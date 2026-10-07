import { app, BrowserWindow, ipcMain } from "electron";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { setTimeout as esperar } from "node:timers/promises";
const scratch = await mkdtemp(join(tmpdir(), "nod-ui-smoke-"));
app.setPath("userData", scratch);
const isolada = { sandbox: true, contextIsolation: true, nodeIntegration: false };
/**
 * definido em 2026-09-24 ("aviso no Mac"): a janela web recebe SÓ `nodDesktop` (as onze de `desktop/preload-web.ts`,
 * com o microfone, o aviso de ligação aberta e as ações da IA do Mac), sem
 * `require`, `process` nem a ponte da tela de conexão (`window.nod`, que entrega `conectar`); a chamada
 * chega ao processo principal e o clique no aviso volta pela `aoAbrir`.
 */
async function janelaWeb() {
  const recebidos = [];
  ipcMain.handle("nod:contador", (_e, n) => { recebidos.push(n); });
  const w = new BrowserWindow({ show: false, webPreferences: { preload: resolve("dist/desktop/preload-web.cjs"), partition: "nod-web-smoke", ...isolada } });
  try {
    await w.loadURL("data:text/html;charset=utf-8,<!doctype html><title>nod</title><body>web</body>");
    const estado = await w.webContents.executeJavaScript(`({ node: typeof require, processo: typeof process, nod: typeof window.nod, ponte: Object.keys(window.nodDesktop ?? {}).sort().join(","), ipc: typeof window.ipcRenderer })`);
    const esperado = "aoAbrir,avisar,contador,definirAvisos,definirTema,emLigacao,iaEntrar,iaInstalar,iaTestar,microfone,preferencias";
    if (estado.node !== "undefined" || estado.processo !== "undefined" || estado.nod !== "undefined" || estado.ipc !== "undefined" || estado.ponte !== esperado) throw new Error(`Janela web expõe mais que nodDesktop: ${JSON.stringify(estado)}`);
    await w.webContents.executeJavaScript(`window.nodDesktop.aoAbrir((alvo) => { window.alvoAberto = alvo; }); window.nodDesktop.contador(3)`);
    w.webContents.send("nod:abrir", { tipo: "sua-vez" });
    await esperar(200);
    const alvo = await w.webContents.executeJavaScript("window.alvoAberto ?? null");
    if (recebidos[0] !== 3 || alvo?.tipo !== "sua-vez") throw new Error(`Ponte da janela web não chegou ao processo principal: ${JSON.stringify({ recebidos, alvo })}`);
    return { ...estado, contador: recebidos[0], alvo: alvo.tipo };
  } finally { w.destroy(); }
}
// medido em 2026-10-06 (NOD-187): sem este ouvinte, destruir a última janela dispara o `app.quit()` padrão durante o
// `await rm` do `finally`, o processo sai com 0 antes do `app.exit(codigo)`, e um smoke quebrado passava.
app.on("window-all-closed", () => {});
// medido em 2026-10-07 (NOD-187, QA): sob carga, o Chromium ainda grava `Session Storage` depois do `destroy()`, o
// `rm` dava ENOTEMPTY no `finally`, e um smoke que passou saía com 1, sem chegar ao `app.exit(codigo)`. A limpeza da
// pasta temporária não decide o resultado: tenta de novo e, se ainda falhar, só avisa.
async function limpar() {
  try { await rm(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); }
  catch (erro) { process.stderr.write(`aviso: pasta temporária não apagada (${scratch}): ${String(erro)}\n`); }
}
void app.whenReady().then(async () => {
ipcMain.handle("nod:estado", () => ({ url: "", mensagem: "" }));
const w = new BrowserWindow({ show: false, width: 580, height: 850, webPreferences: { preload: resolve("dist/desktop/preload.cjs"), ...isolada } });
// definido em 2026-09-24: o código de saída vem do resultado — antes o `finally` saía com 0 antes de o
// `.catch` ver a falha, e um smoke quebrado passava.
let codigo = 0;
try {
  await w.loadFile(resolve("dist/desktop/setup.html"));
  const estado = await w.webContents.executeJavaScript(`({ node: typeof require, ponte: typeof window.nod?.conectar, desktop: typeof window.nodDesktop, titulo: document.querySelector('h1')?.textContent, overflow: document.documentElement.scrollWidth > innerWidth })`);
  if (estado.node !== "undefined" || estado.ponte !== "function" || estado.desktop !== "undefined" || estado.overflow) throw new Error("Isolamento, preload ou layout inválido");
  const screenshot = await w.webContents.capturePage();
  await writeFile("/private/tmp/nod-desktop-setup.png", screenshot.toPNG());
  process.stdout.write(JSON.stringify(estado) + "\n");
  process.stdout.write(JSON.stringify(await janelaWeb()) + "\n");
} catch (erro) { codigo = 1; process.stderr.write(`${String(erro)}\n`); }
finally { w.destroy(); await limpar(); app.exit(codigo); }
}).catch((erro) => { process.stderr.write(`${String(erro)}\n`); app.exit(1); });
