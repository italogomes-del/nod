import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { Rotina } from "../../../src/contracts/rotina.ts";
import { atualizarPerfil } from "../../../src/use-cases/atualizar-perfil.ts";
import { confirmarProposta } from "../../../src/use-cases/confirmar-proposta.ts";
import { criarAgente, NOME_INICIAL } from "../../../src/use-cases/criar-agente.ts";
import { recusarProposta } from "../../../src/use-cases/recusar-proposta.ts";
import { depsEmMemoria, esperarErro, executar } from "../../helpers/deps-l6.ts";

describe("propostas (E1.1): nada é aplicado antes da confirmação", () => {
  it("atualizar_perfil (ferramenta) só cria a proposta; confirmar aplica nome/título/descrição e marca confirmado", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    const ctx = { turnoId: randomUUID(), agenteId: criado.agente.id, conversaId: criado.conversa.id };

    const proposta = await executar(deps, atualizarPerfil, { ...ctx, nome: "Vera", titulo: "Revisora", descricao: "Revisa PRs e responde curto" });
    expect(proposta.events.map((e) => e.kind)).toEqual(["proposta_criada"]);
    expect(await deps.repos.agentes.buscar(criado.agente.id)).toMatchObject({ nome: NOME_INICIAL, confirmado: false });
    expect((await deps.repos.propostas.buscar(proposta.data.proposta_id))?.estado).toBe("pendente");

    const { data, events } = await executar(deps, confirmarProposta, { propostaId: proposta.data.proposta_id });
    expect(data.proposta.estado).toBe("confirmada");
    expect(data.agente).toMatchObject({ nome: "Vera", titulo: "Revisora", descricao: "Revisa PRs e responde curto", confirmado: true });
    expect(events.map((e) => e.kind)).toEqual(["agente_atualizado", "mensagem_criada"]);
    const ultima = await deps.repos.mensagens.ultimaDaConversa(criado.conversa.id);
    expect(ultima?.texto).toContain("Confirmado por");
    expect(ultima?.texto).toContain("nome: Vera");

    await esperarErro(() => confirmarProposta(deps, { propostaId: proposta.data.proposta_id }), "estado_invalido");
    await esperarErro(() => confirmarProposta(deps, { propostaId: randomUUID() }), "nao_encontrado");
  });

  it("proposta vazia é recusada pela ferramenta (entrada_invalida)", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    await esperarErro(() => atualizarPerfil(deps, { turnoId: "t", agenteId: criado.agente.id, conversaId: criado.conversa.id }), "entrada_invalida");
  });

  it("recusar deixa de lado: mensagem 'Deixei isso de lado', agente inalterado, segunda recusa → estado_invalido", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    const proposta = await executar(deps, atualizarPerfil, { turnoId: "t", agenteId: criado.agente.id, conversaId: criado.conversa.id, nome: "Vera" });
    const { data } = await executar(deps, recusarProposta, { propostaId: proposta.data.proposta_id });
    expect(data.proposta.estado).toBe("recusada");
    expect((await deps.repos.agentes.buscar(criado.agente.id))?.nome).toBe(NOME_INICIAL);
    expect((await deps.repos.mensagens.ultimaDaConversa(criado.conversa.id))?.texto).toContain("Deixei isso de lado");
    await esperarErro(() => recusarProposta(deps, { propostaId: proposta.data.proposta_id }), "estado_invalido");
  });

  it("'rotina' confirma pelo services.rotinas.ativar (L7) na mesma tx e emite rotina_criada", async () => {
    const ativar = vi.fn(async (_trx: unknown, propostaId: string): Promise<Rotina> => ({
      tenantId: "t",
      id: "rotina-1",
      agenteId: "a",
      conversaId: "c",
      ownerId: "p",
      cron: "0 8 * * 1-5",
      fusoIana: "America/Sao_Paulo",
      instrucao: "resumo",
      fonte: "prs",
      entregavel: "resumo",
      limitesAprovacao: "nada sai sem aprovação",
      politicaSemDado: "diga que não houve",
      exigeAprovacao: true,
      estado: "ativa",
      proximaExecucao: 1,
      criadoEm: 0,
      excluidoEm: null,
      ...(propostaId ? {} : {}),
    }));
    const { deps } = depsEmMemoria(undefined, { ativarRotina: ativar });
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
    const p = await deps.repos.propostas.criar({
      conversaId: criado.conversa.id,
      agenteId: criado.agente.id,
      payload: { kind: "rotina", cron: "0 8 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: "resumo", fonte: "prs", entregavel: "resumo", limitesAprovacao: "x", politicaSemDado: "y", proximaExecucao: 1, resumo: "dias úteis às 08:00" },
    });
    const { data, events } = await executar(deps, confirmarProposta, { propostaId: p?.id ?? "" });
    expect(ativar).toHaveBeenCalledTimes(1);
    expect(ativar.mock.calls[0]?.[1]).toBe(p?.id);
    expect(data.rotina?.id).toBe("rotina-1");
    expect(events.map((e) => e.kind)).toEqual(["rotina_criada", "mensagem_criada"]);
  });

  it("'acesso' confirma como decisão tipo 'acesso' em Sua vez; nada é concedido aqui", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa", nome: "Vera" });
    const p = await deps.repos.propostas.criar({ conversaId: criado.conversa.id, agenteId: criado.agente.id, payload: { kind: "acesso", conector: "exemplo", capacidades: ["listar_contatos"], nivel: "leitura", naoPedido: ["enviar_email"] } });
    const { data, events } = await executar(deps, confirmarProposta, { propostaId: p?.id ?? "" });
    expect(data.decisao).toMatchObject({ tipo: "acesso", estado: "pendente", agenteId: criado.agente.id });
    expect(data.decisao?.frase).toContain("listar_contatos");
    expect(data.decisao?.frase).toContain("não pedido: enviar_email");
    expect(events.map((e) => e.kind)).toEqual(["decisao_criada", "mensagem_criada"]);
    expect(await deps.repos.concessoes.doAgente(criado.agente.id)).toEqual([]);
  });
});
