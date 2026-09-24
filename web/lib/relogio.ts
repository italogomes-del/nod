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

/** O dia civil do instante no fuso (AAAA-MM-DD): o "hoje" e o "ontem" são do fuso da rotina, não de UTC. */
function diaNoFuso(t: number, fusoIana: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: fusoIana, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
}

/**
 * 'hoje 08:00', 'ontem 13:00', '22/09 18:00' — o dia relativo a `agora`, no fuso dado. definido em
 * 2026-09-24 (emenda da ADR-044): as janelas que a rotina parada não rodou, contadas pela pessoa em dias
 * de calendário, não em "há 19h".
 */
export function quandoCurto(instante: EpochMs, agora: number, fusoIana = "UTC"): string {
  const dia = diaNoFuso(instante, fusoIana);
  const hora = horaMinuto(instante, fusoIana);
  if (dia === diaNoFuso(agora, fusoIana)) return `hoje ${hora}`;
  if (dia === diaNoFuso(agora - DIA, fusoIana)) return `ontem ${hora}`;
  const [, mes = "", d = ""] = dia.split("-");
  return `${d}/${mes} ${hora}`;
}

/** 'desde ontem 13:00' — o card da rotina parada (emenda da ADR-044). */
export function desdeQuando(instante: EpochMs, agora: number, fusoIana = "UTC"): string {
  return `desde ${quandoCurto(instante, agora, fusoIana)}`;
}

/**
 * 'ontem 13:00, ontem 18:00 e hoje 08:00' — em ordem, da mais antiga para a mais nova. Passou de
 * `maximo`, conta e dá as pontas: uma rotina de 5 em 5 min parada há um dia não vira um parágrafo.
 */
export function listaDeJanelas(instantes: readonly EpochMs[], agora: number, fusoIana = "UTC", maximo = 6): string {
  const textos = [...instantes].sort((a, b) => a - b).map((t) => quandoCurto(t, agora, fusoIana));
  const primeira = textos[0] ?? "";
  const ultima = textos[textos.length - 1] ?? "";
  if (textos.length > maximo) return `${textos.length} janelas, de ${primeira} a ${ultima}`;
  return textos.length <= 1 ? primeira : `${textos.slice(0, -1).join(", ")} e ${ultima}`;
}

/** Item ESCRITO da fila (E3.3): 'claude-cli fora do ar desde 14:03'. */
export function foraDoArDesde(nome: string, desde: EpochMs, fusoIana = "UTC"): string {
  return `${nome} fora do ar desde ${horaMinuto(desde, fusoIana)}`;
}

/** Carimbo da fila vazia (E3.3): nunca uma área em branco. */
export function nadaEsperando(ultimaDecisaoEm: IsoUtc | null, agora: number): string {
  return ultimaDecisaoEm === null ? "Nada esperando por você · nenhuma decisão até agora" : `Nada esperando por você · última decisão ${interpolar(ultimaDecisaoEm, agora)}`;
}
