import type { Estado } from "../estado/reducer.ts";
import { avatarAgente, botao, esc } from "../lib/render.ts";

/** Perfil do bot (E1.2, Grok Bot): editar nome/título/descrição/modelo (PATCH), Pin/Hide/Duplicate; o dono é imutável. */
export function renderPerfil(estado: Estado, agenteId: string): string {
  const a = estado.frota?.agentes.find((x) => x.id === agenteId);
  if (!a) return `<section class="tela"><p class="mudo">agente não encontrado (ou de outra pessoa)</p></section>`;
  const concessoes = estado.concessoes[agenteId] ?? [];
  const conectorNome = (id: string) => estado.conectores.find((c) => c.id === id)?.slug ?? id.slice(0, 8);
  return `<section class="tela tela-perfil">
    <header class="tela-cab">${avatarAgente(a, "lg")}<h1>${esc(a.nome)}</h1><span class="chip">${esc(a.dono === "pessoa" ? "seu" : "da empresa")} · dono imutável</span>${a.confirmado ? "" : '<span class="tag tag-ambar">perfil não confirmado</span>'}</header>
    <form class="form" data-form="editar-perfil" data-id="${esc(a.id)}">
      <label>Nome <input name="nome" value="${esc(a.nome)}" required maxlength="60" /></label>
      <label>Título <input name="titulo" value="${esc(a.titulo)}" maxlength="80" /></label>
      <label>O que faz (vai no prompt de sistema) <textarea name="descricao" rows="4">${esc(a.descricao)}</textarea></label>
      <label>Modelo <input name="modelo" value="${esc(a.modelo)}" /></label>
      <div class="acoes">
        <button class="bt pri" type="submit" data-act="salvar-perfil">Salvar</button>
        ${botao("fixar", a.fixado ? "Desafixar" : "Pin", { id: a.id })}
        ${botao("ocultar", a.oculto ? "Mostrar" : "Hide", { id: a.id })}
        ${botao("duplicar", "Duplicate", { id: a.id, titulo: "copia o perfil; nunca memória nem histórico" })}
        ${botao("ir-memoria", "Memória", { id: a.id })}
        ${botao("abrir-conversa", "Conversa", { dados: { conversa: a.conversaId, agente: a.id } })}
      </div>
    </form>
    <h3>Acessos concedidos (${concessoes.length})</h3>
    ${concessoes.length ? `<ul class="lista">${concessoes.map((c) => `<li><code>${esc(conectorNome(c.conectorId))}.${esc(c.capacidade)}</code> ${botao("revogar", "revogar", { classe: "sm", id: c.id, dados: { agente: a.id } })}</li>`).join("")}</ul>` : '<p class="mudo">sem acessos · conceda por capacidade na tela Conectores</p>'}
  </section>`;
}
