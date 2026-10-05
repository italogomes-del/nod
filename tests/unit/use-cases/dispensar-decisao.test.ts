import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { criarRotasSuaVez } from "../../../src/adapters/http/rotas/sua-vez.ts";
import type { Escopo } from "../../../src/shared/types.ts";
import { dispararRotina, registrarDesfechoRotina } from "../../../src/use-cases/disparar-rotina.ts";
import { dispensarDecisao, podeDispensar } from "../../../src/use-cases/dispensar-decisao.ts";
import { depsMemoria } from "../../helpers/deps-l7.ts";
import { PESSOA_ANA, TENANT_PADRAO } from "../../helpers/ids.ts";

const TZ = "America/Sao_Paulo";
const JANELA = Date.parse("2026-09-24T08:00:00-03:00");
const AGORA = JANELA + 60_000;
const DIA = 86_400_000;
const ANA: Escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };

/** Uma rotina disparada na janela das 8h cujo turno terminou pedindo um dado (a Nina sem Gmail, #46). */
async function rotinaQuePediu(d: ReturnType<typeof depsMemoria>, extra: { decisorId?: string } = {}) {
  const agente = await d.deps.repos.agentes.criar({ nome: "Nina", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "claude-haiku-4-5-20251001" });
  const conversa = await d.deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  const rotina = await d.deps.repos.rotinas.criar({ agenteId: agente?.id ?? "", conversaId: conversa?.id ?? "", cron: "0 8 * * *", fusoIana: TZ, instrucao: "resuma os e-mails", fonte: "Gmail", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "diga que não houve", proximaExecucao: JANELA });
  if (!rotina) throw new Error("rotina");
  const r = await dispararRotina(d.deps, { rotina, instanteAgendado: JANELA, machineId: "m1", executor: "catcher" });
  if (!("turno" in r.data)) throw new Error("sem turno");
  const turnoId = r.data.turno.id;
  const pedido = await d.deps.repos.decisoes.criar({ tipo: "falta_de_dado", decisorId: extra.decisorId, agenteId: rotina.agenteId, conversaId: rotina.conversaId, turnoId, prazoDecisaoEm: AGORA + DIA, frase: "falta o acesso ao Gmail" });
  // O turno terminou depois de pedir (compor.ts, depoisDeAssentar). definido em 2026-09-24 (fio da
  // pergunta): a janela ESPERA o fio — 'executou' com a pergunta aberta não conta, nenhuma linha ainda.
  await d.deps.repos.turnos.assentar(turnoId, { estado: "concluido" });
  expect((await registrarDesfechoRotina(d.deps, { turnoId, desfecho: "executou" })).data).toEqual({ ignorado: "aguardando_gate" });
  return { rotina, turnoId, pedidoId: pedido?.id ?? "" };
}

describe("dispensar: quem pode sair pelo × / 'Dispensar'", () => {
  it("aberta: pergunta, falta_de_dado, permissão e — desde 2026-09-24 (ADR-045) — o 'Retomar'; aprovação, acesso e propostas não", () => {
    for (const tipo of ["pergunta", "falta_de_dado", "permissao", "retomar_turno"] as const) {
      expect(podeDispensar({ tipo, estado: "pendente" }), tipo).toBe(true);
      expect(podeDispensar({ tipo, estado: "reaberta" }), tipo).toBe(true);
    }
    for (const tipo of ["aprovacao", "acesso", "gate_rotina", "perfil", "rotina", "rotina_atualizacao", "rotina_exclusao"] as const) {
      expect(podeDispensar({ tipo, estado: "pendente" }), tipo).toBe(false);
      expect(podeDispensar({ tipo, estado: "vencida" }), tipo).toBe(true);
    }
    expect(podeDispensar({ tipo: "retomar_turno", estado: "decidida" })).toBe(false);
  });

  it("'Retomar' aberto sai sem retomar nada; aprovação aberta continua estado_invalido", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const agente = await d.deps.repos.agentes.criar({ nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "claude-haiku-4-5-20251001" });
    const conversa = await d.deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
    const turno = await d.deps.repos.turnos.enfileirar({ conversaId: conversa?.id ?? "", agenteId: agente?.id ?? "", origem: "conversa", prazoEm: AGORA + 10_000, profundidade: 0, entradaTexto: "revise", entradaConfianca: "confiavel", modelo: "sonnet", interrompidoCom: "maquina_sem_contato" });
    const retomar = await d.deps.repos.decisoes.criar({ tipo: "retomar_turno", agenteId: agente?.id ?? "", conversaId: conversa?.id ?? "", turnoId: turno?.id ?? null, prazoDecisaoEm: AGORA + DIA, frase: "Turno interrompido: seu Mac parou de responder." });
    const aprovacao = await d.deps.repos.decisoes.criar({ tipo: "aprovacao", agenteId: agente?.id ?? "", conversaId: conversa?.id ?? "", prazoDecisaoEm: AGORA + DIA, frase: "enviar" });

    const r = await dispensarDecisao(d.deps, { decisaoId: retomar?.id ?? "" });
    expect(r.data.decisao).toMatchObject({ estado: "decidida", desfecho: { tipo: "dispensada", antes: "pendente" } });
    expect(d.banco.turnos.filter((t) => t.origem === "retomada")).toHaveLength(0);
    expect(d.banco.turnos.find((t) => t.id === turno?.id)?.estado).toBe("interrompido");
    await expect(dispensarDecisao(d.deps, { decisaoId: aprovacao?.id ?? "" })).rejects.toMatchObject({ codigo: "estado_invalido" });
  });
});

describe("dispensar o pedido ABERTO de uma execução de rotina (definido em 2026-09-24)", () => {
  it("a janela vira 'passou_em_branco' com motivo 'pedido_dispensado' — a MESMA linha, e a conversa diz em palavras", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const c = await rotinaQuePediu(d);
    const r = await dispensarDecisao(d.deps, { decisaoId: c.pedidoId });
    expect(d.banco.execucoes.map((e) => [e.instanteAgendado, e.desfecho, e.motivo])).toEqual([[JANELA, "passou_em_branco", "pedido_dispensado"]]);
    expect(r.events.map((e) => e.kind)).toEqual(["decisao_decidida", "rotina_executou"]);
    const aviso = d.banco.mensagens.filter((m) => m.kind === "rotina_execucao").at(-1);
    expect(aviso?.texto).toContain("A rotina passou em branco: o pedido foi dispensado sem resposta. Nada foi enviado.");
  });

  it("pedido VENCIDO não reescreve a janela (a causa verdadeira é do varredor) nem escreve na conversa", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const c = await rotinaQuePediu(d);
    const pedido = d.banco.decisoes.find((x) => x.id === c.pedidoId);
    if (!pedido) throw new Error("pedido");
    pedido.prazoDecisaoEm = new Date(AGORA - 1).toISOString();
    await d.deps.repos.decisoes.vencerPendentes(AGORA);
    const mensagensAntes = d.banco.mensagens.length;
    await dispensarDecisao(d.deps, { decisaoId: c.pedidoId });
    expect(d.banco.execucoes).toEqual([]);
    expect(d.banco.mensagens).toHaveLength(mensagensAntes);
  });

  it("pela rota: a decisora designada dispensa e a fase da DONA registra a janela (ADR-007)", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const c = await rotinaQuePediu(d, { decisorId: PESSOA_ANA });
    const donas: string[] = [];
    const rota = criarRotasSuaVez(async (escopo, fn) => {
      donas.push(escopo.pessoaId);
      return fn(d.comEscopo(escopo));
    }).find((r) => r.padrao.source.includes("decisoes") && r.padrao.source.includes("dispensar"));
    if (!rota || rota.publica) throw new Error("rota");
    const req = new IncomingMessage(new Socket());
    const json = vi.fn();
    await rota.handler({ req, res: new ServerResponse(req), escopo: ANA, params: { id: c.pedidoId }, corpo: async () => ({}), json });
    expect(json).toHaveBeenCalledWith(200, { ok: true, ids: { decisaoId: c.pedidoId } });
    expect(donas).toEqual([PESSOA_ANA, d.deps.escopo.pessoaId]);
    expect(d.banco.decisoes.find((x) => x.id === c.pedidoId)?.desfecho).toMatchObject({ tipo: "dispensada", por: PESSOA_ANA });
    expect(d.banco.execucoes.map((e) => [e.desfecho, e.motivo])).toEqual([["passou_em_branco", "pedido_dispensado"]]);
  });
});

describe("dispensar a pergunta do computador (NOD-170)", () => {
  it("aguardando a pessoa: devolve ao bot e conta como atividade, como o 'Devolver ao bot' da tela", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const agente = await d.deps.repos.agentes.criar({ nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "claude-haiku-4-5-20251001" });
    const conversa = await d.deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
    const pergunta = await d.deps.repos.decisoes.criar({ tipo: "pergunta", agenteId: agente?.id ?? "", conversaId: conversa?.id ?? "", prazoDecisaoEm: AGORA + DIA, frase: "faça o login no Gmail" });
    const configurar = vi.fn(async () => undefined);
    const registrar = vi.fn(async () => undefined);
    Object.assign(d.deps.repos.computadores, {
      buscarVinculo: async () => ({ id: "c1", controle: "aguardando_pessoa", ajudaDecisaoId: pergunta?.id }),
      configurar,
      registrar,
    });
    await dispensarDecisao(d.deps, { decisaoId: pergunta?.id ?? "" });
    expect(configurar).toHaveBeenCalledWith("c1", { controle: "bot", ajuda: null, ajudaDecisaoId: null, atividadeEm: AGORA });
    expect(registrar).toHaveBeenCalledWith(expect.objectContaining({ computadorId: "c1", tipo: "devolver" }));
  });
});
