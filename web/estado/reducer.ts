import type { ChaveEmitidaDto, ChaveMaquinaDto, ConversaDto, FrotaDto, RotinaDto, SuaVezDto } from "../../src/contracts/api.ts";
import type { Concessao } from "../../src/contracts/concessao.ts";
import type { Conector } from "../../src/contracts/conector.ts";
import type { EstadoExecutor } from "../../src/contracts/executor.ts";
import type { FrameSse, TipoFrame } from "../../src/contracts/frame.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { DisponibilidadeLigacao } from "../../src/contracts/ligacao.ts";
import type { EstadoOnboarding } from "../../src/contracts/onboarding.ts";
import type { AppComLogo } from "../../src/contracts/marketplace.ts";
import type { Memoria } from "../../src/contracts/memoria.ts";
import type { NaoLidosDto } from "../../src/contracts/nao-lidos.ts";
import type { Negacao } from "../../src/contracts/negacao.ts";
import type { Pendencia } from "../../src/contracts/pendencia.ts";
import type { ExecucaoRotina } from "../../src/contracts/rotina.ts";
import type { RaioXConversa } from "../../src/contracts/raio-x.ts";
import type { Relato } from "../../src/contracts/relato.ts";
import type { MembroSala, Sala } from "../../src/contracts/sala.ts";
import type { EstadoDaTarefa, FaixaParada, TarefaDoBot } from "../../src/contracts/turno.ts";
import type { Escopo } from "../../src/shared/types.ts";
import { A_FAZER_LIGADO } from "../lib/a-fazer.ts";
import { comFerramenta, comTarefas, comTexto, comVigia, type AtividadeTurno, type VigiaDaAtividade } from "../lib/atividade.ts";
import type { EstadoConexao } from "../lib/live-events.ts";
import { conversasComPergunta } from "../lib/perguntas.ts";

/**
 * Estado da web (ADR-020: a web decide, nunca executa; ADR-029: todo fail-closed vira estado
 * escrito). O servidor é a fonte da verdade: um frame SSE (ADR-016) NÃO carrega o conteúdo — ele
 * diz o que mudou (kind, conversaId, turnoId) e o reducer marca o que precisa ser REIDRATADO por
 * REST (`invalidacoes`); só os deltas de turno (efêmeros) entram direto no estado. Nada aqui lê
 * Date.now(): `agora` chega pela ação `tick`.
 */
export type Tela =
  /** Ainda sem conversa escolhida: assim que a frota chega, `resolverInicio` troca pela conversa certa. */
  | { tipo: "inicio" }
  | { tipo: "conversa"; conversaId: string; agenteId: string }
  | { tipo: "sala"; salaId: string; conversaId: string }
  | { tipo: "rotinas" }
  | { tipo: "nova-rotina"; agenteId?: string }
  | { tipo: "novo-bot" }
  /**
   * definido em 2026-09-25 (jornada do marketplace): `gaveta` é a gaveta do app aberta por cima da grade —
   * "detalhes" (o que o app libera; gerenciar, se já conectado) ou "quem-usa" (abre sozinha quando o login
   * termina). `avancado` mostra a tela técnica: chave do Composio, MCP próprio, catálogos e concessão por ação.
   * `voltar` (definido em 2026-10-04) é a tela de onde a pessoa veio, para o "‹ <de onde veio>" do topo.
   */
  | { tipo: "conectores"; app?: string; gaveta?: { slug: string; passo: "detalhes" | "quem-usa" }; avancado?: true; filtro?: "todos" | "conectados" | "atencao"; voltar?: Exclude<Tela, { tipo: "conectores" }> }
  | { tipo: "sua-vez" }
  /** Não lidos (definido em 2026-09-29, 0039): tudo o que chegou, a conversa mais recente em cima. */
  | { tipo: "nao-lidos" }
  | { tipo: "nova-sala" };

/**
 * "Seu espaço" (definido em 2026-09-30, canvas "Menu, sidebar e gaveta"): o que é da CONTA abre pelo menu do avatar numa
 * camada de tela cheia POR CIMA da tela atual, que continua montada embaixo — sair devolve a conversa exata (rolagem,
 * rascunho, gaveta). Gerenciar agentes, Relatos e Computadores deixaram de ser telas e viraram seções daqui.
 */
export type SecaoEspaco = "conexao" | "avisos" | "preferencias" | "computadores" | "agentes" | "relatos";

/**
 * A gaveta do bot por níveis (definido em 2026-09-30, canvas "Menu, sidebar e gaveta"): o que é do bot abre DENTRO dela,
 * com ‹ para voltar à visão geral — a conversa continua ao lado. Editar perfil e Memória deixaram de ser telas.
 * `acesso.id` é o app (slug; o id do conector quando não há slug).
 */
export type NivelGaveta =
  | { tipo: "rotina"; id: string }
  | { tipo: "acesso"; id: string }
  | { tipo: "dar-acesso" }
  | { tipo: "perfil" }
  | { tipo: "memoria" }
  | { tipo: "inteligencia" }
  | { tipo: "nova-rotina" };

export type ConexaoApp = { url: string | null; falhou: string | null };

/**
 * A ligação viva da pessoa (definido em 2026-10-04, ADR-071): `local` = aberta NESTA página (a tela da ligação);
 * senão veio de `GET ligacoes/viva` (outra janela). A barra lateral marca o bot "Em ligação" nos dois casos.
 */
export type LigacaoVivaNaTela = { ligacaoId: string; agenteId: string; conversaId: string; local: boolean };

export type TurnoVivo = { turnoId: string; conversaId: string; estado: "na_fila" | "rodando"; executor: string | null; machineId: string | null; desde: number };

export type ConversaEstado = ConversaDto & {
  carregadaEm: number;
};

export type NegacaoVista = Negacao & { conversaId: string | null; vistaEm: number };

/**
 * definido em 2026-09-24 (emenda da ADR-045): o que a PRÓXIMA mensagem do campo faz enquanto há
 * pergunta aberta na conversa. Sem entrada, responde à mais antiga (web/lib/perguntas.ts);
 * `outroAssunto` manda mensagem comum e deixa a pergunta aberta; `alvoId` escolhe qual pergunta
 * responder quando são várias. Vale até o próximo envio, e some quando a conversa fica sem pergunta.
 */
export type EscolhaComposer = { outroAssunto: boolean; alvoId: string | null };

export type Invalidacao = "onboarding" | "ligacao" | `disponibilidade:${string}` | "gestao" | "frota" | "sua-vez" | "nao-lidos" | "rotinas" | "conectores" | "inventario" | "executor" | "salas" | "chaves" | "relatos" | `conversa:${string}` | `memoria:${string}` | `concessoes:${string}` | `execucoes:${string}` | `pendencias:${string}`;

export type Estado = {
  sessao: Escopo | null;
  tela: Tela;
  /** Seu espaço aberto por cima da tela, na seção escolhida; null = fechado. */
  espaco: { secao: SecaoEspaco } | null;
  frota: FrotaDto | null;
  gestao?: FrotaDto | null;
  inventario: Inventario | null;
  /** Interruptor de executor da máquina (catcher ⇄ claude-cli): estado escrito de cada opção e a última recusa. */
  executor: EstadoExecutor | null;
  conversas: Record<string, ConversaEstado>;
  /**
   * O turno vivo de cada conversa carregada (turno.delta, turno.atividade, turno.tarefas), por conversaId e
   * turnoId, descartado ao encerrar. definido em 2026-09-30: mora fora de `conversas` porque muda a cada
   * pedaço de texto de cada bot; dentro da conversa, cada pedaço trocava a referência dela e forçava a
   * timeline inteira a ser refeita (web/lib/lembrar.ts).
   */
  atividades: Record<string, Record<string, AtividadeTurno>>;
  turnosVivos: Record<string, TurnoVivo>;
  /** Cancelar da fila tem 5 s de Desfazer antes de ir ao servidor (turnoId → instante do clique). */
  cancelando: Record<string, number>;
  salas: { sala: Sala; membros: MembroSala[] }[];
  suaVez: SuaVezDto | null;
  /** Não lidos (0039): o que chegou depois do "lido até" de cada conversa; null = ainda não carregou. */
  naoLidos: NaoLidosDto | null;
  /**
   * Onde a linha "Novas" entra em cada conversa: a primeira não lida quando a pessoa abriu a conversa (ou voltou
   * para a janela com ela aberta). Fica até ela sair da conversa; o servidor já conta tudo como lido. `total` =
   * quantas estavam não lidas quando a linha entrou (a pílula da base diz "3 novas", 2026-10-05).
   */
  novasDesde: Record<string, { mensagemId: string; em: number; total: number }>;
  rotinas: RotinaDto[];
  /**
   * O que já chegou do servidor ao menos uma vez (definido em 2026-09-30): lista vazia é resposta, não falta.
   * Antes `rotinas.length === 0` contava como "não carregou" e quem não tinha rotina relia /rotinas (e
   * redesenhava a tela) a cada ação e a cada frame; o mesmo valia para salas e para o marketplace.
   */
  carregado: { rotinas: boolean; salas: boolean; conectores: boolean };
  execucoes: Record<string, ExecucaoRotina[]>;
  /** Rotinas com o histórico aberto no painel. Separado de `execucoes`: um evento recarrega a lista, mas não a reabre. */
  historicoAberto: Record<string, boolean>;
  /**
   * Card de pasta com a lista aberta ("Não é essa"), por proposta: `curta` mostra as primeiras, `todas`
   * mostra tudo; ausente = só a sugerida. definido em 2026-09-25: estado de tela, não vai ao servidor.
   */
  listaDePasta: Record<string, "curta" | "todas">;
  conectores: Conector[];
  marketplace: AppComLogo[];
  composioConfigurado: boolean;
  /**
   * definido em 2026-09-25: os apps com login em andamento (a janela do provedor aberta e a web
   * perguntando ao servidor, sozinha, se terminou). `falhou` = a frase do que deu errado; o card oferece
   * tentar de novo. Some quando conecta ou quando a pessoa cancela.
   */
  conectando: Record<string, ConexaoApp>;
  /** O nível aberto na gaveta de um bot; outro bot na tela = visão geral. */
  gaveta: { agenteId: string; nivel: NivelGaveta } | null;
  avisoConexao: string | null;
  concessoes: Record<string, Concessao[]>;
  /**
   * O "Agora não" do cartão de liberar apps (definido em 2026-10-05, 0054): por bot, o instante em que a pessoa
   * dispensou cada app (conectorId → ms). Chega junto com as concessões; ausente = ainda não carregou, e o cartão
   * não aparece (web/telas/card-liberar.ts).
   */
  liberacoesDispensadas: Record<string, Record<string, number>>;
  memorias: Record<string, Memoria[]>;
  /**
   * O "a fazer" de cada bot (definido em 2026-09-30, ADR-064): as pendências abertas, da mais nova para a mais antiga;
   * ausente = ainda não carregou. `aFazerAberto` é a lista aberta embaixo da última mensagem — estado de tela.
   */
  pendencias: Record<string, Pendencia[]>;
  aFazerAberto: Record<string, boolean>;
  /** Minhas chaves de máquina (ADR-031); null = ainda não carregou. */
  chaves: ChaveMaquinaDto[] | null;
  /** Relatos de comportamento indesejado (ADR-041); null = ainda não carregou. */
  relatos: Relato[] | null;
  /**
   * Modo dev (definido em 2026-09-28, 0036): a preferência vem do servidor (o app desktop limpa o localStorage)
   * e, ligada, cada conversa aberta traz o resumo do Raio-X de cada turno e o total do dia.
   */
  modoDev: { ligado: boolean; raioX: Record<string, RaioXConversa> };
  /**
   * A chave crua recém-emitida: mostrada UMA vez e descartada ao sair da tela. Fica só na memória da
   * aba — nunca em storage — e o servidor não tem como mostrá-la de novo.
   */
  chaveEmitida: ChaveEmitidaDto | null;
  negacoes: NegacaoVista[];
  faixaParada: FaixaParada | null;
  /** Escolha do campo por conversa (EscolhaComposer); ausente = o padrão. */
  composer: Record<string, EscolhaComposer>;
  conexao: { estado: EstadoConexao; tentativa: number; proximaEmMs: number | null };
  /** O que a próxima volta do main precisa buscar por REST (conjunto, sem duplicata). */
  invalidacoes: Invalidacao[];
  agora: number;
  erro: { codigo: string; mensagem: string; correlationId?: string | null } | null;
  ocupado: boolean;
  ligacaoViva: LigacaoVivaNaTela | null;
  /** A disponibilidade de ligar para cada bot (só decide se o botão "Ligar" aparece); null = a leitura falhou. */
  disponibilidadeLigacao: Record<string, DisponibilidadeLigacao | null>;
  /**
   * Onboarding por ligação (definido em 2026-10-04, ADR-077): o que `GET onboarding` disse. undefined = ainda não leu;
   * null = a leitura falhou ou a rota não existe (falha fechada: o app abre normal). `onboardingAberto` = a camada do
   * onboarding está na frente (resolverInicio abre quando `mostrar`; "Ver o onboarding de novo" reabre).
   */
  onboarding?: EstadoOnboarding | null;
  onboardingAberto: boolean;
  /** A primeira leitura já decidiu se o onboarding abre (só uma vez por sessão; depois só pelo menu da conta). */
  onboardingResolvido?: boolean;
};

export type Acao =
  | { tipo: "conexao-app"; slug: string; valor: ConexaoApp | null }
  | { tipo: "gaveta"; agenteId: string; nivel: NivelGaveta | null }
  | { tipo: "aviso-conexao"; texto: string | null }
  | { tipo: "sessao"; escopo: Escopo | null }
  | { tipo: "navegar"; tela: Tela }
  | { tipo: "espaco"; secao: SecaoEspaco | null }
  | { tipo: "tick"; agora: number }
  | { tipo: "cancelando-turno"; turnoId: string; agora: number }
  | { tipo: "desfazer-cancelamento"; turnoId: string }
  | { tipo: "conexao"; estado: EstadoConexao; tentativa: number; proximaEmMs: number | null }
  | { tipo: "frame"; frame: FrameSse; agora: number }
  | { tipo: "hidratar-gestao"; gestao: FrotaDto }
  | { tipo: "hidratar-frota"; frota: FrotaDto }
  | { tipo: "hidratar-inventario"; inventario: Inventario }
  | { tipo: "hidratar-executor"; executor: EstadoExecutor }
  | { tipo: "hidratar-conversa"; conversa: ConversaDto; agora: number }
  | { tipo: "hidratar-sua-vez"; suaVez: SuaVezDto }
  | { tipo: "hidratar-nao-lidos"; naoLidos: NaoLidosDto }
  | { tipo: "novas-desde"; conversaId: string; mensagemId: string; em: number; total: number }
  | { tipo: "hidratar-rotinas"; rotinas: RotinaDto[] }
  | { tipo: "hidratar-execucoes"; rotinaId: string; execucoes: ExecucaoRotina[] }
  | { tipo: "alternar-historico"; rotinaId: string }
  | { tipo: "lista-de-pasta"; propostaId: string; lista: "curta" | "todas" }
  | { tipo: "hidratar-conectores"; conectores: Conector[]; marketplace?: AppComLogo[]; composioConfigurado?: boolean }
  | { tipo: "hidratar-concessoes"; agenteId: string; concessoes: Concessao[]; liberacoesDispensadas?: Record<string, number> }
  | { tipo: "hidratar-memorias"; agenteId: string; memorias: Memoria[] }
  | { tipo: "hidratar-pendencias"; agenteId: string; pendencias: Pendencia[] }
  | { tipo: "a-fazer"; agenteId: string; aberto: boolean }
  | { tipo: "hidratar-salas"; salas: { sala: Sala; membros: MembroSala[] }[] }
  | { tipo: "hidratar-chaves"; chaves: ChaveMaquinaDto[] }
  | { tipo: "hidratar-relatos"; relatos: Relato[] }
  | { tipo: "modo-dev"; ligado: boolean }
  | { tipo: "hidratar-raio-x"; conversaId: string; raioX: RaioXConversa }
  | { tipo: "chave-emitida"; emitida: ChaveEmitidaDto | null }
  | { tipo: "faixa"; faixa: FaixaParada | null }
  | { tipo: "composer"; conversaId: string; escolha: EscolhaComposer | null }
  | { tipo: "invalidar"; quais: Invalidacao[] }
  | { tipo: "invalidacoes-tratadas"; quais: Invalidacao[] }
  | { tipo: "erro"; erro: { codigo: string; mensagem: string; correlationId?: string | null } | null }
  | { tipo: "ocupado"; valor: boolean }
  | { tipo: "ligacao-viva"; viva: LigacaoVivaNaTela | null }
  | { tipo: "hidratar-disponibilidade-ligacao"; agenteId: string; disponibilidade: DisponibilidadeLigacao | null }
  | { tipo: "esquecer-disponibilidade-ligacao"; agenteId: string }
  | { tipo: "hidratar-onboarding"; onboarding: EstadoOnboarding | null }
  | { tipo: "onboarding-aberto"; aberto: boolean };

export const estadoInicial: Estado = {
  sessao: null,
  tela: { tipo: "inicio" },
  espaco: null,
  frota: null,
  inventario: null,
  executor: null,
  conversas: {},
  atividades: {},
  turnosVivos: {},
  cancelando: {},
  salas: [],
  suaVez: null,
  naoLidos: null,
  novasDesde: {},
  rotinas: [],
  carregado: { rotinas: false, salas: false, conectores: false },
  execucoes: {},
  historicoAberto: {},
  listaDePasta: {},
  conectores: [],
  marketplace: [],
  composioConfigurado: false,
  conectando: {},
  gaveta: null,
  avisoConexao: null,
  concessoes: {},
  liberacoesDispensadas: {},
  memorias: {},
  pendencias: {},
  aFazerAberto: {},
  chaves: null,
  relatos: null,
  modoDev: { ligado: false, raioX: {} },
  chaveEmitida: null,
  negacoes: [],
  faixaParada: null,
  composer: {},
  conexao: { estado: "parado", tentativa: 0, proximaEmMs: null },
  invalidacoes: [],
  agora: 0,
  erro: null,
  ocupado: false,
  ligacaoViva: null,
  disponibilidadeLigacao: {},
  onboardingAberto: false,
};

/** A lista de tarefas de um frame: item fora do formato fica de fora (a web nunca confia no formato do frame). */
const ESTADOS_TAREFA: Record<EstadoDaTarefa, true> = { pendente: true, andamento: true, feita: true };
function tarefasDoFrame(v: unknown): TarefaDoBot[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((t): TarefaDoBot[] => {
    const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    return typeof o.id === "string" && typeof o.titulo === "string" && typeof o.estado === "string" && o.estado in ESTADOS_TAREFA
      ? [{ id: o.id, titulo: o.titulo, estado: o.estado as EstadoDaTarefa }]
      : [];
  }).slice(0, 50);
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function invalidar(estado: Estado, ...quais: (Invalidacao | null)[]): Estado {
  const novas = quais.filter((q): q is Invalidacao => q !== null && !estado.invalidacoes.includes(q));
  return novas.length === 0 ? estado : { ...estado, invalidacoes: [...estado.invalidacoes, ...novas] };
}

function semTurnoVivo(estado: Estado, turnoId: string | null): Estado {
  if (!turnoId || !estado.turnosVivos[turnoId]) return estado;
  const turnosVivos = { ...estado.turnosVivos };
  delete turnosVivos[turnoId];
  return { ...estado, turnosVivos };
}

function semDelta(estado: Estado, conversaId: string | null, turnoId: string | null): Estado {
  if (!conversaId || !turnoId) return estado;
  const daConversa = estado.atividades[conversaId];
  if (!daConversa || !(turnoId in daConversa)) return estado;
  const restantes = { ...daConversa };
  delete restantes[turnoId];
  return { ...estado, atividades: { ...estado.atividades, [conversaId]: restantes } };
}

/** A conversa que a tela mostra (conversa ou sala), já carregada ou ainda chegando. */
function conversaIdNaTela(estado: Estado): string | null {
  const t = estado.tela;
  return t.tipo === "conversa" || t.tipo === "sala" ? t.conversaId : null;
}

/**
 * O texto ao vivo de uma conversa é guardado quando ela está carregada OU é a que a tela está abrindo.
 * definido em 2026-10-01: abrir um bot no meio da resposta põe o GET da conversa para correr junto com os
 * deltas, e o que chegava antes dele era descartado, então a fala aparecia começando no meio (achado da
 * revisão do PR #99). Conversa fora da tela e nunca aberta continua sem guardar (ADR-061, mudouNaTela).
 */
function guardaAoVivo(estado: Estado, conversaId: string): boolean {
  return Boolean(estado.conversas[conversaId]) || conversaIdNaTela(estado) === conversaId;
}

/** O turno vivo `turnoId` da conversa, trocado por `mudar` (o resto de `atividades` fica com a mesma referência). */
function comAtividade(estado: Estado, conversaId: string, turnoId: string, mudar: (a: AtividadeTurno | undefined) => AtividadeTurno): Estado["atividades"] {
  const daConversa = estado.atividades[conversaId] ?? {};
  return { ...estado.atividades, [conversaId]: { ...daConversa, [turnoId]: mudar(daConversa[turnoId]) } };
}

/** O frame é do turno do cérebro de uma ligação (ADR-071)? `modo` é o que o servidor manda; `origem` também vale. */
function turnoDeLigacao(dados: Record<string, unknown>): boolean {
  return dados.modo === "ligacao" || dados.origem === "ligacao";
}

/**
 * O aviso do vigia do turno (NOD-73) como a tela o guarda. `mudoMs` vira o instante em que o silêncio começou, para a
 * contagem de minutos andar sem frame novo. Fora do formato, null (o frame é ignorado).
 */
function vigiaDoFrame(d: Record<string, unknown>, agora: number): VigiaDaAtividade | null {
  const mudoMs = d.mudoMs;
  const emFundo = d.emFundo;
  if (typeof mudoMs !== "number" || !Number.isFinite(mudoMs) || mudoMs < 0 || typeof emFundo !== "number" || !Number.isFinite(emFundo) || emFundo < 0) return null;
  const r = d.repeticao && typeof d.repeticao === "object" ? (d.repeticao as Record<string, unknown>) : null;
  const rotulo = r ? texto(r.rotulo) : null;
  const repeticao = r && rotulo && typeof r.vezes === "number" && r.vezes > 0 ? { rotulo, vezes: r.vezes } : null;
  return { mudoDesde: mudoMs > 0 ? agora - mudoMs : null, aberta: texto(d.aberta), emFundo: Math.floor(emFundo), repeticao };
}

/** Um handler por TipoFrame — a tabela é TOTAL: um tipo novo no contrato não compila sem entrar aqui. */
type Handler = (estado: Estado, frame: FrameSse, agora: number) => Estado;

const conv = (f: FrameSse): Invalidacao | null => {
  const id = texto(f.dados.conversaId);
  return id ? `conversa:${id}` : null;
};

const POR_FRAME: Record<TipoFrame, Handler> = {
  // definido em 2026-09-29 (0039): a mensagem nova também relê os não lidos (o ponto da barra e o ícone do topo).
  "mensagem.nova": (e, f) => (conv(f) ? invalidar(e, conv(f), "nao-lidos") : e),
  "turno.iniciado": (e, f, agora) => {
    // definido em 2026-10-04 (ADR-072): o turno-cérebro da ligação não é trabalho do bot — nada de "trabalhando", fila ou Parar.
    if (f.dados.modo === "ligacao" || f.dados.origem === "ligacao") return e;
    const turnoId = texto(f.dados.turnoId);
    const conversaId = texto(f.dados.conversaId);
    if (!turnoId || !conversaId) return invalidar(e, conv(f));
    // Modo ligação (definido em 2026-10-04, ADR-071): o turno do cérebro da ligação não é "trabalhando", nem fila, nem
    // Parar — a tela da ligação mostra o que ele faz. O servidor marca o frame com `modo: "ligacao"` (e `origem`).
    if (turnoDeLigacao(f.dados)) return invalidar(e, conv(f));
    // dados.kind distingue "na fila" (turno_criado) de "rodando" (turno_despachado) — pendência L8 §5.
    const estado = f.dados.kind === "turno_despachado" ? "rodando" : "na_fila";
    const anterior = e.turnosVivos[turnoId];
    const vivo: TurnoVivo = { turnoId, conversaId, estado, executor: texto(f.dados.executor) ?? anterior?.executor ?? null, machineId: texto(f.dados.machine_id) ?? anterior?.machineId ?? null, desde: anterior?.desde ?? agora };
    return invalidar({ ...e, turnosVivos: { ...e.turnosVivos, [turnoId]: vivo } }, conv(f));
  },
  "turno.delta": (e, f) => {
    if (turnoDeLigacao(f.dados)) return e;
    const turnoId = texto(f.dados.turnoId);
    const conversaId = texto(f.dados.conversaId);
    const trecho = typeof f.dados.texto === "string" ? f.dados.texto : "";
    if (!turnoId || !conversaId) return e;
    const vivo = e.turnosVivos[turnoId];
    const turnosVivos = vivo && vivo.estado !== "rodando" ? { ...e.turnosVivos, [turnoId]: { ...vivo, estado: "rodando" as const } } : e.turnosVivos;
    if (!guardaAoVivo(e, conversaId)) return turnosVivos === e.turnosVivos ? e : { ...e, turnosVivos };
    return { ...e, turnosVivos, atividades: comAtividade(e, conversaId, turnoId, (a) => comTexto(a, trecho)) };
  },
  "turno.atividade": (e, f) => {
    if (turnoDeLigacao(f.dados)) return e;
    const turnoId = texto(f.dados.turnoId);
    const conversaId = texto(f.dados.conversaId);
    if (!turnoId || !conversaId || !guardaAoVivo(e, conversaId)) return e;
    const rotulo = texto(f.dados.rotulo) ?? "Usou uma ferramenta";
    const vivo = e.turnosVivos[turnoId];
    const turnosVivos = vivo && vivo.estado !== "rodando" ? { ...e.turnosVivos, [turnoId]: { ...vivo, estado: "rodando" as const } } : e.turnosVivos;
    return { ...e, turnosVivos, atividades: comAtividade(e, conversaId, turnoId, (a) => comFerramenta(a, rotulo)) };
  },
  "turno.tarefas": (e, f) => {
    if (turnoDeLigacao(f.dados)) return e;
    const turnoId = texto(f.dados.turnoId);
    const conversaId = texto(f.dados.conversaId);
    if (!turnoId || !conversaId || !guardaAoVivo(e, conversaId)) return e;
    return { ...e, atividades: comAtividade(e, conversaId, turnoId, (a) => comTarefas(a, tarefasDoFrame(f.dados.tarefas))) };
  },
  // NOD-73: o vigia só avisa. Guarda o aviso no turno vivo; a ligação não mostra nada disso (ADR-071).
  "turno.vigia": (e, f, agora) => {
    if (turnoDeLigacao(f.dados)) return e;
    const turnoId = texto(f.dados.turnoId);
    const conversaId = texto(f.dados.conversaId);
    if (!turnoId || !conversaId || !guardaAoVivo(e, conversaId)) return e;
    const vigia = vigiaDoFrame(f.dados, agora);
    if (!vigia) return e;
    return { ...e, atividades: comAtividade(e, conversaId, turnoId, (a) => comVigia(a, vigia)) };
  },
  // ADR-067: a volta do modelo virou mensagem e o turno segue rodando — a conversa relê, e o cartão ao vivo recomeça
  // vazio para a próxima volta (senão o mesmo texto apareceria duas vezes).
  "turno.fala": (e, f) => invalidar(semDelta(e, texto(f.dados.conversaId), texto(f.dados.turnoId)), conv(f)),
  "turno.encerrado": (e, f) => invalidar(semDelta(semTurnoVivo(e, texto(f.dados.turnoId)), texto(f.dados.conversaId), texto(f.dados.turnoId)), conv(f), "frota"),
  "turno.interrompido": (e, f) => invalidar(semDelta(semTurnoVivo(e, texto(f.dados.turnoId)), texto(f.dados.conversaId), texto(f.dados.turnoId)), conv(f), "frota", "sua-vez"),
  "decisao.nova": (e, f) => invalidar(e, "sua-vez", conv(f)),
  "decisao.decidida": (e, f) => invalidar(e, "sua-vez", conv(f)),
  "decisao.vencida": (e, f) => invalidar(e, "sua-vez", conv(f)),
  "proposta.nova": (e, f) => invalidar(e, conv(f)),
  "rotina.criada": (e, f) => invalidar(e, "rotinas", conv(f)),
  "rotina.executou": (e, f) => {
    const rotinaId = texto(f.dados.rotinaId) ?? texto(f.dados.rotina_id);
    return invalidar(e, "rotinas", conv(f), rotinaId ? `execucoes:${rotinaId}` : null);
  },
  "sala.handoff": (e, f) => invalidar(e, conv(f)),
  negacao: (e, f, agora) => {
    const classe = f.dados.classe;
    const motivo = f.dados.motivo;
    const nome = texto(f.dados.nome) ?? texto(f.dados.ferramenta) ?? "(sem nome)";
    const valida = (classe === "ferramenta_negada" || classe === "conector_indisponivel" || classe === "plano_ausente") && typeof motivo === "string";
    if (!valida) return invalidar(e, conv(f));
    const vista: NegacaoVista = { classe, nome, motivo: motivo as Negacao["motivo"], desde: typeof f.dados.desde === "number" ? f.dados.desde : agora, terminal: f.dados.terminal === true, conversaId: texto(f.dados.conversaId), vistaEm: agora };
    // definido em 2026-09-16: as 20 mais recentes bastam na tela; o registro completo está na trilha.
    return invalidar({ ...e, negacoes: [vista, ...e.negacoes].slice(0, 20) }, conv(f));
  },
  // definido em 2026-09-24 (emenda da ADR-037): só a SAÚDE (entrou ou saiu do ar) muda a frota — a
  // lateral, o cabeçalho e o painel; as ações comuns do computador não relêem nada.
  "computador.mudou": (e, f) => (f.dados.saude === true ? invalidar(e, "frota") : e),
  "inventario.mudou": (e) => invalidar(e, "inventario", "frota", "executor"),
  "agente.mudou": (e, f) => {
    const agenteId = texto(f.dados.agente_id) ?? texto(f.dados.agenteId);
    // definido em 2026-09-30 (ADR-064): anotar, resolver ou pedir uma pendência só muda o "a fazer" do bot. A linha de
    // sistema do resolver e a fala do Fazer agora chegam pelos frames delas (mensagem.nova, turno.iniciado).
    if (String(f.dados.acao).startsWith("pendencia_")) return agenteId && A_FAZER_LIGADO ? invalidar(e, `pendencias:${agenteId}`) : e;
    const memoria: Invalidacao | null = f.dados.acao === "memoria_criada" && agenteId ? `memoria:${agenteId}` : null;
    const concessoes: Invalidacao | null = f.dados.kind === "concessao_criada" && agenteId ? `concessoes:${agenteId}` : null;
    return invalidar(e, "frota", "gestao", "nao-lidos", ...(["excluir", "restaurar", "duplicado"].includes(String(f.dados.acao)) ? ["rotinas", "salas", "sua-vez"] as const : []), conv(f), memoria, concessoes);
  },
  "parada.faixa": (e, f) => {
    const faixa: FaixaParada = {
      interrompidas: typeof f.dados.interrompidas === "number" ? f.dados.interrompidas : 0,
      naoInterrompidas: [],
      jaEntregues: [],
      nadaRodando: f.dados.nada_rodando === true,
    };
    return invalidar({ ...e, faixaParada: faixa }, conv(f));
  },
  // O relato é registro, não estado vivo da conversa: nada na timeline muda, então nada se invalida.
  // A tela de relatos recarrega quando é aberta (definido em 2026-09-21).
  "relato.criado": (e) => e,
  // A linha "Chat de voz" da conversa e a ligação viva (a barra lateral marca o bot "Em ligação").
  "ligacao.mudou": (e, f) => invalidar(e, conv(f), "ligacao"),
  // ADR-081: o lane da web (#195/#196) troca estes dois por releitura dos trabalhos e da pressão.
  "trabalho.mudou": (e, f) => (conv(f) ? invalidar(e, conv(f)) : e),
  "memoria.mudou": (e) => e,
  resumed: (e, f) => (f.dados.resumed === true ? e : invalidar(e, "frota", "sua-vez", "nao-lidos", "rotinas", "conectores", "inventario", "executor", "salas", ...Object.keys(e.conversas).map((id): Invalidacao => `conversa:${id}`))),
};

export function aplicarFrame(estado: Estado, frame: FrameSse, agora: number): Estado {
  const handler = POR_FRAME[frame.tipo];
  return handler ? handler(estado, frame, agora) : estado;
}

export function reduzir(estado: Estado, acao: Acao): Estado {
  switch (acao.tipo) {
    case "sessao":
      // Trocou a pessoa: chaves E relatos somem. Relato carrega correlationId, machineId e o erro
      // cru do fornecedor — não pode ficar na tela da próxima sessão (ADR-002).
      return { ...estado, sessao: acao.escopo, chaves: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.chaves : null, relatos: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.relatos : null, chaveEmitida: null,
        modoDev: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.modoDev : { ligado: false, raioX: {} },
        naoLidos: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.naoLidos : null, novasDesde: {},
        carregado: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.carregado : estadoInicial.carregado,
        ligacaoViva: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.ligacaoViva : null,
        disponibilidadeLigacao: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.disponibilidadeLigacao : {},
        ...(acao.escopo?.pessoaId === estado.sessao?.pessoaId ? {} : { onboarding: undefined, onboardingAberto: false, onboardingResolvido: false }) };
    case "navegar":
      return resolverInicio({
        ...estado,
        tela: acao.tela,
        // Ir a outro lugar (o clique num aviso, por exemplo) fecha Seu espaço: a pessoa foi para onde pediu.
        espaco: null,
        erro: null,
        // A gaveta só continua num nível interno se a conversa é do mesmo bot; outro bot abre na visão geral.
        gaveta: acao.tela.tipo === "conversa" && estado.gaveta?.agenteId === acao.tela.agenteId ? estado.gaveta : null,
        faixaParada: acao.tela.tipo === estado.tela.tipo ? estado.faixaParada : null,
        // Saiu de Computadores: a chave crua some da memória (ela aparece uma vez só).
        chaveEmitida: null,
        // A linha "Novas" vale enquanto a pessoa está na conversa; saiu, ela some.
        novasDesde: {},
      });
    case "espaco":
      // A chave crua só vive enquanto a pessoa está em Computadores; trocar de seção ou fechar a descarta.
      return { ...estado, espaco: acao.secao ? { secao: acao.secao } : null, chaveEmitida: acao.secao === "computadores" ? estado.chaveEmitida : null, erro: null };
    case "cancelando-turno":
      return { ...estado, cancelando: { ...estado.cancelando, [acao.turnoId]: acao.agora } };
    case "desfazer-cancelamento": {
      if (!(acao.turnoId in estado.cancelando)) return estado;
      const cancelando = { ...estado.cancelando };
      delete cancelando[acao.turnoId];
      return { ...estado, cancelando };
    }
    case "tick": {
      // definido em 2026-09-24 (ADR-045): nenhum evento diz que o Mac voltou (o fechamento do aviso é do
      // varredor, no modo compartilhado). Enquanto houver aviso EM CURSO, cada tick relê "Sua vez".
      const comAgora = { ...estado, agora: acao.agora };
      return estado.suaVez?.incidentes.some((i) => i.voltouEm === null) ? invalidar(comAgora, "sua-vez") : comAgora;
    }
    case "conexao":
      return { ...estado, conexao: { estado: acao.estado, tentativa: acao.tentativa, proximaEmMs: acao.proximaEmMs } };
    case "frame":
      return aplicarFrame(estado, acao.frame, acao.agora);
    case "hidratar-gestao":
      return { ...estado, gestao: acao.gestao };
    case "hidratar-frota":
      return resolverInicio({ ...estado, frota: acao.frota, inventario: acao.frota.inventario });
    case "hidratar-inventario":
      return { ...estado, inventario: acao.inventario };
    case "hidratar-executor":
      return { ...estado, executor: acao.executor };
    case "hidratar-conversa": {
      const conversaId = acao.conversa.conversa.id;
      // Turno aberto que a web não viu nascer (página recarregada no meio dele): o REST o devolve e ele
      // volta a ser vivo, com o `desde` do banco. O frame turno.iniciado não se repete para quem chegou depois.
      // TODO(servidor, modo ligação): `TurnoEmCursoDto` (src/contracts/api.ts) não traz `origem`; o plano diz que
      // `lerConversa` já exclui o turno `ligacao`. Se ele vier, a web o ignora aqui pelo campo `origem` (ou `modo`).
      const novos = (acao.conversa.turnosEmCurso ?? []).filter((t) => !estado.turnosVivos[t.id] && !("origem" in t && t.origem === "ligacao") && !("modo" in t && t.modo === "ligacao"));
      const turnosVivos = novos.length === 0 ? estado.turnosVivos : { ...estado.turnosVivos };
      for (const t of novos) turnosVivos[t.id] = { turnoId: t.id, conversaId, estado: t.estado === "despachando" ? "rodando" : "na_fila", executor: null, machineId: null, desde: t.desde };
      // O texto em streaming de um turno que já acabou sai; o dos que continuam vivos fica.
      const vivosDaConversa = new Set(Object.values(turnosVivos).filter((t) => t.conversaId === conversaId).map((t) => t.turnoId));
      const anteriores = estado.atividades[conversaId] ?? {};
      const mortos = Object.keys(anteriores).filter((turnoId) => !vivosDaConversa.has(turnoId));
      let atividades = estado.atividades;
      if (mortos.length > 0) {
        const restantes = { ...anteriores };
        for (const turnoId of mortos) delete restantes[turnoId];
        atividades = { ...estado.atividades, [conversaId]: restantes };
      }
      return { ...estado, turnosVivos, atividades, conversas: { ...estado.conversas, [conversaId]: { ...acao.conversa, carregadaEm: acao.agora } } };
    }
    case "hidratar-sua-vez": {
      // A escolha do campo só vale enquanto a conversa tem pergunta aberta: respondida ou deixada pra lá
      // (aqui ou noutra aba), um "Outro assunto" antigo não pode decidir pela pergunta seguinte.
      const comPergunta = conversasComPergunta(acao.suaVez);
      const composer = Object.fromEntries(Object.entries(estado.composer).filter(([conversaId]) => comPergunta.has(conversaId)));
      return { ...estado, suaVez: acao.suaVez, composer };
    }
    case "hidratar-rotinas":
      return { ...estado, rotinas: acao.rotinas, carregado: estado.carregado.rotinas ? estado.carregado : { ...estado.carregado, rotinas: true } };
    case "hidratar-execucoes":
      return { ...estado, execucoes: { ...estado.execucoes, [acao.rotinaId]: acao.execucoes } };
    case "alternar-historico":
      return { ...estado, historicoAberto: { ...estado.historicoAberto, [acao.rotinaId]: !estado.historicoAberto[acao.rotinaId] } };
    case "conexao-app": {
      const conectando = { ...estado.conectando };
      if (acao.valor) conectando[acao.slug] = acao.valor;
      else delete conectando[acao.slug];
      return { ...estado, conectando, avisoConexao: acao.valor ? null : estado.avisoConexao };
    }
    case "gaveta":
      return { ...estado, gaveta: acao.nivel ? { agenteId: acao.agenteId, nivel: acao.nivel } : null };
    case "lista-de-pasta":
      return { ...estado, listaDePasta: { ...estado.listaDePasta, [acao.propostaId]: acao.lista } };
    case "aviso-conexao":
      return { ...estado, avisoConexao: acao.texto };
    case "hidratar-conectores":
      return { ...estado, conectores: acao.conectores, marketplace: acao.marketplace ?? estado.marketplace, composioConfigurado: acao.composioConfigurado ?? estado.composioConfigurado, carregado: estado.carregado.conectores ? estado.carregado : { ...estado.carregado, conectores: true } };
    case "hidratar-concessoes":
      // Sem as dispensas na resposta, o que havia fica: sem saber o que a pessoa dispensou, o cartão de liberar não aparece.
      return { ...estado, concessoes: { ...estado.concessoes, [acao.agenteId]: acao.concessoes }, liberacoesDispensadas: acao.liberacoesDispensadas ? { ...estado.liberacoesDispensadas, [acao.agenteId]: acao.liberacoesDispensadas } : estado.liberacoesDispensadas };
    case "hidratar-memorias":
      return { ...estado, memorias: { ...estado.memorias, [acao.agenteId]: acao.memorias } };
    case "hidratar-pendencias": {
      // Sem nenhuma, o indicador some; a lista aberta fecha junto, para a próxima pendência não reabrir sozinha.
      const aFazerAberto = acao.pendencias.length === 0 && estado.aFazerAberto[acao.agenteId] ? { ...estado.aFazerAberto, [acao.agenteId]: false } : estado.aFazerAberto;
      return { ...estado, pendencias: { ...estado.pendencias, [acao.agenteId]: acao.pendencias }, aFazerAberto };
    }
    case "a-fazer":
      return { ...estado, aFazerAberto: { ...estado.aFazerAberto, [acao.agenteId]: acao.aberto } };
    case "hidratar-salas":
      return { ...estado, salas: acao.salas, carregado: estado.carregado.salas ? estado.carregado : { ...estado.carregado, salas: true } };
    case "hidratar-nao-lidos":
      return { ...estado, naoLidos: acao.naoLidos };
    case "novas-desde":
      return { ...estado, novasDesde: { ...estado.novasDesde, [acao.conversaId]: { mensagemId: acao.mensagemId, em: acao.em, total: acao.total } } };
    case "hidratar-chaves":
      return { ...estado, chaves: acao.chaves };
    case "hidratar-relatos":
      return { ...estado, relatos: acao.relatos };
    // Desligado, os resumos saem da memória: religar busca de novo, com o que mudou nesse meio-tempo.
    case "modo-dev":
      return { ...estado, modoDev: { ligado: acao.ligado, raioX: acao.ligado ? estado.modoDev.raioX : {} } };
    case "hidratar-raio-x":
      return estado.modoDev.ligado ? { ...estado, modoDev: { ...estado.modoDev, raioX: { ...estado.modoDev.raioX, [acao.conversaId]: acao.raioX } } } : estado;
    case "chave-emitida":
      return acao.emitida ? invalidar({ ...estado, chaveEmitida: acao.emitida }, "chaves") : { ...estado, chaveEmitida: null };
    case "faixa":
      return { ...estado, faixaParada: acao.faixa };
    case "composer": {
      const composer = { ...estado.composer };
      if (acao.escolha) composer[acao.conversaId] = acao.escolha;
      else delete composer[acao.conversaId];
      return { ...estado, composer };
    }
    case "invalidar":
      return invalidar(estado, ...acao.quais);
    case "invalidacoes-tratadas":
      return { ...estado, invalidacoes: estado.invalidacoes.filter((q) => !acao.quais.includes(q)) };
    case "erro":
      return { ...estado, erro: acao.erro, ocupado: false };
    case "ocupado":
      return { ...estado, ocupado: acao.valor };
    case "ligacao-viva": {
      const a = estado.ligacaoViva;
      const b = acao.viva;
      const igual = a === b || (a !== null && b !== null && a.ligacaoId === b.ligacaoId && a.local === b.local && a.agenteId === b.agenteId);
      return igual ? estado : { ...estado, ligacaoViva: b };
    }
    case "hidratar-disponibilidade-ligacao":
      return { ...estado, disponibilidadeLigacao: { ...estado.disponibilidadeLigacao, [acao.agenteId]: acao.disponibilidade } };
    case "hidratar-onboarding":
      return resolverInicio({ ...estado, onboarding: acao.onboarding });
    case "onboarding-aberto":
      return estado.onboardingAberto === acao.aberto ? estado : { ...estado, onboardingAberto: acao.aberto };
    case "esquecer-disponibilidade-ligacao": {
      if (!(acao.agenteId in estado.disponibilidadeLigacao)) return estado;
      const disponibilidadeLigacao = { ...estado.disponibilidadeLigacao };
      delete disponibilidadeLigacao[acao.agenteId];
      return { ...estado, disponibilidadeLigacao };
    }
  }
}

/**
 * O que mudou entre dois estados aparece na tela? definido em 2026-09-30: o frame de um bot que NÃO está
 * na tela (turno.delta, turno.atividade, turno.tarefas) só mexe em `atividades` da conversa dele, e só a
 * timeline da conversa aberta lê `atividades`. medido em 2026-09-30: redesenhar a tela inteira a cada um
 * desses frames travou a página por 118 s com 8 bots escrevendo e uma conversa de 200 mensagens aberta
 * (scripts/carga-tela). `invalidacoes` também não aparece: só o laço de reidratação a lê, e o que ele
 * busca redesenha ao chegar. Qualquer outra referência nova conta como mudança.
 */
export function mudouNaTela(antes: Estado, depois: Estado): boolean {
  if (antes === depois) return false;
  const naTela = conversaIdNaTela(depois);
  for (const k of Object.keys(depois) as (keyof Estado)[]) {
    if (k === "invalidacoes" || antes[k] === depois[k]) continue;
    if (k === "atividades" && (naTela === null || antes.atividades[naTela] === depois.atividades[naTela])) continue;
    return true;
  }
  return false;
}

export function agenteDaTela(estado: Estado): string | null {
  const t = estado.tela;
  if (t.tipo === "conversa") return t.agenteId;
  return null;
}

export function conversaDaTela(estado: Estado): ConversaEstado | null {
  const t = estado.tela;
  if (t.tipo !== "conversa" && t.tipo !== "sala") return null;
  return estado.conversas[t.conversaId] ?? null;
}

/**
 * definido em 2026-09-24: não há página inicial — o app abre na conversa do primeiro agente da pessoa
 * (fixados primeiro, na ordem da barra lateral) e, sem nenhum, em "Novo bot". Enquanto a frota não chega
 * a tela fica "inicio" (vazia); qualquer navegação para "inicio" resolve do mesmo jeito.
 */
export function resolverInicio(entrada: Estado): Estado {
  let estado = entrada;
  // definido em 2026-10-04 (ADR-077): quem não concluiu o onboarding abre nele (a camada #onboarding por cima do app). A
  // primeira leitura que diz `mostrar` abre uma vez; fechar (concluir) não reabre sozinho — só "Ver o onboarding de novo".
  if (estado.onboarding !== undefined && !estado.onboardingResolvido) {
    const o = estado.onboarding;
    if (o?.mostrar) {
      const guia = o.guia;
      return { ...estado, onboardingResolvido: true, onboardingAberto: true, tela: guia ? { tipo: "conversa", conversaId: guia.conversaId, agenteId: guia.id } : estado.tela };
    }
    estado = { ...estado, onboardingResolvido: true };
  }
  if (estado.tela.tipo !== "inicio" || !estado.frota) return estado;
  const meus = estado.frota.agentes.filter((a) => a.ownerId === estado.sessao?.pessoaId && a.conversaId);
  const primeiro = meus.find((a) => a.fixado) ?? meus[0];
  const tela: Tela = primeiro ? { tipo: "conversa", conversaId: primeiro.conversaId, agenteId: primeiro.id } : { tipo: "novo-bot" };
  return { ...estado, tela };
}

/** O que a tela atual precisa ter carregado (o main busca o que faltar). */
export function invalidacoesDaTela(estado: Estado): Invalidacao[] {
  const t = estado.tela;
  const faltas: Invalidacao[] = [];
  const secao = estado.espaco?.secao;
  if (secao === "agentes" && !estado.gestao) faltas.push("gestao");
  if (!estado.frota) faltas.push("frota");
  // ADR-077: o onboarding é lido uma vez por sessão (a falha vira null e o app abre normal).
  if (estado.sessao && estado.onboarding === undefined) faltas.push("onboarding");
  if ((t.tipo === "conversa" || t.tipo === "sala") && !estado.conversas[t.conversaId]) faltas.push(`conversa:${t.conversaId}`);
  if (t.tipo === "sala" && !estado.carregado.salas) faltas.push("salas");
  if (t.tipo === "nova-sala" && !estado.carregado.salas) faltas.push("salas");
  if (t.tipo === "conversa" && !estado.concessoes[t.agenteId]) faltas.push(`concessoes:${t.agenteId}`);
  // ADR-064: o "a fazer" aparece embaixo da última mensagem e na gaveta, então chega junto com a conversa.
  if (A_FAZER_LIGADO && t.tipo === "conversa" && !estado.pendencias[t.agenteId]) faltas.push(`pendencias:${t.agenteId}`);
  // Modo ligação (2026-10-04): o botão "Ligar" do cabeçalho só aparece com a disponibilidade lida, e só para bot da pessoa.
  if (t.tipo === "conversa" && !(t.agenteId in estado.disponibilidadeLigacao) && estado.frota?.agentes.some((a) => a.id === t.agenteId && a.ownerId === estado.sessao?.pessoaId)) faltas.push(`disponibilidade:${t.agenteId}`);
  // Os níveis da gaveta que leem algo próprio: a memória do bot e o histórico da rotina aberta.
  const nivel = t.tipo === "conversa" && estado.gaveta?.agenteId === t.agenteId ? estado.gaveta.nivel : null;
  if (nivel?.tipo === "memoria" && !estado.memorias[estado.gaveta?.agenteId ?? ""]) faltas.push(`memoria:${estado.gaveta?.agenteId ?? ""}`);
  if (nivel?.tipo === "rotina" && !estado.execucoes[nivel.id]) faltas.push(`execucoes:${nivel.id}`);
  // definido em 2026-09-25: o marketplace diz quais bots usam cada app, então precisa das concessões de todos os bots da pessoa.
  if (t.tipo === "conectores") for (const a of estado.frota?.agentes ?? []) if (a.ownerId === estado.sessao?.pessoaId && !estado.concessoes[a.id]) faltas.push(`concessoes:${a.id}`);
  // definido em 2026-09-18: as rotinas do bot moram no painel Detalhes da conversa, então precisam
  // chegar junto com ela — não só na tela dedicada.
  if ((t.tipo === "rotinas" || t.tipo === "conversa") && !estado.carregado.rotinas) faltas.push("rotinas");
  // definido em 2026-09-24 ("rotina nasce com o acesso"): "Sua vez" também, porque o card da rotina proposta
  // diz se o app que ela precisa já está conectado ("Conectar {App}" ou "Criar rotina e permitir leitura").
  if ((t.tipo === "conectores" || t.tipo === "conversa" || t.tipo === "sala" || t.tipo === "sua-vez") && !estado.carregado.conectores) faltas.push("conectores");
  // A fila alimenta o badge ⚑ da sidebar e a faixa de chamada em QUALQUER tela: sem o rail, ela é o
  // único aviso de que há decisão parada.
  if (!estado.suaVez) faltas.push("sua-vez");
  // O ícone de Não lidos e o ponto de cada linha da barra valem em qualquer tela, como a fila.
  if (!estado.naoLidos) faltas.push("nao-lidos");
  if (secao === "computadores" && !estado.chaves) faltas.push("chaves");
  // O frame relato.criado não invalida nada (é registro), então a seção busca quando ainda não tem.
  if (secao === "relatos" && !estado.relatos) faltas.push("relatos");
  return faltas.filter((f) => !estado.invalidacoes.includes(f));
}
