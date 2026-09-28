import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { ResumoRaioX } from "../../src/contracts/raio-x.ts";
import type { Estado } from "../estado/reducer.ts";
import { esc } from "../lib/render.ts";

/**
 * Modo dev (definido em 2026-09-28, 0036; canvas "Nod — tela do agente", página modo-dev): em cada resposta, o
 * custo, as chamadas e o contexto; no Raio-X, o que foi enviado e o que cada chamada ocupou. Só a pessoa vê o
 * dela (o servidor filtra por RLS). Os números são os do Claude Code; o que é estimativa diz que é.
 */

/** Contexto perto do teto da janela: a faixa e a barra ficam em alerta a partir daqui. */
export const ALERTA_JANELA = 0.85;

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/** 158_000 → "158 mil"; 197_500 → "197,5 mil"; 850 → "850". */
export function mil(n: number): string {
  return n >= 1000 ? `${numero.format(Math.round(n / 100) / 10)} mil` : numero.format(n);
}

/** US$ com duas casas; abaixo de um centavo, três (um turno curto de haiku custa menos que isso). */
export function usd(v: number | null): string {
  if (v === null) return "US$ —";
  const casas = v > 0 && v < 0.01 ? 3 : 2;
  return `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}`;
}

export function modeloCurto(modelo: string | null): string {
  if (!modelo) return "";
  const m = /(opus|sonnet|haiku|fable)/i.exec(modelo);
  return m ? m[1]!.toLowerCase() : modelo;
}

/** A faixa aparece na ÚLTIMA mensagem do turno na conversa (a fala e, se houve, a linha de interrupção). */
export function faixaDaMensagem(m: Mensagem, estado: Estado): string {
  if (!estado.modoDev.ligado || !m.turnoId || m.autoria.autor_tipo === "pessoa") return "";
  const resumo = estado.modoDev.raioX[m.conversaId]?.turnos.find((t) => t.turnoId === m.turnoId);
  if (!resumo) return "";
  const mensagens = estado.conversas[m.conversaId]?.mensagens ?? [];
  const ultima = [...mensagens].reverse().find((x) => x.turnoId === m.turnoId);
  if (ultima && ultima.id !== m.id) return "";
  return renderFaixaDev(resumo);
}

export function renderFaixaDev(r: ResumoRaioX): string {
  const alerta = r.picoContexto !== null && r.janela !== null && r.picoContexto >= r.janela * ALERTA_JANELA;
  const partes = [
    `<b>${esc(usd(r.custoUsd))}</b>`,
    r.chamadas ? `${r.chamadas} ${r.chamadas === 1 ? "chamada" : "chamadas"}${r.compactacoes ? ` + ${r.compactacoes} ${r.compactacoes === 1 ? "compactação" : "compactações"}` : ""}` : "",
    r.picoContexto !== null ? `<span class="${alerta ? "dev-alerta" : ""}">contexto ${esc(mil(r.picoContexto))}${r.janela ? ` / ${esc(mil(r.janela))}` : ""}</span>` : "",
    r.cachePct !== null ? `${r.cachePct}% do cache` : "",
    esc(modeloCurto(r.modelo)),
  ].filter(Boolean);
  return `<div class="faixa-dev${alerta ? " faixa-dev-alerta" : ""}">${partes.join('<i aria-hidden="true">·</i>')}<button type="button" class="faixa-dev-bt" data-act="abrir-raio-x" data-id="${esc(r.turnoId)}">Raio-X</button></div>`;
}

/** No cabeçalho da conversa: o selo e o total de hoje com o bot. */
export function renderSeloModoDev(estado: Estado, conversaId: string | undefined, nome: string): string {
  if (!estado.modoDev.ligado) return "";
  const hoje = conversaId ? estado.modoDev.raioX[conversaId]?.desde : undefined;
  const total = hoje ? `<span class="dev-hoje">Hoje com ${esc(nome)}: <b>${esc(usd(hoje.custoUsd))}</b> · ${hoje.turnos} ${hoje.turnos === 1 ? "turno" : "turnos"}</span>` : "";
  return `<span class="selo-dev" title="Modo dev ligado (⌘⇧D)">MODO DEV</span>${total}`;
}

/** Em "Seu espaço": o interruptor, com o mesmo desenho do de avisos. */
export function renderPreferenciaModoDev(estado: Estado): string {
  return `<section class="espaco-secao">
      <h2>Preferências</h2>
      <div class="avisos-linha">
        <button type="button" class="avisos-interruptor" data-act="alternar-modo-dev" role="switch" aria-checked="${estado.modoDev.ligado ? "true" : "false"}"><span class="avisos-trilho" aria-hidden="true"></span><span>Modo dev</span></button>
        <span class="mudo">Atalho ⌘⇧D</span>
      </div>
      <p class="intro">Mostra, em cada resposta, o custo, os tokens e o que foi enviado ao modelo. Só você vê. O texto do que foi enviado fica guardado a partir dos turnos que rodarem com ele ligado.</p>
    </section>`;
}

