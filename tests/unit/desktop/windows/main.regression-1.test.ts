// Regression: QA-678 — fechar a janela de conexão no meio do pareamento a reabria com "O código venceu";
// e as guardas do main.ts (IPC, cookie, vigia, NSIS) não tinham teste: mutante nelas passava verde.
// Found by /qa on 2026-11-05
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { daTelaDeSetup, telaDaFalhaDePareamento, TEXTOS_WINDOWS } from "../../../../desktop/windows/fluxo.ts";
import { cookieDaJanela, PARTITION_DA_JANELA } from "../../../../desktop/windows/sessao.ts";
import { INTERVALO_DO_VIGIA_MS, vigiar } from "../../../../desktop/windows/motor-status.ts";

const main = readFileSync(new URL("../../../../desktop/windows/main.ts", import.meta.url), "utf8");
const setupUrl = "file:///C:/nod/setup-windows.html";
const wc = { id: 1 };
const setup = { isDestroyed: () => false, webContents: wc };

describe("QA #678: o IPC só atende a tela de conexão", () => {
  it("remetente e frame da tela de conexão: atende", () => {
    expect(daTelaDeSetup({ sender: wc, senderFrame: { url: setupUrl } }, setup, setupUrl)).toBe(true);
  });
  it("outro frame, outro remetente, sem frame, janela fechada ou destruída: recusa", () => {
    expect(daTelaDeSetup({ sender: wc, senderFrame: { url: "https://evil.example/" } }, setup, setupUrl)).toBe(false);
    expect(daTelaDeSetup({ sender: wc, senderFrame: { url: `${setupUrl}#x` } }, setup, setupUrl)).toBe(false);
    expect(daTelaDeSetup({ sender: { id: 2 }, senderFrame: { url: setupUrl } }, setup, setupUrl)).toBe(false);
    expect(daTelaDeSetup({ sender: wc, senderFrame: null }, setup, setupUrl)).toBe(false);
    expect(daTelaDeSetup({ sender: wc, senderFrame: { url: setupUrl } }, null, setupUrl)).toBe(false);
    expect(daTelaDeSetup({ sender: wc, senderFrame: { url: setupUrl } }, { ...setup, isDestroyed: () => true }, setupUrl)).toBe(false);
  });
  it("todo ipcMain.handle do main passa pela guarda", () => {
    const handles = main.split("ipcMain.handle(").length - 1;
    const guardados = main.match(/ipcMain\.handle\("nodwin:\w+", \(e\) => \{?\s*(?:\(|if \()daTelaDeSetup\(e\)/g) ?? [];
    expect(handles).toBeGreaterThanOrEqual(5);
    expect(guardados).toHaveLength(handles);
    expect(main).toMatch(/const daTelaDeSetup = \(e: IpcMainInvokeEvent\) => daTelaDeSetupPura\(e, setup, setupUrl\);/);
    expect(main).toContain('setup.webContents.on("will-navigate", (e, url) => { if (url !== setupUrl) e.preventDefault(); });');
  });
});

describe("QA #678: fechar a janela no meio do pareamento não a reabre", () => {
  it("cancelado = nenhuma tela", () => {
    expect(telaDaFalhaDePareamento("vencido", true)).toBeNull();
    expect(telaDaFalhaDePareamento("servidor_fora", true)).toBeNull();
    expect(telaDaFalhaDePareamento("vencido", false)).toEqual({ tela: "conectar", aviso: TEXTOS_WINDOWS.vencido });
  });
  it("o main passa o cancelarPareamento e só mostra a tela que veio", () => {
    expect(main).toMatch(/telaDaFalhaDePareamento\([^;]*, cancelarPareamento\)/);
    expect(main).toMatch(/if \(tela\) mostrar\(tela\);/);
    expect(main).toContain('setup.on("closed", () => { setup = null; cancelarPareamento = true; });');
  });
});

describe("QA #678: o cookie da sessão na partition nod-web", () => {
  it("o cookie é o nod_sessao, httpOnly, strict, secure só em https", () => {
    expect(PARTITION_DA_JANELA).toBe("nod-web");
    expect(cookieDaJanela("https://app.nodbot.ai", "v")).toEqual({ url: "https://app.nodbot.ai", name: "nod_sessao", value: "v", path: "/", httpOnly: true, secure: true, sameSite: "strict" });
    expect(cookieDaJanela("http://127.0.0.1:8888", "v").secure).toBe(false);
  });
  it("o main grava esse cookie nessa partition e a janela usa a mesma", () => {
    expect(main).toContain("session.fromPartition(PARTITION_DA_JANELA)");
    expect(main).toContain("web.cookies.set(cookieDaJanela(c.url, passo.abrir))");
    expect(main).toContain("partition: PARTITION_DA_JANELA");
    expect(main).not.toMatch(/"nod-web"|"nod_sessao"/);
  });
});

describe("QA #678: o vigia a cada 30 s religa pela tarefa", () => {
  it("o intervalo é 30 s e o main o usa", () => {
    expect(INTERVALO_DO_VIGIA_MS).toBe(30_000);
    expect(main).toMatch(/setInterval\(\(\) => \{ if \(conexao\) void lerMotor\(\); \}, INTERVALO_DO_VIGIA_MS\)/);
  });
  it("vigiar: estado e religar a partir da saída do PowerShell", () => {
    expect(vigiar('{"tarefa":"Ready","processos":0,"instalado":true}')).toEqual({ estado: "parado", religar: true, tarefa: "Ready" });
    expect(vigiar('{"tarefa":"Running","processos":1,"instalado":true}')).toEqual({ estado: "rodando", religar: false, tarefa: "Running" });
    expect(vigiar("lixo")).toEqual({ estado: "desconhecido", religar: false, tarefa: null });
  });
  it("o main religa quando o vigia manda e roda o NSIS com os argumentos da atualização", () => {
    expect(main).toMatch(/const v = vigiar\(saida\);/);
    expect(main).toMatch(/if \(v\.religar\) \{\n\s+const c = comandoDeReligar\(systemRoot\);\n\s+execFile\(c\.arquivo, c\.args/);
    expect(main).toContain("spawn(exe, [...ARGS_DO_INSTALADOR], { detached: true");
  });
});
