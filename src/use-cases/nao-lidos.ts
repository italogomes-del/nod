import type { ConversaNaoLida, NaoLidosDto } from "../contracts/nao-lidos.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import type { ResumoNaoLida } from "../repositories/leituras.repo.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * Não lidos (definido em 2026-09-29, 0039; canvas "Nod — tela do agente", página "Não lidos"): o que chegou
 * depois do "lido até" de cada conversa. Bot oculto ou excluído não está na barra lateral, então o que ele
 * fala também não entra aqui; sala entra sempre que a pessoa a lê.
 */
async function visiveis(deps: Deps): Promise<ResumoNaoLida[]> {
  const resumo = await deps.repos.leituras.resumo();
  if (resumo.length === 0) return [];
  const naBarra = new Set((await deps.repos.agentes.listar()).map((a) => a.id));
  return resumo.filter((r) => r.tipo === "sala" || (r.agenteId !== null && naBarra.has(r.agenteId)));
}

export const listarNaoLidos: CasoDeUso<Record<string, never>, NaoLidosDto> = async (deps) => {
  const conversas = await visiveis(deps);
  const mensagens = await deps.repos.leituras.mensagens(conversas.map((c) => c.conversaId));
  const saida: ConversaNaoLida[] = conversas.flatMap((c) => {
    const m = mensagens.get(c.conversaId);
    return m ? [{ ...c, primeiraId: m.primeira.id, mensagens: m.ultimas, ...(m.avisos.length > 0 ? { avisos: m.avisos } : {}), daRotina: m.daRotina }] : [];
  });
  return { data: { conversas: saida } };
};

async function conversaDaPessoa(deps: Deps, conversaId: string): Promise<string> {
  const conversa = await deps.repos.conversas.buscar(conversaId);
  if (!conversa) throw new ErroDeDominio("nao_encontrado");
  return conversa.id;
}

/** Abrir a conversa, ou "Marcar como lido" na tela Não lidos: lida até a última mensagem. */
export const marcarConversaLida: CasoDeUso<{ conversaId: string }, { ok: true }> = async (deps, input) => {
  await deps.repos.leituras.marcarLida(await conversaDaPessoa(deps, input.conversaId));
  return { data: { ok: true } };
};

/** "Marcar como não lido" do menu do bot: a última fala dele volta a ser nova. */
export const marcarConversaNaoLida: CasoDeUso<{ conversaId: string }, { marcada: boolean }> = async (deps, input) => {
  return { data: { marcada: await deps.repos.leituras.marcarNaoLida(await conversaDaPessoa(deps, input.conversaId)) } };
};

/** "Marcar tudo como lido": as conversas que a tela Não lidos mostra. */
export const marcarTudoLido: CasoDeUso<Record<string, never>, { marcadas: number }> = async (deps) => {
  const conversas = await visiveis(deps);
  for (const c of conversas) await deps.repos.leituras.marcarLida(c.conversaId);
  return { data: { marcadas: conversas.length } };
};
