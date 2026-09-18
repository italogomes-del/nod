import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { criarPastas } from "../../../src/adapters/workspace/pastas.ts";

const temporarios: string[] = [];
afterEach(async () => { for (const p of temporarios.splice(0)) await rm(p, { recursive: true, force: true }); });
async function fixture() {
  const raiz = await mkdtemp(join(tmpdir(), "nod-pastas-test-")); temporarios.push(raiz);
  const pasta = join(raiz, "documentos"); await mkdir(pasta);
  const i = { tenantId: randomUUID(), pessoaId: randomUUID(), conversaId: randomUUID() };
  return { raiz, pasta, i, p: criarPastas(join(raiz, "privado")) };
}
it("não concede acesso antes da escolha; preserva vínculo e arquivos ao revogar", async () => {
  const f = await fixture();
  expect(await f.p.executar(f.i, "workspace_ler_texto", { caminho: "relatorio.txt" })).toMatchObject({ estado: "precisa_pasta" });
  await f.p.escolher(f.i, f.pasta);
  await f.p.executar(f.i, "workspace_gravar_texto", { caminho: "relatorio.txt", texto: "resultado", revisao: "novo" });
  const reaberto = criarPastas(join(f.raiz, "privado"));
  expect(await reaberto.consultar(f.i)).toMatchObject({ pasta: await realpath(f.pasta) });
  expect(await reaberto.consultar({ ...f.i, pessoaId: randomUUID() })).toBeNull();
  await reaberto.revogar(f.i);
  expect(await reaberto.consultar(f.i)).toBeNull();
  expect(await readFile(join(f.pasta, "relatorio.txt"), "utf8")).toBe("resultado");
});
it("recusa travessia, links externos e escrita em configuração de execução", async () => {
  const f = await fixture();
  await f.p.escolher(f.i, f.pasta);
  await mkdir(join(f.raiz, "fora"));
  await writeFile(join(f.raiz, "fora", "segredo"), "não ler");
  await symlink(join(f.raiz, "fora"), join(f.pasta, "link"));
  for (const caminho of ["../fora/segredo", "link/segredo", ".git/config", ".claude/settings.json"]) {
    await expect(f.p.executar(f.i, "workspace_gravar_texto", { caminho, texto: "não", revisao: "novo" })).rejects.toThrow();
  }
  expect(await readFile(join(f.raiz, "fora", "segredo"), "utf8")).toBe("não ler");
});
it("não permite conceder a própria raiz privada do Nod", async () => {
  const f = await fixture(); await mkdir(join(f.raiz, "privado"));
  await expect(f.p.escolher(f.i, join(f.raiz, "privado"))).rejects.toThrow();
  await expect(f.p.escolher(f.i, f.raiz)).rejects.toThrow();
});
it("seletor não oferece conceder a pasta pessoal nem a raiz privada", async () => {
  const f = await fixture();
  expect(await f.p.listarPastas(homedir())).toMatchObject({ selecionavel: false });
  expect(await f.p.listarPastas(f.raiz)).toMatchObject({ selecionavel: false });
  expect(await f.p.listarPastas(f.pasta)).toMatchObject({ selecionavel: true });
});
it("cancelamento impede nova escrita e preparação", async () => {
  const f = await fixture(); await f.p.escolher(f.i, f.pasta);
  const c = new AbortController(); c.abort();
  await expect(f.p.executar(f.i, "workspace_gravar_texto", { caminho: "cancelado.txt", texto: "não", revisao: "novo" }, c.signal)).rejects.toThrow();
  expect((await f.p.consultar(f.i))?.preparado).toBeNull();
  await expect(readFile(join(f.pasta, "cancelado.txt"))).rejects.toThrow();
});
