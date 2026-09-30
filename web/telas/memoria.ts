import type { Estado } from "../estado/reducer.ts";
import { botao, esc, hora } from "../lib/render.ts";

/**
 * Memória do bot (Grok Bot): lista editável por tipo; injetada no prompt com "não substitui fonte autoritativa".
 * definido em 2026-09-30 (canvas "Menu, sidebar e gaveta"): um nível da gaveta do bot, não mais uma tela — anotar em
 * cima, cada memória num cartão com o tipo, o texto e de quem veio.
 */
export function renderMemoriaNaGaveta(estado: Estado, agenteId: string): string {
  const memorias = estado.memorias[agenteId];
  const tipos = (atual?: string) => `<option value="preferencia"${atual === "preferencia" ? " selected" : ""}>preferência</option><option value="fato"${atual === "fato" ? " selected" : ""}>fato</option><option value="resumo"${atual === "resumo" ? " selected" : ""}>resumo</option>`;
  const linhas = (memorias ?? [])
    .map(
      (m) => `<li class="gv-memoria" data-memoria="${esc(m.id)}">
        <div class="gv-memoria-cab"><select data-campo="tipo" aria-label="Tipo da memória">${tipos(m.tipo)}</select><span class="mudo">${esc(m.origem === "agente" ? "anotada pelo bot" : "escrita por você")} · ${hora(m.criadoEm)}</span></div>
        <input data-campo="texto" value="${esc(m.texto)}" aria-label="Texto da memória" />
        <div class="dr-acoes">${botao("salvar-memoria", "Salvar", { classe: "link sm", id: m.id, dados: { agente: agenteId } })}${botao("apagar-memoria", "Apagar", { classe: "link sm perigo", id: m.id, dados: { agente: agenteId } })}</div>
      </li>`,
    )
    .join("");
  return `<p class="mudo gv-nota">O que está aqui entra no prompt do bot como memória. Não substitui a fonte: se um dado importa, confira na origem.</p>
    <form class="gv-anotar" data-form="criar-memoria" data-id="${esc(agenteId)}">
      <select name="tipo" aria-label="Tipo">${tipos("fato")}</select>
      <input name="texto" placeholder="Uma frase para lembrar" required maxlength="500" aria-label="Nova memória" />
      <button class="gv-bt pri" type="submit">Anotar</button>
    </form>
    ${memorias === undefined ? '<p class="mudo">carregando…</p>' : memorias.length ? `<ul class="gv-memorias">${linhas}</ul>` : '<p class="mudo">Nenhuma memória ainda. O bot anota pelo <code>lembrar</code>; você também pode escrever aqui.</p>'}`;
}
