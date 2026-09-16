import { createHmac, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { idDeterministico } from "../../db/seed/id-deterministico.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import type { Escopo } from "../../shared/types.ts";
import type { Rota } from "./roteador.ts";
import { lerCookies } from "./util.ts";

/**
 * Sessão STUB por cookie do servidor (ADR-019: a sessão vem do servidor, nunca do CLI).
 * POST /api/sessao/entrar {pessoa:'marlon'|'ana'} grava cookie HttpOnly nod_sessao assinado (HMAC)
 * com {tenantId, pessoaId}. Só é aceitável em 127.0.0.1 — server.ts recusa outro NOD_HOST.
 * Os ids são os determinísticos de identidade (tests/helpers/ids.ts reexporta os mesmos).
 */
const COOKIE = "nod_sessao";

const PESSOAS: Record<string, string> = {
  marlon: idDeterministico("pessoa:marlon"),
  ana: idDeterministico("pessoa:ana"),
};
const TENANT_LEAPY = idDeterministico("tenant:leapy");

function assinar(payload: string, segredo: string): string {
  return createHmac("sha256", segredo).update(payload).digest("base64url");
}

export function cunharCookie(escopo: Escopo, segredo: string): string {
  const payload = Buffer.from(JSON.stringify(escopo), "utf8").toString("base64url");
  return `${payload}.${assinar(payload, segredo)}`;
}

export function lerCookieSessao(valor: string | undefined, segredo: string): Escopo | null {
  if (!valor) return null;
  const [payload, assinatura] = valor.split(".");
  if (!payload || !assinatura) return null;
  const esperada = assinar(payload, segredo);
  const a = Buffer.from(assinatura);
  const b = Buffer.from(esperada);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<Escopo>;
    if (typeof obj.tenantId !== "string" || typeof obj.pessoaId !== "string" || !obj.tenantId || !obj.pessoaId) return null;
    return { tenantId: obj.tenantId, pessoaId: obj.pessoaId };
  } catch {
    return null;
  }
}

export function criarSessao(segredo: string): { resolverEscopo(req: IncomingMessage): Escopo | null; rotas: Rota[] } {
  return {
    resolverEscopo(req) {
      return lerCookieSessao(lerCookies(req)[COOKIE], segredo);
    },
    rotas: [
      {
        metodo: "POST",
        padrao: /^\/sessao\/entrar$/,
        publica: true,
        async handler(ctx) {
          const corpo = (await ctx.corpo()) as { pessoa?: unknown };
          const pessoaId = typeof corpo.pessoa === "string" ? PESSOAS[corpo.pessoa] : undefined;
          if (!pessoaId) throw new ErroDeDominio("entrada_invalida", { cause: "pessoa desconhecida" });
          const escopo: Escopo = { tenantId: TENANT_LEAPY, pessoaId };
          ctx.res.setHeader("set-cookie", `${COOKIE}=${cunharCookie(escopo, segredo)}; HttpOnly; SameSite=Strict; Path=/`);
          ctx.json(200, escopo);
        },
      },
      {
        metodo: "GET",
        padrao: /^\/sessao$/,
        publica: true,
        async handler(ctx) {
          if (!ctx.escopo) {
            ctx.json(401, { codigo: "nao_permitido", mensagem: "entre com uma sessão" });
            return;
          }
          ctx.json(200, ctx.escopo);
        },
      },
    ],
  };
}
