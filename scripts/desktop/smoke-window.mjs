import { app, BrowserWindow, ipcMain } from "electron";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
const scratch = await mkdtemp(join(tmpdir(), "nod-ui-smoke-"));
app.setPath("userData", scratch);
void app.whenReady().then(async () => {
ipcMain.handle("nod:estado", () => ({ url: "", mensagem: "" }));
const w = new BrowserWindow({ show: false, width: 580, height: 850, webPreferences: { preload: resolve("dist/desktop/preload.cjs"), sandbox: true, contextIsolation: true, nodeIntegration: false } });
try {
  await w.loadFile(resolve("dist/desktop/setup.html"));
  const estado = await w.webContents.executeJavaScript(`({ node: typeof require, ponte: typeof window.nod?.conectar, titulo: document.querySelector('h1')?.textContent, overflow: document.documentElement.scrollWidth > innerWidth })`);
  if (estado.node !== "undefined" || estado.ponte !== "function" || estado.overflow) throw new Error("Isolamento, preload ou layout inválido");
  const screenshot = await w.webContents.capturePage();
  await writeFile("/private/tmp/nod-desktop-setup.png", screenshot.toPNG());
  process.stdout.write(JSON.stringify(estado) + "\n");
} finally { w.destroy(); await rm(scratch, { recursive: true, force: true }); app.exit(0); }
}).catch((erro) => { process.stderr.write(String(erro)); app.exit(1); });
