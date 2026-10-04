/**
 * UAT da ligação por voz contra um servidor de pé (definido em 2026-10-04, plano do modo ligação, "Verificação"). Faz o
 * papel do app: entra (login stub), cria ou acha o bot, aceita o aviso de voz, liga, fala frases de verdade (geradas
 * com o `say` do macOS e mandadas em tempo real, 20 ms por quadro, como um microfone), ouve as respostas, mede as
 * latências e desliga. O áudio que o bot falou é salvo em WAV para ouvir depois.
 *
 * Uso: node scripts/uat/ligacao-voz.ts --url http://127.0.0.1:8890 --saida /tmp/uat-voz "Oi, tudo bem?" "Cria uma rotina"
 * Exige NOD_LOGIN=stub no servidor e macOS (para o `say`). Custo zero com NOD_EXECUTOR=catcher; com claude-cli, gasta a
 * assinatura (Haiku).
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import WebSocket from "ws";

type Msg = { t: string; [k: string]: unknown };

function arg(nome: string, padrao: string): string {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1]! : padrao;
}
const url = arg("url", "http://127.0.0.1:8890");
const saida = arg("saida", join(tmpdir(), "uat-voz"));
const voz = arg("voz", "Luciana");
const nomeBot = arg("bot", "Nina");
const frases = process.argv.slice(2).filter((a, i, all) => !a.startsWith("--") && !all[i - 1]?.startsWith("--"));
if (frases.length === 0) frases.push("Oi, tudo bem?", "Me conta o que você sabe fazer.");
mkdirSync(saida, { recursive: true });

const escrever = (s: string) => process.stdout.write(`${s}\n`);
const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

function wavDoSay(texto: string): Int16Array {
  const arquivo = join(saida, `entrada-${Date.now()}.wav`);
  execFileSync("say", ["-v", voz, "--file-format=WAVE", "--data-format=LEI16@16000", "-o", arquivo, texto]);
  const b = readFileSync(arquivo);
  let i = 12;
  while (i < b.length - 8) {
    const id = b.toString("ascii", i, i + 4);
    const tam = b.readUInt32LE(i + 4);
    if (id === "data") return new Int16Array(b.buffer.slice(b.byteOffset + i + 8, b.byteOffset + i + 8 + tam));
    i += 8 + tam + (tam % 2);
  }
  throw new Error("WAV sem data");
}

function wav(pcm: Int16Array, taxa: number): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + pcm.byteLength, 4); h.write("WAVE", 8); h.write("fmt ", 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(taxa, 24); h.writeUInt32LE(taxa * 2, 28);
  h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(pcm.byteLength, 40);
  return Buffer.concat([h, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength)]);
}

async function main(): Promise<void> {
  const modo = (await (await fetch(`${url}/api/sessao/modo`)).json()) as { pessoas?: { id: string }[] };
  const pessoaId = modo.pessoas?.[0]?.id;
  if (!pessoaId) throw new Error("servidor sem login stub ou sem pessoas");
  const entrar = await fetch(`${url}/api/sessao/entrar`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pessoaId }) });
  const cookie = (entrar.headers.get("set-cookie") ?? "").split(";")[0]!;
  const { tenantId } = (await entrar.json()) as { tenantId: string };
  const api = async <T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> => {
    const r = await fetch(`${url}/api/t/${tenantId}/${caminho}`, { method: metodo, headers: { cookie, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const t = await r.text();
    if (!r.ok) throw new Error(`${metodo} ${caminho} → ${r.status} ${t}`);
    return JSON.parse(t) as T;
  };

  const frota = await api<{ agentes: { id: string; nome: string }[] }>("GET", "frota");
  let agenteId = frota.agentes.find((a) => a.nome === nomeBot)?.id;
  if (!agenteId) agenteId = (await api<{ agente: { id: string } }>("POST", "agentes", { dono: "pessoa", nome: nomeBot })).agente.id;
  const disp = await api<{ disponivel: boolean; consentimentoNecessario?: boolean; texto?: string }>("GET", `ligacoes/disponibilidade?agenteId=${agenteId}`);
  if (!disp.disponivel) throw new Error(`indisponível: ${disp.texto}`);
  if (disp.consentimentoNecessario) await api("POST", "voz/consentimento", { versao: 1 });
  const { ligacao } = await api<{ ligacao: { id: string } }>("POST", "ligacoes", { agenteId });
  escrever(`ligação ${ligacao.id} com ${nomeBot}`);

  const ws = new WebSocket(`${url.replace("http", "ws")}/api/t/${tenantId}/voz/v1/midia`, { headers: { cookie, origin: url } });
  const msgs: { em: number; m: Msg }[] = [];
  const audioPorUtt = new Map<number, Int16Array[]>();
  const todasAsVozes: Int16Array[] = [];
  let primeiroAudioEm = 0;
  // Quando chegou o primeiro áudio de cada fala do bot: o que a pessoa ouve, não só o texto.
  const audioEm = new Map<number, number>();
  ws.on("message", (dados, binario) => {
    const agora = Date.now();
    if (binario) {
      const b = dados as Buffer;
      const utt = b.readUInt16LE(5);
      const pcm = new Int16Array(b.buffer.slice(b.byteOffset + 7, b.byteOffset + b.byteLength));
      if (!audioPorUtt.has(utt)) {
        audioPorUtt.set(utt, []);
        audioEm.set(utt, agora);
        // O "alto-falante": relata o fim da fala depois da duração, como o app faria.
        setTimeout(() => ws.send(JSON.stringify({ t: "tocou-fim", utt })), 400);
      }
      audioPorUtt.get(utt)!.push(pcm);
      todasAsVozes.push(pcm);
      primeiroAudioEm ||= agora;
      return;
    }
    const m = JSON.parse(String(dados)) as Msg;
    msgs.push({ em: agora, m });
    if (m.t === "bot-fala") escrever(`  🤖 [${m.tipo}] ${m.texto}`);
    if (m.t === "legenda" && m.final) escrever(`  🎤 ${m.texto}`);
    if (m.t === "aviso") escrever(`  ⚠️  ${m.texto}`);
  });
  await new Promise<void>((r, j) => { ws.once("open", () => r()); ws.once("error", j); });
  ws.send(JSON.stringify({ t: "ola", v: 1, ligacaoId: ligacao.id, entrada: "pcm16", saida: "pcm16" }));
  const esperar = async (f: (m: Msg) => boolean, desde: number, ms: number): Promise<{ em: number; m: Msg } | null> => {
    const fim = Date.now() + ms;
    while (Date.now() < fim) {
      const achado = msgs.find((x) => x.em >= desde && f(x.m));
      if (achado) return achado;
      await dormir(50);
    }
    return null;
  };
  const inicio = Date.now();
  await esperar((m) => m.t === "cerebro" && m.online === true, inicio, 40_000);
  escrever(`cérebro online em ${Date.now() - inicio} ms`);
  await dormir(2500);

  let seq = 0;
  const relatorio: string[] = [];
  for (const frase of frases) {
    const pcm = wavDoSay(frase);
    const quadros = Math.ceil(pcm.length / 320);
    let fimDaFala = 0;
    for (let q = 0; q < quadros + 75; q++) {
      const pedaco = q < quadros ? pcm.subarray(q * 320, q * 320 + 320) : new Int16Array(320);
      const b = Buffer.alloc(5 + 640);
      b.writeUInt8(1, 0);
      b.writeUInt32LE(seq++, 1);
      Buffer.from(pedaco.buffer, pedaco.byteOffset, pedaco.byteLength).copy(b, 5);
      ws.send(b);
      if (q === quadros) fimDaFala = Date.now();
      await dormir(20);
    }
    const legenda = await esperar((m) => m.t === "legenda" && m.final === true, fimDaFala, 15_000);
    const resposta = await esperar((m) => m.t === "bot-fala" && m.tipo === "conteudo", fimDaFala, 30_000);
    const espera = await esperar((m) => m.t === "bot-fala" && m.tipo === "espera", fimDaFala, 1);
    await dormir(4000);
    // Buraco entre frases da mesma resposta: o áudio da seguinte chegou depois de a anterior acabar de tocar?
    const falas = msgs.filter((x) => x.em >= fimDaFala && x.m.t === "bot-fala" && x.m.tipo === "conteudo").map((x) => Number(x.m.utt));
    let buracoMax = 0;
    for (let i = 1; i < falas.length; i++) {
      const ant = falas[i - 1]!;
      const dur = ((audioPorUtt.get(ant) ?? []).reduce((n, p) => n + p.length, 0) / 24_000) * 1000;
      const fimAnt = (audioEm.get(ant) ?? 0) + dur;
      buracoMax = Math.max(buracoMax, (audioEm.get(falas[i]!) ?? fimAnt) - fimAnt);
    }
    const audio1 = resposta ? audioEm.get(Number(resposta.m.utt)) : undefined;
    relatorio.push(`"${frase}" → STT ${legenda ? legenda.em - fimDaFala : "—"} ms · 1º conteúdo ${resposta ? resposta.em - fimDaFala : "—"} ms · 1º áudio ${audio1 ? audio1 - fimDaFala : "—"} ms${espera ? ` · espera ${espera.em - fimDaFala} ms` : ""}${falas.length > 1 ? ` · maior buraco entre frases ${Math.round(buracoMax)} ms` : ""}`);
  }
  ws.send(JSON.stringify({ t: "tchau" }));
  await esperar((m) => m.t === "fim", inicio, 10_000);
  ws.close();
  const total = todasAsVozes.reduce((s, p) => s + p.length, 0);
  const tudo = new Int16Array(total);
  let o = 0;
  for (const p of todasAsVozes) { tudo.set(p, o); o += p.length; }
  writeFileSync(join(saida, "voz-do-bot.wav"), wav(tudo, 24_000));
  const falas = await api<{ falas: { autor: string; texto: string }[] }>("GET", `ligacoes/${ligacao.id}/falas`);
  escrever("\n— latências (do fim da fala da pessoa) —");
  for (const l of relatorio) escrever(l);
  escrever(`\n— transcrição (${falas.falas.length} falas) —`);
  for (const f of falas.falas) escrever(`${f.autor === "pessoa" ? "🎤" : "🤖"} ${f.texto}`);
  escrever(`\náudio do bot: ${join(saida, "voz-do-bot.wav")} (${(total / 24_000).toFixed(1)} s)`);
}

main().catch((e: unknown) => {
  process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`);
  process.exit(1);
});
