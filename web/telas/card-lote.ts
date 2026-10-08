import type { AcaoNoLote, MotivoCardDoLote, PayloadPropostaLoteBots, Proposta } from "../../src/contracts/conversa.ts";
import { botao, esc } from "../lib/render.ts";

/** O card do lote do Nod (definido em 2026-10-07, ADR-082), fora de conversa.ts como card-perfil e card-pasta. */

const VERBO_DO_LOTE: Record<AcaoNoLote["tipo"], string> = {
  criar: "Criar",
  duplicar: "Duplicar",
  editar: "Editar",
  mover: "Mover",
  excluir: "Excluir",
  criar_rotina: "Criar rotina",
  dar_acesso: "Dar acesso",
  mudar_modo: "Mudar modo",
};
const MODO_HUMANO: Record<NonNullable<AcaoNoLote["modo"]>, string> = { manual: "manual", automatico: "automático", total: "sem aprovações" };
/** Por que a ação esperou você, quando não foi só o modo manual (QA de 2026-10-07: uma frase por tipo, não uma genérica). */
function motivoDoLote(a: AcaoNoLote, motivo: Exclude<MotivoCardDoLote, "manual">): string {
  if (motivo === "arriscada") return a.tipo === "excluir" ? "Excluir é arriscado: o Nod sempre pergunta antes. Dá para restaurar depois em Gerenciar agentes." : "Mudar o modo de um bot é arriscado: o Nod sempre pergunta antes.";
  return a.tipo === "dar_acesso" ? "O Nod leu conteúdo de fora nesta conversa, então dar acesso a um app espera você." : "O Nod leu conteúdo de fora nesta conversa, então esta mudança espera você.";
}

function detalheDaAcao(a: AcaoNoLote): string {
  switch (a.tipo) {
    case "criar": return [a.secao ? `em ${a.secao}` : "", a.descricao ?? ""].filter(Boolean).join(" · ");
    case "duplicar": return "leva memória, rotinas e acessos do original";
    case "editar": return [a.nome ? `nome: ${a.nome}` : "", a.titulo !== undefined ? `título: ${a.titulo || "—"}` : "", a.modelo ? `modelo: ${a.modelo}` : "", a.esforco !== undefined ? `esforço: ${a.esforco || "padrão"}` : "", a.descricao ? "descrição nova" : ""].filter(Boolean).join(" · ");
    case "mover": return a.secao ? `para ${a.secao}` : "para fora da seção";
    case "excluir": return "dá para restaurar depois em Gerenciar agentes";
    case "criar_rotina": return [a.cron ? `${a.cron} (${a.fuso_iana ?? ""})` : "", a.instrucao ?? ""].filter(Boolean).join(" · ");
    case "dar_acesso": return `${a.app ?? ""}, ${a.nivel === "escrita" ? "ler e alterar" : "ler"}`;
    case "mudar_modo": return a.modo ? `para ${MODO_HUMANO[a.modo]}` : "";
    default: return "";
  }
}

/**
 * O card do lote do Nod (ADR-082): cada ação com caixa de marcar enquanto o card está aberto; as já feitas pelo modo
 * aparecem como "feito"; depois de decidido, cada uma com o desfecho. "Aprovar" manda os índices marcados.
 * `aberto` = a proposta pendente com a decisão de mesmo id aberta em "Sua vez" (quem chama confere).
 */
export function renderCardLote(p: Pick<Proposta, "id">, c: PayloadPropostaLoteBots, aberto: boolean): string {
  const esperando = c.acoes.filter((a) => a.estado === "esperando").length;
  const linhas = c.acoes.map((a) => {
    const marca = a.estado === "feita" ? '<span class="tag tag-ok">feito</span>' : a.estado === "falhou" ? `<span class="tag tag-ambar">não deu certo${a.erro ? ` (${esc(a.erro.replaceAll("_", " "))})` : ""}</span>` : a.estado === "recusada" ? '<span class="tag tag-cinza">não feito</span>' : !aberto ? '<span class="tag tag-cinza">não decidido</span>' : "";
    const caixa = a.estado === "esperando" && aberto ? `<input type="checkbox" data-lote-i="${a.i}" checked aria-label="${esc(`${VERBO_DO_LOTE[a.tipo]} ${a.alvoNome}`)}" />` : "";
    const detalhe = detalheDaAcao(a);
    const motivo = a.estado === "esperando" && a.motivo && a.motivo !== "manual" ? `<small class="lote-motivo">${esc(motivoDoLote(a, a.motivo))}</small>` : "";
    return `<label class="lote-acao">${caixa}<span class="lote-texto"><span><i class="lote-verbo">${esc(VERBO_DO_LOTE[a.tipo])}</i><b>${esc(a.alvoNome)}</b>${marca}</span>${detalhe ? `<small>${esc(detalhe)}</small>` : ""}${motivo}</span></label>`;
  }).join("");
  const titulo = aberto ? `${esperando} ${esperando === 1 ? "mudança espera" : "mudanças esperam"} você` : "Mudanças nos seus bots";
  const botoes = aberto ? `${botao("decidir-lote", "Aprovar marcadas", { classe: "pri", id: p.id })}${botao("recusar-decisao", "Recusar", { id: p.id })}` : "";
  return `<div class="card-prop card-lote" data-proposta="${esc(p.id)}">
    <div class="hd">O Nod propõe · ${esc(c.resumo)}</div>
    <div class="ttl">${esc(titulo)}</div>
    <div class="lote-acoes">${linhas}</div>
    ${botoes ? `<div class="ft">${botoes}</div>` : ""}
  </div>`;
}

/**
 * As ações que esperam, em lista curta, para "Sua vez" (revisão de 2026-10-07): lá o botão aprova todas de uma vez, então
 * a pessoa vê o que está aprovando — inclusive um excluir — antes do clique. Desmarcar uma é no card da conversa do Nod.
 */
export function listaDoLoteParaSuaVez(c: PayloadPropostaLoteBots): string {
  const esperando = c.acoes.filter((a) => a.estado === "esperando");
  if (esperando.length === 0) return "";
  return `<ul class="lote-sua-vez">${esperando.map((a) => `<li><i class="lote-verbo">${esc(VERBO_DO_LOTE[a.tipo])}</i>${esc(a.alvoNome)}${detalheDaAcao(a) ? ` <small>${esc(detalheDaAcao(a))}</small>` : ""}</li>`).join("")}</ul>`;
}
