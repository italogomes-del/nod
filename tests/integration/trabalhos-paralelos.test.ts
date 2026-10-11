import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { dispararRotina } from "../../src/use-cases/disparar-rotina.ts";
import { entregarRespostaPeer } from "../../src/use-cases/entregar-resposta-peer.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { criarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { contexto, depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const JANELA = Date.parse("2026-10-07T08:00:00-03:00");
const AGORA = JANELA + 60_000;

describeIntegracao("trabalhos em paralelo pelos casos de uso de verdade (#192, critério 1; S7)", () => {
  it("um bot com uma rotina, um pedido de colega e uma task da pessoa despacha os três juntos, e a mensagem da conversa sai enquanto os três rodam", async () => {
    await withRollback(MARLON, async (trx) => {
      const dev = await agenteComConversa(trx, MARLON, { nome: "Dev" });
      const chico = await agenteComConversa(trx, MARLON, { nome: "Chico" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });

      const rotina = await repos.rotinas.criar({ agenteId: dev.agenteId, conversaId: dev.conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "Triagem do Slack", fonte: "Slack", entregavel: "resumo", limitesAprovacao: "nada", politicaSemDado: "silêncio", proximaExecucao: JANELA });
      const disparo = await dispararRotina(deps, { rotina: rotina!, instanteAgendado: JANELA, machineId: randomUUID(), executor: "catcher" });
      if (!("turno" in disparo.data)) throw new Error("rotina sem turno");

      const turnoChico = await repos.turnos.enfileirar({ executor: "catcher", conversaId: chico.conversaId, agenteId: chico.agenteId, origem: "conversa", prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "peça ao Dev", entradaConfianca: "confiavel", modelo: "m" });
      // O turno do Chico já rodou (é dele o pedido); só a fila do Dev interessa aqui.
      await repos.turnos.assentar(turnoChico!.id, { estado: "concluido" });
      const pedido = await pedirABot(deps, { ...contexto(chico.agenteId, chico.conversaId, turnoChico?.id), agente: "Dev", pedido: "Revise o PR 481" });

      const daPessoa = (await criarTrabalho(deps, { agenteId: dev.agenteId, conversaId: dev.conversaId, titulo: "Dashboard de churn", origem: "pessoa" })).trabalho;
      await repos.turnos.enfileirar({ executor: "catcher", conversaId: dev.conversaId, agenteId: dev.agenteId, origem: "conversa", trabalhoId: daPessoa.id, prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "monte o dashboard", entradaConfianca: "confiavel", modelo: "m" });

      const tres = [];
      for (let i = 0; i < 3; i++) tres.push(await repos.turnos.reivindicar({ machineId: randomUUID(), agora: AGORA }));
      expect(new Set(tres.map((t) => t?.agenteId))).toEqual(new Set([dev.agenteId]));
      expect(new Set(tres.map((t) => t?.origem))).toEqual(new Set(["rotina", "delegacao", "conversa"]));
      const origens = await Promise.all(tres.map(async (t) => (await repos.trabalhos.buscar(t?.trabalhoId ?? ""))?.origem));
      expect(new Set(origens)).toEqual(new Set(["rotina", "colega", "pessoa"]));

      const fala = await repos.turnos.enfileirar({ executor: "catcher", conversaId: dev.conversaId, agenteId: dev.agenteId, origem: "conversa", prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "e aí, como vai?", entradaConfianca: "confiavel", modelo: "m" });
      expect((await repos.turnos.reivindicar({ machineId: randomUUID(), agora: AGORA }))?.id).toBe(fala?.id);

      // Quem pediu recebe a resposta numa continuação que segue no trabalho DELE (aqui, a conversa: null) e a entrega
      // diz de que task veio.
      const tarefa = await repos.turnos.buscar(pedido.data.tarefa_id);
      await repos.turnos.assentar(tarefa!.id, { estado: "concluido" });
      const entrega = await entregarRespostaPeer(deps, { tarefaId: tarefa!.id, texto: "Revisei: dois comentários." });
      if (!("mensagem" in entrega.data)) throw new Error("sem entrega");
      expect(entrega.data.continuacao.trabalhoId).toBeNull();
      expect(entrega.data.mensagem.payload).toMatchObject({ kind: "peer_ask", trabalhoId: tarefa!.trabalhoId });
    });
  });
});
