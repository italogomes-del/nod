import type { Mensagem } from "../../src/contracts/mensagem.ts";
import type { ResumoRaioX } from "../../src/contracts/raio-x.ts";
import type { Estado } from "../estado/reducer.ts";
import { esc } from "../lib/render.ts";
import { ESCOLHAS_TEMA, lerTema, type EscolhaTema } from "../lib/tema.ts";

/**
 * Modo dev (definido em 2026-09-28, 0036; canvas "Nod — tela do agente", página modo-dev): em cada resposta, o
 * custo, as chamadas e o contexto; no Raio-X, o que foi enviado e o que cada chamada ocupou. Só a pessoa vê o
 * dela (o servidor filtra por RLS). Os números são os do Claude Code; o que é estimativa diz que é.
 */

/** Contexto perto do teto da janela: a faixa e a barra ficam em alerta a partir daqui. */
export const ALERTA_JANELA = 0.85;

const numero = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

/** 158_000 → "158 mil"; 197_500 → "197,5 mil"; 850 → "850"; 1_000_000 → "1 mi" (a janela do opus; "1.000 mil" não se lê). */
export function mil(n: number): string {
  if (n >= 999_950) return `${numero.format(Math.round(n / 100_000) / 10)} mi`;
  return n >= 1000 ? `${numero.format(Math.round(n / 100) / 10)} mil` : numero.format(n);
}

/** US$ com duas casas; abaixo de um centavo, três (um turno curto de haiku custa menos que isso). */
/**
 * NOD-276 (D10): o custo de UM turno. Null com chamadas registradas = o turno gastou e o CLI não disse quanto (caiu antes
 * do `result`): "custo desconhecido", e não "US$ —", que lia como "não custou".
 */
export function custoDoTurno(v: number | null, gastou: boolean): string {
  return v === null && gastou ? "custo desconhecido" : usd(v);
}

/** NOD-276 (D10): o total que deixou de fora turno sem custo conhecido diz "parcial". */
/** Revisão do Gil no #336: o que "(parcial)" e "custo desconhecido" querem dizer, no title de quem os mostra. */
export const PARCIAL = "Parcial: algum turno caiu antes de informar o custo e ficou fora da soma.";
export const CUSTO_DESCONHECIDO = "O turno caiu antes de informar o custo; os tokens estão somados.";

export function totalUsd(v: number, parcial: boolean | undefined): string {
  return parcial ? `${usd(v)} (parcial)` : usd(v);
}

export function usd(v: number | null): string {
  if (v === null) return "US$ —";
  const casas = v > 0 && v < 0.01 ? 3 : 2;
  return `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}`;
}

/** NOD-273: "850 tokens", "13 mil tokens", "1.204 mil tokens" — o consumo de quem não informa custo (o Codex). */
export function tokensLegiveis(n: number): string {
  if (!Number.isFinite(n) || n < 1000) return `${Math.max(0, Math.round(Number.isFinite(n) ? n : 0)).toLocaleString("pt-BR")} tokens`;
  return `${Math.round(n / 1000).toLocaleString("pt-BR")} mil tokens`;
}

/**
 * NOD-273: o custo de uma frente (ou task). Com turno sem custo informado (o Codex), o valor é só parte: "(parcial)"; sem
 * nenhum valor e parcial, diz por quê. null = nada a mostrar.
 */
export function custoDaFrente(t: { custoUsd: number | null; custoParcial?: boolean }): string | null {
  if (t.custoUsd === null) return t.custoParcial ? "custo não informado pelo Codex" : null;
  return `${usd(t.custoUsd)}${t.custoParcial ? " (parcial)" : ""}`;
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
  // definido em 2026-09-28 (canvas modo-dev, D1): "pico" quando houve compactação — o contexto subiu e desceu no turno.
  const rotulo = r.compactacoes ? "pico" : "contexto";
  const barra = r.picoContexto !== null && r.janela ? `<span class="faixa-dev-barra" aria-hidden="true"><span style="width:${Math.min(100, (r.picoContexto / r.janela) * 100).toFixed(1)}%"></span></span>` : "";
  const partes = [
    r.custoUsd === null && r.chamadas > 0 ? `<b title="${CUSTO_DESCONHECIDO}">${esc(custoDoTurno(r.custoUsd, true))}</b>` : `<b>${esc(custoDoTurno(r.custoUsd, r.chamadas > 0))}</b>`,
    r.chamadas ? `<span>${r.chamadas} ${r.chamadas === 1 ? "chamada" : "chamadas"}${r.compactacoes ? ` + ${r.compactacoes} ${r.compactacoes === 1 ? "compactação" : "compactações"}` : ""}</span>` : "",
    r.picoContexto !== null ? `<span class="faixa-dev-ctx${alerta ? " dev-alerta" : ""}">${rotulo}${barra}<span>${esc(mil(r.picoContexto))}${r.janela ? ` / ${esc(mil(r.janela))}` : ""}</span></span>` : "",
    r.cachePct !== null ? `<span>${r.cachePct}% do cache</span>` : "",
    r.modelo ? `<span>${esc(modeloCurto(r.modelo))}</span>` : "",
  ].filter(Boolean);
  return `<div class="faixa-dev${alerta ? " faixa-dev-alerta" : ""}">${partes.join("")}<button type="button" class="faixa-dev-bt" data-act="abrir-raio-x" data-id="${esc(r.turnoId)}">Raio-X</button></div>`;
}

/** Na gaveta do bot (desde 2026-10-16, plano "tela limpa"; antes no cabeçalho da conversa): o selo e o total de hoje. */
export function renderSeloModoDev(estado: Estado, conversaId: string | undefined, nome: string): string {
  if (!estado.modoDev.ligado) return "";
  const hoje = conversaId ? estado.modoDev.raioX[conversaId]?.desde : undefined;
  const total = hoje ? `<span class="dev-hoje">Hoje com ${esc(nome)}: <b${hoje.parcial ? ` title="${PARCIAL}"` : ""}>${esc(totalUsd(hoje.custoUsd, hoje.parcial))}</b> · ${hoje.turnos} ${hoje.turnos === 1 ? "turno" : "turnos"}</span>` : "";
  return `<span class="selo-dev" title="Modo dev ligado (⌘⇧D)">MODO DEV</span>${total}${renderTaxasLinhas(estado)}`;
}

/**
 * A taxa de abertura das linhas do chat (definido em 2026-10-07, #191; ADR-083, gatilho de reversão): abertas / mostradas
 * nos últimos 14 dias, por tipo. Um tipo acima de 30% por duas semanas volta a ser balão (a decisão é manual).
 */
export function renderTaxasLinhas(estado: Estado): string {
  const taxas = estado.modoDev.taxasLinhas;
  if (!estado.modoDev.ligado || !taxas?.length) return "";
  const partes = taxas.map((t) => `${t.tipo} ${t.taxa === null ? "—" : `${Math.round(t.taxa * 100)}%`}`).join(" · ");
  return `<span class="dev-hoje dev-linhas" title="Linhas do chat abertas nos últimos 14 dias (abertas / mostradas). Acima de 30% por 2 semanas, o tipo volta a ser balão (ADR-083).">Linhas abertas: ${esc(partes)}</span>`;
}

/**
 * Aparência (definido em 2026-10-04, design system do Nod): Sistema, Claro ou Escuro, deste computador. O clique
 * aplica na hora (web/lib/tema.ts) e marca o botão no próprio DOM: a escolha não mora no Estado.
 */
export function renderEscolhaTema(atual: EscolhaTema): string {
  const botoes = ESCOLHAS_TEMA.map((t) => `<button type="button" class="seg${t.id === atual ? " ativo" : ""}" data-act="escolher-tema" data-tema="${t.id}" aria-pressed="${t.id === atual}">${esc(t.nome)}</button>`).join("");
  return `<h3 class="espaco-subtitulo">Aparência</h3>
      <div class="segmentado escolha-tema" role="group" aria-label="Tema">${botoes}</div>
      <p class="intro">Sistema acompanha o modo claro ou escuro do macOS. A escolha vale para este computador.</p>`;
}

/** Em "Seu espaço": Aparência e o interruptor do modo dev, com o mesmo desenho do de avisos. */
export function renderPreferenciaModoDev(estado: Estado): string {
  return `<section class="espaco-secao">
      <h2>Preferências</h2>
      ${renderEscolhaTema(lerTema())}
      <h3 class="espaco-subtitulo">Modo dev</h3>
      <div class="avisos-linha">
        <button type="button" class="avisos-interruptor" data-act="alternar-modo-dev" role="switch" aria-checked="${estado.modoDev.ligado ? "true" : "false"}"><span class="avisos-trilho" aria-hidden="true"></span><span>Modo dev</span></button>
        <span class="mudo">Atalho ⌘⇧D</span>
      </div>
      <p class="intro">Mostra, em cada resposta, o custo, os tokens e o que foi enviado ao modelo. Só você vê. O texto do que foi enviado fica guardado a partir dos turnos que rodarem com ele ligado.</p>
    </section>`;
}

