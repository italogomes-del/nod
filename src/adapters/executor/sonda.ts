import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import type { Inventario } from "../../contracts/inventario.ts";
import type { EventoStream } from "../../contracts/turno.ts";
import { montarAmbiente } from "../../domain/ambiente-executor.ts";
import { interpretarLinhaStreamJson } from "../../domain/stream-json.ts";
import { caminhoAumentado, resolverBinario } from "./caminho.ts";
import { extrairVersao, flagsListadasNoHelp } from "./flag-floors.ts";
import { executarColetando } from "./processo.ts";

/**
 * Sonda de disponibilidade (ADR-019): pergunta ao CLI, nunca lê a credencial.
 *  (1) presença de variável de ambiente não prova nada — ANTHROPIC_API_KEY nem é lida;
 *  (2) a identidade que o CLI reporta é cosmética: o snapshot NÃO tem email;
 *  (3) três estados: ausente (binário) | nao_autenticado (turno mínimo falhou ou cobraria fora da
 *      assinatura) | pronto (versão lida e turno de uma palavra respondido com init.apiKeySource 'none').
 * O turno de sonda é stream-json (não json): ver lerTurnoDeSonda.
 * O turno de sonda custa (medido em 2026-09-16, mapa-cli: US$0,003–0,02 com haiku) — por isso o
 * cache de 5 min em src/services/inventario.ts e o modelo mais barato (EMENDA 35).
 */
export type OpcoesSonda = {
  /** definido em 2026-09-16: 10 s para `--version`/`--help` (local, sem rede). */
  timeoutVersaoMs?: number;
  /** definido em 2026-09-16: 90 s para o turno de uma palavra — a sonda s3 com MCP levou 8,3 s; folga de 10x. */
  timeoutTurnoMs?: number;
  home?: string;
  /** Base do cwd descartável da sonda (nunca o repo — mapa-cli: o cwd decide qual CLAUDE.md o CLI lê). */
  cwdBase?: string;
  relogio?: () => number;
};

export type SondaDetalhada = {
  inventario: Inventario;
  /** Caminho absoluto resolvido; null quando ausente. */
  binario: string | null;
  /** Flags que o `--help` lista (para os floors); null quando o help não pôde ser lido. */
  flagsNoHelp: string[] | null;
  /** total_cost_usd do turno de sonda (null quando não houve turno ou result). */
  custoUsd: number | null;
};

type Env = Readonly<Record<string, string | undefined>>;

export function ambienteDaSonda(env: Env, home: string): Record<string, string> {
  const limpo = montarAmbiente("local", env);
  return { ...limpo, PATH: caminhoAumentado(env.PATH, home), HOME: limpo.HOME ?? home };
}

/** Só `--version`: barato e sem rede. Para o driver conferir floors sem gastar turno. */
export async function lerVersao(binario: string, env: Record<string, string>, timeoutMs = 10_000): Promise<{ versao: string } | { erro: string }> {
  const r = await executarColetando({ bin: binario, args: ["--version"], env, cwd: tmpdir(), timeoutMs });
  if (r.erroSpawn) return { erro: "binario_nao_executa" };
  if (r.exitCode !== 0) return { erro: `version_exit_${r.exitCode ?? "null"}` };
  const versao = extrairVersao(r.stdout);
  return versao ? { versao } : { erro: "versao_ilegivel" };
}

export async function lerFlagsDoHelp(binario: string, env: Record<string, string>, timeoutMs = 10_000): Promise<string[] | null> {
  const r = await executarColetando({ bin: binario, args: ["--help"], env, cwd: tmpdir(), timeoutMs });
  if (r.erroSpawn || r.exitCode !== 0) return null;
  return flagsListadasNoHelp(r.stdout);
}

/**
 * Lê o turno de sonda pelo MESMO parser do driver. medido em 2026-09-16 (um turno haiku real,
 * US$0,014): `--output-format json` NÃO traz `apiKeySource` (chaves: type, subtype, is_error,
 * result, session_id, total_cost_usd, usage, modelUsage, permission_denials…); só o `system/init`
 * do stream-json traz — por isso a sonda usa stream-json e lê o init. Sem init, ou com
 * apiKeySource ausente, é fail-closed (nao_autenticado), nunca "assume assinatura".
 */
export function lerTurnoDeSonda(stdout: string): { init: Extract<EventoStream, { tipo: "init" }> | null; result: Extract<EventoStream, { tipo: "result" }> | null } {
  let init: Extract<EventoStream, { tipo: "init" }> | null = null;
  let result: Extract<EventoStream, { tipo: "result" }> | null = null;
  for (const linha of stdout.split("\n")) {
    const ev = interpretarLinhaStreamJson(linha);
    if (ev.tipo === "init") init = ev;
    else if (ev.tipo === "result") result = ev;
  }
  return { init, result };
}

export async function sondarDetalhado(bin: string | undefined, env: Env, modelo: string, o: OpcoesSonda = {}): Promise<SondaDetalhada> {
  const home = o.home ?? env.HOME ?? homedir();
  const agora = o.relogio ?? Date.now;
  const ambiente = ambienteDaSonda(env, home);
  const binario = await resolverBinario(bin, ambiente.PATH ?? "", home);
  if (!binario) return { inventario: { estado: "ausente", motivo: bin ? "binario_nao_encontrado" : "claude_fora_do_path", em: agora() }, binario: null, flagsNoHelp: null, custoUsd: null };

  const versao = await lerVersao(binario, ambiente, o.timeoutVersaoMs);
  if ("erro" in versao) return { inventario: { estado: "ausente", motivo: versao.erro, em: agora() }, binario, flagsNoHelp: null, custoUsd: null };
  const flagsNoHelp = await lerFlagsDoHelp(binario, ambiente, o.timeoutVersaoMs);

  const dir = await mkdtemp(join(o.cwdBase ?? tmpdir(), "nod-sonda-"));
  try {
    const mcpVazio = join(dir, "mcp-vazio.json");
    await writeFile(mcpVazio, `${JSON.stringify({ mcpServers: {} })}\n`, { mode: 0o600 });
    const r = await executarColetando({
      bin: binario,
      args: ["-p", "responda só OK", "--model", modelo, "--max-turns", "1", "--tools", "", "--strict-mcp-config", "--mcp-config", mcpVazio, "--output-format", "stream-json", "--verbose"],
      env: ambiente,
      cwd: dir,
      timeoutMs: o.timeoutTurnoMs ?? 90_000,
    });
    const { init, result } = lerTurnoDeSonda(r.stdout);
    const custoUsd = result?.custoUsd ?? null;
    const naoAutenticado = (motivo: string): SondaDetalhada => ({ inventario: { estado: "nao_autenticado", motivo, versao: versao.versao, em: agora() }, binario, flagsNoHelp, custoUsd });
    if (r.estourouTempo) return naoAutenticado("turno_de_sonda_sem_resposta");
    if (r.erroSpawn) return naoAutenticado("turno_de_sonda_nao_lancou");
    // ADR-009: o motivo é o código de saída, nunca o texto do stderr ("Not logged in" não é lido).
    if (r.exitCode !== 0) return naoAutenticado(`turno_de_sonda_exit_${r.exitCode ?? "null"}`);
    if (!init) return naoAutenticado("turno_de_sonda_sem_init");
    if (!result) return naoAutenticado("turno_de_sonda_sem_result");
    if (!result.sucesso) return naoAutenticado("turno_de_sonda_com_erro");
    // Cobrança fora da assinatura claude.ai (chave de API, helper) não é 'pronto': cairia na fatura errada (ADR-015).
    if (init.apiKeySource !== "none") return naoAutenticado(`api_key_source_${init.apiKeySource}`);
    return { inventario: { estado: "pronto", versao: versao.versao, em: agora() }, binario, flagsNoHelp, custoUsd };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Forma do plano: `sondar(bin, env, modelo)` → Inventario. */
export async function sondar(bin: string | undefined, env: Env, modelo: string, o: OpcoesSonda = {}): Promise<Inventario> {
  return (await sondarDetalhado(bin, env, modelo, o)).inventario;
}
