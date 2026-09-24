import type { ExecucaoRotina } from "../../src/contracts/rotina.ts";

/**
 * definido em 2026-09-24 (ADR-045): quem parou a execução interrompida, em palavras — o Mac da pessoa
 * ou o servidor. Motivo sem tradução sai como está (dado técnico visível, nunca um buraco).
 */
const MOTIVO_HUMANO: Readonly<Record<string, string>> = {
  maquina_sem_contato: "seu Mac parou de responder",
  reinicio_servidor: "o servidor reiniciou",
};

export function motivoDaExecucao(e: Pick<ExecucaoRotina, "motivo">): string | null {
  return e.motivo === null ? null : (MOTIVO_HUMANO[e.motivo] ?? e.motivo);
}

/** "interrompida · seu Mac parou de responder"; os outros desfechos seguem só com o nome. */
export function rotuloExecucao(e: Pick<ExecucaoRotina, "desfecho" | "motivo">): string {
  const base = e.desfecho.replaceAll("_", " ");
  const motivo = e.desfecho === "interrompida" ? motivoDaExecucao(e) : null;
  return motivo ? `${base} · ${motivo}` : base;
}
