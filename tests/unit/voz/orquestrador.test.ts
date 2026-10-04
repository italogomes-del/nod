import { describe, expect, it } from "vitest";
import type { MsgCerebroServidor, MsgMidiaServidor } from "../../../src/contracts/voz.ts";
import { criarServicoVoz, type FalaParaGravar, type MetricasVoz, type RegistroLigacao } from "../../../src/adapters/voz/orquestrador.ts";
import { criarProvedoresFalsos } from "../../../src/adapters/voz/voz-falsa.ts";
import type { CanalVoz } from "../../../src/adapters/voz/ws.ts";
import type { MotivoFimLigacao } from "../../../src/contracts/voz.ts";

/**
 * Orquestrador de voz com canais e provedores falsos (definido em 2026-10-04, ADR-071/073/074): sem socket, sem banco,
 * com prazos curtos. O e2e (tests/concurrency/ligacao-catcher.test.ts) cobre o caminho feliz pelo servidor inteiro;
 * aqui ficam as bordas — interrupção, backchannel, quedas, tempo máximo e comando de voz.
 */
type CanalFalso = CanalVoz & { json: Record<string, unknown>[]; binarios: number; fechadoCom: number | null; receber(m: object | Uint8Array): void; cair(): void };

function canalFalso(): CanalFalso {
  let aoMsg: ((m: { texto: string } | { binario: Uint8Array }) => void) | null = null;
  let aoFim: ((c: number) => void) | null = null;
  const c: CanalFalso = {
    json: [],
    binarios: 0,
    fechadoCom: null,
    enviarJson(m) { c.json.push(m as Record<string, unknown>); },
    enviarBinario() { c.binarios++; },
    fechar(codigo) { c.fechadoCom = codigo; },
    aoMensagem(fn) { aoMsg = fn; },
    aoFechar(fn) { aoFim = fn; },
    pendente: () => 0,
    receber(m) { aoMsg?.(m instanceof Uint8Array ? { binario: m } : { texto: JSON.stringify(m) }); },
    cair() { aoFim?.(1006); },
  };
  return c;
}

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function ate<T>(f: () => T | undefined | null | false, ms = 3000): Promise<T> {
  const fim = Date.now() + ms;
  for (;;) {
    const v = f();
    if (v) return v;
    if (Date.now() > fim) throw new Error("tempo esgotado");
    await dormir(10);
  }
}

function quadro(seq: number, voz: boolean): Uint8Array {
  const b = new Uint8Array(5 + 640);
  const v = new DataView(b.buffer);
  v.setUint8(0, 1);
  v.setUint32(1, seq, true);
  for (let i = 0; i < 320; i++) v.setInt16(5 + i * 2, voz ? Math.round(Math.sin((i + seq * 320) / 6) * 9000) : 0, true);
  return b;
}

function montar(o: { roteiro?: string[]; maxS?: number; prazos?: Record<string, number> } = {}) {
  const provedores = criarProvedoresFalsos({ roteiro: o.roteiro ?? [], silencioso: true });
  const falas: FalaParaGravar[] = [];
  const fins: { motivo: MotivoFimLigacao; metricas: MetricasVoz }[] = [];
  const voz = criarServicoVoz({
    provedores,
    persistencia: {
      atender: async () => undefined,
      gravarFala: async (_r, f) => { falas.push(f); },
      encerrar: async (_r, motivo, metricas) => { fins.push({ motivo, metricas }); },
    },
    aleatorio: () => 0.99,
    prazos: { midiaReconexaoMs: 100, cerebroReconexaoMs: 150, cerebroPrimeiroMs: 5000, confirmarInterrupcaoMs: 300, resumoMs: 50, ...o.prazos },
  });
  const reg: RegistroLigacao = { ligacaoId: "l1", tenantId: "t", pessoaId: "p", agenteId: "a", conversaId: "c", turnoId: "turno", voz: "clara", velocidade: 1, nomeBot: "Nina", genero: "feminina", maxS: o.maxS ?? 600 };
  voz.registrar(reg);
  const midia = canalFalso();
  const cerebro = canalFalso();
  return { voz, provedores, falas, fins, midia, cerebro };
}

/** O "alto-falante" do teste: relata que tudo o que já foi mandado terminou de tocar. */
function tocouTudo(midia: CanalFalso): void {
  for (const m of midia.json) if (m.t === "bot-fala") midia.receber({ t: "tocou-fim", utt: m.utt });
}

const msgs = (c: CanalFalso, t: string) => c.json.filter((m) => m.t === t) as (MsgMidiaServidor & MsgCerebroServidor & Record<string, unknown>)[];

describe("orquestrador de voz", () => {
  it("anexa mídia e cérebro: saúda, aquece o cérebro com a vez 0 e recusa segunda mídia sem retomar", async () => {
    const { voz, midia, cerebro } = montar();
    expect(voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia })).toBeNull();
    expect(voz.anexarMidia({ pessoaId: "outra", ligacaoId: "l1", retomar: false, canal: canalFalso() })).toBe(4404);
    expect(voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: canalFalso() })).toBe(4409);
    expect(msgs(midia, "pronto")).toHaveLength(1);
    expect(msgs(midia, "bot-fala")[0]?.texto).toBe("Oi! Aqui é Nina.");
    expect(voz.anexarCerebro({ turnoId: "outro", ligacaoId: "l1", canal: cerebro })).toBe(4404);
    expect(voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro })).toBeNull();
    expect(msgs(cerebro, "vez")[0]).toMatchObject({ n: 0 });
    expect(msgs(midia, "cerebro").at(-1)).toMatchObject({ online: true });
  });

  it("texto vira vez; a fala do cérebro vira bot-fala com áudio; a vez 0 nunca é falada", async () => {
    const { voz, midia, cerebro, falas } = montar();
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
    cerebro.receber({ t: "fala", n: 0, seq: 0, delta: "ok" });
    midia.receber({ t: "texto", conteudo: "quero uma rotina" });
    const vez = await ate(() => msgs(cerebro, "vez").find((v) => v.n === 1));
    expect(vez.texto).toBe("quero uma rotina");
    cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Claro, vamos criar. " });
    cerebro.receber({ t: "fala-fim", n: 1 });
    await ate(() => msgs(midia, "bot-fala").find((m) => m.tipo === "conteudo" && String(m.texto).includes("vamos criar")));
    expect(msgs(midia, "bot-fala").some((m) => m.texto === "ok")).toBe(false);
    expect(midia.binarios).toBeGreaterThan(0);
    await ate(() => falas.find((f) => f.autor === "bot" && f.texto.includes("vamos criar")));
  });

  it("fala por cima do bot: confirma a interrupção, manda interromper ao cliente e ao cérebro, e a próxima vez leva o 'ouviu até'", async () => {
    const { voz, midia, cerebro, provedores } = montar({ prazos: { interrupcaoPorFalaMs: 200 } });
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
    await dormir(30);
    tocouTudo(midia);
    midia.receber({ t: "texto", conteudo: "me explica tudo" });
    await ate(() => msgs(cerebro, "vez").find((v) => v.n === 1));
    cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Esta é uma explicação muito longa que vai tocar por bastante tempo no alto-falante, com várias frases. " });
    await ate(() => msgs(midia, "bot-fala").find((m) => m.tipo === "conteudo" && String(m.texto).includes("explicação")));
    provedores.stt.empurrarTexto("espera, para");
    let seq = 0;
    for (let i = 0; i < 25; i++) midia.receber(quadro(seq++, true));
    for (let i = 0; i < 50; i++) midia.receber(quadro(seq++, false));
    await ate(() => msgs(midia, "interromper").length > 0);
    await ate(() => msgs(cerebro, "interromper").length > 0);
    const vez2 = await ate(() => msgs(cerebro, "vez").find((v) => v.n === 2));
    expect(vez2.texto).toContain("espera");
    expect(typeof vez2.ouvidoAte === "string" || vez2.ouvidoAte === undefined).toBe(true);
  });

  it("'uhum' com o bot falando não interrompe: vai só para a transcrição e o volume volta", async () => {
    const { voz, midia, cerebro, provedores, falas } = montar({ prazos: { interrupcaoPorFalaMs: 5000 } });
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
    await dormir(30);
    tocouTudo(midia);
    midia.receber({ t: "texto", conteudo: "fala comigo" });
    await ate(() => msgs(cerebro, "vez").find((v) => v.n === 1));
    cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Esta é uma resposta comprida que segue tocando por um bom tempo, sem pressa nenhuma. " });
    await ate(() => msgs(midia, "bot-fala").find((m) => m.tipo === "conteudo"));
    provedores.stt.empurrarTexto("uhum");
    let seq = 0;
    for (let i = 0; i < 8; i++) midia.receber(quadro(seq++, true));
    for (let i = 0; i < 40; i++) midia.receber(quadro(seq++, false));
    await ate(() => falas.find((f) => f.autor === "pessoa" && f.texto === "uhum"));
    expect(msgs(midia, "interromper")).toHaveLength(0);
    expect(msgs(cerebro, "vez").some((v) => v.n === 2)).toBe(false);
  });

  it("cérebro cai e não volta no prazo: a ligação encerra com cerebro_caiu", async () => {
    const { voz, midia, cerebro, fins } = montar();
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
    cerebro.cair();
    expect(msgs(midia, "cerebro").at(-1)).toMatchObject({ online: false });
    await ate(() => fins.length > 0, 2000);
    expect(fins[0]?.motivo).toBe("cerebro_caiu");
    expect(msgs(midia, "fim").at(-1)).toMatchObject({ motivo: "cerebro_caiu" });
  });

  it("mídia cai e volta com retomar no prazo: a ligação segue", async () => {
    const { voz, midia, fins } = montar({ prazos: { midiaReconexaoMs: 400 } });
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    midia.cair();
    await dormir(100);
    const nova = canalFalso();
    expect(voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: true, canal: nova })).toBeNull();
    await dormir(500);
    expect(fins).toHaveLength(0);
    expect(msgs(nova, "pronto")).toHaveLength(1);
  });

  it("tempo máximo: encerra com tempo_maximo", async () => {
    const { voz, midia, fins } = montar({ maxS: 0.3 });
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    await ate(() => fins.length > 0, 3000);
    expect(fins[0]?.motivo).toBe("tempo_maximo");
  });

  it("tchau encerra com pessoa_desligou e manda fim ao cérebro (que então pede o resumo)", async () => {
    const { voz, midia, cerebro, fins } = montar();
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
    midia.receber({ t: "tchau" });
    await ate(() => fins.length > 0);
    expect(fins[0]?.motivo).toBe("pessoa_desligou");
    expect(msgs(cerebro, "fim")).toHaveLength(1);
    expect(voz.vivas()).toBe(0);
  });

  it("aprovação por voz: comando só vale uma vez, para a decisão e a ação certas, e não vale para outra pessoa", async () => {
    const { voz, midia, cerebro, provedores } = montar();
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
    await dormir(50);
    for (const m of msgs(midia, "bot-fala")) midia.receber({ t: "tocou-fim", utt: m.utt });
    voz.pedirAprovacao("l1", { decisaoId: "d1", leitura: "Mandar 1 e-mail. Para aprovar, diga 'eu aprovo'.", perfil: "estrito" });
    const leitura = await ate(() => msgs(midia, "bot-fala").find((m) => m.tipo === "leitura"));
    midia.receber({ t: "tocou-fim", utt: leitura.utt });
    await ate(() => msgs(midia, "janela").length > 0);
    await dormir(80);
    provedores.stt.empurrarTexto("eu aprovo");
    let seq = 0;
    for (let i = 0; i < 20; i++) midia.receber(quadro(seq++, true));
    for (let i = 0; i < 40; i++) midia.receber(quadro(seq++, false));
    const cmd = await ate(() => msgs(midia, "comando")[0]);
    expect(cmd).toMatchObject({ decisaoId: "d1", acao: "aprovar" });
    expect(msgs(cerebro, "vez").some((v) => v.n === 1)).toBe(false);
    const comandoId = String(cmd.comandoId);
    expect(voz.conferirComando({ pessoaId: "outra", ligacaoId: "l1", comandoId, decisaoId: "d1", acao: "aprovar" })).toBe(false);
    expect(voz.conferirComando({ pessoaId: "p", ligacaoId: "l1", comandoId, decisaoId: "d1", acao: "recusar" })).toBe(false);
    expect(voz.conferirComando({ pessoaId: "p", ligacaoId: "l1", comandoId, decisaoId: "d1", acao: "aprovar" })).toBe(true);
    expect(voz.conferirComando({ pessoaId: "p", ligacaoId: "l1", comandoId, decisaoId: "d1", acao: "aprovar" })).toBe(false);
    voz.decisaoDecidida("l1", { decisaoId: "d1", resultado: "aprovado", porVoz: true });
    await ate(() => msgs(midia, "bot-fala").find((m) => String(m.texto).includes("aprovado")));
    await ate(() => msgs(cerebro, "nota").find((n) => String(n.texto).includes("aprovou por voz")));
  });

  it("desligar pelo bot: encerra com bot_desligou depois da última frase", async () => {
    const { voz, midia, cerebro, fins } = montar();
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
    midia.receber({ t: "texto", conteudo: "tchau" });
    await ate(() => msgs(cerebro, "vez").find((v) => v.n === 1));
    cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Até mais! " });
    cerebro.receber({ t: "atividade", tipo: "inicio", nome: "mcp__nod__desligar" });
    cerebro.receber({ t: "atividade", tipo: "fim", nome: "mcp__nod__desligar" });
    cerebro.receber({ t: "fala", n: 1, seq: 1, delta: "Até mais de novo!" });
    cerebro.receber({ t: "fala-fim", n: 1 });
    await ate(() => fins.length > 0, 5000);
    expect(fins[0]?.motivo).toBe("bot_desligou");
    expect(msgs(midia, "bot-fala").some((m) => String(m.texto).includes("de novo"))).toBe(false);
  });

  it("refazer a vez: a pessoa volta a falar antes de o bot dizer algo — a resposta é descartada e a fala vira uma vez só", async () => {
    const { voz, midia, cerebro, provedores } = montar();
    voz.anexarMidia({ pessoaId: "p", ligacaoId: "l1", retomar: false, canal: midia });
    voz.anexarCerebro({ turnoId: "turno", ligacaoId: "l1", canal: cerebro });
    await dormir(30);
    tocouTudo(midia);
    provedores.stt.empurrarTexto("Primeiro eu quero definir o que você faz.");
    provedores.stt.empurrarTexto("Quero que seja minha secretária.");
    let seq = 0;
    for (let i = 0; i < 30; i++) midia.receber(quadro(seq++, true));
    for (let i = 0; i < 40; i++) midia.receber(quadro(seq++, false));
    await ate(() => msgs(cerebro, "vez").find((v) => v.n === 1));
    // Volta a falar antes de qualquer áudio da resposta.
    for (let i = 0; i < 30; i++) midia.receber(quadro(seq++, true));
    for (let i = 0; i < 40; i++) midia.receber(quadro(seq++, false));
    await ate(() => msgs(cerebro, "interromper").find((m) => m.modo === "duro"));
    const vez2 = await ate(() => msgs(cerebro, "vez").find((v) => v.n === 2));
    expect(String(vez2.texto)).toContain("Primeiro eu quero definir");
    expect(String(vez2.texto)).toContain("minha secretária");
    expect(String(vez2.texto)).toContain("ainda não tinha terminado");
    // A resposta atrasada da vez 1 não é falada.
    cerebro.receber({ t: "fala", n: 1, seq: 0, delta: "Resposta velha." });
    await dormir(50);
    expect(msgs(midia, "bot-fala").some((m) => String(m.texto).includes("velha"))).toBe(false);
  });
});
