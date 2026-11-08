#!/usr/bin/env node
// Gera `telas/*.png` a partir de `fonte/*.dc.html` sem o runtime do canvas.
//
// O formato .dc.html tem um template (<x-dc>) com buracos {{a.b}}, blocos <sc-if value="{{x}}"> e handlers
// onClick="{{fn}}", mais um `class Component extends DCLogic` com `renderVals()`. Este script roda a classe em Node
// com um DCLogic mínimo, percorre os passos de cada tela (os botões `s1..sN` do canto, ou uma sequência explícita),
// resolve o template em HTML estático e fotografa cada estado com o chrome-headless-shell do Playwright.
//
// Uso: node docs/prototipos/times-e-apps/renderizar.mjs [--so J2] [--chrome <caminho>]

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';

const aqui = dirname(fileURLToPath(import.meta.url));
const fonte = join(aqui, 'fonte');
const telas = join(aqui, 'telas');
const tmp = join(aqui, '.render');
const args = process.argv.slice(2);
const so = args.includes('--so') ? args[args.indexOf('--so') + 1] : null;
const chrome = args.includes('--chrome')
  ? args[args.indexOf('--chrome') + 1]
  : acharChrome();

function acharChrome() {
  const base = join(homedir(), 'Library/Caches/ms-playwright');
  const dirs = readdirSync(base).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse();
  for (const d of dirs) {
    for (const sub of readdirSync(join(base, d))) {
      const bin = join(base, d, sub, 'chrome-headless-shell');
      try { readFileSync(bin); return bin; } catch {}
    }
  }
  throw new Error('chrome-headless-shell não encontrado; passe --chrome <caminho>');
}

// Sequências explícitas para as telas sem botões de passo (nome do handler ou [handler, ...]).
const sequencias = {
  'E4b-faixa-um-clique': [['goTime', 'conversa-do-time'], ['goQuadro', 'quadro'], ['goAda', 'ada-em-particular']],
  'E5-dez-bots-cinco-apps': [
    ['goTime', 'conversa-do-time'], ['togglePanel', 'painel-apps-e-membros'], ['go_quadro', 'quadro'],
    ['toggleMenu', 'menu-de-apps'], ['go_metricas', 'app-metricas'], ['goAda', 'ada-em-particular'],
  ],
};

class DCLogic {
  constructor(props) { this.props = props ?? {}; this.state = {}; }
  setState(patch) { Object.assign(this.state, patch); }
  forceUpdate() {}
}

function instanciar(src) {
  const m = src.match(/<script type="text\/x-dc" data-dc-script[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error('sem bloco data-dc-script');
  const Component = new Function('DCLogic', m[1] + '\nreturn Component;')(DCLogic);
  return new Component({});
}

function valor(vals, caminho) {
  let v = vals;
  for (const p of caminho.trim().split('.')) {
    if (v == null) return '';
    v = v[p];
  }
  if (typeof v === 'function') return '';
  if (v == null) return '';
  return v;
}

function resolver(template, vals) {
  // 1. <sc-if value="{{x}}" ...> ... </sc-if>, com aninhamento, por pilha
  let out = '';
  let i = 0;
  const pilha = []; // {keep, buf}
  const re = /<sc-if\b([^>]*)>|<\/sc-if>/g;
  let m;
  let ultimo = 0;
  const emitir = (s) => { if (pilha.length === 0) out += s; else pilha[pilha.length - 1].buf += s; };
  while ((m = re.exec(template))) {
    emitir(template.slice(ultimo, m.index));
    ultimo = re.lastIndex;
    if (m[0] === '</sc-if>') {
      const top = pilha.pop();
      if (top.keep) emitir(top.buf);
    } else {
      const v = m[1].match(/value="\{\{\s*([^}]+?)\s*\}\}"/);
      const keep = v ? !!valor(vals, v[1]) : true;
      pilha.push({ keep, buf: '' });
    }
  }
  emitir(template.slice(ultimo));
  let html = out;
  // 2. handlers viram nada
  html = html.replace(/\s(on[A-Z]\w*)="\{\{[^}]*\}\}"/g, '');
  // 3. buracos
  html = html.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, p) => String(valor(vals, p)));
  // 4. tags do canvas
  html = html.replace(/<\/?x-dc>/g, '').replace(/<\/?helmet>/g, '');
  html = html.replace(/<script src="\.\/support\.js"><\/script>/, '');
  // os passos e a dica são andaime do canvas; nas fotos, o README conta cada passo
  html = html.replace('</style>', '.steps,.hint{display:none !important}</style>');
  html = html.replace(/<script type="text\/x-dc"[\s\S]*?<\/script>/, '');
  return html;
}

function fotografar(html, png) {
  const arquivo = join(tmp, 'pagina.html');
  writeFileSync(arquivo, html);
  execFileSync(chrome, [
    '--headless', '--hide-scrollbars', '--disable-gpu', '--no-sandbox',
    '--window-size=1440,900', '--force-device-scale-factor=1', '--virtual-time-budget=4000',
    `--screenshot=${png}`, `file://${arquivo}`,
  ], { stdio: 'ignore' });
}

mkdirSync(telas, { recursive: true });
mkdirSync(tmp, { recursive: true });
const arquivos = readdirSync(fonte).filter((f) => f.endsWith('.dc.html')).sort();
const indice = [];
for (const f of arquivos) {
  const nome = f.replace('.dc.html', '');
  if (so && !nome.startsWith(so)) continue;
  const src = readFileSync(join(fonte, f), 'utf8');
  const comp = instanciar(src);
  const passos = [];
  const vals0 = comp.renderVals();
  if (sequencias[nome]) {
    for (const [h, rotulo] of sequencias[nome]) passos.push({ acao: h, rotulo });
  } else {
    const n = Object.keys(vals0).filter((k) => /^b\d+$/.test(k)).length;
    const rotulos = [...src.matchAll(/<button style="background:\{\{b(\d+)\}\}" onClick="\{\{s\d+b?\}\}">\d+ · ([^<]+)<\/button>/g)]
      .map((x) => x[2]);
    for (let i = 1; i <= n; i++) passos.push({ acao: null, passo: i, rotulo: rotulos[i - 1] ?? `passo ${i}` });
  }
  passos.forEach((p, idx) => {
    let vals = comp.renderVals();
    if (p.acao) { vals[p.acao](); }
    else { const fn = vals['s' + p.passo] ?? vals['s' + p.passo + 'b']; fn(); }
    vals = comp.renderVals();
    const html = resolver(src, vals);
    const slug = p.rotulo.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const png = join(telas, `${nome}-${String(idx + 1).padStart(2, '0')}-${slug}.png`);
    fotografar(html, png);
    indice.push({ tela: nome, passo: idx + 1, rotulo: p.rotulo, png: png.replace(aqui + '/', ''), dica: vals.hint ?? '' });
    process.stdout.write(`${nome} ${idx + 1}/${passos.length}\n`);
  });
}
writeFileSync(join(aqui, 'telas', 'indice.json'), JSON.stringify(indice, null, 2));
rmSync(tmp, { recursive: true, force: true });
