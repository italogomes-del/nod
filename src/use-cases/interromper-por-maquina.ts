import type { RuntimeEvent } from "../contracts/evento.ts";
import type { Incidente } from "../contracts/incidente.ts";
import type { Turno } from "../contracts/turno.ts";
import { destinoDaQueda, juntarQuedas, motivoDaQueda, ultimoSinalDoTurno, type MotivoDaQueda, type QuedaDeMaquina } from "../domain/incidente.ts";
import { motivoDaQuedaEmPortugues, motivoEmPortugues, redigir } from "../domain/redacao.ts";
import { rotinaDoTurno } from "./apoio-l7.ts";
import { autoriaAgente, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { continuarAprovacoes } from "./decidir.ts";
import { registrarDesfechoRotina } from "./disparar-rotina.ts";
import type { Deps } from "./tipos.ts";
import { sincronizarDoTurno } from "./trabalhos.ts";
import { propagarSessaoDoTurno } from "./sessao-do-turno.ts";

/** O que a regra de queda usa de Deps: o varredor de lease (laço de fundo) monta só isto. */
export type DepsQueda = Pick<Deps, "repos" | "escopo" | "agora">;

/** A retomada anterior da mesma conversa sai quando uma queda nova abre outra (ADR-045). */
export const REGRA_RETOMADA_SUBSTITUIDA = "regra:retomada_substituida" as const;

/**
 * definido em 2026-10-15 (NOD-261, E2): o "Retomar" do turno caído fecha quando a continuação de uma aprovação já
 * decidida o retoma — duas retomadas do mesmo turno refariam o efeito externo que a pessoa aprovou.
 */
export const REGRA_APROVACAO_CONTINUADA = "regra:aprovacao_continuada" as const;

export type SaidaQuedaDaMaquina = {
  interrompidos: string[];
  decisoes: string[];
  rotinas: string[];
  /** Quantos turnos caíram por motivo: quem observa (a borda) conta a métrica pos_restart. */
  porMotivo: Record<MotivoDaQueda, number>;
  incidenteId: string | null;
};

/** Um turno JÁ interrompido pela queda, com o que se sabe dela. */
type Caido = { turno: Turno; motivo: MotivoDaQueda; perdidoDesde: number; maquinaPresente: boolean };

/**
 * O que acontece com UM turno derrubado. Rotina: só o histórico — execução 'interrompida', sem decisão
 * e sem mensagem; a próxima janela roda sozinha, então "Retomar" não faz sentido. Conversa: a retomada
 * anterior da MESMA conversa fecha por regra e nasce uma, com a frase na conversa — a pessoa estava
 * esperando aquela resposta. Ligação: só o histórico, como na entrega (ADR-072).
 */
async function consequencias(deps: DepsQueda, c: Caido & { rotinaId: string | null }, prazoMs: number | undefined, events: RuntimeEvent[]): Promise<{ decisaoId: string | null; rotinaId: string | null; rotina: boolean }> {
  const { turno, motivo } = c;
  const agora = deps.agora();
  await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor: "catcher", machineId: turno.machineId, decididoPor: "regra:varredor_lease" });
  events.push(evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo, machine_id: turno.machineId, perdido_desde: c.perdidoDesde } }));
  if (c.rotinaId) {
    const r = await registrarDesfechoRotina(deps, { turnoId: turno.id, desfecho: "interrompida", motivo });
    events.push(...(r.events ?? []));
    return { decisaoId: null, rotinaId: c.rotinaId, rotina: true };
  }
  // NOD-168 (ADR-072): o turno-cérebro de uma ligação não ganha card "Retomar" nem aviso na conversa — a ligação conta
  // como acabou (o orquestrador encerra e grava a linha do motivo). A queda segue em `porMotivo` e no aviso do Mac.
  if (turno.origem === "ligacao") return { decisaoId: null, rotinaId: null, rotina: false };
  for (const anterior of await deps.repos.decisoes.pendentesDaConversa(turno.conversaId)) {
    if (anterior.tipo !== "retomar_turno") continue;
    // revisto em 2026-10-07 (ADR-083, S6): só a retomada da MESMA faixa sai — a queda de uma task não fecha o
    // "Retomar" da conversa nem o de outra task do bot.
    const deQuem = anterior.turnoId ? await deps.repos.turnos.buscar(anterior.turnoId) : null;
    if ((deQuem?.trabalhoId ?? null) !== (turno.trabalhoId ?? null)) continue;
    const fechada = await deps.repos.decisoes.fecharPorRegra(anterior.id, { regra: REGRA_RETOMADA_SUBSTITUIDA, regraVersao: 1, agora });
    if (fechada) events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria: { ...autoria, decidido_por: REGRA_RETOMADA_SUBSTITUIDA }, agora, conversaId: fechada.conversaId, turnoId: fechada.turnoId, dados: { decisao_id: fechada.id, tipo: fechada.tipo, regra: REGRA_RETOMADA_SUBSTITUIDA } }));
  }
  // definido em 2026-10-09: a queda nomeia a máquina Linux (a VM do motor) em vez de culpar o Mac.
  const maquina = motivo === "maquina_sem_contato" && turno.machineId ? await deps.repos.maquinaTokens.identificar(turno.machineId) : null;
  const frase = redigir("turno-interrompido", agora, { motivo: motivo === "maquina_sem_contato" ? motivoDaQuedaEmPortugues(maquina) : motivoEmPortugues(motivo) });
  const decisao = await deps.repos.decisoes.criar({ tipo: "retomar_turno", agenteId: turno.agenteId, conversaId: turno.conversaId, turnoId: turno.id, prazoDecisaoEm: agora + (prazoMs ?? PRAZO_DECISAO_PADRAO_MS), frase });
  const aviso = await deps.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "sistema", texto: frase, confianca: "confiavel" });
  if (decisao) events.push(evento(deps.escopo, { kind: "decisao_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { decisao_id: decisao.id, tipo: "retomar_turno" } }));
  if (aviso) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: aviso.id, kind: "sistema" } }));
  return { decisaoId: decisao?.id ?? null, rotinaId: null, rotina: false };
}

/**
 * Ordem das travas, a MESMA nas duas portas (varredor e entrega): linhas de turno → trava por pessoa
 * dos incidentes → decisões → janelas. O varredor interrompe todos os turnos antes de entrar aqui; a
 * entrega já tem a linha do turno. Assim ninguém segura a trava por pessoa esperando uma linha de
 * turno que a outra transação tem — o impasse que o varredor-por-turno criaria. Decisões (conversa)
 * antes de janelas (rotina) é a ordem do varredor de expiração (vencerPendentes → janela do gate): os
 * dois laços acordam juntos depois de uma noite de sono e não podem se cruzar.
 */
async function aplicar(deps: DepsQueda, caidos: readonly Caido[], prazoMs: number | undefined): Promise<{ data: SaidaQuedaDaMaquina; events: RuntimeEvent[] }> {
  const saida: SaidaQuedaDaMaquina = { interrompidos: [], decisoes: [], rotinas: [], porMotivo: { maquina_sem_contato: 0, reinicio_servidor: 0 }, incidenteId: null };
  const events: RuntimeEvent[] = [];
  const doMac = caidos.filter((c) => c.motivo === "maquina_sem_contato");
  // Reinício do servidor não é culpa do Mac: nenhum aviso de queda (ADR-045).
  const ultimo = doMac.length > 0 ? await deps.repos.incidentes.travarUltimo("mac_sem_contato") : null;
  const classificados: (Caido & { rotinaId: string | null })[] = [];
  for (const c of caidos) classificados.push({ ...c, rotinaId: (await rotinaDoTurno(deps.repos, c.turno.id))?.rotina.id ?? null });
  const emOrdem = [...classificados.filter((c) => c.rotinaId === null), ...classificados.filter((c) => c.rotinaId !== null)];
  const quedas: QuedaDeMaquina[] = [];
  for (const c of emOrdem) {
    const r = await consequencias(deps, c, prazoMs, events);
    // NOD-261 (E2): a aprovação decidida enquanto o turno ainda aparecia "despachando" (assentarAprovacao confiou no turno
    // vivo) segue agora, numa continuação só: reivindicarContinuacao dá a decisão a uma chamada, e a entrega tardia
    // depois disto não continua de novo. Com a continuação na fila, o "Retomar" deste turno sai por regra.
    const continuacao = await continuarAprovacoes(deps, c.turno);
    events.push(...continuacao.events);
    if (continuacao.continuadas > 0 && r.decisaoId) {
      const fechada = await deps.repos.decisoes.fecharPorRegra(r.decisaoId, { regra: REGRA_APROVACAO_CONTINUADA, regraVersao: 1, agora: deps.agora() });
      if (fechada) {
        const autoria = autoriaAgente({ agenteId: c.turno.agenteId, contaDeExecucao: c.turno.ownerId, executor: "catcher", machineId: c.turno.machineId, decididoPor: REGRA_APROVACAO_CONTINUADA });
        events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria, agora: deps.agora(), conversaId: fechada.conversaId, turnoId: fechada.turnoId, dados: { decisao_id: fechada.id, tipo: fechada.tipo, regra: REGRA_APROVACAO_CONTINUADA } }));
      }
    }
    // ADR-083: o trabalho do turno caído vira "precisa de você" (o card Retomar) ou "falhou" (rotina, sem retomada).
    events.push(...(await sincronizarDoTurno(deps, c.turno)));
    saida.interrompidos.push(c.turno.id);
    saida.porMotivo[c.motivo] += 1;
    if (r.decisaoId) saida.decisoes.push(r.decisaoId);
    if (r.rotinaId) saida.rotinas.push(r.rotinaId);
    if (c.motivo === "maquina_sem_contato") quedas.push({ perdidoDesde: c.perdidoDesde, notadoEm: deps.agora(), machineId: c.turno.machineId, agenteId: c.turno.agenteId, rotina: r.rotina, maquinaPresente: c.maquinaPresente });
  }
  saida.incidenteId = (await registrarIncidente(deps, ultimo, quedas))?.id ?? null;
  return { data: saida, events };
}

/** UM aviso por queda (src/domain/incidente.ts): mescla no último ou abre outro. */
async function registrarIncidente(deps: DepsQueda, ultimo: Incidente | null, quedas: readonly QuedaDeMaquina[]): Promise<Incidente | null> {
  const junta = juntarQuedas(quedas);
  if (!junta) return null;
  const soma = { comecouEm: junta.perdidoDesde, voltouEm: junta.voltouEm, rotinas: junta.rotinas, conversas: junta.conversas, agentes: junta.agentes };
  if (ultimo && destinoDaQueda(ultimo, junta) === "mesclar") return deps.repos.incidentes.mesclar(ultimo.id, soma);
  return deps.repos.incidentes.abrir({ tipo: "mac_sem_contato", machineId: junta.machineId, ...soma });
}

export type EntradaVarredura = {
  /** Os turnos com lease vencido, como o varredor os leu (com lease_ate). */
  turnos: readonly Turno[];
  prazoMs?: number;
  /** Só no modo compartilhado: turno sem sinal desde antes do boot foi perdido pelo servidor (motivoDaQueda). */
  inicioDoProcesso?: number | null;
  /** Só no modo compartilhado: a máquina voltou a puxar? Ausente = modo local, a máquina é este processo. */
  maquinaPresente?: (machineId: string | null) => boolean;
  /**
   * NOD-214 (carência do lease no boot): até aqui (inicioDoProcesso + LEASE_MS), o turno cuja máquina atravessa o
   * reinício (`turno_credenciais.sobrevive_reinicio`) NÃO é assentado por `reinicio_servidor` — a máquina segue rodando e
   * a próxima renovação dela adota o turno. Ausente = sem carência (modo local).
   */
  carenciaAte?: number | null;
};

/**
 * definido em 2026-09-24 (ADR-045): o ÚNICO lugar da regra de queda. Porta do varredor de lease:
 * interrompe TODOS os turnos órfãos antes de qualquer consequência (ordem de travas acima). Rodar duas
 * vezes não faz nada: só o que ainda está vivo é interrompido (ADR-010).
 */
export async function interromperPorMaquina(deps: DepsQueda, input: EntradaVarredura): Promise<{ data: SaidaQuedaDaMaquina; events: RuntimeEvent[] }> {
  const agora = deps.agora();
  const caidos: Caido[] = [];
  const naCarencia = input.carenciaAte != null && agora < input.carenciaAte ? await deps.repos.turnoCredenciais.quaisSobrevivem(input.turnos.map((t) => t.id)) : new Set<string>();
  for (const vencido of input.turnos) {
    if (naCarencia.has(vencido.id)) continue;
    const motivo = motivoDaQueda(vencido, agora, input.inicioDoProcesso ?? null);
    // NOD-241 (emenda da ADR-084): o último sinal vai para a linha — é a régua da retomada automática. `leaseVencidoEm`:
    // o turno que renovou o lease depois de `vencidos()` não é interrompido.
    const perdidoDesde = ultimoSinalDoTurno(vencido, agora);
    const turno = await deps.repos.turnos.interromper(vencido.id, motivo, { ultimoSinalEm: perdidoDesde, leaseVencidoEm: agora });
    if (!turno) continue;
    // NOD-214: a sessão que a renovação gravou no turno vale como a da entrega que não veio (a próxima mensagem a
    // retoma), e a credencial sai — o turno assentado não é mais adotável. Sem credencial (turno de antes da 0073), nada.
    const cred = await deps.repos.turnoCredenciais.buscar(turno.id);
    if (cred) {
      const sessao = await deps.repos.turnos.sessaoDoTurno(turno.id);
      // A máquina não diz aqui se bifurca: `false` nunca põe a conversa na sessão da frente (ADR-099, I8).
      if (sessao) await propagarSessaoDoTurno(deps, { turno, sessaoCli: sessao.sessaoCli, executor: cred.executor, harness: cred.harness, maquinaBifurca: false });
      await deps.repos.turnoCredenciais.apagar(turno.id);
    }
    caidos.push({ turno, motivo, perdidoDesde, maquinaPresente: input.maquinaPresente ? input.maquinaPresente(vencido.machineId) : true });
  }
  return aplicar(deps, caidos, input.prazoMs);
}

/**
 * Porta da entrega (assentar-turno.ts): a máquina voltou e entregou depois de o lease vencer, sem Parar;
 * o turno JÁ foi assentado como interrompido maquina_sem_contato. Quem entregou está presente.
 * Termina igual ao varredor.
 */
export function aposQuedaDaMaquina(deps: DepsQueda, turno: Turno, p: { perdidoDesde: number; prazoMs?: number }): Promise<{ data: SaidaQuedaDaMaquina; events: RuntimeEvent[] }> {
  return aplicar(deps, [{ turno, motivo: "maquina_sem_contato", perdidoDesde: p.perdidoDesde, maquinaPresente: true }], p.prazoMs);
}

/**
 * Modo compartilhado: o aviso em curso fecha quando a máquina volta a puxar (ADR-045). No modo local
 * nunca há aviso em curso — o varredor roda no próprio Mac.
 */
export async function registrarVoltaDasMaquinas(deps: DepsQueda, maquinaPresente: (machineId: string | null) => boolean): Promise<string[]> {
  const fechados: string[] = [];
  const emCurso = await deps.repos.incidentes.emCurso();
  if (emCurso.length === 0) return fechados;
  // A mesma trava por pessoa de quem registra quedas: sem ela, fechar e mesclar correriam juntos.
  await deps.repos.incidentes.travarUltimo("mac_sem_contato");
  for (const i of emCurso) {
    if (!maquinaPresente(i.machineId)) continue;
    if (await deps.repos.incidentes.marcarVolta(i.id, deps.agora())) fechados.push(i.id);
  }
  return fechados;
}
