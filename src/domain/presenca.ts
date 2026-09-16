import { OFFLINE_MS } from "../shared/constantes.ts";

export type Presenca = "online" | "offline" | "nunca_vista";

/** Presença derivada do próprio poll, sem heartbeat separado (ADR-021). */
export function presencaMaquina(vistoEm: number | null, agora: number, offlineMs = OFFLINE_MS): Presenca {
  if (vistoEm === null) return "nunca_vista";
  return agora - vistoEm > offlineMs ? "offline" : "online";
}
