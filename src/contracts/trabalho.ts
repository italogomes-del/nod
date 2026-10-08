import type { Executor } from "./evento.ts";
import type { EpochMs, TenantId } from "./ids.ts";
import type { Mensagem } from "./mensagem.ts";

/**
 * Trabalho (definido em 2026-10-07, ADR-083, épico #188): uma unidade de trabalho longo de um bot, com sessão do CLI e
 * pasta próprias, que roda em paralelo com a conversa e com outros trabalhos do mesmo bot. Na tela é a "task".
 * O nome no código é `trabalho` porque `tarefa` já quer dizer outras três coisas: o `tarefaId` do pedido entre bots
 * (o id do turno delegado), a ferramenta `iniciar_tarefa` da ligação e a lista do TaskCreate (`turno.tarefas`).
 *
 * - `pessoa`: a conversa coordenadora abriu (`abrir_task`) a partir de um pedido da pessoa;
 * - `rotina`: uma execução de rotina (uma por execução, nunca uma por rotina);
 * - `colega`: um pedido de outro bot (`pedir_a_bot`), com os acessos de quem recebe (ADR-058);
 * - `rede`: um turno de conversa que passou de 2 min trabalhando e foi promovido sozinho.
 */
export type OrigemTrabalho = "pessoa" | "rotina" | "colega" | "rede";

/**
 * `na_fila`: criado, ainda sem turno despachado (ou esperando o trabalho de `depoisDeTrabalhoId`);
 * `rodando`: tem turno despachando ou pendente; `precisa_de_voce`: parou numa pergunta ou aprovação;
 * `fechado_ocioso`: o processo do CLI foi fechado para liberar memória e volta com a resposta da pessoa;
 * `terminado`: entregou; `parado`: a pessoa parou; `falhou`: interrompido sem retomada possível.
 */
export type EstadoTrabalho = "na_fila" | "rodando" | "precisa_de_voce" | "fechado_ocioso" | "terminado" | "parado" | "falhou";

/** Estados em que o trabalho conta como aberto (faixa, chip da barra, "Trabalhando" e "Precisa de você"). */
export const ESTADOS_ABERTOS_TRABALHO = ["na_fila", "rodando", "precisa_de_voce", "fechado_ocioso"] as const satisfies readonly EstadoTrabalho[];

export type Trabalho = {
  tenantId: TenantId;
  id: string;
  agenteId: string;
  /** A conversa do bot onde a linha "Abriu a task …" e o resultado aparecem. */
  conversaId: string;
  titulo: string;
  origem: OrigemTrabalho;
  /** origem = colega: o bot que pediu. */
  pedidoPorAgenteId: string | null;
  /** origem = rotina. */
  rotinaId: string | null;
  /** Aberto por um trabalho de rotina (profundidade 1): este não abre outros. */
  trabalhoMaeId: string | null;
  /** "Fazer depois da …": só começa quando este terminar, parar ou falhar. */
  depoisDeTrabalhoId: string | null;
  estado: EstadoTrabalho;
  sessaoCli: string | null;
  sessaoHarness: string | null;
  /** definido em 2026-10-08 (revisão do épico, S14): o executor que criou a sessão; o --resume só vale para o mesmo. */
  sessaoExecutor?: Executor | null;
  /** Pasta do trabalho (convenção da ADR-065): `~/nod/<bot>/<slug>`; null = a pasta do bot. */
  pasta: string | null;
  /** Última leitura de memória do Mac para o grupo de processos do trabalho (#194). */
  memoriaMb: number | null;
  custoUsd: number | null;
  /**
   * definido em 2026-10-08 (ADR-085, revisão do #209): a pessoa pediu e está esperando — "Executar agora" numa rotina,
   * ou um pedido a colega feito na conversa com ela. O Mac apertado não segura este trabalho.
   */
  pessoaEsperando?: boolean;
  criadoEm: EpochMs;
  iniciadoEm: EpochMs | null;
  terminadoEm: EpochMs | null;
};

/** O que a web recebe: o trabalho mais o que a faixa e as listas mostram sem outra ida ao servidor. */
export type TrabalhoDto = Omit<Trabalho, "tenantId" | "sessaoCli" | "sessaoHarness" | "sessaoExecutor"> & {
  /** Nome do bot que pediu (origem = colega), para a etiqueta "pedido do Chico". */
  pedidoPorNome: string | null;
  /** Nome da rotina (origem = rotina), para a etiqueta "rotina". */
  rotinaNome: string | null;
  /** O último passo conhecido (nome da ferramenta ou a última fala curta), para a faixa e as listas. */
  ultimoPasso: string | null;
  /** O turno do trabalho que está rodando agora, se houver: a tela da task pede o ao vivo dele. */
  turnoVivoId: string | null;
  /** Título do trabalho que segura o computador do bot, quando este está esperando por ele. */
  esperandoComputadorDe: string | null;
  /**
   * definido em 2026-10-08 (revisão do épico, S24): o título e o último passo podem trazer texto de fora (task de colega,
   * ou um turno dela leu conteúdo de fora). O prompt da conversa os marca com cuidado.
   */
  deFora?: boolean;
  /**
   * ADR-085 (revisão do #209): o Mac apertado seguraria este trabalho agora — em segundo plano, ainda não começou,
   * ninguém esperando e dentro da espera máxima. A linha diz "esperando o Mac aliviar" só com ele e `segurando`.
   */
  seguravel?: boolean;
  /**
   * definido em 2026-10-08 (protótipo "Nod — tempo da task", aprovado pelo Marlon): o colega cuja resposta a task espera
   * (o pedido mais antigo ainda sem volta), para o status curto "esperando Eng 2". Ausente ou null: não espera colega.
   */
  esperandoColega?: { nome: string; desde: number; trabalhoId: string | null } | null;
  /** Quanto os turnos do trabalho de fato rodaram (do começo ao último sinal de cada um, o que roda até agora), em ms. */
  trabalhouMs?: number;
};

/** Pressão de memória do macOS (kern.memorystatus_vm_pressure_level: 1 = verde, 2 = amarela, 4 = vermelha). */
export type NivelPressao = "verde" | "amarela" | "vermelha";

/**
 * GET trabalhos(?agenteId=): os abertos e os terminados hoje, e a pressão do Mac da pessoa (null = nenhum Mac falou).
 * ADR-085 (definido em 2026-10-08): `processador` é o pior nível de processador entre os Macs dela (null = nenhum Mac
 * mandou; app anterior à 0.4.0-rc.6 não manda) e `segurando` diz que trabalho novo em segundo plano está esperando o
 * Mac aliviar, pelo "uso do Mac" que a pessoa escolheu.
 */
export type TrabalhosDto = { trabalhos: TrabalhoDto[]; pressao: NivelPressao | null; memoriaTotalMb: number | null; processador?: NivelPressao | null; cargaProcessador?: number | null; segurando?: boolean };

/** GET trabalhos/:id: a tela da task. `mensagens` são as do trabalho (inclui as falas do meio). */
export type TrabalhoDetalheDto = { trabalho: TrabalhoDto; mensagens: Mensagem[] };

/** Telemetria das linhas do chat (#191): o que a web mostrou e o que a pessoa abriu. */
export type TipoLinha = "rotina" | "bots" | "task";
export type EventoLinha = { acao: "mostrada" | "aberta"; tipo: TipoLinha; agenteId: string; chaveLinha: string };
/** GET telemetria/linhas: por tipo, nos últimos 14 dias; `taxa` = abertas / mostradas (distintas por chaveLinha). */
export type TaxaDeAbertura = { tipo: TipoLinha; mostradas: number; abertas: number; taxa: number | null };

/**
 * Processador do Mac (definido em 2026-10-08, ADR-085): a carga média de 1 minuto (`vm.loadavg`) dividida pelos
 * núcleos, e o nível que sai dela (domain/memoria-mac.ts, nivelDoProcessador).
 */
export type LeituraProcessador = { nivel: NivelPressao; carga: number };

/**
 * Memória que o Mac manda na renovação (#194): o nível do macOS e a soma do RSS do grupo de processos de cada turno.
 * ADR-085: também no `puxar` (sem `porTurno`), para o servidor saber do Mac mesmo sem turno rodando, e com o processador.
 */
export type LeituraMemoria = { nivel: NivelPressao; totalMb: number; porTurno: { turnoId: string; mb: number }[]; processador?: LeituraProcessador };
