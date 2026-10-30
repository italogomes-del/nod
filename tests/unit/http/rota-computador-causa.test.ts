import { describe, expect, it } from "vitest";
import { ErroDeDominio } from "../../../src/domain/erro.ts";
import { MOTIVOS_DO_COMPUTADOR, rotasComputadores } from "../../../src/adapters/http/rotas/computadores.ts";
import type { Computadores } from "../../../src/adapters/fundo/computadores.ts";
import type { Ctx } from "../../../src/adapters/http/roteador.ts";

/** NOD-407: o 409 das rotas do computador diz a causa real (lista branca) em vez do "Atualize a página" genérico. */
const ESCOPO = { tenantId: "00000000-0000-4000-8000-0000000000a1", pessoaId: "00000000-0000-4000-8000-0000000000b1" };

function chamar(rotaPadrao: string, metodo: "GET" | "POST", corpo: unknown, falha: unknown, params: Record<string, string> = {}) {
  const computadores = {
    operarDaPessoa: async () => { throw falha; },
    configurar: async () => { throw falha; },
    humano: async () => { throw falha; },
  } as unknown as Computadores;
  const rota = rotasComputadores(computadores).find((r) => r.metodo === metodo && r.padrao.source === rotaPadrao)!;
  const resposta: { status?: number; corpo?: unknown } = {};
  const ctx = { escopo: ESCOPO, params, corpo: async () => corpo, json: (status: number, c: unknown) => { resposta.status = status; resposta.corpo = c; } } as unknown as Ctx;
  return rota.handler(ctx).then(() => resposta);
}

describe("rotas do computador: a causa real no 409 (NOD-407)", () => {
  it("acordar com a máquina sem contato: 409 com a frase da tabela e o motivo", async () => {
    const r = await chamar("^\\/computador$", "POST", { operacao: "acordar" }, new ErroDeDominio("estado_invalido", { cause: "maquina_sem_contato" }));
    expect(r).toEqual({ status: 409, corpo: { codigo: "estado_invalido", mensagem: MOTIVOS_DO_COMPUTADOR.maquina_sem_contato, motivo: "maquina_sem_contato" } });
  });

  it("'computador fora do ar' vira fora_do_ar; sem causa é a reserva viva (ocupado); outras causas seguem o caminho comum", async () => {
    expect((await chamar("^\\/agentes\\/(?<id>[^/]+)\\/computador$", "POST", { operacao: "assumir" }, new ErroDeDominio("estado_invalido", { cause: "computador fora do ar" }), { id: "a" })).corpo).toMatchObject({ motivo: "fora_do_ar" });
    expect((await chamar("^\\/agentes\\/(?<id>[^/]+)\\/computador\\/acoes$", "POST", { tipo: "observar" }, new ErroDeDominio("estado_invalido"), { id: "a" })).corpo).toMatchObject({ motivo: "ocupado", mensagem: MOTIVOS_DO_COMPUTADOR.ocupado });
    await expect(chamar("^\\/computador$", "POST", { operacao: "acordar" }, new ErroDeDominio("estado_invalido", { cause: "segredo da pessoa" }))).rejects.toMatchObject({ codigo: "estado_invalido" });
    await expect(chamar("^\\/computador$", "POST", { operacao: "acordar" }, new ErroDeDominio("nao_permitido"))).rejects.toMatchObject({ codigo: "nao_permitido" });
  });
});
