import type { JsonSchema } from "./json-schema.ts";

/**
 * As ferramentas do laço de voz (definido em 2026-10-04, ADR-072). Moram fora de ferramentas-nod.ts pelo gatilho de
 * 200 linhas da EMENDA 26, como as de pendência; entram só no catálogo do modo `ligacao`.
 */
export const FERRAMENTAS_LIGACAO = {
  iniciar_tarefa: {
    type: "object",
    description:
      "Começa um trabalho demorado (ler e revisar algo, pesquisar, fazer várias ações) sem parar a ligação. Devolve na hora; você segue conversando, e o resultado chega depois como aviso [nod]. Use para tudo que leve mais que alguns segundos. No máximo 3 por ligação.",
    properties: {
      pedido: { type: "string", description: "O que fazer, autocontido, como você escreveria para você mesmo no chat. Inclua nomes, links e detalhes que a pessoa disse.", minLength: 1, maxLength: 2000 },
    },
    required: ["pedido"],
    additionalProperties: false,
  },
  desligar: {
    type: "object",
    description: "Encerra a ligação depois da sua última frase. Use só quando a pessoa se despedir ou pedir para desligar.",
    properties: {},
    required: [],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type ArgsIniciarTarefa = { pedido: string };
export type ResultadoIniciarTarefa = { ok: true; tarefa_id: string; instrucao: string } | { ok: false; erro: "fora_da_ligacao" | "limite_de_tarefas"; instrucao: string };
export type ResultadoDesligar = { ok: true; instrucao: string } | { ok: false; erro: "fora_da_ligacao" };

export type ContratoFerramentasLigacao = {
  iniciar_tarefa: { args: ArgsIniciarTarefa; resultado: ResultadoIniciarTarefa };
  desligar: { args: { _?: never }; resultado: ResultadoDesligar };
};
