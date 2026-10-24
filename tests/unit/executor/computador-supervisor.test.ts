// NOD-96 PR 2 (ADR-122): o supervisor como processo comum, com dbus/keyring/secret-tool falsos e sem telas reais.
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assinarComando, chaveDaLoja, chaveDaMaquina, chaveDoStorage, chavesDeAssinatura, selar } from "../../../infra/computador/chaves.mjs";
import { fundir, gravarLoja, lerLoja, lojaVazia, cookiesVivos } from "../../../infra/computador/loja-cookies.mjs";
import { gravarOrigem, hashDosDados, lerTudo, pastaDoStorage } from "../../../infra/computador/login-storage.mjs";
import { criarSupervisor, escutarControle, servirControle, type Supervisor } from "../../../infra/computador/supervisor.mjs";
import { criarServidorTerminal, escutar } from "../../../infra/computador/terminal.mjs";
import { ETAPAS } from "../../../web/lib/computador-pessoa.ts";

const CRED = "b".repeat(64);
const ID = "pc1";
const limpar: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => { for (const f of limpar.splice(0).reverse()) await f(); });

async function montar(leitura = () => ({ memoria: "verde" as unknown, processador: "verde" as unknown }), aoAtualizar?: () => void) {
  const dir = await mkdtemp(join(tmpdir(), "nod-supervisor-test-"));
  limpar.push(() => rm(dir, { recursive: true, force: true }));
  const bin = async (nome: string, corpo: string) => {
    const f = join(dir, nome);
    await writeFile(f, `#!/bin/sh\n${corpo}\n`);
    await chmod(f, 0o755);
    return f;
  };
  const registro = join(dir, "registro");
  const binarios = {
    dbus: await bin("dbus", 'for a in "$@"; do case "$a" in --address=*) echo "${a#--address=}";; esac; done; exec sleep 60'),
    // Como os de verdade: o keyring só "destrava" depois de ler a senha inteira (grava e renomeia, atômico), e o
    // secret-tool falha até o keyring estar de pé — o supervisor tenta de novo. Antes o secret-tool passava na hora e o
    // teste podia ler o .keyring ainda vazio (corrida).
    keyring: await bin("keyring", `cat > "${registro}.keyring.tmp" && mv "${registro}.keyring.tmp" "${registro}.keyring"; exec sleep 60`),
    secretTool: await bin("secret-tool", `[ -f "${registro}.keyring" ] || { cat >/dev/null; exit 1; }; cat > "${registro}.safe"`),
    xvfb: "Xvfb", openbox: "openbox", chromium: "chromium", bwrap: null, xdotool: "xdotool", xclip: "xclip", scrot: "scrot",
  };
  const terminal = join(dir, "term.sock");
  const st = criarServidorTerminal({ raiz: join(dir, "raiz") });
  await escutar(st, terminal);
  limpar.push(() => new Promise((r) => st.close(r)));
  const logs: string[] = [];
  const sup = criarSupervisor({ raiz: join(dir, "raiz"), run: join(dir, "run"), terminal, bin: binarios, leitura, log: (m) => logs.push(m), aoAtualizar });
  limpar.push(() => sup.encerrar());
  return { dir, sup, registro, logs, terminal };
}

const { privada, publica } = chavesDeAssinatura(CRED, ID);
let n = 0;
const cmd = (c: Record<string, unknown>, chave = privada) =>
  assinarComando({ id: `c${++n}`, computadorId: ID, uso: "equilibrado", prazoMs: Date.now() + 60_000, ...c }, chave);

async function iniciar(sup: Supervisor) {
  // Qualquer comando cria o computador no disco (e o par X25519); antes do TOFU ele é recusado.
  if (!sup.estados().some((e) => e.computadorId === ID)) await sup.tratar(cmd({ tipo: "parar" }));
  const supervisorPub = sup.estados().find((e) => e.computadorId === ID)!.supervisorPub;
  return sup.tratar(cmd({ tipo: "iniciar", servidorPub: publica, segredoSelado: selar(supervisorPub, chaveDaMaquina(CRED, ID)) }));
}

describe("supervisor", () => {
  it("recusa comando sem a chave do servidor fixada, fixa no primeiro iniciar (TOFU) e liga a máquina", async () => {
    const { sup, registro, dir } = await montar();
    expect((await sup.tratar(cmd({ tipo: "parar" }))).motivo).toBe("acao_falhou");
    const r = await iniciar(sup);
    expect(r).toMatchObject({ desfecho: "ok" });
    expect((await readFile(join(dir, "raiz", ID, "estado", "servidor.pub"), "utf8")).trim()).toBe(publica);
    const chave = chaveDaMaquina(CRED, ID);
    expect(await readFile(`${registro}.keyring`, "utf8")).toBe(chave);
    expect((await readFile(`${registro}.safe`, "utf8")).length).toBeGreaterThan(20);
    expect(sup.estados()[0]?.ligado).toBe(true);
    // Outra chave de servidor não entra depois de fixada, nem num iniciar.
    const outra = chavesDeAssinatura("c".repeat(64), ID);
    expect((await sup.tratar(cmd({ tipo: "parar", servidorPub: outra.publica }, outra.privada))).desfecho).toBe("falhou");
  });

  it("comando repetido ou vencido é recusado", async () => {
    const { sup } = await montar();
    await iniciar(sup);
    const c = cmd({ tipo: "fechar_tela", agenteId: "bot1" });
    expect((await sup.tratar(c)).desfecho).toBe("ok");
    expect((await sup.tratar(c)).desfecho).toBe("falhou");
    expect((await sup.tratar(cmd({ tipo: "fechar_tela", agenteId: "bot1", prazoMs: Date.now() - 1 }))).desfecho).toBe("falhou");
  });

  it("segredo selado para outra chave é cofre_invalido", async () => {
    const { sup } = await montar();
    await sup.tratar(cmd({ tipo: "parar" }));
    const r = await sup.tratar(cmd({ tipo: "iniciar", servidorPub: publica, segredoSelado: "AAAA" }));
    expect(r).toMatchObject({ desfecho: "falhou", motivo: "cofre_invalido" });
  });

  it("sob pressão e sem tela ociosa, a tela espera (esperando_tela), nunca erro", async () => {
    const { sup } = await montar(() => ({ memoria: "vermelha", processador: "verde" }));
    await iniciar(sup);
    const r = await sup.tratar(cmd({ tipo: "acao", agenteId: "bot1", acao: { tipo: "observar" } }));
    expect(r).toMatchObject({ desfecho: "esperando_tela", quem: [] });
    expect(sup.estados()[0]?.telas).toEqual([expect.objectContaining({ agenteId: "bot1", estado: "esperando" })]);
  });

  it("sair de todos zera a loja; redefinir troca a chave do supervisor e mantém logins/", async () => {
    const { sup, dir } = await montar();
    await iniciar(sup);
    const arquivo = join(dir, "raiz", ID, "logins", "principal", "cookies.enc");
    const chave = chaveDaLoja(chaveDaMaquina(CRED, ID));
    await gravarLoja(arquivo, chave, fundir(lojaVazia(), { postos: [{ name: "s", value: "1", domain: ".a.com", path: "/" }], removidos: [] }, Date.now()).loja);
    // NOD-97 PR 6: o storage em comum também sai no Sair de todos.
    const storage = pastaDoStorage(join(dir, "raiz", ID, "logins"));
    const chaveSt = chaveDoStorage(chaveDaMaquina(CRED, ID));
    const dados = { localStorage: [["k", "v"]], indexedDB: [], pulados: [] };
    await gravarOrigem(storage, chaveSt, { origem: "https://a.com", em: Date.now(), hash: hashDosDados(dados), dados });
    expect((await lerTudo(storage, chaveSt)).itens).toHaveLength(1);
    expect((await sup.tratar(cmd({ tipo: "sair_de_todos" }))).desfecho).toBe("ok");
    expect(cookiesVivos(await lerLoja(arquivo, chave))).toHaveLength(0);
    expect((await lerTudo(storage, chaveSt)).itens).toHaveLength(0);
    const antes = sup.estados()[0]?.supervisorPub;
    await mkdir(join(dir, "raiz", ID, "perfis", "bot1"), { recursive: true });
    const r = await sup.tratar(cmd({ tipo: "redefinir" }));
    expect(r).toMatchObject({ desfecho: "ok", progresso: { pct: 100 } });
    expect(sup.estados()[0]).toMatchObject({ ligado: false, operacao: null });
    expect(sup.estados()[0]?.supervisorPub).not.toBe(antes);
    // A chave nova volta na resposta do comando assinado (o servidor troca a fixada por ela).
    expect(r.supervisorPub).toBe(sup.estados()[0]?.supervisorPub);
    await expect(lerLoja(arquivo, chave)).resolves.toBeTruthy();
    await expect(stat(join(dir, "raiz", ID, "perfis", "bot1"))).rejects.toThrow();
    await expect(stat(join(dir, "raiz", ID, "perfil-base"))).resolves.toBeTruthy();
    // A chave do servidor fixada continua: o próximo comando assinado entra.
    expect((await sup.tratar(cmd({ tipo: "fechar_tela", agenteId: "bot1" }))).desfecho).toBe("ok");
  });

  it("esquecer senhas apaga a loja de senhas e o Login Data de cada perfil, e o computador segue ligado", async () => {
    const { sup, dir } = await montar();
    await iniciar(sup);
    const raiz = join(dir, "raiz", ID);
    const senhas = join(raiz, "logins", "principal", "senhas.enc");
    const loginData = (p: string) => join(raiz, p, "Default", "Login Data");
    await mkdir(join(raiz, "logins", "principal"), { recursive: true });
    await writeFile(senhas, "cifrado");
    for (const p of ["perfil-base", "perfis/bot1"]) {
      await mkdir(join(raiz, p, "Default"), { recursive: true });
      await writeFile(loginData(p), "sqlite");
      await writeFile(`${loginData(p)}-journal`, "j");
    }
    const r = await sup.tratar(cmd({ tipo: "esquecer_senhas" }));
    expect(r).toMatchObject({ desfecho: "ok", progresso: { pct: 100, etapa: "pronto" }, relancados: 0 });
    await expect(stat(senhas)).rejects.toThrow();
    await expect(stat(loginData("perfil-base"))).rejects.toThrow();
    await expect(stat(loginData("perfis/bot1"))).rejects.toThrow();
    await expect(stat(`${loginData("perfis/bot1")}-journal`)).rejects.toThrow();
    // Os perfis e os logins (cookies) ficam; só as senhas saem.
    await expect(stat(join(raiz, "perfis", "bot1"))).resolves.toBeTruthy();
    expect(sup.estados()[0]?.ligado).toBe(true);
    // A chave do servidor segue fixada: o próximo comando entra.
    expect((await sup.tratar(cmd({ tipo: "fechar_tela", agenteId: "bot1" }))).desfecho).toBe("ok");
  });

  it("esquecer senhas que não consegue apagar um Login Data falha (não diz que esqueceu) e o computador segue de pé", async () => {
    const { sup, dir, logs } = await montar();
    await iniciar(sup);
    const pasta = join(dir, "raiz", ID, "perfis", "bot1", "Default");
    await mkdir(pasta, { recursive: true });
    await writeFile(join(pasta, "Login Data"), "sqlite");
    await chmod(pasta, 0o500); // o rm do Login Data falha (EACCES)
    limpar.push(() => chmod(pasta, 0o700));
    const r = await sup.tratar(cmd({ tipo: "esquecer_senhas" }));
    expect(r).toMatchObject({ desfecho: "falhou", motivo: "acao_falhou" });
    expect(logs.some((l) => l.startsWith("esquecer_senhas:"))).toBe(true);
    await chmod(pasta, 0o700);
    // A fila da máquina não ficou presa na falha: a próxima operação roda e apaga.
    expect((await sup.tratar(cmd({ tipo: "esquecer_senhas" }))).desfecho).toBe("ok");
    await expect(stat(join(pasta, "Login Data"))).rejects.toThrow();
    expect(sup.estados()[0]).toMatchObject({ ligado: true, operacao: null });
  });

  it("sair de todos que não consegue apagar o storage guardado falha (não diz que saiu) e a fila segue viva", async () => {
    const { sup, dir } = await montar();
    await iniciar(sup);
    const storage = pastaDoStorage(join(dir, "raiz", ID, "logins"));
    const chaveSt = chaveDoStorage(chaveDaMaquina(CRED, ID));
    const dados = { localStorage: [["k", "v"]], indexedDB: [], pulados: [] };
    await gravarOrigem(storage, chaveSt, { origem: "https://a.com", em: Date.now(), hash: hashDosDados(dados), dados });
    await chmod(storage, 0o500);
    limpar.push(() => chmod(storage, 0o700));
    expect(await sup.tratar(cmd({ tipo: "sair_de_todos" }))).toMatchObject({ desfecho: "falhou", motivo: "acao_falhou" });
    await chmod(storage, 0o700);
    expect((await sup.tratar(cmd({ tipo: "sair_de_todos" }))).desfecho).toBe("ok");
    expect((await lerTudo(storage, chaveSt)).itens).toHaveLength(0);
  });

  it("as etapas que o supervisor emite em Sair de todos e Esquecer senhas são as que a web lista (ETAPAS)", async () => {
    const { sup } = await montar();
    await iniciar(sup);
    const vistas: Record<string, string[]> = {};
    sup.ouvir((m) => {
      const f = m as { tipo: string; operacao?: { tipo: string; etapa: string } | null };
      if (f.tipo === "estado" && f.operacao && f.operacao.etapa !== "pronto") (vistas[f.operacao.tipo] ??= []).push(f.operacao.etapa);
    });
    for (const tipo of ["sair_de_todos", "esquecer_senhas"] as const) {
      expect((await sup.tratar(cmd({ tipo }))).desfecho).toBe("ok");
      expect(vistas[tipo]?.length, tipo).toBeGreaterThan(0);
      for (const e of vistas[tipo]!) expect(ETAPAS[tipo], `${tipo}: ${e}`).toContain(e);
    }
  });

  it("as operações relatam o progresso em etapas e, durante elas, os outros comandos esperam (atualizando)", async () => {
    let reiniciou = 0;
    const { sup } = await montar(undefined, () => { reiniciou++; });
    await iniciar(sup);
    const fotos: Array<{ tipo: string; operacao?: { tipo: string; pct: number; etapa: string } | null }> = [];
    let durante: Promise<{ motivo?: string }> | null = null;
    sup.ouvir((m) => {
      const f = m as (typeof fotos)[number];
      if (f.tipo !== "estado") return;
      fotos.push(f);
      if (f.operacao && !durante) durante = sup.tratar(cmd({ tipo: "acao", agenteId: "bot1", acao: { tipo: "observar" } }));
    });
    const r = await sup.tratar(cmd({ tipo: "atualizar" }));
    expect(r).toMatchObject({ desfecho: "ok", progresso: { pct: 100, etapa: "pronto" } });
    const pcts = fotos.flatMap((f) => (f.operacao ? [f.operacao.pct] : []));
    expect(pcts.length).toBeGreaterThanOrEqual(3);
    expect(pcts).toEqual([...pcts].sort((a, b) => a - b));
    expect(fotos.at(-1)?.operacao).toBeNull();
    expect(await durante).toMatchObject({ desfecho: "falhou", motivo: "atualizando" });
    expect(sup.estados()[0]).toMatchObject({ ligado: false });
    // As etapas têm os nomes que a web mostra (ETAPAS.atualizar do #494).
    const etapas = new Set(fotos.flatMap((f) => (f.operacao ? [f.operacao.etapa] : [])));
    expect([...etapas].every((e) => ["Preparando", "Baixando a versão nova", "Reiniciando", "Reconectando"].includes(e))).toBe(true);
    await new Promise((r) => setTimeout(r, 300));
    expect(reiniciou).toBe(1);
  });

  it("apagar_perfil apaga o perfil do bot e deixa os outros e os logins", async () => {
    const { sup, dir } = await montar();
    await iniciar(sup);
    const raiz = join(dir, "raiz", ID);
    await mkdir(join(raiz, "perfis", "bot1"), { recursive: true });
    await mkdir(join(raiz, "perfis", "bot2"), { recursive: true });
    expect((await sup.tratar(cmd({ tipo: "apagar_perfil" }))).desfecho).toBe("falhou");
    expect((await sup.tratar(cmd({ tipo: "apagar_perfil", agenteId: "../x" }))).desfecho).toBe("falhou");
    expect((await sup.tratar(cmd({ tipo: "apagar_perfil", agenteId: "bot1" }))).desfecho).toBe("ok");
    await expect(stat(join(raiz, "perfis", "bot1"))).rejects.toThrow();
    await expect(stat(join(raiz, "perfis", "bot2"))).resolves.toBeTruthy();
    await expect(stat(join(raiz, "logins"))).resolves.toBeTruthy();
  });

  it("o socket de controle fala NDJSON: estado ao conectar e resultado por comando", async () => {
    const { sup, dir } = await montar();
    await iniciar(sup);
    const caminho = join(dir, "ctl.sock");
    const srv = servirControle(sup);
    await escutarControle(srv, caminho);
    limpar.push(() => new Promise((r) => srv.close(r)));
    const linhas: Array<Record<string, unknown>> = [];
    const s = connect(caminho);
    limpar.push(() => s.destroy());
    let buf = "";
    const chegou = (cond: (m: Record<string, unknown>) => boolean) => new Promise<Record<string, unknown>>((resolve) => {
      const ver = () => { const m = linhas.find(cond); if (m) resolve(m); else setTimeout(ver, 10); };
      ver();
    });
    s.on("data", (b) => { buf += b; let i; while ((i = buf.indexOf("\n")) >= 0) { linhas.push(JSON.parse(buf.slice(0, i))); buf = buf.slice(i + 1); } });
    expect(await chegou((m) => m.tipo === "estado")).toMatchObject({ computadorId: ID, ligado: true });
    const c = cmd({ tipo: "fechar_tela", agenteId: "bot9" });
    s.write(`${JSON.stringify(c)}\nlixo\n`);
    expect(await chegou((m) => m.tipo === "resultado" && m.id === c.id)).toMatchObject({ desfecho: "ok" });
    expect(await chegou((m) => m.tipo === "resultado" && m.id === "")).toMatchObject({ desfecho: "falhou" });
    // O envelope do motor (MensagemAoSupervisor): comando embrulhado e pedido da foto.
    const e = cmd({ tipo: "fechar_tela", agenteId: "bot8" });
    s.write(`${JSON.stringify({ tipo: "comando", comando: e })}\n`);
    expect(await chegou((m) => m.tipo === "resultado" && m.id === e.id)).toMatchObject({ desfecho: "ok" });
    const fotosAntes = linhas.filter((m) => m.tipo === "estado").length;
    s.write(`${JSON.stringify({ tipo: "pedir_estado" })}\n`);
    await chegou(() => linhas.filter((m) => m.tipo === "estado").length > fotosAntes);
  });
});
