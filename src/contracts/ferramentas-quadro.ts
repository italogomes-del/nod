import type { JsonSchema } from "./json-schema.ts";
import { LIMITES_QUADRO, STATUS_TAREFA, type ArgsGerirQuadro, type ResultadoGerirQuadro } from "./quadro.ts";

/**
 * gerir_quadro (definido em 2026-10-31, NOD-442, ADR-135): QUALQUER bot faz no quadro o que a pessoa faz na tela — criar o
 * quadro com a meta e o prazo, criar e importar tarefas do Linear, mudar status, responsável, PR e pergunta, responder o
 * bloqueio e desfazer o último lote. Cada chamada é um lote atômico (tudo ou nada) com um Desfazer. O servidor não fala
 * com o Linear: o bot busca os itens com a ferramenta dele e os passa em `importar_linear`. Mora fora de
 * ferramentas-nod.ts pelo gatilho de 200 linhas da EMENDA 26 e é espalhada em FERRAMENTAS_NOD.
 */

const STATUS = { type: "string", enum: [...STATUS_TAREFA], description: "backlog, afazer (o bot responsável começa sozinho), fazendo, voce (bloqueada esperando a pessoa; exige pergunta), revisao (PR aberto), bloqueado, feito ou cancelado." } as const satisfies JsonSchema;
const TAREFA = { type: "string", description: "A tarefa: o id, o identificador do Linear (NOD-12) ou o título exato.", minLength: 1 } as const satisfies JsonSchema;
const ouNull = (s: JsonSchema, description: string): JsonSchema => ({ anyOf: [s, { type: "null" }], description });
const AGENTE = { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }], description: "O bot responsável: id ou nome exato (sem o Nod). null tira o responsável." } as const satisfies JsonSchema;

/** As propriedades de cada tipo de ação; o registro (src/domain/acoes/quadro.ts) reusa as mesmas. */
export const PROPRIEDADES_QUADRO = {
  meta: { type: "string", description: "A meta em uma frase (o que é 'pronto').", minLength: 1, maxLength: LIMITES_QUADRO.meta },
  prazo: ouNull({ type: "string" }, "O prazo, AAAA-MM-DD; null tira."),
  titulo: { type: "string", minLength: 1, maxLength: LIMITES_QUADRO.titulo },
  descricao: { type: "string", maxLength: LIMITES_QUADRO.descricao },
  status: STATUS,
  agente: AGENTE,
  tarefa: TAREFA,
  pr_url: ouNull({ type: "string" }, "O PR do GitHub (https://github.com/dono/repo/pull/N). Sem status, a tarefa vai para revisao."),
  pergunta: ouNull({ type: "string", maxLength: LIMITES_QUADRO.pergunta }, "O que a pessoa precisa responder (com status voce). null tira."),
  excluir: { type: "boolean", description: "true tira a tarefa do quadro (o Desfazer a traz de volta)." },
  resposta: { type: "string", minLength: 1, maxLength: LIMITES_QUADRO.resposta },
  lote: { type: "string", description: "O lote a desfazer; sem ele, o último." },
  itens: {
    type: "array",
    maxItems: LIMITES_QUADRO.itens,
    items: {
      type: "object",
      properties: {
        identificador: { type: "string", description: "NOD-12", minLength: 1, maxLength: LIMITES_QUADRO.identificador },
        titulo: { type: "string", minLength: 1, maxLength: LIMITES_QUADRO.titulo },
        url: { type: "string", description: "https://linear.app/..." },
        descricao: { type: "string", maxLength: LIMITES_QUADRO.descricao },
        status: STATUS,
        agente: AGENTE,
      },
      required: ["identificador", "titulo"],
      additionalProperties: false,
    },
  },
} as const satisfies Record<string, JsonSchema>;

const P = PROPRIEDADES_QUADRO;

export const FERRAMENTAS_QUADRO = {
  gerir_quadro: {
    type: "object",
    description:
      "Mexe no quadro de tarefas da pessoa (a aba Quadro de um bot), do mesmo jeito que ela faria na tela. Uma chamada = um lote atômico com Desfazer. Tipos: criar_quadro {meta, prazo?}; editar_quadro {meta?, prazo?}; criar_tarefa {titulo, descricao?, status?, agente?}; importar_linear {itens} (busque os itens no Linear antes, com a sua ferramenta); mudar_tarefa {tarefa, titulo?, descricao?, status?, agente?, pr_url?, pergunta?, excluir?}; responder {tarefa, resposta}; desfazer {lote?} (sozinho no lote). Tarefa em afazer com responsável faz o bot responsável começar sozinho. Ao terminar a sua tarefa, ponha o PR (vai para revisao) e depois status feito; quando travar numa decisão da pessoa, use status voce com a pergunta.",
    properties: {
      quadro: { type: "string", description: "O quadro: o id ou o nome do bot anfitrião. Sem ele, o seu; senão, o único da pessoa." },
      acoes: {
        type: "array",
        minItems: 1,
        maxItems: LIMITES_QUADRO.ops,
        items: {
          type: "object",
          properties: {
            tipo: { type: "string", enum: ["criar_quadro", "editar_quadro", "criar_tarefa", "importar_linear", "mudar_tarefa", "responder", "desfazer"] },
            ...P,
          },
          required: ["tipo"],
          additionalProperties: false,
        },
      },
    },
    required: ["acoes"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type ContratoFerramentasQuadro = {
  gerir_quadro: { args: ArgsGerirQuadro; resultado: ResultadoGerirQuadro };
};
