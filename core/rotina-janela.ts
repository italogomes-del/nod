const OFFSET_NUMERICO = /(?:utc|gmt)?\s*[+-]\s*\d{1,2}(?::\d{2})?/i;

export class RotinaInvalida extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RotinaInvalida";
  }
}

export function assertFusoIana(fusoIana: string): void {
  if (OFFSET_NUMERICO.test(fusoIana) || /[+-]\d{2}:\d{2}/.test(fusoIana)) {
    throw new RotinaInvalida("A persistência recusa offset numérico. Use um fuso IANA nomeado, por exemplo America/Sao_Paulo.");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: fusoIana }).format(new Date(0));
  } catch {
    throw new RotinaInvalida(`Fuso IANA desconhecido: ${fusoIana}`);
  }
}

export type CampoCron = {
  minuto: number;
  hora: number;
  diasMes: "*" | number;
  mes: "*" | number;
  diasSemana: "*" | number[] | "uteis";
};

export function parseCron5(cron: string): CampoCron {
  const partes = cron.trim().split(/\s+/);
  if (partes.length !== 5) {
    throw new RotinaInvalida("A expressão precisa ter 5 campos cron.");
  }
  const [minutoS, horaS, diaMesS, mesS, diaSemS] = partes as [string, string, string, string, string];
  const minuto = Number(minutoS);
  const hora = Number(horaS);
  if (!Number.isInteger(minuto) || minuto < 0 || minuto > 59) {
    throw new RotinaInvalida("Minuto cron inválido.");
  }
  if (!Number.isInteger(hora) || hora < 0 || hora > 23) {
    throw new RotinaInvalida("Hora cron inválida.");
  }
  let diasSemana: CampoCron["diasSemana"] = "*";
  if (diaSemS === "1-5") diasSemana = "uteis";
  else if (diaSemS !== "*") {
    diasSemana = diaSemS.split(",").map((d) => Number(d));
    if (diasSemana.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) {
      throw new RotinaInvalida("Dia da semana cron inválido.");
    }
  }
  return {
    minuto,
    hora,
    diasMes: diaMesS === "*" ? "*" : Number(diaMesS),
    mes: mesS === "*" ? "*" : Number(mesS),
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

function casa(cron: CampoCron, p: PartesZona): boolean {
  if (p.mi !== cron.minuto || p.h !== cron.hora) return false;
  if (cron.diasSemana === "uteis") return p.w >= 1 && p.w <= 5;
  if (cron.diasSemana !== "*" && Array.isArray(cron.diasSemana)) return cron.diasSemana.includes(p.w);
  return true;
}

/**
 * Instante canônico da próxima janela: o horário agendado do próprio cron, não o agora.
 * Dois processos com a mesma entrada chegam ao mesmo valor (ADR-011 / E7.6).
 */
export function proximaJanela(entrada: { cron: string; fusoIana: string; agora: number }): number {
  assertFusoIana(entrada.fusoIana);
  const cron = parseCron5(entrada.cron);
  const teto = entrada.agora + 400 * 24 * 60 * 60 * 1000;
  let cursor = entrada.agora;
  const p0 = partesNoFuso(cursor, entrada.fusoIana);
  cursor = instanteNoFuso({ y: p0.y, mo: p0.mo, d: p0.d, h: cron.hora, mi: cron.minuto }, entrada.fusoIana);
  if (cursor <= entrada.agora) {
    cursor += 24 * 60 * 60 * 1000;
  }
  while (cursor < teto) {
    const p = partesNoFuso(cursor, entrada.fusoIana);
    const cand = instanteNoFuso({ y: p.y, mo: p.mo, d: p.d, h: cron.hora, mi: cron.minuto }, entrada.fusoIana);
    if (cand > entrada.agora && casa(cron, partesNoFuso(cand, entrada.fusoIana))) {
      return cand;
    }
    cursor += 24 * 60 * 60 * 1000;
  }
  throw new RotinaInvalida("Essa periodicidade não tem execução futura.");
}
