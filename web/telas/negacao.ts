import type { Negacao } from "../../src/contracts/negacao.ts";
import { esc, hora } from "../lib/render.ts";
import { haQuanto } from "../lib/relogio.ts";

/**
 * Fail-closed RENDERIZADO por CLASSE, com relógio (ADR-029): nunca recusa seca, nunca silêncio.
 *  - conector_indisponivel → "conector <nome> indisponível: <motivo> desde HH:MM (há N min)"
 *  - ferramenta_negada     → "ferramenta <nome> negada: <motivo>" (+ terminal: o turno encerrou)
 *  - plano_ausente         → "nenhum trabalho começa: <motivo> desde HH:MM"
 */
const MOTIVO: Record<Negacao["motivo"], string> = {
  capacidade_desligada: "capacidade desligada",
  teto_canal: "teto do canal atingido",
  alcance_insuficiente: "alcance insuficiente — peça aprovação",
  fora_do_catalogo: "fora do catálogo deste turno",
  plano_ausente: "plano de turno ausente",
  plano_expirado: "plano de turno expirado",
  catalogo_vazio: "catálogo vazio",
  conector_indisponivel: "conector indisponível",
  parada_ativa: "parada ativa pela pessoa",
  args_invalidos: "argumentos inválidos",
  falha_tecnica: "falha técnica",
  timeout_transporte: "tempo esgotado no transporte",
};

export function textoNegacao(n: Negacao, agora: number): string {
  switch (n.classe) {
    case "conector_indisponivel":
      return `conector ${n.nome} indisponível: ${MOTIVO[n.motivo]} desde ${hora(n.desde)} (${haQuanto(agora - n.desde)})`;
    case "ferramenta_negada":
      return `ferramenta ${n.nome} negada: ${MOTIVO[n.motivo]}${n.terminal ? " · terminal: o turno encerrou, nada mais foi tentado" : " · transitória: o agente pode seguir por outro caminho"}`;
    case "plano_ausente":
      return `nenhum trabalho começa: ${MOTIVO[n.motivo]} desde ${hora(n.desde)} (${haQuanto(agora - n.desde)})`;
  }
}

export function renderNegacao(n: Negacao, agora: number): string {
  return `<div class="negacao negacao-${esc(n.classe)}" role="status"><span class="neg-classe">${esc(n.classe.replace("_", " "))}</span> ${esc(textoNegacao(n, agora))}</div>`;
}

export function renderNegacoes(lista: readonly Negacao[], agora: number, vazio = ""): string {
  if (lista.length === 0) return vazio ? `<p class="mudo">${esc(vazio)}</p>` : "";
  const porClasse = new Map<Negacao["classe"], Negacao[]>();
  for (const n of lista) porClasse.set(n.classe, [...(porClasse.get(n.classe) ?? []), n]);
  return [...porClasse.entries()].map(([classe, ns]) => `<section class="negacoes"><h4>${esc(classe.replace("_", " "))} · ${ns.length}</h4>${ns.map((n) => renderNegacao(n, agora)).join("")}</section>`).join("");
}
