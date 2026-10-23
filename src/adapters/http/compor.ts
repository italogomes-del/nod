import { criarLoginsNaMaquina } from "../../services/logins-na-maquina.ts";
import { anunciarContasDaMaquina } from "../../use-cases/contas-ia.ts";
import { rotasContasIa } from "./rotas/contas-ia.ts";
import { rotasInstalacoesSsh } from "./rotas/instalacoes-ssh.ts";
import { criarInstalacoesPorSsh } from "../../services/instalacoes-por-ssh.ts";
import type { ContaAnunciada, ProgressoDoLogin, PuxadaDeContas } from "../../contracts/contas-ia.ts";
import type { ProgressoDeInstalacao } from "../../contracts/instalacoes-ssh.ts";
import type { PlataformaMaquina } from "../../contracts/ponte.ts";
import type { DriverComputador } from "../../contracts/computador.ts";
import { criarDriverDocker } from "../computador/docker.ts";
import { type Computadores, criarComputadores } from "../fundo/computadores.ts";
import { rotasComputadores } from "./rotas/computadores.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import { expandirTil } from "../executor/caminho.ts";
import { criarWorkspaces } from "../fundo/workspaces.ts";
import { rotasWorkspaces } from "./rotas/workspaces.ts";
import { HARNESS_LEGADO, HARNESSES } from "../../contracts/harness.ts";
import type { CatalogoHarness, IdHarness } from "../../contracts/harness.ts";
import type { Executor, RuntimeEvent } from "../../contracts/evento.ts";
import type { EstadoExecutor, IdExecutor } from "../../contracts/executor.ts";
import { CAUSAS_DO_MAC, type CausaDoMac, type Inventario } from "../../contracts/inventario.ts";
import { sondaFoiLenta } from "../../domain/sonda-lenta.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import type { EventoStream, SubagenteVivo } from "../../contracts/turno.ts";
import { chaveDe, cifrar, decifrar } from "../../db/cifra.ts";
import { abrirTxEscopada, exigirForaDaTx, txEscopadaOuDoContexto } from "../../db/tx.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { iaAtualDoCatalogo, opcoesDoCatalogo } from "../../domain/harness.ts";
import { iaDoAutomatico, iasNoLimite, inteligenciaDoAgente, ordemEfetiva } from "../../domain/inteligencia.ts";
import { rotuloFerramenta } from "../../domain/rotulo-ferramenta.ts";
import { criarAvisoDoVigia } from "./aviso-vigia.ts";
import { lerModelosLigacao } from "../../domain/modelo-ligacao.ts";
import { contextoAtual } from "../../obs/contexto.ts";
import { log } from "../../obs/log.ts";
import { listarTodas } from "../../repositories/pessoas.repo.ts";
import { criarBarramento, type Barramento } from "../../services/barramento.ts";
import { criarConectoresVivos, type ConectoresVivos, type ConfigConectorVivo } from "../../services/conectores-vivos.ts";
import { capturaLigada, criarCapturas } from "../../services/capturas.ts";
import type { Conector } from "../../contracts/conector.ts";
import { COMANDO_GITHUB_NATIVO } from "../../contracts/github.ts";
import { executarGithubNaMaquina } from "../conectores-locais/github/maquina.ts";
import { concluirItemNaMaquina, itensParaAMaquina } from "../../use-cases/itens-na-maquina.ts";
import { removerMaquina } from "../../use-cases/interromper-por-maquina.ts";
import { repetirBarradosPorIa } from "../../use-cases/repetir-barrados-por-ia.ts";
import { configGithubNativo, criarDetectorGh, sondaGithubNativa, type DetectorGh } from "../conectores-locais/github/nativo.ts";
import { criarSubidaComposio } from "../integracoes/arquivo-composio.ts";
import { criarCofreDeTokensDoApp, criarTokenDeInstalacao } from "../integracoes/github-app.ts";
import { criarInterruptor, type InterruptorNod } from "../../services/interruptor.ts";
import { criarInventario, type ServicoInventario } from "../../services/inventario.ts";
import { criarTokenTurno, type PlanoRecomposto, type TokenTurno } from "../../services/token-turno.ts";
import { criarPareamentoMaquina } from "../../services/pareamento-maquina.ts";
import { criarPareamentoDispositivo } from "../../services/pareamento-dispositivo.ts";
import type { Db, Escopo, Relogio, Tx } from "../../shared/types.ts";
import { JUNTAR_DELTAS_MS } from "../../shared/constantes.ts";
import { servicoRotinas } from "../../use-cases/ativar-rotina.ts";
import { atualizarPerfil } from "../../use-cases/atualizar-perfil.ts";
import { motorDe } from "../../use-cases/autoria-evento.ts";
import { criarRotina } from "../../use-cases/criar-rotina.ts";
import { atualizarRotinaPeloAgente, excluirRotinaPeloAgente, listarRotinasDoAgente, pausarRotinaPeloAgente, reativarRotinaPeloAgente } from "../../use-cases/rotinas-do-agente.ts";
import { registrarDesfechoDaEntrega, repetidoSemResume } from "../../use-cases/disparar-rotina.ts";
import { emitirPlanoTurno } from "../../use-cases/emitir-plano-turno.ts";
import { encaminhar } from "../../use-cases/encaminhar.ts";
import { avisarFalhaDelegacao, entregarRespostaPeer } from "../../use-cases/entregar-resposta-peer.ts";
import { refazerRetornoDoLote } from "../../use-cases/fechar-lote.ts";
import { motivoEmPortugues } from "../../domain/redacao.ts";
import { lembrar } from "../../use-cases/lembrar.ts";
import { passar } from "../../use-cases/passar.ts";
import { semNovidade } from "../../use-cases/sem-novidade.ts";
import { pedirAcesso } from "../../use-cases/pedir-acesso.ts";
import { pedirAPessoa } from "../../use-cases/pedir-a-pessoa.ts";
import { pedirAprovacao } from "../../use-cases/pedir-aprovacao.ts";
import { pedirABot } from "../../use-cases/pedir-a-bot.ts";
import { verColegas } from "../../use-cases/ver-colegas.ts";
import { lerArtefato, publicarArtefato } from "../../use-cases/artefatos.ts";
import { servicoSala } from "../../use-cases/servico-sala.ts";
import type { Deps, Services, UseCasesNod } from "../../use-cases/tipos.ts";
import type { RegistroCatcher } from "../executor/drivers/catcher.ts";
import { iniciarLaco } from "../executor/laco.ts";
import { criarAcompanhanteDeTarefas } from "../executor/acompanhar-tarefas.ts";
import { criarAcompanhanteDeSubagentes } from "../executor/acompanhar-subagentes.ts";
import { comRotulos, haSubagenteTrabalhando, resumoSubagentes } from "../../domain/subagentes.ts";
import { iniciarPoolDeLacos } from "../executor/pool-lacos.ts";
import { criarAmostradorMemoria } from "../executor/amostrador-memoria.ts";
import { criarExecutarComando, iniciarLimpezaDasTasks, modoDaLimpeza } from "../executor/limpeza-das-tasks.ts";
import { iniciarEsperas } from "../executor/esperas.ts";
import { caminhoAumentado } from "../executor/caminho.ts";
import { montarAmbiente } from "../../domain/ambiente-executor.ts";
import { lerNodExecutor, MOTIVO_NAO_REGISTRADO } from "../executor/registry.ts";
import type { IdDriver, Registry } from "../executor/spi.ts";
import type { IniciarLaco } from "../fundo/orquestrador-turnos.ts";
import { criarPonteInterna, type PonteInternaNod } from "../fundo/ponte-interna.ts";
import { autorizarChaveMaquina } from "./autorizar-chave-maquina.ts";
import { segredoEfetivo } from "./sessao.ts";
import { comporContas, type ContasMontadas } from "./compor-contas.ts";
import type { EnviadorEmail } from "../email/enviador.ts";
import { criarPonteHttpServidor } from "./rotas/ponte.ts";
import type { Rota } from "./roteador.ts";
import { criarRotasAgentes } from "./rotas/agentes.ts";
import { criarRotasTrabalhos } from "./rotas/trabalhos.ts";
import { criarRotasAtividade } from "./rotas/atividade.ts";
import { criarTrabalhosVivos } from "../fundo/trabalhos-vivos.ts";
import { criarRotasArtefatos } from "./rotas/artefatos.ts";
import { rotasMaquinas } from "./rotas/maquinas.ts";
import { rotasNuvem } from "./rotas/nuvem.ts";
import { iniciarReconciliadorNuvem } from "../fundo/reconciliador-nuvem.ts";
import { criarProvedorGcp } from "../nuvem/gcp.ts";
import { criarContaGcp } from "../nuvem/conta-gcp.ts";
import type { ContaNuvem, ProvedorNuvem } from "../../contracts/provedor-nuvem.ts";
import { ErroNuvemLancado, servidorPublicoValido } from "../../domain/maquina-nuvem.ts";
import { criarRepos } from "../../repositories/index.ts";
import { rotasMotor } from "./rotas/motor.ts";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { rotasConcessoes } from "./rotas/concessoes.ts";
import { rotasMarketplace } from "./rotas/marketplace.ts";
import { rotasConectores } from "./rotas/conectores.ts";
import { criarRotasConversas } from "./rotas/conversas.ts";
import { criarRotasRelatos } from "./rotas/relatos.ts";
import { criarRotasDecisoes } from "./rotas/decisoes.ts";
import { executar, type DentroDeTx } from "./rotas/dentro-de-tx.ts";
import { criarCaixaRevisoes } from "../fundo/caixa-revisoes.ts";
import { lerConfigRevisor, renovacaoDoLacoLocal } from "../../domain/revisor.ts";
import { assentarRevisao } from "../../use-cases/revisar-acao.ts";
import { criarRotaDev } from "./rotas/dev.ts";
import { criarRotaEventos } from "./rotas/eventos.ts";
import { criarConexoesSse, type ConexoesSse } from "./sse.ts";
import type { DepsRotas } from "./rotas/executar-caso.ts";
import { criarRotasExecutor } from "./rotas/executor.ts";
import { criarRotasIas } from "./rotas/ias.ts";
import { criarRotasFrota } from "./rotas/frota.ts";
import { rotasInternas } from "./rotas/interno.ts";
import { criarRotaInventario } from "./rotas/inventario.ts";
import { criarRotaAmbiente } from "./rotas/ambiente.ts";
import { criarRotaMetricas } from "./rotas/metricas.ts";
import { criarRotasPropostas } from "./rotas/propostas.ts";
import { criarRotasRotinas, type DepsRotasL7 } from "./rotas/rotinas.ts";
import { criarRotasSalas } from "./rotas/salas.ts";
import { criarRotasSuaVez } from "./rotas/sua-vez.ts";
import { rotasTrilha } from "./rotas/trilha.ts";
import { criarRotasTurnos } from "./rotas/turnos.ts";
import { criarRotasRaioX } from "./rotas/raio-x.ts";
import { criarRotasComandos } from "./rotas/comandos.ts";
import { criarRotasUsoDoPlano } from "./rotas/uso-do-plano.ts";
import { criarRotasCustoDoDia } from "./rotas/custo-do-dia.ts";
import { criarRotasNaoLidos } from "./rotas/nao-lidos.ts";
import { criarRotasLigacoes } from "./rotas/ligacoes.ts";
import { neutralizarDelimitadores } from "../mcp-proxy/moldura.ts";
import { desligar, iniciarTarefa } from "../../use-cases/ferramentas-ligacao.ts";
import { anotarEntrevista, concluirEntrevista, estadoOnboardingParaVoz, proporBot } from "../../use-cases/onboarding.ts";
import { abrirFrentes, abrirTask, devolverResumo, mandarParaFrente, mandarParaTask } from "../../use-cases/frentes.ts";
import { meChameAs } from "../../use-cases/me-chame-as.ts";
import { esperarComando } from "../../use-cases/esperar-comando.ts";
import { gerirBots } from "../../use-cases/gerir-bots.ts";
import { criarBots } from "../../use-cases/criar-bots.ts";
import { responderPedido } from "../../use-cases/responder-pedido.ts";
import { registrarRelatoDoNod, verAppsConectados } from "../../use-cases/nod.ts";
import { MODELOS_DE_BOT, saudacaoDoOnboarding } from "../../domain/roteiro-onboarding.ts";
import type { IaNoMac } from "../../contracts/onboarding.ts";
import { criarRotasOnboarding } from "./rotas/onboarding.ts";
import { criarServicoVoz, type PersistenciaVoz, type RefLigacao, type ServicoVoz } from "../voz/orquestrador.ts";
import type { EstadoIaDaLigacao, IaDaLigacao } from "../../contracts/voz.ts";
import { ehIaDaLigacao, estadoIaDaLigacao } from "../../domain/ligacao-sem-ia.ts";
import { criarProvedoresVoz } from "../voz/fabrica.ts";
import { ADIANTE_MS_PADRAO, CARACTERES_DIA_PADRAO, criarLeitorDeVoz, lerInteiroDaLeitura } from "./leitura-voz.ts";
import type { ContextoLeitura } from "../../use-cases/ouvir-mensagem.ts";
import type { ProvedoresVoz } from "../voz/spi.ts";
import { concatenar, montarWav } from "../voz/audio.ts";
import { VELOCIDADES_VOZ, VOZES_NOD } from "../../contracts/vozes.ts";
import { criarCacheDeFalas } from "../voz/falas-de-espera.ts";
import { anexarCanaisVoz, type CanaisVoz, type CanalVoz } from "../voz/ws.ts";
import { criarServicoDitado } from "../voz/ditado.ts";
import { autorizarDitado, type ContextoDitado } from "../../use-cases/ditado.ts";
import { atenderLigacao, encerrarLigacao, gravarFalaLigacao, leituraDaDecisao, mandarNoChatDaLigacao, reabrirCerebroDaLigacao, resultadoDaTarefaDaLigacao, type ContextoLigacao } from "../../use-cases/ligacoes.ts";
import { cancelarTurno } from "../../use-cases/cancelar-turno.ts";
import type { IncomingMessage, Server } from "node:http";

/**
 * Composição do app (L9): UMA função monta Services concreto, UseCasesNod completo, a ponte
 * in-process, a fábrica `dentro` (abre abrirTxEscopada e monta Deps — a única porta das rotas ao
 * banco) e a lista de rotas de TODAS as lanes. Nada aqui é lógica de produto: só ligação.
 *
 * Fatias de Services: planos ← L5 (emitirPlanoTurno), rotinas ← L7 (servicoRotinas), conectores ← L5
 * (conectores-vivos), interruptor ← L6, catcher ← L3/L4 (catcherRepo), tokenTurno ← L5, sala ← L7
 * (servicoSala), barramento ← L8. UseCasesNod: lembrar/atualizarPerfil ← L6; criarRotina/passar/
 * encaminhar/pedirABot ← L7; pedirAcesso/pedirAprovacao/pedirAPessoa ← L5 (EMENDA 5).
 *
 * O registry chega DEPOIS (ligarRegistry): o driver catcher precisa da URL do servidor, que só existe
 * depois do listen — em produção a porta é fixa, no teste é 0 (EMENDA 34).
 */
export type EnvApp = Readonly<Record<string, string | undefined>>;

/** Liga (create + sonda) um driver ainda em sombra no registry já ligado; devolve o inventário da sonda. O boot fornece. */
export type AtivarDriver = (id: IdDriver) => Promise<Inventario>;

export type OpcoesCompor = {
  computador?: DriverComputador;
  db: Db;
  env: EnvApp;
  relogio?: Relogio;
  /** Fonte das pessoas (tenant de um pessoaId); só em teste. Default: tabela pessoas. */
  listarPessoas?: () => Promise<{ tenantId: string; id: string }[]>;
  /** Quem responde se o `gh` desta máquina está logado (ADR-048); só em teste. Default: `gh auth status`. */
  detectorGh?: DetectorGh;
  /** Provedores de voz prontos (NOD-180); só em teste, para observar o TTS falso. Default: pelas envs NOD_VOZ_*. */
  voz?: ProvedoresVoz;
  /** Só em teste (definido em 2026-10-08): o prazo da rede de 2 min (ADR-083 §2), para o e2e não esperar 120 s. Default: REDE_MS. */
  redeMs?: number;
  /** NOD-214: quando o processo começou (boot.ts), para a carência do lease na adoção. Ausente = a hora da composição. */
  inicioDoProcesso?: number;
  /** ADR-121: só em teste — a conta falsa e o fetch da troca do OAuth da nuvem. Default: Google de verdade. */
  nuvem?: { conta?: ContaNuvem; fetchImpl?: typeof fetch; provedor?: ProvedorNuvem };
  /** NOD-345: só em teste — o enviador de e-mail da conta. Default: Resend (google) ou a caixa local (stub). */
  enviadorEmail?: EnviadorEmail;
};

export type App = {
  services: Services;
  useCases: UseCasesNod;
  dentro: DentroDeTx;
  depsDe(trx: Tx, escopo: Escopo): Deps;
  ponte: PonteInternaNod;
  rotas: Rota[];
  /** NOD-345: as contas (NOD_CONTAS); null desligadas. O boot passa ao servidor (sessão revogável + rotas). */
  contas: ContasMontadas | null;
  barramento: Barramento;
  interruptor: InterruptorNod;
  tokens: TokenTurno;
  conectoresVivos: ConectoresVivos;
  inventario: ServicoInventario;
  /** Executor em uso AGORA ('local' = claude-cli; 'catcher'): nasce de NOD_EXECUTOR e muda pelo interruptor (trocarExecutor). Leia sempre na hora, nunca copie. */
  readonly executor: Executor;
  readonly idDriver: IdDriver;
  machineId: string;
  compartilhado: boolean;
  /** Modo compartilhado: último contato de uma máquina pela ponte HTTP (o varredor de lease fecha o aviso de queda quando ela volta, ADR-045). */
  ultimoContatoDaMaquina(machineId: string): number | null;
  autorizarMaquina(token: string): ReturnType<typeof autorizarChaveMaquina>;
  /** Liga o registry sondado (boot), os snapshots das sondas por driver e quem liga um driver DEPOIS do boot (interruptor). */
  ligarRegistry(registry: Registry, inventarios?: Partial<Record<IdDriver, Inventario>>, ativar?: AtivarDriver): void;
  /** Interruptor de executor (definido em 2026-09-16): estado escrito da máquina e troca em tempo de execução, serializada. */
  estadoExecutor(): EstadoExecutor;
  trocarExecutor(id: IdExecutor): Promise<EstadoExecutor>;
  registry(): Registry | null;
  /** O laço da L4 com os sinks da composição (deltas → barramento; adapter → interruptor). */
  iniciarLaco: IniciarLaco;
  /** Ligação do driver catcher: cada passo vira linha em catcher_registros na tx escopada do turno. */
  aoRegistrarCatcher(r: RegistroCatcher): void;
  tenantDe(pessoaId: string): Promise<string | null>;
  /** ADR-071: o orquestrador das ligações por voz (memória deste processo). */
  voz: ServicoVoz;
  /** NOD-175: a ponte de máquina para de entregar turno novo (drenagem do SIGTERM); renovar e entregar seguem. */
  drenarPonte(): void;
  /** NOD-218: liga o varredor de presença das máquinas (o boot, ao ficar ativo); idempotente. */
  iniciarVarredorMaquinas(intervaloMs?: number): { parar(): Promise<void> };
  /** NOD-218: as conexões SSE abertas — a drenagem recusa as novas e encerra as abertas. */
  sse: ConexoesSse;
  /** NOD-175: `puxar` da ponte de máquina em voo — reserva que ainda pode virar token vivo. */
  reservasEmVoo(): number;
  /** NOD-170: os computadores dos bots, só quando ligados (NOD_COMPUTADORES=docker ou driver injetado); o boot liga o varredor de ociosidade. */
  computadores: Computadores | null;
  /** Liga os dois canais WebSocket da ligação ao servidor HTTP (boot, depois do listen). */
  anexarVoz(server: Server, resolverEscopo: (req: IncomingMessage) => Escopo | null | Promise<Escopo | null>): CanaisVoz;
  fechar(): Promise<void>;
};

/** Escopo da transação corrente (abrirTxEscopada põe no AsyncLocalStorage). Fora de uma tx escopada é erro, nunca default. */
export function escopoDoContexto(): Escopo {
  const ctx = contextoAtual();
  if (!ctx) throw new ErroDeDominio("escopo_vazio", { cause: "serviço chamado fora de uma transação escopada" });
  return { tenantId: ctx.tenantId, pessoaId: ctx.pessoaId };
}

function numero(v: string | undefined, padrao: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : padrao;
}

/** ADR-090: a versão do package.json deste servidor (a que o motor instalado por ele anuncia). */
function versaoDoServidor(): string {
  try {
    return (JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}

/**
 * ADR-121: o OAuth da nuvem usa o mesmo cliente do login (NOD_GOOGLE_CLIENT_*) com outro callback, que precisa estar
 * cadastrado no Google Cloud Console: NOD_NUVEM_REDIRECT_URI, ou <NOD_URL_PUBLICA>/api/nuvem/google/callback.
 */
function oauthNuvem(env: Readonly<Record<string, string | undefined>>) {
  const clientId = env.NOD_GOOGLE_CLIENT_ID;
  const clientSecret = env.NOD_GOOGLE_CLIENT_SECRET;
  const redirectUri = env.NOD_NUVEM_REDIRECT_URI || (env.NOD_URL_PUBLICA ? `${env.NOD_URL_PUBLICA.replace(/\/$/, "")}/api/nuvem/google/callback` : "");
  return clientId && clientSecret && redirectUri ? { clientId, clientSecret, redirectUri } : null;
}

export function comporApp(o: OpcoesCompor): App {
  const { db, env } = o;
  // NOD-164: o modelo da ligação vem do env do servidor. O boot já validou; aqui lança antes de qualquer efeito se
  // alguém compôs sem o boot.
  const modelosLigacao = lerModelosLigacao(env);
  // definido em 2026-10-07 (ADR-082): as mãos do Nod ligadas por padrão; NOD_GERIR_BOTS=0 as tira do catálogo sem deploy de código.
  const semFerramentasDoNod = env.NOD_GERIR_BOTS?.trim() === "0";
  // definido em 2026-10-13 (ADR-104, revisão do PR #309): o mesmo interruptor para o criar_bots dos bots comuns.
  const semCriarBots = env.NOD_CRIAR_BOTS?.trim() === "0";
  const compartilhado = env.NOD_MODO === "compartilhado";
  const relogio: Relogio = o.relogio ?? (() => Date.now());
  const fusoPadrao = env.NOD_FUSO_PADRAO ?? "America/Sao_Paulo";
  // Executor da máquina: nasce de NOD_EXECUTOR e muda pelo interruptor (trocarExecutor). Quem precisa dele lê o valor VIVO
  // (getter/closure), nunca uma cópia — senão a troca pela interface não chega ao plano do turno seguinte.
  // NOD-160: valor desconhecido é 'local' com o claude-cli (que o boot não registra), para o turno cair em
  // executor_indisponivel com o motivo — nunca no catcher, que simularia achando que é a IA.
  const lido = lerNodExecutor(env);
  const pedido = "pedido" in lido ? lido.pedido : null;
  const automatico = pedido === "auto" || (pedido === null && "pedido" in lido && env.NODE_ENV === "production");
  let driverPreferido: IdExecutor = pedido === "codex-cli" ? "codex-cli" : "claude-cli";
  let executorAtual: Executor = compartilhado || automatico || "desconhecido" in lido || pedido === "claude-cli" || pedido === "codex-cli" ? "local" : "catcher";
  const idDriverAtual = (): IdExecutor => (executorAtual === "local" ? driverPreferido : "catcher");
  const IDS_DRIVER: readonly IdExecutor[] = ["catcher", "claude-cli", "codex-cli"];
  const inventarioPorDriver: Partial<Record<IdDriver, Inventario>> = {};
  let ativarDriver: AtivarDriver | null = null;
  let filaDeTrocas: Promise<unknown> = Promise.resolve();
  const machineId = env.NOD_MACHINE_ID ?? "";
  const prazoDecisaoMs = numero(env.NOD_PRAZO_DECISAO_MS, 86_400_000);
  const modeloPadrao = env.NOD_MODELO ?? "auto";
  const chave = chaveDe(env.NOD_CREDENTIAL_KEY ?? "chave-de-desenvolvimento-sem-valor");
  let registryLigado: Registry | null = null;
  let inventarioInicial: Inventario | null = null;
  // medido em 2026-09-16 (e2e:haiku): GET inventario entre o listen e a sonda do boot cacheava 'ausente: servidor ainda
  // sem registry' por 5 min. A sonda agora ESPERA o registry ser ligado em vez de responder um estado provisório.
  let ligarRegistryResolvido: () => void = () => undefined;
  const registryPronto = new Promise<void>((r) => {
    ligarRegistryResolvido = r;
  });

  // NOD_JUNTAR_DELTAS_MS=0 volta a um frame por pedaço de texto (para medir ou isolar um problema).
  const barramento = criarBarramento({ juntarDeltasMs: env.NOD_JUNTAR_DELTAS_MS === undefined ? JUNTAR_DELTAS_MS : Math.max(0, Number(env.NOD_JUNTAR_DELTAS_MS) || 0) });
  const interruptor = criarInterruptor();
  // revisto em 2026-10-12 (NOD-214): o token que falta na memória (o processo é novo, o turno seguiu na máquina durante o
  // deploy) é procurado pelo hash em `turno_credenciais`, no escopo que o token alega, e só vale com o turno ainda
  // despachando. O plano dele volta pelo mesmo caminho do despacho (`recomporPlano`, mais abaixo).
  const tokens = criarTokenTurno({
    agora: relogio,
    buscar: (escopo, hash) =>
      abrirTxEscopada(db, escopo)(async (trx) => {
        const repos = criarRepos(trx, escopo);
        const c = await repos.turnoCredenciais.buscarPorHash(hash);
        if (!c) return null;
        const t = await repos.turnos.buscar(c.turnoId);
        if (!t || t.estado !== "despachando") return null;
        return { turnoId: c.turnoId, tokenHash: c.tokenHash, epoch: c.epoch, identidade: c.identidade, sobreviveReinicio: c.sobreviveReinicio };
      }),
    recompor: (identidade, token) => recomporPlano(identidade, token),
  });

  // tenant de uma pessoa (pessoas é catálogo sem RLS por pessoa); cache com recarga quando não achar.
  const tenants = new Map<string, string>();
  const listar = o.listarPessoas ?? (() => listarTodas(db));
  async function tenantDe(pessoaId: string): Promise<string | null> {
    if (!tenants.has(pessoaId)) for (const p of await listar()) tenants.set(p.id, p.tenantId);
    return tenants.get(pessoaId) ?? null;
  }

  const useCases: UseCasesNod = { lembrar, atualizarPerfil, pedirAcesso, criarRotina, listarRotinasDoAgente, pausarRotinaPeloAgente, reativarRotinaPeloAgente, atualizarRotinaPeloAgente, excluirRotinaPeloAgente, pedirAprovacao, pedirAPessoa, passar, encaminhar, semNovidade, pedirABot, verColegas, publicarArtefato, lerArtefato, iniciarTarefa, desligar, anotarEntrevista, concluirEntrevista, proporBot, abrirTask, mandarParaTask, meChameAs, esperarComando, abrirFrentes, mandarParaFrente, devolverResumo, gerirBots, verAppsConectados, registrarRelatoDoNod, criarBots, responderPedido };

  const depsDe = (trx: Tx, escopo: Escopo): Deps => ({ repos: criarRepos(trx, escopo), services, useCases, tx: (fn) => fn(trx), escopo, agora: relogio, fusoPadrao });
  const depsSobre = (trx: Tx): Deps => depsDe(trx, escopoDoContexto());
  const gravar = async (trx: Tx, events: RuntimeEvent[]): Promise<void> => {
    if (events.length) await criarRepos(trx, escopoDoContexto()).events.gravarComOutbox(events);
  };

  // definido em 2026-10-12 (NOD-212): na transação autenticada, carregar respeita seu escopo e a RLS,
  // mesmo se a pessoa não estiver no catálogo. Aprovações executadas fora da transação mantêm a busca pela dona.
  const donoDoConector = new Map<string, Escopo>();
  /**
   * revisto em 2026-09-24 (ADR-048): o gh roda na MÁQUINA do turno, e só para a dona dela. No modo
   * compartilhado quem diz é o anúncio do app desktop (ponte HTTP, por chave de máquina = pessoa); no
   * modo local o servidor É o Mac, e a dona é quem NOD_DONO_DA_MAQUINA nomeia (e-mail ou id) — sem ela o gh
   * não serve a ninguém, porque o login do gh deste Mac não é de todas as pessoas do cadastro.
   */
  const detectorGh = compartilhado ? null : (o.detectorGh ?? criarDetectorGh({ ambiente: env }));
  let donoLocal: Promise<string | null> | null = null;
  const donoDaMaquinaLocal = (): Promise<string | null> => (donoLocal ??= (async () => {
    const dono = (env.NOD_DONO_DA_MAQUINA ?? "").trim().toLowerCase();
    if (!dono) return null;
    if (/^[0-9a-f-]{36}$/.test(dono)) return dono;
    return (await listarTodas(db)).find((p) => p.email?.toLowerCase() === dono)?.id ?? null;
  })());
  /** ADR-092: a máquina é uma conexão da ponte HTTP desta pessoa (a VM), e não este processo. */
  function maquinaDaPonte(escopo: Escopo, machineId: string): boolean {
    return ponteHttp.maquina(escopo, machineId) !== null;
  }
  async function ghDaPessoa(escopo: Escopo, machineId?: string): Promise<boolean> {
    if (compartilhado) return machineId ? ponteHttp.ghDaMaquina(escopo, machineId) : ponteHttp.ghDaPessoa(escopo.pessoaId);
    // ADR-092: o turno de uma máquina da ponte (a VM) usa o gh dela, nunca o deste Mac.
    if (machineId && maquinaDaPonte(escopo, machineId)) return ponteHttp.ghDaMaquina(escopo, machineId);
    if (!detectorGh || (await donoDaMaquinaLocal()) !== escopo.pessoaId) return false;
    return detectorGh.logado();
  }
  // ADR-048: o App da organização só atende turno de ROTINA (ninguém olhando); em turno interativo, nunca.
  const cofreDoApp = criarCofreDeTokensDoApp<Escopo>({
    agora: relogio,
    async gerar(escopo) {
      const cfg = await txEscopadaOuDoContexto(db, escopo)((trx) => criarRepos(trx, escopo).githubApp.config());
      if (!cfg) return null;
      return criarTokenDeInstalacao({ appId: cfg.appId, instalacaoId: cfg.instalacaoId, chavePem: decifrar(cfg.chavePrivadaCifrada, chave), agora: relogio() });
    },
  });
  async function tokenDoApp(escopo: Escopo): Promise<{ token: string; expiraEm: number } | null> {
    try {
      return await cofreDoApp.token(escopo);
    } catch (e) {
      log("aviso", "github_app_token_falhou", { codigo: e instanceof ErroDeDominio ? e.codigo : "desconhecido" });
      return null;
    }
  }
  // ADR-048: a marca `nod:github` vira o servidor stdio nativo com o jeito DO SERVIDOR escolhido agora
  // (token → Composio → App só em rotina); o resto dos conectores sai como foi registrado.
  async function configDe(conectorId: string, c: Pick<Conector, "slug" | "transporte" | "comando" | "args" | "url">, envDecifrado: Record<string, string>, escopo: Escopo, rotina: boolean): Promise<ConfigConectorVivo | null> {
    if (c.comando !== COMANDO_GITHUB_NATIVO) return { nome: c.slug, transporte: c.transporte, comando: c.comando, args: c.args, url: c.url, env: envDecifrado };
    const r = configGithubNativo({ envConector: envDecifrado, app: rotina ? await tokenDoApp(escopo) : null, rotina, ambiente: env });
    if (!r.ok) {
      log("aviso", "github_sem_jeito", { conector_id: conectorId, rotina });
      return null;
    }
    log("info", "github_jeito_escolhido", { conector_id: conectorId, jeito: r.cfg.jeito, rotina });
    return { nome: c.slug, transporte: "stdio", comando: r.cfg.comando, args: r.cfg.args, url: null, env: r.cfg.env, ...(r.cfg.expiraEm !== undefined ? { expiraEm: r.cfg.expiraEm } : {}) };
  }
  const conectoresVivos = criarConectoresVivos({
    agora: relogio,
    ambiente: env,
    // ADR-068: o nod local está no Mac da pessoa e sobe o arquivo que o bot cita; o compartilhado não o alcança.
    ...(compartilhado ? {} : { subirArquivo: criarSubidaComposio() }),
    // NOD-263: conector chamado com a tx escopada aberta segura uma conexão do pool pelo tempo do app de fora.
    antesDeChamar: exigirForaDaTx,
    async carregar(conectorId, contexto) {
      const atual = contextoAtual();
      const escopos = atual
        ? [{ tenantId: atual.tenantId, pessoaId: atual.pessoaId }]
        : donoDoConector.has(conectorId) ? [donoDoConector.get(conectorId) as Escopo] : (await listar()).map((p) => ({ tenantId: p.tenantId, pessoaId: p.id }));
      for (const escopo of escopos) {
        const c = await txEscopadaOuDoContexto(db, escopo)((trx) => criarRepos(trx, escopo).conectores.buscar(conectorId));
        if (!c) continue;
        const dono = { tenantId: c.tenantId, pessoaId: c.ownerId };
        donoDoConector.set(conectorId, dono);
        const envDecifrado = c.envCifrado ? (JSON.parse(decifrar(c.envCifrado, chave)) as Record<string, string>) : {};
        return configDe(conectorId, c, envDecifrado, dono, contexto.rotina);
      }
      return null;
    },
    async sondarNativo(c) {
      const escopo = { tenantId: c.tenantId, pessoaId: c.ownerId };
      const appConfigurado = (await txEscopadaOuDoContexto(db, escopo)((trx) => criarRepos(trx, escopo).githubApp.config())) !== null;
      return sondaGithubNativa({ ghNaMaquina: await ghDaPessoa(escopo), envChaves: Object.keys(c.env), appConfigurado });
    },
  });
  // O detector aquece no boot: o primeiro pedir_acesso não espera o `gh auth status` dentro da transação.
  if (detectorGh) void detectorGh.logado().catch(() => false);

  // ADR-083: a última ferramenta de cada turno vivo e a memória dos Macs, em memória do processo.
  const trabalhosVivos = criarTrabalhosVivos(relogio);
  /**
   * NOD-279 (C15, definido em 2026-10-15): desligada por padrão; `NOD_FUNDO_LINUX_SO_VERMELHA=1` liga, depois da linha de
   * base da VM, a regra em que a máquina linux só segura o fundo novo por memória ou processador em vermelha (memoria-mac.ts).
   */
  const fundoLinuxSoVermelha = env.NOD_FUNDO_LINUX_SO_VERMELHA === "1";
  const services: Services = {
    trabalhosVivos,
    // A tela fala por máquina (2026-10-09): o nome de cada máquina e se é um Mac. Com o servidor no Mac (ADR-092), a
    // máquina deste processo é "Este Mac" e o turno sem alvo é dela.
    maquinas: {
      leituras: (pessoaId) => trabalhosVivos.porMaquina(pessoaId),
      identificar(escopo, id) {
        if (!compartilhado && id === machineId) return { nome: "Este Mac", ehMac: true };
        const m = ponteHttp.maquina(escopo, id);
        return m ? { nome: m.nome, ehMac: m.plataforma === "darwin" } : null;
      },
      // NOD-279 (C15): a plataforma de cada máquina para o portão da tela (a mesma regra do `puxar`).
      plataforma(escopo, id) {
        if (!compartilhado && id === machineId) return "darwin";
        return ponteHttp.maquina(escopo, id)?.plataforma ?? null;
      },
      fundoLinuxSoVermelha,
      macDoServidor: compartilhado || !machineId ? null : machineId,
      // NOD-260 (G8): conectada = a ponte falou com ela há menos de 60 s (a regra do chip); o Mac do servidor sempre.
      conectada(escopo, id) {
        if (!compartilhado && id === machineId) return true;
        return ponteHttp.maquinasDaPessoa(escopo).some((m) => m.machineId === id);
      },
      // NOD-260 (D3): as IAs prontas nas máquinas vivas da pessoa (a ponte) e, no modo local, as deste Mac.
      iasProntas(pessoaId) {
        const daPonte = Object.entries(ponteHttp.harnessesDaPessoa(pessoaId)).filter(([, i]) => i?.estado === "pronto").map(([h]) => h);
        const desteMac = compartilhado ? [] : HARNESSES.filter((h) => inventarioDe(h.id).estado === "pronto").map((h) => h.id);
        return [...new Set([...daPonte, ...desteMac])];
      },
    },
    relogio,
    tokenTurno: tokens,
    planos: {
      async emitir(trx, turnoId, machineIdDoPlano) {
        const d = depsSobre(trx);
        // ADR-092: no modo local, o turno que uma máquina da ponte puxou (a VM) sai como no compartilhado — as IAs, o gh e
        // o nome DELA e sem as pastas do Mac. O resto roda neste Mac.
        // revisto em 2026-10-15 (ADR-107, NOD-281): com --resume quando a sessão nasceu nesta máquina, nesta IA e nesta
        // conta (sessaoPorMaquina); antes a ponte nunca retomava e cada turno ia com o histórico.
        const daPonte = compartilhado || maquinaDaPonte(d.escopo, machineIdDoPlano);
        const r = await emitirPlanoTurno(d, { turnoId, machineId: machineIdDoPlano, executor: daPonte ? "local" : executorAtual, permitirResume: true, sessaoPorMaquina: daPonte, ghNaMaquina: await ghDaPessoa(d.escopo, machineIdDoPlano),
          harnesses: daPonte ? ponteHttp.harnesses(d.escopo, machineIdDoPlano) : Object.fromEntries(HARNESSES.map((h) => [h.id, inventarioDe(h.id)])),
          harnessPreferido: !daPonte && driverPreferido !== "catcher" ? driverPreferido : null, modelosLigacao, semFerramentasDoNod, semCriarBots,
          maquina: daPonte ? ponteHttp.maquina(d.escopo, machineIdDoPlano) : null, ...(daPonte && !compartilhado ? { maquinaRemota: true } : {}),
          ...(daPonte ? { capacidadesDaMaquina: ponteHttp.capacidadesDaMaquina(d.escopo, machineIdDoPlano) } : {}) });
        if (r.events?.length) await d.repos.events.gravarComOutbox(r.events);
        return r.data;
      },
      buscar: (turnoId) => tokens.planoDe(turnoId),
    },
    rotinas: servicoRotinas(depsSobre, gravar),
    conectores: conectoresVivos,
    interruptor,
    catcher: {
      async registrar(trx, turnoId, tipo, dados) {
        await depsSobre(trx).repos.catcher.registrar({ turnoId, tipo, dados });
      },
    },
    sala: servicoSala(depsSobre, gravar),
    barramento,
  };

  const dentro: DentroDeTx = (escopo, fn) => abrirTxEscopada(db, escopo)((trx) => fn(depsDe(trx, escopo)));
  // NOD-345 (ADR-124): contas atrás de NOD_CONTAS/NOD_BOOTSTRAP/NOD_CONTAS_GOOGLE (compor-contas.ts). Desligadas = null.
  const contas = comporContas({ db, env, dentro, agora: relogio, ...(o.enviadorEmail ? { enviador: o.enviadorEmail } : {}) });

  /**
   * ADR-115 (2026-10-18, plano dos modos de aprovação, PR 3a): o revisor do Automático. A chave `NOD_REVISOR` (ligado ou
   * não) e o modelo (`NOD_MODELO_REVISOR_CLAUDE`) vêm do ambiente; inválido impede o boot. A caixa de pedidos é uma por
   * processo, dividida por todas as pontes e pelas rotas internas; o prazo de cada pedido vira cartão por aqui.
   */
  const configRevisor = lerConfigRevisor(env);
  const caixaRevisoes = criarCaixaRevisoes({
    config: configRevisor,
    agora: relogio,
    pressao: (id) => trabalhosVivos.daMaquina(id),
    async vencer({ escopo, decisaoId, resultado }) {
      try {
        await dentro(escopo, (d) => executar(d, assentarRevisao, { decisaoId, resultado }));
      } catch (e) {
        // A decisão fica `em_revisao`: o varredor de expiração a recolhe em até 2 × o prazo.
        log("erro", "revisao_vencer_falhou", { decisao_id: decisaoId, erro: e instanceof Error ? e.name : "desconhecido" });
      }
    },
  });
  services.revisor = caixaRevisoes;
  log("info", "revisor_modo", { ligado: configRevisor.ligado, modelo: configRevisor.modelo, esforco: configRevisor.esforco ?? null, teto_dia: configRevisor.tetoDia });

  /**
   * definido em 2026-10-12 (NOD-214): o plano do turno adotado depois de um reinício, recomposto pelo emitir do despacho
   * com o token que a máquina já tem e a IA que o despacho escolheu (`turno_credenciais`). null = o turno não está mais
   * despachando ou a credencial sumiu (entregue ou assentado pelo lease enquanto isso).
   */
  async function recomporPlano(identidade: { tenantId: string; pessoaId: string; turnoId: string }, token: string): Promise<PlanoRecomposto | null> {
    const escopo: Escopo = { tenantId: identidade.tenantId, pessoaId: identidade.pessoaId };
    return abrirTxEscopada(db, escopo)(async (trx) => {
      const d = depsDe(trx, escopo);
      const [c, t] = await Promise.all([d.repos.turnoCredenciais.buscar(identidade.turnoId), d.repos.turnos.buscar(identidade.turnoId)]);
      if (!c || !t || t.estado !== "despachando" || !t.machineId) return null;
      const daPonte = compartilhado || maquinaDaPonte(escopo, t.machineId);
      const visto = c.harness ? (daPonte ? ponteHttp.harnesses(escopo, t.machineId)[c.harness] : inventarioDe(c.harness)) : undefined;
      // A máquina já roda esta IA: o inventário que ainda não voltou depois do reinício não a tira do plano.
      const inventario: Inventario = visto?.estado === "pronto" ? visto : { estado: "pronto", versao: "adotado", em: relogio() };
      // revisto em 2026-10-15 (NOD-288): a máquina que ainda não reconectou (servidor recém-reiniciado) dá "não sei"
      // (undefined), não {} — o Codex com terminal não perde o Bash; o plano volta provisório e fica fora do cache.
      const capacidades = daPonte ? ponteHttp.capacidadesDaMaquinaConectada(escopo, t.machineId) : undefined;
      const r = await emitirPlanoTurno(d, {
        turnoId: t.id, machineId: t.machineId, executor: c.executor, permitirResume: false, ghNaMaquina: await ghDaPessoa(escopo, t.machineId),
        harnesses: c.harness ? { [c.harness]: inventario } : undefined, harnessPreferido: c.harness, modelosLigacao, semFerramentasDoNod, semCriarBots,
        maquina: daPonte ? ponteHttp.maquina(escopo, t.machineId) : null, ...(daPonte && !compartilhado ? { maquinaRemota: true } : {}),
        ...(capacidades ? { capacidadesDaMaquina: capacidades } : {}),
        recompor: { tokenDeTurno: token, harness: c.harness },
      });
      return { plano: r.data, provisorio: daPonte && capacidades === undefined };
    });
  }

  // NOD-200: a chave liga o guardador e o serviço juntos; desligada, nada fica em memória e `tomar` é sempre null.
  const capturaNoTranscript = capturaLigada(env);
  const computadores = criarComputadores({ dentro, driver: o.computador ?? criarDriverDocker(env), executor: () => executorAtual, guardarTelas: capturaNoTranscript,
    cifrar: (s) => cifrar(s, chave), decifrar: (s) => decifrar(s, chave),
    // `saude` (emenda da ADR-037): o computador entrou ou saiu do ar — a web relê a frota só nesse caso.
    mudou: (escopo, agenteId, saude) => { barramento.publicar(escopo.pessoaId, "computador.mudou", { agenteId, ...(saude ? { saude: true } : {}) }); } });
  if (o.computador || env.NOD_COMPUTADORES === "docker") services.computadores = computadores;
  services.capturas = criarCapturas({ ligado: capturaNoTranscript, fonte: computadores });
  // definido em 2026-09-18: login web remoto não autoriza o filesystem do host; stub só escuta loopback.
  const workspaces = compartilhado || env.NOD_LOGIN !== "stub" ? undefined : criarWorkspaces({ dentro, machineId, imagem: env.NOD_COMPUTADOR_IMAGEM, ...(env.NOD_BUSCA_BASE ? { baseBusca: env.NOD_BUSCA_BASE } : {}), raiz: join(expandirTil(env.NOD_HOME ?? "~/.nod", homedir()), "workspaces") });
  if (workspaces) services.workspaces = workspaces;
  services.github = {
    // Chamado dentro da tx escopada de quem pede (pedir_acesso, Conectar): o escopo vem do contexto.
    async prontoSemConfiguracao() {
      return (await ghDaPessoa(escopoDoContexto())) ? "gh" : null;
    },
    ...(compartilhado ? {} : {
      // Modo local: o servidor É o Mac, então o item aprovado roda aqui mesmo — só se é da dona dele.
      async executarNaMaquina(escopo: Escopo, capacidade: string, argumentos: Record<string, unknown>) {
        if (!(await ghDaPessoa(escopo))) return null;
        const r = await executarGithubNaMaquina({ capacidade, argumentos, ambiente: env });
        return { conteudo: r.conteudo, isError: r.isError };
      },
    }),
  };

  // Depois de assentar (mesma tx): rotina registra desfecho (L7), peer entrega a resposta (L7).
  /**
   * 0068 (emenda da ADR-036): quando o limite de uma IA de cada pessoa mudou — compartilhado entre todas as pontes (uma
   * por Mac no modo compartilhado), para a fila de todas ler o limite novo na hora; a tela recebe `inventario.mudou`.
   */
  const limitesTrocados = new Map<string, number>();
  const depsPonte: Parameters<typeof criarPonteInterna>[1] = {
    services,
    useCases,
    executor: () => executorAtual,
    agora: relogio,
    // NOD-214: a carência do lease só no compartilhado — no modo local o reinício é o nod fechado (ADR-045).
    ...(compartilhado ? { inicioDoProcesso: o.inicioDoProcesso ?? relogio() } : {}),
    listarPessoas: o.listarPessoas,
    esquecerTurno: (id) => {
      interruptor.esquecer(id);
      trabalhosVivos.esquecerTurno(id);
    },
    // ADR-083: a rede de 2 min só promove quem já chamou ferramenta; a memória do Mac fica em memória do processo.
    fezFerramenta: (id) => trabalhosVivos.ultimaFerramenta(id) !== null,
    registrarMemoria: (pessoaId, machineId, leitura) => trabalhosVivos.registrarMemoria(pessoaId, machineId, leitura),
    pressaoDaMaquina: (machineId) => trabalhosVivos.daMaquina(machineId),
    desfazerMemoria: (pessoaId, mudanca) => trabalhosVivos.desfazer(pessoaId, mudanca),
    esquecerMaquina: (machineId) => trabalhosVivos.esquecerMaquina(machineId),
    usoTrocadoEm: (pessoaId) => trabalhosVivos.usoTrocadoEm(pessoaId),
    limitesTrocadosEm: (pessoaId) => limitesTrocados.get(pessoaId) ?? 0,
    limiteMudou: (pessoaId) => {
      limitesTrocados.set(pessoaId, relogio());
      barramento.publicar(pessoaId, "inventario.mudou", { motivo: "limite" });
    },
    ...(o.redeMs !== undefined ? { redeMs: o.redeMs } : {}),
    fundoLinuxSoVermelha,
    revisoes: caixaRevisoes,
    async depoisDeAssentar(d, { entrega, saida }) {
      const turno = saida.turno;
      if (!turno || saida.tardia) return [];
      const events: RuntimeEvent[] = [];
      // NOD-274: o fundo que parou na cota não falhou — a volta espera a hora (ou a janela já ficou 'nao_rodou'). Gravar
      // "falhou" aqui ou avisar falha a quem pediu desmentiria a linha "espera e volta sozinho".
      if (saida.esperaDaCota) return [];
      // NOD-258: o retorno do lote que caiu é refeito uma vez (e, na segunda, a linha diz onde ficaram os resumos).
      // A regra (só o interrompido, sem Parar; o concluído marca o lote entregue, NOD-309) fica em refazerRetornoDoLote.
      events.push(...(await refazerRetornoDoLote(d, turno)));
      // A rotina (ou a retomada dela) registra o desfecho da janela; a regra mora em registrarDesfechoDaEntrega (NOD-251;
      // NOD-245: o turno adotado que o reinício do servidor derrubou também fica de fora, como o da máquina sem contato).
      events.push(...(await registrarDesfechoDaEntrega(d, turno)));
      // definido em 2026-09-24 (ADR-047): a tarefa delegada (e a retomada dela, depois de um acesso aprovado)
      // também devolve o resultado ao remetente; entregarRespostaPeer segue a cadeia e ignora o resto.
      if ((turno.origem === "peer" || turno.origem === "delegacao" || turno.origem === "retomada") && turno.estado === "concluido" && entrega.fala.tipo === "texto" && entrega.fala.texto.trim() !== "") {
        const r = await entregarRespostaPeer(d, { tarefaId: turno.id, texto: entrega.fala.texto });
        // NOD-256 (F1.1): o ignorado "quem_pediu_parado" ainda grava a peer_ask e traz o evento dela; os outros não trazem.
        events.push(...(r.events ?? []));
      } else if ((turno.origem === "delegacao" || (turno.origem === "retomada" && turno.sobProcuracaoDe)) && !(await repetidoSemResume(d, turno.id))) {
        // ADR-107 (NOD-281, critério 4): a retomada recusada pelo CLI que já voltou à fila sem resume não avisa falha.
        // Revisão da ADR-047: tarefa delegada que parou ou terminou calada avisa o remetente (uma vez por raiz).
        const motivo = turno.estado === "interrompido" ? motivoEmPortugues(turno.motivoFalha ?? turno.motivoInterrupcao ?? "sem_progresso") : "terminou sem resposta";
        const r = await avisarFalhaDelegacao(d, { turnoId: turno.id, motivo });
        events.push(...(r.events ?? []));
      }
      return events;
    },
  };

  // ADR-108 (revisão do PR 2, C5): as IAs prontas nas máquinas da ponte HTTP (as VMs, no modo local) contam por máquina.
  const ponte = criarPonteInterna(db, { ...depsPonte, prontosPorMaquina: (pessoaId) => ponteHttp.prontosPorMaquinaDaPessoa(pessoaId) });
  const autorizarMaquina = (token: string) => autorizarChaveMaquina(db, token, relogio());
  // ADR-102 (2026-10-13): os logins de contas pela tela e o pareamento por código/convite (em memória, src/services).
  const logins = criarLoginsNaMaquina(relogio);
  const dispositivo = criarPareamentoDispositivo(relogio);
  // NOD-94 (emenda 11 da ADR-090): os pedidos de instalação da máquina só computador por SSH (em memória; só compartilhado).
  const instalacoes = criarInstalacoesPorSsh(relogio);
  /** A máquina nova pareou com o convite de um pedido: ele fica `pronta` e o endereço (com a host key) é guardado. */
  const pareadaPorConvite = async (e: { escopo: Escopo; convite: string; maquinaId: string }) => {
    const r = instalacoes.pareada(e.escopo, e.convite, e.maquinaId);
    if (!r) return;
    log("info", "instalacao_ssh_pronta", { pessoa_id: e.escopo.pessoaId, instalacao_id: r.id, maquina_id: e.maquinaId });
    // Sem impressão (a instaladora não relatou) ou sem usuário (modo apelido): não há o que travar na reinstalação.
    if (r.impressao && r.usuario) {
      const { impressao, usuario } = r;
      await dentro(e.escopo, (d) => d.repos.maquinasSsh.registrar({ maquinaId: e.maquinaId, host: r.host, porta: r.porta, usuario, impressaoHost: impressao }, d.agora()));
    }
  };
  // NOD-253 (2026-10-15): a lista mudou (ordem, modo, "Seguir com", conta logada ou saída) — a fila de todas as pontes relê
  // a cota por conta na hora, em vez de esperar os 30 s do LIMITES_VALEM_MS.
  const avisarContas = (escopo: Escopo, motivo: string, loginId?: string) => {
    if (motivo !== "login") limitesTrocados.set(escopo.pessoaId, relogio());
    barramento.publicar(escopo.pessoaId, "contas.mudou", { motivo, ...(loginId ? { loginId } : {}) });
  };
  /**
   * ADR-092: no modo local a ponte HTTP também fica de pé, para as máquinas Linux da pessoa (o motor da ADR-090) — o Mac
   * continua rodando os bots neste processo. A máquina da ponte só pega o turno que tem ELA como alvo, roda sempre a IA
   * real ('local') e não mexe no que é do Mac: o inventário persistido por pessoa (é o do Mac, que o gate pré-spawn lê), as
   * falas barradas por falta de IA no Mac, os itens do gh (rodam aqui mesmo) e a sessão do CLI da conversa.
   */
  const ponteHttp = criarPonteHttpServidor({
    criar: (escopo) => criarPonteInterna(db, { ...depsPonte, erroCruNoLog: false, listarPessoas: async () => [{ id: escopo.pessoaId, tenantId: escopo.tenantId }], harnessesDaPessoa: (pessoaId) => ponteHttp.harnessesDaPessoa(pessoaId),
      prontosPorMaquina: (pessoaId) => ponteHttp.prontosPorMaquinaDaPessoa(pessoaId),
      // NOD-301: no compartilhado, a máquina sem conta livre deixa passar o turno sem alvo para outra com conta livre.
      ...(compartilhado ? { declinarSemAlvo: true } : { executor: "local" as const, soComoAlvo: true }) }),
    persistir: compartilhado ? (escopo, inv) => dentro(escopo, async (d) => { await d.repos.inventario.registrar("claude-cli", inv); }) : async () => undefined,
    ...(compartilhado ? {} : { descartarSessao: true }),
    // ADR-090 (0067): nos dois modos — no local, a VM também cai, e o aviso a nomeia.
    registrarPlataforma: (escopo, chaveId, plataforma) => dentro(escopo, (d) => d.repos.maquinaTokens.registrarPlataforma(chaveId, plataforma)),
    nomeDaChave: (escopo, chaveId) => dentro(escopo, async (d) => (await d.repos.maquinaTokens.identificar(chaveId))?.nome ?? null),
    ...(contas ? { sessaoDaMaquina: async (escopo: Escopo, chaveId: string) => contas.sessaoDaMaquina(escopo, chaveId, await dentro(escopo, async (d) => (await d.repos.maquinaTokens.identificar(chaveId))?.nome ?? null)) } : {}),
    papelDaChave: (escopo, chaveId) => dentro(escopo, async (d) => (await d.repos.maquinaTokens.identificar(chaveId))?.papel ?? null),
    // NOD-300: "presenca" quando uma máquina perde ou recupera o contato (o varrer da ponte).
    inventarioMudou: (escopo, motivo) => { barramento.publicar(escopo.pessoaId, "inventario.mudou", { motivo: motivo ?? "anuncio" }); },
    autorizar: autorizarMaquina,
    segredo: segredoEfetivo(env.NOD_LOGIN === "google" ? "google" : "stub", env.NOD_SESSAO_SEGREDO),
    seguro: env.NOD_LOGIN === "google",
    agora: relogio,
    delta: (plano, texto) => publicarDoPlano(plano, "turno.delta", { texto }),
    ferramenta: (plano, nome) => publicarDoPlano(plano, "turno.atividade", { nome, rotulo: rotuloFerramenta(nome) }),
    tarefas: (plano, tarefas) => publicarDoPlano(plano, "turno.tarefas", { tarefas }),
    subagentes: (plano, subagentes, principalOcioso) => publicarDoPlano(plano, "turno.subagentes", { subagentes, principalOcioso: principalOcioso === true }),
    fala: (plano) => publicarDoPlano(plano, "turno.fala", {}),
    vigia: (plano, aviso) => avisoDoVigia(plano, aviso),
    longpollMs: env.NOD_LONGPOLL_MS ? numero(env.NOD_LONGPOLL_MS, 20_000) : undefined,
    // ADR-048: itens aprovados que rodam no gh do Mac da dona — a máquina puxa, executa e relata. No modo local o item roda
    // neste Mac na hora (executarNaMaquina) e nenhuma máquina da ponte o puxa (ADR-092).
    // definido em 2026-10-05: uma IA ficou pronta no Mac — as falas barradas por falta de IA são repetidas sozinhas. No modo
    // local quem barra é a IA deste Mac, não a da VM (ADR-092).
    ...(compartilhado ? {
      itensLocais: (escopo: Escopo) => dentro(escopo, (d) => itensParaAMaquina(d)),
      repetirBarrados: (escopo: Escopo, prontos: readonly IdHarness[]) => dentro(escopo, async (d) => {
        const r = await repetirBarradosPorIa(d, { executor: "local", prontos });
        if (r.events?.length) await d.repos.events.gravarComOutbox(r.events);
      }),
    } : {}),
    concluirItemLocal: (escopo, itemId, desfecho) => dentro(escopo, async (d) => {
      const r = await concluirItemNaMaquina(d, { itemId, desfecho });
      if (r.events.length) await d.repos.events.gravarComOutbox(r.events);
    }),
    // NOD-94: a instalação por SSH é do modo compartilhado (no local, ADR-092, a opção não aparece).
    ...(compartilhado ? { instalacoes: {
      puxada: (escopo: Escopo, chaveId: string, e: { chavePublica: string; plataforma: PlataformaMaquina }) => {
        instalacoes.anunciarInstaladora(escopo, chaveId, e);
        return instalacoes.pendentes(escopo, chaveId);
      },
      progresso: async (escopo: Escopo, chaveId: string, p: ProgressoDeInstalacao) => {
        const r = instalacoes.progresso(escopo, chaveId, p);
        // Nunca as linhas do script nem a impressão no log: só o id, a etapa e o motivo.
        log(r.aceito ? "info" : "aviso", r.aceito ? "instalacao_ssh_progresso" : "instalacao_ssh_progresso_recusado", { machine_id: chaveId, instalacao_id: p.id, etapa: p.etapa ?? null, erro: p.erro ?? null });
        return r.aceito;
      },
    } } : {}),
    // ADR-102: as contas da pessoa são do modo compartilhado (suposição 7: o modo local fica com a tela da ADR-101).
    ...(compartilhado ? { contas: {
      anunciar: async (escopo: Escopo, chaveId: string, anunciadas: ContaAnunciada[]) => {
        const r = await dentro(escopo, (d) => anunciarContasDaMaquina(d, chaveId, anunciadas));
        if (r.mudou) avisarContas(escopo, "anuncio");
      },
      puxada: async (escopo: Escopo, chaveId: string): Promise<PuxadaDeContas> => {
        const sair = await dentro(escopo, (d) => d.repos.contasIa.saidasPendentes(chaveId));
        // NOD-9 (definido em 2026-10-22): o pedido de atualizar sai uma vez, na puxada seguinte ao clique.
        const atualizar = logins.atualizacoesPedidas(escopo, chaveId);
        return { logins: logins.pendentes(escopo, chaveId), sair, desconectar: logins.desconexaoPedida(escopo, chaveId), ...(atualizar.length ? { atualizar } : {}) };
      },
      progresso: async (escopo: Escopo, chaveId: string, p: ProgressoDoLogin) => {
        const r = logins.progresso(escopo, chaveId, p);
        if (!r.aceito) {
          log("aviso", "login_progresso_recusado", { machine_id: chaveId, login_id: p.loginId, fase: p.fase });
          return false;
        }
        if (p.fase === "pronto" && p.impressao) {
          const conta = await dentro(escopo, async (d) => (await d.repos.contasIa.listar()).contas.find((c) => c.impressao === p.impressao && c.removidaEm === null) ?? null);
          if (conta) logins.ligarConta(escopo, p.loginId, conta.id);
        }
        log("info", "login_na_maquina", { machine_id: chaveId, login_id: p.loginId, fase: p.fase, erro: p.erro ?? null });
        avisarContas(escopo, "login", p.loginId);
        return true;
      },
      saiu: async (escopo: Escopo, chaveId: string, impressoes: string[], desconectada: boolean) => {
        await dentro(escopo, async (d) => {
          await d.repos.contasIa.saiu(chaveId, impressoes);
          // "Desconectar com sair das contas": a máquina confirmou — agora a chave dela é revogada. Pelo removerMaquina (A7,
          // QA): o aviso "sem contato" em curso dela sai dispensado, como no revogar da tela, e não fecha como "voltou".
          if (desconectada && logins.concluirDesconexao(escopo, chaveId)) await removerMaquina(d, chaveId);
        });
        avisarContas(escopo, "saiu");
      },
    } } : {}),
  });

  // ---- Ligação por voz (definido em 2026-10-04, ADR-071/072) ----------------------------------------------------------
  // NOD_LIGACAO: desligada | admins | todas. Padrão: todas fora de produção; em produção, só admins (fase 1, atrás de flag).
  const modoLigacao = env.NOD_LIGACAO ?? (env.NODE_ENV === "production" ? "admins" : "todas");
  const adminsVoz = (env.NOD_ADMINS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const maxLigacaoS = numero(env.NOD_LIGACAO_MAX_S, 30 * 60);
  const limiteDiarioMs = numero(env.NOD_LIGACAO_MINUTOS_DIA, 60) * 60_000;
  const maxSimultaneas = numero(env.NOD_LIGACAO_SIMULTANEAS, 20);
  // Voz mal configurada nunca derruba o servidor: a ligação fica indisponível ("voz fora do ar") e o resto segue.
  let vozConfigurada = true;
  let provedoresVoz: ProvedoresVoz;
  try {
    provedoresVoz = o.voz ?? criarProvedoresVoz(env);
  } catch (e) {
    vozConfigurada = false;
    log("erro", "voz_nao_configurada", { erro: e instanceof Error ? e.name : "desconhecido" });
    provedoresVoz = criarProvedoresVoz({ NOD_VOZ_STT: "falso", NOD_VOZ_TTS: "falso" });
  }
  const esperasVoz = criarCacheDeFalas({ tts: provedoresVoz.tts, provedor: provedoresVoz.tts.id, diretorio: env.NOD_VOZ_CACHE });
  const escopoDaRef = (ref: RefLigacao): Escopo => ({ tenantId: ref.tenantId, pessoaId: ref.pessoaId });
  const rodarCaso = <I, O>(escopo: Escopo, caso: (d: Deps, i: I) => Promise<{ data: O; events?: RuntimeEvent[] }>, input: I): Promise<O> =>
    abrirTxEscopada(db, escopo)(async (trx) => {
      const d = depsDe(trx, escopo);
      const r = await caso(d, input);
      if (r.events?.length) await d.repos.events.gravarComOutbox(r.events);
      return r.data;
    });
  const persistenciaVoz: PersistenciaVoz = {
    async atender(ref) { await rodarCaso(escopoDaRef(ref), atenderLigacao, { ligacaoId: ref.ligacaoId }); },
    async gravarFala(ref, f) { await rodarCaso(escopoDaRef(ref), gravarFalaLigacao, { ...f, ligacaoId: ref.ligacaoId }); },
    async encerrar(ref, motivo, metricas) {
      inscricoesVoz.get(ref.ligacaoId)?.();
      inscricoesVoz.delete(ref.ligacaoId);
      decisoesDeForaDaLigacao.delete(ref.ligacaoId);
      await rodarCaso(escopoDaRef(ref), encerrarLigacao, { ligacaoId: ref.ligacaoId, motivo, metricas });
    },
    async mandarNoChat(ref, texto) { await rodarCaso(escopoDaRef(ref), mandarNoChatDaLigacao, { ligacaoId: ref.ligacaoId, agenteId: ref.agenteId, conversaId: ref.conversaId, turnoId: ref.turnoId, texto }); },
    // ADR-077: a etapa e os campos do onboarding, para o painel, a pílula e os chips da ligação de onboarding.
    async estadoOnboarding(ref) { return rodarCaso(escopoDaRef(ref), estadoOnboardingParaVoz, {}); },
  };
  // Rede de segurança da ligação (2026-10-05): as IAs do Mac da pessoa, pelo inventário anunciado (catalogoHarness).
  // Com NOD_LIGACAO_CODEX=0 o Codex não atende ligação neste servidor: fica fora da lista, e o aviso não o oferece.
  const iasDoMacParaVoz = (pessoaId: string): EstadoIaDaLigacao[] =>
    catalogoHarness(pessoaId).opcoes.flatMap((h) => (ehIaDaLigacao(h.id) && !(h.id === "codex-cli" && env.NOD_LIGACAO_CODEX === "0") ? [estadoIaDaLigacao(h.id, h.inventario)] : []));
  /**
   * definido em 2026-10-10 (emenda da ADR-078): no limite da assinatura, a ligação continua sozinha pela outra IA pronta —
   * o mesmo caminho do `POST ligacoes/:id/continuar` (rotas/ligacoes.ts): um turno-cérebro novo e o `reabrirCerebro`.
   */
  async function continuarLigacaoCom(ref: RefLigacao, ia: IaDaLigacao): Promise<boolean> {
    const escopo = escopoDaRef(ref);
    const iasProntas = !compartilhado && executorAtual === "catcher" ? null : iasDoMacParaVoz(ref.pessoaId).filter((i) => i.estado === "pronto").map((i) => i.id);
    const r = await rodarCaso(escopo, reabrirCerebroDaLigacao, { ligacaoId: ref.ligacaoId, ia, iasProntas, executor: executorAtual });
    if (voz.reabrirCerebro({ pessoaId: ref.pessoaId, ligacaoId: ref.ligacaoId, turnoId: r.turno.id, ia })) return true;
    // A ligação acabou entre a conferência e o commit: o turno recém-criado sai da fila em vez de ficar órfão.
    await rodarCaso(escopo, cancelarTurno, { turnoId: r.turno.id }).catch(() => undefined);
    return false;
  }
  const voz = criarServicoVoz({ provedores: provedoresVoz, persistencia: persistenciaVoz, esperas: esperasVoz, relogio, iasDoMac: (ref) => iasDoMacParaVoz(ref.pessoaId), continuarCom: continuarLigacaoCom });
  // ADR-074: os cards da conversa da ligação viram leitura + janela de aprovação por voz. O orquestrador não lê banco:
  // a composição escuta os frames da pessoa e monta a leitura (leituraDaDecisao) numa tx dela.
  const inscricoesVoz = new Map<string, () => void>();
  const decididasPorVoz = new Set<string>();
  /** ADR-077: as decisões de fora da conversa da ligação que ela acompanha (o acesso e a rotina do bot novo do onboarding). */
  const decisoesDeForaDaLigacao = new Map<string, Set<string>>();
  function lerParaVoz(escopo: Escopo, ligacaoId: string, decisaoId: string, soDoBotDoOnboarding = false): void {
    rodarCaso(escopo, leituraDaDecisao, { decisaoId, soDoBotDoOnboarding })
      .then((p) => {
        if (!p) return;
        if (soDoBotDoOnboarding) decisoesDeForaDaLigacao.get(ligacaoId)?.add(decisaoId);
        voz.pedirAprovacao(ligacaoId, p);
      })
      .catch((e: unknown) => log("aviso", "voz_leitura_falhou", { ligacao_id: ligacaoId, erro: e instanceof Error ? e.name : "desconhecido" }));
  }
  function acompanharDecisoes(escopo: Escopo, ligacaoId: string, conversaId: string, onboarding = false): void {
    if (onboarding) decisoesDeForaDaLigacao.set(ligacaoId, new Set());
    // Ao ligar, as pendências da conversa entram na fila de leitura.
    dentro(escopo, (d) => d.repos.decisoes.listarSuaVez(relogio()))
      .then((ds) => { for (const x of ds) if (x.conversaId === conversaId) lerParaVoz(escopo, ligacaoId, x.id); })
      .catch(() => undefined);
    const sair = barramento.inscrever(escopo.pessoaId, (f) => {
      if (f.dados.conversaId !== conversaId) {
        // ADR-077: no onboarding, o card do bot novo (na conversa dele) também se lê e se decide por voz.
        const de = decisoesDeForaDaLigacao.get(ligacaoId);
        const id = typeof f.dados.decisao_id === "string" ? f.dados.decisao_id : typeof f.dados.decisaoId === "string" ? f.dados.decisaoId : null;
        if (!de || !id) return;
        if (f.tipo === "decisao.nova") lerParaVoz(escopo, ligacaoId, id, true);
        else if (f.tipo === "decisao.decidida" && de.has(id) && !decididasPorVoz.has(id)) voz.decisaoDecidida(ligacaoId, { decisaoId: id, resultado: f.dados.recusada === true ? "recusado" : "decidido", porVoz: false });
        return;
      }
      // Rede de segurança (2026-10-05): o turno-cérebro desta ligação terminou com ela viva — a ligação avisa e espera a escolha.
      if ((f.tipo === "turno.encerrado" || f.tipo === "turno.interrompido") && typeof f.dados.turnoId === "string"
        && voz.cerebroTerminou(ligacaoId, { turnoId: f.dados.turnoId, sucesso: f.tipo === "turno.encerrado", motivo: typeof f.dados.motivo === "string" ? f.dados.motivo : null, causaSemIa: typeof f.dados.causa_sem_ia === "string" ? f.dados.causa_sem_ia : null, ia: typeof f.dados.harness === "string" ? f.dados.harness : null })) return;
      // ADR-072: tarefa pedida na ligação (iniciar_tarefa) terminou — o bot avisa falando, numa brecha.
      if ((f.tipo === "turno.encerrado" || f.tipo === "turno.interrompido") && typeof f.dados.turnoId === "string" && f.dados.origem !== "ligacao") {
        rodarCaso(escopo, resultadoDaTarefaDaLigacao, { turnoId: f.dados.turnoId, ligacaoId })
          .then((r) => {
            if (!r) return;
            const corpo = neutralizarDelimitadores(r.texto).replace(/\[nod\]/gi, "[n o d]");
            voz.nota(ligacaoId, r.concluido ? `A tarefa que você iniciou na ligação terminou. Conte à pessoa em uma ou duas frases. Resultado:\n${corpo}` : `A tarefa que você iniciou na ligação parou antes de terminar (${corpo}). Conte à pessoa em uma frase.`, r.confiavel, true);
          })
          .catch(() => undefined);
        return;
      }
      const decisaoId = typeof f.dados.decisao_id === "string" ? f.dados.decisao_id : typeof f.dados.decisaoId === "string" ? f.dados.decisaoId : null;
      if (!decisaoId) return;
      if (f.tipo === "decisao.nova") lerParaVoz(escopo, ligacaoId, decisaoId);
      else if (f.tipo === "decisao.decidida" && !decididasPorVoz.has(decisaoId)) voz.decisaoDecidida(ligacaoId, { decisaoId, resultado: f.dados.recusada === true ? "recusado" : "decidido", porVoz: false });
    });
    inscricoesVoz.set(ligacaoId, sair);
  }
  // Prévia da voz do bot (Editar perfil, Ajustes da ligação): uma frase pelo provedor das ligações, em memória.
  const amostras = new Map<string, Promise<Buffer | null>>();
  function amostraDeVoz(idVoz: string, velocidade: number): Promise<Buffer | null> {
    const vozNod = VOZES_NOD.find((v) => v.id === idVoz);
    if (!vozNod || !(VELOCIDADES_VOZ as readonly number[]).includes(velocidade)) return Promise.resolve(null);
    const chave = `${idVoz}:${velocidade}`;
    let p = amostras.get(chave);
    if (!p) {
      p = (async () => {
        const pedacos: Int16Array[] = [];
        for await (const pcm of provedoresVoz.tts.sintetizar({ texto: `Oi! Esta é a voz ${vozNod.nome}. É assim que eu falo nas ligações.`, voz: idVoz, velocidade, prioridade: "previa" })) pedacos.push(pcm);
        return montarWav(concatenar(pedacos), 24_000);
      })().catch((e: unknown) => {
        amostras.delete(chave);
        log("aviso", "voz_amostra_falhou", { erro: e instanceof Error ? e.name : "desconhecido" });
        return null;
      });
      amostras.set(chave, p);
    }
    return p;
  }
  // Ouvir as respostas (definido em 2026-10-06, NOD-180): desligado por padrão; NOD_VOZ_LEITURA=1 liga. Segue a mesma
  // abertura das ligações (NOD_LIGACAO) e o mesmo provedor; o teto diário e a janela à frente vêm das envs.
  const leituraHabilitada = env.NOD_VOZ_LEITURA === "1";
  const leitor = criarLeitorDeVoz({
    tts: provedoresVoz.tts,
    caracteresPorDia: lerInteiroDaLeitura("NOD_VOZ_LEITURA_CARACTERES_DIA", env.NOD_VOZ_LEITURA_CARACTERES_DIA, CARACTERES_DIA_PADRAO),
    adianteMs: lerInteiroDaLeitura("NOD_VOZ_LEITURA_ADIANTE_MS", env.NOD_VOZ_LEITURA_ADIANTE_MS, ADIANTE_MS_PADRAO),
  });
  async function contextoLeitura(escopo: Escopo): Promise<ContextoLeitura> {
    return {
      habilitada: leituraHabilitada,
      permitido: leituraHabilitada && (modoLigacao === "todas" || (modoLigacao === "admins" && (await ehAdminVoz(escopo)))),
      vozDisponivel: vozConfigurada,
    };
  }
  // Ditado no campo de mensagem (definido em 2026-10-11, ADR-095): NOD_DITADO desligado | admins | todos, padrão todos
  // (custa centavos por minuto e não toca o Mac). Usa o STT das ligações; a voz mal configurada tira o microfone do
  // campo, e o provedor `falso` em produção também (ele inventaria o texto).
  const modoDitado = env.NOD_DITADO ?? "todos";
  const ditado = criarServicoDitado({ transcritor: provedoresVoz.stt, relogio });
  async function contextoDitado(escopo: Escopo): Promise<ContextoDitado> {
    return {
      habilitado: modoDitado !== "desligado",
      permitido: modoDitado === "todos" || (modoDitado === "admins" && (await ehAdminVoz(escopo))),
      vozDisponivel: vozConfigurada && !(env.NODE_ENV === "production" && provedoresVoz.stt.id === "falso"),
    };
  }
  function anexarDitado(escopo: Escopo, canal: CanalVoz): void {
    contextoDitado(escopo)
      .then((contexto) => dentro(escopo, (d) => autorizarDitado(d, { contexto })))
      .then(({ data: r }) => (r.ok ? ditado.abrir({ pessoaId: escopo.pessoaId, canal, vocabulario: r.vocabulario }) : ditado.recusar(canal, r.codigo)))
      .catch((e: unknown) => {
        log("aviso", "voz_ditado_autorizar_falhou", { erro: e instanceof Error ? e.name : "desconhecido" });
        ditado.recusar(canal, "falhou");
      });
  }
  async function ehAdminVoz(escopo: Escopo): Promise<boolean> {
    if (adminsVoz.length === 0) return false;
    if (adminsVoz.includes(escopo.pessoaId.toLowerCase())) return true;
    const email = (await dentro(escopo, (d) => d.repos.pessoas.buscar(escopo.pessoaId)))?.email?.toLowerCase();
    return !!email && adminsVoz.includes(email);
  }
  /** Início do dia em São Paulo (UTC−3, sem horário de verão desde 2019), para o limite diário. */
  const inicioDoDiaSp = (agora: number): number => {
    const fuso = 3 * 3_600_000;
    return Math.floor((agora - fuso) / 86_400_000) * 86_400_000 + fuso;
  };
  /** NOD-167: no modo local, a mesma regra de `semLacoDeVozDaPessoa` sobre as máquinas da ponte interna. */
  function semLacoDeVozLocal(harness: IdHarness): boolean {
    const maquinas = ponte.maquinasConectadas().filter((m) => m.ligacao === true && m.harnesses?.[harness]?.estado === "pronto");
    return maquinas.length > 0 && maquinas.every((m) => m.semLacoDeVoz?.includes(harness) === true);
  }
  async function contextoLigacao(escopo: Escopo, agenteId: string, onboarding = false): Promise<ContextoLigacao> {
    const [agente, preferencias] = await dentro(escopo, (d) => Promise.all([d.repos.agentes.buscar(agenteId), d.repos.preferencias.buscar()]));
    const prontos = compartilhado ? ponteHttp.harnessesDaPessoa(escopo.pessoaId) : null;
    // revisto em 2026-10-10 (emenda da ADR-036): o bot no Automático liga pela IA que o turno usaria — a primeira pronta da
    // ordem dele (ou da pessoa) fora do limite —, não pelo harness padrão do servidor (o Codex pronto e o Claude não
    // diziam "IA fora" no caso do Breno).
    const doAutomatico = (): IdHarness | null => {
      if (!agente) return null;
      const i = inteligenciaDoAgente(agente);
      const pronta = (h: IdHarness) => (compartilhado ? prontos?.[h]?.estado : inventarioPorDriver[h as IdDriver]?.estado) === "pronto";
      return iaDoAutomatico({ ordem: ordemEfetiva({ doBot: i.ordem, daPessoa: preferencias.ordemIas ?? null, preferido: compartilhado ? null : driverPreferido === "catcher" ? null : driverPreferido }), prontos: HARNESSES.map((h) => h.id).filter(pronta), noLimite: iasNoLimite(preferencias.iasNoLimite, relogio()) });
    };
    const harness = agente?.harness && agente.harness !== "auto" ? agente.harness : doAutomatico() ?? driverPreferido;
    const iaPronta = executorAtual === "catcher" ? true : compartilhado ? prontos?.[harness as IdDriver & keyof typeof prontos]?.estado === "pronto" : inventarioPorDriver[harness as IdDriver]?.estado === "pronto";
    return {
      habilitada: modoLigacao !== "desligada",
      // ADR-077: NOD_ONBOARDING_VOZ=1 abre a ligação de onboarding (a da guia) mesmo com as ligações só para admins.
      permitido: modoLigacao === "todas" || (onboarding && env.NOD_ONBOARDING_VOZ === "1") || (modoLigacao === "admins" && (await ehAdminVoz(escopo))),
      maquinaComLigacao: compartilhado ? ponteHttp.ligacaoDaPessoa(escopo.pessoaId) : ponte.maquinasConectadas().some((m) => m.ligacao === true),
      iaPronta,
      // ADR-076 (fase 4): o laço de voz do Codex é o app-server (drivers/codex-ligacao.ts). Liga por padrão;
      // NOD_LIGACAO_CODEX=0 é a chave de desligar (o app-server é experimental na OpenAI).
      codexSemVoz: executorAtual !== "catcher" && harness === "codex-cli" && env.NOD_LIGACAO_CODEX === "0",
      // NOD-167: o Mac disse que esta IA não roda o laço de voz (o Codex sem `app-server`): recusa própria, antes de tocar.
      iaSemLacoDeVoz: executorAtual !== "catcher" && (compartilhado
        ? ponteHttp.semLacoDeVozDaPessoa(escopo.pessoaId, harness as IdHarness)
        : semLacoDeVozLocal(harness as IdHarness)),
      drenando: voz.drenando(),
      vozDisponivel: vozConfigurada,
      vivasNoServidor: voz.vivas(),
      // NOD-218: a cor deste processo no azul/verde; o boot da outra cor não fecha esta ligação.
      instancia: env.NOD_COR || null,
      maxSimultaneas,
      limiteDiarioMs,
      inicioDoDia: inicioDoDiaSp(relogio()),
      provedorStt: provedoresVoz.stt.id,
      provedorTts: provedoresVoz.tts.id,
      leituraHabilitada,
    };
  }

  // ADR-092: também no modo local, para as máquinas da ponte (a VM) saírem da lista quando param de falar.
  // revisto em 2026-10-22 (NOD-218): virou laço que o boot liga ao ficar ativo (a cor passiva não conhece as máquinas e
  // as tiraria da lista) e que a drenagem para, esperando a varredura em voo.
  let varredorMaquinas: { parar(): Promise<void> } | null = null;
  const iniciarVarredorMaquinas = (intervaloMs = 15_000): { parar(): Promise<void> } => {
    if (varredorMaquinas) return varredorMaquinas;
    let emVoo: Promise<unknown> | null = null;
    const timer = setInterval(() => {
      if (emVoo) return;
      emVoo = ponteHttp
        .varrer()
        .catch(() => log("aviso", "presenca_maquinas_falhou", {}))
        .finally(() => {
          emVoo = null;
        });
    }, intervaloMs);
    timer.unref();
    varredorMaquinas = {
      async parar() {
        clearInterval(timer);
        if (emVoo) await emVoo;
      },
    };
    return varredorMaquinas;
  };
  const conexoesSse = criarConexoesSse();

  // ADR-121 (NOD-92): a máquina na nuvem que dorme e acorda pelo Google. A flag é lida SÓ aqui: sem ela, as rotas não
  // existem (404), o reconciliador não sobe e o MaquinaDto sai sem `nuvem`.
  const nuvemLigada = env.NOD_MAQUINA_NUVEM?.trim() === "gcp";
  // O provedor com a chave da conta de serviço (decifrada só aqui, nunca em log). Em teste, o falso injetado.
  const provedorDaChave = (cifrada: string | null): ProvedorNuvem => {
    if (o.nuvem?.provedor) return o.nuvem.provedor;
    if (!cifrada) throw new ErroNuvemLancado({ motivo: "credencial_nuvem", detalhe: "sem_chave" });
    return criarProvedorGcp({ chaveJson: decifrar(cifrada, chave) });
  };
  // PR 2 (criar a VM): o script de início baixa o motor de NOD_URL_PUBLICA; sem ela, criar responde integracao_nao_configurada.
  const urlPublica = env.NOD_URL_PUBLICA?.trim().replace(/\/$/, "") ?? "";
  // Revisão item 9: endereço inválido (com caminho, maiúsculas, espaço) desliga a criação já ao subir, com log.
  const urlPublicaValida = urlPublica !== "" && servidorPublicoValido(urlPublica);
  if (nuvemLigada && urlPublica !== "" && !urlPublicaValida) log("erro", "nuvem_url_publica_invalida", {});
  const criacaoNuvem = urlPublicaValida
    ? { servidor: urlPublica, decifrar: (s: string) => decifrar(s, chave), registrarConvite: dispositivo.registrarConviteNuvem.bind(dispositivo) }
    : undefined;
  const reconciliadorNuvem = nuvemLigada
    ? iniciarReconciliadorNuvem({
        db,
        agora: relogio,
        provedorDa: async (escopo, tx, credencialId) => provedorDaChave(await tx((trx) => criarRepos(trx, escopo).credenciaisNuvem.chaveCifrada(credencialId))),
        ...(criacaoNuvem ? { criacao: criacaoNuvem } : {}),
      })
    : null;

  // Inventário por pessoa (ADR-019): a sonda é da MÁQUINA (uma por TTL, compartilhada entre pessoas);
  // definido em 2026-09-18: descoberta consulta instalação/login sem prompt e persiste por pessoa.
  let sondaCompartilhada: { em: number; promessa: Promise<Inventario> } | null = null;
  const TTL_SONDA_MS = 300_000;
  // definido em 2026-09-18: quem chega antes do registry espera até PRAZO_REGISTRY_MS; vencido o prazo
  // responde 'ausente' SEM cachear, para a próxima chamada tentar de
  // novo. Um app composto e nunca ligado (só em teste) responde em vez de pendurar o pedido.
  const PRAZO_REGISTRY_MS = 15_000;
  async function sondarMaquina(): Promise<Inventario> {
    if (!registryLigado) {
      let prazo: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        registryPronto,
        new Promise<void>((r) => {
          prazo = setTimeout(r, PRAZO_REGISTRY_MS);
        }),
      ]);
      if (prazo) clearTimeout(prazo);
      if (!registryLigado) return { estado: "ausente", motivo: "servidor ainda sem registry", em: relogio() };
    }
    const agora = relogio();
    if (sondaCompartilhada && agora - sondaCompartilhada.em < TTL_SONDA_MS) return sondaCompartilhada.promessa;
    const id = idDriverAtual();
    const registro = registryLigado?.[id];
    const promessa: Promise<Inventario> = !registro
      ? Promise.resolve({ estado: "ausente", motivo: MOTIVO_NAO_REGISTRADO, em: agora })
      : registro.estado === "sombra"
        ? Promise.resolve({ estado: "ausente", motivo: registro.motivo, em: agora })
        : registro.instance.sondar();
    sondaCompartilhada = { em: agora, promessa };
    promessa.then(
      (inv) => {
        inventarioPorDriver[id] = inv;
        // NOD-178: a sonda lenta não segura a máquina por 5 min; a próxima consulta pergunta de novo ao CLI.
        if (sondaFoiLenta(inv) && sondaCompartilhada?.promessa === promessa) sondaCompartilhada = null;
      },
      () => undefined,
    );
    return promessa;
  }
  const inventario = criarInventario({
    relogio,
    ttlMs: compartilhado ? 0 : undefined,
    sondar: async (pessoaId) => {
      if (compartilhado) return ponteHttp.inventario(pessoaId);
      if (inventarioInicial && relogio() - inventarioInicial.em < TTL_SONDA_MS && !sondaCompartilhada) {
        sondaCompartilhada = { em: inventarioInicial.em, promessa: Promise.resolve(inventarioInicial) };
      }
      return sondarMaquina();
    },
    persistir: async (pessoaId, inv) => {
      const tenantId = await tenantDe(pessoaId);
      if (!tenantId) return;
      const escopo = { tenantId, pessoaId };
      await abrirTxEscopada(db, escopo)((trx) => criarRepos(trx, escopo).inventario.registrar(motorDe(executorAtual), inv));
    },
  });

  // Interruptor de executor (definido em 2026-09-16): a troca é da MÁQUINA. Trocar para um driver em sombra
  // tenta ligá-lo na hora (ativarDriver, fornecido pelo boot; a descoberta não submete prompt) e só
  // vira executor se a sonda disser 'pronto' — senão `recusa` escrita e nada muda (ADR-019 gate, ADR-029).
  function inventarioDe(id: IdDriver): Inventario {
    const guardado = inventarioPorDriver[id];
    if (guardado) return guardado;
    const registro = registryLigado?.[id];
    const motivo = !registryLigado ? "Verificando as conexões deste computador…"
      : !registro || registro.estado === "sombra" && registro.motivo === MOTIVO_NAO_REGISTRADO ? "Conecte sua conta para habilitar este harness."
      : registro.estado === "pronto" ? "Verificando conexão…" : registro.motivo;
    return { estado: "ausente", motivo, em: relogio() };
  }
  /** `recusa` é da RESPOSTA da troca pedida, nunca guardada: quem só consulta (GET, outras telas) não vê a recusa de outra pessoa. */
  function catalogoHarness(pessoaId?: string): CatalogoHarness {
    const remotos = compartilhado && pessoaId ? ponteHttp.harnessesDaPessoa(pessoaId) : null;
    // NOD-207: as capacidades vêm do contrato nos dois modos (a ponte só diz o inventário de cada máquina).
    const opcoes = opcoesDoCatalogo((id) => remotos ? remotos[id] ?? { estado: "ausente" as const, motivo: "Não conectado neste computador", em: relogio() } : inventarioDe(id));
    return { simulacao: !compartilhado && executorAtual === "catcher", legado: HARNESS_LEGADO, padrao: opcoes.find((h) => h.id === driverPreferido && h.inventario.estado === "pronto")?.id ?? opcoes.find((h) => h.inventario.estado === "pronto")?.id ?? null, opcoes };
  }
  function estadoExecutor(recusa: string | null = null): EstadoExecutor {
    return { atual: idDriverAtual(), opcoes: IDS_DRIVER.map((id) => ({ id, custo: id === "catcher" ? "zero" : "real", inventario: inventarioDe(id) })), recusa, harnesses: catalogoHarness() };
  }
  function recusar(id: IdExecutor, atual: IdDriver, motivo: string): EstadoExecutor {
    log("aviso", "executor_troca_recusada", { pedido: id, atual, motivo });
    return estadoExecutor(`${id} em sombra: ${motivo}`);
  }
  async function trocar(id: IdExecutor): Promise<EstadoExecutor> {
    const anterior = idDriverAtual();
    // NOD-160: o mesmo id só é no-op com o driver pronto. Em sombra (NOD_EXECUTOR desconhecido deixa o Claude "atual" e em
    // sombra desde o boot), escolhê-lo de novo no seletor é o pedido de ligá-lo: segue para a sonda.
    if (id === anterior && (!registryLigado || registryLigado[id]?.estado === "pronto")) return estadoExecutor();
    const registry = registryLigado;
    if (!registry) return estadoExecutor("servidor ainda sem registry");
    try {
      // 1. Sonda ANTES de virar: liga o driver em sombra ou reaproveita a consulta recente do
      //    driver já pronto; sonda velha (> TTL) é refeita — um driver pronto no boot pode ter sido deslogado desde então.
      const registro = registry[id];
      const conhecido = inventarioPorDriver[id];
      let inv: Inventario;
      if (!registro || registro.estado !== "pronto") {
        if (!ativarDriver) return recusar(id, anterior, registro?.motivo ?? MOTIVO_NAO_REGISTRADO);
        inv = await ativarDriver(id);
      } else if (conhecido?.estado === "pronto" && relogio() - conhecido.em < TTL_SONDA_MS) inv = conhecido;
      else inv = await registro.instance.sondar(); // sem sonda recente que diga 'pronto': sonda de novo (uma recusa recente não é definitiva)
      inventarioPorDriver[id] = inv;
      if (inv.estado !== "pronto") return recusar(id, anterior, `${inv.estado}: ${inv.motivo}`);
      const ligado = registry[id];
      if (!ligado || ligado.estado !== "pronto") return recusar(id, anterior, ligado?.motivo ?? MOTIVO_NAO_REGISTRADO);

      // 2. Ainda antes de virar: inventário persistido por pessoa sob o motor NOVO (é o que enviarMensagem e emitirPlanoTurno
      //    leem no gate pré-spawn) e máquina anunciada com ele — nenhum turno nasce 'ausente' na janela da troca.
      const novo: Executor = id === "catcher" ? "catcher" : "local";
      const pessoas = await listar();
      for (const p of pessoas) {
        const escopo: Escopo = { tenantId: p.tenantId, pessoaId: p.id };
        await abrirTxEscopada(db, escopo)((trx) => criarRepos(trx, escopo).inventario.registrar(motorDe(novo), inv));
      }
      for (const m of ponte.maquinasConectadas()) await ponte.conectar({ ...m, inventario: inv });

      // 3. Vira por último. A consulta da troca vale como a consulta da máquina; o cache do
      //    inventário por pessoa é invalidado e cada tela aberta recebe o aviso.
      driverPreferido = id;
      executorAtual = novo;
      inventarioInicial = null;
      sondaCompartilhada = { em: relogio(), promessa: Promise.resolve(inv) };
      for (const p of pessoas) {
        inventario.invalidar(p.id);
        barramento.publicar(p.id, "inventario.mudou", { motor: id, anterior });
      }
      log("info", "executor_trocado", { de: anterior, para: id, inventario: inv.estado });
      return estadoExecutor();
    } catch (erro) {
      // Nada virou (o executor só muda no passo 3, que não lança): estado escrito, nunca 500 mudo (ADR-029).
      const nome = erro instanceof Error ? erro.name : "desconhecido";
      log("erro", "executor_troca_falhou", { pedido: id, atual: anterior, erro: nome });
      return estadoExecutor(`falha ao trocar para ${id}: ${nome}`);
    }
  }
  function trocarExecutor(id: IdExecutor): Promise<EstadoExecutor> {
    const p = filaDeTrocas.then(() => trocar(id));
    filaDeTrocas = p.catch(() => undefined);
    return p;
  }

  /**
   * definido em 2026-10-09: as causas que só a tela do Mac distingue (sem_node, config_invalida) não vão aos cards do
   * onboarding: ali o card mostra o estado sem causa. O limite (0068) também não: é do servidor, e este catálogo não o
   * sobrepõe.
   */
  const ehCausaDoMac = (c: string): c is CausaDoMac | "limite" => c === "limite" || (CAUSAS_DO_MAC as readonly string[]).includes(c);
  /** ADR-077: a IA dos bots no Mac da pessoa, para os cards de IA do onboarding (o catcher conta como pronto). */
  function executorDoMac(pessoaId: string): { pronto: boolean; ias: IaNoMac[] } {
    const catalogo = catalogoHarness(pessoaId);
    const ias: IaNoMac[] = catalogo.opcoes.filter((h): h is typeof h & { id: IaNoMac["id"] } => h.id === "claude-cli" || h.id === "codex-cli").map((h) => ({ id: h.id, estado: h.inventario.estado, ...(h.inventario.estado !== "pronto" && "motivo" in h.inventario && h.inventario.motivo ? { motivo: h.inventario.motivo } : {}), ...(h.inventario.estado !== "pronto" && h.inventario.causa && !ehCausaDoMac(h.inventario.causa) ? { causa: h.inventario.causa } : {}), ...(h.inventario.estado === "ausente" && h.inventario.causa === "cli_antigo" && h.inventario.versao && h.inventario.minima ? { versao: h.inventario.versao, minima: h.inventario.minima } : {}) }));
    return { pronto: (!compartilhado && executorAtual === "catcher") || ias.some((i) => i.estado === "pronto"), ias };
  }

  const depsRotas: DepsRotas = {
    abrirTx: (escopo) => abrirTxEscopada(db, escopo),
    services,
    useCases,
    agora: relogio,
    modeloPadrao,
    prazoDecisaoMs,
    get executor() {
      return executorAtual;
    },
    ...(compartilhado ? { harnessesDaPessoa: (pessoaId: string) => ponteHttp.harnessesDaPessoa(pessoaId) } : {}),
  };
  const depsL7: DepsRotasL7 = { executor: () => executorAtual, txPara: (escopo) => abrirTxEscopada(db, escopo), services, useCases, agora: relogio, fusoPadrao };
  const rotas: Rota[] = [
    ...criarRotasFrota(depsRotas),
    criarRotaInventario({ inventario }),
    criarRotaAmbiente(env),
    // ADR-092: a ponte das máquinas também no modo local (a VM da pessoa); o seletor de IA continua sendo o deste Mac.
    ...ponteHttp.rotas,
    ...(compartilhado ? [
      { metodo: "GET", padrao: /^\/executor$/, async handler(ctx) {
        const catalogo = catalogoHarness(ctx.escopo.pessoaId);
        // revisto em 2026-10-10 (teste do Breno): aqui não existe `POST /executor` — o "usar Codex" dava 404. `trocavel: false`
        // tira o botão; a IA de cada bot é escolhida na Inteligência dele, e o Automático segue a ordem da pessoa (GET /ias).
        ctx.json(200, { atual: iaAtualDoCatalogo(catalogo), opcoes: catalogo.opcoes.filter((h) => h.integrado).map((h) => ({ id: h.id, custo: "real", inventario: h.inventario })), recusa: null, harnesses: catalogo, trocavel: false });
      } } satisfies Rota,
    ] : criarRotasExecutor({ estado: estadoExecutor, trocar: trocarExecutor })),
    ...criarRotasIas({ ...depsRotas, inventarios: (escopo) => Object.fromEntries(catalogoHarness(escopo.pessoaId).opcoes.map((h) => [h.id, h.inventario])) }),
    ...criarRotasAgentes(depsRotas, computadores.desligarExcluido, (escopo) => ({
      ...ponteHttp.prontosPorMaquinaDaPessoa(escopo.pessoaId),
      ...(compartilhado ? {} : Object.fromEntries(ponte.maquinasConectadas().map((m) => [m.machineId, (Object.entries(m.harnesses ?? {}) as [IdHarness, Inventario | undefined][]).filter(([, i]) => i?.estado === "pronto").map(([h]) => h)]))),
    })),
    ...criarRotasConversas(depsRotas),
    ...criarRotasTrabalhos(depsRotas),
    ...criarRotasAtividade(depsRotas),
    ...criarRotasArtefatos(depsRotas),
    ...criarRotasRelatos(depsRotas),
    ...criarRotasPropostas(depsRotas),
    ...criarRotasTurnos(depsRotas),
    ...criarRotasRaioX(depsRotas),
    ...criarRotasComandos(depsRotas),
    ...criarRotasUsoDoPlano(depsRotas),
    ...criarRotasCustoDoDia({ ...depsRotas, fusoPadrao: env.NOD_FUSO_PADRAO ?? "America/Sao_Paulo" }),
    ...criarRotasNaoLidos(depsRotas),
    ...criarRotasLigacoes({
      ...depsRotas,
      contexto: contextoLigacao,
      maxS: maxLigacaoS,
      registrar: (escopo, l) => {
        voz.registrar({ ...l, tenantId: escopo.tenantId, pessoaId: escopo.pessoaId, maxS: maxLigacaoS });
        acompanharDecisoes(escopo, l.ligacaoId, l.conversaId);
      },
      encerrarViva: (id) => voz.encerrar(id, "pessoa_desligou"),
      aguardandoEscolha: (escopo, ligacaoId) => voz.aguardandoEscolha({ pessoaId: escopo.pessoaId, ligacaoId }),
      iasProntas: (escopo) => (!compartilhado && executorAtual === "catcher" ? null : iasDoMacParaVoz(escopo.pessoaId).filter((i) => i.estado === "pronto").map((i) => i.id)),
      reabrirCerebro: (escopo, p) => voz.reabrirCerebro({ pessoaId: escopo.pessoaId, ...p }),
      amostra: amostraDeVoz,
      contextoLeitura,
      ouvir: (escopo, p) => leitor.ler({ escopo, ...p }),
      contextoDitado,
    }),
    ...criarRotasOnboarding({
      ...depsRotas,
      executorDoMac: (escopo) => executorDoMac(escopo.pessoaId),
      contexto: (escopo, agenteId) => contextoLigacao(escopo, agenteId, true),
      registrar: (escopo, l) => {
        voz.registrar({
          ligacaoId: l.ligacao.id, agenteId: l.ligacao.agenteId, conversaId: l.ligacao.conversaId, turnoId: l.turno.id, voz: l.voz, velocidade: l.velocidade, nomeBot: l.nomeBot, genero: l.genero,
          tenantId: escopo.tenantId, pessoaId: escopo.pessoaId, maxS: maxLigacaoS,
          onboarding: true, saudacao: saudacaoDoOnboarding(l.nomeBot), aguardandoConsentimento: true,
          vocabulario: Object.values(MODELOS_DE_BOT).flatMap((m) => [m.nome, m.app.nome]),
        });
        acompanharDecisoes(escopo, l.ligacao.id, l.ligacao.conversaId, true);
      },
      liberar: (id) => voz.liberar(id),
      encerrarViva: (id, motivo) => voz.encerrar(id, motivo),
      fusoPadrao: env.NOD_FUSO_PADRAO ?? "America/Sao_Paulo",
    }),
    ...rotasConcessoes({ dentro }),
    ...rotasMarketplace({ dentro, cifrar: (t) => cifrar(t, chave), decifrar: (t) => decifrar(t, chave), admins: (env.NOD_ADMINS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean), aoTrocarApp: (t) => cofreDoApp.esquecer(t) }),
    ...rotasConectores({ dentro, cifrar: (t) => cifrar(t, chave), decifrar: (t) => decifrar(t, chave) }),
    ...rotasTrilha({ dentro }),
    // ADR-090: o motor sem janela da versão deste servidor (dist/motor) e o script que o instala numa máquina Linux.
    ...rotasMotor({ pasta: env.NOD_MOTOR_DIR ?? resolve("dist/motor"), versao: versaoDoServidor(), ...(env.NOD_URL_PUBLICA ? { urlPublica: env.NOD_URL_PUBLICA } : {}) }),
    ...rotasContasIa({ dentro, logins, dispositivo, compartilhado, avisar: avisarContas, maquinaViva: (escopo, id) => ponteHttp.maquinasDaPessoa(escopo).some((m) => m.machineId === id), aoRenomear: (escopo, id, nome) => ponteHttp.renomear(escopo, id, nome) }),
    ...(compartilhado ? rotasInstalacoesSsh({ dentro, instalacoes, dispositivo, ...(env.NOD_URL_PUBLICA ? { urlPublica: env.NOD_URL_PUBLICA } : {}) }) : []),
    ...rotasMaquinas({ dentro, pareamento: criarPareamentoMaquina(relogio), dispositivo, maquinasVivas: (escopo) => ponteHttp.maquinasDaPessoa(escopo), pareadaPorConvite, ...(compartilhado ? {} : { servidorNoMac: { api: `http://127.0.0.1:${numero(env.NOD_API_PORT, 8888)}` } }) , nuvem: nuvemLigada }),
    ...(nuvemLigada ? rotasNuvem({ dentro, segredo: segredoEfetivo(env.NOD_LOGIN === "google" ? "google" : "stub", env.NOD_SESSAO_SEGREDO), oauth: oauthNuvem(env), conta: o.nuvem?.conta ?? criarContaGcp({ contaFaturamento: env.NOD_NUVEM_CONTA_FATURAMENTO ?? null }), ...(o.nuvem?.fetchImpl ? { fetchImpl: o.nuvem.fetchImpl } : {}), cifrar: (t) => cifrar(t, chave), provedorDa: async (escopo, credencialId) => provedorDaChave(await dentro(escopo, (d) => d.repos.credenciaisNuvem.chaveCifrada(credencialId))), ...(criacaoNuvem ? { registrarConvite: criacaoNuvem.registrarConvite } : {}), agora: relogio }) : []),
    // definido em 2026-09-16: NOD_LONGPOLL_MS encurta a fatia do long-poll de aprovação (testes/e2e); default LONGPOLL_APROVACAO_MS.
    ...rotasComputadores(computadores),
    ...rotasWorkspaces(workspaces, dentro),
    ...rotasInternas({ dentro, computadores, workspaces, tokens, agora: relogio, revisor: caixaRevisoes, pressao: (pessoaId) => trabalhosVivos.memoria(pessoaId)?.nivel ?? null, longpollMs: env.NOD_LONGPOLL_MS ? numero(env.NOD_LONGPOLL_MS, 20_000) : undefined }),
    ...criarRotasRotinas(depsL7),
    ...criarRotasSalas(depsL7),
    ...criarRotasSuaVez(dentro),
    ...criarRotasDecisoes({
      dentro,
      services,
      conferirComandoVoz: (p) => voz.conferirComando(p),
      aoDecidirPorVoz: (p) => {
        decididasPorVoz.add(p.decisaoId);
        voz.decisaoDecidida(p.ligacaoId, { decisaoId: p.decisaoId, resultado: p.acao === "aprovar" ? "aprovado" : "recusado", porVoz: true });
      },
      prazoDecisaoMs,
      get executor() {
        return executorAtual;
      },
    }),
    criarRotaEventos(barramento, { conexoes: conexoesSse }),
    criarRotaMetricas(),
    criarRotaDev(dentro, {
      get executor() {
        return idDriverAtual();
      },
    }),
  ];

  function publicarDoPlano(plano: PlanoTurno, tipo: "turno.delta" | "turno.atividade" | "turno.tarefas" | "turno.subagentes" | "turno.fala" | "turno.vigia", dados: Record<string, unknown>): void {
    // ADR-083: o "último passo" da faixa de Trabalhos é o rótulo da última ferramenta do turno vivo.
    if (tipo === "turno.atividade" && typeof dados.rotulo === "string") trabalhosVivos.ferramenta(plano.turnoId, dados.rotulo);
    // NOD-350: e, enquanto algum subagente trabalha, a contagem deles (critérios 3 e 9).
    // O frame leva a mesma linha pronta: a web só importa tipos de src, e o texto não pode divergir entre as telas.
    if (tipo === "turno.subagentes" && Array.isArray(dados.subagentes)) {
      // O `passo` chega como o nome cru da ferramenta (validado na ponte): o rótulo da tela sai daqui, nunca do Mac.
      const lista = comRotulos(dados.subagentes as SubagenteVivo[]);
      const resumo = resumoSubagentes(lista);
      trabalhosVivos.subagentes(plano.turnoId, resumo, haSubagenteTrabalhando(lista));
      dados = { ...dados, subagentes: lista, resumo };
    }
    barramento.publicar(plano.autoria.conta_de_execucao, tipo, { turnoId: plano.turnoId, conversaId: plano.conversaId, agenteId: plano.agenteId, executor: plano.executor, machineId: plano.machineId, ...dados });
  }
  // NOD-73: o vigia do turno (só avisa), igual para o app do Mac e o modo servidor — frame e log saem do mesmo lugar.
  const avisoDoVigia = criarAvisoDoVigia((plano, dados) => publicarDoPlano(plano, "turno.vigia", dados));

  function aoRegistrarCatcher(r: RegistroCatcher): void {
    const escopo = ponte.escopoDoTurno(r.turnoId);
    if (!escopo) return;
    abrirTxEscopada(db, escopo)((trx) => services.catcher.registrar(trx, r.turnoId, r.tipo, r.dados)).catch((e: unknown) => {
      log("aviso", "catcher_registro_falhou", { turno_id: r.turnoId, tipo: r.tipo, erro: e instanceof Error ? e.name : "desconhecido" });
    });
  }

  // A lista de tarefas do bot (definido em 2026-09-28): o mesmo acompanhante do app do Mac, publicado direto.
  const planosVivos = new Map<string, PlanoTurno>();
  const tarefasVivas = criarAcompanhanteDeTarefas((turnoId, tarefas) => {
    const plano = planosVivos.get(turnoId);
    if (plano) publicarDoPlano(plano, "turno.tarefas", { tarefas });
  });
  // NOD-350: os subagentes, agrupados em no máximo uma publicação por segundo (aqui não há a renovação para juntar).
  const subagentesVivos = criarAcompanhanteDeSubagentes((turnoId, subagentes, principalOcioso) => {
    const plano = planosVivos.get(turnoId);
    if (plano) publicarDoPlano(plano, "turno.subagentes", { subagentes, principalOcioso });
  }, { relogio });
  // definido em 2026-10-07 (ADR-083 §4, #194): a memória desta máquina (o executor local roda aqui), um amostrador só
  // para todos os pools. revisto em 2026-10-08 (ADR-085): no macOS ele amostra desde o primeiro `puxar` (a leitura da
  // máquina vai em cada um); fora do macOS, sem NOD_SIMULAR_*, não lê nada e o puxar vai sem leitura.
  const memoriaDaMaquina = criarAmostradorMemoria({ env });
  // Pool elástico por pessoa (2026-09-24): um laço ocioso sempre puxando, mais um por turno rodando.
  const iniciarLacoDaPessoa: IniciarLaco = (p) =>
    iniciarPoolDeLacos((ponte) => iniciarLaco({
      ...p,
      ponte,
      // ADR-115 (plano dos modos de aprovação, redesenho 6): o modo local renova a 1 s, como o app do Mac e o motor — é a
      // batida que entrega o pedido de revisão ao laço; a 30 s ele estouraria o prazo de 60 s. Só com a chave ligada
      // (revisão do PR 3a): desligada, nenhum pedido sai, e a batida fica a de hoje (30 s), sem 30× renovações no banco.
      ...renovacaoDoLacoLocal(configRevisor),
      memoria: memoriaDaMaquina,
      aoDelta: (plano, texto) => publicarDoPlano(plano, "turno.delta", { texto }),
      aoFalaGravada: (plano) => publicarDoPlano(plano, "turno.fala", {}),
      aoVigia: (plano, aviso) => avisoDoVigia(plano, aviso),
      aoEvento: (plano, ev: EventoStream) => {
        if (ev.tipo === "catcher") aoRegistrarCatcher({ turnoId: plano.turnoId, tipo: ev.subtipo, dados: ev.dados });
        else if (ev.tipo === "tool_use") publicarDoPlano(plano, "turno.atividade", { nome: ev.nome, rotulo: rotuloFerramenta(ev.nome) });
        tarefasVivas.evento(plano.turnoId, ev);
        subagentesVivos.evento(plano.turnoId, ev);
      },
      aoIniciarTurno: (plano, adapter) => { interruptor.registrar(plano.turnoId, () => adapter.interromper()); planosVivos.set(plano.turnoId, plano); },
      aoTerminarTurno: (plano) => { interruptor.esquecer(plano.turnoId); tarefasVivas.esquecer(plano.turnoId); subagentesVivos.parar(plano.turnoId); subagentesVivos.esquecer(plano.turnoId); planosVivos.delete(plano.turnoId); },
    }), p.ponte);
  // definido em 2026-10-09 (ADR-088): no modo local o servidor É o executor do Mac, e a limpeza das pastas de task roda
  // aqui, uma por pessoa ao lado do pool (as passadas entram numa fila só do processo, revisão do #225).
  // `NOD_LIMPEZA_TASKS` (ADR-096): sem nada apaga; `simular` confere tudo e só registra; `desligada` desliga.
  const homeDoExecutor = env.HOME ?? homedir();
  const modoLimpeza = modoDaLimpeza(env);
  // Segunda revisão do #225: o modo efetivo no boot — quem lê o log sabe se algo foi apagado (o padrão é `ligada`, ADR-096).
  if (!compartilhado) log("info", "limpeza_modo", { modo: modoLimpeza, onde: "servidor_local" });
  const pastaEmUso = (pasta: string) => [...planosVivos.values()].some((p) => p.pastaDoBot === pasta || p.pastaDoBot?.startsWith(`${pasta}/`) === true);
  // definido em 2026-10-12 (ADR-099, parte 2): as esperas de comando rodam aqui também, uma por pessoa ao lado do pool, com
  // o ambiente limpo dos drivers (o mesmo regime do Bash do bot: nada do servidor vaza para o comando).
  const ambienteDasEsperas = { ...montarAmbiente("local", env), PATH: caminhoAumentado(env.PATH, homeDoExecutor), HOME: homeDoExecutor };
  const iniciar: IniciarLaco = (p) => {
    const pool = iniciarLacoDaPessoa(p);
    const limpeza = modoLimpeza === "desligada" ? null : iniciarLimpezaDasTasks({ ponte: p.ponte, pessoaId: p.pessoaId, home: homeDoExecutor, executar: criarExecutarComando(env, homeDoExecutor), simular: modoLimpeza === "simular", emUso: pastaEmUso, machineId: p.machineId });
    const esperas = iniciarEsperas({ ponte: p.ponte, pessoaId: p.pessoaId, machineId: p.machineId, home: homeDoExecutor, env: ambienteDasEsperas });
    return { ...pool, async parar() { limpeza?.parar(); esperas.parar(); await pool.parar(); } };
  };

  return {
    services,
    useCases,
    dentro,
    computadores: o.computador || env.NOD_COMPUTADORES === "docker" ? computadores : null,
    depsDe,
    ponte,
    rotas,
    contas,
    barramento,
    interruptor,
    tokens,
    conectoresVivos,
    inventario,
    get executor() {
      return executorAtual;
    },
    get idDriver() {
      return idDriverAtual();
    },
    machineId,
    compartilhado,
    ultimoContatoDaMaquina: (machineId) => ponteHttp.ultimoContato(machineId),
    autorizarMaquina,
    ligarRegistry(registry, inventarios, ativar) {
      registryLigado = registry;
      if (automatico) driverPreferido = registry["claude-cli"].estado === "pronto" ? "claude-cli" : registry["codex-cli"]?.estado === "pronto" ? "codex-cli" : "claude-cli";
      for (const id of IDS_DRIVER) {
        const inv = inventarios?.[id];
        if (inv) inventarioPorDriver[id] = inv;
      }
      inventarioInicial = inventarios?.[idDriverAtual()] ?? null;
      ativarDriver = ativar ?? null;
      sondaCompartilhada = null;
      ligarRegistryResolvido();
    },
    estadoExecutor,
    trocarExecutor,
    registry: () => registryLigado,
    iniciarLaco: iniciar,
    aoRegistrarCatcher,
    tenantDe,
    voz,
    drenarPonte: () => ponteHttp.iniciarDrenagem(),
    iniciarVarredorMaquinas,
    sse: conexoesSse,
    reservasEmVoo: () => ponteHttp.reservasEmVoo(),
    anexarVoz(server, resolverEscopo) {
      return anexarCanaisVoz(server, {
        resolverEscopo,
        autorizarTokenTurno: (token) => tokens.autorizarComBanco(token),
        ligacaoDoTurno: (turnoId) => tokens.planoDe(turnoId)?.ligacaoVoz?.ligacaoId ?? null,
        anexarMidia: ({ escopo, ligacaoId, retomar, canal }) => voz.anexarMidia({ pessoaId: escopo.pessoaId, ligacaoId, retomar, canal }),
        anexarCerebro: ({ identidade, ligacaoId, canal }) => voz.anexarCerebro({ turnoId: identidade.turnoId, ligacaoId, canal }),
        anexarDitado: ({ escopo, canal }) => anexarDitado(escopo, canal),
      });
    },
    async fechar() {
      leitor.fechar();
      await ditado.fechar();
      await voz.fechar();
      await provedoresVoz.encerrar();
      await varredorMaquinas?.parar();
      reconciliadorNuvem?.parar();
      await conectoresVivos.fechar();
    },
  };
}
