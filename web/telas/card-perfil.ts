import type { FrotaDto } from "../../src/contracts/api.ts";
import type { PayloadPropostaRotina, Proposta } from "../../src/contracts/conversa.ts";
import type { Estado } from "../estado/reducer.ts";
import { botao, esc, iconeAgente } from "../lib/render.ts";
import { conectorDoApp, nomeDoApp } from "./app-acesso.ts";
import { logoApp } from "./marketplace.ts";

/**
 * O perfil que vem com as rotinas (definido em 2026-09-28, ADR-050, "bot novo é bot completo"): UM card
 * com quem o bot passa a ser, o que ele vai fazer e que apps vai ler. Confirmar cria tudo e libera a
 * leitura (confirmar-proposta.ts). As propostas 'rotina' do perfil não viram card próprio: somem da
 * linha do tempo (idsNoPerfil) e aparecem aqui dentro. Perfil sem rotinas segue no card de sempre.
 */

/** Instrução de rotina escrita pelo modelo pode ser um parágrafo; o card mostra o começo e o resto no title. */
const INSTRUCAO_NO_CARD = 140;

type Rotina = { id: string; payload: PayloadPropostaRotina };

/** As propostas 'rotina' pendentes que algum perfil pendente carrega: não viram card próprio. */
export function idsNoPerfil(propostas: readonly Proposta[]): Set<string> {
  const ids = new Set<string>();
  for (const p of propostas) if (p.payload.kind === "perfil" && p.estado === "pendente") for (const id of p.payload.rotinas ?? []) ids.add(id);
  return ids;
}

function rotinasDe(p: Proposta, propostas: readonly Proposta[]): Rotina[] {
  if (p.payload.kind !== "perfil") return [];
  const porId = new Map(propostas.map((x) => [x.id, x]));
  return (p.payload.rotinas ?? []).flatMap((id) => {
    const r = porId.get(id);
    return r && r.estado === "pendente" && r.payload.kind === "rotina" ? [{ id, payload: r.payload }] : [];
  });
}

/** Os apps que as rotinas declaram, um por slug, com o nível mais alto pedido para ele. */
function appsDe(rotinas: readonly Rotina[]): { slug: string; escrita: boolean }[] {
  const apps = new Map<string, boolean>();
  for (const r of rotinas) for (const a of r.payload.acessos ?? []) apps.set(a.conector, (apps.get(a.conector) ?? false) || a.nivel === "escrita");
  return [...apps].map(([slug, escrita]) => ({ slug, escrita }));
}

function cortar(texto: string, teto: number): string {
  return texto.length > teto ? `${texto.slice(0, teto - 1)}…` : texto;
}

/** null = o perfil não traz rotinas (ou elas já saíram de pendente): o card de sempre desenha. */
export function renderCardPerfil(p: Proposta, propostas: readonly Proposta[], estado: Estado, agente: FrotaDto["agentes"][number] | undefined): string | null {
  if (p.payload.kind !== "perfil") return null;
  const rotinas = rotinasDe(p, propostas);
  if (rotinas.length === 0) return null;
  const c = p.payload;
  const nome = c.nome ?? agente?.nome ?? "O bot";
  const titulo = c.titulo ?? agente?.titulo ?? "";
  const icone = agente ? iconeAgente({ ...agente, nome }, "lg") : "";
  const cab = `<div class="ac-cab">${icone}<div class="ac-titulo"><b>${esc(titulo ? `${nome} · ${titulo}` : nome)}</b>${c.descricao ? `<small>${esc(c.descricao)}</small>` : ""}</div></div>`;

  const lista = rotinas.map((r) => `<li><b title="${esc(r.payload.instrucao)}">${esc(cortar(r.payload.instrucao, INSTRUCAO_NO_CARD))}</b><small>${esc(r.payload.resumo)}</small></li>`).join("");
  const blocoRotinas = `<div class="pc-secao"><div class="pc-rotulo">${rotinas.length === 1 ? "1 rotina" : `${rotinas.length} rotinas`}</div><ul class="pc-rotinas">${lista}</ul></div>`;

  const apps = appsDe(rotinas);
  let blocoApps = "";
  if (apps.length > 0) {
    const chips = apps.map(({ slug }) => {
      const nomeApp = nomeDoApp(estado, slug);
      return `<span class="pc-app">${logoApp(estado, slug, nomeApp)}${esc(nomeApp)}</span>`;
    }).join("");
    // App ainda por conectar não trava o card: a rotina nasce e pede o acesso quando precisar (pré-voo, ADR-044).
    const faltam = apps.filter(({ slug }) => !conectorDoApp(estado, slug)?.habilitado).map(({ slug }) => nomeDoApp(estado, slug));
    const falta = faltam.length > 0 ? `<p class="pc-falta">Falta conectar ${esc(faltam.join(", "))}: ${esc(nome)} pede quando a rotina precisar.</p>` : "";
    const rotulo = apps.some((a) => a.escrita) ? "Lê e altera · confirmar já permite" : "Lê, sem mudar nada · confirmar já permite";
    blocoApps = `<div class="pc-secao"><div class="pc-rotulo">${rotulo}</div><div class="pc-apps">${chips}</div>${falta}</div>`;
  }

  const botoes = [
    botao("confirmar-proposta", "Confirmar", { classe: "pri", id: p.id }),
    botao("preencher-prompt", "Ajustar", { classe: "link", dados: { texto: "Quero ajustar a proposta: " } }),
    botao("recusar-proposta", "Deixar de lado", { classe: "link", id: p.id }),
  ].join("");
  return `<section class="acesso-card perfil-card" data-proposta="${esc(p.id)}">${cab}${blocoRotinas}${blocoApps}<div class="ac-rodape">${botoes}<span class="ac-nota">Nada vale antes de você confirmar</span></div></section>`;
}
