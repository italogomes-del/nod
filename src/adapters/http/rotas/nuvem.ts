import { createHash, randomBytes } from "node:crypto";
import { DORMIR_APOS_MIN, type ContaNuvem, type ContaNuvemDto, type DormirAposMin, type MotivoFalhaNuvem, type RefInstancia } from "../../../contracts/provedor-nuvem.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { ErroNuvemLancado } from "../../../domain/maquina-nuvem.ts";
import { log } from "../../../obs/log.ts";
import type { Escopo } from "../../../shared/types.ts";
import type { Deps } from "../../../use-cases/tipos.ts";
import type { Rota } from "../roteador.ts";
import { cunharState, stateValido, STATE_VALIDADE_MS } from "../sessao-google.ts";
import { lerCookies } from "../util.ts";
import type { DentroDeTx } from "./dentro-de-tx.ts";

/**
 * ADR-121 (NOD-92): a máquina na nuvem da pessoa. Só montadas com NOD_MAQUINA_NUVEM=gcp (compor.ts); sem a flag, 404.
 *
 *   POST /api/t/:t/nuvem/google {para:"preparar"} | {para:"conectar", maquinaId, projeto, zona, nome}
 *     └─ 200 {url} do Google (escopo cloud-platform, access_type=online, PKCE S256) + Set-Cookie nod_nuvem (Lax)
 *   GET  /api/nuvem/google/callback?code&state   (pública: o cookie de sessão é Strict e não volta do Google)
 *     ├─ state assinado, igual ao cookie, ≤ 600 s; o nonce acha o pedido NA MEMÓRIA (escopo, verificador PKCE)
 *     ├─ troca o code pelo token (com o verificador) — o token nunca vai para o banco nem para o log
 *     └─ 302 /maquinas?nuvem=preparando e, em segundo plano: preparar o projeto → cifrar a chave → gravar a
 *        credencial → (conectar) dar o papel de ligar à conta de serviço e ligar a VM à chave da máquina.
 *   GET  /api/t/:t/nuvem/conta                        a conta, e se o preparo ainda roda ou falhou
 *   POST /api/t/:t/nuvem/maquinas/:id/dormir          "Dormir agora" (força, mas nunca com trabalho rodando)
 *   POST /api/t/:t/nuvem/maquinas/:id/acordar
 *   PUT  /api/t/:t/nuvem/maquinas/:id/dormir-apos     {minutos: 15|30|60|120|null}
 * `:id` é a chave da máquina (maquina_tokens), o mesmo id que a tela já conhece.
 */
export const COOKIE_NUVEM = "nod_nuvem";
export const ESCOPO_CLOUD_PLATFORM = "https://www.googleapis.com/auth/cloud-platform";
const PRAZO_TOKEN_MS = 10_000;

export type ConfigOauthNuvem = { clientId: string; clientSecret: string; redirectUri: string; urlAutorizacao?: string; urlToken?: string };

export type DepsRotasNuvem = {
  dentro: DentroDeTx;
  segredo: string;
  /** null: o servidor não tem o OAuth do Google (NOD_GOOGLE_CLIENT_*) — preparar/conectar respondem integracao_nao_configurada. */
  oauth: ConfigOauthNuvem | null;
  conta: ContaNuvem;
  cifrar(texto: string): string;
  fetchImpl?: typeof fetch;
  agora?: () => number;
};

type Pedido = { para: "preparar" } | { para: "conectar"; maquinaId: string; ref: RefInstancia };
type Pendente = { escopo: Escopo; verificador: string; pedido: Pedido; em: number };
type Preparo = { fase: "preparando" | "falhou"; motivo: MotivoFalhaNuvem | null; detalhe: string | null };

const PROJETO = /^[a-z][-a-z0-9]{4,28}[a-z0-9]$/;
const ZONA = /^[a-z]+-[a-z]+[0-9]+-[a-z]$/;
const INSTANCIA = /^[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function texto(v: unknown, re: RegExp, campo: string): string {
  if (typeof v !== "string" || !re.test(v.trim())) throw new ErroDeDominio("entrada_invalida", { cause: campo });
  return v.trim();
}

export function lerPedido(corpo: unknown): Pedido {
  const c = (corpo ?? {}) as Record<string, unknown>;
  if (c.para === "preparar") return { para: "preparar" };
  if (c.para !== "conectar") throw new ErroDeDominio("entrada_invalida", { cause: "para" });
  return { para: "conectar", maquinaId: texto(c.maquinaId, UUID, "máquina"), ref: { projeto: texto(c.projeto, PROJETO, "projeto"), zona: texto(c.zona, ZONA, "zona"), nome: texto(c.nome, INSTANCIA, "nome da instância") } };
}

const chaveDaPessoa = (e: Escopo) => `${e.tenantId}:${e.pessoaId}`;

async function maquinaDaNuvem(d: Deps, maquinaId: string) {
  const m = await d.repos.maquinasNuvem.buscarPorMaquina(maquinaId);
  if (!m) throw new ErroDeDominio("nao_encontrado", { cause: "máquina na nuvem" });
  return m;
}

export function rotasNuvem(deps: DepsRotasNuvem): Rota[] {
  const agora = deps.agora ?? (() => Date.now());
  const f = deps.fetchImpl ?? fetch;
  const pendentes = new Map<string, Pendente>();
  const preparos = new Map<string, Preparo>();
  const seguro = deps.oauth?.redirectUri.startsWith("https://") ?? false;
  const atributos = `HttpOnly; SameSite=Lax; Path=/api/nuvem/google${seguro ? "; Secure" : ""}`;
  const apagar = `${COOKIE_NUVEM}=; Max-Age=0; ${atributos}`;

  const limparVencidos = () => {
    const t = agora();
    for (const [n, p] of pendentes) if (t - p.em > STATE_VALIDADE_MS) pendentes.delete(n);
  };

  /** Em segundo plano, depois do 302: o preparo leva minutos (cria projeto, ativa a Compute). */
  async function concluir(p: Pendente, token: string): Promise<void> {
    const k = chaveDaPessoa(p.escopo);
    preparos.set(k, { fase: "preparando", motivo: null, detalhe: null });
    try {
      const existente = p.pedido.para === "conectar" ? p.pedido.ref.projeto : await deps.dentro(p.escopo, async (d) => (await d.repos.credenciaisNuvem.atual())?.projeto ?? null);
      const pronta = await deps.conta.preparar({ pessoaId: p.escopo.pessoaId, tokenAcesso: token, projetoExistente: existente });
      const cred = await deps.dentro(p.escopo, (d) => d.repos.credenciaisNuvem.gravar({ provedor: "gcp", projeto: pronta.projeto, contaServico: pronta.contaServico, chaveCifrada: deps.cifrar(pronta.chaveJson), chaveNome: pronta.chaveNome }));
      // NOD-92 (revisão B2): com a chave nova gravada, a velha (Reconectar) sai do Google. Falhou: a nova já vale; avisa e segue.
      try {
        const apagadas = await deps.conta.apagarOutrasChaves({ tokenAcesso: token, projeto: pronta.projeto, contaServico: pronta.contaServico, manter: pronta.chaveNome });
        if (apagadas > 0) log("info", "nuvem_chave_antiga_apagada", { tenant_id: p.escopo.tenantId, pessoa_id: p.escopo.pessoaId, apagadas });
      } catch (e) {
        log("aviso", "nuvem_chave_antiga_ficou", { tenant_id: p.escopo.tenantId, pessoa_id: p.escopo.pessoaId, erro: e instanceof Error ? e.name : "desconhecido" });
      }
      if (p.pedido.para === "conectar") {
        const { ref, maquinaId } = p.pedido;
        await deps.conta.autorizarInstancia({ tokenAcesso: token, projeto: cred.projeto, contaServico: cred.contaServico, ref });
        await deps.dentro(p.escopo, async (d) => {
          if (await d.repos.maquinasNuvem.buscarPorMaquina(maquinaId)) return;
          await d.repos.maquinasNuvem.criarConectada({ credencialId: cred.id, maquinaId, ref, agora: agora() });
        });
      }
      preparos.delete(k);
      log("info", "nuvem_conta_preparada", { tenant_id: p.escopo.tenantId, pessoa_id: p.escopo.pessoaId, para: p.pedido.para });
    } catch (e) {
      const lancado = e instanceof ErroNuvemLancado;
      preparos.set(k, { fase: "falhou", motivo: lancado ? e.motivo : null, detalhe: lancado ? e.detalhe : "tente_de_novo" });
      log("aviso", "nuvem_preparo_falhou", { tenant_id: p.escopo.tenantId, pessoa_id: p.escopo.pessoaId, erro: e instanceof Error ? e.name : "desconhecido", ...(lancado ? { motivo: e.motivo } : {}) });
    }
  }

  return [
    {
      metodo: "POST",
      padrao: /^\/nuvem\/google$/,
      async handler(ctx) {
        if (!deps.oauth) throw new ErroDeDominio("integracao_nao_configurada", { cause: "oauth da nuvem" });
        const pedido = lerPedido(await ctx.corpo());
        if (pedido.para === "conectar") {
          await deps.dentro(ctx.escopo, async (d) => {
            const viva = (await d.repos.maquinaTokens.listar()).some((c) => c.id === pedido.maquinaId && c.revogadaEm === null);
            if (!viva) throw new ErroDeDominio("nao_encontrado", { cause: "máquina" });
            if (await d.repos.maquinasNuvem.buscarPorMaquina(pedido.maquinaId)) throw new ErroDeDominio("estado_invalido", { cause: "máquina já conectada" });
          });
        }
        limparVencidos();
        const nonce = randomBytes(16).toString("base64url");
        const verificador = randomBytes(32).toString("base64url");
        pendentes.set(nonce, { escopo: ctx.escopo, verificador, pedido, em: agora() });
        const state = cunharState(deps.segredo, agora(), nonce);
        const url = new URL(deps.oauth.urlAutorizacao ?? "https://accounts.google.com/o/oauth2/v2/auth");
        url.searchParams.set("client_id", deps.oauth.clientId);
        url.searchParams.set("redirect_uri", deps.oauth.redirectUri);
        url.searchParams.set("response_type", "code");
        url.searchParams.set("scope", ESCOPO_CLOUD_PLATFORM);
        url.searchParams.set("access_type", "online");
        url.searchParams.set("prompt", "consent");
        url.searchParams.set("state", state);
        url.searchParams.set("code_challenge", createHash("sha256").update(verificador).digest("base64url"));
        url.searchParams.set("code_challenge_method", "S256");
        ctx.res.setHeader("set-cookie", `${COOKIE_NUVEM}=${state}; Max-Age=${STATE_VALIDADE_MS / 1000}; ${atributos}`);
        ctx.res.setHeader("cache-control", "no-store");
        ctx.json(200, { url: url.toString() });
      },
    },
    {
      metodo: "GET",
      padrao: /^\/nuvem\/google\/callback$/,
      publica: true,
      async handler(ctx) {
        const voltar = (resultado: "preparando" | "recusado") => {
          ctx.res.writeHead(302, { location: `/maquinas?nuvem=${resultado}`, "set-cookie": apagar, "cache-control": "no-store" });
          ctx.res.end();
        };
        const q = new URL(ctx.req.url ?? "/", "http://127.0.0.1").searchParams;
        const state = q.get("state") ?? undefined;
        if (!deps.oauth || q.has("error") || !stateValido(state, lerCookies(ctx.req)[COOKIE_NUVEM], deps.segredo, agora())) return voltar("recusado");
        let nonce: unknown;
        try { nonce = (JSON.parse(Buffer.from(state!.split(".")[0] ?? "", "base64url").toString("utf8")) as { n?: unknown }).n; } catch { nonce = null; }
        const p = typeof nonce === "string" ? pendentes.get(nonce) : undefined;
        if (typeof nonce === "string") pendentes.delete(nonce);
        const code = q.get("code");
        if (!p || !code) return voltar("recusado");
        let token: unknown;
        try {
          const r = await f(deps.oauth.urlToken ?? "https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ code, client_id: deps.oauth.clientId, client_secret: deps.oauth.clientSecret, redirect_uri: deps.oauth.redirectUri, grant_type: "authorization_code", code_verifier: p.verificador }).toString(),
            signal: AbortSignal.timeout(PRAZO_TOKEN_MS),
          });
          // Nada do corpo do Google chega ao log nem à pessoa.
          if (!r.ok) { log("aviso", "nuvem_oauth_troca_falhou", { status: r.status }); return voltar("recusado"); }
          token = ((await r.json()) as { access_token?: unknown }).access_token;
        } catch (e) {
          log("aviso", "nuvem_oauth_troca_falhou", { status: 0, erro: e instanceof Error ? e.name : "desconhecido" });
          return voltar("recusado");
        }
        if (typeof token !== "string" || token.length === 0) return voltar("recusado");
        void concluir(p, token);
        voltar("preparando");
      },
    },
    {
      metodo: "GET",
      padrao: /^\/nuvem\/conta$/,
      async handler(ctx) {
        const cred = await deps.dentro(ctx.escopo, (d) => d.repos.credenciaisNuvem.atual());
        const preparo = preparos.get(chaveDaPessoa(ctx.escopo));
        const dto: ContaNuvemDto = {
          conectada: cred !== null,
          projeto: cred?.projeto ?? null,
          preparando: preparo?.fase === "preparando",
          motivo: preparo?.fase === "falhou" ? preparo.motivo : null,
          detalhe: preparo?.fase === "falhou" ? preparo.detalhe : null,
        };
        ctx.json(200, dto);
      },
    },
    {
      metodo: "POST",
      padrao: /^\/nuvem\/maquinas\/(?<id>[^/]+)\/dormir$/,
      async handler(ctx) {
        const r = await deps.dentro(ctx.escopo, async (d) => d.repos.maquinasNuvem.tentarDormir((await maquinaDaNuvem(d, ctx.params.id ?? "")).id, agora(), { forcar: true }));
        if (!r.ok) throw new ErroDeDominio("estado_invalido", { cause: r.motivo });
        ctx.json(200, { ok: true });
      },
    },
    {
      metodo: "POST",
      padrao: /^\/nuvem\/maquinas\/(?<id>[^/]+)\/acordar$/,
      async handler(ctx) {
        const ok = await deps.dentro(ctx.escopo, async (d) => d.repos.maquinasNuvem.pedirAcordar((await maquinaDaNuvem(d, ctx.params.id ?? "")).id, agora()));
        if (!ok) throw new ErroDeDominio("estado_invalido", { cause: "acordar" });
        ctx.json(200, { ok: true });
      },
    },
    {
      metodo: "PUT",
      padrao: /^\/nuvem\/maquinas\/(?<id>[^/]+)\/dormir-apos$/,
      async handler(ctx) {
        const { minutos } = ((await ctx.corpo()) ?? {}) as { minutos?: unknown };
        if (minutos !== null && !DORMIR_APOS_MIN.includes(minutos as DormirAposMin)) throw new ErroDeDominio("entrada_invalida", { cause: "minutos" });
        const v = minutos as DormirAposMin | null;
        await deps.dentro(ctx.escopo, async (d) => d.repos.maquinasNuvem.definirDormirApos((await maquinaDaNuvem(d, ctx.params.id ?? "")).id, v));
        ctx.json(200, { dormirAposMin: v });
      },
    },
  ];
}
