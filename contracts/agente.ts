import type { Autoria } from "./evento.ts";

export type FormaAgente = "shape-square" | "shape-hex" | "shape-circle";
export type CorAgente =
  | "c-purple"
  | "c-black"
  | "c-pink"
  | "c-teal"
  | "c-blue"
  | "c-orange"
  | "c-green"
  | "c-red";

export type DonoAgente =
  | { tipo: "pessoa"; pessoaId: string }
  | { tipo: "empresa"; empresaId: string };

export type Agente = {
  tenantId: string;
  id: string;
  nome: string;
  /** O que ele faz — prosa da pessoa, não formulário. */
  instrucoes: string;
  dono: DonoAgente;
  forma: FormaAgente;
  cor: CorAgente;
  secao: string;
  favorito: boolean;
  confirmado: boolean;
  criadoEm: number;
};

export type MensagemKind =
  | "texto"
  | "starter"
  | "proposta-papel"
  | "proposta-rotina"
  | "proposta-concessao"
  | "sistema";

export type Mensagem = {
  tenantId: string;
  id: string;
  agenteId: string;
  autoria: Autoria;
  kind: MensagemKind;
  texto: string;
  payload: Record<string, unknown> | null;
  createdAt: number;
};
