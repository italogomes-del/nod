import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import { chamarFerramenta } from "../../src/use-cases/chamar-ferramenta.ts";
import { decidirAcesso } from "../../src/use-cases/decidir-acesso.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { entregarRespostaPeer } from "../../src/use-cases/entregar-resposta-peer.ts";
import { listarSuaVez } from "../../src/use-cases/listar-sua-vez.ts";
import { pedirAcesso } from "../../src/use-cases/pedir-acesso.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { permitirSempre } from "../../src/use-cases/permitir-sempre.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_LEAPY } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";
import type { Tx } from "../../src/shared/types.ts";

const MARLON = { tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_LEAPY, pessoaId: PESSOA_ANA };
const AGORA = Date.parse("2026-09-29T20:30:00Z");
const PEDIDO = "Taga, pede ao Dev 1 para me ajudar a revisar o PR #466";
const PRONTO = { estado: "pronto" as const, versao: "t", em: 0 };
const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome, schema: { type: "object" }, readOnlyHint });

/** Taga (quem pede) e Dev 1 (quem recebe), da mesma dona, e a mensagem de Marlon que abriu o turno do Taga. */
async function cenario(trx: Tx) {
  const taga = await agenteComConversa(trx, MARLON, { nome: "Taga" });
  const dev1 = await agenteComConversa(trx, MARLON, { nome: "Dev 1" });
  const { deps, repos, chamadas } = depsSobre(trx, MARLON, { agora: () => AGORA });
  for (const a of [taga, dev1]) await repos.agentes.atualizarPerfil(a.agenteId, { confirmado: true });
  const { data } = await enviarMensagem(deps, { conversaId: taga.conversaId, texto: PEDIDO, inventario: PRONTO });
  return { taga, dev1, deps, repos, chamadas, turnoTaga: data.turno };
}

function pedir(deps: Deps, p: { turnoId: string; agenteId: string; conversaId: string }, agente = "Dev 1") {
  return pedirABot(deps, { ...p, agente, pedido: "revisar o PR 466", contexto: "https://github.com/leapy/app/pull/466" });
}

/** GitHub com leitura e escrita, concedido ao Dev 1 inteiro. */
async function githubDoDev1(repos: Repos, dev1: { agenteId: string; conversaId: string }) {
  const criado = await repos.conectores.criar({ nome: "GitHub", slug: "github", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
  const sondado = await repos.conectores.registrarSonda(criado?.id ?? "", { ok: true, catalogo: [cap("pr_ver", true), cap("pr_comentar", false), cap("pr_revisar", false)], agora: AGORA });
  if (!sondado) throw new Error("conector");
  const m = await repos.mensagens.criar({ conversaId: dev1.conversaId, autoria: { autor_tipo: "pessoa", autor_id: PESSOA_MARLON, sob_procuracao_de: null, conta_de_execucao: PESSOA_MARLON, executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1 }, kind: "sistema", texto: "acesso", confianca: "confiavel" });
  for (const capacidade of ["pr_ver", "pr_comentar"]) await repos.concessoes.conceder({ agenteId: dev1.agenteId, conectorId: sondado.id, capacidade, mensagemId: m?.id ?? "" });
  return sondado;
}

/** Um turno de rotina de verdade: rotina, janela reivindicada e turno ligado a ela. */
async function turnoDeRotina(repos: Repos, de: { agenteId: string; conversaId: string }, exigeAprovacao: boolean) {
  const rotina = await repos.rotinas.criar({ agenteId: de.agenteId, conversaId: de.conversaId, cron: "*/10 * * * *", fusoIana: "UTC", instrucao: "Ler o Slack", fonte: "Slack", entregavel: "chat", limitesAprovacao: "", politicaSemDado: "", proximaExecucao: AGORA, exigeAprovacao });
  const turno = await repos.turnos.enfileirar({ conversaId: de.conversaId, agenteId: de.agenteId, origem: "rotina", prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "Execução agendada", entradaConfianca: "nao_confiavel", modelo: "m" });
  await repos.rotinaJanelas.reivindicar({ rotinaId: rotina!.id, instanteAgendado: AGORA, machineId: randomUUID(), executor: "catcher" });
  await repos.rotinaJanelas.vincularTurno({ rotinaId: rotina!.id, instanteAgendado: AGORA, turnoId: turno!.id });
  return turno!;
}

async function planoDe(deps: Deps, turnoId: string) {
  return emitirPlanoTurno(deps, { turnoId, machineId: randomUUID(), executor: "catcher" });
}

describeIntegracao("pedir_a_bot (ADR-058): quem recebe usa os acessos dele", () => {
  it("de uma conversa: turno 'delegacao' confiável sob procuração de Marlon; a mensagem dele vai junto; o plano tem o catálogo inteiro e nenhuma trava", async () => {
    await withRollback(MARLON, async (trx) => {
      const { taga, dev1, deps, repos, chamadas, turnoTaga } = await cenario(trx);
      await githubDoDev1(repos, dev1);
      const r = await pedir(deps, { turnoId: turnoTaga.id, agenteId: taga.agenteId, conversaId: taga.conversaId });
      const tarefa = await repos.turnos.buscar(r.data.tarefa_id);
      expect(tarefa).toMatchObject({ agenteId: dev1.agenteId, conversaId: dev1.conversaId, origem: "delegacao", profundidade: 1, entradaConfianca: "confiavel", sobProcuracaoDe: PESSOA_MARLON, estado: "pendente" });
      expect(tarefa?.entradaTexto).toContain("Pedido de Taga:\n<pedido_do_colega>\nPedido: revisar o PR 466\nContexto: https://github.com/leapy/app/pull/466\n</pedido_do_colega>");
      expect(tarefa?.entradaTexto).toContain(`<pedido_da_pessoa>\n${PEDIDO}\n</pedido_da_pessoa>`);

      const [pedido] = (await repos.mensagens.listarDaConversa(dev1.conversaId)).filter((m) => m.payload?.kind === "peer_pedido");
      expect(pedido).toMatchObject({ turnoId: tarefa?.id, kind: "texto", texto: "revisar o PR 466\n\nhttps://github.com/leapy/app/pull/466", payload: { kind: "peer_pedido", conversaOrigemId: taga.conversaId, turnoOrigemId: turnoTaga.id } });
      expect(pedido?.autoria).toMatchObject({ autor_tipo: "agente", autor_id: taga.agenteId, sob_procuracao_de: PESSOA_MARLON, conta_de_execucao: PESSOA_MARLON });
      expect((await repos.events.gravarComOutbox(r.events ?? [])).ids).toHaveLength(2);

      const plano = await planoDe(deps, tarefa?.id ?? "");
      expect(plano.events?.[0]?.dados.modo).toBe("delegacao");
      expect(plano.data.autoria.sob_procuracao_de).toBe(PESSOA_MARLON);
      expect(plano.data.catalogo.ferramentas.map((f) => f.nome)).toEqual(expect.arrayContaining(["github__pr_ver", "github__pr_comentar", "pedir_acesso", "pedir_aprovacao"]));
      expect(plano.data.politicaExecucao.efeitoExternoSoPorAprovacao).toBe(false);
      expect(plano.data.promptSistema).toContain("Modo de pedido de colega: Taga, outro bot de");
      expect(plano.data.entrada.sessaoCli).toBeNull();
      // Sem trava, a escrita concedida segue o MODO de quem recebe (ADR-062): no manual, pede card; no automático, roda direto.
      const comentar = () => chamarFerramenta(deps, { turnoId: tarefa?.id ?? "", agenteId: dev1.agenteId, nome: "github__pr_comentar", argumentos: {}, plano: plano.data });
      expect((await comentar()).data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente" } });
      await repos.agentes.definirModoAprovacao(dev1.agenteId, "automatico");
      expect((await comentar()).data).toMatchObject({ ok: true });
      expect(chamadas.conectores.map((c) => c.tool)).toEqual(["pr_comentar"]);
    });
  });

  it("de uma rotina com exige_aprovacao — o caso da Clarice: o colega lê livre, mas a escrita dele só sai por item aprovado", async () => {
    await withRollback(MARLON, async (trx) => {
      const { taga, dev1, deps, repos, chamadas } = await cenario(trx);
      await githubDoDev1(repos, dev1);
      const daRotina = await turnoDeRotina(repos, taga, true);
      const r = await pedir(deps, { turnoId: daRotina.id, agenteId: taga.agenteId, conversaId: taga.conversaId });
      const tarefa = await repos.turnos.buscar(r.data.tarefa_id);
      expect(tarefa).toMatchObject({ origem: "delegacao", entradaConfianca: "confiavel" });
      expect(tarefa?.entradaTexto).not.toContain("pedido_da_pessoa");

      const plano = await planoDe(deps, tarefa?.id ?? "");
      expect(plano.data.catalogo.ferramentas.map((f) => f.nome)).toEqual(expect.arrayContaining(["github__pr_ver", "github__pr_comentar"]));
      expect(plano.data.politicaExecucao.efeitoExternoSoPorAprovacao).toBe(true);
      expect(plano.data.promptSistema).toContain("O pedido nasceu de uma rotina que exige aprovação");
      const leitura = await chamarFerramenta(deps, { turnoId: tarefa?.id ?? "", agenteId: dev1.agenteId, nome: "github__pr_ver", argumentos: {}, plano: plano.data });
      expect(leitura.data).toMatchObject({ ok: true });
      const escrita = await chamarFerramenta(deps, { turnoId: tarefa?.id ?? "", agenteId: dev1.agenteId, nome: "github__pr_comentar", argumentos: {}, plano: plano.data });
      expect(escrita.data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente" } });
      expect(chamadas.conectores.map((c) => c.tool)).toEqual(["pr_ver"]);

      // Rotina sem a trava: nada herdado.
      const semTrava = await pedir(deps, { turnoId: (await turnoDeRotina(repos, taga, false)).id, agenteId: taga.agenteId, conversaId: taga.conversaId });
      expect((await planoDe(deps, semTrava.data.tarefa_id)).data.politicaExecucao.efeitoExternoSoPorAprovacao).toBe(false);
    });
  });

  it("pede de qualquer turno abaixo do limite (retomada, sem mensagem, não confiável, delegação em 1 e 2), um passe mais fundo; em 3 não repassa; turno de outro bot não serve", async () => {
    await withRollback(MARLON, async (trx) => {
      const { taga, dev1, deps, repos, turnoTaga } = await cenario(trx);
      const base = { conversaId: taga.conversaId, agenteId: taga.agenteId, prazoEm: AGORA + 60_000, entradaTexto: "x", modelo: "m" };
      const aceitos = [
        await repos.turnos.enfileirar({ ...base, origem: "retomada", profundidade: 0, entradaConfianca: "confiavel", retomaTurnoId: turnoTaga.id }),
        await repos.turnos.enfileirar({ ...base, origem: "conversa", profundidade: 0, entradaConfianca: "nao_confiavel" }),
        await repos.turnos.enfileirar({ ...base, origem: "conversa", profundidade: 0, entradaConfianca: "confiavel" }),
        // ADR-063: quem cumpre um pedido, ou a continuação de quem pediu, ainda pede até o limite da corrente.
        await repos.turnos.enfileirar({ ...base, origem: "delegacao", profundidade: 1, entradaConfianca: "confiavel", sobProcuracaoDe: PESSOA_MARLON }),
        await repos.turnos.enfileirar({ ...base, origem: "retomada", profundidade: 2, entradaConfianca: "confiavel", retomaTurnoId: turnoTaga.id }),
      ];
      for (const t of aceitos) {
        const tarefa = await repos.turnos.buscar((await pedir(deps, { turnoId: t?.id ?? "", agenteId: taga.agenteId, conversaId: taga.conversaId })).data.tarefa_id);
        expect(tarefa).toMatchObject({ origem: "delegacao", profundidade: (t?.profundidade ?? 0) + 1 });
      }

      const noLimite = [
        await repos.turnos.enfileirar({ ...base, origem: "delegacao", profundidade: 3, entradaConfianca: "confiavel", sobProcuracaoDe: PESSOA_MARLON }),
        await repos.turnos.enfileirar({ ...base, origem: "retomada", profundidade: 3, entradaConfianca: "confiavel", retomaTurnoId: turnoTaga.id }),
      ];
      for (const t of noLimite) await expect(pedir(deps, { turnoId: t?.id ?? "", agenteId: taga.agenteId, conversaId: taga.conversaId })).rejects.toMatchObject({ codigo: "nao_permitido" });
      await expect(pedir(deps, { turnoId: turnoTaga.id, agenteId: dev1.agenteId, conversaId: dev1.conversaId }, "Taga")).rejects.toMatchObject({ codigo: "nao_permitido" });
      expect((await repos.turnos.listarDaConversa(dev1.conversaId)).filter((t) => t.origem === "delegacao")).toHaveLength(aceitos.length);
    });
  });

  it("a 0043 aceita 0 a 3 e recusa 4; a corrente Taga → Dev 1 → Chico → Dev 2 para no terceiro passe, com a trava da rotina de ponta a ponta", async () => {
    await withRollback(MARLON, async (trx) => {
      const { taga, dev1, deps, repos } = await cenario(trx);
      const chico = await agenteComConversa(trx, MARLON, { nome: "Chico" });
      const dev2 = await agenteComConversa(trx, MARLON, { nome: "Dev 2" });
      for (const a of [chico, dev2]) await repos.agentes.atualizarPerfil(a.agenteId, { confirmado: true });
      const base = { conversaId: taga.conversaId, agenteId: taga.agenteId, origem: "conversa" as const, prazoEm: AGORA + 60_000, entradaTexto: "x", entradaConfianca: "confiavel" as const, modelo: "m" };
      expect((await repos.turnos.enfileirar({ ...base, profundidade: 3 }))?.profundidade).toBe(3);
      await expectRejected(trx, () => trx`insert into turnos (tenant_id, owner_id, conversa_id, agente_id, origem, prazo_em, profundidade, entrada_texto, entrada_confianca, modelo)
        values (${TENANT_LEAPY}, ${PESSOA_MARLON}, ${taga.conversaId}, ${taga.agenteId}, 'conversa', now(), 4, 'x', 'confiavel', 'm')`, "23514");

      const rotina = await turnoDeRotina(repos, taga, true);
      const tarefa = async (de: { agenteId: string; conversaId: string }, turnoId: string, agente: string) => (await repos.turnos.buscar((await pedir(deps, { turnoId, agenteId: de.agenteId, conversaId: de.conversaId }, agente)).data.tarefa_id))!;
      const d1 = await tarefa(taga, rotina.id, "Dev 1");
      const d2 = await tarefa(dev1, d1.id, "Chico");
      const d3 = await tarefa(chico, d2.id, "Dev 2");
      expect([d1, d2, d3].map((t) => t.profundidade)).toEqual([1, 2, 3]);
      await expect(pedir(deps, { turnoId: d3.id, agenteId: dev2.agenteId, conversaId: dev2.conversaId }, "Taga")).rejects.toMatchObject({ codigo: "nao_permitido" });
      for (const t of [d1, d2, d3]) expect((await planoDe(deps, t.id)).data.politicaExecucao.efeitoExternoSoPorAprovacao).toBe(true);
      const noUltimo = (await planoDe(deps, d3.id)).data;
      expect(noUltimo.catalogo.ferramentas.map((f) => f.nome)).not.toContain("pedir_a_bot");
      expect(noUltimo.promptSistema).toContain("Limite da corrente:");
      expect(noUltimo.promptSistema).toContain("Faça o que der e diga na sua resposta a Chico, com uma pitada de humor, o que falta e para quem");
      const noSegundo = (await planoDe(deps, d2.id)).data;
      expect(noSegundo.catalogo.ferramentas.map((f) => f.nome)).toContain("pedir_a_bot");
      expect(noSegundo.promptSistema).toContain("Quem receber um pedido seu agora já estará no último passe da corrente");
    });
  });

  it("dono diferente: sem procuração → nao_permitido; classe alheia não basta; a classe antiga delegar_tarefa vale", async () => {
    await withRollback(MARLON, async (trx) => {
      const taga = await agenteComConversa(trx, MARLON, { nome: "Taga" });
      await vincularEscopo(trx, ANA);
      const dev1 = await agenteComConversa(trx, ANA, { nome: "Dev 1", dono: "empresa" });
      await vincularEscopo(trx, MARLON);
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const { data } = await enviarMensagem(deps, { conversaId: taga.conversaId, texto: PEDIDO, inventario: PRONTO });
      const ctx = { turnoId: data.turno.id, agenteId: taga.agenteId, conversaId: taga.conversaId };
      await expect(pedir(deps, ctx)).rejects.toMatchObject({ codigo: "nao_permitido" });
      await vincularEscopo(trx, ANA);
      const procuracao = await criarRepos(trx, ANA).procuracoes.criar({ agenteConcedenteId: dev1.agenteId, agenteBeneficiarioId: taga.agenteId, classesPermitidas: ["outra"], tetoDiario: 5 });
      await trx`update procuracoes set visibility = 'equipe' where id = ${procuracao?.id ?? ""}`;
      await trx`update conversas set visibility = 'equipe' where id = ${dev1.conversaId}`;
      await vincularEscopo(trx, MARLON);
      await expect(pedir(deps, ctx)).rejects.toMatchObject({ codigo: "nao_permitido", cause: "classe_nao_permitida" });

      await vincularEscopo(trx, ANA);
      await trx`update procuracoes set classes_permitidas = ${["delegar_tarefa"]} where id = ${procuracao?.id ?? ""}`;
      await vincularEscopo(trx, MARLON);
      const r = await pedir(deps, ctx);
      expect(await repos.turnos.buscar(r.data.tarefa_id)).toMatchObject({ agenteId: dev1.agenteId, origem: "delegacao", sobProcuracaoDe: PESSOA_MARLON });
    });
  });

  it("falta acesso: o card nasce na conversa do Dev 1; aprovar retoma o pedido; só o resultado final volta, como retomada do turno do Taga", async () => {
    await withRollback(MARLON, async (trx) => {
      const { taga, dev1, deps, repos, turnoTaga } = await cenario(trx);
      const criado = await repos.conectores.criar({ nome: "GitHub", slug: "github", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
      await repos.conectores.registrarSonda(criado?.id ?? "", { ok: true, catalogo: [cap("pr_ver", true), cap("pr_comentar", false)], agora: AGORA });
      const r = await pedir(deps, { turnoId: turnoTaga.id, agenteId: taga.agenteId, conversaId: taga.conversaId });
      const tarefaId = r.data.tarefa_id;

      const pedido = await pedirAcesso(deps, { turnoId: tarefaId, conversaId: dev1.conversaId, agenteId: dev1.agenteId, conector: "github", capacidades: ["pr_ver", "pr_comentar"], nivel: "escrita", nao_pedido: ["aprovar ou fazer merge"] });
      expect(pedido.data.estado).toBe("aguardando_pessoa");
      expect((await repos.propostas.pendentesDaConversa(taga.conversaId)).length).toBe(0);
      await repos.turnos.assentar(tarefaId, { estado: "concluido" });
      expect((await entregarRespostaPeer(deps, { tarefaId, texto: "Pedi acesso ao GitHub." })).data).toEqual({ ignorado: "aguardando_pessoa" });

      const decidido = await decidirAcesso(deps, { decisaoId: pedido.data.proposta_id, recusar: false, executor: "catcher" });
      const retomada = await repos.turnos.buscar(decidido.data.turnoId ?? "");
      expect(retomada).toMatchObject({ origem: "retomada", retomaTurnoId: tarefaId, conversaId: dev1.conversaId, profundidade: 1, entradaConfianca: "confiavel", sobProcuracaoDe: PESSOA_MARLON });
      expect((await planoDe(deps, retomada?.id ?? "")).events?.[0]?.dados.modo).toBe("delegacao");

      await repos.turnos.assentar(retomada?.id ?? "", { estado: "concluido" });
      const entrega = await entregarRespostaPeer(deps, { tarefaId: retomada?.id ?? "", texto: "Revisei o PR 466: dois comentários." });
      if (!("mensagem" in entrega.data)) throw new Error("deveria entregar");
      expect(entrega.data.mensagem).toMatchObject({ conversaId: taga.conversaId, kind: "peer_ask", payload: { kind: "peer_ask", agenteId: dev1.agenteId, tarefaId, delegada: true, turnoOrigemId: turnoTaga.id } });
      expect(entrega.data.continuacao).toMatchObject({ conversaId: taga.conversaId, agenteId: taga.agenteId, origem: "retomada", retomaTurnoId: turnoTaga.id, profundidade: 1, entradaConfianca: "confiavel", sobProcuracaoDe: null });
      expect(entrega.data.continuacao.entradaTexto).toContain("Resposta de Dev 1 ao seu pedido: Revisei o PR 466: dois comentários.");
      // A continuação volta no modo de quem pediu (conversa) e, abaixo do limite, ainda pede a outro colega (ADR-063).
      const plano = await planoDe(deps, entrega.data.continuacao.id);
      expect(plano.events?.[0]?.dados.modo).toBe("conversa");
      expect(plano.data.catalogo.ferramentas.map((f) => f.nome)).toContain("pedir_a_bot");
      expect(plano.data.promptSistema).not.toContain("Limite da corrente:");
      expect(plano.data.promptSistema).toContain("tarefaOriginal");
    });
  });

  it("'Sempre permitir' não nasce para aprovar PR: o clique aprova, a regra de pr_revisar não é criada, e Sua vez marca o item", async () => {
    await withRollback(MARLON, async (trx) => {
      const { dev1, deps, repos } = await cenario(trx);
      await githubDoDev1(repos, dev1);
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
      expect((await permitirSempre(deps, { decisaoId: d?.id ?? "", itemIds: [itens[1]?.id ?? ""] })).data).toEqual({ criadas: [], mensagemId: null });
    });
  });
});
