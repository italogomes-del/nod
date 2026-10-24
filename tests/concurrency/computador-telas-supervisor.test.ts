// NOD-96 PR 7 (definido em 2026-10-22, ADR-122): o supervisor REAL com várias telas ao mesmo tempo. A tela é a falsa
// (tests/helpers/tela-falsa.mjs: o mesmo protocolo IPC da tela.mjs, sem Xvfb nem Chromium), o terminal é o real e a
// loja de cookies é a real (cifrada no disco). O que precisa de Xvfb/Chromium/systemd de verdade é o smoke na VM
// (scripts/e2e-computador-vm.sh); aqui fica o que é do supervisor: login em comum, telas sem vazar, cookies ao mesmo
// tempo, a régua (fila e ociosa) e Atualizar/Redefinir sem perder os logins.
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { assinarComando, chaveDaLoja, chaveDaMaquina, chavesDeAssinatura, selar } from "../../infra/computador/chaves.mjs";
import { cookiesVivos, lerLoja } from "../../infra/computador/loja-cookies.mjs";
import { OCIOSA_APOS_MS } from "../../infra/computador/regua.mjs";
import { criarSupervisor, type Supervisor } from "../../infra/computador/supervisor.mjs";
import { criarServidorTerminal, escutar } from "../../infra/computador/terminal.mjs";

const CRED = "d".repeat(64);
const ID = "pc-e2e";
const TELA_FALSA = fileURLToPath(new URL("../helpers/tela-falsa.mjs", import.meta.url));
const limpar: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => { for (const f of limpar.splice(0).reverse()) await f(); });

type Nivel = "verde" | "amarela" | "vermelha";
type Tela = { url: string; titulo: string; texto: string };
type Resultado = { desfecho: string; motivo?: string; quem?: string[]; supervisorPub?: string; resultado?: { tela?: Tela } };

async function montar(o: { ambienteTela?: Record<string, string> } = {}) {
  const dir = await mkdtemp(join(tmpdir(), "nod-telas-e2e-"));
  limpar.push(() => rm(dir, { recursive: true, force: true }));
  const bin = async (nome: string, corpo: string) => {
    const f = join(dir, nome);
    await writeFile(f, `#!/bin/sh\n${corpo}\n`);
    await chmod(f, 0o755);
    return f;
  };
  const binarios = {
    dbus: await bin("dbus", 'for a in "$@"; do case "$a" in --address=*) echo "${a#--address=}";; esac; done; exec sleep 60'),
    keyring: await bin("keyring", "cat >/dev/null; exec sleep 60"),
    secretTool: await bin("secret-tool", "cat >/dev/null"),
    xvfb: "Xvfb", openbox: "openbox", chromium: "chromium", bwrap: null, xdotool: "xdotool", xclip: "xclip", scrot: "scrot",
  };
  const terminal = join(dir, "term.sock");
  const st = criarServidorTerminal({ raiz: join(dir, "raiz") });
  await escutar(st, terminal);
  limpar.push(() => new Promise((r) => st.close(r)));
  // A régua lê a memória daqui: vermelha com `limite` telas de pé (fechar uma devolve a memória, como na máquina de
  // verdade); o relógio anda para a tela ficar ociosa.
  const maquina = { limite: Infinity, desvio: 0 };
  const dePe = () => (sup.estados()[0]?.telas ?? []).filter((t) => t.estado === "aberta" || t.estado === "abrindo").length;
  const agora = () => Date.now() + maquina.desvio;
  const logs: string[] = [];
  const sup = criarSupervisor({
    raiz: join(dir, "raiz"), run: join(dir, "run"), terminal, bin: binarios, tela: TELA_FALSA, ambienteTela: o.ambienteTela,
    leitura: () => ({ memoria: (dePe() >= maquina.limite ? "vermelha" : "verde") as Nivel, processador: "verde" }), agora, log: (m) => logs.push(m),
  });
  limpar.push(() => sup.encerrar());
  const { privada, publica } = chavesDeAssinatura(CRED, ID);
  let n = 0;
  const cmd = (c: Record<string, unknown>) =>
    assinarComando({ id: `c${++n}`, computadorId: ID, uso: "equilibrado", prazoMs: agora() + 60_000, ...c }, privada);
  const tratar = (c: Record<string, unknown>) => sup.tratar(cmd(c)) as Promise<Resultado>;
  const iniciar = async () => {
    if (!sup.estados().some((e) => e.computadorId === ID)) await tratar({ tipo: "parar" });
    const supervisorPub = sup.estados().find((e) => e.computadorId === ID)!.supervisorPub;
    const r = await tratar({ tipo: "iniciar", servidorPub: publica, segredoSelado: selar(supervisorPub, chaveDaMaquina(CRED, ID)) });
    expect(r.desfecho).toBe("ok");
  };
  const navegar = (agenteId: string, url: string) => tratar({ tipo: "acao", agenteId, acao: { tipo: "navegar", url } });
  /** Os cookies que a tela do bot vê no host da URL (navega até ela, sem login). */
  const cookiesEm = async (agenteId: string, url: string) => {
    const r = await navegar(agenteId, url);
    expect(r.desfecho, JSON.stringify(r)).toBe("ok");
    return Object.fromEntries((JSON.parse(r.resultado!.tela!.texto) as { name: string; value: string }[]).map((c) => [c.name, c.value]));
  };
  const telas = () => Object.fromEntries((sup.estados()[0]?.telas ?? []).map((t) => [t.agenteId, t.estado]));
  const loja = async () => cookiesVivos(await lerLoja(join(dir, "raiz", ID, "logins", "principal", "cookies.enc"), chaveDaLoja(chaveDaMaquina(CRED, ID))));
  return { sup, maquina, tratar, iniciar, navegar, cookiesEm, telas, loja, logs, assentar: () => (sup as Supervisor).assentar() };
}

const MAIL = "https://mail.exemplo.com/";

describe("computador da pessoa: várias telas no supervisor real (NOD-96 PR 7)", () => {
  it("login em comum: o que um bot entra vale nas telas abertas e no bot criado depois; sair também", async () => {
    const m = await montar();
    await m.iniciar();
    expect(await m.cookiesEm("ana", MAIL)).toEqual({});
    expect((await m.navegar("beto", `${MAIL}?entrar=sid:abc`)).desfecho).toBe("ok");
    await m.assentar();
    // A tela da Ana já estava aberta: recebeu o repasse.
    expect(await m.cookiesEm("ana", MAIL)).toEqual({ sid: "abc" });
    // O Caio nunca teve tela: nasce com a loja.
    expect(await m.cookiesEm("caio", MAIL)).toEqual({ sid: "abc" });
    expect(m.telas()).toEqual({ ana: "aberta", beto: "aberta", caio: "aberta" });
    // Sair num bot sai em todos.
    await m.navegar("caio", `${MAIL}?sair=sid`);
    await m.assentar();
    expect(await m.cookiesEm("ana", MAIL)).toEqual({});
    expect(await m.cookiesEm("beto", MAIL)).toEqual({});
    expect(await m.loja()).toEqual([]);
  });

  it("bots em paralelo: cada ação volta com a tela do próprio bot, nunca a de outro", async () => {
    const m = await montar({ ambienteTela: { NOD_TELA_FALSA_ACAO_MS: "7" } });
    await m.iniciar();
    const bots = ["ana", "beto", "caio", "duda"];
    for (let volta = 0; volta < 15; volta++) {
      const rs = await Promise.all(bots.map((b) => m.navegar(b, `https://${b}.exemplo.com/pagina-${volta}`)));
      rs.forEach((r, i) => {
        expect(r.desfecho).toBe("ok");
        expect(r.resultado?.tela?.url).toBe(`https://${bots[i]}.exemplo.com/pagina-${volta}`);
        expect(r.resultado?.tela?.titulo).toContain(`(${bots[i]})`);
      });
    }
    // Duas ações ao mesmo tempo no MESMO bot: uma passa, a outra é `ocupado` (a reserva é por tela).
    const [x, y] = await Promise.all([m.navegar("ana", "https://a.exemplo.com/1"), m.navegar("ana", "https://a.exemplo.com/2")]);
    expect([x.desfecho, y.desfecho].sort()).toEqual(["falhou", "ok"]);
    expect([x.motivo, y.motivo]).toContain("ocupado");
  });

  it("cookies ao mesmo tempo em 6 telas: a loja não corrompe, ninguém perde o seu e o comum fica com o último", async () => {
    const m = await montar();
    await m.iniciar();
    const bots = ["b1", "b2", "b3", "b4", "b5", "b6"];
    // 6 telas abertas de uma vez, com memória sobrando (a régua não segura nenhuma).
    const abertas = await Promise.all(bots.map((agenteId) => m.tratar({ tipo: "abrir_tela", agenteId })));
    expect(abertas.map((r) => r.desfecho)).toEqual(bots.map(() => "ok"));
    expect(Object.values(m.telas()).filter((e) => e === "aberta")).toHaveLength(6);
    const VOLTAS = 30;
    await Promise.all(bots.map(async (b) => {
      for (let v = 0; v < VOLTAS; v++) {
        const r = await m.navegar(b, `${MAIL}?entrar=${b}:${v}`);
        expect(r.desfecho).toBe("ok");
        await m.navegar(b, `${MAIL}?entrar=comum:${b}-${v}`);
      }
    }));
    await m.assentar();
    const loja = Object.fromEntries((await m.loja()).map((c) => [c.name, String(c.value)]));
    for (const b of bots) expect(loja[b]).toBe(String(VOLTAS - 1));
    // O comum: o último escrito ganha (LWW), que é a última volta de algum bot.
    expect(loja.comum).toMatch(new RegExp(`^b[1-6]-${VOLTAS - 1}$`));
    // Cada tela vê o cookie próprio de todas as outras (o repasse chegou a todas).
    for (const b of bots) {
      const vistos = await m.cookiesEm(b, MAIL);
      for (const outro of bots) expect(vistos[outro]).toBe(String(VOLTAS - 1));
    }
    // Uma tela nova nasce com a loja inteira, inclusive o comum que ganhou.
    expect(await m.cookiesEm("b7", MAIL)).toEqual(loja);
    expect(m.logs.filter((l) => l.startsWith("loja de cookies"))).toEqual([]);
  });

  it("fila por memória: sem memória e sem ociosa espera com quem ocupa; ociosa fecha a mais antiga e reabre logada", async () => {
    const m = await montar();
    await m.iniciar();
    await m.navegar("ana", `${MAIL}?entrar=sid:xyz`);
    await m.navegar("beto", MAIL);
    await m.assentar();
    m.maquina.limite = 2;
    // Sem tela ociosa: o Caio espera (não é erro) e sabe quem ocupa.
    const espera = await m.navegar("caio", MAIL);
    expect(espera).toMatchObject({ desfecho: "esperando_tela" });
    expect(espera.quem?.sort()).toEqual(["ana", "beto"]);
    expect(m.telas().caio).toBe("esperando");
    // Passou o tempo de ociosa e o Beto seguiu usando: fecha a da Ana e abre a do Caio, já logada.
    m.maquina.desvio += OCIOSA_APOS_MS + 1000;
    await m.navegar("beto", MAIL);
    expect(await m.cookiesEm("caio", MAIL)).toEqual({ sid: "xyz" });
    expect(m.telas()).toMatchObject({ ana: "fechada", beto: "aberta", caio: "aberta" });
    // A Ana volta: a ociosa mais antiga agora é a do Beto; a da Ana reabre com o login.
    m.maquina.desvio += OCIOSA_APOS_MS + 1000;
    expect(await m.cookiesEm("ana", MAIL)).toEqual({ sid: "xyz" });
    expect(m.telas()).toMatchObject({ ana: "aberta", beto: "fechada", caio: "aberta" });
    // Com memória de novo, abre sem fechar ninguém.
    m.maquina.limite = Infinity;
    expect(await m.cookiesEm("beto", MAIL)).toEqual({ sid: "xyz" });
    expect(Object.values(m.telas()).filter((e) => e === "aberta")).toHaveLength(3);
  });

  it("a tela que o servidor fechou por ociosidade (fechar_tela, 15 min) reabre na próxima ação, logada", async () => {
    const m = await montar();
    await m.iniciar();
    await m.navegar("ana", `${MAIL}?entrar=sid:15min`);
    expect((await m.tratar({ tipo: "fechar_tela", agenteId: "ana" })).desfecho).toBe("ok");
    expect(m.telas().ana).toBe("fechada");
    expect(await m.cookiesEm("ana", MAIL)).toEqual({ sid: "15min" });
    expect(m.telas().ana).toBe("aberta");
  });

  it("Atualizar e Redefinir fecham as telas e mantêm os logins; Sair de todos não", async () => {
    const m = await montar();
    await m.iniciar();
    await m.navegar("ana", `${MAIL}?entrar=sid:fica`);
    await m.navegar("beto", MAIL);
    await m.assentar();
    expect((await m.tratar({ tipo: "atualizar" })).desfecho).toBe("ok");
    expect(Object.values(m.telas()).filter((e) => e === "aberta")).toEqual([]);
    // Depois do Atualizar o servidor liga de novo no próximo comando.
    expect((await m.navegar("ana", MAIL)).motivo).toBe("nao_iniciou");
    await m.iniciar();
    expect(await m.cookiesEm("beto", MAIL)).toEqual({ sid: "fica" });
    const r = await m.tratar({ tipo: "redefinir" });
    expect(r.desfecho).toBe("ok");
    // A X25519 é nova: o iniciar sela para ela (o servidor a recebeu na resposta do redefinir).
    expect(r.supervisorPub).toBe(m.sup.estados()[0]?.supervisorPub);
    await m.iniciar();
    expect(await m.cookiesEm("ana", MAIL)).toEqual({ sid: "fica" });
    expect(await m.cookiesEm("caio", MAIL)).toEqual({ sid: "fica" });
    expect((await m.tratar({ tipo: "sair_de_todos" })).desfecho).toBe("ok");
    expect(await m.cookiesEm("ana", MAIL)).toEqual({});
    expect(await m.cookiesEm("duda", MAIL)).toEqual({});
  });

  it("instalação limpa: a sonda sem assinatura é recusada, mas o computador novo é relatado na hora com a X25519", async () => {
    const m = await montar();
    const relatos: { tipo: string; computadorId?: string; supervisorPub?: string }[] = [];
    m.sup.ouvir((r) => relatos.push(r as (typeof relatos)[number]));
    expect(m.sup.estados()).toEqual([]);
    const r = await m.sup.tratar({ id: "sonda-1", computadorId: ID, tipo: "parar", uso: "equilibrado", prazoMs: Date.now() + 60_000, assinatura: "" }) as Resultado;
    expect(r.desfecho).toBe("falhou");
    const estado = relatos.find((x) => x.tipo === "estado" && x.computadorId === ID);
    expect(estado?.supervisorPub).toBe(m.sup.estados()[0]?.supervisorPub);
    expect(m.sup.estados()[0]?.ligado).toBe(false);
    // Recusada de verdade: o servidor ainda não está fixado e nada ligou.
    await m.iniciar();
  });
});
