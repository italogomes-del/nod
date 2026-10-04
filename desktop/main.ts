import { criarCodexCliDriver } from "../src/adapters/executor/drivers/codex-cli.ts";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, powerSaveBlocker, safeStorage, session, shell, systemPreferences, type IpcMainInvokeEvent } from "electron";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { hostname } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { criarClaudeCliDriver } from "../src/adapters/executor/drivers/claude-cli.ts";
import { iniciarLaco } from "../src/adapters/executor/laco.ts";
import { criarAcompanhanteDeTarefas } from "../src/adapters/executor/acompanhar-tarefas.ts";
import { iniciarPoolDeLacos, type PoolDeLacos } from "../src/adapters/executor/pool-lacos.ts";
import { criarRegistryDetalhado } from "../src/adapters/executor/registry.ts";
import { criarPonteHttp, FalhaPonte, urlServidor } from "../src/adapters/executor/ponte-http.ts";
import type { Registry } from "../src/adapters/executor/spi.ts";
import { versaoAceita } from "../src/domain/versao-app.ts";
import { CANAIS_DESKTOP, type AlvoAviso, type AvisoDesktop, type PreferenciasDesktop, type TemaDesktop } from "../src/contracts/desktop.ts";
import { lerAviso, lerContador, lerPreferencias, lerTemaDesktop, origemDe, remetenteWebValido } from "./avisos-mac.ts";
import { abreNoNavegador } from "./links-externos.ts";
import { estadoDoMicrofone, lerEmLigacao, permitirChecagemDeMidia, permitirPedidoDeMidia, TEXTO_FECHAR_EM_LIGACAO } from "./permissoes-midia.ts";
import type { EstadoMicrofone } from "../src/contracts/desktop.ts";
import { criarDetectorGh, executarGithubNaMaquina } from "../src/adapters/conectores-locais/github/maquina.ts";
import { FalhaPareamento, parearPeloNavegador } from "./parear.ts";

/** ADR-069: o endereço do servidor vem no build (scripts/desktop/build.mjs, NOD_SERVIDOR_PADRAO); vazio = a pessoa informa. */
declare const __NOD_SERVIDOR_PADRAO__: string;
const SERVIDOR_PADRAO = typeof __NOD_SERVIDOR_PADRAO__ === "string" ? __NOD_SERVIDOR_PADRAO__ : "";

type Config = { url: string; chave: string };
const dir = dirname(fileURLToPath(import.meta.url));
const setup = join(dir, "setup.html");
const setupUrl = pathToFileURL(setup).href;
let janela: BrowserWindow | null = null;
let configuracao: Config | null = null;
let laco: PoolDeLacos | null = null;
let registry: Registry | null = null;
let cliente: ReturnType<typeof criarPonteHttp> | null = null;
let mensagem = "";
let conectando = false;
let encerrando = false;
let falhando = false;
let itensGithub: ReturnType<typeof setInterval> | null = null;
/**
 * definido em 2026-09-24 (ADR-048): de 5 em 5 s o app puxa os itens aprovados que rodam no gh deste
 * Mac (um comentário que a pessoa aprovou no celular sai assim que o Mac estiver aberto). Um por vez.
 */
const INTERVALO_ITENS_GITHUB_MS = 5_000;
/**
 * revisto em 2026-09-25: item que já rodou neste Mac nunca roda de novo (comentar e revisar no GitHub
 * não são idempotentes). O desfecho fica guardado até o servidor aceitar o relato; a cada volta o app
 * reenvia só o relato. Limite: fechar o app entre rodar e relatar perde esta memória.
 */
const relatosPendentes = new Map<string, "executado" | "falhou_na_execucao">();
function vigiarItensGithub(c: ReturnType<typeof criarPonteHttp>) {
  let ocupado = false;
  const relatar = async (itemId: string, desfecho: "executado" | "falhou_na_execucao") => {
    relatosPendentes.set(itemId, desfecho);
    await c.resultadoItemLocal(itemId, desfecho).then(() => relatosPendentes.delete(itemId), () => undefined);
  };
  itensGithub = setInterval(() => {
    if (ocupado) return;
    ocupado = true;
    void (async () => {
      for (const [itemId, desfecho] of [...relatosPendentes]) await relatar(itemId, desfecho);
      for (const item of await c.itensLocais()) {
        const jaRodou = relatosPendentes.get(item.itemId);
        if (jaRodou) { await relatar(item.itemId, jaRodou); continue; }
        const r = await executarGithubNaMaquina({ capacidade: item.capacidade, argumentos: item.argumentos, ambiente: process.env });
        await relatar(item.itemId, r.isError ? "falhou_na_execucao" : "executado");
      }
    })().catch(() => undefined).finally(() => { ocupado = false; });
  }, INTERVALO_ITENS_GITHUB_MS);
}
const mensagens: Record<string, string> = {
  servidor_fora: "O servidor não respondeu. Confira sua conexão; o app tentará novamente.",
  chave_invalida: "Esta chave não é mais válida. Gere uma nova em Chaves no navegador.",
  atualize_app: "Atualize o nod para continuar. Peça ao time o DMG mais recente.",
  reconectar: "Reconectando ao servidor…",
  resposta_invalida: "Confira o endereço HTTPS do servidor do seu time.",
  sem_resposta: "O navegador não confirmou a tempo. Clique em Entrar com Google de novo.",
  recusado: "O nod não confirmou este Mac. Clique em Entrar com Google de novo.",
};
function caminhoConfig() { return join(app.getPath("userData"), "conexao.enc"); }

// ---- Avisos no Mac (definido em 2026-09-24) ----------------------------------------------------------
// A preferência mora em userData/preferencias.json: o localStorage da janela web é apagado a cada
// conexão (clearStorageData abaixo). O aviso sai daqui, do processo principal — a página continua sem
// permissão nenhuma (proteger) —, e só com a janela fora de foco.
let preferencias: Pick<PreferenciasDesktop, "avisos" | "tema"> = { avisos: true, tema: "sistema" };
/** O último aviso falhou ao aparecer (o macOS bloqueou); o próximo que aparecer desfaz. */
let bloqueados = false;
let contadorAtual = 0;
/** Referência viva de cada aviso: sem ela o coletor leva o objeto e o clique se perde. */
const avisosVivos: Notification[] = [];
const MAX_AVISOS_VIVOS = 20;
function caminhoPreferencias() { return join(app.getPath("userData"), "preferencias.json"); }
function estadoPreferencias(): PreferenciasDesktop { return { avisos: preferencias.avisos, tema: preferencias.tema, bloqueados }; }
async function carregarPreferencias() {
  preferencias = lerPreferencias(await readFile(caminhoPreferencias(), "utf8").catch(() => null));
}
async function gravarPreferencias() {
  await mkdir(app.getPath("userData"), { recursive: true });
  const tmp = `${caminhoPreferencias()}.tmp`;
  await writeFile(tmp, JSON.stringify(preferencias), { mode: 0o600 });
  await rename(tmp, caminhoPreferencias());
}
// ---- Tema (definido em 2026-10-04, ADR-070) ------------------------------------------------------------
// O nativeTheme decide o prefers-color-scheme da página: com ele, o tema escolhido vale desde o primeiro quadro,
// mesmo com o localStorage apagado a cada conexão, e a janela já nasce com o fundo certo (sem piscar branco).
function aplicarTemaNativo() { nativeTheme.themeSource = preferencias.tema === "claro" ? "light" : preferencias.tema === "escuro" ? "dark" : "system"; }
/** Fundo da janela antes da página pintar: os valores de --surface em web/tokens.css. */
function fundoDaJanela() { return nativeTheme.shouldUseDarkColors ? "#131315" : "#ffffff"; }
async function definirTema(tema: TemaDesktop): Promise<PreferenciasDesktop> {
  preferencias = { ...preferencias, tema };
  aplicarTemaNativo();
  await gravarPreferencias();
  return estadoPreferencias();
}
/** Desligado, o Dock também apaga: o número é parte dos avisos. */
function aplicarContador() { app.setBadgeCount(preferencias.avisos ? contadorAtual : 0); }
async function definirAvisos(ligado: boolean): Promise<PreferenciasDesktop> {
  preferencias = { ...preferencias, avisos: ligado };
  montarMenu(); aplicarContador();
  await gravarPreferencias();
  return estadoPreferencias();
}
function montarMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ label: "nod", submenu: [{ label: "Conexão / verificar conta de IA", click: () => { void parar().then(mostrarSetup); } }, { type: "separator" }, { label: "Avisos no Mac", type: "checkbox", checked: preferencias.avisos, click: (item) => { void definirAvisos(item.checked); } }, { type: "separator" }, { role: "quit" }] }, { role: "editMenu" }, { role: "viewMenu" }]));
}
/** A janela aberta é a do nod web, na origem do servidor configurado (e não a tela de conexão). */
function janelaWeb(): BrowserWindow | null {
  const w = janela;
  const origem = origemDe(configuracao?.url);
  return w && !w.isDestroyed() && origem !== null && origemDe(w.webContents.getURL()) === origem ? w : null;
}
function avisar(aviso: AvisoDesktop): boolean {
  const w = janelaWeb();
  if (!preferencias.avisos || !w || w.isFocused() || !Notification.isSupported()) return false;
  const n = new Notification({ title: aviso.titulo, body: aviso.corpo, groupId: "nod-sua-vez" });
  const soltar = () => { const i = avisosVivos.indexOf(n); if (i >= 0) avisosVivos.splice(i, 1); };
  avisosVivos.push(n);
  if (avisosVivos.length > MAX_AVISOS_VIVOS) avisosVivos.shift();
  n.on("show", () => { bloqueados = false; });
  n.on("failed", () => { bloqueados = true; soltar(); });
  n.on("close", soltar);
  n.on("click", () => {
    soltar();
    const web = janelaWeb();
    if (!web) return;
    if (web.isMinimized()) web.restore();
    web.show(); web.focus();
    const alvo: AlvoAviso = aviso.alvo;
    web.webContents.send(CANAIS_DESKTOP.abrir, alvo);
  });
  n.show();
  return true;
}
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
    // ADR-053: o link do bot (target=_blank) também sai para o navegador padrão; a janela nunca abre no app.
    if (origem && (url.startsWith(`${origem}/`) || abreNoNavegador(url))) void shell.openExternal(url);
    return { action: "deny" };
  });
  w.webContents.on("will-navigate", (e, url) => {
    if ((!origem && url !== setupUrl) || (origem && new URL(url).origin !== origem)) e.preventDefault();
    if (origem && url.startsWith(`${origem}/api/sessao/google`)) { e.preventDefault(); void shell.openExternal(url); }
  });
  w.webContents.on("will-redirect", (e, url) => { if (!origem || new URL(url).origin !== origem) e.preventDefault(); });
  // definido em 2026-09-28 (ADR-051): o iframe do artefato (sandbox, CSP sem rede) ainda pode navegar A SI
  // MESMO — link, location, meta refresh —, a única saída que a CSP não fecha. No app, subframe nenhum sai
  // do documento que a página lhe deu (no navegador, a web fecha o iframe no segundo `load`).
  w.webContents.on("will-frame-navigate", (e) => { if (!e.isMainFrame && !/^about:(srcdoc|blank)$/.test(e.url)) e.preventDefault(); });
  // definido em 2026-10-04 (ADR-071, modo ligação): a única permissão da página é o microfone — `media` só de áudio, só na
  // origem do servidor, só no frame de topo desta janela (desktop/permissoes-midia.ts). A tela de conexão (sem origem) não
  // ganha nada. O macOS ainda pergunta antes (nod:microfone).
  w.webContents.session.setPermissionRequestHandler((wc, permission, callback, details) => {
    callback(!!origem && wc === w.webContents && permitirPedidoDeMidia({ permissao: permission, tiposDeMidia: "mediaTypes" in details ? details.mediaTypes : undefined, urlDoPedido: details.requestingUrl, frameDeTopo: details.isMainFrame, servidor: origem }));
  });
  w.webContents.session.setPermissionCheckHandler((wc, permission, requestingOrigin, details) => !!origem && wc === w.webContents && permitirChecagemDeMidia({ permissao: permission, tipoDeMidia: details.mediaType, origem: requestingOrigin, frameDeTopo: details.isMainFrame, servidor: origem }));
}

// ---- Modo ligação (definido em 2026-10-04, ADR-071) -----------------------------------------------------------------
// A página avisa que abriu uma ligação (nodDesktop.emLigacao): o app não é suspenso, a janela não é estrangulada em
// segundo plano (a voz continua com o nod atrás de outra janela) e fechar pergunta antes. Exceção à ADR-045 registrada na
// ADR-071: só com a ligação aberta pela pessoa.
let emLigacao = false;
let bloqueioDeSuspensao: number | null = null;
function definirEmLigacao(ativa: boolean) {
  emLigacao = ativa;
  const w = janelaWeb();
  if (ativa && bloqueioDeSuspensao === null) bloqueioDeSuspensao = powerSaveBlocker.start("prevent-app-suspension");
  if (!ativa && bloqueioDeSuspensao !== null) { powerSaveBlocker.stop(bloqueioDeSuspensao); bloqueioDeSuspensao = null; }
  w?.webContents.setBackgroundThrottling(!ativa);
}
/** O macOS pergunta pelo microfone uma vez; depois responde do que a pessoa escolheu (Ajustes do Sistema › Privacidade). */
async function acessoAoMicrofone(): Promise<EstadoMicrofone> {
  if (process.platform !== "darwin") return "concedido";
  const estado = estadoDoMicrofone(systemPreferences.getMediaAccessStatus("microphone"));
  if (estado) return estado;
  return (await systemPreferences.askForMediaAccess("microphone")) ? "concedido" : "negado";
}
/** Fechar com a ligação aberta: confirma; confirmado, a janela fecha e o servidor encerra pela queda da mídia. */
async function confirmarFecharEmLigacao(w: BrowserWindow): Promise<boolean> {
  const r = await dialog.showMessageBox(w, { type: "question", message: TEXTO_FECHAR_EM_LIGACAO.mensagem, detail: TEXTO_FECHAR_EM_LIGACAO.detalhe, buttons: [TEXTO_FECHAR_EM_LIGACAO.encerrar, TEXTO_FECHAR_EM_LIGACAO.continuar], defaultId: 1, cancelId: 1 });
  return r.response === 0;
}
async function mostrarSetup() {
  const anterior = janela;
  // Sem a janela web, o número do Dock ficaria parado no último valor.
  contadorAtual = 0; aplicarContador();
  const nova = new BrowserWindow({ width: 580, height: 850, minWidth: 500, title: "Conectar ao nod", backgroundColor: fundoDaJanela(), webPreferences: { preload: join(dir, "preload.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  janela = nova; proteger(nova);
  nova.on("closed", () => { if (janela === nova) janela = null; });
  await nova.loadFile(setup);
  anterior?.close();
}
async function parar() {
  if (itensGithub) clearInterval(itensGithub);
  itensGithub = null;
  const anterior = laco; laco = null;
  cliente?.cancelar();
  if (anterior) await anterior.parar().catch(() => undefined);
  for (const r of Object.values(registry ?? {})) if (r?.estado === "pronto") await r.instance.dispose();
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
  // ADR-052: o hook do nod vai empacotado ao lado do proxy; sem ele o kit do terminal não liga.
  const lig = { urlNod: c.url, proxyPath: app.isPackaged ? join(process.resourcesPath, "app.asar.unpacked", "dist", "desktop", "proxy.mjs") : join(dir, "proxy.mjs"), hookPath: app.isPackaged ? join(process.resourcesPath, "app.asar.unpacked", "dist", "desktop", "hook-nativas.mjs") : join(dir, "hook-nativas.mjs"), nodePath: process.execPath, electronComoNode: true, sondaSemTurno: true };
  const criado = await criarRegistryDetalhado({ ...process.env, NOD_HOME: join(app.getPath("userData"), "executor") }, [criarClaudeCliDriver(lig), criarCodexCliDriver(lig)]);
  registry = criado.registry;
  const inv = Object.values(criado.inventarios).find((i) => i?.estado === "pronto") ?? criado.inventarios["claude-cli"] ?? { estado: "ausente" as const, motivo: "Conecte sua conta de IA", em: Date.now() };
  cliente = criarPonteHttp({ url: c.url, chave: c.chave, versao: app.getVersion(), aoFalhar: falha });
  // ADR-048: o gh já logado neste Mac vira o jeito de conectar o GitHub da pessoa, sem ela configurar nada.
  const gh = await criarDetectorGh({ ambiente: process.env }).logado();
  await cliente.ponte.conectar({ machineId: dados.machineId, nome: hostname(), inventario: inv, versaoContrato: 1, harnesses: criado.inventarios, github: { gh }, ligacao: true });
  if (gh) vigiarItensGithub(cliente);
  if (inv.estado !== "pronto") {
    mensagem = inv.estado === "nao_autenticado" ? "Entre na sua conta do Claude Code ou Codex e conecte novamente." : "Instale o Claude Code ou Codex neste Mac e conecte novamente.";
    throw new Error("harness_indisponivel");
  }
  const reg = registry;
  // A lista de tarefas do bot (definido em 2026-09-28) vai como trecho vivo, como o nome das ferramentas.
  const tarefasVivas = criarAcompanhanteDeTarefas((turnoId, tarefas) => cliente?.tarefas(turnoId, tarefas));
  laco = iniciarPoolDeLacos((ponte) => iniciarLaco({ ponte, registry: reg, pessoaId: dados.escopo.pessoaId, machineId: dados.machineId, relogio: () => Date.now(), renovacaoMs: 1_000, esperaVaziaMs: 1000, aoDelta: (p, t) => cliente?.delta(p.turnoId, t), aoEvento: (p, ev) => { if (ev.tipo === "tool_use") cliente?.ferramenta(p.turnoId, ev.nome); tarefasVivas.evento(p.turnoId, ev); }, aoTerminarTurno: (p) => tarefasVivas.esquecer(p.turnoId) }), cliente.ponte);
  const anterior = janela;
  // definido em 2026-09-24 ("aviso no Mac"): preload próprio da janela web — só `nodDesktop` (preload-web.ts).
  const nova = new BrowserWindow({ width: 1280, height: 860, minWidth: 900, title: "nod", backgroundColor: fundoDaJanela(), webPreferences: { partition: "nod-web", preload: join(dir, "preload-web.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  janela = nova; proteger(nova, c.url);
  nova.on("close", (e) => {
    if (!emLigacao) return;
    e.preventDefault();
    void confirmarFecharEmLigacao(nova).then((sim) => { if (sim) { definirEmLigacao(false); nova.close(); } });
  });
  nova.on("closed", () => { if (janela === nova) { janela = null; definirEmLigacao(false); } });
  nova.webContents.on("did-fail-load", (_e, code, _description, _url, main) => { if (main && code !== -3) { mensagem = mensagens.servidor_fora!; void mostrarSetup(); } });
  await nova.loadURL(c.url);
  anterior?.close(); mensagem = "Conectado.";
}
function validarRemetente(event: IpcMainInvokeEvent) {
  if (event.senderFrame?.url !== setupUrl || event.sender !== janela?.webContents) throw new Error("origem_invalida");
}
/** A janela web: a principal, frame de topo, na origem do servidor configurado. */
function validarRemetenteWeb(event: IpcMainInvokeEvent) {
  const frame = event.senderFrame;
  if (event.sender !== janela?.webContents || !remetenteWebValido({ frameUrl: frame?.url, frameDeTopo: !!frame && frame.parent === null, servidor: configuracao?.url })) throw new Error("origem_invalida");
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => { janela?.show(); janela?.focus(); });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", (event) => {
    if (encerrando) return;
    event.preventDefault();
    // Cmd+Q com a ligação aberta pergunta como o fechar da janela; "Continuar" cancela a saída.
    const w = janelaWeb();
    if (emLigacao && w) {
      void confirmarFecharEmLigacao(w).then((sim) => { if (sim) { definirEmLigacao(false); app.quit(); } });
      return;
    }
    encerrando = true;
    void parar().finally(() => app.quit());
  });
  void app.whenReady().then(async () => {
    await carregarPreferencias();
    aplicarTemaNativo();
    montarMenu();
    ipcMain.handle(CANAIS_DESKTOP.avisar, (e, dados: unknown) => {
      validarRemetenteWeb(e);
      const aviso = lerAviso(dados);
      return aviso ? avisar(aviso) : false;
    });
    ipcMain.handle(CANAIS_DESKTOP.contador, (e, n: unknown) => {
      validarRemetenteWeb(e);
      const lido = lerContador(n);
      if (lido !== null) { contadorAtual = lido; aplicarContador(); }
    });
    ipcMain.handle(CANAIS_DESKTOP.preferencias, (e) => { validarRemetenteWeb(e); return estadoPreferencias(); });
    ipcMain.handle(CANAIS_DESKTOP.definirAvisos, (e, ligado: unknown) => {
      validarRemetenteWeb(e);
      if (typeof ligado !== "boolean") throw new Error("entrada_invalida");
      return definirAvisos(ligado);
    });
    ipcMain.handle(CANAIS_DESKTOP.definirTema, (e, tema: unknown) => {
      validarRemetenteWeb(e);
      const lido = lerTemaDesktop(tema);
      if (!lido) throw new Error("entrada_invalida");
      return definirTema(lido);
    });
    ipcMain.handle(CANAIS_DESKTOP.microfone, (e) => { validarRemetenteWeb(e); return acessoAoMicrofone(); });
    ipcMain.handle(CANAIS_DESKTOP.emLigacao, (e, ativa: unknown) => {
      validarRemetenteWeb(e);
      const lido = lerEmLigacao(ativa);
      if (lido === null) throw new Error("entrada_invalida");
      definirEmLigacao(lido);
    });
    ipcMain.handle("nod:estado", (e) => { validarRemetente(e); return { url: configuracao?.url ?? SERVIDOR_PADRAO, mensagem }; });
    // ADR-069: entrar pelo navegador e voltar com a chave, sem copiar nada. A invocação dura até a pessoa confirmar (ou o prazo vencer).
    ipcMain.handle("nod:parear", async (e, valor: unknown) => {
      validarRemetente(e);
      if (conectando) return { mensagem: "Conexão em andamento…" };
      conectando = true;
      try {
        const url = urlServidor(valor, !app.isPackaged);
        const chave = await parearPeloNavegador({ servidor: url, nome: hostname(), abrir: (u) => shell.openExternal(u) });
        await conectar({ url, chave });
      } catch (erro) {
        if (erro instanceof FalhaPareamento) mensagem = mensagens[erro.codigo] ?? mensagens.servidor_fora!;
        else if (erro instanceof FalhaPonte) mensagem = mensagens[erro.codigo]!;
        else if (!mensagem || mensagem === "Conectado.") mensagem = "Não foi possível conectar. Confira o endereço e sua conta de IA.";
      } finally { conectando = false; }
      return { mensagem };
    });
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
      } catch (erro) { if (erro instanceof FalhaPonte) mensagem = mensagens[erro.codigo]!; else if (!mensagem) mensagem = "Não foi possível conectar. Confira sua conta de IA e o acesso ao Keychain."; }
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
