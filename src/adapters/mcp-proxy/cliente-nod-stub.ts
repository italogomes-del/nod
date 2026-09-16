import type { Confianca } from "../../contracts/mensagem.ts";
import type { Negacao } from "../../contracts/negacao.ts";
import type { DesfechoItem } from "../../contracts/motivos.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";

/**
 * STUB do cliente HTTP das rotas internas (EMENDA 6: o arquivo definitivo é
 * src/adapters/executor/cliente-nod.ts, da L4; ele não existia neste worktree — ver
 * PENDENCIA-CONTRATO.md). O proxy fala com o servidor SÓ por aqui, com o Bearer do token de turno
 * (ADR-024: o remetente é derivado do token, nunca do corpo). Estes tipos são o CONTRATO DE FIO
 * entre o proxy e src/adapters/http/rotas/interno.ts; a L9 troca o import em proxy.ts e mantém as formas.
 */
export type RespostaPlano =
  | { ok: true; plano: PlanoTurno }
  | { ok: false; motivo: "plano_ausente" | "servidor_fora" | "falha_tecnica"; status: number | null };

/** Corpo devolvido por POST /api/interno/ferramentas/:nome. `aguardar` = decisão criada, o proxy faz long-poll. */
export type RespostaFerramenta =
  | { ok: true; conteudo: string; confianca: Confianca }
  | { ok: false; negacao: Negacao }
  | { aguardar: string };

export type RespostaAguardar =
  | { estado: "decidida"; itens: { idx: number; desfecho: DesfechoItem | null }[] }
  | { estado: "pendente" };

export type FalhaTransporte = { transporte: "servidor_fora" | "timeout" | "falha_tecnica"; status: number | null };

export interface ClienteNod {
  plano(): Promise<RespostaPlano>;
  ferramenta(nome: string, argumentos: Record<string, unknown>): Promise<RespostaFerramenta | FalhaTransporte>;
  aguardar(decisaoId: string, fatiaMs: number): Promise<RespostaAguardar | FalhaTransporte>;
  /** Negação decidida LOCALMENTE pelo proxy (fora do catálogo): o servidor grava trilha e pede interrupção. */
  negacao(n: Negacao): Promise<void>;
}

export type OpcoesClienteNod = {
  url: string;
  token: string;
  /** definido em 2026-09-16: 5 s — acima disso o servidor local está fora, não lento (ADR-029: conector_indisponivel com `desde`). */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export const TIMEOUT_CLIENTE_NOD_MS = 5_000;

function ehFalha(x: unknown): x is FalhaTransporte {
  return typeof x === "object" && x !== null && "transporte" in x;
}

/** Predicado: a resposta é falha de TRANSPORTE (servidor fora, timeout), não uma decisão do servidor. */
export function ehFalhaTransporte(x: RespostaFerramenta | RespostaAguardar | FalhaTransporte): x is FalhaTransporte {
  return ehFalha(x);
}

export function criarClienteNod(opcoes: OpcoesClienteNod): ClienteNod {
  const base = opcoes.url.replace(/\/$/, "");
  const f = opcoes.fetchImpl ?? fetch;
  const timeout = opcoes.timeoutMs ?? TIMEOUT_CLIENTE_NOD_MS;

  async function chamar(metodo: "GET" | "POST", caminho: string, corpo?: unknown, timeoutMs = timeout): Promise<{ status: number; json: unknown } | FalhaTransporte> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await f(`${base}${caminho}`, {
        method: metodo,
        headers: { authorization: `Bearer ${opcoes.token}`, "content-type": "application/json" },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: ctrl.signal,
      });
      const texto = await r.text();
      let json: unknown = null;
      try {
        json = texto === "" ? null : JSON.parse(texto);
      } catch {
        json = null;
      }
      return { status: r.status, json };
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return { transporte: "timeout", status: null };
      return { transporte: "servidor_fora", status: null };
    } finally {
      clearTimeout(t);
    }
  }

  return {
    async plano() {
      const r = await chamar("GET", "/api/interno/plano");
      if (ehFalha(r)) return { ok: false, motivo: "servidor_fora", status: null };
      if (r.status === 200 && typeof r.json === "object" && r.json !== null) return { ok: true, plano: r.json as PlanoTurno };
      if (r.status === 401 || r.status === 404) return { ok: false, motivo: "plano_ausente", status: r.status };
      return { ok: false, motivo: "falha_tecnica", status: r.status };
    },

    async ferramenta(nome, argumentos) {
      const r = await chamar("POST", `/api/interno/ferramentas/${encodeURIComponent(nome)}`, { argumentos });
      if (ehFalha(r)) return r;
      if (r.status === 200 && typeof r.json === "object" && r.json !== null) return r.json as RespostaFerramenta;
      return { transporte: "falha_tecnica", status: r.status };
    },

    async aguardar(decisaoId, fatiaMs) {
      const r = await chamar("GET", `/api/interno/decisoes/${encodeURIComponent(decisaoId)}/aguardar`, undefined, fatiaMs + timeout);
      if (ehFalha(r)) return r;
      if (r.status === 200 && typeof r.json === "object" && r.json !== null) return r.json as RespostaAguardar;
      return { transporte: "falha_tecnica", status: r.status };
    },

    async negacao(n) {
      await chamar("POST", "/api/interno/negacoes", n);
    },
  };
}
