import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { TipoDecisao } from "../contracts/decisao.ts";
import type { DesfechoRotina, MotivoBloqueioRotina, MotivoFalha, MotivoSemNovidade, MotivoSemPendencia } from "../contracts/motivos.ts";
import { TIPOS_PEDIDO_A_PESSOA } from "../contracts/pedido.ts";
import type { ExecucaoRotina, Rotina } from "../contracts/rotina.ts";
import type { Turno } from "../contracts/turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { pendenciasDoPrompt } from "../domain/pendencia.ts";
import { motivoEmPortugues, redigir } from "../domain/redacao.ts";
import { proximaJanela } from "../domain/rotina-janela.ts";
import { resumoCron } from "../domain/rotina-texto.ts";
import { agenteVisivel, autoriaAgente, autoriaPessoa, carimbo, evento, PRAZO_DECISAO_MS, rotinaDoTurno } from "./apoio-l7.ts";
import { preVooDaRotina, REGRA_PRE_VOO, type BloqueioDoPreVoo } from "./pre-voo-rotina.ts";
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
 * `pulada`: o turno da execução anterior ainda está aberto; a rotina foi só reagendada (ADR-045).
 * `bloqueada` (definido em 2026-09-24, emenda da ADR-044): o pré-voo parou a janela sem turno — o
 * motivo, o card de acesso que a destrava (null quando é a pergunta que espera) e a próxima execução.
 * `semPendencia` (definido em 2026-10-01, item 7 da ADR-066): a rotina só acorda com pendência e o agente não tinha
 * nenhuma visível — a janela passou sem turno (registrarSemPendencia) e a agenda andou.
 */
export type SaidaDisparo =
  | { turno: Turno; proximaExecucao: number }
  | { janelaDeOutro: true }
  | { pulada: true; turnoAbertoId: string | null; trabalhoAbertoId?: string; proximaExecucao: number }
  | { bloqueada: MotivoBloqueioRotina; propostaId: string | null; proximaExecucao: number }
  | { semPendencia: true; proximaExecucao: number };

/**
 * Entrada de um turno de rotina é a instrução normalizada mais o contexto fixo (fonte, entregável,
 * limites, política sem dado). Texto do SERVIDOR, não do modelo: só o que a pessoa confirmou.
 */
export function montarEntradaRotina(rotina: Rotina, instanteAgendado: number): string {
  return [
    `Execução agendada da rotina "${resumoCron(rotina.cron, rotina.fusoIana)}" em ${carimbo(instanteAgendado, rotina.fusoIana)} (${rotina.fusoIana}).`,
    `Instrução: ${rotina.instrucao}`,
    `Fonte: ${rotina.fonte}`,
    `Entregável: ${rotina.entregavel}`,
    `Limites de aprovação: ${rotina.limitesAprovacao}`,
    `Se não houver dado: ${rotina.politicaSemDado}`,
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
  // definido em 2026-09-24 (ADR-045): UMA execução aberta por rotina, só no caminho do AGENDADOR. Turno
  // anterior ainda pendente ou rodando (o Mac dormiu no meio) → reagenda sem reivindicar a janela: sem
  // isto as execuções se empilhavam a cada acordar. "Executar agora" e "Permitir e rodar agora"
  // (preservarAgenda) são atos da pessoa e nunca são pulados.
  if (!input.preservarAgenda) {
    const turnoAbertoId = await deps.repos.rotinaJanelas.turnoAberto(rotina.id);
    // definido em 2026-10-08 (revisão do épico, S12): também enquanto uma task que uma execução anterior abriu (filha)
    // não acabou — a execução seguinte, sem ver a anterior, abria a mesma task de novo, a cada janela. revisto em
    // 2026-10-12 (ADR-099, I7 revista): e enquanto uma frente que o dono abriu para a rotina não acabou.
    const filha = turnoAbertoId ? null : await deps.repos.trabalhos.filhaAbertaDaRotina(rotina.id);
    if (turnoAbertoId || filha) {
      const proximaExecucao = proximaJanela({ cron: rotina.cron, fusoIana: rotina.fusoIana, agora: Math.max(deps.agora(), instanteAgendado) });
      await deps.repos.rotinas.reagendar(rotina.id, proximaExecucao);
      return { data: { pulada: true, turnoAbertoId, ...(filha ? { trabalhoAbertoId: filha.id } : {}), proximaExecucao } };
    }
  }
  const ganhou = await deps.repos.rotinaJanelas.reivindicar({ rotinaId: rotina.id, instanteAgendado, machineId: input.machineId, executor: input.executor });
  if (!ganhou) return { data: { janelaDeOutro: true } };
  const agente = await agenteVisivel(deps.repos, rotina.agenteId);
  const agora = deps.agora();
  // definido em 2026-09-24 (emenda da ADR-044): o pré-voo, depois de reivindicar a janela (ADR-011
  // inalterado) e antes do turno — no agendador e no "executar agora"; a pergunta pendente só trava o
  // agendador, porque "executar agora" é ato da pessoa.
  const bloqueio = input.aposConceder ? null : await preVooDaRotina(deps, rotina, { agendada: !input.preservarAgenda });
  if (bloqueio) return registrarBloqueio(deps, input, bloqueio, agora);
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
    entradaTexto: montarEntradaRotina(rotina, instanteAgendado),
    // revisto em 2026-10-01 (ADR-066): a entrada da rotina é confiável — é a instrução que a pessoa confirmou. Antes
    // ela nascia não confiável quando a FONTE citava um app de fora (GitHub, Gmail), e o catálogo perdia a escrita:
    // 1.040 de 1.130 turnos de rotina saíram assim até 30/09. A marca agora vem do que o bot lê (chamar-ferramenta.ts).
    entradaConfianca: "confiavel",
    modelo: agente.modelo,
    harness: agente.harness,
    executor: input.executor,
  });
  if (!turno) throw new ErroDeDominio("estado_invalido", { cause: "turno de rotina não criado" });
  await deps.repos.rotinaJanelas.vincularTurno({ rotinaId: rotina.id, instanteAgendado, turnoId: turno.id });
  const proximaExecucao = input.preservarAgenda ? rotina.proximaExecucao : proximaJanela({ cron: rotina.cron, fusoIana: rotina.fusoIana, agora: Math.max(agora, instanteAgendado) });
  if (!input.preservarAgenda) await deps.repos.rotinas.reagendar(rotina.id, proximaExecucao);
  const autoria = autoriaPessoa(deps.escopo.pessoaId, "regra:scheduler-rotina");
  return {
    data: { turno, proximaExecucao },
    events: [evento(deps, "turno_criado", autoria, { turnoId: turno.id, rotinaId: rotina.id, origem: "rotina", instanteAgendado }, { conversaId: rotina.conversaId, turnoId: turno.id })],
  };
};

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
  motivo?: MotivoFalha | MotivoSemNovidade | MotivoSemPendencia | "maquina_sem_contato" | "reinicio_servidor" | "ninguem_respondeu_o_gate" | "pedido_dispensado" | "pergunta_sem_resposta" | null;
  /** A regra que interrompeu (autoria do evento de `interrompida`); sem ela, a do varredor de lease. NOD-219: `regra:turno-orfao`. */
  regra?: `regra:${string}`;
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
 * máquina parou no meio — quem avisa é o aviso único do incidente, não uma linha por execução.
 */
const SILENCIOSOS: ReadonlySet<DesfechoRotina> = new Set<DesfechoRotina>(["sem_novidade", "interrompida"]);

/**
 * definido em 2026-09-16: o gate de uma rotina é QUALQUER pedido de aprovação pendente ligado ao turno
 * dela — tipo 'gate_rotina' (rótulo do plano) ou 'aprovacao' (o que pedirAprovacao da L5 cria hoje).
 * Assim o caminho real (rotina roda → pedir_aprovacao → ninguém responde) chega a passou_em_branco
 * sem depender de a L5 trocar o rótulo; a ligação é o turno_id, dado tipado, nunca a frase.
 */
export const TIPOS_GATE_ROTINA: ReadonlySet<TipoDecisao> = new Set<TipoDecisao>(["gate_rotina", "aprovacao"]);

/**
 * definido em 2026-09-24 (fio da pergunta, emenda da ADR-045): o que SEGURA o desfecho da execução — o
 * gate e as perguntas de pedir_a_pessoa. A execução que pergunta não "executou" ao encerrar o turno da
 * pergunta: todas as rodadas do fio são da mesma janela, e o desfecho é do fio inteiro — 'executou' quando
 * a retomada segue sem perguntar de novo, 'passou_em_branco' quando a pergunta é deixada pra lá ou vence.
 */
export const TIPOS_QUE_SEGURAM_A_EXECUCAO: ReadonlySet<TipoDecisao> = new Set<TipoDecisao>([...TIPOS_GATE_ROTINA, ...TIPOS_PEDIDO_A_PESSOA]);
export type SaidaDesfecho = { execucao: ExecucaoRotina; rotina: Rotina; podadas: number } | { ignorado: "nao_e_rotina" | "aguardando_gate" | "aguardando_frentes" };

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
  }
  const agora = deps.agora();
  // definido em 2026-09-24 (ADR-045): UMA linha por janela. A rotina que pergunta e é retomada, ou que
  // cai e depois vence o gate, registra desfecho mais de uma vez para a MESMA janela; a trava da
  // janela serializa quem registra (varredor × entrega) e o desfecho mais recente substitui o anterior.
  await deps.repos.rotinaJanelas.travar(rotina.id, instanteAgendado);
  const anterior = await deps.repos.rotinaExecucoes.daJanela(rotina.id, instanteAgendado);
  const execucao = anterior
    ? await deps.repos.rotinaExecucoes.atualizarDesfecho(anterior.id, input.desfecho, input.motivo ?? null, agora)
    : await deps.repos.rotinaExecucoes.registrar({
        rotinaId: rotina.id,
        instanteAgendado,
        turnoId: turnoDisparado.id,
        desfecho: input.desfecho,
        motivo: input.motivo ?? null,
        em: agora,
      });
  if (!execucao) throw new ErroDeDominio("estado_invalido", { cause: "execução não registrada" });
  const podadas = await deps.repos.rotinaExecucoes.podar(rotina.id);
  // definido em 2026-09-21: SILÊNCIO. A execução ficou registrada acima (e aparece no histórico da
  // rotina), mas nada é escrito na conversa — nem a fala do agente (suprimida em assentar-turno.ts)
  // nem este marcador. Uma rotina que roda a cada 5 min e não acha novidade não deve deixar rastro
  // no chat; quem quer conferir que ela rodou olha o histórico.
  if (SILENCIOSOS.has(input.desfecho)) {
    const autoriaSilencio = input.desfecho === "interrompida" ? autoriaPessoa(deps.escopo.pessoaId, input.regra ?? "regra:varredor_lease") : autoriaAgente(rotina.agenteId, deps.escopo.pessoaId);
    return {
      data: { execucao, rotina, podadas },
      events: [evento(deps, "rotina_executou", autoriaSilencio, { rotinaId: rotina.id, execucaoId: execucao.id, desfecho: input.desfecho, motivo: input.motivo ?? null, instanteAgendado }, { conversaId: rotina.conversaId, turnoId: turnoDisparado.id })],
    };
  }
  const quando = carimbo(agora, rotina.fusoIana);
  const texto =
    input.desfecho === "executou"
      ? `Rotina executou em ${quando} (${rotina.fusoIana}): ${resumoCron(rotina.cron, rotina.fusoIana)}.`
      : input.desfecho === "passou_em_branco"
        ? `${redigir("rotina-passou-em-branco", agora, { motivo: input.motivo ? (MOTIVO_EM_BRANCO[input.motivo] ?? input.motivo) : "sem motivo" })} (${quando})`
        : `${redigir("rotina-falhou", agora, { motivo: motivoEmPortugues(input.motivo ?? "erro_execucao") })} (${quando})`;
  const autoria = input.desfecho === "executou" ? autoriaAgente(rotina.agenteId, deps.escopo.pessoaId) : autoriaPessoa(deps.escopo.pessoaId, "regra:varredor-expiracao");
  await deps.repos.mensagens.criar({
    conversaId: rotina.conversaId,
    turnoId: turnoDisparado.id,
    autoria,
    kind: "rotina_execucao",
    texto,
    payload: { kind: "rotina_execucao", rotinaId: rotina.id, instanteAgendado, desfecho: input.desfecho },
    confianca: "confiavel",
  });
  const events: RuntimeEvent[] = [
    evento(deps, "rotina_executou", autoria, { rotinaId: rotina.id, execucaoId: execucao.id, desfecho: input.desfecho, motivo: input.motivo ?? null, instanteAgendado }, { conversaId: rotina.conversaId, turnoId: turnoDisparado.id }),
  ];
  return { data: { execucao, rotina, podadas }, events };
}
