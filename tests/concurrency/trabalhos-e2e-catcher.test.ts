import { describe, it } from "vitest";

/**
 * E2E com o catcher dos trabalhos em paralelo (ADR-081, épico #188). definido em 2026-10-07: estes cenários precisam dos
 * marcadores `[[espera: ms]]` (o catcher segura uma ferramenta) e `[[sessao: id]]` (o catcher devolve uma sessão), que a
 * frente A traz em src/adapters/executor/drivers/catcher.ts e tests/helpers/catcher-roteiro.ts (S9). Na frente B eles
 * ainda não existem: os casos ficam registrados como `todo` e viram teste no merge das frentes. O que eles exercitam já
 * está provado sem o catcher em tests/integration/coordenacao-trabalhos.test.ts, tests/integration/trabalhos-*.test.ts,
 * tests/concurrency/serializacao-por-conversa.test.ts e tests/concurrency/trabalhos-ponte-http.test.ts.
 */
describe("e2e com catcher: trabalhos em paralelo (#192, #193, #194)", () => {
  it.todo("#192: um bot com rotina, pedido de colega e task da pessoa roda os três ao mesmo tempo ([[espera]] nos três) e a mensagem da conversa é respondida enquanto eles rodam");
  it.todo("#192: duas tasks do mesmo bot terminam com sessões ([[sessao]]) e pastas diferentes; a retomada de cada uma volta na sessão dela");
  it.todo("#193: \"monta o dashboard de churn\" durante uma task abre uma segunda task (abrir_task no roteiro); \"Fazer depois\" grava depois_de e ela espera a primeira terminar");
  it.todo("#193: turno de conversa com ferramenta de 150 s ([[espera: 150000]]) vira task aos 120 s; uma mensagem aos 130 s é despachada em até 5 s com entrada.bifurcar");
  it.todo("#193: mandar_para_task com a task rodando chega no meio do turno dela (renovação com aceitaMensagens) e nunca no da conversa");
  it.todo("#194: com NOD_SIMULAR_PRESSAO=2 no laço, abrir uma task publica memoria.mudou amarela uma vez; com 4, nenhuma task rodando é encerrada");
});
