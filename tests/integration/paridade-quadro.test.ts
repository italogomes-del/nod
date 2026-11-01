import { afterAll, beforeAll, expect, it } from "vitest";
import { rotasQuadro } from "../../src/adapters/http/rotas/quadro.ts";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import type { OpQuadro, QuadroDto } from "../../src/contracts/quadro.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { ACOES_QUADRO } from "../../src/domain/acoes/quadro.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { EXECUTORES_QUADRO } from "../../src/use-cases/acoes/quadro.ts";
import { garantirNod } from "../../src/use-cases/onboarding.ts";
import { gerirQuadro } from "../../src/use-cases/gerir-quadro.ts";
import { decidirColunasDoQuadro } from "../../src/use-cases/colunas-do-quadro.ts";
import { aplicarLoteQuadro, montarQuadro } from "../../src/use-cases/quadro.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { depsSobreTrx, executar, MARLON, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-442 (ADR-135): o teste de contrato das ações `quadro.*`. A mesma ação pela tela (rota HTTP, autor a pessoa) e pelo
 * chat (gerir_quadro de um bot) leva o mesmo estado inicial ao mesmo estado final, e QUALQUER bot faz igual: o Nod e um
 * bot comum chegam ao mesmo quadro. É o arquivo que o registro cita como `contrato` (src/domain/acoes/quadro.ts).
 */

type Retrato = { meta: string | null; prazo: string | null; cumprida: boolean; resumo: string | null; colunas: unknown[]; tarefas: unknown[]; turnosAbertos: number };
const retrato = (q: QuadroDto | null, turnos: number): Retrato | null =>
  q
    ? {
        meta: q.meta,
        prazo: q.prazo,
        cumprida: q.cumpridoEm !== null,
        resumo: q.resumo,
        colunas: q.colunas.map((c) => [c.id, c.nome, c.grupo]),
        tarefas: q.tarefas.map((t) => [t.titulo, t.descricao, t.status, t.agenteNome, t.linearId, t.prUrl, t.pergunta, t.resposta, t.execucao]),
        turnosAbertos: turnos,
      }
    : null;

describeIntegracao("paridade tela × chat do quadro.* (NOD-442, ADR-135)", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;

  beforeAll(async () => {
    const deps: DepsRotas = {
      abrirTx:
        (escopo: Escopo) =>
        async <T,>(fn: (t: Tx) => Promise<T>): Promise<T> => {
          const trx = trxAtual;
          if (!trx) throw new Error("teste sem transação aberta");
          const caixa: { valor?: T } = {};
          await trx.savepoint(async (sp) => {
            await vincularEscopo(sp, escopo);
            caixa.valor = await fn(sp);
          });
          return caixa.valor as T;
        },
      services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON),
      useCases: useCasesDeTeste(),
      executor: "catcher",
    };
    servidor = await servidorDeTeste(rotasQuadro(deps));
  });
  afterAll(() => servidor.close());

  /** O bot que chama o gerir_quadro: um turno de conversa dele (o executor dos turnos que o lote abrir sai daqui). */
  async function turnoDe(d: Deps, agenteId: string, conversaId: string) {
    const turno = await d.repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "pedido", entradaConfianca: "confiavel", modelo: "auto" });
    if (!turno) throw new Error("turno");
    return { turnoId: turno.id, agenteId, conversaId };
  }

  async function montar(trx: Tx) {
    const d = depsSobreTrx(trx, MARLON);
    await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
    const sufixo = Math.random().toString(36).slice(2, 7);
    const tela = await agenteComConversa(trx, MARLON, { nome: `Tela ${sufixo}` });
    const chat = await agenteComConversa(trx, MARLON, { nome: `Chat ${sufixo}` });
    // O bot que faz pelo chat (comum) e o que executa as tarefas dos dois quadros.
    const gil = await agenteComConversa(trx, MARLON, { nome: `Gil ${sufixo}` });
    const caio = await agenteComConversa(trx, MARLON, { nome: `Caio ${sufixo}` });
    return { d, tela, chat, gil, caio, nomeChat: `Chat ${sufixo}`, nomeCaio: `Caio ${sufixo}` };
  }

  type M = Awaited<ReturnType<typeof montar>>;
  const pessoa = (d: Deps, anfitriaoId: string, ops: OpQuadro[]) => executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId, executor: "catcher", ops });
  const estado = async (m: M, anfitriaoId: string) => {
    const q = await m.d.repos.quadros.doAgente(anfitriaoId);
    const tarefas = q ? await m.d.repos.quadros.tarefas(q.id) : [];
    return retrato(q ? await montarQuadro(m.d, q) : null, tarefas.filter((t) => t.turnoId).length);
  };

  type Cenario = {
    id: (typeof ACOES_QUADRO)[number]["id"];
    /** O mesmo preparo nos dois quadros (pela pessoa). */
    preparar?: (m: M) => OpQuadro[][];
    tela: (m: M, q: { anfitriao: string; tarefa: (titulo: string) => Promise<string>; ultimoLote: () => Promise<string> }) => Promise<{ metodo: string; caminho: string; corpo?: unknown; status: number }>;
    chat: (m: M) => OpQuadro;
    /** A ação apaga o quadro: os dois lados terminam sem quadro. */
    semQuadroNoFim?: boolean;
    /** Quem chama o gerir_quadro é o próprio anfitrião (o remover é só do próprio quadro). */
    peloAnfitriao?: boolean;
    /** O chat abre um card: a pessoa confirma antes da comparação. */
    confirmar?: true;
  };
  const DOCES = [
    { nome: "Pedido", grupo: "nao_iniciado" as const }, { nome: "Compras", grupo: "iniciado" as const }, { nome: "Produção", grupo: "iniciado" as const },
    { nome: "Finalização", grupo: "iniciado" as const }, { nome: "Embalagem", grupo: "iniciado" as const }, { nome: "Entrega", grupo: "iniciado" as const },
    { nome: "Pago", grupo: "feito" as const },
  ];
  const BASE: (m: M) => OpQuadro[][] = (m) => [[{ tipo: "criar_quadro", meta: "Lançar login", prazo: "2026-11-06" }, { tipo: "criar_tarefa", titulo: "T1" }, { tipo: "criar_tarefa", titulo: "T2", status: "backlog", agente: m.nomeCaio }]];
  const comPergunta: (m: M) => OpQuadro[][] = (m) => [...BASE(m), [{ tipo: "mudar_tarefa", tarefa: "T2", status: "voce", pergunta: "Qual cor?" }]];
  const CENARIOS: Cenario[] = [
    { id: "quadro.criar", tela: async (_m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro`, corpo: { meta: "Lançar login", prazo: "2026-11-06" }, status: 201 }), chat: () => ({ tipo: "criar_quadro", meta: "Lançar login", prazo: "2026-11-06" }) },
    { id: "quadro.editar", preparar: BASE, tela: async (_m, q) => ({ metodo: "PATCH", caminho: `/agentes/${q.anfitriao}/quadro`, corpo: { meta: "Lançar o login novo", prazo: null }, status: 200 }), chat: () => ({ tipo: "editar_quadro", meta: "Lançar o login novo", prazo: null }) },
    { id: "quadro.criar_tarefa", preparar: BASE, tela: async (m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro/tarefas`, corpo: { titulo: "T3", descricao: "d", agente: m.nomeCaio }, status: 201 }), chat: (m) => ({ tipo: "criar_tarefa", titulo: "T3", descricao: "d", agente: m.nomeCaio }) },
    {
      id: "quadro.importar_linear",
      preparar: BASE,
      tela: async (_m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro/linear`, corpo: { itens: [{ identificador: "NOD-9", titulo: "Do Linear", url: "https://linear.app/gamefik/issue/NOD-9" }] }, status: 200 }),
      chat: () => ({ tipo: "importar_linear", itens: [{ identificador: "NOD-9", titulo: "Do Linear", url: "https://linear.app/gamefik/issue/NOD-9" }] }),
    },
    {
      id: "quadro.mudar_tarefa",
      preparar: BASE,
      tela: async (m, q) => ({ metodo: "PATCH", caminho: `/agentes/${q.anfitriao}/quadro/tarefas/${await q.tarefa("T1")}`, corpo: { status: "afazer", agente: m.nomeCaio }, status: 200 }),
      chat: (m) => ({ tipo: "mudar_tarefa", tarefa: "T1", status: "afazer", agente: m.nomeCaio }),
    },
    {
      id: "quadro.responder",
      preparar: comPergunta,
      tela: async (_m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro/tarefas/${await q.tarefa("T2")}/resposta`, corpo: { resposta: "Azul" }, status: 200 }),
      chat: () => ({ tipo: "responder", tarefa: "T2", resposta: "Azul" }),
    },
    {
      id: "quadro.desfazer",
      preparar: (m) => [...BASE(m), [{ tipo: "mudar_tarefa", tarefa: "T1", status: "feito" }, { tipo: "criar_tarefa", titulo: "T4" }]],
      tela: async (_m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro/lotes/${await q.ultimoLote()}/desfazer`, status: 200 }),
      chat: () => ({ tipo: "desfazer" }),
    },
    {
      // NOD-415 (ADR-141): voltar a agente comum. O preparo deixa um turno de tarefa rodando: a remoção o para.
      id: "quadro.remover",
      preparar: (m) => [...BASE(m), [{ tipo: "mudar_tarefa", tarefa: "T1", status: "afazer", agente: m.nomeCaio }]],
      tela: async (_m, q) => ({ metodo: "DELETE", caminho: `/agentes/${q.anfitriao}/quadro`, status: 200 }),
      chat: (m) => ({ tipo: "remover_quadro", bot: m.nomeChat }),
      semQuadroNoFim: true,
      peloAnfitriao: true,
    },
    // NOD-448 (ADR-140): as colunas.
    {
      id: "quadro.criar_coluna",
      preparar: BASE,
      tela: async (_m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro/colunas`, corpo: { nome: "Testes", grupo: "iniciado", depois_de: "fazendo" }, status: 201 }),
      chat: () => ({ tipo: "criar_coluna", nome: "Testes", grupo: "iniciado", depois_de: "fazendo" }),
    },
    {
      id: "quadro.renomear_coluna",
      preparar: BASE,
      tela: async (_m, q) => ({ metodo: "PATCH", caminho: `/agentes/${q.anfitriao}/quadro/colunas/voce`, corpo: { nome: "Comigo" }, status: 200 }),
      chat: () => ({ tipo: "renomear_coluna", coluna: "Precisa de você", nome: "Comigo" }),
    },
    {
      id: "quadro.mover_coluna",
      preparar: BASE,
      tela: async (_m, q) => ({ metodo: "POST", caminho: `/agentes/${q.anfitriao}/quadro/colunas/bloqueado/mover`, corpo: { antes_de: "fazendo" }, status: 200 }),
      chat: () => ({ tipo: "mover_coluna", coluna: "Bloqueado", antes_de: "Fazendo" }),
    },
    {
      // Com tarefa: pede destino, e a tarefa vai junto, sem acionar ninguém (decisão do Gil).
      id: "quadro.remover_coluna",
      preparar: BASE,
      tela: async (_m, q) => ({ metodo: "DELETE", caminho: `/agentes/${q.anfitriao}/quadro/colunas/backlog?destino=afazer`, status: 200 }),
      chat: () => ({ tipo: "remover_coluna", coluna: "Backlog", destino: "A fazer" }),
    },
    {
      // Pela tela aplica direto; pelo chat vira card e só aplica ao confirmar (o teste confirma antes de comparar).
      id: "quadro.substituir_colunas",
      preparar: BASE,
      tela: async (_m, q) => ({ metodo: "PUT", caminho: `/agentes/${q.anfitriao}/quadro/colunas`, corpo: { colunas: DOCES }, status: 200 }),
      chat: () => ({ tipo: "substituir_colunas", colunas: DOCES }),
      confirmar: true,
    },
  ];

  it("cobre exatamente as ações do quadro, e o executor de cada uma existe", () => {
    expect(CENARIOS.map((c) => c.id).sort()).toEqual(ACOES_QUADRO.map((a) => a.id).sort());
    expect(Object.keys(EXECUTORES_QUADRO).sort()).toEqual(ACOES_QUADRO.map((a) => a.id).sort());
  });

  it.each(CENARIOS)("$id: a rota e o gerir_quadro levam o mesmo estado inicial ao mesmo estado final", async (c) => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      for (const ops of c.preparar?.(m) ?? []) for (const anfitriao of [m.tela.agenteId, m.chat.agenteId]) expect((await pessoa(m.d, anfitriao, ops)).data).toMatchObject({ ok: true });
      expect(await estado(m, m.tela.agenteId)).toEqual(await estado(m, m.chat.agenteId));

      const sessao = await servidor.entrar("marlon");
      const auxiliares = {
        anfitriao: m.tela.agenteId,
        tarefa: async (titulo: string) => {
          const q = await m.d.repos.quadros.doAgente(m.tela.agenteId);
          return (await m.d.repos.quadros.tarefas(q!.id)).find((t) => t.titulo === titulo)!.id;
        },
        ultimoLote: async () => (await m.d.repos.quadros.ultimoLote((await m.d.repos.quadros.doAgente(m.tela.agenteId))!.id))!.id,
      };
      const t = await c.tela(m, auxiliares);
      const resp = await servidor.chamar(sessao, t.metodo, t.caminho, t.corpo);
      expect(resp.status, await resp.clone().text()).toBe(t.status);

      const quem = c.peloAnfitriao ? m.chat : m.gil;
      const ctx = await turnoDe(m.d, quem.agenteId, quem.conversaId);
      const r = await executar(m.d, gerirQuadro, { ...ctx, quadro: m.nomeChat, acoes: [c.chat(m)] });
      expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
      if (c.confirmar) {
        if (!r.data.ok || !r.data.proposta_id) throw new Error("sem card");
        // Antes de confirmar, nada mudou no quadro do chat.
        expect((await estado(m, m.chat.agenteId))?.colunas).not.toEqual((await estado(m, m.tela.agenteId))?.colunas);
        expect((await executar(m.d, decidirColunasDoQuadro, { decisaoId: r.data.proposta_id, recusar: false, executor: "catcher" })).data).toMatchObject({ aplicado: true });
      }

      const doLadoDaTela = await estado(m, m.tela.agenteId);
      if (c.semQuadroNoFim) expect(doLadoDaTela).toBeNull();
      else expect(doLadoDaTela).not.toBeNull();
      expect(await estado(m, m.chat.agenteId)).toEqual(doLadoDaTela);
    });
  });

  it("qualquer bot: o Nod e um bot comum fazem a mesma jornada e chegam ao mesmo quadro", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const { nod } = (await executar(m.d, garantirNod, {})).data;
      const ops: OpQuadro[][] = [
        [{ tipo: "criar_quadro", meta: "Meta", prazo: "2026-11-06" }, { tipo: "importar_linear", itens: [{ identificador: "NOD-1", titulo: "A" }, { identificador: "NOD-2", titulo: "B" }] }],
        [{ tipo: "mudar_tarefa", tarefa: "NOD-1", agente: m.nomeCaio, status: "afazer" }],
        [{ tipo: "mudar_tarefa", tarefa: "NOD-2", status: "voce", pergunta: "Pode?" }],
        [{ tipo: "responder", tarefa: "NOD-2", resposta: "Pode" }],
        [{ tipo: "mudar_tarefa", tarefa: "NOD-1", pr_url: "https://github.com/gamefik/nod/pull/1" }],
        [{ tipo: "mudar_tarefa", tarefa: "NOD-1", status: "feito" }, { tipo: "mudar_tarefa", tarefa: "NOD-2", status: "feito" }],
      ];
      const pelo = async (autor: { agenteId: string; conversaId: string }, anfitriao: string) => {
        const ctx = await turnoDe(m.d, autor.agenteId, autor.conversaId);
        for (const acoes of ops) {
          const r = await executar(m.d, gerirQuadro, { ...ctx, quadro: anfitriao, acoes });
          expect(r.data, JSON.stringify(r.data)).toMatchObject({ ok: true });
        }
      };
      await pelo({ agenteId: nod.id, conversaId: nod.conversaId }, m.tela.agenteId);
      await pelo({ agenteId: m.gil.agenteId, conversaId: m.gil.conversaId }, m.chat.agenteId);
      const final = await estado(m, m.tela.agenteId);
      expect(final).toMatchObject({ cumprida: true, resumo: expect.stringContaining("2 de 2 tarefas feitas") });
      expect(await estado(m, m.chat.agenteId)).toEqual(final);
    });
  });

  it("a coluna pela URL com % no nome: o roteador já decodificou, a rota não decodifica de novo (revisão do PR #615)", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      expect((await pessoa(m.d, m.tela.agenteId, [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_coluna", nome: "100%", grupo: "iniciado" }])).data).toMatchObject({ ok: true });
      const sessao = await servidor.entrar("marlon");
      const resp = await servidor.chamar(sessao, "PATCH", `/agentes/${m.tela.agenteId}/quadro/colunas/${encodeURIComponent("100%")}`, { nome: "Cem" });
      expect(resp.status, await resp.clone().text()).toBe(200);
      expect((await estado(m, m.tela.agenteId))?.colunas.map((c) => (c as string[])[1])).toContain("Cem");
    });
  });

  it("rotas: GET devolve null e depois o quadro; corpo inválido é 400; experimento desligado é 403", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const sessao = await servidor.entrar("marlon");
      const base = `/agentes/${m.tela.agenteId}/quadro`;
      expect(await (await servidor.chamar(sessao, "GET", base)).json()).toEqual({ quadro: null });
      // A meta é opcional (NOD-415): vazia cria no fluxo contínuo; tipo errado ou longa demais é 400.
      expect((await servidor.chamar(sessao, "POST", base, { meta: 3 })).status).toBe(400);
      expect((await servidor.chamar(sessao, "POST", base, { meta: "x".repeat(201) })).status).toBe(400);
      expect((await servidor.chamar(sessao, "POST", `${base}/tarefas`, { titulo: "x".repeat(201) })).status).toBe(400);
      expect((await servidor.chamar(sessao, "POST", base, { meta: "M" })).status).toBe(201);
      expect((await servidor.chamar(sessao, "PATCH", `${base}/tarefas/00000000-0000-4000-8000-000000000000`, { status: "feito" })).status).toBe(404);
      const corpo = (await (await servidor.chamar(sessao, "GET", base)).json()) as { quadro: QuadroDto };
      expect(corpo.quadro.meta).toBe("M");
      // Tirar a meta pela tela (PATCH meta null) volta ao fluxo contínuo.
      expect((await servidor.chamar(sessao, "PATCH", base, { meta: null })).status).toBe(200);
      expect(((await (await servidor.chamar(sessao, "GET", base)).json()) as { quadro: QuadroDto }).quadro.meta).toBeNull();
      await m.d.repos.preferencias.gravar({ experimentos: { quadro: false } });
      expect((await servidor.chamar(sessao, "GET", base)).status).toBe(403);
      expect((await servidor.chamar(sessao, "PATCH", base, { meta: "N" })).status).toBe(403);
    });
  });

  it("o corpo não escolhe o quadro nem o executor: anfitriaoId e executor do corpo são ignorados (revisão do PR #612)", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const sessao = await servidor.entrar("marlon");
      for (const a of [m.tela.agenteId, m.chat.agenteId]) expect((await pessoa(m.d, a, [{ tipo: "criar_quadro", meta: a === m.tela.agenteId ? "Tela" : "Chat" }])).data).toMatchObject({ ok: true });
      const r = await servidor.chamar(sessao, "POST", `/agentes/${m.tela.agenteId}/quadro/tarefas`, { titulo: "T", agente: m.nomeCaio, anfitriaoId: m.chat.agenteId, executor: "claude-cli" });
      expect(r.status, await r.clone().text()).toBe(201);
      const tarefasDe = async (a: string) => (await m.d.repos.quadros.tarefas((await m.d.repos.quadros.doAgente(a))!.id)).map((t) => t.titulo);
      expect(await tarefasDe(m.tela.agenteId)).toEqual(["T"]);
      expect(await tarefasDe(m.chat.agenteId)).toEqual([]);
      const [t] = await m.d.repos.quadros.tarefas((await m.d.repos.quadros.doAgente(m.tela.agenteId))!.id);
      expect((await m.d.repos.turnos.buscar(t!.turnoId!))?.executor).toBe("catcher");
    });
  });

  it("responder pelo chat só num turno em que a pessoa falou; num turno de tarefa (delegação) o bot é recusado", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      for (const ops of [[{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "T2", status: "voce", agente: m.nomeCaio }, { tipo: "mudar_tarefa", tarefa: "T2", pergunta: "Qual cor?" }]] as OpQuadro[][]) {
        expect((await pessoa(m.d, m.tela.agenteId, ops)).data).toMatchObject({ ok: true });
      }
      const delegacao = await m.d.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.caio.conversaId, agenteId: m.caio.agenteId, origem: "delegacao", prazoEm: Date.now() + 600_000, profundidade: 1, entradaTexto: "tarefa", entradaConfianca: "nao_confiavel", modelo: "auto" });
      const r = await executar(m.d, gerirQuadro, { turnoId: delegacao!.id, agenteId: m.caio.agenteId, conversaId: m.caio.conversaId, quadro: m.tela.agenteId, acoes: [{ tipo: "responder", tarefa: "T2", resposta: "Azul" }] });
      expect(r.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect(JSON.stringify(r.data)).toContain("resposta da pessoa");
      // Uma delegação limpa (confiável, nada de fora) também não responde: quem responde é a pessoa, na conversa (QA, mutante M12).
      const limpa = await m.d.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.caio.conversaId, agenteId: m.caio.agenteId, origem: "delegacao", prazoEm: Date.now() + 600_000, profundidade: 1, entradaTexto: "tarefa", entradaConfianca: "confiavel", sobProcuracaoDe: MARLON.pessoaId, modelo: "auto" });
      const r2 = await executar(m.d, gerirQuadro, { turnoId: limpa!.id, agenteId: m.caio.agenteId, conversaId: m.caio.conversaId, quadro: m.tela.agenteId, acoes: [{ tipo: "responder", tarefa: "T2", resposta: "Azul" }] });
      expect(r2.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect(JSON.stringify(r2.data)).toContain("resposta da pessoa");
      const [t] = await m.d.repos.quadros.tarefas((await m.d.repos.quadros.doAgente(m.tela.agenteId))!.id);
      expect(t).toMatchObject({ status: "voce", resposta: null });
    });
  });
  it("corrente que atravessou dono: o gerir_quadro recusa na profundidade > 0, sob a procuração de outra pessoa (ADR-063, revisão do PR #612)", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const acoes: OpQuadro[] = [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "T", agente: m.nomeCaio }];
      const deOutra = await m.d.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.gil.conversaId, agenteId: m.gil.agenteId, origem: "delegacao", prazoEm: Date.now() + 600_000, profundidade: 1, entradaTexto: "x", entradaConfianca: "confiavel", sobProcuracaoDe: PESSOA_ANA, modelo: "auto" });
      const r = await executar(m.d, gerirQuadro, { turnoId: deOutra!.id, agenteId: m.gil.agenteId, conversaId: m.gil.conversaId, quadro: m.tela.agenteId, acoes });
      expect(r.data).toMatchObject({ ok: false, erro: "entrada_invalida" });
      expect(JSON.stringify(r.data)).toContain("entre donos diferentes");
      expect(await m.d.repos.quadros.doAgente(m.tela.agenteId)).toBeNull();
      // Do mesmo dono, um salto adiante, vale.
      const doDono = await m.d.repos.turnos.enfileirar({ executor: "catcher", conversaId: m.gil.conversaId, agenteId: m.gil.agenteId, origem: "delegacao", prazoEm: Date.now() + 600_000, profundidade: 1, entradaTexto: "x", entradaConfianca: "confiavel", sobProcuracaoDe: MARLON.pessoaId, modelo: "auto" });
      const ok = await executar(m.d, gerirQuadro, { turnoId: doDono!.id, agenteId: m.gil.agenteId, conversaId: m.gil.conversaId, quadro: m.tela.agenteId, acoes });
      expect(ok.data).toMatchObject({ ok: true });
    });
  });

  it("a confiança do turno da tarefa vem de quem fez o lote; o Linear é interno; turno contaminado contamina, e o aviso Com você não sai (ADR-062, revisão do PR #612)", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      const tela = await pessoa(m.d, m.tela.agenteId, [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "Da pessoa", agente: m.nomeCaio }, { tipo: "importar_linear", itens: [{ identificador: "NOD-77", titulo: "Do Linear", agente: m.nomeCaio }] }]);
      if (!tela.data.ok) throw new Error(tela.data.detalhe);
      const turnoDa = async (titulo: string) => (await m.d.repos.quadros.tarefas((await m.d.repos.quadros.doAgente(m.tela.agenteId))!.id)).find((t) => t.titulo === titulo)!.turnoId!;
      const daPessoa = await turnoDa("Da pessoa");
      const doLinear = await turnoDa("Do Linear");
      expect((await m.d.repos.turnos.buscar(daPessoa))?.entradaConfianca).toBe("confiavel");
      expect(await m.d.repos.turnos.contaminado(daPessoa)).toBe(false);
      expect(await m.d.repos.turnos.contaminado(doLinear)).toBe(false);
      // Um bot num turno contaminado: o turno que ele começa nasce contaminado também.
      const ctx = await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId);
      await m.d.repos.turnos.contaminar(ctx.turnoId, Date.now());
      const r = await executar(m.d, gerirQuadro, { ...ctx, quadro: m.tela.agenteId, acoes: [{ tipo: "criar_tarefa", titulo: "Do bot", agente: m.nomeCaio }] });
      if (!r.data.ok) throw new Error(JSON.stringify(r.data));
      expect(await m.d.repos.turnos.contaminado(await turnoDa("Do bot"))).toBe(true);
      // A tarefa que o bot contaminado escreveu em Backlog continua de fora quando a pessoa a começa depois (codex, rodada 3).
      const sujo = await executar(m.d, gerirQuadro, { ...ctx, quadro: m.tela.agenteId, acoes: [{ tipo: "criar_tarefa", titulo: "Guardada", status: "backlog" }] });
      expect(sujo.data).toMatchObject({ ok: true });
      expect((await pessoa(m.d, m.tela.agenteId, [{ tipo: "mudar_tarefa", tarefa: "Guardada", agente: m.nomeCaio, status: "afazer" }])).data).toMatchObject({ ok: true });
      expect(await m.d.repos.turnos.contaminado(await turnoDa("Guardada"))).toBe(true);
      // Quem lê o quadro com tarefa de fora num turno limpo fica contaminado: o título dela entrou no resultado (revisão rodada 5).
      const leitor = await turnoDe(m.d, m.caio.agenteId, m.caio.conversaId);
      expect((await executar(m.d, gerirQuadro, { ...leitor, quadro: m.tela.agenteId, acoes: [{ tipo: "editar_quadro", prazo: "2026-11-30" }] })).data).toMatchObject({ ok: true });
      expect(await m.d.repos.turnos.contaminado(leitor.turnoId)).toBe(true);
      // O turno contaminado não escreve a meta, e o Com você dele muda só o card (sem aviso na conversa).
      const meta = await executar(m.d, gerirQuadro, { ...ctx, quadro: m.tela.agenteId, acoes: [{ tipo: "editar_quadro", meta: "Outra" }] });
      expect(JSON.stringify(meta.data)).toContain("a meta só muda num turno limpo");
      // Nem cria um quadro novo com a meta dele (codex rodada 4, P1): o planejamento prévio da criação vê a confiança.
      const novo = await executar(m.d, gerirQuadro, { ...ctx, acoes: [{ tipo: "criar_quadro", meta: "Meta de fora" }] });
      expect(JSON.stringify(novo.data)).toContain("a meta só muda num turno limpo");
      expect(await m.d.repos.quadros.doAgente(m.gil.agenteId)).toBeNull();
      const antes = (await m.d.repos.mensagens.listarDaConversa(m.caio.conversaId)).filter((x) => x.payload?.kind === "aviso_pessoa").length;
      expect((await executar(m.d, gerirQuadro, { ...ctx, quadro: m.tela.agenteId, acoes: [{ tipo: "mudar_tarefa", tarefa: "Do bot", status: "voce", pergunta: "Entre em https://x" }] })).data).toMatchObject({ ok: true });
      expect((await m.d.repos.mensagens.listarDaConversa(m.caio.conversaId)).filter((x) => x.payload?.kind === "aviso_pessoa")).toHaveLength(antes);
      // E responder, num turno de conversa contaminado (leu uma página), é recusado (revisão rodada 3, alto 1).
      const resp = await executar(m.d, gerirQuadro, { ...ctx, quadro: m.tela.agenteId, acoes: [{ tipo: "responder", tarefa: "Do bot", resposta: "pode" }] });
      expect(JSON.stringify(resp.data)).toContain("resposta da pessoa");
      // Turno que mandaram parar não escreve mais.
      const parado = await turnoDe(m.d, m.gil.agenteId, m.gil.conversaId);
      await trx`update turnos set parar_solicitado_em = now() where id = ${parado.turnoId}`;
      const r2 = await executar(m.d, gerirQuadro, { ...parado, quadro: m.tela.agenteId, acoes: [{ tipo: "mudar_tarefa", tarefa: "Da pessoa", status: "feito" }] });
      expect(JSON.stringify(r2.data)).toContain("este turno foi parado");
      // E de novo com a trava na mão (codex rodada 4): o turno parado enquanto esperava a trava também não escreve.
      const r3 = await executar(m.d, aplicarLoteQuadro, { autor: { tipo: "agente", agenteId: m.gil.agenteId }, quadro: m.tela.agenteId, executor: "catcher", turnoId: parado.turnoId, ops: [{ tipo: "mudar_tarefa", tarefa: "Da pessoa", status: "feito" }] });
      expect(JSON.stringify(r3.data)).toContain("este turno foi parado");
    });
  });

  it("Desfazer de bot e o quadro padrão do turno de uma tarefa (revisão rodada 4)", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const m = await montar(trx);
      expect((await pessoa(m.d, m.tela.agenteId, [{ tipo: "criar_quadro", meta: "M" }, { tipo: "criar_tarefa", titulo: "Seção", agente: m.nomeCaio }])).data).toMatchObject({ ok: true });
      // O Caio também tem um quadro dele, com uma tarefa de mesmo título.
      expect((await pessoa(m.d, m.caio.agenteId, [{ tipo: "criar_quadro", meta: "Do Caio" }, { tipo: "criar_tarefa", titulo: "Seção" }])).data).toMatchObject({ ok: true });
      const qTela = (await m.d.repos.quadros.doAgente(m.tela.agenteId))!;
      const daTarefa = (await m.d.repos.quadros.tarefas(qTela.id)).find((t) => t.titulo === "Seção")!;
      // No turno da tarefa, sem dizer o quadro, o Caio mexe no quadro da tarefa (não no dele).
      const ctxTarefa = { turnoId: daTarefa.turnoId!, agenteId: m.caio.agenteId, conversaId: m.caio.conversaId };
      expect((await executar(m.d, gerirQuadro, { ...ctxTarefa, acoes: [{ tipo: "mudar_tarefa", tarefa: "Seção", pr_url: "https://github.com/gamefik/nod/pull/9" }] })).data).toMatchObject({ ok: true });
      expect((await m.d.repos.quadros.tarefas(qTela.id)).find((t) => t.id === daTarefa.id)?.status).toBe("revisao");
      // O último lote agora é do Caio; a pessoa faz outro por cima: o Caio, no turno da tarefa, não desfaz o da pessoa.
      expect((await pessoa(m.d, m.tela.agenteId, [{ tipo: "criar_tarefa", titulo: "Da pessoa" }])).data).toMatchObject({ ok: true });
      const alheio = await executar(m.d, gerirQuadro, { ...ctxTarefa, acoes: [{ tipo: "desfazer" }] });
      expect(JSON.stringify(alheio.data)).toContain("o último lote não é seu");
      // A pedido da pessoa, na conversa limpa, desfaz; num turno contaminado, nunca.
      const conversa = await turnoDe(m.d, m.caio.agenteId, m.caio.conversaId);
      await m.d.repos.turnos.contaminar(conversa.turnoId, Date.now());
      expect(JSON.stringify((await executar(m.d, gerirQuadro, { ...conversa, quadro: m.tela.agenteId, acoes: [{ tipo: "desfazer" }] })).data)).toContain("desfazer só num turno limpo");
      const limpa = await turnoDe(m.d, m.caio.agenteId, m.caio.conversaId);
      expect((await executar(m.d, gerirQuadro, { ...limpa, quadro: m.tela.agenteId, acoes: [{ tipo: "desfazer" }] })).data).toMatchObject({ ok: true });
      expect((await m.d.repos.quadros.tarefas(qTela.id)).some((t) => t.titulo === "Da pessoa")).toBe(false);
      // Responsável oculto: a tarefa que entra em A fazer não fica em Fazendo sem ninguém (revisão rodada 5).
      expect((await pessoa(m.d, m.tela.agenteId, [{ tipo: "criar_tarefa", titulo: "Do oculto", status: "backlog", agente: m.nomeCaio }])).data).toMatchObject({ ok: true });
      await trx`update agentes set oculto = true where id = ${m.caio.agenteId}`;
      expect((await pessoa(m.d, m.tela.agenteId, [{ tipo: "mudar_tarefa", tarefa: "Do oculto", status: "afazer" }])).data).toMatchObject({ ok: true });
      expect((await m.d.repos.quadros.tarefas(qTela.id)).find((t) => t.titulo === "Do oculto")).toMatchObject({ status: "afazer", turnoId: null });
    });
  });
});
