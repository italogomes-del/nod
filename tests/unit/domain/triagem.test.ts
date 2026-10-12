import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import type { Turno } from "../../../src/contracts/turno.ts";
import { montarPlano, type EntradaPlano } from "../../../src/domain/plano-turno.ts";
import { secaoDaLinha } from "../../../src/domain/prompt-sistema.ts";
import { cicloDoPedido, ehTriagemDeColega, emTriagem, instrucaoEsperaCircular, instrucaoPedidoRecebido, linhaDaTriagem, pessoaEsperaOPedido } from "../../../src/domain/triagem.ts";

const agora = 1_000_000;
const agente: Agente = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Vera", titulo: "", descricao: "revisa PRs", dono: "pessoa", forma: "shape-square", cor: "c-red", fixado: false, oculto: false, confirmado: true, modelo: "claude-haiku-4-5-20251001", duplicadoDe: null, criadoEm: 0 };
const turno: Turno = { executor: "catcher", tenantId: "t", id: "t1", conversaId: "c1", agenteId: "a1", ownerId: "p", origem: "delegacao", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: agora + 86_400_000, motivoInterrupcao: null, motivoFalha: null, semNovidadeMotivo: null, retomaTurnoId: null, profundidade: 1, reenvios: 0, pararSolicitadoEm: null, entradaTexto: "oi", entradaAnexos: [], entradaConfianca: "confiavel", custoUsd: null, modelo: "claude-haiku-4-5-20251001", criadoEm: agora, mensagemOrigemId: null };
const base: EntradaPlano = { turno, agente, memorias: [], concessoes: [], conectores: [], modo: "delegacao", confianca: "confiavel", profundidade: 1, inventario: { estado: "pronto", versao: "2.1.272", em: agora }, executor: "local", sessaoCli: null, pessoaNome: "Marlon", agora, aFazer: true, delegacao: { pessoaNome: "Marlon", remetenteNome: "Chico" } };
const nomes = (p: ReturnType<typeof montarPlano>) => p.catalogo.ferramentas.map((f) => f.nome);
const prompt = (e: EntradaPlano) => montarPlano(e).promptSistema;

describe("triagem na entrada (ADR-099 itens 1a e 8, I7 revista)", () => {
  it("é triagem de colega o turno `delegacao` fora de trabalho; o pedido de antes (task de colega) não é", () => {
    expect(ehTriagemDeColega({ origem: "delegacao", trabalhoId: null })).toBe(true);
    expect(ehTriagemDeColega({ origem: "delegacao", trabalhoId: "w1" })).toBe(false);
    expect(ehTriagemDeColega({ origem: "conversa", trabalhoId: null })).toBe(false);
    expect(ehTriagemDeColega({ origem: "retomada", trabalhoId: null })).toBe(false);
  });

  it("emTriagem: delegação ou rotina, sem trabalho, com abrir_frentes", () => {
    expect(emTriagem({ modo: "delegacao", trabalho: null, abreFrentes: true })).toBe(true);
    expect(emTriagem({ modo: "rotina", trabalho: undefined, abreFrentes: true })).toBe(true);
    expect(emTriagem({ modo: "rotina", trabalho: { origem: "rotina" }, abreFrentes: true })).toBe(false);
    expect(emTriagem({ modo: "conversa", trabalho: null, abreFrentes: true })).toBe(false);
    expect(emTriagem({ modo: "delegacao", trabalho: null, abreFrentes: false })).toBe(false);
  });

  it("a pessoa espera o pedido feito num turno dela, fora de task; não o de task, rotina ou colega (ADR-085)", () => {
    expect(pessoaEsperaOPedido({ origem: "conversa", trabalhoId: null })).toBe(true);
    expect(pessoaEsperaOPedido({ origem: "sala", trabalhoId: null })).toBe(true);
    expect(pessoaEsperaOPedido({ origem: "conversa", trabalhoId: "w" })).toBe(false);
    expect(pessoaEsperaOPedido({ origem: "rotina", trabalhoId: null })).toBe(false);
    expect(pessoaEsperaOPedido({ origem: "delegacao", trabalhoId: null })).toBe(false);
    expect(pessoaEsperaOPedido(null)).toBe(false);
  });

  describe("espera circular", () => {
    it("direta: B já pediu a A, e A pede a B → [B, A]", () => {
      expect(cicloDoPedido([{ de: "B", para: "A" }], "A", "B")).toEqual(["B", "A"]);
    });
    it("em qualquer profundidade: B pediu a C, C pediu a A → [B, C, A]", () => {
      expect(cicloDoPedido([{ de: "B", para: "C" }, { de: "C", para: "A" }, { de: "X", para: "B" }], "A", "B")).toEqual(["B", "C", "A"]);
    });
    it("sem caminho de volta não há ciclo: A já pediu a B (mesmo sentido) e pede de novo", () => {
      expect(cicloDoPedido([{ de: "A", para: "B" }], "A", "B")).toBeNull();
      expect(cicloDoPedido([{ de: "B", para: "C" }, { de: "C", para: "D" }], "A", "B")).toBeNull();
      expect(cicloDoPedido([], "A", "B")).toBeNull();
    });
    it("um ciclo antigo entre outros bots não trava o pedido (busca só a partir do alvo) e não entra em laço", () => {
      expect(cicloDoPedido([{ de: "C", para: "D" }, { de: "D", para: "C" }, { de: "B", para: "C" }], "A", "B")).toBeNull();
    });
    it("a instrução nomeia a corrente e diz o que fazer em vez de pedir", () => {
      expect(instrucaoEsperaCircular(["Dev 1", "Chico"])).toBe("Espera circular: Dev 1 pediu algo a você e ainda espera a sua resposta. Se você pedir a Dev 1 agora, um fica esperando o outro. Não peça: termine o que der com o que você já tem e, na sua resposta, diga o que falta e o que precisa de Dev 1 — a pergunta vai junto com a resposta.");
      expect(instrucaoEsperaCircular(["Dev 1", "Dev 2", "Chico"])).toContain("Dev 1 pediu algo a Dev 2, que pediu a você");
    });
  });

  it("a resposta imediata: entrou na triagem; com colegas livres, sugere", () => {
    expect(instrucaoPedidoRecebido("Dev 1", [])).toContain("Pedido entregue a Dev 1: entrou na triagem dele");
    expect(instrucaoPedidoRecebido("Dev 1", [])).not.toContain("Livres agora");
    expect(instrucaoPedidoRecebido("Dev 1", ["Dev 2", "Dev 3"])).toContain("Livres agora: Dev 2 e Dev 3 — se for urgente e Dev 1 estiver ocupado, um deles pode ajudar.");
  });

  describe("catálogo e prompt da triagem", () => {
    it("a triagem de colega (delegação sem trabalho) tem abrir_frentes e mandar_para_frente; a task de colega de antes não", () => {
      expect(nomes(montarPlano(base))).toEqual(expect.arrayContaining(["abrir_frentes", "mandar_para_frente", "me_chame_as"]));
      const antiga = nomes(montarPlano({ ...base, trabalho: { titulo: "PR 42", origem: "colega", trabalhoMaeId: null, forma: "task" } }));
      for (const fora of ["abrir_frentes", "mandar_para_frente"]) expect(antiga).not.toContain(fora);
      const frente = nomes(montarPlano({ ...base, trabalho: { titulo: "PR 42", origem: "colega", trabalhoMaeId: null, forma: "frente" } }));
      expect(frente).toContain("devolver_resumo");
      for (const fora of ["abrir_frentes", "mandar_para_frente", "me_chame_as", "criar_rotina"]) expect(frente).not.toContain(fora);
    });

    it("a triagem da rotina (sem trabalho) tem as duas; a rotina-mãe de antes só abre", () => {
      const rotina = { ...base, modo: "rotina" as const, turno: { ...turno, origem: "rotina" as const, profundidade: 0 as const }, profundidade: 0 as const, delegacao: null };
      expect(nomes(montarPlano(rotina))).toEqual(expect.arrayContaining(["abrir_frentes", "mandar_para_frente", "sem_novidade"]));
      const mae = nomes(montarPlano({ ...rotina, trabalho: { titulo: "Triagem", origem: "rotina", trabalhoMaeId: null, forma: "task" } }));
      expect(mae).toContain("abrir_frentes");
      expect(mae).not.toContain("mandar_para_frente");
      expect(prompt(rotina)).toContain(linhaDaTriagem("rotina", null));
      expect(prompt({ ...rotina, trabalho: { titulo: "Triagem", origem: "rotina", trabalhoMaeId: null, forma: "task" } })).not.toContain("Triagem: ");
    });

    it("o prompt da triagem de colega diz que o turno é curto, os quatro caminhos e para quem vai o resultado; no lugar da linha do dono", () => {
      const p = prompt(base);
      expect(p).toContain(linhaDaTriagem("delegacao", "Chico"));
      expect(p).toContain("o resultado delas vai direto a Chico");
      expect(p).not.toContain("Frentes: trabalho que leva mais que alguns minutos");
      // Na conversa com a pessoa, a linha do dono continua a de antes.
      const conversa = prompt({ ...base, modo: "conversa", turno: { ...turno, origem: "conversa", profundidade: 0 }, profundidade: 0, delegacao: null });
      expect(conversa).toContain("Frentes: trabalho que leva mais que alguns minutos");
      expect(conversa).not.toContain("Triagem: ");
    });

    it("a linha da triagem pertence à seção de ferramentas do Raio-X", () => {
      expect(secaoDaLinha(linhaDaTriagem("delegacao", "Chico"))).toBe("ferramentas");
      expect(secaoDaLinha(linhaDaTriagem("rotina", null))).toBe("ferramentas");
    });
  });
});
