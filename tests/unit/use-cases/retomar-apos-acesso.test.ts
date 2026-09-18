import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { expect, it, vi } from "vitest";
import { criarRotasDecisoes } from "../../../src/adapters/http/rotas/decisoes.ts";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { pedirAcesso } from "../../../src/use-cases/pedir-acesso.ts";
import { confirmarProposta } from "../../../src/use-cases/confirmar-proposta.ts";
import { depsEmMemoria } from "../../helpers/deps-l6.ts";

async function preparar() {
  const { deps, banco } = depsEmMemoria();
  const { data: bot } = await criarAgente(deps, { dono: "pessoa", interativo: true });
  const conector = await deps.repos.conectores.criar({ nome: "Slack", slug: "slack", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
  if (!conector) throw new Error("conector");
  conector.habilitado = true;
  conector.catalogo = [{ nome: "enviar", descricao: "Enviar mensagem", schema: { type: "object" }, readOnlyHint: false }];
  const original = await deps.repos.turnos.enfileirar({ conversaId: bot.conversa.id, agenteId: bot.agente.id, origem: "conversa", prazoEm: deps.agora() + 10000, profundidade: 0, entradaTexto: "mande uma msg de teste para Ingridd", entradaConfianca: "confiavel", harness: "claude-cli", modelo: "sonnet" });
  if (!original) throw new Error("turno");
  const pedido = await pedirAcesso(deps, { turnoId: original.id, conversaId: bot.conversa.id, agenteId: bot.agente.id, conector: "slack", capacidades: ["enviar"], nivel: "escrita", nao_pedido: [] });
  const confirmado = await confirmarProposta(deps, { propostaId: pedido.data.proposta_id });
  expect(confirmado.data.decisao?.turnoId).toBe(original.id);
  const rota = criarRotasDecisoes({ dentro: async (_escopo, fn) => fn(deps), services: deps.services })[0]!;
  const req = new IncomingMessage(new Socket());
  const decidir = (recusar = false) => rota.handler({ req, res: new ServerResponse(req), escopo: deps.escopo, params: { id: pedido.data.proposta_id }, corpo: async () => ({ recusar }), json: vi.fn() });
  return { banco, original, decidir };
}

it("conceder o acesso retoma o pedido original uma única vez, sem executar o envio na aprovação", async () => {
  const { banco, original, decidir } = await preparar();
  await decidir();
  expect(banco.concessoes).toHaveLength(1);
  const retomadas = banco.turnos.filter((t) => t.retomaTurnoId === original.id);
  expect(retomadas).toHaveLength(1);
  expect(retomadas[0]).toMatchObject({ origem: "retomada", harness: original.harness, modelo: original.modelo, entradaConfianca: original.entradaConfianca });
  expect(retomadas[0]?.entradaTexto).toContain(original.entradaTexto);
  expect(retomadas[0]?.entradaTexto).toContain("slack: enviar");
  expect(retomadas[0]?.entradaTexto).toContain("Preserve as regras de aprovação");
  await expect(decidir()).rejects.toMatchObject({ codigo: "estado_invalido" });
  expect(banco.turnos.filter((t) => t.retomaTurnoId === original.id)).toHaveLength(1);
});

it("recusar o acesso não retoma nem concede capacidades", async () => {
  const { banco, original, decidir } = await preparar();
  await decidir(true);
  expect(banco.concessoes).toHaveLength(0);
  expect(banco.turnos.filter((t) => t.retomaTurnoId === original.id)).toHaveLength(0);
});

it("preserva a classificação de confiança ao retomar uma entrada externa", async () => {
  const { banco, original, decidir } = await preparar();
  original.entradaConfianca = "nao_confiavel";
  await decidir();
  expect(banco.turnos.find((t) => t.retomaTurnoId === original.id)?.entradaConfianca).toBe("nao_confiavel");
});
