import { fileURLToPath } from "node:url";
import { paraCadaPessoa } from "../src/adapters/fundo/escopos-de-fundo.ts";
import { criarDb } from "../src/db/client.ts";
import { log } from "../src/obs/log.ts";
import type { Tx } from "../src/shared/types.ts";

/**
 * definido em 2026-10-15 (NOD-291, C14 da forense de produção): recalcula o custo dos turnos que rodaram numa CÓPIA da
 * sessão da conversa (`--resume <mãe> --fork-session`, a rede de 2 min da ADR-083 §2) e gravaram o total inteiro da
 * sessão — o histórico da mãe junto (US$ 670 em 4 turnos de 08/10).
 *
 * SÓ SIMULA por padrão: lista turno, custo atual, custo novo e a soma por dia (no fuso, pelo instante do gasto). Grava só
 * com `--aplicar`, e só depois do OK do Marlon nos números da simulação (NOD-291).
 *
 *   node scripts/recalcular-custo-bifurcado.ts                       # simula (fuso America/Sao_Paulo)
 *   node scripts/recalcular-custo-bifurcado.ts --fuso=UTC            # simula noutro fuso
 *   node scripts/recalcular-custo-bifurcado.ts --aplicar             # grava (depois do OK)
 *
 * Quem é cópia: o turno da conversa (sem trabalho) que é o PRIMEIRO da sessão dele (nenhum turno anterior com total na
 * mesma `sessao_cli`, então o assentar gravou custo = total) e cuja mãe é conhecida — `sessao_origem_cli` (turnos novos,
 * 0084) ou, nos antigos, a sessão de um trabalho da MESMA conversa (a rede promove o trabalho com a sessão da conversa e a
 * conversa segue na cópia) que já tinha total antes deste turno. O anterior é o da regra nova do assentar: o maior total
 * da mãe nos turnos dela criados antes da cópia. Só entra quando o total da cópia é >= o da mãe (a cópia carrega a mãe;
 * total menor não é cópia dela) e o custo muda.
 *
 * Precisa ser nod_app (DATABASE_URL), pessoa por pessoa: turnos e gastos têm FORCE ROW LEVEL SECURITY.
 */

export type Recalculo = { turnoId: string; sessaoMae: string; dia: string; totalSessao: number; anteriorDaMae: number; custoAtual: number; custoNovo: number };

/** Os turnos a recalcular da pessoa do escopo da transação (RLS). */
export async function planejarRecalculo(trx: Tx, fuso: string): Promise<Recalculo[]> {
  // QA do #346 (2026-10-16): a simulação roda na produção ANTES do deploy, onde a 0084 ainda não criou
  // `sessao_origem_cli` — sem a coluna, todo turno é antigo e a mãe vem só da sessão do trabalho.
  const [col] = await trx<{ tem: boolean }[]>`select exists (select 1 from information_schema.columns
    where table_schema = current_schema() and table_name = 'turnos' and column_name = 'sessao_origem_cli') as tem`;
  const origem = col?.tem ? trx`f.sessao_origem_cli` : trx`null::text`;
  const linhas = await trx<{ turno_id: string; sessao_mae: string; dia: string; total: string; anterior: string; atual: string }[]>`
    with copias as (
      select f.id, f.tenant_id, f.conversa_id, f.criado_em, f.custo_usd, f.custo_sessao_usd, f.sessao_cli,
        coalesce(${origem}, (
          select w.sessao_cli from trabalhos w
          where w.tenant_id = f.tenant_id and w.conversa_id = f.conversa_id and w.sessao_cli is not null and w.sessao_cli <> f.sessao_cli
            and exists (select 1 from turnos m where m.tenant_id = f.tenant_id and m.sessao_cli = w.sessao_cli and m.id <> f.id
              and m.custo_sessao_usd is not null and m.criado_em < f.criado_em and m.custo_sessao_usd <= f.custo_sessao_usd)
          order by (select max(m.criado_em) from turnos m where m.tenant_id = f.tenant_id and m.sessao_cli = w.sessao_cli and m.criado_em < f.criado_em) desc nulls last
          limit 1)) as sessao_mae
      from turnos f
      where f.trabalho_id is null and f.sessao_cli is not null and f.custo_sessao_usd is not null and f.custo_usd is not null
        and not exists (select 1 from turnos o where o.tenant_id = f.tenant_id and o.sessao_cli = f.sessao_cli and o.id <> f.id
          and o.custo_sessao_usd is not null and o.criado_em < f.criado_em)
    ),
    com_mae as (
      select c.*, (select max(m.custo_sessao_usd) from turnos m where m.tenant_id = c.tenant_id and m.sessao_cli = c.sessao_mae
        and m.id <> c.id and m.custo_sessao_usd is not null and m.criado_em < c.criado_em) as anterior
      from copias c where c.sessao_mae is not null and c.sessao_mae <> c.sessao_cli
    )
    select x.id as turno_id, x.sessao_mae,
      to_char(coalesce((select max(g.em) from gastos g where g.tenant_id = x.tenant_id and g.turno_id = x.id), x.criado_em) at time zone ${fuso}, 'YYYY-MM-DD') as dia,
      x.custo_sessao_usd::text as total, x.anterior::text as anterior, x.custo_usd::text as atual
    from com_mae x
    where x.anterior is not null and x.custo_sessao_usd >= x.anterior
    order by x.criado_em`;
  return linhas
    .map((l) => {
      const total = Number(l.total);
      const anterior = Number(l.anterior);
      // A mesma conta de domain/custo-turno.ts (custoDoTurno), com o anterior da mãe.
      const custoNovo = Math.round((total - anterior) * 1e7) / 1e7;
      return { turnoId: l.turno_id, sessaoMae: l.sessao_mae, dia: l.dia, totalSessao: total, anteriorDaMae: anterior, custoAtual: Number(l.atual), custoNovo };
    })
    .filter((r) => Math.abs(r.custoAtual - r.custoNovo) > 1e-7);
}

/** A soma por dia: quanto o dia mostrava, quanto passa a mostrar e a diferença. */
export function somaPorDia(rs: readonly Recalculo[]): { dia: string; turnos: number; antes: number; depois: number; diferenca: number }[] {
  const porDia = new Map<string, { dia: string; turnos: number; antes: number; depois: number; diferenca: number }>();
  for (const r of rs) {
    const d = porDia.get(r.dia) ?? { dia: r.dia, turnos: 0, antes: 0, depois: 0, diferenca: 0 };
    d.turnos += 1;
    d.antes += r.custoAtual;
    d.depois += r.custoNovo;
    d.diferenca = d.depois - d.antes;
    porDia.set(r.dia, d);
  }
  return [...porDia.values()].sort((a, b) => a.dia.localeCompare(b.dia));
}

/** O total de cada dia (soma de `gastos` pelo instante do gasto, no fuso — a régua da NOD-273), da pessoa do escopo. */
export async function totalPorDia(trx: Tx, fuso: string, dias: readonly string[]): Promise<Map<string, number>> {
  if (dias.length === 0) return new Map();
  const linhas = await trx<{ dia: string; total: string }[]>`
    select to_char(g.em at time zone ${fuso}, 'YYYY-MM-DD') as dia, coalesce(sum(g.custo_usd), 0)::text as total
    from gastos g where to_char(g.em at time zone ${fuso}, 'YYYY-MM-DD') = any(${dias as string[]}::text[]) group by 1`;
  return new Map(linhas.map((l) => [l.dia, Number(l.total)]));
}

/** Grava o custo novo no turno e na linha de gastos dele (a que tinha o custo antigo). Devolve quantos turnos mudaram. */
export async function aplicarRecalculo(trx: Tx, rs: readonly Recalculo[]): Promise<number> {
  let n = 0;
  for (const r of rs) {
    const t = await trx`update turnos set custo_usd = ${r.custoNovo} where id = ${r.turnoId} and custo_usd = ${r.custoAtual}`;
    if (t.count !== 1) continue;
    await trx`update gastos set custo_usd = ${r.custoNovo} where turno_id = ${r.turnoId} and custo_usd = ${r.custoAtual}`;
    n += 1;
  }
  return n;
}

const fmt = (v: number) => v.toFixed(2).padStart(10);

async function principal(): Promise<void> {
  try {
    process.loadEnvFile(".env");
  } catch {
    // sem .env: variáveis vêm do ambiente
  }
  const url = process.env.DATABASE_URL;
  if (!url) {
    log("erro", "recalculo_sem_url", { variavel: "DATABASE_URL" });
    process.exit(1);
  }
  const aplicar = process.argv.includes("--aplicar");
  const fuso = process.argv.find((a) => a.startsWith("--fuso="))?.slice("--fuso=".length) || "America/Sao_Paulo";
  const escrever = (s: string) => process.stdout.write(`${s}\n`);
  const db = criarDb(url, { max: 1 });
  const todos: Recalculo[] = [];
  const totalDoDia = new Map<string, number>();
  let aplicados = 0;
  try {
    await paraCadaPessoa(
      db,
      (_escopo, tx) => tx(async (trx) => {
        // Simulação: a transação vira só de leitura antes da primeira consulta de dado — nada grava nem por engano.
        if (!aplicar) await trx`set local transaction_read_only = on`;
        const rs = await planejarRecalculo(trx, fuso);
        todos.push(...rs);
        for (const [dia, v] of await totalPorDia(trx, fuso, [...new Set(rs.map((r) => r.dia))])) totalDoDia.set(dia, (totalDoDia.get(dia) ?? 0) + v);
        if (aplicar) aplicados += await aplicarRecalculo(trx, rs);
      }),
      { aoFalhar: (_escopo, erro) => { throw erro; } },
    );
  } finally {
    await db.end({ timeout: 2 });
  }
  const banco = new URL(url);
  escrever(`Banco: ${banco.host}${banco.pathname} · fuso ${fuso} · ${aplicar ? "APLICANDO" : "SIMULAÇÃO (nada gravado)"}`);
  escrever(`Turnos em cópia de sessão com custo a recalcular: ${todos.length}`);
  escrever("");
  escrever(`${"dia".padEnd(10)}  ${"turno".padEnd(36)}  ${"total sessão".padStart(12)}  ${"mãe".padStart(10)}  ${"atual".padStart(10)}  ${"novo".padStart(10)}`);
  for (const r of todos) escrever(`${r.dia}  ${r.turnoId}  ${fmt(r.totalSessao).padStart(12)}  ${fmt(r.anteriorDaMae)}  ${fmt(r.custoAtual)}  ${fmt(r.custoNovo)}`);
  escrever("");
  escrever(`${"dia".padEnd(10)}  ${"turnos".padStart(6)}  ${"antes".padStart(10)}  ${"depois".padStart(10)}  ${"diferença".padStart(10)}`);
  for (const d of somaPorDia(todos)) escrever(`${d.dia}  ${String(d.turnos).padStart(6)}  ${fmt(d.antes)}  ${fmt(d.depois)}  ${fmt(d.diferenca)}`);
  escrever("");
  escrever(`Total do dia (todos os gastos do dia, régua da NOD-273):`);
  escrever(`${"dia".padEnd(10)}  ${"antes".padStart(10)}  ${"depois".padStart(10)}  ${"diferença".padStart(10)}`);
  for (const d of somaPorDia(todos)) {
    const antes = totalDoDia.get(d.dia) ?? 0;
    escrever(`${d.dia}  ${fmt(antes)}  ${fmt(antes + d.diferenca)}  ${fmt(d.diferenca)}`);
  }
  if (aplicar) {
    escrever(`\nAplicados: ${aplicados} de ${todos.length}.`);
    log("info", "custo_bifurcado_recalculado", { turnos: aplicados, candidatos: todos.length });
  } else {
    escrever("\nNada foi gravado. Para gravar (só depois do OK do Marlon nos números): node scripts/recalcular-custo-bifurcado.ts --aplicar");
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await principal();
