import { describe, expect, it } from "vitest";
import { JUSTIFICATIVA_SENSIVEL } from "../../../src/domain/aprovacao-item.ts";
import { ErroDeDominio } from "../../../src/domain/erro.ts";
import { pedirAprovacao } from "../../../src/use-cases/pedir-aprovacao.ts";
import type { Deps } from "../../../src/use-cases/tipos.ts";
import { depsFalsos } from "./deps-l5.ts";

async function cenario(deps: Deps) {
  const agente = await deps.repos.agentes.criar({ nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
  const conversa = await deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  const email = await deps.repos.conectores.criar({ nome: "Email", slug: "email", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
  await deps.repos.conectores.registrarSonda(email?.id ?? "", { ok: true, catalogo: [{ nome: "enviar", descricao: "envia", schema: { type: "object" }, readOnlyHint: false }], agora: 1 });
  const crm = await deps.repos.conectores.criar({ nome: "CRM", slug: "crm", transporte: "stdio", comando: "node", declaracao: "toca" });
  const semDeclaracao = await deps.repos.conectores.criar({ nome: "Planilha", slug: "planilha", transporte: "stdio", comando: "node", declaracao: "nao-declarou" });
  const turno = await deps.repos.turnos.enfileirar({ conversaId: conversa?.id ?? "", agenteId: agente?.id ?? "", origem: "conversa", prazoEm: 9e12, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
  return { agenteId: agente?.id ?? "", conversaId: conversa?.id ?? "", turnoId: turno?.id ?? "", crmId: crm?.id ?? "", planilhaId: semDeclaracao?.id ?? "" };
}

const destino = { conector: "email", ferramenta: "enviar", argumentos: { para: "x" } };

describe("pedirAprovacao (E4.1/E4.2/E4.4)", () => {
  it("quatro itens viram quatro linhas tipadas; os dois de origem sensível nascem desmarcados com justificativa fixa; volta pendente com instrução", async () => {
    const { deps, banco } = depsFalsos();
    const c = await cenario(deps);
    const r = await pedirAprovacao(deps, {
      turnoId: c.turnoId,
      agenteId: c.agenteId,
      conversaId: c.conversaId,
      resumo: "enviar 4 emails",
      itens: [
        { texto: "email para a Ana", destino },
        { texto: "email para a Bia (nome vindo do CRM)", destino, origem_conector: "crm" },
        { texto: "email para o Caio", destino },
        { texto: "email da planilha sem declaração", destino, origem_conector: "planilha" },
      ],
    });
    expect(r.data.estado).toBe("pendente");
    if (r.data.estado !== "pendente") throw new Error("esperava pendente");
    expect(r.data.instrucao).toBe("encerre o turno; a decisão retoma depois");
    const decisaoId = r.data.decisao_id;
    const decisao = banco.decisoes.find((d) => d.id === decisaoId);
    expect(decisao).toMatchObject({ tipo: "aprovacao", estado: "pendente", frase: "enviar 4 emails", turnoId: c.turnoId, decisorId: deps.escopo.pessoaId });
    const itens = await deps.repos.itensAprovacao.listar(decisaoId);
    expect(itens.map((i) => [i.idx, i.selecionado, i.origemSensivel, i.justificativa])).toEqual([
      [0, true, false, null],
      [1, false, true, JUSTIFICATIVA_SENSIVEL],
      [2, true, false, null],
      [3, false, true, JUSTIFICATIVA_SENSIVEL],
    ]);
    expect(itens[0]?.destino).toEqual(destino);
    expect(itens[0]?.textoFinal).toBe("email para a Ana");
    expect(r.events?.map((e) => e.kind)).toEqual(["decisao_criada"]);
    expect(r.events?.[0]?.dados).toMatchObject({ itens: 4, sensiveis: 2 });
  });

  it("destino fora do catálogo ou conector não registrado é recusado antes de virar decisão (E6.2: nunca inventa escopo)", async () => {
    const { deps, banco } = depsFalsos();
    const c = await cenario(deps);
    const base = { turnoId: c.turnoId, agenteId: c.agenteId, conversaId: c.conversaId, resumo: "x" };
    await expect(pedirAprovacao(deps, { ...base, itens: [{ texto: "a", destino: { ...destino, ferramenta: "apagar_tudo" } }] })).rejects.toMatchObject({ codigo: "entrada_invalida" });
    await expect(pedirAprovacao(deps, { ...base, itens: [{ texto: "a", destino: { ...destino, conector: "inexistente" } }] })).rejects.toMatchObject({ codigo: "entrada_invalida" });
    await expect(pedirAprovacao(deps, { ...base, itens: [] })).rejects.toBeInstanceOf(ErroDeDominio);
    expect(banco.decisoes).toHaveLength(0);
    expect(banco.itens).toHaveLength(0);
  });

  it("origem_conector desconhecida é tratada como sensível (fail-closed, ADR-002)", async () => {
    const { deps } = depsFalsos();
    const c = await cenario(deps);
    const r = await pedirAprovacao(deps, { turnoId: c.turnoId, agenteId: c.agenteId, conversaId: c.conversaId, resumo: "x", itens: [{ texto: "a", destino, origem_conector: "nao-existe" }] });
    if (r.data.estado !== "pendente") throw new Error("esperava pendente");
    const [item] = await deps.repos.itensAprovacao.listar(r.data.decisao_id);
    expect(item).toMatchObject({ selecionado: false, origemSensivel: true });
  });
});
