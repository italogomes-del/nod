import { describe, expect, it } from "vitest";
import type { CustoDoDiaDto } from "../../../src/contracts/cota.ts";
import type { TrabalhoDto, TrabalhosDto } from "../../../src/contracts/trabalho.ts";
import { estadoInicial, invalidacoesDaTela, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { pilulaDaCota, situacaoDe } from "../../../web/lib/trabalhos.ts";
import { custoDoTopo, renderTodosOsTrabalhos } from "../../../web/telas/trabalhos.ts";

/** ADR-099 §7 (definido em 2026-10-12): a cota da IA na tela Trabalhos e o custo de cada bot hoje, atrás de um clique. */

const HORA = 3_600_000;
const AGORA = new Date(2026, 9, 12, 15, 0).getTime();

const trabalho = (id: string, extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id, agenteId: "ze", conversaId: "c-ze", titulo: id, origem: "rotina", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "na_fila",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - HORA, iniciadoEm: null, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: null, esperandoComputadorDe: null, ...extra,
});

function estadoCom(trabalhos: Partial<TrabalhosDto>, extra: Partial<Estado> = {}): Estado {
  return {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
    frota: { agentes: [
      { id: "ze", nome: "Ze 1", conversaId: "c-ze", cor: "c-purple", forma: "shape-circle", ownerId: "p", titulo: "Dev", descricao: "", confirmado: true },
      { id: "ana", nome: "Ana", conversaId: "c-ana", cor: "c-green", forma: "shape-square", ownerId: "p", titulo: "Dados", descricao: "", confirmado: true },
    ] } as never,
    trabalhos: { trabalhos: [], pressao: null, memoriaTotalMb: null, ...trabalhos },
    tela: { tipo: "trabalhos" },
    ...extra,
  };
}

const custo: CustoDoDiaDto = {
  fuso: "America/Sao_Paulo", desde: AGORA - 15 * HORA, ate: AGORA, totalUsd: 21.4, foraDoRitmo: true,
  bots: [
    { agenteId: "ze", hojeUsd: 18.2, mediaUsd: 6, vezes: 3.03, foraDoRitmo: true },
    { agenteId: "ana", hojeUsd: 3.2, mediaUsd: 3, vezes: 1.07, foraDoRitmo: false },
  ],
};

describe("a cota da IA na tela", () => {
  it("a linha da task diz que espera a cota", () => {
    expect(situacaoDe(trabalho("a", { esperaDaCota: true }), [], false, AGORA)).toBe("esperando a cota da IA");
    expect(situacaoDe(trabalho("b"), [], false, AGORA)).toBe("na fila");
  });

  it("a pílula diz quando o fundo volta e que a conversa segue; nada sem cota", () => {
    const voltaEm = new Date(2026, 9, 12, 17, 30).getTime();
    const html = pilulaDaCota({ situacao: "reserva", ias: ["claude-cli"], voltaEm }, [trabalho("a", { esperaDaCota: true }), trabalho("b", { esperaDaCota: true })], AGORA);
    expect(html).toContain("A cota da IA está no fim");
    expect(html).toContain("2 esperam · trabalho de fundo volta às 17:30 · a conversa com você segue");
    expect(pilulaDaCota({ situacao: "limite", ias: ["claude-cli"], voltaEm }, [], AGORA)).toContain("A cota da IA acabou");
    expect(pilulaDaCota(null, [], AGORA)).toBe("");
    expect(pilulaDaCota(undefined, [], AGORA)).toBe("");
  });

  it("Todos os trabalhos mostra a pílula da cota e a linha da task segurada", () => {
    const html = renderTodosOsTrabalhos(estadoCom({ trabalhos: [trabalho("Rotina das 9h", { esperaDaCota: true })], cota: { situacao: "reserva", ias: ["claude-cli"], voltaEm: AGORA + 2 * HORA } }));
    expect(html).toContain("A cota da IA está no fim");
    expect(html).toContain("esperando a cota da IA");
  });
});

describe("o custo de hoje, atrás de um clique", () => {
  it("fechado: só o total e o aviso discreto; nenhum bot à vista", () => {
    const html = custoDoTopo(estadoCom({}, { custoHoje: custo }));
    expect(html).toContain('data-act="custo-hoje"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("US$ 21,40 hoje · acima do normal");
    expect(html).toContain("tt-custo-aviso");
    expect(html).not.toContain("Ze 1");
  });

  it("sem bot fora do ritmo, sem aviso", () => {
    const html = custoDoTopo(estadoCom({}, { custoHoje: { ...custo, foraDoRitmo: false, bots: custo.bots.map((b) => ({ ...b, foraDoRitmo: false })) } }));
    expect(html).not.toContain("acima do normal");
    expect(html).not.toContain("tt-custo-aviso");
  });

  it("aberto: cada bot com o gasto de hoje; quem passou do ritmo diz quantas vezes o normal", () => {
    const html = custoDoTopo(estadoCom({}, { custoHoje: custo, custoAberto: true }));
    expect(html).toContain('aria-expanded="true"');
    expect(html).toMatch(/Ze 1<\/span><small>3× o normal<\/small><b>US\$ 18,20<\/b>/);
    expect(html).toMatch(/Ana<\/span><b>US\$ 3,20<\/b>/);
    expect(html).toContain("mais que o dobro da média dos dias com gasto nos últimos 7 (precisa de pelo menos 3) até este horário");
    expect(html).not.toContain("Parcial:");
  });

  it("revisão do Gil no #336: o bot sem base diz 'sem base'; o total parcial explica o que ficou de fora", () => {
    const semBase = { ...custo, parcial: true, bots: custo.bots.map((b) => (b.agenteId === "ana" ? { ...b, ritmo: "sem base" as const } : b)) };
    const html = custoDoTopo(estadoCom({}, { custoHoje: semBase, custoAberto: true }));
    expect(html).toMatch(/Ana<\/span><small title="Menos de 3 dias com gasto nos últimos 7: ainda não dá para comparar.">sem base<\/small><b>US\$ 3,20<\/b>/);
    expect(html).toContain("(parcial)");
    expect(html).toContain("Parcial: algum turno caiu antes de informar o custo e ficou fora da soma.");
  });

  it("sem leitura (servidor anterior ou ainda carregando), nada", () => {
    expect(custoDoTopo(estadoCom({}))).toBe("");
    expect(custoDoTopo(estadoCom({}, { custoHoje: null }))).toBe("");
  });

  it("a tela Trabalhos pede o custo uma vez; abrir o detalhe relê", () => {
    const e = estadoCom({});
    expect(invalidacoesDaTela(e)).toContain("custo");
    const lido = reduzir(e, { tipo: "hidratar-custo", custo });
    expect(invalidacoesDaTela(lido)).not.toContain("custo");
    const aberto = reduzir(lido, { tipo: "custo-aberto", aberto: true });
    expect(aberto.custoAberto).toBe(true);
    expect(aberto.invalidacoes).toContain("custo");
    expect(reduzir(aberto, { tipo: "custo-aberto", aberto: false }).custoAberto).toBe(false);
  });

  it("trocar de pessoa esquece o custo da anterior", () => {
    const lido = reduzir(estadoCom({}), { tipo: "hidratar-custo", custo });
    expect(reduzir(lido, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "outra" } }).custoHoje).toBeUndefined();
  });
});
