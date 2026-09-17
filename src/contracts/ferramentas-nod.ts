import type { CodigoErro, MotivoPasse } from "./motivos.ts";

import type { JsonSchema } from "./json-schema.ts";
export type { JsonSchema } from "./json-schema.ts";

/**
 * As NOVE ferramentas nod (EMENDA 16 acrescenta pedir_a_pessoa). Lista FECHADA: cada nome tem um
 * case em chamar-ferramenta.ts (tests/conformidade/capabilities-consumidas, L5) e uma entrada em
 * UseCasesNod (servicos.ts). O CLI as vê como mcp__nod__<nome>. Ferramenta de conector é
 * `${slug}__${tool}` e não mora aqui.
 */
export const FERRAMENTAS_NOD = {
  lembrar: {
    type: "object",
    description: "Guarda uma memória deste agente (preferência, fato ou resumo). A memória não substitui fonte autoritativa.",
    properties: {
      tipo: { type: "string", enum: ["preferencia", "fato", "resumo"], description: "Tipo da memória." },
      texto: { type: "string", description: "O que lembrar, em uma frase.", minLength: 1 },
    },
    required: ["tipo", "texto"],
    additionalProperties: false,
  },
  atualizar_perfil: {
    type: "object",
    description: "Propõe nome, título e/ou descrição para este agente. Nada muda antes da pessoa confirmar.",
    properties: {
      nome: { type: "string", description: "Nome curto do agente.", minLength: 1 },
      titulo: { type: "string", description: "Título de uma linha.", minLength: 1 },
      descricao: { type: "string", description: "O que o agente faz e como responde (regras duráveis).", minLength: 1 },
    },
    required: [],
    additionalProperties: false,
  },
  pedir_acesso: {
    type: "object",
    description: "Pede à pessoa acesso a capacidades de um conector. Vira proposta; nada é concedido aqui.",
    properties: {
      conector: { type: "string", description: "Slug do conector registrado ou do marketplace.", minLength: 1 },
      capacidades: { type: "array", items: { type: "string" }, description: "Nomes exatos das ferramentas do catálogo. Para sugerir conexão ainda ausente, envie [] sem inventar capacidades." },
      nivel: { type: "string", enum: ["leitura", "escrita"] },
      nao_pedido: { type: "array", items: { type: "string" }, description: "O que explicitamente NÃO está sendo pedido." },
    },
    required: ["conector", "capacidades", "nivel", "nao_pedido"],
    additionalProperties: false,
  },
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
    },
    required: ["cron", "fuso_iana", "instrucao", "fonte", "entregavel", "limites_aprovacao", "politica_sem_dado"],
    additionalProperties: false,
  },
  pedir_aprovacao: {
    type: "object",
    description:
      "Submete itens de efeito externo para aprovação em lista. Se voltar 'pendente', ENCERRE o turno: a decisão retoma depois.",
    properties: {
      resumo: { type: "string", description: "Resumo do lote em uma frase.", minLength: 1 },
      itens: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          properties: {
            texto: { type: "string", description: "O item como a pessoa vai ler.", minLength: 1 },
            destino: {
              type: "object",
              properties: {
                conector: { type: "string", description: "Slug do conector.", minLength: 1 },
                ferramenta: { type: "string", description: "Ferramenta do conector.", minLength: 1 },
                argumentos: { type: "object", description: "Argumentos da chamada." },
              },
              required: ["conector", "ferramenta", "argumentos"],
              additionalProperties: false,
            },
            origem_conector: { type: "string", description: "Slug do conector de onde o dado veio, se veio de conector.", minLength: 1 },
          },
          required: ["texto", "destino"],
          additionalProperties: false,
        },
      },
    },
    required: ["resumo", "itens"],
    additionalProperties: false,
  },
  pedir_a_pessoa: {
    type: "object",
    description:
      "Para o turno e pergunta à pessoa. tipo é obrigatório: 'pergunta' (julgamento), 'falta_de_dado' (diga o dado e quem destrava) ou 'permissao'. Não tente de novo depois de chamar.",
    properties: {
      tipo: { type: "string", enum: ["pergunta", "falta_de_dado", "permissao"] },
      texto: { type: "string", description: "A pergunta ou o que falta, em uma frase.", minLength: 1 },
      dado: { type: "string", description: "Nome do dado que falta.", minLength: 1 },
      quem_destrava: { type: "string", description: "Nome da pessoa que pode destravar (entre as pessoas do tenant).", minLength: 1 },
    },
    required: ["tipo", "texto"],
    additionalProperties: false,
  },
  passar: {
    type: "object",
    description: "Passa a vez na sala sem falar. O motivo é tipado.",
    properties: { motivo: { type: "string", enum: ["passei_sem_nada_a_dizer", "negado_fail_closed", "ausente_offline", "cota_esgotada"] } },
    required: ["motivo"],
    additionalProperties: false,
  },
  encaminhar: {
    type: "object",
    description: "Encaminha a rodada da sala para outro bot membro (handoff visível). No máximo 3 por rodada sem fala humana.",
    properties: {
      para_agente: { type: "string", description: "Nome do bot destinatário.", minLength: 1 },
      motivo: { type: "string", description: "Por que ele é o certo para continuar.", minLength: 1 },
    },
    required: ["para_agente", "motivo"],
    additionalProperties: false,
  },
  perguntar_a_bot: {
    type: "object",
    description: "Pergunta em texto a outro bot do mesmo dono (1 salto). A resposta volta como conteúdo não confiável.",
    properties: { agente: { type: "string", description: "Id do diretório de colegas, ou nome único do bot.", minLength: 1 }, pergunta: { type: "string", description: "A pergunta.", minLength: 1 } },
    required: ["agente", "pergunta"],
    additionalProperties: false,
  },
} as const satisfies Record<string, JsonSchema>;

export type NomeFerramentaNod = keyof typeof FERRAMENTAS_NOD;

/**
 * Lista LITERAL (EMENDA 26: nada de Object.keys em src/contracts). `satisfies` recusa nome fora de
 * FERRAMENTAS_NOD; ferramentas-nod.test.ts prova (no tipo e em runtime) que cobre TODAS as chaves.
 */
export const NOMES_FERRAMENTAS_NOD = [
  "lembrar", "atualizar_perfil", "pedir_acesso", "criar_rotina", "pedir_aprovacao",
  "pedir_a_pessoa", "passar", "encaminhar", "perguntar_a_bot",
] as const satisfies readonly NomeFerramentaNod[];

export type ArgsLembrar = { tipo: "preferencia" | "fato" | "resumo"; texto: string };
export type ArgsAtualizarPerfil = { nome?: string; titulo?: string; descricao?: string };
export type ArgsPedirAcesso = { conector: string; capacidades: string[]; nivel: "leitura" | "escrita"; nao_pedido: string[] };
export type ArgsCriarRotina = {
  cron: string;
  fuso_iana: string;
  instrucao: string;
  fonte: string;
  entregavel: string;
  limites_aprovacao: string;
  politica_sem_dado: string;
};
export type ItemPedidoAprovacao = {
  texto: string;
  destino: { conector: string; ferramenta: string; argumentos: Record<string, unknown> };
  origem_conector?: string;
};
export type ArgsPedirAprovacao = { resumo: string; itens: ItemPedidoAprovacao[] };
export type ArgsPedirAPessoa = { tipo: "pergunta" | "falta_de_dado" | "permissao"; texto: string; dado?: string; quem_destrava?: string };
export type ArgsPassar = { motivo: MotivoPasse };
export type ArgsEncaminhar = { para_agente: string; motivo: string };
export type ArgsPerguntarABot = { agente: string; pergunta: string };

export type ResultadoLembrar = { ok: true; id: string };
export type ResultadoProposta = { proposta_id: string };
export type ResultadoCriarRotina = { proposta_id: string; proxima_execucao: number; resumo: string } | { erro: CodigoErro };
export type ResultadoPedirAprovacao =
  | { estado: "decidida"; itens: { idx: number; desfecho: string }[] }
  | { estado: "pendente"; decisao_id: string; instrucao: "encerre o turno; a decisão retoma depois" };
export type ResultadoPedirAPessoa = { estado: "pendente"; decisao_id: string; instrucao: "encerre o turno; a resposta retoma depois" };
export type ResultadoOk = { ok: true };
export type ResultadoPerguntarABot = { tarefa_id: string };

/** Args ↔ resultado por nome: contrato entre proxy, chamar-ferramenta e UseCasesNod. */
export type ContratoFerramentaNod = {
  lembrar: { args: ArgsLembrar; resultado: ResultadoLembrar };
  atualizar_perfil: { args: ArgsAtualizarPerfil; resultado: ResultadoProposta };
  pedir_acesso: { args: ArgsPedirAcesso; resultado: ResultadoProposta };
  criar_rotina: { args: ArgsCriarRotina; resultado: ResultadoCriarRotina };
  pedir_aprovacao: { args: ArgsPedirAprovacao; resultado: ResultadoPedirAprovacao };
  pedir_a_pessoa: { args: ArgsPedirAPessoa; resultado: ResultadoPedirAPessoa };
  passar: { args: ArgsPassar; resultado: ResultadoOk };
  encaminhar: { args: ArgsEncaminhar; resultado: ResultadoOk };
  perguntar_a_bot: { args: ArgsPerguntarABot; resultado: ResultadoPerguntarABot };
};
