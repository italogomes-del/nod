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

function nomes(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((t): t is string => typeof t === "string") : [];
}

function janelaDe(modelUsage: Obj | null): number | null {
  const janelas = Object.values(modelUsage ?? {}).map((u) => num(obj(u)?.["contextWindow"])).filter((j): j is number => j !== null);
  return janelas.length ? Math.max(...janelas) : null;
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
      skills: nomes(o["skills"]),
      comandos: nomes(o["slash_commands"]),
      comandosSoDoTerminal: nomes(o["terminal_slash_commands"]),
      plugins: (Array.isArray(o["plugins"]) ? o["plugins"] : []).flatMap((p) => {
        const x = obj(p);
        return x && typeof x["name"] === "string" && typeof x["path"] === "string" ? [{ nome: x["name"], caminho: x["path"] }] : [];
      }),
    };
  }
  if (type === "system" && subtype === "compact_boundary") {
    // O stream usa snake_case; o transcript em disco, camelCase (medido nos .jsonl de 28/09). Aceita os dois.
    const meta = obj(o["compact_metadata"]) ?? obj(o["compactMetadata"]);
    return {
      tipo: "compactacao",
      antes: num(meta?.["pre_tokens"]) ?? num(meta?.["preTokens"]),
      depois: num(meta?.["post_tokens"]) ?? num(meta?.["postTokens"]),
      gatilho: str(meta?.["trigger"], "desconhecido"),
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
    // O message_delta fecha a chamada com o usage completo dela (o do message_start ainda não tem a saída).
    if (ev?.["type"] === "message_delta" && obj(ev["usage"])) {
      const usage = obj(ev["usage"]);
      const t = tokensDe(usage);
      return {
        tipo: "chamada",
        entrada: t.entrada,
        cacheLido: t.cacheLeitura,
        cacheNovo: t.cacheCriacao,
        saida: t.saida,
        pensamento: num(obj(usage?.["output_tokens_details"])?.["thinking_tokens"]) ?? 0,
        subagente: typeof o["parent_tool_use_id"] === "string",
      };
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
      // O CLI emite UMA linha `assistant` por bloco de conteúdo (thinking, text, tool_use — ver
      // s3-mcp-ok.jsonl), então uma linha com texto e ferramenta juntos não foi observada; se vier, a
      // ferramenta ganha, como antes deste evento existir.
      const texto = textoDoConteudo(content);
      if (texto.trim() !== "") return { tipo: "texto_bloco", texto };
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
      erroCru:
        subtype === "success" && o["is_error"] !== true
          ? null
          : [subtype, str(o["error"]), Array.isArray(o["errors"]) ? o["errors"].map(String).join("; ") : "", str(o["result"])].filter(Boolean).join(" | ").slice(0, 500) || null,
      sessaoCli: typeof o["session_id"] === "string" ? o["session_id"] : null,
      texto: str(o["result"]),
      custoUsd: num(o["total_cost_usd"]),
      tokens: tokensDe(obj(o["usage"])),
      numTurnos: num(o["num_turns"]) ?? 0,
      janela: janelaDe(obj(o["modelUsage"])),
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
    case "texto_bloco":
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
 * Bloco de texto escrito ANTES da última ferramenta só entra na fala se passar disto.
 * definido em 2026-09-28: a linha "Progresso" do prompt pede UMA frase curta por etapa entre
 * ferramentas ("Categorizando lote de 11 e-mails"), então narração cabe folgada em 280 caracteres e
 * fica só no cartão de atividade. Texto maior que isso antes de uma ferramenta é relatório: o modelo
 * escreveu a resposta, chamou `lembrar` e fechou com "Anotado." — e o `result` do CLI traz só a
 * última mensagem, então a pessoa (e o colega que perguntou) recebia só "Anotado.".
 */
export const NARRACAO_MAX_CHARS = 280;

const normalizar = (s: string) => s.replace(/\s+/g, " ").trim();
const juntarBlocos = (partes: readonly string[]) => partes.map((p) => p.trim()).filter((p) => p !== "").join("\n\n");

/**
 * Fala = relatórios escritos antes da última ferramenta (> NARRACAO_MAX_CHARS, ainda não contidos no
 * texto final) + texto final, separados por linha em branco. Sem relatório a acrescentar, o texto final
 * sai intacto.
 */
export function comporFala(antesDaUltimaFerramenta: readonly string[], final: string): string {
  const alvo = normalizar(final);
  const relatorios: string[] = [];
  for (const bloco of antesDaUltimaFerramenta) {
    const t = bloco.trim();
    if (t.length <= NARRACAO_MAX_CHARS) continue;
    const n = normalizar(t);
    if (alvo.includes(n) || relatorios.some((r) => normalizar(r).includes(n))) continue;
    relatorios.push(t);
  }
  return relatorios.length === 0 ? final : juntarBlocos([...relatorios, final]);
}

/**
 * Classifica pelo ESTADO DE PROTOCOLO (ADR-009), nunca pela string de erro — `stderr` entra na
 * assinatura só para o teste adversarial provar que variá-lo não muda nada (E9.1):
 *  - result presente → sucesso | falha (subtype ≠ success: erro_max_turns | erro_execucao);
 *  - sem result e (o driver interrompeu OU chegou signal OU houve init) → interrompido com motivo
 *    INDEFINIDO: quem sabe se pediu é o servidor (parado_pela_pessoa se pararSolicitadoEm existe,
 *    senão sem_progresso). A regra é a MESMA antes e depois do init — a sonda de 2026-09-16 mediu
 *    (s6.log) que o SIGTERM sai como exit 143 com signal null, então o exit code sozinho não diz
 *    "interrompido" e o driver informa `interrompidoPeloDriver` quando chamou interromper();
 *  - sem init, exitCode null e sem signal → lancamento_falhou (spawn não aconteceu);
 *  - sem init, exitCode ≠ 0 → sessao_rejeitada: TODA recusa pré-init cai aqui (s2c foi a única
 *    observada). CLI não autenticado é motivo do INVENTÁRIO (sonda → nao_autenticado) e barra o
 *    turno antes do spawn (montarPlano → executor_indisponivel); este classificador não o infere.
 *
 * O texto (definido em 2026-09-28) é o que vira a fala do bot e a resposta ao colega:
 *  - com result: comporFala(blocos antes da última ferramenta, final). O final é `result.texto`; vazio
 *    (Codex, que nunca o preenche, ou erro sem texto), são os blocos depois da última ferramenta; sem
 *    eles, todos os blocos; sem blocos, os deltas colados, como antes;
 *  - sem result (interrompido): tudo o que foi escrito — os blocos separados por linha em branco mais o
 *    trecho em streaming que não chegou a fechar um bloco; sem blocos, os deltas colados, como antes.
 */
export function classificarResultado(entrada: {
  eventos: readonly EventoStream[];
  exitCode: number | null;
  signal: string | null;
  stderr: string;
  sinais?: Partial<SinaisTurno>;
  /** true quando o driver chamou interromper() (SIGTERM) — antes ou depois do init. */
  interrompidoPeloDriver?: boolean;
}): ResultadoTurno {
  let sinais: SinaisTurno = { ...SINAIS_ZERADOS, ...entrada.sinais };
  let init: Extract<EventoStream, { tipo: "init" }> | null = null;
  let result: Extract<EventoStream, { tipo: "result" }> | null = null;
  const ferramentasChamadas: string[] = [];
  let textoStream = "";
  // Deltas desde o último bloco completo: o trecho que um SIGTERM deixa sem o `assistant` que o fecharia.
  let textoAberto = "";
  const blocos: { texto: string; posicao: number }[] = [];
  let ultimaFerramenta = -1;
  for (const [posicao, ev] of entrada.eventos.entries()) {
    sinais = reduzirSinais(sinais, ev);
    if (ev.tipo === "init") init = ev;
    else if (ev.tipo === "result") result = ev;
    else if (ev.tipo === "tool_use") {
      ferramentasChamadas.push(ev.nome);
      ultimaFerramenta = posicao;
    } else if (ev.tipo === "delta") {
      textoStream += ev.texto;
      textoAberto += ev.texto;
    } else if (ev.tipo === "texto_bloco") {
      blocos.push({ texto: ev.texto, posicao });
      textoAberto = "";
    }
  }
  const lancou = entrada.exitCode !== null || entrada.signal !== null || entrada.eventos.length > 0;
  sinais = { ...sinais, attempted: sinais.attempted || lancou };
  const sessaoCli = result?.sessaoCli ?? init?.sessaoCli ?? null;
  const tokensZerados: TokensTurno = { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 };

  const todos = blocos.map((b) => b.texto);
  if (result) {
    const depois = blocos.filter((b) => b.posicao > ultimaFerramenta).map((b) => b.texto);
    const final = result.texto || juntarBlocos(depois) || juntarBlocos(todos) || textoStream;
    const antes = blocos.filter((b) => b.posicao < ultimaFerramenta).map((b) => b.texto);
    const base = {
      texto: comporFala(antes, final),
      sessaoCli,
      sinais,
      custoUsd: result.custoUsd,
      tokens: result.tokens,
      ferramentasChamadas,
      negacoesPermissao: result.negacoesPermissao,
    };
    if (result.sucesso) return { desfecho: "sucesso", ...base };
    return { desfecho: "falha", motivoFalha: result.subtype === "error_max_turns" ? "erro_max_turns" : "erro_execucao", erroCru: result.erroCru, ...base };
  }

  const texto = blocos.length > 0 ? juntarBlocos([...todos, textoAberto]) : textoStream;
  const base = { texto, sessaoCli, custoUsd: null, tokens: tokensZerados, ferramentasChamadas, negacoesPermissao: [] as string[] };
  if (entrada.interrompidoPeloDriver === true || entrada.signal !== null || init) return { desfecho: "interrompido", ...base, sinais };
  if (entrada.exitCode === null) {
    return { desfecho: "interrompido", motivoInterrupcao: "lancamento_falhou", ...base, sinais };
  }
  if (entrada.exitCode !== 0) {
    return { desfecho: "interrompido", motivoInterrupcao: "sessao_rejeitada", ...base, sinais: { ...sinais, rejected: true } };
  }
  return { desfecho: "interrompido", motivoInterrupcao: "sem_progresso", ...base, sinais };
}
