import type { Agente } from "../../contracts/agente.ts";
import type { IdAcao } from "../../domain/acoes/index.ts";
import { criarAgente, type EntradaCriarAgente, type SaidaCriarAgente } from "../criar-agente.ts";
import { duplicarAgente } from "../duplicar-agente.ts";
import { editarPerfil } from "../editar-perfil.ts";
import { gerirAgente } from "../gerir-agente.ts";
import { mudarModoAprovacao } from "../mudar-modo-aprovacao.ts";
import type { CasoDeUso } from "../tipos.ts";

/**
 * Os executores únicos do piloto `bots.*` (definido em 2026-10-28, NOD-391, ADR-135): a rota de pessoa
 * (src/adapters/http/rotas/agentes.ts) e o lote do Nod (gerir-bots.ts) chamam a MESMA função do id. O que cada caminho
 * escolhe é parâmetro escrito: o lote cria já na seção, duplica com as rotinas pausadas e confirma o total só com o
 * cartão aprovado pela pessoa.
 */

/** bots.criar: cria o bot e, com `secao`, já o põe nela (o lote; a tela organiza depois, pelo bots.mover). */
export const criarBot: CasoDeUso<EntradaCriarAgente & { secao?: string }, SaidaCriarAgente> = async (deps, input) => {
  const { secao, ...entrada } = input;
  const r = await criarAgente(deps, { ...entrada, modelo: entrada.modelo ?? deps.modeloPadrao });
  if (secao === undefined || secao.trim() === "") return r;
  const organizado = await gerirAgente(deps, { agenteId: r.data.agente.id, acao: "organizar", secao });
  return { data: r.data, events: [...(r.events ?? []), ...(organizado.events ?? [])] };
};

/** bots.mover: a seção, e na tela também o não lido, o fixado e a ordem da barra (o arrastar é um pedido só). */
export const moverBot: CasoDeUso<{ agenteId: string; secao?: string; naoLido?: boolean; fixado?: boolean; ordem?: string[] }, { agente: Agente }> = (deps, input) => gerirAgente(deps, { ...input, acao: "organizar" });

/**
 * bots.excluir: exclui e, depois do commit, desliga o computador do bot (ADR-135 §4). Antes do NOD-391 só a rota
 * desligava; pelo Nod o computador ficava ligado. O desligamento abre a própria transação e exige o bot já excluído no
 * banco, por isso é efeito pós-commit e não chamada aqui dentro.
 */
export const excluirBot: CasoDeUso<{ agenteId: string }, { agente: Agente }> = async (deps, input) => {
  const r = await gerirAgente(deps, { agenteId: input.agenteId, acao: "excluir" });
  deps.aposCommit?.({ tipo: "desligar_computador", agenteId: r.data.agente.id });
  return r;
};

/** A tabela id → executor do piloto; o registro aponta para ela por `casoDeUso` (o teste de paridade confere). */
export const EXECUTORES_BOTS = {
  "bots.criar": criarBot,
  "bots.duplicar": duplicarAgente,
  "bots.editar": editarPerfil,
  "bots.mover": moverBot,
  "bots.excluir": excluirBot,
  "bots.mudar_modo": mudarModoAprovacao,
} as const satisfies Partial<Record<IdAcao, CasoDeUso<never, unknown>>>;
