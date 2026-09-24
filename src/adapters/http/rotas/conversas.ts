import type { RespostaMutacao } from "../../../contracts/api.ts";
import { TAMANHO_MAX_ANEXO } from "../../../contracts/anexo.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { lerAnexo, receberAnexo } from "../../../use-cases/anexos.ts";
import { enviarMensagem, lerConversa } from "../../../use-cases/enviar-mensagem.ts";
import { parar } from "../../../use-cases/parar.ts";
import { UUID, type Rota } from "../roteador.ts";
import { bytes, lerBruto } from "../util.ts";
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
          anexos: idsDeAnexo(corpo.anexos),
          prazoMs: d.prazoDecisaoMs,
          executor: d.executor,
        });
        const resposta: RespostaMutacao = { ok: true, ids: { mensagem: r.mensagem.id, turno: r.turno.id, ...(r.negacao ? { negacao: r.negacao.id } : {}) } };
        ctx.json(201, resposta);
      },
    },
    {
      // ADR-045: corpo BINÁRIO (o arquivo), tipo no content-type e nome em x-nod-nome. O cabeçalho próprio
      // força preflight num POST de outra origem — defesa a mais sobre o cookie SameSite=Strict.
      metodo: "POST",
      padrao: new RegExp(`^/conversas/${ID}/anexos$`),
      async handler(ctx) {
        const nome = ctx.req.headers["x-nod-nome"];
        if (typeof nome !== "string") throw new ErroDeDominio("entrada_invalida", { cause: "anexo sem x-nod-nome" });
        let conteudo: Buffer;
        try {
          conteudo = await lerBruto(ctx.req, TAMANHO_MAX_ANEXO);
        } catch (e) {
          if (e instanceof RangeError) throw new ErroDeDominio("entrada_invalida", { cause: "anexo: tamanho" });
          throw e;
        }
        const meta = await executar(ctx.escopo, receberAnexo, {
          conversaId: ctx.params.id ?? "",
          nome: decodificar(nome),
          mime: ctx.req.headers["content-type"] ?? "",
          conteudo,
        });
        ctx.json(201, meta);
      },
    },
    {
      metodo: "GET",
      padrao: new RegExp(`^/conversas/${ID}/anexos/(?<aid>[^/]+)$`),
      async handler(ctx) {
        const r = await executar(ctx.escopo, lerAnexo, { conversaId: ctx.params.id ?? "", anexoId: ctx.params.aid ?? "" });
        bytes(ctx.res, r.meta.mime, r.meta.nome, r.bytes);
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

function idsDeAnexo(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !UUID.test(x))) throw new ErroDeDominio("entrada_invalida", { cause: "anexos" });
  return v as string[];
}

function decodificar(nome: string): string {
  try {
    return decodeURIComponent(nome);
  } catch {
    return nome;
  }
}
