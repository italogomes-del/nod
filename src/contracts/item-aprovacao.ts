import type { ParId } from "./ids.ts";
import type { Autoria } from "./evento.ts";
import type { ClassificacaoOrigem } from "./conector.ts";

export type ItemAprovacaoEstado = "proposto" | "selecionado" | "recusado" | "executado" | "nao-executado";

export type ItemAprovacao = {
  id: ParId;
  decisaoId: ParId;
  texto: string;
  estado: ItemAprovacaoEstado;
  origem: ClassificacaoOrigem;
  autoriaMarcacao: Autoria | null;
  nasceDesmarcado: boolean;
};
