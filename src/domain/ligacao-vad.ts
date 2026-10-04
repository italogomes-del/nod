import { QUADRO_MS } from "../contracts/voz.ts";

/**
 * VAD por energia sobre os quadros PCM16 de 20 ms do microfone (protocolo nod-voz/1). Diz quando a fala começa e
 * quando há silêncio; quem decide o FIM DA VEZ é `esperaDeFimDeTurno` (ligacao-turno.ts), que olha o texto. O tempo
 * vem de fora (`agoraMs` = seq × 20 ms), nunca do relógio.
 */

/** Energia RMS do quadro, de 0 (silêncio) a 1 (escala cheia). */
export function energiaRms(q: Int16Array): number {
  if (q.length === 0) return 0;
  let soma = 0;
  for (const amostra of q) {
    const x = amostra / 32768;
    soma += x * x;
  }
  return Math.min(1, Math.sqrt(soma / q.length));
}

export type OpcoesVad = {
  /** Quadros seguidos acima do limiar para dizer que a fala começou. */
  quadrosParaInicio?: number;
  /** Silêncio contínuo para emitir `fim`. */
  silencioParaFimMs?: number;
  /** Limiar mínimo absoluto, por mais silencioso que seja o fundo. */
  limiarMinimo?: number;
  /** O limiar é o piso de ruído vezes este fator. */
  fatorSobrePiso?: number;
  /** Multiplica o limiar enquanto o bot fala (o eco do alto-falante não pode disparar). */
  fatorBotFalando?: number;
  /** Peso de cada quadro na média móvel do piso quando ele sobe (descer é rápido). */
  alfaPiso?: number;
  /** Janela do mínimo de energia que o piso persegue. */
  janelaPisoMs?: number;
  /** Duração de um quadro. */
  quadroMs?: number;
};

/**
 * definido em 2026-10-04: 3 quadros (60 ms) para o início, como o worklet; 600 ms de silêncio para o fim; limiar
 * mínimo 0,01 (≈ −40 dBFS); 3× o piso; 2,5× com o bot falando; o piso persegue o MÍNIMO de energia dos últimos 2 s
 * (entre uma palavra e outra a energia cai ao fundo), com média móvel de peso 0,05 (≈ 400 ms de memória).
 */
export const OPCOES_VAD_PADRAO: Required<OpcoesVad> = {
  quadrosParaInicio: 3,
  silencioParaFimMs: 600,
  limiarMinimo: 0.01,
  fatorSobrePiso: 3,
  fatorBotFalando: 2.5,
  alfaPiso: 0.05,
  janelaPisoMs: 2000,
  quadroMs: QUADRO_MS,
};

/** definido em 2026-10-04: histerese — durante a fala, o quadro conta como voz até 75% do limiar, para não picotar. */
const HISTERESE = 0.75;

/**
 * definido em 2026-10-04 (análise do Buzz, que exige 192 ms): um trecho com menos que isto de quadros com voz é ruído
 * (tosse, batida, estalo, eco curto) — não vai ao STT, que transcreveria uma palavra inventada. 160 ms e não 192 porque
 * "sim" e "não" ditos rápido em pt-BR ficam perto de 200 ms.
 */
export const VOZ_MINIMA_MS = 160;

export type EventoVad = { tipo: "inicio"; em: number } | { tipo: "fim"; em: number; duracaoMs: number; vozMs: number };

export type Vad = {
  /** Processa um quadro que começa em `agoraMs`; devolve o evento que ele provocou, se houver. */
  passo(q: Int16Array, agoraMs: number): EventoVad | null;
  /** Há quanto tempo (ms) os quadros estão em silêncio seguido. */
  silencioMs(): number;
  falando(): boolean;
  definirBotFalando(b: boolean): void;
  /** Troca o fator do limiar com o bot falando (com fone não há eco: o limiar pode ficar mais perto do normal). */
  definirFatorBotFalando(f: number): void;
  /** Limiar em uso agora (já com o fator do bot falando). */
  limiar(): number;
  /** Piso de ruído estimado. */
  piso(): number;
};

export function criarVad(opcoes: OpcoesVad = {}): Vad {
  const o: Required<OpcoesVad> = { ...OPCOES_VAD_PADRAO, ...opcoes };
  let fatorBotFalando = o.fatorBotFalando;
  let piso = 0;
  let botFalando = false;
  let falando = false;
  let seguidosComVoz = 0;
  let primeiroComVozEm = 0;
  let inicioEm = 0;
  let fimDaVozEm = 0;
  let seguidosEmSilencio = 0;
  let quadrosComVoz = 0;
  const recentes: number[] = [];
  const quadrosNaJanela = Math.max(1, Math.round(o.janelaPisoMs / o.quadroMs));

  /**
   * definido em 2026-10-04: o piso só aprende com o bot calado (o eco subiria o piso e a pessoa teria de gritar
   * depois). Desce rápido (0,3); sobe devagar e, durante a fala, só depois de uma janela inteira — assim a voz do
   * começo não vira piso, mas um ruído constante que disparou "fala" (ventilador ligado) vira piso em ~2 s.
   */
  const aprenderPiso = (e: number, agoraMs: number) => {
    if (botFalando) return;
    recentes.push(e);
    if (recentes.length > quadrosNaJanela) recentes.shift();
    const alvo = Math.min(...recentes);
    const podeSubir = !falando || agoraMs - inicioEm >= o.janelaPisoMs;
    if (alvo < piso) piso += (alvo - piso) * 0.3;
    else if (podeSubir) piso += (alvo - piso) * o.alfaPiso;
  };

  const limiar = (): number => Math.max(o.limiarMinimo, piso * o.fatorSobrePiso) * (botFalando ? fatorBotFalando : 1);

  return {
    passo(q, agoraMs) {
      const e = energiaRms(q);
      const l = limiar();
      const comVoz = e >= (falando ? l * HISTERESE : l);
      aprenderPiso(e, agoraMs);
      if (comVoz) {
        seguidosEmSilencio = 0;
        fimDaVozEm = agoraMs + o.quadroMs;
        if (falando) {
          quadrosComVoz++;
          return null;
        }
        if (seguidosComVoz === 0) primeiroComVozEm = agoraMs;
        seguidosComVoz++;
        if (seguidosComVoz < o.quadrosParaInicio) return null;
        falando = true;
        quadrosComVoz = seguidosComVoz;
        inicioEm = primeiroComVozEm;
        return { tipo: "inicio", em: inicioEm };
      }
      seguidosComVoz = 0;
      seguidosEmSilencio++;
      if (falando && seguidosEmSilencio * o.quadroMs >= o.silencioParaFimMs) {
        falando = false;
        return { tipo: "fim", em: fimDaVozEm, duracaoMs: fimDaVozEm - inicioEm, vozMs: quadrosComVoz * o.quadroMs };
      }
      return null;
    },
    silencioMs: () => seguidosEmSilencio * o.quadroMs,
    falando: () => falando,
    definirBotFalando(b) {
      botFalando = b;
    },
    definirFatorBotFalando(f) {
      fatorBotFalando = f;
    },
    limiar,
    piso: () => piso,
  };
}
