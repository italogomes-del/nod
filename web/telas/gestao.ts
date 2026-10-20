import type { FrotaDto } from "../../src/contracts/api.ts";
import { botao, esc, iconeAgente } from "../lib/render.ts";

/** Gerenciar agentes, sem DOM (desde 2026-09-30 é uma seção de Seu espaço); os menus e diálogos moram em gestao-agentes.ts. */
export type BotGerido = FrotaDto["agentes"][number];
export type AcaoGestao = "fixar" | "mover" | "nao-lido" | "renomear" | "perfil" | "duplicar" | "copiar" | "ocultar" | "excluir" | "restaurar";

/**
 * O texto da caixa de duplicar. definido em 2026-09-28 (emenda da ADR-034): a dona leva o bot inteiro; bot de equipe de
 * outra pessoa, só o perfil. revisto em 2026-10-20 (NOD-316): a cópia nasce em Aprovar automaticamente e não herda o
 * modo do original — a caixa diz isso, nos dois ramos.
 */
export function textoDuplicar(dona: boolean): string {
  const modo = "<p>A cópia começa em Aprovar automaticamente; mude em Aprovações.</p>";
  return dona
    ? `<p>A cópia leva perfil, avatar, memória, acessos e rotinas. Rotinas ativas também rodam na cópia. Só o histórico da conversa não vem.</p>${modo}`
    : `<p>A cópia mantém perfil e avatar. Rotinas começam pausadas. Como o bot não é seu, memória e acessos ficam com a dona; o histórico também não vem.</p>${modo}`;
}

export function renderGestao(dados: FrotaDto | null, pessoaId?: string): string {
  const bots = dados?.agentes.filter((a) => a.ownerId === pessoaId) ?? [];
  const grupo = (titulo: string, lista: BotGerido[]) => `<section class="gestao-grupo"><h2>${titulo} <small>${lista.length}</small></h2>${lista.length ? lista.map((a) => `<article class="gestao-row">${iconeAgente(a)}<div><b>${esc(a.nome)}</b><p>${esc(a.titulo || "Sem título")}${a.secao ? ` · ${esc(a.secao)}` : ""}</p></div>${a.excluidoEm ? botao("restaurar-agente", "Restaurar", { id: a.id }) : botao("menu-agente", "•••", { id: a.id, titulo: `Ações de ${a.nome}` })}</article>`).join("") : '<p class="mudo">Nenhum agente aqui.</p>'}</section>`;
  return `<section class="tela tela-gestao"><header class="tela-cab"><h1>Gerenciar agentes</h1>${botao("atualizar-gestao", "Atualizar")}</header><p class="intro">Organize sua equipe e encontre os bots que saíram da barra lateral.</p>${!dados ? '<p role="status">Carregando…</p>' : grupo("Ativos", bots.filter((a) => !a.excluidoEm && !a.oculto)) + grupo("Ocultos", bots.filter((a) => !a.excluidoEm && a.oculto)) + '<p class="mudo">Ocultar não pausa o bot nem suas rotinas.</p>' + grupo("Excluídos", bots.filter((a) => a.excluidoEm)) + '<p class="mudo">Restaurar recupera o perfil e o histórico. Rotinas continuam pausadas e acessos precisam ser concedidos novamente.</p>'}</section>`;
}

