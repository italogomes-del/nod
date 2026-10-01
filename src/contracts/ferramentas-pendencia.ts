import type { JsonSchema } from "./json-schema.ts";

/**
 * As três ferramentas das pendências do bot (definido em 2026-09-30, ADR-064). Moram fora de ferramentas-nod.ts
 * pelo gatilho de 200 linhas da EMENDA 26, como ferramentas-artefato.ts: são espalhadas em FERRAMENTAS_NOD, e a
 * lista continua FECHADA e única. O teto do texto (500) é o CHECK pendencia_texto da 0044 e TEXTO_PENDENCIA_MAX de
 * src/domain/pendencia.ts — repetido aqui porque src/contracts não tem lógica e o schema precisa de literal.
 */
export const FERRAMENTAS_PENDENCIA = {
  anotar_pendencia: {
    type: "object",
    description:
      "Anota algo que você vai deixar para depois: o quê e, se houver, para quem. O nod guarda e devolve a você na próxima vez que a pessoa falar com você ou que uma rotina sua rodar; não acorda você na hora. Use em vez de prometer no texto que fará \"assim que\" ou \"depois\".",
    properties: {
      texto: { type: "string", description: "Autocontido, em uma frase: o que fazer e para quem. Ex.: \"Cobrar do Dev 1 o parecer do PR #475\".", minLength: 1, maxLength: 500 },
      a_partir_de: { type: "string", description: "Opcional: não antes de quando, em ISO 8601 com fuso (ex.: 2026-10-01T16:20:00-03:00), até um ano à frente. Sem isto, ela volta já na próxima rotina ou conversa.", minLength: 1 },
    },
    required: ["texto"],
    additionalProperties: false,
  },
  concluir_pendencia: {
    type: "object",
    description: "Marca como feita uma pendência sua da lista \"Suas pendências abertas\", depois de fazer o trabalho. A conversa mostra à pessoa que você cumpriu.",
    properties: {
      id: { type: "string", description: "O id da pendência, como veio na lista.", minLength: 1 },
      como: { type: "string", description: "O que você fez, em uma frase.", minLength: 1, maxLength: 500 },
    },
    required: ["id", "como"],
    additionalProperties: false,
  },
  descartar_pendencia: {
    type: "object",
    description: "Tira da lista uma pendência sua que perdeu o sentido (já foi feita por outro caminho, não se aplica mais). Diga por quê.",
    properties: {
      id: { type: "string", description: "O id da pendência, como veio na lista.", minLength: 1 },
      por_que: { type: "string", description: "Por que ela não precisa mais ser feita, em uma frase.", minLength: 1, maxLength: 500 },
    },
    required: ["id", "por_que"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type ArgsAnotarPendencia = { texto: string; a_partir_de?: string };
export type ArgsConcluirPendencia = { id: string; como: string };
export type ArgsDescartarPendencia = { id: string; por_que: string };

/** `aparece`: "na próxima rotina ou conversa", ou o instante ISO a partir do qual ela volta. */
export type ResultadoAnotarPendencia =
  | { ok: true; pendencia_id: string; ja_estava: boolean; aparece: string }
  | { ok: false; erro: "texto_vazio" | "a_partir_de_invalido" | "limite_de_pendencias"; instrucao: string };
export type ResultadoResolverPendencia = { ok: true } | { ok: false; erro: "pendencia_nao_encontrada" | "pendencia_ja_resolvida" };

/** Args ↔ resultado das três, intersectado em ContratoFerramentaNod. */
export type ContratoFerramentasPendencia = {
  anotar_pendencia: { args: ArgsAnotarPendencia; resultado: ResultadoAnotarPendencia };
  concluir_pendencia: { args: ArgsConcluirPendencia; resultado: ResultadoResolverPendencia };
  descartar_pendencia: { args: ArgsDescartarPendencia; resultado: ResultadoResolverPendencia };
};
