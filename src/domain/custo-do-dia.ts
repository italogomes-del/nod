import type { CustoDoBotHoje } from "../contracts/cota.ts";
import type { EpochMs } from "../contracts/ids.ts";

/**
 * O custo de cada bot hoje e o aviso de ritmo (definido em 2026-10-12, ADR-099 §7: "custo visível, sem teto"). Puro: `agora`
 * e o fuso por parâmetro. Nada aqui segura trabalho — é só o que a tela Trabalhos mostra atrás de um clique.
 *
 * A regra do aviso: o gasto de HOJE até agora passa de 2× a média dos 7 dias anteriores, cada um somado da meia-noite
 * até o MESMO horário (no fuso da pessoa), e passa do piso de US$ 1. Dias sem gasto contam como zero na média (um bot
 * parado ontem puxa a média para baixo, de propósito: o ritmo é o do bot, não o dos dias em que ele trabalhou). Sem
 * média (nenhum gasto nos 7 dias), não há aviso: falta com que comparar.
 */

/** definido em 2026-10-12: o aviso sai acima de 2× a média do mesmo horário. */
export const VEZES_FORA_DO_RITMO = 2;
/** definido em 2026-10-12: abaixo de US$ 1 no dia não há aviso (centavos dobrando não são ritmo). */
export const PISO_DO_AVISO_USD = 1;
/** Os 7 dias anteriores. */
export const DIAS_DA_MEDIA = 7;

const DIA_MS = 86_400_000;

/** O fuso IANA aceito pelo Intl; o que não for vira o padrão. */
export function fusoValido(fuso: string | null | undefined, padrao: string): string {
  if (!fuso || fuso.length > 64) return padrao;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: fuso });
    return fuso;
  } catch {
    return padrao;
  }
}

/** Quanto o relógio do fuso está à frente do UTC no instante (ms; -3 h em São Paulo). */
function deslocamento(instante: EpochMs, fuso: string): number {
  const partes = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: fuso, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(new Date(instante))
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, Number(p.value)]),
  ) as Record<string, number>;
  const comoUtc = Date.UTC(partes["year"]!, partes["month"]! - 1, partes["day"]!, partes["hour"]!, partes["minute"]!, partes["second"]!);
  return comoUtc - Math.floor(instante / 1000) * 1000;
}

/** A meia-noite (00:00 no fuso) do dia que contém `instante`. Com horário de verão, corrige pelo deslocamento da meia-noite. */
export function meiaNoiteNoFuso(instante: EpochMs, fuso: string): EpochMs {
  const local = instante + deslocamento(instante, fuso);
  const meiaNoiteLocal = Math.floor(local / DIA_MS) * DIA_MS;
  const palpite = meiaNoiteLocal - deslocamento(instante, fuso);
  return meiaNoiteLocal - deslocamento(palpite, fuso);
}

/**
 * As janelas a somar: a de hoje (da meia-noite até agora) e, para cada um dos 7 dias anteriores, da meia-noite dele até o
 * mesmo tempo decorrido. A primeira é hoje.
 */
export function janelasDoDia(agora: EpochMs, fuso: string): { inicio: EpochMs; fim: EpochMs }[] {
  const hoje = meiaNoiteNoFuso(agora, fuso);
  const decorrido = agora - hoje;
  const janelas = [{ inicio: hoje, fim: agora }];
  for (let d = 1; d <= DIAS_DA_MEDIA; d++) {
    // Meio-dia do dia anterior, para o horário de verão não empurrar a conta para o dia errado.
    const inicio = meiaNoiteNoFuso(hoje - d * DIA_MS + DIA_MS / 2, fuso);
    janelas.push({ inicio, fim: inicio + decorrido });
  }
  return janelas;
}

/** O ritmo de um bot: `hoje` e os gastos dos 7 dias anteriores no mesmo horário (faltando dia, conta zero). */
export function ritmoDoBot(hojeUsd: number, anteriores: readonly number[]): Pick<CustoDoBotHoje, "mediaUsd" | "vezes" | "foraDoRitmo"> {
  const soma = anteriores.slice(0, DIAS_DA_MEDIA).reduce((s, v) => s + (Number.isFinite(v) ? v : 0), 0);
  const mediaUsd = soma / DIAS_DA_MEDIA;
  const vezes = mediaUsd > 0 ? hojeUsd / mediaUsd : null;
  return { mediaUsd, vezes, foraDoRitmo: vezes !== null && hojeUsd >= PISO_DO_AVISO_USD && vezes > VEZES_FORA_DO_RITMO };
}

/**
 * Os bots do dia a partir das somas por (bot, janela) — janela 0 é hoje, 1 a 7 os dias anteriores. Entra quem gastou hoje
 * ou está fora do ritmo, do que mais gastou ao que menos.
 */
export function custoDosBots(somas: readonly { agenteId: string; janela: number; usd: number }[]): CustoDoBotHoje[] {
  const porBot = new Map<string, number[]>();
  for (const s of somas) {
    if (s.janela < 0 || s.janela > DIAS_DA_MEDIA) continue;
    const linha = porBot.get(s.agenteId) ?? new Array<number>(DIAS_DA_MEDIA + 1).fill(0);
    linha[s.janela] = (linha[s.janela] ?? 0) + s.usd;
    porBot.set(s.agenteId, linha);
  }
  return [...porBot.entries()]
    .map(([agenteId, linha]) => ({ agenteId, hojeUsd: linha[0] ?? 0, ...ritmoDoBot(linha[0] ?? 0, linha.slice(1)) }))
    .filter((b) => b.hojeUsd > 0 || b.foraDoRitmo)
    .sort((a, b) => b.hojeUsd - a.hojeUsd || a.agenteId.localeCompare(b.agenteId));
}
