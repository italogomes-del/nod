// NOD-96 PR 2 (ADR-122): as peças puras do supervisor do computador por pessoa.
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  abrirSelo, assinarComando, chaveDaLoja, chaveDaMaquina, chavesDeAssinatura, conferirComando, decifrar, cifrar, FOLGA_RELOGIO_MS,
  novoParX25519, selar, senhaSafeStorage, VALIDADE_COMANDO_MS,
} from "../../../infra/computador/chaves.mjs";
import { argsDoBwrap, RESOLV_DO_STUB, scriptDoBwrap } from "../../../infra/computador/isolamento.mjs";
import { atualizarLoja, cookiesVivos, diffDeCookies, fundir, lerLoja, lojaVazia, zerar, type Cookie } from "../../../infra/computador/loja-cookies.mjs";
import { decidirAbertura, leituraLocal, OCIOSA_APOS_MS } from "../../../infra/computador/regua.mjs";
import { caminhoNoWorkspace, urlPermitida } from "../../../infra/computador/tela.mjs";
import { rodarComando } from "../../../infra/computador/terminal.mjs";
import { destinoDoResolv } from "../../../infra/computador/supervisor.mjs";

const pastas: string[] = [];
afterEach(async () => { for (const p of pastas.splice(0)) await rm(p, { recursive: true, force: true }); });
async function pasta() {
  const p = await mkdtemp(join(tmpdir(), "nod-computador-test-"));
  pastas.push(p);
  return p;
}

/** O bwrap desta máquina cria namespaces (na CI pode faltar o binário ou o userns). */
const bwrapIsola = spawnSync("bwrap", ["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc", "--unshare-pid", "true"], { timeout: 5000, stdio: "ignore" }).status === 0;

const CRED = "a".repeat(64);
const ck = (name: string, value: string, extra: Partial<Cookie> = {}): Cookie => ({ name, value, domain: ".exemplo.com", path: "/", expires: -1, ...extra });

describe("chaves", () => {
  it("a chave da máquina, o Safe Storage e a chave da loja são determinísticos e separados por computador", () => {
    const m1 = chaveDaMaquina(CRED, "pc1");
    expect(m1).toMatch(/^[a-f0-9]{64}$/);
    expect(chaveDaMaquina(CRED, "pc1")).toBe(m1);
    expect(chaveDaMaquina(CRED, "pc2")).not.toBe(m1);
    expect(senhaSafeStorage(m1)).toBe(senhaSafeStorage(m1));
    expect(senhaSafeStorage(m1)).not.toBe(senhaSafeStorage(chaveDaMaquina(CRED, "pc2")));
    expect(chaveDaLoja(m1)).toHaveLength(32);
  });

  it("comando assinado vale uma vez, dentro de 2 min; adulterado, vencido ou longo é recusado", () => {
    const { privada, publica } = chavesDeAssinatura(CRED, "pc1");
    const agora = 1_000_000;
    const cmd = assinarComando({ id: "c1", computadorId: "pc1", tipo: "parar", uso: "livre", prazoMs: agora + 60_000 }, privada);
    const vistos = new Map<string, number>();
    expect(conferirComando(cmd, publica, vistos, agora)).toBeNull();
    expect(conferirComando(cmd, publica, vistos, agora)).toBe("repetido");
    expect(conferirComando({ ...cmd, id: "c2" }, publica, new Map(), agora)).toBe("assinatura_invalida");
    expect(conferirComando({ ...cmd, assinatura: undefined }, publica, new Map(), agora)).toBe("sem_assinatura");
    expect(conferirComando(cmd, publica, new Map(), agora + 61_000)).toBe("vencido");
    const longo = assinarComando({ id: "c3", computadorId: "pc1", tipo: "parar", uso: "livre", prazoMs: agora + VALIDADE_COMANDO_MS + FOLGA_RELOGIO_MS + 1 }, privada);
    expect(conferirComando(longo, publica, new Map(), agora)).toBe("prazo_longo");
    const outro = chavesDeAssinatura(CRED, "pc2");
    expect(conferirComando(cmd, outro.publica, new Map(), agora)).toBe("assinatura_invalida");
  });

  it("o selo só abre com a privada do destino; adulterado lança", () => {
    const par = novoParX25519();
    const selado = selar(par.publica, "segredo da máquina");
    expect(abrirSelo(par.privadaPem, selado)).toBe("segredo da máquina");
    expect(() => abrirSelo(novoParX25519().privadaPem, selado)).toThrow();
    const b = Buffer.from(selado, "base64");
    b[b.length - 1] = (b[b.length - 1] ?? 0) ^ 1;
    expect(() => abrirSelo(par.privadaPem, b.toString("base64"))).toThrow();
  });

  it("cifrar e decifrar com AES-GCM", () => {
    const chave = chaveDaLoja(chaveDaMaquina(CRED, "pc1"));
    expect(decifrar(chave, cifrar(chave, "olá"))).toBe("olá");
    expect(() => decifrar(chaveDaLoja(chaveDaMaquina(CRED, "pc2")), cifrar(chave, "olá"))).toThrow();
  });
});

describe("loja de cookies", () => {
  it("diff de duas fotos", () => {
    const d = diffDeCookies([ck("a", "1"), ck("b", "1")], [ck("a", "2"), ck("c", "1")]);
    expect(d.postos.map((c) => c.name).sort()).toEqual(["a", "c"]);
    expect(d.removidos.map((c) => c.name)).toEqual(["b"]);
  });

  it("LWW por (lastAccess, seq): o mais recente ganha e só o que ganhou é repassado", () => {
    const t = Date.now();
    let { loja, efetivo } = fundir(lojaVazia(), { postos: [ck("s", "novo")], removidos: [] }, t + 200);
    expect(efetivo.postos).toHaveLength(1);
    ({ loja, efetivo } = fundir(loja, { postos: [ck("s", "velho")], removidos: [] }, t + 100));
    expect(efetivo.postos).toHaveLength(0);
    expect(cookiesVivos(loja)[0]?.value).toBe("novo");
    ({ loja, efetivo } = fundir(loja, { postos: [ck("s", "empate")], removidos: [] }, t + 200));
    expect(cookiesVivos(loja)[0]?.value).toBe("empate");
    ({ loja, efetivo } = fundir(loja, { postos: [], removidos: [{ name: "s", domain: ".exemplo.com", path: "/" }] }, t + 300));
    expect(efetivo.removidos).toHaveLength(1);
    expect(cookiesVivos(loja)).toHaveLength(0);
    ({ loja } = fundir(loja, { postos: [ck("s", "ressuscitado")], removidos: [] }, t + 250));
    expect(cookiesVivos(loja)).toHaveLength(0);
  });

  it("cookie vencido vira lápide e não volta", () => {
    const agora = 10_000_000;
    const { loja } = fundir(lojaVazia(), { postos: [ck("v", "1", { expires: agora / 1000 - 1 })], removidos: [] }, agora, agora);
    expect(cookiesVivos(loja, agora)).toHaveLength(0);
  });

  it("zerar apaga tudo o que estava vivo", () => {
    const { loja } = fundir(lojaVazia(), { postos: [ck("a", "1"), ck("b", "1")], removidos: [] }, 10);
    const z = zerar(loja, 20);
    expect(z.efetivo.removidos).toHaveLength(2);
    expect(cookiesVivos(z.loja)).toHaveLength(0);
  });

  it("gravada cifrada, atômica; escritas concorrentes não se perdem; chave errada é loja_invalida", async () => {
    const dir = await pasta();
    const arquivo = join(dir, "logins", "principal", "cookies.enc");
    const chave = chaveDaLoja(chaveDaMaquina(CRED, "pc1"));
    expect(await lerLoja(arquivo, chave)).toEqual(lojaVazia());
    await Promise.all(Array.from({ length: 20 }, (_, i) => atualizarLoja(arquivo, chave, (l) => fundir(l, { postos: [ck(`cookie-nome-claro-${i}`, `valor-em-claro-${i}`)], removidos: [] }, 100 + i))));
    const loja = await lerLoja(arquivo, chave);
    expect(cookiesVivos(loja)).toHaveLength(20);
    // Cifrada: nem o nome nem o valor aparecem em claro. Marcadores longos (17+ bytes): um curto como "k1" aparece por
    // acaso nos bytes cifrados (~3% das execuções) e deixava o teste intermitente.
    const bruto = await readFile(arquivo);
    expect(bruto.includes(Buffer.from("cookie-nome-claro-"))).toBe(false);
    expect(bruto.includes(Buffer.from("valor-em-claro-"))).toBe(false);
    await expect(lerLoja(arquivo, chaveDaLoja(chaveDaMaquina(CRED, "pc2")))).rejects.toThrow("loja_invalida");
  });
});

describe("régua", () => {
  const telas = (agora: number) => [
    { agenteId: "a", estado: "aberta", ocupada: false, ultimaAcaoEm: agora - OCIOSA_APOS_MS - 10 },
    { agenteId: "b", estado: "aberta", ocupada: false, ultimaAcaoEm: agora - OCIOSA_APOS_MS - 99 },
    { agenteId: "c", estado: "aberta", ocupada: true, ultimaAcaoEm: 0 },
  ];
  it("sem pressão abre; com pressão fecha a ociosa mais antiga; sem ociosa espera com quem ocupa", () => {
    const agora = 10_000_000;
    expect(decidirAbertura({ uso: "equilibrado", memoria: "verde", processador: "verde", telas: telas(agora), agenteId: "x", agora })).toEqual({ acao: "abrir" });
    expect(decidirAbertura({ uso: "equilibrado", memoria: "vermelha", processador: "verde", telas: telas(agora), agenteId: "x", agora })).toEqual({ acao: "fechar", agenteId: "b" });
    const ocupadas = telas(agora).map((t) => ({ ...t, ultimaAcaoEm: agora }));
    expect(decidirAbertura({ uso: "equilibrado", memoria: "vermelha", processador: "verde", telas: ocupadas, agenteId: "x", agora })).toEqual({ acao: "esperar", quem: ["a", "b", "c"] });
    expect(decidirAbertura({ uso: "livre", memoria: "vermelha", processador: "vermelha", telas: ocupadas, agenteId: "x", agora })).toEqual({ acao: "abrir" });
  });
  it("leitura do /proc e a pressão simulada", () => {
    const meminfo = "MemTotal: 1000 kB\nMemAvailable: 50 kB\n";
    expect(leituraLocal({ meminfo, loadavg: "0.1 0 0", nucleos: 4 }).memoria).toBe("vermelha");
    expect(leituraLocal({ meminfo: "MemTotal: 1000 kB\nMemAvailable: 900 kB\n", loadavg: "0.1", nucleos: 4, simular: "4" }).memoria).not.toBe("verde");
  });
});

describe("isolamento e tela", () => {
  it("o bwrap esconde a raiz e devolve só o perfil, o workspace e logins em leitura", () => {
    const a = argsDoBwrap({ raiz: "/var/lib/nod-computador", perfil: "/var/lib/nod-computador/pc/perfis/bot", workspace: "/w", logins: "/l", tmp: "/t", x11: "/x", bus: "/b" });
    const s = a.join(" ");
    expect(s).toContain("--ro-bind / /");
    expect(s).toContain("--tmpfs /var/lib/nod-computador");
    expect(s.indexOf("--tmpfs /var/lib/nod-computador")).toBeLessThan(s.indexOf("--bind /var/lib/nod-computador/pc/perfis/bot"));
    expect(s).toContain("--ro-bind /l /l");
    expect(s).toContain("--bind /x /tmp/.X11-unix");
    expect(scriptDoBwrap({ args: ["--x", "it's"], binario: "/c" })).toBe(`#!/bin/sh\nexec 'bwrap' '--x' 'it'\\''s' -- '/c' "$@"\n`);
  });

  it("o bwrap esconde a raiz do run (as outras telas e os sockets) e só devolve o tmp e o bus desta tela", () => {
    const run = "/run/nod-computador-pc";
    const a = argsDoBwrap({ raiz: "/var/lib/nod-computador", run, ocultar: ["/run/nod-computador"], tmp: `${run}/pc/telas/bot`, bus: `${run}/pc/bus`, x11: "/x" });
    const s = a.join(" ");
    expect(s).toContain(`--tmpfs ${run} `);
    expect(s).toContain("--tmpfs /run/nod-computador ");
    expect(s.indexOf(`--tmpfs ${run} `)).toBeLessThan(s.indexOf(`--bind ${run}/pc/telas/bot ${run}/pc/telas/bot`));
    expect(s.indexOf(`--tmpfs ${run} `)).toBeLessThan(s.indexOf(`--bind ${run}/pc/bus ${run}/pc/bus`));
    expect(s.indexOf("--tmpfs /run/nod-computador ")).toBeLessThan(s.indexOf(`--bind ${run}/pc/bus`));
    // Sem run, nada muda (compatível com o computador-local).
    expect(argsDoBwrap({ tmp: "/t" }).join(" ")).not.toContain("--tmpfs /run");
  });

  it("o bwrap monta o resolv.conf do stub em /etc/resolv.conf, antes dos tmpfs", () => {
    expect(RESOLV_DO_STUB).toBe("/run/systemd/resolve/stub-resolv.conf");
    const s = argsDoBwrap({ resolv: RESOLV_DO_STUB, raiz: "/r", run: "/run/x" }).join(" ");
    expect(s).toContain(`--ro-bind ${RESOLV_DO_STUB} /etc/resolv.conf`);
    expect(s.indexOf("--ro-bind / /")).toBeLessThan(s.indexOf(`--ro-bind ${RESOLV_DO_STUB}`));
    expect(argsDoBwrap({}).join(" ")).not.toContain("/etc/resolv.conf");
    expect(argsDoBwrap({ resolv: RESOLV_DO_STUB, resolvEm: "/run/systemd/resolve/resolv.conf" }).join(" ")).toContain(`--ro-bind ${RESOLV_DO_STUB} /run/systemd/resolve/resolv.conf`);
  });

  it("o destino do resolv.conf segue o symlink (o bwrap não monta sobre symlink)", async () => {
    const dir = await pasta();
    await writeFile(join(dir, "real.conf"), "nameserver 169.254.169.254\n");
    await symlink(join(dir, "real.conf"), join(dir, "resolv.conf"));
    expect(destinoDoResolv(join(dir, "resolv.conf"))).toBe(join(dir, "real.conf"));
    expect(destinoDoResolv(join(dir, "nao-existe"))).toBe(join(dir, "nao-existe"));
  });

  it.skipIf(!bwrapIsola)("no bwrap de verdade, a tela não vê o tmp das outras e lê o resolv.conf do stub", async () => {
    // Fora do /tmp: o bwrap já esconde o /tmp, e o teste precisa provar o tmpfs do run.
    const base = await mkdtemp(path.join("/var/tmp", "nod-bwrap-"));
    const run = path.join(base, "run");
    const minha = path.join(run, "pc", "telas", "a");
    const outra = path.join(run, "pc", "telas", "b");
    await mkdir(minha, { recursive: true });
    await mkdir(outra, { recursive: true });
    await writeFile(path.join(outra, "entrada"), "senha");
    await writeFile(path.join(minha, "tela.png"), "png");
    const resolv = path.join(base, "stub-resolv.conf");
    await writeFile(resolv, "nameserver 127.0.0.53\n");
    try {
      // Na VM-alvo o /etc/resolv.conf é symlink: o bwrap monta no destino real (destinoDoResolv).
      const args = argsDoBwrap({ run, tmp: minha, resolv, resolvEm: destinoDoResolv() });
      const r = spawnSync("bwrap", [...args, "--", "sh", "-c", `cat /etc/resolv.conf; ls ${minha}; ls ${outra} 2>&1 || echo sem-outra`], { encoding: "utf8", timeout: 10_000 });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("nameserver 127.0.0.53");
      expect(r.stdout).toContain("tela.png");
      expect(r.stdout).toContain("sem-outra");
      expect(r.stdout).not.toContain("entrada");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  it("a tela só navega em http(s) e about:blank", () => {
    expect(urlPermitida("https://a.com")).toBe(true);
    expect(urlPermitida("about:blank")).toBe(true);
    for (const u of ["file:///etc/passwd", "chrome://settings", "javascript:alert(1)", "lixo"]) expect(urlPermitida(u)).toBe(false);
  });

  it("caminho fora do workspace (.. ou symlink) é recusado", async () => {
    const dir = await pasta();
    const ws = join(dir, "ws");
    await mkdir(ws);
    await writeFile(join(dir, "fora.txt"), "x");
    await symlink(join(dir, "fora.txt"), join(ws, "link"));
    expect(await caminhoNoWorkspace(ws, "a/b.txt", true)).toBe(join(ws, "a", "b.txt"));
    await expect(caminhoNoWorkspace(ws, "../fora.txt")).rejects.toThrow("caminho");
    await expect(caminhoNoWorkspace(ws, "link")).rejects.toThrow("caminho");
  });

  it("o terminal roda no workspace, sem DISPLAY, e corta no prazo", async () => {
    const ws = await pasta();
    const r = await rodarComando({ workspace: ws, comando: 'pwd; echo "d=${DISPLAY:-nada}"' });
    expect(r.codigoSaida).toBe(0);
    expect(r.saida).toContain(ws);
    expect(r.saida).toContain("d=nada");
    const lento = await rodarComando({ workspace: ws, comando: "sleep 5", prazoMs: 200 });
    expect(lento.saida).toContain("Limite");
  });
});
