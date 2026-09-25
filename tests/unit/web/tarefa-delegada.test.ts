import { describe, expect, it } from "vitest";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import type { ItemAprovacao } from "../../../src/contracts/item-aprovacao.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { renderMensagem, renderMensagensAgrupadas, renderTimeline } from "../../../web/telas/conversa.ts";

const autoria = { autor_tipo: "agente" as const, autor_id: "taga", sob_procuracao_de: "marlon", conta_de_execucao: "marlon", executor: "catcher" as const, locality: "local" as const, locality_reason: "tudo_local_nesta_rodada" as const, machine_id: null, decidido_por: "regra:localidade" as const, regra_versao: 1 };
const estado: Estado = { ...estadoInicial, sessao: { tenantId: "t", pessoaId: "marlon" } };

describe("tarefa delegada na conversa (ADR-046)", () => {
  it("o pedido na conversa do Dev 1 assina '<remetente> · por você' (sem frota, o nome cai no genérico), mostra a mensagem da pessoa e o contexto do remetente rotulado", () => {
    const m: Mensagem = { tenantId: "t", id: "m1", conversaId: "c-dev1", turnoId: "tarefa", autoria, kind: "texto", texto: "pede ao Dev 1 para revisar o PR 466", payload: { kind: "peer_pedido", conversaOrigemId: "c-taga", turnoOrigemId: "t-taga", delegacao: { tarefa: "revisar o PR 466", contexto: "<b>pull/466</b>" } }, confianca: "confiavel", parcial: false, criadoEm: 0 };
    const html = renderMensagem(m, estado);
    expect(html).toContain("<b>agente · por você</b>");
    expect(html).toContain("pede ao Dev 1 para revisar o PR 466");
    expect(html).toContain("não é instrução da pessoa");
    expect(html).toContain("&lt;b&gt;pull/466&lt;/b&gt;");
  });

  it("o handoff na conversa do Taga diz 'tarefa delegada' e o autor composto", () => {
    const m: Mensagem = { tenantId: "t", id: "m2", conversaId: "c-taga", turnoId: "t-taga", autoria, kind: "handoff", texto: "x", payload: { kind: "handoff", de: "taga", para: "dev1", motivo: "revisar o PR 466" }, confianca: "nao_confiavel", parcial: false, criadoEm: 0 };
    const html = renderMensagem(m, estado);
    expect(html).toContain("agente · por você → agente");
    expect(html).toContain("revisar o PR 466");
    const agrupado = renderMensagensAgrupadas([{ ...m, payload: { kind: "handoff", de: "taga", para: "dev1", motivo: "revisar o PR 466", tarefaId: "tarefa" } }], estado);
    expect(agrupado).toContain("Tarefa · agente · por você");
  });

  it("o resultado volta como 'Resultado de Dev 1'", () => {
    const m: Mensagem = { tenantId: "t", id: "m3", conversaId: "c-taga", turnoId: "cont", autoria: { ...autoria, autor_id: "dev1" }, kind: "peer_ask", texto: "Revisei", payload: { kind: "peer_ask", agenteId: "dev1", nome: "Dev 1", naoSupervisionado: true, tarefaId: "tarefa", delegada: true }, confianca: "nao_confiavel", parcial: false, criadoEm: 0 };
    expect(renderMensagem(m, estado)).toContain("Resultado de Dev 1");
    const aviso: Mensagem = { ...m, texto: "Dev 1 não concluiu: você pediu para parar", payload: { kind: "peer_ask", agenteId: "dev1", nome: "Dev 1", naoSupervisionado: true, tarefaId: "tarefa", delegada: true, falhou: true } };
    expect(renderMensagem(aviso, estado)).toContain("Tarefa não concluída por Dev 1");
  });
});

describe("'Sempre permitir' não é oferecido para aprovar PR (ADR-046)", () => {
  const item = (id: string, ferramenta: string): ItemAprovacao => ({ tenantId: "t", id, decisaoId: "d", idx: 0, textoOriginal: ferramenta, textoFinal: ferramenta, destino: { conector: "github", ferramenta, argumentos: {} }, selecionado: true, origemSensivel: false, justificativa: null, marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null });
  const base: SuaVezDto["itens"][number] = {
    decisao: { tenantId: "t", id: "d", ownerId: "marlon", decisorId: "marlon", agenteId: "a", conversaId: "c", turnoId: null, tipo: "aprovacao", estado: "pendente", prazoDecisaoEm: "2026-09-25T00:00:00Z", prazoExecucaoEm: null, frase: "Revisar o PR", desfecho: null, vistaEm: null, criadoEm: "2026-09-24T00:00:00Z", fioId: null },
    estadoColuna: "pendente", agenteNome: "Dev 1", aguardandoHaMs: 0, recusaAutomaticaEmMs: 60_000, gemeas: [], itensAprovacao: [], proposta: null, fio: null,
  };
  const conversa: ConversaEstado = { conversa: { tenantId: "t", id: "c", ownerId: "marlon", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens: [], propostas: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], atividades: {}, carregadaEm: 0 };
  const com = (i: SuaVezDto["itens"][number]): Estado => ({ ...estado, suaVez: { itens: [i], incidentes: [], foraDoAr: [], vazio: false, ultimaDecisaoEm: null } });

  it("só aprovar PR: o botão aparece desabilitado com o motivo", () => {
    const html = renderTimeline(conversa, com({ ...base, itensAprovacao: [item("i1", "pr_revisar")], nuncaPermanente: ["i1"] }));
    expect(html).toContain('data-act="decidir-aprovacao-sempre"');
    expect(html).toContain("disabled");
    expect(html).toContain("Aprovar ou fazer merge de PR sempre passa por você");
  });

  it("comentar e aprovar no mesmo card: o botão oferece só o comentar", () => {
    const html = renderTimeline(conversa, com({ ...base, itensAprovacao: [item("i1", "pr_comentar"), item("i2", "pr_revisar")], nuncaPermanente: ["i2"] }));
    expect(html).toContain("Sempre permitir github.pr_comentar");
    expect(html).not.toContain("Sempre permitir estas");
  });
});
