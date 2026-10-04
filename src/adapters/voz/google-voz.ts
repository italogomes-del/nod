import { TAXA_VOZ_HZ } from "../../contracts/voz.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { log } from "../../obs/log.ts";
import { fatiar, lerWav, misturarParaMono, reamostrar, bytesParaPcm } from "./audio.ts";
import { vozDoProvedor } from "./catalogo-vozes.ts";
import type { PedidoTts, Sintetizador } from "./spi.ts";

/**
 * TTS Chirp 3 HD pelo REST `text:synthesize` (definido em 2026-10-04, ADR-071). Uma frase por pedido (o orquestrador
 * já fatia em trechos). O streaming do Chirp é gRPC: a fase 0 decide se vale `@grpc/grpc-js`; até lá `streaming:false`.
 *
 * A confirmar na fase 0 (sem credencial nesta máquina em 2026-10-04): `speakingRate` aceito pelas vozes Chirp 3 HD
 * (a documentação diz que sim) e a latência por frase no e2-medium.
 */
export const URL_TTS_GOOGLE = "https://texttospeech.googleapis.com/v1/text:synthesize";

/** definido em 2026-10-04: 100 ms por pedaço (2400 amostras a 24 kHz), o mesmo do `say` e do falso. */
const AMOSTRAS_POR_PEDACO = (100 * TAXA_VOZ_HZ) / 1000;
/** definido em 2026-10-04: uma nova tentativa em 429/5xx/rede, depois de 300 ms; depois erro (plano, "Operação"). */
const ESPERA_NOVA_TENTATIVA_MS = 300;
const TIMEOUT_PEDIDO_MS = 15_000;

export type OpcoesGoogleVoz = {
  token: () => Promise<string>;
  projeto: string | null;
  fetchImpl?: typeof fetch;
  url?: string;
};

class Transitorio extends Error {}

function abortado(sinal: AbortSignal | undefined, e: unknown): boolean {
  return sinal?.aborted === true || (e instanceof Error && e.name === "AbortError" && sinal !== undefined);
}

export function criarSintetizadorGoogle(o: OpcoesGoogleVoz): Sintetizador {
  const fetchImpl = o.fetchImpl ?? fetch;
  const url = o.url ?? URL_TTS_GOOGLE;

  async function pedir(p: PedidoTts): Promise<Buffer> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await o.token()}`, "Content-Type": "application/json; charset=utf-8" };
    if (o.projeto) headers["x-goog-user-project"] = o.projeto;
    const corpo = {
      input: { text: p.texto },
      voice: { languageCode: "pt-BR", name: vozDoProvedor("google", p.voz) },
      audioConfig: { audioEncoding: "LINEAR16", sampleRateHertz: TAXA_VOZ_HZ, speakingRate: p.velocidade },
    };
    const sinais = [AbortSignal.timeout(TIMEOUT_PEDIDO_MS)];
    if (p.sinal) sinais.push(p.sinal);
    let r: Response;
    try {
      r = await fetchImpl(url, { method: "POST", headers, body: JSON.stringify(corpo), signal: AbortSignal.any(sinais) });
    } catch (e) {
      if (abortado(p.sinal, e)) throw e;
      throw new Transitorio("rede", { cause: e });
    }
    if (r.status === 429 || r.status >= 500) throw new Transitorio(String(r.status));
    if (r.status === 401 || r.status === 403) throw new ErroDeDominio("integracao_autenticacao", { cause: new Error(`tts ${r.status}`) });
    if (r.status === 400) throw new ErroDeDominio("entrada_invalida", { cause: new Error("tts 400") });
    if (!r.ok) throw new ErroDeDominio("conector_indisponivel", { cause: new Error(`tts ${r.status}`) });
    const json: unknown = await r.json();
    const b64 = typeof json === "object" && json !== null && "audioContent" in json && typeof json.audioContent === "string" ? json.audioContent : "";
    if (!b64) throw new ErroDeDominio("conector_indisponivel", { cause: new Error("tts sem audioContent") });
    return Buffer.from(b64, "base64");
  }

  return {
    id: "google",
    capacidades: { streaming: false, velocidade: true },
    async *sintetizar(p: PedidoTts) {
      if (p.sinal?.aborted) return;
      let bytes: Buffer | null = null;
      for (let tentativa = 1; bytes === null; tentativa++) {
        try {
          bytes = await pedir(p);
        } catch (e) {
          if (abortado(p.sinal, e)) return;
          if (!(e instanceof Transitorio)) {
            log("aviso", "voz_tts_falhou", { provedor: "google", codigo: e instanceof ErroDeDominio ? e.codigo : "desconhecido" });
            throw e;
          }
          log("aviso", "voz_tts_transitorio", { provedor: "google", motivo: e.message, tentativa });
          if (tentativa >= 2) throw new ErroDeDominio("conector_indisponivel", { cause: e });
          await new Promise((r) => setTimeout(r, ESPERA_NOVA_TENTATIVA_MS));
          if (p.sinal?.aborted) return;
        }
      }
      // LINEAR16 vem com cabeçalho WAV; sem ele (resposta crua), trata como PCM 24 kHz mono
      let pcm: Int16Array;
      if (bytes.toString("ascii", 0, 4) === "RIFF") {
        const wav = lerWav(bytes);
        const mono = misturarParaMono(wav.pcm, wav.canais);
        pcm = wav.taxa === TAXA_VOZ_HZ ? mono : reamostrar(mono, wav.taxa, TAXA_VOZ_HZ);
      } else {
        pcm = bytesParaPcm(bytes);
      }
      for (const pedaco of fatiar(pcm, AMOSTRAS_POR_PEDACO)) {
        if (p.sinal?.aborted) return;
        yield pedaco;
      }
    },
  };
}
