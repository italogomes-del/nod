#!/usr/bin/env node
// NOD-485 (ADR-161): o gamefik/nod está congelado; o código aberto e a operação moram no marlonwlv/nod. Esta trava
// reprova o PR daqui que mexe em caminho público (todo arquivo que o oss/manifesto.json NÃO exclui), para nada novo
// nascer aqui e se perder. Passam: o que só mexe em caminho privado, os PRs abertos antes do corte
// (manifesto.travaPermitidos) e o PR com o rótulo `transicao-nod-485` (posto por quem administra, à mão).
//
//   node scripts/oss/trava.mjs --base <sha> [--head HEAD] [--pr <n>] [--rotulos a,b] [--repo <pasta>]
//
// O manifesto vem do BASE, nunca do PR: senão o próprio PR afrouxaria a regra (um `excluir: ["**"]` ou o número dele em
// travaPermitidos). Base sem travaPermitidos = a trava ainda não entrou na main (o PR que a cria) e libera. O ci.yml roda
// também este script a partir do base, pelo mesmo motivo.
//
// Sai 0 liberado, 1 travado (lista os arquivos) e 2 com erro de uso.

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { casa } from "./exportar.mjs";

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
export const ROTULO = "transicao-nod-485";

/** Decide a trava. Devolve { liberado, motivo, publicos }. */
export function decidir({ arquivos, manifesto, pr, rotulos = [] }) {
  const publicos = arquivos.filter((a) => !casa(a, manifesto.excluir));
  if (!publicos.length) return { liberado: true, motivo: "só caminho privado", publicos };
  if (pr && (manifesto.travaPermitidos ?? []).includes(pr)) return { liberado: true, motivo: `PR #${pr} aberto antes do corte`, publicos };
  if (rotulos.includes(ROTULO)) return { liberado: true, motivo: `rótulo ${ROTULO}`, publicos };
  return { liberado: false, motivo: "mexe em caminho público", publicos };
}

/** O oss/manifesto.json no ref (o base do PR). */
export function manifestoEm(repo, ref) {
  const r = spawnSync("git", ["-C", repo, "show", `${ref}:oss/manifesto.json`], { encoding: "utf8", maxBuffer: 2 ** 26 });
  if (r.status !== 0) throw new Error(`sem oss/manifesto.json em ${ref}: ${r.stderr.trim()}`);
  return JSON.parse(r.stdout);
}

/** Os arquivos mudados entre base e head (inclui apagados e os dois lados de um rename). */
export function arquivosMudados(repo, base, head = "HEAD") {
  const r = spawnSync("git", ["-C", repo, "diff", "--name-only", "--no-renames", "-z", `${base}...${head}`], { encoding: "utf8", maxBuffer: 2 ** 26 });
  if (r.status !== 0) throw new Error(`git diff falhou: ${r.stderr.trim()}`);
  return r.stdout.split("\0").filter(Boolean);
}

const log = (linha) => process.stdout.write(`${linha}\n`);
const erro = (linha) => process.stderr.write(`${linha}\n`);

function main(argv) {
  const val = (k) => {
    const i = argv.indexOf(k);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const base = val("--base");
  if (!base) {
    erro("uso: trava.mjs --base <sha> [--head HEAD] [--pr <n>] [--rotulos a,b] [--repo <pasta>]");
    return 2;
  }
  const repo = resolve(val("--repo") ?? RAIZ);
  let manifesto;
  let arquivos;
  try {
    manifesto = manifestoEm(repo, base);
    arquivos = arquivosMudados(repo, base, val("--head") ?? "HEAD");
  } catch (e) {
    erro(`erro: ${e.message}`);
    return 2;
  }
  if (!Array.isArray(manifesto.travaPermitidos)) {
    log("liberado: a trava ainda não está no base (manifesto sem travaPermitidos)");
    return 0;
  }
  const pr = val("--pr") ? Number(val("--pr")) : undefined;
  const rotulos = (val("--rotulos") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const r = decidir({ arquivos, manifesto, pr, rotulos });
  if (r.liberado) {
    log(`liberado: ${r.motivo}${r.publicos.length ? ` (${r.publicos.length} arquivo(s) público(s))` : ""}`);
    return 0;
  }
  log("::error::O gamefik/nod está congelado (NOD-485, ADR-161): abra este PR no marlonwlv/nod. Arquivos públicos mexidos:");
  for (const a of r.publicos) log(`  ${a}`);
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) process.exit(main(process.argv.slice(2)));
