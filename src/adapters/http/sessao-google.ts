import { randomBytes } from "node:crypto";
import { log } from "../../obs/log.ts";
import type { Escopo } from "../../shared/types.ts";
import type { Rota } from "./roteador.ts";
import { assinar, cabecalhoCookieSessao, iguaisEmTempoConstante, lerAssinado } from "./sessao-cookie.ts";
import { lerCookies } from "./util.ts";

/**
 * Login Google Workspace (ADR-021, ADR-030): OAuth 2.0 Authorization Code, SEM biblioteca (o nod tem
 * uma dependência de produção e trata a lista como superfície controlada).
 *
 *   GET /api/sessao/google
 *     └─ 302 accounts.google.com ?state=<nonce.hmac>   + Set-Cookie nod_oauth=<o mesmo state> (Lax, 600 s)
 *   GET /api/sessao/google/callback?code&state
 *     ├─ state com HMAC válido, idade ≤ 600 s e IGUAL ao cookie?      não → recusa
 *     ├─ POST oauth2.googleapis.com/token (fetch injetável, 5 s)      falhou → recusa
 *     ├─ claims do id_token: iss, aud, exp                           ruim → recusa
 *     ├─ hd = leapy.com.br (hd AUSENTE = conta pessoal Gmail)        não → recusa
 *     ├─ email_verified = true                                       não → recusa
 *     ├─ e-mail casa uma pessoa (cfg.pessoaPorEmail; o boot liga em   não → recusa
 *     │  buscarPorEmail, SEM escopo)
 *     └─ 302 /  + Set-Cookie nod_sessao (Strict; Secure se o redirect for https)
 *
 * TODA recusa é a MESMA resposta, byte a byte: 302 para /?entrar=recusado. Dizer "domínio errado"
 * num caso e "não cadastrado" no outro contaria a quem está de fora quem trabalha na Leapy. O motivo
 * real vai só para o log (`login_recusado`), sem o e-mail.
 *
 * A ALLOWLIST (e-mail em `pessoas`) é a fronteira de segurança; `hd` é defesa em profundidade. Não
 * "simplificar" confiando no `hd` e tirando a busca da pessoa.
 *
 * Por que NÃO verificamos a assinatura RS256 do id_token: ele chega DIRETO do endpoint de token do
 * Google, numa chamada que o nosso servidor faz sobre TLS autenticada com o nosso client_secret — o
 * caso em que a documentação do Google dispensa a verificação. O perigo real é o inverso (aceitar um
 * id_token vindo do navegador), e este fluxo não tem esse caminho. Nunca leia id_token de query/corpo.
 */
export type ConfigGoogle = {
  clientId: string;
  clientSecret: string;
  /** URL pública do callback, exatamente como cadastrada no Google Cloud Console. */
  redirectUri: string;
  /** Domínio Workspace exigido na claim `hd`. Default "leapy.com.br". */
  dominio?: string;
  /** E-mail → pessoa do cadastro, sem escopo (buscarPorEmail). null = recusa. */
  pessoaPorEmail(email: string): Promise<Escopo | null>;
  /** Injetáveis para o teste nunca falar com o Google. */
  fetchImpl?: typeof fetch;
  agora?: () => number;
  urlAutorizacao?: string;
  urlToken?: string;
};

export const COOKIE_STATE = "nod_oauth";
/** definido em 2026-09-16: 10 min para escolher a conta no Google; depois disso o login recomeça. */
export const STATE_VALIDADE_MS = 600_000;
/** definido em 2026-09-16: mesmo teto de 5 s do cliente HTTP do nod (cliente-nod.ts). */
const TIMEOUT_TOKEN_MS = 5_000;
export const DOMINIO_PADRAO = "leapy.com.br";
const EMISSORES = new Set(["accounts.google.com", "https://accounts.google.com"]);
export const DESTINO_RECUSA = "/?entrar=recusado";

export type MotivoRecusa = "cancelado" | "state" | "sem_code" | "troca" | "id_token" | "emissor" | "audiencia" | "expirado" | "dominio" | "email_nao_verificado" | "sem_pessoa";

// ---------------------------------------------------------------------------------------------
// state anti-CSRF sem tabela: nonce + instante assinados; a MESMA string vai na URL e no cookie.

export function cunharState(segredo: string, agora: number, nonce = randomBytes(16).toString("base64url")): string {
  const payload = Buffer.from(JSON.stringify({ n: nonce, t: agora }), "utf8").toString("base64url");
  return `${payload}.${assinar(payload, segredo)}`;
}

/** true só com: assinatura válida, idade dentro da validade, e o state da URL igual ao do cookie. */
export function stateValido(daUrl: string | undefined, doCookie: string | undefined, segredo: string, agora: number): boolean {
  if (!daUrl || !doCookie || !iguaisEmTempoConstante(daUrl, doCookie)) return false;
  const payload = lerAssinado(daUrl, segredo);
  if (!payload) return false;
  try {
    const obj = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { n?: unknown; t?: unknown };
    if (typeof obj.n !== "string" || typeof obj.t !== "number") return false;
    return agora - obj.t >= 0 && agora - obj.t <= STATE_VALIDADE_MS;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// id_token

/** Só o payload (segmento do meio). Ver no cabeçalho do arquivo por que a assinatura não é checada. */
export function claimsDoIdToken(idToken: unknown): Record<string, unknown> | null {
  if (typeof idToken !== "string") return null;
  const partes = idToken.split(".");
  if (partes.length !== 3 || !partes[1]) return null;
  try {
    const obj: unknown = JSON.parse(Buffer.from(partes[1], "base64url").toString("utf8"));
    return typeof obj === "object" && obj !== null && !Array.isArray(obj) ? (obj as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function validarClaims(claims: Record<string, unknown>, p: { clientId: string; dominio: string; agora: number }): { ok: true; email: string } | { ok: false; motivo: MotivoRecusa } {
  if (typeof claims.iss !== "string" || !EMISSORES.has(claims.iss)) return { ok: false, motivo: "emissor" };
  const aud = claims.aud;
  if (!(aud === p.clientId || (Array.isArray(aud) && aud.includes(p.clientId)))) return { ok: false, motivo: "audiencia" };
  if (typeof claims.exp !== "number" || claims.exp * 1000 <= p.agora) return { ok: false, motivo: "expirado" };
  // `hd` AUSENTE é conta pessoal (Gmail): recusa igual a domínio errado.
  if (typeof claims.hd !== "string" || claims.hd.toLowerCase() !== p.dominio) return { ok: false, motivo: "dominio" };
  if (claims.email_verified !== true) return { ok: false, motivo: "email_nao_verificado" };
  if (typeof claims.email !== "string" || !claims.email.toLowerCase().endsWith(`@${p.dominio}`)) return { ok: false, motivo: "dominio" };
  return { ok: true, email: claims.email.toLowerCase() };
}

// ---------------------------------------------------------------------------------------------

export function rotasGoogle(segredo: string, cfg: ConfigGoogle): Rota[] {
  const agora = cfg.agora ?? (() => Date.now());
  const dominio = (cfg.dominio ?? DOMINIO_PADRAO).toLowerCase();
  const seguro = cfg.redirectUri.startsWith("https://");
  const atributosState = `HttpOnly; SameSite=Lax; Path=/api/sessao/google${seguro ? "; Secure" : ""}`;
  // SameSite=Lax (e NÃO Strict) de propósito: a volta do Google é navegação top-level vinda de outro
  // site, e com Strict o navegador não manda o cookie — o login nunca fecha e o sintoma ("state
  // inválido") não aponta a causa. O nod_sessao continua Strict: é cunhado aqui, não lido aqui.
  const apagarState = `${COOKIE_STATE}=; Max-Age=0; ${atributosState}`;

  return [
    {
      metodo: "GET",
      padrao: /^\/sessao\/google$/,
      publica: true,
      async handler(ctx) {
        const state = cunharState(segredo, agora());
        const url = new URL(cfg.urlAutorizacao ?? "https://accounts.google.com/o/oauth2/v2/auth");
        url.searchParams.set("client_id", cfg.clientId);
        url.searchParams.set("redirect_uri", cfg.redirectUri);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("scope", "openid email");
        // `hd` na URL só pré-filtra a tela do Google; a validação de verdade é a claim, no callback.
        url.searchParams.set("hd", dominio);
        url.searchParams.set("prompt", "select_account");
        url.searchParams.set("state", state);
        ctx.res.writeHead(302, {
          location: url.toString(),
          "set-cookie": `${COOKIE_STATE}=${state}; Max-Age=${STATE_VALIDADE_MS / 1000}; ${atributosState}`,
          "cache-control": "no-store",
        });
        ctx.res.end();
      },
    },
    {
      metodo: "GET",
      padrao: /^\/sessao\/google\/callback$/,
      publica: true,
      async handler(ctx) {
        const recusar = (motivo: MotivoRecusa) => {
          log("aviso", "login_recusado", { motivo });
          ctx.res.writeHead(302, { location: DESTINO_RECUSA, "set-cookie": apagarState, "cache-control": "no-store" });
          ctx.res.end();
        };

        const q = new URL(ctx.req.url ?? "/", "http://127.0.0.1").searchParams;
        if (q.has("error")) return recusar("cancelado");
        if (!stateValido(q.get("state") ?? undefined, lerCookies(ctx.req)[COOKIE_STATE], segredo, agora())) return recusar("state");
        const code = q.get("code");
        if (!code) return recusar("sem_code");

        let idToken: unknown;
        try {
          const f = cfg.fetchImpl ?? fetch;
          const r = await f(cfg.urlToken ?? "https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ code, client_id: cfg.clientId, client_secret: cfg.clientSecret, redirect_uri: cfg.redirectUri, grant_type: "authorization_code" }).toString(),
            signal: AbortSignal.timeout(TIMEOUT_TOKEN_MS),
          });
          // Nada do corpo de erro do Google chega à pessoa nem ao log.
          if (!r.ok) return recusar("troca");
          idToken = ((await r.json()) as { id_token?: unknown }).id_token;
        } catch {
          return recusar("troca");
        }

        const claims = claimsDoIdToken(idToken);
        if (!claims) return recusar("id_token");
        const v = validarClaims(claims, { clientId: cfg.clientId, dominio, agora: agora() });
        if (!v.ok) return recusar(v.motivo);

        const escopo = await cfg.pessoaPorEmail(v.email);
        if (!escopo) return recusar("sem_pessoa");

        log("info", "login_google", { tenant_id: escopo.tenantId, pessoa_id: escopo.pessoaId });
        ctx.res.writeHead(302, { location: "/", "set-cookie": [cabecalhoCookieSessao(escopo, segredo, seguro), apagarState], "cache-control": "no-store" });
        ctx.res.end();
      },
    },
  ];
}
