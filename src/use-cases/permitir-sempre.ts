import { randomUUID } from "node:crypto";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { MotivoInatividadePermissao } from "../contracts/motivos.ts";
import type { ItemAprovacao } from "../contracts/item-aprovacao.ts";
import { nuncaPermanente, VERSAO_APROVACAO_PERMANENTE } from "../domain/aprovacao-permanente.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { redigir } from "../domain/redacao.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * O mesmo filtro que a web aplica ao botão (via `nuncaPermanente` do DTO): sensível, computador e ADR-047 ficam de
 * fora. O terminal também (ADR-053): a regra de conector vale para a ferramenta inteira, e "todo comando" seria
 * tirar a aprovação do Mac; para não repetir o card, existe "Pode fazer e o resto desta tarefa".
 */
export function podeVirarRegra(i: Pick<ItemAprovacao, "origemSensivel" | "destino">): boolean {
  return !i.origemSensivel && i.destino.conector !== "computador" && i.destino.conector !== "terminal" && !nuncaPermanente(i.destino.ferramenta);
}

export type EntradaPermitirSempre = { decisaoId: string; itemIds: readonly string[] };
export type SaidaPermitirSempre = { criadas: string[]; mensagemId: string | null };

/**
 * "Sempre permitir isto" (ADR-042 claim 2): a pessoa clicou no card, e o clique vira LINHA. Nasce
 * de ato explícito, nunca inferido de histórico (ADR-038). Cada regra guarda o item que ela estava
 * vendo (`itemOrigemId`) e uma mensagem de consentimento imutável na MESMA transação — mesmo padrão
 * de conceder.ts, que é o que torna a autorização citável seis meses depois.
 *
 * Item de origem sensível e destino 'computador' NUNCA viram regra: o primeiro porque o CHECK do
 * banco recusaria honrá-la, o segundo porque a aprovação é vinculada à ação cifrada (ADR-037). Nem
 * aprovar PR ou merge (definido em 2026-09-24, ADR-047, `nuncaPermanente`): o item é aprovado, a regra não nasce.
 */
export const permitirSempre: CasoDeUso<EntradaPermitirSempre, SaidaPermitirSempre> = async (deps, input) => {
  const decisao = await deps.repos.decisoes.buscar(input.decisaoId);
  if (!decisao) throw new ErroDeDominio("nao_encontrado", { cause: "decisão" });
  const itens = await deps.repos.itensAprovacao.listar(input.decisaoId);
  const alvos = itens.filter((i) => input.itemIds.includes(i.id) && podeVirarRegra(i));
  if (alvos.length === 0) return { data: { criadas: [], mensagemId: null } };

  // Uma regra por FERRAMENTA distinta: o mesmo conector.ferramenta em dois itens é uma regra só.
  const porFerramenta = new Map<string, (typeof alvos)[number]>();
  for (const i of alvos) porFerramenta.set(`${i.destino.conector}.${i.destino.ferramenta}`, i);

  const pessoa = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
  const nomes = [...porFerramenta.keys()];
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: decisao.conversaId,
    turnoId: null,
    kind: "consentimento",
    texto: redigir("permissao-permanente", deps.agora(), { pessoa: pessoa?.nome ?? "a pessoa", ferramentas: nomes.join(", ") }),
    confianca: "confiavel",
    autoria: {
      autor_tipo: "pessoa",
      autor_id: deps.escopo.pessoaId,
      sob_procuracao_de: null,
      conta_de_execucao: deps.escopo.pessoaId,
      executor: "catcher",
      locality: "local",
      locality_reason: "tudo_local_nesta_rodada",
      machine_id: null,
      decidido_por: "pessoa",
      regra_versao: 1,
    },
  });
  if (!mensagem) throw new ErroDeDominio("estado_invalido", { cause: "consentimento não gravado" });

  const criadas: string[] = [];
  for (const item of porFerramenta.values()) {
    const conector = await deps.repos.conectores.buscarPorSlug(item.destino.conector);
    if (!conector) continue;
    const p = await deps.repos.permissoesPermanentes.criar({
      agenteId: decisao.agenteId,
      conectorId: conector.id,
      capacidade: item.destino.ferramenta,
      itemOrigemId: item.id,
      mensagemId: mensagem.id,
      regraVersao: VERSAO_APROVACAO_PERMANENTE,
    });
    if (p) criadas.push(p.id);
  }

  const evento: RuntimeEvent = {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: deps.agora(),
    kind: "mensagem_criada",
    autoria: mensagem.autoria,
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: decisao.conversaId,
    turnoId: null,
    dados: { mensagem_id: mensagem.id, kind: "consentimento", regras: criadas.length },
  };
  return { data: { criadas, mensagemId: mensagem.id }, events: [evento] };
};

export type EntradaRevogarPermissao = { permissaoId: string };

/** Revogar é MARCA com motivo (ADR-042): a regra some das ativas e fica na lista explicando por quê. */
export const revogarPermissao: CasoDeUso<EntradaRevogarPermissao, { revogada: boolean }> = async (deps, input) => {
  const motivo: MotivoInatividadePermissao = "revogada_pela_pessoa";
  const revogada = await deps.repos.permissoesPermanentes.desativar(input.permissaoId, motivo, deps.agora());
  return { data: { revogada } };
};
