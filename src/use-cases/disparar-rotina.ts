import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { DesfechoRotina, MotivoAdiada, MotivoBloqueioRotina, MotivoFalha, MotivoInterrupcaoRotina, MotivoNaoRodouRotina, MotivoSemNovidade, MotivoSemPendencia } from "../contracts/motivos.ts";
import { TIPOS_GATE_ROTINA, TIPOS_QUE_SEGURAM_A_EXECUCAO } from "../contracts/pedido.ts";
import type { ExecucaoRotina, Rotina } from "../contracts/rotina.ts";
import type { TurnoAbertoDaRotina } from "../repositories/rotina-janelas.repo.ts";
import type { Trabalho } from "../contracts/trabalho.ts";
import type { Turno } from "../contracts/turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { pendenciasDoPrompt } from "../domain/pendencia.ts";
import { blocoPedidosAbertos, type PedidoAbertoNoPrompt } from "../domain/triagem.ts";
import { motivoEmPortugues, redigir } from "../domain/redacao.ts";
import { proximaJanela } from "../domain/rotina-janela.ts";
import { resumoCron } from "../domain/rotina-texto.ts";
import { agenteVisivel, autoriaAgente, autoriaPessoa, carimbo, evento, PRAZO_DECISAO_MS, rotinaDoTurno } from "./apoio-l7.ts";
import { eventoTrabalhoMudou } from "./trabalhos.ts";
import { prazoDoColega } from "./janela-pulada.ts";
import { pedidosAbertosDoBot } from "./pedidos-abertos.ts";
import { pendenciasDaRotina, preVooDaRotina, REGRA_PRE_VOO, type BloqueioDoPreVoo } from "./pre-voo-rotina.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

export type EntradaDisparo = {
  rotina: Rotina;
  instanteAgendado: number;
  machineId: string;
  executor: Executor;
  preservarAgenda?: boolean;
  /**
   * definido em 2026-09-24 (emenda da ADR-044): o disparo que decidir-acesso.ts faz logo depois de a
   * pessoa conceder não passa pelo pré-voo — ela acabou de clicar "Permitir e rodar agora".
   */
  aposConceder?: boolean;
  /** O "A fazer" ligado (NOD_PENDENCIAS=1). Ausente = desligado: a rotina "só com pendência" não acorda pelo agendador. */
  aFazer?: boolean;
};
/**
 * `adiada` (definido em 2026-10-15, NOD-243; era `pulada`, sem rastro): a execução anterior ainda está aberta — o turno
 * dela (`turnoAbertoId`) ou uma frente que ela abriu (`trabalhoAbertoId`). A janela vira uma execução 'adiada' com a
 * causa, e a agenda anda (ADR-045: uma execução aberta por rotina).
 * `janelaDeOutro`: outro processo (ou o "Testar agora" do mesmo minuto) já usou a janela; `proximaExecucao` presente =
 * a agenda andou mesmo assim (NOD-271: antes a rotina ficava vencida para sempre).
 * `bloqueada` (definido em 2026-09-24, emenda da ADR-044): o pré-voo parou a janela sem turno — o
 * motivo, o card de acesso que a destrava (null quando é a pergunta que espera) e a próxima execução.
 * `semPendencia` (definido em 2026-10-01, item 7 da ADR-066): a rotina só acorda com pendência e o agente não tinha
 * nenhuma visível — a janela passou sem turno (registrarSemPendencia) e a agenda andou.
 */
export type SaidaDisparo =
  | { turno: Turno; proximaExecucao: number }
  | { janelaDeOutro: true; proximaExecucao?: number }
  | { adiada: MotivoAdiada; turnoAbertoId: string | null; trabalhoAbertoId?: string; proximaExecucao: number }
  | { bloqueada: MotivoBloqueioRotina; propostaId: string | null; proximaExecucao: number }
  | { semPendencia: true; proximaExecucao: number };

/**
 * Entrada de um turno de rotina é a instrução normalizada mais o contexto fixo (fonte, entregável,
 * limites, política sem dado). Texto do SERVIDOR, não do modelo: só o que a pessoa confirmou.
 */
export function montarEntradaRotina(rotina: Rotina, instanteAgendado: number, pedidosAbertos: readonly PedidoAbertoNoPrompt[] = []): string {
  // NOD-259: cada janela é um fio novo e não via os pedidos que as anteriores fizeram a colegas — e pedia de novo.
  const bloco = blocoPedidosAbertos(pedidosAbertos, instanteAgendado, rotina.fusoIana);
  return [
    `Execução agendada da rotina "${resumoCron(rotina.cron, rotina.fusoIana)}" em ${carimbo(instanteAgendado, rotina.fusoIana)} (${rotina.fusoIana}).`,
    `Instrução: ${rotina.instrucao}`,
    `Fonte: ${rotina.fonte}`,
    `Entregável: ${rotina.entregavel}`,
    `Limites de aprovação: ${rotina.limitesAprovacao}`,
    `Se não houver dado: ${rotina.politicaSemDado}`,
    ...(bloco ? ["", bloco] : []),
  ].join("\n");
}

/**
 * A janela que o pré-voo parou (definido em 2026-09-24, emenda da ADR-044): UMA execução 'bloqueada' com
 * o motivo e SEM turno — nenhum modelo rodou —, poda para as 20, evento para o histórico e a lista de
 * rotinas relerem, e NENHUMA mensagem no chat (o card de acesso já está lá; uma linha por janela era o
 * ruído que esta emenda tira). A agenda anda como num disparo normal: a próxima janela tenta de novo.
 */
async function registrarBloqueio(deps: Deps, input: EntradaDisparo, bloqueio: BloqueioDoPreVoo, agora: number): Promise<{ data: SaidaDisparo; events: RuntimeEvent[] }> {
  const { rotina, instanteAgendado } = input;
  const execucao = await deps.repos.rotinaExecucoes.registrar({ rotinaId: rotina.id, instanteAgendado, turnoId: null, desfecho: "bloqueada", motivo: bloqueio.motivo, em: agora });
  if (!execucao) throw new ErroDeDominio("estado_invalido", { cause: "execução bloqueada não registrada" });
  await deps.repos.rotinaExecucoes.podar(rotina.id);
  const proximaExecucao = input.preservarAgenda ? rotina.proximaExecucao : proximaJanela({ cron: rotina.cron, fusoIana: rotina.fusoIana, agora: Math.max(agora, instanteAgendado) });
  if (!input.preservarAgenda) await deps.repos.rotinas.reagendar(rotina.id, proximaExecucao);
  const autoria = autoriaPessoa(deps.escopo.pessoaId, REGRA_PRE_VOO);
  const dados = { rotinaId: rotina.id, execucaoId: execucao.id, desfecho: "bloqueada", motivo: bloqueio.motivo, propostaId: bloqueio.propostaId, instanteAgendado };
  return {
    data: { bloqueada: bloqueio.motivo, propostaId: bloqueio.propostaId, proximaExecucao },
    events: [...bloqueio.events, evento(deps, "rotina_bloqueada", autoria, dados, { conversaId: rotina.conversaId })],
  };
}

/** Quem decidiu que a janela passa sem turno: regra do servidor, não fala do modelo. */
export const REGRA_SEM_PENDENCIA = "regra:rotina-sem-pendencia" as const;

/**
 * A janela da rotina que só acorda com pendência e não tem nenhuma (definido em 2026-10-01, item 7 da ADR-066): UMA
 * execução 'sem_novidade' com motivo 'sem_pendencia' e SEM turno — nenhum modelo rodou, custo zero —, poda para as
 * 20, a agenda anda como num disparo normal e NENHUMA mensagem no chat (o mesmo silêncio de sem_novidade). Só o
 * agendador chega aqui, então a agenda sempre anda.
 * O evento é `rotina_executou`, com os mesmos dados da execução silenciosa de registrarDesfechoRotina: o despachante
 * já o leva ao frame 'rotina.executou', que faz a web reler a lista e o histórico da rotina. Um kind novo só
 * repetiria esse efeito com mais uma entrada em FRAME_POR_EVENTO; o motivo nos dados diferencia quem lê a trilha.
 */
async function registrarSemPendencia(deps: Deps, input: EntradaDisparo, agora: number): Promise<{ data: SaidaDisparo; events: RuntimeEvent[] }> {
  const { rotina, instanteAgendado } = input;
  const motivo: MotivoSemPendencia = "sem_pendencia";
  const execucao = await deps.repos.rotinaExecucoes.registrar({ rotinaId: rotina.id, instanteAgendado, turnoId: null, desfecho: "sem_novidade", motivo, em: agora });
  if (!execucao) throw new ErroDeDominio("estado_invalido", { cause: "execução sem pendência não registrada" });
  await deps.repos.rotinaExecucoes.podar(rotina.id);
  const proximaExecucao = proximaJanela({ cron: rotina.cron, fusoIana: rotina.fusoIana, agora: Math.max(agora, instanteAgendado) });
  await deps.repos.rotinas.reagendar(rotina.id, proximaExecucao);
  const autoria = autoriaPessoa(deps.escopo.pessoaId, REGRA_SEM_PENDENCIA);
  const dados = { rotinaId: rotina.id, execucaoId: execucao.id, desfecho: "sem_novidade", motivo, instanteAgendado };
  return { data: { semPendencia: true, proximaExecucao }, events: [evento(deps, "rotina_executou", autoria, dados, { conversaId: rotina.conversaId })] };
}

/**
 * A regra da janela seguinte, regra do servidor: fecha a execução que ela venceu (NOD-243) e a pergunta das voltas sem
 * novidade quando ela chega (definido em 2026-10-15, NOD-270).
 */
export const REGRA_JANELA_SEGUINTE = "regra:janela_seguinte" as const;

/**
 * definido em 2026-10-15 (NOD-270, C10; decidido em 15/10 na NOD-228): a pergunta das voltas sem novidade (ADR-099 §5)
 * não segura o cron — a janela seguinte É a volta. Ao abrir a janela agendada, a pergunta antiga fecha por regra (sem
 * pessoa; ninguém a continua, então a resposta tardia vê "já resolvido" e não retoma) e a execução que a fez sai como
 * 'sem_novidade'/'voltas_sem_novidade' (silenciosa; se já tinha executado, registrarDesfechoRotina mantém 'executou').
 * Só no agendador: "Testar agora" é ato da pessoa e não mexe na pergunta.
 */
async function fecharPerguntasDasVoltas(deps: Deps, rotina: Rotina, agora: number): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  const autoria = autoriaPessoa(deps.escopo.pessoaId, REGRA_JANELA_SEGUINTE);
  for (const d of (await pendenciasDaRotina(deps.repos, rotina)).dasVoltas) {
    const fechada = await deps.repos.decisoes.fecharPorRegra(d.id, { regra: REGRA_JANELA_SEGUINTE, regraVersao: 1, agora });
    if (!fechada || fechada.turnoId === null) continue;
    await deps.repos.decisoes.reivindicarContinuacao(fechada.id, "turno", agora);
    events.push(evento(deps, "decisao_decidida", autoria, { decisao_id: fechada.id, tipo: fechada.tipo, regra: REGRA_JANELA_SEGUINTE, rotinaId: rotina.id }, { conversaId: fechada.conversaId, turnoId: fechada.turnoId }));
    const r = await registrarDesfechoRotina(deps, { turnoId: fechada.turnoId, desfecho: "sem_novidade", motivo: "voltas_sem_novidade" });
    events.push(...(r.events ?? []));
  }
  return events;
}

/** Quem grava a janela adiada (NOD-243). */
export const REGRA_ADIADA = "regra:rotina-adiada" as const;
/** Piso do corte do pendente que nunca começou (decisão da NOD-228, 15/10): max(1 período do cron, 30 min). */
export const PISO_VENCIDO_MS = 30 * 60_000;
/** Teto da frente da rotina sem nada vivo (NOD-243): depois disso ela não segura a agenda. */
export const TETO_FRENTE_PARADA_MS = 24 * 3_600_000;
/** Adiadas seguidas que viram UM aviso na conversa da rotina (NOD-243). */
export const ADIADAS_PARA_AVISAR = 3;

type Segura = { motivo: MotivoAdiada; turnoAbertoId: string | null; trabalhoAbertoId?: string; titulo?: string };

/**
 * O turno da janela anterior venceu (decisão da NOD-228, 15/10): ainda pendente, nunca começou (`attempted` = já foi
 * pego uma vez e voltou à fila — esse conta como começado), sem volta marcada, e a janela dele ficou para trás mais de
 * max(1 período do cron, 30 min). O que já começou nunca é cortado.
 */
export function execucaoVenceu(aberto: TurnoAbertoDaRotina, rotina: Pick<Rotina, "cron" | "fusoIana">, agora: number): boolean {
  if (aberto.estado !== "pendente" || aberto.attempted || aberto.acordarEm !== null) return false;
  const periodo = proximaJanela({ cron: rotina.cron, fusoIana: rotina.fusoIana, agora: aberto.instanteAgendado }) - aberto.instanteAgendado;
  return agora - aberto.instanteAgendado >= Math.max(periodo, PISO_VENCIDO_MS);
}

/**
 * O que ainda segura a rotina, depois de cortar o que venceu (os eventos do corte vão em `antes`). null = a janela
 * pode abrir outra execução.
 */
async function quemSegura(deps: Deps, rotina: Rotina, instanteAgendado: number, agora: number, antes: RuntimeEvent[]): Promise<Segura | null> {
  const aberto = await deps.repos.rotinaJanelas.turnoAberto(rotina.id, agora);
  if (aberto) {
    if (!execucaoVenceu(aberto, rotina, agora)) return { motivo: "execucao_anterior_aberta", turnoAbertoId: aberto.turnoId };
    antes.push(...(await encerrarExecucaoAntiga(deps, aberto.turnoId, "vencida")));
  }
  // definido em 2026-10-08 (revisão do épico, S12): também enquanto uma task que uma execução anterior abriu (filha)
  // não acabou; revisto em 2026-10-12 (ADR-099, I7 revista): e uma frente que o dono abriu para a rotina. revisto em
  // 2026-10-15 (NOD-243): a frente sem turno vivo há mais de 24 h é parada e deixa de segurar (até 5 por janela).
  // revisto em 2026-10-16 (NOD-274, C9, integrado no #335): a frente sem turno vivo que só espera um colega há mais de 2
  // períodos do cron (mín. 2 h) não segura nem é parada — a consulta não a devolve.
  const colegaAntesDe = agora - prazoDoColega(rotina, instanteAgendado);
  for (let i = 0; i < 5; i++) {
    const filha = await deps.repos.trabalhos.filhaAbertaDaRotina(rotina.id, colegaAntesDe);
    if (!filha) return null;
    const atividade = await deps.repos.trabalhos.atividade(filha.id);
    const ultima = Math.max(atividade.ultimaEm ?? 0, filha.criadoEm);
    if (atividade.vivos > 0 || agora - ultima <= TETO_FRENTE_PARADA_MS) return { motivo: "frente_aberta", turnoAbertoId: null, trabalhoAbertoId: filha.id, titulo: filha.titulo };
    antes.push(...(await pararFrenteDaRotina(deps, filha, agora)));
  }
  return null;
}

/** Fecha a execução antiga como 'interrompida' (silenciosa, como a do varredor) e leva junto o turno, se ainda pendente. */
async function encerrarExecucaoAntiga(deps: Deps, turnoId: string, motivo: MotivoInterrupcaoRotina): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  if (motivo === "vencida") {
    const cortado = await deps.repos.turnos.interromper(turnoId, "vencido");
    if (cortado) events.push(evento(deps, "turno_interrompido", autoriaPessoa(deps.escopo.pessoaId, REGRA_JANELA_SEGUINTE), { motivo: "vencido", estava: "pendente" }, { conversaId: cortado.conversaId, turnoId }));
  }
  const r = await registrarDesfechoRotina(deps, { turnoId, desfecho: "interrompida", motivo, regra: REGRA_JANELA_SEGUINTE });
  events.push(...(r.events ?? []));
  return events;
}

/**
 * A frente da rotina sem nada vivo há mais de 24 h (NOD-243): fica 'parada' e a execução que a abriu (o turno do dono que
 * abriu o lote) fecha 'interrompida'/'frente_parada'. Não acorda o dono: a janela nova já vai pôr outro pedido na fila.
 */
async function pararFrenteDaRotina(deps: Deps, frente: Trabalho, agora: number): Promise<RuntimeEvent[]> {
  const parada = await deps.repos.trabalhos.mudarEstado(frente.id, "parado", agora);
  if (!parada) throw new ErroDeDominio("estado_invalido", { cause: "frente da rotina não parou" });
  const events: RuntimeEvent[] = [eventoTrabalhoMudou(deps, parada)];
  const lote = frente.loteId ? await deps.repos.frentes.buscarLote(frente.loteId) : null;
  if (lote) events.push(...(await encerrarExecucaoAntiga(deps, lote.abertoPorTurnoId, "frente_parada")));
  return events;
}

/**
 * A janela adiada (NOD-243): reivindicada como qualquer outra (a trava ADR-011 vale aqui também), UMA execução 'adiada'
 * com a causa e SEM turno, poda, a agenda anda e o evento `rotina_executou` (a web relê lista e histórico) leva o id de
 * quem segura. Na 3ª adiada seguida, UM aviso na conversa da rotina; a 4ª e a 5ª não repetem, e uma execução que
 * roda zera a conta (a sequência é lida do topo do histórico).
 */
async function registrarAdiada(deps: Deps, input: EntradaDisparo, segura: Segura, agora: number, antes: RuntimeEvent[]): Promise<{ data: SaidaDisparo; events?: RuntimeEvent[] }> {
  const { rotina, instanteAgendado } = input;
  const ganhou = await deps.repos.rotinaJanelas.reivindicar({ rotinaId: rotina.id, instanteAgendado, machineId: input.machineId, executor: input.executor });
  if (!ganhou) return janelaJaUsada(deps, input, antes);
  const execucao = await deps.repos.rotinaExecucoes.registrar({ rotinaId: rotina.id, instanteAgendado, turnoId: null, desfecho: "adiada", motivo: segura.motivo, em: agora });
  if (!execucao) throw new ErroDeDominio("estado_invalido", { cause: "execução adiada não registrada" });
  await deps.repos.rotinaExecucoes.podar(rotina.id);
  await deps.repos.rotinaJanelas.podar(rotina.id, agora);
  const proximaExecucao = proximaJanela({ cron: rotina.cron, fusoIana: rotina.fusoIana, agora: Math.max(agora, instanteAgendado) });
  await deps.repos.rotinas.reagendar(rotina.id, proximaExecucao);
  const autoria = autoriaPessoa(deps.escopo.pessoaId, REGRA_ADIADA);
  const dados = { rotinaId: rotina.id, execucaoId: execucao.id, desfecho: "adiada", motivo: segura.motivo, instanteAgendado, turnoAbertoId: segura.turnoAbertoId, trabalhoAbertoId: segura.trabalhoAbertoId ?? null };
  const events: RuntimeEvent[] = [...antes, evento(deps, "rotina_executou", autoria, dados, { conversaId: rotina.conversaId })];
  const recentes = await deps.repos.rotinaExecucoes.listar(rotina.id, ADIADAS_PARA_AVISAR + 1);
  const seguidas = recentes.findIndex((e) => e.desfecho !== "adiada");
  if ((seguidas === -1 ? recentes.length : seguidas) === ADIADAS_PARA_AVISAR) {
    const aviso = await deps.repos.mensagens.criar({
      conversaId: rotina.conversaId,
      autoria,
      kind: "sistema",
      texto: textoAvisoAdiada(segura),
      confianca: "confiavel",
    });
    if (aviso) events.push(evento(deps, "mensagem_criada", autoria, { mensagem_id: aviso.id, kind: "sistema" }, { conversaId: rotina.conversaId }));
  }
  const saida: SaidaDisparo = { adiada: segura.motivo, turnoAbertoId: segura.turnoAbertoId, ...(segura.trabalhoAbertoId ? { trabalhoAbertoId: segura.trabalhoAbertoId } : {}), proximaExecucao };
  return { data: saida, events };
}

/** O aviso único das adiadas. revisto em 2026-10-16 (revisão do Gil no #335, A2): "terminar", como a lista. */
export function textoAvisoAdiada(segura: Pick<Segura, "motivo" | "titulo">): string {
  const n = ADIADAS_PARA_AVISAR;
  if (segura.motivo === "frente_aberta") {
    const frente = segura.titulo ? `a frente “${segura.titulo}”` : "uma frente desta rotina";
    return `Esta rotina não rodou nas últimas ${n} janelas porque ${frente} ainda não terminou. Ela volta a rodar sozinha quando a frente terminar.`;
  }
  return `Esta rotina não rodou nas últimas ${n} janelas porque a execução anterior ainda não terminou. Ela volta a rodar sozinha quando essa execução terminar.`;
}

/**
 * A janela já tinha dono (outro processo, ou o "Testar agora" no mesmo minuto do cron). revisto em 2026-10-15
 * (NOD-271): se a agenda ainda aponta para o passado, ela anda — antes a rotina ficava vencida para sempre e cada tick
 * perdia a mesma janela em silêncio.
 */
async function janelaJaUsada(deps: Deps, input: EntradaDisparo, antes: RuntimeEvent[]): Promise<{ data: SaidaDisparo; events?: RuntimeEvent[] }> {
  const { rotina, instanteAgendado } = input;
  const agora = deps.agora();
  if (input.preservarAgenda || rotina.proximaExecucao > agora) return { data: { janelaDeOutro: true }, ...(antes.length ? { events: antes } : {}) };
  const proximaExecucao = proximaJanela({ cron: rotina.cron, fusoIana: rotina.fusoIana, agora: Math.max(agora, instanteAgendado) });
  await deps.repos.rotinas.reagendar(rotina.id, proximaExecucao);
  return { data: { janelaDeOutro: true, proximaExecucao }, ...(antes.length ? { events: antes } : {}) };
}

/**
 * ÚNICO lugar que avalia cron em execução (ADR-011): reivindica a janela canônica (UNIQUE por
 * tenant/rotina/instante — false = outro processo ganhou, silencioso), enfileira o turno origem
 * 'rotina' (modo 'rotina' no plano; EMENDA 12 põe fala humana na frente), liga janela → turno e
 * reagenda a próxima execução a partir de `agora`. definido em 2026-09-16: janelas perdidas
 * (servidor fora do ar) NÃO são repostas — uma rotina das 8h que só rodou às 14h é uma execução,
 * não seis. A execução em `rotina_execucoes` só nasce com desfecho (executou | falhou |
 * passou_em_branco): o enum não tem 'pendente', e a janela com turno_id é o registro do "em curso".
 * A janela que o pré-voo para nasce 'bloqueada', sem turno (registrarBloqueio). A da rotina `soComPendencia` sem
 * pendência visível nasce 'sem_novidade'/'sem_pendencia', também sem turno (registrarSemPendencia).
 */
export const dispararRotina: CasoDeUso<EntradaDisparo, SaidaDisparo> = async (deps, input) => {
  const { rotina, instanteAgendado } = input;
  // definido em 2026-09-24 (ADR-045): UMA execução aberta por rotina, só no caminho do AGENDADOR. "Executar agora" e
  // "Permitir e rodar agora" (preservarAgenda) são atos da pessoa e nunca são adiados nem cortam nada.
  // revisto em 2026-10-15 (NOD-243): o que segura a janela deixa rastro (execução 'adiada') e não segura para sempre —
  // o turno pendente que nunca começou vence na janela seguinte, e a frente sem nada vivo há 24 h deixa de segurar.
  // revisto em 2026-10-16 (integração da main no #335): a 'adiada' cobre também a janela pulada da NOD-274 (C9), que na
  // main virava 'nao_rodou'/'execucao_anterior_aberta' — um registro só por janela pulada.
  const antes: RuntimeEvent[] = [];
  if (!input.preservarAgenda) {
    const agora = deps.agora();
    const segura = await quemSegura(deps, rotina, instanteAgendado, agora, antes);
    if (segura) return registrarAdiada(deps, input, segura, agora, antes);
  }
  const ganhou = await deps.repos.rotinaJanelas.reivindicar({ rotinaId: rotina.id, instanteAgendado, machineId: input.machineId, executor: input.executor });
  if (!ganhou) return janelaJaUsada(deps, input, antes);
  const agente = await agenteVisivel(deps.repos, rotina.agenteId);
  const agora = deps.agora();
  // definido em 2026-09-24 (emenda da ADR-044): o pré-voo, depois de reivindicar a janela (ADR-011
  // inalterado) e antes do turno — no agendador e no "executar agora"; a pergunta pendente só trava o
  // agendador, porque "executar agora" é ato da pessoa.
  const bloqueio = input.aposConceder ? null : await preVooDaRotina(deps, rotina, { agendada: !input.preservarAgenda });
  if (bloqueio) return registrarBloqueio(deps, input, bloqueio, agora);
  const fechoDasVoltas = input.preservarAgenda ? [] : await fecharPerguntasDasVoltas(deps, rotina, agora);
  const r = await abrirJanela(deps, input, agente, agora, antes);
  return fechoDasVoltas.length === 0 ? r : { ...r, events: [...fechoDasVoltas, ...(r.events ?? [])] };
};

/** O resto do disparo, depois do pré-voo: a janela sem pendência ou o turno da rotina. */
async function abrirJanela(deps: Deps, input: EntradaDisparo, agente: Awaited<ReturnType<typeof agenteVisivel>>, agora: number, antes: RuntimeEvent[]): Promise<{ data: SaidaDisparo; events?: RuntimeEvent[] }> {
  const { rotina, instanteAgendado } = input;
  // definido em 2026-10-01 (item 7 da ADR-066): depois do pré-voo (a rotina parada por acesso segue parada, com o
  // card dela) e antes do turno. Só no agendador: "Executar agora" e "Permitir e rodar agora" (preservarAgenda) são
  // atos da pessoa e rodam sempre. Visível = a mesma regra do prompt: aberta e com a_partir_de já passado.
  // revisto em 2026-10-06: com o "A fazer" desligado o bot não anota nem vê pendência, então a rotina não acorda.
  if (rotina.soComPendencia && !input.preservarAgenda && (input.aFazer !== true || pendenciasDoPrompt(await deps.repos.pendencias.abertasDoAgente(rotina.agenteId), agora).length === 0)) {
    return registrarSemPendencia(deps, input, agora);
  }
  // revisto em 2026-10-12 (ADR-099 item 1 e decisão 3, I7 revista; era um trabalho por execução, ADR-083 S7/S13): a rotina
  // é um alarme que põe um pedido na fila do dono — um turno curto "rodar <rotina>" na conversa dela (a do bot, ou a sala),
  // sem trabalho, que o `reivindicar` põe depois das falas da pessoa. O dono faz o que é rápido ali mesmo ou abre frentes
  // (abrir_frentes); o lote volta a ele (I3), que fecha a execução com a linha "da rotina". Modo, catálogo e aprovações
  // são os da rotina, como antes (o turno é origem 'rotina', ligado à janela).
  const turno = await deps.repos.turnos.enfileirar({
    conversaId: rotina.conversaId,
    agenteId: rotina.agenteId,
    origem: "rotina",
    prazoEm: agora + PRAZO_DECISAO_MS,
    profundidade: 0,
    entradaTexto: montarEntradaRotina(rotina, instanteAgendado, await pedidosAbertosDoBot(deps, rotina.agenteId, agora)),
    // revisto em 2026-10-01 (ADR-066): a entrada da rotina é confiável — é a instrução que a pessoa confirmou. Antes
    // ela nascia não confiável quando a FONTE citava um app de fora (GitHub, Gmail), e o catálogo perdia a escrita:
    // 1.040 de 1.130 turnos de rotina saíram assim até 30/09. A marca agora vem do que o bot lê (chamar-ferramenta.ts).
    entradaConfianca: "confiavel",
    modelo: agente.modelo,
    harness: agente.harness,
    executor: input.executor,
    // definido em 2026-10-15 (NOD-272, ADR-085): o "Testar agora" e o "Permitir e rodar agora" são a pessoa olhando a
    // tela — o turno não espera a reserva da cota nem o portão do Mac, como uma fala dela.
    pessoaEsperando: input.preservarAgenda === true,
  });
  if (!turno) throw new ErroDeDominio("estado_invalido", { cause: "turno de rotina não criado" });
  await deps.repos.rotinaJanelas.vincularTurno({ rotinaId: rotina.id, instanteAgendado, turnoId: turno.id });
  const proximaExecucao = input.preservarAgenda ? rotina.proximaExecucao : proximaJanela({ cron: rotina.cron, fusoIana: rotina.fusoIana, agora: Math.max(agora, instanteAgendado) });
  if (!input.preservarAgenda) await deps.repos.rotinas.reagendar(rotina.id, proximaExecucao);
  const autoria = autoriaPessoa(deps.escopo.pessoaId, "regra:scheduler-rotina");
  return {
    data: { turno, proximaExecucao },
    events: [...antes, evento(deps, "turno_criado", autoria, { turnoId: turno.id, rotinaId: rotina.id, origem: "rotina", instanteAgendado }, { conversaId: rotina.conversaId, turnoId: turno.id })],
  };
}

/**
 * `pedido_dispensado` (definido em 2026-09-24): a pessoa dispensou, ainda aberto, o pedido que a
 * execução fez (dispensar-decisao.ts). `pergunta_sem_resposta` (mesma data, fio da pergunta): a
 * pergunta da execução venceu sem resposta (varredor-expiracao.ts). rotina_execucoes.motivo é text com
 * CHECK '^[a-z_]+$' (0002): os valores novos passam sem migração. `sem_pendencia` (definido em 2026-10-01, item 7
 * da ADR-066) hoje só nasce em registrarSemPendencia, sem turno; está na união para o histórico ter um tipo só.
 */
export type EntradaDesfecho = {
  turnoId: string;
  desfecho: DesfechoRotina;
  motivo?: MotivoFalha | MotivoSemNovidade | MotivoSemPendencia | MotivoAdiada | MotivoInterrupcaoRotina | "maquina_sem_contato" | "reinicio_servidor" | "ninguem_respondeu_o_gate" | "pedido_dispensado" | "pergunta_sem_resposta" | "voltas_sem_novidade" | "parado_pela_pessoa" | MotivoNaoRodouRotina | null;
  /** A regra que interrompeu (autoria do evento de `interrompida`); sem ela, a do varredor de lease. NOD-219: `regra:turno-orfao`. */
  regra?: `regra:${string}`;
  /** NOD-274: 'nao_rodou' por cota — quando a cota volta (vai para o histórico). */
  voltaEm?: number | null;
};

/** O motivo do passou_em_branco em palavras na conversa; o código fica na execução. Sem tradução sai como está. */
const MOTIVO_EM_BRANCO: Readonly<Record<string, string>> = {
  ninguem_respondeu_o_gate: "ninguém respondeu o gate",
  pedido_dispensado: "o pedido foi dispensado sem resposta",
  pergunta_sem_resposta: "ninguém respondeu a pergunta",
};

/**
 * Desfechos que NÃO escrevem na conversa: a execução fica só no histórico da rotina. sem_novidade
 * (definido em 2026-09-21): rodou e não tinha nada; interrompida (definido em 2026-09-24, ADR-045): a
 * máquina parou no meio — quem avisa é o aviso único do incidente, não uma linha por execução. nao_rodou (definido em
 * 2026-10-15, NOD-274): a janela não rodou (cota ou execução anterior aberta) — fica no histórico, com a hora da volta.
 */
const SILENCIOSOS: ReadonlySet<DesfechoRotina> = new Set<DesfechoRotina>(["sem_novidade", "interrompida", "nao_rodou"]);

/** Moram em contracts/pedido.ts desde a NOD-255 (o pré-voo também as lê); reexportadas para quem já importava daqui. */
export { TIPOS_GATE_ROTINA, TIPOS_QUE_SEGURAM_A_EXECUCAO };

/**
 * `aguardando_volta` (definido em 2026-10-15, NOD-255): uma retomada da execução (a volta marcada, a resposta da pessoa,
 * o retorno do lote) ainda espera ou roda — o desfecho é dela, e a linha "Rotina executou" sai uma vez, depois da volta.
 * `inalterado` (mesma data): a janela já tinha esse desfecho — nada a reescrever, nenhum evento nem mensagem de novo.
 */
export type SaidaDesfecho =
  | { execucao: ExecucaoRotina; rotina: Rotina; podadas: number; inalterado?: true }
  | { ignorado: "nao_e_rotina" | "aguardando_gate" | "aguardando_frentes" | "aguardando_volta" | "repetido_sem_resume" };

/**
 * Assentamento de um turno de rotina (chamado pela L6 ao assentar turno origem 'rotina' ou sua
 * retomada, e pelo varredor no gate vencido): registra a execução com desfecho TIPADO —
 * passou_em_branco ≠ falhou (E7.5) — poda para as 20 mais recentes, escreve a mensagem
 * kind 'rotina_execucao' na conversa da rotina e emite rotina_executou. 'executou' com um gate
 * ainda pendente para o mesmo turno NÃO conta: a rotina só executou quando o efeito saiu.
 */
export async function registrarDesfechoRotina(deps: Pick<Deps, "repos" | "escopo" | "agora">, input: EntradaDesfecho): Promise<{ data: SaidaDesfecho; events?: RuntimeEvent[] }> {
  const ligacao = await rotinaDoTurno(deps.repos, input.turnoId);
  if (!ligacao) return { data: { ignorado: "nao_e_rotina" } };
  const { rotina, turnoDisparado, instanteAgendado } = ligacao;
  // ADR-107 (NOD-281, critério 4): o CLI recusou a sessão da cadeia e a retomada já está de novo na fila, sem resume
  // (assentar-turno.ts, repetirRetomadaSemSessao). A execução não acabou: quem registra o desfecho é a repetição.
  if (input.desfecho === "falhou" && (await repetidoSemResume(deps, input.turnoId))) return { data: { ignorado: "repetido_sem_resume" } };
  // 'sem_novidade' entra aqui junto com 'executou' (definido em 2026-09-21): se um gate deste turno
  // ainda espera resposta, a execução não terminou — registrá-la como silenciosa esconderia um
  // pedido de aprovação pendente. A rotina só encerra quando o efeito saiu.
  if (input.desfecho === "executou" || input.desfecho === "sem_novidade") {
    const turnosDaRotina = new Set([turnoDisparado.id, input.turnoId]);
    const gatesAbertos = (await deps.repos.decisoes.pendentesDaConversa(rotina.conversaId)).filter((d) => TIPOS_QUE_SEGURAM_A_EXECUCAO.has(d.tipo) && d.turnoId !== null && turnosDaRotina.has(d.turnoId));
    if (gatesAbertos.length > 0) return { data: { ignorado: "aguardando_gate" } };
    // definido em 2026-10-12 (ADR-099, I7 revista): o turno do dono que abriu frentes para a rotina não é o fim da
    // execução — o desfecho (e a linha "da rotina") é do retorno do lote, quando as frentes acabam (I3).
    if ((await deps.repos.pedidosDeColega.frentesAbertasDosTurnos([...turnosDaRotina])) > 0) return { data: { ignorado: "aguardando_frentes" } };
    // definido em 2026-10-15 (NOD-255, I3): a execução que marcou uma volta (ou espera outra retomada) ainda não acabou —
    // é a mesma consulta que segura a janela seguinte (rotinaJanelas.turnoAberto). Sem isto, "Rotina executou" saía no
    // fim do primeiro turno e de novo depois da volta.
    if (await deps.repos.rotinaJanelas.retomadaPendenteDe(turnoDisparado.id, input.turnoId)) return { data: { ignorado: "aguardando_volta" } };
  }
  const agora = deps.agora();
  // definido em 2026-09-24 (ADR-045): UMA linha por janela. A rotina que pergunta e é retomada, ou que
  // cai e depois vence o gate, registra desfecho mais de uma vez para a MESMA janela; a trava da
  // janela serializa quem registra (varredor × entrega) e o desfecho mais recente substitui o anterior.
  await deps.repos.rotinaJanelas.travar(rotina.id, instanteAgendado);
  const anterior = await deps.repos.rotinaExecucoes.daJanela(rotina.id, instanteAgendado);
  // revisto em 2026-10-15 (NOD-255, C18/I3): a janela que já executou não vira "sem novidade" porque um turno seguinte
  // dela não achou nada — o efeito já saiu. E o mesmo desfecho de novo não reescreve: nem evento nem mensagem repetidos.
  const desfecho: DesfechoRotina = anterior?.desfecho === "executou" && input.desfecho === "sem_novidade" ? "executou" : input.desfecho;
  if (anterior && anterior.desfecho === desfecho) return { data: { execucao: anterior, rotina, podadas: 0, inalterado: true }, events: [] };
  const motivo = desfecho === input.desfecho ? (input.motivo ?? null) : anterior?.motivo ?? null;
  const execucao = anterior
    ? await deps.repos.rotinaExecucoes.atualizarDesfecho(anterior.id, desfecho, motivo, agora, input.voltaEm ?? null)
    : await deps.repos.rotinaExecucoes.registrar({
        rotinaId: rotina.id,
        instanteAgendado,
        turnoId: turnoDisparado.id,
        desfecho,
        motivo,
        em: agora,
        voltaEm: input.voltaEm ?? null,
      });
  if (!execucao) throw new ErroDeDominio("estado_invalido", { cause: "execução não registrada" });
  const podadas = await deps.repos.rotinaExecucoes.podar(rotina.id);
  // NOD-271: as janelas de mais de 30 dias com turno acabado saem junto (a trava da janela só vale enquanto o instante
  // pode voltar a ser disputado); sem isto `rotina_janelas` só crescia.
  await deps.repos.rotinaJanelas.podar(rotina.id, agora);
  const dados = { rotinaId: rotina.id, execucaoId: execucao.id, desfecho, motivo, instanteAgendado };
  // definido em 2026-09-21: SILÊNCIO. A execução ficou registrada acima (e aparece no histórico da
  // rotina), mas nada é escrito na conversa — nem a fala do agente (suprimida em assentar-turno.ts)
  // nem este marcador. Uma rotina que roda a cada 5 min e não acha novidade não deve deixar rastro
  // no chat; quem quer conferir que ela rodou olha o histórico.
  if (SILENCIOSOS.has(desfecho)) {
    const autoriaSilencio = desfecho === "interrompida" ? autoriaPessoa(deps.escopo.pessoaId, input.regra ?? "regra:varredor_lease") : autoriaAgente(rotina.agenteId, deps.escopo.pessoaId);
    return {
      data: { execucao, rotina, podadas },
      events: [evento(deps, "rotina_executou", autoriaSilencio, dados, { conversaId: rotina.conversaId, turnoId: turnoDisparado.id })],
    };
  }
  const autoria = desfecho === "executou" ? autoriaAgente(rotina.agenteId, deps.escopo.pessoaId) : autoriaPessoa(deps.escopo.pessoaId, "regra:varredor-expiracao");
  const events: RuntimeEvent[] = [evento(deps, "rotina_executou", autoria, dados, { conversaId: rotina.conversaId, turnoId: turnoDisparado.id })];
  const quando = carimbo(agora, rotina.fusoIana);
  const texto =
    desfecho === "executou"
      ? `Rotina executou em ${quando} (${rotina.fusoIana}): ${resumoCron(rotina.cron, rotina.fusoIana)}.`
      : desfecho === "passou_em_branco"
        ? `${redigir("rotina-passou-em-branco", agora, { motivo: input.motivo ? (MOTIVO_EM_BRANCO[input.motivo] ?? input.motivo) : "sem motivo" })} (${quando})`
        : `${redigir("rotina-falhou", agora, { motivo: motivoEmPortugues(input.motivo ?? "erro_execucao") })} (${quando})`;
  await deps.repos.mensagens.criar({
    conversaId: rotina.conversaId,
    turnoId: turnoDisparado.id,
    autoria,
    kind: "rotina_execucao",
    texto,
    payload: { kind: "rotina_execucao", rotinaId: rotina.id, instanteAgendado, desfecho },
    confianca: "confiavel",
  });
  return { data: { execucao, rotina, podadas }, events };
}

/** O turno recusado pelo CLI (sessao_rejeitada) cuja repetição sem resume ainda está na fila. */
export async function repetidoSemResume(deps: Pick<Deps, "repos">, turnoId: string): Promise<boolean> {
  const turno = await deps.repos.turnos.buscar(turnoId);
  if (turno?.motivoInterrupcao !== "sessao_rejeitada") return false;
  const repeticao = await deps.repos.turnos.retomadaNaFila(turnoId);
  return repeticao !== null && repeticao.reenvios > turno.reenvios;
}

/** NOD-251/NOD-275: quem decidiu que a janela não rodou — a máquina recusou o turno no despacho, ou a pessoa pediu Parar. */
export const REGRA_DESPACHO_RECUSADO = "regra:despacho-recusado" as const;
export const REGRA_PARAR = "regra:parar" as const;

/** Por que a janela da rotina terminou sem rodar: a recusa do despacho (do inventário ou da conta) ou o Parar da pessoa. */
export type MotivoRecusaDaRotina = "motor_ausente" | "nao_autenticado" | "limite_do_plano" | "parado_pela_pessoa";

/**
 * NOD-251/NOD-275 (definido em 2026-10-15): o turno de rotina (ou a retomada dela) que o despacho recusou — motor ausente,
 * CLI sem login, conta no limite — ou que a pessoa parou antes de rodar. Sem isto a janela sumia do histórico: o turno saía
 * `interrompido`, mas `rotina_execucoes` não ganhava linha e a trilha `rotina_*` não tinha evento. Registra 'interrompida'
 * com o motivo, na MESMA tx do despacho, e devolve o `rotina_executou`. 'interrompida' é silencioso (SILENCIOSOS): a nota
 * ou a negação que o despacho já escreve é a única linha no chat. Turno que não leva a uma rotina → nada.
 */
export async function registrarRecusaDaRotina(deps: Pick<Deps, "repos" | "escopo" | "agora">, turno: Pick<Turno, "id" | "origem">, motivo: MotivoRecusaDaRotina): Promise<RuntimeEvent[]> {
  if (turno.origem !== "rotina" && turno.origem !== "retomada") return [];
  const regra = motivo === "parado_pela_pessoa" ? REGRA_PARAR : REGRA_DESPACHO_RECUSADO;
  const r = await registrarDesfechoRotina(deps, { turnoId: turno.id, desfecho: "interrompida", motivo, regra });
  return "execucao" in r.data ? (r.events ?? []) : [];
}

/**
 * O desfecho da janela quando a máquina entrega o turno da rotina (ou da retomada dela) — chamado pela ponte depois de
 * assentar (compor.ts, depoisDeAssentar), na mesma tx. Turno que não é de rotina → nada.
 * - definido em 2026-09-24 (ADR-045): turno derrubado pela máquina já registrou a execução como 'interrompida'
 *   (interromper-por-maquina.ts); registrar 'falhou' aqui sobrescreveria a janela. NOD-245: idem `reinicio_servidor`.
 * - definido em 2026-09-21: concluído + `sem_novidade` chamado = execução completa que não rendeu notícia ('sem_novidade',
 *   silencioso); concluído = 'executou'; o resto = 'falhou' com o motivo da falha.
 * - NOD-251 (definido em 2026-10-15): "Parar" no meio da rotina não é erro técnico — a janela fica 'interrompida'
 *   (silenciosa) com o motivo parado_pela_pessoa, sem a linha "A rotina falhou por erro técnico" no chat.
 */
export async function registrarDesfechoDaEntrega(deps: Pick<Deps, "repos" | "escopo" | "agora">, turno: Turno): Promise<RuntimeEvent[]> {
  if (turno.origem !== "rotina" && turno.origem !== "retomada") return [];
  // NOD-245: o mesmo para `reinicio_servidor` (a entrega do turno adotado que o deploy derrubou).
  if (turno.motivoInterrupcao === "maquina_sem_contato" || turno.motivoInterrupcao === "reinicio_servidor") return [];
  if (turno.estado === "interrompido" && turno.motivoInterrupcao === "parado_pela_pessoa") return registrarRecusaDaRotina(deps, turno, "parado_pela_pessoa");
  const silencioso = turno.estado === "concluido" && turno.semNovidadeMotivo !== null;
  const desfecho = silencioso ? "sem_novidade" : turno.estado === "concluido" ? "executou" : "falhou";
  const r = await registrarDesfechoRotina(deps, { turnoId: turno.id, desfecho, motivo: silencioso ? turno.semNovidadeMotivo : desfecho === "falhou" ? (turno.motivoFalha ?? null) : null });
  return "execucao" in r.data ? (r.events ?? []) : [];
}
