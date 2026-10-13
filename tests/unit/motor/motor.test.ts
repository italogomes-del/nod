import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scriptDeInstalacao, servidorParaScript } from "../../../src/adapters/http/motor-instalacao.ts";
import { arquivoDaConexao, carregarConexao, comandoDeEntrar, guardarConexao, lerComando, lerConexao, pastaDoMotor } from "../../../motor/conexao.ts";

describe("motor sem janela (ADR-090)", () => {
  it("lê os comandos do nod-motor", () => {
    expect(lerComando([])).toEqual({ tipo: "ajuda", erro: null });
    expect(lerComando(["rodar"])).toEqual({ tipo: "rodar" });
    expect(lerComando(["parear", "https://nod.exemplo.com", "--nome", "vm-sp"])).toEqual({ tipo: "parear", servidor: "https://nod.exemplo.com", nome: "vm-sp", convite: null });
    expect(lerComando(["parear", "--nome", "vm-sp", "https://nod.exemplo.com"])).toEqual({ tipo: "parear", servidor: "https://nod.exemplo.com", nome: "vm-sp", convite: null });
    // ADR-102: o convite do comando de instalação; um valor fora do formato é ignorado (vale o código de sempre).
    const convite = "A".repeat(32);
    expect(lerComando(["parear", "https://nod.exemplo.com", "--convite", convite])).toEqual({ tipo: "parear", servidor: "https://nod.exemplo.com", nome: null, convite });
    expect(lerComando(["parear", "--convite", "x; rm -rf /", "https://nod.exemplo.com"])).toMatchObject({ servidor: "https://nod.exemplo.com", convite: null });
    expect(lerComando(["parear"]).tipo).toBe("ajuda");
    expect(lerComando(["entrar", "claude"])).toEqual({ tipo: "entrar", ia: "claude" });
    expect(lerComando(["entrar", "gemini"]).tipo).toBe("ajuda");
    expect(lerComando(["--help"])).toEqual({ tipo: "ajuda", erro: null });
    expect(lerComando(["xyz"])).toMatchObject({ tipo: "ajuda", erro: expect.stringContaining("xyz") });
  });

  it("o login headless de cada IA (o Codex e o gh pelo fluxo de dispositivo)", () => {
    expect(comandoDeEntrar("claude")).toEqual({ nome: "claude", args: ["auth", "login"] });
    expect(comandoDeEntrar("codex").args).toContain("--device-auth");
    expect(comandoDeEntrar("github").nome).toBe("gh");
  });

  it("a conexão fica num arquivo 0600 e volta igual", async () => {
    const pasta = await mkdtemp(join(tmpdir(), "nod-motor-"));
    expect(pastaDoMotor({ NOD_MOTOR_HOME: pasta })).toBe(pasta);
    expect(pastaDoMotor({ HOME: "/home/nod" })).toBe("/home/nod/.config/nod-motor");
    expect(await carregarConexao(pasta)).toBeNull();
    await guardarConexao(pasta, { url: "https://nod.exemplo.com", chave: "abc.def" });
    expect(await carregarConexao(pasta)).toEqual({ url: "https://nod.exemplo.com", chave: "abc.def" });
    expect((await stat(arquivoDaConexao(pasta))).mode & 0o777).toBe(0o600);
    expect(lerConexao(await readFile(arquivoDaConexao(pasta), "utf8"))).not.toBeNull();
    expect(lerConexao("{}")).toBeNull();
    expect(lerConexao("não é json")).toBeNull();
  });

  it("o script de instalação só sai com HTTPS (ou http em loopback) e um host sem nada que o shell interprete", () => {
    expect(servidorParaScript("https", "nod.exemplo.com")).toBe("https://nod.exemplo.com");
    expect(servidorParaScript("https,http", "nod.exemplo.com")).toBe("https://nod.exemplo.com");
    expect(servidorParaScript("http", "127.0.0.1:8888")).toBe("http://127.0.0.1:8888");
    expect(servidorParaScript("http", "nod.exemplo.com")).toBeNull();
    expect(servidorParaScript("https", "nod.exemplo.com;rm -rf /")).toBeNull();
    expect(servidorParaScript("https", "$(whoami).exemplo.com")).toBeNull();
    expect(() => scriptDeInstalacao({ servidor: "https://x\"; rm", versao: "1" })).toThrow();
  });

  it("o script de instalação é shell válido e leva o servidor e a versão", () => {
    const script = scriptDeInstalacao({ servidor: "https://nod.exemplo.com", versao: "0.4.0-rc.6" });
    expect(script).toContain('NOD_SERVIDOR="https://nod.exemplo.com"');
    expect(script).toContain('NOD_VERSAO="0.4.0-rc.6"');
    expect(script).toContain("User=nod");
    expect(script).not.toContain("${o.");
    execFileSync("sh", ["-n"], { input: script });
  });

  it("ADR-102: o convite vai no script e no pareamento; o Codex vem sempre (NOD_SEM_CODEX=1 desliga)", () => {
    const convite = "Ab_-".repeat(8);
    const comConvite = scriptDeInstalacao({ servidor: "https://nod.exemplo.com", versao: "0.4.0", convite });
    expect(comConvite).toContain(`NOD_CONVITE="${convite}"`);
    expect(comConvite).toContain(`parear "$NOD_SERVIDOR" --convite "$NOD_CONVITE"`);
    expect(comConvite).toContain('if [ "${NOD_SEM_CODEX:-0}" != "1" ]; then');
    expect(comConvite).not.toContain("NOD_COM_CODEX:-0");
    // Convite fora do formato nunca entra no shell.
    expect(scriptDeInstalacao({ servidor: "https://nod.exemplo.com", versao: "0.4.0", convite: '"; rm -rf / #' })).toContain('NOD_CONVITE=""');
    expect(execFileSync("sh", ["-n"], { input: comConvite }).toString()).toBe("");
  });

  it("ADR-097 (fase 0b): um OOM mata o processo, não o serviço; e a máquina sem swap ganha zram (ou arquivo de swap)", () => {
    const script = scriptDeInstalacao({ servidor: "https://nod.exemplo.com", versao: "0.4.0-rc.6" });
    expect(script).toContain("OOMPolicy=continue");
    // ADR-097 (fase 2): o motor cria um grupo de controle por turno.
    expect(script).toContain("Delegate=yes");
    // Só liga swap quando não há nenhum, e nunca para a instalação por isso.
    expect(script).toContain('if [ -z "$(swapon --noheadings 2>/dev/null)" ]; then');
    expect(script).toContain("ligar_swap || true");
    expect(script).toContain("zram-tools");
    expect(script).toContain("printf 'ALGO=zstd\\nSIZE=%s\\nPRIORITY=100\\n'");
    expect(script).toContain("/swapfile-nod none swap sw 0 0");
  });

  it("QA NOD-199: o motor reanuncia pela rota só de inventário, como o app do Mac — nunca pelo conectar direto", async () => {
    // O `conectar` com turno rodando volta 409 (o aoFalhar do motor reanuncia de novo) e, depois de 90 s, limpa os planos.
    // Quem decide entre `inventario` e `conectar` é o cliente (`anunciarInventario`, coberto em ponte-http-inventario).
    for (const arquivo of ["motor/main.ts", "desktop/main.ts"]) {
      const fonte = await readFile(join(process.cwd(), arquivo), "utf8");
      expect(fonte, arquivo).toMatch(/anunciar: async[^\n]*\n?[^]*?ponte\.anunciarInventario\(/);
      expect(fonte, arquivo).not.toMatch(/ponteHttp\.ponte\.conectar\(/);
    }
  });
});
