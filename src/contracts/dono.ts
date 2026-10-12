/**
 * O estado do dono (definido em 2026-10-12, ADR-099 item 10, issue I10): o contrato da "linha acima do campo" e da linha
 * do bot em Trabalhos (Parte 5). Cada bot tem um dono, a conversa dele; o servidor resume tudo o que o bot tem em
 * andamento num estado principal e em contagens, calculado por `estadoDoDono` (src/domain/estado-do-dono.ts). Só tipos.
 *
 * A prioridade do principal: `esperando_voce` (uma decisão ou pergunta aberta do bot ou de alguma frente) >
 * `trabalhando` (frentes com turno vivo; a própria conversa trabalhando conta) > `esperando` (um comando, uma volta
 * marcada ou um colega; "esperar não é trabalhar") > `fila` (pedidos ainda não começados, ou frentes esperando a vez) >
 * `livre` (a linha some).
 */
export const PRINCIPAIS_DO_DONO = ["esperando_voce", "trabalhando", "esperando", "fila", "livre"] as const;
export type PrincipalDoDono = (typeof PRINCIPAIS_DO_DONO)[number];

export type EstadoDoDono = {
  agenteId: string;
  principal: PrincipalDoDono;
  /** Frentes trabalhando agora (com turno vivo): "Trabalhando em N frentes". */
  frentes: number;
  /** O turno da própria conversa (fora de frente) está rodando: conta como trabalhando, mesmo com 0 frentes. */
  conversaTrabalhando: boolean;
  /** Decisões e perguntas abertas do bot e das frentes dele: "Esperando você". */
  esperandoVoce: number;
  /** O que só espera algo de fora — comando, volta marcada, colega —, das frentes e da conversa. */
  esperando: number;
  /** Pedidos na fila do dono (ainda não começados) e frentes esperando a vez. */
  fila: number;
  /** O motivo curto da espera mais antiga ("a CI do #845"); null sem espera. */
  motivoEspera: string | null;
  /** Desde quando o estado principal vale (a decisão, o turno, a espera ou o pedido mais antigo); null quando livre. */
  desde: number | null;
};

/** O que uma espera espera: um comando (`esperar_comando`), a hora marcada (`me_chame_as`) ou a resposta de um colega. */
export type TipoEsperaDoDono = "comando" | "volta" | "colega";

/**
 * Uma espera na linha aberta. `trabalhoId` null = a espera é da própria conversa. Comando: o comando, a última linha da
 * saída (a da tentativa anterior do mesmo comando enquanto este roda; o motor não manda saída parcial) e a tentativa N de
 * `tentativas` (as voltas da mesma espera sem novidade, ADR-099 item 5). Volta: `acordaEm`.
 */
export type EsperaDoDonoDto = {
  tipo: TipoEsperaDoDono;
  trabalhoId: string | null;
  motivo: string;
  desde: number;
  comando?: string;
  ultimaLinha?: string | null;
  tentativa?: number;
  tentativas?: number;
  acordaEm?: number;
};

/** De onde veio um pedido na fila do dono. */
export type DeQuemPediu = "pessoa" | "colega" | "rotina";

/** Um pedido na fila do dono, na ordem em que sai: quem pediu (o nome do colega ou da rotina) e quando. */
export type PedidoNaFilaDto = { turnoId: string; de: DeQuemPediu; nome: string | null; desde: number };

/**
 * O dono de um bot como a tela o recebe: o estado (a linha fechada) e, para a linha aberta, as esperas e a fila. As
 * frentes da linha aberta são os `TrabalhoDto` do bot (título, último passo, tempo, lote), que vêm junto.
 */
export type DonoDto = { estado: EstadoDoDono; esperas: EsperaDoDonoDto[]; fila: PedidoNaFilaDto[] };

/**
 * O lote (o pedido) de uma frente, na linha aberta (definido em 2026-10-12, ADR-099, I10): quando o dono o abriu e
 * quantas frentes dele ainda estão abertas. De quem é o pedido sai da `origem` da frente (`pedidoPorNome`, `rotinaNome`).
 */
export type LoteNaTela = { id: string; abertoEm: number; frentes: number; abertas: number };

/** O que o `TrabalhoDto` ganha para a linha aberta (ADR-099, I10). */
export type FrenteNaLinhaAberta = {
  /** O motivo da volta marcada (`acordaEm`), para "esperando: o deploy terminar"; null = nenhuma ou sem motivo. */
  acordaMotivo?: string | null;
  /** O lote (o pedido) a que a frente pertence; null = sem lote (a task de antes, migrada pela 0072). */
  lote?: LoteNaTela | null;
};

/** O que o `TrabalhosDto` ganha (ADR-099, I10): o dono de cada bot pedido (todos os da pessoa, ou o `agenteId`). */
export type DonosNosTrabalhos = { donos?: DonoDto[] };
