import { afterAll, beforeAll, expect, it } from "vitest";
import type { Agente } from "../../src/contracts/agente.ts";
import type { ConversaDto, RespostaMutacao, RotinaDto } from "../../src/contracts/api.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { ExecucaoRotina } from "../../src/contracts/rotina.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

describeIntegracao("produto v1: formulários e colaboração com servidor completo", () => {
  let srv: ServidorCompleto;
  beforeAll(async () => { srv = await servidorCompleto(); });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: [], conversas: [] });
    await srv.desligar();
  });

  it("cria perfil completo, agenda pela interface, testa pausada sem alterar agenda e registra resultado", async () => {
    const bot = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Lume", titulo: "Conteúdo", descricao: "Prepara resumos curtos" });
    expect(bot.agente.confirmado).toBe(true);
    expect(bot.agente.descricao).toBe("Prepara resumos curtos");
    const criada = await srv.json<RespostaMutacao>("POST", "rotinas", { agenteId: bot.agente.id, cron: "0 9 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: "[[texto: Resumo de hoje pronto.]]", fonte: "Conversa", entregavel: "Resumo", limitesAprovacao: "Pedir aprovação para efeitos externos", politicaSemDado: "Avisar" });
    const id = criada.ids.rotinaId!;
    const antes = await srv.json<{ rotinas: RotinaDto[] }>("GET", "rotinas");
    await srv.json("POST", `rotinas/${id}/pausar`);
    const teste = await srv.json<RespostaMutacao>("POST", `rotinas/${id}/executar`);
    expect(teste.ids.conversaId).toBe(bot.conversa.id);
    expect(teste.ids.turnoId).toBeTruthy();
    const execucoes = await srv.esperar(async () => {
      const r = await srv.json<{ execucoes: ExecucaoRotina[] }>("GET", `rotinas/${id}/execucoes`);
      return r.execucoes.length ? r.execucoes : null;
    });
    expect(execucoes[0]?.desfecho).toBe("executou");
    const depois = await srv.json<{ rotinas: RotinaDto[] }>("GET", "rotinas");
    expect(depois.rotinas[0]?.rotina.estado).toBe("pausada");
    expect(depois.rotinas[0]?.rotina.proximaExecucao).toBe(antes.rotinas[0]?.rotina.proximaExecucao);
    const conversa = await srv.json<ConversaDto>("GET", `conversas/${bot.conversa.id}/mensagens`);
    expect(conversa.mensagens.some((m) => m.texto === "Resumo de hoje pronto.")).toBe(true);
    expect((await srv.chamar("POST", "rotinas/nao-uuid/executar")).status).toBe(404);
  });

  it("consulta por id dentro de uma sala mostra pedido e resposta na sala, sem contaminar o DM", async () => {
    const criar = (nome: string) => srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome, descricao: "Colabora com os colegas" });
    const a = await criar("Autora");
    const b = await criar("Revisora");
    const sala = await srv.json<RespostaMutacao>("POST", "salas", { nome: "Lançamento", agenteIds: [a.agente.id, b.agente.id] });
    const pergunta = `[[texto: O principal risco é falta de clareza.]]`;
    await srv.json("POST", `salas/${sala.ids.salaId}/mensagens`, { texto: `@Autora [[tool: perguntar_a_bot ${JSON.stringify({ agente: b.agente.id, pergunta })}]] [[texto: Pedi uma revisão.]]` });
    const retorno = await srv.esperar(async () => {
      const c = await srv.json<ConversaDto>("GET", `conversas/${sala.ids.conversaId}/mensagens`);
      return c.mensagens.some((m) => m.kind === "peer_ask") ? c : null;
    }, { timeoutMs: 15_000 });
    expect(retorno.mensagens.some((m) => m.kind === "handoff" && m.payload?.kind === "handoff" && m.payload.tarefaId)).toBe(true);
    expect(retorno.mensagens.find((m) => m.kind === "peer_ask")?.texto).toBe("O principal risco é falta de clareza.");
    const dm = await srv.json<ConversaDto>("GET", `conversas/${a.conversa.id}/mensagens`);
    expect(dm.mensagens.some((m) => m.kind === "peer_ask")).toBe(false);
  });
});
