import { ErroDeDominio } from "../domain/erro.ts";
import { quandoUtc } from "./conceder.ts";
import { autoriaDaPessoa } from "./registrar-negacao.ts";
import type { CasoDeUso } from "./tipos.ts";

export type EntradaRevogar = { concessaoId: string };
export type SaidaRevogar = { ok: true; mensagemId: string | null };

/**
 * Revogação: apaga a concessão (o plano do PRÓXIMO turno já nasce sem a ferramenta — E6.4, provado
 * em tests/concurrency/revogacao-entre-enfileirar-e-despachar.test.ts) e deixa registro escrito na
 * conversa do agente. A mensagem de consentimento original fica: é imutável e citável (E6.3).
 */
export const revogar: CasoDeUso<EntradaRevogar, SaidaRevogar> = async (deps, input) => {
  const agora = deps.agora();
  const concessao = await deps.repos.concessoes.buscar(input.concessaoId);
  if (!concessao) throw new ErroDeDominio("nao_encontrado", { cause: "concessão" });
  const apagou = await deps.repos.concessoes.revogar(concessao.id);
  if (!apagou) throw new ErroDeDominio("nao_encontrado", { cause: "concessão de outra pessoa" });
  const conector = await deps.repos.conectores.buscar(concessao.conectorId);
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(concessao.agenteId);
  const pessoa = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
  let mensagemId: string | null = null;
  if (conversa) {
    const m = await deps.repos.mensagens.criar({
      conversaId: conversa.id,
      autoria: autoriaDaPessoa(deps.escopo),
      kind: "sistema",
      texto: `Revogado por ${pessoa?.nome ?? "a pessoa"} em ${quandoUtc(agora)}: ${conector?.slug ?? concessao.conectorId}.${concessao.capacidade}.`,
      confianca: "confiavel",
    });
    mensagemId = m?.id ?? null;
  }
  return { data: { ok: true, mensagemId } };
};
