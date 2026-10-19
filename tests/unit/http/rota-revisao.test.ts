import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it } from "vitest";
import type { PlanoTurno } from "../../../src/contracts/plano-turno.ts";
import type { PedidoRenovar } from "../../../src/contracts/ponte.ts";
import type { RelatoRevisao } from "../../../src/contracts/revisao.ts";
import { VERSAO_MINIMA_APP, type PonteInternaNod } from "../../../src/adapters/fundo/ponte-interna.ts";
import { criarPonteHttpServidor } from "../../../src/adapters/http/rotas/ponte.ts";
import { camposDoRevisor, relatoRevisao } from "../../../src/adapters/http/rotas/ponte-validacao.ts";

/**
 * ADR-115 (PR 3a do plano dos modos de aprovação) na ponte HTTP da máquina: a renovação remonta o `PedidoRenovar` campo a
 * campo (o campo novo do revisor some calado se não entrar ali) e a rota `revisao` entrega o relato à ponte com a máquina
 * da CHAVE, nunca a do corpo.
 */
const escopo = { tenantId: "00000000-0000-4000-8000-000000000001", pessoaId: "00000000-0000-4000-8000-000000000002" };
const turnoId = "00000000-0000-4000-8000-000000000003";
const revisaoId = "00000000-0000-4000-8000-000000000004";
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false };
const PROVA = "a".repeat(64);

function montar() {
  const renovados: PedidoRenovar[] = [];
  const relatos: { pessoaId: string; machineId: string; relato: RelatoRevisao }[] = [];
  const pronto = { estado: "pronto", versao: "fake", em: 0 };
  const ponte: PonteInternaNod = {
    conectar: async () => undefined,
    puxar: async () => ({ turnoId } as PlanoTurno),
    renovar: async (p) => {
      renovados.push(p);
      return { ativo: true, versaoMinimaApp: VERSAO_MINIMA_APP, revisoes: [{ revisaoId, decisaoId: turnoId, turnoId, modelo: "m", prompt: "p", entrada: "e", expiraEm: 1 }] };
    },
    entregar: async () => undefined,
    desconectar: async () => undefined,
    maquinasConectadas: () => [],
    escopoDoTurno: () => null,
    relatarRevisao: async (pessoaId, machineId, relato) => {
      relatos.push({ pessoaId, machineId, relato });
      return { aceito: true };
    },
  };
  const p = criarPonteHttpServidor({
    criar: () => ponte, persistir: async () => undefined, autorizar: async () => ({ ...escopo, chaveId: "chave-m1" }),
    segredo: "s", seguro: false, agora: () => 1_800_000_000_000, delta: () => undefined, ferramenta: () => undefined, tarefas: () => undefined, longpollMs: 2_000,
  });
  const chamar = async (nome: string, corpo: unknown = {}) => {
    const rota = p.rotas.find((r) => r.padrao.test(`/${nome}`));
    let resposta: { status: number; body: unknown } | null = null;
    const req = new IncomingMessage(new Socket());
    req.headers = { authorization: "Bearer k", "x-nod-versao": VERSAO_MINIMA_APP };
    await rota!.handler({ req, res: new ServerResponse(req), escopo, params: { chaveId: "chave-m1" }, corpo: async () => corpo, json: (status, body) => { resposta = { status, body }; } });
    return resposta!;
  };
  return { chamar, renovados, relatos, pronto };
}

describe("ponte HTTP e o revisor (ADR-115)", () => {
  it("a renovação passa `revisa`, o segredo e os recebidos à ponte, e devolve os pedidos de revisão", async () => {
    const { chamar, renovados, pronto } = montar();
    await chamar("conectar", { versaoContrato: 1, nome: "Mac", inventario: pronto });
    await chamar("puxar");
    const r = await chamar("renovar", { turnoId, sinais: SINAIS, eventos: [], revisa: true, segredoRevisao: "s".repeat(32), revisoesRecebidas: [revisaoId] });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ativo: true, revisoes: [{ revisaoId }] });
    expect(renovados.at(-1)).toMatchObject({ turnoId, machineId: "chave-m1", revisa: true, segredoRevisao: "s".repeat(32), revisoesRecebidas: [revisaoId] });
    // App antigo: sem os campos, a ponte não recebe nenhum (e a fase 1 manda ao cartão).
    await chamar("renovar", { turnoId, sinais: SINAIS, eventos: [] });
    const antigo = renovados.at(-1)!;
    expect("revisa" in antigo || "segredoRevisao" in antigo || "revisoesRecebidas" in antigo).toBe(false);
  });

  it("campos do revisor fora do formato viram ausentes e nunca derrubam a renovação (o lease)", () => {
    expect(camposDoRevisor({ revisa: "sim", segredoRevisao: 7, revisoesRecebidas: ["não-uuid"] })).toEqual({});
    expect(camposDoRevisor({ revisa: true, segredoRevisao: "x".repeat(300), revisoesRecebidas: Array.from({ length: 65 }, () => revisaoId) })).toEqual({ revisa: true });
  });

  it("a rota `revisao` entrega o relato com a máquina da chave; corpo fora do contrato é 400 (entrada_invalida)", async () => {
    const { chamar, relatos, pronto } = montar();
    await chamar("conectar", { versaoContrato: 1, nome: "Mac", inventario: pronto });
    const corpo = { revisaoId, turnoId, saida: '{"decisao":"libera","motivo":"ok"}', ms: 4100, fichasEntrada: 2000, fichasSaida: 20, prova: PROVA, machineId: "outra-maquina" };
    expect(await chamar("revisao", corpo)).toEqual({ status: 200, body: { aceito: true } });
    expect(relatos).toEqual([{ pessoaId: escopo.pessoaId, machineId: "chave-m1", relato: { revisaoId, turnoId, saida: corpo.saida, ms: 4100, fichasEntrada: 2000, fichasSaida: 20, prova: PROVA } }]);
    for (const ruim of [
      { ...corpo, prova: "curta" },
      { ...corpo, revisaoId: "x" },
      { ...corpo, falha: "init" },
      { revisaoId, turnoId, ms: 1, prova: PROVA },
      { revisaoId, turnoId, falha: "inventada", ms: 1, prova: PROVA },
      { ...corpo, ms: -1 },
      { ...corpo, fichasEntrada: 1.5 },
      { ...corpo, saida: "x".repeat(5000) },
    ]) await expect(chamar("revisao", ruim)).rejects.toThrow("entrada_invalida");
  });

  it("relatoRevisao aceita a falha do laço sem saída", () => {
    expect(relatoRevisao({ revisaoId, turnoId, falha: "prazo", ms: 55_000, prova: PROVA })).toEqual({ revisaoId, turnoId, falha: "prazo", ms: 55_000, prova: PROVA });
  });
});
