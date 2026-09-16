import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Inventario } from "../../../contracts/inventario.ts";
import type { PlanoTurno } from "../../../contracts/plano-turno.ts";
import type { EventoStream, ResultadoTurno, SinaisTurno } from "../../../contracts/turno.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { classificarResultado, interpretarLinhaStreamJson, reduzirSinais, SINAIS_ZERADOS } from "../../../domain/stream-json.ts";
import { caminhoAumentado, resolverBinario } from "../caminho.ts";
import { conferirFloors, type FlagComPiso } from "../flag-floors.ts";
import { escreverMcpConfig } from "../mcp-config.ts";
import { iniciarProcesso, type Processo } from "../processo.ts";
import { lerFlagsDoHelp, lerVersao, sondarDetalhado } from "../sonda.ts";
import type { Adapter, ConfigDriver, Driver, Instance } from "../spi.ts";

/**
 * Driver claude-cli (ADR-012: implementação ÚNICA e real; ADR-014 invertido: o CLI é o da pessoa).
 * Contrato empírico de 2026-09-16 (mapa-cli): -p + stream-json + --verbose obrigatório, --tools ""
 * + --strict-mcp-config + --allowedTools exato = menor privilégio verificado (s3/s4b), --session-id
 * só no PRIMEIRO turno e --resume nos seguintes (s2c), cwd = mkdtemp por turno (EMENDA 11; --resume
 * funciona de qualquer cwd, s2d), SIGTERM → exit 143 sem `result` (s6).
 */
export type LigacaoClaudeCli = {
  /** URL do servidor nod para o proxy (vai no mcp.json, nunca no env do CLI). */
  urlNod: string;
  /** Caminho absoluto do proxy MCP (L5). */
  proxyPath: string;
  nodePath?: string;
  /** definido em 2026-09-16: a sonda usa o modelo mais barato (EMENDA 35). */
  modeloSonda?: string;
  /**
   * Espera entre SIGTERM e SIGKILL na interrupção; default SIGTERM_PARA_SIGKILL_MS (5 s).
   * definido em 2026-09-16: existe para o teste que CRONOMETRA `interromper()` poder afirmar
   * contra um limite que ele controla, em vez de correr contra o mesmo relógio do código.
   * Produção não passa nada.
   */
  sigtermParaSigkillMs?: number;
};

export const MODELO_SONDA_PADRAO = "claude-haiku-4-5-20251001";

/** As flags que montarArgs usa — é a lista conferida contra os floors. */
export const FLAGS_DO_TURNO: readonly FlagComPiso[] = [
  "--output-format",
  "--verbose",
  "--include-partial-messages",
  "--model",
  "--max-turns",
  "--setting-sources",
  "--strict-mcp-config",
  "--mcp-config",
  "--tools",
  "--allowedTools",
  "--permission-mode",
  "--append-system-prompt",
  "--session-id",
  "--resume",
];

/** Args do `claude -p` para um plano (função pura: é o que os testes de args conferem). */
export function montarArgs(entrada: { plano: PlanoTurno; mcpJson: string; sessaoNova?: () => string }): { args: string[]; sessaoCli: string } {
  const { plano } = entrada;
  const permitidas = plano.catalogo.ferramentas.map((f) => f.nomeMcp).join(",");
  const sessaoCli = plano.entrada.sessaoCli ?? (entrada.sessaoNova ?? randomUUID)();
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model",
    plano.entrada.modelo,
    "--max-turns",
    String(plano.entrada.maxTurnos),
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--mcp-config",
    entrada.mcpJson,
    "--tools",
    "",
    "--allowedTools",
    permitidas,
    "--permission-mode",
    "default",
    "--append-system-prompt",
    plano.promptSistema,
    ...(plano.entrada.sessaoCli ? ["--resume", plano.entrada.sessaoCli] : ["--session-id", sessaoCli]),
  ];
  return { args, sessaoCli };
}

/** Env do filho: cfg.env (já sem a denylist) + PATH aumentado + HOME + teto do tools/call. */
export function montarEnvDoFilho(env: Record<string, string>, home: string, prazoMs: number): Record<string, string> {
  return {
    ...env,
    PATH: caminhoAumentado(env.PATH, home),
    HOME: env.HOME ?? home,
    // definido em 2026-09-16: uma ferramenta (aprovação em long-poll) pode esperar tanto quanto o turno, nunca menos de 60 s;
    // o teto real do CLI é o que scripts/sonda-mcp-timeout.ts mede.
    MCP_TOOL_TIMEOUT: String(Math.max(60_000, Math.floor(prazoMs))),
  };
}

const chavesSinais: readonly (keyof SinaisTurno)[] = ["attempted", "rejected", "promptSubmitted", "producedOutput"];

export function criarClaudeCliDriver(lig: LigacaoClaudeCli): Driver {
  return {
    meta: { id: "claude-cli", locality: "local" },
    async create(cfg: ConfigDriver): Promise<Instance> {
      const home = cfg.env.HOME ?? homedir();
      const path = caminhoAumentado(cfg.env.PATH, home);
      const envBase = { ...cfg.env, PATH: path, HOME: home };
      let binario: string | null = null;
      let versao: string | null = null;
      let flagsNoHelp: string[] | null = null;

      /** `--version` + `--help` sem gastar turno; a sonda completa também preenche. */
      async function garantirVersao(): Promise<{ binario: string; versao: string }> {
        if (binario && versao) return { binario, versao };
        binario ??= await resolverBinario(cfg.bin, path, home);
        if (!binario) throw new ErroDeDominio("executor_indisponivel", { cause: "motor_ausente" });
        const v = await lerVersao(binario, envBase);
        if ("erro" in v) throw new ErroDeDominio("executor_indisponivel", { cause: v.erro });
        versao = v.versao;
        flagsNoHelp ??= await lerFlagsDoHelp(binario, envBase);
        return { binario, versao };
      }

      return {
        async sondar(): Promise<Inventario> {
          const s = await sondarDetalhado(cfg.bin, cfg.env, lig.modeloSonda ?? MODELO_SONDA_PADRAO, { home, cwdBase: cfg.cwdBase });
          binario = s.binario;
          flagsNoHelp = s.flagsNoHelp;
          if ("versao" in s.inventario && s.inventario.versao) versao = s.inventario.versao;
          return s.inventario;
        },

        adapter(plano: PlanoTurno): Adapter {
          let processo: Processo | null = null;
          let interromperPedido = false;

          return {
            async rodarTurno(sinks): Promise<ResultadoTurno> {
              // `sinais` é marcado ANTES de cada sinal síncrono sair, para o `aoLinha` (que pode
              // receber o init enquanto um `await sinks.sinal` ainda está pendente) não o repetir.
              let sinais: SinaisTurno = { ...SINAIS_ZERADOS, attempted: true };
              await sinks.sinal("attempted");
              const { binario: bin, versao: v } = await garantirVersao();
              const floors = conferirFloors({ versao: v, flags: FLAGS_DO_TURNO, flagsNoHelp });
              if (!floors.ok) throw new ErroDeDominio("executor_indisponivel", { cause: floors.motivo });

              await mkdir(cfg.cwdBase, { recursive: true });
              const tmpdir = await mkdtemp(join(cfg.cwdBase, "turno-"));
              const eventos: EventoStream[] = [];
              try {
                const mcpJson = await escreverMcpConfig(tmpdir, { url: lig.urlNod, tokenDeTurno: plano.tokenDeTurno, proxyPath: lig.proxyPath, nodePath: lig.nodePath });
                const { args } = montarArgs({ plano, mcpJson });
                const env = montarEnvDoFilho(cfg.env, home, plano.politicaExecucao.prazoMs);

                const pendentes: Promise<void>[] = [];
                const proc = iniciarProcesso({
                  bin,
                  args,
                  env,
                  cwd: tmpdir,
                  sigtermParaSigkillMs: lig.sigtermParaSigkillMs,
                  aoLinha(linha) {
                    const ev = interpretarLinhaStreamJson(linha);
                    if (ev.tipo === "ignorado") return;
                    eventos.push(ev);
                    sinks.evento(ev);
                    if (ev.tipo === "delta") sinks.delta(ev.texto);
                    const depois = reduzirSinais(sinais, ev);
                    for (const k of chavesSinais) {
                      if (depois[k] && !sinais[k]) pendentes.push(sinks.sinal(k));
                    }
                    sinais = depois;
                  },
                });
                processo = proc;
                if (interromperPedido) await proc.interromper();

                // ADR-009: promptSubmitted é gravado ANTES de o prompt sair para o CLI.
                sinais = { ...sinais, promptSubmitted: true };
                await sinks.sinal("promptSubmitted");
                proc.escrever(plano.entrada.texto);
                proc.fecharStdin();

                const fim = await proc.fim;
                await Promise.all(pendentes);
                if (fim.erroSpawn) {
                  return classificarResultado({ eventos, exitCode: null, signal: null, stderr: fim.stderr, sinais, interrompidoPeloDriver: proc.interrompido() });
                }
                return classificarResultado({ eventos, exitCode: fim.exitCode, signal: fim.signal, stderr: fim.stderr, sinais, interrompidoPeloDriver: proc.interrompido() });
              } finally {
                processo = null;
                await rm(tmpdir, { recursive: true, force: true });
              }
            },

            async interromper(): Promise<void> {
              interromperPedido = true;
              if (processo) await processo.interromper();
            },
          };
        },

        async dispose(): Promise<void> {
          // nada persistente: cada turno limpa o próprio tmpdir
        },
      };
    },
  };
}
