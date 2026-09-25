import type { TenantId } from "./ids.ts";
import type { DesfechoItem, MotivoAprovacaoManual } from "./motivos.ts";

export type DestinoItem = {
  conector: string;
  ferramenta: string;
  argumentos: Record<string, unknown>;
  /**
   * definido em 2026-09-24 (ADR-048): o item roda na máquina da pessoa (gh do Mac dela), carimbado na
   * criação a partir do plano. Aprovado, espera o Mac puxar pela ponte ("aguardando seu Mac").
   */
  execucao?: "maquina";
};

/**
 * Item de aprovação em lista (E4.1/E4.2). Origem sensível nasce desmarcada com justificativa;
 * marcar item sensível exige pessoa (CHECK item_sensivel_marcado_exige_pessoa na 0002).
 */
export type ItemAprovacao = {
  tenantId: TenantId;
  id: string;
  decisaoId: string;
  idx: number;
  textoOriginal: string;
  textoFinal: string;
  destino: DestinoItem;
  selecionado: boolean;
  origemSensivel: boolean;
  justificativa: string | null;
  marcadoPor: string | null;
  marcadoEm: string | null;
  editadoPor: string | null;
  desfecho: DesfechoItem | null;
  /**
   * Por que este item precisou de pessoa (ADR-042/ADR-029: regra suspensa em silêncio é negação
   * seca). NULO = resolvido por regra, sem perguntar. A pessoa lê o motivo no card.
   */
  motivoManual: MotivoAprovacaoManual | null;
};
