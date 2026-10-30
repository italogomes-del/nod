/**
 * NOD-431, definido em 2026-10-30: o balão da pessoa ganha a cor do bot da conversa, com o texto sempre legível (WCAG AA, 4,5:1).
 *
 * As cores moram como literais em web/tokens.css (o único arquivo da web com cor literal, ADR-070); esta função é a
 * fonte de onde esses literais saem e o teste tests/unit/domain/contraste-do-balao.test.ts confere, para as 12 skins nos
 * dois temas, que o tokens.css tem exatamente o que ela calcula e que o contraste passa. Determinística: mesma entrada,
 * mesma saída, sem aleatório nem relógio.
 *
 * Regra:
 * 1. O balão precisa se separar da página (`surface`) e do balão do bot (`surface-raised`) por SEPARACAO_MINIMA; se não
 *    separa (creme no claro, preto no escuro), a luminosidade anda para longe deles primeiro.
 * 2. A tinta é a escura do tema claro (#18181b) ou o branco, a que tiver mais contraste com o fundo. Se a escura não
 *    passa e o preto puro passa (o violeta), a tinta é o preto: o critério só manda ajustar a cor quando nem preto nem
 *    branco chegam a 4,5:1.
 * 3. Só se nem assim o texto passar de 4,5:1, o fundo muda a luminosidade (HSL; matiz e saturação ficam, o tom do bot
 *    fica) em passos de 1%, para longe da tinta. O fundo do código é o balão 10% para longe da tinta (ou para perto
 *    dela, nas pontas em que o outro lado não separa o chip); nos dois casos o texto do chip passa de 4,5:1.
 */

export const CONTRASTE_MINIMO = 4.5;
/** Razão mínima entre o fundo do balão da pessoa e o do bot: abaixo disso as duas vozes voltam a parecer uma. */
export const SEPARACAO_MINIMA = 1.2;
/** Quanto o fundo do chip de comando se afasta do balão (para longe da tinta). */
export const MISTURA_DO_CODIGO = 0.1;
export const TINTA_ESCURA = "#18181b";
export const TINTA_CLARA = "#ffffff";
export const TINTA_PRETA = "#000000";

export interface CoresDoBalao {
  fundo: string;
  tinta: string;
  /** Fundo do chip de comando dentro do balão. */
  codigo: string;
}

type Rgb = readonly [number, number, number];

const hexParaRgb = (hex: string): Rgb => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new Error(`cor inválida: ${hex}`);
  const n = Number.parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const rgbParaHex = (rgb: Rgb): string => `#${rgb.map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, "0")).join("")}`;

/** Luminância relativa da WCAG 2.x. */
export function luminancia(hex: string): number {
  const [r, g, b] = hexParaRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Razão de contraste da WCAG entre duas cores, de 1 a 21. */
export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** Mistura em sRGB, como `color-mix(in srgb, b p, a)`. */
export function misturar(a: string, b: string, p: number): string {
  const [x, y] = [hexParaRgb(a), hexParaRgb(b)];
  const canal = (i: 0 | 1 | 2): number => x[i] * (1 - p) + y[i] * p;
  return rgbParaHex([canal(0), canal(1), canal(2)]);
}

const paraHsl = (hex: string): [number, number, number] => {
  const [r, g, b] = hexParaRgb(hex).map((c) => c / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h / 6, s, l];
};

const deHsl = (h: number, s: number, l: number): string => {
  if (s === 0) return rgbParaHex([l * 255, l * 255, l * 255]);
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const canal = (t0: number): number => {
    const t = t0 < 0 ? t0 + 1 : t0 > 1 ? t0 - 1 : t0;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return rgbParaHex([canal(h + 1 / 3) * 255, canal(h) * 255, canal(h - 1 / 3) * 255]);
};

const comLuminosidade = (hex: string, l: number): string => {
  const [h, s] = paraHsl(hex);
  return deHsl(h, s, Math.min(1, Math.max(0, l)));
};

/** Razão mínima entre o chip e o balão, para o chip não sumir. */
const SEPARACAO_DO_CHIP = 1.1;

/**
 * O fundo do chip: 10% para longe da tinta, que nunca tem menos contraste que o balão. Nas pontas (balão quase preto ou
 * quase branco) esse lado não separa o chip do balão, e ele vai 10% para o lado da tinta; o contraste é conferido no
 * passo 3 de coresDoBalao.
 */
const codigoDe = (fundo: string, tinta: string): string => {
  const longe = misturar(fundo, luminancia(tinta) < 0.5 ? TINTA_CLARA : TINTA_PRETA, MISTURA_DO_CODIGO);
  return contraste(longe, fundo) >= SEPARACAO_DO_CHIP ? longe : misturar(fundo, tinta, MISTURA_DO_CODIGO);
};

/** Matiz HSL em graus (0 a 360); um cinza devolve 0. */
export function matiz(hex: string): number {
  return paraHsl(hex)[0] * 360;
}

/**
 * As cores do balão da pessoa para uma cor de bot, contra o que está em volta dele no tema: a página (`surface`) e o
 * balão do bot (`surface-raised`). Lança se não achar: uma skin nova que caia aqui precisa de decisão de design.
 */
export function coresDoBalao(corDoBot: string, balaoDoBot: string, pagina: string): CoresDoBalao {
  const separa = (f: string): boolean => Math.min(contraste(f, balaoDoBot), contraste(f, pagina)) >= SEPARACAO_MINIMA;
  const passa = (f: string, t: string): boolean => contraste(f, t) >= CONTRASTE_MINIMO && contraste(codigoDe(f, t), t) >= CONTRASTE_MINIMO;
  const [, , l0] = paraHsl(corDoBot);
  // 1. Separar do que está em volta: no tema claro escurece, no escuro clareia.
  const temaClaro = luminancia(pagina) > 0.18;
  let fundo = corDoBot.toLowerCase();
  for (let i = 1; !separa(fundo); i++) {
    if (i > 100) throw new Error(`sem separação para ${corDoBot}`);
    fundo = comLuminosidade(corDoBot, l0 + (temaClaro ? -i : i) / 100);
  }
  // 2. A tinta com mais contraste; o preto puro antes de mexer na cor do bot.
  const melhor = contraste(fundo, TINTA_ESCURA) >= contraste(fundo, TINTA_CLARA) ? TINTA_ESCURA : TINTA_CLARA;
  const tinta = !passa(fundo, melhor) && passa(fundo, TINTA_PRETA) ? TINTA_PRETA : melhor;
  // 3. Só se nem assim passar: afastar da tinta, sem perder a separação.
  const [, , l1] = paraHsl(fundo);
  const base = fundo;
  for (let i = 1; !passa(fundo, tinta) || !separa(fundo); i++) {
    if (i > 100) throw new Error(`sem contraste para ${corDoBot}`);
    fundo = comLuminosidade(base, l1 + (luminancia(tinta) < 0.5 ? i : -i) / 100);
  }
  return { fundo, tinta, codigo: codigoDe(fundo, tinta) };
}
