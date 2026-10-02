import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { listen } from "../../src/adapters/http/server.ts";
import { lerCookieSessao } from "../../src/adapters/http/sessao.ts";
import type { Escopo } from "../../src/shared/types.ts";
import { COOKIE_STATE, DESTINO_RECUSA } from "../../src/adapters/http/sessao-google.ts";
import { CLIENT_ID, claimsBoas, googleFalso, respostaComIdToken } from "../helpers/google-falso.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";

const SEGREDO = "segredo-de-teste-do-login-google-com-40-chars";
const EMAIL_CADASTRADO = "marlon.wanderllich@acme.com.br";

/**
 * Login Google de ponta a ponta sobre o servidor real em porta 0 (E1.2, ADR-030), com o Google
 * substituído por um fetch falso. A busca da pessoa é injetada (a busca real, buscarPorEmail, tem o
 * próprio teste em tests/integration/repos/pessoas-email.test.ts).
 */
describe("login Google: servidor real, Google falso", () => {
  let base: string;
  let close: () => Promise<void>;
  let resposta: () => Response | Promise<Response> = () => respostaComIdToken(claimsBoas(Date.now()));
  const google = googleFalso(() => resposta());
  const pessoaPorEmail = async (email: string): Promise<Escopo | null> => (email === EMAIL_CADASTRADO ? { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON } : null);

  beforeAll(async () => {
    const srv = await listen(0, "127.0.0.1", {
      segredoSessao: SEGREDO,
      sessao: {
        modo: "google",
        google: {
          clientId: CLIENT_ID,
          clientSecret: "segredo-do-cliente-oauth",
          redirectUri: "http://127.0.0.1:5274/api/sessao/google/callback",
          dominio: "acme.com.br",
          fetchImpl: google.fetchImpl,
          pessoaPorEmail,
        },
      },
    });
    base = `http://127.0.0.1:${srv.port}`;
    close = srv.close;
  });
  afterAll(() => close());

  async function iniciar(): Promise<{ state: string; cookie: string; location: URL; setCookie: string }> {
    const r = await fetch(`${base}/api/sessao/google`, { redirect: "manual" });
    expect(r.status).toBe(302);
    const location = new URL(r.headers.get("location") ?? "");
    const setCookie = r.headers.get("set-cookie") ?? "";
    return { state: location.searchParams.get("state") ?? "", cookie: setCookie.split(";")[0] ?? "", location, setCookie };
  }

  async function voltar(query: string, cookie?: string): Promise<Response> {
    return fetch(`${base}/api/sessao/google/callback?${query}`, { redirect: "manual", headers: cookie ? { cookie } : {} });
  }

  async function assinatura(r: Response): Promise<string> {
    return JSON.stringify({ status: r.status, location: r.headers.get("location"), cookie: r.headers.get("set-cookie"), corpo: await r.text() });
  }

  it("entrar manda para o Google com client_id, hd, escopo mínimo e o state também no cookie Lax de 10 min", async () => {
    const { location, state, setCookie } = await iniciar();
    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location.searchParams.get("client_id")).toBe(CLIENT_ID);
    expect(location.searchParams.get("hd")).toBe("acme.com.br");
    expect(location.searchParams.get("scope")).toBe("openid email");
    expect(location.searchParams.get("response_type")).toBe("code");
    expect(state.length).toBeGreaterThan(20);
    expect(setCookie).toContain(`nod_oauth=${state}`);
    expect(setCookie).toContain("SameSite=Lax");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Max-Age=600");
    expect(setCookie).not.toContain("Secure");
  });

  it("conta cadastrada: volta logada, com cookie de sessão válido, e o nod mandou o code e o client_secret ao Google", async () => {
    resposta = () => respostaComIdToken(claimsBoas(Date.now()));
    const { state, cookie } = await iniciar();
    const r = await voltar(`code=codigo-do-google&state=${encodeURIComponent(state)}`, cookie);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/");
    const cookies = r.headers.getSetCookie();
    const sessao = cookies.find((c) => c.startsWith("nod_sessao="));
    expect(sessao).toContain("SameSite=Strict");
    expect(cookies.some((c) => c.startsWith("nod_oauth=;") && c.includes("Max-Age=0"))).toBe(true);
    expect(lerCookieSessao(sessao?.split(";")[0]?.slice("nod_sessao=".length), SEGREDO)).toEqual({ tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON });

    const ultima = google.chamadas.at(-1);
    expect(ultima?.url).toBe("https://oauth2.googleapis.com/token");
    expect(ultima?.corpo.get("code")).toBe("codigo-do-google");
    expect(ultima?.corpo.get("client_secret")).toBe("segredo-do-cliente-oauth");
    expect(ultima?.corpo.get("grant_type")).toBe("authorization_code");

    const eu = await fetch(`${base}/api/sessao`, { headers: { cookie: sessao?.split(";")[0] ?? "" } });
    expect(await eu.json()).toEqual({ tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON });
  });

  it("TODA recusa é a mesma resposta, byte a byte, e nenhuma cria sessão (não diz quem tem acesso)", async () => {
    const agora = Date.now();
    const casos: { nome: string; resposta: () => Response | Promise<Response>; query?: (s: string) => string; semCookie?: boolean; outroState?: boolean }[] = [
      { nome: "outro domínio", resposta: () => respostaComIdToken(claimsBoas(agora, { hd: "outra.com.br", email: "x@outra.com.br" })) },
      { nome: "Gmail pessoal (sem hd)", resposta: () => respostaComIdToken(claimsBoas(agora, { hd: undefined, email: "x@gmail.com" })) },
      { nome: "e-mail não verificado", resposta: () => respostaComIdToken(claimsBoas(agora, { email_verified: false })) },
      { nome: "conta do domínio sem cadastro no nod", resposta: () => respostaComIdToken(claimsBoas(agora, { email: "ninguem@acme.com.br" })) },
      { nome: "Google fora do ar (503)", resposta: () => new Response("<html>erro interno do google com detalhe</html>", { status: 503 }) },
      { nome: "Google inalcançável", resposta: () => Promise.reject(new Error("ECONNRESET detalhe")) },
      { nome: "Google sem id_token", resposta: () => new Response("{}", { status: 200 }) },
      { nome: "pessoa cancelou no Google", resposta: () => respostaComIdToken(claimsBoas(agora)), query: () => "error=access_denied" },
      { nome: "volta sem code", resposta: () => respostaComIdToken(claimsBoas(agora)), query: (s) => `state=${encodeURIComponent(s)}` },
      { nome: "sem cookie de state", resposta: () => respostaComIdToken(claimsBoas(agora)), semCookie: true },
      { nome: "state de outro login", resposta: () => respostaComIdToken(claimsBoas(agora)), outroState: true },
    ];
    const vistas = new Set<string>();
    for (const c of casos) {
      resposta = c.resposta;
      const a = await iniciar();
      const b = c.outroState ? await iniciar() : a;
      const query = c.query ? c.query(a.state) : `code=x&state=${encodeURIComponent(b.state)}`;
      const r = await voltar(query, c.semCookie ? undefined : a.cookie);
      expect(r.headers.getSetCookie().some((k) => k.startsWith("nod_sessao=")), c.nome).toBe(false);
      expect(r.headers.get("location"), c.nome).toBe("/?entrar=recusado");
      vistas.add(await assinatura(r));
    }
    expect(vistas.size).toBe(1);
    // Valor concreto: se a forma da recusa mudar, o teste quebra (sem isto, "todas iguais" é fraco
    // demais — dez casos saídos da mesma função sempre seriam iguais).
    expect([...vistas][0]).toBe(
      JSON.stringify({ status: 302, location: DESTINO_RECUSA, cookie: `${COOKIE_STATE}=; Max-Age=0; HttpOnly; SameSite=Lax; Path=/api/sessao/google`, corpo: "" }),
    );
    // E a recusa é DIFERENTE do sucesso (senão "idêntico" seria idêntico a tudo).
    resposta = () => respostaComIdToken(claimsBoas(agora));
    const bom = await iniciar();
    const ok = await voltar(`code=x&state=${encodeURIComponent(bom.state)}`, bom.cookie);
    expect(await assinatura(ok)).not.toBe([...vistas][0]);
  });

  it("a recusa vai para o log com o motivo, SEM o e-mail e sem o corpo de erro do Google", async () => {
    const saida = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      resposta = () => respostaComIdToken(claimsBoas(Date.now(), { email: "segredo.pessoal@acme.com.br" }));
      let a = await iniciar();
      await voltar(`code=x&state=${encodeURIComponent(a.state)}`, a.cookie);
      resposta = () => new Response("detalhe-interno-do-google", { status: 500 });
      a = await iniciar();
      await voltar(`code=x&state=${encodeURIComponent(a.state)}`, a.cookie);
      const linhas = saida.mock.calls.map((c) => String(c[0])).join("\n");
      const recusas = saida.mock.calls.map((c) => JSON.parse(String(c[0])) as { evento: string; motivo?: string }).filter((l) => l.evento === "login_recusado");
      expect(recusas.map((l) => l.motivo)).toEqual(["sem_pessoa", "troca"]);
      expect(linhas).not.toContain("segredo.pessoal");
      expect(linhas).not.toContain("detalhe-interno-do-google");
    } finally {
      saida.mockRestore();
    }
  });

  it("no modo google o login de desenvolvimento não existe, e a tela recebe o modo", async () => {
    const r = await fetch(`${base}/api/sessao/entrar`, { method: "POST", body: JSON.stringify({ pessoaId: PESSOA_MARLON }) });
    expect(r.status).toBe(404);
    expect(await (await fetch(`${base}/api/sessao/modo`)).json()).toEqual({ modo: "google" });
  });
});

describe("login Google atrás de HTTPS", () => {
  it("com redirect https, o cookie de state e o de sessão levam Secure; e pode escutar fora de 127.0.0.1", async () => {
    const srv = await listen(0, "0.0.0.0", {
      segredoSessao: SEGREDO,
      sessao: {
        modo: "google",
        google: { clientId: CLIENT_ID, clientSecret: "x", redirectUri: "https://nod.acme.com.br/api/sessao/google/callback", fetchImpl: async () => respostaComIdToken(claimsBoas(Date.now())), pessoaPorEmail: async () => ({ tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON }) },
      },
    });
    try {
      const url = `http://127.0.0.1:${srv.port}`;
      const r = await fetch(`${url}/api/sessao/google`, { redirect: "manual" });
      const cookie = r.headers.get("set-cookie") ?? "";
      expect(cookie).toContain("Secure");
      const state = new URL(r.headers.get("location") ?? "").searchParams.get("state") ?? "";
      const cb = await fetch(`${url}/api/sessao/google/callback?code=x&state=${encodeURIComponent(state)}`, { redirect: "manual", headers: { cookie: cookie.split(";")[0] ?? "" } });
      expect(cb.headers.getSetCookie().find((c) => c.startsWith("nod_sessao="))).toContain("Secure");
    } finally {
      await srv.close();
    }
  });

  it("login real com o segredo de exemplo não sobe", () => {
    expect(() =>
      listen(0, "127.0.0.1", {
        segredoSessao: "troque-este-segredo-em-dev",
        sessao: { modo: "google", google: { clientId: "a", clientSecret: "b", redirectUri: "https://x/cb", pessoaPorEmail: async () => null } },
      }),
    ).toThrow(/NOD_SESSAO_SEGREDO recusado/);
  });
});
