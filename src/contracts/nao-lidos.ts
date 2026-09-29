import type { EpochMs } from "./ids.ts";
import type { Mensagem } from "./mensagem.ts";

/**
 * Não lidos (definido em 2026-09-29, 0039): cada conversa com fala nova de quem não é a pessoa, a mais recente
 * primeiro. `primeiraId` é onde a linha "Novas" entra; `mensagens` são as últimas não lidas (até 3), em ordem
 * de criação; `daRotina` = alguma delas veio de um turno de rotina. Conta só texto e artefato: aviso do sistema,
 * execução de rotina e a troca interna entre bots não são "mensagem nova".
 */
export type ConversaNaoLida = {
  conversaId: string;
  tipo: "propria" | "sala";
  agenteId: string | null;
  salaId: string | null;
  total: number;
  primeiraId: string;
  desde: EpochMs;
  ultimaEm: EpochMs;
  mensagens: Mensagem[];
  daRotina: boolean;
};
export type NaoLidosDto = { conversas: ConversaNaoLida[] };
