import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, realpath, rename, unlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { lerTexto, gravarTexto } from "../../../infra/computador/texto.mjs";
import type { PedidoWorkspace, WorkspacePreparado } from "../../contracts/workspace.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { validarAcaoComputador } from "../../domain/computador.ts";
import { criarPreparadorWorkspace } from "./preparar.ts";
import { executarNoWorkspace } from "./terminal.ts";

type Identidade = { tenantId: string; pessoaId: string; conversaId: string };
type Vinculo = { pasta: string; id: string; preparado: WorkspacePreparado | null };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function dentro(raiz: string, alvo: string): boolean {
  const r = relative(raiz, alvo);
  return r === "" || (!isAbsolute(r) && r !== ".." && !r.startsWith(`..${sep}`));
}

/** definido em 2026-09-18: armazenamento privado na máquina local; não é autorização por si só. */
export function criarPastas(raiz: string, imagem?: string) {
  const preparar = criarPreparadorWorkspace(join(raiz, "ambientes"));
  const registros = join(raiz, "vinculos");
  function arquivo(i: Identidade) {
    if (![i.tenantId, i.pessoaId, i.conversaId].every(v => uuid.test(v))) throw new ErroDeDominio("entrada_invalida");
    return join(registros, `${i.tenantId}-${i.pessoaId}-${i.conversaId}.json`);
  }
  async function consultar(i: Identidade): Promise<Vinculo | null> {
    try { return JSON.parse(await readFile(arquivo(i), "utf8")) as Vinculo; }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return null; throw e; }
  }
  async function salvar(i: Identidade, v: Vinculo) {
    await mkdir(registros, { recursive: true, mode: 0o700 });
    const tmp = `${arquivo(i)}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(v), { mode: 0o600, flag: "wx" });
    await rename(tmp, arquivo(i));
  }
  async function caminho(w: WorkspacePreparado, nome: string, novo = false) {
    if (isAbsolute(nome) || nome.includes("\0") || nome.includes("\\")) throw new ErroDeDominio("entrada_invalida");
    const alvo = resolve(w.caminho, nome);
    if (!dentro(w.caminho, alvo)) throw new ErroDeDominio("nao_permitido");
    const partes = relative(w.caminho, alvo).split(sep);
    if (partes.some(p => [".git", ".nod", ".claude", ".codex", ".agents"].includes(p))) throw new ErroDeDominio("nao_permitido");
    // definido em 2026-09-18: verificar cada ancestral existente antes de criar diretórios.
    if (novo) {
      let pai = w.caminho;
      for (const segmento of partes.slice(0, -1)) {
        pai = join(pai, segmento);
        try { await mkdir(pai); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
        if (!dentro(w.caminho, await realpath(pai))) throw new ErroDeDominio("nao_permitido");
      }
    }
    const real = await realpath(alvo).catch((e: NodeJS.ErrnoException) => {
      if (novo && e.code === "ENOENT") return alvo;
      throw e;
    });
    if (!dentro(w.caminho, real) || relative(w.caminho, real).split(sep).some(p => [".git", ".nod", ".claude", ".codex", ".agents"].includes(p))) throw new ErroDeDominio("nao_permitido");
    return real;
  }
  return {
    consultar,
    async escolher(i: Identidade, pasta: string) {
      if (!isAbsolute(pasta) || pasta.includes("\0")) throw new ErroDeDominio("entrada_invalida");
      const p = await realpath(pasta);
      await mkdir(raiz, { recursive: true, mode: 0o700 });
      const privado = await realpath(raiz);
      if (p === dirname(p) || p === await realpath(homedir()) || dentro(p, privado) || dentro(privado, p)) throw new ErroDeDominio("nao_permitido");
      await readdir(p);
      const v: Vinculo = { pasta: p, id: randomUUID(), preparado: null };
      await salvar(i, v);
      return v;
    },
    async revogar(i: Identidade) {
      await unlink(arquivo(i)).catch((e: NodeJS.ErrnoException) => { if (e.code !== "ENOENT") throw e; });
    },
    async listarPastas(pasta?: string) {
      const p = await realpath(pasta ?? homedir());
      await mkdir(raiz, { recursive: true, mode: 0o700 });
      const privado = await realpath(raiz);
      const selecionavel = p !== dirname(p) && p !== await realpath(homedir()) && !dentro(p, privado) && !dentro(privado, p);
      return { caminho: p, pai: dirname(p), selecionavel, pastas: (await readdir(p, { withFileTypes: true })).filter(e => e.isDirectory() && !e.name.startsWith(".")).map(e => ({ nome: e.name, caminho: join(p, e.name) })).sort((a,b) => a.nome.localeCompare(b.nome)).slice(0, 200) };
    },
    async preparar(i: Identidade, escolha: Pick<PedidoWorkspace, "modo" | "referencia">) {
      const v = await consultar(i);
      if (!v) throw new ErroDeDominio("nao_permitido");
      const w = await preparar({ id: v.id, pastaAutorizada: v.pasta, ...escolha });
      await salvar(i, { ...v, preparado: w });
      return w;
    },
    async executar(i: Identidade, nome: string, args: Record<string, unknown>, sinal = new AbortController().signal) {
      sinal.throwIfAborted();
      const v = await consultar(i);
      if (!v) return { estado: "precisa_pasta", instrucao: "Peça à pessoa para usar Pasta de trabalho nesta conversa e escolher a pasta. Não existe acesso antes dessa escolha." };
      const w = v.preparado ?? await this.preparar(i, { modo: "auto" });
      sinal.throwIfAborted();
      if (await realpath(w.caminho) !== w.caminho || await realpath(v.pasta) !== v.pasta) throw new ErroDeDominio("nao_permitido");
      if (nome === "workspace_terminal") {
        if (typeof args.comando !== "string") throw new ErroDeDominio("entrada_invalida");
        return executarNoWorkspace(w, args.comando, sinal, imagem);
      }
      if (nome === "workspace_arquivos") {
        const itens = await readdir(await caminho(w, String(args.caminho ?? ".")), { withFileTypes: true });
        return { arquivos: itens.slice(0, 100).map(e => ({ nome: e.name, diretorio: e.isDirectory() })), mais: itens.length > 100 };
      }
      const a = validarAcaoComputador({ ...args, tipo: nome.slice(10) });
      if (a.tipo === "ler_texto") return lerTexto(await caminho(w, a.caminho), a.inicio, a.revisao);
      if (a.tipo === "gravar_texto") {
        const destino = await caminho(w, a.caminho, true);
        sinal.throwIfAborted();
        return gravarTexto(destino, a.texto, a.revisao);
      }
      throw new ErroDeDominio("entrada_invalida");
    },
  };
}
