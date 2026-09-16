import { parseCron5, proximaJanela, RotinaInvalida, assertFusoIana } from "./rotina-janela.ts";

const DIAS: Record<string, number> = {
  domingo: 0,
  segunda: 1,
  terca: 2,
  terça: 2,
  quarta: 3,
  quinta: 4,
  sexta: 5,
  sabado: 6,
  sábado: 6,
};

export type RotinaNormalizada = {
  cron: string;
  fusoIana: string;
  instrucao: string;
  exigeAprovacao: true;
  proximoDisparo: number;
  resumo: string;
};

const HORA = /(?:às|as|a)\s*(\d{1,2})(?:h|:)?(\d{2})?|(?:^|\s)(\d{1,2})h(\d{2})?/i;

function extrairHora(texto: string): { hora: number; minuto: number } | null {
  const m = texto.match(HORA);
  if (!m) return null;
  const hora = Number(m[1] ?? m[3]);
  const minuto = Number(m[2] ?? m[4] ?? 0);
  if (!Number.isInteger(hora) || hora < 0 || hora > 23) return null;
  if (!Number.isInteger(minuto) || minuto < 0 || minuto > 59) return null;
  return { hora, minuto };
}

function resumoCron(cron: string, fusoIana: string): string {
  const c = parseCron5(cron);
  const hh = String(c.hora).padStart(2, "0");
  const mm = String(c.minuto).padStart(2, "0");
  const horas = `${hh}:${mm}`;
  if (c.diasSemana === "uteis") return `Todo dia útil às ${horas} · ${fusoIana}`;
  if (c.diasSemana === "*") return `Todo dia às ${horas} · ${fusoIana}`;
  if (Array.isArray(c.diasSemana) && c.diasSemana.length === 1) {
    const nomes = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
    const d = nomes[c.diasSemana[0] ?? 0];
    return `Toda ${d} às ${horas} · ${fusoIana}`;
  }
  return `${cron} · ${fusoIana}`;
}

export function textoTemRecorrencia(texto: string): boolean {
  return /toda|todo\s+dia|dias?\s+úteis|dias?\s+uteis|toda\s+segunda|toda\s+terça|toda\s+terca|toda\s+quarta|toda\s+quinta|toda\s+sexta|todo\s+sábado|todo\s+sabado|todo\s+domingo|de\s+hora\s+em\s+hora/i.test(
    texto,
  );
}

/**
 * Normaliza recorrência em português para cron + fuso IANA.
 * Gate de aprovação é SEMPRE true — não sai do texto (E7.3).
 * Nada é agendado aqui: só a proposta (E7.1).
 */
export function interpretarRotinaTexto(entrada: {
  texto: string;
  fusoIana: string;
  agora: number;
}): RotinaNormalizada {
  assertFusoIana(entrada.fusoIana);
  if (/(?:utc|gmt)?\s*[+-]\s*\d/i.test(entrada.texto) || /[+-]\d{2}:\d{2}/.test(entrada.texto)) {
    throw new RotinaInvalida("A persistência recusa offset numérico. Diga o fuso pelo nome, por exemplo America/Sao_Paulo.");
  }

  const hora = extrairHora(entrada.texto) ?? { hora: 8, minuto: 0 };
  let cron: string;

  if (/dias?\s+út(?:eis|il)|dias?\s+uteis/i.test(entrada.texto)) {
    cron = `${hora.minuto} ${hora.hora} * * 1-5`;
  } else if (/todo\s+dia/i.test(entrada.texto)) {
    cron = `${hora.minuto} ${hora.hora} * * *`;
  } else {
    const diaNome = Object.keys(DIAS).find((d) => new RegExp(`toda\\s+${d}|todo\\s+${d}`, "i").test(entrada.texto));
    if (diaNome) {
      cron = `${hora.minuto} ${hora.hora} * * ${DIAS[diaNome]}`;
    } else if (textoTemRecorrencia(entrada.texto)) {
      cron = `${hora.minuto} ${hora.hora} * * *`;
    } else {
      throw new RotinaInvalida("Não entendi a periodicidade. Experimente: «todo dia às 8h» ou «toda segunda às 7h».");
    }
  }

  const proximoDisparo = proximaJanela({ cron, fusoIana: entrada.fusoIana, agora: entrada.agora });
  return {
    cron,
    fusoIana: entrada.fusoIana,
    instrucao: entrada.texto.trim(),
    exigeAprovacao: true,
    proximoDisparo,
    resumo: resumoCron(cron, entrada.fusoIana),
  };
}
