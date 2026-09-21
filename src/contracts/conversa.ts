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

export type KindProposta = "perfil" | "rotina" | "acesso" | "pasta";
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
};
export type PayloadPropostaAcesso = {
  kind: "acesso";
  conector: string;
  conectar?: true;
  turnoId?: string;
  capacidades: string[];
  nivel: "leitura" | "escrita";
  naoPedido: string[];
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
export type PayloadProposta = PayloadPropostaPerfil | PayloadPropostaRotina | PayloadPropostaAcesso | PayloadPropostaPasta;

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
