import type { Autoria, RuntimeEvent } from "../contracts/evento.ts";
import type { Incidente } from "../contracts/incidente.ts";
import type { Turno } from "../contracts/turno.ts";
import { assuntoDaInterrupcao } from "../domain/destino-no-chat.ts";
import { destinoDaQueda, juntarQuedas, motivoDaQueda, ultimoSinalDoTurno, type MotivoDaQueda, type QuedaDeMaquina } from "../domain/incidente.ts";
import { motivoDaQuedaEmPortugues, motivoEmPortugues, redigir } from "../domain/redacao.ts";
import { ehVoltaDoFundo, entradaDaRetomadaDaQueda } from "../domain/cota-da-ia.ts";
import { decidirEsperaNoFundo } from "../domain/espera-no-fundo.ts";
import { trabalhoAberto } from "../domain/trabalho.ts";
import { log } from "../obs/log.ts";
import { rotinaDoTurno } from "./apoio-l7.ts";
import { avisarEsperaAoRemetente } from "./entregar-resposta-peer.ts";
import { enfileirarVoltaDoFundo, entradaDaVoltaDoFundo, fundoNaCadeia, raizDaCadeia } from "./volta-do-fundo.ts";
import { autoriaAgente, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { continuarAprovacoes } from "./decidir.ts";
import { registrarDesfechoRotina } from "./disparar-rotina.ts";
import { registrarInterrupcaoPorParada } from "./interrupcao-por-parada.ts";
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
 * O que acontece com UM turno derrubado. Fundo (NOD-309, PR 3): volta para a fila sozinho (aposQuedaNoFundo); só o que a
 * regra do fundo devolve (não é fundo, o teto ou o prazo acabou, a continuação de uma aprovação já o retoma) segue abaixo.
 * Rotina: só o histórico — execução 'interrompida', sem decisão
 * e sem mensagem; a próxima janela roda sozinha, então "Retomar" não faz sentido. Conversa: a retomada
 * anterior da MESMA conversa fecha por regra e nasce uma, com a frase na conversa — a pessoa estava
 * esperando aquela resposta. Ligação: só o histórico, como na entrega (ADR-072).
 */
async function consequencias(deps: DepsQueda, c: Caido & { rotinaId: string | null }, prazoMs: number | undefined, continuadas: number, events: RuntimeEvent[]): Promise<{ decisaoId: string | null; rotinaId: string | null; rotina: boolean }> {
  const { turno, motivo } = c;
  const agora = deps.agora();
  await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor: "catcher", machineId: turno.machineId, decididoPor: "regra:varredor_lease" });
  // NOD-309 (PR 3, emenda da ADR-045): o trabalho de fundo não ganha "Retomar" nem cai calado — volta para a fila sozinho.
  const noFundo = continuadas > 0 ? null : await aposQuedaNoFundo(deps, c, autoria);
  events.push(evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo, machine_id: turno.machineId, perdido_desde: c.perdidoDesde, ...(noFundo?.dados ?? {}) } }));
  if (noFundo) {
    events.push(...noFundo.events);
    return { decisaoId: null, rotinaId: c.rotinaId, rotina: c.rotinaId !== null };
  }
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
  const aviso = await deps.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "sistema", assunto: assuntoDaInterrupcao(motivo), texto: frase, confianca: "confiavel" });
  if (decisao) events.push(evento(deps.escopo, { kind: "decisao_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { decisao_id: decisao.id, tipo: "retomar_turno" } }));
  if (aviso) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: aviso.id, kind: "sistema" } }));
  return { decisaoId: decisao?.id ?? null, rotinaId: null, rotina: false };
}

/**
 * definido em 2026-10-20 (NOD-309, PR 3, emenda da ADR-045): o trabalho de FUNDO derrubado no meio do turno — rotina,
 * pedido de colega, frente e retorno do lote — volta para a fila sozinho, pela regra única do fundo
 * (domain/espera-no-fundo.ts). Reinício do servidor: a retomada entra agora. Máquina sem contato: entra agora também e
 * fica pendente até a máquina voltar a puxar — é o "quando o Mac voltar"; a linha diz isso uma vez por cadeia (a task
 * sempre, é o fio dela) e quem pediu ao colega lê uma vez. O reinício não avisa (ADR-045: não é culpa do Mac, e a volta
 * é imediata). A rotina cuja volta passaria da próxima janela fica `nao_rodou` com o motivo; o teto (3 quedas por cadeia)
 * ou o prazo (24 h) devolve null, e vale o caminho de antes (o "Retomar", o histórico da rotina, o aviso do pedido parado).
 * Quem pediu Parar não chega aqui (aposParada); a ligação não é fundo.
 */
async function aposQuedaNoFundo(deps: DepsQueda, c: Caido & { rotinaId: string | null }, autoria: Autoria): Promise<{ dados: Record<string, string | number | null>; events: RuntimeEvent[] } | null> {
  const { turno, motivo } = c;
  if (turno.pararSolicitadoEm !== null || !(await fundoNaCadeia(deps, turno))) return null;
  const trabalho = turno.trabalhoId ? await deps.repos.trabalhos.buscar(turno.trabalhoId) : null;
  if (turno.trabalhoId && (!trabalho || !trabalhoAberto(trabalho.estado))) return null;
  const agora = deps.agora();
  const retomaTurnoId = turno.retomaTurnoId ?? turno.id;
  const raiz = await raizDaCadeia(deps, turno);
  const daRotina = c.rotinaId ? await rotinaDoTurno(deps.repos, turno.id) : null;
  const quedas = await deps.repos.turnos.quedasDaCadeia(raiz.id, turno.id);
  const decisao = decidirEsperaNoFundo({
    causa: motivo,
    tentativasTransitorias: turno.tentativasTransitorias ?? 0,
    quedas,
    agora,
    inicioDaCadeia: raiz.criadoEm,
    ehRotina: daRotina !== null,
    proximaExecucao: daRotina?.rotina.proximaExecucao ?? null,
    aleatorio: 0,
  });
  const chave = turno.trabalhoId ? "frente" : daRotina ? "rotina" : "pedido";
  if (decisao.tipo === "desistir") {
    log("aviso", "fundo_desistiu", { turno_id: turno.id, causa: motivo, motivo: decisao.motivo, quedas, fundo: chave });
    return null;
  }
  await deps.repos.turnos.travarRetomadas(retomaTurnoId);
  if (decisao.tipo === "nao_rodou") {
    const r = await registrarDesfechoRotina(deps, { turnoId: turno.id, desfecho: "nao_rodou", motivo: decisao.motivo, ...(decisao.voltaEm !== null ? { voltaEm: decisao.voltaEm } : {}) });
    log("info", "fundo_rotina_nao_rodou", { turno_id: turno.id, rotina_id: daRotina?.rotina.id ?? null, causa: motivo, volta_em: decisao.voltaEm });
    return { dados: { espera_no_fundo: motivo, espera_da_cota: "nao_rodou", volta_em: decisao.voltaEm }, events: r.events ?? [] };
  }
  const sessaoRetomavel = trabalho ? trabalho.sessaoCli !== null && (trabalho.sessaoHarness === null || trabalho.sessaoHarness === turno.harness) : false;
  const base = entradaDaRetomadaDaQueda(motivoEmPortugues(motivo));
  const volta = await enfileirarVoltaDoFundo(deps, { turno, retomaTurnoId, entradaTexto: entradaDaVoltaDoFundo({ turno, raiz, base, sessaoRetomavel }), acordarEm: agora, agora });
  const events: RuntimeEvent[] = [
    evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: turno.conversaId, turnoId: volta.id, dados: { origem: volta.origem, agente_id: turno.agenteId, retoma_turno_id: retomaTurnoId, trabalho_id: turno.trabalhoId ?? null, acordar_em: agora } }),
  ];
  if (motivo === "maquina_sem_contato") {
    const jaEsperou = turno.origem === "retomada" && ehVoltaDoFundo(turno.entradaTexto);
    const identificada = turno.machineId ? await deps.repos.maquinaTokens.identificar(turno.machineId) : null;
    const maquina = identificada?.plataforma === "linux" ? `A máquina ${identificada.nome}` : "O Mac";
    const pedido = chave === "frente" ? "Esta task" : chave === "rotina" ? "Esta execução da rotina" : "Este pedido";
    if (chave === "frente" || !jaEsperou) {
      const linha = await deps.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "sistema", assunto: "fundo.espera", texto: redigir("fundo-espera-maquina", agora, { maquina, pedido }), confianca: "confiavel" });
      if (linha) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: linha.id, kind: "sistema" } }));
    }
    if (!jaEsperou) {
      const agente = await deps.repos.agentes.buscar(turno.agenteId);
      events.push(...(await avisarEsperaAoRemetente(deps, { turno, texto: redigir("fundo-espera-maquina", agora, { maquina, pedido: `O pedido a ${agente?.nome ?? "o colega"}` }) })));
    }
  }
  // Risco do plano (laço de retomada): o teto de quedas por cadeia segura; o log mede a tentativa.
  log("info", "fundo_retomado", { turno_id: turno.id, volta_turno_id: volta.id, causa: motivo, tentativa: decisao.tentativa, fundo: chave });
  return { dados: { espera_no_fundo: motivo, espera_da_cota: "espera", volta_turno_id: volta.id, volta_em: decisao.voltaEm, tentativa: decisao.tentativa }, events };
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
    // NOD-261 (E2): a aprovação decidida enquanto o turno ainda aparecia "despachando" (assentarAprovacao confiou no turno
    // vivo) segue agora, numa continuação só: reivindicarContinuacao dá a decisão a uma chamada, e a entrega tardia
    // depois disto não continua de novo. Com a continuação na fila, o "Retomar" deste turno sai por regra.
    // NOD-309 (PR 3): a continuação vem antes — com ela na fila, o fundo não ganha uma segunda retomada (refaria o efeito).
    const continuacao = await continuarAprovacoes(deps, c.turno);
    const r = await consequencias(deps, c, prazoMs, continuacao.continuadas, events);
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
  const parados: { turno: Turno; perdidoDesde: number }[] = [];
  for (const vencido of input.turnos) {
    if (naCarencia.has(vencido.id)) continue;
    // definido em 2026-10-15 (NOD-252): a pessoa pediu para parar (ou excluiu o bot) e o lease venceu porque a
    // renovação o congelou (renovarLease) — com a máquina fora, ninguém entregou. O Parar vence a queda: o turno
    // termina `parado_pela_pessoa`, sem Retomar, sem aviso de queda e sem contar em `porMotivo`.
    const parado = vencido.pararSolicitadoEm !== null;
    const motivo = parado ? "parado_pela_pessoa" : motivoDaQueda(vencido, agora, input.inicioDoProcesso ?? null);
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
    if (parado) parados.push({ turno, perdidoDesde });
    else caidos.push({ turno, motivo: motivo as MotivoDaQueda, perdidoDesde, maquinaPresente: input.maquinaPresente ? input.maquinaPresente(vencido.machineId) : true });
  }
  const r = await aplicar(deps, caidos, input.prazoMs);
  // Depois das quedas: a mesma ordem de travas (a trava por pessoa dos incidentes antes das janelas de rotina).
  for (const p of parados) r.events.push(...(await aposParada(deps, p.turno, p.perdidoDesde)));
  r.data.interrompidos.push(...parados.map((p) => p.turno.id));
  return r;
}

/** O turno parado pela pessoa que o varredor assentou (NOD-252): as parciais, o evento, a task e o registro da parada. */
async function aposParada(deps: DepsQueda, turno: Turno, perdidoDesde: number): Promise<RuntimeEvent[]> {
  const agora = deps.agora();
  const events: RuntimeEvent[] = [];
  await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor: "catcher", machineId: turno.machineId, decididoPor: "regra:varredor_lease" });
  events.push(evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: "parado_pela_pessoa", machine_id: turno.machineId, perdido_desde: perdidoDesde } }));
  events.push(...(await sincronizarDoTurno(deps, turno)));
  // A ligação se encerra pelo Desligar (ADR-072): sem histórico de rotina nem aviso de delegação.
  if (turno.origem !== "ligacao") events.push(...(await registrarInterrupcaoPorParada(deps, { turnoId: turno.id })));
  return events;
}

/**
 * Porta da entrega (assentar-turno.ts): a máquina voltou e entregou depois de o lease vencer, sem Parar;
 * o turno JÁ foi assentado como interrompido maquina_sem_contato. Quem entregou está presente.
 * Termina igual ao varredor.
 * revisto em 2026-10-15 (NOD-245): `motivo` vem de quem assentou — a entrega de um turno adotado que o reinício do
 * servidor derrubou é `reinicio_servidor` (Retomar, sem aviso de queda do Mac). Ausente = `maquina_sem_contato`.
 */
export function aposQuedaDaMaquina(deps: DepsQueda, turno: Turno, p: { perdidoDesde: number; prazoMs?: number; motivo?: MotivoDaQueda }): Promise<{ data: SaidaQuedaDaMaquina; events: RuntimeEvent[] }> {
  return aplicar(deps, [{ turno, motivo: p.motivo ?? "maquina_sem_contato", perdidoDesde: p.perdidoDesde, maquinaPresente: true }], p.prazoMs);
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
