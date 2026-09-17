import { setTimeout as esperar } from "node:timers/promises";
import type { Inventario } from "../../../contracts/inventario.ts";
import type { PlanoTurno } from "../../../contracts/plano-turno.ts";
import type { Escopo } from "../../../shared/types.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import type { PonteInternaNod } from "../../fundo/ponte-interna.ts";
import { VERSAO_MINIMA_APP } from "../../fundo/ponte-interna.ts";
import type { Ctx, Rota } from "../roteador.ts";
import { cabecalhoCookieSessao } from "../sessao-cookie.ts";
import { entrega, exigir, inventario, objeto, sinais, texto, uuid } from "./ponte-validacao.ts";
import { versaoAceita } from "../../../domain/versao-app.ts";

type Conexao = { escopo: Escopo; ponte: PonteInternaNod; inv: Inventario; ultimo: number; puxando: boolean; plano: PlanoTurno | null; recebida?: { turnoId: string; seqLocal: number } };
export function criarPonteHttpServidor(d: {
  criar(escopo: Escopo): PonteInternaNod;
  persistir(escopo: Escopo, inv: Inventario): Promise<void>;
  autorizar(token: string): Promise<(Escopo & { chaveId: string }) | null>;
  segredo: string;
  seguro: boolean;
  agora(): number;
  delta(plano: PlanoTurno, texto: string): void;
  longpollMs?: number;
}) {
  const conexoes = new Map<string, Conexao>();
  const ausente = (): Inventario => ({ estado: "ausente", motivo: "Abra o app nod e conecte o Claude no seu computador", em: d.agora() });
  function atual(pessoaId: string): Inventario {
    const vivas = [...conexoes.values()].filter((c) => c.escopo.pessoaId === pessoaId && d.agora() - c.ultimo < 60_000);
    return vivas.find((c) => c.inv.estado === "pronto")?.inv ?? vivas[0]?.inv ?? ausente();
  }
  async function persistir(c: Conexao) { await d.persistir(c.escopo, atual(c.escopo.pessoaId)); }
  function conexao(ctx: Ctx): Conexao {
    const c = conexoes.get(ctx.params.chaveId ?? "");
    if (!c || c.escopo.pessoaId !== ctx.escopo.pessoaId || c.escopo.tenantId !== ctx.escopo.tenantId) throw new ErroDeDominio("estado_invalido");
    return c;
  }
  function rota(nome: string, fn: (ctx: Ctx, corpo: Record<string, unknown>) => Promise<void>): Rota {
    return { metodo: "POST", padrao: new RegExp(`^/${nome}$`), maquina: true, async handler(ctx) {
      ctx.res.setHeader("x-nod-versao-minima", VERSAO_MINIMA_APP);
      if (!versaoAceita(ctx.req.headers["x-nod-versao"], VERSAO_MINIMA_APP)) { ctx.json(426, { codigo: "atualize_app", versaoMinimaApp: VERSAO_MINIMA_APP }); return; }
      await fn(ctx, objeto(await ctx.corpo()));
    } };
  }
  const rotas = [
    rota("sessao", async (ctx) => {
      ctx.res.setHeader("set-cookie", cabecalhoCookieSessao(ctx.escopo, d.segredo, d.seguro));
      ctx.json(200, { escopo: ctx.escopo, machineId: ctx.params.chaveId });
    }),
    rota("conectar", async (ctx, b) => {
      exigir(b.versaoContrato === 1 && texto(b.nome, 100) && b.nome.trim());
      const id = ctx.params.chaveId!;
      let c = conexoes.get(id);
      if (!c) {
        c = { escopo: ctx.escopo, ponte: d.criar(ctx.escopo), inv: ausente(), ultimo: d.agora(), puxando: false, plano: null };
        conexoes.set(id, c);
      }
      if (c.plano) {
        if (d.agora() - c.ultimo < 90_000) throw new ErroDeDominio("estado_invalido");
        c.plano = null;
      }
      c.inv = inventario(b.inventario, d.agora()); c.ultimo = d.agora();
      await c.ponte.conectar({ machineId: id, nome: b.nome, inventario: c.inv, versaoContrato: 1 });
      await persistir(c);
      ctx.json(200, { machineId: id, escopo: ctx.escopo });
    }),
    rota("puxar", async (ctx) => {
      const c = conexao(ctx);
      if (c.puxando || c.plano) throw new ErroDeDominio("estado_invalido");
      c.puxando = true;
      try {
        const ate = d.agora() + (d.longpollMs ?? 20_000);
        do {
          if (ctx.res.destroyed) return;
          const identidade = await d.autorizar((ctx.req.headers.authorization ?? "").slice(7));
          if (!identidade) { ctx.json(401, { codigo: "nao_permitido" }); return; }
          c.ultimo = d.agora();
          if (c.inv.estado === "pronto") c.plano = await c.ponte.puxar(ctx.escopo.pessoaId);
          if (c.plano) break;
          await esperar(250);
        } while (d.agora() < ate);
        ctx.json(200, { plano: c.plano });
      } finally { c.puxando = false; }
    }),
    rota("renovar", async (ctx, b) => {
      const c = conexao(ctx), turnoId = uuid(b.turnoId);
      exigir(b.eventos === undefined || (Array.isArray(b.eventos) && b.eventos.length === 0));
      const s = sinais(b.sinais);
      if (c.plano?.turnoId !== turnoId) { ctx.json(200, { ativo: false, versaoMinimaApp: VERSAO_MINIMA_APP }); return; }
      c.ultimo = d.agora();
      const r = await c.ponte.renovar({ turnoId, machineId: ctx.params.chaveId!, sinais: s, eventos: [] });
      if (r.ativo && texto(b.delta, 16_000) && b.delta) d.delta(c.plano, b.delta);
      ctx.json(200, r);
    }),
    rota("entregar", async (ctx, b) => {
      const c = conexao(ctx), e = entrega(b, ctx.params.chaveId!);
      if (c.recebida?.turnoId === e.turnoId && c.recebida.seqLocal === e.seqLocal) { ctx.json(200, { ok: true }); return; }
      if (c.plano?.turnoId !== e.turnoId) throw new ErroDeDominio("nao_permitido");
      c.ultimo = d.agora();
      await c.ponte.entregar(e);
      c.recebida = { turnoId: e.turnoId, seqLocal: e.seqLocal };
      c.plano = null;
      ctx.json(200, { ok: true });
    }),
    rota("desconectar", async (ctx) => {
      const c = conexao(ctx);
      await c.ponte.desconectar(ctx.params.chaveId!);
      conexoes.delete(ctx.params.chaveId!);
      await persistir(c);
      ctx.json(200, { ok: true });
    }),
  ];
  async function varrer() {
    for (const [id, c] of conexoes) {
      if (d.agora() - c.ultimo < 60_000 || c.puxando) continue;
      c.inv = ausente();
      await persistir(c);
      if (d.agora() - c.ultimo >= 90_000) conexoes.delete(id);
    }
  }
  return { rotas, inventario: atual, varrer };
}
