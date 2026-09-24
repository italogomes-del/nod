import type { TipoDecisao } from "./decisao.ts";
import type { JsonSchema } from "./json-schema.ts";

/**
 * pedir_a_pessoa (EMENDA 16) em contrato próprio: ferramentas-nod.ts encostava no gatilho de 200
 * linhas da EMENDA 26. Os três tipos se RESPONDEM com texto da pessoa, nunca com um botão de decidir.
 */
export const TIPOS_PEDIDO_A_PESSOA = ["pergunta", "falta_de_dado", "permissao"] as const satisfies readonly TipoDecisao[];
export type TipoPedidoAPessoa = (typeof TIPOS_PEDIDO_A_PESSOA)[number];

/**
 * definido em 2026-09-24 (emenda da ADR-045): respostas prontas viram botões de um toque debaixo da
 * pergunta. Quatro cabem numa linha do balão; 60 caracteres cabem num botão sem quebrar.
 */
export const MAX_OPCOES = 4;
export const MAX_CARACTERES_OPCAO = 60;

export type ArgsPedirAPessoa = { tipo: TipoPedidoAPessoa; texto: string; dado?: string; quem_destrava?: string; opcoes?: string[] };

/**
 * A pergunta é a fala do agente na conversa (emenda da ADR-045): `texto` aparece num balão, então a
 * descrição pede fala natural dirigida à pessoa, e `opcoes` quando as respostas são previsíveis.
 */
export const SCHEMA_PEDIR_A_PESSOA = {
  type: "object",
  description:
    "Para o turno e pergunta à pessoa. O texto aparece na conversa como a sua própria fala, num balão de pergunta: escreva como você falaria com ela, direto e em uma ou duas frases, dizendo o que precisa e para quê. Quando as respostas prováveis forem previsíveis (sim ou não, uma entre poucas alternativas), mande até 4 em opcoes — viram botões de um toque, e a pessoa ainda pode responder com as próprias palavras. tipo: 'pergunta' (julgamento), 'falta_de_dado' (diga em dado o que falta) ou 'permissao'. Depois de chamar, encerre o turno sem repetir a pergunta em texto e sem tentar de novo: a resposta dela retoma o trabalho de onde parou.",
  properties: {
    tipo: { type: "string", enum: TIPOS_PEDIDO_A_PESSOA },
    texto: { type: "string", description: "A pergunta como você diria à pessoa, em uma ou duas frases.", minLength: 1 },
    dado: { type: "string", description: "Nome curto do dado que falta (em falta_de_dado).", minLength: 1 },
    quem_destrava: { type: "string", description: "Nome da pessoa que pode destravar (entre as pessoas do tenant).", minLength: 1 },
    opcoes: {
      type: "array",
      description: "Até 4 respostas prováveis, escritas como a pessoa responderia (\"Sim, pode arquivar\"), cada uma com até 60 caracteres. Omita quando a resposta não for previsível.",
      items: { type: "string", minLength: 1, maxLength: MAX_CARACTERES_OPCAO },
      maxItems: MAX_OPCOES,
    },
  },
  required: ["tipo", "texto"],
  additionalProperties: false,
} as const satisfies JsonSchema;
