import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { PlanoTurno } from "../../../contracts/plano-turno.ts";
import { RESPOSTA_TESTE_IA_MAX } from "../../../contracts/desktop.ts";
import { MOTIVO_DA_CAUSA, type Inventario } from "../../../contracts/inventario.ts";
import { motivoSondaLenta, sondaFoiLenta } from "../../../domain/sonda-lenta.ts";
import type { EventoStream, SinaisTurno } from "../../../contracts/turno.ts";
import { baixarAnexos, entradaCodex } from "../anexos-turno.ts";
import { erroDoCodex, interpretarCodex, ultimaLinhaUtil } from "../../../domain/codex-stream.ts";
import { classificarResultado, reduzirSinais, SINAIS_ZERADOS } from "../../../domain/stream-json.ts";
import { respostaDoTeste } from "../../../domain/conta-da-ia.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { log } from "../../../obs/log.ts";
import { resolverBinario } from "../caminho.ts";
import { executarColetando, iniciarProcesso, type Processo } from "../processo.ts";
import { PRAZO_SONDA_PADRAO_MS } from "../sonda.ts";
import type { Driver } from "../spi.ts";
import type { LigacaoClaudeCli } from "./claude-cli.ts";
import { ambienteCodex, configMcpCodex, escreverLauncherProxy, negociarConfigCodex, overridesIsolamentoCodex, SEM_RECUSADAS, type RecusadasCodex } from "./codex-comum.ts";
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
export function argsCodex(plano: PlanoTurno, config: string, imagens: readonly string[] = [], recusadas: RecusadasCodex = SEM_RECUSADAS): string[] {
  const pastas = plano.workspacePastas ?? null;
  return ["exec", ...FLAGS_CODEX.filter((f) => f !== "--sandbox"), "--sandbox", pastas ? "workspace-write" : "read-only", "--color", "never", "--model", plano.entrada.modelo,
    ...(pastas ? ["--cd", pastas.ativa] : []),
    "-c", `developer_instructions=${JSON.stringify(plano.promptSistema)}`,
    "-c", `mcp_servers=${config}`, "-c", 'approval_policy="never"',
    ...overridesIsolamentoCodex(recusadas).flatMap((o) => ["-c", o]),
    // ADR-046: imagem anexada entra como arquivo do turno; o texto continua pelo stdin ("-").
    ...imagens.flatMap((i) => ["--image", i]), "-"];
}

/** Só os campos que `argsCodex` e `configMcpCodex` leem: a negociação valida as CHAVES, não este plano. */
const PLANO_DE_SONDA = {
  workspacePastas: null,
  entrada: { modelo: "sonda" },
  promptSistema: "",
  catalogo: { ferramentas: [] },
  politicaExecucao: { prazoMs: 60_000 },
} as unknown as PlanoTurno;

/** definido em 2026-10-05: o modelo do teste é o que o "automático" usa no Codex (src/domain/harness.ts). */
const MODELO_TESTE_CODEX = "gpt-5.6-sol";
/** definido em 2026-10-05: o mesmo teto do turno de sonda do Claude (sonda.ts). */
const TIMEOUT_TESTE_MS = 90_000;

export function criarCodexCliDriver(lig: LigacaoClaudeCli): Driver {
  return {
    meta: { id: "codex-cli", locality: "local" },
    async create(cfg) {
      const home = cfg.env.HOME ?? "";
      const env = ambienteCodex(cfg.env);
      let bin: string | null = null;
      let inv: Inventario | null = null;
      // As chaves de config que a versão instalada recusou (negociarConfigCodex); refeito a cada sonda.
      let recusadas: RecusadasCodex = SEM_RECUSADAS;
      const prazoSondaMs = lig.prazoSondaMs ?? PRAZO_SONDA_PADRAO_MS;
      async function sondar(): Promise<Inventario> {
        // NOD-178: um resultado de sonda lenta não é definitivo; a próxima chamada pergunta de novo ao CLI.
        if (inv && !sondaFoiLenta(inv) && Date.now() - inv.em < 300_000) return inv;
        bin = await resolverBinario(cfg.bins?.["codex-cli"], env.PATH ?? "", home, "codex");
        const em = Date.now();
        if (!bin) return inv = { estado: "ausente", motivo: "Instale o Codex e entre na sua conta para usá-lo no nod.", em };
        const executar = (args: string[]) => executarColetando({ bin: bin!, args, env, cwd: home, timeoutMs: prazoSondaMs });
        const lenta = (): Inventario => ({ estado: "ausente", motivo: motivoSondaLenta("Codex"), causa: "sonda_lenta", em });
        const help = await executar(["exec", "--help"]);
        if (help.estourouTempo) return inv = lenta();
        if (help.exitCode !== 0 || FLAGS_CODEX.some((f) => !help.stdout.includes(f))) return inv = { estado: "ausente", motivo: "Atualize o Codex: esta versão ainda não oferece o isolamento exigido pelo nod.", em };
        const lida = await executar(["--version"]);
        if (lida.estourouTempo) return inv = lenta();
        const versao = lida.stdout.trim().slice(0, 100);
        const login = await executar(["login", "status"]);
        if (login.estourouTempo) return inv = { estado: "nao_autenticado", motivo: motivoSondaLenta("Codex"), versao, causa: "sonda_lenta", em };
        if (login.exitCode !== 0) return inv = { estado: "nao_autenticado", motivo: "Abra o Codex, entre na sua conta e tente novamente.", versao, em };
        // definido em 2026-10-05: a config do turno é validada aqui, de graça (stdin vazio, nenhum modelo), com um plano
        // de prova. O que a versão não conhece cai; o que não pode cair deixa o Codex indisponível com o motivo dito.
        // NOD-178: a rodada que estoura o prazo não é "aceita" (saída vazia); a sonda inteira volta como lenta.
        let estourou = false;
        const negociacao = await negociarConfigCodex(async (r) => {
          const fim = await executar(argsCodex(PLANO_DE_SONDA, configMcpCodex(PLANO_DE_SONDA, { ...lig, proxyPath: "sonda.mjs" }, r), [], r));
          if (fim.estourouTempo) estourou = true;
          return estourou ? "" : `${fim.stdout}\n${fim.stderr}`;
        });
        if (estourou) return inv = lenta();
        if (negociacao.recusadas.size > 0 || !negociacao.aceita) {
          log("aviso", "codex_config_negociada", { versao, aceita: negociacao.aceita, recusadas: [...negociacao.recusadas].join(","), parou_em: negociacao.aceita ? null : negociacao.chave });
        }
        if (!negociacao.aceita) return inv = { estado: "ausente", motivo: "Atualize o Codex: esta versão não aceita o isolamento exigido pelo nod.", em };
        recusadas = negociacao.recusadas;
        return inv = { estado: "pronto", versao, em };
      }
      // ADR-076: piso do laço de voz = `codex app-server --help` responde; as flags listadas ali decidem as opcionais.
      let flagsAppServer: { bin: string; flags: string[] | null } | null = null;
      async function sondarAppServer(b: string): Promise<string[] | null> {
        if (flagsAppServer?.bin === b) return flagsAppServer.flags;
        const help = await executarColetando({ bin: b, args: ["app-server", "--help"], env, cwd: home, timeoutMs: prazoSondaMs });
        // NOD-178: help lento não é "sem app-server" (que pediria para atualizar) e não fica guardado.
        if (help.estourouTempo) throw new ErroDeDominio("executor_indisponivel", { cause: "sonda_lenta" });
        flagsAppServer = { bin: b, flags: help.exitCode === 0 ? [...new Set(help.stdout.match(/--[a-z][a-z0-9-]*/g) ?? [])] : null };
        return flagsAppServer.flags;
      }
      /**
       * O teste de verdade (definido em 2026-10-05, emenda da ADR-019): um `codex exec` de uma frase, SEM servidor MCP,
       * com as mesmas chaves de isolamento do turno. `login status` diz só que há conta; isto diz que ela responde.
       * Custa um turno da assinatura do Codex.
       */
      async function testar(pergunta: string): Promise<{ inventario: Inventario; resposta: string | null }> {
        inv = null;
        const inventario = await sondar();
        if (inventario.estado !== "pronto" || !bin) return { inventario, resposta: null };
        await mkdir(cfg.cwdBase, { recursive: true });
        const dir = await mkdtemp(join(cfg.cwdBase, "codex-teste-"));
        try {
          const plano = { ...PLANO_DE_SONDA, entrada: { modelo: MODELO_TESTE_CODEX } } as unknown as PlanoTurno;
          const eventos: EventoStream[] = [];
          const proc = iniciarProcesso({ bin, args: argsCodex(plano, "{}", [], recusadas), env, cwd: dir, sigtermParaSigkillMs: lig.sigtermParaSigkillMs, aoLinha(linha) { eventos.push(...interpretarCodex(linha)); } });
          proc.escrever(pergunta); proc.fecharStdin();
          const relogio = setTimeout(() => { void proc.interromper(); }, TIMEOUT_TESTE_MS);
          const fim = await proc.fim.finally(() => clearTimeout(relogio));
          const r = classificarResultado({ eventos, ...fim, sinais: { ...SINAIS_ZERADOS, attempted: true }, interrompidoPeloDriver: proc.interrompido() });
          const resposta = r.desfecho === "sucesso" ? respostaDoTeste(r.texto, RESPOSTA_TESTE_IA_MAX) : null;
          log("info", "teste_codex_cli", { estado: resposta ? "pronto" : "nao_autenticado", causa: resposta ? null : "teste_falhou" });
          if (resposta) return { inventario, resposta };
          // A sonda de login passou e o turno não respondeu: a conta está logada e não serve agora.
          inv = null;
          return { inventario: { estado: "nao_autenticado", motivo: MOTIVO_DA_CAUSA.teste_falhou, versao: inventario.versao, causa: "teste_falhou", em: Date.now() }, resposta: null };
        } finally { await rm(dir, { recursive: true, force: true }); }
      }
      return {
        sondar,
        testar,
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
                  plano, sinks, bin, flagsNoHelp, recusadas, env, cwdBase: cfg.cwdBase,
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
                const args = argsCodex(plano, configMcpCodex(plano, { ...lig, proxyPath: launcher }, recusadas), entrada.imagens, recusadas);
                const pendentes: Promise<void>[] = [];
                // O que o Codex disse de errado (item `error`, evento `error`): hoje é a única pista de um turno que falha.
                let ultimoErro: string | null = null;
                proc = iniciarProcesso({ bin, args, env, cwd: dir, sigtermParaSigkillMs: lig.sigtermParaSigkillMs, aoLinha(linha) {
                  ultimoErro = erroDoCodex(linha) ?? ultimoErro;
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
                const r = classificarResultado({ eventos, ...fim, sinais, interrompidoPeloDriver: proc.interrompido() });
                // definido em 2026-10-05: turno que não deu certo leva o motivo cru para o diagnóstico (o `turn.failed`
                // do Codex, senão o último erro que ele emitiu, senão a última linha do stderr). Antes o `erro_cru`
                // do Codex era sempre nulo e um turno que morria em 5 s não deixava pista.
                const erroCru = r.desfecho === "sucesso" ? r.erroCru : r.erroCru ?? ultimoErro ?? ultimaLinhaUtil(fim.stderr);
                return { ...r, erroCru, sessaoCli: null };
              } finally { if (proc) await proc.interromper(); proc = null; await rm(dir, { recursive: true, force: true }); }
            },
          };
        },
        async dispose() {},
      };
    },
  };
}
