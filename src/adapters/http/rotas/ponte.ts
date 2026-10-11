import { HARNESSES } from "../../../contracts/harness.ts";
import type { IdHarness } from "../../../contracts/harness.ts";
import { setTimeout as esperar } from "node:timers/promises";
import type { Inventario } from "../../../contracts/inventario.ts";
import type { PlanoTurno } from "../../../contracts/plano-turno.ts";
import type { LeituraMemoria } from "../../../contracts/trabalho.ts";
import { PLATAFORMAS_MAQUINA, type AnuncioMaquina, type PlataformaMaquina, type VigiaVivo } from "../../../contracts/ponte.ts";
import type { TarefaDoBot } from "../../../contracts/turno.ts";
import type { Escopo } from "../../../shared/types.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { log } from "../../../obs/log.ts";
import type { PonteInternaNod } from "../../fundo/ponte-interna.ts";
import { VERSAO_MINIMA_APP } from "../../fundo/ponte-interna.ts";
import type { Ctx, Rota } from "../roteador.ts";
import { cabecalhoCookieSessao } from "../sessao-cookie.ts";
import { capacidadesAnunciadas, entrega, exigir, falas, idsDeMensagens, inventario, memoria, objeto, sinais, texto, trechos, uuid } from "./ponte-validacao.ts";
import { versaoAceita } from "../../../domain/versao-app.ts";
import { relatoValido } from "../../../use-cases/limpeza-das-tasks.ts";

/**
 * `planos`: os turnos que esta máquina está rodando AGORA (definido em 2026-09-24). Com o pool de laços
 * o app roda um turno por agente em paralelo; antes era um `plano` só e a renovação do segundo turno
 * voltava {ativo:false}, matando a CLI. `recebidas` guarda a última entrega de cada turno (idempotência).
 */
type Conexao = { escopo: Escopo; ponte: PonteInternaNod; inv: Inventario; ultimo: number; puxando: boolean; planos: Map<string, PlanoTurno>; recebidas: Map<string, number>; gh: boolean; nome: string; plataforma: PlataformaMaquina; anuncio: AnuncioMaquina | null };

/**
 * NOD-199: o que um anúncio da máquina diz das IAs dela, lido com os mesmos filtros nas duas rotas que o recebem
 * (`conectar` e `inventario`): só ids integrados, `semLacoDeVoz` só de harness pronto neste anúncio, capacidades validadas.
 */
type LeituraAnuncio = { inv: Inventario; gh: boolean; motores: Partial<Record<IdHarness, Inventario>>; harnessesAusente: boolean; semLacoDeVoz: IdHarness[]; capacidades: ReturnType<typeof capacidadesAnunciadas> };
function lerAnuncio(b: Record<string, unknown>, agora: number): LeituraAnuncio {
  const inv = inventario(b.inventario, agora);
  // ADR-048: o gh desta máquina (app ≥ 2026-09-24). Ausente = app antigo = sem gh.
  const gh = objeto(b.github ?? {}).gh === true;
  const motores: Partial<Record<IdHarness, Inventario>> = {};
  if (b.harnesses !== undefined) {
    const anunciados = objeto(b.harnesses);
    for (const h of HARNESSES) if (anunciados[h.id] !== undefined && h.integrado) motores[h.id] = inventario(anunciados[h.id], agora, h.nome);
  }
  // NOD-167: só ids integrados e prontos neste anúncio; qualquer outra coisa é ignorada (app antigo não manda o campo).
  const semLacoDeVoz = Array.isArray(b.semLacoDeVoz) ? HARNESSES.filter((h) => h.integrado && (b.semLacoDeVoz as unknown[]).includes(h.id) && motores[h.id]?.estado === "pronto").map((h) => h.id) : [];
  // Revisão do épico (S15, 2026-10-08): o que os drivers desta máquina declaram (a rede de 2 min só promove com bifurcaSessao).
  const capacidades = capacidadesAnunciadas(b.capacidades);
  return { inv, gh, motores, harnessesAusente: b.harnesses === undefined, semLacoDeVoz, capacidades };
}

/** ADR-090: uma máquina conectada da pessoa, como a tela "Máquinas" a mostra (sem credencial nem inventário bruto). */
export type MaquinaConectada = { machineId: string; nome: string; plataforma: PlataformaMaquina; ias: Partial<Record<IdHarness, Inventario["estado"]>>; gh: boolean };

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
  /**
   * ADR-092: com o servidor no Mac (modo local), a sessão do CLI que a máquina remota devolve não é guardada. A conversa
   * e o trabalho continuam com a sessão do Mac, que o próximo turno no Mac retoma; a sessão da VM não existe no Mac.
   */
  descartarSessao?: boolean;
  /** ADR-090 (0067): grava na chave o sistema que a máquina anunciou — o aviso de queda nomeia a VM depois que a conexão some. */
  registrarPlataforma?(escopo: Escopo, chaveId: string, plataforma: PlataformaMaquina): Promise<void>;
}) {
  const conexoes = new Map<string, Conexao>();
  const reservas = new Map<string, { machineId: string; ate: number }>();
  /** Revisão do #209: um aviso por máquina para a leitura com defeito no puxar (ela chega a cada pedido). */
  const leiturasInvalidas = new Set<string>();
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
  /** Melhor esforço: o anúncio não pode falhar porque a repetição das falas barradas falhou. */
  async function repetirBarrados(c: Conexao) {
    if (c.inv.estado !== "pronto" || !d.repetirBarrados) return;
    const prontos = Object.entries(harnessesDaPessoa(c.escopo.pessoaId)).filter(([, i]) => i?.estado === "pronto").map(([h]) => h as IdHarness);
    await d.repetirBarrados(c.escopo, prontos).catch(() => log("aviso", "repetir_barrados_falhou", {}));
  }
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
      // ADR-090: o nome e o sistema da máquina (o motor sem janela manda "linux"). Ausente ou desconhecido = app do Mac.
      const nome = b.nome.trim();
      const plataforma = PLATAFORMAS_MAQUINA.find((x) => x === b.plataforma) ?? "darwin";
      let c = conexoes.get(id);
      if (!c) {
        c = { escopo: ctx.escopo, ponte: d.criar(ctx.escopo), inv: ausente(), ultimo: d.agora(), puxando: false, planos: new Map(), recebidas: new Map(), gh: false, nome, plataforma, anuncio: null };
        conexoes.set(id, c);
      }
      if (c.planos.size > 0) {
        if (d.agora() - c.ultimo < 90_000) throw new ErroDeDominio("estado_invalido");
        c.planos.clear();
      }
      const a = lerAnuncio(b, d.agora());
      c.inv = a.inv; c.ultimo = d.agora(); c.gh = a.gh;
      c.nome = nome;
      c.plataforma = plataforma;
      c.anuncio = { machineId: id, nome: b.nome, plataforma: c.plataforma, inventario: c.inv, versaoContrato: 1, harnesses: a.harnessesAusente ? { "claude-cli": c.inv } : a.motores, ligacao: b.ligacao === true, ...(a.semLacoDeVoz.length > 0 ? { semLacoDeVoz: a.semLacoDeVoz } : {}), ...(a.capacidades ? { capacidades: a.capacidades } : {}) };
      await c.ponte.conectar(c.anuncio);
      await persistir(c);
      await d.registrarPlataforma?.(ctx.escopo, id, plataforma);
      await repetirBarrados(c);
      ctx.json(200, { machineId: id, escopo: ctx.escopo });
    }),
    /**
     * NOD-199 (emenda à ADR-021): anúncio SÓ de inventário, para a máquina já conectada — a IA que ficou pronta (ou caiu)
     * chega ao servidor com turno rodando. Troca inventário, harnesses, gh e capacidades da conexão e nunca toca em
     * `planos`, `puxando` nem `recebidas`: o turno em curso termina e entrega como antes. Sem conexão desta chave (ou de
     * outra pessoa), `conexao` lança `estado_invalido` → 409, que o app lê como `reconectar`. O nome, a plataforma e o
     * laço de voz vêm do `conectar` (não mudam sem reabrir o app).
     */
    rota("inventario", async (ctx, b) => {
      const c = conexao(ctx);
      exigir(b.versaoContrato === 1);
      const a = lerAnuncio(b, d.agora());
      c.inv = a.inv; c.ultimo = d.agora(); c.gh = a.gh;
      // A conexão só nasce no `conectar`, que grava o anúncio: daqui saem o nome e o laço de voz, que não mudam aqui.
      // ADR-090: a plataforma também é do `conectar` — o motor na VM Linux não vira "darwin" ao reanunciar.
      const { nome, ligacao } = c.anuncio ?? { nome: c.nome, ligacao: false };
      c.anuncio = { machineId: ctx.params.chaveId!, nome, plataforma: c.plataforma, inventario: c.inv, versaoContrato: 1, harnesses: a.harnessesAusente ? { "claude-cli": c.inv } : a.motores, ligacao, ...(a.semLacoDeVoz.length > 0 ? { semLacoDeVoz: a.semLacoDeVoz } : {}), ...(a.capacidades ? { capacidades: a.capacidades } : {}) };
      // O `conectar` da ponte interna só registra o anúncio da máquina (idempotente): seguro com turno rodando.
      await c.ponte.conectar(c.anuncio);
      await persistir(c);
      await repetirBarrados(c);
      ctx.json(200, { ok: true });
    }),
    rota("puxar", async (ctx, b) => {
      const c = conexao(ctx);
      // ADR-085: a leitura do Mac (memória e processador) vem no corpo; app antigo manda `{}`. Revisão do #209: leitura
      // com defeito vai como "sem leitura" (nada é segurado), nunca um 400 — o puxar é o que entrega trabalho ao Mac.
      let mem: LeituraMemoria | undefined;
      try {
        mem = memoria(b.memoria);
      } catch {
        if (!leiturasInvalidas.has(ctx.params.chaveId!)) log("aviso", "puxar_leitura_invalida", { machine_id: ctx.params.chaveId });
        leiturasInvalidas.add(ctx.params.chaveId!);
      }
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
            // Revisão do #209: a leitura entra uma vez por pedido. Repetida a cada 250 ms durante a espera de até 20 s,
            // ela passava por cima da mais nova que a renovação trouxe e o nível ia e voltava na tela.
            try { plano = await c.ponte.puxar(ctx.escopo.pessoaId, mem); } finally { reservando--; mem = undefined; }
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
      // #189: o que o app escreveu na sessão (confirmado) e o que não conseguiu (fica na fila).
      const entregues = idsDeMensagens(b.mensagensEntregues), devolvidas = idsDeMensagens(b.mensagensDevolvidas);
      // ADR-083 (#194): a memória do Mac, amostrada uma vez por máquina e mandada em cada renovação.
      const mem = memoria(b.memoria);
      const r = await c.ponte.renovar({ turnoId, machineId: ctx.params.chaveId!, sinais: s, eventos: [], ...(fs.length ? { falas: fs } : {}), ...(b.aceitaMensagens === true ? { aceitaMensagens: true } : {}), ...(entregues ? { mensagensEntregues: entregues } : {}), ...(devolvidas?.length ? { mensagensDevolvidas: devolvidas } : {}), ...(mem ? { memoria: mem } : {}) });
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
      const c = conexao(ctx), lida = entrega(b, ctx.params.chaveId!);
      const e = d.descartarSessao && lida.resultado.sessaoCli !== null ? { ...lida, resultado: { ...lida.resultado, sessaoCli: null } } : lida;
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
    /**
     * ADR-088 (2026-10-09): o Mac PUXA as pastas de task encerradas que pode limpar (o servidor nunca disca, ADR-021) e
     * relata o resumo. A pessoa é a da chave; o relato só vira log (relatoValido descarta o que não é número conhecido).
     * ADR-095: `apertado: true` (só o booleano conta) = o disco da máquina está amarelo ou vermelho.
     */
    rota("limpeza", async (ctx, b) => {
      const c = conexao(ctx);
      c.ultimo = d.agora();
      ctx.json(200, { pastas: (await c.ponte.pastasParaLimpar?.(ctx.escopo.pessoaId, { apertado: b.apertado === true })) ?? [] });
    }),
    rota("limpeza/resultado", async (ctx, b) => {
      const c = conexao(ctx);
      c.ultimo = d.agora();
      await c.ponte.relatarLimpeza?.(ctx.escopo.pessoaId, relatoValido(b.relato));
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
  /** ADR-090: nome e plataforma da máquina viva do turno, para o prompt nomeá-la. null = não conectada (ou de outra pessoa). */
  function maquina(escopo: Escopo, machineId: string): { nome: string; plataforma: PlataformaMaquina } | null {
    const c = conexoes.get(machineId);
    if (!c || c.escopo.pessoaId !== escopo.pessoaId || c.escopo.tenantId !== escopo.tenantId) return null;
    return { nome: c.nome, plataforma: c.plataforma };
  }
  /** ADR-090: as máquinas vivas da pessoa (último contato há menos de 60 s), para a tela "Máquinas". */
  function maquinasDaPessoa(escopo: Escopo): MaquinaConectada[] {
    return [...conexoes.entries()].flatMap(([id, c]) => {
      if (c.escopo.pessoaId !== escopo.pessoaId || c.escopo.tenantId !== escopo.tenantId || d.agora() - c.ultimo >= 60_000) return [];
      const ias = Object.fromEntries(Object.entries(harnesses(c.escopo, id)).map(([h, inv]) => [h, inv?.estado])) as MaquinaConectada["ias"];
      return [{ machineId: id, nome: c.nome, plataforma: c.plataforma, ias, gh: c.gh }];
    });
  }
  /** NOD-175: a partir daqui o puxar volta `{plano:null}` na hora; renovar e entregar seguem aceitos. Não se desfaz. */
  function iniciarDrenagem(): void { drenando = true; }
  /** NOD-175: quantos `ponte.puxar` estão em voo (reserva que pode virar token vivo). */
  function reservasEmVoo(): number { return reservando; }
  return { rotas, inventario: atual, varrer, harnesses, harnessesDaPessoa, maquina, maquinasDaPessoa, ultimoContato, ghDaMaquina, ghDaPessoa, ligacaoDaPessoa, semLacoDeVozDaPessoa, iniciarDrenagem, reservasEmVoo };
}
