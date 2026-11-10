#!/usr/bin/env node
// NOD-485 (ADR-161): leva ao repo público um commit que ainda entrou no gamefik/nod (os PRs abertos antes do corte,
// manifesto.travaPermitidos). Exporta o pai e o commit pelo manifesto (as mesmas exclusões e reescritas do export),
// tira a diferença entre os dois snapshots e a aplica num clone do marlonwlv/nod. Depois varre o clone (proibidos +
// gitleaks). Não commita nem empurra: quem porta revisa, commita e abre o PR no público.
//
//   node scripts/oss/portar.mjs --ref <sha-do-merge> --publico <clone-do-publico> [--patch <arquivo>]
//
// Sai 0 aplicado e limpo, 1 com achado na varredura (o patch fica aplicado para corrigir) e 2 com erro (nada aplicado).

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { exportar } from "./exportar.mjs";
import { varrer } from "./varrer.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/** O patch (git, binário incluso) do snapshot do pai do ref para o do ref. Vazio = nada público mudou. */
export function patchDoCommit({ repo = RAIZ, ref }) {
  const tmp = mkdtempSync(join(tmpdir(), "nod-portar-"));
  try {
    exportar({ repo, ref: `${ref}^`, saida: join(tmp, "antes"), gitleaks: false });
    exportar({ repo, ref, saida: join(tmp, "depois"), gitleaks: false });
    const r = spawnSync("git", ["diff", "--no-index", "--binary", "--no-renames", "--src-prefix=a/", "--dst-prefix=b/", "antes", "depois"], {
      cwd: tmp,
      maxBuffer: 2 ** 28,
    });
    if (r.status !== 0 && r.status !== 1) throw new Error(`git diff falhou: ${r.stderr.toString().trim()}`);
    // git diff --no-index de duas pastas escreve a/antes/<c> b/depois/<c> (e a/depois/ no arquivo novo, b/antes/ no
    // apagado): tira o nome da pasta, só nas linhas de cabeçalho (o conteúdo do patch fica intacto).
    const tira = (l) => l.replace(/(^| )([ab])\/(antes|depois)\//g, "$1$2/");
    return r.stdout
      .toString("utf8")
      .split("\n")
      .map((l) => (/^(diff --git |--- |\+\+\+ )/.test(l) ? tira(l) : l))
      .join("\n");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/** Aplica o patch no clone do público (3-way, para tolerar o que já divergiu lá). Lança sem aplicar nada se não couber. */
export function aplicar(publico, patch) {
  const tmp = mkdtempSync(join(tmpdir(), "nod-portar-patch-"));
  try {
    const arq = join(tmp, "porta.patch");
    writeFileSync(arq, patch);
    const check = spawnSync("git", ["-C", publico, "apply", "--check", "--3way", arq], { encoding: "utf8" });
    if (check.status !== 0) throw new Error(`o patch não aplica no público:\n${check.stderr.trim()}`);
    const r = spawnSync("git", ["-C", publico, "apply", "--3way", arq], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`git apply falhou:\n${r.stderr.trim()}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

const log = (linha) => process.stdout.write(`${linha}\n`);
const erro = (linha) => process.stderr.write(`${linha}\n`);

function main(argv) {
  const val = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const ref = val("--ref");
  const publico = val("--publico");
  if (!ref || !publico) {
    erro("uso: portar.mjs --ref <sha> --publico <clone-do-publico> [--patch <arquivo>]");
    return 2;
  }
  let patch;
  try {
    patch = patchDoCommit({ ref });
    if (val("--patch")) writeFileSync(val("--patch"), patch);
    if (!patch.trim()) {
      log(`nada público mudou em ${ref}`);
      return 0;
    }
    aplicar(resolve(publico), patch);
  } catch (e) {
    erro(`erro: ${e.message}`);
    return 2;
  }
  const r = varrer(resolve(publico));
  log(`aplicado em ${publico}; varredura: ${r.total} arquivos, limpo=${r.limpo}`);
  for (const a of r.proibidos) log(`proibido: ${a.arquivo}:${a.linha} (${a.motivo}) ${a.trecho}`);
  for (const a of r.gitleaks) log(`gitleaks: ${a.arquivo}:${a.linha} (${a.regra})`);
  return r.limpo ? 0 : 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exit(main(process.argv.slice(2)));
