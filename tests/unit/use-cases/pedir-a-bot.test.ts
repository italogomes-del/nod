import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { OrigemTurno, Profundidade } from "../../../src/contracts/turno.ts";
import { montarPlano } from "../../../src/domain/plano-turno.ts";
import { travaDoPedido } from "../../../src/use-cases/apoio-l7.ts";
import { entregarRespostaPeer } from "../../../src/use-cases/entregar-resposta-peer.ts";
import { pedirABot } from "../../../src/use-cases/pedir-a-bot.ts";
import { depsMemoria } from "../../helpers/deps-l7.ts";
import { PESSOA_ANA, TENANT_LEAPY } from "../../helpers/ids.ts";

/**
 * pedir_a_bot (definido em 2026-09-29, ADR-058): UM jeito de um bot pedir a outro — pergunta ou tarefa —, e
 * quem recebe usa os acessos dele, venha o pedido de conversa, sala ou rotina. Um salto; a trava da rotina de
 * quem pediu é herdada; a resposta volta como retomada do turno que pediu.
 */
const AGORA = 1_700_000_000_000;
type D = ReturnType<typeof depsMemoria>;

async function bot(d: D, nome: string, deps = d.deps) {
  const a = await deps.repos.agentes.criar({ nome, dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "claude-haiku-4-5-20251001" });
  const c = await deps.repos.conversas.criar({ tipo: "propria", agenteId: a?.id ?? "" });
  return { id: a?.id ?? "", conversaId: c?.id ?? "", agente: a };
}

/** O turno de quem pede: é dele que o pedido parte (profundidade, confiança, rotina). */
async function turno(d: D, agenteId: string, conversaId: string, origem: OrigemTurno = "conversa", extra: { profundidade?: Profundidade; confianca?: "confiavel" | "nao_confiavel" } = {}) {
  const t = await d.deps.repos.turnos.enfileirar({ conversaId, agenteId, origem, prazoEm: AGORA + 60_000, profundidade: extra.profundidade ?? 0, entradaTexto: "trabalho", entradaConfianca: extra.confianca ?? "confiavel", modelo: "haiku" });
  if (!t) throw new Error("turno não criado");
  return t;
}

function pedir(d: D, de: { id: string; conversaId: string }, turnoId: string, agente: string, pedido: string, contexto?: string) {
  return pedirABot(d.deps, { turnoId, agenteId: de.id, conversaId: de.conversaId, agente, pedido, ...(contexto ? { contexto } : {}) });
}

describe("pedir_a_bot: quem recebe usa os acessos dele", () => {
  it("de uma conversa: o alvo ganha turno 'delegacao' confiável, em profundidade 1, sob procuração da pessoa; o pedido vai num bloco próprio", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const vera = await bot(d, "Vera");
    const tuca = await bot(d, "Tuca");
    const t = await turno(d, vera.id, vera.conversaId);
    const r = await pedir(d, vera, t.id, "Tuca", "Explique como a busca por nome funciona hoje.", "PR #415");
    const tarefa = d.banco.turnos.find((x) => x.id === r.data.tarefa_id);
    expect(tarefa).toMatchObject({ agenteId: tuca.id, conversaId: tuca.conversaId, origem: "delegacao", profundidade: 1, entradaConfianca: "confiavel", sobProcuracaoDe: d.deps.escopo.pessoaId, estado: "pendente" });
    expect(tarefa?.entradaTexto).toContain("Pedido de Vera:\n<pedido_do_colega>\nPedido: Explique como a busca por nome funciona hoje.\nContexto: PR #415\n</pedido_do_colega>");
    const pedido = d.banco.mensagens.find((m) => m.conversaId === tuca.conversaId && m.payload?.kind === "peer_pedido");
    expect(pedido).toMatchObject({ turnoId: r.data.tarefa_id, autoria: { autor_tipo: "agente", autor_id: vera.id, sob_procuracao_de: d.deps.escopo.pessoaId }, payload: { turnoOrigemId: t.id, conversaOrigemId: vera.conversaId } });
    expect(d.banco.mensagens.find((m) => m.kind === "handoff")).toMatchObject({ conversaId: vera.conversaId, texto: "Vera pediu a Tuca: Explique como a busca por nome funciona hoje.", payload: { tarefaId: r.data.tarefa_id } });
    expect(r.events?.map((e) => e.kind)).toEqual(["mensagem_criada", "turno_criado"]);
  });

  it("de uma rotina também — o caso da Clarice e do Chico —, e sem o bloco da pessoa (ninguém escreveu)", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const clarice = await bot(d, "Clarice");
    await bot(d, "Chico");
    const t = await turno(d, clarice.id, clarice.conversaId, "rotina", { confianca: "nao_confiavel" });
    const r = await pedir(d, clarice, t.id, "Chico", "Como a busca por nome funciona no Backoffice?");
    const tarefa = d.banco.turnos.find((x) => x.id === r.data.tarefa_id);
    expect(tarefa).toMatchObject({ origem: "delegacao", entradaConfianca: "confiavel" });
    expect(tarefa?.entradaTexto).not.toContain("pedido_da_pessoa");
  });

  it("um salto: quem está em profundidade 1 (cumprindo um pedido, ou a continuação) não pede de novo", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const vera = await bot(d, "Vera");
    await bot(d, "Tuca");
    const t = await turno(d, vera.id, vera.conversaId, "delegacao", { profundidade: 1 });
    await expect(pedir(d, vera, t.id, "Tuca", "e agora?")).rejects.toMatchObject({ codigo: "nao_permitido" });
    // Turno de outro bot também não serve de origem.
    const outro = await bot(d, "Zeca");
    const deOutro = await turno(d, outro.id, outro.conversaId);
    await expect(pedir(d, vera, deOutro.id, "Tuca", "oi")).rejects.toMatchObject({ codigo: "nao_permitido" });
    expect(d.banco.turnos.filter((x) => x.origem === "delegacao" && x.agenteId !== vera.id)).toHaveLength(0);
  });

  it("outro dono: sem procuração, nao_permitido; procuração antiga (perguntar_a_bot) ou nova (pedir_a_bot) vale", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const vera = await bot(d, "Vera");
    const comoAna = d.comEscopo({ tenantId: TENANT_LEAPY, pessoaId: PESSOA_ANA });
    const tuca = await bot(d, "Tuca", comoAna);
    const t = await turno(d, vera.id, vera.conversaId);
    await expect(pedir(d, vera, t.id, "Tuca", "oi")).rejects.toMatchObject({ codigo: "nao_permitido" });
    await comoAna.repos.procuracoes.criar({ agenteConcedenteId: tuca.id, agenteBeneficiarioId: vera.id, classesPermitidas: ["outra"], tetoDiario: 5 });
    await expect(pedir(d, vera, t.id, "Tuca", "oi")).rejects.toMatchObject({ codigo: "nao_permitido" });
    await comoAna.repos.procuracoes.criar({ agenteConcedenteId: tuca.id, agenteBeneficiarioId: vera.id, classesPermitidas: ["perguntar_a_bot"], tetoDiario: 5 });
    const r = await pedir(d, vera, t.id, "Tuca", "oi");
    expect(d.banco.turnos.find((x) => x.id === r.data.tarefa_id)?.agenteId).toBe(tuca.id);
  });

  it("bot desconhecido → nao_encontrado; a si mesmo → entrada_invalida; pedido vazio → texto_vazio", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const vera = await bot(d, "Vera");
    await bot(d, "Tuca");
    const t = await turno(d, vera.id, vera.conversaId);
    await expect(pedir(d, vera, t.id, "Zé", "oi")).rejects.toMatchObject({ codigo: "nao_encontrado" });
    await expect(pedir(d, vera, t.id, "Vera", "oi")).rejects.toMatchObject({ codigo: "entrada_invalida" });
    await expect(pedir(d, vera, t.id, "Tuca", " ")).rejects.toMatchObject({ codigo: "texto_vazio" });
  });
});

describe("a trava da rotina de quem pediu vale para quem recebe", () => {
  async function turnoDaRotina(d: D, de: { id: string; conversaId: string }, exigeAprovacao: boolean) {
    const rotina = await d.deps.repos.rotinas.criar({ agenteId: de.id, conversaId: de.conversaId, cron: "*/10 * * * *", fusoIana: "UTC", instrucao: "Ler o Slack", fonte: "Slack", entregavel: "chat", limitesAprovacao: "", politicaSemDado: "", proximaExecucao: AGORA, exigeAprovacao });
    const t = await turno(d, de.id, de.conversaId, "rotina", { confianca: "nao_confiavel" });
    await d.deps.repos.rotinaJanelas.reivindicar({ rotinaId: rotina!.id, instanteAgendado: AGORA, executor: "catcher", machineId: randomUUID() });
    await d.deps.repos.rotinaJanelas.vincularTurno({ rotinaId: rotina!.id, instanteAgendado: AGORA, turnoId: t.id });
    return t;
  }

  it("rotina com exige_aprovacao trava; sem, não trava; conversa não trava; sem o pedido, trava (fail-closed)", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const clarice = await bot(d, "Clarice");
    await bot(d, "Chico");
    const comTrava = await pedir(d, clarice, (await turnoDaRotina(d, clarice, true)).id, "Chico", "leia o PR");
    const semTrava = await pedir(d, clarice, (await turnoDaRotina(d, clarice, false)).id, "Chico", "leia o PR");
    const daConversa = await pedir(d, clarice, (await turno(d, clarice.id, clarice.conversaId)).id, "Chico", "leia o PR");
    const tarefa = (id: string) => d.banco.turnos.find((x) => x.id === id)!;
    expect(await travaDoPedido(d.deps.repos, tarefa(comTrava.data.tarefa_id))).toBe(true);
    expect(await travaDoPedido(d.deps.repos, tarefa(semTrava.data.tarefa_id))).toBe(false);
    expect(await travaDoPedido(d.deps.repos, tarefa(daConversa.data.tarefa_id))).toBe(false);
    // Rotina sem janela (criada fora do scheduler) trava, como no gate da própria rotina (E7.3).
    const semJanela = await pedir(d, clarice, (await turno(d, clarice.id, clarice.conversaId, "rotina")).id, "Chico", "leia o PR");
    expect(await travaDoPedido(d.deps.repos, tarefa(semJanela.data.tarefa_id))).toBe(true);
    const orfa = await turno(d, clarice.id, clarice.conversaId, "delegacao", { profundidade: 1 });
    expect(await travaDoPedido(d.deps.repos, orfa)).toBe(true);
  });
});

describe("a resposta volta como continuação de quem pediu", () => {
  it("peer_ask na conversa de quem pediu + retomada do turno dele, com a confiança dele e em profundidade 1", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const vera = await bot(d, "Vera");
    const tuca = await bot(d, "Tuca");
    const t = await turno(d, vera.id, vera.conversaId);
    const r = await pedir(d, vera, t.id, "Tuca", "status do PR 42?");
    const entrega = await entregarRespostaPeer(d.deps, { tarefaId: r.data.tarefa_id, texto: "PR 42 aprovado, falta o merge." });
    if (!("mensagem" in entrega.data)) throw new Error("deveria entregar");
    expect(entrega.data.mensagem).toMatchObject({
      conversaId: vera.conversaId,
      kind: "peer_ask",
      texto: "PR 42 aprovado, falta o merge.",
      payload: { kind: "peer_ask", agenteId: tuca.id, nome: "Tuca", tarefaId: r.data.tarefa_id, turnoOrigemId: t.id, delegada: true },
    });
    expect(entrega.data.continuacao).toMatchObject({ conversaId: vera.conversaId, agenteId: vera.id, origem: "retomada", retomaTurnoId: t.id, profundidade: 1, entradaConfianca: "confiavel" });
    expect(entrega.data.continuacao.entradaTexto).toContain("Resposta de Tuca ao seu pedido: PR 42 aprovado, falta o merge.");
    expect(entrega.data.continuacao.entradaTexto).not.toContain("NÃO confiável");

    // Em profundidade 1 o salto some, mas o resto do kit da conversa fica.
    const plano = montarPlano({
      turno: entrega.data.continuacao,
      agente: vera.agente!,
      memorias: [],
      concessoes: [],
      conectores: [],
      modo: "conversa",
      confianca: "confiavel",
      profundidade: 1,
      inventario: { estado: "pronto", versao: "x", em: AGORA },
      executor: "catcher",
      sessaoCli: null,
      pessoaNome: "Marlon",
      agora: AGORA,
    });
    const nomes = plano.catalogo.ferramentas.map((f) => f.nome);
    expect(nomes).not.toContain("pedir_a_bot");
    expect(nomes).not.toContain("encaminhar");
    expect(nomes).toEqual(expect.arrayContaining(["lembrar", "pedir_aprovacao", "pedir_acesso", "pedir_a_pessoa"]));

    // A continuação NÃO é uma tarefa: entregar sobre ela é ignorado.
    expect((await entregarRespostaPeer(d.deps, { tarefaId: entrega.data.continuacao.id, texto: "x" })).data).toEqual({ ignorado: "nao_e_tarefa_peer" });
  });

  it("pedido que partiu da rotina volta à rotina: a continuação herda a confiança dela (não confiável)", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const clarice = await bot(d, "Clarice");
    await bot(d, "Chico");
    const t = await turno(d, clarice.id, clarice.conversaId, "rotina", { confianca: "nao_confiavel" });
    const r = await pedir(d, clarice, t.id, "Chico", "como funciona a busca?");
    const entrega = await entregarRespostaPeer(d.deps, { tarefaId: r.data.tarefa_id, texto: "Busca por tokens, sem acento." });
    if (!("continuacao" in entrega.data)) throw new Error("deveria entregar");
    expect(entrega.data.continuacao).toMatchObject({ origem: "retomada", retomaTurnoId: t.id, entradaConfianca: "nao_confiavel", profundidade: 1 });
  });

  it("pedido feito numa sala volta à mesma sala", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const vera = await bot(d, "Vera");
    await bot(d, "Tuca");
    const sala = await d.deps.repos.conversas.criar({ tipo: "sala", salaId: randomUUID() });
    const original = await turno(d, vera.id, sala!.id, "sala");
    const r = await pedirABot(d.deps, { turnoId: original.id, agenteId: vera.id, conversaId: sala!.id, agente: "Tuca", pedido: "Quais clientes avisar?" });
    expect(d.banco.mensagens.find((m) => m.kind === "handoff")).toMatchObject({ conversaId: sala!.id, payload: { tarefaId: r.data.tarefa_id } });
    const resposta = await entregarRespostaPeer(d.deps, { tarefaId: r.data.tarefa_id, texto: "Clientes do piloto." });
    if (!("continuacao" in resposta.data)) throw new Error("resposta ausente");
    expect(resposta.data.continuacao).toMatchObject({ conversaId: sala!.id, origem: "retomada", retomaTurnoId: original.id });
    expect(resposta.data.mensagem.conversaId).toBe(sala!.id);
  });
});
