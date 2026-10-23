import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { aspasDeShell, chaveDoComando, comandoNaFila, MARCA_DA_FILA, precisaDaVez, repositorioDaOrigem, semPeso, type Historico } from "../../domain/fila-do-forno.ts";
import { decidirNativa, NATIVA_MCP_DA_PESSOA } from "../../domain/nativas.ts";
import { ESPERA_APROVACAO_NO_TURNO_MS, LONGPOLL_APROVACAO_MS, VARIAVEL_CONFIG_HOOK } from "../../shared/constantes.ts";
import { mainDaVaga } from "./vaga.ts";

/**
 * Hook PreToolUse do nod (ADR-052): o Claude Code o chama ANTES de cada ferramenta nativa do turno, e é ele
 * quem decide — o mesmo papel do proxy para as ferramentas MCP (ADR-013), local e fail-closed. O driver grava
 * a configuração (0600) no diretório temporário do turno; o token nunca vai na linha de comando.
 *
 * revisto em 2026-09-28 (ADR-055, "terminal de verdade, como o inhouse"): sem sandbox. Arquivo em qualquer
 * lugar do Mac passa; o Bash vai ao servidor COM o comando, e o servidor decide: o que só lê roda, o resto
 * vira card de aprovação na conversa — e o hook espera a resposta no próprio turno, em fatias, como o proxy
 * espera uma aprovação (0032). Sem confirmação do servidor, nada roda. Nunca escreve fora do JSON de saída
 * no stdout: é o canal com o CLI.
 */
/**
 * `pastaDoBot` e `home` (definido em 2026-10-01, ADR-065): a cerca do git fora da pasta do bot. Config de um driver
 * antigo sem os dois campos não liga a cerca — o comando segue para o servidor como antes.
 */
/** `daTask` (definido em 2026-10-09, ADR-088): `pastaDoBot` é a pasta da task, e a worktree nasce dentro dela. */
/**
 * `vaga` (definido em 2026-10-11, ADR-097, fase 1b): a fila do forno desta máquina — a pasta dela e a chamada ao
 * nod-vaga (o node e este script, com aspas). Config de um driver anterior sem o campo não liga a fila.
 */
/**
 * Campos do Codex (definido em 2026-10-14, ADR-103), todos medidos no 0.147.0 com um turno real:
 * - `formato: "codex"`: "permitir" sai SEM nada no stdout (o JSON com `permissionDecision: "allow"` sem `updatedInput`
 *   o Codex marca o hook como falho, e segue); negar continua o mesmo JSON do Claude.
 * - `prazoMs`: o hook do Codex FALHA ABERTO — estourou o `timeout` dele, o comando roda. O hook nega sozinho antes disso.
 * - `negacoes`: arquivo do turno onde cada negação é anotada ({nome, motivo}); o comando barrado não vira item no stream
 *   do Codex, e o driver junta daqui as negações do turno (a pílula "ferramenta negada" com a causa, como no Claude).
 * - `mcpDaPessoa`: o turno carregou os MCPs da pessoa; os que não são do nod vão ao servidor (NATIVA_MCP_DA_PESSOA).
 */
export type ConfigHook = { url: string; token: string; pastaDoBot?: string; home?: string; daTask?: boolean; vaga?: { dir: string; invocar: string }; formato?: "claude" | "codex"; prazoMs?: number; negacoes?: string; mcpDaPessoa?: boolean };

/** `updatedInput` (ADR-097): o Bash com a vez da fila em volta; o CLI valida contra o formato da ferramenta. */
export type SaidaHook = { hookSpecificOutput: { hookEventName: "PreToolUse"; permissionDecision: "allow" | "deny"; permissionDecisionReason: string; updatedInput?: Record<string, unknown> } };

/** O que o servidor respondeu sobre a chamada; `motivo` volta ao modelo quando nega. */
export type Confirmacao = { permitir: boolean; motivo?: string };
/** `arquivo` (ADR-066): a gravação fora de ~/nod/<bot>, que o servidor decide pelo modo — e o hook espera, como no Bash. */
export type Confirmar = (p: { ferramenta: string; contamina: boolean; comando?: string; arquivo?: string; mcp?: string }) => Promise<Confirmacao>;

const saida = (permitir: boolean, motivo: string): SaidaHook => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: permitir ? "allow" : "deny", permissionDecisionReason: `nod: ${motivo}` } });

/** O motivo que o modelo lê quando a espera acaba sem resposta: a aprovação segue na conversa e retoma a tarefa. */
export const AINDA_ESPERANDO = "o pedido de aprovação deste comando continua na conversa; quando a pessoa decidir, a tarefa retoma sozinha. Encerre o turno dizendo que está esperando — não repita o comando agora.";

/** Uma decisão completa: evento do CLI → saída do hook. `confirmar` fala com o servidor (injetável no teste). */
/** O comando com a vez da fila em volta, ou null se ele roda direto (ADR-097). */
export type Fila = (comando: string, cwd: string | null) => string | null;

export async function decidirHook(evento: unknown, confirmar: Confirmar, pastas?: Pick<ConfigHook, "pastaDoBot" | "home" | "daTask" | "mcpDaPessoa">, fila?: Fila): Promise<SaidaHook> {
  const e = (typeof evento === "object" && evento !== null ? evento : {}) as { tool_name?: unknown; tool_input?: unknown; cwd?: unknown };
  const ferramenta = typeof e.tool_name === "string" ? e.tool_name : "";
  const entrada = typeof e.tool_input === "object" && e.tool_input !== null ? (e.tool_input as Record<string, unknown>) : {};
  // ADR-065: o `cwd` do evento é a pasta em que o Bash está agora (o Claude Code a mantém entre comandos).
  const pasta = pastas?.pastaDoBot && pastas.home ? { cwd: typeof e.cwd === "string" ? e.cwd : null, pastaDoBot: pastas.pastaDoBot, home: pastas.home, daTask: pastas.daTask === true } : undefined;
  const d = decidirNativa({ ferramenta, entrada, ...(pasta ? { pasta } : {}), ...(pastas?.mcpDaPessoa ? { mcpDaPessoa: true } : {}) });
  if (!d.permitir) return saida(false, d.motivo);
  // MCP do nod: o proxy já decide e registra; o hook não confirma de novo no servidor (a rota só aceita nativas).
  // ADR-103: o MCP da pessoa (no Codex) vai ao servidor como a nativa NATIVA_MCP_DA_PESSOA, com o texto do pedido.
  if (ferramenta.startsWith("mcp__") && d.mcp === undefined) return saida(true, d.motivo);
  const c = d.mcp !== undefined
    ? await confirmar({ ferramenta: NATIVA_MCP_DA_PESSOA, contamina: d.contamina, mcp: d.mcp })
    : await confirmar({ ferramenta, contamina: d.contamina, ...(d.comando !== undefined ? { comando: d.comando } : {}), ...(d.arquivo !== undefined ? { arquivo: d.arquivo } : {}) });
  if (!c.permitir) return saida(false, c.motivo ?? "o servidor do nod não confirmou esta chamada");
  // ADR-097: a fila do forno no Bash e no Monitor (o prompt manda rodar teste demorado em segundo plano ou com o Monitor:
  // é ali que mora o peso), depois do servidor liberar o comando. Um servidor de desenvolvimento não prende a fila:
  // quem tem a vez há mais de TETO_DA_VEZ_MS deixa de segurar (vaga.ts).
  const naFila = (ferramenta === "Bash" || ferramenta === "Monitor") && fila && d.comando !== undefined ? fila(d.comando, typeof e.cwd === "string" ? e.cwd : null) : null;
  if (naFila === null) return saida(true, d.motivo);
  return { hookSpecificOutput: { ...saida(true, d.motivo).hookSpecificOutput, updatedInput: { ...entrada, command: naFila } } };
}

/**
 * A fila desta máquina (ADR-097): o que não pesa e o que já se mostrou leve rodam direto; o resto pede a vez. O histórico
 * é lido aqui, de uma vez, sem esperar nada (o hook tem prazo). Qualquer falha = o comando roda direto.
 */
export function filaDaMaquina(
  vaga: NonNullable<ConfigHook["vaga"]>,
  lerHistorico: () => Historico = () => lerHistoricoDaFila(vaga.dir),
  repositorio: (cwd: string | null) => string | null = repositorioDoGit,
): Fila {
  return (comando, cwd) => {
    try {
      if (comando.trimStart().startsWith(MARCA_DA_FILA) || semPeso(comando)) return null;
      const chave = chaveDoComando(comando, repositorio(cwd));
      if (!precisaDaVez({ comando, historico: lerHistorico()[chave] })) return null;
      return comandoNaFila(comando, { invocar: vaga.invocar, chave64: Buffer.from(chave, "utf8").toString("base64url"), dir: aspasDeShell(vaga.dir) });
    } catch {
      return null;
    }
  };
}

/** O repositório da pasta do comando, pelo git (uns poucos ms; o hook tem prazo, então até 2 s e, falhando, null). */
function repositorioDoGit(cwd: string | null): string | null {
  if (!cwd) return null;
  try {
    return repositorioDaOrigem(execFileSync("git", ["-C", cwd, "config", "--get", "remote.origin.url"], { encoding: "utf8", timeout: 2_000, stdio: ["ignore", "pipe", "ignore"] }));
  } catch {
    return null;
  }
}

function lerHistoricoDaFila(dir: string): Historico {
  try {
    return JSON.parse(readFileSync(join(dir, "historico.json"), "utf8")) as Historico;
  } catch {
    return {};
  }
}

/** Resposta do POST /api/interno/nativas: liberada, ou uma decisão aberta para esperar. */
type RespostaNativa = { ok?: boolean; aguardar?: string; mensagem?: string };
/** `soltar` (ADR-083, #194): o servidor fechou a espera porque o Mac apertou — o turno encerra e volta quando a pessoa decidir. */
type RespostaAguardar = { estado?: string; soltar?: boolean; itens?: { desfecho?: string | null }[] };

/**
 * definido em 2026-10-09 (ADR-089, #217): entre duas consultas da mesma espera passa ao menos isto. A rota segura cada
 * consulta até LONGPOLL_APROVACAO_MS, mas responde na hora quando solta a espera ou quando uma retomada já ficou com a
 * decisão; sem piso, o hook virava um laço apertado por até ESPERA_APROVACAO_NO_TURNO_MS justamente com o Mac apertado.
 */
export const PAUSA_MINIMA_ENTRE_CONSULTAS_MS = 1_000;

const dormirPadrao = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * definido em 2026-10-20 (NOD-293, E7): o servidor recusando ou derrubando a conexão é o deploy/reinício no meio do turno
 * (o Caddy ou a porta somem por alguns segundos). O pedido ao servidor é repetido depois destas esperas, nunca além do
 * `prazoMs` do hook; esgotadas, nega com SERVIDOR_REINICIANDO. Qualquer outro erro nega como antes (a falha sobe e o
 * `main` nega com "não foi possível decidir esta chamada").
 */
export const ESPERAS_RECONEXAO_MS = [1_000, 3_000, 5_000] as const;
export const SERVIDOR_REINICIANDO = "o servidor do nod está reiniciando; tente este comando de novo daqui a alguns segundos";
// UND_ERR_SOCKET: o undici com o socket destruído no meio da resposta (o processo do servidor morrendo). Repetir é
// seguro: o POST leva a mesma chave de idempotência (E9).
const CODIGOS_DE_REINICIO = new Set(["ECONNREFUSED", "ECONNRESET", "UND_ERR_SOCKET"]);

/** O fetch do Node lança `TypeError("fetch failed")` com o erro do socket no `cause` (ou um AggregateError de vários). */
function ehServidorReiniciando(erro: unknown): boolean {
  const causa = typeof erro === "object" && erro !== null ? (erro as { cause?: unknown }).cause : undefined;
  if (typeof causa !== "object" || causa === null) return false;
  const c = causa as { code?: unknown; errors?: unknown };
  if (typeof c.code === "string" && CODIGOS_DE_REINICIO.has(c.code)) return true;
  return Array.isArray(c.errors) && c.errors.length > 0 && c.errors.every((e: unknown) => typeof e === "object" && e !== null && CODIGOS_DE_REINICIO.has(String((e as { code?: unknown }).code)));
}

/**
 * Fala com o servidor. Bash que precisa de aprovação: espera a decisão em fatias até ESPERA_APROVACAO_NO_TURNO_MS
 * (era abaixo da isenção do vigia da ADR-040, que saiu na ADR-067); aprovada, confirma de novo — agora o servidor acha a aprovação, grava a
 * trilha e libera. Recusada, ou a espera acabou: nega com o motivo que o modelo precisa ler.
 * revisto em 2026-10-09 (ADR-089, #217): `soltar: true` encerra a espera NA HORA com AINDA_ESPERANDO, como o proxy faz
 * nas ferramentas MCP; antes o hook repetia a consulta em qualquer estado diferente de "decidida".
 */
export function confirmarNoServidor(cfg: ConfigHook, opcoes: { agora?: () => number; fetch?: typeof fetch; dormir?: (ms: number) => Promise<void> } = {}): Confirmar {
  const agora = opcoes.agora ?? Date.now;
  const dormir = opcoes.dormir ?? dormirPadrao;
  const buscar = opcoes.fetch ?? fetch;
  const base = cfg.url.replace(/\/+$/, "");
  const headers = { authorization: `Bearer ${cfg.token}`, "content-type": "application/json" };
  return async ({ ferramenta, contamina, comando, arquivo, mcp }) => {
    const chegou = agora();
    const pedirUmaVez = async (chave: string): Promise<RespostaNativa | Confirmacao> => {
      const r = await buscar(`${base}/api/interno/nativas`, {
        method: "POST",
        headers: { ...headers, "x-nod-idempotency-key": chave },
        body: JSON.stringify({ ferramenta, contamina, ...(comando !== undefined ? { comando } : {}), ...(arquivo !== undefined ? { arquivo } : {}), ...(mcp !== undefined ? { mcp } : {}) }),
        signal: AbortSignal.timeout(10_000),
      });
      const corpo = (await r.json().catch(() => ({}))) as RespostaNativa;
      return r.ok ? corpo : { permitir: false, motivo: corpo.mensagem ?? "o servidor do nod não confirmou esta chamada" };
    };
    // NOD-293 (E7): conexão recusada/derrubada = o servidor reiniciando; repete nas ESPERAS_RECONEXAO_MS, dentro do prazo.
    const pedir = async (chave: string): Promise<RespostaNativa | Confirmacao> => {
      for (let tentativa = 0; ; tentativa += 1) {
        try {
          return await pedirUmaVez(chave);
        } catch (erro) {
          if (!ehServidorReiniciando(erro)) throw erro;
          const espera = ESPERAS_RECONEXAO_MS[tentativa];
          if (espera === undefined || (cfg.prazoMs !== undefined && agora() - chegou + espera >= cfg.prazoMs)) return { permitir: false, motivo: SERVIDOR_REINICIANDO };
          await dormir(espera);
        }
      }
    };
    const primeira = await pedir(randomUUID());
    if ("permitir" in primeira) return primeira;
    if (primeira.ok === true) return { permitir: true };
    if (typeof primeira.aguardar !== "string") return { permitir: false, motivo: "resposta inesperada do servidor do nod" };
    const inicio = agora();
    while (agora() - inicio < ESPERA_APROVACAO_NO_TURNO_MS) {
      const consulta = agora();
      const r = await buscar(`${base}/api/interno/decisoes/${encodeURIComponent(primeira.aguardar)}/aguardar`, { headers, signal: AbortSignal.timeout(LONGPOLL_APROVACAO_MS + 10_000) });
      if (!r.ok) return { permitir: false, motivo: "a aprovação deste comando não foi encontrada" };
      const d = (await r.json()) as RespostaAguardar;
      if (d.soltar === true) return { permitir: false, motivo: AINDA_ESPERANDO };
      if (d.estado !== "decidida") {
        const passou = agora() - consulta;
        if (passou < PAUSA_MINIMA_ENTRE_CONSULTAS_MS) await dormir(PAUSA_MINIMA_ENTRE_CONSULTAS_MS - passou);
        continue;
      }
      if (!(d.itens ?? []).some((i) => i.desfecho === "executado")) return { permitir: false, motivo: "a pessoa não aprovou este comando" };
      const segunda = await pedir(randomUUID());
      return "permitir" in segunda ? segunda : segunda.ok === true ? { permitir: true } : { permitir: false, motivo: "o servidor do nod não liberou o comando aprovado" };
    }
    return { permitir: false, motivo: AINDA_ESPERANDO };
  };
}

async function lerStdin(): Promise<string> {
  let texto = "";
  for await (const pedaco of process.stdin) texto += String(pedaco);
  return texto;
}

/**
 * O que vai ao stdout (ADR-103): no Codex, "permitir" sem `updatedInput` é o stdout vazio (o JSON de allow puro o Codex
 * marca como falha do hook); o resto é o JSON de sempre, que os dois CLIs entendem.
 */
export function textoDaSaida(resposta: SaidaHook, formato: ConfigHook["formato"]): string {
  const s = resposta.hookSpecificOutput;
  if (formato === "codex" && s.permissionDecision === "allow" && s.updatedInput === undefined) return "";
  return JSON.stringify(resposta);
}

/** ADR-103: a negação anotada para o driver do Codex (uma linha JSON por negação; falhar aqui nunca muda a decisão). */
function anotarNegacao(arquivo: string | undefined, evento: unknown, resposta: SaidaHook): void {
  if (!arquivo || resposta.hookSpecificOutput.permissionDecision !== "deny") return;
  try {
    const e = (typeof evento === "object" && evento !== null ? evento : {}) as { tool_name?: unknown };
    const nome = typeof e.tool_name === "string" ? (e.tool_name.startsWith("mcp__") && !e.tool_name.startsWith("mcp__nod__") ? NATIVA_MCP_DA_PESSOA : e.tool_name) : "";
    appendFileSync(arquivo, `${JSON.stringify({ nome, motivo: resposta.hookSpecificOutput.permissionDecisionReason.slice(0, 1000) })}\n`, { mode: 0o600 });
  } catch {
    // A negação já vale; só a pílula fica sem a causa.
  }
}

/**
 * Decide com prazo (ADR-103): `prazoMs` vencido = nega dizendo que a aprovação segue na conversa. No Codex o próprio CLI
 * deixaria o comando rodar ao estourar o timeout dele; o prazo do hook fica abaixo do timeout que o driver configura.
 */
export async function decidirComPrazo(decidir: () => Promise<SaidaHook>, prazoMs: number | undefined): Promise<SaidaHook> {
  if (!prazoMs) return decidir();
  let relogio: ReturnType<typeof setTimeout> | undefined;
  const vencido = new Promise<SaidaHook>((r) => { relogio = setTimeout(() => r(saida(false, AINDA_ESPERANDO)), prazoMs); });
  try {
    return await Promise.race([decidir(), vencido]);
  } finally {
    clearTimeout(relogio);
  }
}

export async function main(): Promise<void> {
  // ADR-097: o nod-vaga mora neste mesmo script (o motor e o app já o instalam): `… hook-nativas.mjs vaga pegar …`.
  if (process.argv[2] === "vaga") return mainDaVaga(process.argv.slice(3));
  let resposta: SaidaHook;
  let cfg: ConfigHook | null = null;
  let evento: unknown = null;
  try {
    // ADR-103: no Codex o caminho vem pela variável (o comando do hook é fixo); no Claude, pelo argumento, como antes.
    cfg = JSON.parse(readFileSync(process.argv[2] ?? process.env[VARIAVEL_CONFIG_HOOK] ?? "", "utf8")) as ConfigHook;
    const c = cfg;
    evento = JSON.parse(await lerStdin()) as unknown;
    resposta = await decidirComPrazo(() => decidirHook(evento, confirmarNoServidor(c), c, c.vaga ? filaDaMaquina(c.vaga) : undefined), c.prazoMs);
  } catch {
    resposta = saida(false, "não foi possível decidir esta chamada");
  }
  anotarNegacao(cfg?.negacoes, evento, resposta);
  process.stdout.write(textoDaSaida(resposta, cfg?.formato));
  // O prazo pode vencer com a consulta ao servidor ainda aberta: o hook sai na hora, sem esperar a rede.
  if (cfg?.prazoMs) process.exit(0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
