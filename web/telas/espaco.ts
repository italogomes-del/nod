import type { Estado } from "../estado/reducer.ts";
import { botao, esc } from "../lib/render.ts";
import { renderInventario } from "./frota.ts";
import { renderChaves } from "./chaves.ts";

/**
 * "Seu espaço" (definido em 2026-09-18): o que é da CONTA, não de um bot. Nasceu ao derrubar o rail —
 * conexão/harness (que ocupava o topo da Frota), computadores (a antiga entrada "Chaves") e os dois
 * links de administração. É configuração: visitada raramente, por isso sai do caminho de todo dia e
 * fica atrás do rodapé da sidebar. O ambiente do banco vem junto porque também é da instância.
 */
export function renderEspaco(estado: Estado, ambiente: { regime: string; porta?: number | null } | null): string {
  const amb = ambiente
    ? `<p class="mudo">Banco desta instância: ${esc(ambiente.regime === "persistente" ? "persistente" : ambiente.regime === "efemero" ? "efêmero" : "não identificado")}${ambiente.porta ? ` · porta ${esc(String(ambiente.porta))}` : ""}.</p>`
    : "";
  return `<section class="tela tela-espaco">
    <header class="tela-cab"><h1>Seu espaço</h1></header>

    <section class="espaco-secao">
      <h2>Conexão</h2>
      <p class="intro">Quem executa o trabalho dos seus bots: a sua conta de IA ou a simulação sem custo.</p>
      ${renderInventario(estado)}
    </section>

    <section class="espaco-secao">
      <h2>Computadores</h2>
      ${renderChaves(estado, false)}
    </section>

    <section class="espaco-secao">
      <h2>Administração</h2>
      <div class="espaco-links">
        ${botao("navegar", "Marketplace e conectores", { classe: "espaco-link", dados: { tela: "conectores" } })}
        ${botao("navegar", "Gerenciar agentes", { classe: "espaco-link", dados: { tela: "gestao" } })}
        ${botao("navegar", "Relatos", { classe: "espaco-link", dados: { tela: "relatos" } })}
      </div>
      ${amb}
    </section>
  </section>`;
}
