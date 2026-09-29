import { COMPOSIO_POR_CAPACIDADE_GITHUB } from "../../contracts/github.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import type { ArgsGithub } from "../../domain/github.ts";
import type { AppGerenciado } from "../../domain/catalogo-marketplace.ts";

export type ChamadaComposio = { slug: string; argumentos: Record<string, unknown> };

/** A tabela capacidade → GITHUB_* mora em src/contracts/github.ts (a migração dos acessos antigos também a lê). */
export const GITHUB_PELO_COMPOSIO = COMPOSIO_POR_CAPACIDADE_GITHUB;

/** As chamadas ao Composio de uma capacidade já validada pelo domínio; null = indisponível neste jeito. */
export function chamadasComposioGithub(a: ArgsGithub): ChamadaComposio[] | null {
  const repo = { owner: a.alvo.dono, repo: a.alvo.repo };
  switch (a.capacidade) {
    case "pr_ver":
      return [{ slug: "GITHUB_GET_A_PULL_REQUEST", argumentos: { ...repo, pull_number: a.numero } }];
    case "pr_arquivos":
      return [{ slug: "GITHUB_LIST_PULL_REQUESTS_FILES", argumentos: { ...repo, pull_number: a.numero, per_page: 100 } }];
    case "pr_comentarios":
      return [
        { slug: "GITHUB_LIST_ISSUE_COMMENTS", argumentos: { ...repo, issue_number: a.numero, per_page: 100 } },
        { slug: "GITHUB_LIST_REVIEW_COMMENTS_ON_A_PULL_REQUEST", argumentos: { ...repo, pull_number: a.numero, per_page: 100 } },
      ];
    case "arquivo_ler":
      return [{ slug: "GITHUB_GET_REPOSITORY_CONTENT", argumentos: { ...repo, path: a.caminho, ...(a.ref ? { ref: a.ref } : {}) } }];
    case "issue_ver":
      return [{ slug: "GITHUB_GET_AN_ISSUE", argumentos: { ...repo, issue_number: a.numero } }];
    case "pr_comentar":
      return [{ slug: "GITHUB_CREATE_AN_ISSUE_COMMENT", argumentos: { ...repo, issue_number: a.numero, body: a.texto } }];
    case "pr_revisar":
      return [{ slug: "GITHUB_CREATE_A_REVIEW_FOR_A_PULL_REQUEST", argumentos: { ...repo, pull_number: a.numero, event: a.evento === "approve" ? "APPROVE" : a.evento === "request_changes" ? "REQUEST_CHANGES" : "COMMENT", ...(a.texto ? { body: a.texto } : {}) } }];
    case "pr_diff":
    case "pr_checks":
      return null;
  }
}

function urlDoProvedor(valor: string, hosts: string[]): URL {
  let url: URL;
  try { url = new URL(valor); } catch { throw new ErroDeDominio("conector_indisponivel"); }
  if (url.protocol !== "https:" || !hosts.includes(url.hostname) || url.username || url.password || url.port) throw new ErroDeDominio("conector_indisponivel");
  return url;
}

const BASE = "https://backend.composio.dev/api/v3.1";

const HOSTS_LOGO = ["logos.composio.dev", "assets.composio.dev", "cdn.composio.dev"];

/** O logo só passa com host da allowlist: o servidor é quem busca a imagem (ADR-041 §6). */
function logoDoProvedor(bruto: unknown): string | null {
  if (typeof bruto !== "string") return null;
  try { return urlDoProvedor(bruto, HOSTS_LOGO).href; } catch { return null; }
}

/**
 * definido em 2026-09-29 (ADR-057): o `GET /toolkits` devolve até 1000 por página, e o catálogo
 * público tinha 312 toolkits na documentação do provedor. Cinco páginas são folga, não expectativa: o
 * teto existe para um `next_cursor` que nunca acaba não virar laço.
 */
const PAGINAS_TOOLKITS = 5;

/** definido em 2026-09-17: URLs e erros do provedor nunca transportam a chave para a web ou para o modelo. */
export function criarClienteComposio(chave: string, f: typeof fetch = fetch) {
  async function pedir(path: string, body?: unknown): Promise<Record<string, unknown>> {
    try {
      const r = await f(`${BASE}${path}`, { method: body ? "POST" : "GET", headers: { "x-api-key": chave, "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15_000), redirect: "error" });
      if (!r.ok) throw new ErroDeDominio(r.status === 401 || r.status === 403 ? "integracao_autenticacao" : "conector_indisponivel");
      const data: unknown = await r.json();
      if (!data || typeof data !== "object" || Array.isArray(data)) throw new ErroDeDominio("conector_indisponivel");
      return data as Record<string, unknown>;
    } catch (e) {
      if (e instanceof ErroDeDominio) throw e;
      throw new ErroDeDominio("conector_indisponivel");
    }
  }
  return {
    validar: () => pedir("/toolkits?limit=1"),
    /**
     * ADR-041: o catálogo exibido é o que a pessoa configurou no painel (auth configs), não o
     * catálogo público de toolkits. A forma do envelope e o nome do campo do logo não estão
     * fixados no contrato do provedor, então lemos as variações conhecidas e o que não casar cai
     * fora em silêncio — catálogo incompleto degrada para o piso curado, nunca derruba a tela.
     */
    async catalogo(): Promise<{ slug: string; nome: string; logo: string | null }[]> {
      const r = await pedir("/auth_configs");
      const itens = (r.items ?? r.data ?? r.auth_configs) as unknown;
      if (!Array.isArray(itens)) throw new ErroDeDominio("conector_indisponivel");
      const porSlug = new Map<string, { slug: string; nome: string; logo: string | null }>();
      for (const it of itens) {
        if (!it || typeof it !== "object") continue;
        const o = it as Record<string, unknown>;
        const tk = o.toolkit as Record<string, unknown> | string | undefined;
        const slug = (typeof tk === "string" ? tk : typeof tk?.slug === "string" ? tk.slug : null)?.toLowerCase();
        if (!slug || !/^[a-z0-9_-]{1,64}$/.test(slug)) continue;
        if (o.status === "DISABLED" || o.deleted === true) continue;
        const meta = (tk && typeof tk === "object" ? tk : {}) as Record<string, unknown>;
        const logo = logoDoProvedor(meta.logo ?? (meta.meta as Record<string, unknown> | undefined)?.logo ?? o.logo);
        const nome = typeof meta.name === "string" ? meta.name : slug;
        if (!porSlug.has(slug)) porSlug.set(slug, { slug, nome, logo });
        else if (logo && !porSlug.get(slug)!.logo) porSlug.get(slug)!.logo = logo;
      }
      return [...porSlug.values()];
    },
    /**
     * ADR-057: o catálogo público, só o que o Composio conecta sem auth config no painel — o toolkit
     * com login gerenciado por ele (`composio_managed_auth_schemes` não vazio). Ficam de fora o que
     * não tem login a fazer (`no_auth`: conectar aqui termina numa conta conectada, que ele não tem),
     * o toolkit local e o customizado do projeto (esse, com auth config, já vem do `catalogo()`).
     */
    async gerenciados(): Promise<AppGerenciado[]> {
      const porSlug = new Map<string, AppGerenciado>();
      let cursor: string | null = null;
      for (let pagina = 0; pagina < PAGINAS_TOOLKITS; pagina++) {
        const r = await pedir(`/toolkits?limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        if (!Array.isArray(r.items)) throw new ErroDeDominio("conector_indisponivel");
        for (const it of r.items as unknown[]) {
          if (!it || typeof it !== "object") continue;
          const o = it as Record<string, unknown>;
          const slug = typeof o.slug === "string" ? o.slug.toLowerCase() : null;
          if (!slug || !/^[a-z0-9_-]{1,64}$/.test(slug) || porSlug.has(slug)) continue;
          const gerenciado = Array.isArray(o.composio_managed_auth_schemes) && o.composio_managed_auth_schemes.length > 0;
          if (!gerenciado || o.no_auth === true || o.is_local_toolkit === true || o.type === "custom") continue;
          const meta = (o.meta && typeof o.meta === "object" ? o.meta : {}) as Record<string, unknown>;
          const categorias = (Array.isArray(meta.categories) ? meta.categories as unknown[] : [])
            .map((c) => typeof c === "string" ? c : c && typeof c === "object" ? (c as Record<string, unknown>).name : null)
            .filter((c): c is string => typeof c === "string" && c.length > 0);
          porSlug.set(slug, {
            slug,
            nome: typeof o.name === "string" && o.name.trim() ? o.name.trim() : slug,
            logo: logoDoProvedor(meta.logo),
            descricao: typeof meta.description === "string" ? meta.description : "",
            categorias,
          });
        }
        cursor = typeof r.next_cursor === "string" && r.next_cursor ? r.next_cursor : null;
        if (!cursor) break;
      }
      return [...porSlug.values()];
    },
    async criarSessao(userId: string, toolkit: string) {
      const r = await pedir("/tool_router/session", {
        user_id: userId, toolkits: { enable: [toolkit] }, preload: { tools: "all" },
        manage_connections: { enable: false }, workbench: { enable: false, enable_proxy_execution: false },
        search: { enable: false }, execute: { enable_multi_execute: false },
      });
      const mcp = r.mcp as { url?: unknown } | undefined;
      if (typeof r.session_id !== "string" || !/^[A-Za-z0-9_-]+$/.test(r.session_id) || typeof mcp?.url !== "string") throw new ErroDeDominio("conector_indisponivel");
      const url = urlDoProvedor(mcp.url, ["app.composio.dev", "backend.composio.dev"]);
      return { id: r.session_id, url: url.href };
    },
    async autorizar(sessaoId: string, toolkit: string) {
      const r = await pedir(`/tool_router/session/${encodeURIComponent(sessaoId)}/link`, { toolkit });
      if (typeof r.redirect_url !== "string" || typeof r.connected_account_id !== "string") throw new ErroDeDominio("conector_indisponivel");
      const url = urlDoProvedor(r.redirect_url, ["app.composio.dev", "connect.composio.dev", "backend.composio.dev"]);
      return { url: url.href, contaId: r.connected_account_id };
    },
    async conectado(contaId: string, userId: string, toolkit: string) {
      const r = await pedir(`/connected_accounts/${encodeURIComponent(contaId)}`);
      const t = r.toolkit as { slug?: unknown } | undefined;
      return r.status === "ACTIVE" && r.is_disabled !== true && r.user_id === userId && t?.slug === toolkit;
    },
    async fixarConta(sessaoId: string, toolkit: string, contaId: string) {
      try {
        const r = await f(`${BASE}/tool_router/session/${encodeURIComponent(sessaoId)}`, { method: "PATCH", headers: { "x-api-key": chave, "content-type": "application/json" }, body: JSON.stringify({ connected_accounts: { [toolkit]: [contaId] } }), signal: AbortSignal.timeout(15_000), redirect: "error" });
        if (!r.ok) throw new ErroDeDominio("conector_indisponivel");
      } catch { throw new ErroDeDominio("conector_indisponivel"); }
    },
  };
}
