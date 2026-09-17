import type { Estado } from "../estado/reducer.ts";
import { botao, esc } from "../lib/render.ts";

export function logoApp(slug: string, nome: string): string {
  const simbolos: Record<string, string> = { slack: "✣", github: "⌘", gmail: "M", notion: "N", linear: "◩", googlesheets: "▤", googlecalendar: "31", clickup: "⌃" };
  return `<span class="app-logo app-${esc(slug)}" aria-hidden="true">${esc(simbolos[slug] ?? nome.slice(0, 1))}</span>`;
}

export function renderMarketplace(estado: Estado): string {
  const tela = estado.tela.tipo === "conectores" ? estado.tela : null;
  const instalados = estado.conectores.filter((c) => c.habilitado).length;
  const retorno = tela?.voltar ? botao("voltar-conexao", "← Voltar para a conversa", { classe: "link" }) : "";
  return `<div class="marketplace-hero">${retorno}<div class="marketplace-title"><div><span class="eyebrow">MAIS POSSIBILIDADES PARA SEUS BOTS</span><h1>Marketplace</h1></div><span class="chip">${instalados} ${instalados === 1 ? "conectado" : "conectados"}</span></div><p class="intro">Seus apps, trabalhando com você. Conecte uma vez e escolha o que cada bot pode fazer.</p>
    <label class="search marketplace-search"><span>⌕</span><input id="busca-marketplace" aria-label="Buscar apps e ferramentas" placeholder="Buscar apps e ferramentas" /></label></div>
    <details class="composio-setup"${estado.composioConfigurado ? "" : " open"}><summary>${estado.composioConfigurado ? "✓ Composio configurado · alterar chave" : "Comece conectando seu Composio"}</summary><p>Adicione a chave do seu projeto uma vez. Depois, entre nos apps pelo navegador.</p><form class="form composio-form" data-form="configurar-composio"><label>Chave do projeto<input type="password" name="chave" required autocomplete="off" placeholder="Cole sua chave Composio" /></label><button class="bt pri" type="submit">Salvar e verificar</button></form><a href="https://platform.composio.dev" target="_blank" rel="noopener noreferrer">Abrir Composio ↗</a><small>A chave fica cifrada neste servidor. O Composio gerencia os logins dos apps.</small></details>
    <h2 class="marketplace-heading">Para o seu dia a dia</h2>
    <div class="apps-grid">${estado.marketplace.map((app) => {
      const c = estado.conectores.find((c) => c.slug === app.slug && c.ownerId === estado.sessao?.pessoaId);
      const selecionado = tela?.app === app.slug;
      const auth = estado.autorizacaoApp?.slug === app.slug ? estado.autorizacaoApp : null;
      return `<article class="app-card${selecionado ? " selected" : ""}" data-app-busca="${esc(`${app.nome} ${app.categoria} ${app.descricao}`.toLowerCase())}" id="app-${esc(app.slug)}"><div class="app-card-heading">${logoApp(app.slug, app.nome)}<span><h3>${esc(app.nome)}</h3><small>${esc(app.categoria)}</small></span>${c?.habilitado ? '<span class="connected-dot" title="Conectado">✓</span>' : ""}</div><p>${esc(app.descricao)}</p><div class="app-card-actions">${botao("conectar-composio", c?.habilitado ? "Reconectar" : c ? "Refazer conexão" : "Conectar", { id: app.slug, classe: selecionado ? "pri" : "" })}${c ? botao("verificar-composio", "Verificar conexão", { id: app.slug }) : ""}</div>${auth ? `<div class="auth-pending"><a class="bt pri" href="${esc(auth.url)}" target="_blank" rel="noopener noreferrer">Entrar no ${esc(app.nome)} ↗</a><p>Conclua o login na aba que abrir e clique em Verificar conexão.</p></div>` : ""}${c?.ultimaFalha ? '<p class="connection-error" role="status">Não foi possível acessar as ferramentas. Verifique o login e tente novamente.</p>' : ""}${c?.habilitado && selecionado && tela?.voltar ? botao("voltar-conexao", "Voltar e continuar tarefa", { classe: "pri" }) : ""}</article>`;
    }).join("")}</div>
    <p id="marketplace-vazio" class="mudo" hidden>Nenhum app encontrado. Tente outro nome ou conecte seu próprio MCP abaixo.</p>
    ${estado.avisoConexao ? `<p class="connection-notice" role="status">${esc(estado.avisoConexao)}</p>` : ""}`;
}
