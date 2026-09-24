import { SLUG_GITHUB } from "../../../contracts/github.ts";
import { APPS_MARKETPLACE } from "../../../contracts/marketplace.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { garantirGithubPeloGh } from "../../../use-cases/conectar-github.ts";
import { registrarConector } from "../../../use-cases/registrar-conector.ts";
import { sondarConector } from "../../../use-cases/sondar-conector.ts";
import { criarClienteComposio } from "../../integracoes/composio.ts";
import type { Rota } from "../roteador.ts";
import { executar, type DentroDeTx } from "./dentro-de-tx.ts";

export function rotasMarketplace(op: { dentro: DentroDeTx; cifrar: (s: string) => string; decifrar: (s: string) => string; fetchImpl?: typeof fetch }): Rota[] {
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
        // ADR-047: o que já está pronto ganha. gh logado nesta máquina = conectado agora, sem login nem campo.
        const r = await op.dentro(ctx.escopo, (d) => garantirGithubPeloGh(d, { pelaPessoa: true }));
        if (r.ok) { ctx.json(200, { conectado: true, conectorId: r.conector.id, jeito: "gh" }); return; }
      }
      const cifrada = await op.dentro(ctx.escopo, (d) => d.repos.composio.chave());
      if (!cifrada) throw new ErroDeDominio("integracao_nao_configurada");
      const chave = op.decifrar(cifrada);
      const c = cliente(chave);
      const userId = `nod:${ctx.escopo.tenantId}:${ctx.escopo.pessoaId}`;
      const sessao = await c.criarSessao(userId, app.slug);
      const link = await c.autorizar(sessao.id, app.slug);
      const conectorId = await op.dentro(ctx.escopo, async (d) => {
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
