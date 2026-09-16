/**
 * Cliente HTTP das rotas internas do nod (EMENDA 6): /api/interno/… com `Authorization: Bearer
 * <token de turno>`. Usado pelo proxy MCP (L5, importa por caminho) e pelo driver catcher (in-process,
 * sem processo filho). Nunca manda `Origin` (o roteador responde 403 antes do token) e nunca manda
 * 'remetente' no corpo: a identidade é a do token (ADR-024).
 *
 * Forma das rotas (tabela ROTAS em src/contracts/api.ts; handlers da L5):
 *   GET  /api/interno/plano                        → PlanoTurno do token
 *   POST /api/interno/ferramentas/:nome {args}     → {conteudo: string; isError: boolean}
 *   GET  /api/interno/decisoes/:id/aguardar        → decisão (long-poll de LONGPOLL_APROVACAO_MS)
 * Resposta fora de 2xx vira {isError:true} com o corpo seguro do servidor (código fechado, ADR-002).
 */
export type RespostaNod = { status: number; corpo: unknown };

export type RespostaFerramenta = { conteudo: string; isError: boolean };

export type ClienteNod = {
  plano(): Promise<RespostaNod>;
  chamarFerramenta(nome: string, args: Record<string, unknown>): Promise<RespostaFerramenta>;
  aguardarDecisao(decisaoId: string): Promise<RespostaNod>;
};

export type LigacaoNod = {
  url: string;
  token: string;
  fetchImpl?: typeof fetch;
  /** definido em 2026-09-16: 30 s para chamadas curtas; `aguardarDecisao` usa o dobro do long-poll do servidor (20 s). */
  timeoutMs?: number;
};

function obj(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function criarClienteNod(l: LigacaoNod): ClienteNod {
  const fetchImpl = l.fetchImpl ?? fetch;
  const base = l.url.replace(/\/+$/, "");
  const timeoutMs = l.timeoutMs ?? 30_000;

  async function pedir(metodo: "GET" | "POST", caminho: string, corpo?: unknown, timeout = timeoutMs): Promise<RespostaNod> {
    const r = await fetchImpl(`${base}/api/interno/${caminho.replace(/^\//, "")}`, {
      method: metodo,
      headers: { authorization: `Bearer ${l.token}`, "content-type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(timeout),
    });
    const texto = await r.text();
    let lido: unknown = texto;
    try {
      lido = texto === "" ? null : JSON.parse(texto);
    } catch {
      lido = texto;
    }
    return { status: r.status, corpo: lido };
  }

  return {
    plano: () => pedir("GET", "plano"),
    async chamarFerramenta(nome, args) {
      const r = await pedir("POST", `ferramentas/${encodeURIComponent(nome)}`, { args });
      const c = obj(r.corpo);
      if (r.status >= 200 && r.status < 300) {
        if (c && typeof c["conteudo"] === "string") return { conteudo: c["conteudo"], isError: c["isError"] === true };
        return { conteudo: typeof r.corpo === "string" ? r.corpo : JSON.stringify(r.corpo), isError: false };
      }
      return { conteudo: typeof r.corpo === "string" ? r.corpo : JSON.stringify(r.corpo), isError: true };
    },
    aguardarDecisao: (decisaoId) => pedir("GET", `decisoes/${encodeURIComponent(decisaoId)}/aguardar`, undefined, Math.max(timeoutMs, 40_000)),
  };
}
