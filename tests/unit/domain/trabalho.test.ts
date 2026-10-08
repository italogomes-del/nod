import { describe, expect, it } from "vitest";
import { CAPACIDADES_HARNESS, SEM_CAPACIDADES } from "../../../src/contracts/harness.ts";
import { estadoDoTrabalho, pastaDoTrabalho, pastaRelativa, podeAbrirTask, podeMandarParaTask, promoveNaRede, REDE_MS, slugDoTrabalho, tituloDoTrabalho, type FatosTrabalho } from "../../../src/domain/trabalho.ts";

const base: FatosTrabalho = { estadoAtual: "na_fila", iniciado: false, parando: 0, despachando: 0, pendentes: 0, decisaoPendente: false, ultimo: null };

describe("estadoDoTrabalho (a tabela de estados da #192)", () => {
  it.each([
    ["criado, sem turno despachado", {}, "na_fila"],
    ["turno na fila antes de começar (ou esperando o depois_de)", { pendentes: 1 }, "na_fila"],
    ["turno rodando", { despachando: 1 }, "rodando"],
    ["turno rodando parado numa aprovação dentro do turno", { despachando: 1, decisaoPendente: true }, "precisa_de_voce"],
    ["retomada na fila de um trabalho que já começou", { iniciado: true, pendentes: 1 }, "rodando"],
    ["nada vivo e pergunta aberta", { iniciado: true, decisaoPendente: true, ultimo: { estado: "concluido", motivo: null } }, "precisa_de_voce"],
    ["fechado por memória continua fechado enquanto espera a pessoa", { estadoAtual: "fechado_ocioso", iniciado: true, decisaoPendente: true }, "fechado_ocioso"],
    ["entregou", { iniciado: true, ultimo: { estado: "concluido", motivo: null } }, "terminado"],
    ["a pessoa parou", { iniciado: true, ultimo: { estado: "interrompido", motivo: "parado_pela_pessoa" } }, "parado"],
    ["o Parar foi pedido e o processo ainda acaba", { iniciado: true, parando: 1 }, "parado"],
    ["a máquina sumiu sem retomada", { iniciado: true, ultimo: { estado: "interrompido", motivo: "maquina_sem_contato" } }, "falhou"],
    ["parado sem turno nenhum continua parado", { estadoAtual: "parado" }, "parado"],
  ] as const)("%s → %s", (_nome, fatos, esperado) => {
    expect(estadoDoTrabalho({ ...base, ...fatos })).toBe(esperado);
  });
});

describe("título, slug e pasta", () => {
  it("título: a primeira linha não vazia, espaços juntos, até 80 caracteres", () => {
    expect(tituloDoTrabalho("\n  Montar   o dashboard de churn \nresto")).toBe("Montar o dashboard de churn");
    expect(tituloDoTrabalho("x".repeat(100))).toHaveLength(80);
    expect(tituloDoTrabalho("   ")).toBe("Trabalho");
  });
  it("slug sem acento nem símbolo, com o começo do id: o mesmo título nunca dá a mesma pasta", () => {
    expect(slugDoTrabalho("Revisão do PR #481!", "ABCDEF12-0000")).toBe("revisao-do-pr-481-abcdef");
    expect(pastaDoTrabalho("Ada", "Login", "111111aa")).not.toBe(pastaDoTrabalho("Ada", "Login", "222222bb"));
    expect(slugDoTrabalho("!!!", "c0ffee99")).toBe("task-c0ffee");
    expect(pastaRelativa("~/nod/Ada/login-111111")).toBe("Ada/login-111111");
    expect(pastaRelativa("/tmp/x")).toBeNull();
  });
});

describe("quem abre e quem repassa (#193)", () => {
  it("a conversa e a task de rotina sem mãe abrem; a filha da rotina, a da pessoa, a de colega e a da rede não", () => {
    expect(podeAbrirTask(null)).toBe(true);
    expect(podeAbrirTask({ origem: "rotina", trabalhoMaeId: null })).toBe(true);
    expect(podeAbrirTask({ origem: "rotina", trabalhoMaeId: "mae" })).toBe(false);
    for (const origem of ["pessoa", "colega", "rede"] as const) expect(podeAbrirTask({ origem, trabalhoMaeId: null })).toBe(false);
    expect(podeMandarParaTask(null)).toBe(true);
    expect(podeMandarParaTask({ origem: "rotina" })).toBe(false);
  });
});

describe("promoveNaRede (rede de 2 min)", () => {
  const ok = { origem: "conversa" as const, trabalhoId: null, estado: "despachando" as const, despachadoHaMs: REDE_MS, fezFerramenta: true, capacidades: CAPACIDADES_HARNESS["claude-cli"] };
  it("promove só a conversa rodando há 2 min, com ferramenta e harness que bifurca", () => {
    expect(promoveNaRede(ok)).toBe(true);
    expect(promoveNaRede({ ...ok, despachadoHaMs: REDE_MS - 1 })).toBe(false);
    expect(promoveNaRede({ ...ok, fezFerramenta: false })).toBe(false);
    expect(promoveNaRede({ ...ok, trabalhoId: "w" })).toBe(false);
    for (const origem of ["sala", "rotina", "delegacao", "retomada", "ligacao"] as const) expect(promoveNaRede({ ...ok, origem })).toBe(false);
  });
  it("sem a capacidade bifurcaSessao (Codex, harness desconhecido) nunca promove", () => {
    expect(promoveNaRede({ ...ok, capacidades: CAPACIDADES_HARNESS["codex-cli"] })).toBe(false);
    expect(promoveNaRede({ ...ok, capacidades: SEM_CAPACIDADES })).toBe(false);
  });
});
