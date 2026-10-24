// NOD-96 PR 2 (ADR-122): o supervisor como processo comum, com dbus/keyring/secret-tool falsos e sem telas reais.
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { assinarComando, chaveDaLoja, chaveDaMaquina, chavesDeAssinatura, selar } from "../../../infra/computador/chaves.mjs";
import { fundir, gravarLoja, lerLoja, lojaVazia, cookiesVivos } from "../../../infra/computador/loja-cookies.mjs";
import { criarSupervisor, escutarControle, servirControle, type Supervisor } from "../../../infra/computador/supervisor.mjs";
import { criarServidorTerminal, escutar } from "../../../infra/computador/terminal.mjs";

const CRED = "b".repeat(64);
const ID = "pc1";
const limpar: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => { for (const f of limpar.splice(0).reverse()) await f(); });

async function montar(leitura = () => ({ memoria: "verde" as unknown, processador: "verde" as unknown })) {
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
  const sup = criarSupervisor({ raiz: join(dir, "raiz"), run: join(dir, "run"), terminal, bin: binarios, leitura, log: (m) => logs.push(m) });
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
    expect((await sup.tratar(cmd({ tipo: "sair_de_todos" }))).desfecho).toBe("ok");
    expect(cookiesVivos(await lerLoja(arquivo, chave))).toHaveLength(0);
    const antes = sup.estados()[0]?.supervisorPub;
    expect((await sup.tratar(cmd({ tipo: "redefinir" }))).desfecho).toBe("ok");
    expect(sup.estados()[0]).toMatchObject({ ligado: false });
    expect(sup.estados()[0]?.supervisorPub).not.toBe(antes);
    await expect(lerLoja(arquivo, chave)).resolves.toBeTruthy();
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
  });
});
