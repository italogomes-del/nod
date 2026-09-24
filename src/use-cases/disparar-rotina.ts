import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { TipoDecisao } from "../contracts/decisao.ts";
import type { Confianca } from "../contracts/mensagem.ts";
import type { DesfechoRotina, MotivoFalha, MotivoSemNovidade } from "../contracts/motivos.ts";
import { TIPOS_PEDIDO_A_PESSOA } from "../contracts/pedido.ts";
import type { ExecucaoRotina, Rotina } from "../contracts/rotina.ts";
import type { Turno } from "../contracts/turno.ts";
import { conectorTocaAprendiz } from "../domain/dado-pessoal.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { redigir } from "../domain/redacao.ts";
import { proximaJanela } from "../domain/rotina-janela.ts";
import { resumoCron } from "../domain/rotina-texto.ts";
import { agenteVisivel, autoriaAgente, autoriaPessoa, carimbo, evento, PRAZO_DECISAO_MS, rotinaDoTurno } from "./apoio-l7.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

export type EntradaDisparo = { rotina: Rotina; instanteAgendado: number; machineId: string; executor: Executor; preservarAgenda?: boolean };
/** `pulada`: o turno da execução anterior ainda está aberto; a rotina foi só reagendada (ADR-045). */
export type SaidaDisparo = { turno: Turno; proximaExecucao: number } | { janelaDeOutro: true } | { pulada: true; turnoAbertoId: string; proximaExecucao: number };

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
 * A fonte da rotina é prosa; o que decide confiança é dado TIPADO: se a fonte cita (por slug ou
 * nome) um conector habilitado que toca dado de aprendiz, a entrada nasce nao_confiavel e o plano
 * reduz o catálogo (ADR-026). Não é interpretação de intenção: é casar nomes de conectores.
 */
export async function confiancaDaFonte(deps: Pick<Deps, "repos">, fonte: string): Promise<Confianca> {
  const f = fonte.toLowerCase();
  for (const c of await deps.repos.conectores.listarHabilitados()) {
    const citado = f.includes(c.slug.toLowerCase()) || f.includes(c.nome.toLowerCase());
    if (citado && conectorTocaAprendiz(c)) return "nao_confiavel";
  }
  return "confiavel";
}

/**
 * ÚNICO lugar que avalia cron em execução (ADR-011): reivindica a janela canônica (UNIQUE por
 * tenant/rotina/instante — false = outro processo ganhou, silencioso), enfileira o turno origem
 * 'rotina' (modo 'rotina' no plano; EMENDA 12 põe fala humana na frente), liga janela → turno e
 * reagenda a próxima execução a partir de `agora`. definido em 2026-09-16: janelas perdidas
 * (servidor fora do ar) NÃO são repostas — uma rotina das 8h que só rodou às 14h é uma execução,
 * não seis. A execução em `rotina_execucoes` só nasce com desfecho (executou | falhou |
 * passou_em_branco): o enum não tem 'pendente', e a janela com turno_id é o registro do "em curso".
 */
export const dispararRotina: CasoDeUso<EntradaDisparo, SaidaDisparo> = async (deps, input) => {
  const { rotina, instanteAgendado } = input;
  // definido em 2026-09-24 (ADR-045): UMA execução aberta por rotina, só no caminho do AGENDADOR. Turno
  // anterior ainda pendente ou rodando (o Mac dormiu no meio) → reagenda sem reivindicar a janela: sem
  // isto as execuções se empilhavam a cada acordar. "Executar agora" e "Permitir e rodar agora"
  // (preservarAgenda) são atos da pessoa e nunca são pulados.
  if (!input.preservarAgenda) {
    const turnoAbertoId = await deps.repos.rotinaJanelas.turnoAberto(rotina.id);
    if (turnoAbertoId) {
      const proximaExecucao = proximaJanela({ cron: rotina.cron, fusoIana: rotina.fusoIana, agora: Math.max(deps.agora(), instanteAgendado) });
      await deps.repos.rotinas.reagendar(rotina.id, proximaExecucao);
      return { data: { pulada: true, turnoAbertoId, proximaExecucao } };
    }
  }
  const ganhou = await deps.repos.rotinaJanelas.reivindicar({ rotinaId: rotina.id, instanteAgendado, machineId: input.machineId, executor: input.executor });
  if (!ganhou) return { data: { janelaDeOutro: true } };
  const agente = await agenteVisivel(deps.repos, rotina.agenteId);
  const agora = deps.agora();
  const turno = await deps.repos.turnos.enfileirar({
    conversaId: rotina.conversaId,
    agenteId: rotina.agenteId,
    origem: "rotina",
    prazoEm: agora + PRAZO_DECISAO_MS,
    profundidade: 0,
    entradaTexto: montarEntradaRotina(rotina, instanteAgendado),
    entradaConfianca: await confiancaDaFonte(deps, rotina.fonte),
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
 * CHECK '^[a-z_]+$' (0002): os valores novos passam sem migração.
 */
export type EntradaDesfecho = { turnoId: string; desfecho: DesfechoRotina; motivo?: MotivoFalha | MotivoSemNovidade | "maquina_sem_contato" | "reinicio_servidor" | "ninguem_respondeu_o_gate" | "pedido_dispensado" | "pergunta_sem_resposta" | null };

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
export type SaidaDesfecho = { execucao: ExecucaoRotina; rotina: Rotina; podadas: number } | { ignorado: "nao_e_rotina" | "aguardando_gate" };

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
    const autoriaSilencio = input.desfecho === "interrompida" ? autoriaPessoa(deps.escopo.pessoaId, "regra:varredor_lease") : autoriaAgente(rotina.agenteId, deps.escopo.pessoaId);
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
        : `${redigir("rotina-falhou", agora, { motivo: input.motivo ?? "erro_execucao" })} (${quando})`;
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
