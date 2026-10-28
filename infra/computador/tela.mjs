// definido em 2026-10-22 (NOD-96 PR 2, ADR-122 §1): a tela de um bot no computador da pessoa. Um processo por tela,
// filho do supervisor (fork, IPC): Xvfb :1NN + openbox + Chromium (launchPersistentContext num fork do perfil-base, sem
// Cookies), cada um dentro do bwrap (isolamento.mjs), CDP por pipe. Nasce do runtime.mjs do modo docker: as ações são as
// mesmas. Os cookies não ficam no perfil: depois de cada ação a tela manda o diff ao supervisor (loja única) e aplica o
// que ele repassa das outras telas.
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';
import { access, chmod, cp, mkdir, readFile, readdir, realpath, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { URL, pathToFileURL } from 'node:url';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { setTimeout as esperar } from 'node:timers/promises';
import { lerTexto, gravarTexto } from './texto.mjs';
import { codigoDaAcao, falhaDe, primeiraLinha, PRAZO_NAVEGADOR_MS, TRAVAS_DO_PERFIL } from './falhas.mjs';
import { argsDoBwrap, scriptDoBwrap } from './isolamento.mjs';
import { chaveDoCookie, diffDeCookies } from './loja-cookies.mjs';
import { coletarNaPagina, comPrazo, hashDosDados, origemDe, origemTemLogin, PRAZO_COLETA_MS, restaurarOrigem, ritmoDeColeta, TETO_STORAGE_BYTES } from './login-storage.mjs';
import { importarNoPerfil } from './login-senhas.mjs';

const exec = promisify(execFile);

/** Arquivos do SQLite de cookies que o fork do perfil-base não leva: os cookies vêm da loja. */
export const COOKIES_DO_PERFIL = ['Default/Cookies', 'Default/Cookies-journal', 'Default/Network/Cookies', 'Default/Network/Cookies-journal'];

/** Esquemas que a tela navega. file:, chrome: e afins ficam de fora: o disco da máquina não é do bot. */
export function urlPermitida(url) {
  if (url === 'about:blank') return true;
  try {
    return ['http:', 'https:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/**
 * Ganchos da tela (ADR-122; a NOD-97 pendura senhas e storage aqui). Cada lista roda em ordem; um gancho que lança em
 * `antesDeNavegar` recusa a navegação.
 */
export const ganchos = {
  antesDeAbrirChrome: [],
  depoisDaAcao: [],
  aoFecharChrome: [],
  antesDeNavegar: [
    (url) => {
      if (!urlPermitida(url)) throw new Error('url_recusada');
    },
  ],
};
const rodar = async (lista, ...args) => {
  for (const g of lista) await g(...args);
};

/** Faz o perfil do bot a partir do perfil-base (cp --reflink=auto), sem os cookies. Perfil que já existe fica. */
export async function forkDoPerfil(perfilBase, perfil) {
  const existe = await access(perfil).then(() => true, () => false);
  if (!existe) {
    await mkdir(path.dirname(perfil), { recursive: true, mode: 0o700 });
    const temBase = await access(perfilBase).then(() => true, () => false);
    if (temBase) await exec('cp', ['-a', '--reflink=auto', `${perfilBase}/.`, perfil]).catch(async () => cp(perfilBase, perfil, { recursive: true }));
    else await mkdir(perfil, { recursive: true, mode: 0o700 });
  }
  for (const c of COOKIES_DO_PERFIL) await rm(path.join(perfil, c), { force: true });
  for (const nome of TRAVAS_DO_PERFIL) await unlink(path.join(perfil, nome)).catch(() => {});
  await perfilSaiuLimpo(perfil);
}

/** NOD-97 PR 6: o storage de site que o Chrome guarda no perfil (o que o Sair de todos apaga, além dos cookies). */
export const STORAGE_DO_PERFIL = ['Default/Local Storage', 'Default/Session Storage', 'Default/IndexedDB', 'nod-storage.json', 'nod-origens.json'];
const ARQUIVO_DA_GERACAO = 'nod-storage-geracao';
/** As origens que as abas deste perfil já abriram (o que o Sair de todos apaga numa tela aberta). */
export const ARQUIVO_DAS_ORIGENS = 'nod-origens.json';
const TETO_DE_ORIGENS = 5000;

/**
 * NOD-97 PR 6 (revisão do #515): grava `conteudo()` em `arquivo` em fila, uma gravação por vez, e de forma atômica
 * (temporário + rename). writeFile concorrente no mesmo arquivo intercala as escritas e deixa um JSON inválido, que ao
 * reabrir a tela vira [] e esquece as origens. `conteudo` é lido na hora em que a gravação roda, então a última da fila
 * grava o estado atual. A promessa devolvida nunca rejeita.
 */
export function gravadorEmFila(arquivo, conteudo) {
  let fila = Promise.resolve();
  let seq = 0;
  return () =>
    (fila = fila.then(async () => {
      const tmp = `${arquivo}.${process.pid}.${++seq}.tmp`;
      try {
        await writeFile(tmp, conteudo(), { mode: 0o600 });
        await rename(tmp, arquivo);
      } catch {
        await rm(tmp, { force: true }).catch(() => {});
      }
    }));
}

/**
 * QA do #515 @3c77fab4: a tela morta no meio de uma gravação (o supervisor dá SIGKILL depois de 15 s) deixa o temporário
 * do gravadorEmFila no perfil, com as origens visitadas, e nada o apagava (nem o Sair de todos). Sai ao subir a tela e
 * junto com o storage do perfil.
 */
export async function apagarTemporariosDasOrigens(perfil) {
  const nomes = await readdir(perfil).catch(() => []);
  const sobras = nomes.filter((n) => n.startsWith(`${ARQUIVO_DAS_ORIGENS}.`) && n.endsWith('.tmp'));
  await Promise.all(sobras.map((n) => rm(path.join(perfil, n), { force: true }).catch(() => {})));
}

/** A geração do storage em comum que este perfil já aplicou (0 se nunca). */
export async function geracaoDoPerfil(perfil) {
  const n = Number((await readFile(path.join(perfil, ARQUIVO_DA_GERACAO), 'utf8').catch(() => '0')).trim());
  return Number.isSafeInteger(n) && n >= 0 ? n : 0;
}

export const gravarGeracaoDoPerfil = (perfil, geracao) => writeFile(path.join(perfil, ARQUIVO_DA_GERACAO), String(geracao), { mode: 0o600 });

/**
 * NOD-97 PR 6: o Sair de todos sobe a geração do storage em comum. O perfil de uma tela que estava fechada ainda tem o
 * Local Storage/IndexedDB no disco: ao subir com uma geração mais nova que a dele, apaga esse storage ANTES do Chrome
 * abrir e grava a geração. Devolve true se apagou.
 */
export async function aplicarGeracaoNoPerfil(perfil, geracao) {
  if (!Number.isSafeInteger(geracao) || geracao <= (await geracaoDoPerfil(perfil))) return false;
  for (const nome of STORAGE_DO_PERFIL) await rm(path.join(perfil, nome), { recursive: true, force: true });
  await apagarTemporariosDasOrigens(perfil);
  await gravarGeracaoDoPerfil(perfil, geracao);
  return true;
}

/** NOD-97 PR 6: apaga pelo CDP (Storage.clearDataForOrigin) o storage das origens dadas, abertas numa aba ou não. */
export async function limparOrigensNoChrome(context, origens) {
  const lista = [...new Set(origens)].filter((o) => origemDe(o) === o);
  if (!lista.length || !context) return;
  const { cdp, temporaria } = await sessaoQueResponde(context);
  try {
    // Prazo por chamada (QA do #515): uma chamada presa não pode segurar a tela até o supervisor matá-la em 15 s; a
    // limpeza falha a tempo e as origens ficam guardadas para o próximo Sair de todos.
    for (const origin of lista) {
      const r = await comPrazo(cdp.send('Storage.clearDataForOrigin', { origin, storageTypes: 'local_storage,indexeddb,websql,cache_storage,service_workers,file_systems' }), PRAZO_DO_CDP_MS, VENCEU);
      if (r === VENCEU) throw new Error('limpeza_sem_resposta');
    }
  } finally {
    await comPrazo(cdp.detach().catch(() => {}), PRAZO_DO_CDP_MS);
    if (temporaria) await comPrazo(temporaria.close().catch(() => {}), PRAZO_DO_CDP_MS);
  }
}

/**
 * QA do #515: a sessão CDP abre numa aba que responde. A aba presa (página em laço infinito, diálogo de beforeunload)
 * segura o newCDPSession para sempre; as que já foram a about:blank vêm primeiro e, se nenhuma responde, uma aba nova
 * temporária faz a limpeza (o Storage.clearDataForOrigin vale para o navegador inteiro, de qualquer aba).
 */
async function sessaoQueResponde(context) {
  const abas = context.pages().filter((x) => !x.isClosed());
  abas.sort((a, b) => Number(b.url() === 'about:blank') - Number(a.url() === 'about:blank'));
  for (const p of abas) {
    const pedido = context.newCDPSession(p).catch(() => null);
    const cdp = await comPrazo(pedido, PRAZO_DO_CDP_MS, VENCEU);
    if (cdp === VENCEU) { pedido.then((s) => s?.detach().catch(() => {})); continue; }
    if (cdp) return { cdp, temporaria: null };
  }
  const temporaria = await comPrazo(context.newPage(), PRAZO_DO_CDP_MS * 2, VENCEU);
  if (temporaria === VENCEU) throw new Error('limpeza_sem_resposta');
  const cdp = await comPrazo(context.newCDPSession(temporaria), PRAZO_DO_CDP_MS, VENCEU);
  if (cdp === VENCEU) { await temporaria.close().catch(() => {}); throw new Error('limpeza_sem_resposta'); }
  return { cdp, temporaria };
}

/**
 * NOD-97 PR 6 (QA do #515): o Sair de todos numa tela ABERTA. A página viva guarda a sessão na memória e pode regravá-la
 * no storage (o SPA que renova o token): as abas saem para about:blank ANTES de apagar, os cookies saem de novo (o que a
 * página gravou ao sair), o storage de cada origem sai pelo CDP e as abas voltam ao endereço em que estavam, deslogadas.
 */
export async function sairDasAbas(context, origens, pendente = null, aoAceitar = () => {}) {
  if (!context) return;
  const abas = context.pages().filter((p) => !p.isClosed());
  const enderecos = abas.map((p) => [p, p.url()]);
  // QA do #515: o site que pede "sair da página?" (beforeunload, comum em editor e formulário) prende a aba no diálogo: a
  // ida a about:blank não acontece, o SPA segue vivo com a sessão na memória e a sessão CDP da aba trava. No Sair de todos
  // a página sai de qualquer jeito: o diálogo é aceito, o que já estava aberto e os que a ida a about:blank abrir.
  // aoAceitar avisa a tela, que também ouve o 'dialog' da aba e guardaria o diálogo já aceito (revisão do #521).
  const aceitar = (d) => { if (d.type() === 'beforeunload') { d.accept().catch(() => {}); aoAceitar(d); } };
  if (pendente?.type?.() === 'beforeunload') await pendente.accept().catch(() => {});
  for (const p of abas) p.on('dialog', aceitar);
  try {
    // Em paralelo e com prazo curto: o supervisor mata a tela que não responde a limpar_storage em 15 s, e uma aba num
    // site lento não pode segurar o Sair de todos (revisão do #518). A volta só espera o commit; a página carrega depois.
    await Promise.all(abas.map((p) => p.goto('about:blank', { timeout: 3000 }).catch(() => {})));
  } finally {
    for (const p of abas) p.off('dialog', aceitar);
  }
  await context.clearCookies();
  await limparOrigensNoChrome(context, [...origens, ...enderecos.map(([, u]) => origemDe(u)).filter(Boolean)]);
  await Promise.all(enderecos.filter(([, url]) => origemDe(url)).map(([p, url]) => p.goto(url, { waitUntil: 'commit', timeout: 4000 }).catch(() => {})));
}

/** Prazo de cada chamada ao CDP na limpeza (QA do #515): 5000 origens levam ~3 s no total; uma só nunca leva 2 s. */
const PRAZO_DO_CDP_MS = 2000;
const VENCEU = Symbol('venceu');

/** Igual ao runtime: sem isto o Chromium abre "Restore pages?" depois de uma tela morta. JSON inválido fica. */
export async function perfilSaiuLimpo(perfil) {
  const arquivo = path.join(perfil, 'Default', 'Preferences');
  let prefs;
  try {
    prefs = JSON.parse(await readFile(arquivo, 'utf8'));
  } catch {
    return;
  }
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return;
  const p = prefs.profile && typeof prefs.profile === 'object' && !Array.isArray(prefs.profile) ? prefs.profile : (prefs.profile = {});
  if (p.exit_type === 'Normal' && p.exited_cleanly === true) return;
  p.exit_type = 'Normal';
  p.exited_cleanly = true;
  await writeFile(arquivo, JSON.stringify(prefs));
}

/**
 * NOD-97 PR 3 (ADR-122 §4, emenda): o arquivo Xauthority de uma tela, com um cookie MIT-MAGIC-COOKIE-1 só dela. Uma
 * entrada FamilyWild (vale para qualquer host) no número do display: sem ela o Xvfb aceita qualquer processo da
 * máquina que alcance o socket (o abstrato `@/tmp/.X11-unix/X1NN` é por network namespace, não some no PrivateTmp nem no
 * bwrap: o motor, os CLIs dos bots e o terminal o alcançariam). Gerado aqui, em Node, para não depender do `xauth`.
 */
export function arquivoXauthority(display, cookie = randomBytes(16)) {
  if (!Buffer.isBuffer(cookie) || cookie.length !== 16) throw new Error('cookie_x');
  const campo = (b) => {
    const t = Buffer.alloc(2);
    t.writeUInt16BE(b.length);
    return Buffer.concat([t, b]);
  };
  const familia = Buffer.alloc(2);
  familia.writeUInt16BE(0xffff);
  return Buffer.concat([familia, campo(Buffer.alloc(0)), campo(Buffer.from(String(display))), campo(Buffer.from('MIT-MAGIC-COOKIE-1')), campo(cookie)]);
}

/** Os argumentos do Xvfb: só o socket do caminho (sem TCP nem o abstrato) e só com o cookie (`-auth`). */
export function argsDoXvfb(display, xauthority, extras = []) {
  return [`:${display}`, '-screen', '0', '1280x800x24', '-nolisten', 'tcp', '-nolisten', 'local', '-auth', xauthority, ...extras];
}

/**
 * NOD-97 PR 5: roda na página (context.addInitScript, em TODA navegação e em todo frame, antes do script do site) para
 * o bot nunca ver a senha que o Chrome preenche. Marca com `data-nod-senha` todo input que já foi type=password e
 * injeta um CSS que troca o texto por bolinhas (`-webkit-text-security`), inclusive se o site trocar o input para
 * type=text para "mostrar senha". O valor continua no campo (o site funciona); só não aparece no screenshot nem no
 * innerText que a tela manda ao bot.
 *
 * Shadow DOM: o CSS do documento não atravessa a fronteira de um shadow root. Por isso o `attachShadow` é embrulhado
 * (pega também os roots `closed`, que de fora ninguém alcança), e cada root ganha o mesmo <style> e o mesmo
 * observador; root aberto que já existia (shadow DOM declarativo) é coberto quando aparece na árvore. O <style> volta se
 * o site trocar o conteúdo do root. Fica de fora só o shadow DOM declarativo `closed` (não passa pelo attachShadow nem
 * é alcançável): registrado na ADR-122.
 */
/* eslint-disable no-undef */
export function mascaraDeSenha() {
  const CSS = 'input:-webkit-autofill, input[data-nod-senha]{-webkit-text-security:disc !important;}';
  const cobertas = new Map();
  const opcoes = { childList: true, subtree: true, attributes: true, attributeFilter: ['type'] };
  let obs = null;
  const garantirEstilo = (raiz) => {
    const atual = cobertas.get(raiz);
    if (atual && atual.parentNode === raiz) return;
    const s = document.createElement('style');
    s.setAttribute('data-nod-mascara-senha', '');
    s.textContent = CSS;
    raiz.appendChild(s);
    cobertas.set(raiz, s);
  };
  const cobrir = (raiz) => {
    if (!raiz || cobertas.has(raiz)) return;
    garantirEstilo(raiz);
    marcar(raiz);
    obs?.observe(raiz, opcoes);
  };
  function marcar(raiz) {
    if (!raiz || !raiz.querySelectorAll) return;
    if (raiz.tagName === 'INPUT' && raiz.type === 'password') raiz.setAttribute('data-nod-senha', '');
    if (raiz.shadowRoot) cobrir(raiz.shadowRoot);
    for (const el of raiz.querySelectorAll('*')) {
      if (el.tagName === 'INPUT' && el.type === 'password') el.setAttribute('data-nod-senha', '');
      if (el.shadowRoot) cobrir(el.shadowRoot);
    }
  }
  const original = typeof Element !== 'undefined' ? Element.prototype.attachShadow : null;
  if (original) {
    Element.prototype.attachShadow = function attachShadow(...args) {
      const raiz = original.apply(this, args);
      try { cobrir(raiz); } catch { /* a máscara nunca quebra o site */ }
      return raiz;
    };
  }
  const estiloDoDocumento = () => {
    const cabeca = document.head || document.documentElement;
    if (cabeca && !document.getElementById('nod-mascara-senha')) {
      const s = document.createElement('style');
      s.id = 'nod-mascara-senha';
      s.textContent = CSS;
      cabeca.appendChild(s);
    }
  };
  obs = new MutationObserver((muts) => {
    for (const m of muts) {
      for (const n of m.addedNodes) if (n.nodeType === 1) marcar(n);
      if (m.type === 'attributes' && m.target.tagName === 'INPUT' && m.target.type === 'password') m.target.setAttribute('data-nod-senha', '');
      const raiz = m.target.getRootNode?.();
      if (raiz && raiz !== document && cobertas.has(raiz)) garantirEstilo(raiz);
    }
    // Só o que entrou é varrido (acima); aqui só confere que o <style> do documento continua lá.
    estiloDoDocumento();
  });
  // Roots criados antes do documentElement (raro) já estão em `cobertas`, mas sem observador.
  for (const raiz of cobertas.keys()) obs.observe(raiz, opcoes);
  const iniciar = () => { estiloDoDocumento(); marcar(document); obs.observe(document.documentElement, opcoes); };
  if (document.documentElement) iniciar();
  else document.addEventListener('DOMContentLoaded', iniciar);
}

/**
 * Roda na página: há um campo de senha preenchido pelo Chrome? Devolve só true/false, nunca o valor. Olha também
 * dentro dos shadow roots abertos.
 */
export function temSenhaPreenchida() {
  const SELETOR = 'input[data-nod-senha]:-webkit-autofill, input:-webkit-autofill[type="password"]';
  const olhar = (raiz) => {
    if (raiz.querySelector(SELETOR)) return true;
    for (const el of raiz.querySelectorAll('*')) if (el.shadowRoot && olhar(el.shadowRoot)) return true;
    return false;
  };
  return olhar(document);
}
/* eslint-enable no-undef */

const OPENBOX_XML = `<?xml version="1.0" encoding="UTF-8"?>
<openbox_config xmlns="http://openbox.org/3.4/rc">
  <applications>
    <application class="*">
      <decor>no</decor>
      <maximized>yes</maximized>
    </application>
  </applications>
</openbox_config>`;

function teclaDoXdotool(k) {
  const nomes = { Control: 'ctrl', Meta: 'super', Enter: 'Return', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', Space: 'space', Backspace: 'BackSpace', PageUp: 'Prior', PageDown: 'Next' };
  return k.split('+').map((x) => nomes[x] ?? x).join('+');
}

/** Caminho dentro do workspace (resolve symlinks); fora dele lança `caminho`. */
export async function caminhoNoWorkspace(raiz, c, novo = false) {
  const base = await realpath(raiz);
  const dentro = (p) => p === base || p.startsWith(base + path.sep);
  const absoluto = path.resolve(base, c);
  if (!dentro(absoluto)) throw new Error('caminho');
  if (novo) await mkdir(path.dirname(absoluto), { recursive: true });
  const resolvido = await realpath(absoluto).catch(async (e) => {
    if (!novo || e.code !== 'ENOENT') throw e;
    return path.join(await realpath(path.dirname(absoluto)), path.basename(absoluto));
  });
  if (!dentro(resolvido)) throw new Error('caminho');
  return resolvido;
}

/**
 * Uma tela viva. `config` (do supervisor): agenteId, display (número), raiz, run (a raiz do run, some no bwrap), ocultar
 * (outras pastas que somem no bwrap), resolv (o resolv.conf do stub, ou nada) e resolvEm (onde montá-lo), perfil, perfilBase, workspace, logins,
 * tmp, x11, bus (pasta) e busEndereco, bin {xvfb, openbox, chromium, bwrap (null = sem bwrap), xdotool, xclip, scrot},
 * sandbox (sandbox do Chromium), cookies (a loja aplicada na subida).
 */
export function criarTela(config, avisar) {
  const filhos = [];
  const quadros = new Map();
  let revision = randomBytes(32).toString('hex');
  let context = null;
  let page = null;
  let dialogo = null;
  /** A última foto dos cookies que a loja conhece (o que a tela mandou e o que recebeu). */
  let conhecidos = new Map();
  /**
   * NOD-97 PR 4: o storage por origem. `versoes` (origem → { em, hash }) é o que este perfil já tem (mandou ou aplicou),
   * gravado no perfil para a próxima subida; `pendentes` é o que outra tela mandou e ainda não entrou (entra quando
   * esta tela navega para a origem e nenhuma aba está nela); `ritmo` segura a coleta a uma por origem a cada 10 s e
   * agenda a rodada do fim da janela para a coleta segurada não se perder.
   */
  const arquivoDeVersoes = path.join(config.perfil, 'nod-storage.json');
  let versoes = {};
  const pendentes = new Map();
  /**
   * NOD-97 PR 6 (QA do #515): toda origem que um frame desta tela abriu, com login rastreado ou não (o site que guarda a
   * sessão só em IndexedDB, sem cookie, também sai no Sair de todos). Gravada no perfil para valer depois de reabrir.
   */
  const arquivoDasOrigens = path.join(config.perfil, ARQUIVO_DAS_ORIGENS);
  let visitadas = new Set();
  // Em fila e atômica (gravadorEmFila): as gravações concorrentes de anotarOrigem/limparStorage corrompiam o arquivo.
  const gravarOrigens = gravadorEmFila(arquivoDasOrigens, () => JSON.stringify([...visitadas]));
  function anotarOrigem(url) {
    const o = origemDe(url);
    if (!o || visitadas.has(o) || visitadas.size >= TETO_DE_ORIGENS) return;
    visitadas.add(o);
    gravarOrigens();
  }
  const ritmo = ritmoDeColeta({ aoVencer: () => { mandarStorage().catch(() => {}); } });
  // NOD-97 PR 5: origens cujo preenchimento de senha já foi avisado, para não repetir o aviso a cada observação.
  const senhasAvisadas = new Set();
  const DISPLAY = `:${config.display}`;
  // O cookie do X fica no tmp desta tela (0600, some no bwrap das outras): só os filhos dela abrem o DISPLAY.
  const XAUTHORITY = path.join(config.tmp, 'Xauthority');
  const ambienteX = { ...process.env, DISPLAY, XAUTHORITY, DBUS_SESSION_BUS_ADDRESS: config.busEndereco ?? '', TMPDIR: config.tmp, HOME: path.join(config.perfil, '..', `casa-${config.agenteId}`) };
  const run = (bin, args, opcoes = {}) => exec(bin, args, { timeout: 25000, maxBuffer: 8 * 1024 * 1024, env: ambienteX, ...opcoes });
  const mudar = () => {
    revision = randomBytes(32).toString('hex');
    quadros.clear();
  };
  const bwrapArgs = (comPerfil) =>
    argsDoBwrap({
      raiz: config.raiz, run: config.run, ocultar: config.ocultar, resolv: config.resolv, resolvEm: config.resolvEm, x11: config.x11, bus: config.bus, tmp: config.tmp,
      ...(comPerfil ? { perfil: config.perfil, workspace: config.workspace, logins: config.logins } : {}),
    });

  // NOD-96: os scripts do bwrap NÃO ficam no tmp: ele é o /run da unit (noexec no Debian 12: o spawn dá EACCES e o
  // Xvfb "não abre") e entra com escrita no bwrap da tela (o Chromium reescreveria o próprio lançador). Ficam em
  // `config.scripts`, sob a raiz dos computadores (exec, e some atrás do tmpfs dentro do bwrap).
  const pastaDosScripts = config.scripts ?? config.tmp;
  async function noBwrap(nome, binario, comPerfil) {
    if (!config.bin.bwrap) return binario;
    await mkdir(pastaDosScripts, { recursive: true, mode: 0o700 });
    const script = path.join(pastaDosScripts, `${nome}.sh`);
    await writeFile(script, scriptDoBwrap({ bwrap: config.bin.bwrap, args: bwrapArgs(comPerfil), binario }), { mode: 0o700 });
    await chmod(script, 0o700);
    return script;
  }

  let erroAoIniciar = null;
  function iniciar(bin, args) {
    const p = spawn(bin, args, { stdio: 'ignore', env: ambienteX, detached: true });
    // O erro do spawn (EACCES, ENOENT) vai no detalhe da falha: engolido, só restava "o Xvfb não abriu".
    p.on('error', (e) => { erroAoIniciar ??= `${path.basename(bin)}: ${e?.code ?? e?.message ?? e}`; });
    filhos.push(p);
    return p;
  }

  async function subir() {
    await mkdir(config.tmp, { recursive: true, mode: 0o700 });
    // NOD-96: com PrivateTmp na unit, o /tmp nasce vazio e o bwrap não monta o /tmp/.X11-unix que não existe.
    await mkdir(config.x11, { recursive: true, mode: 0o1777 }).catch(() => {});
    await mkdir(ambienteX.HOME, { recursive: true, mode: 0o700 });
    await mkdir(config.workspace, { recursive: true });
    await forkDoPerfil(config.perfilBase, config.perfil);
    // NOD-97 PR 6: houve um Sair de todos enquanto esta tela estava fechada: o storage do perfil sai antes do Chrome.
    await aplicarGeracaoNoPerfil(config.perfil, config.geracao);
    // NOD-97 PR 5: as senhas salvas em comum entram no perfil ANTES do Chrome abrir (ele trava o Login Data em uso).
    // Falha de importação nunca impede a tela de subir: o login manual continua valendo.
    if (config.senhas) {
      try {
        importarNoPerfil(config.perfil, config.senhas);
      } catch {
        // falha de importação não impede a tela de subir: o login manual continua valendo
      }
    }
    const socketX = path.join(config.x11, `X${config.display}`);
    await unlink(socketX).catch(() => {});
    await writeFile(XAUTHORITY, arquivoXauthority(config.display), { mode: 0o600 });
    await chmod(XAUTHORITY, 0o600);
    iniciar(await noBwrap('xvfb', config.bin.xvfb, false), argsDoXvfb(config.display, XAUTHORITY, config.xvfbArgs ?? []));
    for (let i = 0; i < 100; i++) {
      if (await access(socketX).then(() => true, () => false)) break;
      if (i === 99 || erroAoIniciar) throw falhaDe('nao_iniciou', `o Xvfb não abriu${erroAoIniciar ? ` (${erroAoIniciar})` : ''}`);
      await esperar(100);
    }
    const cfg = path.join(config.tmp, 'openbox.xml');
    await writeFile(cfg, OPENBOX_XML);
    iniciar(await noBwrap('openbox', config.bin.openbox, false), ['--config-file', cfg]);
    await rodar(ganchos.antesDeAbrirChrome, config);
    try {
      // Importado só aqui: quem usa as funções puras deste arquivo (testes, supervisor) não precisa do playwright-core.
      const { chromium } = await import('playwright-core');
      context = await chromium.launchPersistentContext(config.perfil, {
        executablePath: await noBwrap('chromium', config.bin.chromium, true),
        headless: false, viewport: null, acceptDownloads: true, timeout: PRAZO_NAVEGADOR_MS,
        chromiumSandbox: config.sandbox !== false, env: ambienteX,
        args: ['--password-store=gnome-libsecret', '--start-maximized', '--window-size=1280,800', '--window-position=0,0', '--disable-dev-shm-usage', '--disable-quic', '--autoplay-policy=no-user-gesture-required', '--test-type', '--hide-crash-restore-bubble', '--no-first-run', '--no-default-browser-check'],
      });
    } catch (e) {
      throw falhaDe('navegador_nao_abriu', e);
    }
    context.setDefaultTimeout(15000);
    // NOD-97 PR 5: em toda página, esconde o que o Chrome preenche nos campos de senha (ver mascaraDeSenha).
    await context.addInitScript(mascaraDeSenha).catch(() => {});
    if (config.cookies?.length) await context.addCookies(config.cookies);
    conhecidos = new Map((await context.cookies()).map((c) => [chaveDoCookie(c), c]));
    page = context.pages()[0] ?? (await context.newPage());
    await apagarTemporariosDasOrigens(config.perfil); // antes da 1ª gravação desta tela: só sobra de tela morta
    versoes = await readFile(arquivoDeVersoes, 'utf8').then((t) => JSON.parse(t), () => ({}));
    if (!versoes || typeof versoes !== 'object' || Array.isArray(versoes)) versoes = {};
    const lidas = await readFile(arquivoDasOrigens, 'utf8').then((t) => JSON.parse(t), () => []);
    visitadas = new Set((Array.isArray(lidas) ? lidas : []).filter((o) => typeof o === 'string' && origemDe(o) === o).slice(0, TETO_DE_ORIGENS));
    for (const p of context.pages()) anotarOrigem(p.url());
    for (const item of config.storage ?? []) receberStorage(item);
    await aplicarPendentes(page, [...pendentes.keys()]).catch(() => {});
    await exec(config.bin.xdotool, ['search', '--onlyvisible', '--class', 'Chromium', 'windowmove', '0', '0', 'windowsize', '1280', '800'], { timeout: 4000, env: ambienteX }).catch(() => {});
    context.pages().forEach(acompanhar);
    context.on('page', (p) => {
      acompanhar(p);
      page = p;
      mudar();
    });
  }

  function acompanhar(p) {
    p.on('framenavigated', (f) => {
      anotarOrigem(f.url());
      if (f === p.mainFrame()) mudar();
    });
    p.on('close', mudar);
    p.on('download', async (d) => {
      try {
        await d.saveAs(path.join(config.workspace, path.basename(d.suggestedFilename())));
      } catch {
        // falha de download fica visível no navegador, como no runtime
      }
    });
    p.on('dialog', (d) => {
      dialogo = d;
      mudar();
    });
  }

  async function atual() {
    if (page.isClosed()) page = context.pages().at(-1) ?? (await context.newPage());
    return page;
  }

  async function observar() {
    const p = await atual();
    const png = path.join(config.tmp, 'tela.png');
    await run(config.bin.scrot, ['-o', png]);
    const quadro = randomBytes(32).toString('hex');
    quadros.set(quadro, { revision, em: Date.now() });
    for (const [id, q] of quadros) if (Date.now() - q.em > 120000 || quadros.size > 256) quadros.delete(id);
    const senhaPreenchida = await olharSenha(p);
    return {
      quadro, imagem: (await readFile(png)).toString('base64'), largura: 1280, altura: 800, url: p.url(),
      titulo: dialogo ? 'Diálogo do navegador' : await p.title().catch(() => ''),
      dialogo: dialogo ? { tipo: dialogo.type(), mensagem: dialogo.message() } : undefined,
      texto: dialogo ? dialogo.message() : (await p.locator('body').innerText({ timeout: 1000 }).catch(() => '')).slice(0, 12000),
      abas: await Promise.all(context.pages().map(async (t) => ({ url: t.url(), titulo: dialogo ? 'Navegador' : await t.title().catch(() => ''), ativa: t === p }))),
      ...(senhaPreenchida ? { senhaPreenchida: { origem: senhaPreenchida } } : {}),
    };
  }

  /**
   * NOD-97 PR 5: a página tem um campo de senha preenchido pelo Chrome? Devolve a origem (uma vez por origem, para o
   * servidor avisar a pessoa no chat do bot) ou null. Nunca lê o valor: só pergunta se o autofill aconteceu.
   */
  async function olharSenha(p) {
    const origem = origemDe(p.isClosed() ? '' : p.url());
    // Re-QA do #515: com um diálogo aberto (beforeunload, alert) o evaluate só volta quando ele fecha, e o observar
    // travava sem mostrar o diálogo ao bot. Com diálogo não há o que olhar; aba travada também não segura o observar.
    if (!origem || dialogo) return null;
    const tem = await comPrazo(p.evaluate(temSenhaPreenchida).catch(() => false), 1000, false);
    if (!tem || senhasAvisadas.has(origem)) return null;
    senhasAvisadas.add(origem);
    return origem;
  }

  /** Manda ao supervisor o que mudou nos cookies desde a última foto conhecida. */
  async function mandarCookies() {
    if (!context) return;
    const agora = await context.cookies();
    const diff = diffDeCookies([...conhecidos.values()], agora);
    conhecidos = new Map(agora.map((c) => [chaveDoCookie(c), c]));
    if (diff.postos.length || diff.removidos.length) avisar({ tipo: 'cookies', diff, em: Date.now() });
  }

  /** Aplica o que outra tela mudou (repasse do supervisor). A foto conhecida muda junto: não volta como diff. */
  async function receberCookies({ postos = [], removidos = [] }) {
    if (!context) return;
    for (const r of removidos) {
      await context.clearCookies({ name: r.name, domain: r.domain, path: r.path });
      conhecidos.delete(chaveDoCookie(r));
    }
    if (postos.length) await context.addCookies(postos);
    for (const c of postos) conhecidos.set(chaveDoCookie(c), c);
  }

  const gravarVersoes = () => writeFile(arquivoDeVersoes, JSON.stringify(versoes), { mode: 0o600 }).catch(() => {});

  /**
   * Manda ao supervisor o storage das origens com login abertas nas abas (ou só nas `paginas`), se mudou: no máximo
   * uma vez a cada 10 s por origem, salvo `forcar`. A coleta de cada aba tem prazo (PRAZO_COLETA_MS): aba que não
   * responde fica de fora desta rodada, sem segurar a resposta da ação.
   */
  async function mandarStorage(forcar = false, paginas = null) {
    if (!context) return;
    const cookies = await context.cookies();
    const vistas = new Set();
    let mudou = false;
    for (const p of paginas ?? context.pages()) {
      const origem = origemDe(p.isClosed() ? '' : p.url());
      if (!origem || vistas.has(origem)) continue;
      vistas.add(origem);
      if (!origemTemLogin(origem, cookies)) continue;
      if (!ritmo.liberar(origem, forcar)) continue;
      const dados = await comPrazo(p.evaluate(coletarNaPagina).catch(() => null), PRAZO_COLETA_MS);
      if (!dados) continue;
      const hash = hashDosDados(dados);
      if (versoes[origem]?.hash === hash) continue;
      if (Buffer.byteLength(JSON.stringify(dados)) > TETO_STORAGE_BYTES) continue;
      const em = Math.max(Date.now(), (versoes[origem]?.em ?? 0) + 1);
      versoes[origem] = { em, hash };
      pendentes.delete(origem);
      mudou = true;
      avisar({ tipo: 'storage', origem, em, hash, dados });
    }
    if (mudou) await gravarVersoes();
  }

  /** O supervisor repassou (ou trouxe na subida) a versão de uma origem: fica pendente se é mais nova que a daqui. */
  function receberStorage({ origem, em, hash, dados }) {
    if (!origemDe(origem) || typeof em !== 'number') return;
    const v = versoes[origem];
    if (v && (v.hash === hash || v.em >= em)) return;
    pendentes.set(origem, { em, hash, dados });
  }

  /**
   * Aplica numa aba as versões pendentes das origens pedidas: a aba vai a uma página vazia da origem (page.route, sem
   * passar pelo service worker do site, que poderia servir a página de verdade), restaura e volta a ficar sem rota.
   * Origem aberta em outra aba fica pendente: trocar o storage sob o site vivo o deixaria pela metade.
   */
  async function aplicarPendentes(p, origens) {
    const abertas = new Set(context.pages().filter((x) => !x.isClosed()).map((x) => origemDe(x.url())));
    const itens = origens.filter((o) => pendentes.has(o) && !abertas.has(o));
    if (!itens.length) return;
    const vazia = (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html></html>' }).catch(() => {});
    const cdp = await context.newCDPSession(p).catch(() => null);
    await cdp?.send('Network.setBypassServiceWorker', { bypass: true }).catch(() => {});
    await p.route('**/*', vazia);
    try {
      for (const origem of itens) {
        const item = pendentes.get(origem);
        try {
          await p.goto(`${origem}/`, { waitUntil: 'domcontentloaded', timeout: 10000 });
          // A versão guardada é a do que ficou na aba (o banco só deste perfil fica), para não haver ping-pong.
          versoes[origem] = { em: item.em, hash: await restaurarOrigem(p, item.dados) };
        } catch {
          // a origem que não restaura segue com o storage do perfil; a próxima versão tenta de novo
        }
        pendentes.delete(origem);
      }
    } finally {
      await p.unroute('**/*', vazia).catch(() => {});
      await cdp?.send('Network.setBypassServiceWorker', { bypass: false }).catch(() => {});
      await cdp?.detach().catch(() => {});
      await gravarVersoes();
    }
  }

  async function limparCookies() {
    if (!context) return;
    await context.clearCookies();
    conhecidos = new Map();
  }

  /** NOD-97 PR 6 (Sair de todos os sites): esquece o storage em comum e apaga o das abas abertas. */
  async function limparStorage(geracao) {
    // As origens que este perfil conhece saem ANTES de zerar o índice: o CDP apaga também as que não estão numa aba, e as
    // visitadas cobrem o site que guarda a sessão só no storage, sem cookie de login (QA do #515).
    const origens = [...Object.keys(versoes), ...pendentes.keys(), ...visitadas];
    // Zera antes de sair das abas: as que voltam ao endereço em que estavam são anotadas de novo. Se a limpeza falha, as
    // origens voltam ao arquivo (revisão do #518): o próximo Sair de todos ainda precisa apagá-las.
    const antes = visitadas;
    visitadas = new Set();
    // O diálogo de beforeunload que estava aberto é aceito no sairDasAbas: a tela deixa de mostrá-lo.
    const pendente = dialogo?.type() === 'beforeunload' ? dialogo : null;
    if (pendente) { dialogo = null; mudar(); }
    try {
      // O diálogo que a ida a about:blank abre e o sairDasAbas aceita não fica na tela como se ainda estivesse aberto.
      await sairDasAbas(context, origens, pendente, (d) => { if (dialogo === d) { dialogo = null; mudar(); } });
    } catch (e) {
      visitadas = new Set([...antes, ...visitadas].slice(0, TETO_DE_ORIGENS));
      await gravarOrigens();
      throw e;
    }
    await gravarOrigens();
    conhecidos = new Map();
    versoes = {};
    pendentes.clear();
    await gravarVersoes();
    if (Number.isSafeInteger(geracao)) await gravarGeracaoDoPerfil(config.perfil, geracao);
  }

  async function acao(a) {
    const observado = quadros.get(a.quadro);
    if ('quadro' in a && (!observado || observado.revision !== revision || Date.now() - observado.em > 120000)) throw new Error('tela_alterada');
    const p = await atual();
    const ws = (c, novo) => caminhoNoWorkspace(config.workspace, c, novo);
    if (a.tipo === 'arquivos') {
      const dir = await ws(a.caminho);
      const nomes = (await readdir(dir)).slice(0, 200);
      const base = await realpath(config.workspace);
      return { arquivos: await Promise.all(nomes.map(async (nome) => { const s = await stat(path.join(dir, nome)); return { nome, caminho: path.relative(base, path.join(dir, nome)), tamanho: s.size, diretorio: s.isDirectory() }; })) };
    }
    if (a.tipo === 'ler_arquivo') { const f = await ws(a.caminho); if ((await stat(f)).size > 524288) throw new Error('arquivo_grande'); return { arquivo: { nome: path.basename(f), base64: (await readFile(f)).toString('base64') } }; }
    if (a.tipo === 'ler_texto') return lerTexto(await ws(a.caminho), a.inicio, a.revisao);
    if (a.tipo === 'gravar_texto') return gravarTexto(await ws(a.caminho, true), a.texto, a.revisao);
    if (a.tipo === 'gravar_arquivo') { const f = await ws(a.caminho, true); await writeFile(f, Buffer.from(a.base64, 'base64')); return { saida: 'Arquivo gravado.' }; }
    switch (a.tipo) {
      case 'observar': break;
      case 'dialogo': { if (!dialogo) throw new Error('dialogo'); const d = dialogo; dialogo = null; mudar(); if (a.aceitar) await d.accept(a.texto); else await d.dismiss(); break; }
      // Antes de sair da origem atual, coleta o que ela tem agora (o login gravado dentro da janela de 10 s não se perde).
      case 'navegar': await rodar(ganchos.antesDeNavegar, a.url, config); await mandarStorage(true, [p]).catch(() => {}); await aplicarPendentes(p, [origemDe(a.url)].filter(Boolean)).catch(() => {}); mudar(); await p.goto(a.url, { waitUntil: 'domcontentloaded', timeout: 20000 }); await p.bringToFront(); break;
      case 'abas': if (a.aba !== undefined) { page = context.pages()[a.aba]; if (!page) throw new Error('aba'); mudar(); await page.bringToFront(); } break;
      case 'clicar': mudar(); await run(config.bin.xdotool, ['mousemove', '--sync', String(a.x), String(a.y), 'click', '--repeat', String(a.vezes ?? 1), String(a.botao ?? 1)]); break;
      case 'arrastar': mudar(); await run(config.bin.xdotool, ['mousemove', '--sync', String(a.x), String(a.y), 'mousedown', '1', 'mousemove', '--sync', String(a.destinoX), String(a.destinoY), 'mouseup', '1']); break;
      case 'digitar': {
        mudar();
        const entrada = path.join(config.tmp, 'entrada');
        await writeFile(entrada, a.texto, { mode: 0o600 });
        await run(config.bin.xclip, ['-selection', 'clipboard', entrada]);
        await run(config.bin.xdotool, ['key', '--clearmodifiers', 'ctrl+v']);
        await esperar(150);
        await unlink(entrada);
        await run(config.bin.xclip, ['-selection', 'clipboard', '/dev/null']);
        break;
      }
      case 'tecla': mudar(); await run(config.bin.xdotool, ['key', '--clearmodifiers', teclaDoXdotool(a.tecla)]); break;
      case 'rolar': mudar(); await run(config.bin.xdotool, ['click', '--repeat', String(Math.max(1, Math.ceil(Math.abs(a.delta) / 100))), a.delta < 0 ? '4' : '5']); break;
      case 'anexar': mudar(); await p.locator('input[type=file]').first().setInputFiles(await ws(a.caminho)); break;
      default: throw new Error('acao');
    }
    await esperar(100);
    return { tela: await observar() };
  }

  async function fechar() {
    try {
      await mandarCookies();
    } catch { /* segue */ }
    ritmo.parar();
    try {
      await mandarStorage(true);
    } catch { /* segue */ }
    await rodar(ganchos.aoFecharChrome, config).catch(() => {});
    await context?.close().catch(() => {});
    for (const p of filhos.reverse()) {
      try {
        process.kill(-p.pid, 'SIGTERM');
      } catch { /* segue */ }
    }
    await esperar(300);
    for (const p of filhos) {
      try {
        process.kill(-p.pid, 'SIGKILL');
      } catch { /* segue */ }
    }
    await rm(config.tmp, { recursive: true, force: true }).catch(() => {});
  }

  return {
    subir,
    observar,
    receberCookies,
    limparCookies,
    limparStorage,
    receberStorage,
    async executar(a) {
      try {
        const resultado = await acao(a);
        await rodar(ganchos.depoisDaAcao, a, config);
        return resultado;
      } finally {
        await mandarCookies().catch(() => {});
        await mandarStorage().catch(() => {});
      }
    },
    fechar,
  };
}

/** O processo da tela: fala com o supervisor por IPC (process.send). */
async function principal() {
  let tela = null;
  const enviar = (m) => process.send?.(m);
  process.on('disconnect', async () => {
    await tela?.fechar().catch(() => {});
    process.exit(0);
  });
  // NOD-97 PR 4: o SIGTERM (supervisor parando, systemd) também fecha direito, para o storage e os cookies saírem.
  process.on('SIGTERM', async () => {
    await tela?.fechar().catch(() => {});
    process.exit(0);
  });
  process.on('message', async (m) => {
    try {
      if (m.tipo === 'abrir') {
        tela = criarTela(m.config, enviar);
        try {
          await tela.subir();
          enviar({ tipo: 'pronta' });
        } catch (e) {
          enviar({ tipo: 'falhou', codigo: e?.codigo ?? 'nao_iniciou', detalhe: primeiraLinha(e?.message) });
        }
      } else if (m.tipo === 'acao') {
        try {
          enviar({ tipo: 'resposta', id: m.id, resultado: await tela.executar(m.acao) });
        } catch (e) {
          enviar({ tipo: 'resposta', id: m.id, erro: codigoDaAcao(e), detalhe: primeiraLinha(e?.message) });
        }
      } else if (m.tipo === 'repasse') {
        await tela?.receberCookies(m);
      } else if (m.tipo === 'storage') {
        tela?.receberStorage(m);
      } else if (m.tipo === 'limpar_cookies') {
        await tela?.limparCookies();
        enviar({ tipo: 'resposta', id: m.id, resultado: {} });
      } else if (m.tipo === 'limpar_storage') {
        await tela?.limparStorage(m.geracao);
        enviar({ tipo: 'resposta', id: m.id, resultado: {} });
      } else if (m.tipo === 'fechar') {
        await tela?.fechar();
        enviar({ tipo: 'fechada' });
        process.exit(0);
      }
    } catch (e) {
      if (m.id) enviar({ tipo: 'resposta', id: m.id, erro: 'acao_falhou', detalhe: primeiraLinha(e?.message) });
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href && process.send) {
  // Os downloads (workspace/<bot>) nascem 0660/0770: o terminal, outro uid do grupo nod-pc-arquivos, lê e grava neles.
  // O perfil segue 0700 (mkdir com modo explícito), fora do alcance do terminal.
  process.umask(0o007);
  await principal();
}
