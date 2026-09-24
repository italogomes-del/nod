import { COMANDO_GITHUB_NATIVO, ENV_TOKEN_GITHUB, SLUG_GITHUB, type OndeRodaConector } from "../../../contracts/github.ts";
import { APPS_MARKETPLACE } from "../../../contracts/marketplace.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { fraseSemJeito } from "../../../domain/github.ts";
import { formatoDeTokenGithub, garantirGithubSemConfiguracao, guardarComposioGithub, guardarTokenGithub } from "../../../use-cases/conectar-github.ts";
import { API_GITHUB } from "../../conectores-locais/github/backend-rest.ts";
import { registrarConector } from "../../../use-cases/registrar-conector.ts";
import { sondarConector } from "../../../use-cases/sondar-conector.ts";
import { criarClienteComposio } from "../../integracoes/composio.ts";
import { chavePrivadaValida, criarTokenDeInstalacao } from "../../integracoes/github-app.ts";
import type { Rota } from "../roteador.ts";
import { executar, type DentroDeTx } from "./dentro-de-tx.ts";

export type OpcoesRotasMarketplace = {
  dentro: DentroDeTx;
  cifrar: (s: string) => string;
  decifrar: (s: string) => string;
  fetchImpl?: typeof fetch;
  /** Onde o conector roda (ADR-047): muda a frase de quando nenhum jeito de conectar o GitHub serve. */
  onde?: OndeRodaConector;
  /** Base da API do GitHub; só teste. */
  apiGithub?: string;
  /** O App do tenant mudou: o token de instalação guardado em memória deixa de valer. */
  aoTrocarApp?: (tenantId: string) => void;
};

export function rotasMarketplace(op: OpcoesRotasMarketplace): Rota[] {
  const cliente = (chave: string) => criarClienteComposio(chave, op.fetchImpl);
  /**
   * revisto em 2026-09-21 (ADR-041): a curadoria deixou de ser a lista do que EXISTE, então
   * recusar por ausência nela barraria justamente o app recém-criado no painel. Quem valida é o
   * provedor — o `criarSessao` falha para toolkit que ele não conhece. Daqui sai só o nome exibido.
   */
  const acharApp = (slug: string) => {
    if (!/^[a-z0-9_-]{1,64}$/.test(slug)) throw new ErroDeDominio("nao_encontrado");
    return APPS_MARKETPLACE.find((a) => a.slug === slug) ?? { slug, nome: slug, descricao: "", categoria: "" };
  };
  return [
    /**
     * Jeito 3 (ADR-047): token pessoal no campo avançado. O GitHub é perguntado ANTES de guardar
     * (GET /user): token recusado não vira conector "conectado" que falha na primeira chamada. Guardar
     * e sondar são duas transações — a sonda decifra o env da linha já gravada.
     */
    { metodo: "POST", padrao: /^\/marketplace\/github\/token$/, async handler(ctx) {
      const body = await ctx.corpo() as { token?: unknown } | null;
      const token = typeof body?.token === "string" ? body.token.trim() : "";
      if (!formatoDeTokenGithub(token)) throw new ErroDeDominio("entrada_invalida");
      let aceito: boolean;
      try {
        const r = await (op.fetchImpl ?? fetch)(`${op.apiGithub ?? API_GITHUB}/user`, { headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "nod" }, redirect: "error", signal: AbortSignal.timeout(10_000) });
        if (r.status !== 200 && r.status !== 401 && r.status !== 403) throw new ErroDeDominio("conector_indisponivel");
        aceito = r.status === 200;
      } catch (e) {
        throw e instanceof ErroDeDominio ? e : new ErroDeDominio("conector_indisponivel");
      }
      if (!aceito) throw new ErroDeDominio("integracao_autenticacao");
      const salvo = await op.dentro(ctx.escopo, (d) => guardarTokenGithub(d, { token, cifrar: op.cifrar, decifrar: op.decifrar }));
      const s = await op.dentro(ctx.escopo, (d) => executar(d, sondarConector, { conectorId: salvo.id }));
      ctx.json(200, { conectado: s.ok, conectorId: salvo.id, conector: s.conector });
    } },
    /**
     * Jeito 5 (ADR-047): o GitHub App da organização, para as rotinas no executor de servidor. A
     * chave privada nunca volta: o GET diz só se há App e quais números. O POST gera um token de
     * instalação ANTES de guardar — app, instalação ou chave errados não viram configuração muda.
     */
    { metodo: "GET", padrao: /^\/marketplace\/github\/app$/, async handler(ctx) {
      const c = await op.dentro(ctx.escopo, (d) => d.repos.githubApp.config());
      ctx.json(200, c ? { configurado: true, appId: c.appId, instalacaoId: c.instalacaoId, podeTrocar: c.ownerId === ctx.escopo.pessoaId } : { configurado: false });
    } },
    { metodo: "POST", padrao: /^\/marketplace\/github\/app$/, async handler(ctx) {
      const body = await ctx.corpo() as { appId?: unknown; instalacaoId?: unknown; chavePrivada?: unknown } | null;
      const appId = typeof body?.appId === "string" || typeof body?.appId === "number" ? String(body.appId).trim() : "";
      const instalacaoId = typeof body?.instalacaoId === "string" || typeof body?.instalacaoId === "number" ? String(body.instalacaoId).trim() : "";
      const chavePem = typeof body?.chavePrivada === "string" ? body.chavePrivada.trim() : "";
      if (!/^[0-9]{1,12}$/.test(appId) || !/^[0-9]{1,15}$/.test(instalacaoId) || chavePem.length > 16_384 || !chavePrivadaValida(chavePem)) throw new ErroDeDominio("entrada_invalida");
      const atual = await op.dentro(ctx.escopo, (d) => d.repos.githubApp.config());
      if (atual && atual.ownerId !== ctx.escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
      await criarTokenDeInstalacao({ appId, instalacaoId, chavePem, agora: Date.now(), base: op.apiGithub, fetchImpl: op.fetchImpl });
      await op.dentro(ctx.escopo, (d) => d.repos.githubApp.salvar({ appId, instalacaoId, chavePrivadaCifrada: op.cifrar(chavePem) }));
      op.aoTrocarApp?.(ctx.escopo.tenantId);
      ctx.json(200, { configurado: true, appId, instalacaoId });
    } },
    { metodo: "POST", padrao: /^\/marketplace\/configurar$/, async handler(ctx) {
      const body = await ctx.corpo() as { chave?: unknown } | null;
      if (typeof body?.chave !== "string" || !body.chave.trim() || body.chave.length > 4096 || /[\r\n]/.test(body.chave)) throw new ErroDeDominio("entrada_invalida");
      const chave = body.chave.trim();
      await cliente(chave).validar();
      await op.dentro(ctx.escopo, async (d) => { await d.repos.composio.salvarChave(op.cifrar(chave)); });
      ctx.json(200, { configurado: true });
    } },
    { metodo: "POST", padrao: /^\/marketplace\/(?<slug>[a-z0-9-]+)\/conectar$/, async handler(ctx) {
      const app = acharApp(ctx.params.slug ?? "");
      if (app.slug === SLUG_GITHUB) {
        // ADR-047: o que já está pronto ganha. gh logado nesta máquina (ou o App da organização no
        // servidor) = conectado agora, sem login nem campo.
        const r = await op.dentro(ctx.escopo, (d) => garantirGithubSemConfiguracao(d, { pelaPessoa: true }));
        if (r.ok) { ctx.json(200, { conectado: true, conectorId: r.conector.id }); return; }
        // Sem gh: o token já colado serve sem nova tela; a sonda escolhe o jeito (token antes do Composio na máquina).
        const comToken = await op.dentro(ctx.escopo, async (d) => {
          const c = await d.repos.conectores.buscarPorSlug(SLUG_GITHUB);
          return c && c.ownerId === ctx.escopo.pessoaId && c.comando === COMANDO_GITHUB_NATIVO && c.env[ENV_TOKEN_GITHUB] ? c.id : null;
        });
        if (comToken) {
          const s = await op.dentro(ctx.escopo, (d) => executar(d, sondarConector, { conectorId: comToken }));
          if (s.ok) { ctx.json(200, { conectado: true, conectorId: comToken, jeito: "token" }); return; }
        }
      }
      const cifrada = await op.dentro(ctx.escopo, (d) => d.repos.composio.chave());
      if (!cifrada && app.slug === SLUG_GITHUB) { ctx.json(200, { conectado: false, frase: fraseSemJeito(op.onde ?? "maquina_da_pessoa") }); return; }
      if (!cifrada) throw new ErroDeDominio("integracao_nao_configurada");
      const chave = op.decifrar(cifrada);
      const c = cliente(chave);
      const userId = `nod:${ctx.escopo.tenantId}:${ctx.escopo.pessoaId}`;
      const sessao = await c.criarSessao(userId, app.slug);
      const link = await c.autorizar(sessao.id, app.slug);
      const conectorId = await op.dentro(ctx.escopo, async (d) => {
        if (app.slug === SLUG_GITHUB) {
          // ADR-047: o Composio é um jeito DENTRO do GitHub nativo; os nomes estáveis e as concessões ficam.
          const g = await guardarComposioGithub(d, { url: sessao.url, chave, cifrar: op.cifrar, decifrar: op.decifrar });
          await d.repos.composio.salvarSessao({ toolkit: app.slug, sessaoId: sessao.id, contaId: link.contaId, conectorId: g.id });
          return g.id;
        }
        const existente = await d.repos.conectores.buscarPorSlug(app.slug);
        if (existente && existente.ownerId !== ctx.escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
        const anterior = await d.repos.composio.sessao(app.slug);
        if (existente && anterior?.conectorId !== existente.id) throw new ErroDeDominio("estado_invalido");
        const env = { "x-api-key": chave };
        const conector = existente
          ? await d.repos.conectores.atualizarEndpoint(existente.id, sessao.url, op.cifrar(JSON.stringify(env)), Object.keys(env))
          : await executar(d, registrarConector, { nome: app.nome, slug: app.slug, transporte: "http", url: sessao.url, env, declaracao: "toca", cifrar: op.cifrar });
        if (!conector) throw new ErroDeDominio("estado_invalido");
        await d.repos.composio.salvarSessao({ toolkit: app.slug, sessaoId: sessao.id, contaId: link.contaId, conectorId: conector.id });
        return conector.id;
      });
      ctx.json(200, { url: link.url, conectorId });
    } },
    { metodo: "POST", padrao: /^\/marketplace\/(?<slug>[a-z0-9-]+)\/verificar$/, async handler(ctx) {
      const app = acharApp(ctx.params.slug ?? "");
      const { cifrada, sessao } = await op.dentro(ctx.escopo, async (d) => ({ cifrada: await d.repos.composio.chave(), sessao: await d.repos.composio.sessao(app.slug) }));
      if (!cifrada || !sessao) throw new ErroDeDominio("estado_invalido");
      const c = cliente(op.decifrar(cifrada));
      const ativo = await c.conectado(sessao.contaId, `nod:${ctx.escopo.tenantId}:${ctx.escopo.pessoaId}`, app.slug);
      if (!ativo) { ctx.json(200, { conectado: false }); return; }
      await c.fixarConta(sessao.sessaoId, app.slug, sessao.contaId);
      const r = await op.dentro(ctx.escopo, (d) => executar(d, sondarConector, { conectorId: sessao.conectorId }));
      ctx.json(200, { conectado: r.ok, conector: r.conector });
    } },
  ];
}
