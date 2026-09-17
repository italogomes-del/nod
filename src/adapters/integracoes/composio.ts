import { ErroDeDominio } from "../../domain/erro.ts";

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
