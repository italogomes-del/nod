import type { NomeCapacidadeGithub } from "../../contracts/github.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import type { ArgsGithub } from "../../domain/github.ts";

export type ChamadaComposio = { slug: string; argumentos: Record<string, unknown> };

/**
 * definido em 2026-09-24 (ADR-047): as capacidades estáveis do conector `github` → ferramentas
 * GITHUB_* do Composio. Slugs e parâmetros conferidos em https://docs.composio.dev/toolkits/github.md
 * no mesmo dia (GITHUB_GET_A_PULL_REQUEST, GITHUB_LIST_PULL_REQUESTS_FILES, GITHUB_LIST_ISSUE_COMMENTS,
 * GITHUB_LIST_REVIEW_COMMENTS_ON_A_PULL_REQUEST, GITHUB_GET_REPOSITORY_CONTENT, GITHUB_GET_AN_ISSUE,
 * GITHUB_CREATE_AN_ISSUE_COMMENT, GITHUB_CREATE_A_REVIEW_FOR_A_PULL_REQUEST). `null` = sem par:
 * o diff unificado não existe lá, e os checks pediriam o SHA do head lido de um `data` em texto
 * livre — aparecem como indisponíveis neste jeito, em vez de adivinhados.
 */
export const GITHUB_PELO_COMPOSIO: Readonly<Record<NomeCapacidadeGithub, readonly string[] | null>> = {
  pr_ver: ["GITHUB_GET_A_PULL_REQUEST"],
  pr_diff: null,
  pr_arquivos: ["GITHUB_LIST_PULL_REQUESTS_FILES"],
  pr_comentarios: ["GITHUB_LIST_ISSUE_COMMENTS", "GITHUB_LIST_REVIEW_COMMENTS_ON_A_PULL_REQUEST"],
  pr_checks: null,
  arquivo_ler: ["GITHUB_GET_REPOSITORY_CONTENT"],
  issue_ver: ["GITHUB_GET_AN_ISSUE"],
  pr_comentar: ["GITHUB_CREATE_AN_ISSUE_COMMENT"],
  pr_revisar: ["GITHUB_CREATE_A_REVIEW_FOR_A_PULL_REQUEST"],
};

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
        const logoBruto = meta.logo ?? (meta.meta as Record<string, unknown> | undefined)?.logo ?? o.logo;
        let logo: string | null = null;
        if (typeof logoBruto === "string") {
          try { logo = urlDoProvedor(logoBruto, ["logos.composio.dev", "assets.composio.dev", "cdn.composio.dev"]).href; } catch { logo = null; }
        }
        const nome = typeof meta.name === "string" ? meta.name : slug;
        if (!porSlug.has(slug)) porSlug.set(slug, { slug, nome, logo });
        else if (logo && !porSlug.get(slug)!.logo) porSlug.get(slug)!.logo = logo;
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
