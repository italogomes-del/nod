import { HARNESSES } from "../../../contracts/harness.ts";
import type { IdHarness } from "../../../contracts/harness.ts";
import { setTimeout as esperar } from "node:timers/promises";
import type { Inventario } from "../../../contracts/inventario.ts";
import type { PlanoTurno } from "../../../contracts/plano-turno.ts";
import type { VigiaVivo } from "../../../contracts/ponte.ts";
import type { TarefaDoBot } from "../../../contracts/turno.ts";
import type { Escopo } from "../../../shared/types.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { log } from "../../../obs/log.ts";
import type { PonteInternaNod } from "../../fundo/ponte-interna.ts";
import { VERSAO_MINIMA_APP } from "../../fundo/ponte-interna.ts";
import type { Ctx, Rota } from "../roteador.ts";
import { cabecalhoCookieSessao } from "../sessao-cookie.ts";
import { entrega, exigir, falas, inventario, objeto, sinais, texto, trechos, uuid } from "./ponte-validacao.ts";
import { versaoAceita } from "../../../domain/versao-app.ts";

/**
 * `planos`: os turnos que esta máquina está rodando AGORA (definido em 2026-09-24). Com o pool de laços
 * o app roda um turno por agente em paralelo; antes era um `plano` só e a renovação do segundo turno
 * voltava {ativo:false}, matando a CLI. `recebidas` guarda a última entrega de cada turno (idempotência).
 */
type Conexao = { escopo: Escopo; ponte: PonteInternaNod; inv: Inventario; ultimo: number; puxando: boolean; planos: Map<string, PlanoTurno>; recebidas: Map<string, number>; gh: boolean };

/** Um item aprovado que roda no Mac da dona (ADR-048): o que a máquina recebe ao puxar `itens-locais`. */
export type ItemLocal = { itemId: string; capacidade: string; argumentos: Record<string, unknown> };
export type DesfechoLocal = "executado" | "falhou_na_execucao";
/**
 * definido em 2026-09-24: um item entregue a uma máquina fica reservado para ela por 2 min — duas
 * máquinas da mesma pessoa não executam o mesmo comentário. Reserva vencida volta para a fila (o
 * resultado que chegar depois ainda é aceito uma vez: o desfecho só é gravado se estava aberto).
 */
const RESERVA_ITEM_MS = 120_000;
const RECEBIDAS_GUARDADAS = 64;
export function criarPonteHttpServidor(d: {
  criar(escopo: Escopo): PonteInternaNod;
  persistir(escopo: Escopo, inv: Inventario): Promise<void>;
  autorizar(token: string): Promise<(Escopo & { chaveId: string }) | null>;
  segredo: string;
  seguro: boolean;
  agora(): number;
  delta(plano: PlanoTurno, texto: string): void;
  ferramenta(plano: PlanoTurno, nome: string): void;
  /** A lista de tarefas do bot, inteira, quando muda (definido em 2026-09-28). */
  tarefas(plano: PlanoTurno, tarefas: TarefaDoBot[]): void;
  /** ADR-067: uma fala da sessão viva foi gravada — a tela troca o texto ao vivo pela mensagem. */
  fala?(plano: PlanoTurno): void;
  /** NOD-73: o vigia do turno avisou (só nome e números) — publica turno.vigia e registra no log. */
  vigia?(plano: PlanoTurno, aviso: VigiaVivo): void;
  longpollMs?: number;
  /** ADR-048: itens aprovados que esperam o gh do Mac desta pessoa, e o desfecho que o Mac relata. */
  itensLocais?(escopo: Escopo): Promise<ItemLocal[]>;
  concluirItemLocal?(escopo: Escopo, itemId: string, desfecho: DesfechoLocal): Promise<void>;
  /** definido em 2026-10-05: o Mac anunciou uma IA pronta — repete as falas que ficaram sem resposta por falta de IA. */
  repetirBarrados?(escopo: Escopo, prontos: readonly IdHarness[]): Promise<void>;
}) {
  const conexoes = new Map<string, Conexao>();
  const reservas = new Map<string, { machineId: string; ate: number }>();
  /**
   * definido em 2026-10-05 (NOD-175): na drenagem do SIGTERM o puxar não reserva turno novo — o turno fica `pendente` no
   * Postgres (ADR-010) para o próximo processo. `reservando` conta os `ponte.puxar` em voo: o que já reservou antes da
   * drenagem é ENTREGUE (o token foi cunhado e `ativos()` passa a contá-lo), nunca desfeito; a drenagem espera esse zero.
   */
  let drenando = false;
  let reservando = 0;
  const ausente = (): Inventario => ({ estado: "ausente", motivo: "Abra o app nod e conecte sua conta de IA no seu computador", em: d.agora() });
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
        c = { escopo: ctx.escopo, ponte: d.criar(ctx.escopo), inv: ausente(), ultimo: d.agora(), puxando: false, planos: new Map(), recebidas: new Map(), gh: false };
        conexoes.set(id, c);
      }
      if (c.planos.size > 0) {
        if (d.agora() - c.ultimo < 90_000) throw new ErroDeDominio("estado_invalido");
        c.planos.clear();
      }
      c.inv = inventario(b.inventario, d.agora()); c.ultimo = d.agora();
      // ADR-048: o gh desta máquina (app ≥ 2026-09-24). Ausente = app antigo = sem gh.
      c.gh = objeto(b.github ?? {}).gh === true;
      const motores: Partial<Record<IdHarness, Inventario>> = {};
      if (b.harnesses !== undefined) {
        const anunciados = objeto(b.harnesses);
        for (const h of HARNESSES) if (anunciados[h.id] !== undefined && h.integrado) motores[h.id] = inventario(anunciados[h.id], d.agora(), h.nome);
      }
      // NOD-167: só ids integrados e prontos neste anúncio; qualquer outra coisa é ignorada (app antigo não manda o campo).
      const semLacoDeVoz = Array.isArray(b.semLacoDeVoz) ? HARNESSES.filter((h) => h.integrado && (b.semLacoDeVoz as unknown[]).includes(h.id) && motores[h.id]?.estado === "pronto").map((h) => h.id) : [];
      await c.ponte.conectar({ machineId: id, nome: b.nome, inventario: c.inv, versaoContrato: 1, harnesses: b.harnesses === undefined ? { "claude-cli": c.inv } : motores, ligacao: b.ligacao === true, ...(semLacoDeVoz.length > 0 ? { semLacoDeVoz } : {}) });
      await persistir(c);
      // Melhor esforço: a conexão não pode falhar porque a repetição falhou.
      if (c.inv.estado === "pronto" && d.repetirBarrados) {
        const prontos = Object.entries(harnessesDaPessoa(ctx.escopo.pessoaId)).filter(([, i]) => i?.estado === "pronto").map(([h]) => h as IdHarness);
        await d.repetirBarrados(ctx.escopo, prontos).catch(() => log("aviso", "repetir_barrados_falhou", {}));
      }
      ctx.json(200, { machineId: id, escopo: ctx.escopo });
    }),
    rota("puxar", async (ctx) => {
      const c = conexao(ctx);
      if (c.puxando) throw new ErroDeDominio("estado_invalido");
      c.puxando = true;
      try {
        const ate = d.agora() + (d.longpollMs ?? 20_000);
        let plano: PlanoTurno | null = null;
        do {
          if (ctx.res.destroyed) return;
          const identidade = await d.autorizar((ctx.req.headers.authorization ?? "").slice(7));
          if (!identidade) { ctx.json(401, { codigo: "nao_permitido" }); return; }
          c.ultimo = d.agora();
          if (drenando) break;
          if (c.inv.estado === "pronto") {
            reservando++;
            try { plano = await c.ponte.puxar(ctx.escopo.pessoaId); } finally { reservando--; }
          }
          if (plano) { c.planos.set(plano.turnoId, plano); break; }
          if (drenando) break;
          await esperar(250);
        } while (d.agora() < ate);
        ctx.json(200, { plano });
      } finally { c.puxando = false; }
    }),
    rota("renovar", async (ctx, b) => {
      const c = conexao(ctx), turnoId = uuid(b.turnoId);
      exigir(b.eventos === undefined || (Array.isArray(b.eventos) && b.eventos.length === 0));
      const s = sinais(b.sinais);
      const plano = c.planos.get(turnoId);
      if (!plano) { ctx.json(200, { ativo: false, versaoMinimaApp: VERSAO_MINIMA_APP }); return; }
      c.ultimo = d.agora();
      // ADR-067: as falas da sessão viva e o pedido de mensagens novas viajam na renovação.
      const fs = falas(b.falas);
      const r = await c.ponte.renovar({ turnoId, machineId: ctx.params.chaveId!, sinais: s, eventos: [], ...(fs.length ? { falas: fs } : {}), ...(b.aceitaMensagens === true ? { aceitaMensagens: true } : {}) });
      if (fs.length && r.ativo) d.fala?.(plano);
      if (r.ativo && texto(b.delta, 16_000) && b.delta) d.delta(plano, b.delta);
      if (r.ativo) for (const t of trechos(b.trechos)) {
        if ("ferramenta" in t) d.ferramenta(plano, t.ferramenta);
        else if ("tarefas" in t) d.tarefas(plano, t.tarefas);
        else if ("vigia" in t) d.vigia?.(plano, t.vigia);
        else if (t.texto) d.delta(plano, t.texto);
      }
      ctx.json(200, r);
    }),
    rota("entregar", async (ctx, b) => {
      const c = conexao(ctx), e = entrega(b, ctx.params.chaveId!);
      if (c.recebidas.get(e.turnoId) === e.seqLocal) { ctx.json(200, { ok: true }); return; }
      if (!c.planos.has(e.turnoId)) throw new ErroDeDominio("nao_permitido");
      c.ultimo = d.agora();
      await c.ponte.entregar(e);
      // definido em 2026-10-05: o turno reprovou a conta da IA (ponte-interna, reprovarHarness) — o inventário desta
      // conexão acompanha, para a tela e o banco não continuarem dizendo "pronta".
      if (e.resultado.causaSemIa) {
        const m = c.ponte.maquinasConectadas().find((x) => x.machineId === e.machineId);
        if (m) { c.inv = m.inventario; await persistir(c); }
      }
      c.recebidas.set(e.turnoId, e.seqLocal);
      if (c.recebidas.size > RECEBIDAS_GUARDADAS) c.recebidas.delete(c.recebidas.keys().next().value!);
      c.planos.delete(e.turnoId);
      ctx.json(200, { ok: true });
    }),
    /**
     * ADR-048: a máquina PUXA os itens aprovados que rodam no gh dela — o servidor nunca disca (ADR-021).
     * Só a máquina que anunciou o gh recebe; a pessoa é a da chave, nunca do corpo.
     */
    rota("itens-locais", async (ctx) => {
      const c = conexao(ctx);
      c.ultimo = d.agora();
      if (!c.gh || !d.itensLocais) { ctx.json(200, { itens: [] }); return; }
      const agora = d.agora();
      // revisto em 2026-09-25: reserva viva não volta nem para a máquina que a segura — comentar e
      // revisar no GitHub não são idempotentes; se o relato falhou, a máquina reenvia só o relato.
      const livres = (await d.itensLocais(ctx.escopo)).filter((i) => {
        const r = reservas.get(i.itemId);
        return !r || r.ate <= agora;
      }).slice(0, 10);
      for (const i of livres) reservas.set(i.itemId, { machineId: ctx.params.chaveId!, ate: agora + RESERVA_ITEM_MS });
      ctx.json(200, { itens: livres });
    }),
    rota("itens-locais/resultado", async (ctx, b) => {
      const c = conexao(ctx);
      const itemId = uuid(b.itemId);
      exigir(b.desfecho === "executado" || b.desfecho === "falhou_na_execucao");
      // Reserva perdida (servidor reiniciou) não recusa o relato: sem ele a máquina puxaria e rodaria de
      // novo. Recusa só a reserva viva de OUTRA máquina; o desfecho é gravado uma vez (se aberto).
      const r = reservas.get(itemId);
      if (!c.gh || (r && r.ate > d.agora() && r.machineId !== ctx.params.chaveId)) throw new ErroDeDominio("nao_permitido");
      c.ultimo = d.agora();
      await d.concluirItemLocal?.(ctx.escopo, itemId, b.desfecho as DesfechoLocal);
      reservas.delete(itemId);
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
  function harnesses(escopo: Escopo, machineId: string): Partial<Record<IdHarness, Inventario>> {
    const c = conexoes.get(machineId);
    if (!c || c.escopo.pessoaId !== escopo.pessoaId || c.escopo.tenantId !== escopo.tenantId || d.agora() - c.ultimo >= 60_000) return {};
    return c.ponte.maquinasConectadas().find((m) => m.machineId === machineId)?.harnesses ?? { "claude-cli": c.inv };
  }
  function harnessesDaPessoa(pessoaId: string): Partial<Record<IdHarness, Inventario>> {
    const todos: Partial<Record<IdHarness, Inventario>> = {};
    for (const [id, c] of conexoes) if (c.escopo.pessoaId === pessoaId) for (const [h, inv] of Object.entries(harnesses(c.escopo, id))) {
      const key = h as IdHarness; if (todos[key]?.estado !== "pronto") todos[key] = inv;
    }
    return todos;
  }
  /** Último contato da máquina pela ponte (conectar/puxar/renovar/entregar); null = não está conectada. */
  function ultimoContato(machineId: string): number | null {
    return conexoes.get(machineId)?.ultimo ?? null;
  }
  /** ADR-048: a máquina do turno anunciou o gh e é da pessoa do escopo (a chave é por pessoa). */
  function ghDaMaquina(escopo: Escopo, machineId: string): boolean {
    const c = conexoes.get(machineId);
    return !!c && c.gh && c.escopo.pessoaId === escopo.pessoaId && c.escopo.tenantId === escopo.tenantId && d.agora() - c.ultimo < 60_000;
  }
  /** ADR-072: alguma máquina viva da pessoa anunciou o laço de voz (app que sabe atender ligação). */
  function ligacaoDaPessoa(pessoaId: string): boolean {
    return [...conexoes.entries()].some(([id, c]) => c.escopo.pessoaId === pessoaId && d.agora() - c.ultimo < 60_000 && c.ponte.maquinasConectadas().some((m) => m.machineId === id && m.ligacao === true));
  }
  /**
   * NOD-167: a IA está pronta em alguma máquina viva da pessoa que atende ligação, e TODAS essas a anunciaram sem o laço
   * de voz (o Codex sem `app-server`). Basta uma máquina com o laço para não recusar.
   */
  function semLacoDeVozDaPessoa(pessoaId: string, harness: IdHarness): boolean {
    const maquinas = [...conexoes.entries()].flatMap(([id, c]) => c.escopo.pessoaId === pessoaId && d.agora() - c.ultimo < 60_000 ? c.ponte.maquinasConectadas().filter((m) => m.machineId === id && m.ligacao === true && m.harnesses?.[harness]?.estado === "pronto") : []);
    return maquinas.length > 0 && maquinas.every((m) => m.semLacoDeVoz?.includes(harness) === true);
  }
  /** Alguma máquina viva da pessoa tem o gh: o registro automático do GitHub pode nascer dele. */
  function ghDaPessoa(pessoaId: string): boolean {
    return [...conexoes.entries()].some(([id, c]) => c.escopo.pessoaId === pessoaId && ghDaMaquina(c.escopo, id));
  }
  /** NOD-175: a partir daqui o puxar volta `{plano:null}` na hora; renovar e entregar seguem aceitos. Não se desfaz. */
  function iniciarDrenagem(): void { drenando = true; }
  /** NOD-175: quantos `ponte.puxar` estão em voo (reserva que pode virar token vivo). */
  function reservasEmVoo(): number { return reservando; }
  return { rotas, inventario: atual, varrer, harnesses, harnessesDaPessoa, ultimoContato, ghDaMaquina, ghDaPessoa, ligacaoDaPessoa, semLacoDeVozDaPessoa, iniciarDrenagem, reservasEmVoo };
}
