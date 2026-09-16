import type { EpochMs, TenantId } from "./ids.ts";

export type TipoMemoria = "preferencia" | "fato" | "resumo";

/** Memória por bot, editável pela pessoa; injetada no prompt com "não substitui fonte autoritativa". */
export type Memoria = {
  tenantId: TenantId;
  id: string;
  agenteId: string;
  tipo: TipoMemoria;
  texto: string;
  origem: "pessoa" | "agente";
  criadoEm: EpochMs;
};
