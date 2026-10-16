import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { expect, it, vi } from "vitest";
import { criarRotasDecisoes } from "../../src/adapters/http/rotas/decisoes.ts";
import { pedirAPessoa } from "../../src/use-cases/pedir-a-pessoa.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.parse("2026-09-24T15:00:00-03:00");

/**
 * Perguntas viram conversa (emenda da ADR-045, definido em 2026-09-24), no Postgres de verdade: o
 * payload jsonb das duas mensagens (a fala que é a pergunta e a resposta que a cita) sobrevive à ida e
 * volta, e POST decisoes/:id/responder — a mesma rota do campo em modo resposta e do toque numa opção —
 * continua criando a retomada. Sem migração: `mensagens.payload` já é jsonb.
 */
describeIntegracao("perguntas viram conversa: a pergunta é fala ligada à decisão e a resposta leva o vínculo", () => {
  it("pedir_a_pessoa grava a fala com payload pedido_a_pessoa; responder fecha, grava a resposta ligada e cria a retomada", async () => {
    await withRollback(MARLON, async (trx) => {
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Cecília" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const turno = await repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "arquive os PRs parados", entradaConfianca: "confiavel", modelo: "claude-haiku-4-5-20251001" });
      if (!turno) throw new Error("turno");

      const pedido = await pedirAPessoa(deps, { turnoId: turno.id, conversaId, agenteId, tipo: "pergunta", texto: "Posso arquivar o PR 7? Ele está parado há duas semanas.", opcoes: ["Sim, pode arquivar", " ", "sim, pode arquivar", "Não, deixe aberto", "x".repeat(61)] });
      const decisaoId = pedido.data.decisao_id;
      const decisao = await repos.decisoes.buscar(decisaoId);
      const fala = (await repos.mensagens.listarDaConversa(conversaId)).find((m) => m.payload?.kind === "pedido_a_pessoa");
      expect(fala).toMatchObject({ kind: "texto", texto: "Posso arquivar o PR 7? Ele está parado há duas semanas.", autoria: { autor_tipo: "agente", autor_id: agenteId } });
      expect(fala?.payload).toEqual({ kind: "pedido_a_pessoa", decisaoId, opcoes: ["Sim, pode arquivar", "Não, deixe aberto"] });
      // O molde da fila ficou só na decisão ("Sua vez"); a conversa não o recebe mais.
      expect(decisao?.frase).toMatch(/^parei para perguntar a .+: Posso arquivar o PR 7\?/);
      expect((await repos.mensagens.listarDaConversa(conversaId)).filter((m) => m.texto.startsWith("parei"))).toEqual([]);

      const rota = criarRotasDecisoes({ dentro: async (_escopo, fn) => fn(deps), services: deps.services }).find((r) => r.padrao.source.includes("responder"));
      if (!rota || rota.publica) throw new Error("rota responder");
      const req = new IncomingMessage(new Socket());
      const json = vi.fn();
      await rota.handler({ req, res: new ServerResponse(req), escopo: MARLON, params: { id: decisaoId }, corpo: async () => ({ texto: "Sim, pode arquivar" }), json });
      const ids = (json.mock.calls[0]?.[1] as { ids: Record<string, string> }).ids;

      expect((await repos.decisoes.buscar(decisaoId))?.estado).toBe("decidida");
      const resposta = (await repos.mensagens.listarDaConversa(conversaId)).find((m) => m.id === ids.mensagem);
      expect(resposta).toMatchObject({ kind: "texto", texto: "Sim, pode arquivar", autoria: { autor_tipo: "pessoa", autor_id: PESSOA_MARLON } });
      expect(resposta?.payload).toEqual({ kind: "resposta_a_pedido", decisaoId, agenteId, perguntaEm: Date.parse(decisao?.criadoEm ?? ""), retomada: true, turnoRetomadaId: ids.turnoRetomada });
      const retomada = await repos.turnos.buscar(ids.turnoRetomada ?? "");
      expect(retomada).toMatchObject({ origem: "retomada", retomaTurnoId: turno.id, estado: "pendente" });
      expect(retomada?.entradaTexto).toContain("Sim, pode arquivar");
    });
  });
});
