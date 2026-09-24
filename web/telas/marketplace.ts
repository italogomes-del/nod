import type { Estado } from "../estado/reducer.ts";
import { botao, esc } from "../lib/render.ts";

/**
 * revisto em 2026-09-21 (ADR-041): app novo no painel não tem símbolo escrito à mão aqui, então o
 * logo vem do provedor PELO SERVIDOR (/api/marketplace/:slug/logo). A inicial continua desenhada
 * por baixo: é ela que aparece enquanto a imagem carrega e se a busca falhar (onerror some com a
 * <img> e descobre o span).
 */
export function logoApp(slug: string, nome: string, temLogo = false): string {
  const simbolos: Record<string, string> = { slack: "✣", github: "⌘", gmail: "M", notion: "N", linear: "◩", googlesheets: "▤", googlecalendar: "31", clickup: "⌃" };
  const inicial = esc(simbolos[slug] ?? nome.slice(0, 1).toUpperCase());
  const img = temLogo
    ? `<img src="/api/marketplace/${encodeURIComponent(slug)}/logo" alt="" loading="lazy" onerror="this.remove()" />`
    : "";
  return `<span class="app-logo app-${esc(slug)}" aria-hidden="true">${inicial}${img}</span>`;
}

/**
 * definido em 2026-09-24 (ADR-047): o GitHub conecta sozinho pelo gh desta máquina; o token pessoal
 * fica recolhido em "Avançado" para quem não tem gh. O valor nunca volta: só a marca de que existe.
 */
function avancadoGithub(temToken: boolean): string {
  return `<details class="github-avancado"><summary>Avançado: token pessoal${temToken ? " · ✓ guardado" : ""}</summary><form class="form" data-form="token-github"><label>Token do GitHub<input type="password" name="token" required autocomplete="off" placeholder="ghp_… ou github_pat_…" /></label><button class="bt" type="submit">Guardar e verificar</button></form><small>Use quando esta máquina não tem o gh logado. O token fica cifrado neste servidor e os comentários saem em nome da conta dele.</small></details>`;
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
      return `<article class="app-card${selecionado ? " selected" : ""}" data-app-busca="${esc(`${app.nome} ${app.categoria} ${app.descricao}`.toLowerCase())}" id="app-${esc(app.slug)}"><div class="app-card-heading">${logoApp(app.slug, app.nome, !!app.logo)}<span><h3>${esc(app.nome)}</h3><small>${esc(app.categoria)}</small></span>${c?.habilitado ? '<span class="connected-dot" title="Conectado">✓</span>' : ""}</div><p>${esc(app.descricao)}</p><div class="app-card-actions">${botao("conectar-composio", c?.habilitado ? "Reconectar" : c ? "Refazer conexão" : "Conectar", { id: app.slug, classe: selecionado ? "pri" : "" })}${c ? botao("verificar-composio", "Verificar conexão", { id: app.slug }) : ""}</div>${auth ? `<div class="auth-pending"><a class="bt pri" href="${esc(auth.url)}" target="_blank" rel="noopener noreferrer">Entrar no ${esc(app.nome)} ↗</a><p>Conclua o login na aba que abrir e clique em Verificar conexão.</p></div>` : ""}${c?.ultimaFalha ? '<p class="connection-error" role="status">Não foi possível acessar as ferramentas. Verifique o login e tente novamente.</p>' : ""}${c?.habilitado && selecionado && tela?.voltar ? botao("voltar-conexao", "Voltar e continuar tarefa", { classe: "pri" }) : ""}${app.slug === "github" ? avancadoGithub(c?.env.GITHUB_TOKEN === true) : ""}</article>`;
    }).join("")}</div>
    <p id="marketplace-vazio" class="mudo" hidden>Nenhum app encontrado. Tente outro nome ou conecte seu próprio MCP abaixo.</p>
    ${estado.avisoConexao ? `<p class="connection-notice" role="status">${esc(estado.avisoConexao)}</p>` : ""}`;
}
