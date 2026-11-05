import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, session, shell, Tray, type IpcMainInvokeEvent } from "electron";
import { execFile, spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { arquivoDaConexao, carregarConexao, guardarConexao, pastaDoMotor, type ConexaoMotor } from "../../motor/conexao.ts";
import { criarAtualizacaoDoApp, linhaDaAtualizacao, servidorDeAtualizacao, TEXTOS_ATUALIZACAO, type AtualizacaoDoApp } from "../atualizacao.ts";
import { abreNoNavegador } from "../links-externos.ts";
import { ARGS_DO_INSTALADOR, criarAtualizadorWindows, gravadorConferindo } from "./atualizador.ts";
import { daTelaDeSetup as daTelaDeSetupPura, maisUmaLinha, passoAoAbrir, passoDaSessao, servidorDoApp, telaDaFalhaDePareamento, TEXTOS_WINDOWS, travarPermissoes, urlDaTelaDeSetup, type TelaDoSetup } from "./fluxo.ts";
import { rodarInstalacao } from "./instalacao.ts";
import { comandoDeReligar, comandoDeStatus, INTERVALO_DO_VIGIA_MS, TEXTO_DO_ESTADO, vigiar, type EstadoDoMotor } from "./motor-status.ts";
import { FalhaPareamentoWindows, linkDePareamento, parearPorDispositivo } from "./pareamento.ts";
import { abrirSessao, cookieDaJanela, PARTITION_DA_JANELA } from "./sessao.ts";

/**
 * ADA-229 (ADR-152): o processo principal do app do Windows. A mesma base Electron do Mac (ícone, partition `nod-web`,
 * coordenador da atualização), sem launchd, VM nem Keychain: o executor é o motor da ADR-151, fora do Electron. A lógica
 * fica nos módulos ao lado (testados sem Electron); aqui só a cola com janelas, bandeja, IPC e processos.
 */
declare const __NOD_SERVIDOR_PADRAO__: string;
const SERVIDOR = servidorDoApp(typeof __NOD_SERVIDOR_PADRAO__ === "string" ? __NOD_SERVIDOR_PADRAO__ : "");
const dir = dirname(fileURLToPath(import.meta.url));
const setupUrl = urlDaTelaDeSetup(dir);
const pastaMotor = () => pastaDoMotor(process.env, "win32");
const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT ?? "C:\\Windows";

let setup: BrowserWindow | null = null;
let janela: BrowserWindow | null = null;
let bandeja: Tray | null = null;
let conexao: ConexaoMotor | null = null;
let telaAtual: TelaDoSetup = { tela: "abrindo" };
let motor: EstadoDoMotor = "desconhecido";
let ocupado = false;
let cancelarPareamento = false;
let saindo = false;
let atualizacao: AtualizacaoDoApp | null = null;

const registrar = (evento: string, campos: Record<string, string | number | boolean | null> = {}) => {
  process.stdout.write(`${JSON.stringify({ t: new Date().toISOString(), evento, ...campos })}\n`);
};

function icone() { return nativeImage.createFromPath(join(dir, "icon.png")); }

function mostrar(t: TelaDoSetup) {
  telaAtual = t;
  if (!setup || setup.isDestroyed()) criarSetup();
  setup?.webContents.send("nodwin:tela", t);
  setup?.show();
}

function criarSetup() {
  setup = new BrowserWindow({ width: 520, height: 640, resizable: false, title: "nod", icon: icone(), show: false, autoHideMenuBar: true, webPreferences: { preload: join(dir, "preload-windows.cjs"), contextIsolation: true, sandbox: true, nodeIntegration: false } });
  setup.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  setup.webContents.on("will-navigate", (e, url) => { if (url !== setupUrl) e.preventDefault(); });
  setup.on("ready-to-show", () => setup?.show());
  setup.on("closed", () => { setup = null; cancelarPareamento = true; });
  void setup.loadURL(setupUrl);
}

/** Só a tela de conexão fala com estes canais. */
const daTelaDeSetup = (e: IpcMainInvokeEvent) => daTelaDeSetupPura(e, setup, setupUrl);

async function lerMotor(): Promise<EstadoDoMotor> {
  const { arquivo, args } = comandoDeStatus(systemRoot);
  const saida = await new Promise<string>((r) => execFile(arquivo, args, { windowsHide: true, timeout: 20_000 }, (_e, out) => r(String(out ?? ""))));
  const v = vigiar(saida);
  const estado = v.estado;
  if (v.religar) {
    const c = comandoDeReligar(systemRoot);
    execFile(c.arquivo, c.args, { windowsHide: true, timeout: 20_000 }, () => undefined);
    registrar("motor_religado", { tarefa: v.tarefa });
  }
  if (estado !== motor) { motor = estado; atualizarBandeja(); registrar("motor_estado", { estado }); }
  return estado;
}

async function abrir() {
  if (ocupado) return;
  ocupado = true;
  try {
    if (!janela || janela.isDestroyed() || !janela.isVisible()) mostrar({ tela: "abrindo" });
    conexao = await carregarConexao(pastaMotor());
    const passo = passoAoAbrir(conexao, conexao ? await lerMotor() : motor);
    if (passo.tipo === "setup") { mostrar(passo.tela); return; }
    if (passo.tipo === "instalar") { await instalar(); return; }
    await entrar(passo.conexao);
  } finally { ocupado = false; }
}

async function instalar() {
  let linhas: string[] = [];
  mostrar({ tela: "instalando", linhas });
  const r = await rodarInstalacao({ servidor: conexao?.url ?? SERVIDOR, gerar: spawn, env: process.env, aoLinha: (l) => { if (l.tipo !== "resultado") { linhas = maisUmaLinha(linhas, l.texto); mostrar({ tela: "instalando", linhas }); } } });
  registrar("instalacao_motor", { ok: r.ok });
  if (!r.ok) { mostrar({ tela: "erro", mensagem: TEXTOS_WINDOWS.instalacaoFalhou(r.erro ?? ""), podeTentar: true }); return; }
  await lerMotor();
  if (conexao) await entrar(conexao);
}

async function entrar(c: ConexaoMotor) {
  const passo = passoDaSessao(await abrirSessao(c, app.getVersion()));
  if (!("abrir" in passo)) {
    if (passo.apagarConexao) { await rm(arquivoDaConexao(pastaMotor()), { force: true }); conexao = null; atualizacao?.desconectado(); }
    if (passo.procurarAtualizacao) atualizacao?.procurar(true);
    mostrar(passo.tela);
    return;
  }
  const web = session.fromPartition(PARTITION_DA_JANELA);
  await web.clearStorageData();
  await web.cookies.set(cookieDaJanela(c.url, passo.abrir));
  abrirJanela(c.url);
  setup?.close();
  atualizacao?.conectado();
}

function abrirJanela(url: string) {
  const origem = new URL(url).origin;
  if (janela && !janela.isDestroyed()) { void janela.loadURL(`${origem}/`); janela.show(); return; }
  janela = new BrowserWindow({ width: 1280, height: 820, minWidth: 900, minHeight: 600, title: "nod", icon: icone(), autoHideMenuBar: true, webPreferences: { partition: PARTITION_DA_JANELA, contextIsolation: true, sandbox: true, nodeIntegration: false } });
  // ADR-053: link para fora (target=_blank) abre no navegador; a janela nunca abre outra no app.
  janela.webContents.setWindowOpenHandler(({ url: u }) => { if (abreNoNavegador(u)) void shell.openExternal(u); return { action: "deny" }; });
  janela.webContents.on("will-navigate", (e, u) => {
    let fora = true;
    try { fora = new URL(u).origin !== origem; } catch { /* inválida: fica */ }
    if (fora || u.startsWith(`${origem}/api/sessao/google`)) { e.preventDefault(); if (abreNoNavegador(u)) void shell.openExternal(u); }
  });
  janela.webContents.on("will-redirect", (e, u) => { try { if (new URL(u).origin !== origem) e.preventDefault(); } catch { e.preventDefault(); } });
  janela.webContents.on("will-frame-navigate", (e) => { if (!e.isMainFrame && !/^about:(srcdoc|blank)$/.test(e.url)) e.preventDefault(); });
  travarPermissoes(janela.webContents.session);
  // Fechar a janela deixa o nod na bandeja (o motor segue de qualquer jeito); Sair fica no menu da bandeja.
  janela.on("close", (e) => { if (!saindo) { e.preventDefault(); janela?.hide(); } });
  void janela.loadURL(`${origem}/`);
}

async function conectar() {
  if (ocupado) return;
  ocupado = true;
  cancelarPareamento = false;
  try {
    const chave = await parearPorDispositivo({
      servidor: SERVIDOR,
      nome: hostname(),
      abrir: (u) => shell.openExternal(u),
      mostrarCodigo: (codigo) => mostrar({ tela: "aguardando", codigo, link: linkDePareamento(SERVIDOR, codigo) }),
      cancelado: () => cancelarPareamento,
    });
    conexao = { url: SERVIDOR, chave };
    await guardarConexao(pastaMotor(), conexao);
    registrar("pareado", {});
  } catch (e) {
    // Fechou a janela no meio: não reabre com "O código venceu" (o app segue na bandeja).
    const tela = telaDaFalhaDePareamento(e instanceof FalhaPareamentoWindows ? e.codigo : "servidor_fora", cancelarPareamento);
    if (tela) mostrar(tela);
    return;
  } finally { ocupado = false; }
  await abrir();
}

function atualizarBandeja() {
  if (!bandeja) return;
  const estadoAtualizacao = atualizacao?.estado();
  const linha = estadoAtualizacao ? linhaDaAtualizacao(estadoAtualizacao, process.arch, "win32") : "";
  bandeja.setToolTip(`nod: ${TEXTO_DO_ESTADO[motor]}`);
  bandeja.setContextMenu(Menu.buildFromTemplate([
    { label: "Abrir o nod", click: () => { if (janela && !janela.isDestroyed()) janela.show(); else void abrir(); } },
    { label: TEXTO_DO_ESTADO[motor], enabled: false },
    { type: "separator" },
    estadoAtualizacao?.fase === "pronta"
      ? { label: TEXTOS_ATUALIZACAO.reiniciar(estadoAtualizacao.versao), click: () => void atualizacao?.reiniciar() }
      : { label: TEXTOS_ATUALIZACAO.procurar, enabled: estadoAtualizacao?.fase !== "desligada", click: () => void atualizacao?.procurar(true, true) },
    ...(linha ? [{ label: linha.slice(0, 80), enabled: false }] : []),
    { type: "separator" },
    { label: "Sair", click: () => { saindo = true; app.quit(); } },
  ]));
}

function montarAtualizacao(): AtualizacaoDoApp {
  return criarAtualizacaoDoApp({
    updater: criarAtualizadorWindows({
      gravar: gravadorConferindo(join(app.getPath("userData"), "atualizacao")),
      instalar: (exe) => {
        // O NSIS fecha o app (se ainda aberto), troca os arquivos e reabre com --updated.
        spawn(exe, [...ARGS_DO_INSTALADOR], { detached: true, stdio: "ignore", windowsHide: true }).unref();
        saindo = true;
        app.quit();
      },
    }),
    empacotado: app.isPackaged,
    plataforma: process.platform,
    arquitetura: process.arch,
    naPastaAplicativos: () => true,
    versao: app.getVersion(),
    // Só o servidor oficial do build é fonte de atualização (ADR-149).
    conexao: () => (conexao && servidorDeAtualizacao(conexao.url, SERVIDOR) ? conexao : null),
    agendar: (f, ms) => { const t = setTimeout(f, ms); return () => clearTimeout(t); },
    agora: Date.now,
    registrar,
    aoMudar: (e) => { atualizarBandeja(); setup?.webContents.send("nodwin:atualizacao", linhaDaAtualizacao(e, process.arch, "win32")); },
    // O motor roda fora do app: reiniciar o app não derruba turno nenhum.
    podeReiniciar: async () => true,
    antesDeInstalar: async () => undefined,
    sair: () => { saindo = true; app.quit(); },
    avisar: (texto) => { void dialog.showMessageBox({ type: "info", message: texto, buttons: ["OK"] }); },
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.setAppUserModelId("app.nod.desktop");
  app.on("second-instance", () => {
    const w = janela && !janela.isDestroyed() && janela.isVisible() ? janela : setup;
    if (w && !w.isDestroyed()) { if (w.isMinimized()) w.restore(); w.show(); w.focus(); } else void abrir();
  });
  // A bandeja segue com as janelas fechadas; só o Sair (ou o reinício da atualização) encerra.
  app.on("window-all-closed", () => { if (saindo) app.quit(); });
  app.on("before-quit", () => { saindo = true; });
  void app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    ipcMain.handle("nodwin:estado", (e) => (daTelaDeSetup(e) ? telaAtual : null));
    ipcMain.handle("nodwin:conectar", (e) => { if (daTelaDeSetup(e)) void conectar(); });
    ipcMain.handle("nodwin:tentar", (e) => { if (daTelaDeSetup(e)) void abrir(); });
    ipcMain.handle("nodwin:abrirLink", (e) => {
      if (daTelaDeSetup(e) && telaAtual.tela === "aguardando") void shell.openExternal(telaAtual.link);
    });
    ipcMain.handle("nodwin:baixar", (e) => { if (daTelaDeSetup(e)) void shell.openExternal("https://nodbot.ai/download/windows"); });
    bandeja = new Tray(icone().resize({ width: 16, height: 16 }));
    bandeja.on("click", () => { if (janela && !janela.isDestroyed()) janela.show(); else void abrir(); });
    atualizacao = montarAtualizacao();
    atualizarBandeja();
    setInterval(() => { if (conexao) void lerMotor(); }, INTERVALO_DO_VIGIA_MS).unref();
    registrar("app_aberto", { versao: app.getVersion() });
    void abrir();
  });
}
