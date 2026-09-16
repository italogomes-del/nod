import type { IncomingMessage, ServerResponse } from "node:http";
import { ErroDeDominio } from "../../domain/erro.ts";
import type { Escopo } from "../../shared/types.ts";
import { responderErro } from "./erros.ts";
import { json, lerCorpo } from "./util.ts";

/**
 * Roteador do nod. Três famílias de rota:
 *  - /api/t/:tenantId/…  escopada: exige sessão e o tenant da URL casa a sessão (senão 404, nunca 403 — ADR-005);
 *  - /api/interno/…      autenticada por token de turno: Origin → 403 ANTES do token (ADR-021);
 *                        qualquer campo 'remetente' no corpo é ignorado (ADR-024);
 *  - /api/…              pública (saude, sessao): sem escopo garantido.
 * Cada rota é fina: valida, chama caso de uso, responde. Erro passa por responderErro.
 */
export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  escopo: Escopo;
  params: Record<string, string>;
  corpo(): Promise<unknown>;
  json(status: number, body: unknown): void;
}

export type CtxPublico = Omit<Ctx, "escopo"> & { escopo: Escopo | null };

export type Metodo = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export type Rota =
  | { metodo: Metodo; padrao: RegExp; handler(ctx: Ctx): Promise<void>; interno?: true; publica?: undefined }
  | { metodo: Metodo; padrao: RegExp; handler(ctx: CtxPublico): Promise<void>; publica: true; interno?: undefined };

/** Identidade derivada do token de turno (L5 implementa services.tokenTurno.autorizar). */
export interface IdentidadeDeTurno extends Escopo {
  turnoId: string;
  agenteId: string;
}

export interface DepsRoteador {
  resolverEscopo(req: IncomingMessage): Escopo | null;
  autorizarTokenTurno?(token: string): IdentidadeDeTurno | null;
  /** Último recurso quando nenhuma rota casa (ex.: estático). Devolve true se respondeu. */
  fallback?(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
}

const PREFIXO_TENANT = /^\/api\/t\/([^/]+)(\/.*)?$/;
const PREFIXO_INTERNO = /^\/api\/interno(\/.*)$/;
const PREFIXO_PUBLICO = /^\/api(\/.*)$/;

function montarCtx(req: IncomingMessage, res: ServerResponse, escopo: Escopo | null, params: Record<string, string>): CtxPublico {
  let corpoLido: Promise<unknown> | null = null;
  return {
    req,
    res,
    escopo,
    params,
    corpo: () => (corpoLido ??= lerCorpo(req)),
    json: (status, body) => json(res, status, body),
  };
}

function casar(rotas: Rota[], metodo: string, caminho: string, filtro: (r: Rota) => boolean): { rota: Rota; params: Record<string, string> } | null {
  for (const rota of rotas) {
    if (!filtro(rota) || rota.metodo !== metodo) continue;
    const m = rota.padrao.exec(caminho);
    if (!m) continue;
    const params: Record<string, string> = {};
    for (const [k, v] of Object.entries(m.groups ?? {})) params[k] = decodeURIComponent(v);
    return { rota, params };
  }
  return null;
}

export function criarRoteador(rotas: Rota[], deps: DepsRoteador): (req: IncomingMessage, res: ServerResponse) => void {
  async function tratar(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const caminho = url.pathname;
    const metodo = req.method ?? "GET";

    const interno = PREFIXO_INTERNO.exec(caminho);
    if (interno) {
      if (req.headers.origin !== undefined) {
        json(res, 403, { codigo: "nao_permitido", mensagem: "rota interna não aceita navegador" });
        return;
      }
      const auth = req.headers.authorization ?? "";
      const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
      const identidade = token && deps.autorizarTokenTurno ? deps.autorizarTokenTurno(token) : null;
      if (!identidade) {
        json(res, 401, { codigo: "nao_permitido", mensagem: "token de turno ausente ou inválido" });
        return;
      }
      const achado = casar(rotas, metodo, interno[1] ?? "/", (r) => r.interno === true);
      if (!achado) {
        json(res, 404, { codigo: "nao_encontrado", mensagem: "rota não encontrada" });
        return;
      }
      const ctx = montarCtx(req, res, { tenantId: identidade.tenantId, pessoaId: identidade.pessoaId }, {
        ...achado.params,
        turnoId: identidade.turnoId,
        agenteId: identidade.agenteId,
      });
      await (achado.rota.handler as (c: CtxPublico) => Promise<void>)(ctx);
      return;
    }

    const escopado = PREFIXO_TENANT.exec(caminho);
    if (escopado) {
      const escopo = deps.resolverEscopo(req);
      if (!escopo) {
        json(res, 401, { codigo: "nao_permitido", mensagem: "entre com uma sessão" });
        return;
      }
      if (escopo.tenantId !== escopado[1]) {
        json(res, 404, { codigo: "nao_encontrado", mensagem: "rota não encontrada" });
        return;
      }
      const achado = casar(rotas, metodo, escopado[2] ?? "/", (r) => !r.interno && !r.publica);
      if (!achado) {
        json(res, 404, { codigo: "nao_encontrado", mensagem: "rota não encontrada" });
        return;
      }
      await (achado.rota.handler as (c: CtxPublico) => Promise<void>)(montarCtx(req, res, escopo, achado.params));
      return;
    }

    const publico = PREFIXO_PUBLICO.exec(caminho);
    if (publico) {
      const achado = casar(rotas, metodo, publico[1] ?? "/", (r) => r.publica === true);
      if (achado) {
        await achado.rota.handler(montarCtx(req, res, deps.resolverEscopo(req), achado.params) as Ctx);
        return;
      }
      json(res, 404, { codigo: "nao_encontrado", mensagem: "rota não encontrada" });
      return;
    }

    if (deps.fallback && (await deps.fallback(req, res))) return;
    json(res, 404, { codigo: "nao_encontrado", mensagem: "rota não encontrada" });
  }

  return (req, res) => {
    tratar(req, res).catch((err: unknown) => {
      if (res.headersSent) {
        res.end();
        return;
      }
      responderErro(res, err instanceof SyntaxError ? new ErroDeDominio("entrada_invalida", { cause: err }) : err);
    });
  };
}
