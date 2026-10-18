import { describe, expect, it } from "vitest";
import type { ConversaDto, SuaVezDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { blocosDoHistorico } from "../../../web/telas/conversa.ts";

/**
 * QA do PR 4 do chat limpo (2026-10-18): o pedido cuja âncora cai dentro de uma troca agrupada (PR 3) ia para ANTES dela.
 * Caso real: o Leo pede ao Ze um e-mail; o Ze pede aprovação no turno do pedido. A âncora do pedido é a última fala desse
 * turno, que está dentro da linha "Conversou com Leo · 2 mensagens", e a chave da troca (`troca:turno:<id>`) não dizia a
 * posição: o cartão (aberto ou encolhido) aparecia em cima da conversa que o causou. A troca agora leva a posição da
 * mensagem em que entrou, como a linha (`linha:<id>`).
 */

const C = "c-ze";
const AGORA = Date.parse("2026-10-18T13:10:00Z");
const MIN = 60_000;
const t0 = AGORA - 60 * MIN;
const pessoa = { autor_tipo: "pessoa", autor_id: "p", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 } as const;
const ze = { ...pessoa, autor_tipo: "agente", autor_id: "ze", decidido_por: "regra:teste" } as const;
const leo = { ...ze, autor_id: "leo", sob_procuracao_de: "p" } as const;

const msg = (id: string, criadoEm: number, extra: Partial<Mensagem> = {}): Mensagem => ({
  tenantId: "t", id, conversaId: C, turnoId: null, autoria: ze, kind: "texto", texto: `fala ${id}`, payload: null, confianca: "confiavel", parcial: false, criadoEm, destino: "chat",
  origemTurno: null, trabalhoId: null, fimDoTurno: false, ...extra,
} as Mensagem);

/** O pedido do Leo recebido pelo Ze e a resposta, num turno de delegação ("Preparei o follow-up; falta o ok."). */
const pedidoDoLeo = (): Mensagem[] => [
  msg("k1", t0 + 10 * MIN, { autoria: leo, turnoId: "tk", origemTurno: "delegacao", payload: { kind: "peer_pedido", conversaOrigemId: "c-leo", turnoOrigemId: "t-leo", nome: "Leo" }, texto: "Prepara e manda o e-mail de follow-up para a Marta.", confianca: "nao_confiavel" }),
  msg("k2", t0 + 11 * MIN, { turnoId: "tk", origemTurno: "delegacao", fimDoTurno: true, texto: "Preparei o follow-up; falta o ok." }),
];
const antes = (): Mensagem[] => [msg("p1", t0, { autoria: pessoa }), msg("b1", t0 + MIN, { turnoId: "t1", origemTurno: "conversa", fimDoTurno: true })];

const pedido = (id: string, turnoId: string): SuaVezDto["itens"][number] => ({
  decisao: { tenantId: "t", id, ownerId: "p", decisorId: "p", agenteId: "ze", conversaId: C, turnoId, tipo: "aprovacao", estado: "pendente", prazoDecisaoEm: "2026-10-19T13:00:00Z", prazoExecucaoEm: null, frase: "Enviar e-mail para Marta Dias · “Follow-up”", desfecho: null, vistaEm: null, criadoEm: new Date(t0 + 11 * MIN).toISOString(), fioId: null },
  estadoColuna: "pendente", agenteNome: "Ze", aguardandoHaMs: MIN, recusaAutomaticaEmMs: 23 * 3_600_000, gemeas: [], proposta: null, fio: null, rotinaParada: null,
  itensAprovacao: [{ tenantId: "t", id: `${id}-i`, decisaoId: id, idx: 0, textoOriginal: "e-mail", textoFinal: "e-mail", destino: { conector: "exemplo", ferramenta: "enviar_email", argumentos: {} }, selecionado: true, origemSensivel: false, justificativa: null, marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null }],
});

function cenario(mensagens: Mensagem[], itens: SuaVezDto["itens"] = []): { e: Estado; c: ConversaEstado } {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "ze", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
  };
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA });
  const e: Estado = {
    ...base, agora: AGORA, sessao: { pessoaId: "p", tenantId: "t" } as never,
    frota: { agentes: [{ id: "ze", nome: "Ze", conversaId: C, cor: "c-yellow", forma: "shape-square", ownerId: "p" }, { id: "leo", nome: "Leo", conversaId: "c-leo", cor: "c-brown", forma: "shape-square", ownerId: "p" }] } as never,
    suaVez: { itens, incidentes: [], foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null },
  };
  return { e, c: e.conversas[C]! };
}

const chaves = (c: ConversaEstado, e: Estado): string[] => blocosDoHistorico(c, e).map((b) => b.chave).filter((k) => !k.startsWith("sep:") && !["a-fazer", "acolhimento", "decisoes", "liberar"].includes(k));

describe("o pedido cuja âncora cai dentro de uma troca agrupada fica depois dela", () => {
  it("aberto: o cartão do Ze vem depois de 'Conversou com Leo', não em cima", () => {
    const { e, c } = cenario([...antes(), ...pedidoDoLeo()], [pedido("d1", "tk")]);
    const ordem = chaves(c, e);
    expect(ordem).toEqual(["p1", "b1", "troca:turno:tk", "decisao:d1"]);
  });

  it("encolhido: o recibo da aprovação (gravado no turno do pedido) também fica depois da troca", () => {
    const recibo = msg("r", t0 + 12 * MIN, { turnoId: "tk", autoria: pessoa, kind: "resultado_aprovacao", texto: "Marlon aprovou 1 de 1.", payload: { kind: "resultado_aprovacao", decisaoId: "d1", frase: "Enviar e-mail para Marta Dias · “Follow-up”", itens: [{ idx: 0, desfecho: "executado", texto: "e-mail" }] } });
    const { e, c } = cenario([...antes(), ...pedidoDoLeo(), recibo, msg("b2", t0 + 13 * MIN, { turnoId: "t2", origemTurno: "retomada", fimDoTurno: true, texto: "Enviado." })]);
    const ordem = chaves(c, e);
    expect(ordem.indexOf("troca:turno:tk")).toBeLessThan(ordem.findIndex((k) => k.endsWith("r")));
    expect(ordem.findIndex((k) => k.endsWith("r"))).toBeLessThan(ordem.indexOf("b2"));
  });

  it("a troca guarda a posição da mensagem em que entrou; as outras linhas seguem sem o campo", () => {
    const { e, c } = cenario([...antes(), ...pedidoDoLeo()]);
    const blocos = blocosDoHistorico(c, e);
    expect(blocos.find((b) => b.chave === "troca:turno:tk")?.inicio).toBe("k1");
    expect(blocos.find((b) => b.chave === "b1")?.inicio).toBeUndefined();
  });
});
