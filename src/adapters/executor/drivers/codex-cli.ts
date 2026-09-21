import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PlanoTurno } from "../../../contracts/plano-turno.ts";
import type { Inventario } from "../../../contracts/inventario.ts";
import type { EventoStream, SinaisTurno } from "../../../contracts/turno.ts";
import { interpretarCodex } from "../../../domain/codex-stream.ts";
import { classificarResultado, reduzirSinais, SINAIS_ZERADOS } from "../../../domain/stream-json.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { resolverBinario } from "../caminho.ts";
import { executarColetando, iniciarProcesso, type Processo } from "../processo.ts";
import type { Driver } from "../spi.ts";
import type { LigacaoClaudeCli } from "./claude-cli.ts";

export const FLAGS_CODEX = ["--json", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config", "--sandbox", "--skip-git-repo-check"] as const;

/**
 * definido em 2026-09-18: com projeto autorizado o Codex escreve na pasta (workspace-write) em vez
 * de read-only, e `--cd` aponta a pasta ativa. NÃO HOMOLOGADO: o binário do Codex não estava
 * instalado na máquina onde o confinamento do Claude foi medido, então este caminho está coberto
 * só por teste de montagem de args. Validar com o CLI real antes de anunciar paridade.
 */
export function argsCodex(plano: PlanoTurno, config: string): string[] {
  const pastas = plano.workspacePastas ?? null;
  return ["exec", ...FLAGS_CODEX.filter((f) => f !== "--sandbox"), "--sandbox", pastas ? "workspace-write" : "read-only", "--color", "never", "--model", plano.entrada.modelo,
    ...(pastas ? ["--cd", pastas.ativa] : []),
    "-c", `developer_instructions=${JSON.stringify(plano.promptSistema)}`,
    "-c", `mcp_servers=${config}`, "-c", 'approval_policy="never"', "-c", 'web_search="disabled"',
    "-c", "features.shell_tool=false", "-c", "features.unified_exec=false", "-c", "features.apply_patch_freeform=false",
    "-c", "features.multi_agent=false", "-c", "features.apps=false", "-c", "features.js_repl=false", "-c", "features.view_image=false", "-c", "features.plugins=false", "-c", "features.hooks=false",
    "-c", "features.browser_use=false", "-c", "features.browser_use_external=false", "-c", "features.computer_use=false",
    "-c", "features.in_app_browser=false", "-c", "features.remote_plugin=false", "-c", "features.image_generation=false",
    "-c", "features.code_mode_host=false", "-c", "features.workspace_dependencies=false", "-c", "features.shell_snapshot=false",
    "-c", "features.skip_host_skill_discovery=true", "-c", "features.skill_search=false", "-c", "project_doc_max_bytes=0", "-"];
}

/** definido em 2026-09-18: configuração aponta para um launcher privado; token nunca em argv. */
export function configMcpCodex(plano: PlanoTurno, lig: LigacaoClaudeCli): string {
  const mcp = { command: lig.nodePath ?? process.execPath, args: [lig.proxyPath], env: lig.electronComoNode ? { ELECTRON_RUN_AS_NODE: "1" } : {} };
  const quote = JSON.stringify;
  return `{ nod = { command = ${quote(mcp.command)}, args = [${mcp.args.map((s) => quote(s)).join(", ")}], required = true, enabled_tools = [${plano.catalogo.ferramentas.map((f) => quote(f.nome)).join(", ")}], tool_timeout_sec = ${Math.ceil(plano.politicaExecucao.prazoMs / 1000)}, env = { ${Object.entries(mcp.env).map(([k, v]) => `${k} = ${quote(v)}`).join(", ")} } } }`;
}

export function criarCodexCliDriver(lig: LigacaoClaudeCli): Driver {
  return {
    meta: { id: "codex-cli", locality: "local" },
    async create(cfg) {
      const home = cfg.env.HOME ?? "";
      const env = Object.fromEntries(Object.entries(cfg.env).filter(([k]) => !/^(OPENAI_|CODEX_API_KEY$|CODEX_ACCESS_TOKEN$|DATABASE_|PGPASSWORD$)/.test(k)));
      let bin: string | null = null;
      let inv: Inventario | null = null;
      async function sondar(): Promise<Inventario> {
        if (inv && Date.now() - inv.em < 300_000) return inv;
        bin = await resolverBinario(cfg.bins?.["codex-cli"], env.PATH ?? "", home, "codex");
        const em = Date.now();
        if (!bin) return inv = { estado: "ausente", motivo: "Instale o Codex e entre na sua conta para usá-lo no nod.", em };
        const executar = (args: string[]) => executarColetando({ bin: bin!, args, env, cwd: home, timeoutMs: 10_000 });
        const help = await executar(["exec", "--help"]);
        if (help.exitCode !== 0 || FLAGS_CODEX.some((f) => !help.stdout.includes(f))) return inv = { estado: "ausente", motivo: "Atualize o Codex: esta versão ainda não oferece o isolamento exigido pelo nod.", em };
        const versao = (await executar(["--version"])).stdout.trim().slice(0, 100);
        const login = await executar(["login", "status"]);
        if (login.exitCode !== 0) return inv = { estado: "nao_autenticado", motivo: "Abra o Codex, entre na sua conta e tente novamente.", versao, em };
        return inv = { estado: "pronto", versao, em };
      }
      return {
        sondar,
        adapter(plano) {
          let proc: Processo | null = null;
          let parado = false;
          return {
            async interromper() { parado = true; if (proc) await proc.interromper(); },
            async rodarTurno(sinks) {
              const eventos: EventoStream[] = [];
              let sinais: SinaisTurno = { ...SINAIS_ZERADOS, attempted: true };
              await sinks.sinal("attempted");
              if ((await sondar()).estado !== "pronto" || !bin) throw new ErroDeDominio("executor_indisponivel");
              await mkdir(cfg.cwdBase, { recursive: true });
              const dir = await mkdtemp(join(cfg.cwdBase, "codex-"));
              let prazo: ReturnType<typeof setTimeout> | undefined;
              try {
                const launcher = join(dir, "proxy.mjs");
                await writeFile(launcher, `process.env.NOD_URL = ${JSON.stringify(lig.urlNod)};\nprocess.env.NOD_TOKEN_TURNO = ${JSON.stringify(plano.tokenDeTurno)};\nconst proxy = await import(${JSON.stringify(pathToFileURL(lig.proxyPath).href)});\nawait proxy.main();\n`, { mode: 0o600, flag: "wx" });
                const args = argsCodex(plano, configMcpCodex(plano, { ...lig, proxyPath: launcher }));
                const pendentes: Promise<void>[] = [];
                proc = iniciarProcesso({ bin, args, env, cwd: dir, sigtermParaSigkillMs: lig.sigtermParaSigkillMs, aoLinha(linha) {
                  for (const ev of interpretarCodex(linha)) {
                    eventos.push(ev); sinks.evento(ev);
                    if (ev.tipo === "delta") sinks.delta(ev.texto);
                    const novos = reduzirSinais(sinais, ev);
                    for (const k of Object.keys(novos) as (keyof SinaisTurno)[]) if (novos[k] && !sinais[k]) pendentes.push(sinks.sinal(k));
                    sinais = novos;
                  }
                } });
                prazo = setTimeout(() => { void proc?.interromper(); }, plano.politicaExecucao.prazoMs);
                if (parado) await proc.interromper();
                else {
                  await sinks.sinal("promptSubmitted"); sinais.promptSubmitted = true;
                  proc.escrever(plano.entrada.texto); proc.fecharStdin();
                }
                const fim = await proc.fim;
                await Promise.all(pendentes);
                return { ...classificarResultado({ eventos, ...fim, sinais, interrompidoPeloDriver: proc.interrompido() }), sessaoCli: null };
              } finally { if (prazo) clearTimeout(prazo); if (proc) await proc.interromper(); proc = null; await rm(dir, { recursive: true, force: true }); }
            },
          };
        },
        async dispose() {},
      };
    },
  };
}
