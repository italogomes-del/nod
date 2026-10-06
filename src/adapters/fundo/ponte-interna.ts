import type { Executor, RuntimeEvent } from "../../contracts/evento.ts";
import type { IdHarness } from "../../contracts/harness.ts";
import { MOTIVO_DA_CAUSA, type CausaSemIa, type Inventario } from "../../contracts/inventario.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import type { AnuncioMaquina, Entrega, PedidoRenovar, PonteInterna, RespostaRenovar } from "../../contracts/ponte.ts";
import { abrirTxEscopada } from "../../db/tx.ts";
import { redigirECortar } from "../../domain/segredos.ts";
import { log } from "../../obs/log.ts";
import { metricas as registroPadrao } from "../../obs/metricas.ts";
import { criarRepos } from "../../repositories/index.ts";
import { listarTodas, type Pessoa } from "../../repositories/pessoas.repo.ts";
import type { Db, Escopo, Relogio, Tx } from "../../shared/types.ts";
import { assentarTurno, type SaidaAssentarTurno } from "../../use-cases/assentar-turno.ts";
import { despacharTurno } from "../../use-cases/despachar-turno.ts";
import { absorverNaSessao, gravarFalasDaSessao } from "../../use-cases/sessao-viva.ts";
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
};

export type PonteInternaNod = PonteInterna & {
  maquinasConectadas(): AnuncioMaquina[];
  escopoDoTurno(turnoId: string): Escopo | null;
};

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

  function depsDe(trx: Tx, escopo: Escopo): Deps {
    return { repos: criarRepos(trx, escopo), services: deps.services, useCases: deps.useCases, tx: (fn) => fn(trx), escopo, agora };
  }

  return {
    async conectar(m) {
      maquinas.set(m.machineId, m);
    },

    async desconectar(machineId) {
      maquinas.delete(machineId);
    },

    async puxar(pessoaId): Promise<PlanoTurno | null> {
      const escopo = await resolverEscopo(pessoaId);
      if (!escopo) return null;
      const maquina = maquinas.values().next().value;
      if (!maquina) return null;
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
          const r = await despacharTurno(d, { machineId: maquina.machineId, executor: executorAtual(), inventario: maquina.inventario, harnessesProntos: maquina.harnesses ? Object.entries(maquina.harnesses).filter(([, i]) => i.estado === "pronto").map(([id]) => id) : undefined, harnessesDaPessoa: maquina.harnesses ? harnessesDaPessoa(pessoaId) : undefined, aceitaLigacao: maquina.ligacao === true });
          if (r.events?.length) await d.repos.events.gravarComOutbox(r.events);
          if (r.data.plano) {
            escopos.set(r.data.plano.turnoId, escopo);
            executores.set(r.data.plano.turnoId, r.data.plano.executor);
            if (r.data.plano.harness) harnesses.set(r.data.plano.turnoId, r.data.plano.harness);
          }
          return r.data.plano;
        });
      } catch (e) {
        for (const turnoId of emitidos) {
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
      const escopo = escopos.get(p.turnoId);
      if (!escopo) return { ativo: false, versaoMinimaApp: VERSAO_MINIMA_APP };
      const executor = executores.get(p.turnoId) ?? executorAtual();
      // ADR-067: cada fala da sessão viva entra uma vez — a renovação que falhou na volta é repetida com as mesmas.
      const novas = (p.falas ?? []).filter((f) => f.seq > (falasGravadas.get(p.turnoId) ?? 0)).sort((a, b) => a.seq - b.seq);
      const { ativo, mensagens } = await abrirTxEscopada(db, escopo)(async (trx) => {
        const d = depsDe(trx, escopo);
        const r = await d.repos.turnos.renovarLease(p.turnoId, p.machineId, p.sinais, agora());
        if (p.eventos.length) await d.repos.events.gravarComOutbox(p.eventos);
        const events: RuntimeEvent[] = [];
        if (novas.length) {
          const g = await gravarFalasDaSessao(d, { turnoId: p.turnoId, machineId: p.machineId, executor, textos: novas.map((f) => f.texto) });
          events.push(...(g.events ?? []));
        }
        let textos: string[] = [];
        if (r.ativo && p.aceitaMensagens) {
          const a = await absorverNaSessao(d, { turnoId: p.turnoId, executor });
          textos = a.data.textos;
          events.push(...(a.events ?? []));
        }
        if (events.length) await d.repos.events.gravarComOutbox(events);
        return { ativo: r.ativo, mensagens: textos };
      });
      if (novas.length) falasGravadas.set(p.turnoId, novas.at(-1)!.seq);
      return { ativo, versaoMinimaApp: VERSAO_MINIMA_APP, ...(mensagens.length ? { mensagens } : {}) };
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
      try {
        await abrirTxEscopada(db, escopo)(async (trx) => {
          const d = depsDe(trx, escopo);
          const r = await assentarTurno(d, { ...e, executor, harness: harnessDoTurno, outraIa });
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
      } finally {
        escopos.delete(e.turnoId);
        executores.delete(e.turnoId);
        harnesses.delete(e.turnoId);
        falasGravadas.delete(e.turnoId);
        deps.services.tokenTurno.revogar(e.turnoId);
        deps.esquecerTurno?.(e.turnoId);
      }
    },

    maquinasConectadas() {
      return [...maquinas.values()];
    },

    escopoDoTurno(turnoId) {
      return escopos.get(turnoId) ?? null;
    },
  };
}
