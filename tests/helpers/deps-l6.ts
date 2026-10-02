import type { FrameSse } from "../../src/contracts/frame.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { Rotina } from "../../src/contracts/rotina.ts";
import { ErroDeDominio } from "../../src/domain/erro.ts";
import { montarPlano } from "../../src/domain/plano-turno.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import { criarInterruptor, type InterruptorNod } from "../../src/services/interruptor.ts";
import type { Escopo, Relogio, Tx } from "../../src/shared/types.ts";
import { lerArtefato, publicarArtefato } from "../../src/use-cases/artefatos.ts";
import { atualizarPerfil } from "../../src/use-cases/atualizar-perfil.ts";
import { lembrar } from "../../src/use-cases/lembrar.ts";
import type { CasoDeUso, Deps, Services, UseCasesNod } from "../../src/use-cases/tipos.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "./ids.ts";
import { criarBancoMemoria, type BancoMemoria } from "./repos-memoria.ts";

/**
 * Deps de teste da L6. As fatias de Services das outras lanes (planos ← L5, rotinas ← L7, tokenTurno ← L5,
 * barramento ← L8) entram como dublês honestos: `planos.emitir` monta o plano pelo DOMÍNIO (montarPlano)
 * sobre os repos da transação — a mesma regra que a L5 compõe —, `rotinas.ativar` é um espião injetável,
 * e o que não é desta lane lança "não implementado" em vez de fingir sucesso.
 */
export const MARLON: Escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
export const ANA: Escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };

export type OpcoesServicos = {
  interruptor?: InterruptorNod;
  ativarRotina?: (trx: Tx, propostaId: string) => Promise<Rotina>;
  relogio?: Relogio;
};

export type ServicesDeTeste = Services & { interruptor: InterruptorNod; revogados: string[]; frames: FrameSse[] };

const naoImplementado = (nome: string) => async (): Promise<never> => {
  throw new Error(`${nome}: não implementado nesta lane`);
};

export function servicosDeTeste(reposDe: (trx: Tx) => Repos, escopo: Escopo, opcoes: OpcoesServicos = {}): ServicesDeTeste {
  const relogio = opcoes.relogio ?? (() => Date.now());
  const revogados: string[] = [];
  const frames: FrameSse[] = [];
  let seq = 0;
  return {
    relogio,
    interruptor: opcoes.interruptor ?? criarInterruptor(),
    revogados,
    frames,
    tokenTurno: {
      cunhar: (turnoId) => `tok-${turnoId}`,
      autorizar: () => null,
      revogar: (turnoId) => {
        revogados.push(turnoId);
      },
    },
    planos: {
      async emitir(trx, turnoId, machineId): Promise<PlanoTurno> {
        const repos = reposDe(trx);
        const turno = await repos.turnos.buscar(turnoId);
        if (!turno) throw new ErroDeDominio("nao_encontrado");
        const agente = await repos.agentes.buscar(turno.agenteId);
        if (!agente) throw new ErroDeDominio("nao_encontrado");
        const [memorias, concessoes, conectores, conversa, pessoa] = await Promise.all([
          repos.memorias.listarDoAgente(agente.id),
          repos.concessoes.doAgente(agente.id),
          repos.conectores.listarHabilitados(),
          repos.conversas.buscar(turno.conversaId),
          repos.pessoas.buscar(escopo.pessoaId),
        ]);
        const inventario = (await repos.inventario.buscar("catcher")) ?? (await repos.inventario.buscar("claude-cli")) ?? { estado: "pronto" as const, versao: "teste", em: relogio() };
        const modo = turno.origem === "rotina" ? "rotina" : turno.origem === "sala" ? "sala" : turno.origem === "peer" ? "peer" : agente.confirmado ? "conversa" : "criacao";
        const plano = montarPlano({
          turno,
          agente,
          memorias,
          concessoes,
          conectores,
          modo,
          confianca: turno.entradaConfianca,
          profundidade: turno.profundidade,
          inventario,
          executor: "catcher",
          sessaoCli: conversa?.sessaoCli ?? null,
          pessoaNome: pessoa?.nome ?? "pessoa",
          agora: relogio(),
        });
        return { ...plano, tokenDeTurno: `tok-${turnoId}`, machineId };
      },
      buscar: () => null,
    },
    rotinas: { ativar: opcoes.ativarRotina ?? naoImplementado("rotinas.ativar (L7)") },
    conectores: {
      chamar: naoImplementado("conectores.chamar (L5)"),
      async sondar() {
        return { ok: false, motivo: "conector_indisponivel" };
      },
    },
    catcher: {
      async registrar(trx, turnoId, tipo, dados) {
        await reposDe(trx).catcher.registrar({ turnoId, tipo, dados });
      },
    },
    sala: { encaminhar: naoImplementado("sala.encaminhar (L7)"), passar: naoImplementado("sala.passar (L7)"), pedir: naoImplementado("sala.pedir (L7)") },
    barramento: {
      publicar(pessoaId, tipo, dados) {
        const frame: FrameSse = { streamId: "teste", seq: ++seq, pessoaId, tipo, dados };
        frames.push(frame);
        return frame;
      },
    },
  };
}

/** As catorze ferramentas: as duas desta lane são reais; as outras lançam (nunca fingem sucesso). */
export function useCasesDeTeste(): UseCasesNod {
  return {
    lembrar,
    atualizarPerfil,
    pedirAcesso: naoImplementado("pedirAcesso (L5)"),
    criarRotina: naoImplementado("criarRotina (L7)"),
    listarRotinasDoAgente: naoImplementado("listarRotinasDoAgente (L7)"),
    pausarRotinaPeloAgente: naoImplementado("pausarRotinaPeloAgente (L7)"),
    reativarRotinaPeloAgente: naoImplementado("reativarRotinaPeloAgente (L7)"),
    atualizarRotinaPeloAgente: naoImplementado("atualizarRotinaPeloAgente (L7)"),
    excluirRotinaPeloAgente: naoImplementado("excluirRotinaPeloAgente (L7)"),
    pedirAprovacao: naoImplementado("pedirAprovacao (L5)"),
    pedirAPessoa: naoImplementado("pedirAPessoa (L5)"),
    passar: naoImplementado("passar (L7)"),
    encaminhar: naoImplementado("encaminhar (L7)"),
    semNovidade: naoImplementado("semNovidade (L7)"),
    pedirABot: naoImplementado("pedirABot (L7)"),
    verColegas: naoImplementado("verColegas (L7)"),
    publicarArtefato,
    lerArtefato,
  };
}

/** Deps sobre a transação do withRollback (integração): repos reais, tx = `(fn) => fn(trx)`. */
export function depsSobreTrx(trx: Tx, escopo: Escopo, opcoes: OpcoesServicos & { services?: Services } = {}): Deps & { services: ServicesDeTeste } {
  const services = (opcoes.services as ServicesDeTeste | undefined) ?? servicosDeTeste((t) => criarRepos(t, escopo), escopo, opcoes);
  return { repos: criarRepos(trx, escopo), services, useCases: useCasesDeTeste(), tx: (fn) => fn(trx), escopo, agora: opcoes.relogio ?? (() => Date.now()) };
}

/** Deps em memória (unitário): os repos de tests/helpers/repos-memoria.ts e tx = `(fn) => fn({} as never)`. */
export function depsEmMemoria(escopo: Escopo = MARLON, opcoes: OpcoesServicos = {}): { deps: Deps & { services: ServicesDeTeste }; banco: BancoMemoria; reposDe(escopo: Escopo): Repos } {
  const { banco, repos: reposDe } = criarBancoMemoria();
  const repos = reposDe(escopo);
  const services = servicosDeTeste(() => repos, escopo, opcoes);
  const deps: Deps & { services: ServicesDeTeste } = { repos, services, useCases: useCasesDeTeste(), tx: (fn) => fn({} as never), escopo, agora: opcoes.relogio ?? (() => Date.now()) };
  return { deps, banco, reposDe };
}

/** Roda o caso de uso e grava os eventos pelo outbox, como a rota/ponte fazem. */
export async function executar<I, O>(deps: Deps, caso: CasoDeUso<I, O>, input: I): Promise<{ data: O; events: NonNullable<Awaited<ReturnType<CasoDeUso<I, O>>>["events"]> }> {
  const r = await caso(deps, input);
  const events = r.events ?? [];
  if (events.length) await deps.repos.events.gravarComOutbox(events);
  return { data: r.data, events };
}

/** Espera ErroDeDominio com o código dado. */
export async function esperarErro(fn: () => Promise<unknown>, codigo: string): Promise<void> {
  try {
    await fn();
  } catch (e) {
    if (e instanceof ErroDeDominio && e.codigo === codigo) return;
    throw e;
  }
  throw new Error(`esperava ErroDeDominio(${codigo}) e nada foi lançado`);
}
