// NOD-117: os atalhos de teclado do nod e a folha deles (o bloco Ajuda de Configurações › Geral).
// Puro: quem lê o evento e age é o keydown global de web/main.ts; aqui só se decide o quê.
//
// O modificador muda com o lugar onde o nod roda, porque o navegador reserva ⌘N, ⌘1–9 e ⌘⇧[ ]:
//   app do Mac: ⌘ · navegador no Mac: ⌃ · navegador no Windows/Linux: Alt (a folha, nele, é Ctrl+/).

export type LugarTeclado = "app-mac" | "navegador-mac" | "outro";

/** O app do Mac é o desktop num Mac; o desktop fora do Mac segue as teclas do Windows/Linux. */
export function lugarDoTeclado(p: { desktop: boolean; plataforma: string }): LugarTeclado {
  const mac = /Mac|iPhone|iPad/.test(p.plataforma);
  if (!mac) return "outro";
  return p.desktop ? "app-mac" : "navegador-mac";
}

/** O lugar desta janela (nodDesktop existe só no app). Fora do navegador (testes), "outro". */
export function lugarAtual(): LugarTeclado {
  const g = globalThis as { nodDesktop?: unknown; navigator?: { platform?: string } };
  return lugarDoTeclado({ desktop: g.nodDesktop !== undefined, plataforma: g.navigator?.platform ?? "" });
}

/**
 * O que importa do KeyboardEvent; `code` é a posição física (Digit1, KeyN, BracketLeft, Slash). Quem chama copia os
 * campos do evento (o spread de um KeyboardEvent não copia os getters).
 */
export type Tecla = {
  code: string;
  /** Pode faltar: o autofill do Chrome manda keydown sem `key`. */
  key: string | undefined;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  keyCode?: number;
};

export type ContextoTecla = {
  lugar: LugarTeclado;
  /** O foco está num campo de texto (input, textarea, select, contenteditable). */
  emCampo: boolean;
  /** Há um diálogo aberto ou o foco está dentro de um. */
  dialogo: boolean;
  /** No celular não há atalhos (nem a folha mostra teclas). */
  celular: boolean;
  /**
   * Seu espaço aberto (ele é um diálogo modal, mas é a própria folha): só a folha age, e ela leva ao bloco Ajuda dentro
   * dele. Os atalhos que levariam a outro lugar ficam parados, como em qualquer diálogo (critério 7 da NOD-117).
   */
  espaco?: boolean;
  /** Ditado gravando: um atalho que troca de tela descartaria a gravação em silêncio. */
  ditando?: boolean;
  /** Foco num campo de edição da gaveta (memória, missão e voz…): ir a outro bot perderia o texto. */
  editando?: boolean;
};

export type AcaoAtalho =
  | { tipo: "novo-bot" }
  | { tipo: "ir-ao-bot"; n: number }
  | { tipo: "vizinho"; passo: 1 | -1 }
  | { tipo: "folha" };

type Mod = "meta" | "ctrl" | "alt";

const MOD_DE: Record<LugarTeclado, Mod> = { "app-mac": "meta", "navegador-mac": "ctrl", outro: "alt" };
const MOD_DA_FOLHA: Record<LugarTeclado, Mod> = { "app-mac": "meta", "navegador-mac": "ctrl", outro: "ctrl" };

/** Só o modificador pedido (sem os outros dois): Alt sem Ctrl deixa o AltGr do Windows de fora. */
function soCom(t: Tecla, mod: Mod): boolean {
  return t.metaKey === (mod === "meta") && t.ctrlKey === (mod === "ctrl") && t.altKey === (mod === "alt");
}

/** O atalho novo que a tecla pede, ou null (e aí o keydown segue como antes: ⌘K, ⌘⇧D, Esc…). */
export function atalhoDoTeclado(t: Tecla, c: ContextoTecla): AcaoAtalho | null {
  if (c.celular || c.dialogo || t.repeat || t.isComposing || t.keyCode === 229) return null;
  const a = acaoDaTecla(t, c);
  // Ditando, nada (nem a folha: o Esc que a fecharia descartaria a gravação). Em Seu espaço, só a folha e fora de campo
  // (num campo de renomear, ⌘/ trocaria de seção com o texto pela metade). Definido em 2026-10-28, NOD-117 critério 7.
  // Editando na gaveta, a folha (que abre por cima) pode; ir a outro lugar, não.
  if (a && (c.ditando || (c.espaco && (a.tipo !== "folha" || c.emCampo)) || (c.editando && a.tipo !== "folha"))) return null;
  return a;
}

function acaoDaTecla(t: Tecla, c: ContextoTecla): AcaoAtalho | null {
  const key = t.key ?? "";
  t = { ...t, key };
  // "?" sem modificador, só fora de campo: no campo de mensagem ele escreve "?".
  if (t.key === "?" && !t.metaKey && !t.ctrlKey && !t.altKey) return c.emCampo ? null : { tipo: "folha" };
  const mod = MOD_DE[c.lugar];
  // A folha com modificador vale mesmo no campo. "/" pelo caractere (ABNT2, DE, ES…: na posição Slash do DE fica o "-",
  // e Ctrl+- é o zoom); a posição Slash só quando o caractere não veio (tecla morta ou não identificada).
  const barra = key === "/" || (key.length !== 1 && t.code === "Slash" && !t.shiftKey);
  if (soCom(t, MOD_DA_FOLHA[c.lugar]) && barra) return { tipo: "folha" };
  if (!soCom(t, mod)) return null;
  if (!t.shiftKey) {
    if (t.code === "KeyN") return { tipo: "novo-bot" };
    const digito = /^Digit([1-9])$/.exec(t.code);
    if (digito) return { tipo: "ir-ao-bot", n: Number(digito[1]) };
    return null;
  }
  // Colchete: primeiro pelo caractere (no ABNT2 o "[" fica na tecla BracketRight), depois pela posição.
  if (t.key === "[" || t.key === "{") return { tipo: "vizinho", passo: -1 };
  if (t.key === "]" || t.key === "}") return { tipo: "vizinho", passo: 1 };
  if (t.code === "BracketLeft") return { tipo: "vizinho", passo: -1 };
  if (t.code === "BracketRight") return { tipo: "vizinho", passo: 1 };
  return null;
}

/** Uma linha da barra (fixado ou bot-row), como o DOM a mostra. */
export type LinhaDaBarra = {
  /** A seção recolhida a esconde (.escondida): não a conversa aberta nem quem tem alerta, que ela deixa à vista. */
  escondida: boolean;
  /** A busca da barra a escondeu (`hidden`, filtrarBots em web/main.ts). */
  oculta: boolean;
};

/**
 * Quais linhas contam, na ordem da barra: as à vista (critérios 2 e 3 da NOD-117). O bot que a seção recolhida esconde não
 * conta; o que ela deixa à vista (a conversa aberta, quem tem alerta) conta. Buscando, conta o que a busca mostra.
 */
export function linhasAVista<T extends LinhaDaBarra>(linhas: readonly T[], buscando: boolean): T[] {
  return linhas.filter((l) => !l.oculta && (buscando || !l.escondida));
}

/** Foco num campo de texto: aí o "?" escreve. Caixa de marcar, rádio, botão e controle deslizante não escrevem. */
export const SELETOR_CAMPO =
  "input:not([type='checkbox'], [type='radio'], [type='button'], [type='submit'], [type='reset'], [type='range'], [type='color'], [type='file']), textarea, select, [contenteditable]:not([contenteditable='false'])";

/**
 * Um diálogo por cima (definido em 2026-10-28, NOD-117 critério 7): o <dialog> aberto, os modais em div (Sair,
 * Desconectar, "Confirme que é você", a gaveta do Marketplace) e os popovers em div (avatar da gaveta, ação em lote).
 * Seu espaço (.cfg-espaco) entra pelo `espaco` do contexto, porque nele a folha ainda age. O Raio-X é um <dialog>
 * aberto com show() que fica ao lado como painel: não trava os atalhos. Sem `dialog:modal`, que quebra o querySelector
 * no Safari antes do 15.4.
 */
export const SELETOR_MODAL = 'dialog[open]:not(.raio-x), [role="dialog"]:not(.cfg-espaco)';

/** Uma linha da barra para o atalho: `atual` é o bot da conversa aberta (aria-current). */
export type LinhaDoAtalho = LinhaDaBarra & { atual: boolean };

/**
 * O índice (na lista inteira de linhas) do bot que o atalho pede, ou null quando não há alvo e a tecla segue livre.
 * Conta só as linhas à vista (linhasAVista).
 */
export function alvoDoAtalho(
  linhas: readonly LinhaDoAtalho[],
  a: { tipo: "ir-ao-bot"; n: number } | { tipo: "vizinho"; passo: 1 | -1 },
  buscando: boolean,
): number | null {
  const vista = linhasAVista(linhas.map((l, i) => ({ ...l, i })), buscando);
  const k = a.tipo === "ir-ao-bot"
    ? indiceDoBot(a.n, vista.length)
    : alvoVizinho(vista.length, vista.findIndex((l) => l.atual), a.passo);
  return k === null ? null : (vista[k]?.i ?? null);
}

/** O índice do bot n (1–9) numa lista de `total`, ou null se não há tantos. */
export function indiceDoBot(n: number, total: number): number | null {
  return Number.isInteger(n) && n >= 1 && n <= 9 && n <= total ? n - 1 : null;
}

/** O vizinho, dando a volta. Sem atual (fora da lista), o próximo é o 1º e o anterior é o último. */
export function alvoVizinho(total: number, atual: number, passo: 1 | -1): number | null {
  if (total <= 0) return null;
  if (atual < 0 || atual >= total) return passo === 1 ? 0 : total - 1;
  return (atual + passo + total) % total;
}

// ---- A folha (bloco Ajuda) e os rótulos ----------------------------------------------------------------------

const NOME: Record<Mod, Record<LugarTeclado, string>> = {
  meta: { "app-mac": "⌘", "navegador-mac": "⌘", outro: "Meta" },
  ctrl: { "app-mac": "⌃", "navegador-mac": "⌃", outro: "Ctrl" },
  alt: { "app-mac": "⌥", "navegador-mac": "⌥", outro: "Alt" },
};
const FALADO: Record<Mod, Record<LugarTeclado, string>> = {
  meta: { "app-mac": "Command", "navegador-mac": "Command", outro: "Meta" },
  ctrl: { "app-mac": "Control", "navegador-mac": "Control", outro: "Control" },
  alt: { "app-mac": "Option", "navegador-mac": "Option", outro: "Alt" },
};
const ARIA: Record<Mod, string> = { meta: "Meta", ctrl: "Control", alt: "Alt" };

export type LinhaDaFolha = {
  titulo: string;
  /** Uma ou mais combinações alternativas; cada uma é a sequência de teclas. */
  combinacoes: readonly (readonly string[])[];
  /** Para leitor de tela. */
  falado: string;
};

/** As 7 linhas da folha, nas teclas do lugar. ⌘K e ⌘⇧D aceitam ⌘ ou Ctrl: no Mac mostram ⌘, fora dele Ctrl. */
export function linhasDaFolha(lugar: LugarTeclado): LinhaDaFolha[] {
  const m = MOD_DE[lugar];
  const f = MOD_DA_FOLHA[lugar];
  const mac = lugar !== "outro";
  const shift = mac ? "⇧" : "Shift";
  const busca: Mod = mac ? "meta" : "ctrl";
  const k = (mod: Mod) => NOME[mod][lugar];
  const fala = (mod: Mod) => FALADO[mod][lugar];
  return [
    { titulo: "Nova conversa (novo bot)", combinacoes: [[k(m), "N"]], falado: `${fala(m)} N` },
    { titulo: "Ir ao bot 1 a 9 da barra", combinacoes: [[k(m), "1–9"]], falado: `${fala(m)} 1 a 9` },
    { titulo: "Bot anterior e próximo", combinacoes: [[k(m), shift, "["], [k(m), shift, "]"]], falado: `${fala(m)} Shift colchete esquerdo e ${fala(m)} Shift colchete direito` },
    { titulo: "Folha de atalhos", combinacoes: [["?"], [k(f), "/"]], falado: `Interrogação, ou ${fala(f)} barra` },
    { titulo: "Buscar agentes", combinacoes: [[k(busca), "K"]], falado: `${fala(busca)} K` },
    { titulo: "Modo dev", combinacoes: [[k(busca), shift, "D"]], falado: `${fala(busca)} Shift D` },
    { titulo: "Fechar e voltar", combinacoes: [["esc"]], falado: "Esc" },
  ];
}

/** O rótulo e o aria-keyshortcuts do + (Novo bot) no lugar. */
export function atalhoDoNovoBot(lugar: LugarTeclado): { texto: string; aria: string } {
  const m = MOD_DE[lugar];
  return { texto: lugar === "outro" ? `${NOME[m][lugar]}+N` : `${NOME[m][lugar]}N`, aria: `${ARIA[m]}+N` };
}
