import type { ModoAprovacao } from "../contracts/agente.ts";
import type { PlanoTurno } from "../contracts/plano-turno.ts";
import { gatilhoDeRevisao, vaiAoRevisor, type GatilhoDoAutomatico } from "../domain/modo-aprovacao.ts";
import { log } from "../obs/log.ts";
import type { Deps } from "./tipos.ts";

/** A janela do "contaminado" da conversa (revisão de engenharia do plano dos modos de aprovação, item 11). */
export const JANELA_CONVERSA_DE_FORA_MS = 24 * 60 * 60_000;

/**
 * De onde vem a ação: comando do terminal, gravar arquivo fora da pasta do bot, MCP da pessoa (ADR-103) ou app conectado.
 * O MCP fica à parte porque toda chamada a ele marca o turno, e a segunda já cai em `envio_apos_fora` (revisão de
 * engenharia, item 25): se a origem `mcp` dominar a contagem, o assunto volta.
 */
export type OrigemDaRevisao = "terminal" | "arquivo" | "mcp" | "app";

export type MedidaDaRevisao = {
  origem: OrigemDaRevisao;
  /** Só no app: a chamada direta (`chamar_ferramenta`) ou o lote do `pedir_aprovacao`. */
  via?: "chamada" | "pedido";
  arriscada: boolean;
  credencial: boolean;
  envioParaFora: boolean;
  /** A marca do turno de hoje: entrada não confiável ou `turnos.contaminado`. */
  contaminado: boolean;
  /** Só no lote: quantos itens são arriscados ou mandam para fora. */
  itens?: number;
};

/**
 * PR 1 do plano dos modos de aprovação (medir antes): conta o que o Automático novo faria com uma ação que, no manual,
 * pediria a pessoa, em TODO bot e em todo modo, sem mudar decisão nenhuma. Duas linhas de log, nunca com o texto da ação:
 * `revisor_seria_chamado` (gatilho `arriscado` ou `envio_apos_fora`) e `cartao_seria_aberto` (gatilho `credencial`, que
 * no Automático é sempre cartão na v1, decisão do Marlon de 2026-10-18). As duas marcas de conteúdo de fora vão juntas,
 * para medir o custo de cada uma: `contaminado` (o turno) e `contaminado_conversa` (a conversa nas últimas 24 h; nula
 * quando o gatilho não depende dela). O gatilho usa a da conversa. A consulta à conversa só roda quando decide.
 */
export async function medirRevisao(deps: Deps, plano: Plano, modo: ModoAprovacao | undefined, m: MedidaDaRevisao): Promise<GatilhoDoAutomatico | null> {
  try {
    return await medir(deps, plano, modo, m);
  } catch (e) {
    // Revisão do PR #402: a medição só observa. Um erro nela (a consulta da conversa estourando o statement_timeout,
    // um repositório quebrado) não pode negar nem aprovar nada: fica no log, sem texto, e a decisão segue a de hoje.
    log("erro", "medir_revisao_falhou", { turno_id: plano.turnoId, erro: e instanceof Error ? ((e as { code?: string; codigo?: string }).code ?? (e as { codigo?: string }).codigo ?? e.name) : "desconhecido" });
    return null;
  }
}

type Plano = Pick<PlanoTurno, "turnoId" | "agenteId" | "conversaId" | "modoTurno" | "harness">;

async function medir(deps: Deps, plano: Plano, modo: ModoAprovacao | undefined, m: MedidaDaRevisao): Promise<GatilhoDoAutomatico | null> {
  const decideComAConversa = !m.credencial && !m.arriscada && m.envioParaFora;
  // A consulta roda no savepoint dela (turnos.repo.ts): a que falha no Postgres não aborta a transação do caso de uso.
  const contaminadoConversa = !decideComAConversa ? null : m.contaminado || (await deps.repos.turnos.conversaLeuDeFora(plano.conversaId, { agora: deps.agora(), janelaMs: JANELA_CONVERSA_DE_FORA_MS }));
  const gatilho = gatilhoDeRevisao({ arriscada: m.arriscada, credencial: m.credencial, envioParaFora: m.envioParaFora, contaminado: contaminadoConversa === true || m.contaminado });
  if (gatilho === null) return null;
  log("info", vaiAoRevisor(gatilho) ? "revisor_seria_chamado" : "cartao_seria_aberto", {
    gatilho,
    origem: m.origem,
    ...(m.via ? { via: m.via } : {}),
    modo: modo ?? "manual",
    modo_turno: plano.modoTurno ?? null,
    // Revisão do PR #402 (a Parte 1 do plano pede): o Codex não tem revisor na v1 e vira cartão; é o número da decisão
    // em aberto 9.
    harness: plano.harness ?? null,
    contaminado: m.contaminado,
    contaminado_conversa: contaminadoConversa,
    agente_id: plano.agenteId,
    turno_id: plano.turnoId,
    ...(m.itens !== undefined ? { itens: m.itens } : {}),
  });
  return gatilho;
}
