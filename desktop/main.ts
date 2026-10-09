import { criarCodexCliDriver } from "../src/adapters/executor/drivers/codex-cli.ts";
import { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, Notification, powerSaveBlocker, safeStorage, screen, session, shell, systemPreferences, type IpcMainInvokeEvent } from "electron";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { homedir, hostname, tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { criarClaudeCliDriver } from "../src/adapters/executor/drivers/claude-cli.ts";
import { driverDoPlano, iniciarLaco } from "../src/adapters/executor/laco.ts";
import { executarColetando } from "../src/adapters/executor/processo.ts";
import { criarAcompanhanteDeTarefas } from "../src/adapters/executor/acompanhar-tarefas.ts";
import { iniciarPoolDeLacos, type PoolDeLacos } from "../src/adapters/executor/pool-lacos.ts";
import { criarAmostradorMemoria } from "../src/adapters/executor/amostrador-memoria.ts";
import { criarExecutarComando, iniciarLimpezaDasTasks, modoDaLimpeza, type LimpezaDasTasks } from "../src/adapters/executor/limpeza-das-tasks.ts";
import type { PlanoTurno } from "../src/contracts/plano-turno.ts";
import { configDosDrivers, criarRegistryDetalhado } from "../src/adapters/executor/registry.ts";
import { resolverBinario } from "../src/adapters/executor/caminho.ts";
import { prazoSondaDoEnv } from "../src/adapters/executor/sonda.ts";
import type { ConfigDriver, Driver } from "../src/adapters/executor/spi.ts";
import { criarPonteHttp, FalhaPonte, urlServidor } from "../src/adapters/executor/ponte-http.ts";
import type { Registry } from "../src/adapters/executor/spi.ts";
import { versaoAceita } from "../src/domain/versao-app.ts";
import { CANAIS_DESKTOP, type AlvoAviso, type AvisoDesktop, type IaDesktop, type PreferenciasDesktop, type ResultadoIaDesktop, type TemaDesktop, type TesteDeIa } from "../src/contracts/desktop.ts";
import { ambienteDoLogin, comandoDeEstadoDoLogin, comandoDeLogin, lerIaDesktop, textoDaImpressao, URL_INSTALAR_IA } from "./ia-mac.ts";
import { criarVigiaDasIas, type Veredito, type VigiaDasIas } from "./vigia-ias.ts";
import { lerAviso, lerContador, lerPreferencias, lerTemaDesktop, opcoesDoAviso, origemDe, remetenteWebValido } from "./avisos-mac.ts";
import { abreNoNavegador } from "./links-externos.ts";
import { focarJanela, LARGURA_MINIMA, lerEstadoJanela, medirEstadoJanela, resolverEstadoJanela, type EstadoJanela } from "./janela.ts";
import { estadoDoMicrofone, lerEmLigacao, permitirChecagemDeMidia, permitirPedidoDeMidia, TEXTO_FECHAR_EM_LIGACAO } from "./permissoes-midia.ts";
import type { EstadoMicrofone } from "../src/contracts/desktop.ts";
import { criarDetectorGh, executarGithubNaMaquina } from "../src/adapters/conectores-locais/github/maquina.ts";
import { FalhaPareamento, parearPeloNavegador } from "./parear.ts";
import { IDIOMA_DO_APP, templateDoMenu } from "./menu.ts";
import { criarArquivoDeLog, escreverDiagnostico, instalarOuvintesDeQueda, lerCaudaDoLog, MAX_BYTES_LOG } from "./diagnostico.ts";
import { montarDiagnostico, nomeArquivoDiagnostico, TETO_REGISTROS_BYTES, type EntradaDiagnostico } from "../src/domain/diagnostico-app.ts";
import { definirDestinoDoLog, log } from "../src/obs/log.ts";
import type { Inventario } from "../src/contracts/inventario.ts";
import type { IdDriver } from "../src/adapters/executor/spi.ts";

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
/**
 * definido em 2026-10-07 (ADR-083 §4, #194): UM amostrador de memória para o Mac inteiro (pressão do macOS e memória
 * por grupo de processos), compartilhado por todos os laços do pool; cada renovação leva a última leitura.
 * `NOD_SIMULAR_PRESSAO=1|2|4` no ambiente do app força o nível (UAT). O timer não segura o app aberto.
 */
const memoriaDoMac = criarAmostradorMemoria({ env: process.env });
let registry: Registry | null = null;
let cliente: ReturnType<typeof criarPonteHttp> | null = null;
let mensagem = "";
let conectando = false;
let encerrando = false;
let falhando = false;
let itensGithub: ReturnType<typeof setInterval> | null = null;
/** ADR-088 (2026-10-09): a limpeza das pastas de task encerradas neste Mac (o servidor diz quais; o Mac apaga). */
let limpezaDasTasks: LimpezaDasTasks | null = null;
/** Revisão do #225: os turnos rodando neste Mac — a limpeza não mexe na pasta de nenhum deles. */
const planosNoMac = new Map<string, PlanoTurno>();
/**
 * A vigia das IAs da conexão atual (vigia-ias.ts; revisto em 2026-10-05): sem IA pronta ela olha de novo a cada 3 s
 * (ADR-077), guarda o veredito do teste de verdade e reanuncia o inventário ao servidor quando ele muda.
 */
let vigiaIas: VigiaDasIas | null = null;
/** A config dos drivers da conexão atual (ambiente limpo + PATH aumentado): a sonda e o login da IA a reaproveitam. */
let cfgExecutor: ConfigDriver | null = null;
/** O que o diagnóstico (NOD-138) conta da conexão atual; `parar()` zera. */
let inventariosAtuais: Partial<Record<IdDriver, Inventario>> | null = null;
let maquinaIdAtual: string | null = null;
let ghLogado: boolean | null = null;
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
let preferencias: Pick<PreferenciasDesktop, "avisos" | "tema" | "som"> = { avisos: true, tema: "sistema", som: true };
/** O último aviso falhou ao aparecer (o macOS bloqueou); o próximo que aparecer desfaz. */
let bloqueados = false;
let contadorAtual = 0;
/** Referência viva de cada aviso: sem ela o coletor leva o objeto e o clique se perde. */
const avisosVivos: Notification[] = [];
const MAX_AVISOS_VIVOS = 20;
function caminhoPreferencias() { return join(app.getPath("userData"), "preferencias.json"); }
function estadoPreferencias(): PreferenciasDesktop { return { avisos: preferencias.avisos, tema: preferencias.tema, som: preferencias.som, bloqueados }; }
async function carregarPreferencias() {
  preferencias = lerPreferencias(await readFile(caminhoPreferencias(), "utf8").catch(() => null));
}
async function gravarPreferencias() {
  await mkdir(app.getPath("userData"), { recursive: true });
  const tmp = `${caminhoPreferencias()}.tmp`;
  await writeFile(tmp, JSON.stringify(preferencias), { mode: 0o600 });
  await rename(tmp, caminhoPreferencias());
}
// ---- Estado da janela web (definido em 2026-10-05, NOD-137) ---------------------------------------------------------
// Posição, tamanho e maximizada em userData/janela.json, lidos uma vez no boot e mantidos em memória: a reconexão recria a
// janela no mesmo lugar sem reler o disco. Minimizada não grava; tela cheia grava o último estado como janela normal. As
// escritas entram numa fila (sem corrida no rename) e o before-quit espera a última; escrita cortada deixa só o .tmp, e o
// janela.json anterior fica intacto.
let estadoJanela: EstadoJanela | null = null;
let gravacaoJanela: Promise<void> = Promise.resolve();
const ESPERA_ESTADO_JANELA_MS = 250;
const TAMANHO_PADRAO_JANELA = { largura: 1280, altura: 860 };
function caminhoEstadoJanela() { return join(app.getPath("userData"), "janela.json"); }
async function carregarEstadoJanela() {
  estadoJanela = lerEstadoJanela(await readFile(caminhoEstadoJanela(), "utf8").catch(() => null));
}
async function gravarEstadoJanela(estado: EstadoJanela) {
  await mkdir(app.getPath("userData"), { recursive: true });
  const tmp = `${caminhoEstadoJanela()}.tmp`;
  await writeFile(tmp, JSON.stringify(estado), { mode: 0o600 });
  await rename(tmp, caminhoEstadoJanela());
}
function telas() { return { principal: screen.getPrimaryDisplay().workArea, todas: screen.getAllDisplays().map((d) => d.workArea) }; }
/** Síncrono: mede a janela agora (medirEstadoJanela) e enfileira a escrita. */
function capturarEstadoJanela(w: BrowserWindow) {
  const estado = medirEstadoJanela(w, estadoJanela);
  if (!estado) return;
  estadoJanela = estado;
  gravacaoJanela = gravacaoJanela.then(() => gravarEstadoJanela(estado)).catch(() => undefined);
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
/** Som dos avisos (NOD-196): só muda o `silent` do próximo aviso; com os avisos desligados, a escolha fica guardada. */
async function definirSom(ligado: boolean): Promise<PreferenciasDesktop> {
  preferencias = { ...preferencias, som: ligado };
  await gravarPreferencias();
  return estadoPreferencias();
}
function montarMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate(templateDoMenu({ avisos: preferencias.avisos, empacotado: app.isPackaged }, { conexao: () => { void parar().then(mostrarSetup); }, definirAvisos: (ligado) => { void definirAvisos(ligado); }, exportarDiagnostico: () => { void exportarDiagnostico(); } })));
}
// ---- Diagnóstico para suporte (definido em 2026-10-05, NOD-138) -------------------------------------------------------
// Só pelo menu nativo: funciona na tela de conexão e com a janela web fora do ar, e não aumenta a ponte da página. O texto
// sai de montarDiagnostico (redigido, ~ no lugar da pasta pessoal) e fica só neste Mac: nada sobe ao servidor.
const AVISO_DIAGNOSTICO = "O arquivo traz a versão do app, o estado da conexão e da IA e os registros recentes deste Mac. Não traz chaves, senhas nem o texto das suas conversas.";
const FALHA_DIAGNOSTICO = "Não foi possível salvar o diagnóstico. Escolha outra pasta e tente de novo.";
function entradaDiagnostico(): EntradaDiagnostico {
  const conectado = cliente !== null;
  return {
    app: { versao: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, plataforma: process.platform, arquitetura: process.arch, versaoSistema: process.getSystemVersion(), empacotado: app.isPackaged, ligadoHaSegundos: process.uptime() },
    conexao: { servidor: configuracao?.url ?? null, conectado, maquinaId: maquinaIdAtual, status: mensagem },
    ia: inventariosAtuais ? Object.entries(inventariosAtuais).map(([harness, i]) => ({ harness, estado: i?.estado ?? "desconhecido", motivo: i && "motivo" in i ? i.motivo : null, versao: i && "versao" in i ? i.versao ?? null : null })) : null,
    execucao: { conectado, lacoAtivo: laco !== null, sondandoIa: vigiaIas !== null && laco === null, emLigacao, githubNoMac: ghLogado },
    preferencias: { avisos: preferencias.avisos, tema: preferencias.tema, som: preferencias.som, avisosBloqueados: bloqueados },
    registros: lerCaudaDoLog(app.getPath("logs"), TETO_REGISTROS_BYTES),
  };
}
async function exportarDiagnostico() {
  const agora = Date.now();
  const opcoes = { title: "Exportar diagnóstico", message: AVISO_DIAGNOSTICO, defaultPath: join(app.getPath("downloads"), nomeArquivoDiagnostico(agora, -new Date(agora).getTimezoneOffset())), filters: [{ name: "Texto", extensions: ["txt"] }] };
  const w = janela && !janela.isDestroyed() ? janela : null;
  const r = w ? await dialog.showSaveDialog(w, opcoes) : await dialog.showSaveDialog(opcoes);
  if (r.canceled || !r.filePath) return;
  try {
    escreverDiagnostico(r.filePath, montarDiagnostico(entradaDiagnostico(), agora));
    log("info", "diagnostico_exportado");
    shell.showItemInFolder(r.filePath);
  } catch {
    log("aviso", "diagnostico_nao_salvo");
    const erro = { type: "warning" as const, message: FALHA_DIAGNOSTICO };
    void (w ? dialog.showMessageBox(w, erro) : dialog.showMessageBox(erro));
  }
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
  const n = new Notification(opcoesDoAviso(aviso, { som: preferencias.som }));
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
    focarJanela(web);
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
  limpezaDasTasks?.parar();
  limpezaDasTasks = null;
  vigiaIas?.parar();
  vigiaIas = null;
  const anterior = laco; laco = null;
  cliente?.cancelar();
  if (anterior) await anterior.parar().catch(() => undefined);
  for (const r of Object.values(registry ?? {})) if (r?.estado === "pronto") await r.instance.dispose();
  if (cliente) await cliente.ponte.desconectar("").catch(() => undefined);
  registry = null; cliente = null;
  inventariosAtuais = null; maquinaIdAtual = null; ghLogado = null;
}
/** definido em 2026-10-05: entre dois reanúncios depois de um 409 (o laço puxa a cada segundo e cada um falharia igual). */
const ESPERA_REANUNCIO_MS = 10_000;
let ultimoReanuncio = 0;
function falha(codigo: FalhaPonte["codigo"]) {
  mensagem = mensagens[codigo] ?? mensagens.servidor_fora!;
  // medido em produção em 2026-10-05: o servidor reiniciou num deploy, esqueceu a máquina e respondeu 409 a todo
  // `puxar`; o app só trocava a mensagem e a fila da pessoa ficou parada até ela reabrir o app. Agora se reanuncia.
  if (codigo === "reconectar" && vigiaIas && Date.now() - ultimoReanuncio >= ESPERA_REANUNCIO_MS) {
    ultimoReanuncio = Date.now();
    void vigiaIas.reanunciar().then(() => { if (mensagem === mensagens.reconectar) mensagem = "Conectado."; }).catch(() => undefined);
  }
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
  const lig = { urlNod: c.url, proxyPath: app.isPackaged ? join(process.resourcesPath, "app.asar.unpacked", "dist", "desktop", "proxy.mjs") : join(dir, "proxy.mjs"), hookPath: app.isPackaged ? join(process.resourcesPath, "app.asar.unpacked", "dist", "desktop", "hook-nativas.mjs") : join(dir, "hook-nativas.mjs"), nodePath: process.execPath, electronComoNode: true, sondaSemTurno: true, prazoSondaMs: prazoSondaDoEnv(process.env) };
  const envExecutor = { ...process.env, NOD_HOME: join(app.getPath("userData"), "executor") };
  const drivers: Driver[] = [criarClaudeCliDriver(lig), criarCodexCliDriver(lig)];
  const cfg = await configDosDrivers(envExecutor);
  cfgExecutor = cfg;
  const criado = await criarRegistryDetalhado(envExecutor, drivers, { cfg });
  // Um objeto só, atualizado no lugar a cada sondagem: o laço lê `registry[driver]` a cada turno, então uma IA que
  // fica pronta depois (ou um driver recriado) passa a valer sem reiniciar o laço.
  const registryDoLaco: Registry = criado.registry;
  registry = registryDoLaco;
  inventariosAtuais = criado.inventarios; maquinaIdAtual = dados.machineId;
  const ponteHttp = criarPonteHttp({ url: c.url, chave: c.chave, versao: app.getVersion(), aoFalhar: falha });
  cliente = ponteHttp;
  // ADR-048: o gh já logado neste Mac vira o jeito de conectar o GitHub da pessoa, sem ela configurar nada.
  const gh = await criarDetectorGh({ ambiente: process.env }).logado();
  if (cliente === ponteHttp) ghLogado = gh; // um parar() durante o await já zerou: não ressuscita o valor velho
  const anuncio = { machineId: dados.machineId, nome: hostname(), versaoContrato: 1, github: { gh }, ligacao: true } as const;
  if (gh) vigiarItensGithub(ponteHttp);
  if (cliente === ponteHttp) {
    // ADR-088: o PATH do shell de login (o mesmo dos drivers) — as ferramentas de onde a pessoa as instalou.
    limpezaDasTasks?.parar();
    const homeDoMac = cfg.env.HOME ?? homedir();
    const modo = modoDaLimpeza(process.env);
    log("info", "limpeza_modo", { modo, onde: "app_do_mac" });
    limpezaDasTasks = modo === "desligada" ? null : iniciarLimpezaDasTasks({ ponte: ponteHttp.ponte, pessoaId: dados.escopo.pessoaId, home: homeDoMac, executar: criarExecutarComando(cfg.env, homeDoMac), simular: modo === "simular", emUso: (pasta) => [...planosNoMac.values()].some((p) => p.pastaDoBot === pasta || p.pastaDoBot?.startsWith(`${pasta}/`) === true) });
  }
  // A lista de tarefas do bot (definido em 2026-09-28) vai como trecho vivo, como o nome das ferramentas.
  const subirLaco = (reg: Registry) => {
    const tarefasVivas = criarAcompanhanteDeTarefas((turnoId, tarefas) => cliente?.tarefas(turnoId, tarefas));
    laco = iniciarPoolDeLacos((ponte) => iniciarLaco({ ponte, registry: reg, pessoaId: dados.escopo.pessoaId, machineId: dados.machineId, relogio: () => Date.now(), renovacaoMs: 1_000, esperaVaziaMs: 1000, memoria: memoriaDoMac, aoDelta: (p, t) => cliente?.delta(p.turnoId, t), aoEvento: (p, ev) => { if (ev.tipo === "tool_use") cliente?.ferramenta(p.turnoId, ev.nome); tarefasVivas.evento(p.turnoId, ev); }, aoIniciarTurno: (p) => { planosNoMac.set(p.turnoId, p); }, aoTerminarTurno: (p) => { tarefasVivas.esquecer(p.turnoId); planosNoMac.delete(p.turnoId); },
      // NOD-73: o vigia do turno só avisa — o aviso vai como trecho vivo, só nome e números (os argumentos ficam no Mac).
      aoVigia: (p, aviso) => cliente?.vigia(p.turnoId, aviso),
      // definido em 2026-10-05: o turno disse que a conta desta IA não serve — o veredito fica guardado e o Mac reanuncia.
      aoResultado: (p, r) => { const ia = lerIaDesktop(driverDoPlano(p)); if (ia && r.causaSemIa) void vigia.reprovar(ia, r.causaSemIa).catch(() => undefined); } }), ponteHttp.ponte);
  };
  // definido em 2026-10-04 (ADR-077) e revisto em 2026-10-05: sem IA pronta a janela abre do mesmo jeito — a web mostra
  // os cards de IA — e a vigia olha de novo a cada 3 s, com um registry novo a cada volta (os drivers recriados não
  // guardam o cache de 5 min da sonda do Codex). O que vai ao servidor é a conferência de login JÁ com o veredito do
  // teste de verdade aplicado: IA logada e reprovada é anunciada como fora, com a causa.
  let lacoNoAr = false;
  const arquivoVereditos = join(app.getPath("userData"), "ias-testadas.json");
  const vigia = criarVigiaDasIas({
    sondar: () => criarRegistryDetalhado(envExecutor, drivers, { cfg }),
    impressao: (ia) => impressaoDoLogin(ia, cfg),
    anunciar: async (inventarios, principal, semLacoDeVoz, capacidades) => { if (cliente !== ponteHttp) return; inventariosAtuais = inventarios; await ponteHttp.ponte.conectar({ ...anuncio, inventario: principal, harnesses: inventarios, semLacoDeVoz, capacidades }); },
    aoRegistry: (novo, algumaPronta) => {
      if (cliente !== ponteHttp) return;
      Object.assign(registryDoLaco, novo);
      if (algumaPronta && !lacoNoAr) { lacoNoAr = true; subirLaco(registryDoLaco); }
    },
    ler: async () => JSON.parse(await readFile(arquivoVereditos, "utf8")) as unknown,
    gravar: (vereditos: Veredito[]) => writeFile(arquivoVereditos, `${JSON.stringify(vereditos)}\n`, { mode: 0o600 }),
    agora: Date.now,
    agendar: (fn, ms) => { const t = setTimeout(fn, ms); return { cancelar: () => clearTimeout(t) }; },
  });
  vigiaIas = vigia;
  await vigia.iniciar(criado);
  const anterior = janela;
  // definido em 2026-09-24 ("aviso no Mac"): preload próprio da janela web — só `nodDesktop` (preload-web.ts).
  // NOD-137: nasce onde a pessoa deixou, inteira numa tela que existe; o mínimo de 900 cede numa tela mais estreita.
  const bounds = resolverEstadoJanela(estadoJanela, telas(), TAMANHO_PADRAO_JANELA);
  // Os bounds normais da janela maximizada vêm da memória (medirEstadoJanela): valem os da criação, já ajustados à tela.
  estadoJanela = bounds;
  const nova = new BrowserWindow({ x: bounds.x, y: bounds.y, width: bounds.largura, height: bounds.altura, minWidth: Math.min(LARGURA_MINIMA, bounds.largura), title: "nod", backgroundColor: fundoDaJanela(), webPreferences: { partition: "nod-web", preload: join(dir, "preload-web.cjs"), nodeIntegration: false, contextIsolation: true, sandbox: true } });
  if (bounds.maximizada) nova.maximize();
  janela = nova; proteger(nova, c.url);
  // A checagem de tela cheia é no disparo do timer; no Electron 43 isFullScreen() já é true desde o 1º resize da animação.
  let esperaEstado: ReturnType<typeof setTimeout> | null = null;
  const cancelarEstado = () => { if (esperaEstado) clearTimeout(esperaEstado); esperaEstado = null; };
  const agendarEstado = () => { cancelarEstado(); esperaEstado = setTimeout(() => { esperaEstado = null; capturarEstadoJanela(nova); }, ESPERA_ESTADO_JANELA_MS); };
  nova.on("move", agendarEstado);
  nova.on("resize", agendarEstado);
  nova.on("maximize", agendarEstado);
  nova.on("unmaximize", agendarEstado);
  nova.on("enter-full-screen", () => { cancelarEstado(); capturarEstadoJanela(nova); });
  nova.on("close", (e) => {
    cancelarEstado(); capturarEstadoJanela(nova);
    if (!emLigacao) return;
    e.preventDefault();
    void confirmarFecharEmLigacao(nova).then((sim) => { if (sim) { definirEmLigacao(false); nova.close(); } });
  });
  nova.on("closed", () => { cancelarEstado(); if (janela === nova) { janela = null; definirEmLigacao(false); } });
  nova.webContents.on("did-fail-load", (_e, code, _description, _url, main) => { if (main && code !== -3) { mensagem = mensagens.servidor_fora!; void mostrarSetup(); } });
  await nova.loadURL(c.url);
  anterior?.close(); mensagem = "Conectado.";
}
/**
 * "Entrar" num card de IA (ADR-077): o login do próprio CLI, sem shell, desanexado e com o ambiente limpo dos drivers
 * (ia-mac.ts). Ele abre o navegador; o nod nunca lê o token — a sonda de 3 s percebe quando ficou pronto.
 */
async function entrarNaIa(ia: IaDesktop): Promise<ResultadoIaDesktop> {
  const cfg = cfgExecutor ?? await configDosDrivers({ ...process.env, NOD_HOME: join(app.getPath("userData"), "executor") });
  const home = cfg.env.HOME ?? "";
  const { nome, args } = comandoDeLogin(ia);
  const bin = await resolverBinario(ia === "claude-cli" ? cfg.bin : cfg.bins?.["codex-cli"], cfg.env.PATH ?? "", home, nome);
  if (!bin) return { ok: false, motivo: "nao_instalado" };
  return new Promise((resolver) => {
    try {
      const filho = spawn(bin, args, { cwd: home || undefined, env: ambienteDoLogin(cfg.env), detached: true, stdio: "ignore", shell: false });
      filho.once("spawn", () => { filho.unref(); resolver({ ok: true }); });
      // definido em 2026-10-05: o login terminou bem — se esta IA estava reprovada, a conta nova é testada agora.
      filho.once("exit", (codigo) => { if (codigo === 0) void vigiaIas?.contaMudou(ia).catch(() => undefined); });
      filho.once("error", () => resolver({ ok: false, motivo: "falhou" }));
    } catch { resolver({ ok: false, motivo: "falhou" }); }
  });
}
/**
 * A impressão da conta logada numa IA (definido em 2026-10-05): o hash do que o CLI diz sobre o login. Fica só neste
 * Mac, junto do veredito do teste (vigia-ias.ts); null quando o CLI não responde.
 */
async function impressaoDoLogin(ia: IaDesktop, cfg: ConfigDriver): Promise<string | null> {
  const home = cfg.env.HOME ?? "";
  const { nome, args } = comandoDeEstadoDoLogin(ia);
  const bin = await resolverBinario(ia === "claude-cli" ? cfg.bin : cfg.bins?.["codex-cli"], cfg.env.PATH ?? "", home, nome);
  if (!bin) return null;
  const r = await executarColetando({ bin, args, env: ambienteDoLogin(cfg.env), cwd: home || tmpdir(), timeoutMs: 10_000 });
  return r.exitCode === 0 ? createHash("sha256").update(textoDaImpressao(ia, r.stdout, r.stderr)).digest("hex") : null;
}
function validarRemetente(event: IpcMainInvokeEvent) {
  if (event.senderFrame?.url !== setupUrl || event.sender !== janela?.webContents) throw new Error("origem_invalida");
}
/** A janela web: a principal, frame de topo, na origem do servidor configurado. */
function validarRemetenteWeb(event: IpcMainInvokeEvent) {
  const frame = event.senderFrame;
  if (event.sender !== janela?.webContents || !remetenteWebValido({ frameUrl: frame?.url, frameDeTopo: !!frame && frame.parent === null, servidor: configuracao?.url })) throw new Error("origem_invalida");
}
// NOD-174: menu de contexto, diálogos nativos e validação da página em pt-BR mesmo num Mac em inglês. Só vale antes do
// `ready`: depois disso o Chromium ignora a troca em silêncio.
app.commandLine.appendSwitch("lang", IDIOMA_DO_APP);
if (!app.requestSingleInstanceLock()) app.quit();
else {
  // NOD-137: abrir de novo (segunda cópia, Dock) traz a janela atual, inclusive minimizada. Sem janela (boot ou troca em
  // curso), o activate não faz nada: fechar a última janela sai do app (window-all-closed).
  app.on("second-instance", () => focarJanela(janela));
  app.on("activate", () => focarJanela(janela));
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
    // Cmd+Q: as janelas só fecham depois deste evento, então o estado é capturado aqui e a gravação entra na espera.
    if (w) capturarEstadoJanela(w);
    void Promise.all([parar(), gravacaoJanela]).finally(() => app.quit());
  });
  void app.whenReady().then(async () => {
    // NOD-138: o log() do app passa a gravar em ~/Library/Logs/nod antes de qualquer outra coisa, e as quedas viram linha.
    definirDestinoDoLog(criarArquivoDeLog({ dir: app.getPath("logs"), maxBytes: MAX_BYTES_LOG }));
    instalarOuvintesDeQueda({ app, processo: process, registrar: (campos) => log("erro", "app_processo_caiu", campos), encerrando: () => encerrando, ehJanelaPrincipal: (conteudo) => !!janela && !janela.isDestroyed() && conteudo === janela.webContents });
    log("info", "app_iniciado", { versao: app.getVersion(), empacotado: app.isPackaged, arquitetura: process.arch });
    await carregarPreferencias();
    await carregarEstadoJanela();
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
    ipcMain.handle(CANAIS_DESKTOP.definirSom, (e, ligado: unknown) => {
      validarRemetenteWeb(e);
      if (typeof ligado !== "boolean") throw new Error("entrada_invalida");
      return definirSom(ligado);
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
    ipcMain.handle(CANAIS_DESKTOP.iaEntrar, (e, ia: unknown) => {
      validarRemetenteWeb(e);
      const lida = lerIaDesktop(ia);
      if (!lida) throw new Error("entrada_invalida");
      return entrarNaIa(lida);
    });
    ipcMain.handle(CANAIS_DESKTOP.iaInstalar, async (e, ia: unknown): Promise<ResultadoIaDesktop> => {
      validarRemetenteWeb(e);
      const lida = lerIaDesktop(ia);
      if (!lida) throw new Error("entrada_invalida");
      try { await shell.openExternal(URL_INSTALAR_IA[lida]); return { ok: true }; } catch { return { ok: false, motivo: "falhou" }; }
    });
    // definido em 2026-10-05: o teste de verdade das IAs. O pedido vem de uma página remota: a vigia só aceita os ids
    // conhecidos e um nome com forma de nome (src/domain/conta-da-ia.ts). Sem conexão não há o que testar.
    ipcMain.handle(CANAIS_DESKTOP.iaTestar, (e, pedido: unknown): Promise<TesteDeIa[]> => {
      validarRemetenteWeb(e);
      return vigiaIas ? vigiaIas.testar(pedido) : Promise.resolve([]);
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
