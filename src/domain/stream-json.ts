import type { EventoStream, ResultadoTurno, SinaisTurno, TokensTurno } from "../contracts/turno.ts";

/**
 * Parser PURO do `claude -p --output-format stream-json --verbose --include-partial-messages`
 * (contrato empírico de 2026-09-16, mapa-cli + fixtures reais em tests/fixtures/stream-json).
 * Tipos/subtipos desconhecidos (system/status, system/thinking_tokens, signature_delta…) viram
 * 'ignorado' em vez de derrubar o turno. Nenhuma decisão lê texto de erro (ADR-009 / E9.1).
 */
type Obj = Record<string, unknown>;

function obj(v: unknown): Obj | null {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : null;
}
function str(v: unknown, padrao = ""): string {
  return typeof v === "string" ? v : padrao;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function tokensDe(usage: Obj | null): TokensTurno {
  return {
    entrada: num(usage?.["input_tokens"]) ?? 0,
    saida: num(usage?.["output_tokens"]) ?? 0,
    cacheLeitura: num(usage?.["cache_read_input_tokens"]) ?? 0,
    cacheCriacao: num(usage?.["cache_creation_input_tokens"]) ?? 0,
  };
}

function textoDoConteudo(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((c) => {
      const o = obj(c);
      return o && o["type"] === "text" ? str(o["text"]) : "";
    })
    .join("");
}

export function interpretarLinhaStreamJson(linha: string): EventoStream {
  const bruta = linha.trim();
  if (bruta === "") return { tipo: "ignorado", razao: "linha_vazia", tipoBruto: null };
  let json: unknown;
  try {
    json = JSON.parse(bruta);
  } catch {
    return { tipo: "ignorado", razao: "json_invalido", tipoBruto: null };
  }
  const o = obj(json);
  if (!o) return { tipo: "ignorado", razao: "json_invalido", tipoBruto: null };
  const type = str(o["type"]);
  const subtype = str(o["subtype"]);
  const tipoBruto = subtype ? `${type}/${subtype}` : type;

  if (type === "system" && subtype === "init") {
    const tools = Array.isArray(o["tools"]) ? o["tools"].filter((t): t is string => typeof t === "string") : [];
    return {
      tipo: "init",
      sessaoCli: str(o["session_id"]),
      ferramentas: tools,
      modelo: str(o["model"]),
      versaoCli: str(o["claude_code_version"]),
      apiKeySource: str(o["apiKeySource"], "desconhecido"),
    };
  }
  if (type === "rate_limit_event") {
    const info = obj(o["rate_limit_info"]);
    const janelas = obj(info?.["unifiedWindows"]);
    return {
      tipo: "rate_limit",
      status: str(info?.["status"], "desconhecido"),
      utilizacaoCincoHoras: num(obj(janelas?.["five_hour"])?.["utilization"]),
      utilizacaoSeteDias: num(obj(janelas?.["seven_day"])?.["utilization"]),
    };
  }
  if (type === "stream_event") {
    const ev = obj(o["event"]);
    if (ev?.["type"] === "content_block_delta") {
      const delta = obj(ev["delta"]);
      if (delta?.["type"] === "text_delta") return { tipo: "delta", texto: str(delta["text"]) };
    }
    return { tipo: "ignorado", razao: "tipo_desconhecido", tipoBruto: `${type} ev=${str(ev?.["type"], "?")}` };
  }
  if (type === "assistant") {
    const content = obj(o["message"])?.["content"];
    if (Array.isArray(content)) {
      for (const bloco of content) {
        const b = obj(bloco);
        if (b?.["type"] === "tool_use") return { tipo: "tool_use", id: str(b["id"]), nome: str(b["name"]), input: b["input"] };
      }
    }
    return { tipo: "ignorado", razao: "tipo_desconhecido", tipoBruto: "assistant" };
  }
  if (type === "user") {
    const content = obj(o["message"])?.["content"];
    if (Array.isArray(content)) {
      for (const bloco of content) {
        const b = obj(bloco);
        if (b?.["type"] === "tool_result") {
          return { tipo: "tool_result", toolUseId: str(b["tool_use_id"]), isError: b["is_error"] === true, texto: textoDoConteudo(b["content"]) };
        }
      }
    }
    return { tipo: "ignorado", razao: "tipo_desconhecido", tipoBruto: "user" };
  }
  if (type === "result") {
    const denials = Array.isArray(o["permission_denials"]) ? o["permission_denials"] : [];
    return {
      tipo: "result",
      sucesso: subtype === "success" && o["is_error"] !== true,
      subtype,
      sessaoCli: typeof o["session_id"] === "string" ? o["session_id"] : null,
      texto: str(o["result"]),
      custoUsd: num(o["total_cost_usd"]),
      tokens: tokensDe(obj(o["usage"])),
      numTurnos: num(o["num_turns"]) ?? 0,
      negacoesPermissao: denials.map((d) => str(obj(d)?.["tool_name"])).filter((n) => n !== ""),
    };
  }
  return { tipo: "ignorado", razao: "tipo_desconhecido", tipoBruto };
}

/** Quatro sinais write-ahead (ADR-009): init = o CLI aceitou o prompt; qualquer saída = producedOutput. */
export function reduzirSinais(sinais: SinaisTurno, ev: EventoStream): SinaisTurno {
  switch (ev.tipo) {
    case "init":
      return { ...sinais, attempted: true, promptSubmitted: true };
    case "delta":
    case "tool_use":
    case "tool_result":
    case "result":
      return { ...sinais, attempted: true, producedOutput: true };
    default:
      return sinais;
  }
}

export const SINAIS_ZERADOS: SinaisTurno = { attempted: false, rejected: false, promptSubmitted: false, producedOutput: false };

/**
 * Classifica pelo ESTADO DE PROTOCOLO (ADR-009), nunca pela string de erro — `stderr` entra na
 * assinatura só para o teste adversarial provar que variá-lo não muda nada (E9.1):
 *  - result presente → sucesso | falha (subtype ≠ success: erro_max_turns | erro_execucao);
 *  - sem result, com init → interrompido (SIGTERM/exit 143, s6; quem decide parado_pela_pessoa vs
 *    sem_progresso é o servidor, que sabe se pediu);
 *  - sem init, exitCode ≠ 0 → sessao_rejeitada (CLI subiu e recusou antes do init: s2c);
 *  - sem init, exitCode null e sem signal → lancamento_falhou (spawn não aconteceu).
 */
export function classificarResultado(entrada: {
  eventos: readonly EventoStream[];
  exitCode: number | null;
  signal: string | null;
  stderr: string;
  sinais?: Partial<SinaisTurno>;
}): ResultadoTurno {
  let sinais: SinaisTurno = { ...SINAIS_ZERADOS, ...entrada.sinais };
  let init: Extract<EventoStream, { tipo: "init" }> | null = null;
  let result: Extract<EventoStream, { tipo: "result" }> | null = null;
  const ferramentasChamadas: string[] = [];
  let textoStream = "";
  for (const ev of entrada.eventos) {
    sinais = reduzirSinais(sinais, ev);
    if (ev.tipo === "init") init = ev;
    else if (ev.tipo === "result") result = ev;
    else if (ev.tipo === "tool_use") ferramentasChamadas.push(ev.nome);
    else if (ev.tipo === "delta") textoStream += ev.texto;
  }
  const lancou = entrada.exitCode !== null || entrada.signal !== null || entrada.eventos.length > 0;
  sinais = { ...sinais, attempted: sinais.attempted || lancou };
  const sessaoCli = result?.sessaoCli ?? init?.sessaoCli ?? null;
  const tokensZerados: TokensTurno = { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 };

  if (result) {
    const base = {
      texto: result.texto || textoStream,
      sessaoCli,
      sinais,
      custoUsd: result.custoUsd,
      tokens: result.tokens,
      ferramentasChamadas,
      negacoesPermissao: result.negacoesPermissao,
    };
    if (result.sucesso) return { desfecho: "sucesso", ...base };
    return { desfecho: "falha", motivoFalha: result.subtype === "error_max_turns" ? "erro_max_turns" : "erro_execucao", ...base };
  }

  const base = { texto: textoStream, sessaoCli, custoUsd: null, tokens: tokensZerados, ferramentasChamadas, negacoesPermissao: [] as string[] };
  if (init) return { desfecho: "interrompido", ...base, sinais };
  if (entrada.exitCode === null && entrada.signal === null) {
    return { desfecho: "interrompido", motivoInterrupcao: "lancamento_falhou", ...base, sinais };
  }
  if (entrada.exitCode !== null && entrada.exitCode !== 0) {
    return { desfecho: "interrompido", motivoInterrupcao: "sessao_rejeitada", ...base, sinais: { ...sinais, rejected: true } };
  }
  return { desfecho: "interrompido", motivoInterrupcao: "sem_progresso", ...base, sinais };
}
