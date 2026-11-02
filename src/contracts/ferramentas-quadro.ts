import type { JsonSchema } from "./json-schema.ts";
import { GRUPOS_COLUNA, LIMITES_QUADRO, type ArgsGerirQuadro, type ResultadoGerirQuadro } from "./quadro.ts";

/**
 * gerir_quadro (definido em 2026-10-31, NOD-442, ADR-135): QUALQUER bot faz no quadro o que a pessoa faz na tela — criar o
 * quadro com a meta e o prazo, criar e importar tarefas do Linear, mudar a tarefa de quadro, mudar status, responsável, PR e pergunta, responder o
 * bloqueio e desfazer o último lote. Cada chamada é um lote atômico (tudo ou nada) com um Desfazer. O servidor não fala
 * com o Linear: o bot busca os itens com a ferramenta dele e os passa em `importar_linear`. Mora fora de
 * ferramentas-nod.ts pelo gatilho de 200 linhas da EMENDA 26 e é espalhada em FERRAMENTAS_NOD.
 */

// NOD-448: o status é a coluna (o id ou o nome que o quadro mostra). O padrão: backlog, afazer, fazendo, revisao, bloqueado, voce, feito, cancelado.
const STATUS = { type: "string", minLength: 1, maxLength: 60, description: "A coluna: o id ou o nome (resumo_quadro traz as colunas). Padrão: backlog, afazer (o bot responsável começa sozinho; num quadro sem A fazer, leva à coluna de andamento), fazendo, revisao (PR aberto), bloqueado, voce (Precisa de você; exige pergunta), feito, cancelado." } as const satisfies JsonSchema;
const COLUNA = { type: "string", minLength: 1, maxLength: 60, description: "A coluna: o id ou o nome." } as const satisfies JsonSchema;
const GRUPO = { type: "string", enum: [...GRUPOS_COLUNA], description: "nao_iniciado (espera), iniciado (andamento: o bot começa ao entrar), feito (conta no progresso) ou fechado (sai da conta). Não muda depois." } as const satisfies JsonSchema;
const TAREFA = { type: "string", description: "A tarefa: o código do quadro (ZE-12), o id, o identificador do Linear (NOD-12) ou o título exato.", minLength: 1 } as const satisfies JsonSchema;
const ouNull = (s: JsonSchema, description: string): JsonSchema => ({ anyOf: [s, { type: "null" }], description });
const AGENTE = { anyOf: [{ type: "string", minLength: 1 }, { type: "null" }], description: "O bot responsável: id ou nome exato (sem o Nod). null tira o responsável." } as const satisfies JsonSchema;

/** As propriedades de cada tipo de ação; o registro (src/domain/acoes/quadro.ts) reusa as mesmas. */
export const PROPRIEDADES_QUADRO = {
  meta: ouNull({ type: "string", maxLength: LIMITES_QUADRO.meta }, "Opcional: a meta em uma frase (o que é 'pronto'). Sem meta é o fluxo contínuo (sem progresso nem risco de prazo); null tira."),
  prazo: ouNull({ type: "string" }, "O prazo, AAAA-MM-DD; null tira."),
  titulo: { type: "string", minLength: 1, maxLength: LIMITES_QUADRO.titulo },
  descricao: { type: "string", maxLength: LIMITES_QUADRO.descricao },
  status: STATUS,
  agente: AGENTE,
  tarefa: TAREFA,
  pr_url: ouNull({ type: "string" }, "O PR do GitHub (https://github.com/dono/repo/pull/N). Sem status, a tarefa vai para revisao."),
  pergunta: ouNull({ type: "string", maxLength: LIMITES_QUADRO.pergunta }, "O que a pessoa precisa responder (com status voce). null tira."),
  excluir: { type: "boolean", description: "true tira a tarefa do quadro (o Desfazer a traz de volta)." },
  sem_iniciar: { type: "boolean", description: "true: muda de coluna (e de responsável, pela passagem) sem acionar ninguém." },
  instrucoes: ouNull({ type: "string", maxLength: LIMITES_QUADRO.instrucoes }, "definir_passagem: o que essa etapa faz (vai no pedido de quem pega a tarefa nela). null tira."),
  resposta: { type: "string", minLength: 1, maxLength: LIMITES_QUADRO.resposta },
  texto: { type: "string", minLength: 1, maxLength: LIMITES_QUADRO.comentario, description: "comentar: o texto; @Nome de um bot o aciona. recado: o que a pessoa disse, como ela disse." },
  lote: { type: "string", description: "O lote a desfazer; sem ele, o último." },
  quadro: { type: "string", minLength: 1, maxLength: 200, description: "mover_quadro: o quadro de destino (o nome do bot anfitrião, o prefixo do código, como ZE, ou o id)." },
  bot: { type: "string", minLength: 1, maxLength: 200, description: "remover_quadro: o nome do bot dono do quadro, como a pessoa disse (obrigatório para o bot)." },
  nome: { type: "string", description: "O nome da coluna.", minLength: 1, maxLength: LIMITES_QUADRO.coluna },
  grupo: GRUPO,
  coluna: COLUNA,
  depois_de: { ...COLUNA, description: "A coluna (do mesmo grupo) que fica antes." },
  prazo_min: ouNull({ type: "integer" }, "Prazo da coluna em minutos (só onde o trabalho anda): a tarefa parada além dele faz o quadro cobrar o responsável e, se continuar parada, avisar a pessoa. null tira."),
  antes_de: { ...COLUNA, description: "A coluna (do mesmo grupo) que fica depois." },
  destino: { ...COLUNA, description: "Para onde vão as tarefas da coluna removida (obrigatório se ela tiver tarefas)." },
  colunas: {
    type: "array",
    minItems: 1,
    maxItems: LIMITES_QUADRO.colunas,
    description: "O conjunto novo, na ordem. Mantenha o id das que continuam.",
    items: {
      type: "object",
      properties: { id: { type: "string", minLength: 1, maxLength: 48 }, nome: { type: "string", minLength: 1, maxLength: LIMITES_QUADRO.coluna }, grupo: GRUPO },
      required: ["nome", "grupo"],
      additionalProperties: false,
    },
  },
  destinos: {
    type: "array",
    maxItems: LIMITES_QUADRO.colunas,
    description: "Para onde vão as tarefas das colunas que saem; sem isso, para a primeira do mesmo grupo.",
    items: { type: "object", properties: { de: COLUNA, para: COLUNA }, required: ["de", "para"], additionalProperties: false },
  },
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
      "Mexe no quadro de tarefas da pessoa (a aba Quadro de um bot), do mesmo jeito que ela faria na tela. Uma chamada = um lote atômico com Desfazer. acoes vazio ([]) só consulta: devolve o quadro com o trabalho atual de cada tarefa (número, estado, motivo da falha, nova tentativa agendada), sem mudar nada. Tipos: criar_quadro {meta?, prazo?} (meta só se a pessoa quiser uma; o padrão é o fluxo contínuo, sem meta); editar_quadro {meta?, prazo?} (meta null tira); criar_tarefa {titulo, descricao?, status?, agente?} (sem status vai para o Backlog e ninguém começa; para o responsável começar já, passe status afazer); importar_linear {itens} (busque os itens no Linear antes, com a sua ferramenta); mudar_tarefa {tarefa, titulo?, descricao?, status?, agente?, pr_url?, pergunta?, excluir?, sem_iniciar?} (sem_iniciar true muda de coluna, e de responsável pela passagem, sem acionar ninguém); responder {tarefa, resposta}; comentar {tarefa, texto} (sozinho; sem Desfazer; aciona o responsável só com a tarefa em andamento, como Fazendo e Em revisão; em Backlog, A fazer, Feito ou Cancelado fica na tarefa sem acioná-lo; @Nome aciona aquele bot sem trocar o responsável; o seu comentário não aciona você); desfazer {lote?} (sozinho no lote); mover_quadro {tarefa, quadro} (sozinho; leva a tarefa para o quadro de outro bot da pessoa com o histórico e os comentários, cai na coluna do mesmo grupo e não aciona ninguém; ela ganha o código do destino e o antigo continua abrindo; sem Desfazer); remover_quadro {bot} (sozinho; o seu quadro ou o de outro bot dela, com quadro = o nome do dono; o dono volta a agente comum: apaga o quadro, as tarefas e o histórico, sem Desfazer; a conversa e a memória ficam; só quando a pessoa pedir: passe em bot o nome do dono, como ela disse; vira um card Excluir / Agora não que ela confirma, ou sai na hora no automático). Colunas: criar_coluna {nome, grupo, depois_de?, prazo_min?}; renomear_coluna {coluna, nome?, prazo_min?} (prazo_min sozinho põe ou tira o prazo); mover_coluna {coluna, antes_de? | depois_de?} (só dentro do grupo); remover_coluna {coluna, destino?} (com tarefas, o destino é obrigatório; Precisa de você e Cancelado não saem); substituir_colunas {colunas, destinos?} (sozinho no lote; vira uma proposta que a pessoa confirma num card); definir_passagem {coluna, agente?, instrucoes?} (a coluna passa a tarefa que entra nela para o bot agente: em A fazer e nas colunas de andamento ele começa na hora; nas outras de Não iniciado, como Backlog, a tarefa passa para ele, sem acionar; agente null tira a passagem). Etapas: terminei {tarefa?} manda a tarefa para a próxima coluna (sem tarefa, a do seu turno) e, se a coluna aciona, quem cuida dela começa — use ao acabar a sua etapa. Trabalho da tarefa (cada um sozinho, sem Desfazer, só a pedido da pessoa na conversa com você): repetir_trabalho {tarefa} abre um trabalho novo (para o atual; a tarefa Bloqueada volta para onde estava); cancelar_trabalho {tarefa} para o trabalho atual e os recados que aguardavam, sem mover a tarefa; recado {tarefa, texto} leva o que a pessoa disse ao trabalho em andamento (entra no próximo passo; sem trabalho, vira um novo). Criar, renomear, mover e remover coluna não pedem confirmação: conte o que mudou em uma frase, a pessoa tem Desfazer. Tarefa em afazer com responsável faz o bot responsável começar sozinho. Ao terminar a sua tarefa, ponha o PR (vai para revisao) e depois status feito; quando travar numa decisão da pessoa, use status voce com a pergunta (o quadro avisa a pessoa e junta as decisões pendentes numa mensagem só).",
    properties: {
      quadro: { type: "string", description: "O quadro: o id ou o nome do bot anfitrião. Sem ele, o seu; senão, o único da pessoa." },
      acoes: {
        type: "array",
        minItems: 0,
        maxItems: LIMITES_QUADRO.ops,
        items: {
          type: "object",
          properties: {
            tipo: { type: "string", enum: ["criar_quadro", "editar_quadro", "criar_tarefa", "importar_linear", "mudar_tarefa", "responder", "comentar", "desfazer", "mover_quadro", "remover_quadro", "criar_coluna", "renomear_coluna", "mover_coluna", "remover_coluna", "substituir_colunas", "definir_passagem", "terminei", "repetir_trabalho", "cancelar_trabalho", "recado"] },
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
