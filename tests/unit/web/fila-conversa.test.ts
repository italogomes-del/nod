import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { renderMensagem, situacaoNaFila } from "../../../web/telas/conversa.ts";

const C = "c1";
const AGORA = 1_000_000;

function mensagem(id: string): Mensagem {
  return { tenantId: "t", id, conversaId: C, turnoId: null, autoria: { autor_tipo: "pessoa", autor_id: "p" }, kind: "texto", texto: "fazer novamente", payload: null, confianca: "confiavel", parcial: false, criadoEm: AGORA } as unknown as Mensagem;
}

function comConversa(dto: Partial<ConversaDto>): Estado {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 },
    mensagens: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
    ...dto,
  };
  const e = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA });
  return { ...e, frota: { agentes: [{ id: "a", nome: "Nina", conversaId: C }] } as never };
}

describe("fila da conversa: cada mensagem com seu Cancelar", () => {
  const emCurso = (id: string, estado: "pendente" | "despachando", mensagemId: string | null) => ({ id, estado, desde: AGORA, mensagemId });

  it("uma na fila: lê quando terminar; duas: lê junto com as outras", () => {
    const uma = comConversa({ turnosEmCurso: [emCurso("rodando", "despachando", "m1"), emCurso("t2", "pendente", "m2")] });
    expect(situacaoNaFila(mensagem("m2"), uma)).toEqual({ tipo: "na_fila", turnoId: "t2", texto: "Na fila · Nina lê quando terminar o turno atual" });
    expect(situacaoNaFila(mensagem("m1"), uma)).toBeNull();
    const duas = comConversa({ turnosEmCurso: [emCurso("t2", "pendente", "m2"), emCurso("t3", "pendente", "m3")] });
    expect(situacaoNaFila(mensagem("m3"), duas)).toEqual({ tipo: "na_fila", turnoId: "t3", texto: "Na fila · Nina lê junto com as outras quando terminar" });
  });

  it("Cancelar mostra Desfazer por 5 s só na web; cancelada no servidor vira 'não rodou'", () => {
    const e = comConversa({ turnosEmCurso: [emCurso("t2", "pendente", "m2")] });
    const cancelando = reduzir(e, { tipo: "cancelando-turno", turnoId: "t2", agora: AGORA });
    expect(situacaoNaFila(mensagem("m2"), cancelando)).toEqual({ tipo: "cancelando", turnoId: "t2" });
    expect(renderMensagem(mensagem("m2"), cancelando)).toContain('data-act="desfazer-cancelamento"');
    expect(situacaoNaFila(mensagem("m2"), reduzir(cancelando, { tipo: "desfazer-cancelamento", turnoId: "t2" }))?.tipo).toBe("na_fila");
    expect(situacaoNaFila(mensagem("m2"), comConversa({ turnosCancelados: [{ id: "t2", mensagemId: "m2" }] }))).toEqual({ tipo: "cancelada", turnoId: "t2" });
  });

  it("mensagem cujo turno já rodou (ou foi lido junto com outro) não tem chip", () => {
    const e = comConversa({});
    expect(situacaoNaFila(mensagem("m1"), e)).toBeNull();
    expect(renderMensagem(mensagem("m1"), e)).not.toContain("fila-chip");
  });
});
