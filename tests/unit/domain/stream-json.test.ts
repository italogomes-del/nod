import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { EventoStream } from "../../../src/contracts/turno.ts";
import { interpretarCodex } from "../../../src/domain/codex-stream.ts";
import { classificarResultado, comporFala, interpretarLinhaStreamJson, NARRACAO_MAX_CHARS, reduzirSinais, SINAIS_ZERADOS } from "../../../src/domain/stream-json.ts";

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

/**
 * definido em 2026-09-28: o `result` do CLI traz só a última mensagem. Relatório escrito antes de uma
 * ferramenta (lembrar → "Anotado.") sumia da fala da pessoa e da resposta ao colega.
 */
describe("fala inteira: relatório antes da última ferramenta + texto final", () => {
  const init: EventoStream = { tipo: "init", sessaoCli: "s", ferramentas: [], modelo: "m", versaoCli: "v", apiKeySource: "none" };
  const ok = (texto: string): EventoStream => ({ tipo: "result", sucesso: true, subtype: "success", sessaoCli: "s", texto, custoUsd: 0.01, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, numTurnos: 2, negacoesPermissao: [], erroCru: null });
  const ferramenta = (id: string): EventoStream[] => [
    { tipo: "tool_use", id, nome: "mcp__nod__lembrar", input: {} },
    { tipo: "tool_result", toolUseId: id, isError: false, texto: "ok" },
  ];
  /** Deltas e depois o bloco completo, como o CLI emite. */
  const bloco = (texto: string): EventoStream[] => [{ tipo: "delta", texto }, { tipo: "texto_bloco", texto }];
  const relatorio = `Relatório das tasks: ${"NOD-101 aberto há 3 dias, sem revisão; ".repeat(10)}fim.`;
  const texto = (eventos: EventoStream[]) => classificarResultado({ eventos, exitCode: 0, signal: null, stderr: "" }).texto;

  it("o parser devolve texto_bloco para o bloco de texto completo e continua devolvendo tool_use", () => {
    const evs = eventosDe("relatorio-lembrar.jsonl");
    const blocos = evs.filter((e) => e.tipo === "texto_bloco");
    expect(blocos).toHaveLength(2);
    expect(blocos[0]).toMatchObject({ texto: expect.stringMatching(/^Relatório das tasks da semana:/) });
    expect(blocos[1]).toEqual({ tipo: "texto_bloco", texto: "Anotado." });
    expect(evs.find((e) => e.tipo === "tool_use")).toMatchObject({ nome: "mcp__nod__lembrar", input: { texto: "Marlon quer o relatório de tasks às segundas" } });
    // bloco só de thinking continua ignorado (s3)
    expect(eventosDe("s3-mcp-ok.jsonl").filter((e) => e.tipo === "texto_bloco")).toHaveLength(1);
  });

  it("fixture real de formato: relatório > 280 → lembrar → 'Anotado.' vira relatório + linha em branco + 'Anotado.'", () => {
    const r = classificarResultado({ eventos: eventosDe("relatorio-lembrar.jsonl"), exitCode: 0, signal: null, stderr: "" });
    expect(r.desfecho).toBe("sucesso");
    expect(r.ferramentasChamadas).toEqual(["mcp__nod__lembrar"]);
    expect(r.texto.startsWith("Relatório das tasks da semana:\n\n- NOD-101")).toBe(true);
    expect(r.texto.endsWith("destravar a revisão do NOD-101 hoje.\n\nAnotado.")).toBe(true);
  });

  it("narração curta (≤ 280) antes das ferramentas fica só no cartão de atividade", () => {
    const narracao = "Buscando tasks no Linear…";
    expect(texto([init, ...bloco(narracao), ...ferramenta("u1"), ...bloco("Achei 3 tasks."), ok("Achei 3 tasks.")])).toBe("Achei 3 tasks.");
    // o limite é estrito: exatamente NARRACAO_MAX_CHARS ainda é narração
    const noLimite = "a".repeat(NARRACAO_MAX_CHARS);
    expect(texto([init, ...bloco(noLimite), ...ferramenta("u1"), ok("Pronto.")])).toBe("Pronto.");
    expect(texto([init, ...bloco(`${noLimite}b`), ...ferramenta("u1"), ok("Pronto.")])).toBe(`${noLimite}b\n\nPronto.`);
  });

  it("vários passos: só o relatório entra, na ordem, e o texto final fecha a fala", () => {
    const evs = [init, ...bloco("Buscando tasks…"), ...ferramenta("u1"), ...bloco(relatorio), ...ferramenta("u2"), ...bloco("Salvando na memória."), ...ferramenta("u3"), ...bloco("Anotado."), ok("Anotado.")];
    expect(texto(evs)).toBe(`${relatorio}\n\nAnotado.`);
  });

  it("sem duplicar: o final que repete o relatório (mesmo com espaços diferentes) sai uma vez só", () => {
    const final = `Pronto, aqui vai de novo:\n\n${relatorio.replaceAll("; ", ";\n")}`;
    expect(texto([init, ...bloco(relatorio), ...ferramenta("u1"), ...bloco(final), ok(final)])).toBe(final);
    // o mesmo relatório escrito duas vezes antes das ferramentas também entra uma vez
    expect(texto([init, ...bloco(relatorio), ...ferramenta("u1"), ...bloco(relatorio), ...ferramenta("u2"), ok("Anotado.")])).toBe(`${relatorio}\n\nAnotado.`);
  });

  it("sem ferramenta, ou com o relatório depois da última ferramenta, a fala é o result intacto (s3)", () => {
    expect(texto([init, ...bloco(relatorio), ok(relatorio)])).toBe(relatorio);
    expect(texto([init, ...bloco("Buscando…"), ...ferramenta("u1"), ...bloco(relatorio), ok(relatorio)])).toBe(relatorio);
  });

  it("result sem texto: o final são os blocos depois da última ferramenta; sem eles, todos os blocos separados", () => {
    expect(texto([init, ...bloco(relatorio), ...ferramenta("u1"), ...bloco("Anotado."), ok("")])).toBe(`${relatorio}\n\nAnotado.`);
    expect(texto([init, ...bloco("Buscando…"), ...ferramenta("u1"), ...bloco("Achei."), ...ferramenta("u2"), ok("")])).toBe("Buscando…\n\nAchei.");
    // sem blocos (catcher), os deltas colados, como antes
    expect(texto([init, { tipo: "delta", texto: "oi " }, { tipo: "delta", texto: "tudo bem" }, ok("")])).toBe("oi tudo bem");
  });

  it("turno interrompido (sem result): todos os blocos separados + o trecho que não fechou bloco", () => {
    const evs: EventoStream[] = [init, ...bloco("Buscando tasks…"), ...ferramenta("u1"), ...bloco(relatorio), ...ferramenta("u2"), { tipo: "delta", texto: "Agora vou " }, { tipo: "delta", texto: "salvar" }];
    const r = classificarResultado({ eventos: evs, exitCode: 143, signal: null, stderr: "", interrompidoPeloDriver: true });
    expect(r.desfecho).toBe("interrompido");
    expect(r.texto).toBe(`Buscando tasks…\n\n${relatorio}\n\nAgora vou salvar`);
    // sem blocos, os deltas colados continuam sendo o texto (s6)
    const s6 = classificarResultado({ eventos: eventosDe("s6-sigterm.jsonl"), exitCode: 143, signal: null, stderr: "" });
    const deltas = eventosDe("s6-sigterm.jsonl").map((e) => (e.tipo === "delta" ? e.texto : "")).join("");
    expect(s6.texto).toBe(deltas);
  });

  it("Codex: cada agent_message vira delta (ao vivo) e texto_bloco; a última é o final e as anteriores só se forem relatório", () => {
    const linha = (v: unknown) => interpretarCodex(JSON.stringify(v));
    const msg = (text: string) => linha({ type: "item.completed", item: { type: "agent_message", text } });
    const tool = (id: string) => [...linha({ type: "item.started", item: { id, type: "mcp_tool_call", server: "nod", tool: "lembrar", arguments: {} } }), ...linha({ type: "item.completed", item: { id, type: "mcp_tool_call", status: "completed" } })];
    expect(msg("Olá.")).toEqual([{ tipo: "delta", texto: "Olá." }, { tipo: "texto_bloco", texto: "Olá." }]);
    const fim = linha({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } });
    const evs = [...linha({ type: "thread.started" }), ...msg("Vou consultar."), ...tool("t1"), ...msg(relatorio), ...tool("t2"), ...msg("Anotado."), ...fim];
    const r = classificarResultado({ eventos: evs, exitCode: 0, signal: null, stderr: "" });
    expect(r.desfecho).toBe("sucesso");
    expect(r.texto).toBe(`${relatorio}\n\nAnotado.`);
  });

  it("comporFala sem relatório devolve o final intacto, inclusive vazio", () => {
    expect(comporFala([], "  pronto  ")).toBe("  pronto  ");
    expect(comporFala(["curto"], "")).toBe("");
    expect(comporFala([relatorio], "")).toBe(relatorio);
  });
});
