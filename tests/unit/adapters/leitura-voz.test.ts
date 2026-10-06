import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import { expect, it } from "vitest";
import { criarLeitorDeVoz } from "../../../src/adapters/http/leitura-voz.ts";
import { criarProvedoresFalsos } from "../../../src/adapters/voz/voz-falsa.ts";
import type { Sintetizador } from "../../../src/adapters/voz/spi.ts";
import type { LeituraPreparada } from "../../../src/use-cases/ouvir-mensagem.ts";

/**
 * Leitor de respostas (NOD-180), sem servidor: a resposta HTTP é um EventEmitter com o que o leitor usa. O caso que o
 * servidor completo não pega fácil é a pessoa fechar enquanto a rota ainda lê o banco: o `close` já passou quando o
 * leitor começa, `write` devolve false e o `drain` nunca vem.
 */
const escopo = { tenantId: "00000000-0000-4000-8000-000000000001", pessoaId: "00000000-0000-4000-8000-000000000002" };
const leitura: LeituraPreparada = { agenteId: "a", trechos: ["Primeira frase.", "Segunda frase."], voz: "v", velocidade: 1, caracteres: 29 };

function respostaJaFechada(): ServerResponse & { escritas: number } {
  const r = Object.assign(new EventEmitter(), {
    escritas: 0,
    destroyed: true,
    writableEnded: false,
    headersSent: false,
    writeHead() {
      r.headersSent = true;
      return r;
    },
    write() {
      r.escritas++;
      return false;
    },
    end() {
      r.writableEnded = true;
    },
    destroy() {},
  });
  return r as unknown as ServerResponse & { escritas: number };
}

function ttsContado(): Sintetizador & { pedidos: number } {
  const base = criarProvedoresFalsos().tts;
  const t = { ...base, pedidos: 0, sintetizar: (p: Parameters<Sintetizador["sintetizar"]>[0]) => (t.pedidos++, base.sintetizar(p)) };
  return t;
}

it("a pessoa fechou antes de o áudio começar: não chama o TTS, não trava e devolve o teto", async () => {
  const tts = ttsContado();
  const leitor = criarLeitorDeVoz({ tts, caracteresPorDia: 29, adianteMs: 1_000 });
  const res = respostaJaFechada();
  const fim = leitor.ler({ escopo, mensagemId: "m", leitura, res });
  const venceu = await Promise.race([fim.then(() => "terminou"), new Promise((ok) => setTimeout(() => ok("travou"), 2_000))]);
  expect(venceu).toBe("terminou");
  expect(tts.pedidos).toBe(0);
  expect(res.escritas).toBe(0);
  expect(leitor.vivas()).toBe(0);
  // O teto inteiro voltou: a mesma leitura cabe de novo.
  await leitor.ler({ escopo, mensagemId: "m", leitura, res: respostaJaFechada() });
  leitor.fechar();
});

it("o socket cai no meio (write false, sem drain nem close novos): a espera não trava", async () => {
  const tts = ttsContado();
  const leitor = criarLeitorDeVoz({ tts, caracteresPorDia: 0, adianteMs: 60_000 });
  const res = respostaJaFechada();
  res.destroyed = false;
  res.write = () => {
    res.escritas++;
    res.destroyed = true;
    return false;
  };
  const fim = leitor.ler({ escopo, mensagemId: "m", leitura, res });
  const venceu = await Promise.race([fim.then(() => "terminou"), new Promise((ok) => setTimeout(() => ok("travou"), 2_000))]);
  expect(venceu).toBe("terminou");
  expect(res.escritas).toBe(1);
  expect(tts.pedidos).toBe(1);
  leitor.fechar();
});
