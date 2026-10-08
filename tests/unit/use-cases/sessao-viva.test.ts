import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { OrigemTurno } from "../../../src/contracts/turno.ts";
import { absorverNaSessao, aceitaMensagemNaSessao, confirmarNaSessao, gravarFalasDaSessao } from "../../../src/use-cases/sessao-viva.ts";
import { depsMemoria } from "../../helpers/deps-l7.ts";

/**
 * ADR-067, lado do servidor da sessão viva: a fala de uma volta que não encerrou o turno entra na conversa na hora, e a
 * mensagem que a pessoa manda com o bot trabalhando entra no turno vivo em vez de esperar na fila.
 */
const AGORA = 1_790_000_000_000;
type D = ReturnType<typeof depsMemoria>;

async function cenario() {
  const d = depsMemoria({ agora: () => AGORA });
  const agente = await d.deps.repos.agentes.criar({ nome: "Dev 4", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "claude-haiku-4-5-20251001" });
  const conversa = await d.deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  return { d, agenteId: agente?.id ?? "", conversaId: conversa?.id ?? "" };
}

async function turno(d: D, agenteId: string, conversaId: string, o: { origem?: OrigemTurno; estado?: "pendente" | "despachando" | "concluido" | "interrompido"; texto?: string; daPessoa?: boolean; anexos?: string[]; sobProcuracaoDe?: string; retomaTurnoId?: string; trabalhoId?: string } = {}) {
  const t = await d.deps.repos.turnos.enfileirar({
    conversaId, agenteId, origem: o.origem ?? "conversa", prazoEm: AGORA + 60_000, profundidade: o.origem === "delegacao" ? 1 : 0,
    entradaTexto: o.texto ?? "trabalho", entradaConfianca: "confiavel", modelo: "m",
    ...(o.daPessoa !== false ? { mensagemOrigemId: randomUUID() } : {}),
    ...(o.anexos ? { entradaAnexos: o.anexos } : {}),
  });
  const linha = d.banco.turnos.find((x) => x.id === t?.id)!;
  linha.criadoEm = AGORA + d.banco.turnos.length;
  if (o.estado && o.estado !== "pendente") {
    linha.estado = o.estado;
    linha.machineId = "m1";
  }
  if (o.sobProcuracaoDe) linha.sobProcuracaoDe = o.sobProcuracaoDe;
  if (o.retomaTurnoId) linha.retomaTurnoId = o.retomaTurnoId;
  if (o.trabalhoId) linha.trabalhoId = o.trabalhoId;
  return linha;
}

describe("gravarFalasDaSessao (ADR-067)", () => {
  it("turno vivo: cada fala vira mensagem do bot na conversa, com mensagem_criada; texto vazio não entra", async () => {
    const { d, agenteId, conversaId } = await cenario();
    const vivo = await turno(d, agenteId, conversaId, { estado: "despachando" });
    const r = await gravarFalasDaSessao(d.deps, { turnoId: vivo.id, machineId: "m1", executor: "local", textos: ["Disparei os testes.", "  ", "Testes verdes."] });
    expect(r.data.gravadas).toBe(2);
    const doBot = d.banco.mensagens.filter((m) => m.turnoId === vivo.id);
    expect(doBot.map((m) => [m.autoria.autor_tipo, m.autoria.autor_id, m.kind, m.texto])).toEqual([
      ["agente", agenteId, "texto", "Disparei os testes."],
      ["agente", agenteId, "texto", "Testes verdes."],
    ]);
    expect(r.events?.map((e) => e.kind)).toEqual(["mensagem_criada", "mensagem_criada"]);
  });

  it("turno já assentado, de sala ou de outra máquina: nada entra", async () => {
    const { d, agenteId, conversaId } = await cenario();
    const assentado = await turno(d, agenteId, conversaId, { estado: "concluido" });
    const sala = await turno(d, agenteId, conversaId, { estado: "despachando", origem: "sala" });
    const vivo = await turno(d, agenteId, conversaId, { estado: "despachando" });
    for (const [t, maquina] of [[assentado, "m1"], [sala, "m1"], [vivo, "outra"]] as const) {
      expect((await gravarFalasDaSessao(d.deps, { turnoId: t.id, machineId: maquina, executor: "local", textos: ["oi"] })).data.gravadas).toBe(0);
    }
    expect(d.banco.mensagens.filter((m) => m.autoria.autor_tipo === "agente")).toHaveLength(0);
  });
});

describe("absorverNaSessao (ADR-067)", () => {
  it("as falas da pessoa na fila desta conversa entram no turno vivo, na ordem, e saem 'absorvido' apontando para ele", async () => {
    const { d, agenteId, conversaId } = await cenario();
    const vivo = await turno(d, agenteId, conversaId, { estado: "despachando" });
    const a = await turno(d, agenteId, conversaId, { texto: "quanto é 2+2?" });
    const b = await turno(d, agenteId, conversaId, { texto: "e muda o nome do arquivo" });
    const r = await absorverNaSessao(d.deps, { turnoId: vivo.id, executor: "local" });
    expect(r.data.textos).toEqual(["quanto é 2+2?", "e muda o nome do arquivo"]);
    for (const t of [a, b]) expect(t).toMatchObject({ estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: vivo.id });
    expect(r.events?.map((e) => [e.kind, e.dados])).toEqual([
      ["turno_interrompido", { motivo: "absorvido", absorvido_por: vivo.id }],
      ["turno_interrompido", { motivo: "absorvido", absorvido_por: vivo.id }],
    ]);
    // Uma segunda pergunta não traz nada de novo.
    expect((await absorverNaSessao(d.deps, { turnoId: vivo.id, executor: "local" })).data.textos).toEqual([]);
  });

  it("fica na fila: fala com anexo (o próximo turno a baixa inteira), rotina, fala de outra conversa", async () => {
    const { d, agenteId, conversaId } = await cenario();
    const outra = await d.deps.repos.conversas.criar({ tipo: "propria", agenteId });
    const vivo = await turno(d, agenteId, conversaId, { estado: "despachando" });
    const comAnexo = await turno(d, agenteId, conversaId, { texto: "olha o print", anexos: [randomUUID()] });
    const rotina = await turno(d, agenteId, conversaId, { origem: "rotina", daPessoa: false });
    const deOutra = await turno(d, agenteId, outra?.id ?? "", { texto: "noutra conversa" });
    expect((await absorverNaSessao(d.deps, { turnoId: vivo.id, executor: "local" })).data.textos).toEqual([]);
    for (const t of [comAnexo, rotina, deOutra]) expect(t.estado).toBe("pendente");
  });

  it("pedido de colega (delegação, sob procuração), sala e turno que não roda não recebem mensagem da pessoa", async () => {
    const { d, agenteId, conversaId } = await cenario();
    const delegacao = await turno(d, agenteId, conversaId, { estado: "despachando", origem: "delegacao" });
    const pendente = await turno(d, agenteId, conversaId, { texto: "oi" });
    expect((await absorverNaSessao(d.deps, { turnoId: delegacao.id, executor: "local" })).data.textos).toEqual([]);
    expect(pendente.estado).toBe("pendente");
    expect(aceitaMensagemNaSessao({ ...delegacao, origem: "retomada", sobProcuracaoDe: "pessoa" })).toBe(false);
    expect(aceitaMensagemNaSessao({ ...delegacao, origem: "sala" })).toBe(false);
    expect(aceitaMensagemNaSessao({ ...delegacao, origem: "conversa", estado: "concluido" })).toBe(false);
  });
});

describe("mensagem no meio só em turno de conversa (ADR-083 §6, #189)", () => {
  it("rotina, retomada de rotina e turno de trabalho não absorvem: a mensagem fica pendente e vira turno próprio", async () => {
    const { d, agenteId, conversaId } = await cenario();
    const rotina = await turno(d, agenteId, conversaId, { estado: "despachando", origem: "rotina", daPessoa: false });
    const rotinaParada = await turno(d, agenteId, conversaId, { estado: "interrompido", origem: "rotina", daPessoa: false });
    const retomadaDaRotina = await turno(d, agenteId, conversaId, { estado: "despachando", origem: "retomada", daPessoa: false, retomaTurnoId: rotinaParada.id });
    const deTrabalho = await turno(d, agenteId, conversaId, { estado: "despachando", trabalhoId: randomUUID() });
    const daPessoa = await turno(d, agenteId, conversaId, { texto: "chegou agora" });
    for (const vivo of [rotina, retomadaDaRotina, deTrabalho]) {
      expect((await absorverNaSessao(d.deps, { turnoId: vivo.id, executor: "local" })).data).toEqual({ textos: [], ids: [] });
      expect((await absorverNaSessao(d.deps, { turnoId: vivo.id, executor: "local", confirma: true })).data).toEqual({ textos: [], ids: [] });
    }
    expect(daPessoa.estado).toBe("pendente");
    expect(aceitaMensagemNaSessao(rotina)).toBe(false);
    expect(aceitaMensagemNaSessao(deTrabalho)).toBe(false);
  });

  it("retomada de uma retomada de pedido de colega também fica de fora; a de uma conversa recebe", async () => {
    const { d, agenteId, conversaId } = await cenario();
    const delegacao = await turno(d, agenteId, conversaId, { estado: "interrompido", origem: "delegacao", daPessoa: false });
    const r1 = await turno(d, agenteId, conversaId, { estado: "interrompido", origem: "retomada", daPessoa: false, retomaTurnoId: delegacao.id });
    const r2 = await turno(d, agenteId, conversaId, { estado: "despachando", origem: "retomada", daPessoa: false, retomaTurnoId: r1.id });
    await turno(d, agenteId, conversaId, { texto: "oi" });
    expect((await absorverNaSessao(d.deps, { turnoId: r2.id, executor: "local", confirma: true })).data.ids).toEqual([]);
    r2.estado = "interrompido";
    const conversa = await turno(d, agenteId, conversaId, { estado: "interrompido" });
    const retomada = await turno(d, agenteId, conversaId, { estado: "despachando", origem: "retomada", daPessoa: false, retomaTurnoId: conversa.id });
    expect((await absorverNaSessao(d.deps, { turnoId: retomada.id, executor: "local", confirma: true })).data.textos).toEqual(["oi"]);
  });

  it("#189 com confirmação: oferecer não tira da fila; só a confirmada sai 'absorvido', a outra segue pendente", async () => {
    const { d, agenteId, conversaId } = await cenario();
    const vivo = await turno(d, agenteId, conversaId, { estado: "despachando" });
    const a = await turno(d, agenteId, conversaId, { texto: "primeira" });
    const b = await turno(d, agenteId, conversaId, { texto: "segunda" });
    const oferta = await absorverNaSessao(d.deps, { turnoId: vivo.id, executor: "local", confirma: true });
    expect(oferta.data).toEqual({ textos: ["primeira", "segunda"], ids: [a.id, b.id] });
    expect(oferta.events ?? []).toEqual([]);
    expect([a.estado, b.estado]).toEqual(["pendente", "pendente"]);
    // As já oferecidas não voltam na próxima renovação.
    expect((await absorverNaSessao(d.deps, { turnoId: vivo.id, executor: "local", confirma: true, jaOferecidas: [a.id, b.id] })).data.ids).toEqual([]);
    // O CLI recebeu só a primeira (a sessão fechou antes da segunda).
    const c = await confirmarNaSessao(d.deps, { turnoId: vivo.id, executor: "local", ids: [a.id] });
    expect(c.data.confirmadas).toBe(1);
    expect(a).toMatchObject({ estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: vivo.id });
    expect(b.estado).toBe("pendente");
    expect(c.events?.map((e) => [e.kind, e.turnoId, e.dados])).toEqual([["turno_interrompido", a.id, { motivo: "absorvido", absorvido_por: vivo.id }]]);
    // Confirmar de novo não faz nada (já não está pendente).
    expect((await confirmarNaSessao(d.deps, { turnoId: vivo.id, executor: "local", ids: [a.id] })).data.confirmadas).toBe(0);
  });
});
