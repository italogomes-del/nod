import { describe, expect, it } from "vitest";
import type { FrameSse } from "../../../src/contracts/frame.ts";
import { calcularBackoffMs, criarLiveEvents, interpretarFrame, urlComSince, type EventoLive, type FonteSse } from "../../../web/lib/live-events.ts";

type Ouvinte = (ev: { data?: unknown; lastEventId?: string }) => void;

/** EventSource falso: o teste dispara open/error/frames à mão. */
class FonteFalsa implements FonteSse {
  ouvintes = new Map<string, Ouvinte[]>();
  fechada = false;
  url: string;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(tipo: string, fn: Ouvinte): void {
    this.ouvintes.set(tipo, [...(this.ouvintes.get(tipo) ?? []), fn]);
  }
  close(): void {
    this.fechada = true;
  }
  disparar(tipo: string, ev: { data?: unknown; lastEventId?: string } = {}): void {
    for (const fn of this.ouvintes.get(tipo) ?? []) fn(ev);
  }
  frame(f: FrameSse): void {
    this.disparar(f.tipo, { data: JSON.stringify(f), lastEventId: `${f.streamId}:${f.seq}` });
  }
}

function montar(aleatorio = () => 0.5) {
  const fontes: FonteFalsa[] = [];
  const timers: { fn: () => void; ms: number; cancelado: boolean }[] = [];
  const eventos: EventoLive[] = [];
  let reidratacoes = 0;
  const live = criarLiveEvents("/api/t/t1/eventos", {
    aoReidratar: () => {
      reidratacoes += 1;
    },
    criarFonte: (url) => {
      const f = new FonteFalsa(url);
      fontes.push(f);
      return f;
    },
    agendar: (fn, ms) => {
      const t = { fn, ms, cancelado: false };
      timers.push(t);
      return t;
    },
    cancelar: (id) => {
      (id as { cancelado: boolean }).cancelado = true;
    },
    aleatorio,
  });
  live.subscribe((ev) => eventos.push(ev));
  return { live, fontes, timers, eventos, reidratacoes: () => reidratacoes };
}

const frame = (seq: number, tipo: FrameSse["tipo"] = "mensagem.nova", streamId = "s1"): FrameSse => ({ streamId, seq, pessoaId: "p", tipo, dados: { seq } });

describe("live-events: interface de 4 campos sobre EventSource (ADR-016)", () => {
  it("connect abre a fonte; resumed:false dispara reidratação; frames chegam na ordem e duplicata é descartada", () => {
    const m = montar();
    m.live.connect();
    expect(m.fontes).toHaveLength(1);
    expect(m.fontes[0]?.url).toBe("/api/t/t1/eventos");
    m.fontes[0]?.disparar("open");
    m.fontes[0]?.frame({ streamId: "s1", seq: 0, pessoaId: "p", tipo: "resumed", dados: { resumed: false } });
    expect(m.reidratacoes()).toBe(1);
    m.fontes[0]?.frame(frame(1));
    m.fontes[0]?.frame(frame(2, "turno.delta"));
    m.fontes[0]?.frame(frame(2, "turno.delta"));
    m.fontes[0]?.frame(frame(1));
    const frames = m.eventos.filter((e): e is Extract<EventoLive, { tipo: "frame" }> => e.tipo === "frame");
    expect(frames.map((e) => e.frame.seq)).toEqual([1, 2]);
    expect(m.eventos.filter((e) => e.tipo === "conexao").map((e) => (e.tipo === "conexao" ? e.estado : ""))).toEqual(["conectando", "aberto"]);
  });

  it("erro fecha a fonte, agenda reconexão com backoff+jitter e reconecta com ?since=<último id>", () => {
    const m = montar(() => 0.5);
    m.live.connect();
    m.fontes[0]?.disparar("open");
    m.fontes[0]?.frame(frame(1));
    m.fontes[0]?.frame(frame(2));
    m.fontes[0]?.disparar("error");
    expect(m.fontes[0]?.fechada).toBe(true);
    expect(m.timers).toHaveLength(1);
    expect(m.timers[0]?.ms).toBe(1000);
    const reconectando = m.eventos.find((e) => e.tipo === "conexao" && e.estado === "reconectando");
    expect(reconectando).toMatchObject({ tentativa: 1, proximaEmMs: 1000 });
    m.timers[0]?.fn();
    expect(m.fontes).toHaveLength(2);
    expect(m.fontes[1]?.url).toBe("/api/t/t1/eventos?since=s1%3A2");
    // Replay completo 3 e depois resumed:true: sem reidratar.
    m.fontes[1]?.disparar("open");
    m.fontes[1]?.frame(frame(3));
    m.fontes[1]?.frame({ streamId: "s1", seq: 3, pessoaId: "p", tipo: "resumed", dados: { resumed: true } });
    expect(m.reidratacoes()).toBe(0);
    expect(m.eventos.filter((e) => e.tipo === "frame")).toHaveLength(3);
    // Segundo erro dobra a espera; após 'open' a tentativa volta a zero.
    m.fontes[1]?.disparar("error");
    expect(m.timers[1]?.ms).toBe(1000);
    m.timers[1]?.fn();
    m.fontes[2]?.disparar("error");
    expect(m.timers[2]?.ms).toBe(2000);
  });

  it("resumed:false depois de buffer podado reidrata e passa a seguir o stream novo", () => {
    const m = montar();
    m.live.connect();
    m.fontes[0]?.frame(frame(5));
    m.fontes[0]?.disparar("error");
    m.timers[0]?.fn();
    m.fontes[1]?.frame({ streamId: "s2", seq: 0, pessoaId: "p", tipo: "resumed", dados: { resumed: false } });
    expect(m.reidratacoes()).toBe(1);
    m.fontes[1]?.frame(frame(1, "mensagem.nova", "s2"));
    expect(m.eventos.filter((e) => e.tipo === "frame").map((e) => (e.tipo === "frame" ? `${e.frame.streamId}:${e.frame.seq}` : ""))).toEqual(["s1:5", "s2:1"]);
    m.fontes[1]?.disparar("error");
    m.timers[1]?.fn();
    expect(m.fontes[2]?.url).toBe("/api/t/t1/eventos?since=s2%3A1");
  });

  it("disconnect fecha, cancela o timer pendente e ignora eventos tardios; connect de novo reabre", () => {
    const m = montar();
    m.live.connect();
    m.fontes[0]?.disparar("error");
    m.live.disconnect();
    expect(m.timers[0]?.cancelado).toBe(true);
    m.fontes[0]?.frame(frame(9));
    expect(m.eventos.filter((e) => e.tipo === "frame")).toHaveLength(0);
    expect(m.eventos.at(-1)).toMatchObject({ tipo: "conexao", estado: "parado" });
    m.live.connect();
    expect(m.fontes).toHaveLength(2);
    expect(() => m.live.send({})).toThrow(/REST/);
  });

  it("retomar (ADR-094): com a conexão aberta não faz nada; caída, reabre na hora sem esperar o backoff", () => {
    const m = montar();
    m.live.connect();
    m.fontes[0]?.disparar("open");
    m.fontes[0]?.frame(frame(4));
    // Trocar de aba / voltar ao app com o stream vivo: nenhuma fonte nova, nenhum timer, nenhuma reidratação.
    m.live.retomar();
    m.live.retomar();
    expect(m.fontes).toHaveLength(1);
    expect(m.fontes[0]?.fechada).toBe(false);
    expect(m.timers).toHaveLength(0);
    // Abrindo (antes do open) também não: o navegador avisa com error se não conseguir.
    m.fontes[0]?.disparar("error");
    for (let i = 0; i < 5; i++) {
      m.timers.at(-1)?.fn();
      m.fontes.at(-1)?.disparar("error");
    }
    const esperando = m.timers.at(-1);
    expect(esperando?.ms).toBe(30000);
    const antes = m.fontes.length;
    m.live.retomar();
    expect(esperando?.cancelado).toBe(true);
    expect(m.fontes).toHaveLength(antes + 1);
    expect(m.fontes.at(-1)?.url).toBe("/api/t/t1/eventos?since=s1%3A4");
    m.live.retomar();
    expect(m.fontes).toHaveLength(antes + 1);
    // Desligado (sem sessão), retomar não reabre.
    m.live.disconnect();
    m.live.retomar();
    expect(m.fontes).toHaveLength(antes + 1);
  });

  it("backoff: 1s → 30s com jitter ±30%", () => {
    expect(calcularBackoffMs(1, () => 0.5)).toBe(1000);
    expect(calcularBackoffMs(2, () => 0.5)).toBe(2000);
    expect(calcularBackoffMs(6, () => 0.5)).toBe(30000);
    expect(calcularBackoffMs(20, () => 0.5)).toBe(30000);
    expect(calcularBackoffMs(1, () => 0)).toBe(700);
    expect(calcularBackoffMs(1, () => 0.999)).toBeGreaterThanOrEqual(1299);
    expect(calcularBackoffMs(1, () => 0.999)).toBeLessThanOrEqual(1300);
  });

  it("interpretarFrame recusa lixo; urlComSince respeita query existente", () => {
    expect(interpretarFrame("não json")).toBeNull();
    expect(interpretarFrame(JSON.stringify({ streamId: "s", seq: 1, pessoaId: "p", tipo: "inventado" }))).toBeNull();
    expect(interpretarFrame(JSON.stringify({ streamId: "s", seq: 1, pessoaId: "p", tipo: "negacao" }))).toEqual({ streamId: "s", seq: 1, pessoaId: "p", tipo: "negacao", dados: {} });
    expect(interpretarFrame(42)).toBeNull();
    expect(urlComSince("/e", null)).toBe("/e");
    expect(urlComSince("/e?x=1", "s:1")).toBe("/e?x=1&since=s%3A1");
  });
});
