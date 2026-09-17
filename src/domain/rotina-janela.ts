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
  minuto: number[];
  hora: number[];
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

/** definido em 2026-09-17: passo cron é ancorado no relógio, nunca no momento da última execução. */
function horarios(campo: string, max: number): number[] {
  if (campo === "*") return Array.from({ length: max + 1 }, (_, i) => i);
  if (campo.startsWith("*/")) {
    const passo = inteiroEntre(campo.slice(2), 1, max + 1);
    if (passo === null) throw new RotinaInvalida("entrada_invalida", "passo cron inválido");
    return Array.from({ length: Math.ceil((max + 1) / passo) }, (_, i) => i * passo);
  }
  const lista = listaOuAsterisco(campo, 0, max, "horário");
  return lista === "*" ? [] : [...new Set(lista)].sort((a, b) => a - b);
}

/** Só valida/normaliza dado tipado (Regra 9): cron de 5 campos com horários fixos, listas, asterisco e passos em minuto/hora. */
export function parseCron5(cron: string): CampoCron {
  const partes = cron.trim().split(/\s+/);
  if (partes.length !== 5) throw new RotinaInvalida("entrada_invalida", "a expressão precisa ter 5 campos cron");
  const [minutoS, horaS, diaMesS, mesS, diaSemS] = partes as [string, string, string, string, string];
  const minuto = horarios(minutoS, 59);
  const hora = horarios(horaS, 23);
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

function formatador(fusoIana: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: fusoIana,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
}

function partesNoFuso(agora: number, fmt: Intl.DateTimeFormat): PartesZona {
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

/**
 * Corrigido em 2026-09-16: a versão anterior ignorava diasMes e mes (mapa-codigo achado 5),
 * então "0 8 1 * *" disparava todo dia. Agora os cinco campos contam.
 */
function casa(cron: CampoCron, p: PartesZona): boolean {
  if (!cron.minuto.includes(p.mi) || !cron.hora.includes(p.h)) return false;
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
  const fmt = formatador(entrada.fusoIana);
  let cursor = Math.floor(entrada.agora / 60_000) * 60_000 + 60_000;
  while (cursor < teto) {
    const p = partesNoFuso(cursor, fmt);
    if (casa(cron, p)) return cursor;
    const diaValido = (cron.diasMes === "*" || cron.diasMes.includes(p.d)) &&
      (cron.mes === "*" || cron.mes.includes(p.mo)) &&
      (cron.diasSemana === "*" || (cron.diasSemana === "uteis" ? p.w >= 1 && p.w <= 5 : cron.diasSemana.includes(p.w)));
    // definido em 2026-09-17: avança em UTC; horas inexistentes são puladas e horas repetidas têm instantes distintos.
    cursor += (!diaValido || !cron.hora.includes(p.h) ? 60 - p.mi : 1) * 60_000;
  }
  throw new RotinaInvalida("cron_sem_futuro", "essa periodicidade não tem execução futura em 400 dias");
}
