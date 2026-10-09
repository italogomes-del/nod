import type { Executor, RuntimeEvent } from "../../contracts/evento.ts";
import type { IdHarness } from "../../contracts/harness.ts";
import { MOTIVO_DA_CAUSA, type CausaSemIa, type Inventario } from "../../contracts/inventario.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import type { AnuncioMaquina, Entrega, PastaParaLimpar, PedidoRenovar, PonteInterna, RelatoLimpeza, RespostaRenovar } from "../../contracts/ponte.ts";
import { abrirTxEscopada } from "../../db/tx.ts";
import { redigirECortar } from "../../domain/segredos.ts";
import { log } from "../../obs/log.ts";
import { metricas as registroPadrao } from "../../obs/metricas.ts";
import { criarRepos } from "../../repositories/index.ts";
import { listarTodas, type Pessoa } from "../../repositories/pessoas.repo.ts";
import { LEASE_MS } from "../../shared/constantes.ts";
import type { Db, Escopo, Relogio, Tx } from "../../shared/types.ts";
import { assentarTurno, type SaidaAssentarTurno } from "../../use-cases/assentar-turno.ts";
import { despacharTurno } from "../../use-cases/despachar-turno.ts";
import { absorverNaSessao, confirmarNaSessao, gravarFalasDaSessao } from "../../use-cases/sessao-viva.ts";
import { absorverNoTrabalho, promoverNaRede } from "../../use-cases/coordenar-trabalhos.ts";
import { eventoPressao, sincronizarTrabalho } from "../../use-cases/trabalhos.ts";
import { camposDoRelato, pastasParaLimpar, relatoValido } from "../../use-cases/limpeza-das-tasks.ts";
import { REDE_MS } from "../../domain/trabalho.ts";
import type { MudancaDePressao } from "./trabalhos-vivos.ts";
import type { LeituraMemoria, NivelPressao } from "../../contracts/trabalho.ts";
import type { UsoDoMac } from "../../contracts/raio-x.ts";
import { USO_DO_MAC_PADRAO } from "../../contracts/raio-x.ts";
import { deveSegurar, ESPACO_FUNDO_MS } from "../../domain/memoria-mac.ts";
import type { Deps, Services, UseCasesNod } from "../../use-cases/tipos.ts";

/** definido em 2026-09-16: versão mínima do app = a do package.json desta rodada; a ponte HTTP compara quando entrar (ADR-021). */
export const VERSAO_MINIMA_APP = "0.1.0";

export type DepsPonte = {
  services: Services;
  useCases: UseCasesNod;
  agora?: Relogio;
  /** 'local' (claude-cli) ou 'catcher' — o que a máquina conectada de fato roda. Função = valor VIVO (o interruptor de executor troca em tempo de execução). */
  executor?: Executor | (() => Executor);
  /** Fonte das pessoas para resolver tenant de um pessoaId; só em teste (default: tabela pessoas). */
  listarPessoas?: () => Promise<Pick<Pessoa, "tenantId" | "id">[]>;
  /** Depois de entregar: soltar o processo do interruptor (criarInterruptor().esquecer). */
  esquecerTurno?: (turnoId: string) => void;
  /**
   * definido em 2026-09-16 (composição L9): roda na MESMA tx logo depois de assentarTurno, com as Deps e
   * a saída, e devolve eventos a gravar — é onde a rotina registra desfecho (registrarDesfechoRotina) e o
   * turno peer entrega a resposta (entregarRespostaPeer), sem a ponte importar casos de uso da L7.
   */
  depoisDeAssentar?: (deps: Deps, p: { entrega: Entrega; saida: SaidaAssentarTurno }) => Promise<RuntimeEvent[]>;
  /**
   * definido em 2026-10-05: `false` na ponte das máquinas remotas — o motivo cru que o Mac manda vai para o diagnóstico
   * gravado da pessoa e NUNCA para o log do servidor (decisão de 2026-09-17 em ponte-validacao.ts). Padrão: loga (o
   * executor do próprio processo, em desenvolvimento).
   */
  erroCruNoLog?: boolean;
  /**
   * NOD-171: os harnesses de todas as máquinas vivas da pessoa (na ponte HTTP, `harnessesDaPessoa` das conexões).
   * Somados aos das máquinas desta ponte, deixam o despacho recusar o turno fixado num harness que nenhuma tem pronto.
   */
  harnessesDaPessoa?: (pessoaId: string) => Partial<Record<IdHarness, Inventario>>;
  /** ADR-083 (#193): o turno já chamou alguma ferramenta? (o compositor sabe pelo `turno.atividade`). Ausente = não. */
  fezFerramenta?: (turnoId: string) => boolean;
  /** ADR-083 (#194): guarda a leitura de memória do Mac e diz se o nível que a pessoa vê mudou. */
  registrarMemoria?: (pessoaId: string, machineId: string, leitura: LeituraMemoria) => MudancaDePressao;
  /** ADR-085: a última leitura viva deste Mac (memória e processador); null = sem leitura, e então nada é segurado. */
  pressaoDaMaquina?: (machineId: string) => { memoria: NivelPressao; processador: NivelPressao | null } | null;
  /** Revisão do #209: o evento da mudança de pressão não foi gravado (a tx desfez) — a próxima leitura refaz o frame. */
  desfazerMemoria?: (pessoaId: string, mudanca: MudancaDePressao) => void;
  /** Revisão do #209: o Mac desconectou — a leitura dele sai. */
  esquecerMaquina?: (machineId: string) => void;
  /** ADR-085: quando a pessoa trocou o "uso do Mac" (gravado); o que foi lido antes não vale mais. Ausente = 0. */
  usoTrocadoEm?: (pessoaId: string) => number;
  /** Só o e2e (definido em 2026-10-08): a rede de 2 min com outro prazo, para não esperar 120 s. Ausente = REDE_MS. */
  redeMs?: number;
};

export type PonteInternaNod = PonteInterna & {
  maquinasConectadas(): AnuncioMaquina[];
  escopoDoTurno(turnoId: string): Escopo | null;
  /** Quantos turnos cada mapa da ponte guarda (revisão do épico, S21): o log de saúde e os testes olham por aqui. */
  emMemoria?(): { escopos: number; oferecidas: number; despachados: number };
};

/** definido em 2026-10-08 (revisão do épico, S20): o assentar vítima de impasse é repetido até isto de vezes. */
const TENTATIVAS_DO_ASSENTAR = 3;
/**
 * ADR-085 (revisão do #209): o "uso do Mac" lido vale 30 s no puxar. A troca pela tela vale na hora (`usoTrocadoEm`); os
 * 30 s só cobrem quem mudou por fora da rota (direto no banco).
 */
export const USO_VALE_MS = 30_000;

/** 40P01 (impasse) e 40001 (serialização): a transação perdeu a corrida e pode ser repetida inteira. */
function ehConflitoTransitorio(err: unknown): boolean {
  const codigo = typeof err === "object" && err !== null ? (err as { code?: unknown }).code : undefined;
  return codigo === "40P01" || codigo === "40001";
}

/**
 * PonteInterna in-process (ADR-021, EMENDA 3): os cinco verbos falados por chamada de função, sem
 * socket. puxar abre a tx ESCOPADA da pessoa (abrirTxEscopada) e roda despacharTurno; renovar renova o
 * lease e grava os eventos da máquina pelo outbox; entregar assenta. O escopo de cada turno puxado fica
 * em memória: renovar/entregar de turno desconhecido (de antes de um reinício) é fail-closed —
 * {ativo:false} / entrega descartada com log — e o varredor de lease encerra o turno órfão.
 */
export function criarPonteInterna(db: Db, deps: DepsPonte): PonteInternaNod {
  const agora: Relogio = deps.agora ?? (() => Date.now());
  const executorAtual = (): Executor => (typeof deps.executor === "function" ? deps.executor() : (deps.executor ?? "catcher"));
  const maquinas = new Map<string, AnuncioMaquina>();
  const escopos = new Map<string, Escopo>();
  /** Executor do PLANO de cada turno puxado: a entrega assenta com ele, não com o executor vigente (que pode ter sido trocado no meio). */
  const executores = new Map<string, Executor>();
  /** Harness do plano puxado (0030): a sessão que o turno devolver é deste harness. */
  const harnesses = new Map<string, IdHarness>();
  const tenantsPorPessoa = new Map<string, string>();
  /** ADR-067: o maior `seq` de fala intermediária já gravado por turno (some na entrega). */
  const falasGravadas = new Map<string, number>();
  /**
   * #189: as mensagens da fila já entregues ao app neste turno e ainda não confirmadas — não vão de novo na próxima
   * renovação. Somem na entrega; a não confirmada continua `pendente` no banco e vira turno próprio.
   */
  const oferecidas = new Map<string, Set<string>>();
  /**
   * ADR-083 (#193): quando o turno foi puxado e a sessão que o plano retomou (nula se ele bifurcou ou começou uma) —
   * a rede de 2 min promove o turno de conversa e entrega essa sessão ao trabalho `rede`. Somem na entrega.
   */
  const despachados = new Map<string, { em: number; sessaoCli: string | null; bifurcou: boolean }>();
  /**
   * Revisão do épico (S21, 2026-10-08): a última vez que o turno foi puxado ou renovado. Passado o lease sem notícia, o
   * varredor de lease o encerra no banco e a entrega talvez nunca chegue: `oferecidas` e `despachados` dele saem aqui
   * (o escopo fica: a entrega tardia ainda assenta, ADR-045). Antes só a entrega os limpava.
   */
  const vistos = new Map<string, number>();
  /**
   * ADR-085 (revisão do #209): o "uso do Mac" de cada pessoa, lido no máximo a cada USO_VALE_MS e fora da tx do puxar
   * (antes era uma consulta por puxar apertado, dentro da trava da fila; e um erro dela virava "nenhum trabalho").
   */
  const usos = new Map<string, { uso: UsoDoMac; ate: number; lidoEm: number }>();
  /** ADR-085 (revisão do #209): quando o último trabalho novo em segundo plano começou em cada Mac (o espaço entre eles). */
  const ultimoFundo = new Map<string, number>();
  /** ADR-085 (revisão do #209): se cada Mac está segurando agora — o log sai só na mudança. */
  const segurando = new Map<string, boolean>();
  function esquecerVencidos(): void {
    const limite = agora() - LEASE_MS;
    for (const [turnoId, em] of vistos) {
      if (em >= limite) continue;
      vistos.delete(turnoId);
      oferecidas.delete(turnoId);
      despachados.delete(turnoId);
    }
  }

  /** NOD-171: os harnesses das máquinas desta ponte somados aos da pessoa nas outras conexões; o pronto vence. */
  function harnessesDaPessoa(pessoaId: string): Partial<Record<IdHarness, Inventario>> {
    const todos: Partial<Record<IdHarness, Inventario>> = { ...(deps.harnessesDaPessoa?.(pessoaId) ?? {}) };
    for (const m of maquinas.values()) for (const [h, inv] of Object.entries(m.harnesses ?? {})) {
      const id = h as IdHarness;
      if (inv && todos[id]?.estado !== "pronto") todos[id] = inv;
    }
    return todos;
  }

  async function resolverEscopo(pessoaId: string): Promise<Escopo | null> {
    if (!tenantsPorPessoa.has(pessoaId)) {
      const pessoas = await (deps.listarPessoas ? deps.listarPessoas() : listarTodas(db));
      for (const p of pessoas) tenantsPorPessoa.set(p.id, p.tenantId);
    }
    const tenantId = tenantsPorPessoa.get(pessoaId);
    return tenantId ? { tenantId, pessoaId } : null;
  }

  /**
   * definido em 2026-10-05: o turno voltou dizendo que a CONTA desta IA não serve (logada e sem acesso). A IA sai do
   * inventário desta máquina na hora — o próximo despacho já não a escolhe — e a resposta é a outra IA pronta, se
   * houver (o turno em "automático" é repetido nela, assentar-turno.ts). O app do Mac reanuncia com o veredito dele;
   * isto cobre o intervalo e o app antigo, que continuaria anunciando "pronto" pela conferência de login.
   */
  function reprovarHarness(machineId: string, harness: IdHarness, causa: CausaSemIa): IdHarness | null {
    const m = maquinas.get(machineId);
    if (!m) return null;
    const reprovado: Inventario = { estado: "nao_autenticado", causa, motivo: MOTIVO_DA_CAUSA[causa], em: agora() };
    const todos: Partial<Record<IdHarness, Inventario>> = { ...(m.harnesses ?? { "claude-cli": m.inventario }), [harness]: reprovado };
    const outra = (Object.entries(todos) as [IdHarness, Inventario][]).find(([id, i]) => id !== harness && i.estado === "pronto");
    maquinas.set(machineId, { ...m, harnesses: todos, inventario: outra ? outra[1] : reprovado });
    log("aviso", "ia_reprovada_no_turno", { machine_id: machineId, harness, causa, outra: outra?.[0] ?? null });
    return outra?.[0] ?? null;
  }

  async function usoDoMac(escopo: Escopo): Promise<UsoDoMac> {
    const guardado = usos.get(escopo.pessoaId);
    if (guardado && guardado.ate > agora() && guardado.lidoEm > (deps.usoTrocadoEm?.(escopo.pessoaId) ?? 0)) return guardado.uso;
    try {
      const lidoEm = agora();
      const uso = (await abrirTxEscopada(db, escopo)((trx) => criarRepos(trx, escopo).preferencias.buscar())).usoDoMac ?? USO_DO_MAC_PADRAO;
      usos.set(escopo.pessoaId, { uso, ate: lidoEm + USO_VALE_MS, lidoEm });
      return uso;
    } catch (e) {
      log("aviso", "uso_do_mac_sem_leitura", { pessoa_id: escopo.pessoaId, erro: e instanceof Error ? e.name : "desconhecido" });
      return guardado?.uso ?? USO_DO_MAC_PADRAO;
    }
  }

  function depsDe(trx: Tx, escopo: Escopo): Deps {
    return { repos: criarRepos(trx, escopo), services: deps.services, useCases: deps.useCases, tx: (fn) => fn(trx), escopo, agora };
  }

  return {
    async conectar(m) {
      maquinas.set(m.machineId, m);
    },

    async desconectar(machineId) {
      maquinas.delete(machineId);
      ultimoFundo.delete(machineId);
      segurando.delete(machineId);
      deps.esquecerMaquina?.(machineId);
    },

    async puxar(pessoaId, leituraDoMac): Promise<PlanoTurno | null> {
      esquecerVencidos();
      const escopo = await resolverEscopo(pessoaId);
      if (!escopo) return null;
      const maquina = maquinas.values().next().value;
      if (!maquina) return null;
      // ADR-085: a leitura que veio no puxar entra como a da renovação; a mudança de nível vira o mesmo frame.
      const mudanca = leituraDoMac ? deps.registrarMemoria?.(pessoaId, maquina.machineId, leituraDoMac) : undefined;
      // ADR-085: sem leitura deste Mac (app antigo, fora do macOS) nada é segurado nem espaçado.
      const pressao = deps.pressaoDaMaquina?.(maquina.machineId) ?? null;
      const uso = pressao ? await usoDoMac(escopo) : "livre";
      const segurarFundo = pressao !== null && deveSegurar(uso, pressao.memoria, pressao.processador);
      const espacarFundo = uso !== "livre" && agora() - (ultimoFundo.get(maquina.machineId) ?? -Infinity) < ESPACO_FUNDO_MS;
      if ((segurando.get(maquina.machineId) ?? false) !== segurarFundo) {
        segurando.set(maquina.machineId, segurarFundo);
        log("info", segurarFundo ? "fundo_segurado" : "fundo_solto", { pessoa_id: pessoaId, machine_id: maquina.machineId, uso, memoria: pressao?.memoria ?? null, processador: pressao?.processador ?? null });
      }
      const antes = agora();
      // definido em 2026-10-05 (NOD-175): o token nasce dentro da tx (emitir-plano-turno). Se algo falha depois do
      // `cunhar` (composição, outbox, commit), o turno volta a `pendente` e ninguém recebe o plano: o token cunhado
      // aqui é revogado, senão ele conta em `ativos()` para sempre e segura a drenagem do SIGTERM até o prazo.
      // Embrulha `planos.emitir` (é por ele que o despacho cunha), não `tokenTurno.cunhar`: o emitir composto em
      // compor.ts usa os services do fechamento e não veria um cunhar trocado aqui.
      const emitidos: string[] = [];
      const planos = deps.services.planos;
      const services: Services = { ...deps.services, planos: { ...planos, emitir: (trx, turnoId, machineId) => (emitidos.push(turnoId), planos.emitir(trx, turnoId, machineId)) } };
      try {
        return await abrirTxEscopada(db, escopo)(async (trx) => {
          const d = { ...depsDe(trx, escopo), services };
          if (mudanca?.mudou && leituraDoMac) await d.repos.events.gravarComOutbox([eventoPressao(d, mudanca, leituraDoMac)]);
          const r = await despacharTurno(d, { segurarFundo, espacarFundo, machineId: maquina.machineId, executor: executorAtual(), inventario: maquina.inventario, harnessesProntos: maquina.harnesses ? Object.entries(maquina.harnesses).filter(([, i]) => i.estado === "pronto").map(([id]) => id) : undefined, harnessesDaPessoa: maquina.harnesses ? harnessesDaPessoa(pessoaId) : undefined, aceitaLigacao: maquina.ligacao === true });
          if (r.events?.length) await d.repos.events.gravarComOutbox(r.events);
          if (r.data.plano) {
            vistos.set(r.data.plano.turnoId, agora());
            despachados.set(r.data.plano.turnoId, { em: agora(), sessaoCli: r.data.plano.entrada.bifurcar ? null : r.data.plano.entrada.sessaoCli, bifurcou: r.data.plano.entrada.bifurcar === true });
            escopos.set(r.data.plano.turnoId, escopo);
            executores.set(r.data.plano.turnoId, r.data.plano.executor);
            if (r.data.plano.harness) harnesses.set(r.data.plano.turnoId, r.data.plano.harness);
            // ADR-085 (revisão do #209): começou trabalho novo em segundo plano — o próximo deste Mac espera ESPACO_FUNDO_MS.
            const w = uso !== "livre" && r.data.turno.trabalhoId ? await d.repos.trabalhos.buscar(r.data.turno.trabalhoId) : null;
            // ADR-086: a volta marcada também conta (processo novo no Mac sem ninguém esperando).
            const volta = r.data.turno.acordarEm != null;
            if (w && (volta || ((w.origem === "rotina" || w.origem === "colega") && w.pessoaEsperando !== true && (w.iniciadoEm === null || w.iniciadoEm >= antes)))) {
              ultimoFundo.set(maquina.machineId, agora());
              log("info", "fundo_comecou", { pessoa_id: pessoaId, machine_id: maquina.machineId, trabalho_id: w.id, origem: w.origem, volta, espera_ms: agora() - (volta ? r.data.turno.acordarEm! : w.criadoEm), segurando: segurarFundo });
            }
          }
          return r.data.plano;
        });
      } catch (e) {
        if (mudanca) deps.desfazerMemoria?.(pessoaId, mudanca);
        for (const turnoId of emitidos) {
          despachados.delete(turnoId);
          vistos.delete(turnoId);
          escopos.delete(turnoId);
          executores.delete(turnoId);
          harnesses.delete(turnoId);
          deps.services.tokenTurno.revogar(turnoId);
        }
        log("erro", "ponte_puxar_falhou", { pessoa_id: pessoaId, erro: e instanceof Error ? e.name : "desconhecido" });
        return null;
      }
    },

    async renovar(p: PedidoRenovar): Promise<RespostaRenovar> {
      esquecerVencidos();
      const escopo = escopos.get(p.turnoId);
      if (!escopo) return { ativo: false, versaoMinimaApp: VERSAO_MINIMA_APP };
      const executor = executores.get(p.turnoId) ?? executorAtual();
      // ADR-067: cada fala da sessão viva entra uma vez — a renovação que falhou na volta é repetida com as mesmas.
      const novas = (p.falas ?? []).filter((f) => f.seq > (falasGravadas.get(p.turnoId) ?? 0)).sort((a, b) => a.seq - b.seq);
      // #189: app que manda `mensagensEntregues` confirma o que escreveu; a mensagem só sai da fila na confirmação.
      const confirma = Array.isArray(p.mensagensEntregues);
      const jaOferecidas = oferecidas.get(p.turnoId) ?? new Set<string>();
      for (const id of p.mensagensDevolvidas ?? []) jaOferecidas.delete(id);
      const { ativo, mensagens, ids, semMoldura, conversaSemTrabalho } = await abrirTxEscopada(db, escopo)(async (trx) => {
        const d = depsDe(trx, escopo);
        const r = await d.repos.turnos.renovarLease(p.turnoId, p.machineId, p.sinais, agora());
        if (p.eventos.length) await d.repos.events.gravarComOutbox(p.eventos);
        const events: RuntimeEvent[] = [];
        if (novas.length) {
          const g = await gravarFalasDaSessao(d, { turnoId: p.turnoId, machineId: p.machineId, executor, textos: novas.map((f) => f.texto) });
          events.push(...(g.events ?? []));
        }
        // Turno parado (ativo:false) não confirma: a resposta não vai sair, e a mensagem fica para o próximo turno.
        if (r.ativo && p.mensagensEntregues?.length) {
          const c = await confirmarNaSessao(d, { turnoId: p.turnoId, executor, ids: p.mensagensEntregues });
          events.push(...(c.events ?? []));
        }
        let textos: string[] = [];
        let ids: string[] = [];
        if (r.ativo && p.aceitaMensagens) {
          const a = await absorverNaSessao(d, { turnoId: p.turnoId, executor, confirma, jaOferecidas: [...jaOferecidas] });
          textos = a.data.textos;
          ids = a.data.ids;
          events.push(...(a.events ?? []));
        }
        // ADR-083 (#193): a fala mandada à task (tela da task ou mandar_para_task) entra no turno vivo dela.
        // Revisão do épico (S18, 2026-10-08): nas mesmas duas fases da conversa (#189) — oferecida aqui, absorvida na
        // confirmação —, com o id em `mensagensIds` e em `mensagensSemMoldura` (é recado para a task, não fala no meio).
        let semMoldura: string[] = [];
        if (r.ativo && p.aceitaMensagens) {
          const b = await absorverNoTrabalho(d, { turnoId: p.turnoId, confirma, jaOferecidas: [...jaOferecidas] });
          textos = [...textos, ...b.data.textos];
          ids = [...ids, ...b.data.ids];
          semMoldura = b.data.ids;
          events.push(...(b.events ?? []));
        }
        const turno = r.ativo ? await d.repos.turnos.buscar(p.turnoId) : null;
        // A decisão respondida DENTRO do turno não passa por outro caminho: a renovação acerta o estado da task.
        if (turno?.trabalhoId) events.push(...(await sincronizarTrabalho(d, turno.trabalhoId)));
        // ADR-083 (#194): a memória do Mac. A dos turnos vai para os trabalhos deles; o nível só gera evento na mudança.
        let mudanca: MudancaDePressao | undefined;
        if (p.memoria) {
          await d.repos.trabalhos.atualizarMemoria(p.memoria.porTurno);
          mudanca = deps.registrarMemoria?.(escopo.pessoaId, p.machineId, p.memoria);
          if (mudanca?.mudou) events.push(eventoPressao(d, mudanca, p.memoria));
        }
        // Revisão do #209: o evento só existe se a tx gravar — senão o "visto" volta e a próxima leitura refaz o frame.
        try {
          if (events.length) await d.repos.events.gravarComOutbox(events);
        } catch (e) {
          if (mudanca) deps.desfazerMemoria?.(escopo.pessoaId, mudanca);
          throw e;
        }
        return { ativo: r.ativo, mensagens: textos, ids, semMoldura, conversaSemTrabalho: turno !== null && !turno.trabalhoId && turno.origem === "conversa" };
      });
      // #189: o que o app confirmou já saiu da fila (absorvido): não está mais "oferecido e esperando confirmação".
      if (ativo) for (const id of p.mensagensEntregues ?? []) jaOferecidas.delete(id);
      // A rede de 2 min, numa transação PRÓPRIA: se a entrega correr junto, só a promoção desfaz — nunca a renovação.
      const despachado = despachados.get(p.turnoId);
      const redeMs = deps.redeMs ?? REDE_MS;
      const harness = harnesses.get(p.turnoId) ?? null;
      // definido em 2026-10-08 (revisão do épico, S15): só promove quando a MÁQUINA deste turno anunciou que bifurca sessão
      // com este harness (AnuncioMaquina.capacidades, já com o piso do CLI dela). App antigo não anuncia: não promove — ele
      // poria dois CLIs na mesma sessão, e o CLI sem --fork-session recusaria a próxima mensagem para sempre.
      const maquinaBifurca = harness !== null && maquinas.get(p.machineId)?.capacidades?.[harness]?.bifurcaSessao === true;
      // S17: com mensagem oferecida e ainda não confirmada (nesta renovação ou numa anterior), não promove: a resposta a
      // ela sairia duas vezes (no turno promovido e no turno próprio que a mensagem viraria).
      const semMensagemNoAr = ids.length === 0 && jaOferecidas.size === 0;
      if (ativo && conversaSemTrabalho && despachado && maquinaBifurca && semMensagemNoAr && agora() - despachado.em >= redeMs && deps.fezFerramenta?.(p.turnoId)) {
        await abrirTxEscopada(db, escopo)(async (trx) => {
          const d = depsDe(trx, escopo);
          const r = await promoverNaRede(d, { turnoId: p.turnoId, despachadoEm: despachado.em, fezFerramenta: true, harness, sessaoCli: despachado.sessaoCli, sessaoExecutor: executores.get(p.turnoId) ?? null, maquinaBifurca, redeMs });
          if (r.events?.length) await d.repos.events.gravarComOutbox(r.events);
        }).catch((e: unknown) => log("aviso", "rede_promover_falhou", { turno_id: p.turnoId, erro: e instanceof Error ? e.name : "desconhecido" }));
      }
      if (novas.length) falasGravadas.set(p.turnoId, novas.at(-1)!.seq);
      if (ativo) vistos.set(p.turnoId, agora());
      if (confirma && ativo) {
        for (const id of ids) jaOferecidas.add(id);
        oferecidas.set(p.turnoId, jaOferecidas);
      }
      return { ativo, versaoMinimaApp: VERSAO_MINIMA_APP, ...(mensagens.length ? { mensagens, mensagensIds: ids } : {}), ...(semMoldura.length ? { mensagensSemMoldura: semMoldura } : {}) };
    },

    async entregar(e: Entrega) {
      const escopo = escopos.get(e.turnoId);
      if (!escopo) {
        log("aviso", "ponte_entrega_sem_escopo", { turno_id: e.turnoId, machine_id: e.machineId });
        return;
      }
      const executor = executores.get(e.turnoId) ?? executorAtual();
      // 0005: turno que falhou vira uma linha de log COM a causa crua do CLI — antes só chegava
      // "erro_execucao" e o diagnóstico exigia reproduzir o turno à mão (medido 2026-09-16).
      if (e.resultado.desfecho !== "sucesso") {
        log(e.resultado.desfecho === "falha" ? "erro" : "aviso", "turno_nao_concluiu", {
          turno_id: e.turnoId,
          desfecho: e.resultado.desfecho,
          motivo: e.resultado.motivoFalha ?? e.resultado.motivoInterrupcao ?? null,
          erro_cru: deps.erroCruNoLog === false ? null : (e.resultado.erroCru ?? null),
          causa: e.resultado.causaSemIa ?? null,
          sessao_cli: e.resultado.sessaoCli,
          executor,
        });
      }
      const harnessDoTurno = harnesses.get(e.turnoId) ?? null;
      const outraIa = e.resultado.causaSemIa && harnessDoTurno ? reprovarHarness(e.machineId, harnessDoTurno, e.resultado.causaSemIa) : null;
      // Revisão do épico (S20, 2026-10-08): o assentar é repetido quando o Postgres o escolhe como vítima de um impasse
      // (40P01) ou de serialização (40001) — a transação inteira volta, inclusive o registro da entrega (idempotência
      // por seq_local), então repetir é seguro. E os mapas só saem depois do assentar com sucesso: antes o `finally`
      // apagava o escopo mesmo na falha, e a nova tentativa da entrega caía em "entrega sem escopo" — a resposta se perdia.
      const assentar = () => abrirTxEscopada(db, escopo)(async (trx) => {
        const d = depsDe(trx, escopo);
        const r = await assentarTurno(d, { ...e, executor, harness: harnessDoTurno, outraIa, bifurcou: despachados.get(e.turnoId)?.bifurcou === true });
        // definido em 2026-09-21 (ADR-041): o diagnóstico da falha também PERSISTE, não só vira log.
        // A linha acima vai para stdout e some no Electron empacotado; sem isto um relato feito
        // minutos depois não alcança a causa crua nem os nomes das ferramentas (só a contagem).
        // Best-effort: um SAVEPOINT isola a escrita para que ela NUNCA derrube o assentamento.
        // erro_cru vem do fornecedor sem teto de tamanho, e um timeout no insert do toast levaria
        // junto a mensagem do agente, o gasto e o outbox — o observador não pode destruir o
        // observado. Truncado em 8 KiB, o mesmo teto do corte de resultado do proxy, e redigido
        // antes do corte (NOD-158): o relato e a exportação do diagnóstico leem daqui.
        if (e.resultado.desfecho !== "sucesso" && !r.data.duplicada) {
          try {
            await d.tx(async (t) => {
              await t`savepoint diagnostico`;
              try {
                await criarRepos(t, escopo).relatos.registrarDiagnostico({
                  turnoId: e.turnoId,
                  erroCru: redigirECortar(e.resultado.erroCru, 8000),
                  ferramentas: e.resultado.ferramentasChamadas,
                  negacoes: e.resultado.negacoesPermissao,
                  sessaoCli: e.resultado.sessaoCli,
                  em: agora(),
                });
                await t`release savepoint diagnostico`;
              } catch (err) {
                await t`rollback to savepoint diagnostico`;
                throw err;
              }
            });
          } catch {
            log("aviso", "diagnostico_nao_gravado", { turno_id: e.turnoId });
          }
        }
        // ADR-017 #4 / ADR-045: a entrega que chegou com o lease vencido é um turno perdido pela máquina.
        if (!r.data.tardia && r.data.turno?.motivoInterrupcao === "maquina_sem_contato") registroPadrao.incrementar({ metrica: "pos_restart", desfecho: "perdido", origem: "maquina_sumida", tenant_id: escopo.tenantId });
        const extras = deps.depoisDeAssentar && !r.data.duplicada ? await deps.depoisDeAssentar(d, { entrega: e, saida: r.data }) : [];
        const events = [...(r.events ?? []), ...extras];
        if (events.length) await d.repos.events.gravarComOutbox(events);
      });
      try {
        for (let tentativa = 1; ; tentativa++) {
          try {
            await assentar();
            break;
          } catch (err) {
            if (tentativa >= TENTATIVAS_DO_ASSENTAR || !ehConflitoTransitorio(err)) throw err;
            log("aviso", "ponte_entrega_repetida", { turno_id: e.turnoId, tentativa, codigo: (err as { code?: string }).code ?? null });
          }
        }
      } catch (err) {
        // O processo do turno já acabou: o token e o interruptor saem. O escopo e os mapas ficam para a entrega repetida.
        deps.services.tokenTurno.revogar(e.turnoId);
        deps.esquecerTurno?.(e.turnoId);
        throw err;
      }
      escopos.delete(e.turnoId);
      executores.delete(e.turnoId);
      harnesses.delete(e.turnoId);
      falasGravadas.delete(e.turnoId);
      oferecidas.delete(e.turnoId);
      despachados.delete(e.turnoId);
      vistos.delete(e.turnoId);
      deps.services.tokenTurno.revogar(e.turnoId);
      // NOD-200: a captura do turno sai só com o assentar confirmado; na falha fica, como o escopo, para a entrega repetida.
      deps.services.capturas?.esquecer(e.turnoId);
      deps.esquecerTurno?.(e.turnoId);
    },

    /** ADR-088: a regra de quem pode ser limpo lê o banco na tx escopada da pessoa; o Mac apaga. */
    async pastasParaLimpar(pessoaId): Promise<PastaParaLimpar[]> {
      const escopo = await resolverEscopo(pessoaId);
      if (!escopo) return [];
      return abrirTxEscopada(db, escopo)((trx) => pastasParaLimpar(depsDe(trx, escopo)));
    },

    /** ADR-088: o resumo da passada vira o log `limpeza_feita` (só números; nunca caminho). */
    async relatarLimpeza(pessoaId, relato: RelatoLimpeza) {
      log("info", "limpeza_feita", { pessoa_id: pessoaId, ...camposDoRelato(relatoValido(relato)) });
    },

    emMemoria() {
      return { escopos: escopos.size, oferecidas: oferecidas.size, despachados: despachados.size };
    },

    maquinasConectadas() {
      return [...maquinas.values()];
    },

    escopoDoTurno(turnoId) {
      return escopos.get(turnoId) ?? null;
    },
  };
}
