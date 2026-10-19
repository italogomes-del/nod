import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DISJUNTOR_MS, PRAZO_REVISAO_MS, type PedidoRevisao, type RelatoRevisao } from "../../../src/contracts/revisao.ts";
import { criarCaixaRevisoes, provaDaRevisao, type DepsCaixa } from "../../../src/adapters/fundo/caixa-revisoes.ts";
import type { ResultadoRevisao } from "../../../src/use-cases/revisar-acao.ts";

/**
 * A caixa de pedidos de revisão (plano dos modos de aprovação, 3c; ADR-115): memória do processo, dividida pelas pontes.
 * Relógio e prazos injetados — nada aqui depende do relógio de parede.
 */

const ESCOPO = { tenantId: randomUUID(), pessoaId: randomUUID() };
const SEGREDO = "s".repeat(32);
const OUTRO_SEGREDO = "o".repeat(32);
const MAQUINA = "maquina-a";

function montar() {
  let agora = 1_000_000;
  const vencidas: { decisaoId: string; resultado: ResultadoRevisao }[] = [];
  const agendados: { quando: number; fn: () => void; vivo: boolean }[] = [];
  const deps: DepsCaixa = {
    config: { ligado: true, modelo: "claude-sonnet-5-5", esforco: "low", tetoDia: 300, prazoMs: PRAZO_REVISAO_MS },
    agora: () => agora,
    async vencer(p) {
      vencidas.push({ decisaoId: p.decisaoId, resultado: p.resultado });
    },
    agendar(fn, ms) {
      const a = { quando: agora + ms, fn, vivo: true };
      agendados.push(a);
      return () => {
        a.vivo = false;
      };
    },
  };
  const caixa = criarCaixaRevisoes(deps);
  const pedido = (turnoId: string, extra: Partial<PedidoRevisao> = {}): PedidoRevisao => ({ revisaoId: randomUUID(), decisaoId: randomUUID(), turnoId, modelo: "claude-sonnet-5-5", esforco: "low", prompt: "p", entrada: "e", expiraEm: agora + PRAZO_REVISAO_MS, ...extra });
  const enfileirar = (p: PedidoRevisao, machineId = MAQUINA) => caixa.enfileirar({ escopo: ESCOPO, machineId, pedido: p });
  const relato = (p: PedidoRevisao, extra: Partial<RelatoRevisao> = {}, segredo = SEGREDO): RelatoRevisao => ({ revisaoId: p.revisaoId, turnoId: p.turnoId, saida: '{"decisao":"libera","motivo":"você pediu"}', ms: 4000, prova: provaDaRevisao(segredo, p.revisaoId, p.decisaoId), ...extra });
  return {
    caixa,
    vencidas,
    pedido,
    enfileirar,
    relato,
    avancar(ms: number) {
      agora += ms;
      for (const a of agendados) if (a.vivo && a.quando <= agora) {
        a.vivo = false;
        a.fn();
      }
    },
  };
}

describe("caixa de revisões: revisa e o segredo do turno", () => {
  it("o turno só tem revisor quando a última renovação trouxe `revisa` e o segredo", () => {
    const { caixa } = montar();
    const turno = randomUUID();
    expect(caixa.revisorDoTurno(turno)).toBeNull();
    caixa.naRenovacao({ turnoId: turno, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO });
    expect(caixa.revisorDoTurno(turno)).toEqual({ machineId: MAQUINA });
    // App antigo (ou a renovação que perdeu o campo): sem `revisa`, sem revisor.
    caixa.naRenovacao({ turnoId: turno, machineId: MAQUINA, revisa: false, amarraSegredo: true, segredo: SEGREDO });
    expect(caixa.revisorDoTurno(turno)).toBeNull();
    // `revisa` sem segredo também não vale; segredo fora do formato não conta.
    const outro = randomUUID();
    caixa.naRenovacao({ turnoId: outro, machineId: MAQUINA, revisa: true, amarraSegredo: true });
    expect(caixa.revisorDoTurno(outro)).toBeNull();
    caixa.naRenovacao({ turnoId: outro, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: "curto" });
    expect(caixa.revisorDoTurno(outro)).toBeNull();
  });

  it("dois segredos para o turno envenenam: ninguém recebe pedido, o que estava na caixa vira cartão e o turno fica sem revisor (revisão do PR 3a)", () => {
    const { caixa, pedido, enfileirar, relato, vencidas } = montar();
    const turno = randomUUID();
    caixa.naRenovacao({ turnoId: turno, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO });
    const p = pedido(turno);
    enfileirar(p);
    expect(caixa.naRenovacao({ turnoId: turno, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: OUTRO_SEGREDO })).toEqual([]);
    // Quem chegou primeiro pode ser o intruso: nenhum dos dois segredos vale mais.
    expect(vencidas).toEqual([{ decisaoId: p.decisaoId, resultado: { tipo: "falha", falha: "sem_revisor", entregueEm: null } }]);
    expect(caixa.relatar(MAQUINA, relato(p, {}, OUTRO_SEGREDO))).toMatchObject({ aceito: false });
    expect(caixa.relatar(MAQUINA, relato(p))).toMatchObject({ aceito: false, motivo: "desconhecida" });
    expect(caixa.naRenovacao({ turnoId: turno, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO })).toEqual([]);
    expect(caixa.revisorDoTurno(turno)).toBeNull();
  });

  it("o segredo só é amarrado antes do prompt_submitted: o laço antigo (que nunca mandou um) e o mapa vazio depois de um reinício ficam sem revisor (revisão do PR 3a)", () => {
    const { caixa } = montar();
    const turno = randomUUID();
    // O laço antigo renova sem segredo; depois do prompt, um processo do bot manda `revisa` com um segredo dele.
    caixa.naRenovacao({ turnoId: turno, machineId: MAQUINA, revisa: false, amarraSegredo: true });
    caixa.naRenovacao({ turnoId: turno, machineId: MAQUINA, revisa: true, amarraSegredo: false, segredo: OUTRO_SEGREDO });
    expect(caixa.revisorDoTurno(turno)).toBeNull();
    // Reinício: o turno adotado já tinha prompt_submitted, e a primeira renovação que chega não amarra nada.
    const adotado = randomUUID();
    caixa.naRenovacao({ turnoId: adotado, machineId: MAQUINA, revisa: true, amarraSegredo: false, segredo: SEGREDO });
    expect(caixa.revisorDoTurno(adotado)).toBeNull();
    // O segredo amarrado antes do prompt segue valendo nas renovações de depois.
    const novo = randomUUID();
    caixa.naRenovacao({ turnoId: novo, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO });
    caixa.naRenovacao({ turnoId: novo, machineId: MAQUINA, revisa: true, amarraSegredo: false, segredo: SEGREDO });
    expect(caixa.revisorDoTurno(novo)).toEqual({ machineId: MAQUINA });
  });

  it("a renovação de outra máquina para o mesmo turno é ignorada", () => {
    const { caixa, pedido, enfileirar } = montar();
    const turno = randomUUID();
    caixa.naRenovacao({ turnoId: turno, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO });
    enfileirar(pedido(turno));
    expect(caixa.naRenovacao({ turnoId: turno, machineId: "maquina-b", revisa: true, amarraSegredo: true, segredo: SEGREDO })).toEqual([]);
    expect(caixa.revisorDoTurno(turno)).toEqual({ machineId: MAQUINA });
  });
});

describe("caixa de revisões: entrega", () => {
  it("reentrega em toda renovação até `revisoesRecebidas` (a resposta perdida não trava a revisão)", () => {
    const { caixa, pedido, enfileirar } = montar();
    const turno = randomUUID();
    caixa.naRenovacao({ turnoId: turno, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO });
    const p = pedido(turno);
    enfileirar(p);
    expect(caixa.naRenovacao({ turnoId: turno, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO })).toEqual([p]);
    // A resposta dessa renovação "se perdeu": a próxima traz de novo.
    expect(caixa.naRenovacao({ turnoId: turno, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO })).toEqual([p]);
    expect(caixa.naRenovacao({ turnoId: turno, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO, recebidas: [p.revisaoId] })).toEqual([]);
    expect(caixa.naRenovacao({ turnoId: turno, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO })).toEqual([]);
  });

  it("sem `revisa` ou sem o segredo na renovação, nada é entregue", () => {
    const { caixa, pedido, enfileirar } = montar();
    const turno = randomUUID();
    caixa.naRenovacao({ turnoId: turno, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO });
    enfileirar(pedido(turno));
    expect(caixa.naRenovacao({ turnoId: turno, machineId: MAQUINA, revisa: true, amarraSegredo: true })).toEqual([]);
    expect(caixa.naRenovacao({ turnoId: turno, machineId: MAQUINA, revisa: false, amarraSegredo: true, segredo: SEGREDO })).toEqual([]);
  });

  it("no máximo 2 revisões em voo por máquina; a terceira sai quando uma termina (a espera conta no prazo)", () => {
    const { caixa, pedido, enfileirar, relato } = montar();
    const [t1, t2, t3] = [randomUUID(), randomUUID(), randomUUID()];
    for (const t of [t1, t2, t3]) caixa.naRenovacao({ turnoId: t, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO });
    const [p1, p2, p3] = [pedido(t1), pedido(t2), pedido(t3)];
    for (const p of [p1, p2, p3]) enfileirar(p);
    expect(caixa.naRenovacao({ turnoId: t1, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO })).toEqual([p1]);
    expect(caixa.naRenovacao({ turnoId: t2, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO })).toEqual([p2]);
    expect(caixa.naRenovacao({ turnoId: t3, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO })).toEqual([]);
    // Confirmar o recebimento não libera a vaga: só o relato (ou o prazo).
    expect(caixa.naRenovacao({ turnoId: t1, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO, recebidas: [p1.revisaoId] })).toEqual([]);
    expect(caixa.naRenovacao({ turnoId: t3, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO })).toEqual([]);
    expect(caixa.relatar(MAQUINA, relato(p1)).aceito).toBe(true);
    expect(caixa.naRenovacao({ turnoId: t3, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO })).toEqual([p3]);
  });
});

describe("caixa de revisões: o relato", () => {
  it("aceito uma vez só: o repetido, o de outra máquina, o de outro turno, o atrasado e o sem prova certa são ignorados", () => {
    const { caixa, pedido, enfileirar, relato, avancar } = montar();
    const turno = randomUUID();
    caixa.naRenovacao({ turnoId: turno, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO });
    const p = pedido(turno);
    enfileirar(p);
    expect(caixa.relatar("maquina-b", relato(p))).toMatchObject({ aceito: false, motivo: "outro_turno_ou_maquina" });
    expect(caixa.relatar(MAQUINA, relato(p, { turnoId: randomUUID() }))).toMatchObject({ aceito: false, motivo: "outro_turno_ou_maquina" });
    expect(caixa.relatar(MAQUINA, relato(p, { prova: "0".repeat(64) }))).toMatchObject({ aceito: false, motivo: "prova" });
    const aceito = caixa.relatar(MAQUINA, relato(p, { fichasEntrada: 2100, fichasSaida: 40 }));
    expect(aceito).toMatchObject({ aceito: true, escopo: ESCOPO, decisaoId: p.decisaoId, resultado: { tipo: "saida", ms: 4000, fichasEntrada: 2100, fichasSaida: 40 } });
    expect(caixa.relatar(MAQUINA, relato(p))).toMatchObject({ aceito: false, motivo: "desconhecida" });
    // O atrasado: passado o expiraEm, ignorado (o prazo já virou cartão).
    const q = pedido(turno, { expiraEm: 1_000_000 + 10 });
    enfileirar(q);
    avancar(5);
    const r = relato(q);
    avancar(10);
    expect(caixa.relatar(MAQUINA, r)).toMatchObject({ aceito: false });
  });

  it("a falha do laço vira resultado de falha", () => {
    const { caixa, pedido, enfileirar, relato } = montar();
    const turno = randomUUID();
    caixa.naRenovacao({ turnoId: turno, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO });
    const p = pedido(turno);
    enfileirar(p);
    const { saida: _s, ...semSaida } = relato(p);
    expect(caixa.relatar(MAQUINA, { ...semSaida, falha: "init" })).toMatchObject({ aceito: true, resultado: { tipo: "falha", falha: "init" } });
  });

  it("disjuntor: 3 falhas seguidas da mesma máquina → 10 min sem revisor nela; um veredito bom zera a conta", () => {
    const { caixa, pedido, enfileirar, relato, avancar } = montar();
    const turno = randomUUID();
    caixa.naRenovacao({ turnoId: turno, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO });
    const rodar = (saida: string) => {
      const p = pedido(turno);
      enfileirar(p);
      caixa.naRenovacao({ turnoId: turno, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO });
      expect(caixa.relatar(MAQUINA, relato(p, { saida })).aceito).toBe(true);
    };
    rodar("não sei");
    rodar("não sei");
    rodar('{"decisao":"pede","motivo":"ok"}');
    rodar("não sei");
    rodar("não sei");
    expect(caixa.disjuntorAberto(MAQUINA)).toBe(false);
    rodar("não sei");
    expect(caixa.disjuntorAberto(MAQUINA)).toBe(true);
    expect(caixa.disjuntorAberto("maquina-b")).toBe(false);
    avancar(DISJUNTOR_MS + 1);
    expect(caixa.disjuntorAberto(MAQUINA)).toBe(false);
  });
});

describe("caixa de revisões: prazo e fim do turno", () => {
  it("passado o prazo, a revisão vence (cartão) e conta para o disjuntor", () => {
    const { caixa, pedido, enfileirar, vencidas, avancar } = montar();
    const turno = randomUUID();
    caixa.naRenovacao({ turnoId: turno, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO });
    const p = pedido(turno);
    enfileirar(p);
    caixa.naRenovacao({ turnoId: turno, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO });
    avancar(PRAZO_REVISAO_MS - 1);
    expect(vencidas).toEqual([]);
    avancar(1);
    expect(vencidas).toEqual([{ decisaoId: p.decisaoId, resultado: { tipo: "falha", falha: "prazo", entregueEm: 1_000_000 } }]);
    expect(caixa.emMemoria().pedidos).toBe(0);
    for (let i = 0; i < 2; i++) {
      enfileirar(pedido(turno));
      avancar(PRAZO_REVISAO_MS);
    }
    expect(caixa.disjuntorAberto(MAQUINA)).toBe(true);
  });

  it("o turno entregue: a revisão que sobrou vira cartão na hora e o estado do turno sai", () => {
    const { caixa, pedido, enfileirar, vencidas } = montar();
    const turno = randomUUID();
    caixa.naRenovacao({ turnoId: turno, machineId: MAQUINA, revisa: true, amarraSegredo: true, segredo: SEGREDO });
    const p = pedido(turno);
    enfileirar(p);
    caixa.esquecerTurno(turno);
    expect(vencidas).toEqual([{ decisaoId: p.decisaoId, resultado: { tipo: "falha", falha: "turno", entregueEm: null } }]);
    expect(caixa.revisorDoTurno(turno)).toBeNull();
    expect(caixa.emMemoria()).toEqual({ turnos: 0, pedidos: 0 });
  });
});
