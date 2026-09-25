import type { AcessoPedido } from "./acesso.ts";
import type { EpochMs, TenantId } from "./ids.ts";
import type { Visibilidade } from "./agente.ts";
import type { Executor } from "./evento.ts";

export type TipoConversa = "propria" | "sala";

export type Conversa = {
  tenantId: TenantId;
  id: string;
  ownerId: string;
  visibility: Visibilidade;
  tipo: TipoConversa;
  agenteId: string | null;
  salaId: string | null;
  /** session_id do `claude -p`: 1º turno --session-id, seguintes --resume (mapa-cli). */
  sessaoCli: string | null;
  /**
   * Executor que criou `sessaoCli` (0005). Uma sessão só vale `--resume` para o MESMO executor:
   * o catcher nunca cria sessão real, e uma sessão do claude-cli não existe para o catcher.
   * Opcional no tipo para não obrigar cada literal de teste a declará-lo; ausente ⇒ desconhecido ⇒ não reaproveita.
   */
  sessaoExecutor?: Executor | null;
  criadoEm: EpochMs;
};

export type KindProposta = "perfil" | "rotina" | "acesso" | "pasta" | "rotina_atualizacao" | "rotina_exclusao";
export type EstadoProposta = "pendente" | "confirmada" | "recusada";

export type PayloadPropostaPerfil = { kind: "perfil"; nome?: string; titulo?: string; descricao?: string };
export type PayloadPropostaRotina = {
  kind: "rotina";
  cron: string;
  fusoIana: string;
  instrucao: string;
  fonte: string;
  entregavel: string;
  limitesAprovacao: string;
  politicaSemDado: string;
  proximaExecucao: EpochMs;
  resumo: string;
  /**
   * definido em 2026-09-24 (emenda da ADR-044, "rotina nasce com o acesso"): o que a rotina declarou ler
   * ou alterar, JÁ normalizado (leitura com [] num app conectado já traz as ferramentas de leitura).
   * Confirmar concede o que estiver conectado. Ausente = a rotina não declarou (proposta anterior).
   */
  acessos?: AcessoPedido[];
};
/**
 * definido em 2026-09-21: atualizar uma rotina que já existe. Guarda só o que MUDA (campo ausente
 * fica como está) mais o `antes` do que muda, para o card mostrar de→para e a pessoa conferir sem
 * consultar outra tela. Como em criar_rotina, o payload já vem NORMALIZADO pelo domínio: aplicar
 * não reinterpreta nada (E7.1).
 */
export type PayloadPropostaRotinaAtualizacao = {
  kind: "rotina_atualizacao";
  rotinaId: string;
  cron?: string;
  fusoIana?: string;
  instrucao?: string;
  fonte?: string;
  entregavel?: string;
  limitesAprovacao?: string;
  politicaSemDado?: string;
  /** A lista NOVA de acessos declarados, inteira (emenda de 2026-09-24); aplicar concede o que for novo. */
  acessos?: AcessoPedido[];
  /** Recalculado na confirmação a partir de agora; este é o previsto quando a proposta nasceu. */
  proximaExecucao: EpochMs;
  resumo: string;
  antes: { resumo: string; instrucao: string };
};
/** Exclusão recuperável (ADR-034): o card precisa dizer QUAL rotina, então carrega o resumo. */
export type PayloadPropostaRotinaExclusao = {
  kind: "rotina_exclusao";
  rotinaId: string;
  resumo: string;
  instrucao: string;
};
export type PayloadPropostaAcesso = {
  kind: "acesso";
  conector: string;
  conectar?: true;
  turnoId?: string;
  capacidades: string[];
  nivel: "leitura" | "escrita";
  naoPedido: string[];
  /**
   * definido em 2026-09-24 (ADR-044): pedido feito por um turno de rotina. Permitir roda a rotina de
   * novo na hora; recusar pausa a rotina. Ausente = pedido da conversa, que retoma o turno.
   */
  rotinaId?: string;
  /** definido em 2026-09-25: o "para quê" que o agente deu em pedir_acesso; o card mostra embaixo do título. */
  para?: string;
  /**
   * definido em 2026-09-24 (emenda da ADR-044): geração de execução do agente (ADR-034) quando o card
   * nasceu SEM turno — o pré-voo da rotina. Sem turno não há como `execucaoBloqueada` ver que o agente foi
   * excluído e restaurado; permitir um card de outra geração concede, mas não reativa nem dispara a rotina.
   */
  geracao?: number;
};
/**
 * definido em 2026-09-18: o produto descobre a pasta e a pessoa autoriza em um clique. A proposta
 * carrega os caminhos encontrados; conceder continua sendo ato dela, por rota autenticada.
 * candidatas vazio = busca sem resultado, e o card oferece escolher manualmente.
 */
export type PayloadPropostaPasta = {
  kind: "pasta";
  turnoId?: string;
  candidatas: { caminho: string; nome: string; git: boolean }[];
  motivo: string;
  buscaTermo: string;
};
export type PayloadProposta = PayloadPropostaPerfil | PayloadPropostaRotina | PayloadPropostaAcesso | PayloadPropostaPasta | PayloadPropostaRotinaAtualizacao | PayloadPropostaRotinaExclusao;

/** Proposta do modelo (ferramenta tipada) — nada é aplicado antes da confirmação da pessoa (E1.1). */
export type Proposta = {
  tenantId: TenantId;
  id: string;
  conversaId: string;
  agenteId: string;
  kind: KindProposta;
  estado: EstadoProposta;
  payload: PayloadProposta;
  criadoEm: EpochMs;
};
