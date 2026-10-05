import { log } from "../../../obs/log.ts";
import type { Rota } from "../roteador.ts";

/** definido em 2026-10-05 (NOD-175): o `select 1` tem 2 s; o healthcheck do compose e o laço do deploy.sh esperam um nod que fala com o banco. */
export const PRAZO_SAUDE_BANCO_MS = 2_000;

/**
 * `GET /api/saude`. Com `verificar` (o boot passa um `select 1`), responde 200 só se o banco respondeu no prazo; falha ou
 * prazo → 503 `{ok:false}`, sem detalhe no corpo nem a message no log. Sem `verificar` (testes do roteador), 200 como antes.
 * A rota é pública: pedidos simultâneos compartilham a verificação em voo, para não empilhar `select 1` no pool com o
 * banco pendurado.
 */
export function criarRotaSaude(verificar?: () => Promise<unknown>): Rota {
  let emVoo: Promise<"erro" | "prazo" | null> | null = null;
  function verificarComPrazo(v: () => Promise<unknown>): Promise<"erro" | "prazo" | null> {
    let prazo: ReturnType<typeof setTimeout> | undefined;
    return Promise.race([
      Promise.resolve()
        .then(v)
        .then(
          () => null,
          () => "erro" as const,
        ),
      new Promise<"prazo">((r) => {
        prazo = setTimeout(() => r("prazo"), PRAZO_SAUDE_BANCO_MS);
      }),
    ]).finally(() => clearTimeout(prazo));
  }
  return {
    metodo: "GET",
    padrao: /^\/saude$/,
    publica: true,
    async handler(ctx) {
      if (!verificar) {
        ctx.json(200, { ok: true });
        return;
      }
      emVoo ??= verificarComPrazo(verificar).finally(() => {
        emVoo = null;
      });
      const motivo = await emVoo;
      if (motivo === null) {
        ctx.json(200, { ok: true });
        return;
      }
      log("aviso", "saude_banco_falhou", { motivo });
      ctx.json(503, { ok: false });
    },
  };
}
