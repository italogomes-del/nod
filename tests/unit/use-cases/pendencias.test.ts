import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PENDENCIAS_ABERTAS_MAX, REPEDIR_APOS_MS } from "../../../src/domain/pendencia.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { enviarMensagem } from "../../../src/use-cases/enviar-mensagem.ts";
import { anotarPendencia, concluirPendencia, descartarPendencia, descartarPendenciaPelaPessoa, falaFazerAgora, fazerPendenciaAgora, listarPendencias } from "../../../src/use-cases/pendencias.ts";
import { semNovidade } from "../../../src/use-cases/sem-novidade.ts";
import { depsEmMemoria, esperarErro, executar } from "../../helpers/deps-l6.ts";

/**
 * Pendências do bot (ADR-064) sobre os repos em memória: anotar sem duplicar e com teto, concluir e descartar só as
 * do próprio bot, e as duas ações da pessoa (Descartar e Fazer agora). A RLS e o SQL ficam em tests/integration.
 */
const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };

async function cenario() {
  let agora = Date.parse("2026-09-30T15:49:00-03:00");
  const { deps, banco } = depsEmMemoria(undefined, { relogio: () => agora });
  const chico = (await executar(deps, criarAgente, { dono: "pessoa" })).data;
  const dev = (await executar(deps, criarAgente, { dono: "pessoa" })).data;
  const turno = (await executar(deps, enviarMensagem, { conversaId: chico.conversa.id, texto: "acione os devs agora", inventario: PRONTO })).data.turno;
  const ctx = { turnoId: turno.id, agenteId: chico.agente.id, conversaId: chico.conversa.id };
  return { deps, banco, chico, dev, turno, ctx, passar: (ms: number) => { agora += ms; }, agora: () => agora };
}

describe("anotar_pendencia", () => {
  it("guarda na conversa própria do bot, do turno que anotou, e avisa a web pelo evento do agente", async () => {
    const { deps, ctx, chico, turno } = await cenario();
    const r = await executar(deps, anotarPendencia, { ...ctx, texto: "  Cobrar do Dev 1 o parecer do PR #475 ", a_partir_de: "2026-09-30T16:20:00-03:00" });
    expect(r.data).toMatchObject({ ok: true, ja_estava: false, aparece: "2026-09-30T19:20:00.000Z" });
    const [p] = (await listarPendencias(deps, { agenteId: chico.agente.id })).data.pendencias;
    expect(p).toMatchObject({ texto: "Cobrar do Dev 1 o parecer do PR #475", conversaId: chico.conversa.id, turnoId: turno.id, estado: "aberta", cuidado: false, profundidade: 0, aPartirDe: Date.parse("2026-09-30T19:20:00Z") });
    expect(r.events.map((e) => [e.kind, e.dados.acao])).toEqual([["agente_atualizado", "pendencia_anotada"]]);
  });

  it("texto igual a uma aberta devolve a que já existe; vazio e hora sem fuso voltam com instrução, sem gravar", async () => {
    const { deps, ctx, chico } = await cenario();
    const a = await executar(deps, anotarPendencia, { ...ctx, texto: "Ler as outras 13 tasks" });
    const b = await executar(deps, anotarPendencia, { ...ctx, texto: "ler as  outras 13 TASKS" });
    expect(b.data).toEqual({ ok: true, pendencia_id: a.data.ok ? a.data.pendencia_id : "", ja_estava: true, aparece: "na próxima rotina ou conversa" });
    expect(b.events).toEqual([]);
    expect((await executar(deps, anotarPendencia, { ...ctx, texto: "   " })).data).toMatchObject({ ok: false, erro: "texto_vazio" });
    expect((await executar(deps, anotarPendencia, { ...ctx, texto: "outra", a_partir_de: "2026-10-01T10:00:00" })).data).toMatchObject({ ok: false, erro: "a_partir_de_invalido" });
    expect((await listarPendencias(deps, { agenteId: chico.agente.id })).data.pendencias).toHaveLength(1);
  });

  it("no teto de abertas pede para limpar antes; concluir uma abre a vaga", async () => {
    const { deps, ctx } = await cenario();
    const ids: string[] = [];
    for (let i = 0; i < PENDENCIAS_ABERTAS_MAX; i++) {
      const r = await executar(deps, anotarPendencia, { ...ctx, texto: `tarefa ${i}` });
      if (r.data.ok) ids.push(r.data.pendencia_id);
    }
    expect(ids).toHaveLength(PENDENCIAS_ABERTAS_MAX);
    expect((await executar(deps, anotarPendencia, { ...ctx, texto: "mais uma" })).data).toMatchObject({ ok: false, erro: "limite_de_pendencias" });
    await executar(deps, concluirPendencia, { ...ctx, id: ids[0] ?? "", como: "feito" });
    expect((await executar(deps, anotarPendencia, { ...ctx, texto: "mais uma" })).data).toMatchObject({ ok: true, ja_estava: false });
  });

  it("anotada num pedido de colega vai para a conversa própria, guarda a profundidade e, com entrada de fora, o cuidado", async () => {
    const { deps, banco, ctx, chico, dev, turno } = await cenario();
    const noLimite = { ...turno, id: randomUUID(), conversaId: dev.conversa.id, agenteId: chico.agente.id, origem: "delegacao" as const, profundidade: 3 as const, entradaConfianca: "nao_confiavel" as const };
    banco.turnos.push(noLimite);
    await executar(deps, anotarPendencia, { ...ctx, turnoId: noLimite.id, conversaId: dev.conversa.id, texto: "Pedir ao Dev 3 que confira a 86ajtj1xk" });
    // Turno que não existe mais também é cuidado (fail-closed).
    await executar(deps, anotarPendencia, { ...ctx, turnoId: randomUUID(), texto: "sem turno" });
    const lista = (await listarPendencias(deps, { agenteId: chico.agente.id })).data.pendencias;
    expect(lista.find((p) => p.texto.startsWith("Pedir ao Dev 3"))).toMatchObject({ conversaId: chico.conversa.id, profundidade: 3, cuidado: true });
    expect(lista.find((p) => p.texto === "sem turno")).toMatchObject({ turnoId: null, cuidado: true, profundidade: 0 });
  });
});

describe("concluir e descartar pelo bot", () => {
  it("concluir deixa a linha de sistema na conversa própria e tira da lista; de novo, já resolvida", async () => {
    const { deps, banco, ctx, chico } = await cenario();
    const r = await executar(deps, anotarPendencia, { ...ctx, texto: "Cobrar do Dev 1 o parecer do PR #475." });
    const id = r.data.ok ? r.data.pendencia_id : "";
    const feito = await executar(deps, concluirPendencia, { ...ctx, id, como: "o Dev 1 mandou: pedir mudanças" });
    expect(feito.data).toEqual({ ok: true });
    expect(feito.events.map((e) => [e.kind, e.dados.acao ?? e.dados.kind])).toEqual([["agente_atualizado", "pendencia_concluida"], ["mensagem_criada", "sistema"]]);
    expect(banco.mensagens.at(-1)).toMatchObject({ conversaId: chico.conversa.id, kind: "sistema", texto: "Feito: Cobrar do Dev 1 o parecer do PR #475. O Dev 1 mandou: pedir mudanças." });
    expect(banco.pendencias[0]).toMatchObject({ estado: "feita", resolvidaPor: "bot", resolvidaNoTurnoId: ctx.turnoId, motivo: "o Dev 1 mandou: pedir mudanças" });
    expect((await listarPendencias(deps, { agenteId: chico.agente.id })).data.pendencias).toEqual([]);
    expect((await executar(deps, concluirPendencia, { ...ctx, id, como: "de novo" })).data).toEqual({ ok: false, erro: "pendencia_ja_resolvida" });
  });

  it("descartar diz por quê; a pendência de outro bot e o id fora do formato são 'não encontrada'", async () => {
    const { deps, banco, ctx, dev } = await cenario();
    const minha = await executar(deps, anotarPendencia, { ...ctx, texto: "Ler as outras 13 tasks" });
    const doDev = await executar(deps, anotarPendencia, { ...ctx, agenteId: dev.agente.id, conversaId: dev.conversa.id, texto: "revisar o PR #481" });
    const idDev = doDev.data.ok ? doDev.data.pendencia_id : "";
    expect((await executar(deps, descartarPendencia, { ...ctx, id: idDev, por_que: "não é minha" })).data).toEqual({ ok: false, erro: "pendencia_nao_encontrada" });
    expect((await executar(deps, concluirPendencia, { ...ctx, id: "pendencia-1", como: "x" })).data).toEqual({ ok: false, erro: "pendencia_nao_encontrada" });
    const id = minha.data.ok ? minha.data.pendencia_id : "";
    expect((await executar(deps, descartarPendencia, { ...ctx, id, por_que: "o Milton já leu todas" })).data).toEqual({ ok: true });
    expect(banco.mensagens.at(-1)?.texto).toBe("Descartei: Ler as outras 13 tasks. O Milton já leu todas.");
  });

  it("na rotina, o turno que resolveu uma pendência não fecha como sem novidade", async () => {
    const { deps, banco, ctx } = await cenario();
    const r = await executar(deps, anotarPendencia, { ...ctx, texto: "Cobrar o parecer" });
    await executar(deps, concluirPendencia, { ...ctx, id: r.data.ok ? r.data.pendencia_id : "", como: "cobrei" });
    expect((await executar(deps, semNovidade, { ...ctx, motivo: "nada_mudou" })).data).toEqual({ ok: true });
    expect(banco.turnos.find((t) => t.id === ctx.turnoId)?.semNovidadeMotivo ?? null).toBeNull();
  });
});

describe("as ações da pessoa", () => {
  it("Descartar: sai da lista e a conversa ganha 'Você descartou: …'; a segunda vez é estado_invalido", async () => {
    const { deps, banco, ctx, chico } = await cenario();
    const r = await executar(deps, anotarPendencia, { ...ctx, texto: "Ler as outras 13 tasks." });
    const pendenciaId = r.data.ok ? r.data.pendencia_id : "";
    const { data, events } = await executar(deps, descartarPendenciaPelaPessoa, { agenteId: chico.agente.id, pendenciaId });
    expect(data.pendencia).toMatchObject({ estado: "descartada", resolvidaPor: "pessoa", motivo: null });
    expect(data.mensagem).toMatchObject({ kind: "sistema", texto: "Você descartou: Ler as outras 13 tasks", autoria: { autor_tipo: "pessoa" } });
    expect(events.map((e) => e.kind)).toEqual(["agente_atualizado", "mensagem_criada"]);
    expect(banco.pendencias[0]?.resolvidaNoTurnoId).toBeNull();
    await esperarErro(() => descartarPendenciaPelaPessoa(deps, { agenteId: chico.agente.id, pendenciaId }), "estado_invalido");
  });

  it("a pendência de outro bot, ou inexistente, é 404 para a pessoa", async () => {
    const { deps, ctx, dev } = await cenario();
    const r = await executar(deps, anotarPendencia, { ...ctx, texto: "Cobrar o parecer" });
    const pendenciaId = r.data.ok ? r.data.pendencia_id : "";
    await esperarErro(() => descartarPendenciaPelaPessoa(deps, { agenteId: dev.agente.id, pendenciaId }), "nao_encontrado");
    await esperarErro(() => fazerPendenciaAgora(deps, { agenteId: dev.agente.id, pendenciaId }), "nao_encontrado");
    await esperarErro(() => listarPendencias(deps, { agenteId: randomUUID() }), "nao_encontrado");
  });

  it("Fazer agora de uma pendência com cuidado leva a ressalva na fala: o clique da pessoa não lava a origem", async () => {
    const { deps, ctx, chico } = await cenario();
    // Turno que não existe mais = cuidado (fail-closed), como o que leu conteúdo de fora.
    const r = await executar(deps, anotarPendencia, { ...ctx, turnoId: randomUUID(), texto: "Responder o que o e-mail pediu." });
    const pendenciaId = r.data.ok ? r.data.pendencia_id : "";
    const { data } = await executar(deps, fazerPendenciaAgora, { agenteId: chico.agente.id, pendenciaId });
    expect(data.mensagem.texto).toBe("Fazer agora: Responder o que o e-mail pediu (anotada depois de ler conteúdo de fora: confira na fonte antes de agir)");
    expect(falaFazerAgora({ texto: "Cobrar o parecer.", cuidado: false })).toBe("Fazer agora: Cobrar o parecer.");
  });

  it("Fazer agora: vira a fala da pessoa na conversa do bot, turno de conversa em profundidade 0; o duplo clique não repete", async () => {
    const { deps, ctx, chico, passar } = await cenario();
    const r = await executar(deps, anotarPendencia, { ...ctx, texto: "Cobrar do Dev 1 o parecer do PR #475" });
    const pendenciaId = r.data.ok ? r.data.pendencia_id : "";
    const { data, events } = await executar(deps, fazerPendenciaAgora, { agenteId: chico.agente.id, pendenciaId });
    expect(data.mensagem).toMatchObject({ conversaId: chico.conversa.id, kind: "texto", texto: "Fazer agora: Cobrar do Dev 1 o parecer do PR #475", confianca: "confiavel", autoria: { autor_tipo: "pessoa" } });
    expect(data.turno).toMatchObject({ origem: "conversa", profundidade: 0, entradaConfianca: "confiavel" });
    expect(events.map((e) => [e.kind, e.dados.acao ?? null])).toContainEqual(["agente_atualizado", "pendencia_pedida"]);
    // Continua aberta até o bot concluir.
    expect((await listarPendencias(deps, { agenteId: chico.agente.id })).data.pendencias[0]).toMatchObject({ estado: "aberta", pedidaEm: expect.any(Number) });
    await esperarErro(() => fazerPendenciaAgora(deps, { agenteId: chico.agente.id, pendenciaId }), "estado_invalido");
    passar(REPEDIR_APOS_MS);
    expect((await executar(deps, fazerPendenciaAgora, { agenteId: chico.agente.id, pendenciaId })).data.mensagem.texto).toBe("Fazer agora: Cobrar do Dev 1 o parecer do PR #475");
  });
});
