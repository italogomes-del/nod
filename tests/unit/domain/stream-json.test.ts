import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EventoStream } from "../../../src/contracts/turno.ts";
import { classificarResultado, interpretarLinhaStreamJson, reduzirSinais, SINAIS_ZERADOS } from "../../../src/domain/stream-json.ts";

const FIXTURES = new URL("../../fixtures/stream-json/", import.meta.url);
function eventosDe(nome: string): EventoStream[] {
  const texto = readFileSync(new URL(nome, FIXTURES), "utf8");
  return texto.split("\n").map(interpretarLinhaStreamJson);
}

/** stderr real de s2c (sonda 2026-09-16); stdout vazio, exit 1. */
const STDERR_S2C = "Error: Session ID b086c652-7e33-44f6-8d2e-b7643f69274c is already in use.\n";

describe("interpretarLinhaStreamJson", () => {
  it("init, delta, tool_use, tool_result, result e rate_limit saem do s3 real; o resto é ignorado sem falhar", () => {
    const evs = eventosDe("s3-mcp-ok.jsonl");
    const init = evs.find((e) => e.tipo === "init");
    expect(init).toMatchObject({ tipo: "init", sessaoCli: "ff68ffc2-f8ba-44ed-9f8a-483e3c4b3684", ferramentas: ["mcp__nod__somar"], versaoCli: "2.1.272", apiKeySource: "none" });
    expect(evs.find((e) => e.tipo === "tool_use")).toMatchObject({ nome: "mcp__nod__somar", input: { a: 17, b: 25 } });
    expect(evs.find((e) => e.tipo === "tool_result")).toMatchObject({ isError: false, texto: "RESULTADO_SOMA=42" });
    expect(evs.find((e) => e.tipo === "rate_limit")).toMatchObject({ status: "allowed", utilizacaoCincoHoras: 0.1 });
    const deltas = evs.filter((e) => e.tipo === "delta").map((e) => (e.tipo === "delta" ? e.texto : "")).join("");
    expect(deltas.startsWith("SONDA_OK")).toBe(true);
    const ignorados = evs.filter((e) => e.tipo === "ignorado");
    expect(ignorados.length).toBeGreaterThan(0);
    expect(ignorados.every((e) => e.tipo === "ignorado" && (e.razao === "tipo_desconhecido" || e.razao === "linha_vazia"))).toBe(true);
  });

  it("linha vazia e JSON inválido viram ignorado, nunca exceção", () => {
    expect(interpretarLinhaStreamJson("")).toEqual({ tipo: "ignorado", razao: "linha_vazia", tipoBruto: null });
    expect(interpretarLinhaStreamJson("{nope")).toEqual({ tipo: "ignorado", razao: "json_invalido", tipoBruto: null });
    expect(interpretarLinhaStreamJson('{"type":"system","subtype":"status"}')).toMatchObject({ tipo: "ignorado", razao: "tipo_desconhecido", tipoBruto: "system/status" });
  });

  it("reduzirSinais: init → promptSubmitted; saída → producedOutput; ignorado não muda nada", () => {
    let s = SINAIS_ZERADOS;
    s = reduzirSinais(s, { tipo: "ignorado", razao: "linha_vazia", tipoBruto: null });
    expect(s).toEqual(SINAIS_ZERADOS);
    s = reduzirSinais(s, { tipo: "init", sessaoCli: "x", ferramentas: [], modelo: "m", versaoCli: "v", apiKeySource: "none" });
    expect(s).toMatchObject({ attempted: true, promptSubmitted: true, producedOutput: false });
    s = reduzirSinais(s, { tipo: "delta", texto: "a" });
    expect(s.producedOutput).toBe(true);
  });
});

describe("classificarResultado (ADR-009: estado de protocolo, nunca string de erro)", () => {
  it("s3 → sucesso, sinais true, custo 0.0207631, sessão do init, ferramenta chamada, sem negação", () => {
    const r = classificarResultado({ eventos: eventosDe("s3-mcp-ok.jsonl"), exitCode: 0, signal: null, stderr: "" });
    expect(r.desfecho).toBe("sucesso");
    expect(r.sinais).toEqual({ attempted: true, rejected: false, promptSubmitted: true, producedOutput: true });
    expect(r.custoUsd).toBe(0.0207631);
    expect(r.sessaoCli).toBe("ff68ffc2-f8ba-44ed-9f8a-483e3c4b3684");
    expect(r.ferramentasChamadas).toEqual(["mcp__nod__somar"]);
    expect(r.negacoesPermissao).toEqual([]);
    expect(r.tokens).toEqual({ entrada: 18, saida: 712, cacheLeitura: 7341, cacheCriacao: 7716 });
    expect(r.texto.startsWith("SONDA_OK")).toBe(true);
  });

  it("s4b → negacoesPermissao=['mcp__nod__somar'] com desfecho sucesso (negação NÃO é erro no CLI)", () => {
    const r = classificarResultado({ eventos: eventosDe("s4b-negado.jsonl"), exitCode: 0, signal: null, stderr: "" });
    expect(r.desfecho).toBe("sucesso");
    expect(r.negacoesPermissao).toEqual(["mcp__nod__somar"]);
    expect(r.ferramentasChamadas).toEqual(["mcp__nod__somar"]);
  });

  it("s6 → interrompido sem result (SIGTERM, exit 143); motivo fica para o servidor decidir", () => {
    const evs = eventosDe("s6-sigterm.jsonl");
    expect(evs.some((e) => e.tipo === "result")).toBe(false);
    const r = classificarResultado({ eventos: evs, exitCode: 143, signal: null, stderr: "" });
    expect(r.desfecho).toBe("interrompido");
    expect(r.motivoInterrupcao).toBeUndefined();
    expect(r.sinais).toMatchObject({ attempted: true, promptSubmitted: true, producedOutput: true, rejected: false });
    expect(r.sessaoCli).toBe("ed815b86-9773-4d0a-8081-72f1aed09d19");
    expect(r.texto.length).toBeGreaterThan(0);
    expect(r.custoUsd).toBeNull();
  });

  it("s2c → sessao_rejeitada: stdout vazio, exit 1, sem init (rejected=true)", () => {
    const r = classificarResultado({ eventos: eventosDe("s2c-session-in-use.jsonl"), exitCode: 1, signal: null, stderr: STDERR_S2C });
    expect(r.desfecho).toBe("interrompido");
    expect(r.motivoInterrupcao).toBe("sessao_rejeitada");
    expect(r.sinais).toEqual({ attempted: true, rejected: true, promptSubmitted: false, producedOutput: false });
  });

  it("SIGTERM ANTES do init (driver chamou interromper(); exit 143, signal null) → interrompido com motivo indefinido, NÃO sessao_rejeitada", () => {
    const r = classificarResultado({ eventos: [], exitCode: 143, signal: null, stderr: "", interrompidoPeloDriver: true });
    expect(r.desfecho).toBe("interrompido");
    expect(r.motivoInterrupcao).toBeUndefined();
    expect(r.sinais).toEqual({ attempted: true, rejected: false, promptSubmitted: false, producedOutput: false });
    // signal presente (SIGKILL após os 5s) segue a mesma regra, com ou sem init
    expect(classificarResultado({ eventos: [], exitCode: null, signal: "SIGKILL", stderr: "" }).motivoInterrupcao).toBeUndefined();
    expect(classificarResultado({ eventos: eventosDe("s6-sigterm.jsonl"), exitCode: null, signal: "SIGKILL", stderr: "" }).motivoInterrupcao).toBeUndefined();
  });

  it("sem init, exit 0 e sem signal (CLI saiu limpo sem dizer nada) → sem_progresso", () => {
    expect(classificarResultado({ eventos: [], exitCode: 0, signal: null, stderr: "" })).toMatchObject({ desfecho: "interrompido", motivoInterrupcao: "sem_progresso" });
  });

  it("spawn que não aconteceu (exitCode null, sem signal, sem eventos) → lancamento_falhou", () => {
    const r = classificarResultado({ eventos: [], exitCode: null, signal: null, stderr: "spawn ENOENT" });
    expect(r.motivoInterrupcao).toBe("lancamento_falhou");
    expect(r.sinais.attempted).toBe(false);
  });

  it("adversarial (E9.1): variar stderr não muda o resultado em nenhum cenário", () => {
    const cenarios: { nome: string; exitCode: number | null }[] = [
      { nome: "s3-mcp-ok.jsonl", exitCode: 0 },
      { nome: "s4b-negado.jsonl", exitCode: 0 },
      { nome: "s6-sigterm.jsonl", exitCode: 143 },
      { nome: "s2c-session-in-use.jsonl", exitCode: 1 },
    ];
    for (const c of cenarios) {
      const evs = eventosDe(c.nome);
      const a = classificarResultado({ eventos: evs, exitCode: c.exitCode, signal: null, stderr: "" });
      const b = classificarResultado({ eventos: evs, exitCode: c.exitCode, signal: null, stderr: STDERR_S2C });
      const d = classificarResultado({ eventos: evs, exitCode: c.exitCode, signal: null, stderr: "Error: max turns\nis_error true success" });
      expect(b).toEqual(a);
      expect(d).toEqual(a);
    }
  });

  it("result com subtype error_max_turns → falha erro_max_turns; outro erro → erro_execucao", () => {
    const init: EventoStream = { tipo: "init", sessaoCli: "s", ferramentas: [], modelo: "m", versaoCli: "v", apiKeySource: "none" };
    const res = (subtype: string): EventoStream => ({ tipo: "result", sucesso: false, subtype, sessaoCli: "s", texto: "", custoUsd: 0.01, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, numTurnos: 1, negacoesPermissao: [], erroCru: null });
    expect(classificarResultado({ eventos: [init, res("error_max_turns")], exitCode: 0, signal: null, stderr: "" })).toMatchObject({ desfecho: "falha", motivoFalha: "erro_max_turns" });
    expect(classificarResultado({ eventos: [init, res("error_during_execution")], exitCode: 1, signal: null, stderr: "" })).toMatchObject({ desfecho: "falha", motivoFalha: "erro_execucao" });
  });
});
