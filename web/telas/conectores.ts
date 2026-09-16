import type { Estado } from "../estado/reducer.ts";
import { avatarAgente, botao, esc, hora } from "../lib/render.ts";
import { haQuanto } from "../lib/relogio.ts";

/**
 * Conectores (E6, ADR-013/015): registrar (nasce desabilitado; env fica cifrado no servidor e a web
 * só vê chaves → true), sondar (catálogo com readOnlyHint), habilitar/desabilitar e conceder POR BOT
 * E POR CAPACIDADE — a concessão nasce com a mensagem de consentimento na conversa do bot.
 */
export function renderConectores(estado: Estado): string {
  const agentes = estado.frota?.agentes ?? [];
  const cartoes = estado.conectores
    .map((c) => {
      const falha = c.ultimaFalha ? `<div class="negacao negacao-conector_indisponivel">conector ${esc(c.slug)} indisponível: ${esc(c.ultimaFalha.motivo.replaceAll("_", " "))} desde ${hora(c.ultimaFalha.em)} (${haQuanto(estado.agora - c.ultimaFalha.em)})</div>` : "";
      const catalogo = c.catalogo.length
        ? `<ul class="catalogo">${c.catalogo.map((cap) => `<li><code>${esc(cap.nome)}</code> <span class="tag ${cap.readOnlyHint ? "tag-cinza" : "tag-ambar"}">${cap.readOnlyHint ? "só leitura" : "efeito externo"}</span> <span class="mudo">${esc(cap.descricao)}</span></li>`).join("")}</ul>`
        : '<p class="mudo">catálogo vazio — sonde para descobrir as ferramentas</p>';
      const conceder = c.catalogo.length && agentes.length
        ? `<form class="form linha" data-form="conceder" data-id="${esc(c.id)}">
            <select name="agenteId">${agentes.map((a) => `<option value="${esc(a.id)}">${esc(a.nome)}</option>`).join("")}</select>
            <select name="capacidade">${c.catalogo.map((cap) => `<option value="${esc(cap.nome)}">${esc(cap.nome)}</option>`).join("")}</select>
            <button class="bt pri" type="submit" data-act="conceder">Conceder</button>
          </form>`
        : "";
      const concedidas = agentes
        .flatMap((a) => (estado.concessoes[a.id] ?? []).filter((g) => g.conectorId === c.id).map((g) => `<li>${avatarAgente(a, "sm")} ${esc(a.nome)} · <code>${esc(g.capacidade)}</code> ${botao("revogar", "revogar", { classe: "sm", id: g.id, dados: { agente: a.id } })}</li>`))
        .join("");
      return `<li class="conector" data-conector="${esc(c.id)}">
        <div class="cn-cab"><b>${esc(c.nome)}</b> <code>${esc(c.slug)}</code> <span class="tag">${esc(c.transporte)}</span> <span class="tag ${c.habilitado ? "tag-ok" : "tag-cinza"}">${c.habilitado ? "habilitado" : "desabilitado"}</span> <span class="tag ${c.declaracao === "nao-toca" ? "tag-cinza" : "tag-ambar"}">${esc(c.declaracao === "nao-toca" ? "não toca dado de aprendiz" : c.declaracao === "toca" ? "toca dado de aprendiz" : "não declarou = toca")}</span>${c.sondadoEm ? `<span class="mudo">sondado ${hora(c.sondadoEm)}</span>` : ""}</div>
        <div class="mudo">${esc(c.transporte === "stdio" ? `${c.comando ?? ""} ${c.args.join(" ")}` : (c.url ?? ""))} · env: ${esc(Object.keys(c.env).join(", ") || "—")} (valores só no servidor)</div>
        ${falha}
        ${catalogo}
        <div class="acoes">${botao("sondar-conector", "Sondar", { id: c.id })}${c.habilitado ? botao("desabilitar-conector", "Desabilitar", { id: c.id }) : botao("habilitar-conector", "Habilitar", { id: c.id, titulo: "exige catálogo sondado" })}</div>
        ${conceder}
        ${concedidas ? `<ul class="lista">${concedidas}</ul>` : ""}
      </li>`;
    })
    .join("");
  return `<section class="tela tela-conectores">
    <header class="tela-cab"><h1>Conectores</h1><span class="chip">servidores MCP registrados por você</span></header>
    <details class="registrar"><summary>Registrar conector</summary>
      <form class="form" data-form="registrar-conector">
        <label>Nome <input name="nome" required placeholder="Exemplo" /></label>
        <label>Slug <input name="slug" required pattern="[a-z0-9][a-z0-9-]*" placeholder="exemplo" /></label>
        <label>Transporte <select name="transporte"><option value="stdio">stdio</option><option value="http">http</option></select></label>
        <label>Comando (stdio) <input name="comando" placeholder="node" /></label>
        <label>Args (um por linha) <textarea name="args" rows="2" placeholder="scripts/mcp-exemplo.mjs"></textarea></label>
        <label>URL (http) <input name="url" placeholder="http://127.0.0.1:1234/mcp" /></label>
        <label>Env (JSON; fica cifrado no servidor) <textarea name="env" rows="2" placeholder='{"TOKEN":"…"}'></textarea></label>
        <label>Declaração <select name="declaracao"><option value="nao-toca">não toca dado de aprendiz</option><option value="toca">toca dado de aprendiz</option><option value="nao-declarou">não declaro (= toca)</option></select></label>
        <button class="bt pri" type="submit" data-act="registrar-conector">Registrar (nasce desabilitado)</button>
      </form>
    </details>
    ${estado.conectores.length ? `<ul class="lista">${cartoes}</ul>` : '<p class="mudo">Nenhum conector. Registre um servidor MCP — o de exemplo do repositório é <code>node scripts/mcp-exemplo.mjs</code>.</p>'}
  </section>`;
}
