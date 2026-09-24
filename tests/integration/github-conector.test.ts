import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { configGithubNativo } from "../../src/adapters/conectores-locais/github/nativo.ts";
import { rotasConectores } from "../../src/adapters/http/rotas/conectores.ts";
import type { DentroDeTx } from "../../src/adapters/http/rotas/dentro-de-tx.ts";
import { rotasMarketplace } from "../../src/adapters/http/rotas/marketplace.ts";
import { CAPACIDADES_GITHUB, COMANDO_GITHUB_NATIVO } from "../../src/contracts/github.ts";
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
import { PESSOA_MARLON, TENANT_LEAPY } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON };
const LEITURA = CAPACIDADES_GITHUB.filter((c) => c.readOnlyHint).map((c) => c.nome);
const TODAS = CAPACIDADES_GITHUB.map((c) => c.nome);

/**
 * Deps sobre a tx real com o que o registro automático toca de verdade: o detector de gh (falso, é
 * a máquina do teste) e os conectores vivos REAIS — a sonda spawna o servidor stdio nativo, que
 * lista os nomes estáveis sem chamar o gh. `carregar` não enxerga a tx do teste (como na composição
 * real não enxerga a tx aberta de pedir_acesso): quem responde é `resolverSemBanco`.
 */
function depsGithub(trx: Tx, escopo: Escopo, ghLogado: boolean): { deps: Deps; repos: Repos; sondas: string[] } {
  const base = depsSobre(trx, escopo);
  const sondas: string[] = [];
  const vivos = criarConectoresVivos({
    agora: () => Date.now(),
    carregar: async () => null,
    resolverSemBanco: async (c) => {
      sondas.push(c.id);
      const r = configGithubNativo({ onde: "maquina_da_pessoa", envConector: {}, ghLogado, app: null, ambiente: process.env });
      return r.ok ? { nome: c.slug, transporte: "stdio", comando: r.cfg.comando, args: r.cfg.args, env: r.cfg.env } : null;
    },
  });
  const deps: Deps = { ...base.deps, services: { ...base.deps.services, conectores: vivos, githubLocal: { ghLogado: async () => ghLogado } } };
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
        expect(await r.json()).toEqual({ conectado: true, conectorId: legado.id, jeito: "gh" });
        expect(await repos.conectores.buscar(legado.id)).toMatchObject({ transporte: "stdio", comando: COMANDO_GITHUB_NATIVO, url: null, habilitado: true, envCifrado: null });
        const lista = await (await srv.chamar(sessao, "GET", "conectores")).json() as { conectores: { slug: string; comando: string }[]; marketplace: { slug: string }[] };
        expect(lista.conectores.filter((c) => c.slug === "github")).toEqual([expect.objectContaining({ comando: COMANDO_GITHUB_NATIVO })]);
        expect(lista.marketplace.map((a) => a.slug)).toContain("github");
      } finally {
        await srv.close();
      }
    });
  });

  it("a marca nod: é do nod: registrar à mão com ela é recusado", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps } = depsGithub(trx, MARLON, true);
      await expect(registrarConector(deps, { nome: "x", slug: "x", transporte: "stdio", comando: COMANDO_GITHUB_NATIVO, cifrar: (s) => s })).rejects.toMatchObject({ codigo: "entrada_invalida" });
    });
  });
});
