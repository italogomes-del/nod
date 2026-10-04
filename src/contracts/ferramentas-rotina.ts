import type { ArgsPedirAcesso } from "./ferramentas-nod.ts";
import type { CodigoErro } from "./motivos.ts";
import type { JsonSchema } from "./json-schema.ts";

/**
 * Ciclo de vida de rotina que JÁ EXISTE (definido em 2026-09-21). Mora fora de ferramentas-nod.ts
 * porque aquele arquivo bateu no gatilho de revisão de 200 linhas da EMENDA 26; a lista continua
 * FECHADA e única — estas entradas são espalhadas em FERRAMENTAS_NOD, não uma segunda lista.
 *
 * criar_rotina (o nascimento) veio junto em 2026-09-21, quando a main trouxe sem_novidade e o
 * arquivo de lá passou das 200 linhas de novo: TODO schema de rotina mora aqui agora.
 */
/**
 * definido em 2026-10-04 (ADR-077): no onboarding por ligação, a Nina pede o acesso e propõe a rotina PARA o bot novo
 * da pessoa. Só vale para o bot que o onboarding criou (preferencias.onboarding_bot_id); fora dele a ferramenta recusa.
 */
export const PARA_BOT: JsonSchema = { type: "string", description: "Só no onboarding: o nome do bot novo que você acabou de criar com a pessoa. Fora disso, omita.", minLength: 1, maxLength: 60 };

const ROTINA_ID: JsonSchema = { type: "string", description: "Id da rotina, exatamente como veio do inventário, de listar_rotinas ou de ver_colegas.", minLength: 1 };

/**
 * definido em 2026-09-24 (emenda da ADR-044, "rotina nasce com o acesso"): os apps que a rotina lê ou
 * altera, na forma dos argumentos de pedir_acesso. A pessoa está na criação: confirmar a rotina é o
 * consentimento, e o card mostra o que será liberado. Espelha FERRAMENTAS_NOD.pedir_acesso sem importá-lo
 * (ferramentas-nod.ts já importa este arquivo; o ciclo de VALORES quebraria o módulo).
 */
const ACESSOS: JsonSchema = {
  type: "array",
  description: "Apps que a rotina lê ou altera, um item por app. A pessoa permite junto com a rotina.",
  items: {
    type: "object",
    properties: {
      conector: { type: "string", description: "Slug do app registrado ou do marketplace.", minLength: 1 },
      capacidades: { type: "array", items: { type: "string" }, description: "Com nivel leitura, [] pede as ferramentas de leitura do app. Escrita exige os nomes exatos do catálogo." },
      nivel: { type: "string", enum: ["leitura", "escrita"] },
      nao_pedido: { type: "array", items: { type: "string" }, description: "O que explicitamente NÃO está sendo pedido." },
    },
    required: ["conector", "capacidades", "nivel", "nao_pedido"],
    additionalProperties: false,
  },
};

/**
 * definido em 2026-10-01 (item 7 da ADR-066, migração 0045): rotina de retomar trabalho pela metade. O Dev que
 * acordava de 20 em 20 min só para perguntar "tem algo pra mim?" gastava ~US$ 0,30 por execução, quase sempre em
 * sem_novidade; com o flag, a janela sem pendência visível passa sem turno.
 */
const SO_COM_PENDENCIA: JsonSchema = {
  type: "boolean",
  description: "true = a rotina só acorda quando você tem pendência aberta (anotar_pendencia); sem pendência, a execução passa sem turno e sem custo. Use para rotina de retomar trabalho pela metade.",
};

export const FERRAMENTAS_ROTINA = {
  criar_rotina: {
    type: "object",
    description: "Propõe uma rotina (cron de 5 campos + fuso IANA). A pessoa confirma; o gate de aprovação nasce ligado.",
    properties: {
      cron: { type: "string", description: "Expressão cron de 5 campos, ex.: '0 8 * * 1-5'.", minLength: 1 },
      fuso_iana: { type: "string", description: "Fuso IANA nomeado, ex.: America/Sao_Paulo. Offset numérico é recusado.", minLength: 1 },
      instrucao: { type: "string", description: "O que fazer em cada execução.", minLength: 1 },
      fonte: { type: "string", description: "De onde vem o dado.", minLength: 1 },
      entregavel: { type: "string", description: "O que sai ao final.", minLength: 1 },
      limites_aprovacao: { type: "string", description: "O que exige aprovação antes de sair.", minLength: 1 },
      politica_sem_dado: { type: "string", description: "O que fazer quando não houver dado.", minLength: 1 },
      acessos: ACESSOS,
      so_com_pendencia: SO_COM_PENDENCIA,
      para_bot: PARA_BOT,
    },
    required: ["cron", "fuso_iana", "instrucao", "fonte", "entregavel", "limites_aprovacao", "politica_sem_dado"],
    additionalProperties: false,
  },
  listar_rotinas: {
    type: "object",
    description: "Lista as rotinas deste agente com id, horário, estado e instrução. Leitura: nada muda.",
    properties: {},
    required: [],
    additionalProperties: false,
  },
  pausar_rotina: {
    type: "object",
    description: "Pausa uma rotina existente: ela para de executar até ser reativada. Use o id exato do inventário; a rotina de um colega (id de ver_colegas) só quando a pessoa pedir.",
    properties: { rotina_id: ROTINA_ID },
    required: ["rotina_id"],
    additionalProperties: false,
  },
  reativar_rotina: {
    type: "object",
    description: "Reativa uma rotina pausada, sua ou de um colega quando a pessoa pedir. O próximo horário é recalculado a partir de agora; execuções perdidas na pausa não são repostas.",
    properties: { rotina_id: ROTINA_ID },
    required: ["rotina_id"],
    additionalProperties: false,
  },
  atualizar_rotina: {
    type: "object",
    description: "Propõe mudar uma rotina existente. Envie SÓ os campos que mudam; os outros ficam como estão. A pessoa confirma; nada muda antes disso.",
    properties: {
      rotina_id: ROTINA_ID,
      cron: { type: "string", description: "Novo cron de 5 campos, ex.: '0 8 * * 1-5'.", minLength: 1 },
      fuso_iana: { type: "string", description: "Novo fuso IANA nomeado. Offset numérico é recusado.", minLength: 1 },
      instrucao: { type: "string", description: "Nova instrução de cada execução.", minLength: 1 },
      fonte: { type: "string", description: "Nova fonte do dado.", minLength: 1 },
      entregavel: { type: "string", description: "Novo entregável.", minLength: 1 },
      limites_aprovacao: { type: "string", description: "Novo limite do que exige aprovação.", minLength: 1 },
      politica_sem_dado: { type: "string", description: "Nova política para quando não houver dado.", minLength: 1 },
      acessos: { ...ACESSOS, description: "A lista NOVA e inteira de apps que a rotina lê ou altera." },
      so_com_pendencia: SO_COM_PENDENCIA,
    },
    required: ["rotina_id"],
    additionalProperties: false,
  },
  excluir_rotina: {
    type: "object",
    description: "Propõe excluir uma rotina existente. A pessoa confirma; nada é excluído antes disso. Para só interromper por um tempo, prefira pausar_rotina.",
    properties: { rotina_id: ROTINA_ID },
    required: ["rotina_id"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type ArgsCriarRotina = {
  cron: string;
  fuso_iana: string;
  instrucao: string;
  fonte: string;
  entregavel: string;
  limites_aprovacao: string;
  politica_sem_dado: string;
  acessos?: ArgsPedirAcesso[];
  /** Ausente = false: a rotina acorda em toda janela (0045). */
  so_com_pendencia?: boolean;
  /** ADR-077: só no onboarding, o bot novo da pessoa (o nome dele). */
  para_bot?: string;
};
/** Sem argumentos: o agente só pode listar as rotinas DELE, que vêm do contexto do turno. */
export type ArgsListarRotinas = object;
export type ArgsPausarRotina = { rotina_id: string };
export type ArgsReativarRotina = { rotina_id: string };

/**
 * A rotina como o modelo a lê de volta: mesma forma do inventário do prompt de sistema. `so_com_pendencia` só
 * aparece quando true (definido em 2026-10-01, item 7 da ADR-066): ausente é o comum, e o inventário não muda.
 */
export type RotinaListada = { id: string; quando: string; estado: "ativa" | "pausada"; instrucao: string; so_com_pendencia?: true };
export type ResultadoListarRotinas = { rotinas: RotinaListada[] };
/** `ja_estava` distingue "pausei agora" de "já estava pausada": o modelo não deve anunciar mudança que não houve. */
export type ResultadoAlternarRotina = { rotina_id: string; estado: "ativa" | "pausada"; ja_estava: boolean; proxima_execucao: number | null } | { erro: CodigoErro };

export type ArgsAtualizarRotina = {
  rotina_id: string;
  cron?: string;
  fuso_iana?: string;
  instrucao?: string;
  fonte?: string;
  entregavel?: string;
  limites_aprovacao?: string;
  politica_sem_dado?: string;
  acessos?: ArgsPedirAcesso[];
  /** Presente troca (true ou false); ausente fica como está. */
  so_com_pendencia?: boolean;
};
export type ArgsExcluirRotina = { rotina_id: string };

/** Como criar_rotina: nasce PROPOSTA, nada é aplicado. O modelo não deve anunciar mudança feita. */
/** `aplicada: true` (ADR-059): o modo do bot confirmou na hora — a mudança JÁ vale, sem card. */
export type ResultadoPropostaRotina = { proposta_id: string; resumo: string; aplicada?: true } | { erro: CodigoErro };
export type ResultadoCriarRotina = { proposta_id: string; proxima_execucao: number; resumo: string; aplicada?: true } | { erro: CodigoErro };
