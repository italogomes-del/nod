import { ErroDeDominio } from "./erro.ts";

/**
 * Erro de rotina com código fechado: fuso_invalido | cron_sem_futuro | entrada_invalida.
 * A prosa de diagnóstico fica em `cause`, nunca sai na resposta (ADR-002/004).
 */
export class RotinaInvalida extends ErroDeDominio {
  constructor(codigo: "fuso_invalido" | "cron_sem_futuro" | "entrada_invalida", detalhe: string) {
    super(codigo, { cause: detalhe });
    this.name = "RotinaInvalida";
  }
}

/** Offset numérico é recusado ANTES de perguntar ao Intl: "UTC-3", "-03:00", "GMT+3" (ADR-011). */
function pareceOffset(fuso: string): boolean {
  const f = fuso.trim();
  if (f === "") return true;
  for (const c of f) if (c === "+" || c === "-" || (c >= "0" && c <= "9")) return true;
  return false;
}

export function assertFusoIana(fusoIana: string): void {
  if (pareceOffset(fusoIana)) {
    throw new RotinaInvalida("fuso_invalido", "offset numérico ou fuso vazio; use um nome IANA como America/Sao_Paulo");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: fusoIana }).format(new Date(0));
  } catch {
    throw new RotinaInvalida("fuso_invalido", `fuso IANA desconhecido: ${fusoIana}`);
  }
}

export type CampoCron = {
  minuto: number;
  hora: number;
  diasMes: "*" | number[];
  mes: "*" | number[];
  diasSemana: "*" | number[] | "uteis";
};

function inteiroEntre(s: string, min: number, max: number): number | null {
  if (s === "" || !/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= min && n <= max ? n : null;
}

function listaOuAsterisco(campo: string, min: number, max: number, rotulo: string): "*" | number[] {
  if (campo === "*") return "*";
  const valores = campo.split(",").map((p) => inteiroEntre(p, min, max));
  if (valores.some((v) => v === null)) throw new RotinaInvalida("entrada_invalida", `${rotulo} cron inválido`);
  return valores as number[];
}

/** Só valida/normaliza dado tipado (Regra 9): cron de 5 campos com minuto/hora fixos, listas em dia/mês/semana. */
export function parseCron5(cron: string): CampoCron {
  const partes = cron.trim().split(/\s+/);
  if (partes.length !== 5) throw new RotinaInvalida("entrada_invalida", "a expressão precisa ter 5 campos cron");
  const [minutoS, horaS, diaMesS, mesS, diaSemS] = partes as [string, string, string, string, string];
  const minuto = inteiroEntre(minutoS, 0, 59);
  const hora = inteiroEntre(horaS, 0, 23);
  if (minuto === null) throw new RotinaInvalida("entrada_invalida", "minuto cron inválido");
  if (hora === null) throw new RotinaInvalida("entrada_invalida", "hora cron inválida");
  let diasSemana: CampoCron["diasSemana"];
  if (diaSemS === "1-5") diasSemana = "uteis";
  else diasSemana = listaOuAsterisco(diaSemS, 0, 6, "dia da semana");
  return {
    minuto,
    hora,
    diasMes: listaOuAsterisco(diaMesS, 1, 31, "dia do mês"),
    mes: listaOuAsterisco(mesS, 1, 12, "mês"),
    diasSemana,
  };
}

type PartesZona = { y: number; mo: number; d: number; h: number; mi: number; w: number };

function partesNoFuso(agora: number, fusoIana: string): PartesZona {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: fusoIana,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const parts = fmt.formatToParts(new Date(agora));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const week: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const w = week[get("weekday")] ?? 0;
  return {
    y: Number(get("year")),
    mo: Number(get("month")),
    d: Number(get("day")),
    h: Number(get("hour")),
    mi: Number(get("minute")),
    w,
  };
}

function instanteNoFuso(p: { y: number; mo: number; d: number; h: number; mi: number }, fusoIana: string): number {
  const naive = Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, 0);
  const asIf = partesNoFuso(naive, fusoIana);
  const naiveThere = Date.UTC(asIf.y, asIf.mo - 1, asIf.d, asIf.h, asIf.mi, 0);
  const shift = naive - naiveThere;
  return naive + shift;
}

/**
 * Corrigido em 2026-09-16: a versão anterior ignorava diasMes e mes (mapa-codigo achado 5),
 * então "0 8 1 * *" disparava todo dia. Agora os cinco campos contam.
 */
function casa(cron: CampoCron, p: PartesZona): boolean {
  if (p.mi !== cron.minuto || p.h !== cron.hora) return false;
  if (cron.diasMes !== "*" && !cron.diasMes.includes(p.d)) return false;
  if (cron.mes !== "*" && !cron.mes.includes(p.mo)) return false;
  if (cron.diasSemana === "uteis") return p.w >= 1 && p.w <= 5;
  if (cron.diasSemana !== "*") return cron.diasSemana.includes(p.w);
  return true;
}

/** definido em 2026-09-16: 400 dias cobre qualquer combinação válida de dia/mês (ex.: 29/02 a cada 4 anos NÃO cabe e é recusada). */
const TETO_BUSCA_DIAS = 400;

/**
 * Instante canônico da próxima janela: o horário agendado do próprio cron, não o agora.
 * Dois processos com a mesma entrada chegam ao mesmo valor (ADR-011 / E7.6).
 */
export function proximaJanela(entrada: { cron: string; fusoIana: string; agora: number }): number {
  assertFusoIana(entrada.fusoIana);
  const cron = parseCron5(entrada.cron);
  const teto = entrada.agora + TETO_BUSCA_DIAS * 24 * 60 * 60 * 1000;
  let cursor = entrada.agora;
  const p0 = partesNoFuso(cursor, entrada.fusoIana);
  cursor = instanteNoFuso({ y: p0.y, mo: p0.mo, d: p0.d, h: cron.hora, mi: cron.minuto }, entrada.fusoIana);
  if (cursor <= entrada.agora) cursor += 24 * 60 * 60 * 1000;
  while (cursor < teto) {
    const p = partesNoFuso(cursor, entrada.fusoIana);
    const cand = instanteNoFuso({ y: p.y, mo: p.mo, d: p.d, h: cron.hora, mi: cron.minuto }, entrada.fusoIana);
    if (cand > entrada.agora && casa(cron, partesNoFuso(cand, entrada.fusoIana))) return cand;
    cursor += 24 * 60 * 60 * 1000;
  }
  throw new RotinaInvalida("cron_sem_futuro", "essa periodicidade não tem execução futura em 400 dias");
}
