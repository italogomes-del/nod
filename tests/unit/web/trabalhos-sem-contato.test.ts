import { describe, expect, it } from "vitest";
import type { TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { agrupar, dicaSemContato, emEspera, esperandoMaquina, pontoTrabalho, resumoDaPilula, situacaoDe } from "../../../web/lib/trabalhos.ts";
import { custoDoTurno, renderFaixaDev, totalUsd } from "../../../web/telas/modo-dev.ts";
import { chipTrabalhosDoBot, renderTodosOsTrabalhos, renderTopoTrabalho } from "../../../web/telas/trabalhos.ts";

/**
 * NOD-260 (G8) e NOD-276 (G12), definidos em 2026-10-15: o trabalho cuja máquina não fala com o servidor espera essa
 * máquina — despachando: "esperando <máquina> · sem contato desde HH:MM"; na fila: "esperando <máquina> · sem contato".
 * Sem o atalho "Rodar em outra".
 */
const AGORA = new Date(2026, 9, 15, 15, 0).getTime();
const DESDE = new Date(2026, 9, 15, 14, 32).getTime();
const trabalho = (extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id: "t1", agenteId: "leo", conversaId: "c-leo", titulo: "t1", origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 3_600_000, iniciadoEm: AGORA - 3_600_000, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: "turno", esperandoComputadorDe: null, ...extra,
});
const vm = (semContatoDesde: number | null) => ({ id: "vm", nome: "nod-motor-teste", ehMac: false, semContatoDesde });

describe("trabalho com a máquina sem contato", () => {
  it("despachando: espera a máquina, com a hora do último contato", () => {
    const t = trabalho({ maquina: vm(DESDE) });
    expect(esperandoMaquina(t)).toEqual({ nome: "nod-motor-teste", desde: DESDE });
    expect(situacaoDe(t, [t], false, AGORA)).toBe("esperando nod-motor-teste · sem contato desde 14:32");
  });

  it("na fila: espera a máquina, sem hora", () => {
    const t = trabalho({ estado: "na_fila", iniciadoEm: null, turnoVivoId: null, maquina: vm(DESDE) });
    expect(situacaoDe(t, [t], false, AGORA)).toBe("esperando nod-motor-teste · sem contato");
  });

  it("vai ao grupo esperando, não trabalhando", () => {
    const g = agrupar([trabalho({ maquina: vm(DESDE) }), trabalho({ id: "t2", maquina: vm(null) })], AGORA);
    expect(g.esperando.map((t) => t.id)).toEqual(["t1"]);
    expect(g.trabalhando.map((t) => t.id)).toEqual(["t2"]);
  });

  it("máquina em contato, ou servidor de antes (sem o campo): nada muda", () => {
    expect(esperandoMaquina(trabalho({ maquina: vm(null) }))).toBeNull();
    expect(esperandoMaquina(trabalho({ maquina: { id: "vm", nome: "x", ehMac: false } }))).toBeNull();
    expect(esperandoMaquina(trabalho())).toBeNull();
  });
});

describe("custo desconhecido e total parcial (D10)", () => {
  it("o turno sem result mostra 'custo desconhecido'; o total marca '(parcial)'", () => {
    expect(custoDoTurno(null, true)).toBe("custo desconhecido");
    expect(custoDoTurno(0.5, true)).not.toBe("custo desconhecido");
    expect(totalUsd(1.2, true)).toMatch(/\(parcial\)$/);
    expect(totalUsd(1.2, false)).not.toMatch(/parcial/);
  });
});

function estadoCom(trabalhos: TrabalhoDto[]): Estado {
  return {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
    frota: { agentes: [{ id: "leo", nome: "Leonardo", conversaId: "c-leo", cor: "c-blue", forma: "shape-circle", ownerId: "p", titulo: "PM", descricao: "", confirmado: true }] } as never,
    trabalhos: { trabalhos, pressao: "verde", memoriaTotalMb: 300, processador: "verde", cargaProcessador: 0.3, segurando: false },
    tela: { tipo: "trabalhos" },
  };
}

describe("revisão do Gil no #336: a máquina sem contato é espera em todo lugar", () => {
  const preso = trabalho({ maquina: vm(DESDE), ultimoPasso: "lendo o diff" });

  it("um predicado só: emEspera", () => {
    expect(emEspera(preso)).toBe(true);
    expect(emEspera(trabalho({ maquina: vm(null) }))).toBe(false);
  });

  it("o ponto da linha é o vazado da espera, sem pulso", () => {
    const ponto = pontoTrabalho(preso, "c-blue");
    expect(ponto).toContain("fora-do-mac");
    expect(ponto).not.toContain("pulso-trab");
  });

  it("o chip da barra não pulsa e a pílula diz esperando", () => {
    const chip = chipTrabalhosDoBot(estadoCom([preso]), { id: "leo", cor: "c-blue", conversaId: "c-leo" });
    expect(chip).toContain("ponto-trabalho fora-do-mac");
    expect(chip).not.toContain("pulso-trab");
    expect(chip).toContain("1 esperando");
    expect(resumoDaPilula([preso])).toMatchObject({ ponto: "fora-do-mac", texto: "esperando" });
  });

  it("o topo da task nunca diz 'trabalhando'", () => {
    const topo = renderTopoTrabalho(estadoCom([preso]), "t1");
    expect(topo).not.toContain(">trabalhando<");
    expect(topo).toContain("esperando nod-motor-teste · sem contato desde 14:32");
    expect(topo).toContain("tk-status fora-do-mac");
  });

  it("o contato de outro dia diz o dia", () => {
    const ontem = new Date(2026, 9, 14, 14, 32).getTime();
    const antes = new Date(2026, 9, 12, 9, 5).getTime();
    expect(situacaoDe(trabalho({ maquina: vm(ontem) }), [], false, AGORA)).toBe("esperando nod-motor-teste · sem contato desde ontem 14:32");
    expect(situacaoDe(trabalho({ maquina: vm(antes) }), [], false, AGORA)).toBe("esperando nod-motor-teste · sem contato desde 12/10 09:05");
  });

  it("o passo cortado leva o texto inteiro e a pista no title", () => {
    expect(dicaSemContato(preso, AGORA)).toBe("nod-motor-teste não responde desde 14:32. O trabalho segue sozinho quando ela voltar; para rodar em outra máquina desta vez, abra a conversa do bot.");
    const html = renderTodosOsTrabalhos(estadoCom([preso]));
    expect(html).toContain('title="nod-motor-teste não responde desde 14:32.');
  });

  it("'custo desconhecido' explica no title", () => {
    const faixa = renderFaixaDev({ turnoId: "t", custoUsd: null, chamadas: 2, compactacoes: 0, picoContexto: null, janela: null, cachePct: null, modelo: null } as never);
    expect(faixa).toContain('title="O turno caiu antes de informar o custo; os tokens estão somados."');
  });
});
