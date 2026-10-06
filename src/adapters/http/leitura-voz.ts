import type { ServerResponse } from "node:http";
import { TAXA_VOZ_HZ } from "../../contracts/voz.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { log } from "../../obs/log.ts";
import type { Escopo } from "../../shared/types.ts";
import type { LeituraPreparada } from "../../use-cases/ouvir-mensagem.ts";
import type { Sintetizador } from "../voz/spi.ts";

/**
 * Leitor de respostas (definido em 2026-10-06, NOD-180; emenda à ADR-071): toca a resposta do bot com a voz dele, fora
 * da ligação, em streaming. O corpo é PCM16 big-endian mono a 24 kHz (`audio/L16; rate=24000`, RFC 2586): o navegador
 * toca sem esperar o fim, e nada é gravado em disco. Regras:
 * - teto diário de caracteres por pessoa, em memória (zera no reinício), reservado inteiro antes do 1º byte e
 *   devolvido no que não chegou ao TTS;
 * - uma leitura por pessoa: a nova cancela a anterior;
 * - a pessoa fechou (ou o servidor está saindo) → aborta o TTS na hora; nenhum trecho novo é pedido;
 * - prioridade "previa" no limitador do TTS: a ligação ao vivo passa na frente;
 * - no máximo `adianteMs` de áudio à frente do relógio, e o `drain` do socket segura o resto.
 */

/** definido em 2026-10-06: padrões das envs da leitura. */
export const CARACTERES_DIA_PADRAO = 100_000;
export const ADIANTE_MS_PADRAO = 15_000;

export type OpcoesLeitor = {
  tts: Sintetizador;
  /** Teto de caracteres lidos por pessoa por dia (America/Sao_Paulo); 0 = sem teto. */
  caracteresPorDia: number;
  /** Quanto áudio pode ir à frente do tempo real. */
  adianteMs: number;
  agora?: () => number;
};

export type PedidoDeLeitura = { escopo: Escopo; mensagemId: string; leitura: LeituraPreparada; res: ServerResponse };

export type LeitorDeVoz = {
  /** Lança `limite_atingido` (sem teto) ou `conector_indisponivel` (o TTS falhou antes do 1º byte); depois disso, nunca lança. */
  ler(p: PedidoDeLeitura): Promise<void>;
  /** Leituras tocando agora. */
  vivas(): number;
  /** O servidor está saindo: aborta todas. */
  fechar(): void;
};

const CABECALHOS_AUDIO = { "content-type": `audio/L16; rate=${TAXA_VOZ_HZ}; channels=1`, "cache-control": "no-store", "x-content-type-options": "nosniff" };

type Desfecho = "completa" | "cancelada" | "substituida" | "erro" | "desligando";

/** `NOD_VOZ_LEITURA_*`: inteiro ≥ 0; inválido → log de erro e o padrão (a leitura nunca derruba o servidor). */
export function lerInteiroDaLeitura(variavel: string, valor: string | undefined, padrao: number): number {
  const v = valor?.trim();
  if (!v) return padrao;
  if (!/^\d+$/.test(v)) {
    log("erro", "voz_leitura_env_invalida", { variavel, valor: v, mensagem: `${variavel} precisa ser um número inteiro; usando ${padrao}` });
    return padrao;
  }
  return Number(v);
}

/** Dia em São Paulo (UTC−3, sem horário de verão desde 2019), como chave do teto. */
function diaSp(agora: number): number {
  return Math.floor((agora - 3 * 3_600_000) / 86_400_000);
}

function paraBigEndian(pcm: Int16Array): Buffer {
  const b = Buffer.allocUnsafe(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) b.writeInt16BE(pcm[i] ?? 0, i * 2);
  return b;
}

/** Espera `ms` ou até o sinal abortar (sem lançar). */
function esperar(ms: number, sinal: AbortSignal): Promise<void> {
  if (sinal.aborted || ms <= 0) return Promise.resolve();
  return new Promise((resolver) => {
    const fim = () => {
      clearTimeout(t);
      sinal.removeEventListener("abort", fim);
      resolver();
    };
    const t = setTimeout(fim, ms);
    sinal.addEventListener("abort", fim, { once: true });
  });
}

/** Espera o `drain` do socket, o fechamento ou o abort (sem lançar). Socket já destruído não emite mais nada: volta já. */
function esperarDreno(res: ServerResponse, sinal: AbortSignal): Promise<void> {
  if (sinal.aborted || res.destroyed) return Promise.resolve();
  return new Promise((resolver) => {
    const fim = () => {
      res.off("drain", fim);
      res.off("close", fim);
      sinal.removeEventListener("abort", fim);
      resolver();
    };
    res.once("drain", fim);
    res.once("close", fim);
    sinal.addEventListener("abort", fim, { once: true });
  });
}

export function criarLeitorDeVoz(o: OpcoesLeitor): LeitorDeVoz {
  const agora = o.agora ?? (() => Date.now());
  const usados = new Map<string, number>();
  const ativas = new Map<string, AbortController>();
  let fechando = false;

  const chaveDoDia = (escopo: Escopo): string => `${diaSp(agora())}|${escopo.tenantId}|${escopo.pessoaId}`;

  function reservar(chave: string, n: number): boolean {
    const dia = chave.slice(0, chave.indexOf("|") + 1);
    for (const k of usados.keys()) if (!k.startsWith(dia)) usados.delete(k);
    const atual = usados.get(chave) ?? 0;
    if (o.caracteresPorDia > 0 && atual + n > o.caracteresPorDia) return false;
    usados.set(chave, atual + n);
    return true;
  }

  function devolver(chave: string, n: number): void {
    const atual = usados.get(chave);
    if (atual === undefined || n <= 0) return;
    usados.set(chave, Math.max(0, atual - n));
  }

  return {
    vivas: () => ativas.size,

    fechar() {
      fechando = true;
      for (const c of ativas.values()) c.abort("desligando");
    },

    async ler({ escopo, mensagemId, leitura, res }) {
      if (fechando) throw new ErroDeDominio("conector_indisponivel", { cause: "servidor saindo" });
      const chave = chaveDoDia(escopo);
      if (!reservar(chave, leitura.caracteres)) throw new ErroDeDominio("limite_atingido", { cause: "leitura: teto diário" });
      const pessoa = `${escopo.tenantId}|${escopo.pessoaId}`;
      ativas.get(pessoa)?.abort("substituida");
      const ctrl = new AbortController();
      ativas.set(pessoa, ctrl);
      const sinal = ctrl.signal;
      const aoFechar = () => {
        if (!res.writableEnded) ctrl.abort("cancelada");
      };
      res.on("close", aoFechar);
      // A pessoa pode ter fechado enquanto a rota lia o banco: o `close` já passou e não volta.
      if (res.destroyed) ctrl.abort("cancelada");

      const inicio = agora();
      let consumidos = 0;
      let trechos = 0;
      let bytes = 0;
      let audioMs = 0;
      let desfecho: Desfecho = "completa";
      let falha: unknown = null;
      try {
        for (const texto of leitura.trechos) {
          if (sinal.aborted) break;
          consumidos += texto.length;
          trechos++;
          for await (const pcm of o.tts.sintetizar({ texto, voz: leitura.voz, velocidade: leitura.velocidade, sinal, prioridade: "previa" })) {
            if (sinal.aborted) break;
            if (!res.headersSent) res.writeHead(200, CABECALHOS_AUDIO);
            const b = paraBigEndian(pcm);
            bytes += b.length;
            audioMs += (pcm.length * 1000) / TAXA_VOZ_HZ;
            if (!res.write(b)) await esperarDreno(res, sinal);
            if (res.destroyed && !sinal.aborted) ctrl.abort("cancelada");
            const adiantado = audioMs - (agora() - inicio) - o.adianteMs;
            if (adiantado > 0) await esperar(adiantado, sinal);
          }
        }
        if (sinal.aborted) desfecho = (sinal.reason as Desfecho | undefined) ?? "cancelada";
        else {
          if (!res.headersSent) res.writeHead(200, CABECALHOS_AUDIO);
          res.end();
        }
      } catch (e) {
        if (sinal.aborted) desfecho = (sinal.reason as Desfecho | undefined) ?? "cancelada";
        else {
          desfecho = "erro";
          falha = e;
        }
      } finally {
        res.off("close", aoFechar);
        devolver(chave, leitura.caracteres - consumidos);
        if (ativas.get(pessoa) === ctrl) ativas.delete(pessoa);
        // Sem o texto: só números (ADR-075).
        log(desfecho === "erro" ? "aviso" : "info", "voz_leitura", {
          mensagem_id: mensagemId,
          agente_id: leitura.agenteId,
          trechos,
          caracteres: consumidos,
          bytes,
          ms: agora() - inicio,
          desfecho,
          provedor: o.tts.id,
          ...(falha ? { erro: falha instanceof Error ? falha.name : "desconhecido" } : {}),
        });
      }
      if (desfecho === "erro") {
        // Antes do 1º byte a rota ainda responde 502; depois, o áudio corta (o roteador não pode mais mudar o status).
        if (!res.headersSent) throw new ErroDeDominio("conector_indisponivel", { cause: falha });
        res.destroy();
      } else if (desfecho !== "completa" && !res.writableEnded && !res.destroyed) res.destroy();
    },
  };
}
