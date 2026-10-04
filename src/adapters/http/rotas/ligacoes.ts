import type { Escopo } from "../../../shared/types.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import {
  apagarTranscricao,
  avaliarLigacao,
  consentirVoz,
  definirVozDoAgente,
  disponibilidadeLigacao,
  encerrarLigacao,
  falasDaLigacao,
  ligacaoViva,
  ligar,
  type ContextoLigacao,
} from "../../../use-cases/ligacoes.ts";
import type { Rota } from "../roteador.ts";
import { corpoObjeto, criarExecutor, texto, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";

/** O que a rota precisa da composição além das Deps: o estado vivo da voz e das máquinas. */
export type DepsRotasLigacoes = DepsRotas & {
  contexto(escopo: Escopo, agenteId: string): Promise<ContextoLigacao>;
  /** Depois do commit do POST: registra a ligação no orquestrador de voz (memória). */
  registrar(escopo: Escopo, l: { ligacaoId: string; agenteId: string; conversaId: string; turnoId: string; voz: string; velocidade: number; nomeBot: string; genero: "feminina" | "masculina" }): void;
  encerrarViva(ligacaoId: string): Promise<void>;
  /** A prévia de uma voz (WAV) para escolher a voz do bot; null = voz desconhecida ou fora do ar. */
  amostra(voz: string, velocidade: number): Promise<Buffer | null>;
  maxS: number;
};

/**
 * Rotas da ligação por voz (definido em 2026-10-04, ADR-072/075). O áudio não passa por aqui: vai pelo WebSocket de
 * mídia (src/adapters/voz/ws.ts). Aqui ficam disponibilidade, ligar, desligar, a transcrição, a avaliação, o
 * consentimento e a voz do bot.
 */
export function criarRotasLigacoes(d: DepsRotasLigacoes): Rota[] {
  const executar = criarExecutor(d);
  return [
    {
      metodo: "GET",
      padrao: /^\/ligacoes\/disponibilidade$/,
      async handler(ctx) {
        const agenteId = new URL(ctx.req.url ?? "/", "http://x").searchParams.get("agenteId") ?? "";
        if (!/^[0-9a-f-]{36}$/i.test(agenteId)) throw new ErroDeDominio("entrada_invalida", { cause: "agenteId" });
        const contexto = await d.contexto(ctx.escopo, agenteId);
        ctx.json(200, await executar(ctx.escopo, disponibilidadeLigacao, { agenteId, contexto }));
      },
    },
    {
      metodo: "GET",
      padrao: /^\/ligacoes\/viva$/,
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, ligacaoViva, {}));
      },
    },
    {
      metodo: "POST",
      padrao: /^\/ligacoes$/,
      async handler(ctx) {
        const agenteId = texto(corpoObjeto(await ctx.corpo()).agenteId);
        if (!/^[0-9a-f-]{36}$/i.test(agenteId)) throw new ErroDeDominio("entrada_invalida", { cause: "agenteId" });
        const contexto = await d.contexto(ctx.escopo, agenteId);
        const r = await executar(ctx.escopo, ligar, { agenteId, contexto, executor: d.executor });
        d.registrar(ctx.escopo, { ligacaoId: r.ligacao.id, agenteId, conversaId: r.ligacao.conversaId, turnoId: r.turno.id, voz: r.voz, velocidade: r.velocidade, nomeBot: r.nomeBot, genero: r.genero });
        ctx.json(201, { ligacao: r.ligacao, maxS: d.maxS });
      },
    },
    {
      metodo: "POST",
      padrao: new RegExp(`^/ligacoes/${ID}/encerrar$`),
      async handler(ctx) {
        const id = ctx.params.id ?? "";
        // O orquestrador fecha a mídia e manda o `fim` ao cérebro; se ele não tiver a ligação (reinício), o banco fecha.
        await d.encerrarViva(id);
        const l = await executar(ctx.escopo, encerrarLigacao, { ligacaoId: id, motivo: "pessoa_desligou" });
        if (!l) throw new ErroDeDominio("nao_encontrado");
        ctx.json(200, { ligacao: l });
      },
    },
    {
      metodo: "GET",
      padrao: new RegExp(`^/ligacoes/${ID}/falas$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, falasDaLigacao, { ligacaoId: ctx.params.id ?? "" }));
      },
    },
    {
      metodo: "DELETE",
      padrao: new RegExp(`^/ligacoes/${ID}/falas$`),
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, apagarTranscricao, { ligacaoId: ctx.params.id ?? "" }));
      },
    },
    {
      metodo: "POST",
      padrao: new RegExp(`^/ligacoes/${ID}/avaliacao$`),
      async handler(ctx) {
        const b = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, avaliarLigacao, { ligacaoId: ctx.params.id ?? "", nota: b.nota, motivo: b.motivo }));
      },
    },
    {
      metodo: "POST",
      padrao: /^\/voz\/consentimento$/,
      async handler(ctx) {
        ctx.json(200, await executar(ctx.escopo, consentirVoz, { versao: corpoObjeto(await ctx.corpo()).versao }));
      },
    },
    {
      // A prévia da voz (definido em 2026-10-04): o mesmo provedor das ligações, uma frase curta, em cache.
      metodo: "GET",
      padrao: /^\/voz\/amostra$/,
      async handler(ctx) {
        const q = new URL(ctx.req.url ?? "/", "http://x").searchParams;
        const velocidade = Number(q.get("velocidade") ?? "1");
        const wav = await d.amostra(q.get("voz") ?? "", Number.isFinite(velocidade) ? velocidade : 1);
        if (!wav) throw new ErroDeDominio("nao_encontrado", { cause: "voz" });
        ctx.res.writeHead(200, { "content-type": "audio/wav", "content-length": String(wav.length), "cache-control": "private, max-age=3600" });
        ctx.res.end(wav);
      },
    },
    {
      // A voz do bot e a velocidade (Ajustes da ligação, detalhes do bot). Vale na próxima frase da ligação.
      metodo: "PATCH",
      padrao: new RegExp(`^/agentes/${ID}/voz$`),
      async handler(ctx) {
        const b = corpoObjeto(await ctx.corpo());
        ctx.json(200, await executar(ctx.escopo, definirVozDoAgente, { agenteId: ctx.params.id ?? "", voz: b.voz, vozVelocidade: b.vozVelocidade }));
      },
    },
  ];
}
