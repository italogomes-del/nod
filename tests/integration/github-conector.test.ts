import { generateKeyPairSync, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { chaveDe, cifrar, decifrar } from "../../src/db/cifra.ts";
import { configGithubNativo } from "../../src/adapters/conectores-locais/github/nativo.ts";
import { rotasConectores } from "../../src/adapters/http/rotas/conectores.ts";
import type { DentroDeTx } from "../../src/adapters/http/rotas/dentro-de-tx.ts";
import { rotasMarketplace } from "../../src/adapters/http/rotas/marketplace.ts";
import { CAPACIDADES_GITHUB, COMANDO_GITHUB_NATIVO } from "../../src/contracts/github.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import { criarConectoresVivos } from "../../src/services/conectores-vivos.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { decidirAcesso } from "../../src/use-cases/decidir-acesso.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { pedirAcesso } from "../../src/use-cases/pedir-acesso.ts";
import { registrarConector } from "../../src/use-cases/registrar-conector.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_LEAPY } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_LEAPY, pessoaId: PESSOA_ANA };
const CHAVE = chaveDe("teste-github-local");
const LEITURA = CAPACIDADES_GITHUB.filter((c) => c.readOnlyHint).map((c) => c.nome);
const TODAS = CAPACIDADES_GITHUB.map((c) => c.nome);

/**
 * Deps sobre a tx real com o que o registro automático toca de verdade: o detector de gh (falso, é
 * a máquina do teste) e os conectores vivos REAIS — a sonda spawna o servidor stdio nativo, que
 * lista os nomes estáveis sem chamar o gh. `carregar` não enxerga a tx do teste (como na composição
 * real não enxerga a tx aberta de pedir_acesso): quem responde é `resolverSemBanco`.
 */
function depsGithub(trx: Tx, escopo: Escopo, ghLogado: boolean, opcoes: { carregarDaTx?: boolean } = {}): { deps: Deps; repos: Repos; sondas: string[] } {
  const base = depsSobre(trx, escopo);
  const sondas: string[] = [];
  const vivos = criarConectoresVivos({
    agora: () => Date.now(),
    // Como `carregar` da composição, mas lendo a tx do teste (a linha foi "gravada" em outra chamada da rota).
    carregar: async (id) => {
      if (!opcoes.carregarDaTx) return null;
      const c = await base.repos.conectores.buscar(id);
      if (!c) return null;
      const r = configGithubNativo({ onde: "maquina_da_pessoa", envConector: c.envCifrado ? (JSON.parse(decifrar(c.envCifrado, CHAVE)) as Record<string, string>) : {}, ghLogado, app: null, ambiente: process.env });
      return r.ok ? { nome: c.slug, transporte: "stdio", comando: r.cfg.comando, args: r.cfg.args, env: r.cfg.env } : null;
    },
    resolverSemBanco: async (c) => {
      sondas.push(c.id);
      const r = configGithubNativo({ onde: "maquina_da_pessoa", envConector: {}, ghLogado, app: null, ambiente: process.env });
      return r.ok ? { nome: c.slug, transporte: "stdio", comando: r.cfg.comando, args: r.cfg.args, env: r.cfg.env } : null;
    },
  });
  const deps: Deps = { ...base.deps, services: { ...base.deps.services, conectores: vivos, github: { prontoSemConfiguracao: async () => (ghLogado ? "gh" : null) } } };
  return { deps, repos: base.repos, sondas };
}

async function turnoDaConversa(repos: Repos, conversaId: string, agenteId: string): Promise<string> {
  const t = await repos.turnos.enfileirar({ conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "revise o PR 466", entradaConfianca: "confiavel", modelo: "m" });
  if (!t) throw new Error("turno");
  return t.id;
}

describeIntegracao("GitHub nativo: registro sem configuração (ADR-047)", () => {
  it("gh logado: pedir_acesso cria o conector nativo habilitado e o card já sai com o botão de permitir (escrita = catálogo inteiro); permitir concede github__<capacidade>", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Dev 1" });
      const { deps, repos, sondas } = depsGithub(trx, MARLON, true);
      const turnoId = await turnoDaConversa(repos, conversaId, agenteId);

      const r = await pedirAcesso(deps, { turnoId, conversaId, agenteId, conector: "github", capacidades: [], nivel: "escrita", nao_pedido: [] });
      expect(r.data.estado).toBe("aguardando_pessoa");
      expect(sondas).toHaveLength(1);
      const conector = await repos.conectores.buscarPorSlug("github");
      expect(conector).toMatchObject({ transporte: "stdio", comando: COMANDO_GITHUB_NATIVO, habilitado: true, env: {}, envCifrado: null, declaracao: "toca" });
      expect(conector?.catalogo.map((c) => [c.nome, c.readOnlyHint])).toEqual(CAPACIDADES_GITHUB.map((c) => [c.nome, c.readOnlyHint]));

      const proposta = await repos.propostas.buscar(r.data.proposta_id);
      expect(proposta?.payload).toEqual({ kind: "acesso", turnoId, conector: "github", capacidades: TODAS, nivel: "escrita", naoPedido: [] });
      expect(await repos.decisoes.buscar(r.data.proposta_id)).toMatchObject({ tipo: "acesso", estado: "pendente", frase: "Dev 1 precisa ler e alterar seu GitHub (9 ações)." });

      const decidido = await decidirAcesso(deps, { decisaoId: r.data.proposta_id, recusar: false, executor: "catcher" });
      expect(decidido.data).toMatchObject({ concessoes: 9 });
      const plano = await emitirPlanoTurno(deps, { turnoId, machineId: randomUUID(), executor: "catcher" });
      expect(plano.data.catalogo.ferramentas.map((f) => f.nome)).toEqual(expect.arrayContaining(["github__pr_ver", "github__pr_diff", "github__pr_comentar", "github__pr_revisar"]));
      expect(plano.data.catalogo.ferramentas.find((f) => f.nome === "github__pr_comentar")?.readOnlyHint).toBe(false);

      // O segundo pedido não recria nem ressonda: o conector já está pronto.
      const turno2 = await turnoDaConversa(repos, conversaId, agenteId);
      await pedirAcesso(deps, { turnoId: turno2, conversaId, agenteId, conector: "github", capacidades: ["pr_ver"], nivel: "leitura", nao_pedido: [] });
      expect(sondas).toHaveLength(1);
      expect((await repos.conectores.listar()).filter((c) => c.slug === "github")).toHaveLength(1);
    });
  });

  it("pedido de leitura sem capacidades nomeadas entra só com as de leitura", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const { deps, repos } = depsGithub(trx, MARLON, true);
      const r = await pedirAcesso(deps, { turnoId: await turnoDaConversa(repos, conversaId, agenteId), conversaId, agenteId, conector: "github", capacidades: [], nivel: "leitura", nao_pedido: [] });
      expect((await repos.propostas.buscar(r.data.proposta_id))?.payload).toMatchObject({ capacidades: LEITURA, nivel: "leitura" });
      expect((await repos.decisoes.buscar(r.data.proposta_id))?.frase).toContain("Não inclui: comentar, revisar pull requests.");
    });
  });

  it("sem gh logado: nada nasce e o pedido vira o card de conexão de sempre", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const { deps, repos, sondas } = depsGithub(trx, MARLON, false);
      const r = await pedirAcesso(deps, { turnoId: await turnoDaConversa(repos, conversaId, agenteId), conversaId, agenteId, conector: "github", capacidades: [], nivel: "leitura", nao_pedido: [] });
      expect((await repos.propostas.buscar(r.data.proposta_id))?.payload).toMatchObject({ conectar: true, conector: "github" });
      expect(await repos.decisoes.buscar(r.data.proposta_id)).toBeNull();
      expect(await repos.conectores.buscarPorSlug("github")).toBeNull();
      expect(sondas).toHaveLength(0);
    });
  });

  it("o github do Composio (HTTP) de antes: o agente nunca o troca por baixo; o clique em Conectar troca no lugar, mesmo id, sem segredo na listagem", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const { deps, repos } = depsGithub(trx, MARLON, true);
      const legado = await repos.conectores.criar({ nome: "GitHub", slug: "github", transporte: "http", url: "https://backend.composio.dev/tool_router/v3/trs_x/mcp", envCifrado: "v1:x:y:z", envChaves: ["x-api-key"], declaracao: "toca" });
      if (!legado) throw new Error("legado");

      const pedido = await pedirAcesso(deps, { turnoId: await turnoDaConversa(repos, conversaId, agenteId), conversaId, agenteId, conector: "github", capacidades: [], nivel: "leitura", nao_pedido: [] });
      expect((await repos.propostas.buscar(pedido.data.proposta_id))?.payload).toMatchObject({ conectar: true });
      expect(await repos.conectores.buscar(legado.id)).toMatchObject({ transporte: "http" });

      const dentro: DentroDeTx = (escopo, fn) => fn({ ...deps, escopo, repos: depsSobre(trx, escopo).repos });
      const srv = await servidorDeTeste([
        ...rotasMarketplace({ dentro, cifrar: (s) => s, decifrar: (s) => s, fetchImpl: async () => { throw new Error("o GitHub pelo gh não chama o Composio"); } }),
        ...rotasConectores({ dentro, cifrar: (s) => s, decifrar: (s) => s, fetchImpl: async () => { throw new Error("sem provedor"); } }),
      ]);
      try {
        const sessao = await srv.entrar("marlon");
        const r = await srv.chamar(sessao, "POST", "marketplace/github/conectar");
        expect(r.status).toBe(200);
        expect(await r.json()).toEqual({ conectado: true, conectorId: legado.id });
        expect(await repos.conectores.buscar(legado.id)).toMatchObject({ transporte: "stdio", comando: COMANDO_GITHUB_NATIVO, url: null, habilitado: true, envCifrado: null });
        const lista = await (await srv.chamar(sessao, "GET", "conectores")).json() as { conectores: { slug: string; comando: string }[]; marketplace: { slug: string }[] };
        expect(lista.conectores.filter((c) => c.slug === "github")).toEqual([expect.objectContaining({ comando: COMANDO_GITHUB_NATIVO })]);
        expect(lista.marketplace.map((a) => a.slug)).toContain("github");
      } finally {
        await srv.close();
      }
    });
  });

  it("token pessoal (campo avançado): o GitHub é perguntado antes, o token vai cifrado para o env e o conector sonda pelo jeito token", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, repos } = depsGithub(trx, MARLON, false, { carregarDaTx: true });
      const dentro: DentroDeTx = (escopo, fn) => fn({ ...deps, escopo, repos: depsSobre(trx, escopo).repos });
      const perguntas: string[] = [];
      const fakeFetch: typeof fetch = async (url, init) => {
        perguntas.push(String(url));
        return new Headers(init?.headers).get("authorization") === "Bearer ghp_aceitoaceitoaceitoaceito1" ? Response.json({ login: "marlon" }) : new Response("{}", { status: 401 });
      };
      const cifra = (s: string) => cifrar(s, CHAVE);
      const srv = await servidorDeTeste([
        ...rotasMarketplace({ dentro, cifrar: cifra, decifrar: (s) => decifrar(s, CHAVE), fetchImpl: fakeFetch, apiGithub: "https://api.github.test" }),
        ...rotasConectores({ dentro, cifrar: cifra, decifrar: (s) => decifrar(s, CHAVE), fetchImpl: async () => { throw new Error("sem provedor"); } }),
      ]);
      try {
        const sessao = await srv.entrar("marlon");
        expect((await srv.chamar(sessao, "POST", "marketplace/github/token", { token: "nao-e-token" })).status).toBe(400);
        expect((await srv.chamar(sessao, "POST", "marketplace/github/token", { token: "ghp_recusadorecusadorecusado1" })).status).toBe(403);
        expect(await repos.conectores.buscarPorSlug("github")).toBeNull();

        const r = await srv.chamar(sessao, "POST", "marketplace/github/token", { token: "ghp_aceitoaceitoaceitoaceito1" });
        expect(r.status).toBe(200);
        expect(await r.json()).toMatchObject({ conectado: true, conector: { slug: "github", habilitado: true, env: { GITHUB_TOKEN: true } } });
        expect(perguntas).toEqual(["https://api.github.test/user", "https://api.github.test/user"]);
        const guardado = await repos.conectores.buscarPorSlug("github");
        expect(guardado?.envCifrado).not.toContain("ghp_");
        expect(JSON.parse(decifrar(guardado?.envCifrado ?? "", CHAVE))).toEqual({ GITHUB_TOKEN: "ghp_aceitoaceitoaceitoaceito1" });
        expect(guardado?.catalogo).toHaveLength(9);
        const lista = await (await srv.chamar(sessao, "GET", "conectores")).text();
        expect(lista).not.toContain("ghp_aceito");

        // Sem gh, Conectar usa o token já guardado: nada de Composio, nada de nova tela.
        expect(await (await srv.chamar(sessao, "POST", "marketplace/github/conectar")).json()).toEqual({ conectado: true, conectorId: guardado?.id, jeito: "token" });
      } finally {
        await srv.close();
      }
    });
  });

  it("sem gh e sem token: o Composio vira um jeito DENTRO do GitHub nativo — mesmos nomes, menos o que o Composio não tem", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps, repos } = depsGithub(trx, MARLON, false, { carregarDaTx: true });
      const dentro: DentroDeTx = (escopo, fn) => fn({ ...deps, escopo, repos: depsSobre(trx, escopo).repos });
      await repos.composio.salvarChave(cifrar("ak_segredo", CHAVE));
      const userId = `nod:${TENANT_LEAPY}:${PESSOA_MARLON}`;
      const fakeFetch: typeof fetch = async (url) => {
        const u = String(url);
        if (u.endsWith("/tool_router/session")) return Response.json({ session_id: "trs_gh", mcp: { url: "https://backend.composio.dev/tool_router/v3/trs_gh/mcp" } });
        if (u.endsWith("/link")) return Response.json({ redirect_url: "https://connect.composio.dev/link/lk_gh", connected_account_id: "ca_gh" });
        if (u.endsWith("/connected_accounts/ca_gh")) return Response.json({ status: "ACTIVE", user_id: userId, toolkit: { slug: "github" } });
        if (u.endsWith("/tool_router/session/trs_gh")) return Response.json({});
        throw new Error(`inesperado: ${u}`);
      };
      const cifra = (s: string) => cifrar(s, CHAVE);
      const srv = await servidorDeTeste(rotasMarketplace({ dentro, cifrar: cifra, decifrar: (s) => decifrar(s, CHAVE), fetchImpl: fakeFetch }));
      try {
        const sessao = await srv.entrar("marlon");
        const inicio = await (await srv.chamar(sessao, "POST", "marketplace/github/conectar")).json() as { url: string; conectorId: string };
        expect(inicio.url).toBe("https://connect.composio.dev/link/lk_gh");
        const antes = await repos.conectores.buscar(inicio.conectorId);
        expect(antes).toMatchObject({ slug: "github", comando: COMANDO_GITHUB_NATIVO, habilitado: false, env: { COMPOSIO_API_KEY: true, COMPOSIO_URL: true } });
        expect(antes?.envCifrado).not.toContain("ak_segredo");

        expect(await (await srv.chamar(sessao, "POST", "marketplace/github/verificar")).json()).toMatchObject({ conectado: true, conector: { habilitado: true } });
        const depois = await repos.conectores.buscar(inicio.conectorId);
        expect(depois?.catalogo.map((c) => c.nome)).toEqual(["pr_ver", "pr_arquivos", "pr_comentarios", "arquivo_ler", "issue_ver", "pr_comentar", "pr_revisar"]);
      } finally {
        await srv.close();
      }
    });
  });

  it("sem gh, sem token e sem Composio: Conectar GitHub devolve a frase do que fazer, não um erro", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps } = depsGithub(trx, MARLON, false);
      const dentro: DentroDeTx = (escopo, fn) => fn({ ...deps, escopo, repos: depsSobre(trx, escopo).repos });
      const srv = await servidorDeTeste(rotasMarketplace({ dentro, cifrar: (s) => s, decifrar: (s) => s }));
      try {
        const sessao = await srv.entrar("marlon");
        const r = await (await srv.chamar(sessao, "POST", "marketplace/github/conectar")).json() as { conectado: boolean; frase: string };
        expect(r.conectado).toBe(false);
        expect(r.frase).toContain("rode `gh auth login` nesta máquina");
      } finally {
        await srv.close();
      }
    });
  });

  it("GitHub App da organização (0027): do tenant — a Ana lê, só quem cadastrou troca; a rota gera um token antes de guardar e nunca devolve a chave", async () => {
    await withRollback(MARLON, async (trx) => {
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
      const { deps, repos } = depsGithub(trx, MARLON, false);
      const dentro: DentroDeTx = (escopo, fn) => fn({ ...deps, escopo, repos: depsSobre(trx, escopo).repos });
      const trocas: string[] = [];
      let status = 201;
      const fakeFetch: typeof fetch = async (url) => {
        expect(String(url)).toBe("https://api.github.test/app/installations/987/access_tokens");
        return Response.json({ token: "ghs_tokendeinstalacao1234567890", expires_at: "2099-01-01T00:00:00Z" }, { status });
      };
      const srv = await servidorDeTeste(rotasMarketplace({ dentro, cifrar: (s) => cifrar(s, CHAVE), decifrar: (s) => decifrar(s, CHAVE), fetchImpl: fakeFetch, apiGithub: "https://api.github.test", aoTrocarApp: (t) => trocas.push(t) }));
      try {
        const sessao = await srv.entrar("marlon");
        expect(await (await srv.chamar(sessao, "GET", "marketplace/github/app")).json()).toEqual({ configurado: false });
        expect((await srv.chamar(sessao, "POST", "marketplace/github/app", { appId: "12a", instalacaoId: "987", chavePrivada: pem })).status).toBe(400);
        expect((await srv.chamar(sessao, "POST", "marketplace/github/app", { appId: "123", instalacaoId: "987", chavePrivada: "não é pem" })).status).toBe(400);
        status = 404;
        expect((await srv.chamar(sessao, "POST", "marketplace/github/app", { appId: "123", instalacaoId: "987", chavePrivada: pem })).status).toBe(403);
        expect(await repos.githubApp.config()).toBeNull();
        status = 201;
        expect((await srv.chamar(sessao, "POST", "marketplace/github/app", { appId: "123", instalacaoId: "987", chavePrivada: pem })).status).toBe(200);
        expect(trocas).toEqual([TENANT_LEAPY]);
        const get = await (await srv.chamar(sessao, "GET", "marketplace/github/app")).text();
        expect(JSON.parse(get)).toEqual({ configurado: true, appId: "123", instalacaoId: "987", podeTrocar: true });
        const guardada = await repos.githubApp.config();
        expect(guardada?.chavePrivadaCifrada).not.toContain("PRIVATE KEY");
        expect(decifrar(guardada?.chavePrivadaCifrada ?? "", CHAVE)).toBe(pem.trim());
      } finally {
        await srv.close();
      }

      await vincularEscopo(trx, ANA);
      const daAna = criarRepos(trx, ANA);
      expect(await daAna.githubApp.config()).toMatchObject({ appId: "123", ownerId: PESSOA_MARLON });
      await expectRejected(trx, () => daAna.githubApp.salvar({ appId: "999", instalacaoId: "1", chavePrivadaCifrada: "x" }), "42501");
      await vincularEscopo(trx, MARLON);
    });
  });

  it("no servidor compartilhado, com o App da organização, o GitHub também nasce sozinho — pelo jeito app, nunca pelo gh", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const base = depsSobre(trx, MARLON);
      const jeitos: string[] = [];
      const vivos = criarConectoresVivos({
        agora: () => Date.now(),
        carregar: async () => null,
        resolverSemBanco: async (c) => {
          const r = configGithubNativo({ onde: "servidor", envConector: {}, ghLogado: true, app: { token: "ghs_x", expiraEm: Date.now() + 3_000_000 }, ambiente: process.env });
          if (!r.ok) return null;
          jeitos.push(r.cfg.jeito);
          return { nome: c.slug, transporte: "stdio", comando: r.cfg.comando, args: r.cfg.args, env: r.cfg.env, expiraEm: r.cfg.expiraEm };
        },
      });
      const deps: Deps = { ...base.deps, services: { ...base.deps.services, conectores: vivos, github: { prontoSemConfiguracao: async () => "app" } } };
      const r = await pedirAcesso(deps, { turnoId: await turnoDaConversa(base.repos, conversaId, agenteId), conversaId, agenteId, conector: "github", capacidades: ["pr_ver"], nivel: "leitura", nao_pedido: [] });
      expect(jeitos).toEqual(["app"]);
      expect(await base.repos.decisoes.buscar(r.data.proposta_id)).toMatchObject({ tipo: "acesso", estado: "pendente" });
    });
  });

  it("a marca nod: é do nod: registrar à mão com ela é recusado", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps } = depsGithub(trx, MARLON, true);
      await expect(registrarConector(deps, { nome: "x", slug: "x", transporte: "stdio", comando: COMANDO_GITHUB_NATIVO, cifrar: (s) => s })).rejects.toMatchObject({ codigo: "entrada_invalida" });
    });
  });
});
