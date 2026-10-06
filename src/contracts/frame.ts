export type TipoFrame =
  | "mensagem.nova"
  | "turno.iniciado"
  | "turno.delta"
  /** Ferramenta chamada no turno vivo: só {nome, rotulo}, nunca input/resultado. Separa as etapas do cartão de atividade. */
  | "turno.atividade"
  /** A lista de tarefas do bot no turno vivo (TaskCreate/TaskUpdate): {tarefas: TarefaDoBot[]}, a lista inteira. */
  | "turno.tarefas"
  /**
   * Sessão viva (ADR-067): uma volta do modelo foi gravada como mensagem com o turno ainda rodando. A tela troca o texto
   * ao vivo daquele turno pela mensagem (relê a conversa e zera o trecho), e o turno segue "rodando".
   */
  | "turno.fala"
  /**
   * O vigia do turno (NOD-73): {mudoMs, aberta?, emFundo, repeticao?} com RÓTULOS, nunca argumentos. Só avisa; a
   * tela mostra "sem novidade há N min" e "repetiu a mesma ação N vezes". A ligação ignora.
   */
  | "turno.vigia"
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
  | "relato.criado"
  /** Modo ligação (ADR-071/075): a ligação da pessoa começou, mudou de estado ou acabou; a web relê a conversa e a ligação viva. */
  | "ligacao.mudou"
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
