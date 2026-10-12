import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import { criarRotasDecisoes } from "../../../src/adapters/http/rotas/decisoes.ts";
import { FERRAMENTAS_NOD } from "../../../src/contracts/ferramentas-nod.ts";
import { MAX_CARACTERES_OPCAO, MAX_OPCOES } from "../../../src/contracts/pedido.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { normalizarOpcoes, normalizarPedidoAPessoa, pedirAPessoa } from "../../../src/use-cases/pedir-a-pessoa.ts";
import { depsEmMemoria, MARLON } from "../../helpers/deps-l6.ts";

/**
 * Perguntas viram conversa (emenda da ADR-045, definido em 2026-09-24): pedir_a_pessoa grava a FALA do
 * agente ligada à decisão (payload pedido_a_pessoa), com respostas prontas opcionais; o molde "parei:
 * falta X; quem destrava: Y; não vou tentar de novo" ficou só na frase da fila.
 */
describe("respostas prontas (opcoes)", () => {
  it("até 4, cada uma com até 60 caracteres: vazia, repetida (sem caixa), longa e não-texto saem; espaço colapsa", () => {
    const sessenta = "a".repeat(MAX_CARACTERES_OPCAO);
    expect(normalizarOpcoes(["  Sim,   pode\narquivar ", "", "   ", 3, null, "sim, PODE arquivar", "x".repeat(MAX_CARACTERES_OPCAO + 1), "Não", sessenta, "Depois", "Nunca"])).toEqual(["Sim, pode arquivar", "Não", sessenta, "Depois"]);
    expect(normalizarOpcoes(["Nunca", "Não", "Talvez", "Sim", "Depois"])).toHaveLength(MAX_OPCOES);
    // Conta caractere, não unidade UTF-16: 60 emojis cabem.
    expect(normalizarOpcoes(["👍".repeat(MAX_CARACTERES_OPCAO)])).toHaveLength(1);
    expect(normalizarOpcoes("Sim, Não")).toEqual([]);
    expect(normalizarOpcoes(undefined)).toEqual([]);
  });

  it("normalizarPedidoAPessoa leva as opções válidas e omite o campo quando nenhuma sobra — nunca recusa por elas (EMENDA 16)", () => {
    expect(normalizarPedidoAPessoa({ tipo: "pergunta", texto: "Posso arquivar?", opcoes: ["Sim", "Não"] })).toEqual({ tipo: "pergunta", texto: "Posso arquivar?", opcoes: ["Sim", "Não"] });
    expect(normalizarPedidoAPessoa({ tipo: "pergunta", texto: "Posso arquivar?", opcoes: ["", 42] })).toEqual({ tipo: "pergunta", texto: "Posso arquivar?" });
    expect(normalizarPedidoAPessoa({ tipo: "permissao_total", opcoes: "sim" })).toEqual({ tipo: "pergunta", texto: "(pedido sem texto)" });
  });

  it("o schema diz ao modelo o limite e a descrição pede fala natural, opcoes previsíveis e nada de repetir a pergunta", () => {
    const schema = FERRAMENTAS_NOD.pedir_a_pessoa;
    expect(schema.properties.opcoes).toMatchObject({ type: "array", maxItems: MAX_OPCOES, items: { type: "string", maxLength: MAX_CARACTERES_OPCAO } });
    expect(schema.required).toEqual(["tipo", "texto"]);
    expect(schema.description).toContain("como a sua própria fala");
    expect(schema.description).toContain("opcoes");
    expect(schema.description).toContain("sem repetir a pergunta em texto");
    expect(schema.description).not.toContain("quem destrava");
  });
});

describe("pedirAPessoa grava a fala ligada à decisão", () => {
  async function cenario() {
    const { deps, banco } = depsEmMemoria();
    banco.pessoas.push({ tenantId: MARLON.tenantId, id: MARLON.pessoaId, nome: "Marlon", iniciais: "M", email: null });
    const { data: bot } = await criarAgente(deps, { dono: "pessoa", nome: "Nina" });
    const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: "conversa", prazoEm: deps.agora() + 60_000, profundidade: 0, entradaTexto: "faça o resumo de vendas", entradaConfianca: "confiavel", modelo: "sonnet" });
    if (!turno) throw new Error("turno");
    return { deps, banco, bot, turno };
  }

  it("a conversa recebe o `texto` do agente com payload pedido_a_pessoa e as opções; a fila fica com a frase curta", async () => {
    const { deps, banco, bot, turno } = await cenario();
    const antes = banco.mensagens.length;
    const r = await pedirAPessoa(deps, { turnoId: turno.id, conversaId: bot.conversa.id, agenteId: bot.agente.id, tipo: "falta_de_dado", texto: "Não achei a planilha de vendas de setembro. Pode me mandar o link?", dado: "planilha de vendas", opcoes: ["Vou mandar agora", "Use a de agosto"] });
    const novas = banco.mensagens.slice(antes);
    expect(novas).toHaveLength(1);
    expect(novas[0]).toMatchObject({ kind: "texto", texto: "Não achei a planilha de vendas de setembro. Pode me mandar o link?", autoria: { autor_tipo: "agente", autor_id: bot.agente.id } });
    expect(novas[0]?.payload).toEqual({ kind: "pedido_a_pessoa", decisaoId: r.data.decisao_id, opcoes: ["Vou mandar agora", "Use a de agosto"] });
    expect(banco.decisoes.find((d) => d.id === r.data.decisao_id)?.frase).toBe("parei: falta planilha de vendas; quem destrava: Marlon; não vou tentar de novo.");
    expect(banco.mensagens.some((m) => m.texto.startsWith("parei"))).toBe(false);
  });

  it("POST decisoes/:id/responder — a rota do campo e do toque — fecha a pergunta, grava a resposta LIGADA a ela e cria a retomada", async () => {
    const { deps, banco, bot, turno } = await cenario();
    const r = await pedirAPessoa(deps, { turnoId: turno.id, conversaId: bot.conversa.id, agenteId: bot.agente.id, tipo: "pergunta", texto: "Posso arquivar o PR 7?", opcoes: ["Sim, pode arquivar"] });
    const decisao = banco.decisoes.find((d) => d.id === r.data.decisao_id);
    const rota = criarRotasDecisoes({ dentro: async (_escopo, fn) => fn(deps), services: deps.services }).find((x) => x.padrao.source.includes("responder"));
    if (!rota || rota.publica) throw new Error("rota responder");
    const req = new IncomingMessage(new Socket());
    const json = vi.fn();
    await rota.handler({ req, res: new ServerResponse(req), escopo: deps.escopo, params: { id: r.data.decisao_id }, corpo: async () => ({ texto: "Sim, pode arquivar" }), json });
    const ids = (json.mock.calls[0]?.[1] as { ids: Record<string, string> }).ids;
    expect(ids.turnoRetomada).toBeTruthy();
    expect(banco.decisoes.find((d) => d.id === r.data.decisao_id)?.estado).toBe("decidida");
    const resposta = banco.mensagens.find((m) => m.id === ids.mensagem);
    expect(resposta).toMatchObject({ kind: "texto", texto: "Sim, pode arquivar", autoria: { autor_tipo: "pessoa", autor_id: MARLON.pessoaId } });
    expect(resposta?.payload).toEqual({ kind: "resposta_a_pedido", decisaoId: r.data.decisao_id, agenteId: bot.agente.id, perguntaEm: Date.parse(decisao?.criadoEm ?? ""), retomada: true, turnoRetomadaId: ids.turnoRetomada });
    expect(banco.turnos.find((t) => t.id === ids.turnoRetomada)).toMatchObject({ origem: "retomada", retomaTurnoId: turno.id });
  });
});
