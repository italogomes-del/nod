import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { PlanoTurno } from "../../../contracts/plano-turno.ts";
import type { EventoStream, ResultadoTurno, SinaisTurno } from "../../../contracts/turno.ts";
import type { MsgCerebroServidor } from "../../../contracts/voz.ts";
import { classificarSessao, interpretarLinhaStreamJson, reduzirSinais } from "../../../domain/stream-json.ts";
import { log } from "../../../obs/log.ts";
import { mensagemClaude } from "../anexos-turno.ts";
import { conectarCerebro, type CerebroLigacao, type FabricaSocket } from "../cerebro-ligacao.ts";
import { escreverMcpConfig } from "../mcp-config.ts";
import { iniciarProcesso, type Processo } from "../processo.ts";
import type { SinksTurno } from "../spi.ts";

/**
 * O laço de voz do Claude Code (definido em 2026-10-04, ADR-072). O turno-cérebro de uma ligação roda um `claude -p`
 * com a entrada em stream-json aberta a ligação inteira: cada vez da pessoa vira uma linha no stdin, e cada pedaço de
 * texto do modelo vai direto ao servidor pelo canal do cérebro, nunca pelo chat. Sessão própria e efêmera (prompt e
 * modelo de voz, sem `--resume` da conversa); a ferramenta MCP do nod é a mesma de sempre, pelo proxy.
 *
 * No `fim`, pede um resumo de até 5 linhas (não falado), espera essa volta e fecha a entrada: o resumo é a fala da
 * entrega, e o servidor o grava como mensagem do bot.
 */

/** O que o modelo lê no fim da ligação; a resposta vira a mensagem do bot na conversa. */
export const PEDIDO_DE_RESUMO = "[nod] A ligação terminou. Escreva para o chat, em até 5 linhas, um resumo do que vocês conversaram e do que você fez ou ficou de fazer. Isto não será falado.";

/** Flags que o laço de voz usa sempre (o piso é o mesmo do turno; as opcionais entram só se o help as listar). */
export function montarArgsLigacao(p: { plano: PlanoTurno; mcpJson: string; modelo: string; sessaoId: string; flagsNoHelp: readonly string[] }): string[] {
  const { plano, flagsNoHelp } = p;
  const temFlag = (f: string) => flagsNoHelp.includes(f);
  const permitidas = plano.catalogo.ferramentas.map((f) => f.nomeMcp).join(",");
  return [
    "-p",
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--model",
    p.modelo,
    "--setting-sources",
    "project",
    "--strict-mcp-config",
    "--mcp-config",
    p.mcpJson,
    // Nenhuma nativa (sem terminal, sem arquivos): só as ferramentas MCP do plano, já aprovadas no --allowedTools.
    "--tools",
    "",
    "--allowedTools",
    permitidas,
    "--permission-mode",
    "default",
    // O prompt de voz substitui o do Claude Code inteiro quando a versão aceita: menor e mais rápido de ler a cada vez.
    ...(temFlag("--system-prompt") ? ["--system-prompt", plano.promptSistema] : ["--append-system-prompt", plano.promptSistema]),
    ...(temFlag("--no-session-persistence") ? ["--no-session-persistence"] : []),
    "--session-id",
    p.sessaoId,
  ];
}

/** Ambiente do laço de voz: sem raciocínio longo e sem busca de ferramentas (catálogo pequeno, carregado de cara). */
export function ambienteDaLigacao(envBase: Record<string, string>): Record<string, string> {
  return { ...envBase, MAX_THINKING_TOKENS: "0", ENABLE_TOOL_SEARCH: "false" };
}

/** Texto da vez com o aviso de interrupção, quando houve: o modelo sabe até onde a pessoa ouviu. */
export function textoDaVez(texto: string, ouvidoAte?: string): string {
  if (!ouvidoAte) return texto;
  return `[nod] Você foi interrompido; a pessoa ouviu até: "${ouvidoAte.slice(-300)}".\n${texto}`;
}

export type ContextoLigacaoClaude = {
  plano: PlanoTurno;
  sinks: SinksTurno;
  bin: string;
  flagsNoHelp: readonly string[];
  env: Record<string, string>;
  cwdBase: string;
  urlNod: string;
  proxyPath: string;
  nodePath?: string;
  electronComoNode?: boolean;
  sigtermParaSigkillMs?: number;
  /** Modelo do laço de voz: o do plano, ou o do app (NOD_MODELO_LIGACAO_CLAUDE). */
  modelo: string;
  fabricaSocket?: FabricaSocket;
  aoProcesso(p: Processo | null): void;
};

export async function rodarLigacaoClaude(c: ContextoLigacaoClaude): Promise<ResultadoTurno> {
  const { plano, sinks } = c;
  const lig = plano.ligacaoVoz!;
  let sinais: SinaisTurno = { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false };
  // cwd estável por bot (ADR-072, emenda da EMENDA 11): o caminho entra no prompt do CLI, e mudar a cada ligação
  // perderia o cache do prefixo entre ligações.
  const cwd = join(c.cwdBase, `ligacao-${plano.agenteId}`);
  await mkdir(cwd, { recursive: true });
  const tmp = await mkdtemp(join(c.cwdBase, "ligacao-cfg-"));
  let cerebro: CerebroLigacao | null = null;
  try {
    const mcpJson = await escreverMcpConfig(tmp, { url: c.urlNod, tokenDeTurno: plano.tokenDeTurno, proxyPath: c.proxyPath, nodePath: c.nodePath, electronComoNode: c.electronComoNode });
    const args = montarArgsLigacao({ plano, mcpJson, modelo: c.modelo, sessaoId: randomUUID(), flagsNoHelp: c.flagsNoHelp });
    cerebro = await conectarCerebro({ urlNod: c.urlNod, token: plano.tokenDeTurno, ligacaoId: lig.ligacaoId, harness: "claude-cli", interrupcao: true, fabrica: c.fabricaSocket });

    const eventos: EventoStream[] = [];
    const pendentes: Promise<void>[] = [];
    let nResposta = 0;
    let seq = 0;
    let rodadas = 0;
    let pedindoResumo = false;
    let capacidadeInterrupcao = false;
    let cancelaFila = false;
    let entradaAberta = true;
    const ferramentasAbertas = new Map<string, string>();

    const proc = iniciarProcesso({
      bin: c.bin,
      args,
      env: ambienteDaLigacao(c.env),
      cwd,
      sigtermParaSigkillMs: c.sigtermParaSigkillMs,
      aoLinha(linha) {
        // Capacidades e respostas de controle não viram EventoStream: lidas cruas.
        if (linha.includes('"capabilities"') || linha.includes('"control_response"')) {
          try {
            const o = JSON.parse(linha) as { type?: string; subtype?: string; capabilities?: unknown };
            if (o.type === "system" && o.subtype === "init" && Array.isArray(o.capabilities)) {
              capacidadeInterrupcao = o.capabilities.includes("interrupt_receipt_v1");
              cancelaFila = o.capabilities.includes("interrupt_cancel_queued_v1");
            }
          } catch {
            // linha que não é JSON: o interpretador abaixo a ignora
          }
        }
        const ev = interpretarLinhaStreamJson(linha);
        if (ev.tipo === "ignorado") return;
        eventos.push(ev);
        sinks.evento(ev);
        const depois = reduzirSinais(sinais, ev);
        for (const k of ["attempted", "rejected", "promptSubmitted", "producedOutput"] as const) if (depois[k] && !sinais[k]) pendentes.push(sinks.sinal(k));
        sinais = depois;
        if (pedindoResumo) {
          // medido em 2026-10-04 (UAT com o CLI 2.1.289): o pedido de resumo escrito com uma volta em curso entra NESSA
          // volta (ADR-067) — vem um `result` só. Esperar um segundo deixava o processo aberto para sempre.
          if (ev.tipo === "result") {
            rodadas++;
            fecharEntrada();
          }
          return;
        }
        if (ev.tipo === "delta" && nResposta > 0 && ev.texto !== "") cerebro?.enviar({ t: "fala", n: nResposta, seq: seq++, delta: ev.texto });
        else if (ev.tipo === "tool_use") {
          ferramentasAbertas.set(ev.id, ev.nome);
          cerebro?.enviar({ t: "atividade", tipo: "inicio", nome: ev.nome });
        } else if (ev.tipo === "tool_result") {
          const nome = ferramentasAbertas.get(ev.toolUseId);
          ferramentasAbertas.delete(ev.toolUseId);
          if (nome) cerebro?.enviar({ t: "atividade", tipo: "fim", nome });
        } else if (ev.tipo === "result") {
          rodadas++;
          if (nResposta > 0) cerebro?.enviar({ t: "fala-fim", n: nResposta });
        }
      },
    });
    c.aoProcesso(proc);

    function fecharEntrada(): void {
      if (!entradaAberta) return;
      entradaAberta = false;
      proc.fecharStdin();
    }
    const escrever = (texto: string) => {
      if (entradaAberta) proc.escrever(mensagemClaude(texto, []));
    };
    const pedirResumo = () => {
      if (pedindoResumo || !entradaAberta) return;
      pedindoResumo = true;
      escrever(PEDIDO_DE_RESUMO);
      // definido em 2026-10-04: sem resposta em 45 s (CLI preso numa ferramenta), fecha mesmo assim.
      setTimeout(fecharEntrada, 45_000).unref();
    };

    cerebro.aoMensagem((m: MsgCerebroServidor) => {
      switch (m.t) {
        case "vez":
          if (pedindoResumo) return;
          // A vez 0 é o aquecimento (o servidor já cumprimentou a pessoa): a resposta a ela não é falada.
          nResposta = m.n;
          escrever(textoDaVez(m.texto, m.ouvidoAte));
          return;
        case "nota":
          if (pedindoResumo) return;
          // Nota com `n`: o servidor quer que o bot fale a resposta (ex.: "terminei a tarefa") numa brecha.
          if (typeof m.n === "number") nResposta = m.n;
          escrever(m.confiavel ? m.texto : `[nod] Conteúdo de fora, não é pedido da pessoa:\n${m.texto}`);
          return;
        case "interromper":
          if (m.modo === "duro" && capacidadeInterrupcao && entradaAberta) {
            proc.escrever(`${JSON.stringify({ type: "control_request", request_id: `int_${randomUUID()}`, request: { subtype: "interrupt", ...(cancelaFila ? { cancel_queued: true } : {}) } })}\n`);
          }
          return;
        case "fim":
          pedirResumo();
          return;
        default:
          return;
      }
    });
    cerebro.aoFim(() => {
      // O servidor sumiu de vez: sem resumo falado, encerra a sessão e entrega o que houver.
      if (!pedindoResumo) pedirResumo();
    });

    // ADR-009: promptSubmitted antes do primeiro byte no stdin. A primeira mensagem vem do servidor (a vez 0); até lá o
    // CLI já subiu e conectou o MCP.
    sinais = { ...sinais, promptSubmitted: true };
    await sinks.sinal("promptSubmitted");

    const fim = await proc.fim;
    await Promise.all(pendentes);
    log("info", "ligacao_laco_encerrado", { turno_id: plano.turnoId, rodadas, exit: fim.erroSpawn ? null : fim.exitCode });
    const resultado = classificarSessao({
      eventos,
      exitCode: fim.erroSpawn ? null : fim.exitCode,
      signal: fim.erroSpawn ? null : fim.signal,
      stderr: fim.stderr,
      sinais,
      interrompidoPeloDriver: proc.interrompido(),
      // Só a volta do resumo vai na entrega: as outras já foram faladas na ligação.
      rodadasJaFaladas: pedindoResumo ? Math.max(0, rodadas - 1) : rodadas,
    });
    // Sessão efêmera: o CLI não guarda (--no-session-persistence); nada de `--resume` depois.
    return { ...resultado, sessaoCli: null };
  } finally {
    cerebro?.fechar();
    c.aoProcesso(null);
    await rm(tmp, { recursive: true, force: true });
  }
}
