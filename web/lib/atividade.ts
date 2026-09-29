import type { TarefaDoBot } from "../../src/contracts/turno.ts";

/**
 * Turno vivo como cartão de atividade (definido em 2026-09-24): o balão é o que o agente DIZ, o cartão
 * é o que ele está FAZENDO. O texto em streaming vai para `atual`; cada ferramenta (turno.atividade)
 * fecha `atual` numa etapa. Sem nenhuma ferramenta o turno continua um balão (resposta simples); a
 * resposta final vira mensagem normal por REST quando o turno encerra. Tudo puro e testável.
 */
export type Etapa = { texto: string; ferramentas: number };

export type AtividadeTurno = {
  /** Texto desde a última ferramenta (ou desde o início, se ainda não houve nenhuma). */
  atual: string;
  /** Últimas etapas fechadas; `totalEtapas` conta também as descartadas pelo teto. */
  etapas: Etapa[];
  totalEtapas: number;
  ferramentas: number;
  ultimaFerramenta: string | null;
  /** A lista de tarefas do bot (turno.tarefas), inteira, a mais nova que chegou. */
  tarefas: TarefaDoBot[];
};

export const ETAPAS_GUARDADAS = 200;

export const ATIVIDADE_VAZIA: AtividadeTurno = { atual: "", etapas: [], totalEtapas: 0, ferramentas: 0, ultimaFerramenta: null, tarefas: [] };

export function comTarefas(a: AtividadeTurno | undefined, tarefas: TarefaDoBot[]): AtividadeTurno {
  return { ...(a ?? ATIVIDADE_VAZIA), tarefas };
}

export function comTexto(a: AtividadeTurno | undefined, trecho: string): AtividadeTurno {
  const base = a ?? ATIVIDADE_VAZIA;
  return { ...base, atual: base.atual + trecho };
}

/**
 * Narração antes da ferramenta vira etapa com 1 ferramenta; ferramentas seguidas sem narração somam na
 * última etapa; ferramenta sem etapa nenhuma antes abre uma etapa com o próprio rótulo.
 */
export function comFerramenta(a: AtividadeTurno | undefined, rotulo: string): AtividadeTurno {
  const base = a ?? ATIVIDADE_VAZIA;
  const narracao = base.atual.trim();
  const ultima = base.etapas[base.etapas.length - 1];
  let etapas: Etapa[];
  let totalEtapas = base.totalEtapas;
  if (narracao) {
    etapas = [...base.etapas, { texto: narracao, ferramentas: 1 }];
    totalEtapas += 1;
  } else if (ultima) {
    etapas = [...base.etapas.slice(0, -1), { ...ultima, ferramentas: ultima.ferramentas + 1 }];
  } else {
    etapas = [{ texto: rotulo, ferramentas: 1 }];
    totalEtapas += 1;
  }
  return { atual: "", etapas: etapas.slice(-ETAPAS_GUARDADAS), totalEtapas, ferramentas: base.ferramentas + 1, ultimaFerramenta: rotulo, tarefas: base.tarefas };
}

/** Primeira frase da narração, numa linha, sem marcação: é o que cabe numa linha do cartão. */
export function resumoEtapa(texto: string, max = 140): string {
  const limpo = texto.replace(/[*_`#>]+/g, "").replace(/^\s*[-•]\s+/gm, "").replace(/\s+/g, " ").trim();
  const frase = /^(.+?[.!?…])(?:\s|$)/.exec(limpo)?.[1] ?? limpo;
  return frase.length > max ? `${frase.slice(0, max - 1).trimEnd()}…` : frase;
}

/** A linha "o que está fazendo agora": a narração corrente; sem ela, a última ferramenta. */
export function linhaAtual(a: AtividadeTurno): string {
  const narracao = resumoEtapa(a.atual);
  if (narracao) return narracao.replace(/[.:]$/, "…");
  return a.ultimaFerramenta ? `${a.ultimaFerramenta}…` : "Começando…";
}
