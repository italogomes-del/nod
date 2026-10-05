import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { PlanoTurno } from "../../../contracts/plano-turno.ts";
import type { Inventario } from "../../../contracts/inventario.ts";
import type { EventoStream, SinaisTurno } from "../../../contracts/turno.ts";
import { baixarAnexos, entradaCodex } from "../anexos-turno.ts";
import { interpretarCodex } from "../../../domain/codex-stream.ts";
import { classificarResultado, reduzirSinais, SINAIS_ZERADOS } from "../../../domain/stream-json.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { resolverBinario } from "../caminho.ts";
import { executarColetando, iniciarProcesso, type Processo } from "../processo.ts";
import type { Driver } from "../spi.ts";
import type { LigacaoClaudeCli } from "./claude-cli.ts";
import { ambienteCodex, configMcpCodex, escreverLauncherProxy, OVERRIDES_ISOLAMENTO_CODEX } from "./codex-comum.ts";
import { rodarLigacaoCodex } from "./codex-ligacao.ts";

export { configMcpCodex } from "./codex-comum.ts";

export const FLAGS_CODEX = ["--json", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config", "--sandbox", "--skip-git-repo-check"] as const;

/**
 * definido em 2026-09-18: com projeto autorizado o Codex escreve na pasta (workspace-write) em vez
 * de read-only, e `--cd` aponta a pasta ativa. NÃO HOMOLOGADO: o binário do Codex não estava
 * instalado na máquina onde o confinamento do Claude foi medido, então este caminho está coberto
 * só por teste de montagem de args. Validar com o CLI real antes de anunciar paridade.
 *
 * definido em 2026-09-18 (ADR-040): o Codex nunca teve teto de passos, então é o Claude que se
 * alinha a ele quando `--max-turns` sai — nada a mudar aqui. `interpretarCodex` produz os mesmos
 * EventoStream do Claude. revisto em 2026-10-01 (ADR-067): o vigia de atividade de `laco.ts` saiu, e o
 * Codex segue um prompt por turno, sem sessão viva.
 *
 * LACUNA NÃO HOMOLOGADA: não há equivalente a `--autocompact` no conjunto FLAGS_CODEX sondado, e o
 * binário não estava instalado na máquina onde a medição foi feita. Não inventar flag de janela de
 * contexto aqui sem sondar o CLI real. revisto em 2026-10-01 (ADR-067): saiu o deadline absoluto por `prazoMs`
 * (setTimeout → interromper) — nenhum relógio de trabalho; o turno acaba quando o Codex termina ou no Parar.
 */
export function argsCodex(plano: PlanoTurno, config: string, imagens: readonly string[] = []): string[] {
  const pastas = plano.workspacePastas ?? null;
  return ["exec", ...FLAGS_CODEX.filter((f) => f !== "--sandbox"), "--sandbox", pastas ? "workspace-write" : "read-only", "--color", "never", "--model", plano.entrada.modelo,
    ...(pastas ? ["--cd", pastas.ativa] : []),
    "-c", `developer_instructions=${JSON.stringify(plano.promptSistema)}`,
    "-c", `mcp_servers=${config}`, "-c", 'approval_policy="never"',
    ...OVERRIDES_ISOLAMENTO_CODEX.flatMap((o) => ["-c", o]),
    // ADR-046: imagem anexada entra como arquivo do turno; o texto continua pelo stdin ("-").
    ...imagens.flatMap((i) => ["--image", i]), "-"];
}

export function criarCodexCliDriver(lig: LigacaoClaudeCli): Driver {
  return {
    meta: { id: "codex-cli", locality: "local" },
    async create(cfg) {
      const home = cfg.env.HOME ?? "";
      const env = ambienteCodex(cfg.env);
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
      // ADR-076: piso do laço de voz = `codex app-server --help` responde; as flags listadas ali decidem as opcionais.
      let flagsAppServer: { bin: string; flags: string[] | null } | null = null;
      async function sondarAppServer(b: string): Promise<string[] | null> {
        if (flagsAppServer?.bin === b) return flagsAppServer.flags;
        const help = await executarColetando({ bin: b, args: ["app-server", "--help"], env, cwd: home, timeoutMs: 10_000 });
        flagsAppServer = { bin: b, flags: help.exitCode === 0 ? [...new Set(help.stdout.match(/--[a-z][a-z0-9-]*/g) ?? [])] : null };
        return flagsAppServer.flags;
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
              // ADR-076: o turno-cérebro de uma ligação é o laço de voz no app-server, não um `codex exec`.
              if (plano.modoTurno === "ligacao" && plano.ligacaoVoz) {
                const flagsNoHelp = await sondarAppServer(bin);
                if (!flagsNoHelp) throw new ErroDeDominio("executor_indisponivel", { cause: "codex sem app-server: atualize o Codex para ligar" });
                await mkdir(cfg.cwdBase, { recursive: true });
                return await rodarLigacaoCodex({
                  plano, sinks, bin, flagsNoHelp, env, cwdBase: cfg.cwdBase,
                  urlNod: lig.urlNod, proxyPath: lig.proxyPath, nodePath: lig.nodePath, electronComoNode: lig.electronComoNode,
                  sigtermParaSigkillMs: lig.sigtermParaSigkillMs,
                  aoProcesso: (p) => {
                    proc = p;
                    if (p && parado) void p.interromper();
                  },
                });
              }
              await mkdir(cfg.cwdBase, { recursive: true });
              const dir = await mkdtemp(join(cfg.cwdBase, "codex-"));
              try {
                const launcher = await escreverLauncherProxy(dir, { urlNod: lig.urlNod, tokenDeTurno: plano.tokenDeTurno, proxyPath: lig.proxyPath });
                // ADR-046 (não homologado: o Codex não estava instalado na máquina da medição): imagem por
                // --image, texto de arquivo no prompt, PDF vira linha de "não lido".
                const anexos = plano.entrada.anexos?.length ? await baixarAnexos(plano, lig.urlNod) : [];
                const entrada = anexos.length > 0 ? await entradaCodex(plano.entrada.texto, anexos, dir) : { texto: plano.entrada.texto, imagens: [] };
                const args = argsCodex(plano, configMcpCodex(plano, { ...lig, proxyPath: launcher }), entrada.imagens);
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
                if (parado) await proc.interromper();
                else {
                  await sinks.sinal("promptSubmitted"); sinais.promptSubmitted = true;
                  proc.escrever(entrada.texto); proc.fecharStdin();
                }
                const fim = await proc.fim;
                await Promise.all(pendentes);
                return { ...classificarResultado({ eventos, ...fim, sinais, interrompidoPeloDriver: proc.interrompido() }), sessaoCli: null };
              } finally { if (proc) await proc.interromper(); proc = null; await rm(dir, { recursive: true, force: true }); }
            },
          };
        },
        async dispose() {},
      };
    },
  };
}
