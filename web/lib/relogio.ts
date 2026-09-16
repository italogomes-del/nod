import type { EpochMs, IsoUtc } from "../../src/contracts/ids.ts";

/**
 * O servidor manda instante ABSOLUTO em UTC; o cliente só interpola (ADR-007). Nada aqui lê
 * Date.now(): `agora` chega por parâmetro para o texto ser determinístico e testável.
 * definido em 2026-09-16: minutos abaixo de 1 h, horas até 48 h (arredondadas), dias depois —
 * "aguardando há 6h", "recusa automática em 18h" (E3.2).
 */
const MIN = 60_000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

export function duracaoCurta(ms: number): string {
  const abs = Math.max(0, ms);
  if (abs < MIN) return "menos de 1 min";
  if (abs < HORA) return `${Math.floor(abs / MIN)} min`;
  if (abs < 2 * DIA) return `${Math.round(abs / HORA)}h`;
  return `${Math.round(abs / DIA)} d`;
}

/** 'há 6h' — para aguardandoHaMs. */
export function haQuanto(ms: number): string {
  return ms < MIN ? "agora" : `há ${duracaoCurta(ms)}`;
}

/** 'em 18h' — para recusaAutomaticaEmMs; zero ou negativo = já passou. */
export function emQuanto(ms: number): string {
  return ms <= 0 ? "agora" : `em ${duracaoCurta(ms)}`;
}

/** Instante ISO UTC contra `agora`: passado vira 'há …', futuro vira 'em …'. */
export function interpolar(instante: IsoUtc | EpochMs, agora: number): string {
  const t = typeof instante === "number" ? instante : Date.parse(instante);
  if (Number.isNaN(t)) return "instante inválido";
  const delta = t - agora;
  return delta >= 0 ? emQuanto(delta) : haQuanto(-delta);
}

/** 'HH:MM' no fuso da pessoa (default UTC). */
export function horaMinuto(instante: IsoUtc | EpochMs, fusoIana = "UTC"): string {
  const t = typeof instante === "number" ? instante : Date.parse(instante);
  return new Intl.DateTimeFormat("pt-BR", { timeZone: fusoIana, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
}

/** Item ESCRITO da fila (E3.3): 'claude-cli fora do ar desde 14:03'. */
export function foraDoArDesde(nome: string, desde: EpochMs, fusoIana = "UTC"): string {
  return `${nome} fora do ar desde ${horaMinuto(desde, fusoIana)}`;
}

/** Carimbo da fila vazia (E3.3): nunca uma área em branco. */
export function nadaEsperando(ultimaDecisaoEm: IsoUtc | null, agora: number): string {
  return ultimaDecisaoEm === null ? "Nada esperando por você · nenhuma decisão até agora" : `Nada esperando por você · última decisão ${interpolar(ultimaDecisaoEm, agora)}`;
}
