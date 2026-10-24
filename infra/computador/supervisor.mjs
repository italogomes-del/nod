// definido em 2026-10-22 (NOD-96 PR 2, ADR-122): o supervisor do computador da pessoa. Roda como `nod-pc`
// (nod-computador.service, ativado por socket) e é o único dono dos perfis, da loja de logins e do keyring. Recebe do
// motor, pelo socket Unix /run/nod-computador/ctl.sock, os ComandoComputador assinados pelo servidor (Ed25519, 2 min,
// anti-replay), abre e fecha as telas (tela.mjs, um processo por bot) pela régua de memória, funde os cookies na loja
// única e repassa às outras telas, e relata o estado (RelatoComputador) a quem estiver ligado no socket.
//
// Protocolo do socket: uma linha JSON por mensagem, nos dois sentidos. Entra MensagemAoSupervisor
// ({tipo:"comando", comando} ou {tipo:"pedir_estado"}; o ComandoComputador cru também vale); sai
// {tipo:"resultado", ...ResultadoComandoComputador} para cada comando e {tipo:"estado", ...EstadoComputadorRelatado} ao
// conectar, a cada mudança de tela e a cada batimento.
import { clearInterval, clearTimeout, setInterval, setTimeout } from 'node:timers';
import { fork } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile, chmod } from 'node:fs/promises';
import { existsSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { availableParallelism, totalmem } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as esperar } from 'node:timers/promises';
import { spawn } from 'node:child_process';
import { createPrivateKey, randomUUID } from 'node:crypto';
import { abrirSelo, chaveDaLoja, conferirComando, novoParX25519, publicaX25519, senhaSafeStorage } from './chaves.mjs';
import { atualizarLoja, cookiesVivos, fundir, lerLoja, zerar } from './loja-cookies.mjs';
import { decidirAbertura, leituraLocal } from './regua.mjs';
import { RESOLV_DO_STUB } from './isolamento.mjs';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
export const ID_VALIDO = /^[A-Za-z0-9_-]{1,64}$/;
export const TIPOS = ['iniciar', 'abrir_tela', 'acao', 'fechar_tela', 'parar', 'atualizar', 'redefinir', 'sair_de_todos', 'apagar_perfil'];
/** Os comandos que dizem a tela (levam `agenteId`). */
export const TIPOS_DA_TELA = ['abrir_tela', 'acao', 'fechar_tela', 'apagar_perfil'];
export const PRAZO_ABRIR_TELA_MS = 60_000;
export const PRAZO_ACAO_MS = 55_000;
export const BATIMENTO_MS = 30_000;
/** Displays :100 a :199 (ADR-122: Xvfb :1NN). */
export const DISPLAY_BASE = 100;

/** PSS (MB) da árvore de processos de `pid`, via smaps_rollup. 0 se não der para ler. */
export function memoriaDaArvore(pid) {
  if (!pid) return null;
  const pais = new Map();
  try {
    for (const d of readdirSync('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      try {
        const s = readFileSync(`/proc/${d}/stat`, 'utf8');
        pais.set(Number(d), Number(s.slice(s.lastIndexOf(')') + 2).split(' ')[1]));
      } catch { /* segue */ }
    }
  } catch {
    return null;
  }
  const dentro = new Set([pid]);
  for (let mudou = true; mudou; ) {
    mudou = false;
    for (const [p, pp] of pais) if (!dentro.has(p) && dentro.has(pp)) { dentro.add(p); mudou = true; }
  }
  let kb = 0;
  for (const p of dentro) {
    try {
      kb += Number(/^Pss:\s+(\d+) kB/m.exec(readFileSync(`/proc/${p}/smaps_rollup`, 'utf8'))?.[1] ?? 0);
    } catch { /* segue */ }
  }
  return Math.round(kb / 1024);
}

function leituraDoSistema() {
  let meminfo = '';
  let loadavg = '';
  try { meminfo = readFileSync('/proc/meminfo', 'utf8'); } catch { /* segue */ }
  try { loadavg = readFileSync('/proc/loadavg', 'utf8'); } catch { /* segue */ }
  return leituraLocal({ meminfo, loadavg, nucleos: availableParallelism(), simular: process.env.NOD_SIMULAR_PRESSAO });
}

/** Os binários (sobrescrevíveis por ambiente, para o computador-local e os testes). */
export function binariosDoAmbiente(env = process.env) {
  return {
    xvfb: env.NOD_PC_XVFB ?? 'Xvfb', openbox: env.NOD_PC_OPENBOX ?? 'openbox', chromium: env.NOD_PC_CHROMIUM ?? chromiumDoPlaywright(env),
    bwrap: env.NOD_PC_BWRAP === 'nao' ? null : (env.NOD_PC_BWRAP ?? 'bwrap'), xdotool: env.NOD_PC_XDOTOOL ?? 'xdotool', xclip: env.NOD_PC_XCLIP ?? 'xclip',
    scrot: env.NOD_PC_SCROT ?? 'scrot', dbus: env.NOD_PC_DBUS ?? 'dbus-daemon', keyring: env.NOD_PC_KEYRING ?? 'gnome-keyring-daemon', secretTool: env.NOD_PC_SECRET_TOOL ?? 'secret-tool',
  };
}

/** O Chromium fixado pelo Playwright em PLAYWRIGHT_BROWSERS_PATH (o instalador usa /opt/nod-motor/chromium). */
export function chromiumDoPlaywright(env = process.env) {
  const base = env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/nod-motor/chromium';
  try {
    const dir = readdirSync(base).filter((d) => /^chromium-\d+$/.test(d)).sort().at(-1);
    if (dir) return path.join(base, dir, 'chrome-linux64', 'chrome');
  } catch { /* segue */ }
  return 'chromium';
}

/** Onde o bwrap monta o resolv.conf do stub: o destino real do /etc/resolv.conf (o bwrap não monta sobre symlink). */
export function destinoDoResolv(arquivo = '/etc/resolv.conf') {
  try { return realpathSync(arquivo); } catch { return arquivo; }
}

const resultado = (id, desfecho, extra = {}) => ({ id, desfecho, ...extra });
const falhou = (id, motivo) => resultado(id, 'falhou', { motivo });

/** Espera a primeira mensagem do filho que satisfaz `cond`, ou a saída dele, ou o prazo. */
function esperarDoFilho(filho, cond, prazoMs) {
  return new Promise((resolve) => {
    const fim = (v) => {
      clearTimeout(t);
      filho.off('message', ouvir);
      filho.off('exit', saiu);
      resolve(v);
    };
    const ouvir = (m) => { if (cond(m)) fim(m); };
    const saiu = () => fim({ tipo: 'saiu' });
    const t = setTimeout(() => fim({ tipo: 'prazo' }), prazoMs);
    filho.on('message', ouvir);
    filho.on('exit', saiu);
  });
}

/**
 * O supervisor, sem socket (o socket é `servirControle`). Opções: raiz (/var/lib/nod-computador), run
 * (/run/nod-computador), terminal (socket do terminal), x11 (/tmp/.X11-unix), bin, sandbox, xvfbArgs, ambienteTela,
 * resolv (o resolv.conf que a tela vê; padrão: o do stub do systemd-resolved, se existir), leitura
 * (() => {memoria, processador}), agora.
 */
export function criarSupervisor(op) {
  const raiz = op.raiz ?? '/var/lib/nod-computador';
  const run = op.run ?? '/run/nod-computador';
  const x11 = op.x11 ?? '/tmp/.X11-unix';
  const resolv = op.resolv !== undefined ? op.resolv : (existsSync(RESOLV_DO_STUB) ? RESOLV_DO_STUB : null);
  const resolvEm = destinoDoResolv();
  const bin = op.bin ?? binariosDoAmbiente();
  const leitura = op.leitura ?? leituraDoSistema;
  const agora = op.agora ?? Date.now;
  const terminal = op.terminal ?? path.join(run, 'term.sock');
  const computadores = new Map();
  const ouvintes = new Set();
  const displaysEmUso = new Set();
  const log = op.log ?? ((m) => process.stderr.write(`[supervisor] ${m}\n`));

  const dirs = (id) => {
    const d = path.join(raiz, id);
    return {
      raiz: d, estado: path.join(d, 'estado'), perfis: path.join(d, 'perfis'), perfilBase: path.join(d, 'perfil-base'),
      logins: path.join(d, 'logins'), loja: path.join(d, 'logins', 'principal', 'cookies.enc'), keyring: path.join(d, 'keyring'),
      workspace: path.join(d, 'workspace'), run: path.join(run, id), bus: path.join(run, id, 'bus'),
    };
  };

  async function prepararPastas(d) {
    for (const p of [d.raiz, d.estado, d.perfis, d.perfilBase, d.logins, path.dirname(d.loja), d.keyring, d.run, d.bus]) await mkdir(p, { recursive: true, mode: 0o700 });
    await mkdir(d.workspace, { recursive: true, mode: 0o2770 });
    // O umask 077 do serviço come o modo do mkdir. O terminal (outro uid, mesmo grupo nod-pc-arquivos) só atravessa a
    // pasta do computador (--x) e lê/grava o workspace; perfis, logins, estado e keyring seguem 0700 do nod-pc.
    await chmod(d.raiz, 0o2710);
    await chmod(d.workspace, 0o2770);
  }

  async function chaveDoSupervisor(d, nova = false) {
    const arquivo = path.join(d.estado, 'supervisor.key');
    if (!nova) {
      try { return createPrivateKey(await readFile(arquivo, 'utf8')); } catch { /* segue */ }
    }
    const par = novoParX25519();
    await writeFile(arquivo, par.privadaPem, { mode: 0o600 });
    return createPrivateKey(par.privadaPem);
  }

  async function obter(id) {
    let c = computadores.get(id);
    if (c) return c;
    const d = dirs(id);
    await prepararPastas(d);
    const privX = await chaveDoSupervisor(d);
    const servidorPub = await readFile(path.join(d.estado, 'servidor.pub'), 'utf8').then((s) => s.trim(), () => null);
    c = { id, d, privX, pubX: publicaX25519(privX), servidorPub, vistos: new Map(), ligado: false, chaveLoja: null, busEndereco: null, procs: [], telas: new Map(), operacao: null, fila: Promise.resolve() };
    computadores.set(id, c);
    return c;
  }

  function estadoDe(c) {
    return {
      computadorId: c.id, ligado: c.ligado, supervisorPub: c.pubX,
      ligadoDesde: c.ligado ? c.ligadoDesde ?? null : null, memoriaTotalMb: Math.round(totalmem() / 1048576),
      operacao: c.operacao ? { tipo: c.operacao.tipo, pct: c.operacao.pct, etapa: c.operacao.etapa } : null,
      telas: [...c.telas.entries()].map(([agenteId, t]) => ({ agenteId, estado: t.estado, ultimaAcaoEm: t.ultimaAcaoEm ?? null, titulo: t.titulo ?? null, memoriaMb: t.estado === 'aberta' ? memoriaDaArvore(t.proc?.pid) : null })),
    };
  }
  const relatar = (m) => { for (const f of ouvintes) { try { f(m); } catch { /* segue */ } } };
  const relatarEstado = (c) => relatar({ tipo: 'estado', ...estadoDe(c) });
  /** Avança o progresso da operação em curso e relata a foto (o servidor grava em computadores.operacao_*). */
  const etapa = (c, pct, nome) => {
    if (!c.operacao) return;
    c.operacao.pct = pct;
    c.operacao.etapa = nome;
    relatarEstado(c);
  };

  // --- máquina: dbus + keyring + Safe Storage ---
  function iniciarProc(binario, args, env, stdin) {
    const p = spawn(binario, args, { env: { ...process.env, ...env }, stdio: [stdin === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'], detached: true });
    p.on('error', () => {});
    if (stdin !== undefined) p.stdin.end(stdin);
    return p;
  }
  const primeiraLinhaDe = (p, prazoMs) => new Promise((resolve) => {
    let buf = '';
    const t = setTimeout(() => resolve(null), prazoMs);
    p.stdout.on('data', (b) => { buf += b; const i = buf.indexOf('\n'); if (i >= 0) { clearTimeout(t); resolve(buf.slice(0, i).trim()); } });
    p.on('exit', () => { clearTimeout(t); resolve(buf.trim() || null); });
  });
  const terminou = (p, prazoMs) => new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), prazoMs);
    p.on('exit', (code) => { clearTimeout(t); resolve(code); });
  });

  async function ligarMaquina(c, chaveMaquina) {
    const socketBus = path.join(c.d.bus, 'socket');
    await rm(socketBus, { force: true });
    const dbus = iniciarProc(bin.dbus, ['--session', '--nofork', '--nopidfile', `--address=unix:path=${socketBus}`, '--print-address=1'], {});
    c.procs.push(dbus);
    const endereco = await primeiraLinhaDe(dbus, 10_000);
    if (!endereco) throw Object.assign(new Error('o dbus não abriu'), { codigo: 'nao_iniciou' });
    c.busEndereco = endereco;
    const env = { DBUS_SESSION_BUS_ADDRESS: endereco, XDG_DATA_HOME: c.d.keyring, XDG_RUNTIME_DIR: c.d.run, HOME: c.d.keyring };
    const keyring = iniciarProc(bin.keyring, ['--foreground', '--unlock', '--components=secrets'], env, chaveMaquina);
    c.procs.push(keyring);
    // O keyring entra no barramento e destrava; o Safe Storage é gravado (idempotente) antes do primeiro Chrome.
    let gravou = false;
    for (let i = 0; i < 50 && !gravou; i++) {
      const p = iniciarProc(bin.secretTool, ['store', '--label=Chromium Safe Storage', 'application', 'chromium'], env, senhaSafeStorage(chaveMaquina));
      gravou = (await terminou(p, 5_000)) === 0;
      if (!gravou) await esperar(100);
    }
    if (!gravou) throw Object.assign(new Error('o keyring não destravou'), { codigo: 'cofre_invalido' });
    c.chaveLoja = chaveDaLoja(chaveMaquina);
    await lerLoja(c.d.loja, c.chaveLoja).catch((e) => { throw Object.assign(e, { codigo: 'cofre_invalido' }); });
    c.ligado = true;
    c.ligadoDesde = agora();
  }

  async function desligarMaquina(c) {
    for (const agenteId of [...c.telas.keys()]) await fecharTela(c, agenteId);
    for (const p of c.procs.splice(0)) {
      try { process.kill(-p.pid, 'SIGTERM'); } catch { /* segue */ }
    }
    c.ligado = false;
    c.chaveLoja = null;
    c.busEndereco = null;
  }

  // --- telas ---
  function novoDisplay() {
    for (let n = 0; n < 100; n++) {
      const numero = DISPLAY_BASE + n;
      if (displaysEmUso.has(numero)) continue;
      try { readFileSync(`/tmp/.X${numero}-lock`); continue; } catch { /* segue */ }
      displaysEmUso.add(numero);
      return numero;
    }
    return null;
  }

  function aoMensagemDaTela(c, agenteId, m) {
    if (m?.tipo !== 'cookies') return;
    c.fila = c.fila.then(async () => {
      if (!c.chaveLoja) return;
      const { efetivo } = await atualizarLoja(c.d.loja, c.chaveLoja, (loja) => fundir(loja, m.diff, m.em, agora()));
      if (!efetivo.postos.length && !efetivo.removidos.length) return;
      for (const [outro, t] of c.telas) if (outro !== agenteId && t.estado === 'aberta') t.proc.send({ tipo: 'repasse', ...efetivo });
    }).catch((e) => log(`loja de cookies: ${e?.message}`));
  }

  async function abrirTela(c, agenteId, uso) {
    let t = c.telas.get(agenteId);
    if (t?.estado === 'aberta') return { ok: true };
    if (t?.estado === 'abrindo') return t.abrindo;
    for (let volta = 0; volta < 10; volta++) {
      const { memoria, processador } = leitura();
      const telas = [...c.telas.entries()].map(([id, x]) => ({ agenteId: id, estado: x.estado, ocupada: x.ocupada, ultimaAcaoEm: x.ultimaAcaoEm }));
      const d = decidirAbertura({ uso, memoria, processador, telas, agenteId, agora: agora() });
      if (d.acao === 'abrir') break;
      if (d.acao === 'fechar') { await fecharTela(c, d.agenteId); continue; }
      t = c.telas.get(agenteId) ?? { estado: 'fechada' };
      if (t.estado !== 'esperando') c.telas.set(agenteId, { ...t, estado: 'esperando', esperandoDesde: agora() });
      relatarEstado(c);
      return { esperando: d.quem };
    }
    const display = novoDisplay();
    if (display === null) return { esperando: [...c.telas.keys()].filter((k) => k !== agenteId) };
    const proc = fork(op.tela ?? process.env.NOD_PC_TELA ?? path.join(AQUI, 'tela.mjs'), [], { stdio: ['ignore', 'inherit', 'inherit', 'ipc'], env: { ...process.env, ...(op.ambienteTela ?? {}) } });
    t = { estado: 'abrindo', proc, display, ocupada: false, ultimaAcaoEm: agora(), pendentes: new Map() };
    c.telas.set(agenteId, t);
    relatarEstado(c);
    proc.on('message', (m) => {
      aoMensagemDaTela(c, agenteId, m);
      if (m?.tipo === 'resposta') { t.pendentes.get(m.id)?.(m); t.pendentes.delete(m.id); }
    });
    proc.on('exit', () => {
      displaysEmUso.delete(display);
      for (const r of t.pendentes.values()) r({ erro: 'sem_resposta' });
      t.pendentes.clear();
      if (c.telas.get(agenteId) === t && t.estado !== 'fechada') { c.telas.set(agenteId, { estado: 'fechada', ultimaAcaoEm: t.ultimaAcaoEm }); relatarEstado(c); }
    });
    t.abrindo = (async () => {
      const loja = await lerLoja(c.d.loja, c.chaveLoja);
      proc.send({
        tipo: 'abrir',
        config: {
          agenteId, display, raiz, run, ocultar: [path.dirname(terminal)], resolv, resolvEm, perfil: path.join(c.d.perfis, agenteId), perfilBase: c.d.perfilBase, workspace: path.join(c.d.workspace, agenteId),
          logins: c.d.logins, tmp: path.join(c.d.run, 'telas', agenteId), x11, bus: c.d.bus, busEndereco: c.busEndereco, bin, sandbox: op.sandbox !== false,
          xvfbArgs: op.xvfbArgs, cookies: cookiesVivos(loja, agora()),
        },
      });
      const m = await esperarDoFilho(proc, (x) => x?.tipo === 'pronta' || x?.tipo === 'falhou', PRAZO_ABRIR_TELA_MS);
      if (m.tipo !== 'pronta') {
        log(`tela ${agenteId} não abriu: ${m.codigo ?? m.tipo} ${m.detalhe ?? ''}`);
        try { proc.kill('SIGKILL'); } catch { /* segue */ }
        c.telas.set(agenteId, { estado: 'fechada', ultimaAcaoEm: t.ultimaAcaoEm });
        relatarEstado(c);
        return { motivo: m.codigo === 'navegador_nao_abriu' ? 'navegador_nao_abriu' : 'nao_iniciou' };
      }
      t.estado = 'aberta';
      t.ultimaAcaoEm = agora();
      relatarEstado(c);
      return { ok: true };
    })();
    return t.abrindo;
  }

  async function fecharTela(c, agenteId) {
    const t = c.telas.get(agenteId);
    if (!t?.proc || t.estado === 'fechada') { c.telas.delete(agenteId); return; }
    t.estado = 'fechando';
    relatarEstado(c);
    if (t.proc.exitCode === null) {
      t.proc.send({ tipo: 'fechar' });
      const m = await esperarDoFilho(t.proc, (x) => x?.tipo === 'fechada', 15_000);
      if (m.tipo === 'prazo') { try { t.proc.kill('SIGKILL'); } catch { /* segue */ } }
    }
    await c.fila;
    c.telas.set(agenteId, { estado: 'fechada', ultimaAcaoEm: t.ultimaAcaoEm });
    relatarEstado(c);
  }

  function pedirATela(t, mensagem, prazoMs = PRAZO_ACAO_MS) {
    const id = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => { t.pendentes.delete(id); try { t.proc.kill('SIGKILL'); } catch { /* segue */ } resolve({ erro: 'sem_resposta' }); }, prazoMs);
      t.pendentes.set(id, (m) => { clearTimeout(timer); resolve(m); });
      t.proc.send({ ...mensagem, id });
    });
  }

  function pedirAoTerminal(computadorId, comando) {
    return new Promise((resolve) => {
      const s = net.connect(terminal);
      let corpo = '';
      s.setTimeout(40_000, () => s.destroy());
      s.on('data', (b) => { corpo += b; });
      s.on('error', () => resolve({ erro: 'sem_resposta' }));
      s.on('close', () => { try { resolve(JSON.parse(corpo)); } catch { resolve({ erro: 'sem_resposta' }); } });
      s.end(JSON.stringify({ computadorId, comando }));
    });
  }

  async function acao(c, cmd) {
    const aberta = await abrirTela(c, cmd.agenteId, cmd.uso);
    if (aberta.esperando) return resultado(cmd.id, 'esperando_tela', { quem: aberta.esperando });
    if (!aberta.ok) return falhou(cmd.id, aberta.motivo);
    const t = c.telas.get(cmd.agenteId);
    if (t.ocupada) return falhou(cmd.id, 'ocupado');
    t.ocupada = true;
    try {
      let extra = {};
      let pedido = cmd.acao;
      if (cmd.acao.tipo === 'terminal') {
        const r = await pedirAoTerminal(c.id, cmd.acao.comando);
        if (r.erro) {
          log(`terminal de ${cmd.agenteId}: ${r.erro}`);
          return falhou(cmd.id, r.erro === 'nao_iniciou' ? 'nao_iniciou' : 'acao_falhou');
        }
        extra = r.resultado;
        pedido = { tipo: 'observar' };
      }
      const m = await pedirATela(t, { tipo: 'acao', acao: pedido });
      if (m.erro) {
        log(`ação ${cmd.acao.tipo} de ${cmd.agenteId}: ${m.erro} ${m.detalhe ?? ''}`);
        return falhou(cmd.id, ['tela_alterada', 'sem_resposta'].includes(m.erro) ? m.erro : 'acao_falhou');
      }
      if (typeof m.resultado?.titulo === 'string') t.titulo = m.resultado.titulo.slice(0, 200);
      return resultado(cmd.id, 'ok', { resultado: { ...extra, ...m.resultado } });
    } finally {
      t.ocupada = false;
      t.ultimaAcaoEm = agora();
    }
  }

  async function fecharTodas(c, de, ate) {
    const abertas = [...c.telas.keys()];
    for (const [i, agenteId] of abertas.entries()) {
      await fecharTela(c, agenteId);
      etapa(c, Math.round(de + ((ate - de) * (i + 1)) / abertas.length), 'Preparando');
    }
  }

  /** Redefinir: apaga tudo menos os logins (e o estado, onde fica a chave do servidor), recria o perfil-base e gera a X25519 nova. */
  async function redefinir(c) {
    etapa(c, 10, 'Preparando');
    await fecharTodas(c, 10, 30);
    etapa(c, 35, 'Preparando');
    await desligarMaquina(c);
    etapa(c, 50, 'Apagando seus dados');
    for (const nome of await readdir(c.d.raiz)) if (nome !== 'logins' && nome !== 'estado') await rm(path.join(c.d.raiz, nome), { recursive: true, force: true });
    await rm(path.join(c.d.estado, 'supervisor.key'), { force: true });
    etapa(c, 75, 'Criando');
    await prepararPastas(c.d);
    c.telas.clear();
    etapa(c, 90, 'Iniciando');
    c.privX = await chaveDoSupervisor(c.d, true);
    c.pubX = publicaX25519(c.privX);
  }

  /** O bot foi excluído: fecha a tela dele e apaga o perfil do Chrome (os logins em comum ficam). */
  async function apagarPerfil(c, agenteId) {
    await fecharTela(c, agenteId);
    c.telas.delete(agenteId);
    await rm(path.join(c.d.perfis, agenteId), { recursive: true, force: true });
    await rm(path.join(c.d.run, 'telas', agenteId), { recursive: true, force: true });
    relatarEstado(c);
  }

  async function executar(c, cmd) {
    switch (cmd.tipo) {
      case 'iniciar': {
        let chave;
        try { chave = abrirSelo(c.privX, cmd.segredoSelado); } catch { return falhou(cmd.id, 'cofre_invalido'); }
        if (!/^[a-f0-9]{64}$/.test(chave)) return falhou(cmd.id, 'cofre_invalido');
        if (c.ligado) return resultado(cmd.id, 'ok');
        try {
          await ligarMaquina(c, chave);
        } catch (e) {
          log(`iniciar ${c.id}: ${e?.message}`);
          await desligarMaquina(c);
          return falhou(cmd.id, e?.codigo === 'cofre_invalido' ? 'cofre_invalido' : 'nao_iniciou');
        }
        relatarEstado(c);
        return resultado(cmd.id, 'ok');
      }
      case 'abrir_tela': {
        if (!c.ligado) return falhou(cmd.id, 'nao_iniciou');
        const r = await abrirTela(c, cmd.agenteId, cmd.uso);
        if (r.esperando) return resultado(cmd.id, 'esperando_tela', { quem: r.esperando });
        return r.ok ? resultado(cmd.id, 'ok') : falhou(cmd.id, r.motivo);
      }
      case 'acao':
        if (!c.ligado) return falhou(cmd.id, 'nao_iniciou');
        if (!cmd.acao || typeof cmd.acao.tipo !== 'string') return falhou(cmd.id, 'acao_falhou');
        return acao(c, cmd);
      case 'fechar_tela':
        await fecharTela(c, cmd.agenteId);
        return resultado(cmd.id, 'ok');
      case 'parar':
        await desligarMaquina(c);
        relatarEstado(c);
        return resultado(cmd.id, 'ok');
      case 'apagar_perfil':
        await apagarPerfil(c, cmd.agenteId);
        return resultado(cmd.id, 'ok');
      case 'sair_de_todos': {
        if (!c.ligado) return falhou(cmd.id, 'nao_iniciou');
        etapa(c, 20, 'Saindo das contas');
        await (c.fila = c.fila.then(() => atualizarLoja(c.d.loja, c.chaveLoja, (loja) => zerar(loja, agora(), agora()))));
        const abertas = [...c.telas.values()].filter((t) => t.estado === 'aberta');
        etapa(c, 50, 'Limpando');
        for (const t of abertas) await pedirATela(t, { tipo: 'limpar_cookies' }, 15_000);
        return resultado(cmd.id, 'ok', { progresso: { pct: 100, etapa: 'pronto' } });
      }
      case 'atualizar':
        // Os binários novos vêm do instalador do motor; aqui fecha tudo (perfis, logins e workspace ficam) para o
        // serviço reiniciar com eles.
        etapa(c, 10, 'Preparando');
        await fecharTodas(c, 10, 60);
        etapa(c, 70, 'Reiniciando');
        await desligarMaquina(c);
        // Reinicia o serviço depois de responder, para o systemd (ativado por socket) carregar os arquivos novos do disco.
        if (op.aoAtualizar) setTimeout(op.aoAtualizar, 200).unref?.();
        return resultado(cmd.id, 'ok', { progresso: { pct: 100, etapa: 'pronto' } });
      case 'redefinir':
        await redefinir(c);
        // A X25519 nova vai na resposta deste comando, que veio assinado com a chave do servidor: é assim que o
        // servidor troca a supervisor_pub fixada (TOFU) sem aceitar uma chave diferente vinda de uma foto qualquer.
        return resultado(cmd.id, 'ok', { progresso: { pct: 100, etapa: 'pronto' }, supervisorPub: c.pubX });
      default:
        return falhou(cmd.id, 'acao_falhou');
    }
  }

  const OPERACOES = new Set(['atualizar', 'redefinir', 'sair_de_todos']);

  /** Trata um ComandoComputador e devolve o ResultadoComandoComputador. Nunca lança. */
  async function tratar(cmd) {
    const id = typeof cmd?.id === 'string' ? cmd.id : '';
    try {
      if (!cmd || typeof cmd !== 'object' || !ID_VALIDO.test(String(cmd.computadorId ?? '')) || !TIPOS.includes(cmd.tipo)) return falhou(id, 'acao_falhou');
      if (cmd.agenteId !== undefined && !ID_VALIDO.test(String(cmd.agenteId))) return falhou(id, 'acao_falhou');
      if (TIPOS_DA_TELA.includes(cmd.tipo) && !cmd.agenteId) return falhou(id, 'acao_falhou');
      const c = await obter(cmd.computadorId);
      // A chave do servidor fica fixada no primeiro `iniciar` (TOFU, como a do supervisor do lado de lá).
      const fixar = !c.servidorPub && cmd.tipo === 'iniciar' && typeof cmd.servidorPub === 'string';
      const publica = c.servidorPub ?? (fixar ? cmd.servidorPub : null);
      const recusa = publica ? conferirComando(cmd, publica, c.vistos, agora()) : 'sem_chave_do_servidor';
      if (recusa) {
        log(`comando ${id} recusado: ${recusa}`);
        return falhou(id, 'acao_falhou');
      }
      if (fixar) {
        await writeFile(path.join(c.d.estado, 'servidor.pub'), publica, { mode: 0o600 });
        c.servidorPub = publica;
      }
      if (c.operacao && cmd.tipo !== 'parar') return falhou(id, 'atualizando');
      if (OPERACOES.has(cmd.tipo)) {
        c.operacao = { tipo: cmd.tipo, pct: 0, etapa: 'Preparando' };
        relatarEstado(c);
      }
      try {
        return await executar(c, cmd);
      } finally {
        if (OPERACOES.has(cmd.tipo)) {
          c.operacao = null;
          relatarEstado(c);
        }
      }
    } catch (e) {
      log(`comando ${id}: ${e?.message}`);
      return falhou(id, 'acao_falhou');
    }
  }

  /** Os computadores que já existem no disco (para o relato ao conectar). */
  async function carregar() {
    let nomes = [];
    try { nomes = await readdir(raiz); } catch { /* segue */ }
    for (const n of nomes) if (ID_VALIDO.test(n)) await obter(n).catch(() => {});
  }

  const batimento = setInterval(() => { for (const c of computadores.values()) relatarEstado(c); }, op.batimentoMs ?? BATIMENTO_MS);
  batimento.unref();

  return {
    tratar,
    carregar,
    estados: () => [...computadores.values()].map(estadoDe),
    ouvir(f) { ouvintes.add(f); return () => ouvintes.delete(f); },
    /** Espera as fusões de cookies em curso (testes). */
    async assentar() { for (const c of computadores.values()) await c.fila; },
    async encerrar() {
      clearInterval(batimento);
      for (const c of computadores.values()) await desligarMaquina(c).catch(() => {});
    },
  };
}

/** O socket de controle: uma linha JSON por mensagem. Devolve o net.Server. */
export function servirControle(supervisor) {
  return net.createServer((socket) => {
    socket.setEncoding('utf8');
    socket.on('error', () => {});
    const escrever = (m) => { if (!socket.destroyed) socket.write(`${JSON.stringify(m)}\n`); };
    const parar = supervisor.ouvir(escrever);
    socket.on('close', parar);
    for (const e of supervisor.estados()) escrever({ tipo: 'estado', ...e });
    let buf = '';
    socket.on('data', (b) => {
      buf += b;
      if (buf.length > 4_000_000) { socket.destroy(); return; }
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const linha = buf.slice(0, i).trim();
        buf = buf.slice(i + 1);
        if (!linha) continue;
        let m;
        try { m = JSON.parse(linha); } catch { escrever({ tipo: 'resultado', id: '', desfecho: 'falhou', motivo: 'acao_falhou' }); continue; }
        // MensagemAoSupervisor (NOD-96 PR 3) é o envelope do motor; o comando cru segue aceito.
        if (m?.tipo === 'pedir_estado') { for (const e of supervisor.estados()) escrever({ tipo: 'estado', ...e }); continue; }
        const cmd = m?.tipo === 'comando' && m.comando && typeof m.comando === 'object' ? m.comando : m;
        void supervisor.tratar(cmd).then((r) => escrever({ tipo: 'resultado', ...r }));
      }
    });
  });
}

/** Escuta no fd do systemd (LISTEN_FDS) ou no caminho dado. */
export async function escutarControle(servidor, caminho) {
  if (process.env.LISTEN_FDS === '1' && process.env.LISTEN_PID === String(process.pid)) {
    servidor.listen({ fd: 3 });
    return;
  }
  await mkdir(path.dirname(caminho), { recursive: true });
  await rm(caminho, { force: true });
  await new Promise((r) => servidor.listen(caminho, r));
  await chmod(caminho, 0o660).catch(() => {});
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.umask(0o077);
  // Depois do Atualizar o processo sai e o systemd (Restart=always) o sobe de novo com os arquivos do disco.
  const aoAtualizar = () => void supervisor.encerrar().finally(() => process.exit(0));
  const supervisor = criarSupervisor({ raiz: process.env.NOD_PC_RAIZ, run: process.env.NOD_PC_RUN, terminal: process.env.NOD_PC_TERMINAL, aoAtualizar });
  await supervisor.carregar();
  const servidor = servirControle(supervisor);
  await escutarControle(servidor, process.env.NOD_PC_SOCKET ?? '/run/nod-computador/ctl.sock');
  const sair = () => void supervisor.encerrar().finally(() => process.exit(0));
  process.on('SIGTERM', sair);
  process.on('SIGINT', sair);
}
