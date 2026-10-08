import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import type { EsforcoAgente } from "../../../contracts/agente.ts";
import type { PlanoTurno } from "../../../contracts/plano-turno.ts";
import type { EventoStream, ResultadoTurno, SinaisTurno, TokensTurno } from "../../../contracts/turno.ts";
import { pedidoThreadStart, pedidoTurnStart, type EsforcoCodex, type EventoAppServer } from "../../../domain/codex-app-server.ts";
import { ultimaLinhaUtil } from "../../../domain/codex-stream.ts";
import { criarFalaDoMeio } from "../../../domain/mensagem-no-meio.ts";
import { classificarSessao, reduzirSinais, SINAIS_ZERADOS, textoDaRodada } from "../../../domain/stream-json.ts";
import { log } from "../../../obs/log.ts";
import type { Processo } from "../processo.ts";
import type { SinksTurno } from "../spi.ts";
import { criarClienteAppServer } from "./cliente-app-server.ts";
import { configMcpCodex, escreverLauncherProxy, type RecusadasCodex } from "./codex-comum.ts";
import { argsAppServer } from "./codex-ligacao.ts";

/**
 * O chat do Codex no `codex app-server` (definido em 2026-10-07, ADR-081 §6, decisão S4). O `codex exec` é um prompt
 * por turno, sem sessão: a mensagem da pessoa no meio do trabalho esperava o turno acabar. Aqui o turno é uma thread
 * (não efêmera) aberta enquanto o bot trabalha, com a mesma sessão viva do Claude (ADR-067): cada volta do modelo
 * fecha com um `turn/completed` (vira um `result`), a mensagem nova entra pelo `turn/steer` no turno ativo (ou abre o
 * próximo `turn/start`) e, sem nada novo, a entrada fecha e o processo sai.
 *
 * O que continua igual ao `codex exec`: o proxy do nod pelo launcher 0600, as chaves de isolamento negociadas na sonda,
 * a sandbox conforme as pastas, `sessaoCli` null (retomaSessao=false até `thread/resume` ser medido). Sem app-server,
 * ou se ele não sobe, quem chama segue no `codex exec`.
 *
 * NÃO HOMOLOGADO: só exercitado contra o app-server falso (tests/fixtures/codex-falso.mjs). O passo "steer no chat"
 * da sonda paga (scripts/sonda-codex-app-server.ts) é o que confirma no Codex real.
 */

/** definido em 2026-10-07: o mesmo prazo do handshake da ligação (só o subir; não é relógio de trabalho, ADR-067). */
const PRAZO_HANDSHAKE_MS = 30_000;
/** definido em 2026-10-07: depois de fechar a entrada, o tempo que o app-server tem para sair sozinho. */
const SAIDA_APOS_FIM_MS = 2_000;

/**
 * definido em 2026-10-07: o esforço do bot no vocabulário do Codex. O `max` do Claude não existe lá; vira o maior
 * (`xhigh`). Sem esforço escolhido, o campo não vai e vale o padrão do modelo (o `codex exec` nunca o mandou).
 */
const ESFORCO_CODEX: Record<EsforcoAgente, EsforcoCodex> = { low: "low", medium: "medium", high: "high", xhigh: "xhigh", max: "xhigh" };

/** O que o adapter repassa ao laço enquanto a thread está viva. */
export type SessaoChatCodex = { aceitaMensagens(): boolean; receberMensagem(texto: string): boolean };

export type ContextoChatCodex = {
  plano: PlanoTurno;
  sinks: SinksTurno;
  bin: string;
  flagsNoHelp: readonly string[];
  recusadas?: RecusadasCodex;
  env: Record<string, string>;
  cwdBase: string;
  urlNod: string;
  proxyPath: string;
  nodePath?: string;
  electronComoNode?: boolean;
  sigtermParaSigkillMs?: number;
  versaoNod?: string;
  aoProcesso(p: Processo | null): void;
  aoSessao(s: SessaoChatCodex | null): void;
};

const TOKENS_ZERADOS: TokensTurno = { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 };
const menos = (a: TokensTurno, b: TokensTurno): TokensTurno => ({
  entrada: Math.max(0, a.entrada - b.entrada),
  saida: Math.max(0, a.saida - b.saida),
  cacheLeitura: Math.max(0, a.cacheLeitura - b.cacheLeitura),
  cacheCriacao: 0,
});

/** O turno inteiro no app-server; null = o app-server não subiu (quem chama roda o `codex exec`). */
export async function rodarChatCodex(c: ContextoChatCodex): Promise<ResultadoTurno | null> {
  const { plano, sinks } = c;
  const pastas = plano.workspacePastas ?? null;
  // Sem pasta, o cwd é estável por bot (como o do Claude, NOD-188); com pasta, a ativa.
  const cwd = pastas?.ativa ?? join(c.cwdBase, `texto-${plano.agenteId}`);
  if (!pastas) await mkdir(cwd, { recursive: true });
  const dir = await mkdtemp(join(c.cwdBase, "codex-chat-"));
  let timerSaida: ReturnType<typeof setTimeout> | null = null;
  try {
    const launcher = await escreverLauncherProxy(dir, { urlNod: c.urlNod, tokenDeTurno: plano.tokenDeTurno, proxyPath: c.proxyPath });
    const configMcp = configMcpCodex(plano, { urlNod: c.urlNod, proxyPath: launcher, nodePath: c.nodePath, electronComoNode: c.electronComoNode }, c.recusadas);
    const sandbox = pastas ? "workspace-write" : "read-only";
    const args = argsAppServer({ configMcp, flagsNoHelp: c.flagsNoHelp, recusadas: c.recusadas, sandbox });
    const esforco = plano.entrada.esforco ? ESFORCO_CODEX[plano.entrada.esforco] : undefined;

    const eventos: EventoStream[] = [];
    const pendentes: Promise<void>[] = [];
    let sinais: SinaisTurno = { ...SINAIS_ZERADOS, attempted: true };
    const meio = criarFalaDoMeio();
    const falaNaHora = plano.modoTurno !== "sala" && sinks.falaIntermediaria !== undefined;
    // A entrada da sessão: aberta depois do handshake, fechada quando o modelo terminou e nada mais chegou.
    let aberta = false;
    let fila: string[] = [];
    let steersEmVoo = 0;
    let decidindo = false;
    const rodadas: EventoStream[][] = [];
    let inicioDaRodada = 0;
    let rodadasFaladas = 0;
    // `thread/tokenUsage/updated` traz o total da thread; o `result` de cada volta leva a diferença (classificarSessao soma).
    let totalAtual = TOKENS_ZERADOS;
    let totalAnterior = TOKENS_ZERADOS;
    let ultimoErro: string | null = null;
    const ferramentasAbertas = new Map<string, string>();

    const emitir = (ev: EventoStream) => {
      eventos.push(ev);
      sinks.evento(ev);
      if (ev.tipo === "delta") sinks.delta(ev.texto);
      // ADR-081 §6: a resposta à mensagem do meio vira fala gravada agora, não passo do card.
      const resposta = meio.avaliar(ev, falaNaHora);
      if (resposta !== null && falaNaHora) sinks.falaIntermediaria!(resposta);
      const depois = reduzirSinais(sinais, ev);
      for (const k of ["attempted", "rejected", "promptSubmitted", "producedOutput"] as const) if (depois[k] && !sinais[k]) pendentes.push(sinks.sinal(k));
      sinais = depois;
    };

    const fecharRodada = (sucesso: boolean, subtype: string, erroCru: string | null) => {
      const tokens = menos(totalAtual, totalAnterior);
      totalAnterior = totalAtual;
      emitir({ tipo: "result", sucesso, subtype, sessaoCli: null, texto: "", custoUsd: null, tokens, numTurnos: 1, negacoesPermissao: [], erroCru: sucesso ? null : erroCru ?? ultimoErro });
      rodadas.push(eventos.slice(inicioDaRodada));
      inicioDaRodada = eventos.length;
    };

    const falarRodadas = () => {
      if (!falaNaHora) return;
      for (; rodadasFaladas < rodadas.length; rodadasFaladas++) {
        const texto = textoDaRodada(rodadas[rodadasFaladas]!, meio);
        if (texto.trim() !== "") sinks.falaIntermediaria!(texto);
      }
    };

    function tratar(ev: EventoAppServer): void {
      switch (ev.tipo) {
        case "delta":
          if (ev.texto !== "") emitir({ tipo: "delta", texto: ev.texto });
          return;
        case "item":
          if (ev.fase === "fim" && ev.texto !== null && ev.texto.trim() !== "") emitir({ tipo: "texto_bloco", texto: ev.texto });
          if (!ev.ferramenta || !ev.itemId) return;
          if (ev.fase === "inicio") {
            ferramentasAbertas.set(ev.itemId, ev.ferramenta);
            emitir({ tipo: "tool_use", id: ev.itemId, nome: ev.ferramenta, input: null });
          } else if (ferramentasAbertas.delete(ev.itemId)) {
            emitir({ tipo: "tool_result", toolUseId: ev.itemId, isError: ev.falhou, texto: "" });
          }
          return;
        case "uso":
          totalAtual = { ...ev.tokens, cacheCriacao: 0 };
          return;
        case "erro":
          ultimoErro = ev.mensagem ?? ultimoErro;
          log("aviso", "codex_chat_erro_servidor", { turno_id: plano.turnoId, vai_repetir: ev.vaiRepetir });
          return;
        default:
          return;
      }
    }

    const cliente = criarClienteAppServer({
      bin: c.bin,
      args,
      env: c.env,
      cwd,
      sigtermParaSigkillMs: c.sigtermParaSigkillMs,
      aoEvento: tratar,
      aoTurnoConcluido(ev) {
        ultimoErro = ev.erro ?? ultimoErro;
        fecharRodada(ev.status === "completed", ev.status === "completed" ? "success" : ev.status === "interrupted" ? "error_interrupted" : "error_during_execution", ev.erro);
        void decidir();
      },
      aoNegado(metodo) {
        log("aviso", "codex_chat_pedido_negado", { turno_id: plano.turnoId, metodo: metodo.slice(0, 80) });
      },
    });
    const proc = cliente.processo;
    c.aoProcesso(proc);

    const encerrar = () => {
      aberta = false;
      if (cliente.fechando()) return;
      cliente.fechar();
      timerSaida = setTimeout(() => void proc.interromper(), SAIDA_APOS_FIM_MS);
    };

    /** Texto na sessão: steer no turno ativo, senão espera o turno abrir (ou o próximo). */
    const mandar = (texto: string) => {
      if (cliente.turno().estado !== "ativo") return void fila.push(texto);
      steersEmVoo += 1;
      cliente.steer(texto, (aceito) => {
        steersEmVoo -= 1;
        // O turno acabou antes de o steer chegar: o texto abre o próximo turno.
        if (!aceito) fila.push(texto);
        if (cliente.turno().estado === "livre") void decidir();
      });
    };

    const iniciar = (texto: string) => {
      cliente.iniciarTurno((id, threadId) => pedidoTurnStart(id, { threadId, texto, ...(esforco ? { esforco } : {}) }), (id, r) => {
        if (id === null) {
          log("aviso", "codex_chat_turno_recusado", { turno_id: plano.turnoId, codigo: r.tipo === "resposta_erro" ? r.codigo : null });
          fecharRodada(false, "error_during_execution", r.tipo === "resposta_erro" ? "turno_recusado" : null);
          return void decidir();
        }
        const juntos = fila;
        fila = [];
        for (const t of juntos) mandar(t);
      });
    };

    /**
     * Depois de cada volta (ADR-067, como o `aposRodada` do Claude): o que chegou abre a próxima; sem nada, pergunta ao
     * laço se a pessoa escreveu (`ocioso`); sem nada de novo, fecha a entrada e o app-server sai.
     */
    async function decidir(): Promise<void> {
      if (decidindo || steersEmVoo > 0 || cliente.turno().estado !== "livre") return;
      decidindo = true;
      try {
        if (aberta && fila.length === 0 && sinks.ocioso) await sinks.ocioso();
        if (aberta && fila.length > 0 && !cliente.fechando()) {
          falarRodadas();
          const juntos = fila;
          fila = [];
          return iniciar(juntos.join("\n\n"));
        }
        encerrar();
      } catch {
        encerrar();
      } finally {
        decidindo = false;
      }
    }

    c.aoSessao({
      aceitaMensagens: () => aberta && !cliente.fechando(),
      receberMensagem(texto) {
        if (!aberta || cliente.fechando()) return false;
        meio.absorveu();
        mandar(texto);
        return true;
      },
    });

    try {
      await cliente.abrirThread({
        versaoNod: c.versaoNod ?? "0",
        prazoMs: PRAZO_HANDSHAKE_MS,
        threadStart: (id) => pedidoThreadStart(id, { modelo: plano.entrada.modelo, instrucoes: plano.promptSistema, cwd, sandbox, efemera: false }),
      });
    } catch (e) {
      // Nada foi escrito para o modelo ainda: o turno segue no `codex exec`, como sem app-server.
      log("aviso", "codex_chat_app_server_falhou", { turno_id: plano.turnoId, erro: e instanceof Error ? e.message.slice(0, 80) : "handshake" });
      return null;
    }
    emitir({ tipo: "init", sessaoCli: null, ferramentas: plano.catalogo.ferramentas.map((f) => f.nomeMcp), modelo: plano.entrada.modelo, versaoCli: "codex-app-server", apiKeySource: "none" });
    // ADR-009: promptSubmitted gravado antes de o prompt sair para o app-server.
    await Promise.all(pendentes);
    aberta = true;
    iniciar(plano.entrada.texto);

    const fim = await proc.fim;
    aberta = false;
    await Promise.all(pendentes);
    const r = classificarSessao({
      eventos,
      exitCode: fim.erroSpawn ? null : fim.exitCode,
      signal: fim.erroSpawn ? null : fim.signal,
      stderr: fim.stderr,
      sinais,
      // Fechar a entrada e matar o que não saiu sozinho é o fim normal, não um Parar.
      interrompidoPeloDriver: proc.interrompido() && !cliente.fechando(),
      rodadasJaFaladas: rodadasFaladas,
      falaDoMeio: meio,
    });
    const erroCru = r.desfecho === "sucesso" ? r.erroCru : r.erroCru ?? ultimoErro ?? ultimaLinhaUtil(fim.stderr);
    return { ...r, erroCru, sessaoCli: null };
  } finally {
    if (timerSaida) clearTimeout(timerSaida);
    c.aoSessao(null);
    c.aoProcesso(null);
    await rm(dir, { recursive: true, force: true });
  }
}
