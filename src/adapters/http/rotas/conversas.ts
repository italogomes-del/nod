import type { RespostaMutacao } from "../../../contracts/api.ts";
import { enviarMensagem, lerConversa } from "../../../use-cases/enviar-mensagem.ts";
import { parar } from "../../../use-cases/parar.ts";
import type { Rota } from "../roteador.ts";
import { corpoObjeto, criarExecutor, texto, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";

/**
 * Conversas (lane L6): GET mensagens (ConversaDto com turnosPendentes, EMENDA 13), POST mensagem
 * (mensagem + turno + outbox na mesma tx) e Parar — da conversa e global (E5.4/E8).
 */
export function criarRotasConversas(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  return [
    {
      metodo: "GET",
      padrao: new RegExp(`^/conversas/${ID}/mensagens$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, lerConversa, { conversaId: ctx.params.id ?? "" }));
      },
    },
    {
      metodo: "POST",
      padrao: new RegExp(`^/conversas/${ID}/mensagens$`),
      async handler(ctx) {
        const corpo = corpoObjeto(await ctx.corpo());
        const r = await executar(ctx.escopo, enviarMensagem, {
          conversaId: ctx.params.id ?? "",
          texto: texto(corpo.texto),
          prazoMs: d.prazoDecisaoMs,
          executor: d.executor,
        });
        const resposta: RespostaMutacao = { ok: true, ids: { mensagem: r.mensagem.id, turno: r.turno.id, ...(r.negacao ? { negacao: r.negacao.id } : {}) } };
        ctx.json(201, resposta);
      },
    },
    {
      metodo: "POST",
      padrao: new RegExp(`^/conversas/${ID}/parar$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, parar, { conversaId: ctx.params.id ?? "" }));
      },
    },
    {
      metodo: "POST",
      padrao: /^\/parar$/,
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, parar, { conversaId: null }));
      },
    },
  ];
}
