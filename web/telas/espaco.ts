import type { Estado } from "../estado/reducer.ts";
import type { EstadoAvisos } from "../lib/avisos.ts";
import { botao, esc } from "../lib/render.ts";
import { renderInventario } from "./frota.ts";
import { renderChaves } from "./chaves.ts";
import { renderNegacoes } from "./negacao.ts";

/**
 * "Seu espaço" (definido em 2026-09-18): o que é da CONTA, não de um bot. Nasceu ao derrubar o rail —
 * conexão/harness (que ocupava o topo da Frota), computadores (a antiga entrada "Chaves") e os dois
 * links de administração. É configuração: visitada raramente, por isso sai do caminho de todo dia e
 * fica atrás do rodapé da sidebar. O ambiente do banco vem junto porque também é da instância.
 * definido em 2026-09-24: sem a página inicial, as negações vivas (ADR-029: fail-closed escrito, com
 * relógio) moram aqui, junto da conexão; o conector fora do ar também aparece no painel do bot.
 */
export function renderEspaco(estado: Estado, ambiente: { regime: string; porta?: number | null } | null, avisos: EstadoAvisos): string {
  const amb = ambiente
    ? `<p class="mudo">Banco desta instância: ${esc(ambiente.regime === "persistente" ? "persistente" : ambiente.regime === "efemero" ? "efêmero" : "não identificado")}${ambiente.porta ? ` · porta ${esc(String(ambiente.porta))}` : ""}.</p>`
    : "";
  return `<section class="tela tela-espaco">
    <header class="tela-cab"><h1>Seu espaço</h1></header>

    <section class="espaco-secao">
      <h2>Conexão</h2>
      <p class="intro">Quem executa o trabalho dos seus bots: a sua conta de IA ou a simulação sem custo.</p>
      ${renderInventario(estado)}
      ${renderNegacoes([...(estado.frota?.negacoes ?? []), ...estado.negacoes.filter((n) => n.classe !== "conector_indisponivel")], estado.agora)}
    </section>

    ${renderAvisos(avisos)}

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

const SITUACAO: Record<EstadoAvisos["onde"], Record<EstadoAvisos["situacao"], string>> = {
  mac: {
    ligados: "Ligados",
    desligados: "Desligados",
    bloqueados: "Bloqueados pelo macOS: libere em Ajustes do Sistema → Notificações → nod",
    indisponiveis: "Este Mac não mostra avisos do nod.",
  },
  navegador: {
    ligados: "Ligados",
    desligados: "Desligados",
    bloqueados: "Bloqueados pelo navegador: libere as notificações deste site nos ajustes do navegador.",
    indisponiveis: "Este navegador não mostra avisos.",
  },
};

/**
 * definido em 2026-09-24 ("aviso no Mac"): o interruptor dos avisos e as regras dele em palavras, para
 * a pessoa saber quando o nod vai (e não vai) chamá-la. No app, liga "Avisos no Mac" (o mesmo item do
 * menu); no navegador, pede a permissão no clique. Bloqueado no navegador, o clique não resolve — o
 * interruptor fica desligado e a linha diz onde liberar.
 */
export function renderAvisos(a: EstadoAvisos): string {
  const ligado = a.situacao === "ligados" || (a.onde === "mac" && a.situacao === "bloqueados");
  const travado = a.situacao === "indisponiveis" || (a.onde === "navegador" && a.situacao === "bloqueados");
  const numero = a.onde === "mac" ? "O número no ícone do Dock mostra quantos pedidos estão abertos." : "O título da aba mostra quantos pedidos estão abertos.";
  return `<section class="espaco-secao espaco-avisos">
      <h2>Avisos</h2>
      <div class="avisos-linha">
        <button type="button" class="avisos-interruptor" data-act="alternar-avisos" role="switch" aria-checked="${ligado ? "true" : "false"}"${travado ? " disabled" : ""}><span class="avisos-trilho" aria-hidden="true"></span><span>Avisar quando algo precisar de você</span></button>
        <span class="avisos-situacao situacao-${esc(a.situacao)}" role="status">${esc(SITUACAO[a.onde][a.situacao])}</span>
      </div>
      <ul class="avisos-regras">
        <li>Só quando o nod não está na frente: com ele aberto, o pedido já aparece na tela.</li>
        <li>No máximo um aviso por minuto; pedidos que chegam juntos viram um aviso só.</li>
        <li>Nunca para quedas que se resolvem sozinhas, como o Mac sem contato, nem para pedidos vencidos.</li>
        <li>${numero}</li>
      </ul>
    </section>`;
}
