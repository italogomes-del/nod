import { describe, expect, it } from "vitest";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { renderMensagem, renderTimeline } from "../../../web/telas/conversa.ts";
import { renderDecisoesDaConversa } from "../../../web/telas/sua-vez.ts";

const item: SuaVezDto["itens"][number] = {
  decisao: { tenantId: "t", id: "d", ownerId: "p", decisorId: "p", agenteId: "a", conversaId: "c", turnoId: null, tipo: "acesso", estado: "pendente", prazoDecisaoEm: "2026-09-18T00:00:00Z", prazoExecucaoEm: null, frase: "Ler Slack <script>alert(1)</script>", desfecho: null, vistaEm: null, criadoEm: "2026-09-17T00:00:00Z" },
  estadoColuna: "pendente", agenteNome: "Milton", aguardandoHaMs: 0, recusaAutomaticaEmMs: 60_000, itensAprovacao: [],
};
const estado: Estado = { ...estadoInicial, suaVez: { itens: [item], foraDoAr: [], vazio: false, ultimaDecisaoEm: null } };
const conversa: ConversaEstado = { conversa: { tenantId: "t", id: "c", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens: [], propostas: [], turnosPendentes: [], deltas: {}, carregadaEm: 0 };

describe("decisões no chat", () => {
  it("mostra a autorização na conversa de origem com as mesmas ações da fila", () => {
    const html = renderTimeline(conversa, estado);
    expect(html).toContain("Preciso da sua decisão para continuar");
    expect(html).toContain('data-act="decidir-proposta"');
    expect(html).toContain('data-id="d"');
    expect(html).toContain("Permitir acesso");
    expect(html).toContain("Não permitir");
    expect(html).not.toContain('data-act="abrir-conversa"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(renderDecisoesDaConversa(estado, "outra", new Set())).toBe("");
  });

  it("não duplica a decisão que já tem proposta e remove o cartão quando a fila é reidratada", () => {
    expect(renderDecisoesDaConversa(estado, "c", new Set(["d"]))).toBe("");
    const atualizado = reduzir(estado, { tipo: "hidratar-sua-vez", suaVez: { itens: [], foraDoAr: [], vazio: true, ultimaDecisaoEm: "2026-09-17T00:01:00Z" } });
    expect(renderTimeline(conversa, atualizado)).not.toContain("Permitir acesso");
  });

  it("pedido vencido oferece reabertura e não concede acesso", () => {
    const vencido: Estado = { ...estado, suaVez: { ...estado.suaVez!, itens: [{ ...item, estadoColuna: "vencido", decisao: { ...item.decisao, estado: "vencida" } }] } };
    const html = renderTimeline(conversa, vencido);
    expect(html).toContain("Pedidos vencidos");
    expect(html).toContain('data-act="reabrir"');
    expect(html).not.toContain('data-act="decidir-proposta"');
  });

  it("aprovação de conteúdo sensível continua desmarcada no chat", () => {
    const sensivel = { tenantId: "t", id: "i", decisaoId: "d", idx: 0, textoOriginal: "Olá", textoFinal: "Olá", destino: { conector: "slack", ferramenta: "send", argumentos: {} }, selecionado: false, origemSensivel: true, justificativa: "Confirme antes de enviar", marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null };
    const e: Estado = { ...estado, suaVez: { ...estado.suaVez!, itens: [{ ...item, decisao: { ...item.decisao, tipo: "aprovacao" }, itensAprovacao: [sensivel] }] } };
    const html = renderTimeline(conversa, e);
    expect(html).toContain('data-item="i"');
    expect(html).not.toContain("checked");
    expect(html).toContain("Confirme antes de enviar");
    expect(html).toContain('data-contador>0</span> de 1');
  });

  it("preserva registro imutável de consentimento recolhido sem repetir o catálogo", () => {
    const m: Mensagem = { tenantId: "t", id: "m", conversaId: "c", turnoId: null, kind: "consentimento", texto: "Registro original <auditoria>", payload: { kind: "consentimento", conectorId: "slack", slug: "slack", capacidade: "SLACK_SEARCH_MESSAGES", naoInclui: ["outras ferramentas"] }, confianca: "confiavel", parcial: false, criadoEm: 0, autoria: { autor_tipo: "pessoa", autor_id: "p", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 } };
    const html = renderMensagem(m, estado);
    expect(html).toContain("Acesso permitido · slack");
    expect(html).toContain("SLACK_SEARCH_MESSAGES");
    expect(html).toContain("Registro original &lt;auditoria&gt;");
    expect(html).toContain("Ver registro de autorização");
    expect(html).not.toContain(" open");
  });
});
