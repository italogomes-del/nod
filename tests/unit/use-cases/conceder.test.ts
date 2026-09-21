import { describe, expect, it } from "vitest";
import { conceder, quandoUtc } from "../../../src/use-cases/conceder.ts";
import { revogar } from "../../../src/use-cases/revogar.ts";
import { PESSOA_MARLON, TENANT_LEAPY } from "../../helpers/ids.ts";
import { depsFalsos } from "./deps-l5.ts";

const AGORA = 1_758_000_000_000;

async function cenario() {
  const { deps, banco } = depsFalsos({ agora: AGORA });
  banco.pessoas.push({ tenantId: TENANT_LEAPY, id: PESSOA_MARLON, nome: "Marlon", iniciais: "M", email: null });
  const agente = await deps.repos.agentes.criar({ nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
  const conversa = await deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  const conector = await deps.repos.conectores.criar({ nome: "Exemplo", slug: "exemplo", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
  await deps.repos.conectores.registrarSonda(conector?.id ?? "", {
    ok: true,
    agora: AGORA,
    catalogo: [
      { nome: "listar_contatos", descricao: "lista contatos", schema: { type: "object" }, readOnlyHint: true },
      { nome: "enviar_email", descricao: "envia e-mail", schema: { type: "object" }, readOnlyHint: false },
    ],
  });
  return { deps, banco, agenteId: agente?.id ?? "", conversaId: conversa?.id ?? "", conectorId: conector?.id ?? "" };
}

describe("conceder / revogar (E6.3, E12.5)", () => {
  it("concessão nasce presa à mensagem de consentimento na conversa do agente, com concedente, data/hora, escopo exato e o que NÃO inclui", async () => {
    const c = await cenario();
    const r = await conceder(c.deps, { agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "listar_contatos", autorTipo: "pessoa" });
    const mensagem = c.banco.mensagens.find((m) => m.id === r.data.mensagemId);
    expect(mensagem).toMatchObject({ kind: "consentimento", conversaId: c.conversaId, confianca: "confiavel", autoria: { autor_tipo: "pessoa", autor_id: PESSOA_MARLON } });
    expect(mensagem?.texto).toBe(`Concedido por Marlon em ${quandoUtc(AGORA)}: exemplo.listar_contatos; não inclui: enviar_email: envia e-mail.`);
    expect(quandoUtc(AGORA)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC$/);
    expect(mensagem?.payload).toEqual({ kind: "consentimento", conectorId: c.conectorId, slug: "exemplo", capacidade: "listar_contatos", naoInclui: ["enviar_email: envia e-mail"] });
    const concessao = await c.deps.repos.concessoes.buscar(r.data.concessaoId);
    expect(concessao).toMatchObject({ agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "listar_contatos", mensagemId: r.data.mensagemId });
    expect(r.events?.map((e) => e.kind)).toEqual(["concessao_criada"]);

    const segunda = await conceder(c.deps, { agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "enviar_email" });
    expect(c.banco.mensagens.find((m) => m.id === segunda.data.mensagemId)?.texto).toContain("não inclui: nada mais deste conector");
  });

  it("agente não concede a agente e capacidade fora do catálogo é recusada com código fechado", async () => {
    const c = await cenario();
    await expect(conceder(c.deps, { agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "listar_contatos", autorTipo: "agente" })).rejects.toMatchObject({ codigo: "nao_permitido" });
    await expect(conceder(c.deps, { agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "apagar_tudo" })).rejects.toMatchObject({ codigo: "entrada_invalida" });
    await expect(conceder(c.deps, { agenteId: "nao-existe", conectorId: c.conectorId, capacidade: "listar_contatos" })).rejects.toMatchObject({ codigo: "nao_encontrado" });
  });

  /**
   * definido em 2026-09-21: até aqui a segunda concessão era `rejects estado_invalido`, agrupada com
   * "fora do catálogo" como se fosse recusa. Não é: aquelas são entrada inválida e permissão, esta é
   * uma operação JÁ satisfeita. O contrato escrito do repositório sempre foi idempotente ("conceder
   * duas vezes não duplica") e o 409 do caso de uso travava o card de uma decisão de acesso duplicada.
   * A invariante que o teste antigo realmente protegia — UMA concessão por capacidade — segue aqui.
   */
  it("conceder de novo a mesma capacidade é idempotente: devolve a concessão existente, sem segunda concessão nem segundo consentimento", async () => {
    const c = await cenario();
    const primeira = await conceder(c.deps, { agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "listar_contatos" });
    const repetida = await conceder(c.deps, { agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "listar_contatos" });

    expect(repetida.data.concessaoId).toBe(primeira.data.concessaoId);
    // A mensagem citável é a ORIGINAL: nenhum consentimento novo entra na conversa própria.
    expect(repetida.data.mensagemId).toBe(primeira.data.mensagemId);
    expect(repetida.events ?? []).toEqual([]);
    expect(c.banco.concessoes).toHaveLength(1);
    expect(c.banco.mensagens.filter((m) => m.kind === "consentimento")).toHaveLength(1);
  });

  it("revogar apaga a concessão, deixa registro escrito e mantém a mensagem de consentimento original", async () => {
    const c = await cenario();
    const r = await conceder(c.deps, { agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "listar_contatos" });
    const rev = await revogar(c.deps, { concessaoId: r.data.concessaoId });
    expect(await c.deps.repos.concessoes.doAgente(c.agenteId)).toEqual([]);
    expect(c.banco.mensagens.find((m) => m.id === r.data.mensagemId)?.kind).toBe("consentimento");
    expect(c.banco.mensagens.find((m) => m.id === rev.data.mensagemId)?.texto).toBe(`Revogado por Marlon em ${quandoUtc(AGORA)}: exemplo.listar_contatos.`);
    await expect(revogar(c.deps, { concessaoId: r.data.concessaoId })).rejects.toMatchObject({ codigo: "nao_encontrado" });
  });
});
