import type { RuntimeEvent } from "../contracts/evento.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { conexaoViraPedido } from "./confirmar-proposta.ts";
import type { CasoDeUso } from "./tipos.ts";

export type SaidaAoConectarApp = { cards: number };

/**
 * definido em 2026-09-25: o login de um app terminou (Verificar do marketplace, que a web chama sozinha
 * enquanto a janela de login está aberta). Cada card "Conecte o X" desta pessoa ainda aberto vira, no
 * mesmo lugar, o card de permitir do nível que o agente pediu — a pessoa não volta ao card para clicar em
 * "Continuar tarefa". Nada é concedido aqui: conceder continua sendo o clique em Permitir (ADR-044).
 * Card que não pode virar (app sem ferramenta daquele nível, proposta decidida no meio) fica como estava.
 */
export const aoConectarApp: CasoDeUso<{ slug: string }, SaidaAoConectarApp> = async (deps, input) => {
  const events: RuntimeEvent[] = [];
  let cards = 0;
  for (const p of await deps.repos.propostas.conexoesPendentes(input.slug)) {
    if (p.payload.kind !== "acesso" || !p.payload.conectar) continue;
    try {
      const r = await conexaoViraPedido(deps, p, p.payload);
      events.push(...r.events);
      cards++;
    } catch (e) {
      if (!(e instanceof ErroDeDominio)) throw e;
    }
  }
  return { data: { cards }, events };
};
