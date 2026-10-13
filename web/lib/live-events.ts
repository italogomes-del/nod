import type { FrameSse, TipoFrame } from "../../src/contracts/frame.ts";

/**
 * Transporte servidor→navegador atrás de uma interface de 4 campos (ADR-016): quem consome não
 * sabe que é EventSource. Backoff 1 s → 30 s com jitter ±30% (definido em 2026-09-16: evita o
 * rebanho de 19 abas reconectando no mesmo milissegundo após um reinício). Reconexão é MANUAL
 * (fecha e reabre com `?since=<último id>`), porque o EventSource nativo não deixa controlar o
 * backoff nem o jitter. Contrato de resume no servidor: src/services/barramento.ts.
 *
 * `resumed:false` = o servidor não conseguiu retomar (primeira conexão, buffer podado ou stream
 * novo): o cliente reidrata por REST (`aoReidratar`) — nunca aplica replay parcial.
 * `send` não existe de fato: comandos vão por REST; chamar lança para ninguém confiar em silêncio.
 */
export type EstadoConexao = "parado" | "conectando" | "aberto" | "reconectando";

export type EventoLive =
  | { tipo: "frame"; frame: FrameSse }
  | { tipo: "resumed"; resumed: boolean; streamId: string; seq: number }
  | { tipo: "conexao"; estado: EstadoConexao; tentativa: number; proximaEmMs: number | null };

export type LiveEvents = {
  connect: () => void;
  disconnect: () => void;
  subscribe: (fn: (ev: EventoLive) => void) => () => void;
  send: (cmd: unknown) => void;
  /**
   * A página voltou (aba à frente, rede de volta, app reaberto no celular). Só reabre se a conexão caiu de fato e
   * está esperando o backoff; aberta (ou abrindo), não faz nada: trocar de aba não derruba o stream nem relê nada.
   */
  retomar: () => void;
};

/** O que usamos do EventSource (o nativo do navegador satisfaz; o teste injeta um falso). */
export interface FonteSse {
  addEventListener(tipo: string, ouvinte: (ev: { data?: unknown; lastEventId?: string }) => void): void;
  close(): void;
}

export interface OpcoesLiveEvents {
  aoReidratar?: () => void;
  criarFonte?: (url: string) => FonteSse;
  agendar?: (fn: () => void, ms: number) => unknown;
  cancelar?: (id: unknown) => void;
  /** [0,1) — injetável para o teste fixar o jitter. */
  aleatorio?: () => number;
  baseMs?: number;
  tetoMs?: number;
}

/** definido em 2026-09-16: 1 s dobrando até 30 s, jitter ±30%. */
export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_TETO_MS = 30_000;
export const JITTER = 0.3;

export function calcularBackoffMs(tentativa: number, aleatorio: () => number, baseMs = BACKOFF_BASE_MS, tetoMs = BACKOFF_TETO_MS): number {
  const exp = Math.min(tetoMs, baseMs * 2 ** Math.max(0, tentativa - 1));
  const fator = 1 + (aleatorio() * 2 - 1) * JITTER;
  return Math.round(exp * fator);
}

/** Todos os tipos de frame: o compilador exige a chave nova quando o contrato ganhar um tipo (a web não importa valores de src). */
const TIPOS: Record<TipoFrame, true> = {
  "mensagem.nova": true,
  "turno.iniciado": true,
  "turno.delta": true,
  "turno.atividade": true,
  "turno.tarefas": true,
  "turno.fala": true,
  "turno.vigia": true,
  "turno.encerrado": true,
  "turno.interrompido": true,
  "decisao.nova": true,
  "decisao.decidida": true,
  "decisao.vencida": true,
  "proposta.nova": true,
  "rotina.criada": true,
  "rotina.executou": true,
  "sala.handoff": true,
  negacao: true,
  "computador.mudou": true,
  "inventario.mudou": true,
  "contas.mudou": true,
  "agente.mudou": true,
  "parada.faixa": true,
  "relato.criado": true,
  "ligacao.mudou": true,
  "trabalho.mudou": true,
  "memoria.mudou": true,
  resumed: true,
};

export function interpretarFrame(data: unknown): FrameSse | null {
  if (typeof data !== "string") return null;
  try {
    const obj: unknown = JSON.parse(data);
    if (typeof obj !== "object" || obj === null) return null;
    const f = obj as Partial<FrameSse>;
    if (typeof f.streamId !== "string" || typeof f.seq !== "number" || typeof f.pessoaId !== "string" || typeof f.tipo !== "string") return null;
    if (!(f.tipo in TIPOS)) return null;
    return { streamId: f.streamId, seq: f.seq, pessoaId: f.pessoaId, tipo: f.tipo as TipoFrame, dados: typeof f.dados === "object" && f.dados !== null ? f.dados : {} };
  } catch {
    return null;
  }
}

export function urlComSince(url: string, ultimoId: string | null): string {
  if (!ultimoId) return url;
  return `${url}${url.includes("?") ? "&" : "?"}since=${encodeURIComponent(ultimoId)}`;
}

export function criarLiveEvents(url: string, opcoes: OpcoesLiveEvents = {}): LiveEvents {
  const criarFonte = opcoes.criarFonte ?? ((u: string): FonteSse => new EventSource(u));
  const agendar = opcoes.agendar ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const cancelar = opcoes.cancelar ?? ((id: unknown) => clearTimeout(id as ReturnType<typeof setTimeout>));
  const aleatorio = opcoes.aleatorio ?? Math.random;

  const ouvintes = new Set<(ev: EventoLive) => void>();
  let fonte: FonteSse | null = null;
  let timer: unknown = null;
  let tentativa = 0;
  let ultimoId: string | null = null;
  let ultimo: { streamId: string; seq: number } | null = null;
  let ativo = false;

  const emitir = (ev: EventoLive): void => {
    for (const fn of ouvintes) fn(ev);
  };

  const aoFrame = (frame: FrameSse, lastEventId: string | undefined): void => {
    // Duplicata (mesmo stream, seq já visto) é descartada: o servidor entrega pelo menos uma vez.
    if (ultimo && ultimo.streamId === frame.streamId && frame.seq <= ultimo.seq && frame.tipo !== "resumed") return;
    ultimo = { streamId: frame.streamId, seq: frame.seq };
    ultimoId = lastEventId && lastEventId !== "" ? lastEventId : `${frame.streamId}:${frame.seq}`;
    if (frame.tipo === "resumed") {
      const resumed = frame.dados.resumed === true;
      emitir({ tipo: "resumed", resumed, streamId: frame.streamId, seq: frame.seq });
      if (!resumed) opcoes.aoReidratar?.();
      return;
    }
    emitir({ tipo: "frame", frame });
  };

  const fechar = (): void => {
    if (fonte) {
      fonte.close();
      fonte = null;
    }
    if (timer !== null) {
      cancelar(timer);
      timer = null;
    }
  };

  const abrir = (): void => {
    if (!ativo) return;
    emitir({ tipo: "conexao", estado: tentativa === 0 ? "conectando" : "reconectando", tentativa, proximaEmMs: null });
    const f = criarFonte(urlComSince(url, ultimoId));
    fonte = f;
    f.addEventListener("open", () => {
      if (fonte !== f) return;
      tentativa = 0;
      emitir({ tipo: "conexao", estado: "aberto", tentativa: 0, proximaEmMs: null });
    });
    f.addEventListener("error", () => {
      if (fonte !== f) return;
      f.close();
      fonte = null;
      if (!ativo) return;
      tentativa += 1;
      const espera = calcularBackoffMs(tentativa, aleatorio, opcoes.baseMs, opcoes.tetoMs);
      emitir({ tipo: "conexao", estado: "reconectando", tentativa, proximaEmMs: espera });
      timer = agendar(() => {
        timer = null;
        abrir();
      }, espera);
    });
    for (const tipo of Object.keys(TIPOS)) {
      f.addEventListener(tipo, (ev) => {
        if (fonte !== f) return;
        const frame = interpretarFrame(ev.data);
        if (frame) aoFrame(frame, ev.lastEventId);
      });
    }
  };

  return {
    connect() {
      if (ativo) return;
      ativo = true;
      tentativa = 0;
      abrir();
    },
    disconnect() {
      ativo = false;
      fechar();
      emitir({ tipo: "conexao", estado: "parado", tentativa: 0, proximaEmMs: null });
    },
    subscribe(fn) {
      ouvintes.add(fn);
      return () => {
        ouvintes.delete(fn);
      };
    },
    retomar() {
      // definido em 2026-10-10 (ADR-094): no celular o sistema derruba o socket com o app em segundo plano e o backoff
      // chega a 30 s depois de várias tentativas sem rede; quem voltou não espera a próxima tentativa.
      if (!ativo || fonte || timer === null) return;
      cancelar(timer);
      timer = null;
      abrir();
    },
    send() {
      throw new Error("live-events é só servidor→navegador (ADR-016): comandos vão por REST em web/lib/api.ts");
    },
  };
}
