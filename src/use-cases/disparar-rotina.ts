import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { Confianca } from "../contracts/mensagem.ts";
import type { DesfechoRotina, MotivoFalha } from "../contracts/motivos.ts";
import type { ExecucaoRotina, Rotina } from "../contracts/rotina.ts";
import type { Turno } from "../contracts/turno.ts";
import { conectorTocaAprendiz } from "../domain/dado-pessoal.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { redigir } from "../domain/redacao.ts";
import { proximaJanela } from "../domain/rotina-janela.ts";
import { resumoCron } from "../domain/rotina-texto.ts";
import { agenteVisivel, autoriaAgente, autoriaPessoa, carimbo, evento, PRAZO_DECISAO_MS, rotinaDoTurno } from "./apoio-l7.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

export type EntradaDisparo = { rotina: Rotina; instanteAgendado: number; machineId: string; executor: Executor };
export type SaidaDisparo = { turno: Turno; proximaExecucao: number } | { janelaDeOutro: true };

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
    executor: input.executor,
  });
  if (!turno) throw new ErroDeDominio("estado_invalido", { cause: "turno de rotina não criado" });
  await deps.repos.rotinaJanelas.vincularTurno({ rotinaId: rotina.id, instanteAgendado, turnoId: turno.id });
  const proximaExecucao = proximaJanela({ cron: rotina.cron, fusoIana: rotina.fusoIana, agora: Math.max(agora, instanteAgendado) });
  await deps.repos.rotinas.reagendar(rotina.id, proximaExecucao);
  const autoria = autoriaPessoa(deps.escopo.pessoaId, "regra:scheduler-rotina");
  return {
    data: { turno, proximaExecucao },
    events: [evento(deps, "turno_criado", autoria, { turnoId: turno.id, rotinaId: rotina.id, origem: "rotina", instanteAgendado }, { conversaId: rotina.conversaId, turnoId: turno.id })],
  };
};

export type EntradaDesfecho = { turnoId: string; desfecho: DesfechoRotina; motivo?: MotivoFalha | "ninguem_respondeu_o_gate" | null };
export type SaidaDesfecho = { execucao: ExecucaoRotina; rotina: Rotina; podadas: number } | { ignorado: "nao_e_rotina" | "aguardando_gate" };

/**
 * Assentamento de um turno de rotina (chamado pela L6 ao assentar turno origem 'rotina' ou sua
 * retomada, e pelo varredor no gate vencido): registra a execução com desfecho TIPADO —
 * passou_em_branco ≠ falhou (E7.5) — poda para as 20 mais recentes, escreve a mensagem
 * kind 'rotina_execucao' na conversa da rotina e emite rotina_executou. 'executou' com um gate
 * ainda pendente para o mesmo turno NÃO conta: a rotina só executou quando o efeito saiu.
 */
export const registrarDesfechoRotina: CasoDeUso<EntradaDesfecho, SaidaDesfecho> = async (deps, input) => {
  const ligacao = await rotinaDoTurno(deps.repos, input.turnoId);
  if (!ligacao) return { data: { ignorado: "nao_e_rotina" } };
  const { rotina, turnoDisparado, instanteAgendado } = ligacao;
  if (input.desfecho === "executou") {
    const gatesAbertos = (await deps.repos.decisoes.pendentesDaConversa(rotina.conversaId)).filter((d) => d.tipo === "gate_rotina" && d.turnoId === turnoDisparado.id);
    if (gatesAbertos.length > 0) return { data: { ignorado: "aguardando_gate" } };
  }
  const agora = deps.agora();
  const execucao = await deps.repos.rotinaExecucoes.registrar({
    rotinaId: rotina.id,
    instanteAgendado,
    turnoId: turnoDisparado.id,
    desfecho: input.desfecho,
    motivo: input.motivo ?? null,
    em: agora,
  });
  if (!execucao) throw new ErroDeDominio("estado_invalido", { cause: "execução não registrada" });
  const podadas = await deps.repos.rotinaExecucoes.podar(rotina.id);
  const quando = carimbo(agora, rotina.fusoIana);
  const texto =
    input.desfecho === "executou"
      ? `Rotina executou em ${quando} (${rotina.fusoIana}): ${resumoCron(rotina.cron, rotina.fusoIana)}.`
      : input.desfecho === "passou_em_branco"
        ? `${redigir("rotina-passou-em-branco", agora, { motivo: input.motivo === "ninguem_respondeu_o_gate" ? "ninguém respondeu o gate" : (input.motivo ?? "sem motivo") })} (${quando})`
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
};
