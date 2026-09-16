import type { EventoStream } from "../../src/contracts/turno.ts";

/**
 * Roteiro do catcher (Leapy §11): marcadores no PROMPT viram a sequência de eventos que o driver
 * falso/catcher emite, sem CLI e sem custo. Módulo puro (sem vitest): o driver catcher da L4 pode
 * importar por caminho. Um marcador por linha, qualquer lugar do prompt:
 *
 *   [[delta: texto]]              → um evento 'delta' com o texto
 *   [[tool: nome {"a":1}]]        → tool_use 'nome' com input JSON (default {}), seguido do
 *                                    tool_result que o servidor devolver (o driver preenche)
 *   [[texto: resposta final]]     → o texto do result
 *   [[custo: 0.0207631]]          → custo do result (default 0)
 *   [[falha: erro_max_turns]]     → result com subtype ≠ success
 *
 * Sem marcador, `roteiroPadrao` responde "catcher: recebi N caracteres; ferramentas: […]".
 */
export type PassoRoteiro =
  | { tipo: "delta"; texto: string }
  | { tipo: "tool_use"; nome: string; input: Record<string, unknown> }
  | { tipo: "texto"; texto: string }
  | { tipo: "custo"; custoUsd: number }
  | { tipo: "falha"; subtype: string };

export type Roteiro = { passos: PassoRoteiro[] };

const ABERTURA = /^\[\[(delta|tool|texto|custo|falha):/;

/**
 * Marcadores com `[[`/`]]` BALANCEADOS (definido em 2026-09-16, L9): um marcador pode carregar outro
 * dentro do próprio JSON — `[[tool: encaminhar {"motivo":"… [[tool: passar {…}]] …"}]]` — para o texto
 * que vira o PROMPT do próximo turno (handoff, pergunta a outro bot) levar o roteiro daquele turno.
 * Sem isto o primeiro `]]` interno fechava o marcador externo e o JSON chegava truncado (args_invalidos).
 */
function* marcadores(prompt: string): Generator<{ tipo: string; corpo: string }> {
  let i = 0;
  while (i < prompt.length) {
    const inicio = prompt.indexOf("[[", i);
    if (inicio === -1) return;
    const m = ABERTURA.exec(prompt.slice(inicio));
    if (!m) {
      i = inicio + 2;
      continue;
    }
    let profundidade = 1;
    let j = inicio + 2;
    while (j < prompt.length && profundidade > 0) {
      if (prompt.startsWith("[[", j)) {
        profundidade += 1;
        j += 2;
      } else if (prompt.startsWith("]]", j)) {
        profundidade -= 1;
        j += 2;
      } else j += 1;
    }
    if (profundidade !== 0) return;
    yield { tipo: m[1] ?? "", corpo: prompt.slice(inicio + m[0].length, j - 2) };
    i = j;
  }
}

export function interpretarRoteiro(prompt: string): Roteiro {
  const passos: PassoRoteiro[] = [];
  for (const m of marcadores(prompt)) {
    const tipo = m.tipo;
    const corpo = m.corpo.trim();
    if (tipo === "delta") passos.push({ tipo: "delta", texto: corpo });
    else if (tipo === "texto") passos.push({ tipo: "texto", texto: corpo });
    else if (tipo === "custo") passos.push({ tipo: "custo", custoUsd: Number(corpo) || 0 });
    else if (tipo === "falha") passos.push({ tipo: "falha", subtype: corpo || "error_during_execution" });
    else if (tipo === "tool") {
      const espaco = corpo.search(/\s/);
      const nome = espaco === -1 ? corpo : corpo.slice(0, espaco);
      let input: Record<string, unknown> = {};
      if (espaco !== -1) {
        try {
          const lido: unknown = JSON.parse(corpo.slice(espaco).trim());
          if (typeof lido === "object" && lido !== null && !Array.isArray(lido)) input = lido as Record<string, unknown>;
        } catch {
          input = {};
        }
      }
      passos.push({ tipo: "tool_use", nome, input });
    }
  }
  return { passos };
}

/** Roteiro default do catcher: um delta descritivo + result custo 0 (definido em 2026-09-16). */
export function roteiroPadrao(entrada: { prompt: string; ferramentas: readonly string[] }): Roteiro {
  const lidos = interpretarRoteiro(entrada.prompt);
  if (lidos.passos.length > 0) return lidos;
  const texto = `catcher: recebi ${entrada.prompt.length} caracteres; ferramentas: [${[...entrada.ferramentas].sort().join(", ")}]`;
  return { passos: [{ tipo: "delta", texto }, { tipo: "texto", texto }] };
}

/**
 * Converte o roteiro na sequência de EventoStream que um `claude -p` real emitiria (init → deltas/
 * tool_use → result), para o driver falso alimentar `sinks.evento` e `classificarResultado`.
 * O tool_result de cada tool_use vem de `responder` (o servidor de verdade ou um stub do teste).
 */
export function eventosDoRoteiro(
  roteiro: Roteiro,
  ctx: { sessaoCli: string; ferramentas: readonly string[]; modelo: string; responder?: (nome: string, input: Record<string, unknown>) => string },
): EventoStream[] {
  const eventos: EventoStream[] = [
    { tipo: "init", sessaoCli: ctx.sessaoCli, ferramentas: [...ctx.ferramentas], modelo: ctx.modelo, versaoCli: "catcher", apiKeySource: "none" },
  ];
  let texto = "";
  let custoUsd = 0;
  let falha: string | null = null;
  let numTurnos = 1;
  for (const p of roteiro.passos) {
    if (p.tipo === "delta") eventos.push({ tipo: "delta", texto: p.texto });
    else if (p.tipo === "texto") texto = p.texto;
    else if (p.tipo === "custo") custoUsd = p.custoUsd;
    else if (p.tipo === "falha") falha = p.subtype;
    else if (p.tipo === "tool_use") {
      const id = `toolu_catcher_${eventos.length}`;
      eventos.push({ tipo: "tool_use", id, nome: p.nome, input: p.input });
      const resposta = ctx.responder ? ctx.responder(p.nome, p.input) : `catcher: ${p.nome} não executada`;
      eventos.push({ tipo: "tool_result", toolUseId: id, isError: false, texto: resposta });
      numTurnos += 1;
    }
  }
  eventos.push({
    tipo: "result",
    sucesso: falha === null,
    subtype: falha ?? "success",
    sessaoCli: ctx.sessaoCli,
    texto,
    custoUsd,
    tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 },
    numTurnos,
    negacoesPermissao: [], erroCru: null,
  });
  return eventos;
}
