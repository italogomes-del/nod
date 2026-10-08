import type { JsonSchema } from "./json-schema.ts";

/**
 * As ferramentas da conversa coordenadora (definido em 2026-10-07, ADR-081 §7, issue #193). Moram fora de
 * ferramentas-nod.ts pelo gatilho de 200 linhas da EMENDA 26, como as de pendência; são espalhadas em FERRAMENTAS_NOD.
 * `abrir_task` entra no turno de conversa (sem trabalho) e no da task de rotina sem mãe; `mandar_para_task`, só na
 * conversa. O teto do título (200) é o CHECK trabalho_titulo da 0060.
 */
export const FERRAMENTAS_TRABALHO = {
  abrir_task: {
    type: "object",
    description:
      "Abre uma task: um trabalho que roda à parte, com sessão e pasta próprias, enquanto esta conversa segue livre. Use para o que leva mais que alguns minutos ou mexe em arquivos e código. Devolve na hora; o resultado e as perguntas da task chegam aqui depois.",
    properties: {
      titulo: { type: "string", description: "Título curto, como a pessoa diria (ex.: \"Dashboard de churn\").", minLength: 1, maxLength: 200 },
      pedido: { type: "string", description: "O que fazer, autocontido: a task não vê esta conversa. Inclua nomes, links e o que a pessoa já disse.", minLength: 1, maxLength: 8000 },
      depois_de: { type: "string", description: "Opcional: o id de uma task aberta que precisa terminar antes desta começar.", minLength: 1 },
    },
    required: ["titulo", "pedido"],
    additionalProperties: false,
  },
  mandar_para_task: {
    type: "object",
    description: "Repassa um recado a uma task aberta (o id está em \"Trabalhos em andamento\"). Se ela estiver rodando, o recado entra no meio do trabalho; senão, vira o próximo passo dela.",
    properties: {
      trabalho_id: { type: "string", description: "O id da task, como veio na lista.", minLength: 1 },
      texto: { type: "string", description: "O recado, autocontido.", minLength: 1, maxLength: 8000 },
    },
    required: ["trabalho_id", "texto"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type ArgsAbrirTask = { titulo: string; pedido: string; depois_de?: string };
export type ArgsMandarParaTask = { trabalho_id: string; texto: string };

export type ResultadoAbrirTask =
  | { ok: true; trabalho_id: string; instrucao: string }
  | { ok: false; erro: "nao_abre_task" | "depois_de_invalido"; instrucao: string };
export type ResultadoMandarParaTask =
  | { ok: true; entrou: "no_meio" | "na_fila"; instrucao: string }
  | { ok: false; erro: "task_nao_encontrada" | "nao_repassa"; instrucao: string };

/** Args ↔ resultado das duas, intersectado em ContratoFerramentaNod. */
export type ContratoFerramentasTrabalho = {
  abrir_task: { args: ArgsAbrirTask; resultado: ResultadoAbrirTask };
  mandar_para_task: { args: ArgsMandarParaTask; resultado: ResultadoMandarParaTask };
};
