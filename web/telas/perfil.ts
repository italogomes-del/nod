import { renderInteligencia } from "./inteligencia.ts";
import type { Estado } from "../estado/reducer.ts";
import { iconeAgente, botao, esc } from "../lib/render.ts";
import { CORES_MASCOTE, FORMAS_MASCOTE } from "../lib/mascote.ts";
import { CATALOGO_MASCOTE } from "../lib/mascote-catalogo.ts";
import { EXPRESSIONS } from "../vendor/bloub/expressions.ts";

const NOMES_FORMAS = ["Quadrado", "Hexágono", "Círculo", "Galet", "Cápsula", "Triângulo", "Nuvem", "Gota"];
const NOMES_CORES = ["Vermelho", "Rosa", "Roxo", "Azul", "Turquesa", "Verde", "Laranja", "Preto", "Marrom", "Âmbar", "Cinza", "Creme"];

/** Perfil do bot (E1.2, Grok Bot): editar nome/título/descrição/modelo (PATCH), Pin/Hide/Duplicate; o dono é imutável. */
export function renderPerfil(estado: Estado, agenteId: string): string {
  const a = [...(estado.frota?.agentes ?? []), ...(estado.gestao?.agentes ?? [])].find((x) => x.id === agenteId && !x.excluidoEm);
  if (!a) return `<section class="tela"><p class="mudo">agente não encontrado (ou de outra pessoa)</p></section>`;
  const concessoes = estado.concessoes[agenteId] ?? [];
  const conectorNome = (id: string) => estado.conectores.find((c) => c.id === id)?.slug ?? id.slice(0, 8);
  return `<section class="tela tela-perfil">
    <header class="tela-cab">${iconeAgente(a, "lg")}<h1>${esc(a.nome)}</h1><span class="chip">${esc(a.dono === "pessoa" ? "Seu agente" : "Agente da equipe")}</span>${a.confirmado ? "" : '<span class="tag tag-ambar">perfil não confirmado</span>'}</header>
    <form class="form" data-form="editar-perfil" data-id="${esc(a.id)}">
      <label>Nome <input name="nome" value="${esc(a.nome)}" required maxlength="60" /></label>
      <label>Título <input name="titulo" value="${esc(a.titulo)}" maxlength="80" /></label>
      <label>Missão e orientações <textarea name="descricao" rows="4">${esc(a.descricao)}</textarea></label>
      <fieldset class="mascote-editor"><legend>Mascote <small>temporário</small></legend>
        <div class="mascote-preview">${iconeAgente(a, "xl", "disponivel", "data-mascote-preview")}<div><b>Seu bot</b><span>A forma e a cor mudam aqui antes de salvar.</span></div></div>
        <span class="campo-titulo">Forma</span><div class="forma-opcoes">${FORMAS_MASCOTE.map((forma, i) => `<label title="${NOMES_FORMAS[i]}"><input type="radio" name="forma" value="${forma}"${a.forma === forma ? " checked" : ""} data-customiza-mascote />${iconeAgente({ ...a, forma }, "md")}<span>${NOMES_FORMAS[i]}</span></label>`).join("")}</div>
        <span class="campo-titulo">Cor</span><div class="cor-opcoes">${CORES_MASCOTE.map((cor, i) => `<label title="${NOMES_CORES[i]}"><input type="radio" name="cor" value="${cor}"${a.cor === cor ? " checked" : ""} data-customiza-mascote /><span class="cor-amostra ${cor}"></span><span class="sr-only">${NOMES_CORES[i]}</span></label>`).join("")}</div>
        <div class="mascote-estados"><span class="campo-titulo">Catálogo Bloub · 15 estados e 16 expressões</span>
          <p class="mudo">Ativo = ligado a fatos do nod. Reservado = demonstração, sem disparo automático. Alguns estados substituem a forma ou expressão durante a animação.</p>
          <label>Expressão da prévia <select data-mascote-expression>${EXPRESSIONS.map(e => `<option value="${e.id}">${e.id}</option>`).join("")}</select></label>
          <div class="acoes"><button type="button" class="bt" data-mascote-replay>Repetir transições</button><button type="button" class="bt" data-mascote-pause aria-pressed="false">Pausar animações</button></div>
          <div class="mascote-catalogo">${Object.entries(CATALOGO_MASCOTE).map(([id, item]) => `<figure><nod-mascote class="icon mascote ${esc(a.cor)} xl" shape="${a.forma}" state="${id}" data-gallery role="img" aria-label="${item.nome}"></nod-mascote><figcaption><b>${item.nome} · <code>${id}</code></b><span>${item.ativo ? "Ativo" : "Reservado"} — ${item.situacao}</span></figcaption></figure>`).join("")}</div>
        </div>
      </fieldset>
      ${renderInteligencia(a, estado.executor?.harnesses)}
      <div class="acoes">
        <button class="bt pri" type="submit" data-act="salvar-perfil">Salvar</button>
        ${botao("fixar", a.fixado ? "Desafixar" : "Fixar", { id: a.id })}
        ${botao("ocultar", a.oculto ? "Mostrar" : "Ocultar", { id: a.id })}
        ${botao("duplicar", "Duplicar", { id: a.id, titulo: a.ownerId === estado.sessao?.pessoaId ? "copia o bot com memória, acessos e rotinas; nunca o histórico" : "copia o perfil; memória, acessos e histórico ficam com a dona" })}
        ${botao("ir-memoria", "Memória", { id: a.id })}
        ${botao("abrir-conversa", "Conversa", { dados: { conversa: a.conversaId, agente: a.id } })}
      </div>
    </form>
    <h3>Acessos concedidos (${concessoes.length})</h3>
    ${concessoes.length ? `<ul class="lista">${concessoes.map((c) => `<li><code>${esc(conectorNome(c.conectorId))}.${esc(c.capacidade)}</code> ${botao("revogar", "revogar", { classe: "sm", id: c.id, dados: { agente: a.id } })}</li>`).join("")}</ul>` : '<p class="mudo">sem acessos · conceda por capacidade na tela Conectores</p>'}
  </section>`;
}
