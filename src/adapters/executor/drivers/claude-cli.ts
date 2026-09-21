import { MODELO_SONDA_PADRAO } from "../../../contracts/modelos.ts";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Inventario } from "../../../contracts/inventario.ts";
import type { PlanoTurno } from "../../../contracts/plano-turno.ts";
import type { EventoStream, ResultadoTurno, SinaisTurno } from "../../../contracts/turno.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { log } from "../../../obs/log.ts";
import { classificarResultado, interpretarLinhaStreamJson, reduzirSinais, SINAIS_ZERADOS } from "../../../domain/stream-json.ts";
import { caminhoAumentado, resolverBinario } from "../caminho.ts";
import { conferirFloors, type FlagComPiso } from "../flag-floors.ts";
import { escreverMcpConfig } from "../mcp-config.ts";
import { iniciarProcesso, executarColetando, type Processo } from "../processo.ts";
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
  electronComoNode?: boolean;
  /** definido em 2026-09-16: a sonda usa o modelo mais barato (EMENDA 35). */
  modeloSonda?: string;
  sondaSemTurno?: boolean;
  /**
   * Espera entre SIGTERM e SIGKILL na interrupção; default SIGTERM_PARA_SIGKILL_MS (5 s).
   * definido em 2026-09-16: existe para o teste que CRONOMETRA `interromper()` poder afirmar
   * contra um limite que ele controla, em vez de correr contra o mesmo relógio do código.
   * Produção não passa nada.
   */
  sigtermParaSigkillMs?: number;
};

export { MODELO_SONDA_PADRAO } from "../../../contracts/modelos.ts";

/**
 * Janela do `--autocompact`. definido em 2026-09-18: mesmo valor do openmausbot
 * (`server/drivers/claude.ts:295`). Explícito em vez de "auto" — comportamento previsível entre
 * versões. Existe porque, sem teto de passos, a tarefa longa precisa compactar em vez de estourar.
 */
export const JANELA_AUTOCOMPACT_TOKENS = 200_000;

/**
 * As flags que montarArgs usa SEMPRE — é a lista conferida contra os floors, e reprovar aqui
 * recusa o turno. --restricted e --add-dir ficam de fora de propósito: são condicionais a existir
 * projeto autorizado, e exigi-las aqui derrubaria todo turno num CLI mais antigo, inclusive os que
 * não tocam em pasta nenhuma. O gate delas é o help, conferido no próprio turno (fail-closed:
 * sem --restricted no help, o cwd continua no diretório temporário e as nativas ficam desligadas).
 * --autocompact é condicional pelo mesmo motivo, e o gate também é o help.
 *
 * definido em 2026-09-18: SEM `--max-turns`. O teto de 12 passos foi dimensionado em 2026-09-16
 * para "lembrar → pedir_aprovacao → resposta" e cortava tarefa de código no meio (ler quatro
 * arquivos já gastava metade). O que limita o turno passa a ser ATIVIDADE: o watchdog de `laco.ts`
 * encerra o que fica mudo. `sonda.ts` continua usando `--max-turns 1`, onde o teto é o desejado,
 * então a flag segue em FLAG_FLOORS — só não é mais exigida no turno.
 */
export const FLAGS_DO_TURNO: readonly FlagComPiso[] = [
  "--output-format",
  "--verbose",
  "--include-partial-messages",
  "--model",
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

/**
 * Ferramentas nativas de arquivo liberadas quando há projeto autorizado. Bash fica fora: --restricted
 * remove as ferramentas que rodam comando, e comando continua indo ao container isolado do nod.
 * Medido em 2026-09-18: com --restricted, ler fora das pastas permitidas é NEGADO pelo CLI (aparece
 * em permission_denials), por caminho relativo e absoluto, e o CLAUDE.md do projeto é ignorado.
 */
export const NATIVAS_DE_ARQUIVO = ["Read", "Edit", "Write", "Glob", "Grep", "NotebookEdit"] as const;

/** Args do `claude -p` para um plano (função pura: é o que os testes de args conferem). */
export function montarArgs(entrada: { plano: PlanoTurno; mcpJson: string; sessaoNova?: () => string; compactar?: boolean }): { args: string[]; sessaoCli: string } {
  const { plano } = entrada;
  const pastas = plano.workspacePastas ?? null;
  // Sem projeto autorizado nada muda: nativas desligadas e cwd no diretório temporário vazio.
  const permitidas = [...plano.catalogo.ferramentas.map((f) => f.nomeMcp), ...(pastas ? NATIVAS_DE_ARQUIVO : [])].join(",");
  const sessaoCli = plano.entrada.sessaoCli ?? (entrada.sessaoNova ?? randomUUID)();
  // Todos os projetos aprovados entram: o bot transita entre eles sem reautorizar (decisão de 2026-09-18).
  const extras = (pastas?.aprovadas ?? []).filter((p) => p !== pastas?.ativa);
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model",
    plano.entrada.modelo,
    // Sem teto de passos, a tarefa longa precisa de janela: compactar em vez de bater no limite.
    ...(entrada.compactar ? ["--autocompact", String(JANELA_AUTOCOMPACT_TOKENS)] : []),
    // --restricted substitui --setting-sources project: ignora CLAUDE.md, skills e hooks do repo
    // aberto, que o nod não escreveu, e confina as ferramentas de arquivo às pastas permitidas.
    ...(pastas ? ["--restricted"] : ["--setting-sources", "project"]),
    ...extras.flatMap((p) => ["--add-dir", p]),
    "--strict-mcp-config",
    "--mcp-config",
    entrada.mcpJson,
    ...(pastas ? [] : ["--tools", ""]),
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
          if (lig.sondaSemTurno) {
            try {
              const v = await garantirVersao();
              const pisos = conferirFloors({ versao: v.versao, flags: FLAGS_DO_TURNO, flagsNoHelp });
              if (!pisos.ok) return { estado: "ausente", motivo: "Atualize o Claude Code para continuar.", em: Date.now() };
              const r = await executarColetando({ bin: v.binario, args: ["auth", "status"], env: envBase, cwd: home, timeoutMs: 10_000 });
              let autenticado = false;
              try { const status = JSON.parse(r.stdout) as { loggedIn?: boolean }; autenticado = status.loggedIn === true; } catch { /* Sem resposta estruturada, a sonda fecha o gate. */ }
              return r.exitCode === 0 && autenticado ? { estado: "pronto", versao: v.versao, em: Date.now() } : { estado: "nao_autenticado", motivo: "Abra o Claude Code e entre na sua conta.", versao: v.versao, em: Date.now() };
            } catch { return { estado: "ausente", motivo: "Instale ou atualize o Claude Code neste computador.", em: Date.now() }; }
          }

          // medido em 2026-09-16 (e2e:haiku, primeira rodada): NOD_HOME/turnos ainda não existia na sonda do boot e o
          // mkdtemp falhava com ENOENT — o driver ia para a sombra com "create_falhou". O diretório nasce aqui também.
          await mkdir(cfg.cwdBase, { recursive: true });
          const s = await sondarDetalhado(cfg.bin, cfg.env, lig.modeloSonda ?? MODELO_SONDA_PADRAO, { home, cwdBase: cfg.cwdBase });
          binario = s.binario;
          flagsNoHelp = s.flagsNoHelp;
          if ("versao" in s.inventario && s.inventario.versao) versao = s.inventario.versao;
          // O turno de sonda custa (assinatura da pessoa): o custo sai no log para o roteiro de aceite somar (L9).
          log("info", "sonda_claude_cli", { estado: s.inventario.estado, motivo: "motivo" in s.inventario ? s.inventario.motivo : null, custo_usd: s.custoUsd });
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

              // Fail-closed: sem --restricted comprovado no help, não se aponta o cwd para a pasta
              // da pessoa — antes o turno cai para o diretório temporário e as nativas desligadas.
              const confinavel = (flagsNoHelp ?? []).includes("--restricted");
              const pastas = confinavel ? plano.workspacePastas ?? null : null;
              await mkdir(cfg.cwdBase, { recursive: true });
              const tmpdir = await mkdtemp(join(cfg.cwdBase, "turno-"));
              const diretorio = pastas?.ativa ?? tmpdir;
              const eventos: EventoStream[] = [];
              try {
                const mcpJson = await escreverMcpConfig(tmpdir, { url: lig.urlNod, tokenDeTurno: plano.tokenDeTurno, proxyPath: lig.proxyPath, nodePath: lig.nodePath, electronComoNode: lig.electronComoNode });
                // Fail-closed: sem --autocompact no help da versão instalada, o turno roda sem ela.
                const compactar = (flagsNoHelp ?? []).includes("--autocompact");
                const { args } = montarArgs({ plano: pastas ? plano : { ...plano, workspacePastas: null }, mcpJson, compactar });
                const env = montarEnvDoFilho(cfg.env, home, plano.politicaExecucao.prazoMs);

                const pendentes: Promise<void>[] = [];
                const proc = iniciarProcesso({
                  bin,
                  args,
                  env,
                  cwd: diretorio,
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
