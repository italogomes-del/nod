import type { Mensagem } from "../../src/contracts/mensagem.ts";
import { botao, esc, hora } from "../lib/render.ts";

export type PayloadArtefato = Extract<NonNullable<Mensagem["payload"]>, { kind: "artefato" }>;

/**
 * O card do artefato (ADR-051) como STRING da timeline: cabeçalho (▣ título · vN · hora), "Tela cheia",
 * "Baixar .html" e um slot VAZIO. O iframe entra depois, por artefatos-vivos.ts — assim o HTML da timeline
 * não muda quando a pessoa marca algo ou quando a altura se ajusta, e a região não é regravada por isso
 * (web/lib/regioes.ts só troca o innerHTML quando o texto muda). Versão anterior fica recolhida num
 * <details data-disclosure>, que main.ts reabre entre renders; só a versão atual grava estado.
 * Sem DOM aqui: conversa.ts (e o teste unitário) importam este arquivo.
 */
export function renderCardArtefato(m: Mensagem, p: PayloadArtefato, versaoMaisRecente: number): string {
  const anterior = p.versao < versaoMaisRecente;
  const naoConfiavel = m.confianca === "nao_confiavel" ? '<span class="tag tag-ambar" title="publicado num turno que leu conteúdo de fora">não confiável</span>' : "";
  const dados = { mensagem: m.id };
  const slot = `<div class="artefato-corpo" data-artefato-slot="${esc(m.id)}"></div>`;
  return `<section class="artefato" data-artefato="${esc(p.artefatoId)}" data-versao="${p.versao}" data-mensagem-artefato="${esc(m.id)}" data-titulo="${esc(p.titulo)}">
    <header class="artefato-cab"><span class="artefato-marca" aria-hidden="true">▣</span><b class="artefato-titulo">${esc(p.titulo)}</b><span class="artefato-meta">v${p.versao} · ${hora(m.criadoEm)}</span>${naoConfiavel}<span class="artefato-status" role="status"></span><span class="artefato-acoes">${botao("artefato-tela-cheia", "Tela cheia", { classe: "link sm", dados })}${botao("artefato-baixar", "Baixar .html", { classe: "link sm", dados })}</span></header>
    ${anterior ? `<details class="artefato-anterior" data-disclosure="artefato-${esc(m.id)}"><summary>Versão anterior · a atual é a v${versaoMaisRecente}</summary>${slot}</details>` : slot}
  </section>`;
}
