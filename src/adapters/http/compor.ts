import type { DriverComputador } from "../../contracts/computador.ts";
import { criarDriverDocker } from "../computador/docker.ts";
import { criarComputadores } from "../fundo/computadores.ts";
import { rotasComputadores } from "./rotas/computadores.ts";
import { homedir } from "node:os";
import { join } from "node:path";
import { expandirTil } from "../executor/caminho.ts";
import { criarWorkspaces } from "../fundo/workspaces.ts";
import { rotasWorkspaces } from "./rotas/workspaces.ts";
import { HARNESSES } from "../../contracts/harness.ts";
import type { CatalogoHarness } from "../../contracts/harness.ts";
import type { Executor, RuntimeEvent } from "../../contracts/evento.ts";
import type { EstadoExecutor, IdExecutor } from "../../contracts/executor.ts";
import type { Inventario } from "../../contracts/inventario.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import type { EventoStream } from "../../contracts/turno.ts";
import { chaveDe, cifrar, decifrar } from "../../db/cifra.ts";
import { abrirTxEscopada } from "../../db/tx.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { rotuloFerramenta } from "../../domain/rotulo-ferramenta.ts";
import { contextoAtual } from "../../obs/contexto.ts";
import { log } from "../../obs/log.ts";
import { criarRepos } from "../../repositories/index.ts";
import { listarTodas } from "../../repositories/pessoas.repo.ts";
import { criarBarramento, type Barramento } from "../../services/barramento.ts";
import { criarConectoresVivos, type ConectoresVivos, type ConfigConectorVivo } from "../../services/conectores-vivos.ts";
import type { Conector } from "../../contracts/conector.ts";
import { COMANDO_GITHUB_NATIVO } from "../../contracts/github.ts";
import { executarGithubNaMaquina } from "../conectores-locais/github/maquina.ts";
import { concluirItemNaMaquina, itensParaAMaquina } from "../../use-cases/itens-na-maquina.ts";
import { configGithubNativo, criarDetectorGh, sondaGithubNativa, type DetectorGh } from "../conectores-locais/github/nativo.ts";
import { criarSubidaComposio } from "../integracoes/arquivo-composio.ts";
import { criarCofreDeTokensDoApp, criarTokenDeInstalacao } from "../integracoes/github-app.ts";
import { criarInterruptor, type InterruptorNod } from "../../services/interruptor.ts";
import { criarInventario, type ServicoInventario } from "../../services/inventario.ts";
import { criarTokenTurno, type TokenTurno } from "../../services/token-turno.ts";
import { criarPareamentoMaquina } from "../../services/pareamento-maquina.ts";
import type { Db, Escopo, Relogio, Tx } from "../../shared/types.ts";
import { JUNTAR_DELTAS_MS } from "../../shared/constantes.ts";
import { servicoRotinas } from "../../use-cases/ativar-rotina.ts";
import { atualizarPerfil } from "../../use-cases/atualizar-perfil.ts";
import { motorDe } from "../../use-cases/autoria-evento.ts";
import { criarRotina } from "../../use-cases/criar-rotina.ts";
import { atualizarRotinaPeloAgente, excluirRotinaPeloAgente, listarRotinasDoAgente, pausarRotinaPeloAgente, reativarRotinaPeloAgente } from "../../use-cases/rotinas-do-agente.ts";
import { registrarDesfechoRotina } from "../../use-cases/disparar-rotina.ts";
import { emitirPlanoTurno } from "../../use-cases/emitir-plano-turno.ts";
import { encaminhar } from "../../use-cases/encaminhar.ts";
import { avisarFalhaDelegacao, entregarRespostaPeer } from "../../use-cases/entregar-resposta-peer.ts";
import { motivoEmPortugues } from "../../domain/redacao.ts";
import { lembrar } from "../../use-cases/lembrar.ts";
import { passar } from "../../use-cases/passar.ts";
import { semNovidade } from "../../use-cases/sem-novidade.ts";
import { anotarPendencia, concluirPendencia, descartarPendencia } from "../../use-cases/pendencias.ts";
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
import { iniciarPoolDeLacos } from "../executor/pool-lacos.ts";
import { MOTIVO_NAO_REGISTRADO } from "../executor/registry.ts";
import type { IdDriver, Registry } from "../executor/spi.ts";
import type { IniciarLaco } from "../fundo/orquestrador-turnos.ts";
import { criarPonteInterna, type PonteInternaNod } from "../fundo/ponte-interna.ts";
import { autorizarChaveMaquina } from "./autorizar-chave-maquina.ts";
import { segredoEfetivo } from "./sessao.ts";
import { criarPonteHttpServidor } from "./rotas/ponte.ts";
import type { Rota } from "./roteador.ts";
import { criarRotasAgentes } from "./rotas/agentes.ts";
import { criarRotasPendencias } from "./rotas/pendencias.ts";
import { criarRotasArtefatos } from "./rotas/artefatos.ts";
import { rotasMaquinas } from "./rotas/maquinas.ts";
import { rotasConcessoes } from "./rotas/concessoes.ts";
import { rotasMarketplace } from "./rotas/marketplace.ts";
import { rotasConectores } from "./rotas/conectores.ts";
import { criarRotasConversas } from "./rotas/conversas.ts";
import { criarRotasRelatos } from "./rotas/relatos.ts";
import { criarRotasDecisoes } from "./rotas/decisoes.ts";
import type { DentroDeTx } from "./rotas/dentro-de-tx.ts";
import { criarRotaDev } from "./rotas/dev.ts";
import { criarRotaEventos } from "./rotas/eventos.ts";
import type { DepsRotas } from "./rotas/executar-caso.ts";
import { criarRotasExecutor } from "./rotas/executor.ts";
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
import { criarRotasNaoLidos } from "./rotas/nao-lidos.ts";
import { criarRotasLigacoes } from "./rotas/ligacoes.ts";
import { neutralizarDelimitadores } from "../mcp-proxy/moldura.ts";
import { desligar, iniciarTarefa } from "../../use-cases/ferramentas-ligacao.ts";
import { criarServicoVoz, type PersistenciaVoz, type RefLigacao, type ServicoVoz } from "../voz/orquestrador.ts";
import { criarProvedoresVoz } from "../voz/fabrica.ts";
import { criarCacheDeFalas } from "../voz/falas-de-espera.ts";
import { anexarCanaisVoz, type CanaisVoz } from "../voz/ws.ts";
import { atenderLigacao, encerrarLigacao, gravarFalaLigacao, leituraDaDecisao, mandarNoChatDaLigacao, resultadoDaTarefaDaLigacao, type ContextoLigacao } from "../../use-cases/ligacoes.ts";
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
};

export type App = {
  services: Services;
  useCases: UseCasesNod;
  dentro: DentroDeTx;
  depsDe(trx: Tx, escopo: Escopo): Deps;
  ponte: PonteInternaNod;
  rotas: Rota[];
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
  /** Liga os dois canais WebSocket da ligação ao servidor HTTP (boot, depois do listen). */
  anexarVoz(server: Server, resolverEscopo: (req: IncomingMessage) => Escopo | null): CanaisVoz;
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

export function comporApp(o: OpcoesCompor): App {
  const { db, env } = o;
  const compartilhado = env.NOD_MODO === "compartilhado";
  const relogio: Relogio = o.relogio ?? (() => Date.now());
  // Executor da máquina: nasce de NOD_EXECUTOR e muda pelo interruptor (trocarExecutor). Quem precisa dele lê o valor VIVO
  // (getter/closure), nunca uma cópia — senão a troca pela interface não chega ao plano do turno seguinte.
  const automatico = env.NOD_EXECUTOR === "auto" || (!env.NOD_EXECUTOR && env.NODE_ENV === "production");
  let driverPreferido: IdExecutor = env.NOD_EXECUTOR === "codex-cli" ? "codex-cli" : "claude-cli";
  let executorAtual: Executor = compartilhado || automatico || env.NOD_EXECUTOR === "claude-cli" || env.NOD_EXECUTOR === "codex-cli" ? "local" : "catcher";
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
  const tokens = criarTokenTurno({ agora: relogio });

  // tenant de uma pessoa (pessoas é catálogo sem RLS por pessoa); cache com recarga quando não achar.
  const tenants = new Map<string, string>();
  const listar = o.listarPessoas ?? (() => listarTodas(db));
  async function tenantDe(pessoaId: string): Promise<string | null> {
    if (!tenants.has(pessoaId)) for (const p of await listar()) tenants.set(p.id, p.tenantId);
    return tenants.get(pessoaId) ?? null;
  }

  const useCases: UseCasesNod = { lembrar, atualizarPerfil, pedirAcesso, criarRotina, listarRotinasDoAgente, pausarRotinaPeloAgente, reativarRotinaPeloAgente, atualizarRotinaPeloAgente, excluirRotinaPeloAgente, pedirAprovacao, pedirAPessoa, passar, encaminhar, semNovidade, pedirABot, verColegas, publicarArtefato, lerArtefato, anotarPendencia, concluirPendencia, descartarPendencia, iniciarTarefa, desligar };

  const depsDe = (trx: Tx, escopo: Escopo): Deps => ({ repos: criarRepos(trx, escopo), services, useCases, tx: (fn) => fn(trx), escopo, agora: relogio });
  const depsSobre = (trx: Tx): Deps => depsDe(trx, escopoDoContexto());
  const gravar = async (trx: Tx, events: RuntimeEvent[]): Promise<void> => {
    if (events.length) await criarRepos(trx, escopoDoContexto()).events.gravarComOutbox(events);
  };

  // Conectores vivos (L5): quem carrega e DECIFRA o env é este callback — o conector é da pessoa que o
  // registrou, então a busca corre as pessoas do servidor (ids são uuid: acha em uma).
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
  async function ghDaPessoa(escopo: Escopo, machineId?: string): Promise<boolean> {
    if (compartilhado) return machineId ? ponteHttp.ghDaMaquina(escopo, machineId) : ponteHttp.ghDaPessoa(escopo.pessoaId);
    if (!detectorGh || (await donoDaMaquinaLocal()) !== escopo.pessoaId) return false;
    return detectorGh.logado();
  }
  // ADR-048: o App da organização só atende turno de ROTINA (ninguém olhando); em turno interativo, nunca.
  const cofreDoApp = criarCofreDeTokensDoApp<Escopo>({
    agora: relogio,
    async gerar(escopo) {
      const cfg = await abrirTxEscopada(db, escopo)((trx) => criarRepos(trx, escopo).githubApp.config());
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
    async carregar(conectorId, contexto) {
      const escopos = donoDoConector.has(conectorId) ? [donoDoConector.get(conectorId) as Escopo] : (await listar()).map((p) => ({ tenantId: p.tenantId, pessoaId: p.id }));
      for (const escopo of escopos) {
        const c = await abrirTxEscopada(db, escopo)((trx) => criarRepos(trx, escopo).conectores.buscar(conectorId));
        if (!c) continue;
        donoDoConector.set(conectorId, escopo);
        const envDecifrado = c.envCifrado ? (JSON.parse(decifrar(c.envCifrado, chave)) as Record<string, string>) : {};
        return configDe(conectorId, c, envDecifrado, escopo, contexto.rotina);
      }
      return null;
    },
    async sondarNativo(c) {
      const escopo = { tenantId: c.tenantId, pessoaId: c.ownerId };
      const appConfigurado = (await abrirTxEscopada(db, escopo)((trx) => criarRepos(trx, escopo).githubApp.config())) !== null;
      return sondaGithubNativa({ ghNaMaquina: await ghDaPessoa(escopo), envChaves: Object.keys(c.env), appConfigurado });
    },
  });
  // O detector aquece no boot: o primeiro pedir_acesso não espera o `gh auth status` dentro da transação.
  if (detectorGh) void detectorGh.logado().catch(() => false);

  const services: Services = {
    relogio,
    tokenTurno: tokens,
    planos: {
      async emitir(trx, turnoId, machineIdDoPlano) {
        const d = depsSobre(trx);
        const r = await emitirPlanoTurno(d, { turnoId, machineId: machineIdDoPlano, executor: executorAtual, permitirResume: !compartilhado, ghNaMaquina: await ghDaPessoa(d.escopo, machineIdDoPlano),
          harnesses: compartilhado ? ponteHttp.harnesses(d.escopo, machineIdDoPlano) : Object.fromEntries(HARNESSES.map((h) => [h.id, inventarioDe(h.id)])),
          harnessPreferido: !compartilhado && driverPreferido !== "catcher" ? driverPreferido : null });
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

  const computadores = criarComputadores({ dentro, driver: o.computador ?? criarDriverDocker(env), executor: () => executorAtual,
    cifrar: (s) => cifrar(s, chave), decifrar: (s) => decifrar(s, chave),
    // `saude` (emenda da ADR-037): o computador entrou ou saiu do ar — a web relê a frota só nesse caso.
    mudou: (escopo, agenteId, saude) => { barramento.publicar(escopo.pessoaId, "computador.mudou", { agenteId, ...(saude ? { saude: true } : {}) }); } });
  if (o.computador || env.NOD_COMPUTADORES === "docker") services.computadores = computadores;
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
  const depsPonte: Parameters<typeof criarPonteInterna>[1] = {
    services,
    useCases,
    executor: () => executorAtual,
    agora: relogio,
    listarPessoas: o.listarPessoas,
    esquecerTurno: (id) => interruptor.esquecer(id),
    async depoisDeAssentar(d, { entrega, saida }) {
      const turno = saida.turno;
      if (!turno || saida.tardia) return [];
      const events: RuntimeEvent[] = [];
      // definido em 2026-09-24 (ADR-045): turno derrubado pela máquina já registrou a execução como
      // 'interrompida' (interromper-por-maquina.ts); registrar 'falhou' aqui sobrescreveria a janela.
      if ((turno.origem === "rotina" || turno.origem === "retomada") && turno.motivoInterrupcao !== "maquina_sem_contato") {
        // definido em 2026-09-21: concluído + `sem_novidade` chamado = execução completa que não
        // rendeu notícia. Desfecho próprio para o histórico distinguir "rodou e não tinha nada" de
        // "rodou e relatou" — e para registrarDesfechoRotina saber que não deve escrever marcador.
        const silencioso = turno.estado === "concluido" && turno.semNovidadeMotivo !== null;
        const desfecho = silencioso ? "sem_novidade" : turno.estado === "concluido" ? "executou" : "falhou";
        const r = await registrarDesfechoRotina(d, { turnoId: turno.id, desfecho, motivo: silencioso ? turno.semNovidadeMotivo : desfecho === "falhou" ? (turno.motivoFalha ?? null) : null });
        if ("execucao" in r.data) events.push(...(r.events ?? []));
      }
      // definido em 2026-09-24 (ADR-047): a tarefa delegada (e a retomada dela, depois de um acesso aprovado)
      // também devolve o resultado ao remetente; entregarRespostaPeer segue a cadeia e ignora o resto.
      if ((turno.origem === "peer" || turno.origem === "delegacao" || turno.origem === "retomada") && turno.estado === "concluido" && entrega.fala.tipo === "texto" && entrega.fala.texto.trim() !== "") {
        const r = await entregarRespostaPeer(d, { tarefaId: turno.id, texto: entrega.fala.texto });
        if (!("ignorado" in r.data)) events.push(...(r.events ?? []));
      } else if (turno.origem === "delegacao" || (turno.origem === "retomada" && turno.sobProcuracaoDe)) {
        // Revisão da ADR-047: tarefa delegada que parou ou terminou calada avisa o remetente (uma vez por raiz).
        const motivo = turno.estado === "interrompido" ? motivoEmPortugues(turno.motivoFalha ?? turno.motivoInterrupcao ?? "sem_progresso") : "terminou sem resposta";
        const r = await avisarFalhaDelegacao(d, { turnoId: turno.id, motivo });
        if (!("ignorado" in r.data)) events.push(...(r.events ?? []));
      }
      return events;
    },
  };

  const ponte = criarPonteInterna(db, depsPonte);
  const autorizarMaquina = (token: string) => autorizarChaveMaquina(db, token, relogio());
  const ponteHttp = criarPonteHttpServidor({
    criar: (escopo) => criarPonteInterna(db, { ...depsPonte, listarPessoas: async () => [{ id: escopo.pessoaId, tenantId: escopo.tenantId }] }),
    persistir: (escopo, inv) => dentro(escopo, async (d) => { await d.repos.inventario.registrar("claude-cli", inv); }),
    autorizar: autorizarMaquina,
    segredo: segredoEfetivo(env.NOD_LOGIN === "google" ? "google" : "stub", env.NOD_SESSAO_SEGREDO),
    seguro: env.NOD_LOGIN === "google",
    agora: relogio,
    delta: (plano, texto) => publicarDoPlano(plano, "turno.delta", { texto }),
    ferramenta: (plano, nome) => publicarDoPlano(plano, "turno.atividade", { nome, rotulo: rotuloFerramenta(nome) }),
    tarefas: (plano, tarefas) => publicarDoPlano(plano, "turno.tarefas", { tarefas }),
    fala: (plano) => publicarDoPlano(plano, "turno.fala", {}),
    longpollMs: env.NOD_LONGPOLL_MS ? numero(env.NOD_LONGPOLL_MS, 20_000) : undefined,
    // ADR-048: itens aprovados que rodam no gh do Mac da dona — a máquina puxa, executa e relata.
    itensLocais: (escopo) => dentro(escopo, (d) => itensParaAMaquina(d)),
    concluirItemLocal: (escopo, itemId, desfecho) => dentro(escopo, async (d) => {
      const r = await concluirItemNaMaquina(d, { itemId, desfecho });
      if (r.events.length) await d.repos.events.gravarComOutbox(r.events);
    }),
  });

  // ---- Ligação por voz (definido em 2026-10-04, ADR-071/072) ----------------------------------------------------------
  // NOD_LIGACAO: desligada | admins | todas. Padrão: todas fora de produção; em produção, só admins (fase 1, atrás de flag).
  const modoLigacao = env.NOD_LIGACAO ?? (env.NODE_ENV === "production" ? "admins" : "todas");
  const adminsVoz = (env.NOD_ADMINS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  const maxLigacaoS = numero(env.NOD_LIGACAO_MAX_S, 30 * 60);
  const limiteDiarioMs = numero(env.NOD_LIGACAO_MINUTOS_DIA, 60) * 60_000;
  const maxSimultaneas = numero(env.NOD_LIGACAO_SIMULTANEAS, 20);
  const provedoresVoz = criarProvedoresVoz(env);
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
      await rodarCaso(escopoDaRef(ref), encerrarLigacao, { ligacaoId: ref.ligacaoId, motivo, metricas });
    },
    async mandarNoChat(ref, texto) { await rodarCaso(escopoDaRef(ref), mandarNoChatDaLigacao, { ligacaoId: ref.ligacaoId, agenteId: ref.agenteId, conversaId: ref.conversaId, turnoId: ref.turnoId, texto }); },
  };
  const voz = criarServicoVoz({ provedores: provedoresVoz, persistencia: persistenciaVoz, esperas: esperasVoz, relogio });
  // ADR-074: os cards da conversa da ligação viram leitura + janela de aprovação por voz. O orquestrador não lê banco:
  // a composição escuta os frames da pessoa e monta a leitura (leituraDaDecisao) numa tx dela.
  const inscricoesVoz = new Map<string, () => void>();
  const decididasPorVoz = new Set<string>();
  function lerParaVoz(escopo: Escopo, ligacaoId: string, decisaoId: string): void {
    rodarCaso(escopo, leituraDaDecisao, { decisaoId })
      .then((p) => { if (p) voz.pedirAprovacao(ligacaoId, p); })
      .catch((e: unknown) => log("aviso", "voz_leitura_falhou", { ligacao_id: ligacaoId, erro: e instanceof Error ? e.name : "desconhecido" }));
  }
  function acompanharDecisoes(escopo: Escopo, ligacaoId: string, conversaId: string): void {
    // Ao ligar, as pendências da conversa entram na fila de leitura.
    dentro(escopo, (d) => d.repos.decisoes.listarSuaVez(relogio()))
      .then((ds) => { for (const x of ds) if (x.conversaId === conversaId) lerParaVoz(escopo, ligacaoId, x.id); })
      .catch(() => undefined);
    const sair = barramento.inscrever(escopo.pessoaId, (f) => {
      if (f.dados.conversaId !== conversaId) return;
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
  async function contextoLigacao(escopo: Escopo, agenteId: string): Promise<ContextoLigacao> {
    const agente = await dentro(escopo, (d) => d.repos.agentes.buscar(agenteId));
    const harness = agente?.harness && agente.harness !== "auto" ? agente.harness : driverPreferido;
    const prontos = compartilhado ? ponteHttp.harnessesDaPessoa(escopo.pessoaId) : null;
    const iaPronta = executorAtual === "catcher" ? true : compartilhado ? prontos?.[harness as IdDriver & keyof typeof prontos]?.estado === "pronto" : inventarioPorDriver[harness as IdDriver]?.estado === "pronto";
    return {
      habilitada: modoLigacao !== "desligada",
      permitido: modoLigacao === "todas" || (modoLigacao === "admins" && (await ehAdminVoz(escopo))),
      maquinaComLigacao: compartilhado ? ponteHttp.ligacaoDaPessoa(escopo.pessoaId) : ponte.maquinasConectadas().some((m) => m.ligacao === true),
      iaPronta,
      // ADR-076 (fase 4): o laço de voz do Codex é o app-server (drivers/codex-ligacao.ts). Liga por padrão;
      // NOD_LIGACAO_CODEX=0 é a chave de desligar (o app-server é experimental na OpenAI).
      codexSemVoz: executorAtual !== "catcher" && harness === "codex-cli" && env.NOD_LIGACAO_CODEX === "0",
      drenando: voz.drenando(),
      vozDisponivel: true,
      vivasNoServidor: voz.vivas(),
      maxSimultaneas,
      limiteDiarioMs,
      inicioDoDia: inicioDoDiaSp(relogio()),
      provedorStt: provedoresVoz.stt.id,
      provedorTts: provedoresVoz.tts.id,
    };
  }

  const varredorMaquinas = compartilhado ? setInterval(() => {
    void ponteHttp.varrer().catch(() => log("aviso", "presenca_maquinas_falhou", {}));
  }, 15_000) : null;
  varredorMaquinas?.unref();

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
    const opcoes = HARNESSES.map((h) => ({ ...h, inventario: remotos ? remotos[h.id] ?? { estado: "ausente" as const, motivo: "Não conectado neste computador", em: relogio() } : inventarioDe(h.id) }));
    return { simulacao: !compartilhado && executorAtual === "catcher", padrao: opcoes.find((h) => h.id === driverPreferido && h.inventario.estado === "pronto")?.id ?? opcoes.find((h) => h.inventario.estado === "pronto")?.id ?? null, opcoes };
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
    if (id === anterior) return estadoExecutor();
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
  };
  const depsL7: DepsRotasL7 = { executor: () => executorAtual, txPara: (escopo) => abrirTxEscopada(db, escopo), services, useCases, agora: relogio };
  const rotas: Rota[] = [
    ...criarRotasFrota(depsRotas),
    criarRotaInventario({ inventario }),
    criarRotaAmbiente(env),
    ...(compartilhado ? [
      ...ponteHttp.rotas,
      { metodo: "GET", padrao: /^\/executor$/, async handler(ctx) {
        const catalogo = catalogoHarness(ctx.escopo.pessoaId);
        ctx.json(200, { atual: catalogo.padrao ?? "claude-cli", opcoes: catalogo.opcoes.filter((h) => h.integrado).map((h) => ({ id: h.id, custo: "real", inventario: h.inventario })), recusa: null, harnesses: catalogo });
      } } satisfies Rota,
    ] : criarRotasExecutor({ estado: estadoExecutor, trocar: trocarExecutor })),
    ...criarRotasAgentes(depsRotas, computadores.desligarExcluido),
    ...criarRotasPendencias(depsRotas),
    ...criarRotasConversas(depsRotas),
    ...criarRotasArtefatos(depsRotas),
    ...criarRotasRelatos(depsRotas),
    ...criarRotasPropostas(depsRotas),
    ...criarRotasTurnos(depsRotas),
    ...criarRotasRaioX(depsRotas),
    ...criarRotasComandos(depsRotas),
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
    }),
    ...rotasConcessoes({ dentro }),
    ...rotasMarketplace({ dentro, cifrar: (t) => cifrar(t, chave), decifrar: (t) => decifrar(t, chave), admins: (env.NOD_ADMINS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean), aoTrocarApp: (t) => cofreDoApp.esquecer(t) }),
    ...rotasConectores({ dentro, cifrar: (t) => cifrar(t, chave), decifrar: (t) => decifrar(t, chave) }),
    ...rotasTrilha({ dentro }),
    ...rotasMaquinas({ dentro, pareamento: criarPareamentoMaquina(relogio) }),
    // definido em 2026-09-16: NOD_LONGPOLL_MS encurta a fatia do long-poll de aprovação (testes/e2e); default LONGPOLL_APROVACAO_MS.
    ...rotasComputadores(computadores),
    ...rotasWorkspaces(workspaces, dentro),
    ...rotasInternas({ dentro, computadores, workspaces, tokens, agora: relogio, longpollMs: env.NOD_LONGPOLL_MS ? numero(env.NOD_LONGPOLL_MS, 20_000) : undefined }),
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
    criarRotaEventos(barramento),
    criarRotaMetricas(),
    criarRotaDev(dentro, {
      get executor() {
        return idDriverAtual();
      },
    }),
  ];

  function publicarDoPlano(plano: PlanoTurno, tipo: "turno.delta" | "turno.atividade" | "turno.tarefas" | "turno.fala", dados: Record<string, unknown>): void {
    barramento.publicar(plano.autoria.conta_de_execucao, tipo, { turnoId: plano.turnoId, conversaId: plano.conversaId, agenteId: plano.agenteId, executor: plano.executor, machineId: plano.machineId, ...dados });
  }

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
  // Pool elástico por pessoa (2026-09-24): um laço ocioso sempre puxando, mais um por turno rodando.
  const iniciar: IniciarLaco = (p) =>
    iniciarPoolDeLacos((ponte) => iniciarLaco({
      ...p,
      ponte,
      aoDelta: (plano, texto) => publicarDoPlano(plano, "turno.delta", { texto }),
      aoFalaGravada: (plano) => publicarDoPlano(plano, "turno.fala", {}),
      aoEvento: (plano, ev: EventoStream) => {
        if (ev.tipo === "catcher") aoRegistrarCatcher({ turnoId: plano.turnoId, tipo: ev.subtipo, dados: ev.dados });
        else if (ev.tipo === "tool_use") publicarDoPlano(plano, "turno.atividade", { nome: ev.nome, rotulo: rotuloFerramenta(ev.nome) });
        tarefasVivas.evento(plano.turnoId, ev);
      },
      aoIniciarTurno: (plano, adapter) => { interruptor.registrar(plano.turnoId, () => adapter.interromper()); planosVivos.set(plano.turnoId, plano); },
      aoTerminarTurno: (plano) => { interruptor.esquecer(plano.turnoId); tarefasVivas.esquecer(plano.turnoId); planosVivos.delete(plano.turnoId); },
    }), p.ponte);

  return {
    services,
    useCases,
    dentro,
    depsDe,
    ponte,
    rotas,
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
    anexarVoz(server, resolverEscopo) {
      return anexarCanaisVoz(server, {
        resolverEscopo,
        autorizarTokenTurno: (token) => tokens.autorizar(token),
        ligacaoDoTurno: (turnoId) => tokens.planoDe(turnoId)?.ligacaoVoz?.ligacaoId ?? null,
        anexarMidia: ({ escopo, ligacaoId, retomar, canal }) => voz.anexarMidia({ pessoaId: escopo.pessoaId, ligacaoId, retomar, canal }),
        anexarCerebro: ({ identidade, ligacaoId, canal }) => voz.anexarCerebro({ turnoId: identidade.turnoId, ligacaoId, canal }),
      });
    },
    async fechar() {
      await voz.fechar();
      await provedoresVoz.encerrar();
      if (varredorMaquinas) clearInterval(varredorMaquinas);
      await conectoresVivos.fechar();
    },
  };
}
