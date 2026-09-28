import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import type { RaioXConversa } from "../../../src/contracts/raio-x.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { renderCabecalhoConversa, renderMensagem } from "../../../web/telas/conversa.ts";
import { mil, renderFaixaDev, usd } from "../../../web/telas/modo-dev.ts";

const C = "c1";
const bot = (id: string, turnoId: string | null, kind: Mensagem["kind"] = "texto"): Mensagem => ({
  tenantId: "t", id, conversaId: C, turnoId, autoria: { autor_tipo: "agente", autor_id: "a" }, kind, texto: `fala ${id}`, payload: null, confianca: "confiavel", parcial: false, criadoEm: 1,
} as Mensagem);
const RAIO_X: RaioXConversa = {
  turnos: [{ turnoId: "t1", custoUsd: 1.02, chamadas: 5, compactacoes: 3, picoContexto: 197_500, janela: 200_000, cachePct: 98, modelo: "claude-sonnet-5" }],
  desde: { custoUsd: 22.67, turnos: 66 },
};

function comConversa(mensagens: Mensagem[]): Estado {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
  };
  const e = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: 1 });
  return { ...e, frota: { agentes: [{ id: "a", nome: "Clarice", conversaId: C }] } as never };
}

describe("modo dev na web", () => {
  it("números como no canvas: mil com uma casa, dólar com duas (três abaixo de um centavo)", () => {
    expect([mil(158_000), mil(197_500), mil(850)]).toEqual(["158 mil", "197,5 mil", "850"]);
    expect([usd(1.02), usd(0.004), usd(null)]).toEqual(["US$ 1,02", "US$ 0,004", "US$ —"]);
  });

  it("a faixa: custo, chamadas + compactações, contexto perto do teto em alerta, cache, modelo e o Raio-X", () => {
    const html = renderFaixaDev(RAIO_X.turnos[0]!);
    expect(html).toContain("US$ 1,02");
    expect(html).toContain("5 chamadas + 3 compactações");
    expect(html).toContain("faixa-dev-alerta");
    expect(html).toContain("contexto 197,5 mil / 200 mil");
    expect(html).toContain("98% do cache");
    expect(html).toContain(">sonnet<");
    expect(html).toContain('data-act="abrir-raio-x" data-id="t1"');
  });

  it("desligado, nada; ligado, só na ÚLTIMA mensagem do turno, e o selo com o total de hoje no cabeçalho", () => {
    const base = comConversa([bot("m1", "t1"), bot("m2", "t1", "sistema"), bot("m3", null)]);
    expect(renderMensagem(bot("m1", "t1"), base)).not.toContain("faixa-dev");
    expect(renderCabecalhoConversa(base, "a")).not.toContain("MODO DEV");

    const ligado = reduzir(reduzir(base, { tipo: "modo-dev", ligado: true }), { tipo: "hidratar-raio-x", conversaId: C, raioX: RAIO_X });
    expect(renderMensagem(bot("m1", "t1"), ligado)).not.toContain("faixa-dev");
    expect(renderMensagem(bot("m2", "t1", "sistema"), ligado)).toContain("faixa-dev");
    expect(renderMensagem(bot("m3", null), ligado)).not.toContain("faixa-dev");
    expect(renderCabecalhoConversa(ligado, "a")).toContain("Hoje com Clarice: <b>US$ 22,67</b> · 66 turnos");

    // Desligar esquece os resumos; religar busca de novo.
    expect(reduzir(ligado, { tipo: "modo-dev", ligado: false }).modoDev).toEqual({ ligado: false, raioX: {} });
  });
});
