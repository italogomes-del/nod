import type { Estado } from "../estado/reducer.ts";
import { botao, esc, hora } from "../lib/render.ts";
import { haQuanto } from "../lib/relogio.ts";

/**
 * Minhas chaves (E1.3, ADR-031): cada computador da pessoa recebe uma chave própria. A chave crua é
 * mostrada UMA vez, logo após gerar; depois só aparece o final dela ("…a1b2c3d4"). Gerar outra NÃO
 * cancela as antigas — por isso o Cancelar fica ao lado de cada uma.
 */
export function renderChaves(estado: Estado): string {
  const emitida = estado.chaveEmitida
    ? `<div class="chave-emitida" role="status">
        <p><b>Chave do computador "${esc(estado.chaveEmitida.dados.nome)}"</b> — copie agora. Ela <b>não será mostrada de novo</b>: o nod guarda só uma impressão digital dela.</p>
        <code class="chave-crua">${esc(estado.chaveEmitida.chave)}</code>
        <div class="acoes">${botao("fechar-chave-emitida", "Já copiei", { classe: "sm" })}</div>
      </div>`
    : "";

  const chaves = estado.chaves;
  const lista =
    chaves === null
      ? '<p class="mudo">carregando…</p>'
      : chaves.length === 0
        ? '<p class="mudo">Nenhuma chave ainda. Gere uma para cada computador que vai trabalhar pelo nod.</p>'
        : `<ul class="lista chaves">${chaves
            .map((c) => {
              const uso = c.ultimoUsoEm ? `usada ${haQuanto(estado.agora - c.ultimoUsoEm)}` : "nunca usada";
              const situacao = c.revogadaEm
                ? `<span class="tag tag-cinza">cancelada ${hora(c.revogadaEm)}</span>`
                : `<span class="tag tag-ok">ativa</span> ${botao("revogar-chave", "Cancelar", { classe: "sm", id: c.id, dados: { nome: c.nome }, titulo: "a chave para de funcionar na hora" })}`;
              return `<li data-chave="${esc(c.id)}"><b>${esc(c.nome)}</b> <code>…${esc(c.prefixo)}</code> <span class="mudo">criada ${hora(c.criadaEm)} · ${esc(uso)}</span> ${situacao}</li>`;
            })
            .join("")}</ul>`;

  return `<section class="tela tela-chaves">
    <header class="tela-cab"><h1>Minhas chaves</h1></header>
    <p class="mudo">Uma chave por computador. Perdeu ou trocou de computador? Cancele a chave dele aqui e gere outra.</p>
    ${emitida}
    <form class="form linha" data-form="emitir-chave">
      <label>Nome do computador <input name="nome" required maxlength="60" placeholder="ex.: MacBook do trabalho" /></label>
      <button class="bt pri" type="submit">Gerar chave</button>
    </form>
    ${lista}
  </section>`;
}
