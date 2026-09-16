import type { Estado } from "../estado/reducer.ts";
import { avatarAgente, botao, esc, hora } from "../lib/render.ts";

/** Memória do bot (Grok Bot): lista editável por tipo; injetada no prompt com "não substitui fonte autoritativa". */
export function renderMemoria(estado: Estado, agenteId: string): string {
  const a = estado.frota?.agentes.find((x) => x.id === agenteId);
  const memorias = estado.memorias[agenteId];
  const linhas = (memorias ?? [])
    .map(
      (m) => `<li class="memoria" data-memoria="${esc(m.id)}">
        <select data-campo="tipo"><option value="preferencia"${m.tipo === "preferencia" ? " selected" : ""}>preferência</option><option value="fato"${m.tipo === "fato" ? " selected" : ""}>fato</option><option value="resumo"${m.tipo === "resumo" ? " selected" : ""}>resumo</option></select>
        <input data-campo="texto" value="${esc(m.texto)}" />
        <span class="mudo">${esc(m.origem === "agente" ? "anotada pelo bot" : "escrita por você")} · ${hora(m.criadoEm)}</span>
        ${botao("salvar-memoria", "salvar", { classe: "sm", id: m.id, dados: { agente: agenteId } })}
        ${botao("apagar-memoria", "apagar", { classe: "sm perigo", id: m.id, dados: { agente: agenteId } })}
      </li>`,
    )
    .join("");
  return `<section class="tela tela-memoria">
    <header class="tela-cab">${a ? avatarAgente(a, "lg") : ""}<h1>Memória de ${esc(a?.nome ?? "agente")}</h1><span class="chip">não substitui fonte autoritativa</span></header>
    <p class="mudo">O que está aqui entra no prompt de sistema do bot como memória — se um dado importa, confira na origem.</p>
    <form class="form linha" data-form="criar-memoria" data-id="${esc(agenteId)}">
      <select name="tipo"><option value="preferencia">preferência</option><option value="fato">fato</option><option value="resumo">resumo</option></select>
      <input name="texto" placeholder="uma frase" required maxlength="500" />
      <button class="bt pri" type="submit" data-act="criar-memoria">Anotar</button>
    </form>
    ${memorias === undefined ? '<p class="mudo">carregando…</p>' : memorias.length ? `<ul class="lista">${linhas}</ul>` : '<p class="mudo">Nenhuma memória ainda. O bot anota pelo `lembrar`; você também pode escrever aqui.</p>'}
  </section>`;
}
