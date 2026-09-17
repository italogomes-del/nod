import type { ChaveEmitidaDto } from "../contracts/api.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { cunharChaveMaquina } from "../services/token-maquina.ts";
import type { CasoDeUso } from "./tipos.ts";

/** definido em 2026-09-16: nome para a pessoa reconhecer o computador na lista ("MacBook do trabalho"). */
const NOME_MAX = 60;

/**
 * Emite uma chave de máquina (ADR-031). A chave crua nasce aqui e sai SÓ no `data` desta resposta:
 * o banco recebe o hash, o log não recebe nada. Emitir de novo NÃO cancela as anteriores — quem quer
 * trocar revoga a velha (revogarChaveMaquina).
 */
export const emitirChaveMaquina: CasoDeUso<{ nome: unknown }, ChaveEmitidaDto> = async (deps, input) => {
  const nome = typeof input.nome === "string" ? input.nome.trim() : "";
  if (nome.length === 0 || nome.length > NOME_MAX) throw new ErroDeDominio("entrada_invalida", { cause: "nome da chave" });
  const cunhada = cunharChaveMaquina(deps.escopo);
  const dados = await deps.repos.maquinaTokens.criar({ nome, prefixo: cunhada.prefixo, hash: cunhada.hash });
  if (!dados) throw new ErroDeDominio("estado_invalido", { cause: "chave não gravada" });
  return { data: { chave: cunhada.chave, dados } };
};

/** Revoga uma chave da própria pessoa. A de outra pessoa é indistinguível de inexistente (404). */
export const revogarChaveMaquina: CasoDeUso<{ id: string }, { ok: true }> = async (deps, input) => {
  const revogou = await deps.repos.maquinaTokens.revogar(input.id, deps.agora());
  if (!revogou) throw new ErroDeDominio("nao_encontrado", { cause: "chave de máquina" });
  return { data: { ok: true } };
};
