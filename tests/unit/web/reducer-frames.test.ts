import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { FrameSse, TipoFrame } from "../../../src/contracts/frame.ts";
import { aplicarFrame, estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";

const CONVERSA = "11111111-1111-4111-8111-111111111111";
const TURNO = "22222222-2222-4222-8222-222222222222";
const AGORA = 1_700_000_000_000;

function frame(tipo: TipoFrame, dados: Record<string, unknown> = {}, seq = 1): FrameSse {
  return { streamId: "s", seq, pessoaId: "p", tipo, dados };
}

function conversaVazia(): ConversaDto {
  return {
    conversa: { tenantId: "t", id: CONVERSA, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 },
    mensagens: [],
    turnosPendentes: [],
    turnosEmCurso: [],
    turnosCancelados: [],
    propostas: [],
  };
}

function comConversa(): Estado {
  return reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa: conversaVazia(), agora: AGORA });
}

/**
 * Um caso por TipoFrame (ADR-016/020): o frame NÃO carrega conteúdo — ele diz o que mudou e o
 * reducer marca o que reidratar por REST (`invalidacoes`); só os deltas de turno entram direto.
 * A tabela POR_FRAME é total: um tipo novo no contrato não compila sem entrar aqui.
 */
describe("aplicarFrame por TipoFrame", () => {
  it("mensagem.nova invalida a conversa do frame (e só ela); sem conversaId não invalida nada", () => {
    const e = aplicarFrame(estadoInicial, frame("mensagem.nova", { conversaId: CONVERSA, kind: "mensagem_criada" }), AGORA);
    expect(e.invalidacoes).toEqual([`conversa:${CONVERSA}`]);
    expect(aplicarFrame(estadoInicial, frame("mensagem.nova", { kind: "mensagem_criada" }), AGORA).invalidacoes).toEqual([]);
    // sem duplicata quando o mesmo frame chega duas vezes
    expect(aplicarFrame(e, frame("mensagem.nova", { conversaId: CONVERSA }), AGORA).invalidacoes).toEqual([`conversa:${CONVERSA}`]);
  });

  it("turno.iniciado: kind turno_criado = 'na fila', turno_despachado = 'rodando' (pendência L8 §5), guardando executor e máquina", () => {
    const naFila = aplicarFrame(estadoInicial, frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_criado" }), AGORA);
    expect(naFila.turnosVivos[TURNO]).toMatchObject({ estado: "na_fila", conversaId: CONVERSA, desde: AGORA });
    const rodando = aplicarFrame(naFila, frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_despachado", executor: "catcher", machine_id: "m1" }), AGORA + 5);
    expect(rodando.turnosVivos[TURNO]).toMatchObject({ estado: "rodando", executor: "catcher", machineId: "m1", desde: AGORA });
  });

  it("turno.delta acumula o texto por turno na conversa carregada e promove o turno a 'rodando'; turno.encerrado limpa o delta e o vivo", () => {
    let e = aplicarFrame(comConversa(), frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_criado" }), AGORA);
    e = aplicarFrame(e, frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "Olá, " }), AGORA);
    e = aplicarFrame(e, frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "mundo" }), AGORA);
    expect(e.conversas[CONVERSA]?.atividades[TURNO]?.atual).toBe("Olá, mundo");
    expect(e.turnosVivos[TURNO]?.estado).toBe("rodando");
    e = aplicarFrame(e, frame("turno.encerrado", { conversaId: CONVERSA, turnoId: TURNO }), AGORA);
    expect(e.conversas[CONVERSA]?.atividades).toEqual({});
    expect(e.turnosVivos[TURNO]).toBeUndefined();
    expect(e.invalidacoes).toEqual([`conversa:${CONVERSA}`, "frota"]);
  });

  it("turno.atividade fecha a narração numa etapa: o texto de antes e o de depois da ferramenta nunca se colam ('lote.44')", () => {
    let e = aplicarFrame(comConversa(), frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_criado" }), AGORA);
    e = aplicarFrame(e, frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "Continuando com o próximo lote." }), AGORA);
    e = aplicarFrame(e, frame("turno.atividade", { conversaId: CONVERSA, turnoId: TURNO, nome: "mcp__nod__gmail__search_threads", rotulo: "Consultou Gmail" }), AGORA);
    expect(e.turnosVivos[TURNO]?.estado).toBe("rodando");
    e = aplicarFrame(e, frame("turno.atividade", { conversaId: CONVERSA, turnoId: TURNO, nome: "mcp__nod__gmail__label_thread", rotulo: "Alterou Gmail" }), AGORA);
    e = aplicarFrame(e, frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "44 processados." }), AGORA);
    expect(e.conversas[CONVERSA]?.atividades[TURNO]).toEqual({
      atual: "44 processados.",
      etapas: [{ texto: "Continuando com o próximo lote.", ferramentas: 2 }],
      totalEtapas: 1,
      ferramentas: 2,
      ultimaFerramenta: "Alterou Gmail",
    });
  });

  it("turno.interrompido limpa o vivo e invalida conversa, frota e sua-vez (pode ter nascido 'retomar?')", () => {
    let e = aplicarFrame(comConversa(), frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_despachado" }), AGORA);
    e = aplicarFrame(e, frame("turno.interrompido", { conversaId: CONVERSA, turnoId: TURNO, motivo: "parado_pela_pessoa" }), AGORA);
    expect(e.turnosVivos).toEqual({});
    expect(e.invalidacoes).toEqual([`conversa:${CONVERSA}`, "frota", "sua-vez"]);
  });

  it("decisao.nova / decisao.decidida / decisao.vencida invalidam Sua vez e a conversa", () => {
    for (const tipo of ["decisao.nova", "decisao.decidida", "decisao.vencida"] as const) {
      expect(aplicarFrame(estadoInicial, frame(tipo, { conversaId: CONVERSA }), AGORA).invalidacoes).toEqual(["sua-vez", `conversa:${CONVERSA}`]);
    }
  });

  it("proposta.nova e sala.handoff invalidam a conversa; rotina.criada invalida rotinas; rotina.executou também as execuções da rotina", () => {
    expect(aplicarFrame(estadoInicial, frame("proposta.nova", { conversaId: CONVERSA }), AGORA).invalidacoes).toEqual([`conversa:${CONVERSA}`]);
    expect(aplicarFrame(estadoInicial, frame("sala.handoff", { conversaId: CONVERSA }), AGORA).invalidacoes).toEqual([`conversa:${CONVERSA}`]);
    expect(aplicarFrame(estadoInicial, frame("rotina.criada", { conversaId: CONVERSA }), AGORA).invalidacoes).toEqual(["rotinas", `conversa:${CONVERSA}`]);
    expect(aplicarFrame(estadoInicial, frame("rotina.executou", { conversaId: CONVERSA, rotinaId: "r1" }), AGORA).invalidacoes).toEqual(["rotinas", `conversa:${CONVERSA}`, "execucoes:r1"]);
  });

  it("negacao vira estado ESCRITO por classe com relógio (ADR-029), 20 mais recentes; frame malformado só invalida", () => {
    const e = aplicarFrame(estadoInicial, frame("negacao", { conversaId: CONVERSA, classe: "ferramenta_negada", motivo: "fora_do_catalogo", nome: "exemplo__apagar", terminal: true, desde: AGORA - 1000 }), AGORA);
    expect(e.negacoes).toEqual([{ classe: "ferramenta_negada", motivo: "fora_do_catalogo", nome: "exemplo__apagar", terminal: true, desde: AGORA - 1000, conversaId: CONVERSA, vistaEm: AGORA }]);
    const mal = aplicarFrame(estadoInicial, frame("negacao", { conversaId: CONVERSA, classe: "outra" }), AGORA);
    expect(mal.negacoes).toEqual([]);
    expect(mal.invalidacoes).toEqual([`conversa:${CONVERSA}`]);
    let muitas = estadoInicial;
    for (let i = 0; i < 25; i++) muitas = aplicarFrame(muitas, frame("negacao", { classe: "plano_ausente", motivo: "plano_ausente", nome: `n${i}` }, i), AGORA + i);
    expect(muitas.negacoes).toHaveLength(20);
    expect(muitas.negacoes[0]?.nome).toBe("n24");
  });

  it("inventario.mudou invalida inventário, frota e o interruptor de executor; agente.mudou invalida frota (+ memória quando a ação é memoria_criada, + concessões quando é concessao_criada)", () => {
    expect(aplicarFrame(estadoInicial, frame("inventario.mudou"), AGORA).invalidacoes).toEqual(["inventario", "frota", "executor"]);
    expect(aplicarFrame(estadoInicial, frame("agente.mudou", { agente_id: "a1", acao: "perfil_confirmado" }), AGORA).invalidacoes).toEqual(["frota", "gestao"]);
    expect(aplicarFrame(estadoInicial, frame("agente.mudou", { agente_id: "a1", acao: "memoria_criada", conversaId: CONVERSA }), AGORA).invalidacoes).toEqual(["frota", "gestao", `conversa:${CONVERSA}`, "memoria:a1"]);
    expect(aplicarFrame(estadoInicial, frame("agente.mudou", { agente_id: "a1", kind: "concessao_criada" }), AGORA).invalidacoes).toEqual(["frota", "gestao", "concessoes:a1"]);
  });

  it("parada.faixa vira FaixaParada renderizável (nadaRodando escrito, nunca em branco)", () => {
    const e = aplicarFrame(estadoInicial, frame("parada.faixa", { conversaId: CONVERSA, interrompidas: 1, nao_interrompidas: 0, ja_entregues: 0, nada_rodando: false }), AGORA);
    expect(e.faixaParada).toEqual({ interrompidas: 1, naoInterrompidas: [], jaEntregues: [], nadaRodando: false });
    expect(aplicarFrame(estadoInicial, frame("parada.faixa", { nada_rodando: true }), AGORA).faixaParada?.nadaRodando).toBe(true);
  });

  it("resumed:false reidrata TUDO (replay parcial nunca é aplicado, ADR-016); resumed:true não faz nada", () => {
    const e = aplicarFrame(comConversa(), frame("resumed", { resumed: false }), AGORA);
    expect(e.invalidacoes).toEqual(["frota", "sua-vez", "rotinas", "conectores", "inventario", "executor", "salas", `conversa:${CONVERSA}`]);
    expect(aplicarFrame(comConversa(), frame("resumed", { resumed: true }), AGORA).invalidacoes).toEqual([]);
  });
});

describe("reduzir: hidratar e navegar", () => {
  it("hidratar-conversa preserva o delta de um turno ainda vivo e descarta os outros", () => {
    let e = aplicarFrame(comConversa(), frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_despachado" }), AGORA);
    e = aplicarFrame(e, frame("turno.delta", { conversaId: CONVERSA, turnoId: TURNO, texto: "x" }), AGORA);
    e = aplicarFrame(e, frame("turno.delta", { conversaId: CONVERSA, turnoId: "outro", texto: "morto" }), AGORA);
    e = reduzir(e, { tipo: "hidratar-conversa", conversa: conversaVazia(), agora: AGORA });
    expect(Object.keys(e.conversas[CONVERSA]?.atividades ?? {})).toEqual([TURNO]);
  });

  it("hidratar-conversa recria o turno que a página não viu nascer (recarregou no meio dele), com o desde do banco", () => {
    const conversa = { ...conversaVazia(), turnosEmCurso: [{ id: TURNO, estado: "despachando" as const, desde: AGORA - 14 * 60_000, mensagemId: null }, { id: "fila", estado: "pendente" as const, desde: AGORA, mensagemId: null }] };
    const e = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA });
    expect(e.turnosVivos[TURNO]).toMatchObject({ conversaId: CONVERSA, estado: "rodando", desde: AGORA - 14 * 60_000 });
    expect(e.turnosVivos.fila).toMatchObject({ estado: "na_fila" });
    // Um vivo que a web já conhecia não é sobrescrito (guarda executor e máquina do frame).
    const conhecido = aplicarFrame(estadoInicial, frame("turno.iniciado", { conversaId: CONVERSA, turnoId: TURNO, kind: "turno_despachado", executor: "claude-cli" }), AGORA);
    expect(reduzir(conhecido, { tipo: "hidratar-conversa", conversa, agora: AGORA }).turnosVivos[TURNO]?.executor).toBe("claude-cli");
  });

  it("invalidacoes-tratadas remove só as tratadas; navegar limpa erro e a faixa ao trocar de tipo de tela", () => {
    let e = reduzir(estadoInicial, { tipo: "invalidar", quais: ["frota", "sua-vez"] });
    e = reduzir(e, { tipo: "invalidacoes-tratadas", quais: ["frota"] });
    expect(e.invalidacoes).toEqual(["sua-vez"]);
    e = reduzir(e, { tipo: "faixa", faixa: { interrompidas: 0, naoInterrompidas: [], jaEntregues: [], nadaRodando: true } });
    e = reduzir(e, { tipo: "erro", erro: { codigo: "nao_encontrado", mensagem: "não encontrado" } });
    e = reduzir(e, { tipo: "navegar", tela: { tipo: "sua-vez" } });
    expect(e.erro).toBeNull();
    expect(e.faixaParada).toBeNull();
    expect(e.tela).toEqual({ tipo: "sua-vez" });
  });
});
