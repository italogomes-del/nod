import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Tx } from "../../src/shared/types.ts";
import { aplicarLoteQuadro } from "../../src/use-cases/quadro.ts";
import { autoriaPessoa } from "../../src/use-cases/autoria-evento.ts";
import { registrarTrilhaQuadro } from "../../src/use-cases/trilha-quadro.ts";
import { depsSobreTrx, executar, MARLON, servicosDeTeste } from "../helpers/deps-l6.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-422 (PR 2): o `scripts/dogfood-quadro.sql` roda escopado numa pessoa, como o app (FORCE RLS), e devolve linhas
 * com dados reais: as métricas que só existem nele (tempo em coluna, conversa aberta sem mensagem em 60 s) não podem
 * sair zeradas. Aqui as consultas rodam dentro da transação escopada do teste, com as variáveis do psql trocadas.
 */

const SCRIPT = readFileSync(new URL("../../scripts/dogfood-quadro.sql", import.meta.url), "utf8");

/** As consultas do script, na ordem, com o título do `\echo` anterior; sem meta-comandos, BEGIN/ROLLBACK e escopo. */
function consultas(vars: Record<string, string>): { titulo: string; sql: string }[] {
  const out: { titulo: string; sql: string }[] = [];
  let titulo = "";
  let atual: string[] = [];
  for (const linha of SCRIPT.split("\n")) {
    const l = linha.trim();
    if (l.startsWith("\\echo '== ")) { titulo = l.slice("\\echo '== ".length, -1); continue; }
    if (l.startsWith("\\") || l.startsWith("--") || l === "") continue;
    atual.push(linha);
    if (l.endsWith(";") || l.endsWith("\\gset")) {
      const sql = atual.join("\n").replace(/\\gset$/, "").replace(/:'(\w+)'/g, (_, k: string) => `'${vars[k] ?? ""}'`).replace(/:(\w+)\b/g, (m, k: string) => (vars[k] ?? m));
      atual = [];
      if (/^(BEGIN|ROLLBACK);$/.test(sql.trim()) || sql.includes("set_config(")) continue;
      out.push({ titulo, sql });
    }
  }
  return out;
}

async function rodar(trx: Tx, anfitriao: string) {
  const r = new Map<string, Record<string, unknown>[]>();
  for (const c of consultas({ anfitriao, dias: "7", tenant: MARLON.tenantId, pessoa: MARLON.pessoaId })) {
    const linhas = (await trx.unsafe(c.sql)) as unknown as Record<string, unknown>[];
    if (/^\s*(select|with)\b/i.test(c.sql)) r.set(c.titulo, [...linhas]);
  }
  return r;
}

/** A linha 'linear' no mesmo lote da criação da tarefa (como a importação grava). `para` null = "fechada no Linear". */
async function linhaDoLinear(trx: Tx, quadroId: string, tarefaId: string, para: string | null, em: string, mesmoLote: boolean | string = true) {
  const [c] = await trx<{ lote_id: string | null }[]>`select lote_id from quadro_tarefa_historico where tarefa_id = ${tarefaId} and campo = 'criada'`;
  await trx.unsafe(`insert into quadro_tarefa_historico (tenant_id, owner_id, tarefa_id, quadro_id, campo, de, para, autor, lote_id, criado_em)
    values ($1, $2, $3, $4, 'linear', null, $5, 'regra', $6, ${em})`, [MARLON.tenantId, MARLON.pessoaId, tarefaId, quadroId, para, typeof mesmoLote === "string" ? mesmoLote : mesmoLote ? (c?.lote_id ?? null) : null]);
}

/** Uma cópia da conversa_aberta que acabou de ser gravada, 2 minutos atrás (a janela de 60 s dela já fechou). */
async function aberturaHa2Minutos(trx: Tx, conversaId: string, minutos = 2) {
  await trx`insert into events (tenant_id, owner_id, kind, autor_tipo, autor_id, sob_procuracao_de, conta_de_execucao, executor, locality, locality_reason,
              machine_id, decidido_por, regra_versao, pessoa_destino_id, conversa_id, turno_id, dados, created_at)
            select tenant_id, owner_id, kind, autor_tipo, autor_id, sob_procuracao_de, conta_de_execucao, executor, locality, locality_reason,
              machine_id, decidido_por, regra_versao, pessoa_destino_id, conversa_id, turno_id, dados, now() - make_interval(mins => ${minutos})
              from events where kind = 'conversa_aberta' and dados->>'conversa_id' = ${conversaId} order by created_at desc limit 1`;
}

describeIntegracao("as consultas do dogfood do quadro (NOD-422, PR 2)", () => {
  it("com uma linha de cada evento, nenhuma métrica sai zerada; a tarefa importada conta o tempo desde o Linear", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON, { services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON) });
      await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
      const sufixo = Math.random().toString(36).slice(2, 7);
      const host = await agenteComConversa(trx, MARLON, { nome: `Host ${sufixo}` });
      const lote = (ops: Parameters<typeof aplicarLoteQuadro>[1]["ops"]) => executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: host.agenteId, executor: "catcher", ops });
      expect((await lote([{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Importada", status: "backlog" }, { tipo: "criar_tarefa", titulo: "Andou", status: "backlog" }])).data).toMatchObject({ ok: true });
      expect((await lote([{ tipo: "mudar_tarefa", tarefa: "Andou", status: "feito" }])).data).toMatchObject({ ok: true });
      const [q] = await trx<{ id: string }[]>`select id from quadros where agente_id = ${host.agenteId}`;
      const [imp] = await trx<{ id: string }[]>`select id from quadro_tarefas where quadro_id = ${q!.id} and titulo = 'Importada'`;
      // A linha do Linear: "No Linear em Backlog desde" há 3 dias (a importação grava a data de lá, no lote que criou a tarefa).
      await linhaDoLinear(trx, q!.id, imp!.id, "Backlog", "now() - interval '3 days'");
      await executar(d, registrarTrilhaQuadro, { eventos: [
        { acao: "tarefa_aberta", quadroId: q!.id, tarefaId: imp!.id, via: "card" },
        { acao: "conversa_aberta", agenteId: host.agenteId, conversaId: host.conversaId },
      ] });
      await aberturaHa2Minutos(trx, host.conversaId);

      const r = await rodar(trx, `Host ${sufixo}`);
      const t = (k: string) => { const v = [...r.entries()].find(([titulo]) => titulo.startsWith(k)); expect(v, k).toBeDefined(); return v![1]; };
      expect(t("O quadro")).toHaveLength(1);
      expect(t("Tarefas movidas por autor").map((l) => [l.autor, Number(l.movidas)])).toEqual([["pessoa", 1]]);
      expect(t("Fluxo entre colunas").map((l) => [l.de, l.para])).toEqual([["backlog", "feito"]]);
      expect(t("Tarefas abertas").map((l) => [l.via, Number(l.aberturas)])).toEqual([["card", 1]]);
      const colunas = new Map(t("Tempo em coluna").map((l) => [String(l.coluna), l]));
      expect(Number(colunas.get("backlog")?.passagens)).toBe(2);
      expect(Number(colunas.get("backlog")?.max_h)).toBeGreaterThanOrEqual(71); // a importada: desde o Linear, não desde agora
      expect(Number(colunas.get("feito")?.abertas)).toBe(1);
      expect(t("Conversas de membros").map((l) => [l.bot, Number(l.aberturas), Number(l.sem_mensagem_60s)])).toEqual([[`Host ${sufixo}`, 1, 1]]);
      expect(Number(t("A semana em números")[0]?.criadas)).toBe(2);
    });
  });

  it("revisão do PR #630: a linha mais nova do Linear (fechada, outro estado) não apaga o tempo desde o Linear; a abertura de agora não conta antes de 60 s", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON, { services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON) });
      await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
      const sufixo = Math.random().toString(36).slice(2, 7);
      const host = await agenteComConversa(trx, MARLON, { nome: `Host ${sufixo}` });
      expect((await executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: host.agenteId, executor: "catcher", ops: [{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Importada", status: "backlog" }] })).data).toMatchObject({ ok: true });
      const [q] = await trx<{ id: string }[]>`select id from quadros where agente_id = ${host.agenteId}`;
      const [imp] = await trx<{ id: string }[]>`select id from quadro_tarefas where quadro_id = ${q!.id} and titulo = 'Importada'`;
      await linhaDoLinear(trx, q!.id, imp!.id, "Backlog", "now() - interval '3 days'");
      // A reimportação depois: "fechada no Linear" (a hora da importação), num lote real que não é o da criação (revisão 2:
      // com lote_id nulo o próprio `lote_id IS NOT NULL` a descartava, e tirar o casamento por lote do JOIN passava).
      expect((await executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: host.agenteId, executor: "catcher", ops: [{ tipo: "criar_tarefa", titulo: "Reimportação", status: "backlog" }] })).data).toMatchObject({ ok: true });
      const [outro] = await trx<{ lote_id: string }[]>`select h.lote_id from quadro_tarefa_historico h join quadro_tarefas t on t.id = h.tarefa_id where t.quadro_id = ${q!.id} and t.titulo = 'Reimportação' and h.campo = 'criada'`;
      expect(outro?.lote_id).toBeTruthy();
      await linhaDoLinear(trx, q!.id, imp!.id, null, "now()", outro!.lote_id);
      await linhaDoLinear(trx, q!.id, imp!.id, "Todo", "now() - interval '1 hour'", outro!.lote_id);
      // Uma abertura agora (a janela de 60 s ainda aberta) e uma de 2 minutos atrás, sem mensagem.
      await executar(d, registrarTrilhaQuadro, { eventos: [{ acao: "conversa_aberta", agenteId: host.agenteId, conversaId: host.conversaId }] });
      await aberturaHa2Minutos(trx, host.conversaId);

      // QA 2 (mutantes A1 e A3): uma abertura de 10 min atrás com fala da pessoa 30 s depois (com mensagem) e uma de 5 min
      // atrás com fala só 2 min depois (fora dos 60 s: sem mensagem). Inverter o filtro da janela fechada ou alargar os 60 s falha.
      for (const [min, depoisS] of [[10, 30], [5, 120]] as const) {
        await aberturaHa2Minutos(trx, host.conversaId, min);
        const fala = await d.repos.mensagens.criar({ conversaId: host.conversaId, autoria: autoriaPessoa(MARLON), kind: "texto", texto: "oi", confianca: "confiavel" });
        await trx`update mensagens set criado_em = now() - make_interval(secs => ${min * 60 - depoisS}) where id = ${fala!.id}`;
      }

      const r = await rodar(trx, `Host ${sufixo}`);
      const t = (k: string) => [...r.entries()].find(([titulo]) => titulo.startsWith(k))?.[1] ?? [];
      const backlog = t("Tempo em coluna").find((l) => l.coluna === "backlog");
      expect(Number(backlog?.max_h)).toBeGreaterThanOrEqual(71);
      // Uma passagem por tarefa (a Importada e a Reimportação): a linha do Linear de outro lote não duplica a entrada.
      expect(Number(backlog?.passagens)).toBe(2);
      expect(t("Conversas de membros").map((l) => [l.bot, Number(l.aberturas), Number(l.sem_mensagem_60s)])).toEqual([[`Host ${sufixo}`, 3, 2]]);
    });
  });

  it("revisão 4 do PR #630: a tarefa excluída sai do tempo em coluna (não fica aberta na última coluna)", async () => {
    await withRollback(MARLON, async (trx) => {
      const d = depsSobreTrx(trx, MARLON, { services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON) });
      await d.repos.preferencias.gravar({ experimentos: { quadro: true } });
      const sufixo = Math.random().toString(36).slice(2, 7);
      const host = await agenteComConversa(trx, MARLON, { nome: `Host ${sufixo}` });
      const lote = (ops: Parameters<typeof aplicarLoteQuadro>[1]["ops"]) => executar(d, aplicarLoteQuadro, { autor: { tipo: "pessoa" }, anfitriaoId: host.agenteId, executor: "catcher", ops });
      expect((await lote([{ tipo: "criar_quadro" }, { tipo: "criar_tarefa", titulo: "Fica", status: "backlog" }, { tipo: "criar_tarefa", titulo: "Sai", status: "backlog" }])).data).toMatchObject({ ok: true });
      expect((await lote([{ tipo: "mudar_tarefa", tarefa: "Sai", status: "afazer" }])).data).toMatchObject({ ok: true });
      expect((await lote([{ tipo: "mudar_tarefa", tarefa: "Sai", excluir: true }])).data).toMatchObject({ ok: true });
      const [q] = await trx<{ id: string }[]>`select id from quadros where agente_id = ${host.agenteId}`;
      expect((await trx`select titulo from quadro_tarefas where quadro_id = ${q!.id}`).map((x) => x.titulo)).toEqual(["Fica"]);
      // O histórico da excluída continua lá (o Desfazer a restaura).
      expect((await trx`select 1 from quadro_tarefa_historico where quadro_id = ${q!.id} and campo = 'status'`).length).toBeGreaterThan(0);

      const r = await rodar(trx, `Host ${sufixo}`);
      const tempo = [...r.entries()].find(([titulo]) => titulo.startsWith("Tempo em coluna"))?.[1] ?? [];
      expect(tempo.map((l) => [l.coluna, Number(l.passagens), Number(l.abertas)])).toEqual([["backlog", 1, 1]]);
    });
  });
});
