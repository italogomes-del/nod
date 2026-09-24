import type { AcessoPedido } from "../../src/contracts/acesso.ts";
import type { Proposta } from "../../src/contracts/conversa.ts";
import type { Estado } from "../estado/reducer.ts";
import { botao, esc } from "../lib/render.ts";
import { logoApp } from "./marketplace.ts";

/**
 * "Rotina nasce com o acesso" (definido em 2026-09-24, emenda da ADR-044): o card da rotina proposta diz,
 * em destaque, o que ela vai LER ou ALTERAR — "Precisa · Ler seu Gmail · Não inclui: enviar, apagar,
 * arquivar" — e o botão principal diz que confirmar também libera ("Criar rotina e permitir leitura").
 * App ainda por conectar: "Conectar {App}" vem primeiro e o botão fica desabilitado, com "Liberado assim
 * que o {App} conectar." O mesmo no chat (conversa.ts) e em "Sua vez" (sua-vez.ts), e na mudança de
 * rotina que traz acessos. A web só importa tipos de src/: nome do app, verbo e "não inclui" espelham
 * nomeDoApp e fraseDoPedidoDeAcesso (src/domain/pedido-acesso.ts) com o que o estado já tem.
 */

type Contexto = Pick<Estado, "conectores" | "marketplace">;

/** Os acessos que a proposta declara: nascimento ('rotina') ou mudança que traz a lista nova. */
export function acessosDaProposta(p: Proposta | null | undefined): readonly AcessoPedido[] {
  if (p?.payload.kind === "rotina" || p?.payload.kind === "rotina_atualizacao") return p.payload.acessos ?? [];
  return [];
}

function nomeDoApp(ctx: Contexto, slug: string): string {
  return ctx.marketplace.find((a) => a.slug === slug)?.nome ?? ctx.conectores.find((c) => c.slug === slug)?.nome ?? slug;
}

const acoes = (n: number): string => `${n} ${n === 1 ? "ação" : "ações"}`;

/** "o Gmail", "o Gmail e o Slack", "o Gmail, o Slack e o Notion". */
function listaDeApps(nomes: readonly string[]): string {
  const com = nomes.map((n) => `o ${n}`);
  return com.length <= 1 ? (com[0] ?? "") : `${com.slice(0, -1).join(", ")} e ${com.at(-1) ?? ""}`;
}

type LinhaPrecisa = { slug: string; nome: string; conectado: boolean; escrita: boolean; html: string };

function linha(a: AcessoPedido, ctx: Contexto, chave: string): LinhaPrecisa {
  const nome = nomeDoApp(ctx, a.conector);
  const conector = ctx.conectores.find((c) => c.slug === a.conector && c.habilitado) ?? ctx.conectores.find((c) => c.slug === a.conector);
  const conectado = Boolean(conector?.habilitado);
  const catalogo = conector?.catalogo ?? [];
  const porNome = new Map(catalogo.map((c) => [c.nome, c]));
  // Leitura declarada com [] (o app não estava conectado na proposta): confirmar concede as de leitura do catálogo de agora.
  const capacidades = a.capacidades.length > 0 ? a.capacidades : a.nivel === "leitura" ? catalogo.filter((c) => c.readOnlyHint).map((c) => c.nome) : [];
  // O verbo pelo que é pedido DE FATO (readOnlyHint do catálogo); sem catálogo à mão, pelo nível declarado.
  const conhecidas = capacidades.length > 0 && capacidades.every((c) => porNome.has(c));
  const leitura = conhecidas ? capacidades.filter((c) => porNome.get(c)?.readOnlyHint === true).length : a.nivel === "leitura" ? 1 : 0;
  const temEscrita = conhecidas ? leitura < capacidades.length : a.nivel === "escrita";
  const verbo = !temEscrita ? "Ler" : leitura === 0 ? "Alterar" : "Ler e alterar";
  let fora: string;
  if (!temEscrita) {
    const curado = ctx.marketplace.find((m) => m.slug === a.conector)?.naoIncluiNaLeitura;
    const deEscrita = catalogo.filter((c) => !c.readOnlyHint).length;
    fora = curado?.length ? `Não inclui: ${curado.join(", ")}.` : `Não inclui: nada que altere o ${nome}${deEscrita > 0 ? ` (${acoes(deEscrita)} de escrita ${deEscrita === 1 ? "fica" : "ficam"} de fora)` : ""}.`;
  } else {
    const outras = catalogo.filter((c) => !capacidades.includes(c.nome)).length;
    fora = outras > 0 ? `Não inclui as outras ${acoes(outras)} do ${nome}.` : "";
  }
  const n = capacidades.length;
  const detalhe = n > 0
    ? `<details class="ap-detalhe" data-disclosure="rotina-precisa-${esc(chave)}-${esc(a.conector)}"><summary>${n === 1 ? "Ver a ação" : `Ver as ${n} ações`}</summary><ul class="acesso-acoes">${capacidades.map((c) => `<li><code>${esc(a.conector)}.${esc(c)}</code></li>`).join("")}</ul></details>`
    : "";
  const temLogo = Boolean(ctx.marketplace.find((m) => m.slug === a.conector)?.logo);
  const html = `<div class="rotina-precisa" data-app="${esc(a.conector)}">${logoApp(a.conector, nome, temLogo)}<div class="rp-corpo"><b class="rp-rotulo">Precisa</b><div class="rp-oque">${esc(verbo)} seu ${esc(nome)}</div>${fora ? `<small class="rp-fora">${esc(fora)}</small>` : ""}${detalhe}</div></div>`;
  return { slug: a.conector, nome, conectado, escrita: temEscrita, html };
}

/** As linhas "Precisa" do card (vazio quando a proposta não declara acessos). */
export function linhasPrecisa(p: Proposta | null | undefined, ctx: Contexto): string {
  if (!p) return "";
  return acessosDaProposta(p).map((a) => linha(a, ctx, p.id).html).join("");
}

/**
 * As ações do card de rotina que declara acessos; null = não declara, e o card segue com os botões de
 * sempre. `confirmar`/`recusar` são os data-act do lugar (confirmar-proposta no chat, decidir-proposta em
 * "Sua vez" e na mudança de rotina). Devolve os botões e, quando falta conectar, a linha que diz por que o
 * principal está desabilitado.
 */
export function acoesComAcesso(p: Proposta | null | undefined, ctx: Contexto, atos: { confirmar: string; recusar: string; rotuloRecusar: string }): { botoes: string; ajuda: string } | null {
  if (!p) return null;
  const linhas = acessosDaProposta(p).map((a) => linha(a, ctx, p.id));
  if (linhas.length === 0) return null;
  const inicio = p.payload.kind === "rotina_atualizacao" ? "Aplicar mudança" : "Criar rotina";
  const rotulo = `${inicio} e permitir ${linhas.some((l) => l.escrita) ? "acesso" : "leitura"}`;
  const faltam = linhas.filter((l) => !l.conectado);
  const liberado = faltam.length > 0 ? `Liberado assim que ${listaDeApps(faltam.map((l) => l.nome))} ${faltam.length === 1 ? "conectar" : "conectarem"}.` : "";
  const conectar = faltam.map((l) => botao("abrir-conexao", `Conectar ${esc(l.nome)}`, { classe: "pri", id: l.slug })).join("");
  const principal = botao(atos.confirmar, rotulo, { classe: faltam.length > 0 ? "" : "pri", id: p.id, desabilitado: faltam.length > 0, ...(liberado ? { titulo: liberado } : {}) });
  return { botoes: `${conectar}${principal}${botao(atos.recusar, atos.rotuloRecusar, { id: p.id })}`, ajuda: liberado ? `<p class="rp-liberado mudo">${esc(liberado)}</p>` : "" };
}
