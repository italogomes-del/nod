import type { RotinaDto } from "../contracts/api.ts";
import type { Concessao } from "../contracts/concessao.ts";
import type { ExecucaoRotina, Rotina } from "../contracts/rotina.ts";
import type { Repos } from "../repositories/tipos.ts";
import { TIPOS_GATE_ROTINA } from "../contracts/pedido.ts";
import { avisoDeJanelasPuladas, janelasPuladas } from "../domain/janelas-puladas.ts";
import { resumoCron } from "../domain/rotina-texto.ts";
import { EXECUCOES_GUARDADAS } from "../shared/constantes.ts";
import { exigir } from "./apoio-l7.ts";
import { bloqueioDaRotina, pendenciaAbertaDaRotina } from "./pre-voo-rotina.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * GET rotinas: o que a policy deixa ver, com a próxima execução calculada pelo servidor (ADR-011).
 * `bloqueio` (definido em 2026-09-24, emenda da ADR-044): a rotina da pessoa parada por falta de conexão
 * ou acesso, com o card que a destrava — a lista mostra "parada · falta acesso ao Gmail" e o botão.
 * Rotina de outra pessoa (visível por 'equipe') sai sem: as concessões e os cards dela são da dona.
 */
export const listarRotinas: CasoDeUso<Record<string, never>, { rotinas: RotinaDto[] }> = async (deps) => {
  const rotinas = await deps.repos.rotinas.listar();
  const minhas = rotinas.filter((r) => r.ownerId === deps.escopo.pessoaId && r.excluidoEm === null);
  const registrados = minhas.length ? await deps.repos.conectores.listar() : [];
  const concessoes = new Map<string, Concessao[]>();
  const dtos: RotinaDto[] = [];
  for (const rotina of rotinas) {
    let bloqueio: RotinaDto["bloqueio"] = null;
    let perguntaPendente: RotinaDto["perguntaPendente"];
    if (minhas.includes(rotina)) {
      if (!concessoes.has(rotina.agenteId)) concessoes.set(rotina.agenteId, await deps.repos.concessoes.doAgente(rotina.agenteId));
      bloqueio = await bloqueioDaRotina(deps.repos, rotina, registrados, concessoes.get(rotina.agenteId) ?? []);
      perguntaPendente = await perguntaQueParou(deps.repos, rotina);
    }
    const puladas = await puladasDe(deps, rotina);
    dtos.push({ rotina, proximaExecucao: rotina.proximaExecucao, bloqueio, resumo: resumoDe(rotina.cron, rotina.fusoIana), ...(perguntaPendente ? { perguntaPendente } : {}), ...(puladas !== null ? { janelasPuladas: puladas } : {}) });
  }
  return { data: { rotinas: dtos } };
};

/**
 * definido em 2026-10-15 (pacote A3): a rotina ativa com uma execução ainda aberta — o agendador pula as janelas seguintes
 * (ADR-045). Conta os horários do cron desde a janela dela até agora; a partir de 3, a lista avisa. Pausada não avisa.
 */
async function puladasDe(deps: Parameters<typeof listarRotinas>[0], rotina: RotinaDto["rotina"]): Promise<number | null> {
  if (rotina.estado !== "ativa" || rotina.excluidoEm !== null) return null;
  const aberta = await deps.repos.rotinaJanelas.execucaoAberta(rotina.id);
  if (!aberta) return null;
  return avisoDeJanelasPuladas(janelasPuladas({ cron: rotina.cron, fusoIana: rotina.fusoIana, desde: aberta.instanteAgendado, agora: deps.agora() }));
}

/**
 * definido em 2026-10-15 (NOD-270): a rotina cuja última janela saiu 'bloqueada'/'aguardando_resposta' está parada por
 * uma pergunta (ou aprovação) que ainda espera — a mais antiga que segura a janela, e desde quando. Só a última execução
 * conta: se a janela seguinte já rodou, não há parada a mostrar.
 */
async function perguntaQueParou(repos: Repos, rotina: Rotina): Promise<RotinaDto["perguntaPendente"]> {
  const [ultima] = await repos.rotinaExecucoes.listar(rotina.id, 1);
  if (ultima?.desfecho !== "bloqueada" || ultima.motivo !== "aguardando_resposta") return undefined;
  const d = await pendenciaAbertaDaRotina(repos, rotina);
  return d ? { decisaoId: d.id, desde: Date.parse(d.criadoEm), tipo: TIPOS_GATE_ROTINA.has(d.tipo) ? "aprovacao" : "pergunta" } : undefined;
}

/** Um cron que o parser não aceita (linha antiga, gravada à mão) não derruba a lista: fica o cron cru. */
function resumoDe(cron: string, fusoIana: string): string {
  try { return resumoCron(cron, fusoIana); } catch { return `${cron} (${fusoIana})`; }
}

/** GET rotinas/:id/execucoes: as 20 mais recentes (Grok Bot), mais recente primeiro. */
export const listarExecucoes: CasoDeUso<{ rotinaId: string }, { execucoes: ExecucaoRotina[] }> = async (deps, input) => {
  exigir(await deps.repos.rotinas.buscar(input.rotinaId), "nao_encontrado", "rotina");
  return { data: { execucoes: await deps.repos.rotinaExecucoes.listar(input.rotinaId, EXECUCOES_GUARDADAS) } };
};
