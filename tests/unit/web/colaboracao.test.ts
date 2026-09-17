import { expect, it } from "vitest";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial } from "../../../web/estado/reducer.ts";
import { renderMensagensAgrupadas } from "../../../web/telas/conversa.ts";

it("agrupa dois colegas pelo turno de origem, preservando respostas tardias e fala normal", () => {
  const base: Mensagem = { id: "m", tenantId: "t", conversaId: "c", turnoId: "turno", kind: "texto", texto: "Conclusão normal", payload: null, confianca: "confiavel", parcial: false, criadoEm: 1, autoria: { autor_tipo: "agente", autor_id: "a", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:teste", regra_versao: 1 } };
  const mensagens: Mensagem[] = [
    ...["b", "c"].map((id): Mensagem => ({ ...base, id: `pedido-${id}`, kind: "handoff", texto: `Pergunta para ${id}`, payload: { kind: "handoff", de: "a", para: id, motivo: "revisar", tarefaId: `tarefa-${id}` } })),
    base,
    ...["b", "c"].map((id): Mensagem => ({ ...base, id: `resposta-${id}`, turnoId: `outro-${id}`, kind: "peer_ask", texto: `Resposta de ${id}`, payload: { kind: "peer_ask", agenteId: id, nome: id, naoSupervisionado: true, tarefaId: `tarefa-${id}` } })),
  ];
  const html = renderMensagensAgrupadas(mensagens, estadoInicial);
  expect(html.match(/class="collaboration"/g)).toHaveLength(1);
  expect(html).toContain("4 mensagens com");
  expect(html).toContain("2 bots");
  expect(html.match(/Conclusão normal/g)).toHaveLength(1);
  expect(html).toContain("Resposta de b");
  expect(html).toContain("Resposta de c");
  expect(html).not.toContain(" open");
});
