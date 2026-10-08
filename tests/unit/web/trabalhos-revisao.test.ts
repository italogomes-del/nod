import { describe, expect, it } from "vitest";
import type { FrameSse } from "../../../src/contracts/frame.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import type { TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import { aplicarFrame, estadoInicial, mudouNaTela, reduzir, type Estado, type Tela } from "../../../web/estado/reducer.ts";
import { ATIVIDADE_VAZIA, comTexto } from "../../../web/lib/atividade.ts";
import { lembrar } from "../../../web/lib/lembrar.ts";
import { blocosAoVivoDaTask, blocosDoHistoricoDaTask, renderFaixaTrabalhos, renderTelaTrabalho } from "../../../web/telas/trabalhos.ts";

/**
 * Correções da revisão do épico #188 na web (definido em 2026-10-08, achados W1–W12): a tela da task por blocos, a task
 * que some, a pressão que volta a null, a task reaberta, o turno fantasma, a faixa ao vivo, o ao vivo esquecido ao sair e
 * o último lote da telemetria. W3 está em envio-idempotente.test.ts; W7, W8 e W10, em chat-limpo.test.ts.
 */

const MIN = 60_000;
const AGORA = new Date(2026, 9, 8, 10, 0).getTime();

const trabalho = (id: string, extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id, agenteId: "dev1", conversaId: "c-dev1", titulo: id, origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 30 * MIN, iniciadoEm: AGORA - 20 * MIN, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: null, esperandoComputadorDe: null, ...extra,
});

const autoria = { autor_tipo: "agente", autor_id: "dev1", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:teste", regra_versao: 1 } as const;
const fala = (id: string, i: number): Mensagem => ({ tenantId: "t", id, conversaId: "c-dev1", turnoId: "tv", autoria, kind: "texto", texto: `passo **${i}** do login`, payload: null, confianca: "confiavel", parcial: false, criadoEm: AGORA - 10 * MIN + i, trabalhoId: "login", origemTurno: "conversa", fimDoTurno: false } as Mensagem);

const frame = (tipo: FrameSse["tipo"], dados: Record<string, unknown>): FrameSse => ({ streamId: "s", seq: 1, pessoaId: "p", tipo, dados });

function estadoCom(trabalhos: TrabalhoDto[], extra: Partial<Estado> = {}): Estado {
  return {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
    frota: { agentes: [
      { id: "leo", nome: "Leonardo", conversaId: "c-leo", cor: "c-purple", forma: "shape-circle", ownerId: "p", titulo: "Dados", descricao: "", confirmado: true },
      { id: "dev1", nome: "Dev 1", conversaId: "c-dev1", cor: "c-green", forma: "shape-square", ownerId: "p", titulo: "Dev", descricao: "", confirmado: true },
    ] } as never,
    trabalhos: { trabalhos, pressao: null, memoriaTotalMb: null },
    tela: { tipo: "conversa", conversaId: "c-leo", agenteId: "leo" },
    ...extra,
  };
}

const conversaLeo: Tela = { tipo: "conversa", conversaId: "c-leo", agenteId: "leo" };
const telaLogin: Tela = { tipo: "trabalho", id: "login", voltar: conversaLeo };

/** A tela da task do Dev 1 aberta (a conversa dele não está carregada), com o turno `tv` rodando e N mensagens. */
function naTask(n = 30): Estado {
  const login = trabalho("login", { turnoVivoId: "tv" });
  return reduzir(estadoCom([login], { tela: telaLogin }), { tipo: "hidratar-trabalho", detalhe: { trabalho: login, mensagens: Array.from({ length: n }, (_, i) => fala(`m${i}`, i)) }, agora: AGORA });
}

describe("W1: a tela da task desenhada por blocos, como a conversa", () => {
  it("turno.delta com a tela da task aberta muda a tela, mas não refaz o histórico; o ao vivo mostra o texto", () => {
    let desenhos = 0;
    const historico = (e: Estado) => lembrar("teste-task-historico", e, ["login"], (x) => {
      desenhos += 1;
      return blocosDoHistoricoDaTask(x, "login");
    });
    let e = naTask();
    const primeiro = historico(e);
    expect(primeiro.map((b) => b.chave)).toEqual(["abertura", ...Array.from({ length: 30 }, (_, i) => `m${i}`)]);
    for (let i = 0; i < 50; i++) {
      const antes = e;
      e = aplicarFrame(e, frame("turno.delta", { turnoId: "tv", conversaId: "c-dev1", texto: `pedaço ${i} ` }), AGORA);
      expect(mudouNaTela(antes, e)).toBe(true);
    }
    expect(historico(e)).toBe(primeiro);
    expect(desenhos).toBe(1);
    const aoVivo = blocosAoVivoDaTask(e, "login");
    expect(aoVivo.map((b) => b.chave)).toEqual(["agora"]);
    expect(aoVivo[0]?.html).toContain("pedaço 49");
    // A string inteira (a que os outros testes das telas leem) é a junção das duas partes.
    expect(renderTelaTrabalho(e, "login")).toBe([...primeiro, ...aoVivo].map((b) => b.html).join(""));
  });

  it("mensagem nova refaz o histórico, e os blocos das outras mensagens ficam idênticos", () => {
    const e = naTask(5);
    const antes = blocosDoHistoricoDaTask(e, "login");
    const d = e.trabalhoDetalhe.login!;
    const depois = blocosDoHistoricoDaTask(reduzir(e, { tipo: "hidratar-trabalho", detalhe: { ...d, mensagens: [...d.mensagens, fala("m5", 5)] }, agora: AGORA }), "login");
    expect(depois.slice(0, antes.length)).toEqual(antes);
    expect(depois.at(-1)?.chave).toBe("m5");
  });
});

describe("W9: o passo da faixa anda ao vivo", () => {
  it("com o ao vivo do turno do trabalho guardado, a faixa mostra o passo dele; sem ele, o último passo do servidor", () => {
    const migrar = trabalho("migrar", { agenteId: "leo", conversaId: "c-leo", titulo: "Migrar relatórios", ultimoPasso: "18 de 42", turnoVivoId: "tm", iniciadoEm: AGORA - 15 * MIN });
    const e = estadoCom([migrar]);
    expect(renderFaixaTrabalhos(e, "leo")).toContain("18 de 42 · 15 min");
    const vivo = { ...e, atividades: { "c-leo": { tm: comTexto(ATIVIDADE_VAZIA, "Convertendo o lote 19.") } } };
    const html = renderFaixaTrabalhos(vivo, "leo");
    expect(html).toContain("Convertendo o lote 19… · 15 min");
    expect(html).not.toContain("18 de 42");
  });
});
