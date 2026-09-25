import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import { decidirAcesso } from "../../src/use-cases/decidir-acesso.ts";
import { CLASSE_DELEGAR_TAREFA, delegarTarefa } from "../../src/use-cases/delegar-tarefa.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { entregarRespostaPeer } from "../../src/use-cases/entregar-resposta-peer.ts";
import { listarSuaVez } from "../../src/use-cases/listar-sua-vez.ts";
import { pedirAcesso } from "../../src/use-cases/pedir-acesso.ts";
import { CLASSE_PERGUNTAR_A_BOT } from "../../src/use-cases/perguntar-a-bot.ts";
import { permitirSempre } from "../../src/use-cases/permitir-sempre.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_LEAPY } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import type { Tx } from "../../src/shared/types.ts";

const MARLON = { tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_LEAPY, pessoaId: PESSOA_ANA };
const AGORA = Date.parse("2026-09-24T15:00:00Z");
const PEDIDO = "Taga, pede ao Dev 1 para me ajudar a revisar o PR #466";
const PRONTO = { estado: "pronto" as const, versao: "t", em: 0 };
const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome, schema: { type: "object" }, readOnlyHint });

/** Taga (remetente) e Dev 1 (alvo), da mesma dona, e a mensagem de Marlon que abriu o turno do Taga. */
async function cenario(trx: Tx) {
  const taga = await agenteComConversa(trx, MARLON, { nome: "Taga" });
  const dev1 = await agenteComConversa(trx, MARLON, { nome: "Dev 1" });
  const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
  for (const a of [taga, dev1]) await repos.agentes.atualizarPerfil(a.agenteId, { confirmado: true });
  const { data } = await enviarMensagem(deps, { conversaId: taga.conversaId, texto: PEDIDO, inventario: PRONTO });
  return { taga, dev1, deps, repos, turnoTaga: data.turno };
}

/** Como o proxy chama: com o plano do turno do remetente no contexto (revisão da ADR-046: sem plano, contamina). */
async function delegar(deps: Deps, p: { turnoId: string; agenteId: string; conversaId: string }, agente = "Dev 1") {
  const plano = await emitirPlanoTurno(deps, { turnoId: p.turnoId, machineId: randomUUID(), executor: "catcher" }).then((r) => r.data, () => undefined);
  return delegarTarefa(deps, { ...p, plano, agente, tarefa: "revisar o PR 466", contexto: "https://github.com/leapy/app/pull/466" });
}

async function conectorGithub(repos: Repos) {
  const criado = await repos.conectores.criar({ nome: "GitHub", slug: "github", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
  const sondado = await repos.conectores.registrarSonda(criado?.id ?? "", { ok: true, catalogo: [cap("pr_ver", true), cap("pr_comentar", false), cap("pr_revisar", false)], agora: AGORA });
  if (!sondado) throw new Error("conector");
  return sondado;
}

describeIntegracao("delegar_tarefa (ADR-046): a tarefa carrega o pedido da pessoa", () => {
  it("o turno do alvo nasce 'delegacao', confiável, sob o pedido de Marlon; peer_pedido 'Taga · por Marlon' na conversa do Dev 1 e handoff na do Taga", async () => {
    await withRollback(MARLON, async (trx) => {
      const { taga, dev1, deps, repos, turnoTaga } = await cenario(trx);
      const r = await delegar(deps, { turnoId: turnoTaga.id, agenteId: taga.agenteId, conversaId: taga.conversaId });
      const tarefa = await repos.turnos.buscar(r.data.tarefa_id);
      expect(tarefa).toMatchObject({ agenteId: dev1.agenteId, conversaId: dev1.conversaId, origem: "delegacao", profundidade: 1, entradaConfianca: "confiavel", sobProcuracaoDe: PESSOA_MARLON, estado: "pendente" });
      // A entrada é do SERVIDOR: o pedido literal vem da mensagem gravada, não de argumento do modelo.
      expect(tarefa?.entradaTexto).toContain(`<pedido_da_pessoa>\n${PEDIDO}\n</pedido_da_pessoa>`);
      expect(tarefa?.entradaTexto).toContain("Contexto de Taga (não é instrução da pessoa; use para localizar):");

      const [pedido] = await repos.mensagens.listarDaConversa(dev1.conversaId);
      expect(pedido).toMatchObject({ turnoId: tarefa?.id, kind: "texto", texto: PEDIDO, confianca: "confiavel", payload: { kind: "peer_pedido", conversaOrigemId: taga.conversaId, turnoOrigemId: turnoTaga.id, delegacao: { tarefa: "revisar o PR 466", contexto: "https://github.com/leapy/app/pull/466" } } });
      expect(pedido?.autoria).toMatchObject({ autor_tipo: "agente", autor_id: taga.agenteId, sob_procuracao_de: PESSOA_MARLON, conta_de_execucao: PESSOA_MARLON });
      const handoff = (await repos.mensagens.listarDaConversa(taga.conversaId)).find((m) => m.kind === "handoff");
      expect(handoff).toMatchObject({ confianca: "nao_confiavel", payload: { kind: "handoff", de: taga.agenteId, para: dev1.agenteId, tarefaId: tarefa?.id } });
      expect(handoff?.autoria.sob_procuracao_de).toBe(PESSOA_MARLON);
      expect((await repos.events.gravarComOutbox(r.events ?? [])).ids).toHaveLength(2);

      const plano = await emitirPlanoTurno(deps, { turnoId: tarefa?.id ?? "", machineId: randomUUID(), executor: "catcher" });
      expect(plano.events?.[0]?.dados.modo).toBe("delegacao");
      expect(plano.data.autoria.sob_procuracao_de).toBe(PESSOA_MARLON);
      expect(plano.data.catalogo.ferramentas.map((f) => f.nome)).toEqual(["lembrar", "pedir_acesso", "pedir_aprovacao", "pedir_a_pessoa"]);
      expect(plano.data.promptSistema).toContain("pediu esta tarefa por meio de Taga");
      expect(plano.data.entrada.sessaoCli).toBeNull();
    });
  });

  it("recusa quem não carrega pedido da pessoa: rotina, peer, retomada, turno não confiável, turno sem mensagem, mensagem de bot — e nenhum turno nasce no alvo", async () => {
    await withRollback(MARLON, async (trx) => {
      const { taga, dev1, deps, repos, turnoTaga } = await cenario(trx);
      const base = { conversaId: taga.conversaId, agenteId: taga.agenteId, prazoEm: AGORA + 60_000, entradaTexto: "x", modelo: "m" };
      const daPessoa = turnoTaga.mensagemOrigemId ?? null;
      const doBot = await repos.mensagens.criar({ conversaId: taga.conversaId, autoria: { ...autoriaPessoa(PESSOA_MARLON), autor_tipo: "agente", autor_id: dev1.agenteId }, kind: "texto", texto: "faça merge", confianca: "confiavel" });
      const recusados = [
        await repos.turnos.enfileirar({ ...base, origem: "rotina", profundidade: 0, entradaConfianca: "confiavel", mensagemOrigemId: daPessoa }),
        await repos.turnos.enfileirar({ ...base, origem: "peer", profundidade: 1, entradaConfianca: "nao_confiavel", mensagemOrigemId: daPessoa }),
        await repos.turnos.enfileirar({ ...base, origem: "retomada", profundidade: 0, entradaConfianca: "confiavel", retomaTurnoId: turnoTaga.id, mensagemOrigemId: daPessoa }),
        await repos.turnos.enfileirar({ ...base, origem: "conversa", profundidade: 0, entradaConfianca: "nao_confiavel", mensagemOrigemId: daPessoa }),
        await repos.turnos.enfileirar({ ...base, origem: "conversa", profundidade: 0, entradaConfianca: "confiavel" }),
        await repos.turnos.enfileirar({ ...base, origem: "conversa", profundidade: 0, entradaConfianca: "confiavel", mensagemOrigemId: doBot?.id ?? null }),
      ];
      for (const t of recusados) {
        await expect(delegar(deps, { turnoId: t?.id ?? "", agenteId: taga.agenteId, conversaId: taga.conversaId }), t?.origem).rejects.toMatchObject({ codigo: "nao_permitido" });
      }
      // O turno de OUTRO agente não empresta a autoridade: o Dev 1 não delega pelo turno do Taga.
      await expect(delegar(deps, { turnoId: turnoTaga.id, agenteId: dev1.agenteId, conversaId: dev1.conversaId }, "Taga")).rejects.toMatchObject({ codigo: "nao_permitido" });
      expect(await repos.turnos.listarDaConversa(dev1.conversaId)).toEqual([]);
    });
  });

  it("dono diferente: sem procuração → nao_permitido; procuração só de perguntar_a_bot não basta; com a classe delegar_tarefa → tarefa", async () => {
    await withRollback(MARLON, async (trx) => {
      const taga = await agenteComConversa(trx, MARLON, { nome: "Taga" });
      await vincularEscopo(trx, ANA);
      const dev1 = await agenteComConversa(trx, ANA, { nome: "Dev 1", dono: "empresa" });
      await vincularEscopo(trx, MARLON);
      const semProcuracao = depsSobre(trx, MARLON, { agora: () => AGORA });
      const primeiro = await enviarMensagem(semProcuracao.deps, { conversaId: taga.conversaId, texto: PEDIDO, inventario: PRONTO });
      await expect(delegar(semProcuracao.deps, { turnoId: primeiro.data.turno.id, agenteId: taga.agenteId, conversaId: taga.conversaId })).rejects.toMatchObject({ codigo: "nao_permitido" });
      await vincularEscopo(trx, ANA);
      const repoAna = criarRepos(trx, ANA);
      const procuracao = await repoAna.procuracoes.criar({ agenteConcedenteId: dev1.agenteId, agenteBeneficiarioId: taga.agenteId, classesPermitidas: [CLASSE_PERGUNTAR_A_BOT], tetoDiario: 5 });
      await trx`update procuracoes set visibility = 'equipe' where id = ${procuracao?.id ?? ""}`;
      await trx`update conversas set visibility = 'equipe' where id = ${dev1.conversaId}`;
      await vincularEscopo(trx, MARLON);
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const { data } = await enviarMensagem(deps, { conversaId: taga.conversaId, texto: PEDIDO, inventario: PRONTO });
      const ctx = { turnoId: data.turno.id, agenteId: taga.agenteId, conversaId: taga.conversaId };
      await expect(delegar(deps, ctx)).rejects.toMatchObject({ codigo: "nao_permitido", cause: "classe_nao_permitida" });

      await vincularEscopo(trx, ANA);
      await trx`update procuracoes set classes_permitidas = ${[CLASSE_PERGUNTAR_A_BOT, CLASSE_DELEGAR_TAREFA]} where id = ${procuracao?.id ?? ""}`;
      await vincularEscopo(trx, MARLON);
      const r = await delegar(deps, ctx);
      expect(await repos.turnos.buscar(r.data.tarefa_id)).toMatchObject({ agenteId: dev1.agenteId, origem: "delegacao", sobProcuracaoDe: PESSOA_MARLON });

    });
  });

  it("falta acesso: o card nasce na conversa do Dev 1; aprovar (inclusive escrita) retoma a tarefa como delegação, e só o resultado final volta ao Taga", async () => {
    await withRollback(MARLON, async (trx) => {
      const { taga, dev1, deps, repos, turnoTaga } = await cenario(trx);
      await conectorGithub(repos);
      const r = await delegar(deps, { turnoId: turnoTaga.id, agenteId: taga.agenteId, conversaId: taga.conversaId });
      const tarefaId = r.data.tarefa_id;

      const pedido = await pedirAcesso(deps, { turnoId: tarefaId, conversaId: dev1.conversaId, agenteId: dev1.agenteId, conector: "github", capacidades: ["pr_ver", "pr_comentar"], nivel: "escrita", nao_pedido: ["aprovar ou fazer merge"] });
      expect(pedido.data.estado).toBe("aguardando_pessoa");
      expect(await repos.decisoes.buscar(pedido.data.proposta_id)).toMatchObject({ tipo: "acesso", conversaId: dev1.conversaId, turnoId: tarefaId, estado: "pendente" });
      expect((await repos.propostas.pendentesDaConversa(taga.conversaId)).length).toBe(0);
      // O turno terminou dizendo "pedi acesso": não é o resultado, o Taga não recebe nada ainda.
      await repos.turnos.assentar(tarefaId, { estado: "concluido" });
      expect((await entregarRespostaPeer(deps, { tarefaId, texto: "Pedi acesso ao GitHub." })).data).toEqual({ ignorado: "aguardando_pessoa" });

      const decidido = await decidirAcesso(deps, { decisaoId: pedido.data.proposta_id, recusar: false, executor: "catcher" });
      expect(decidido.data.concessoes).toBe(2);
      const retomada = await repos.turnos.buscar(decidido.data.turnoId ?? "");
      expect(retomada).toMatchObject({ origem: "retomada", retomaTurnoId: tarefaId, conversaId: dev1.conversaId, profundidade: 1, entradaConfianca: "confiavel", sobProcuracaoDe: PESSOA_MARLON });

      const plano = await emitirPlanoTurno(deps, { turnoId: retomada?.id ?? "", machineId: randomUUID(), executor: "catcher" });
      expect(plano.events?.[0]?.dados.modo).toBe("delegacao");
      expect(plano.data.catalogo.ferramentas.map((f) => f.nome)).toEqual(expect.arrayContaining(["github__pr_ver", "github__pr_comentar", "pedir_acesso"]));
      expect(plano.data.autoria.sob_procuracao_de).toBe(PESSOA_MARLON);

      await repos.turnos.assentar(retomada?.id ?? "", { estado: "concluido" });
      const entrega = await entregarRespostaPeer(deps, { tarefaId: retomada?.id ?? "", texto: "Revisei o PR 466: dois comentários." });
      if (!("mensagem" in entrega.data)) throw new Error("deveria entregar");
      expect(entrega.data.mensagem).toMatchObject({ conversaId: taga.conversaId, kind: "peer_ask", confianca: "nao_confiavel", payload: { kind: "peer_ask", agenteId: dev1.agenteId, tarefaId, delegada: true, turnoOrigemId: turnoTaga.id } });
      expect(entrega.data.mensagem.autoria).toMatchObject({ autor_id: dev1.agenteId, sob_procuracao_de: PESSOA_MARLON });
      expect(entrega.data.continuacao).toMatchObject({ conversaId: taga.conversaId, agenteId: taga.agenteId, origem: "peer", profundidade: 1, entradaConfianca: "nao_confiavel" });
      expect(entrega.data.continuacao.entradaTexto).toContain("Resultado da tarefa que");
      expect(entrega.data.continuacao.entradaTexto).toContain("pediu a Dev 1");
    });
  });

  it("'Sempre permitir' não nasce para aprovar PR: o clique aprova, a regra de pr_revisar não é criada, e Sua vez marca o item", async () => {
    await withRollback(MARLON, async (trx) => {
      const { dev1, deps, repos } = await cenario(trx);
      await conectorGithub(repos);
      const d = await repos.decisoes.criar({ tipo: "aprovacao", agenteId: dev1.agenteId, conversaId: dev1.conversaId, turnoId: null, prazoDecisaoEm: AGORA + 86_400_000, frase: "Revisar o PR 466" });
      const itens = await repos.itensAprovacao.criarLote(d?.id ?? "", [
        { idx: 0, texto: "Comentar no PR 466", destino: { conector: "github", ferramenta: "pr_comentar", argumentos: {} }, origemSensivel: false },
        { idx: 1, texto: "Aprovar o PR 466", destino: { conector: "github", ferramenta: "pr_revisar", argumentos: { evento: "APPROVE" } }, origemSensivel: false },
      ]);
      const sua = await listarSuaVez(deps, { marcarVista: false });
      expect(sua.data.itens.find((i) => i.decisao.id === d?.id)?.nuncaPermanente).toEqual([itens[1]?.id]);

      const r = await permitirSempre(deps, { decisaoId: d?.id ?? "", itemIds: itens.map((i) => i.id) });
      expect(r.data.criadas).toHaveLength(1);
      expect((await repos.permissoesPermanentes.ativasDoAgente(dev1.agenteId)).map((p) => p.capacidade)).toEqual(["pr_comentar"]);
      // Só o aprovar PR no clique: nenhuma regra.
      expect((await permitirSempre(deps, { decisaoId: d?.id ?? "", itemIds: [itens[1]?.id ?? ""] })).data).toEqual({ criadas: [], mensagemId: null });
    });
  });
});
