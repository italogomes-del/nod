import { app, BrowserWindow, ipcMain, Menu, safeStorage, session, shell, type IpcMainInvokeEvent } from "electron";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { hostname } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { criarClaudeCliDriver } from "../src/adapters/executor/drivers/claude-cli.ts";
import { iniciarLaco, type Laco } from "../src/adapters/executor/laco.ts";
import { criarRegistryDetalhado } from "../src/adapters/executor/registry.ts";
import { criarPonteHttp, FalhaPonte, urlServidor } from "../src/adapters/executor/ponte-http.ts";
import type { Registry } from "../src/adapters/executor/spi.ts";
import { versaoAceita } from "../src/domain/versao-app.ts";

type Config = { url: string; chave: string };
const dir = dirname(fileURLToPath(import.meta.url));
const setup = join(dir, "setup.html");
const setupUrl = pathToFileURL(setup).href;
let janela: BrowserWindow | null = null;
let configuracao: Config | null = null;
let laco: Laco | null = null;
let registry: Registry | null = null;
let cliente: ReturnType<typeof criarPonteHttp> | null = null;
let mensagem = "";
let conectando = false;
let encerrando = false;
let falhando = false;
const mensagens: Record<string, string> = {
  servidor_fora: "O servidor não respondeu. Confira sua conexão; o app tentará novamente.",
  chave_invalida: "Esta chave não é mais válida. Gere uma nova em Chaves no navegador.",
  atualize_app: "Atualize o nod para continuar. Peça ao time o DMG mais recente.",
  reconectar: "Reconectando ao servidor…",
  resposta_invalida: "Confira o endereço HTTPS do servidor do seu time.",
};
function caminhoConfig() { return join(app.getPath("userData"), "conexao.enc"); }
async function guardar(c: Config) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error("keychain_indisponivel");
  await mkdir(app.getPath("userData"), { recursive: true });
  const tmp = `${caminhoConfig()}.tmp`;
  await writeFile(tmp, safeStorage.encryptString(JSON.stringify(c)), { mode: 0o600 });
  await rename(tmp, caminhoConfig());
}
async function ler(): Promise<Config | null> {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const c = JSON.parse(safeStorage.decryptString(await readFile(caminhoConfig()))) as Config;
    return { url: urlServidor(c.url, !app.isPackaged), chave: c.chave };
  } catch { return null; }
}
function proteger(w: BrowserWindow, origem?: string) {
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (origem && url.startsWith(`${origem}/`)) void shell.openExternal(url);
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", (e, url) => {
    if ((!origem && url !== setupUrl) || (origem && new URL(url).origin !== origem)) e.preventDefault();
    if (origem && url.startsWith(`${origem}/api/sessao/google`)) { e.preventDefault(); void shell.openExternal(url); }
  });
  w.webContents.on("will-redirect", (e, url) => { if (!origem || new URL(url).origin !== origem) e.preventDefault(); });
  w.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  w.webContents.session.setPermissionCheckHandler(() => false);
}
async function mostrarSetup() {
  const anterior = janela;
  const nova = new BrowserWindow({ width: 580, height: 850, minWidth: 500, title: "Conectar ao nod", webPreferences: { preload: join(dir, "preload.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  janela = nova; proteger(nova);
  nova.on("closed", () => { if (janela === nova) janela = null; });
  await nova.loadFile(setup);
  anterior?.close();
}
async function parar() {
  const anterior = laco; laco = null;
  cliente?.cancelar();
  if (anterior) await anterior.parar().catch(() => undefined);
  for (const r of Object.values(registry ?? {})) if (r.estado === "pronto") await r.instance.dispose();
  if (cliente) await cliente.ponte.desconectar("").catch(() => undefined);
  registry = null; cliente = null;
}
function falha(codigo: FalhaPonte["codigo"]) {
  mensagem = mensagens[codigo] ?? mensagens.servidor_fora!;
  if (!["chave_invalida", "atualize_app"].includes(codigo) || falhando || encerrando) return;
  falhando = true;
  setTimeout(() => { void parar().then(mostrarSetup).finally(() => { falhando = false; }); }, 0);
}
async function conectar(c: Config) {
  await parar();
  const r = await fetch(`${c.url}/api/maquina/sessao`, { method: "POST", redirect: "error", headers: { authorization: `Bearer ${c.chave}`, "x-nod-versao": app.getVersion(), "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15_000) });
  const minima = r.headers.get("x-nod-versao-minima");
  if (r.status === 426 || (minima && !versaoAceita(app.getVersion(), minima))) throw new FalhaPonte("atualize_app");
  if (r.status === 401 || r.status === 403) throw new FalhaPonte("chave_invalida");
  if (!r.ok) throw new FalhaPonte("servidor_fora");
  const dados = await r.json() as { escopo: { pessoaId: string }; machineId: string };
  const cookie = r.headers.get("set-cookie")?.match(/(?:^|;\s*)nod_sessao=([^;]+)/)?.[1];
  if (!cookie || !dados.escopo?.pessoaId || !dados.machineId) throw new FalhaPonte("resposta_invalida");
  const web = session.fromPartition("nod-web");
  await web.clearStorageData();
  await web.cookies.set({ url: c.url, name: "nod_sessao", value: cookie, path: "/", httpOnly: true, secure: c.url.startsWith("https:"), sameSite: "strict" });
  await guardar(c); configuracao = c;
  const criado = await criarRegistryDetalhado({ ...process.env, NOD_HOME: join(app.getPath("userData"), "executor") }, [criarClaudeCliDriver({ urlNod: c.url, proxyPath: app.isPackaged ? join(process.resourcesPath, "app.asar.unpacked", "dist", "desktop", "proxy.mjs") : join(dir, "proxy.mjs"), nodePath: process.execPath, electronComoNode: true })]);
  registry = criado.registry;
  const inv = criado.inventarios["claude-cli"] ?? { estado: "ausente" as const, motivo: "Claude indisponível", em: Date.now() };
  cliente = criarPonteHttp({ url: c.url, chave: c.chave, versao: app.getVersion(), aoFalhar: falha });
  await cliente.ponte.conectar({ machineId: dados.machineId, nome: hostname(), inventario: inv, versaoContrato: 1 });
  if (inv.estado !== "pronto") {
    mensagem = inv.estado === "nao_autenticado" ? "Entre na sua conta com o Claude Code e conecte novamente." : "Instale o Claude Code neste Mac e conecte novamente.";
    throw new Error("claude_indisponivel");
  }
  laco = iniciarLaco({ ponte: cliente.ponte, registry, pessoaId: dados.escopo.pessoaId, machineId: dados.machineId, relogio: () => Date.now(), renovacaoMs: 1_000, esperaVaziaMs: 1000, aoDelta: (_p, t) => cliente?.delta(t) });
  const anterior = janela;
  const nova = new BrowserWindow({ width: 1280, height: 860, minWidth: 900, title: "nod", webPreferences: { partition: "nod-web", nodeIntegration: false, contextIsolation: true, sandbox: true } });
  janela = nova; proteger(nova, c.url);
  nova.on("closed", () => { if (janela === nova) janela = null; });
  nova.webContents.on("did-fail-load", (_e, code, _description, _url, main) => { if (main && code !== -3) { mensagem = mensagens.servidor_fora!; void mostrarSetup(); } });
  await nova.loadURL(c.url);
  anterior?.close(); mensagem = "Conectado.";
}
function validarRemetente(event: IpcMainInvokeEvent) {
  if (event.senderFrame?.url !== setupUrl || event.sender !== janela?.webContents) throw new Error("origem_invalida");
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { janela?.show(); janela?.focus(); });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (encerrando) return;
    event.preventDefault(); encerrando = true;
    void parar().finally(() => app.quit());
  });
  void app.whenReady().then(async () => {
    Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: "nod", submenu: [{ label: "Conexão / verificar Claude", click: () => { void parar().then(mostrarSetup); } }, { role: "quit" }] }, { role: "editMenu" }, { role: "viewMenu" }]));
    ipcMain.handle("nod:estado", (e) => { validarRemetente(e); return { url: configuracao?.url ?? "", mensagem }; });
    ipcMain.handle("nod:login", async (e, valor: unknown) => {
      validarRemetente(e);
      try { await shell.openExternal(urlServidor(valor, !app.isPackaged)); return { mensagem: "No navegador, entre e gere uma chave em Chaves." }; }
      catch { return { mensagem: mensagens.resposta_invalida }; }
    });
    ipcMain.handle("nod:conectar", async (e, dados: unknown) => {
      validarRemetente(e);
      if (conectando) return { mensagem: "Conexão em andamento…" };
      conectando = true;
      try {
        if (!dados || typeof dados !== "object" || !("url" in dados) || !("chave" in dados) || typeof dados.chave !== "string" || dados.chave.length > 1024 || !dados.chave) throw new FalhaPonte("resposta_invalida");
        await conectar({ url: urlServidor(dados.url, !app.isPackaged), chave: dados.chave });
      } catch (erro) { if (erro instanceof FalhaPonte) mensagem = mensagens[erro.codigo]!; else if (!mensagem) mensagem = "Não foi possível conectar. Confira o Claude e o acesso ao Keychain."; }
      finally { conectando = false; }
      return { mensagem };
    });
    configuracao = await ler();
    await mostrarSetup();
    if (configuracao) {
      conectando = true;
      try { await conectar(configuracao); }
      catch (erro) { mensagem = erro instanceof FalhaPonte ? mensagens[erro.codigo]! : mensagem || "Conecte novamente para continuar."; await mostrarSetup(); }
      finally { conectando = false; }
    }
  });
}
