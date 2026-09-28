import type { RuntimeEvent } from "../contracts/evento.ts";
import type { Rotina } from "../contracts/rotina.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { podeCriarRotina } from "../domain/rotina-limites.ts";
import { proximaJanela } from "../domain/rotina-janela.ts";
import type { Tx } from "../shared/types.ts";
import { autoriaPessoa, evento, exigir, textoRotinaAtiva } from "./apoio-l7.ts";
import { concederAcessosDaRotina } from "./conceder-acessos-da-rotina.ts";
import type { CasoDeUso, Deps, Services } from "./tipos.ts";

export type SaidaAtivarRotina = { rotina: Rotina; jaExistia: boolean };

/**
 * Confirmação da proposta 'rotina' pela pessoa (services.rotinas.ativar, chamada pela L6 em
 * confirmarProposta e pela L9 em decidir tipo 'rotina'). Aplica a operação NORMALIZADA guardada no
 * payload — nenhum modelo reinterpreta o pedido (E7.1) — e recalcula a próxima execução a partir
 * de `agora` (o instante guardado na proposta pode ter passado enquanto ninguém confirmava).
 * definido em 2026-09-16: rotina.id = proposta.id = decisao.id — idempotente por construção: a
 * segunda ativação devolve a rotina existente sem criar outra.
 * definido em 2026-09-24 (emenda da ADR-044, "rotina nasce com o acesso"): os `acessos` declarados vão
 * para a rotina e os dos apps conectados são CONCEDIDOS aqui, na mesma transação — o botão dizia "Criar
 * rotina e permitir leitura". Os dois caminhos de confirmação (confirmarProposta e a decisão 'rotina' em
 * decisoes.ts) passam por este caso via services.rotinas.ativar; a segunda ativação não concede de novo.
 */
export const ativarRotina: CasoDeUso<{ propostaId: string; semMensagem?: boolean }, SaidaAtivarRotina> = async (deps, input) => {
  const proposta = exigir(await deps.repos.propostas.buscar(input.propostaId), "nao_encontrado", "proposta");
  if (proposta.payload.kind !== "rotina") throw new ErroDeDominio("estado_invalido", { cause: "proposta não é de rotina" });
  if (proposta.estado === "recusada") throw new ErroDeDominio("estado_invalido", { cause: "proposta recusada" });
  const existente = await deps.repos.rotinas.buscar(proposta.id);
  if (existente) return { data: { rotina: existente, jaExistia: true } };

  const p = proposta.payload;
  if (!podeCriarRotina(await deps.repos.rotinas.contarDoAgente(proposta.agenteId))) {
    throw new ErroDeDominio("limite_atingido", { cause: "rotinas por agente" });
  }
  const agora = deps.agora();
  const proximaExecucao = proximaJanela({ cron: p.cron, fusoIana: p.fusoIana, agora });
  if (proposta.estado === "pendente") await deps.repos.propostas.decidir(proposta.id, "confirmada");
  const rotina = await deps.repos.rotinas.criar({
    id: proposta.id,
    agenteId: proposta.agenteId,
    conversaId: proposta.conversaId,
    cron: p.cron,
    fusoIana: p.fusoIana,
    instrucao: p.instrucao,
    fonte: p.fonte,
    entregavel: p.entregavel,
    limitesAprovacao: p.limitesAprovacao,
    politicaSemDado: p.politicaSemDado,
    proximaExecucao,
    acessos: p.acessos ?? null,
  });
  if (!rotina) throw new ErroDeDominio("estado_invalido", { cause: "rotina não criada" });
  const autoria = autoriaPessoa(deps.escopo.pessoaId);
  // Rotina que vem com o perfil (ADR-050): a confirmação do perfil escreve uma linha só com todas.
  if (!input.semMensagem) {
    await deps.repos.mensagens.criar({
      conversaId: rotina.conversaId,
      autoria,
      kind: "sistema",
      texto: textoRotinaAtiva(rotina, agora),
      confianca: "confiavel",
    });
  }
  const events: RuntimeEvent[] = [
    evento(deps, "rotina_criada", autoria, { rotinaId: rotina.id, propostaId: proposta.id, proximaExecucao: rotina.proximaExecucao, fusoIana: rotina.fusoIana }, { conversaId: rotina.conversaId }),
  ];
  events.push(...((await concederAcessosDaRotina(deps, { agenteId: rotina.agenteId, acessos: rotina.acessos })).events ?? []));
  // A decisão 'rotina' de "Sua vez" tem o mesmo id; se ainda estava aberta, fica decidida aqui.
  const decisao = await deps.repos.decisoes.decidir(proposta.id, { por: deps.escopo.pessoaId, agora });
  if (decisao) events.push(evento(deps, "decisao_decidida", autoria, { decisaoId: decisao.id, tipo: "rotina" }, { conversaId: rotina.conversaId }));
  return { data: { rotina, jaExistia: false }, events };
};

/**
 * Adapta o caso de uso ao contrato `Services.rotinas` (EMENDA 18): a L9 passa uma fábrica de Deps
 * sobre a transação corrente. Os eventos ficam por conta de quem compõe (mesma tx).
 */
export function servicoRotinas(depsSobre: (trx: Tx) => Deps, aoGravar?: (trx: Tx, events: RuntimeEvent[]) => Promise<void>): Services["rotinas"] {
  return {
    async ativar(trx, propostaId, opcoes) {
      const r = await ativarRotina(depsSobre(trx), { propostaId, semMensagem: opcoes?.semMensagem === true });
      if (aoGravar && r.events?.length) await aoGravar(trx, r.events);
      return r.data.rotina;
    },
  };
}
