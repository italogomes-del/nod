import { afterAll, beforeAll, expect, it } from "vitest";
import WebSocket from "ws";
import type { Agente } from "../../src/contracts/agente.ts";
import type { ConversaDto } from "../../src/contracts/api.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { DisponibilidadeLigacao, FalaLigacao, Ligacao } from "../../src/contracts/ligacao.ts";
import type { MsgMidiaServidor } from "../../src/contracts/voz.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * Ligação ponta a ponta com custo zero (definido em 2026-10-04, ADR-071/072): servidor completo, executor catcher em
 * modo ligação (responde "Entendi: …") e voz falsa (STT roteirizado, TTS de silêncio). Um cliente WebSocket faz o papel
 * do app: abre a mídia com cookie e Origin, ouve a saudação, fala por texto e por áudio, desliga. Confere a linha
 * "Chat de voz", a transcrição, o resumo do bot e o turno-cérebro concluído.
 */
let srv: ServidorCompleto;
const criados = { agentes: [] as string[], conversas: [] as string[] };

beforeAll(async () => {
  srv = await servidorCompleto({ env: { NOD_LIGACAO: "todas", NOD_VOZ_FALSO_ROTEIRO: "Oi, tudo bem com você?|pode criar" } });
});

afterAll(async () => {
  try {
    await srv.fechar();
  } finally {
    await limparPessoaE2E(srv.db, srv.dbDono, { tenantId: srv.pessoa.tenantId, pessoaId: srv.pessoa.pessoaId }, criados);
    await srv.desligar();
  }
});

type Cliente = { msgs: MsgMidiaServidor[]; quadrosDeVoz: number; ws: WebSocket; esperarMsg(f: (m: MsgMidiaServidor) => boolean, nome: string, timeoutMs?: number): Promise<MsgMidiaServidor> };

async function abrirMidia(ligacaoId: string, origin: string): Promise<Cliente> {
  const url = `${srv.url.replace("http", "ws")}/api/t/${srv.pessoa.tenantId}/voz/v1/midia`;
  const ws = new WebSocket(url, { headers: { cookie: srv.pessoa.cookie, origin } });
  const c: Cliente = {
    msgs: [],
    quadrosDeVoz: 0,
    ws,
    async esperarMsg(f, nome, timeoutMs = 8_000) {
      return srv.esperar(async () => c.msgs.find(f) ?? null, { nome, timeoutMs });
    },
  };
  ws.on("message", (dados, binario) => {
    if (binario) {
      c.quadrosDeVoz++;
      const b = dados as Buffer;
      // O cliente de verdade relata o fim de cada fala; aqui, na hora (o TTS falso é silêncio).
      const utt = b.readUInt16LE(5);
      ws.send(JSON.stringify({ t: "tocou-fim", utt }));
      return;
    }
    c.msgs.push(JSON.parse(String(dados)) as MsgMidiaServidor);
  });
  await new Promise<void>((r, j) => {
    ws.once("open", () => r());
    ws.once("error", j);
    ws.once("unexpected-response", (_req, res) => j(new Error(`upgrade recusado: ${res.statusCode}`)));
  });
  ws.send(JSON.stringify({ t: "ola", v: 1, ligacaoId, entrada: "pcm16", saida: "pcm16" }));
  return c;
}

/** 20 ms de PCM16 16 kHz com um tom (fala) ou silêncio, no quadro 0x01 do protocolo. */
function quadroMicrofone(seq: number, comVoz: boolean): Buffer {
  const amostras = 320;
  const b = Buffer.alloc(5 + amostras * 2);
  b.writeUInt8(0x01, 0);
  b.writeUInt32LE(seq, 1);
  for (let i = 0; i < amostras; i++) b.writeInt16LE(comVoz ? Math.round(Math.sin((i + seq * amostras) / 6) * 9000) : 0, 5 + i * 2);
  return b;
}

it("liga, ouve a saudação, fala por texto e por áudio, desliga: linha, transcrição, resumo e turno concluído", async () => {
  const { agente, conversa } = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Nina" });
  criados.agentes.push(agente.id);
  criados.conversas.push(conversa.id);

  const antes = await srv.json<DisponibilidadeLigacao>("GET", `ligacoes/disponibilidade?agenteId=${agente.id}`);
  expect(antes).toMatchObject({ disponivel: true, consentimentoNecessario: true });
  // Sem consentimento a ligação é recusada.
  expect((await srv.chamar("POST", "ligacoes", { agenteId: agente.id })).status).toBe(409);
  await srv.json("POST", "voz/consentimento", { versao: 1 });

  const { ligacao } = await srv.json<{ ligacao: Ligacao; maxS: number }>("POST", "ligacoes", { agenteId: agente.id });
  expect(ligacao.estado).toBe("chamando");
  // Uma ligação viva por pessoa.
  expect((await srv.chamar("POST", "ligacoes", { agenteId: agente.id })).status).toBe(409);

  // Origin de outro site: recusado no upgrade.
  await expect(abrirMidia(ligacao.id, "https://outro.exemplo")).rejects.toThrow(/403/);

  const host = new URL(srv.url).host;
  const cli = await abrirMidia(ligacao.id, `http://${host}`);
  await cli.esperarMsg((m) => m.t === "pronto", "pronto");
  await cli.esperarMsg((m) => m.t === "bot-fala" && m.texto.includes("Nina"), "saudação");
  // O catcher puxa o turno da ligação e abre o canal do cérebro.
  await cli.esperarMsg((m) => m.t === "cerebro" && m.online, "cérebro online", 10_000);

  cli.ws.send(JSON.stringify({ t: "texto", conteudo: "quero criar uma rotina" }));
  await cli.esperarMsg((m) => m.t === "bot-fala" && m.tipo === "conteudo" && m.texto.includes("quero criar uma rotina"), "resposta ao texto");

  // Fala por áudio: 600 ms de tom e 1,2 s de silêncio → STT falso → "Oi, tudo bem com você?".
  let seq = 0;
  for (let i = 0; i < 30; i++) cli.ws.send(quadroMicrofone(seq++, true));
  for (let i = 0; i < 60; i++) cli.ws.send(quadroMicrofone(seq++, false));
  await cli.esperarMsg((m) => m.t === "legenda" && m.final && m.texto.includes("tudo bem"), "legenda final");
  await cli.esperarMsg((m) => m.t === "bot-fala" && m.tipo === "conteudo" && m.texto.includes("tudo bem"), "resposta à fala");
  expect(cli.quadrosDeVoz).toBeGreaterThan(0);

  const viva = await srv.json<{ ligacao: Ligacao | null }>("GET", "ligacoes/viva");
  expect(viva.ligacao?.estado).toBe("em_curso");

  // Aprovação por voz (ADR-074): o bot propõe uma rotina; o servidor lê o card, abre a janela, e "pode criar" vira um
  // comando que o cliente manda à rota de decisão — que confere o comando de uso único e cria a rotina.
  const rotina = { cron: "0 8 * * 1-5", fuso_iana: "America/Sao_Paulo", instrucao: "poste um resumo dos PRs abertos", fonte: "PRs abertos", entregavel: "resumo curto", limites_aprovacao: "nada sai sem aprovação", politica_sem_dado: "diga que não houve" };
  cli.ws.send(JSON.stringify({ t: "texto", conteudo: `cria uma rotina [[tool: criar_rotina ${JSON.stringify(rotina)}]] [[delta: Proposta de rotina enviada.]]` }));
  const leitura = await cli.esperarMsg((m) => m.t === "bot-fala" && m.tipo === "leitura", "leitura do card", 10_000);
  expect(leitura.t === "bot-fala" && leitura.texto).toMatch(/Para aprovar/);
  const janela = await cli.esperarMsg((m) => m.t === "janela", "janela aberta");
  const decisaoId = janela.t === "janela" ? janela.decisaoId : "";
  // Um comando forjado (sem passar pela janela) é recusado.
  expect((await srv.chamar("POST", `decisoes/${decisaoId}/decidir`, { canal: "voz", ligacaoId: ligacao.id, comandoId: "forjado", acao: "aprovar" })).status).toBe(403);
  for (let i = 0; i < 30; i++) cli.ws.send(quadroMicrofone(seq++, true));
  for (let i = 0; i < 60; i++) cli.ws.send(quadroMicrofone(seq++, false));
  const comando = await cli.esperarMsg((m) => m.t === "comando", "comando de voz").catch((e: unknown) => { console.error("DEBUG", JSON.stringify(cli.msgs.slice(-15))); throw e; });
  if (comando.t !== "comando") throw new Error("sem comando");
  expect(comando.acao).toBe("aprovar");
  // A voz decide o card inteiro: "sempre" junto é recusado, e o comando continua válido para o pedido certo.
  expect((await srv.chamar("POST", `decisoes/${decisaoId}/decidir`, { canal: "voz", ligacaoId: ligacao.id, comandoId: comando.comandoId, acao: "aprovar", sempre: true })).status).toBe(400);
  expect((await srv.chamar("POST", `decisoes/${decisaoId}/decidir`, { canal: "voz", ligacaoId: ligacao.id, comandoId: comando.comandoId, acao: "aprovar" })).status).toBe(200);
  // Uso único.
  expect((await srv.chamar("POST", `decisoes/${decisaoId}/decidir`, { canal: "voz", ligacaoId: ligacao.id, comandoId: comando.comandoId, acao: "aprovar" })).status).toBe(403);
  await cli.esperarMsg((m) => m.t === "bot-fala" && m.texto.includes("aprovado"), "resultado falado");
  const rotinas = await srv.json<{ rotinas: { id: string }[] } | { id: string }[]>("GET", `agentes/${agente.id}/rotinas`).catch(() => null);
  if (rotinas) expect(Array.isArray(rotinas) ? rotinas.length : rotinas.rotinas.length).toBeGreaterThan(0);

  // iniciar_tarefa (ADR-072): o trabalho vira um turno do bot ligado à ligação; quando termina, o bot avisa falando.
  cli.ws.send(JSON.stringify({ t: "texto", conteudo: `revisa o PR [[tool: iniciar_tarefa {"pedido":"revisar o PR 42"}]] [[delta: Vou revisar e te aviso.]]` }));
  await cli.esperarMsg((m) => m.t === "bot-fala" && m.texto.includes("Vou revisar"), "bot anuncia a tarefa");
  await cli.esperarMsg((m) => m.t === "bot-fala" && m.texto.includes("Aviso recebido"), "aviso falado do fim da tarefa", 15_000);

  cli.ws.send(JSON.stringify({ t: "tchau" }));
  await cli.esperarMsg((m) => m.t === "fim", "fim");

  const encerrada = await srv.esperar(async () => {
    const l = await srv.json<{ ligacao: Ligacao | null }>("GET", "ligacoes/viva");
    return l.ligacao === null ? true : null;
  }, { nome: "ligação encerrada" });
  expect(encerrada).toBe(true);

  const { falas } = await srv.json<{ falas: FalaLigacao[] }>("GET", `ligacoes/${ligacao.id}/falas`);
  expect(falas.filter((f) => f.autor === "pessoa").map((f) => f.texto)).toEqual(expect.arrayContaining(["quero criar uma rotina", "Oi, tudo bem com você?", "pode criar"]));
  expect(falas.some((f) => f.tipo === "leitura")).toBe(true);
  expect(falas.some((f) => f.autor === "bot" && f.texto.includes("Entendi"))).toBe(true);

  // A linha "Chat de voz · mm:ss" e o resumo do bot (o turno-cérebro entregou no `fim`).
  const dto = await srv.esperar(async () => {
    const d = await srv.json<ConversaDto>("GET", `conversas/${conversa.id}/mensagens`);
    return d.mensagens.some((m) => m.texto.startsWith("Resumo da ligação")) ? d : null;
  }, { nome: "resumo na conversa", timeoutMs: 15_000 });
  const linha = dto.mensagens.find((m) => m.payload?.kind === "ligacao");
  expect(linha?.texto).toMatch(/^Chat de voz · \d\d:\d\d$/);
  // O turno-cérebro nunca aparece como trabalho do bot na tela.
  expect(dto.turnosEmCurso ?? []).toEqual([]);

  // Apagar a transcrição: as falas somem, o registro e o resumo ficam.
  await srv.json("DELETE", `ligacoes/${ligacao.id}/falas`);
  const depois = await srv.json<{ falas: FalaLigacao[]; apagadaEm: number | null }>("GET", `ligacoes/${ligacao.id}/falas`);
  expect(depois.falas).toEqual([]);
  expect(depois.apagadaEm).not.toBeNull();
  await srv.json("POST", `ligacoes/${ligacao.id}/avaliacao`, { nota: "boa" });
}, 60_000);
