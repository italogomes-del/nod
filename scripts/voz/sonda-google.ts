/**
 * Sonda paga da voz do Google (definido em 2026-10-04): sintetiza uma frase com o Chirp 3 HD pelo adaptador do nod,
 * mede a latência, salva o WAV e devolve o mesmo áudio (24 kHz → 16 kHz) ao transcritor ao vivo em tempo real.
 * Uso: NOD_VOZ_PROJETO=nod-producao NOD_VOZ_GCLOUD_BIN=$(which gcloud) node scripts/voz/sonda-google.ts [voz] ["frase"]
 */
import { writeFileSync } from "node:fs";
import { montarWav } from "../../src/adapters/voz/audio.ts";
import { criarTranscritorGoogle } from "../../src/adapters/voz/google-transcricao.ts";
import { criarSintetizadorGoogle } from "../../src/adapters/voz/google-voz.ts";
import { criarFonteDeToken } from "../../src/adapters/voz/token-google.ts";

const dizer = (t: string) => process.stdout.write(`${t}\n`);
const voz = process.argv[2] ?? "clara";
const frase = process.argv[3] ?? "Oi! Aqui é Nina. Me conta: qual é a tarefa que mais toma o seu tempo no trabalho hoje?";
const fonte = criarFonteDeToken({ env: process.env });
const token = () => fonte.token();

const t0 = performance.now();
let primeiro = 0;
const pedacos: Int16Array[] = [];
for await (const p of criarSintetizadorGoogle({ token, projeto: fonte.projeto }).sintetizar({ texto: frase, voz, velocidade: 1 })) {
  if (!primeiro) primeiro = performance.now() - t0;
  pedacos.push(p);
}
const total = pedacos.reduce((n, p) => n + p.length, 0);
const pcm24 = new Int16Array(total);
let o = 0;
for (const p of pedacos) { pcm24.set(p, o); o += p.length; }
const arquivo = `${process.env.TMPDIR ?? "/tmp"}/sonda-google-${voz}.wav`;
writeFileSync(arquivo, montarWav(pcm24, 24_000));
dizer(`TTS ${voz}: primeiro áudio ${primeiro.toFixed(0)} ms, ${(total / 24_000).toFixed(1)} s de fala → ${arquivo}`);

// 24k → 16k (linear) e STT em tempo real, quadros de 20 ms, com 1 s de silêncio no fim.
const n16 = Math.floor(total * 2 / 3);
const pcm16 = new Int16Array(n16 + 16_000);
for (let i = 0; i < n16; i++) {
  const x = i * 1.5, a = Math.floor(x), f = x - a;
  pcm16[i] = Math.round((pcm24[a] ?? 0) * (1 - f) + (pcm24[a + 1] ?? 0) * f);
}
const stt = criarTranscritorGoogle({ token, projeto: fonte.projeto, regiao: process.env.NOD_VOZ_REGIAO, modelo: process.env.NOD_VOZ_STT_MODELO });
const t1 = performance.now();
let fimFala = 0;
const fim = new Promise<void>((resolve, reject) => {
  void stt.abrir({
    idioma: "pt-BR",
    vocabulario: ["nod", "Nina", "bot"],
    aoResultado(r) {
      dizer(`${(performance.now() - t1).toFixed(0).padStart(6)} ms ${r.final ? "FINAL  " : "parcial"} ${r.texto}${r.final ? `  (fim da fala +${(performance.now() - fimFala).toFixed(0)} ms)` : ""}`);
      if (r.final) resolve();
    },
    aoErro(e) { reject(e); },
  }).then(async (s) => {
    dizer(`STT aberto em ${(performance.now() - t1).toFixed(0)} ms`);
    for (let i = 0; i < pcm16.length; i += 320) {
      s.enviar(pcm16.subarray(i, i + 320));
      if (i === n16 - (n16 % 320)) fimFala = performance.now();
      await new Promise((r) => setTimeout(r, 20));
    }
    s.fimDeFala();
    await fim.catch(() => {});
    await s.fechar();
  }, reject);
});
await Promise.race([fim, new Promise((_, rej) => setTimeout(() => rej(new Error("sem final em 30 s")), 30_000))]);
process.exit(0);
