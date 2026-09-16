import type { Executor } from "../contracts/evento.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms } from "./conversao.ts";

export interface Gasto {
  id: string;
  turnoId: string;
  executor: Executor;
  tokensEntrada: number;
  tokensSaida: number;
  custoUsd: number | null;
  modelo: string;
  em: number;
}

interface Linha {
  id: string;
  turno_id: string;
  executor: Executor;
  tokens_entrada: number;
  tokens_saida: number;
  custo_usd: string | null;
  modelo: string;
  em: Date;
}

const paraGasto = (l: Linha): Gasto => ({
  id: l.id,
  turnoId: l.turno_id,
  executor: l.executor,
  tokensEntrada: l.tokens_entrada,
  tokensSaida: l.tokens_saida,
  custoUsd: l.custo_usd === null ? null : Number(l.custo_usd),
  modelo: l.modelo,
  em: ms(l.em),
});

export type NovoGasto = { turnoId: string; executor: Executor; tokensEntrada: number; tokensSaida: number; custoUsd: number | null; modelo: string; em: number };

/** Gasto por turno (ADR-015): gravado desde já, mesmo no turno local que não cobra ninguém. */
export function gastosRepo(conn: Conn, escopo: Escopo) {
  return {
    async registrar(g: NovoGasto): Promise<Gasto | null> {
      const [l] = await conn<Linha[]>`
        insert into gastos (tenant_id, owner_id, turno_id, executor, tokens_entrada, tokens_saida, custo_usd, modelo, em)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${g.turnoId}, ${g.executor}, ${g.tokensEntrada}, ${g.tokensSaida}, ${g.custoUsd}, ${g.modelo}, ${data(g.em)})
        returning id, turno_id, executor, tokens_entrada, tokens_saida, custo_usd, modelo, em`;
      return l ? paraGasto(l) : null;
    },

    async doTurno(turnoId: string): Promise<Gasto[]> {
      const linhas = await conn<Linha[]>`
        select id, turno_id, executor, tokens_entrada, tokens_saida, custo_usd, modelo, em from gastos where tenant_id = ${escopo.tenantId} and turno_id = ${turnoId} order by em`;
      return linhas.map(paraGasto);
    },

    /** Métrica custo_servidor_mes (ADR-017): soma do mês civil (UTC) do instante dado, para a pessoa. */
    async somarMes(agora: number): Promise<number> {
      const inicio = new Date(agora);
      inicio.setUTCDate(1);
      inicio.setUTCHours(0, 0, 0, 0);
      const [l] = await conn<{ total: string | null }[]>`
        select sum(custo_usd)::text as total from gastos where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and em >= ${inicio}`;
      return l?.total === null || l?.total === undefined ? 0 : Number(l.total);
    },
  };
}
