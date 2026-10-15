import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { criarContasLocais, inventariosComContas, type IdentidadeDaConta } from "../../../desktop/contas-locais.ts";
import { iniciarContasNoServidor } from "../../../desktop/contas-no-servidor.ts";
import type { IaDesktop } from "../../../src/contracts/desktop.ts";
import type { ContaAnunciada, PuxadaDeContas } from "../../../src/contracts/contas-ia.ts";
import type { Inventario } from "../../../src/contracts/inventario.ts";
import { estadoDaMaquina } from "../../../src/domain/harness.ts";

/**
 * ADR-102 no app do Mac (2026-10-13): a lista que vai ao servidor segue a do app (contas.json, ADR-101), o e-mail e a
 * organização ficam na memória (para a tela e, ADR-105, para o anúncio), nunca no arquivo, e a puxada atende "Sair do Mac" e "Desconectar".
 */
async function montar(identidades: Record<string, IdentidadeDaConta>, aoLogout: (env: Record<string, string>) => void = () => undefined) {
  const raiz = await mkdtemp(join(tmpdir(), "nod-contas-locais-"));
  const arquivo = join(raiz, "contas-locais.json");
  const contas = criarContasLocais({
    base: raiz,
    arquivo,
    pessoaId: "pessoa-1",
    padrao: (ia) => join(raiz, ia),
    // O ambiente diz qual pasta: a conta de sempre não tem variável.
    lerIdentidade: async (ia: IaDesktop, env) => identidades[`${ia}:${Object.values(env)[0]?.split("/").at(-1) ?? "padrao"}`] ?? { logado: false, email: null, orgId: null, plano: null },
    logout: async (_ia, env) => { aoLogout(env); return true; },
    agora: Date.now,
  });
  await contas.carregar();
  return { contas, arquivo };
}

const LEAPY: IdentidadeDaConta = { logado: true, email: "marlon@leapy.com.br", orgId: "org-leapy", plano: "Team", organizacao: "Leapy" };
const PESSOAL: IdentidadeDaConta = { logado: true, email: "marlon@exemplo.com", orgId: "org-p", plano: "Max", organizacao: null };

describe("contas locais no app do Mac (ADR-102)", () => {
  it("segue a lista do app: conta nova entra e é lida, a que saiu some do anúncio", async () => {
    const m = await montar({ "claude-cli:padrao": PESSOAL, "claude-cli:c-1": LEAPY });
    await m.contas.sincronizar([{ ia: "claude-cli", id: "padrao", apelido: "Pessoal" }, { ia: "claude-cli", id: "c-1", apelido: "Leapy" }, { ia: "codex-cli", id: "padrao", apelido: null }]);
    await m.contas.ler();
    // O apelido igual à organização da conta não sai (red team do PR #306: a ADR-101 o tirava da organização).
    expect(m.contas.anuncio().map((c) => c.apelidoSugerido)).toEqual(["Pessoal", undefined]);
    const sairam = await m.contas.sincronizar([{ ia: "claude-cli", id: "padrao", apelido: "Pessoal" }]);
    expect(sairam.map((c) => c.id)).toEqual(["c-1"]);
    expect(m.contas.anuncio()).toHaveLength(1);
  });

  it("ADR-105: e-mail e organização vão nos detalhes e no anúncio, nunca no arquivo", async () => {
    const m = await montar({ "claude-cli:c-1": LEAPY });
    await m.contas.sincronizar([{ ia: "claude-cli", id: "c-1", apelido: null }]);
    await m.contas.ler();
    expect(m.contas.detalhes()).toEqual([expect.objectContaining({ ia: "claude-cli", email: "marlon@leapy.com.br", organizacao: "Leapy", plano: "Team" })]);
    expect(m.contas.detalhes()[0]!.impressao).toBe(m.contas.anuncio()[0]!.impressao);
    expect(m.contas.anuncio()[0]).toMatchObject({ email: "marlon@leapy.com.br", organizacao: "Leapy" });
    expect(await readFile(m.arquivo, "utf8")).not.toContain("leapy.com.br");
  });

  it("ADR-105: a conta carregada do arquivo e ainda não relida vai sem e-mail (o servidor mantém o que tinha)", async () => {
    const m = await montar({ "claude-cli:c-1": LEAPY });
    await m.contas.sincronizar([{ ia: "claude-cli", id: "c-1", apelido: null }]);
    await m.contas.ler();
    // O app reaberto: carrega o arquivo e anuncia antes de reler o CLI.
    const raiz = dirname(m.arquivo);
    const reaberta = criarContasLocais({ base: raiz, arquivo: m.arquivo, pessoaId: "pessoa-1", padrao: (ia) => join(raiz, ia), lerIdentidade: async () => LEAPY, logout: async () => true, agora: Date.now });
    await reaberta.carregar();
    expect(reaberta.anuncio()[0]).toMatchObject({ impressao: m.contas.anuncio()[0]!.impressao });
    expect(reaberta.anuncio()[0]).not.toHaveProperty("email");
    expect(reaberta.anuncio()[0]).not.toHaveProperty("organizacao");
  });

  it("red team do PR #306: entre duas cópias da mesma conta, vale a pronta (a vencida não esconde o login novo)", async () => {
    const m = await montar({ "claude-cli:padrao": LEAPY, "claude-cli:c-1": LEAPY });
    await m.contas.sincronizar([{ ia: "claude-cli", id: "padrao", apelido: null }, { ia: "claude-cli", id: "c-1", apelido: null }]);
    await m.contas.ler();
    // A de sempre perde o login; a c-1 segue pronta com a mesma conta.
    const padrao = m.contas.porId("padrao", "claude-cli")!;
    Object.assign(padrao, { estado: "sem_login" });
    expect(m.contas.anuncio()).toEqual([expect.objectContaining({ estado: "pronta" })]);
    expect(m.contas.porImpressao(m.contas.anuncio()[0]!.impressao)?.id).toBe("c-1");
  });

  it("red team do PR #306: o login novo reaproveita a conta de sempre vencida (o `nod-motor entrar` renova o login)", async () => {
    const m = await montar({ "claude-cli:padrao": LEAPY });
    await m.contas.sincronizar([{ ia: "claude-cli", id: "padrao", apelido: null }]);
    await m.contas.ler();
    Object.assign(m.contas.porId("padrao", "claude-cli")!, { estado: "sem_login" });
    expect((await m.contas.pastaParaLogin("claude-cli", null))?.id).toBe("padrao");
  });

  // Regression: ISSUE-002/006 — a mesma conta logada na pasta de sempre e numa pasta nova ficava nas duas, e o "Sair"
  // fazia logout só numa (a conta continuava na máquina). Found by /qa on 2026-10-13.
  it("QA do PR #306: com a mesma conta em duas pastas prontas, a repetida sai e a de sempre fica; o Sair faz logout em todas", async () => {
    const logouts: string[] = [];
    const m = await montar({ "claude-cli:padrao": LEAPY, "claude-cli:c-1": LEAPY, "claude-cli:c-2": LEAPY }, (env) => { logouts.push(Object.values(env)[0]?.split("/").at(-1) ?? "padrao"); });
    await m.contas.sincronizar([{ ia: "claude-cli", id: "padrao", apelido: null }, { ia: "claude-cli", id: "c-1", apelido: null }, { ia: "claude-cli", id: "c-2", apelido: null }]);
    await m.contas.ler();
    Object.assign(m.contas.porId("c-1", "claude-cli")!, { logadaEm: Date.now() + 5 });
    expect(await m.contas.descartarRepetidas()).toBe(2);
    expect(m.contas.listar().filter((c) => c.ia === "claude-cli").map((c) => c.id)).toEqual(["padrao"]);
    // Duas cópias de novo (o login pela tela numa pasta nova): o Sair sai das duas.
    const m2 = await montar({ "claude-cli:padrao": LEAPY, "claude-cli:c-1": LEAPY }, (env) => { logouts.push(Object.values(env)[0]?.split("/").at(-1) ?? "padrao"); });
    await m2.contas.sincronizar([{ ia: "claude-cli", id: "padrao", apelido: null }, { ia: "claude-cli", id: "c-1", apelido: null }]);
    await m2.contas.ler();
    logouts.length = 0;
    await m2.contas.sair(m2.contas.anuncio()[0]!.impressao);
    expect(logouts.sort()).toEqual(["c-1", "padrao"]);
    expect(m2.contas.anuncio()).toEqual([]);
  });

  it("a mesma conta em duas pastas vai ao servidor uma vez só", async () => {
    const m = await montar({ "claude-cli:padrao": LEAPY, "claude-cli:c-1": LEAPY });
    await m.contas.sincronizar([{ ia: "claude-cli", id: "padrao", apelido: null }, { ia: "claude-cli", id: "c-1", apelido: null }]);
    await m.contas.ler();
    expect(m.contas.anuncio()).toHaveLength(1);
  });
});

describe("puxada de contas no app do Mac (ADR-102)", () => {
  const agendar = (fn: () => void, ms: number) => { const t = setTimeout(fn, ms === 0 ? 0 : 10); return { cancelar: () => clearTimeout(t) }; };
  const esperar = async (cond: () => boolean) => { const ate = Date.now() + 2_000; while (!cond()) { if (Date.now() > ate) throw new Error("tempo"); await new Promise((r) => setTimeout(r, 5)); } };

  it("sair: sai de cada conta pedida e confirma ao servidor", async () => {
    const respostas: (PuxadaDeContas | "sem_rota")[] = [{ logins: [], sair: ["a".repeat(64)], desconectar: false }];
    const saiu: unknown[] = [];
    const sairam: string[] = [];
    const p = iniciarContasNoServidor({ ponte: { puxar: async () => respostas.shift() ?? { logins: [], sair: [], desconectar: false }, saiu: async (i, d) => { saiu.push({ i, d }); return true; } }, sair: async (i) => { sairam.push(i); return true; }, todas: () => [], desconectar: async () => undefined, agendar });
    await esperar(() => saiu.length > 0);
    p.parar();
    expect(sairam).toEqual(["a".repeat(64)]);
    expect(saiu).toEqual([{ i: ["a".repeat(64)], d: false }]);
  });

  it("desconectar com 'sair das contas': sai de todas, confirma desconectada e para", async () => {
    const saiu: unknown[] = [];
    let desconectou = false;
    let puxadas = 0;
    iniciarContasNoServidor({ ponte: { puxar: async () => { puxadas++; return { logins: [], sair: [], desconectar: true }; }, saiu: async (i, d) => { saiu.push({ i, d }); return true; } }, sair: async () => true, todas: () => ["b".repeat(64)], desconectar: async () => { desconectou = true; }, agendar });
    await esperar(() => desconectou);
    await new Promise((r) => setTimeout(r, 40));
    expect(saiu).toEqual([{ i: ["b".repeat(64)], d: true }]);
    expect(puxadas).toBe(1);
  });

  it("servidor sem contas (404): para de puxar", async () => {
    let puxadas = 0;
    iniciarContasNoServidor({ ponte: { puxar: async () => { puxadas++; return "sem_rota"; }, saiu: async () => true }, sair: async () => true, todas: () => [], desconectar: async () => undefined, agendar });
    await new Promise((r) => setTimeout(r, 60));
    expect(puxadas).toBe(1);
  });
});

// #313: o anúncio (motor/main.ts e desktop/main.ts) manda `estadoDaMaquina(principal, inventariosComContas(…))`. Antes mandava
// `comContas["claude-cli"] ?? principal`: com o Claude sempre instalado, a máquina só com o ChatGPT nunca ficava pronta.
describe("o estado da máquina no anúncio (#313)", () => {
  const semLogin: Inventario = { estado: "nao_autenticado", motivo: "Entre na conta do harness neste computador", em: 1 };
  const conta = (ia: ContaAnunciada["ia"]): ContaAnunciada => ({ impressao: "a".repeat(64), ia, estado: "pronta", plano: null, corporativa: false, logadaEm: 1 });

  it("só o Codex pronto: a máquina vai pronta pelo Codex", () => {
    const comContas = inventariosComContas({ "claude-cli": semLogin, "codex-cli": { estado: "pronto", versao: "0.162.0", em: 2 } }, []);
    expect(estadoDaMaquina(semLogin, comContas)).toMatchObject({ estado: "pronto", versao: "0.162.0" });
  });

  it("red team do PR #306 continua: a conta de sempre deslogada e outra conta Claude pronta deixam a máquina pronta", () => {
    const comContas = inventariosComContas({ "claude-cli": semLogin, "codex-cli": semLogin }, [conta("claude-cli")]);
    expect(estadoDaMaquina(semLogin, comContas)).toMatchObject({ estado: "pronto" });
  });

  it("nenhuma IA pronta nem conta pronta: vai a explicação da vigia (`principal`)", () => {
    const principal: Inventario = { estado: "nao_autenticado", causa: "teste_falhou", motivo: "testei e não respondeu", em: 3 };
    expect(estadoDaMaquina(principal, inventariosComContas({ "claude-cli": semLogin, "codex-cli": semLogin }, []))).toBe(principal);
  });
});
