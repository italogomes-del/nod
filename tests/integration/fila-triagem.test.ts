import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { IdHarness } from "../../src/contracts/harness.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { dispararRotina, registrarDesfechoRotina } from "../../src/use-cases/disparar-rotina.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { entregarRespostaPeer } from "../../src/use-cases/entregar-resposta-peer.ts";
import { abrirFrentes } from "../../src/use-cases/frentes.ts";
import { pedidoDeColegaDoTurno } from "../../src/use-cases/pedido-de-colega.ts";
import { cuidarDosPedidosParados } from "../../src/use-cases/pedidos-parados.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { tarefaDoPedido } from "../helpers/pedido.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * A triagem na entrada (ADR-099 itens 1, 1a e 8, issue I7 revista): o pedido de colega e o de rotina entram como um turno
 * curto do dono, sem trabalho; o dono abre frentes ligadas a esse turno, junta ou espera. A espera circular é recusada.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto = { estado: "pronto", versao: "teste", em: Date.now() } as const;
const harnesses: Partial<Record<IdHarness, typeof pronto>> = { "claude-cli": pronto };

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
async function montar(trx: Trx) {
  const agora = () => Date.now();
  const chico = await agenteComConversa(trx, MARLON, { nome: `Chico ${randomUUID().slice(0, 4)}` });
  const dev = await agenteComConversa(trx, MARLON, { nome: `Dev ${randomUUID().slice(0, 4)}` });
  const livre = await agenteComConversa(trx, MARLON, { nome: `Livre ${randomUUID().slice(0, 4)}` });
  const ocupado = await agenteComConversa(trx, MARLON, { nome: `Ocupado ${randomUUID().slice(0, 4)}` });
  const { repos } = chico;
  for (const a of [chico, dev, livre, ocupado]) await repos.agentes.atualizarPerfil(a.agenteId, { confirmado: true });
  const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
  const turnoDe = async (b: { agenteId: string; conversaId: string }, extra: { origem?: "conversa" | "rotina"; trabalhoId?: string | null } = {}) =>
    (await repos.turnos.enfileirar({ executor: "catcher", conversaId: b.conversaId, agenteId: b.agenteId, origem: extra.origem ?? "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "revise o PR 42", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: extra.trabalhoId ?? null }))!;
  // O Ocupado tem um turno rodando: não é sugerido como livre.
  await trx`update turnos set estado = 'despachando', lease_ate = now() + interval '1 minute' where id = ${(await turnoDe(ocupado)).id}`;
  const pedir = (de: { agenteId: string; conversaId: string }, turnoId: string, alvo: string, pedido = "revise o PR 42") =>
    pedirABot(deps, { turnoId, agenteId: de.agenteId, conversaId: de.conversaId, agente: alvo, pedido });
  return { chico, dev, livre, ocupado, repos, deps, turnoDe, pedir, nome: async (id: string) => (await repos.agentes.buscar(id))!.nome };
}

describeIntegracao("fila do dono: a triagem na entrada (ADR-099, I7 revista)", () => {
  it("pedido de colega vira um turno de triagem na conversa do dono de quem recebe — nenhum trabalho; a resposta diz que entrou na triagem e sugere quem está livre", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const deQuemPede = await m.turnoDe(m.chico);
      const r = await m.pedir(m.chico, deQuemPede.id, await m.nome(m.dev.agenteId));
      if (!r.data.ok) throw new Error(r.data.instrucao);
      const tarefa = await m.repos.turnos.buscar(r.data.tarefa_id);
      expect(tarefa).toMatchObject({ agenteId: m.dev.agenteId, conversaId: m.dev.conversaId, origem: "delegacao", trabalhoId: null, estado: "pendente", sobProcuracaoDe: PESSOA_MARLON, profundidade: 1 });
      expect(await m.repos.trabalhos.abertosDoAgente(m.dev.agenteId)).toEqual([]);
      const [handoff] = (await m.repos.mensagens.listarDaConversa(m.chico.conversaId)).filter((x) => x.kind === "handoff");
      expect(handoff?.payload).toEqual({ kind: "handoff", de: m.chico.agenteId, para: m.dev.agenteId, motivo: "revise o PR 42", tarefaId: tarefa!.id });
      expect(r.data.instrucao).toContain(`Pedido entregue a ${await m.nome(m.dev.agenteId)}: entrou na triagem dele`);
      expect(r.data.livres.map((a) => a.id)).toEqual([m.livre.agenteId]);
      expect(r.data.instrucao).toContain(`Livres agora: ${await m.nome(m.livre.agenteId)}`);
      expect(r.events?.map((e) => e.kind)).not.toContain("trabalho_mudou");

      // O critério da I3: o turno atende o pedido do Chico.
      const pedido = await pedidoDeColegaDoTurno(m.deps, tarefa!);
      expect(pedido).toMatchObject({ remetenteAgenteId: m.chico.agenteId, conversaOrigemId: m.chico.conversaId, turnoOrigemId: deQuemPede.id, tarefa: { id: tarefa!.id } });
      expect(await pedidoDeColegaDoTurno(m.deps, deQuemPede)).toBeNull();

      // O plano da triagem: catálogo com abrir_frentes e mandar_para_frente, a linha da triagem e o que está em andamento.
      const plano = (await emitirPlanoTurno(m.deps, { turnoId: tarefa!.id, machineId: randomUUID(), executor: "local", harnesses })).data;
      expect(plano.catalogo.ferramentas.map((f) => f.nome)).toEqual(expect.arrayContaining(["abrir_frentes", "mandar_para_frente", "me_chame_as"]));
      expect(plano.promptSistema).toContain("Triagem: este turno é a entrada de um pedido de");
    });
  });

  it("na triagem o dono abre frentes ligadas ao turno: origem colega, quem pediu, modo delegação; a fala dele não é o resultado (aguardando_frentes) até o lote voltar", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const deQuemPede = await m.turnoDe(m.chico);
      const triagem = tarefaDoPedido((await m.pedir(m.chico, deQuemPede.id, await m.nome(m.dev.agenteId))).data);
      await trx`update turnos set estado = 'despachando', lease_ate = now() + interval '1 minute' where id = ${triagem}`;
      const r = await abrirFrentes(m.deps, { turnoId: triagem, agenteId: m.dev.agenteId, conversaId: m.dev.conversaId, frentes: [{ titulo: "PR 42", pedido: "Revise o PR 42 do gamefik/nod." }] });
      if (!r.data.ok) throw new Error(r.data.instrucao);
      expect(await m.repos.frentes.buscarLote(r.data.lote_id)).toMatchObject({ abertoPorTurnoId: triagem, trabalhoId: null });
      const [frente] = r.data.frentes;
      const w = await m.repos.trabalhos.buscar(frente!.trabalho_id);
      expect(w).toMatchObject({ forma: "frente", origem: "colega", pedidoPorAgenteId: m.chico.agenteId, pessoaEsperando: true, agenteId: m.dev.agenteId, conversaId: m.dev.conversaId });
      const [turnoDaFrente] = await m.repos.turnos.doTrabalho(frente!.trabalho_id);
      expect(turnoDaFrente).toMatchObject({ origem: "delegacao", sobProcuracaoDe: PESSOA_MARLON, profundidade: 1 });
      expect(turnoDaFrente?.entradaTexto).toContain(`para um pedido de ${await m.nome(m.chico.agenteId)}`);

      // O dono encerra a triagem com "comecei": não vai a quem pediu.
      await m.repos.turnos.assentar(triagem, { estado: "concluido" });
      expect((await entregarRespostaPeer(m.deps, { tarefaId: triagem, texto: "Comecei a revisão numa frente." })).data).toEqual({ ignorado: "aguardando_frentes" });
      // A frente terminou e a I3 marcou o lote devolvido: o resultado sai, uma vez, para quem pediu.
      await m.repos.turnos.assentar(turnoDaFrente!.id, { estado: "concluido" });
      await sincronizarTrabalho(m.deps, frente!.trabalho_id);
      await m.repos.frentes.marcarDevolvido(r.data.lote_id, null, Date.now());
      const entrega = await entregarRespostaPeer(m.deps, { tarefaId: triagem, texto: "PR 42 revisado." });
      expect("mensagem" in entrega.data && entrega.data.mensagem).toMatchObject({ conversaId: m.chico.conversaId, kind: "peer_ask", payload: { tarefaId: triagem } });
    });
  });

  it("espera circular: B pede a A enquanto A espera B — recusado com instrução; em qualquer profundidade também; o mesmo sentido passa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const [nChico, nDev, nLivre] = await Promise.all([m.chico, m.dev, m.livre].map((b) => m.nome(b.agenteId)));
      const t1 = tarefaDoPedido((await m.pedir(m.chico, (await m.turnoDe(m.chico)).id, nDev)).data);
      // Na triagem do pedido, o Dev pede ao Chico: o Chico já espera o Dev.
      const volta = await m.pedir(m.dev, t1, nChico, "qual repositório?");
      expect(volta.data).toEqual({ ok: false, erro: "espera_circular", instrucao: expect.stringContaining(`Espera circular: ${nChico} pediu algo a você`) });
      expect((await m.repos.mensagens.listarDaConversa(m.dev.conversaId)).filter((x) => x.kind === "handoff")).toHaveLength(0);
      // Dev → Livre passa; e Livre → Chico fecha Chico → Dev → Livre → Chico.
      const t2 = tarefaDoPedido((await m.pedir(m.dev, t1, nLivre, "levante os testes")).data);
      const fundo = await m.pedir(m.livre, t2, nChico, "e o deploy?");
      expect(fundo.data).toMatchObject({ ok: false, erro: "espera_circular", instrucao: expect.stringContaining(`${nChico} pediu algo a ${nDev}, que pediu a você`) });
      // O Chico pedir de novo ao Dev (mesmo sentido) não é ciclo.
      expect((await m.pedir(m.chico, (await m.turnoDe(m.chico)).id, nDev, "e o PR 43?")).data).toMatchObject({ ok: true });
      // Respondido o pedido (peer_ask), a aresta some: o Dev já pode pedir ao Chico.
      await m.repos.turnos.assentar(t1, { estado: "concluido" });
      await m.repos.turnos.assentar(t2, { estado: "concluido" });
      await entregarRespostaPeer(m.deps, { tarefaId: t2, texto: "12 testes." });
      await entregarRespostaPeer(m.deps, { tarefaId: t1, texto: "PR 42 ok." });
      const segundo = (await m.repos.mensagens.listarDaConversa(m.chico.conversaId)).filter((x) => x.kind === "handoff")[1];
      const t3 = segundo?.payload?.kind === "handoff" ? segundo.payload.tarefaId! : "";
      await m.repos.turnos.assentar(t3, { estado: "concluido" });
      await entregarRespostaPeer(m.deps, { tarefaId: t3, texto: "PR 43 ok." });
      expect((await m.pedir(m.dev, (await m.turnoDe(m.dev)).id, nChico, "qual repositório?")).data).toMatchObject({ ok: true });
    });
  });

  it("rotina vira um turno de triagem na conversa do dono (sem trabalho); as frentes que ela abrir são da rotina, a execução espera o lote e a próxima janela é pulada", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const agora = Date.now();
      const rotina = (await m.repos.rotinas.criar({ agenteId: m.dev.agenteId, conversaId: m.dev.conversaId, cron: "*/5 * * * *", fusoIana: "UTC", instrucao: "Revisar PRs abertos", fonte: "f", entregavel: "e", limitesAprovacao: "", politicaSemDado: "", proximaExecucao: agora }))!;
      const r = await dispararRotina(m.deps, { rotina, instanteAgendado: agora, machineId: randomUUID(), executor: "catcher", preservarAgenda: true });
      if (!("turno" in r.data)) throw new Error(`deveria disparar: ${JSON.stringify(r.data)}`);
      const turno = r.data.turno;
      expect(turno).toMatchObject({ origem: "rotina", trabalhoId: null, conversaId: m.dev.conversaId, agenteId: m.dev.agenteId, estado: "pendente" });
      expect(await m.repos.trabalhos.abertosDoAgente(m.dev.agenteId)).toEqual([]);
      expect(r.events?.map((e) => e.kind)).toEqual(["turno_criado"]);
      const plano = (await emitirPlanoTurno(m.deps, { turnoId: turno.id, machineId: randomUUID(), executor: "local", harnesses })).data;
      expect(plano.catalogo.ferramentas.map((f) => f.nome)).toEqual(expect.arrayContaining(["abrir_frentes", "mandar_para_frente", "sem_novidade"]));
      expect(plano.promptSistema).toContain("Triagem: esta execução da rotina é um pedido na sua fila");

      await trx`update turnos set estado = 'despachando', lease_ate = now() + interval '1 minute' where id = ${turno.id}`;
      const f = await abrirFrentes(m.deps, { turnoId: turno.id, agenteId: m.dev.agenteId, conversaId: m.dev.conversaId, frentes: [{ titulo: "PR 7", pedido: "Revise o PR 7." }] });
      if (!f.data.ok) throw new Error(f.data.instrucao);
      expect(await m.repos.trabalhos.buscar(f.data.frentes[0]!.trabalho_id)).toMatchObject({ origem: "rotina", rotinaId: rotina.id, trabalhoMaeId: null, forma: "frente" });
      expect(await m.repos.frentes.buscarLote(f.data.lote_id)).toMatchObject({ abertoPorTurnoId: turno.id, trabalhoId: null });
      // O turno do dono acabou, mas a execução é do retorno do lote.
      await m.repos.turnos.assentar(turno.id, { estado: "concluido" });
      expect((await registrarDesfechoRotina(m.deps, { turnoId: turno.id, desfecho: "executou" })).data).toEqual({ ignorado: "aguardando_frentes" });
      // A próxima janela do agendador é pulada enquanto a frente da rotina roda.
      const proxima = await dispararRotina(m.deps, { rotina, instanteAgendado: agora + 300_000, machineId: randomUUID(), executor: "catcher" });
      expect(proxima.data).toMatchObject({ pulada: true, trabalhoAbertoId: f.data.frentes[0]!.trabalho_id });
    });
  });

  it("o varredor da ADR-084 cobre a triagem que caiu com a máquina: retoma quando as máquinas voltam (o pedido de antes, task de colega, segue em pedidos-parados.test.ts)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const triagem = tarefaDoPedido((await m.pedir(m.chico, (await m.turnoDe(m.chico)).id, await m.nome(m.dev.agenteId))).data);
      await trx`update turnos set estado = 'despachando', lease_ate = now() - interval '1 minute' where id = ${triagem}`;
      await m.repos.turnos.interromper(triagem, "maquina_sem_contato");
      // Sem sinal de volta das máquinas ainda: espera.
      expect((await m.repos.pedidosDeColega.triagensParadas(Date.now() - 86_400_000, Date.now()))[0]).toMatchObject({ tarefaId: triagem, trabalhoColegaId: null, estadoColega: "falhou", quedas: 1, sinalDepoisDaQueda: false });
      // Um turno da pessoa concluiu depois da queda: as máquinas voltaram, e a triagem é retomada sozinha.
      const outro = await m.turnoDe(m.livre);
      await m.repos.turnos.assentar(outro.id, { estado: "concluido" });
      const r = await cuidarDosPedidosParados(m.deps);
      expect(r.data.retomados).toEqual([triagem]);
      const retomada = (await m.repos.turnos.listarDaConversa(m.dev.conversaId, 50)).find((t) => t.retomaTurnoId === triagem);
      expect(retomada).toMatchObject({ origem: "retomada", trabalhoId: null, estado: "pendente", sobProcuracaoDe: PESSOA_MARLON });
      // Com a retomada na fila, a triagem não está mais parada.
      expect(await m.repos.pedidosDeColega.triagensParadas(Date.now() - 86_400_000, Date.now())).toEqual([]);
    });
  });
});
