import { createHash } from "node:crypto";
import type { Proposta } from "../contracts/conversa.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { Rotina } from "../contracts/rotina.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { revisaoDaRotina } from "../domain/revisao-rotina.ts";
import { proximaJanela } from "../domain/rotina-janela.ts";
import { resumoCron } from "../domain/rotina-texto.ts";
import { log } from "../obs/log.ts";
import { evento, exigir, textoRotinaAtiva } from "./apoio-l7.ts";
import { concederAcessosDaRotina } from "./conceder-acessos-da-rotina.ts";
import { autoriaDeQuemConfirma, fecharDecisaoDaProposta, type PorRegra } from "./confirmar-pelo-modo.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/** `obsoleta` (NOD-159): a rotina mudou depois da proposta; nada foi aplicado e a proposta saiu recusada. */
export type SaidaAplicarPropostaRotina = { rotina: Rotina; jaAplicada: boolean; obsoleta?: true };

/**
 * Confirmação das propostas 'rotina_atualizacao' e 'rotina_exclusao' pela pessoa (L9, decidir).
 * Aplica a operação NORMALIZADA guardada no payload — nenhum modelo reinterpreta o pedido (E7.1).
 *
 * Diferente de ativarRotina, aqui a rotina já existe e tem id próprio: a ligação
 * proposta↔rotina é o campo `rotinaId` do payload, não a igualdade de ids.
 */

export const TEXTO_ROTINA_MUDOU = "Esta mudança não foi aplicada: a rotina mudou depois da proposta. Peça de novo ao bot.";

/** A revisão que vai no payload ao propor e que a confirmação confere (sha256 em hex). */
export function revisaoAtual(rotina: Rotina): string {
  return revisaoDaRotina(rotina, (texto) => createHash("sha256").update(texto).digest("hex"));
}

/** O erro que quem chama devolve DEPOIS do commit, quando o caso respondeu `obsoleta`. */
export function erroRotinaMudou(): ErroDeDominio {
  return new ErroDeDominio("estado_invalido", { cause: "rotina_mudou" });
}

/**
 * definido em 2026-10-06 (NOD-159): o card foi montado sobre uma rotina que já não existe assim. Falha fechada sem
 * LANÇAR: a confirmação roda dentro da transação da rota (comoDona) ou do turno (porRegra), e um throw aqui
 * desfaria a recusa, a decisão fechada e o aviso. Quem chama traduz `obsoleta` em erroRotinaMudou().
 * Não reusa recusarProposta: ela grava a frase genérica de recusa, e aqui o aviso é um só, o da revisão.
 */
async function recusarObsoleta(deps: Deps, proposta: Proposta, atual: Rotina, porRegra: PorRegra | undefined): Promise<{ data: SaidaAplicarPropostaRotina; events: RuntimeEvent[] }> {
  const agora = deps.agora();
  await deps.repos.propostas.decidir(proposta.id, "recusada");
  const autoria = autoriaDeQuemConfirma(deps, proposta.agenteId, porRegra);
  const mensagem = await deps.repos.mensagens.criar({ conversaId: atual.conversaId, autoria, kind: "sistema", texto: TEXTO_ROTINA_MUDOU, confianca: "confiavel" });
  log("aviso", "proposta_rotina_obsoleta", { proposta_id: proposta.id, rotina_id: atual.id });
  const events: RuntimeEvent[] = [];
  if (mensagem) events.push(evento(deps, "mensagem_criada", autoria, { mensagem_id: mensagem.id, kind: "sistema" }, { conversaId: atual.conversaId }));
  // Na rota a decisão já foi fechada por quem clicou (decisoes.ts): aqui volta null e não fecha duas vezes.
  const decisao = await fecharDecisaoDaProposta(deps, proposta.id, agora, porRegra);
  if (decisao) events.push(evento(deps, "decisao_decidida", autoria, { decisaoId: decisao.id, tipo: proposta.kind }, { conversaId: atual.conversaId }));
  return { data: { rotina: atual, jaAplicada: false, obsoleta: true }, events };
}

/** Proposta sem `revisao` nasceu antes da NOD-159 e aplica como antes, para não travar card já aberto. */
function mudouDesdeAProposta(revisao: string | undefined, atual: Rotina): boolean {
  return revisao !== undefined && revisao !== revisaoAtual(atual);
}

/** Idempotente pelo estado da proposta: confirmada duas vezes não aplica duas vezes. */
function jaDecidida(estado: string): boolean {
  return estado === "confirmada";
}

/** `porRegra` (ADR-059): o modo do bot confirmou no turno — sem clique; autoria do agente e decisão fechada por regra. */
export const aplicarAtualizacaoRotina: CasoDeUso<{ propostaId: string; porRegra?: PorRegra }, SaidaAplicarPropostaRotina> = async (deps, input) => {
  const proposta = exigir(await deps.repos.propostas.buscar(input.propostaId), "nao_encontrado", "proposta");
  if (proposta.payload.kind !== "rotina_atualizacao") throw new ErroDeDominio("estado_invalido", { cause: "proposta não é de atualização de rotina" });
  if (proposta.estado === "recusada") throw new ErroDeDominio("estado_invalido", { cause: "proposta recusada" });
  const p = proposta.payload;
  const atual = exigir(await deps.repos.rotinas.buscar(p.rotinaId), "nao_encontrado", "rotina");
  if (atual.excluidoEm !== null) throw new ErroDeDominio("estado_invalido", { cause: "rotina excluída" });
  if (jaDecidida(proposta.estado)) return { data: { rotina: atual, jaAplicada: true } };
  if (mudouDesdeAProposta(p.revisao, atual)) return recusarObsoleta(deps, proposta, atual, input.porRegra);

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
    // definido em 2026-10-01 (item 7 da ADR-066): só vem no payload quando muda; ausente fica como está.
    soComPendencia: p.soComPendencia,
  });
  if (!rotina) throw new ErroDeDominio("nao_permitido", { cause: "só a dona atualiza a rotina" });
  const autoria = autoriaDeQuemConfirma(deps, proposta.agenteId, input.porRegra);
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
  if (p.acessos) events.push(...((await concederAcessosDaRotina(deps, { agenteId: rotina.agenteId, acessos: p.acessos, ...(input.porRegra ? { porRegra: input.porRegra } : {}) })).events ?? []));
  const decisao = await fecharDecisaoDaProposta(deps, proposta.id, agora, input.porRegra);
  if (decisao) events.push(evento(deps, "decisao_decidida", autoria, { decisaoId: decisao.id, tipo: "rotina_atualizacao" }, { conversaId: rotina.conversaId }));
  return { data: { rotina, jaAplicada: false }, events };
};

/**
 * Exclusão RECUPERÁVEL (ADR-034): carimba excluido_em, some das listagens/teto/tick e para de
 * disparar. Turno já em execução pode terminar — mesmo limite do resto do nod.
 */
export const aplicarExclusaoRotina: CasoDeUso<{ propostaId: string; porRegra?: PorRegra }, SaidaAplicarPropostaRotina> = async (deps, input) => {
  const proposta = exigir(await deps.repos.propostas.buscar(input.propostaId), "nao_encontrado", "proposta");
  if (proposta.payload.kind !== "rotina_exclusao") throw new ErroDeDominio("estado_invalido", { cause: "proposta não é de exclusão de rotina" });
  if (proposta.estado === "recusada") throw new ErroDeDominio("estado_invalido", { cause: "proposta recusada" });
  const p = proposta.payload;
  const atual = exigir(await deps.repos.rotinas.buscar(p.rotinaId), "nao_encontrado", "rotina");
  if (atual.excluidoEm !== null || jaDecidida(proposta.estado)) return { data: { rotina: atual, jaAplicada: true } };
  if (mudouDesdeAProposta(p.revisao, atual)) return recusarObsoleta(deps, proposta, atual, input.porRegra);

  const agora = deps.agora();
  await deps.repos.propostas.decidir(proposta.id, "confirmada");
  const rotina = await deps.repos.rotinas.excluir(p.rotinaId, agora);
  if (!rotina) throw new ErroDeDominio("nao_permitido", { cause: "só a dona exclui a rotina" });
  const autoria = autoriaDeQuemConfirma(deps, proposta.agenteId, input.porRegra);
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
  const decisao = await fecharDecisaoDaProposta(deps, proposta.id, agora, input.porRegra);
  if (decisao) events.push(evento(deps, "decisao_decidida", autoria, { decisaoId: decisao.id, tipo: "rotina_exclusao" }, { conversaId: rotina.conversaId }));
  return { data: { rotina, jaAplicada: false }, events };
};
