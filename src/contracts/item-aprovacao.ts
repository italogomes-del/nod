import type { TenantId } from "./ids.ts";
import type { DesfechoItem } from "./motivos.ts";

export type DestinoItem = {
  conector: string;
  ferramenta: string;
  argumentos: Record<string, unknown>;
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
};
