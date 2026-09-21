import type { CodigoErro } from "./motivos.ts";
import type { JsonSchema } from "./json-schema.ts";

/**
 * Ciclo de vida de rotina que JÁ EXISTE (definido em 2026-09-21). Mora fora de ferramentas-nod.ts
 * porque aquele arquivo bateu no gatilho de revisão de 200 linhas da EMENDA 26; a lista continua
 * FECHADA e única — estas entradas são espalhadas em FERRAMENTAS_NOD, não uma segunda lista.
 *
 * criar_rotina (nascimento, por proposta) continua lá: aqui é só o que age sobre rotina existente.
 */
const ROTINA_ID: JsonSchema = { type: "string", description: "Id da rotina, exatamente como veio do inventário ou de listar_rotinas.", minLength: 1 };

export const FERRAMENTAS_ROTINA = {
  listar_rotinas: {
    type: "object",
    description: "Lista as rotinas deste agente com id, horário, estado e instrução. Leitura: nada muda.",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  pausar_rotina: {
    type: "object",
    description: "Pausa uma rotina existente: ela para de executar até ser reativada. Use o id exato do inventário.",
    properties: { rotina_id: ROTINA_ID },
    required: ["rotina_id"],
    additionalProperties: false,
  },
  reativar_rotina: {
    type: "object",
    description: "Reativa uma rotina pausada. O próximo horário é recalculado a partir de agora; execuções perdidas na pausa não são repostas.",
    properties: { rotina_id: ROTINA_ID },
    required: ["rotina_id"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

/** Sem argumentos: o agente só pode listar as rotinas DELE, que vêm do contexto do turno. */
export type ArgsListarRotinas = object;
export type ArgsPausarRotina = { rotina_id: string };
export type ArgsReativarRotina = { rotina_id: string };

/** A rotina como o modelo a lê de volta: mesma forma do inventário do prompt de sistema. */
export type RotinaListada = { id: string; quando: string; estado: "ativa" | "pausada"; instrucao: string };
export type ResultadoListarRotinas = { rotinas: RotinaListada[] };
/** `ja_estava` distingue "pausei agora" de "já estava pausada": o modelo não deve anunciar mudança que não houve. */
export type ResultadoAlternarRotina = { rotina_id: string; estado: "ativa" | "pausada"; ja_estava: boolean; proxima_execucao: number | null } | { erro: CodigoErro };
