import type { Executor, RuntimeEvent } from "../../contracts/evento.ts";
import type { Inventario } from "../../contracts/inventario.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import type { EventoStream } from "../../contracts/turno.ts";
import { chaveDe, cifrar, decifrar } from "../../db/cifra.ts";
import { abrirTxEscopada } from "../../db/tx.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { contextoAtual } from "../../obs/contexto.ts";
import { log } from "../../obs/log.ts";
import { criarRepos } from "../../repositories/index.ts";
import { listarTodas } from "../../repositories/pessoas.repo.ts";
import { criarBarramento, type Barramento } from "../../services/barramento.ts";
import { criarConectoresVivos, type ConectoresVivos } from "../../services/conectores-vivos.ts";
import { criarInterruptor, type InterruptorNod } from "../../services/interruptor.ts";
import { criarInventario, type ServicoInventario } from "../../services/inventario.ts";
import { criarTokenTurno, type TokenTurno } from "../../services/token-turno.ts";
import type { Db, Escopo, Relogio, Tx } from "../../shared/types.ts";
import { servicoRotinas } from "../../use-cases/ativar-rotina.ts";
import { atualizarPerfil } from "../../use-cases/atualizar-perfil.ts";
import { motorDe } from "../../use-cases/autoria-evento.ts";
import { criarRotina } from "../../use-cases/criar-rotina.ts";
import { registrarDesfechoRotina } from "../../use-cases/disparar-rotina.ts";
import { emitirPlanoTurno } from "../../use-cases/emitir-plano-turno.ts";
import { encaminhar } from "../../use-cases/encaminhar.ts";
import { entregarRespostaPeer } from "../../use-cases/entregar-resposta-peer.ts";
import { lembrar } from "../../use-cases/lembrar.ts";
import { passar } from "../../use-cases/passar.ts";
import { pedirAcesso } from "../../use-cases/pedir-acesso.ts";
import { pedirAPessoa } from "../../use-cases/pedir-a-pessoa.ts";
import { pedirAprovacao } from "../../use-cases/pedir-aprovacao.ts";
import { perguntarABot } from "../../use-cases/perguntar-a-bot.ts";
import { servicoSala } from "../../use-cases/servico-sala.ts";
import type { Deps, Services, UseCasesNod } from "../../use-cases/tipos.ts";
import type { RegistroCatcher } from "../executor/drivers/catcher.ts";
import { iniciarLaco } from "../executor/laco.ts";
import type { IdDriver, Registry } from "../executor/spi.ts";
import type { IniciarLaco } from "../fundo/orquestrador-turnos.ts";
import { criarPonteInterna, type PonteInternaNod } from "../fundo/ponte-interna.ts";
import type { Rota } from "./roteador.ts";
import { criarRotasAgentes } from "./rotas/agentes.ts";
import { rotasMaquinas } from "./rotas/maquinas.ts";
import { rotasConcessoes } from "./rotas/concessoes.ts";
import { rotasConectores } from "./rotas/conectores.ts";
import { criarRotasConversas } from "./rotas/conversas.ts";
import { criarRotasDecisoes } from "./rotas/decisoes.ts";
import type { DentroDeTx } from "./rotas/dentro-de-tx.ts";
import { criarRotaDev } from "./rotas/dev.ts";
import { criarRotaEventos } from "./rotas/eventos.ts";
import type { DepsRotas } from "./rotas/executar-caso.ts";
import { criarRotasFrota } from "./rotas/frota.ts";
import { rotasInternas } from "./rotas/interno.ts";
import { criarRotaInventario } from "./rotas/inventario.ts";
import { criarRotaMetricas } from "./rotas/metricas.ts";
import { criarRotasPropostas } from "./rotas/propostas.ts";
import { criarRotasRotinas, type DepsRotasL7 } from "./rotas/rotinas.ts";
import { criarRotasSalas } from "./rotas/salas.ts";
import { criarRotasSuaVez } from "./rotas/sua-vez.ts";
import { rotasTrilha } from "./rotas/trilha.ts";
import { criarRotasTurnos } from "./rotas/turnos.ts";

/**
 * Composição do app (L9): UMA função monta Services concreto, UseCasesNod completo, a ponte
 * in-process, a fábrica `dentro` (abre abrirTxEscopada e monta Deps — a única porta das rotas ao
 * banco) e a lista de rotas de TODAS as lanes. Nada aqui é lógica de produto: só ligação.
 *
 * Fatias de Services: planos ← L5 (emitirPlanoTurno), rotinas ← L7 (servicoRotinas), conectores ← L5
 * (conectores-vivos), interruptor ← L6, catcher ← L3/L4 (catcherRepo), tokenTurno ← L5, sala ← L7
 * (servicoSala), barramento ← L8. UseCasesNod: lembrar/atualizarPerfil ← L6; criarRotina/passar/
 * encaminhar/perguntarABot ← L7; pedirAcesso/pedirAprovacao/pedirAPessoa ← L5 (EMENDA 5).
 *
 * O registry chega DEPOIS (ligarRegistry): o driver catcher precisa da URL do servidor, que só existe
 * depois do listen — em produção a porta é fixa, no teste é 0 (EMENDA 34).
 */
export type EnvApp = Readonly<Record<string, string | undefined>>;

export type OpcoesCompor = {
  db: Db;
  env: EnvApp;
  relogio?: Relogio;
  /** Fonte das pessoas (tenant de um pessoaId); só em teste. Default: tabela pessoas. */
  listarPessoas?: () => Promise<{ tenantId: string; id: string }[]>;
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
  /** 'local' (claude-cli) ou 'catcher' — o que NOD_EXECUTOR pediu. */
  executor: Executor;
  idDriver: IdDriver;
  machineId: string;
  /** Liga o registry sondado (boot) e o snapshot inicial da sonda. */
  ligarRegistry(registry: Registry, inventarioInicial?: Inventario): void;
  registry(): Registry | null;
  /** O laço da L4 com os sinks da composição (deltas → barramento; adapter → interruptor). */
  iniciarLaco: IniciarLaco;
  /** Ligação do driver catcher: cada passo vira linha em catcher_registros na tx escopada do turno. */
  aoRegistrarCatcher(r: RegistroCatcher): void;
  tenantDe(pessoaId: string): Promise<string | null>;
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
  const relogio: Relogio = o.relogio ?? (() => Date.now());
  const executor: Executor = env.NOD_EXECUTOR === "claude-cli" ? "local" : "catcher";
  const idDriver: IdDriver = executor === "local" ? "claude-cli" : "catcher";
  const machineId = env.NOD_MACHINE_ID ?? "";
  const prazoDecisaoMs = numero(env.NOD_PRAZO_DECISAO_MS, 86_400_000);
  const modeloPadrao = env.NOD_MODELO ?? "claude-haiku-4-5-20251001";
  const chave = chaveDe(env.NOD_CREDENTIAL_KEY ?? "chave-de-desenvolvimento-sem-valor");
  let registryLigado: Registry | null = null;
  let inventarioInicial: Inventario | null = null;
  // medido em 2026-09-16 (e2e:haiku): GET inventario entre o listen e a sonda do boot cacheava 'ausente: servidor ainda
  // sem registry' por 5 min. A sonda agora ESPERA o registry ser ligado em vez de responder um estado provisório.
  let ligarRegistryResolvido: () => void = () => undefined;
  const registryPronto = new Promise<void>((r) => {
    ligarRegistryResolvido = r;
  });

  const barramento = criarBarramento();
  const interruptor = criarInterruptor();
  const tokens = criarTokenTurno({ agora: relogio });

  // tenant de uma pessoa (pessoas é catálogo sem RLS por pessoa); cache com recarga quando não achar.
  const tenants = new Map<string, string>();
  const listar = o.listarPessoas ?? (() => listarTodas(db));
  async function tenantDe(pessoaId: string): Promise<string | null> {
    if (!tenants.has(pessoaId)) for (const p of await listar()) tenants.set(p.id, p.tenantId);
    return tenants.get(pessoaId) ?? null;
  }

  const useCases: UseCasesNod = { lembrar, atualizarPerfil, pedirAcesso, criarRotina, pedirAprovacao, pedirAPessoa, passar, encaminhar, perguntarABot };

  const depsDe = (trx: Tx, escopo: Escopo): Deps => ({ repos: criarRepos(trx, escopo), services, useCases, tx: (fn) => fn(trx), escopo, agora: relogio });
  const depsSobre = (trx: Tx): Deps => depsDe(trx, escopoDoContexto());
  const gravar = async (trx: Tx, events: RuntimeEvent[]): Promise<void> => {
    if (events.length) await criarRepos(trx, escopoDoContexto()).events.gravarComOutbox(events);
  };

  // Conectores vivos (L5): quem carrega e DECIFRA o env é este callback — o conector é da pessoa que o
  // registrou, então a busca corre as pessoas do servidor (ids são uuid: acha em uma).
  const donoDoConector = new Map<string, Escopo>();
  const conectoresVivos = criarConectoresVivos({
    agora: relogio,
    ambiente: env,
    async carregar(conectorId) {
      const escopos = donoDoConector.has(conectorId) ? [donoDoConector.get(conectorId) as Escopo] : (await listar()).map((p) => ({ tenantId: p.tenantId, pessoaId: p.id }));
      for (const escopo of escopos) {
        const c = await abrirTxEscopada(db, escopo)((trx) => criarRepos(trx, escopo).conectores.buscar(conectorId));
        if (!c) continue;
        donoDoConector.set(conectorId, escopo);
        const envDecifrado = c.envCifrado ? (JSON.parse(decifrar(c.envCifrado, chave)) as Record<string, string>) : {};
        return { nome: c.slug, transporte: c.transporte, comando: c.comando, args: c.args, url: c.url, env: envDecifrado };
      }
      return null;
    },
  });

  const services: Services = {
    relogio,
    tokenTurno: tokens,
    planos: {
      async emitir(trx, turnoId, machineIdDoPlano) {
        const d = depsSobre(trx);
        const r = await emitirPlanoTurno(d, { turnoId, machineId: machineIdDoPlano, executor });
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

  // Depois de assentar (mesma tx): rotina registra desfecho (L7), peer entrega a resposta (L7).
  const ponte = criarPonteInterna(db, {
    services,
    useCases,
    executor,
    agora: relogio,
    listarPessoas: o.listarPessoas,
    esquecerTurno: (id) => interruptor.esquecer(id),
    async depoisDeAssentar(d, { entrega, saida }) {
      const turno = saida.turno;
      if (!turno || saida.tardia) return [];
      const events: RuntimeEvent[] = [];
      if (turno.origem === "rotina" || turno.origem === "retomada") {
        const desfecho = turno.estado === "concluido" ? "executou" : "falhou";
        const r = await registrarDesfechoRotina(d, { turnoId: turno.id, desfecho, motivo: desfecho === "falhou" ? (turno.motivoFalha ?? null) : null });
        if ("execucao" in r.data) events.push(...(r.events ?? []));
      }
      if (turno.origem === "peer" && turno.estado === "concluido" && entrega.fala.tipo === "texto" && entrega.fala.texto.trim() !== "") {
        const r = await entregarRespostaPeer(d, { tarefaId: turno.id, texto: entrega.fala.texto });
        if (!("ignorado" in r.data)) events.push(...(r.events ?? []));
      }
      return events;
    },
  });

  // Inventário por pessoa (ADR-019): a sonda é da MÁQUINA (uma por TTL, compartilhada entre pessoas — cada
  // sonda do claude-cli custa um turno real); a persistência é por pessoa em inventario_motores.
  let sondaCompartilhada: { em: number; promessa: Promise<Inventario> } | null = null;
  const TTL_SONDA_MS = 300_000;
  // definido em 2026-09-16: quem chega antes do registry espera até PRAZO_REGISTRY_MS (a sonda do boot custa um
  // turno real e leva segundos); vencido o prazo responde 'ausente' SEM cachear, para a próxima chamada tentar de
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
    const registro = registryLigado?.[idDriver];
    const promessa: Promise<Inventario> = !registro
      ? Promise.resolve({ estado: "ausente", motivo: "driver não registrado", em: agora })
      : registro.estado === "sombra"
        ? Promise.resolve({ estado: "ausente", motivo: registro.motivo, em: agora })
        : registro.instance.sondar();
    sondaCompartilhada = { em: agora, promessa };
    return promessa;
  }
  const inventario = criarInventario({
    relogio,
    sondar: async () => {
      if (inventarioInicial && relogio() - inventarioInicial.em < TTL_SONDA_MS && !sondaCompartilhada) {
        sondaCompartilhada = { em: inventarioInicial.em, promessa: Promise.resolve(inventarioInicial) };
      }
      return sondarMaquina();
    },
    persistir: async (pessoaId, inv) => {
      const tenantId = await tenantDe(pessoaId);
      if (!tenantId) return;
      const escopo = { tenantId, pessoaId };
      await abrirTxEscopada(db, escopo)((trx) => criarRepos(trx, escopo).inventario.registrar(motorDe(executor), inv));
    },
  });

  const depsRotas: DepsRotas = { abrirTx: (escopo) => abrirTxEscopada(db, escopo), services, useCases, agora: relogio, modeloPadrao, prazoDecisaoMs, executor };
  const depsL7: DepsRotasL7 = { txPara: (escopo) => abrirTxEscopada(db, escopo), services, useCases, agora: relogio };
  const rotas: Rota[] = [
    ...criarRotasFrota(depsRotas),
    criarRotaInventario({ inventario }),
    ...criarRotasAgentes(depsRotas),
    ...criarRotasConversas(depsRotas),
    ...criarRotasPropostas(depsRotas),
    ...criarRotasTurnos(depsRotas),
    ...rotasConcessoes({ dentro }),
    ...rotasConectores({ dentro, cifrar: (t) => cifrar(t, chave) }),
    ...rotasTrilha({ dentro }),
    ...rotasMaquinas({ dentro }),
    // definido em 2026-09-16: NOD_LONGPOLL_MS encurta a fatia do long-poll de aprovação (testes/e2e); default LONGPOLL_APROVACAO_MS.
    ...rotasInternas({ dentro, tokens, agora: relogio, longpollMs: env.NOD_LONGPOLL_MS ? numero(env.NOD_LONGPOLL_MS, 20_000) : undefined }),
    ...criarRotasRotinas(depsL7),
    ...criarRotasSalas(depsL7),
    ...criarRotasSuaVez(dentro),
    ...criarRotasDecisoes({ dentro, services, prazoDecisaoMs, executor }),
    criarRotaEventos(barramento),
    criarRotaMetricas(),
    criarRotaDev(dentro, { executor: idDriver }),
  ];

  function publicarDoPlano(plano: PlanoTurno, tipo: "turno.delta", dados: Record<string, unknown>): void {
    barramento.publicar(plano.autoria.conta_de_execucao, tipo, { turnoId: plano.turnoId, conversaId: plano.conversaId, agenteId: plano.agenteId, executor: plano.executor, machineId: plano.machineId, ...dados });
  }

  function aoRegistrarCatcher(r: RegistroCatcher): void {
    const escopo = ponte.escopoDoTurno(r.turnoId);
    if (!escopo) return;
    abrirTxEscopada(db, escopo)((trx) => services.catcher.registrar(trx, r.turnoId, r.tipo, r.dados)).catch((e: unknown) => {
      log("aviso", "catcher_registro_falhou", { turno_id: r.turnoId, tipo: r.tipo, erro: e instanceof Error ? e.name : "desconhecido" });
    });
  }

  const iniciar: IniciarLaco = (p) =>
    iniciarLaco({
      ...p,
      aoDelta: (plano, texto) => publicarDoPlano(plano, "turno.delta", { texto }),
      aoEvento: (plano, ev: EventoStream) => {
        if (ev.tipo === "catcher") aoRegistrarCatcher({ turnoId: plano.turnoId, tipo: ev.subtipo, dados: ev.dados });
      },
      aoIniciarTurno: (plano, adapter) => interruptor.registrar(plano.turnoId, () => adapter.interromper()),
      aoTerminarTurno: (plano) => interruptor.esquecer(plano.turnoId),
    });

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
    executor,
    idDriver,
    machineId,
    ligarRegistry(registry, inicial) {
      registryLigado = registry;
      inventarioInicial = inicial ?? null;
      sondaCompartilhada = null;
      ligarRegistryResolvido();
    },
    registry: () => registryLigado,
    iniciarLaco: iniciar,
    aoRegistrarCatcher,
    tenantDe,
    async fechar() {
      await conectoresVivos.fechar();
    },
  };
}
