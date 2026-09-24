import type { RuntimeEvent } from "../contracts/evento.ts";
import type { Rotina } from "../contracts/rotina.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { proximaJanela } from "../domain/rotina-janela.ts";
import { resumoCron } from "../domain/rotina-texto.ts";
import { autoriaPessoa, evento, exigir, textoRotinaAtiva } from "./apoio-l7.ts";
import { concederAcessosDaRotina } from "./conceder-acessos-da-rotina.ts";
import type { CasoDeUso } from "./tipos.ts";

export type SaidaAplicarPropostaRotina = { rotina: Rotina; jaAplicada: boolean };

/**
 * Confirmação das propostas 'rotina_atualizacao' e 'rotina_exclusao' pela pessoa (L9, decidir).
 * Aplica a operação NORMALIZADA guardada no payload — nenhum modelo reinterpreta o pedido (E7.1).
 *
 * Diferente de ativarRotina, aqui a rotina já existe e tem id próprio: a ligação
 * proposta↔rotina é o campo `rotinaId` do payload, não a igualdade de ids.
 */

/** Idempotente pelo estado da proposta: confirmada duas vezes não aplica duas vezes. */
function jaDecidida(estado: string): boolean {
  return estado === "confirmada";
}

export const aplicarAtualizacaoRotina: CasoDeUso<{ propostaId: string }, SaidaAplicarPropostaRotina> = async (deps, input) => {
  const proposta = exigir(await deps.repos.propostas.buscar(input.propostaId), "nao_encontrado", "proposta");
  if (proposta.payload.kind !== "rotina_atualizacao") throw new ErroDeDominio("estado_invalido", { cause: "proposta não é de atualização de rotina" });
  if (proposta.estado === "recusada") throw new ErroDeDominio("estado_invalido", { cause: "proposta recusada" });
  const p = proposta.payload;
  const atual = exigir(await deps.repos.rotinas.buscar(p.rotinaId), "nao_encontrado", "rotina");
  if (atual.excluidoEm !== null) throw new ErroDeDominio("estado_invalido", { cause: "rotina excluída" });
  if (jaDecidida(proposta.estado)) return { data: { rotina: atual, jaAplicada: true } };

  const agora = deps.agora();
  // O instante guardado na proposta pode ter passado enquanto ninguém confirmava (mesma regra de
  // ativarRotina): recalcula do cron JÁ VALIDADO do payload, sem reinterpretar texto.
  const proximaExecucao = proximaJanela({ cron: p.cron ?? atual.cron, fusoIana: p.fusoIana ?? atual.fusoIana, agora });
  await deps.repos.propostas.decidir(proposta.id, "confirmada");
  const rotina = await deps.repos.rotinas.atualizar(p.rotinaId, {
    cron: p.cron,
    fusoIana: p.fusoIana,
    instrucao: p.instrucao,
    fonte: p.fonte,
    entregavel: p.entregavel,
    limitesAprovacao: p.limitesAprovacao,
    politicaSemDado: p.politicaSemDado,
    proximaExecucao,
    acessos: p.acessos,
  });
  if (!rotina) throw new ErroDeDominio("nao_permitido", { cause: "só a dona atualiza a rotina" });
  const autoria = autoriaPessoa(deps.escopo.pessoaId);
  await deps.repos.mensagens.criar({
    conversaId: rotina.conversaId,
    autoria,
    kind: "sistema",
    texto: `Rotina atualizada. ${textoRotinaAtiva(rotina, agora)}`,
    confianca: "confiavel",
  });
  const events: RuntimeEvent[] = [
    evento(deps, "rotina_atualizada", autoria, { rotinaId: rotina.id, propostaId: proposta.id, proximaExecucao: rotina.proximaExecucao, fusoIana: rotina.fusoIana }, { conversaId: rotina.conversaId }),
  ];
  // definido em 2026-09-24 (emenda da ADR-044, "rotina nasce com o acesso"): a mudança que traz `acessos`
  // concede, na mesma transação, o que ainda não estava concedido — o que já estava não vira mensagem
  // nova (concederLote é idempotente). App que saiu da lista NÃO é revogado aqui: revogar é pela tela.
  if (p.acessos) events.push(...((await concederAcessosDaRotina(deps, { agenteId: rotina.agenteId, acessos: p.acessos })).events ?? []));
  const decisao = await deps.repos.decisoes.decidir(proposta.id, { por: deps.escopo.pessoaId, agora });
  if (decisao) events.push(evento(deps, "decisao_decidida", autoria, { decisaoId: decisao.id, tipo: "rotina_atualizacao" }, { conversaId: rotina.conversaId }));
  return { data: { rotina, jaAplicada: false }, events };
};

/**
 * Exclusão RECUPERÁVEL (ADR-034): carimba excluido_em, some das listagens/teto/tick e para de
 * disparar. Turno já em execução pode terminar — mesmo limite do resto do nod.
 */
export const aplicarExclusaoRotina: CasoDeUso<{ propostaId: string }, SaidaAplicarPropostaRotina> = async (deps, input) => {
  const proposta = exigir(await deps.repos.propostas.buscar(input.propostaId), "nao_encontrado", "proposta");
  if (proposta.payload.kind !== "rotina_exclusao") throw new ErroDeDominio("estado_invalido", { cause: "proposta não é de exclusão de rotina" });
  if (proposta.estado === "recusada") throw new ErroDeDominio("estado_invalido", { cause: "proposta recusada" });
  const p = proposta.payload;
  const atual = exigir(await deps.repos.rotinas.buscar(p.rotinaId), "nao_encontrado", "rotina");
  if (atual.excluidoEm !== null || jaDecidida(proposta.estado)) return { data: { rotina: atual, jaAplicada: true } };

  const agora = deps.agora();
  await deps.repos.propostas.decidir(proposta.id, "confirmada");
  const rotina = await deps.repos.rotinas.excluir(p.rotinaId, agora);
  if (!rotina) throw new ErroDeDominio("nao_permitido", { cause: "só a dona exclui a rotina" });
  const autoria = autoriaPessoa(deps.escopo.pessoaId);
  await deps.repos.mensagens.criar({
    conversaId: rotina.conversaId,
    autoria,
    kind: "sistema",
    texto: `Rotina excluída: ${resumoCron(rotina.cron, rotina.fusoIana)}. Nada mais será disparado por ela.`,
    confianca: "confiavel",
  });
  const events: RuntimeEvent[] = [
    evento(deps, "rotina_excluida", autoria, { rotinaId: rotina.id, propostaId: proposta.id }, { conversaId: rotina.conversaId }),
  ];
  const decisao = await deps.repos.decisoes.decidir(proposta.id, { por: deps.escopo.pessoaId, agora });
  if (decisao) events.push(evento(deps, "decisao_decidida", autoria, { decisaoId: decisao.id, tipo: "rotina_exclusao" }, { conversaId: rotina.conversaId }));
  return { data: { rotina, jaAplicada: false }, events };
};
