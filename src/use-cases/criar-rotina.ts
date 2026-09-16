import type { PayloadPropostaRotina, Proposta } from "../contracts/conversa.ts";
import type { Decisao } from "../contracts/decisao.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { Rotina } from "../contracts/rotina.ts";
import type { CasoNod } from "../contracts/servicos.ts";
import { ehErroDeDominio, ErroDeDominio } from "../domain/erro.ts";
import { podeCriarRotina } from "../domain/rotina-limites.ts";
import { validarRotinaNormalizada, type RotinaNormalizada } from "../domain/rotina-texto.ts";
import { agenteVisivel, assertUuid, autoriaAgente, autoriaPessoa, carimbo, evento, PRAZO_DECISAO_MS, textoRotinaAtiva } from "./apoio-l7.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

export type EntradaRotina = {
  cron: string;
  fusoIana: string;
  instrucao: string;
  fonte: string;
  entregavel: string;
  limitesAprovacao: string;
  politicaSemDado: string;
};

/** Valida no domínio (fuso_invalido / cron_sem_futuro / entrada_invalida) e o limite de 50 por bot (limite_atingido). */
async function normalizarComLimite(deps: Deps, agenteId: string, entrada: EntradaRotina): Promise<RotinaNormalizada> {
  const normalizada = validarRotinaNormalizada({ ...entrada, agora: deps.agora() });
  // Depois do domínio (o e2e manda só cron + fuso e espera fuso_invalido antes de qualquer outro campo).
  assertUuid(agenteId, "agenteId");
  await agenteVisivel(deps.repos, agenteId);
  if (!podeCriarRotina(await deps.repos.rotinas.contarDoAgente(agenteId))) {
    throw new ErroDeDominio("limite_atingido", { cause: "rotinas por agente" });
  }
  return normalizada;
}

/**
 * Ferramenta `criar_rotina` (origem AGENTE): NADA é agendado — nasce uma proposta kind 'rotina'
 * com o payload já normalizado (sobrevive a reinício sem reinterpretar, E7.1) e uma decisão tipo
 * 'rotina' em "Sua vez". definido em 2026-09-16: a decisão nasce com o MESMO id da proposta —
 * é a ligação entre as duas sem coluna nova no contrato; ativarRotina usa esse id nos dois lados.
 * Erro de domínio volta TIPADO no resultado ({erro}) para o modelo corrigir a chamada, em vez de
 * virar negação do proxy.
 */
export const criarRotina: CasoNod<Deps, "criar_rotina"> = async (deps, input) => {
  let normalizada: RotinaNormalizada;
  try {
    normalizada = await normalizarComLimite(deps, input.agenteId, {
      cron: input.cron,
      fusoIana: input.fuso_iana,
      instrucao: input.instrucao,
      fonte: input.fonte,
      entregavel: input.entregavel,
      limitesAprovacao: input.limites_aprovacao,
      politicaSemDado: input.politica_sem_dado,
    });
  } catch (e) {
    if (ehErroDeDominio(e)) return { data: { erro: e.codigo } };
    throw e;
  }
  const payload: PayloadPropostaRotina = {
    kind: "rotina",
    cron: normalizada.cron,
    fusoIana: normalizada.fusoIana,
    instrucao: normalizada.instrucao,
    fonte: normalizada.fonte,
    entregavel: normalizada.entregavel,
    limitesAprovacao: normalizada.limitesAprovacao,
    politicaSemDado: normalizada.politicaSemDado,
    proximaExecucao: normalizada.proximaExecucao,
    resumo: normalizada.resumo,
  };
  const proposta = await deps.repos.propostas.criar({ conversaId: input.conversaId, agenteId: input.agenteId, payload });
  if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
  const decisao = await deps.repos.decisoes.criar({
    id: proposta.id,
    tipo: "rotina",
    agenteId: input.agenteId,
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    prazoDecisaoEm: deps.agora() + PRAZO_DECISAO_MS,
    frase: `Rotina proposta: ${normalizada.resumo} · próxima execução ${carimbo(normalizada.proximaExecucao, normalizada.fusoIana)}`,
  });
  const autoria = autoriaAgente(input.agenteId, deps.escopo.pessoaId);
  const events: RuntimeEvent[] = [
    evento(deps, "proposta_criada", autoria, { propostaId: proposta.id, kind: "rotina", proximaExecucao: normalizada.proximaExecucao }, { conversaId: input.conversaId, turnoId: input.turnoId }),
  ];
  if (decisao) events.push(evento(deps, "decisao_criada", autoria, { decisaoId: decisao.id, tipo: "rotina" }, { conversaId: input.conversaId, turnoId: input.turnoId }));
  return { data: { proposta_id: proposta.id, proxima_execucao: normalizada.proximaExecucao, resumo: normalizada.resumo }, events };
};

export type SaidaCriarRotinaPelaPessoa = { rotina: Rotina; proposta: Proposta | null; decisao: Decisao | null };

/**
 * Origem PESSOA (POST rotinas): a pessoa já é a confirmação — a rotina nasce 'ativa' com
 * exige_aprovacao pelo DEFAULT da coluna (E7.3), mensagem de sistema com fuso nomeado na
 * conversa do bot e evento rotina_criada. Lança: fuso_invalido (400), cron_sem_futuro (400),
 * entrada_invalida (400), limite_atingido (429), nao_encontrado (agente).
 */
export const criarRotinaPelaPessoa: CasoDeUso<EntradaRotina & { agenteId: string }, SaidaCriarRotinaPelaPessoa> = async (deps, input) => {
  const normalizada = await normalizarComLimite(deps, input.agenteId, input);
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(input.agenteId);
  if (!conversa) throw new ErroDeDominio("nao_encontrado", { cause: "conversa própria do agente" });
  const rotina = await deps.repos.rotinas.criar({
    agenteId: input.agenteId,
    conversaId: conversa.id,
    cron: normalizada.cron,
    fusoIana: normalizada.fusoIana,
    instrucao: normalizada.instrucao,
    fonte: normalizada.fonte,
    entregavel: normalizada.entregavel,
    limitesAprovacao: normalizada.limitesAprovacao,
    politicaSemDado: normalizada.politicaSemDado,
    proximaExecucao: normalizada.proximaExecucao,
  });
  if (!rotina) throw new ErroDeDominio("estado_invalido", { cause: "rotina não criada" });
  const autoria = autoriaPessoa(deps.escopo.pessoaId);
  await deps.repos.mensagens.criar({
    conversaId: conversa.id,
    autoria,
    kind: "sistema",
    texto: textoRotinaAtiva(rotina, deps.agora()),
    confianca: "confiavel",
  });
  return {
    data: { rotina, proposta: null, decisao: null },
    events: [evento(deps, "rotina_criada", autoria, { rotinaId: rotina.id, proximaExecucao: rotina.proximaExecucao, fusoIana: rotina.fusoIana }, { conversaId: conversa.id })],
  };
};
