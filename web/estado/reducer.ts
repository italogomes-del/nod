import type { Agente, CorAgente, FormaAgente } from "../../src/contracts/agente.ts";
import type { AtividadeDto } from "../../src/contracts/atividade.ts";
import type { ChaveEmitidaDto, ChaveMaquinaDto, ConversaDto, FrotaDto, RotinaDto, SuaVezDto } from "../../src/contracts/api.ts";
import type { MaquinasDto } from "../../src/contracts/maquina.ts";
import type { InstalacaoSshDto, MetodoSsh } from "../../src/contracts/instalacoes-ssh.ts";
import type { ResumoDaChave } from "../lib/chave-ssh.ts";
import type { ContasIaDto } from "../../src/contracts/contas-ia.ts";
import type { DetalhesDasContas } from "../../src/contracts/desktop.ts";
import type { Concessao } from "../../src/contracts/concessao.ts";
import type { Conector } from "../../src/contracts/conector.ts";
import type { EstadoExecutor } from "../../src/contracts/executor.ts";
import type { FrameSse, TipoFrame } from "../../src/contracts/frame.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { IasDaPessoa } from "../../src/contracts/inteligencia.ts";
import type { UsoDoPlanoDto } from "../../src/contracts/uso-do-plano.ts";
import type { DisponibilidadeLigacao } from "../../src/contracts/ligacao.ts";
import type { EstadoOnboarding } from "../../src/contracts/onboarding.ts";
import type { AppComLogo } from "../../src/contracts/marketplace.ts";
import type { Memoria } from "../../src/contracts/memoria.ts";
import type { NaoLidosDto } from "../../src/contracts/nao-lidos.ts";
import type { CausaNativa, Negacao } from "../../src/contracts/negacao.ts";
import type { ExecucaoRotina } from "../../src/contracts/rotina.ts";
import type { Experimentos, RaioXConversa, UsoDoMac } from "../../src/contracts/raio-x.ts";
import type { Relato } from "../../src/contracts/relato.ts";
import type { MembroSala, Sala } from "../../src/contracts/sala.ts";
import type { EstadoDaTarefa, EstadoDoSubagente, FaixaParada, SubagenteVivo, TarefaDoBot } from "../../src/contracts/turno.ts";
import type { DonoDto, EstadoDoDono } from "../../src/contracts/dono.ts";
import type { NivelPressao, TaxaDeAbertura, TrabalhoDetalheDto, TrabalhosDto } from "../../src/contracts/trabalho.ts";
import type { CustoDoDiaDto } from "../../src/contracts/cota.ts";
import type { Escopo } from "../../src/shared/types.ts";
import type { LeituraAtual } from "../lib/ouvir.ts";
import { FALA_SAINDO_MS } from "../lib/fala-viva.ts";
import { acoesFechadas, ATIVIDADE_VAZIA, linhasDoResumo, comFerramenta, comFimDaAcao, comSubagentes, comTarefas, comTexto, comVigia, SEM_NOME_DA_FERRAMENTA, semFerramentaAberta, soSubagentes, subagentesParados, textoDaFala, type AtividadeTurno, type FerramentaEmUso, type SubagentesDoTurno, type VigiaDaAtividade } from "../lib/atividade.ts";
import { chaveDaAtividade, diaLocal, type VistaDaAtividade } from "../lib/atividade-do-bot.ts";
import type { PaginaDaBiblioteca } from "../../src/contracts/biblioteca.ts";
import { gruposVisiveis, juntarPagina, POR_VEZ, type BibliotecaDaConversa, type GrupoBiblioteca } from "../lib/biblioteca.ts";
import type { EstadoConexao } from "../lib/live-events.ts";
import { ehErroDeRede, type ErroNaTela } from "../lib/erro-da-tela.ts";
import { lembrarComputador, MEMORIA_INICIAL, UI_INICIAL as UI_COMPUTADOR_INICIAL, type ComputadorPessoaDto, type ComputadorUi, type MemoriaDoComputador } from "../lib/computador-pessoa.ts";
import { conversasComPergunta } from "../lib/perguntas.ts";
import { UI_IAS_INICIAL, type UiIas } from "../telas/cartao-ia.ts";
import { UI_CONTAS_INICIAL, type UiContas } from "../telas/contas-lista.ts";
import { UI_NUVEM_INICIAL, type UiNuvem } from "../lib/maquina-nuvem.ts";
import type { RascunhoInteligencia } from "../telas/inteligencia.ts";

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
  | { tipo: "nova-sala" }
  /** ADR-083 (#196): "Todos os trabalhos" — os de todos os bots da pessoa, com os filtros De você / Rotinas / Entre bots. */
  | { tipo: "trabalhos"; filtro?: FiltroTrabalhos }
  /**
   * ADR-083 (#195): a tela da task. `voltar` é a tela de onde a pessoa veio (o Fechar e o Esc voltam para ela); abrir
   * outra task de dentro de uma task mantém o `voltar` de fora.
   */
  | { tipo: "trabalho"; id: string; voltar: Tela }
  /**
   * definido em 2026-10-07 (#191): a tela provisória de uma linha do chat sem trabalho por trás (execuções antigas de
   * rotina, pedido a colega de antes do ADR-083): as mensagens que a linha recolheu, na ordem, com Fechar.
   */
  /** `rotina` (definido em 2026-10-08, QA do épico, R2): a tela separa as execuções da rotina, uma a uma. */
  | { tipo: "linha"; conversaId: string; mensagens: string[]; titulo: string; voltar: Tela; rotina?: boolean };

/** Os filtros de "Todos os trabalhos": De você (pessoa e rede), Rotinas e Entre bots (colega). */
export type FiltroTrabalhos = "todos" | "voce" | "rotinas" | "bots";

/**
 * "Seu espaço" (definido em 2026-09-30, canvas "Menu, sidebar e gaveta"): o que é da CONTA abre pelo menu do avatar numa
 * camada de tela cheia POR CIMA da tela atual, que continua montada embaixo — sair devolve a conversa exata (rolagem,
 * rascunho, gaveta). Gerenciar agentes, Relatos e Computadores deixaram de ser telas e viraram seções daqui.
 */
/**
 * ADR-090: o "Conectar uma máquina" (protótipo "Nod — Motor na VM", prancha 2): o comando, o código, a confirmação
 * ("Conectar vm-sp?"), o login das IAs e a escolha dos bots. `chavesAntes`: as chaves que já existiam, para achar a nova.
 */
/** NOD-94: uma máquina da pessoa que pode instalar por SSH agora (o Mac ou um motor que puxou há pouco). */
export type InstaladoraSsh = { id: string; nome: string; plataforma: string };

/**
 * NOD-94: o "Usar uma máquina só para o computador" (instalação por SSH, emenda 11 da ADR-090). A chave, a frase, a
 * senha e a do sudo NUNCA ficam aqui: moram só na memória do controlador (web/lib/instalar-ssh.ts) enquanto o diálogo
 * está aberto, e só saem cifradas para a instaladora. Aqui fica o que a tela mostra.
 */
export type InstalarSsh = {
  fase: "form" | "progresso";
  /** O que a pessoa digitou no Endereço: `host`, `host:porta` ou, no Mac, o apelido do ~/.ssh/config. */
  endereco: string;
  usuario: string;
  metodo: MetodoSsh;
  /** A chave colada, resumida (tipo e impressão); null = ainda não colou. */
  chave: ResumoDaChave | null;
  temFrase: boolean;
  /** null = carregando. */
  instaladoras: InstaladoraSsh[] | null;
  origemId: string | null;
  trocarOrigem: boolean;
  /** 409 `ja_tem_computador`: a tela pergunta "Substituir?"; `confirmado` = a pessoa disse sim. */
  substituir: { nome: string; confirmado: boolean } | null;
  pedido: InstalacaoSshDto | null;
  /** O erro que mora num campo (aria-invalid + aria-describedby). */
  campoErro: { campo: "endereco" | "usuario" | "acesso" | "sudo"; texto: string } | null;
  /** O erro geral, em âmbar (sem instaladora, falha de rede). */
  erro: string | null;
  /** `sem_sudo` com chave: a etapa Conferindo para e pede a senha do sudo no diálogo. */
  pedeSudo: boolean;
  mostrarSudo: boolean;
  /** "Prefere fazer você mesmo?": o comando com o convite (criado ao abrir). null = fechado. */
  manual: string | null;
  segundoPlano: boolean;
  enviando: boolean;
  /** As origens que já tentaram e não acharam rota (o "Tentar a partir de" oferece as outras). */
  tentadas: string[];
};

export type ConectarMaquina = {
  passo: "comando" | "codigo" | "confirmar" | "ias" | "bots";
  codigo: string;
  pedido: { nome: string; plataforma: string; pedidoHaS: number } | null;
  erro: string | null;
  chavesAntes: string[];
  marcados: string[];
  /** ADR-102: o convite do comando de instalação (modo compartilhado); a tela vê a máquina chegar sem código. */
  convite?: string | null;
  /** Até quando o convite vale (o servidor diz); a tela para de esperar e mostra a hora. */
  conviteAte?: number | null;
};

export type SecaoEspaco = "conta" | "conexao" | "avisos" | "preferencias" | "este-mac" | "maquinas" | "computador-do-bot" | "computadores" | "agentes" | "relatos";

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
  | { tipo: "nova-rotina" }
  /** ADR-083 (#196): os trabalhos do bot por grupo (Precisa de você, Trabalhando, Na fila, Terminados hoje). */
  | { tipo: "trabalhos" }
  /** ADR-114 (chat limpo, PR 2): o que saiu do chat do bot, um dia por vez (web/telas/atividade.ts). */
  | { tipo: "atividade" }
  /** ADR-125 (NOD-349): Atalhos, Perfil (Missão e voz), Acessos, Ambiente e o Modo dev, fora da visão geral. */
  | { tipo: "ajustes" };

/** ADR-125: as abas da visão geral da gaveta (a Biblioteca chegou com a NOD-326). */
export type AbaGaveta = "detalhes" | "biblioteca" | "computador";

/** ADR-125: o que a aba Computador mostra, lido de `GET agentes/:id/computador` (web/lib/computador.ts). */
export type EstadoComputadorBot = "ligado" | "ocupado" | "dormindo" | "sem" | "fora" | "indisponivel" | "erro";

/**
 * `semJanela` (revisão do PR #264, NOD-208): a janela de login não abriu (bloqueador de pop-up, app desktop ou
 * a re-sonda do "Tentar de novo", que a abre fora do clique). O bloco de espera mostra "Abrir o login" como link.
 */
export type ConexaoApp = { url: string | null; falhou: string | null; semJanela?: boolean };

/**
 * A ligação viva da pessoa (definido em 2026-10-04, ADR-071): `local` = aberta NESTA página (a tela da ligação);
 * senão veio de `GET ligacoes/viva` (outra janela). A barra lateral marca o bot "Em ligação" nos dois casos.
 */
export type LigacaoVivaNaTela = { ligacaoId: string; agenteId: string; conversaId: string; local: boolean };

/**
 * `trabalhoId` (ADR-083): o turno é de um trabalho — o ao vivo dele aparece na tela da task, nunca no chat.
 * `vistoEm` (NOD-216): o relógio da web quando o servidor confirmou o turno pela última vez (frame ou leitura). A leitura
 * que não o traz só o tira se ela saiu DEPOIS disso — um frame mais novo que o GET não some com a resposta velha.
 * `chegouEm` (NOD-216, revisão): o relógio DA WEB quando ela viu o turno pela primeira vez — a janela de "pensando" conta
 * daqui, e não do `desde` do banco, que vem no relógio do servidor (um relógio adiantado ou atrasado decidiria a animação).
 * `origem` (NOD-216, revisão): de onde o turno veio (`turno_criado.origem`, `TurnoEmCursoDto.origem`); só as origens da
 * fila do dono (`ORIGENS_DA_FILA_DO_DONO`) podem ser desmentidas por ela.
 */
/** `agenteId` (NOD-348): o bot do turno, do `agente_id` do frame — na sala, cada fala viva tem o mascote de quem fala. */
/** O turno que acabou com texto, guardado com a atividade até a releitura da conversa (`em`: a hora do fim). */
export type FalaSaindo = { turno: TurnoVivo; atividade: AtividadeTurno; em: number };
export type TurnoVivo = { turnoId: string; conversaId: string; estado: "na_fila" | "rodando"; executor: string | null; machineId: string | null; desde: number; trabalhoId?: string | null; vistoEm?: number; chegouEm?: number; origem?: string | null; agenteId?: string | null };

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

/**
 * definido em 2026-10-18 (ADR-113, plano "pergunta com botões", Parte 3b): a fala a que a PRÓXIMA mensagem do campo
 * responde, escolhida pelo "Responder" da barra de ações. Fica fora de `composer` de propósito: `hidratar-sua-vez` apaga
 * a escolha do campo nas conversas sem pergunta aberta, e a citação não pode sumir por ali (revisão de engenharia do
 * plano). O `trecho` é só para a caixa "Respondendo": o servidor recalcula o dele a partir de `mensagemId`. Vale até o
 * envio ou o × da caixa.
 */
export type CitacaoNoCampo = { mensagemId: string; trecho: string };

export type Invalidacao = "onboarding" | "ligacao" | "trabalhos" | "custo" | `trabalho:${string}` | `disponibilidade:${string}` | "gestao" | "frota" | "sua-vez" | "nao-lidos" | "rotinas" | "conectores" | "inventario" | "executor" | "ias" | "uso-plano" | "salas" | "chaves" | "maquinas" | "nuvem" | "contas" | "relatos" | `conversa:${string}` | `vivos:${string}` | `memoria:${string}` | `concessoes:${string}` | `execucoes:${string}` | `atividade:${string}` | `atividade-hoje:${string}` | `biblioteca:${string}`;

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
  /**
   * As IAs da pessoa (`GET /ias`, definido em 2026-10-10, plano das IAs): a ordem do Automático, o estado de cada uma com
   * o limite e os modelos. undefined = ainda não lido; null = o servidor não tem a rota (versão anterior).
   */
  ias?: IasDaPessoa | null;
  /**
   * O uso da janela de cada IA (`GET /uso-do-plano`, NOD-179), para o anel do seletor de IA do campo (definido em
   * 2026-10-16, plano "tela limpa", decisão E6). undefined = ainda não lido; null = o servidor não tem a rota.
   */
  usoDoPlano?: UsoDoPlanoDto | null;
  /** As IAs do app do Mac (`nodDesktop.ias`) e o que é só da tela nos cartões (web/telas/cartao-ia.ts). */
  iasMac: UiIas;
  /** O rascunho do nível Inteligência da gaveta (2B) até Salvar; null = nenhum. */
  rascunhoIa: RascunhoInteligencia | null;
  /** O bot cujo menu de Inteligência (2A) está aberto na gaveta; null = fechado. */
  menuIa: string | null;
  conversas: Record<string, ConversaEstado>;
  /**
   * O turno vivo de cada conversa carregada (turno.delta, turno.atividade, turno.tarefas), por conversaId e
   * turnoId, descartado ao encerrar. definido em 2026-09-30: mora fora de `conversas` porque muda a cada
   * pedaço de texto de cada bot; dentro da conversa, cada pedaço trocava a referência dela e forçava a
   * timeline inteira a ser refeita (web/lib/lembrar.ts).
   */
  atividades: Record<string, Record<string, AtividadeTurno>>;
  turnosVivos: Record<string, TurnoVivo>;
  /**
   * NOD-348 (QA do #508): a fala viva que virou mensagem (o turno acabou, ou `turno.fala` no meio dele), por conversa e
   * por turno, até a releitura que saiu depois dela trazer a fala gravada — sem ela, a timeline ficava um quadro sem fala
   * nenhuma e a conversa pulava ~95 px no fim de todo turno. Some sozinha em `FALA_SAINDO_MS` (o tick limpa).
   */
  falasSaindo?: Record<string, Record<string, FalaSaindo>>;
  /**
   * Os últimos turnos que a web viu encerrar ou ser interrompidos (definido em 2026-10-08, revisão W6): o `GET
   * trabalhos/:id` que saiu antes do `turno.encerrado` e chega depois dele traz o turno ainda vivo, e sem esta lista o
   * bot ficava "Trabalhando" para sempre. Só os mais recentes (`ENCERRADOS_GUARDADOS`).
   */
  turnosEncerrados: readonly string[];
  /**
   * NOD-350: os subagentes do turno que acabou (turnoId → lista final), para a task terminada ainda dizer quem concluiu,
   * falhou ou parou (critérios 4 e 5). Só na memória da tela, os mais recentes; recarregar perde (sem migração).
   */
  subagentesDoFim: Readonly<Record<string, SubagentesDoTurno>>;
  /**
   * NOD-216 (revisão): os turnos que uma leitura tirou (turnoId → quando a leitura saiu). A resposta MAIS VELHA que chega
   * depois não os traz de volta — sem isto, o GET conversa que saiu antes do GET trabalhos devolvia o fantasma.
   */
  turnosDesmentidos: Readonly<Record<string, number>>;
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
  /** ADR-125: a última aba da gaveta por bot (o main lê e grava em `localStorage` `nod.gaveta.aba`). */
  abaGaveta: Record<string, AbaGaveta>;
  /** ADR-125: o popover do avatar aberto, com a forma e a cor de quando abriu (Redefinir volta a elas). */
  avatarAberto: { agenteId: string; forma: FormaAgente; cor: CorAgente } | null;
  /** ADR-125: o estado do computador de cada bot, do último pulso da aba Computador; ausente = carregando. */
  computadorVisto: Record<string, EstadoComputadorBot>;
  /** ADR-125: Acordar ou Tentar de novo em andamento (o botão desabilita e diz "Acordando…"). */
  computadorAcao: { agenteId: string; tipo: "acordar" | "religar" } | null;
  /**
   * A Atividade do bot (ADR-114, chat limpo, PR 2): as páginas lidas, por `agenteId:dia` (null = a rota disse 404: servidor
   * de antes, ou o bot não é da pessoa); o "N hoje" da linha da gaveta por bot (`total` null = indisponível, a linha fica
   * sem número); e o que a gaveta mostra (dia, filtro e a mensagem aberta).
   */
  atividadeDoBot: Record<string, AtividadeDto | null>;
  atividadeHoje: Record<string, { dia: string; total: number | null }>;
  atividadeVista: VistaDaAtividade | null;
  /**
   * NOD-326: a Biblioteca da gaveta, por `conversaId` — as páginas lidas, o cursor, o erro e quantos itens cada grupo
   * mostra. Ausente = ainda não lida (a falta `biblioteca:<id>` só existe com a aba aberta na visão geral).
   */
  bibliotecaDoBot: Record<string, BibliotecaDaConversa>;
  avisoConexao: string | null;
  concessoes: Record<string, Concessao[]>;
  /**
   * O "Agora não" do cartão de liberar apps (definido em 2026-10-05, 0054): por bot, o instante em que a pessoa
   * dispensou cada app (conectorId → ms). Chega junto com as concessões; ausente = ainda não carregou, e o cartão
   * não aparece (web/telas/card-liberar.ts).
   */
  liberacoesDispensadas: Record<string, Record<string, number>>;
  memorias: Record<string, Memoria[]>;
  /** Minhas chaves de máquina (ADR-031); null = ainda não carregou. */
  chaves: ChaveMaquinaDto[] | null;
  /** ADR-090: as máquinas da pessoa (chaves vivas + o que as conectadas anunciaram) e o padrão de onde os bots trabalham. */
  maquinas: MaquinasDto | null;
  /**
   * NOD-96 (computador do bot v2): o computador da pessoa. null = a rota não existe (NOD_COMPUTADORES desligado) ou
   * ainda não leu — a web fica no modelo de antes. `computadorMemoria` é o que a web lembra entre leituras (esperas,
   * ✓, telas fechadas por uma operação); `computadorUi`, o realce e o diálogo do painel.
   */
  computadorPessoa: ComputadorPessoaDto | null;
  computadorMemoria: MemoriaDoComputador;
  computadorUi: ComputadorUi;
  /** ADR-090: o "Conectar uma máquina" aberto em Seu espaço › Máquinas (passo, código digitado, o pedido visto). */
  conectarMaquina: ConectarMaquina | null;
  /** NOD-94: a instalação por SSH aberta (o diálogo ou a linha em segundo plano); null = nenhuma. */
  instalarSsh: InstalarSsh | null;
  /** ADR-102: as contas de IA da pessoa em todas as máquinas; null = ainda não carregou. */
  contasIa: ContasIaDto | null;
  /** ADR-102: e-mail e organização das contas que este Mac conhece (só no app do Mac); null = fora do app ou app antigo. */
  detalhesContas: DetalhesDasContas | null;
  /** O que é só da tela na lista de contas e em Máquinas (menu aberto, logins na tela, confirmações). */
  contasUi: UiContas;
  /** ADR-121 (NOD-92): a conta da nuvem e o que é só da tela nela (aviso da volta do Google, formulário, menu do sono). */
  nuvem: UiNuvem;
  /** Relatos de comportamento indesejado (ADR-041); null = ainda não carregou. */
  relatos: Relato[] | null;
  /**
   * Modo dev (definido em 2026-09-28, 0036): a preferência vem do servidor (o app desktop limpa o localStorage)
   * e, ligada, cada conversa aberta traz o resumo do Raio-X de cada turno e o total do dia.
   */
  modoDev: { ligado: boolean; raioX: Record<string, RaioXConversa>; taxasLinhas?: TaxaDeAbertura[] };
  /**
   * A chave crua recém-emitida: mostrada UMA vez e descartada ao sair da tela. Fica só na memória da
   * aba — nunca em storage — e o servidor não tem como mostrá-la de novo.
   */
  chaveEmitida: ChaveEmitidaDto | null;
  negacoes: NegacaoVista[];
  faixaParada: FaixaParada | null;
  /** Escolha do campo por conversa (EscolhaComposer); ausente = o padrão. */
  composer: Record<string, EscolhaComposer>;
  /** A citação do campo por conversa (CitacaoNoCampo); ausente = a mensagem não responde a nenhuma fala. */
  citacoes: Record<string, CitacaoNoCampo>;
  conexao: { estado: EstadoConexao; tentativa: number; proximaEmMs: number | null };
  /** O que a próxima volta do main precisa buscar por REST (conjunto, sem duplicata). */
  invalidacoes: Invalidacao[];
  agora: number;
  erro: ErroNaTela | null;
  ocupado: boolean;
  ligacaoViva: LigacaoVivaNaTela | null;
  /** A disponibilidade de ligar para cada bot (só decide se o botão "Ligar" aparece); null = a leitura falhou. */
  disponibilidadeLigacao: Record<string, DisponibilidadeLigacao | null>;
  /**
   * Ouvir uma resposta (NOD-106): a leitura em curso (o tocador de web/lib/ouvir.ts despacha `leitura-mudou`) e a
   * falha antes do primeiro som, que desenha "Não deu para ouvir agora." embaixo do balão por 6 s. Fica aqui porque o
   * render da conversa é puro e lê `Estado`.
   */
  leitura: LeituraAtual | null;
  falhaLeitura: { mensagemId: string } | null;
  /**
   * Onboarding por ligação (definido em 2026-10-04, ADR-077): o que `GET onboarding` disse. undefined = ainda não leu;
   * null = a leitura falhou ou a rota não existe (falha fechada: o app abre normal). `onboardingAberto` = a camada do
   * onboarding está na frente (resolverInicio abre quando `mostrar`; "Ver o onboarding de novo" reabre).
   */
  onboarding?: EstadoOnboarding | null;
  onboardingAberto: boolean;
  /** A primeira leitura já decidiu se o onboarding abre (só uma vez por sessão; depois só pelo menu da conta). */
  onboardingResolvido?: boolean;
  /**
   * ADR-083 (#195/#196): os trabalhos da pessoa (abertos e terminados hoje, de todos os bots) como `GET trabalhos` os
   * devolveu; null = ainda não leu. A faixa, o chip da barra, o ícone do topo, a gaveta e "Todos os trabalhos" leem daqui.
   */
  trabalhos: TrabalhosDto | null;
  /** A tela da task de cada trabalho já aberto (`GET trabalhos/:id`), com as mensagens dele. */
  trabalhoDetalhe: Record<string, TrabalhoDetalheDto>;
  /** QA do NOD-314: turnos que o servidor disse já refeitos ("ja_refeito") nesta sessão — o atalho do turno preso some. */
  turnosRefeitos: string[];
  /** Pressão de memória do Mac (#194): do `GET trabalhos` e do frame `memoria.mudou`; null = nenhum Mac falou. */
  pressao: NivelPressao | null;
  /**
   * O bot cuja faixa de Trabalhos a pessoa abriu nesta visita à conversa; null = pílula. revisto em 2026-10-09 (pedido
   * do Marlon: "o default na UI deve ser a pílula, ela é sempre muito mais sutil"): a faixa nasce recolhida sempre, abre
   * só no clique e fica aberta enquanto a pessoa está na conversa (ida e volta pela tela da task inclusive) — antes era
   * uma preferência guardada em `PUT preferencias`, e o padrão era aberta. Ver `faixaAbertaAoNavegar`. Chat limpo (PR 8,
   * 2026-10-18): é o estado da pílula do bot alargada (web/telas/pilula-do-bot.ts), que sobrevive ao re-render da região.
   */
  faixaTrabalhosAberta: string | null;
  /** definido em 2026-10-12 (ADR-099, parte 5): o bot aberto na tela Trabalhos (as frentes dele embaixo da linha). */
  botAbertoEmTrabalhos: string | null;
  /** ADR-085: quanto do Mac os bots podem usar (Seu espaço › Este Mac; `PUT preferencias`). */
  usoDoMac: UsoDoMac;
  /** ADR-111: as chaves de experimento do menu da conta (Calibração, Memória longa e, ADR-112, Modo WhatsApp), lidas de `GET preferencias`. */
  experimentos: Experimentos;
  /** O cartão do tempo aberto no topo da task (protótipo "Nod — tempo da task"): o id da task, ou null. */
  tempoTaskAberto: string | null;
  /**
   * definido em 2026-10-12 (ADR-099 §7): o custo de cada bot hoje (`GET custo-hoje`), lido quando a tela Trabalhos abre.
   * undefined = ainda não lido; null = servidor sem a rota.
   */
  custoHoje?: CustoDoDiaDto | null;
  /** O detalhe do custo aberto no topo de Trabalhos (atrás de um clique; o Marlon quer a tela limpa). */
  custoAberto: boolean;
};

export type Acao =
  | { tipo: "conexao-app"; slug: string; valor: ConexaoApp | null }
  | { tipo: "gaveta"; agenteId: string; nivel: NivelGaveta | null }
  | { tipo: "aba-gaveta"; agenteId: string; aba: AbaGaveta }
  | { tipo: "abas-lidas"; abas: Record<string, AbaGaveta> }
  | { tipo: "avatar-popover"; aberto: { agenteId: string; forma: FormaAgente; cor: CorAgente } | null }
  | { tipo: "computador-visto"; agenteId: string; estado: EstadoComputadorBot }
  | { tipo: "computador-acao"; acao: { agenteId: string; tipo: "acordar" | "religar" } | null }
  | { tipo: "agente-local"; agenteId: string; mudanca: { nome?: string; titulo?: string; forma?: FormaAgente; cor?: CorAgente } }
  | { tipo: "hidratar-atividade"; agenteId: string; dia: string; atividade: AtividadeDto | null }
  | { tipo: "hidratar-atividade-hoje"; agenteId: string; dia: string; total: number | null }
  | { tipo: "hidratar-biblioteca"; conversaId: string; pagina: PaginaDaBiblioteca | null; seguinte: boolean }
  | { tipo: "biblioteca-mais"; conversaId: string; grupo: GrupoBiblioteca }
  | { tipo: "biblioteca-tentar"; conversaId: string }
  | { tipo: "atividade-vista"; mudanca: Partial<Pick<VistaDaAtividade, "dia" | "filtro" | "aberta">> }
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
  | { tipo: "hidratar-ias"; ias: IasDaPessoa | null }
  | { tipo: "hidratar-uso-plano"; usoDoPlano: UsoDoPlanoDto | null }
  /** O agente que o servidor devolveu ao gravar (`PUT agentes/:id/inteligencia`), já na frota e na gestão antes de reler. */
  | { tipo: "agente-gravado"; agente: Agente }
  /** Mudou algo das IAs do Mac ou da tela dos cartões (só os campos que vieram). */
  | { tipo: "ias-mac"; mudanca: Partial<UiIas> }
  /** A ordem arrastada em Provedores de IA, já na tela antes do servidor responder. */
  | { tipo: "ordem-ias"; ordem: IasDaPessoa["ordem"] }
  | { tipo: "rascunho-ia"; rascunho: RascunhoInteligencia | null }
  | { tipo: "menu-ia"; agenteId: string | null }
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
  | { tipo: "hidratar-salas"; salas: { sala: Sala; membros: MembroSala[] }[] }
  | { tipo: "hidratar-chaves"; chaves: ChaveMaquinaDto[] }
  | { tipo: "hidratar-maquinas"; maquinas: MaquinasDto }
  | { tipo: "hidratar-computador-pessoa"; dto: ComputadorPessoaDto | null; agora: number }
  | { tipo: "computador-ui"; ui: Partial<ComputadorUi> }
  | { tipo: "conectar-maquina"; conectar: ConectarMaquina | null }
  | { tipo: "instalar-ssh"; instalar: InstalarSsh | null }
  | { tipo: "hidratar-contas"; contas: ContasIaDto; detalhes: DetalhesDasContas | null }
  | { tipo: "trocar-contas"; contas: ContasIaDto }
  | { tipo: "contas-ui"; mudanca: Partial<UiContas> }
  | { tipo: "nuvem-ui"; mudanca: Partial<UiNuvem> }
  | { tipo: "hidratar-relatos"; relatos: Relato[] }
  | { tipo: "modo-dev"; ligado: boolean }
  | { tipo: "hidratar-raio-x"; conversaId: string; raioX: RaioXConversa }
  | { tipo: "chave-emitida"; emitida: ChaveEmitidaDto | null }
  | { tipo: "faixa"; faixa: FaixaParada | null }
  | { tipo: "composer"; conversaId: string; escolha: EscolhaComposer | null }
  | { tipo: "citar"; conversaId: string; citacao: CitacaoNoCampo | null }
  | { tipo: "invalidar"; quais: Invalidacao[] }
  | { tipo: "invalidacoes-tratadas"; quais: Invalidacao[] }
  | { tipo: "erro"; erro: ErroNaTela | null }
  /** QA do NOD-314: o "Rodar em <outra> desta vez" respondeu `ja_refeito`: o atalho daquele turno some. */
  | { tipo: "turno-refeito"; turnoId: string }
  /** NOD-215: uma chamada caiu por rede (ainda tentando de novo ou já desistiu): vira "Reconectando…", nunca por cima de outro erro. */
  | { tipo: "rede-caiu"; erro: ErroNaTela }
  /** NOD-215: o nod respondeu de novo: o "Reconectando…" some sozinho. */
  | { tipo: "rede-voltou" }
  | { tipo: "ocupado"; valor: boolean }
  | { tipo: "ligacao-viva"; viva: LigacaoVivaNaTela | null }
  | { tipo: "hidratar-disponibilidade-ligacao"; agenteId: string; disponibilidade: DisponibilidadeLigacao | null }
  /** NOD-106: o tocador mudou de fase (null = ocioso); `falha` grava (ou, com null, tira) o aviso de falha. */
  | { tipo: "leitura-mudou"; leitura: LeituraAtual | null; falha?: { mensagemId: string } | null }
  | { tipo: "esquecer-disponibilidade-ligacao"; agenteId: string }
  | { tipo: "hidratar-onboarding"; onboarding: EstadoOnboarding | null }
  | { tipo: "onboarding-aberto"; aberto: boolean }
  /** `agora` (NOD-216): quando a leitura saiu; com ele, os donos reconciliam os turnos vivos das conversas dos bots. */
  | { tipo: "hidratar-trabalhos"; trabalhos: TrabalhosDto; agora?: number }
  | { tipo: "hidratar-trabalho"; detalhe: TrabalhoDetalheDto; agora: number }
  /** O `GET trabalhos/:id` voltou 404: a task não existe (ou não é desta pessoa). */
  | { tipo: "trabalho-sumiu"; id: string }
  /** Abre (o id do bot) ou recolhe (null) a faixa de Trabalhos da conversa. */
  | { tipo: "faixa-trabalhos"; agenteId: string | null }
  /** ADR-099 (parte 5): abre (o id do bot) ou fecha (null) as frentes de um bot na tela Trabalhos. */
  | { tipo: "bot-trabalhos"; agenteId: string | null }
  | { tipo: "uso-do-mac"; uso: UsoDoMac }
  | { tipo: "experimentos"; experimentos: Experimentos }
  | { tipo: "tempo-task"; id: string | null }
  | { tipo: "hidratar-custo"; custo: CustoDoDiaDto | null }
  | { tipo: "custo-aberto"; aberto: boolean }
  | { tipo: "hidratar-taxas-linhas"; taxas: TaxaDeAbertura[] };

export const estadoInicial: Estado = {
  sessao: null,
  tela: { tipo: "inicio" },
  espaco: null,
  frota: null,
  inventario: null,
  executor: null,
  iasMac: UI_IAS_INICIAL,
  rascunhoIa: null,
  menuIa: null,
  conversas: {},
  atividades: {},
  turnosVivos: {},
  turnosEncerrados: [],
  subagentesDoFim: {},
  turnosDesmentidos: {},
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
  abaGaveta: {},
  avatarAberto: null,
  computadorVisto: {},
  computadorAcao: null,
  atividadeDoBot: {},
  bibliotecaDoBot: {},
  atividadeHoje: {},
  atividadeVista: null,
  avisoConexao: null,
  concessoes: {},
  liberacoesDispensadas: {},
  memorias: {},
  chaves: null,
  maquinas: null,
  computadorPessoa: null,
  computadorMemoria: MEMORIA_INICIAL,
  computadorUi: UI_COMPUTADOR_INICIAL,
  conectarMaquina: null,
  instalarSsh: null,
  contasIa: null,
  detalhesContas: null,
  contasUi: UI_CONTAS_INICIAL,
  nuvem: UI_NUVEM_INICIAL,
  relatos: null,
  modoDev: { ligado: false, raioX: {} },
  chaveEmitida: null,
  negacoes: [],
  faixaParada: null,
  composer: {},
  citacoes: {},
  conexao: { estado: "parado", tentativa: 0, proximaEmMs: null },
  invalidacoes: [],
  agora: 0,
  erro: null,
  ocupado: false,
  ligacaoViva: null,
  disponibilidadeLigacao: {},
  leitura: null,
  falhaLeitura: null,
  onboardingAberto: false,
  trabalhos: null,
  trabalhoDetalhe: {},
  turnosRefeitos: [],
  pressao: null,
  faixaTrabalhosAberta: null,
  botAbertoEmTrabalhos: null,
  usoDoMac: "equilibrado",
  experimentos: { calibracao: false, memoriaLonga: false, whatsapp: false },
  tempoTaskAberto: null,
  custoAberto: false,
};

/** A posição de uma IA na ordem nova (as que não estão nela vão para o fim, na ordem de antes). */
const posicao = (ordem: readonly string[], id: string): number => (ordem.includes(id) ? ordem.indexOf(id) : ordem.length);

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

const ESTADOS_SUBAGENTE: Record<EstadoDoSubagente, true> = { trabalhando: true, concluido: true, falhou: true, parado: true };

/** NOD-350: o servidor já validou (ponte-validacao.ts); aqui só não deixa um frame torto quebrar a tela. */
function subagentesDoFrame(v: unknown): SubagenteVivo[] {
  if (!Array.isArray(v)) return [];
  const num = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0);
  return v.flatMap((t): SubagenteVivo[] => {
    const o = (t && typeof t === "object" ? t : {}) as Record<string, unknown>;
    if (typeof o.id !== "string" || typeof o.estado !== "string" || !(o.estado in ESTADOS_SUBAGENTE)) return [];
    if (o.natureza !== "agente" && o.natureza !== "comando") return [];
    return [{ id: o.id, natureza: o.natureza, descricao: typeof o.descricao === "string" ? o.descricao.slice(0, 80) : "", estado: o.estado as EstadoDoSubagente, passo: typeof o.passo === "string" && o.passo !== "" ? o.passo.slice(0, 60) : null, chamadas: num(o.chamadas), duracaoMs: num(o.duracaoMs) }];
  }).slice(0, 20);
}

function texto(v: unknown): string | null {
  return typeof v === "string" && v !== "" ? v : null;
}

function invalidar(estado: Estado, ...quais: (Invalidacao | null)[]): Estado {
  const novas = quais.filter((q): q is Invalidacao => q !== null && !estado.invalidacoes.includes(q));
  return novas.length === 0 ? estado : { ...estado, invalidacoes: [...estado.invalidacoes, ...novas] };
}

/**
 * O uso do plano relido por um frame (revisão do PR 1, 2026-10-16): `usoDoPlano === null` é o servidor sem a rota, ou a
 * leitura que falhou fechada (main.ts) — nenhum frame pede de novo; quem tenta outra vez é a volta da janela ou da rede
 * (`invalidacoesAoRetomar`).
 */
const usoPlano = (e: Estado): Invalidacao | null => (e.usoDoPlano === null ? null : "uso-plano");
/**
 * NOD-12 (2026-10-22): a leitura do uso agora é por conta e vem com a lista de contas (as barras de Provedores de IA, a
 * faixa do menu e o anel do seletor). O turno que acaba traz leitura nova: relê as contas, se a tela já as tem; quem
 * nunca as pediu (ex.: sem abrir a conversa) continua sem pedir.
 */
const contasDoTurno = (e: Estado): Invalidacao | null => (e.contasIa === null ? null : "contas");

/** NOD-348: guarda a fala viva do turno que vira mensagem com texto, na conversa aberta (não o da task, sem fala viva). */
function comFalaSaindo(estado: Estado, turnoId: string | null, agora: number, fim = false): Estado {
  const turno = turnoId ? estado.turnosVivos[turnoId] : undefined;
  if (!turno || turno.estado !== "rodando" || turno.trabalhoId || !estado.conversas[turno.conversaId]) return estado;
  const atividade = estado.atividades[turno.conversaId]?.[turno.turnoId];
  if (!atividade) return estado;
  if (!textoDaFala(atividade)) return fim ? comAcoesNaUltimaSaindo(estado, turno.conversaId, turno.turnoId, atividade.acoes) : estado;
  // Uma por fala (revisão 4 do #508): dois `turno.fala` antes da releitura não apagam o primeiro.
  const atuais = estado.falasSaindo?.[turno.conversaId] ?? {};
  let n = Object.keys(atuais).length;
  while (atuais[`${turno.turnoId}:${agora}:${n}`]) n++;
  const daConversa = { ...atuais, [`${turno.turnoId}:${agora}:${n}`]: { turno, atividade, em: agora } };
  return { ...estado, falasSaindo: { ...estado.falasSaindo, [turno.conversaId]: daConversa } };
}

/**
 * NOD-353 (revisão do #523): o turno acabou sem fala final depois de um `turno.fala` — a última fala parada dele é a que
 * guarda o resumo (o servidor grava nela, `acoesNaUltimaFalaDoTurno`), então o retrato dela passa a ter as ações do fim.
 */
function comAcoesNaUltimaSaindo(estado: Estado, conversaId: string, turnoId: string, acoes: AtividadeTurno["acoes"]): Estado {
  const atuais = estado.falasSaindo?.[conversaId];
  const chave = atuais ? Object.keys(atuais).filter((k) => atuais[k]?.turno.turnoId === turnoId).sort((a, b) => (atuais[a]?.em ?? 0) - (atuais[b]?.em ?? 0)).at(-1) : undefined;
  const s = chave ? atuais?.[chave] : undefined;
  if (!atuais || !chave || !s) return comAcoesNaUltimaGravada(estado, conversaId, turnoId, acoes);
  if (s.atividade.acoes === acoes) return estado;
  return { ...estado, falasSaindo: { ...estado.falasSaindo, [conversaId]: { ...atuais, [chave]: { ...s, atividade: { ...s.atividade, acoes } } } } };
}

/**
 * NOD-353 (revisão 2 do #523): a releitura do `turno.fala` já trouxe a fala do meio gravada (e tirou o retrato) antes do
 * encerrado — o resumo entra nela na hora, igual ao que o servidor grava (`acoesNaUltimaFalaDoTurno`), sem esperar a
 * próxima releitura (o resumo sumia por um momento).
 */
function comAcoesNaUltimaGravada(estado: Estado, conversaId: string, turnoId: string, acoes: AtividadeTurno["acoes"]): Estado {
  const c = estado.conversas[conversaId];
  if (!c || acoes.length === 0) return estado;
  let i = -1;
  for (let k = c.mensagens.length - 1; k >= 0; k--) {
    const m = c.mensagens[k];
    if (m?.turnoId === turnoId && m.kind === "texto" && m.autoria.autor_tipo === "agente") { i = k; break; }
  }
  const m = c.mensagens[i];
  if (!m || m.payload) return estado;
  const payload = { kind: "acoes_do_turno" as const, acoes: linhasDoResumo(acoes, true).map((l) => ({ rotulo: l.rotulo, ...(l.estado === "falhou" ? { falhou: true as const } : {}), ...(l.vezes ? { vezes: l.vezes } : {}) })) };
  const mensagens = [...c.mensagens];
  mensagens[i] = { ...m, payload };
  return { ...estado, conversas: { ...estado.conversas, [conversaId]: { ...c, mensagens } } };
}

/**
 * Tira as falas que saíam e já não precisam ficar: `fica` decide por fala. A releitura só tira as falas de antes dela
 * (`em <= saiuEm`): uma resposta que saiu antes do fim do turno ainda não traz a fala gravada (revisão 3 do #508).
 */
function semFalasSaindo(estado: Estado, fica: (s: FalaSaindo, conversaId: string) => boolean): Estado {
  if (!estado.falasSaindo) return estado;
  let mudou = false;
  const falasSaindo: NonNullable<Estado["falasSaindo"]> = {};
  for (const [conversaId, daConversa] of Object.entries(estado.falasSaindo)) {
    const restantes: Record<string, FalaSaindo> = {};
    for (const [turnoId, s] of Object.entries(daConversa)) {
      if (fica(s, conversaId)) restantes[turnoId] = s;
      else mudou = true;
    }
    if (Object.keys(restantes).length > 0) falasSaindo[conversaId] = restantes;
  }
  return mudou ? { ...estado, falasSaindo } : estado;
}

function semTurnoVivo(estado: Estado, turnoId: string | null): Estado {
  if (!turnoId || !estado.turnosVivos[turnoId]) return estado;
  const turnosVivos = { ...estado.turnosVivos };
  delete turnosVivos[turnoId];
  return { ...estado, turnosVivos };
}

/** definido em 2026-10-08 (W6): quantos turnos encerrados a web lembra — bem mais que os GETs que podem estar em voo. */
export const ENCERRADOS_GUARDADOS = 200;

/** NOD-216: o turno vivo foi confirmado pelo servidor antes de uma leitura que saiu em `leituraEm`? */
const confirmadoAntes = (v: TurnoVivo, leituraEm: number): boolean => (v.vistoEm ?? v.desde) < leituraEm;

/**
 * NOD-216 (revisão): as origens que `dono.fila` lista (src/repositories/donos.repo.ts). Um pendente de outra origem
 * (`retomada`, por exemplo) não aparece nela e nem por isso é fantasma; origem desconhecida também não se desmente.
 */
export const ORIGENS_DA_FILA_DO_DONO: ReadonlySet<string> = new Set(["conversa", "delegacao", "peer", "rotina"]);

/** Tira os turnos desmentidos por uma leitura que saiu em `leituraEm`, e lembra disso (`turnosDesmentidos`). */
function semDesmentidos(estado: Estado, ids: readonly string[], leituraEm: number): Estado {
  if (ids.length === 0) return estado;
  const turnosVivos = { ...estado.turnosVivos };
  const lembrados = Object.entries({ ...estado.turnosDesmentidos, ...Object.fromEntries(ids.map((id) => [id, leituraEm])) });
  for (const id of ids) delete turnosVivos[id];
  return { ...estado, turnosVivos, turnosDesmentidos: Object.fromEntries(lembrados.slice(-ENCERRADOS_GUARDADOS)) };
}

/** A leitura que saiu em `leituraEm` é mais velha que a que desmentiu o turno: ela não o traz de volta. */
const desmentidoDepois = (estado: Estado, turnoId: string, leituraEm: number): boolean => (estado.turnosDesmentidos[turnoId] ?? -Infinity) > leituraEm;

/**
 * NOD-219 (definido em 2026-10-13): a conversa PRÓPRIA do bot trabalha? A barra e a conversa reconciliadas aqui são a
 * própria; `conversaTrabalhando` conta também o turno do bot numa sala, que segurava o vivo de uma conversa própria
 * parada. O servidor de antes não manda o campo novo: aí vale o de sempre. NOD-260 (definido em 2026-10-15): o servidor
 * novo manda sempre o campo, e o turno de sala nunca entra nele.
 */
const propriaTrabalhando = (e: EstadoDoDono): boolean => e.conversaPropriaTrabalhando ?? e.conversaTrabalhando;

/**
 * NOD-216: os mascotes da barra são dos bots cuja conversa NÃO está aberta — essa conversa não é relida, e um turno vivo
 * que perdeu o `turno.encerrado` ficava animando o bot para sempre. `GET trabalhos` traz o dono de cada bot, lido no
 * servidor agora: sem `conversaPropriaTrabalhando` (NOD-219), nenhum turno da conversa roda; fora de `fila`, nenhum espera a vez. O vivo
 * da conversa do bot que o dono desmente sai (só o confirmado antes da leitura; o de task é da tela da task).
 */
function reconciliarPelosDonos(estado: Estado, trabalhos: TrabalhosDto, leituraEm: number | undefined): Estado {
  const donos = trabalhos.donos;
  if (leituraEm === undefined || !Array.isArray(donos) || donos.length === 0) return estado;
  const conversaDe = new Map((estado.frota?.agentes ?? []).map((a) => [a.id, a.conversaId]));
  const desmentidos: string[] = [];
  for (const dono of donos) {
    const conversaId = conversaDe.get(dono.estado.agenteId);
    if (!conversaId) continue;
    const naFila = new Set(dono.fila.map((p) => p.turnoId));
    const trabalhando = propriaTrabalhando(dono.estado);
    for (const v of Object.values(estado.turnosVivos)) {
      if (v.conversaId !== conversaId || v.trabalhoId || !confirmadoAntes(v, leituraEm)) continue;
      // Revisão: o "na fila" fora da fila com o bot trabalhando pode ser o mesmo turno, já despachado (o frame
      // turno_despachado perdido ou ainda a caminho) — fica; e só a origem que a fila lista pode ser desmentida por ela.
      const desmentido = v.estado === "rodando"
        ? !trabalhando
        : !naFila.has(v.turnoId) && !trabalhando && ORIGENS_DA_FILA_DO_DONO.has(v.origem ?? "");
      if (desmentido) desmentidos.push(v.turnoId);
    }
  }
  return semDesmentidos(estado, desmentidos, leituraEm);
}

/**
 * NOD-300 (definido em 2026-10-20): o dono lido em `GET trabalhos` vale também para a conversa do bot — a linha acima do
 * campo e a barra leem o da conversa (web/lib/dono.ts) e, sem isto, a releitura de Trabalhos (a máquina que perdeu o
 * contato) não mudava a barra. A regra do `comEstadoDoDono`: só as conversas daquele bot ganham objeto novo, e só quando
 * o dono mudou de fato.
 */
export function comDonosNasConversas(e: Estado, donos: readonly DonoDto[] | undefined): Estado {
  if (!Array.isArray(donos) || donos.length === 0) return e;
  const porBot = new Map(donos.map((d) => [d.estado.agenteId, d]));
  const trocadas = Object.entries(e.conversas).flatMap(([id, c]) => {
    const novo = c.dono ? porBot.get(c.dono.estado.agenteId) : undefined;
    return novo && JSON.stringify(novo) !== JSON.stringify(c.dono) ? [[id, { ...c, dono: novo }] as const] : [];
  });
  return trocadas.length === 0 ? e : { ...e, conversas: { ...e.conversas, ...Object.fromEntries(trocadas) } };
}

/**
 * QA do PR #302 (NOD-216): o bot que o dono diz trabalhando (ou com fila) e cuja conversa a web ainda não leu tem a
 * conversa pedida (`vivos:`, buscada mesmo fora da tela). Sem isto, depois de um reload a barra mostrava "disponível" o
 * bot que rodava, até a conversa dele abrir: os turnos vivos só vinham da conversa carregada, e `GET trabalhos` só
 * desmente. A leitura da conversa traz os turnos dela (a sala e a task continuam fora); lida uma vez, não se pede de novo.
 */
function comConversasDosDonos(estado: Estado): Estado {
  const donos = estado.trabalhos?.donos;
  if (!Array.isArray(donos) || donos.length === 0 || !estado.frota) return estado;
  const conversaDe = new Map(estado.frota.agentes.map((a) => [a.id, a.conversaId]));
  const pedir: Invalidacao[] = [];
  for (const dono of donos) {
    const conversaId = conversaDe.get(dono.estado.agenteId);
    if (conversaId && !estado.conversas[conversaId] && (propriaTrabalhando(dono.estado) || dono.fila.length > 0)) pedir.push(`vivos:${conversaId}`);
  }
  return invalidar(estado, ...pedir);
}

function encerrado(estado: Estado, turnoId: string | null): Estado {
  if (!turnoId || estado.turnosEncerrados.includes(turnoId)) return estado;
  return { ...estado, turnosEncerrados: [turnoId, ...estado.turnosEncerrados].slice(0, ENCERRADOS_GUARDADOS) };
}

/** `turno.fala`: zera só o texto em streaming do turno (o resto da atividade segue com o turno vivo). */
function semTexto(estado: Estado, conversaId: string | null, turnoId: string | null): Estado {
  const a = conversaId && turnoId ? estado.atividades[conversaId]?.[turnoId] : undefined;
  if (!a || !conversaId || !turnoId) return estado;
  // NOD-350: com subagentes, o cartão recomeça só com eles (e a última ferramenta como ✓); eles seguem depois da fala.
  // NOD-353: as ações seguem (o resumo é do turno inteiro); a volta acabou, então nenhuma roda mais.
  const proxima = soSubagentes(a) ?? { ...a, atual: "", antes: [], curtasDescartadas: undefined, acoes: acoesFechadas(a.acoes) };
  return { ...estado, atividades: { ...estado.atividades, [conversaId]: { ...estado.atividades[conversaId], [turnoId]: proxima } } };
}

export const SUBAGENTES_DO_FIM_GUARDADOS = 50;

/**
 * NOD-350: o turno acabou (ou foi parado). Quem ainda trabalhava vira parado (critério 5) e a lista final fica guardada
 * por turnoId para a task terminada; o cartão ao vivo some em seguida (o delete abaixo).
 */
function fimDosSubagentes(estado: Estado, conversaId: string | null, turnoId: string | null, agora: number): Estado {
  if (!conversaId || !turnoId) return estado;
  const daConversa = estado.atividades[conversaId];
  const final = subagentesParados(daConversa?.[turnoId]?.subagentes ?? null, agora);
  if (!daConversa || !(turnoId in daConversa)) return estado;
  const restantes = { ...daConversa };
  delete restantes[turnoId];
  const atividades = { ...estado.atividades, [conversaId]: restantes };
  if (!final) return { ...estado, atividades };
  const guardados = Object.entries({ ...estado.subagentesDoFim, [turnoId]: final }).slice(-SUBAGENTES_DO_FIM_GUARDADOS);
  return { ...estado, atividades, subagentesDoFim: Object.fromEntries(guardados) };
}

function semConversa(atividades: Estado["atividades"], conversaId: string): Estado["atividades"] {
  const restantes = { ...atividades };
  delete restantes[conversaId];
  return restantes;
}

/**
 * A faixa de Trabalhos aberta depois de navegar (revisto em 2026-10-09: o padrão ao entrar na conversa é a pílula). Fica
 * aberta enquanto a pessoa continua na conversa do bot: na mesma conversa, na tela de uma task (ou de uma linha) e ao
 * voltar dela. Entrar na conversa vindo de outro lugar (outro bot, "Todos os trabalhos", Seu espaço) recolhe.
 */
export function faixaAbertaAoNavegar(aberta: string | null, de: Tela, para: Tela): string | null {
  if (!aberta) return null;
  if (para.tipo === "trabalho" || para.tipo === "linha") return aberta;
  if (para.tipo !== "conversa" || para.agenteId !== aberta) return null;
  const continua = de.tipo === "trabalho" || de.tipo === "linha" || (de.tipo === "conversa" && de.agenteId === aberta);
  return continua ? aberta : null;
}

/**
 * NOD-280 (critério 9): a conversa aberta tem nota de limite com `contas` (ADR-102). A lista de contas vale para ela: a
 * conta que entrou na máquina depois da nota vira "Seguir com", e `contas.mudou` relê a lista com a conversa aberta.
 */
export function conversaAbertaTemNotaDeContas(estado: Pick<Estado, "tela" | "conversas">): boolean {
  const t = estado.tela;
  if (t.tipo !== "conversa" && t.tipo !== "sala" && t.tipo !== "linha") return false;
  return estado.conversas[t.conversaId]?.mensagens.some((m) => m.payload?.kind === "limite_do_plano" && !!m.payload.contas) ?? false;
}

/**
 * A conversa que a tela mostra (conversa ou sala), já carregada ou ainda chegando. ADR-083: a tela da task mostra o ao
 * vivo do turno do trabalho, que chega pelos frames da conversa do bot dele — mesmo de outro bot, nunca aberta.
 */
export function conversaIdNaTela(estado: Estado): string | null {
  const t = estado.tela;
  if (t.tipo === "conversa" || t.tipo === "sala" || t.tipo === "linha") return t.conversaId;
  if (t.tipo === "trabalho") return estado.trabalhoDetalhe[t.id]?.trabalho.conversaId ?? estado.trabalhos?.trabalhos.find((x) => x.id === t.id)?.conversaId ?? null;
  return null;
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

/**
 * O estado do dono que chega no frame `trabalho.mudou` (definido em 2026-10-12, ADR-099, parte 5): troca o `estado` do
 * dono daquele bot na lista de `GET trabalhos` e na conversa dele, sem mexer nas esperas e na fila (o REST traz). Fora do
 * formato (ou ausente: a leitura falhou no servidor), nada muda.
 */
export function comEstadoDoDono(e: Estado, cru: unknown): Estado {
  if (!cru || typeof cru !== "object") return e;
  const novo = cru as EstadoDoDono;
  if (typeof novo.agenteId !== "string" || typeof novo.principal !== "string" || typeof novo.frentes !== "number") return e;
  const trocar = (d: DonoDto): DonoDto => (d.estado.agenteId === novo.agenteId ? { ...d, estado: novo } : d);
  const donos = e.trabalhos?.donos;
  const trabalhos = e.trabalhos && donos?.some((d) => d.estado.agenteId === novo.agenteId) ? { ...e.trabalhos, donos: donos.map(trocar) } : e.trabalhos;
  // Só as conversas daquele bot ganham objeto novo (a tela lembra o que desenha pela referência, web/lib/lembrar.ts).
  const doBot = Object.entries(e.conversas).filter(([, c]) => c.dono?.estado.agenteId === novo.agenteId);
  const conversas = doBot.length === 0 ? e.conversas : { ...e.conversas, ...Object.fromEntries(doBot.map(([id, c]) => [id, { ...c, dono: c.dono ? trocar(c.dono) : c.dono }])) };
  return trabalhos === e.trabalhos && conversas === e.conversas ? e : { ...e, trabalhos, conversas };
}

const conv = (f: FrameSse): Invalidacao | null => {
  const id = texto(f.dados.conversaId);
  return id ? `conversa:${id}` : null;
};

/**
 * ADR-114 (chat limpo, PR 2): a mensagem nova, a negação (a de conector chega só por esse frame) e o trabalho que mudou na
 * conversa de um bot releem o "N hoje" dele — só se a linha já foi lida — e a página da Atividade aberta dele. O frame não
 * diz o assunto: relê a contagem, que é barata (`contagem=1`). O main junta as releituras numa por segundo.
 */
function atividadeDoFrame(e: Estado, f: FrameSse): Invalidacao[] {
  const conversaId = texto(f.dados.conversaId);
  const bot = conversaId ? e.frota?.agentes.find((a) => a.conversaId === conversaId) : undefined;
  if (!bot) return [];
  const quais: Invalidacao[] = [];
  if (e.atividadeHoje[bot.id]) quais.push(`atividade-hoje:${bot.id}`);
  if (e.atividadeVista?.agenteId === bot.id) quais.push(`atividade:${chaveDaAtividade(bot.id, e.atividadeVista.dia)}`);
  return quais;
}

/**
 * NOD-326: a fala nova e o fim do turno (a mídia do bot se prende à fala final) releem a 1ª página da Biblioteca da
 * conversa — só se ela já foi lida; a releitura junta o novo ao que a pessoa já carregou (web/lib/biblioteca.ts).
 */
function bibliotecaDoFrame(e: Estado, f: FrameSse): Invalidacao[] {
  const conversaId = texto(f.dados.conversaId);
  return conversaId && e.bibliotecaDoBot[conversaId] ? [`biblioteca:${conversaId}`] : [];
}

/** O turno da ligação não é trabalho do bot (ADR-072): não relê Trabalhos. */
const trabalhosDoTurno = (f: FrameSse): Invalidacao[] => (turnoDeLigacao(f.dados) || f.dados.modo === "ligacao" || f.dados.origem === "ligacao" ? [] : ["trabalhos"]);

/** NOD-353: o id da chamada no frame (o mesmo formato que a ponte aceita); fora dele, a ação fica sem id. */
const idDaAcao = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v) ? v : null);

/** NOD-348: o `emUso` do frame, conferido; o servidor antigo não o manda e a fala diz "Usando uma ferramenta". */
function emUsoDoFrame(v: unknown): FerramentaEmUso {
  if (!v || typeof v !== "object") return SEM_NOME_DA_FERRAMENTA;
  const { texto: t, frentes } = v as Record<string, unknown>;
  return typeof t === "string" && t.trim() ? { texto: t.trim().slice(0, 80), frentes: frentes === true } : SEM_NOME_DA_FERRAMENTA;
}

const POR_FRAME: Record<TipoFrame, Handler> = {
  // definido em 2026-09-29 (0039): a mensagem nova também relê os não lidos (o ponto da barra e o ícone do topo).
  "mensagem.nova": (e, f) => (conv(f) ? invalidar(e, conv(f), "nao-lidos", ...atividadeDoFrame(e, f), ...bibliotecaDoFrame(e, f)) : e),
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
    const trabalhoId = texto(f.dados.trabalhoId) ?? texto(f.dados.trabalho_id) ?? anterior?.trabalhoId ?? null;
    const vivo: TurnoVivo = { turnoId, conversaId, estado, executor: texto(f.dados.executor) ?? anterior?.executor ?? null, machineId: texto(f.dados.machine_id) ?? anterior?.machineId ?? null, desde: estado === "rodando" && anterior?.estado !== "rodando" ? agora : (anterior?.desde ?? agora), trabalhoId, vistoEm: agora, chegouEm: anterior?.chegouEm ?? agora, origem: texto(f.dados.origem) ?? anterior?.origem ?? null, agenteId: texto(f.dados.agente_id) ?? texto(f.dados.agenteId) ?? anterior?.agenteId ?? null };
    return invalidar({ ...e, turnosVivos: { ...e.turnosVivos, [turnoId]: vivo } }, conv(f), "trabalhos");
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
    return { ...e, turnosVivos, atividades: comAtividade(e, conversaId, turnoId, (a) => comFerramenta(a, rotulo, emUsoDoFrame(f.dados.emUso), idDaAcao(f.dados.id))) };
  },
  // NOD-353: a chamada terminou (feita ou Falhou, de tool_result.isError); fim de turno ou id desconhecido não muda nada.
  "turno.acao_fim": (e, f) => {
    if (turnoDeLigacao(f.dados)) return e;
    const turnoId = texto(f.dados.turnoId);
    const conversaId = texto(f.dados.conversaId);
    const id = idDaAcao(f.dados.id);
    if (!turnoId || !conversaId || !id || !guardaAoVivo(e, conversaId)) return e;
    const a = e.atividades[conversaId]?.[turnoId];
    const nova = comFimDaAcao(a, id, f.dados.falhou === true);
    return !nova || nova === a ? e : { ...e, atividades: { ...e.atividades, [conversaId]: { ...e.atividades[conversaId], [turnoId]: nova } } };
  },
  "turno.tarefas": (e, f) => {
    if (turnoDeLigacao(f.dados)) return e;
    const turnoId = texto(f.dados.turnoId);
    const conversaId = texto(f.dados.conversaId);
    if (!turnoId || !conversaId || !guardaAoVivo(e, conversaId)) return e;
    return { ...e, atividades: comAtividade(e, conversaId, turnoId, (a) => comTarefas(a, tarefasDoFrame(f.dados.tarefas))) };
  },
  // NOD-350: a lista inteira dos subagentes do turno (o servidor manda no máximo ~1 por segundo) e a linha pronta.
  "turno.subagentes": (e, f, agora) => {
    if (turnoDeLigacao(f.dados)) return e;
    const turnoId = texto(f.dados.turnoId);
    const conversaId = texto(f.dados.conversaId);
    if (!turnoId || !conversaId || !guardaAoVivo(e, conversaId)) return e;
    // A descarga do último frame pode chegar depois do fim: não ressuscita o cartão, só acerta a lista final.
    if (e.turnosEncerrados.includes(turnoId)) {
      const fim = e.subagentesDoFim[turnoId];
      if (!fim) return e;
      // A base é a lista final guardada: quem já tinha terminado mantém a hora em que a tela viu o fim.
      const lista = subagentesParados(comSubagentes({ ...ATIVIDADE_VAZIA, subagentes: fim }, subagentesDoFrame(f.dados.subagentes), texto(f.dados.resumo), agora).subagentes, agora);
      return lista ? { ...e, subagentesDoFim: { ...e.subagentesDoFim, [turnoId]: lista } } : e;
    }
    // `principalOcioso`: a volta do bot acabou, com ou sem fala (sala, ou só disparou os subagentes) — a última
    // ferramenta dele vira ✓ e deixa de pulsar no "agora" (critério 2).
    const ocioso = f.dados.principalOcioso === true;
    return { ...e, atividades: comAtividade(e, conversaId, turnoId, (a) => {
      const nova = comSubagentes(a, subagentesDoFrame(f.dados.subagentes), texto(f.dados.resumo), agora);
      return ocioso ? semFerramentaAberta(nova) : nova;
    }) };
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
  // vazio para a próxima volta (senão o mesmo texto apareceria duas vezes). NOD-348 (revisão 3 do #508): o texto que
  // virou mensagem fica como fala parada até a releitura, e o turno segue com as etapas, o vigia e a ferramenta em uso.
  "turno.fala": (e, f, agora) => invalidar(semTexto(comFalaSaindo(e, texto(f.dados.turnoId), agora), texto(f.dados.conversaId), texto(f.dados.turnoId)), conv(f)),
  // NOD-260 (definido em 2026-10-15, J1): o turno que começa, acaba ou é interrompido muda Trabalhos (a linha do dono, o
  // "Trabalhando · há N"); antes só `trabalho.mudou` relia, e o turno da conversa ficava "trabalhando" lá. Os frames são
  // da pessoa (o barramento publica por pessoa); main.ts junta a releitura numa por segundo (web/lib/releitura-adiada.ts).
  // definido em 2026-10-16 (plano "tela limpa", T6): o CLI informa o uso do plano a cada turno, então o anel do seletor relê
  // quando um turno termina (uma leitura por turno, sem relógio novo); fora da conversa a falta espera a tela pedir. O turno
  // interrompido também gastou a janela (e é o que acaba quando a conta bate no limite): relê igual (revisão do PR 1).
  // NOD-12: e a lista de contas, que carrega a leitura por conta.
  "turno.encerrado": (e, f, agora) => invalidar(fimDosSubagentes(encerrado(semTurnoVivo(comFalaSaindo(e, texto(f.dados.turnoId), agora, true), texto(f.dados.turnoId)), texto(f.dados.turnoId)), texto(f.dados.conversaId), texto(f.dados.turnoId), agora), conv(f), "frota", usoPlano(e), contasDoTurno(e), ...trabalhosDoTurno(f), ...bibliotecaDoFrame(e, f)),
  "turno.interrompido": (e, f, agora) => invalidar(fimDosSubagentes(encerrado(semTurnoVivo(e, texto(f.dados.turnoId)), texto(f.dados.turnoId)), texto(f.dados.conversaId), texto(f.dados.turnoId), agora), conv(f), "frota", "sua-vez", usoPlano(e), contasDoTurno(e), ...trabalhosDoTurno(f), ...bibliotecaDoFrame(e, f)),
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
    // definido em 2026-10-11: a causa que o hook do nod deu e quantas vezes no turno (causa desconhecida: a tela cai no motivo).
    const causaNativa = typeof f.dados.causa_nativa === "string" ? (f.dados.causa_nativa as CausaNativa) : null;
    const vezes = typeof f.dados.vezes === "number" && f.dados.vezes > 1 ? f.dados.vezes : null;
    const vista: NegacaoVista = { classe, nome, motivo: motivo as Negacao["motivo"], desde: typeof f.dados.desde === "number" ? f.dados.desde : agora, terminal: f.dados.terminal === true, conversaId: texto(f.dados.conversaId), vistaEm: agora, ...(causaNativa ? { causa: causaNativa } : {}), ...(vezes ? { vezes } : {}) };
    // definido em 2026-09-16: as 20 mais recentes bastam na tela; o registro completo está na trilha.
    return invalidar({ ...e, negacoes: [vista, ...e.negacoes].slice(0, 20) }, conv(f), ...atividadeDoFrame(e, f));
  },
  // definido em 2026-09-24 (emenda da ADR-037): só a SAÚDE (entrou ou saiu do ar) muda a frota — a
  // lateral, o cabeçalho e o painel; as ações comuns do computador não relêem nada.
  "computador.mudou": (e, f) => (f.dados.saude === true ? invalidar(e, "frota") : e),
  // definido em 2026-10-16 (decisão E6): o uso da janela é relido junto com as IAs.
  // NOD-300: e os trabalhos — a máquina que perdeu ou recuperou o contato (motivo "presenca") muda a linha do dono.
  "inventario.mudou": (e) => invalidar(e, "inventario", "frota", "executor", "ias", usoPlano(e), "maquinas", "trabalhos"),
  // ADR-102: a lista de contas (ou um login numa máquina) mudou. definido em 2026-10-16 (revisão do PR 1): a conta em uso
  // pode ter trocado (limite, login, outra conta na frente), e com ela o uso da janela do anel.
  "contas.mudou": (e) => invalidar(e, "contas", "maquinas", usoPlano(e)),
  "agente.mudou": (e, f) => {
    const agenteId = texto(f.dados.agente_id) ?? texto(f.dados.agenteId);
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
  // ADR-113: as reações de uma fala mudaram (noutra aba ou pelo próprio clique) — relê a conversa, que traz o chip.
  "reacao.mudou": (e, f) => invalidar(e, conv(f)),
  // ADR-083: um trabalho nasceu ou mudou — relê a lista (faixa, barra, gaveta), a conversa do bot (a linha "Abriu a
  // task", a pergunta e o resultado) e a tela da task, se ela já foi aberta.
  "trabalho.mudou": (e, f) => {
    const id = texto(f.dados.trabalhoId) ?? texto(f.dados.trabalho_id);
    const aberta = id && (e.trabalhoDetalhe[id] || (e.tela.tipo === "trabalho" && e.tela.id === id)) ? (`trabalho:${id}` as Invalidacao) : null;
    // ADR-099 §7: o custo de hoje também (só é buscado com a tela Trabalhos aberta; `relevante` no main).
    // ADR-099 (parte 5): o estado do dono que o frame traz vale na hora (a linha acima do campo, o chip e Trabalhos), antes
    // de a lista e a conversa voltarem do REST.
    return invalidar(comEstadoDoDono(e, f.dados.estadoDono), "trabalhos", "custo", conv(f), aberta, ...atividadeDoFrame(e, f));
  },
  // #194: o nível vale na hora (a pílula aparece sem esperar o REST); a lista relê para o total de memória.
  "memoria.mudou": (e, f) => {
    const nivel = f.dados.nivel;
    if (nivel !== "verde" && nivel !== "amarela" && nivel !== "vermelha") return e;
    return invalidar(e.pressao === nivel ? e : { ...e, pressao: nivel }, "trabalhos");
  },
  resumed: (e, f) => (f.dados.resumed === true ? e : invalidar(e, "frota", "sua-vez", "nao-lidos", "rotinas", "conectores", "inventario", "executor", "ias", usoPlano(e), "salas", ...Object.keys(e.conversas).map((id): Invalidacao => `conversa:${id}`))),
};

/** Frames que trazem fala nova (ou o fim de um turno) para a conversa do bot: a tela da task aberta relê as mensagens dela. */
const RELEEM_A_TASK: ReadonlySet<TipoFrame> = new Set<TipoFrame>(["mensagem.nova", "turno.fala", "turno.encerrado", "turno.interrompido", "decisao.nova", "decisao.decidida"]);

export function aplicarFrame(estado: Estado, frame: FrameSse, agora: number): Estado {
  const handler = POR_FRAME[frame.tipo];
  const depois = handler ? handler(estado, frame, agora) : estado;
  // ADR-083 (#195): a tela da task mostra as mensagens do trabalho, que chegam pelos frames da conversa do bot dele.
  const t = depois.tela;
  if (t.tipo !== "trabalho" || !RELEEM_A_TASK.has(frame.tipo) || texto(frame.dados.conversaId) !== conversaIdNaTela(depois)) return depois;
  return invalidar(depois, `trabalho:${t.id}`);
}

export function reduzir(estado: Estado, acao: Acao): Estado {
  switch (acao.tipo) {
    case "sessao":
      // Trocou a pessoa: chaves E relatos somem. Relato carrega correlationId, machineId e o erro
      // cru do fornecedor — não pode ficar na tela da próxima sessão (ADR-002).
      return { ...estado, sessao: acao.escopo, chaves: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.chaves : null, maquinas: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.maquinas : null, computadorPessoa: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.computadorPessoa : null, instalarSsh: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.instalarSsh : null, contasIa: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.contasIa : null, detalhesContas: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.detalhesContas : null, relatos: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.relatos : null, chaveEmitida: null,
        modoDev: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.modoDev : { ligado: false, raioX: {} },
        naoLidos: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.naoLidos : null, novasDesde: {},
        citacoes: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.citacoes : {},
        custoHoje: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.custoHoje : undefined,
        carregado: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.carregado : estadoInicial.carregado,
        ligacaoViva: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.ligacaoViva : null,
        disponibilidadeLigacao: acao.escopo?.pessoaId === estado.sessao?.pessoaId ? estado.disponibilidadeLigacao : {},
        leitura: acao.escopo?.pessoaId === estado.sessao?.pessoaId && acao.escopo?.tenantId === estado.sessao?.tenantId ? estado.leitura : null,
        falhaLeitura: acao.escopo?.pessoaId === estado.sessao?.pessoaId && acao.escopo?.tenantId === estado.sessao?.tenantId ? estado.falhaLeitura : null,
        // NOD-326 (revisão 3): a Biblioteca também some na troca de tenant (não fica dado de um tenant no outro).
        ...(acao.escopo?.tenantId === estado.sessao?.tenantId ? {} : { bibliotecaDoBot: {} }),
        ...(acao.escopo?.pessoaId === estado.sessao?.pessoaId ? {} : { onboarding: undefined, onboardingAberto: false, onboardingResolvido: false, trabalhos: null, trabalhoDetalhe: {}, pressao: null, atividadeDoBot: {}, atividadeHoje: {}, atividadeVista: null, bibliotecaDoBot: {} }) };
    case "navegar": {
      // definido em 2026-10-08 (revisão W5): reabrir uma task já vista relê as mensagens dela (o detalhe guardado é de
      // quando ela foi aberta da última vez); W11: sair da tela da task de um bot cuja conversa não está carregada apaga o
      // ao vivo dela — os frames dessa conversa param de ser guardados, e voltar juntaria o texto com um buraco no meio.
      const saindo = conversaIdNaTela(estado);
      const atividades = saindo && !estado.conversas[saindo] && estado.atividades[saindo] && conversaIdNaTela({ ...estado, tela: acao.tela }) !== saindo
        ? semConversa(estado.atividades, saindo)
        : estado.atividades;
      const navegado = resolverInicio({
        ...estado,
        atividades,
        tela: acao.tela,
        // Ir a outro lugar (o clique num aviso, por exemplo) fecha Seu espaço: a pessoa foi para onde pediu.
        espaco: null,
        erro: null,
        // Revisão da NOD-349: o popover do avatar não reabre sozinho ao voltar ao bot.
        avatarAberto: null,
        // A gaveta só continua num nível interno se a conversa é do mesmo bot; outro bot abre na visão geral.
        gaveta: acao.tela.tipo === "conversa" && estado.gaveta?.agenteId === acao.tela.agenteId ? estado.gaveta : null,
        faixaParada: acao.tela.tipo === estado.tela.tipo ? estado.faixaParada : null,
        // Saiu de Computadores: a chave crua some da memória (ela aparece uma vez só).
        chaveEmitida: null,
        // A linha "Novas" vale enquanto a pessoa está na conversa; saiu, ela some.
        novasDesde: {},
        faixaTrabalhosAberta: faixaAbertaAoNavegar(estado.faixaTrabalhosAberta, estado.tela, acao.tela),
      });
      if (acao.tela.tipo === "trabalho") return invalidar(navegado, `trabalho:${acao.tela.id}`);
      // NOD-260 (definido em 2026-10-15): abrir Trabalhos (vindo de outra tela) sempre relê — a lista guardada é de
      // quando ela foi lida, e só o frame de um trabalho a relia.
      return acao.tela.tipo === "trabalhos" && estado.tela.tipo !== "trabalhos" ? invalidar(navegado, "trabalhos") : navegado;
    }
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
      const comAgora = semFalasSaindo({ ...estado, agora: acao.agora }, (s) => acao.agora - s.em < FALA_SAINDO_MS);
      return estado.suaVez?.incidentes.some((i) => i.voltouEm === null) ? invalidar(comAgora, "sua-vez") : comAgora;
    }
    case "conexao": {
      // NOD-215: o SSE de volta a `aberto` prova que o servidor voltou; só o erro DE REDE some (outro erro fica).
      const erro = acao.estado === "aberto" && ehErroDeRede(estado.erro) ? null : estado.erro;
      return { ...estado, conexao: { estado: acao.estado, tentativa: acao.tentativa, proximaEmMs: acao.proximaEmMs }, erro };
    }
    case "frame":
      return aplicarFrame(estado, acao.frame, acao.agora);
    case "hidratar-gestao":
      return { ...estado, gestao: acao.gestao };
    case "hidratar-frota": {
      // Revisão da NOD-349: o computador que a frota diz que voltou deixa de valer como "fora" lido num pulso antigo.
      const voltaram = acao.frota.agentes.filter((a) => !a.computadorForaDoAr && estado.computadorVisto[a.id] === "fora").map((a) => a.id);
      const computadorVisto = voltaram.length ? Object.fromEntries(Object.entries(estado.computadorVisto).filter(([id]) => !voltaram.includes(id))) : estado.computadorVisto;
      return comConversasDosDonos(resolverInicio({ ...estado, frota: acao.frota, inventario: acao.frota.inventario, computadorVisto }));
    }
    case "hidratar-inventario":
      return { ...estado, inventario: acao.inventario };
    case "hidratar-executor":
      return { ...estado, executor: acao.executor };
    case "hidratar-ias":
      return { ...estado, ias: acao.ias };
    case "hidratar-uso-plano":
      return { ...estado, usoDoPlano: acao.usoDoPlano };
    case "agente-gravado": {
      // Revisão do PR 1 (2026-10-16): o seletor de IA mostra a escolha na hora; o refetch de frota/gestão confirma depois.
      // Só os campos do perfil que o PUT devolve entram — o que é da frota (conversaId, estado, prévia) fica.
      const junto = <T extends { agentes: Agente[] }>(dto: T): T => ({ ...dto, agentes: dto.agentes.map((x) => (x.id === acao.agente.id ? { ...x, ...acao.agente } : x)) });
      return { ...estado, frota: estado.frota ? junto(estado.frota) : estado.frota, gestao: estado.gestao ? junto(estado.gestao) : estado.gestao };
    }
    case "ias-mac":
      return { ...estado, iasMac: { ...estado.iasMac, ...acao.mudanca } };
    case "ordem-ias": {
      if (!estado.ias) return estado;
      const ias = [...estado.ias.ias].sort((a, b) => posicao(acao.ordem, a.id) - posicao(acao.ordem, b.id));
      return { ...estado, ias: { ...estado.ias, ordem: acao.ordem, ordemPadrao: false, ias } };
    }
    case "rascunho-ia":
      return { ...estado, rascunhoIa: acao.rascunho };
    case "menu-ia":
      return { ...estado, menuIa: acao.agenteId };
    case "hidratar-conversa": {
      const conversaId = acao.conversa.conversa.id;
      // Turno aberto que a web não viu nascer (página recarregada no meio dele): o REST o devolve e ele
      // volta a ser vivo, com o `desde` do banco. O frame turno.iniciado não se repete para quem chegou depois.
      // TODO(servidor, modo ligação): `TurnoEmCursoDto` (src/contracts/api.ts) não traz `origem`; o plano diz que
      // `lerConversa` já exclui o turno `ligacao`. Se ele vier, a web o ignora aqui pelo campo `origem` (ou `modo`).
      // NOD-216: o que a web já viu encerrar nunca volta (o GET que saiu antes do `turno.encerrado`), como em hidratar-trabalho.
      // Revisão: e o que uma leitura mais nova já desmentiu também não (a resposta velha que chega por último).
      const leuTurnos = Array.isArray(acao.conversa.turnosEmCurso);
      const emCurso = acao.conversa.turnosEmCurso ?? [];
      const novos = emCurso.filter((t) => !estado.turnosVivos[t.id] && !estado.turnosEncerrados.includes(t.id) && !desmentidoDepois(estado, t.id, acao.agora) && !("origem" in t && t.origem === "ligacao") && !("modo" in t && t.modo === "ligacao"));
      // NOD-216: e o turno da conversa que o servidor não devolve mais sai — o `turno.encerrado` perdido (SSE caído, aba
      // dormindo) deixava "na fila · há 6h" e o mascote animado para sempre. Só os confirmados ANTES desta leitura sair; o
      // de task (`trabalhoId`) é da tela da task (hidratar-trabalho).
      // Revisão: a resposta sem `turnosEmCurso` (servidor antigo, resposta parcial) não diz que nada roda — não tira nada.
      const naLeitura = new Set(emCurso.map((t) => t.id));
      const sumiram = leuTurnos ? Object.values(estado.turnosVivos).filter((v) => v.conversaId === conversaId && !v.trabalhoId && !naLeitura.has(v.turnoId) && confirmadoAntes(v, acao.agora)).map((v) => v.turnoId) : [];
      const semSumidos = semDesmentidos(estado, sumiram, acao.agora);
      const turnosVivos = novos.length === 0 ? semSumidos.turnosVivos : { ...semSumidos.turnosVivos };
      // `chegouEm`: o relógio da web, nunca adiante do `desde` do banco (o relógio da web atrasado faria a fila "pensar").
      // NOD-276 (J3): o que já roda conta "Trabalhando · há N" do despacho; "Na fila há N" segue com a criação.
      const desdeDe = (t: (typeof novos)[number]): number => (t.estado === "despachando" ? (t.despachadoEm ?? t.desde) : t.desde);
      for (const t of novos) turnosVivos[t.id] = { turnoId: t.id, conversaId, estado: t.estado === "despachando" ? "rodando" : "na_fila", executor: null, machineId: null, desde: desdeDe(t), trabalhoId: t.trabalhoId ?? null, vistoEm: acao.agora, chegouEm: Math.min(desdeDe(t), acao.agora), origem: t.origem ?? null, agenteId: t.agenteId ?? null };
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
      return { ...semFalasSaindo(semSumidos, (s, c) => c !== conversaId || s.em > acao.agora), turnosVivos, atividades, conversas: { ...estado.conversas, [conversaId]: { ...acao.conversa, carregadaEm: acao.agora } } };
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
    case "gaveta": {
      // O rascunho da Inteligência (2B) e o menu rápido (2A) não sobrevivem à troca de nível.
      // ADR-114: a Atividade abre sempre no dia de hoje, em "Tudo"; sair dela esquece o dia, o filtro e o item aberto.
      const atividadeVista: VistaDaAtividade | null = acao.nivel?.tipo === "atividade" ? { agenteId: acao.agenteId, dia: diaLocal(estado.agora > 0 ? estado.agora : Date.now()), filtro: "tudo", aberta: null } : null;
      const depois = { ...estado, avatarAberto: null, gaveta: acao.nivel ? { agenteId: acao.agenteId, nivel: acao.nivel } : null, rascunhoIa: acao.nivel?.tipo === "inteligencia" && estado.rascunhoIa?.agenteId === acao.agenteId ? estado.rascunhoIa : null, menuIa: null, atividadeVista };
      // Reabrir a Atividade relê o dia (a página guardada aparece enquanto a nova não chega): fechada, nenhum frame a relia.
      return atividadeVista && chaveDaAtividade(atividadeVista.agenteId, atividadeVista.dia) in estado.atividadeDoBot ? invalidar(depois, `atividade:${chaveDaAtividade(atividadeVista.agenteId, atividadeVista.dia)}`) : depois;
    }
    case "aba-gaveta":
      if (estado.abaGaveta[acao.agenteId] === acao.aba) return estado;
      return { ...estado, abaGaveta: { ...estado.abaGaveta, [acao.agenteId]: acao.aba }, avatarAberto: null };
    case "abas-lidas":
      return { ...estado, abaGaveta: { ...acao.abas, ...estado.abaGaveta } };
    case "avatar-popover":
      return { ...estado, avatarAberto: acao.aberto };
    case "computador-visto":
      if (estado.computadorVisto[acao.agenteId] === acao.estado) return estado;
      return { ...estado, computadorVisto: { ...estado.computadorVisto, [acao.agenteId]: acao.estado } };
    case "computador-acao":
      return { ...estado, computadorAcao: acao.acao };
    case "agente-local": {
      // ADR-125: o nome, o subtítulo, a forma e a cor mudam na hora na frota (otimista); o PATCH confirma ou desfaz.
      if (!estado.frota) return estado;
      const agentes = estado.frota.agentes.map((a) => (a.id === acao.agenteId ? { ...a, ...acao.mudanca } : a));
      return { ...estado, frota: { ...estado.frota, agentes } };
    }
    case "hidratar-atividade": {
      // A página do dia de hoje também é o "N hoje" da linha (o mesmo total, nas mesmas três fontes).
      const hoje = estado.atividadeHoje[acao.agenteId];
      const atividadeHoje = acao.atividade && hoje?.dia === acao.dia ? { ...estado.atividadeHoje, [acao.agenteId]: { dia: acao.dia, total: acao.atividade.total } } : estado.atividadeHoje;
      return { ...estado, atividadeDoBot: { ...estado.atividadeDoBot, [chaveDaAtividade(acao.agenteId, acao.dia)]: acao.atividade }, atividadeHoje };
    }
    case "hidratar-atividade-hoje":
      return { ...estado, atividadeHoje: { ...estado.atividadeHoje, [acao.agenteId]: { dia: acao.dia, total: acao.total } } };
    case "hidratar-biblioteca": {
      const antes = estado.bibliotecaDoBot[acao.conversaId];
      // Revisão 1 da NOD-326: a página seguinte só entra se ainda é esperada (a lista não foi trocada por erro nem por
      // "Tentar de novo" enquanto ela vinha); a releitura que falha mantém a lista que estava boa.
      if (acao.seguinte && (!antes || antes.erro || !antes.carregandoMais)) return estado;
      let nova: BibliotecaDaConversa;
      if (acao.pagina) nova = juntarPagina(antes?.erro ? undefined : antes, acao.pagina, acao.seguinte);
      else if (acao.seguinte && antes) nova = { ...antes, carregandoMais: false, falhouMais: true };
      else if (antes && !antes.erro) return estado;
      else nova = { itens: [], proximo: null, erro: true, carregandoMais: false, mostrando: antes?.mostrando ?? {} };
      return { ...estado, bibliotecaDoBot: { ...estado.bibliotecaDoBot, [acao.conversaId]: nova } };
    }
    case "biblioteca-mais": {
      const b = estado.bibliotecaDoBot[acao.conversaId];
      if (!b) return estado;
      const g = gruposVisiveis(b, estado.agora > 0 ? estado.agora : Date.now()).find((v) => v.grupo === acao.grupo);
      if (!g || (!g.maisLocal && !g.maisNoServidor)) return estado;
      // Revisão 3: com uma página a caminho, só o "mais" do que já foi lido anda (outro grupo); o do servidor espera.
      if (b.carregandoMais && !g.maisLocal) return estado;
      const mostrando = { ...b.mostrando, [acao.grupo]: g.itens.length + POR_VEZ };
      return { ...estado, bibliotecaDoBot: { ...estado.bibliotecaDoBot, [acao.conversaId]: { ...b, mostrando, carregandoMais: b.carregandoMais || g.maisNoServidor, falhouMais: false } } };
    }
    case "biblioteca-tentar": {
      const { [acao.conversaId]: _fora, ...resto } = estado.bibliotecaDoBot;
      return { ...estado, bibliotecaDoBot: resto };
    }
    case "atividade-vista":
      return estado.atividadeVista ? { ...estado, atividadeVista: { ...estado.atividadeVista, ...acao.mudanca } } : estado;
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
    case "hidratar-salas":
      return { ...estado, salas: acao.salas, carregado: estado.carregado.salas ? estado.carregado : { ...estado.carregado, salas: true } };
    case "hidratar-nao-lidos":
      return { ...estado, naoLidos: acao.naoLidos };
    case "novas-desde":
      return { ...estado, novasDesde: { ...estado.novasDesde, [acao.conversaId]: { mensagemId: acao.mensagemId, em: acao.em, total: acao.total } } };
    case "hidratar-chaves":
      return { ...estado, chaves: acao.chaves };
    case "hidratar-maquinas":
      return { ...estado, maquinas: acao.maquinas };
    case "hidratar-computador-pessoa": {
      if (!acao.dto) return estado.computadorPessoa ? { ...estado, computadorPessoa: null, computadorMemoria: MEMORIA_INICIAL, computadorUi: UI_COMPUTADOR_INICIAL } : estado;
      const computadorMemoria = lembrarComputador(estado.computadorPessoa, acao.dto, estado.computadorMemoria, acao.agora);
      // A operação acabou: as etapas fecham sozinhas. NOD-93: o preparo acabou (pronto, falhou): a janela de primeiro uso também.
      const fimDaOperacao = !acao.dto.operacao && estado.computadorUi.etapasAbertas;
      const fimDoPreparo = estado.computadorUi.preparoAberto && !acao.dto.preparo?.estado.match(/^(baixando|pausado_sem_internet|preparando|ligando|esperando_memoria)$/);
      const computadorUi = fimDaOperacao || fimDoPreparo ? { ...estado.computadorUi, ...(fimDaOperacao ? { etapasAbertas: false } : {}), ...(fimDoPreparo ? { preparoAberto: false } : {}) } : estado.computadorUi;
      return { ...estado, computadorPessoa: acao.dto, computadorMemoria, computadorUi };
    }
    case "computador-ui":
      return { ...estado, computadorUi: { ...estado.computadorUi, ...acao.ui } };
    case "conectar-maquina":
      return { ...estado, conectarMaquina: acao.conectar };
    case "instalar-ssh":
      return { ...estado, instalarSsh: acao.instalar };
    case "hidratar-contas":
      return { ...estado, contasIa: acao.contas, detalhesContas: acao.detalhes };
    case "trocar-contas":
      return { ...estado, contasIa: acao.contas };
    case "contas-ui":
      return { ...estado, contasUi: { ...estado.contasUi, ...acao.mudanca } };
    case "nuvem-ui":
      return { ...estado, nuvem: { ...estado.nuvem, ...acao.mudanca } };
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
    case "citar": {
      const citacoes = { ...estado.citacoes };
      if (acao.citacao) citacoes[acao.conversaId] = acao.citacao;
      else delete citacoes[acao.conversaId];
      return { ...estado, citacoes };
    }
    case "invalidar":
      return invalidar(estado, ...acao.quais);
    case "invalidacoes-tratadas":
      return { ...estado, invalidacoes: estado.invalidacoes.filter((q) => !acao.quais.includes(q)) };
    case "erro":
      return { ...estado, erro: acao.erro, ocupado: false };
    case "turno-refeito":
      return estado.turnosRefeitos.includes(acao.turnoId) ? estado : { ...estado, turnosRefeitos: [...estado.turnosRefeitos, acao.turnoId] };
    case "rede-caiu":
      // Um erro de outra natureza na tela não é trocado pelo aviso de rede; o "ocupado" fica: a ação segue tentando.
      if (estado.erro !== null && !ehErroDeRede(estado.erro)) return estado;
      return { ...estado, erro: acao.erro };
    case "rede-voltou":
      return ehErroDeRede(estado.erro) ? { ...estado, erro: null } : estado;
    case "ocupado":
      return { ...estado, ocupado: acao.valor };
    case "ligacao-viva": {
      const a = estado.ligacaoViva;
      const b = acao.viva;
      const igual = a === b || (a !== null && b !== null && a.ligacaoId === b.ligacaoId && a.local === b.local && a.agenteId === b.agenteId);
      return igual ? estado : { ...estado, ligacaoViva: b };
    }
    case "leitura-mudou": {
      const a = estado.leitura;
      const b = acao.leitura;
      const mesma = a === b || (a !== null && b !== null && a.mensagemId === b.mensagemId && a.fase === b.fase);
      const falhaLeitura = acao.falha === undefined ? estado.falhaLeitura : acao.falha;
      return mesma && falhaLeitura === estado.falhaLeitura ? estado : { ...estado, leitura: b, falhaLeitura };
    }
    case "hidratar-disponibilidade-ligacao":
      return { ...estado, disponibilidadeLigacao: { ...estado.disponibilidadeLigacao, [acao.agenteId]: acao.disponibilidade } };
    case "hidratar-onboarding":
      return resolverInicio({ ...estado, onboarding: acao.onboarding });
    case "onboarding-aberto":
      return estado.onboardingAberto === acao.aberto ? estado : { ...estado, onboardingAberto: acao.aberto };
    case "hidratar-trabalhos":
      // O servidor manda o nível que vale agora: null (nenhum Mac falou) também limpa o amarelo antigo (revisão W4).
      return comConversasDosDonos(comDonosNasConversas(reconciliarPelosDonos({ ...estado, trabalhos: acao.trabalhos, pressao: acao.trabalhos.pressao }, acao.trabalhos, acao.agora), acao.trabalhos.donos));
    case "hidratar-trabalho": {
      // Página aberta no meio do trabalho: o turno que roda volta a ser vivo, para o ao vivo dele ser guardado e desenhado.
      // definido em 2026-10-08 (revisão W6): o turno do trabalho que não é mais o vivo dele sai, e o que a web já viu
      // encerrar nunca volta — o GET que saiu antes do `turno.encerrado` não recria um "Trabalhando" fantasma.
      const t = acao.detalhe.trabalho;
      const velhos = Object.values(estado.turnosVivos).filter((v) => v.trabalhoId === t.id && v.turnoId !== t.turnoVivoId);
      const volta = t.turnoVivoId && !estado.turnosVivos[t.turnoVivoId] && !estado.turnosEncerrados.includes(t.turnoVivoId) ? t.turnoVivoId : null;
      let turnosVivos = estado.turnosVivos;
      if (velhos.length > 0 || volta) {
        turnosVivos = { ...estado.turnosVivos };
        for (const v of velhos) delete turnosVivos[v.turnoId];
        if (volta) turnosVivos[volta] = { turnoId: volta, conversaId: t.conversaId, estado: "rodando", executor: null, machineId: null, desde: t.iniciadoEm ?? acao.agora, trabalhoId: t.id };
      }
      return { ...estado, turnosVivos, trabalhoDetalhe: { ...estado.trabalhoDetalhe, [t.id]: acao.detalhe } };
    }
    case "trabalho-sumiu": {
      // definido em 2026-10-08 (revisão W2): a task que some (404) não fica em "carregando a task…" pedindo o GET de novo
      // a cada frame — a tela volta para onde a pessoa estava (main.ts esquece a task lembrada na aba).
      const t = estado.tela;
      if (t.tipo !== "trabalho" || t.id !== acao.id) return estado;
      return resolverInicio({ ...estado, tela: t.voltar, invalidacoes: estado.invalidacoes.filter((q) => q !== `trabalho:${acao.id}`) });
    }
    case "faixa-trabalhos":
      return estado.faixaTrabalhosAberta === acao.agenteId ? estado : { ...estado, faixaTrabalhosAberta: acao.agenteId };
    case "bot-trabalhos":
      return estado.botAbertoEmTrabalhos === acao.agenteId ? estado : { ...estado, botAbertoEmTrabalhos: acao.agenteId };
    case "uso-do-mac":
      return estado.usoDoMac === acao.uso ? estado : { ...estado, usoDoMac: acao.uso };
    case "experimentos":
      return { ...estado, experimentos: acao.experimentos };
    case "tempo-task":
      return estado.tempoTaskAberto === acao.id ? estado : { ...estado, tempoTaskAberto: acao.id };
    case "hidratar-custo":
      return { ...estado, custoHoje: acao.custo };
    case "custo-aberto":
      // Abrir relê o custo (o gasto anda a cada turno; a tela não fica com o número de quando abriu).
      return estado.custoAberto === acao.aberto ? estado : acao.aberto ? invalidar({ ...estado, custoAberto: true }, "custo") : { ...estado, custoAberto: false };
    case "hidratar-taxas-linhas":
      return estado.modoDev.ligado ? { ...estado, modoDev: { ...estado.modoDev, taxasLinhas: acao.taxas } } : estado;
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
  // revisto em 2026-10-07 (ADR-081): o Nod é fixo mas de uso esporádico — o app abre no primeiro bot da pessoa e só cai
  // no Nod quando ele é o único.
  const comuns = meus.filter((a) => a.papel !== "nod");
  const primeiro = comuns.find((a) => a.fixado) ?? comuns[0] ?? meus[0];
  const tela: Tela = primeiro ? { tipo: "conversa", conversaId: primeiro.conversaId, agenteId: primeiro.id } : { tipo: "novo-bot" };
  return { ...estado, tela };
}

/** O que a tela atual precisa ter carregado (o main busca o que faltar). */
/** NOD-326: a conversa de um bot na tela, a gaveta dele na visão geral (sem nível aberto) e a aba Biblioteca escolhida. */
export function bibliotecaAberta(estado: Pick<Estado, "tela" | "gaveta" | "abaGaveta">): boolean {
  const t = estado.tela;
  if (t.tipo !== "conversa") return false;
  const nivel = estado.gaveta?.agenteId === t.agenteId ? estado.gaveta.nivel : null;
  return nivel === null && estado.abaGaveta[t.agenteId] === "biblioteca";
}

export function invalidacoesDaTela(estado: Estado): Invalidacao[] {
  const t = estado.tela;
  const faltas: Invalidacao[] = [];
  const secao = estado.espaco?.secao;
  if (secao === "agentes" && !estado.gestao) faltas.push("gestao");
  if (!estado.frota) faltas.push("frota");
  // Plano das IAs (2026-10-10): Provedores de IA, a gaveta (2A/2B) e as linhas de troca de IA no chat leem `GET /ias`.
  if (estado.sessao && estado.ias === undefined && (secao === "conexao" || t.tipo === "conversa")) faltas.push("ias");
  // definido em 2026-10-16 (plano "tela limpa", T6): o anel do seletor de IA no campo da conversa lê o uso da janela.
  if (estado.sessao && estado.usoDoPlano === undefined && t.tipo === "conversa") faltas.push("uso-plano");
  // ADR-077: o onboarding é lido uma vez por sessão (a falha vira null e o app abre normal).
  if (estado.sessao && estado.onboarding === undefined) faltas.push("onboarding");
  if ((t.tipo === "conversa" || t.tipo === "sala") && !estado.conversas[t.conversaId]) faltas.push(`conversa:${t.conversaId}`);
  if (t.tipo === "sala" && !estado.carregado.salas) faltas.push("salas");
  if (t.tipo === "nova-sala" && !estado.carregado.salas) faltas.push("salas");
  if (t.tipo === "conversa" && !estado.concessoes[t.agenteId]) faltas.push(`concessoes:${t.agenteId}`);
  // Modo ligação (2026-10-04): o botão "Ligar" do cabeçalho só aparece com a disponibilidade lida, e só para bot da pessoa.
  if (t.tipo === "conversa" && !(t.agenteId in estado.disponibilidadeLigacao) && estado.frota?.agentes.some((a) => a.id === t.agenteId && a.ownerId === estado.sessao?.pessoaId)) faltas.push(`disponibilidade:${t.agenteId}`);
  // Os níveis da gaveta que leem algo próprio: a memória do bot e o histórico da rotina aberta.
  const nivel = t.tipo === "conversa" && estado.gaveta?.agenteId === t.agenteId ? estado.gaveta.nivel : null;
  if (nivel?.tipo === "memoria" && !estado.memorias[estado.gaveta?.agenteId ?? ""]) faltas.push(`memoria:${estado.gaveta?.agenteId ?? ""}`);
  if (nivel?.tipo === "rotina" && !estado.execucoes[nivel.id]) faltas.push(`execucoes:${nivel.id}`);
  // ADR-114: a página do dia aberto na Atividade; e o "N hoje" da linha "Atividade" do bot da pessoa (o main só busca com o
  // painel à vista). Lida num dia que já passou (a meia-noite virou com a tela aberta), relê.
  const vista = estado.atividadeVista;
  if (nivel?.tipo === "atividade" && vista && !(chaveDaAtividade(vista.agenteId, vista.dia) in estado.atividadeDoBot)) faltas.push(`atividade:${chaveDaAtividade(vista.agenteId, vista.dia)}`);
  if (t.tipo === "conversa" && estado.frota?.agentes.some((a) => a.id === t.agenteId && a.ownerId === estado.sessao?.pessoaId)) {
    const lida = estado.atividadeHoje[t.agenteId];
    if (!lida || (estado.agora > 0 && lida.dia < diaLocal(estado.agora))) faltas.push(`atividade-hoje:${t.agenteId}`);
  }
  // NOD-326: a Biblioteca, só com ela aberta na visão geral da gaveta deste bot (o main ainda pede o painel à vista).
  if (t.tipo === "conversa" && bibliotecaAberta(estado) && !estado.bibliotecaDoBot[t.conversaId]) faltas.push(`biblioteca:${t.conversaId}`);
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
  // ADR-083: o chip de cada bot na barra e o ícone "Trabalhos" do topo também (e a faixa, a gaveta, a tela da task).
  if (estado.sessao && !estado.trabalhos) faltas.push("trabalhos");
  if (t.tipo === "trabalho" && !estado.trabalhoDetalhe[t.id]) faltas.push(`trabalho:${t.id}`);
  // ADR-099 §7: o custo de hoje na tela Trabalhos (o aviso de ritmo aparece sem clique; o detalhe, atrás dele).
  if (estado.sessao && t.tipo === "trabalhos" && estado.custoHoje === undefined) faltas.push("custo");
  if (t.tipo === "linha" && !estado.conversas[t.conversaId]) faltas.push(`conversa:${t.conversaId}`);
  if (secao === "computadores" && !estado.chaves) faltas.push("chaves");
  // ADR-090: a seção Máquinas e a conversa (a mensagem na fila diz quando a máquina do bot está fora do ar).
  // QA do NOD-314: a tela da task também lê a frota ("Rodar em <outra> desta vez" e a linha do turno preso).
  if (estado.sessao && !estado.maquinas && (secao === "maquinas" || secao === "conexao" || t.tipo === "conversa" || t.tipo === "trabalho")) faltas.push("maquinas");
  // ADR-121 (NOD-92): a conta da nuvem em Máquinas (404 = sem a flag; a seção fica como antes).
  if (estado.sessao && estado.nuvem.conta === null && secao === "maquinas") faltas.push("nuvem");
  // ADR-102: a lista de contas em Provedores de IA e o resumo de contas de cada máquina.
  // definido em 2026-10-16 (T6): e o cabeçalho do seletor de IA no campo (a conta em uso, só o apelido).
  // NOD-280 (critério 9): e a sala/linha aberta com nota de limite de contas — a nota se recalcula com a lista.
  if (estado.sessao && !estado.contasIa && (secao === "maquinas" || secao === "conexao" || t.tipo === "conversa" || t.tipo === "trabalho" || conversaAbertaTemNotaDeContas(estado))) faltas.push("contas");
  // O frame relato.criado não invalida nada (é registro), então a seção busca quando ainda não tem.
  if (secao === "relatos" && !estado.relatos) faltas.push("relatos");
  return faltas.filter((f) => !estado.invalidacoes.includes(f));
}

/**
 * O que o stream que voltou a `aberto` relê (definido em 2026-10-13, NOD-216): os turnos vivos — `GET trabalhos` traz o
 * dono de cada bot (os mascotes da barra) e cada conversa carregada, os turnos dela. Só a aberta é buscada na hora.
 */
export function invalidacoesAoReconectar(estado: Estado): Invalidacao[] {
  if (!estado.sessao) return [];
  // Revisão: a tela da task aberta também — é a leitura dela que tira o turno fantasma da task (hidratar-trabalho).
  const t = estado.tela;
  // NOD-326 (revisão 2): a Biblioteca já lida também — o stream que caiu pode ter perdido o frame do arquivo novo.
  return ["trabalhos", ...Object.keys(estado.conversas).map((id): Invalidacao => `conversa:${id}`), ...Object.keys(estado.bibliotecaDoBot).map((id): Invalidacao => `biblioteca:${id}`), ...(t.tipo === "trabalho" ? [`trabalho:${t.id}` as Invalidacao] : [])];
}

/**
 * O que o stream perdido pode ter mudado (definido em 2026-10-10, ADR-094): quando o servidor não consegue retomar
 * (`resumed:false` — o celular ficou muito tempo em segundo plano e o buffer foi podado), a web relê tudo o que já tinha
 * carregado, não só a tela: os não lidos, "Sua vez", os trabalhos, e toda conversa já aberta. Só o que a
 * tela olha é buscado na hora (`relevante` no main); o resto fica marcado até a tela abrir.
 */
export function invalidacoesAoRetomar(estado: Estado): Invalidacao[] {
  if (!estado.sessao) return [];
  const t = estado.tela;
  const todas: Invalidacao[] = [
    "frota", "sua-vez", "nao-lidos", "inventario", "executor", "ias", "uso-plano", "salas", "rotinas", "ligacao", "trabalhos",
    ...Object.keys(estado.conversas).map((id): Invalidacao => `conversa:${id}`),
    ...Object.keys(estado.bibliotecaDoBot).map((id): Invalidacao => `biblioteca:${id}`),
    ...(t.tipo === "conversa" || t.tipo === "sala" || t.tipo === "linha" ? [`conversa:${t.conversaId}` as Invalidacao] : []),
    ...(t.tipo === "trabalho" ? [`trabalho:${t.id}` as Invalidacao] : []),
  ];
  return [...new Set(todas)];
}
