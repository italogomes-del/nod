import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { buscarPastas, ENTRADAS_MAX, PROFUNDIDADE_MAX, RESULTADOS_MAX } from "../../../src/adapters/workspace/busca-pastas.ts";

const temporarios: string[] = [];
afterEach(async () => { for (const p of temporarios.splice(0)) await rm(p, { recursive: true, force: true }); });
/**
 * Base descartável no lugar da pasta pessoal: nenhum teste lê a home real.
 * realpath porque no macOS /var é link para /private/var e a busca resolve a base.
 */
async function base() {
  const raiz = await mkdtemp(join(tmpdir(), "nod-busca-test-")); temporarios.push(raiz);
  return realpath(raiz);
}
const tudoAutorizavel = { podeAutorizar: () => true };

it("acha o projeto pelo nome e prefere o que é repositório Git", async () => {
  const raiz = await base();
  await mkdir(join(raiz, "code", "nod"), { recursive: true });
  await mkdir(join(raiz, "code", "nod", ".git"), { recursive: true });
  await mkdir(join(raiz, "Documents", "nod"), { recursive: true });
  const r = await buscarPastas("nod", { ...tudoAutorizavel, base: raiz });
  expect(r.candidatas).toHaveLength(2);
  expect(r.candidatas[0]).toMatchObject({ caminho: join(raiz, "code", "nod"), git: true });
});

it("casa sem acento e sem caixa", async () => {
  const raiz = await base();
  await mkdir(join(raiz, "Relatórios"), { recursive: true });
  expect((await buscarPastas("relatorios", { ...tudoAutorizavel, base: raiz })).candidatas[0]).toMatchObject({ nome: "Relatórios" });
});

it("nome exato vence prefixo e substring", async () => {
  const raiz = await base();
  for (const n of ["nod", "nod-antigo", "meu-nod-velho"]) await mkdir(join(raiz, n), { recursive: true });
  const r = await buscarPastas("nod", { ...tudoAutorizavel, base: raiz });
  expect(r.candidatas[0]!.nome).toBe("nod");
});

it("não desce em node_modules, Library nem em pastas ocultas", async () => {
  const raiz = await base();
  await mkdir(join(raiz, "node_modules", "alvo"), { recursive: true });
  await mkdir(join(raiz, "Library", "alvo"), { recursive: true });
  await mkdir(join(raiz, ".oculta", "alvo"), { recursive: true });
  expect((await buscarPastas("alvo", { ...tudoAutorizavel, base: raiz })).candidatas).toHaveLength(0);
});

it("não segue link simbólico para fora da base", async () => {
  const raiz = await base();
  const fora = await base();
  await mkdir(join(fora, "alvo"), { recursive: true });
  await symlink(fora, join(raiz, "atalho"));
  expect((await buscarPastas("alvo", { ...tudoAutorizavel, base: raiz })).candidatas).toHaveLength(0);
});

it("respeita a profundidade máxima", async () => {
  const raiz = await base();
  // No limite: PROFUNDIDADE_MAX-1 pastas antes do alvo. Um nível além disso fica fora.
  const limite = join(raiz, ...Array.from({ length: PROFUNDIDADE_MAX - 1 }, (_, n) => `n${n}`), "alvo");
  const fundo = join(raiz, ...Array.from({ length: PROFUNDIDADE_MAX }, (_, n) => `f${n}`), "alvo");
  await mkdir(limite, { recursive: true });
  await mkdir(fundo, { recursive: true });
  const r = await buscarPastas("alvo", { ...tudoAutorizavel, base: raiz });
  expect(r.candidatas.map(c => c.caminho)).toContain(limite);
  expect(r.candidatas.map(c => c.caminho)).not.toContain(fundo);
});

it("nunca oferece pasta que a concessão recusaria", async () => {
  const raiz = await base();
  await mkdir(join(raiz, "privado", "alvo"), { recursive: true });
  await mkdir(join(raiz, "code", "alvo"), { recursive: true });
  const r = await buscarPastas("alvo", { base: raiz, podeAutorizar: (p) => !p.includes(`${join(raiz, "privado")}`) });
  expect(r.candidatas.map(c => c.caminho)).toEqual([join(raiz, "code", "alvo")]);
});

it("limita o número de resultados e marca truncado", async () => {
  const raiz = await base();
  for (let n = 0; n < RESULTADOS_MAX + 4; n++) await mkdir(join(raiz, `alvo-${n}`), { recursive: true });
  const r = await buscarPastas("alvo", { ...tudoAutorizavel, base: raiz });
  expect(r.candidatas).toHaveLength(RESULTADOS_MAX);
  expect(r.truncado).toBe(true);
});

it("devolve parcial quando estoura o orçamento de tempo, sem travar", async () => {
  const raiz = await base();
  await mkdir(join(raiz, "code", "alvo"), { recursive: true });
  let t = 0;
  // Relógio que salta o orçamento inteiro na segunda leitura.
  const r = await buscarPastas("alvo", { ...tudoAutorizavel, base: raiz, agora: () => (t += 10_000) });
  expect(r.truncado).toBe(true);
  expect(Array.isArray(r.candidatas)).toBe(true);
});

it("termo vazio não varre nada", async () => {
  const raiz = await base();
  await mkdir(join(raiz, "alvo"), { recursive: true });
  expect(await buscarPastas("   ", { ...tudoAutorizavel, base: raiz })).toEqual({ candidatas: [], truncado: false });
});

it("pasta com marca de projeto ganha de pasta homônima vazia", async () => {
  const raiz = await base();
  await mkdir(join(raiz, "a", "site"), { recursive: true });
  await mkdir(join(raiz, "b", "site"), { recursive: true });
  await writeFile(join(raiz, "b", "site", "package.json"), "{}");
  expect((await buscarPastas("site", { ...tudoAutorizavel, base: raiz })).candidatas[0]!.caminho).toBe(join(raiz, "b", "site"));
});

it("orçamento de entradas é finito", () => {
  expect(ENTRADAS_MAX).toBeLessThanOrEqual(50_000);
});
