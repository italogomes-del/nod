import { randomUUID } from "node:crypto";
import type { Autoria } from "../../src/contracts/evento.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";

/**
 * Padrão "ensure" (EMENDA 9): cada teste cria as próprias linhas com randomUUID dentro do
 * envelope, nunca depende do seed. Devolve os repos já escopados junto com o que criou.
 */
export async function agenteComConversa(
  trx: Tx,
  escopo: Escopo,
  opcoes: { nome?: string; dono?: "pessoa" | "empresa" } = {},
): Promise<{ repos: Repos; agenteId: string; conversaId: string }> {
  const repos = criarRepos(trx, escopo);
  const agenteId = randomUUID();
  const conversaId = randomUUID();
  const agente = await repos.agentes.criar({ id: agenteId, nome: opcoes.nome ?? `Bot ${agenteId.slice(0, 8)}`, dono: opcoes.dono ?? "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "claude-haiku-4-5-20251001" });
  if (!agente) throw new Error("fábrica: agente não criado");
  const conversa = await repos.conversas.criar({ id: conversaId, tipo: "propria", agenteId });
  if (!conversa) throw new Error("fábrica: conversa não criada");
  return { repos, agenteId, conversaId };
}

/** Autoria de pessoa (definido em 2026-09-16: executor catcher, localidade honesta desta rodada). */
export function autoriaPessoa(pessoaId: string): Autoria {
  return {
    autor_tipo: "pessoa",
    autor_id: pessoaId,
    sob_procuracao_de: null,
    conta_de_execucao: pessoaId,
    executor: "catcher",
    locality: "local",
    locality_reason: "tudo_local_nesta_rodada",
    machine_id: null,
    decidido_por: "pessoa",
    regra_versao: 1,
  };
}

export function autoriaAgente(agenteId: string, contaDeExecucao: string): Autoria {
  return { ...autoriaPessoa(contaDeExecucao), autor_tipo: "agente", autor_id: agenteId, decidido_por: "regra:localidade" };
}
