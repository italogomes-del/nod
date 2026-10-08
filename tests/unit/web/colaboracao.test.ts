import { expect, it } from "vitest";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial } from "../../../web/estado/reducer.ts";
import { renderMensagensAgrupadas } from "../../../web/telas/conversa.ts";

// revisto em 2026-10-07 (#191, chat limpo, padrão Grok): o grupo continua pelo turno de origem, mas em vez de um
// <details class="collaboration"> com as trocas dentro, vira duas linhas centralizadas — "Enviou mensagem para…" no
// pedido e "N mensagens com…" na volta —, que abrem a task de quem recebeu (ou a tela provisória com as trocas).
it("agrupa dois colegas pelo turno de origem, preservando respostas tardias e fala normal", () => {
  const base: Mensagem = { id: "m", tenantId: "t", conversaId: "c", turnoId: "turno", kind: "texto", texto: "Conclusão normal", payload: null, confianca: "confiavel", parcial: false, criadoEm: 1, autoria: { autor_tipo: "agente", autor_id: "a", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:teste", regra_versao: 1 } };
  const mensagens: Mensagem[] = [
    ...["b", "c"].map((id): Mensagem => ({ ...base, id: `pedido-${id}`, kind: "handoff", texto: `Pergunta para ${id}`, payload: { kind: "handoff", de: "a", para: id, motivo: "revisar", tarefaId: `tarefa-${id}` } })),
    base,
    ...["b", "c"].map((id): Mensagem => ({ ...base, id: `resposta-${id}`, turnoId: `outro-${id}`, kind: "peer_ask", texto: `Resposta de ${id}`, payload: { kind: "peer_ask", agenteId: id, nome: id, naoSupervisionado: true, tarefaId: `tarefa-${id}` } })),
  ];
  const html = renderMensagensAgrupadas(mensagens, estadoInicial);
  expect(html).not.toContain('class="collaboration"');
  expect(html.match(/class="linha-centro-wrap"/g)).toHaveLength(2);
  expect(html).toContain("<span>Enviou mensagem para</span>");
  expect(html).toContain("<span>4 mensagens com</span>");
  // Os nomes vêm da frota; fora dela, do que a própria resposta traz.
  expect(html).toContain('<span class="linha-nome">b</span><span class="linha-sep"> e </span><span class="linha-nome">c</span>');
  expect(html.match(/Conclusão normal/g)).toHaveLength(1);
  // As trocas não aparecem no chat: a linha leva os ids para a tela provisória.
  expect(html).not.toContain("Resposta de b");
  expect(html).toContain('data-mensagens="pedido-b,pedido-c,resposta-b,resposta-c"');
});
