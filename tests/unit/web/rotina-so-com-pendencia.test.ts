import { describe, expect, it } from "vitest";
import type { RotinaDto } from "../../../src/contracts/api.ts";
import type { PayloadProposta, Proposta } from "../../../src/contracts/conversa.ts";
import { estadoInicial, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { rotuloExecucao } from "../../../web/lib/execucao.ts";
import { renderTimeline } from "../../../web/telas/conversa.ts";
import { renderDetalhes } from "../../../web/telas/detalhes.ts";
import { renderRotinas } from "../../../web/telas/rotinas.ts";

/**
 * Item 7 da ADR-066: a rotina que só acorda com pendência diz isso na lista, no painel do bot e no card da proposta;
 * a janela que passou sem turno aparece no histórico como "sem novidade · sem pendência aberta, nenhum turno rodou".
 */
const TZ = "America/Sao_Paulo";
const AGORA = Date.parse("2026-10-01T09:30:00-03:00");
const H = 3_600_000;
const rotina = { id: "r1", tenantId: "t", ownerId: "p", agenteId: "a1", conversaId: "c1", instrucao: "Retomar o que ficou pela metade", cron: "*/20 * * * *", fusoIana: TZ, estado: "ativa", exigeAprovacao: true, fonte: "pendências", entregavel: "o trabalho retomado", limitesAprovacao: "", politicaSemDado: "", proximaExecucao: AGORA + H, criadoEm: 0, excluidoEm: null, acessos: null } as const;
const dto = (soComPendencia: boolean): RotinaDto => ({ rotina: { ...rotina, soComPendencia }, proximaExecucao: AGORA + H, bloqueio: null, resumo: `todo dia a cada 20 min (${TZ})`, espera: null });
const agente = { id: "a1", tenantId: "t", ownerId: "p", nome: "Dev 1", titulo: "Dev", descricao: "", descricaoEstado: "", cor: "c-black", forma: "quadrado", conversaId: "c1", confirmado: true, fixado: false, oculto: false, naoLido: false, secao: null } as never;
const TAG = ">só com pendência</span>";

describe("rotina só com pendência na web", () => {
  it("histórico: a janela sem turno diz por quê; sem_novidade comum segue só com o nome", () => {
    expect(rotuloExecucao({ desfecho: "sem_novidade", motivo: "sem_pendencia" })).toBe("sem novidade · sem pendência aberta, nenhum turno rodou");
    expect(rotuloExecucao({ desfecho: "sem_novidade", motivo: null })).toBe("sem novidade");
  });

  it("lista de rotinas: a tag só aparece com o flag; o motivo da execução sai em palavras", () => {
    const execucoes = { r1: [{ tenantId: "t", id: "e1", rotinaId: "r1", instanteAgendado: AGORA, turnoId: null, desfecho: "sem_novidade" as const, motivo: "sem_pendencia", em: AGORA }] };
    const com = renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [dto(true)], execucoes });
    expect(com).toContain(TAG);
    expect(com).toContain("<b>sem novidade</b>");
    expect(com).toContain("· sem pendência aberta, nenhum turno rodou");
    expect(com).not.toContain("sem_pendencia");
    expect(renderRotinas({ ...estadoInicial, agora: AGORA, rotinas: [dto(false)] })).not.toContain(TAG);
  });

  it("painel do bot: 'só com pendência' na linha da rotina, e o nível dela explica", () => {
    const base: Estado = { ...estadoInicial, agora: AGORA, tela: { tipo: "conversa", conversaId: "c1", agenteId: "a1" }, frota: { agentes: [agente], negacoes: [] } as never };
    expect(renderDetalhes({ ...base, rotinas: [dto(true)] })).toContain("só com pendência");
    expect(renderDetalhes({ ...base, rotinas: [dto(false)] })).not.toContain("só com pendência");
  });

  it("card da proposta: a rotina nova diz que só acorda com pendência; a mudança mostra o de→para do flag", () => {
    const proposta = (payload: PayloadProposta): Proposta => ({ tenantId: "t", id: "p1", conversaId: "c1", agenteId: "a1", estado: "pendente", criadoEm: AGORA, kind: payload.kind, payload });
    const conversa = (p: Proposta): ConversaEstado => ({ conversa: { tenantId: "t", id: "c1", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a1", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens: [], propostas: [p], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], carregadaEm: 0 });
    const estado: Estado = { ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" } };
    const nova = { kind: "rotina" as const, cron: rotina.cron, fusoIana: TZ, instrucao: rotina.instrucao, fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "s", proximaExecucao: AGORA + H, resumo: "a cada 20 min" };
    expect(renderTimeline(conversa(proposta({ ...nova, soComPendencia: true })), estado)).toContain("<b>acorda</b>só com pendência aberta (sem nenhuma, a janela passa sem turno)");
    expect(renderTimeline(conversa(proposta(nova)), estado)).not.toContain("<b>acorda</b>");
    const mudanca = { kind: "rotina_atualizacao" as const, rotinaId: "r1", fusoIana: TZ, proximaExecucao: AGORA + H, resumo: "a cada 20 min", antes: { resumo: "a cada 20 min", instrucao: rotina.instrucao } };
    expect(renderTimeline(conversa(proposta({ ...mudanca, soComPendencia: true })), estado)).toContain("<b>acorda</b>em toda janela → só com pendência aberta");
    expect(renderTimeline(conversa(proposta({ ...mudanca, soComPendencia: false })), estado)).toContain("<b>acorda</b>só com pendência aberta → em toda janela");
    expect(renderTimeline(conversa(proposta(mudanca)), estado)).not.toContain("<b>acorda</b>");
  });
});
