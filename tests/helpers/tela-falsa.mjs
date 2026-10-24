// NOD-96 PR 7 (definido em 2026-10-22, ADR-122): a tela do supervisor sem Xvfb nem Chromium, para o e2e local.
// Fala o MESMO protocolo IPC de infra/computador/tela.mjs (abrir/pronta, acao/resposta, cookies, repasse,
// limpar_cookies, fechar/fechada) e guarda os cookies num pote em memória, como o contexto do Playwright faria.
//
// O "site" é a URL: `?entrar=nome:valor` grava o cookie no host (o login), `?sair=nome` apaga. A resposta de toda ação
// é a tela, com `texto` = os cookies do host atual em JSON — é assim que o teste vê se a tela está logada.
// NOD_TELA_FALSA_ATRASO_MS segura o `pronta` (o boot lento); NOD_TELA_FALSA_ACAO_MS segura cada ação.
import { randomBytes } from 'node:crypto';
import process from 'node:process';
import { setTimeout } from 'node:timers';
import { URL } from 'node:url';
import { chaveDoCookie, diffDeCookies } from '../../infra/computador/loja-cookies.mjs';

const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
const ATRASO_ABRIR = Number(process.env.NOD_TELA_FALSA_ATRASO_MS ?? 0);
const ATRASO_ACAO = Number(process.env.NOD_TELA_FALSA_ACAO_MS ?? 0);

let config = null;
let url = 'about:blank';
/** chave do cookie → cookie (a forma do Playwright). */
let pote = new Map();
let conhecidos = new Map();
const enviar = (m) => process.send?.(m);

function host() {
  try { return new URL(url).hostname; } catch { return ''; }
}

function tela() {
  const h = host();
  const doHost = [...pote.values()].filter((c) => h && (c.domain === h || c.domain === `.${h}` || h.endsWith(c.domain))).map((c) => ({ name: c.name, value: c.value }));
  return {
    quadro: randomBytes(32).toString('hex'), imagem: 'iVBORw0KGgo=', largura: 1280, altura: 800, url, titulo: `${h || 'about:blank'} (${config?.agenteId})`,
    texto: JSON.stringify(doHost.sort((a, b) => a.name.localeCompare(b.name))), abas: [{ url, titulo: h, ativa: true }],
  };
}

/** Manda ao supervisor o que mudou desde a última foto (como mandarCookies da tela real). */
function mandarCookies() {
  const agora = [...pote.values()];
  const diff = diffDeCookies([...conhecidos.values()], agora);
  conhecidos = new Map(agora.map((c) => [chaveDoCookie(c), c]));
  if (diff.postos.length || diff.removidos.length) enviar({ tipo: 'cookies', diff, em: Date.now() });
}

function navegar(destino) {
  const u = new URL(destino);
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('url');
  url = u.toString();
  const entrar = u.searchParams.get('entrar');
  if (entrar) {
    const [name, value] = entrar.split(':');
    const c = { name, value, domain: u.hostname, path: '/', expires: -1, httpOnly: true, secure: true, sameSite: 'Lax' };
    pote.set(chaveDoCookie(c), c);
  }
  const sair = u.searchParams.get('sair');
  if (sair) for (const [k, c] of pote) if (c.name === sair && c.domain === u.hostname) pote.delete(k);
}

process.on('disconnect', () => process.exit(0));
process.on('message', async (m) => {
  try {
    if (m.tipo === 'abrir') {
      config = m.config;
      for (const c of config.cookies ?? []) pote.set(chaveDoCookie(c), c);
      conhecidos = new Map(pote);
      await esperar(ATRASO_ABRIR);
      enviar({ tipo: 'pronta' });
    } else if (m.tipo === 'acao') {
      // Como na tela real (o finally de executar), os cookies saem ANTES da resposta.
      let resposta;
      try {
        await esperar(ATRASO_ACAO);
        if (m.acao.tipo === 'navegar') navegar(m.acao.url);
        else if (m.acao.tipo !== 'observar') throw new Error('acao');
        resposta = { tipo: 'resposta', id: m.id, resultado: { tela: tela() } };
      } catch (e) {
        resposta = { tipo: 'resposta', id: m.id, erro: 'acao_falhou', detalhe: String(e?.message) };
      }
      mandarCookies();
      enviar(resposta);
    } else if (m.tipo === 'repasse') {
      for (const r of m.removidos ?? []) { pote.delete(chaveDoCookie(r)); conhecidos.delete(chaveDoCookie(r)); }
      for (const c of m.postos ?? []) { pote.set(chaveDoCookie(c), c); conhecidos.set(chaveDoCookie(c), c); }
    } else if (m.tipo === 'limpar_cookies') {
      pote = new Map();
      conhecidos = new Map();
      enviar({ tipo: 'resposta', id: m.id, resultado: {} });
    } else if (m.tipo === 'fechar') {
      mandarCookies();
      enviar({ tipo: 'fechada' });
      setTimeout(() => process.exit(0), 20);
    }
  } catch (e) {
    if (m.id) enviar({ tipo: 'resposta', id: m.id, erro: 'acao_falhou', detalhe: String(e?.message) });
  }
});
