import type { RespostaMutacao } from "../../../contracts/api.ts";
import { detalharTrabalho, listarTrabalhos, pararTrabalho } from "../../../use-cases/trabalhos.ts";
import type { Rota } from "../roteador.ts";
import { criarExecutor, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";

/** O `agenteId` da query só segue se for uuid (id de fora nunca chega cru ao Postgres, AGENTS.md). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Trabalhos do bot (definido em 2026-10-07, ADR-081 §8): a faixa, a gaveta, "Todos os trabalhos" e a tela da task.
 * O estado vivo chega pelo frame `trabalho.mudou`; a web relê por aqui.
 */
export function criarRotasTrabalhos(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  return [
    {
      metodo: "GET",
      padrao: /^\/trabalhos$/,
      async handler(ctx) {
        const agenteId = new URL(ctx.req.url ?? "/", "http://127.0.0.1").searchParams.get("agenteId");
        if (agenteId !== null && !UUID.test(agenteId)) {
          ctx.json(404, { codigo: "nao_encontrado" });
          return;
        }
        ctx.json(200, await executar(ctx.escopo, listarTrabalhos, agenteId ? { agenteId } : {}));
      },
    },
    {
      metodo: "GET",
      padrao: new RegExp(`^/trabalhos/${ID}$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, detalharTrabalho, { trabalhoId: ctx.params.id ?? "" }));
      },
    },
    {
      metodo: "POST",
      padrao: new RegExp(`^/trabalhos/${ID}/parar$`),
      async handler(ctx) {
        const r = await executar(ctx.escopo, pararTrabalho, { trabalhoId: ctx.params.id ?? "" });
        const resposta: RespostaMutacao & { trabalho: typeof r.trabalho; interrompidos: number } = { ok: true, ids: { trabalho: r.trabalho.id }, trabalho: r.trabalho, interrompidos: r.interrompidos };
        ctx.json(200, resposta);
      },
    },
  ];
}
