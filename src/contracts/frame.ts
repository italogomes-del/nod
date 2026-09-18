export type TipoFrame =
  | "mensagem.nova"
  | "turno.iniciado"
  | "turno.delta"
  | "turno.encerrado"
  | "turno.interrompido"
  | "decisao.nova"
  | "decisao.decidida"
  | "decisao.vencida"
  | "proposta.nova"
  | "rotina.criada"
  | "rotina.executou"
  | "sala.handoff"
  | "negacao"
  | "inventario.mudou"
  | "computador.mudou"
  | "agente.mudou"
  | "parada.faixa"
  | "resumed";

/**
 * Frame SSE numerado por PESSOA (ADR-016). `id:` na linha SSE é `${streamId}:${seq}`;
 * resume só com replay completo (buffer[0].seq <= since+1), senão frame 'resumed' {resumed:false}.
 */
export type FrameSse = {
  streamId: string;
  seq: number;
  pessoaId: string;
  tipo: TipoFrame;
  dados: Record<string, unknown>;
};
