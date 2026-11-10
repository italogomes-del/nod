#!/usr/bin/env node
// NOD-485 (ADR-161): varre um clone do repo público (ou qualquer pasta git) com os padrões proibidos do
// oss/manifesto.json e o gitleaks. A lista de proibidos é interna e não vai ao público; por isso esta varredura mora aqui.
//
//   node scripts/oss/varrer.mjs <pasta-git>            os arquivos versionados + os novos não ignorados (antes do push)
//   node scripts/oss/varrer.mjs <pasta-git> --ref <r>  os arquivos do ref <r> (a main ou o head de um PR)
//   node scripts/oss/varrer.mjs ... --json             resumo em JSON
//
// Sai 0 limpo, 1 com achado e 2 com erro de uso. O trecho achado é impresso (é o que a pessoa precisa para corrigir);
// rode localmente ou em log privado, nunca num log público.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lerBlobs, listarRef, rodarGitleaks, validarManifesto, varrerProibidos, gravarSnapshot } from "./exportar.mjs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** Os arquivos da pasta: do ref, ou os versionados + novos não ignorados do working tree. Map caminho → {conteudo, modo}. */
export function arquivosDe(dir, ref) {
  const arquivos = new Map();
  if (ref) {
    const entradas = listarRef(dir, ref);
    const blobs = lerBlobs(dir, entradas.map((e) => e.sha));
    for (const e of entradas) arquivos.set(e.caminho, { conteudo: blobs.get(e.sha), modo: e.modo });
    return arquivos;
  }
  const r = spawnSync("git", ["-C", dir, "ls-files", "-z", "-c", "-o", "--exclude-standard"], { encoding: "utf8", maxBuffer: 2 ** 28 });
  if (r.status !== 0) throw new Error(`git ls-files falhou: ${r.stderr.trim()}`);
  for (const caminho of new Set(r.stdout.split("\0").filter(Boolean))) {
    try {
      arquivos.set(caminho, { conteudo: readFileSync(join(dir, caminho)), modo: "100644" });
    } catch (e) {
      if (e.code !== "ENOENT" && e.code !== "EISDIR") throw e; // apagado no working tree / submódulo
    }
  }
  return arquivos;
}

export function varrer(dir, { ref, manifestoPath = join(RAIZ, "oss/manifesto.json"), gitleaks = true } = {}) {
  const manifesto = JSON.parse(readFileSync(manifestoPath, "utf8"));
  validarManifesto(manifesto);
  const arquivos = arquivosDe(dir, ref);
  const proibidos = varrerProibidos(arquivos, manifesto);
  let vazamentos = [];
  if (gitleaks) {
    const tmp = mkdtempSync(join(tmpdir(), "nod-varrer-"));
    try {
      gravarSnapshot(tmp, arquivos);
      vazamentos = rodarGitleaks(tmp, join(RAIZ, manifesto.gitleaksConfig ?? "oss/gitleaks.toml"));
      if (vazamentos === null) throw new Error("gitleaks não encontrado (instale ou defina GITLEAKS)");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  return { total: arquivos.size, proibidos, gitleaks: vazamentos, limpo: proibidos.length === 0 && vazamentos.length === 0 };
}

const log = (linha) => process.stdout.write(`${linha}\n`);
const erro = (linha) => process.stderr.write(`${linha}\n`);

function main(argv) {
  const dir = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--ref");
  const i = argv.indexOf("--ref");
  const ref = i >= 0 ? argv[i + 1] : undefined;
  if (!dir || (i >= 0 && !ref)) {
    erro("uso: varrer.mjs <pasta-git> [--ref <ref>] [--json]");
    return 2;
  }
  let r;
  try {
    r = varrer(resolve(dir), { ref });
  } catch (e) {
    erro(`erro: ${e.message}`);
    return 2;
  }
  if (argv.includes("--json")) log(JSON.stringify(r));
  else {
    log(`${r.total} arquivos, limpo=${r.limpo}`);
    for (const a of r.proibidos) log(`proibido: ${a.arquivo}:${a.linha} (${a.motivo}) ${a.trecho}`);
    for (const a of r.gitleaks) log(`gitleaks: ${a.arquivo}:${a.linha} (${a.regra})`);
  }
  return r.limpo ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exit(main(process.argv.slice(2)));
