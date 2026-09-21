import type { Executor, RuntimeEvent } from "../../contracts/evento.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import type { AnuncioMaquina, Entrega, PedidoRenovar, PonteInterna } from "../../contracts/ponte.ts";
import { abrirTxEscopada } from "../../db/tx.ts";
import { log } from "../../obs/log.ts";
import { criarRepos } from "../../repositories/index.ts";
import { listarTodas, type Pessoa } from "../../repositories/pessoas.repo.ts";
import type { Db, Escopo, Relogio, Tx } from "../../shared/types.ts";
import { assentarTurno, type SaidaAssentarTurno } from "../../use-cases/assentar-turno.ts";
import { despacharTurno } from "../../use-cases/despachar-turno.ts";
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
  const tenantsPorPessoa = new Map<string, string>();

  async function resolverEscopo(pessoaId: string): Promise<Escopo | null> {
    if (!tenantsPorPessoa.has(pessoaId)) {
      const pessoas = await (deps.listarPessoas ? deps.listarPessoas() : listarTodas(db));
      for (const p of pessoas) tenantsPorPessoa.set(p.id, p.tenantId);
    }
    const tenantId = tenantsPorPessoa.get(pessoaId);
    return tenantId ? { tenantId, pessoaId } : null;
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
      try {
        return await abrirTxEscopada(db, escopo)(async (trx) => {
          const d = depsDe(trx, escopo);
          const r = await despacharTurno(d, { machineId: maquina.machineId, executor: executorAtual(), inventario: maquina.inventario, harnessesProntos: maquina.harnesses ? Object.entries(maquina.harnesses).filter(([, i]) => i.estado === "pronto").map(([id]) => id) : undefined });
          if (r.events?.length) await d.repos.events.gravarComOutbox(r.events);
          if (r.data.plano) {
            escopos.set(r.data.plano.turnoId, escopo);
            executores.set(r.data.plano.turnoId, r.data.plano.executor);
          }
          return r.data.plano;
        });
      } catch (e) {
        log("erro", "ponte_puxar_falhou", { pessoa_id: pessoaId, erro: e instanceof Error ? e.name : "desconhecido" });
        return null;
      }
    },

    async renovar(p: PedidoRenovar) {
      const escopo = escopos.get(p.turnoId);
      if (!escopo) return { ativo: false, versaoMinimaApp: VERSAO_MINIMA_APP };
      const { ativo } = await abrirTxEscopada(db, escopo)(async (trx) => {
        const repos = criarRepos(trx, escopo);
        const r = await repos.turnos.renovarLease(p.turnoId, p.machineId, p.sinais, agora());
        if (p.eventos.length) await repos.events.gravarComOutbox(p.eventos);
        return r;
      });
      return { ativo, versaoMinimaApp: VERSAO_MINIMA_APP };
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
          erro_cru: e.resultado.erroCru ?? null,
          sessao_cli: e.resultado.sessaoCli,
          executor,
        });
      }
      try {
        await abrirTxEscopada(db, escopo)(async (trx) => {
          const d = depsDe(trx, escopo);
          const r = await assentarTurno(d, { ...e, executor });
          // definido em 2026-09-21 (ADR-041): o diagnóstico da falha também PERSISTE, não só vira log.
          // A linha acima vai para stdout e some no Electron empacotado; sem isto um relato feito
          // minutos depois não alcança a causa crua nem os nomes das ferramentas (só a contagem).
          // Best-effort: um SAVEPOINT isola a escrita para que ela NUNCA derrube o assentamento.
          // erro_cru vem do fornecedor sem teto de tamanho, e um timeout no insert do toast levaria
          // junto a mensagem do agente, o gasto e o outbox — o observador não pode destruir o
          // observado. Truncado em 8 KiB, o mesmo teto do corte de resultado do proxy.
          if (e.resultado.desfecho !== "sucesso" && !r.data.duplicada) {
            try {
              await d.tx(async (t) => {
                await t`savepoint diagnostico`;
                try {
                  await criarRepos(t, escopo).relatos.registrarDiagnostico({
                    turnoId: e.turnoId,
                    erroCru: e.resultado.erroCru ? e.resultado.erroCru.slice(0, 8000) : null,
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
          const extras = deps.depoisDeAssentar && !r.data.duplicada ? await deps.depoisDeAssentar(d, { entrega: e, saida: r.data }) : [];
          const events = [...(r.events ?? []), ...extras];
          if (events.length) await d.repos.events.gravarComOutbox(events);
        });
      } finally {
        escopos.delete(e.turnoId);
        executores.delete(e.turnoId);
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
