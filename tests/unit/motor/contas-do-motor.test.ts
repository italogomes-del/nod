import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ProgressoDoLogin, PuxadaDeContas } from "../../../src/contracts/contas-ia.ts";
import { textoDaImpressaoDaConta } from "../../../src/domain/contas-da-pessoa.ts";
import { criarContasLocais } from "../../../desktop/contas-locais.ts";
import { iniciarContasDoMotor, lerIdentidadeNoCli, logoutNoCli, type ClisDoMotor } from "../../../motor/contas.ts";
import { cifrarCodigo } from "../../../web/lib/cifra.ts";

/**
 * ADR-102 item 3, no motor: o login de uma conta pela tela, de ponta a ponta com um `claude` falso. O motor puxa o
 * pedido, roda o login numa pasta de conta nova, sobe o link oficial e a chave pública, recebe o código cifrado,
 * decifra e entrega ao CLI; no fim relata `pronto` com a impressão (e-mail + organização + pessoa, nunca em claro).
 * Depois, "Sair desta máquina" faz o logout na pasta da conta e avisa o servidor.
 */
const PESSOA = "pessoa-1";
const parados: (() => void)[] = [];
afterEach(() => { for (const p of parados.splice(0)) p(); });

async function montar(o: { logoutFalha?: boolean } = {}) {
  const raiz = await mkdtemp(join(tmpdir(), "nod-contas-motor-"));
  const bin = join(raiz, "claude.mjs");
  await copyFile(new URL("../../fixtures/login-ia/claude-login-falso.mjs", import.meta.url), bin);
  await chmod(bin, 0o755);
  const casa = join(raiz, "casa");
  await mkdir(casa, { recursive: true });
  const clis: ClisDoMotor = { bin: async (ia) => (ia === "claude-cli" ? bin : null), envBase: () => ({ PATH: process.env.PATH ?? "", HOME: casa, CODIGO_CERTO: "codigo-certo-123", EMAIL_FALSO: "Marlon@Leapy.com.br", ORG_FALSA: "org-leapy", ...(o.logoutFalha ? { LOGOUT_FALHA: "1" } : {}) }), home: casa, versao: "teste" };
  const arquivo = join(raiz, "contas-locais.json");
  const contas = criarContasLocais({ base: raiz, arquivo, pessoaId: PESSOA, padrao: (ia) => join(casa, ia === "claude-cli" ? ".claude" : ".codex"), lerIdentidade: (ia, env) => lerIdentidadeNoCli(clis, ia, env), logout: (ia, env) => logoutNoCli(clis, ia, env), agora: Date.now });
  await contas.carregar();
  const progresso: ProgressoDoLogin[] = [];
  const saidas: { impressoes: string[]; desconectada: boolean }[] = [];
  const respostas: (PuxadaDeContas | "sem_rota")[] = [];
  let reanuncios = 0;
  let desconectou = false;
  const atualizar: string[] = [];
  const motor = iniciarContasDoMotor({
    ponte: {
      puxar: async () => respostas.shift() ?? { logins: [], sair: [], desconectar: false },
      progresso: async (p) => { progresso.push(p); return true; },
      saiu: async (impressoes, desconectada) => { saidas.push({ impressoes, desconectada }); return true; },
    },
    contas, clis, arquivo,
    reanunciar: async () => { reanuncios++; },
    desconectar: async () => { desconectou = true; },
    atualizar: (ia) => { atualizar.push(ia); },
    agora: Date.now,
    agendar: (fn, ms) => { const t = setTimeout(fn, ms <= 3_000 ? 15 : ms); return { cancelar: () => clearTimeout(t) }; },
  });
  parados.push(() => motor.parar());
  const esperar = async (cond: () => boolean, ms = 10_000) => {
    const ate = Date.now() + ms;
    while (!cond()) { if (Date.now() > ate) throw new Error("tempo"); await new Promise((r) => setTimeout(r, 20)); }
  };
  return { contas, progresso, saidas, respostas, esperar, arquivo, atualizar, get reanuncios() { return reanuncios; }, get desconectou() { return desconectou; } };
}

/** Um login completo pela tela (o código certo), até o `pronto`. */
async function logar(m: Awaited<ReturnType<typeof montar>>): Promise<void> {
  const id = "55555555-5555-4555-8555-555555555555";
  m.respostas.push({ logins: [{ id, ia: "claude-cli", impressao: null, apelido: null }], sair: [], desconectar: false });
  await m.esperar(() => m.progresso.some((p) => p.fase === "aguardando_pessoa"));
  const chave = m.progresso.find((p) => p.fase === "aguardando_pessoa")!.chavePublica!;
  m.respostas.push({ logins: [{ id, ia: "claude-cli", impressao: null, apelido: null, codigo: await cifrarCodigo(chave, "codigo-certo-123") }], sair: [], desconectar: false });
  await m.esperar(() => m.progresso.some((p) => p.fase === "pronto"));
}

const impressaoEsperada = createHash("sha256").update(textoDaImpressaoDaConta({ pessoaId: PESSOA, ia: "claude-cli", email: "marlon@leapy.com.br", orgId: "org-leapy" })).digest("hex");

describe("contas do motor (ADR-102)", { timeout: 20_000 }, () => {
  it("login pela tela: link oficial + chave pública, código cifrado decifrado no CLI, pronto com a impressão", async () => {
    const m = await montar();
    m.respostas.push({ logins: [{ id: "11111111-1111-4111-8111-111111111111", ia: "claude-cli", impressao: null, apelido: "Leapy" }], sair: [], desconectar: false });
    await m.esperar(() => m.progresso.some((p) => p.fase === "aguardando_pessoa"));
    const aguardando = m.progresso.find((p) => p.fase === "aguardando_pessoa")!;
    expect(aguardando).toMatchObject({ url: "https://claude.com/cai/oauth/authorize?code=true&client_id=falso&state=xyz", pedeCodigo: true });
    expect(aguardando.chavePublica).toMatch(/^[A-Za-z0-9+/]+=*$/);
    const cifrado = await cifrarCodigo(aguardando.chavePublica!, "codigo-certo-123");
    m.respostas.push({ logins: [{ id: "11111111-1111-4111-8111-111111111111", ia: "claude-cli", impressao: null, apelido: "Leapy", codigo: cifrado }], sair: [], desconectar: false });
    await m.esperar(() => m.progresso.some((p) => p.fase === "pronto" || p.fase === "falhou"));
    expect(m.progresso.at(-1)).toMatchObject({ fase: "pronto", impressao: impressaoEsperada });
    expect(m.progresso.map((p) => p.fase)).toEqual(expect.arrayContaining(["abrindo", "aguardando_pessoa", "conferindo", "pronto"]));
    expect(m.reanuncios).toBeGreaterThan(0);
    // A conta entrou na pasta de sempre (a primeira do Claude nesta máquina), com o apelido para o anúncio.
    expect(m.contas.anuncio()).toEqual([expect.objectContaining({ impressao: impressaoEsperada, ia: "claude-cli", estado: "pronta", apelidoSugerido: "Leapy" })]);
    // ADR-105: o e-mail vai no anúncio (para a tela de Provedores), nunca ao arquivo da lista.
    expect(m.contas.anuncio()[0]!.email?.toLowerCase()).toContain("leapy.com.br");
    expect((await readFile(m.arquivo, "utf8")).toLowerCase()).not.toContain("leapy.com.br");
  });

  it("código errado: o login falha com a causa do CLI e nada fica pela metade", async () => {
    const m = await montar();
    m.respostas.push({ logins: [{ id: "22222222-2222-4222-8222-222222222222", ia: "claude-cli", impressao: null, apelido: null }], sair: [], desconectar: false });
    await m.esperar(() => m.progresso.some((p) => p.fase === "aguardando_pessoa"));
    const chave = m.progresso.find((p) => p.fase === "aguardando_pessoa")!.chavePublica!;
    m.respostas.push({ logins: [{ id: "22222222-2222-4222-8222-222222222222", ia: "claude-cli", impressao: null, apelido: null, codigo: await cifrarCodigo(chave, "codigo-errado-999") }], sair: [], desconectar: false });
    await m.esperar(() => m.progresso.some((p) => p.fase === "falhou"));
    expect(m.progresso.at(-1)).toMatchObject({ fase: "falhou" });
    expect(m.contas.anuncio()).toEqual([]);
    expect(await readFile(m.arquivo, "utf8")).toContain('"armadaEm":0');
  });

  it("sair desta máquina: logout na pasta da conta, o servidor fica sabendo e a conta some do anúncio", async () => {
    const m = await montar();
    m.respostas.push({ logins: [{ id: "33333333-3333-4333-8333-333333333333", ia: "claude-cli", impressao: null, apelido: null }], sair: [], desconectar: false });
    await m.esperar(() => m.progresso.some((p) => p.fase === "aguardando_pessoa"));
    const chave = m.progresso.find((p) => p.fase === "aguardando_pessoa")!.chavePublica!;
    m.respostas.push({ logins: [{ id: "33333333-3333-4333-8333-333333333333", ia: "claude-cli", impressao: null, apelido: null, codigo: await cifrarCodigo(chave, "codigo-certo-123") }], sair: [], desconectar: false });
    await m.esperar(() => m.progresso.some((p) => p.fase === "pronto"));
    m.respostas.push({ logins: [], sair: [impressaoEsperada], desconectar: false });
    await m.esperar(() => m.saidas.length > 0);
    expect(m.saidas[0]).toEqual({ impressoes: [impressaoEsperada], desconectada: false });
    expect(m.contas.anuncio()).toEqual([]);
  });

  it("NOD-9 PR4: o Atualizar da tela chega na puxada e vai ao atualizador da máquina, uma vez", async () => {
    const m = await montar();
    m.respostas.push({ logins: [], sair: [], desconectar: false, atualizar: ["claude-cli"] });
    await m.esperar(() => m.atualizar.length > 0);
    await new Promise((r) => setTimeout(r, 100));
    expect(m.atualizar).toEqual(["claude-cli"]);
  });

  it("desconectar com 'sair das contas': sai de todas, confirma ao servidor e para o motor", async () => {
    const m = await montar();
    m.respostas.push({ logins: [], sair: [], desconectar: true });
    await m.esperar(() => m.desconectou);
    expect(m.saidas).toEqual([{ impressoes: [], desconectada: true }]);
  });

  it("desconectar depois de um login: sai da conta (logout na pasta) e confirma a impressão", async () => {
    const m = await montar();
    await logar(m);
    m.respostas.push({ logins: [], sair: [], desconectar: true });
    await m.esperar(() => m.desconectou);
    expect(m.saidas).toEqual([{ impressoes: [impressaoEsperada], desconectada: true }]);
    expect(m.contas.anuncio()).toEqual([]);
  });

  it("revisão do PR #306: logout que falha não é confirmado (a saída fica pendente e a conta continua anunciada)", async () => {
    const m = await montar({ logoutFalha: true });
    await logar(m);
    m.respostas.push({ logins: [], sair: [impressaoEsperada], desconectar: false });
    await m.esperar(() => m.saidas.length > 0);
    expect(m.saidas[0]).toEqual({ impressoes: [], desconectada: false });
    expect(m.contas.anuncio()).toHaveLength(1);
  });

  it("servidor sem contas (404): a puxada para e nada mais acontece", async () => {
    const m = await montar();
    m.respostas.push("sem_rota");
    await new Promise((r) => setTimeout(r, 120));
    m.respostas.push({ logins: [{ id: "44444444-4444-4444-8444-444444444444", ia: "claude-cli", impressao: null, apelido: null }], sair: [], desconectar: false });
    await new Promise((r) => setTimeout(r, 120));
    expect(m.progresso).toEqual([]);
  });
});
