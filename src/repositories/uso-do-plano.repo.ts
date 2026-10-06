import type { IdHarness } from "../contracts/harness.ts";
import type { JanelaDoPlano, SituacaoDoPlano, UsoDoPlano } from "../contracts/uso-do-plano.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, jsonb, ms } from "./conversao.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Linha = { harness: IdHarness; situacao: SituacaoDoPlano; cinco_horas: JanelaDoPlano | null; semana: JanelaDoPlano | null; medido_em: Date };

/** O uso do plano (0056): uma linha por pessoa e CLI; a leitura mais nova vence, a mais antiga não sobrescreve. */
export function usoDoPlanoRepo(conn: Conn, escopo: Escopo) {
  return {
    async gravar(uso: UsoDoPlano, machineId: string | null): Promise<void> {
      const maquina = machineId && UUID.test(machineId) ? machineId : null;
      await conn`
        insert into uso_do_plano (tenant_id, owner_id, harness, situacao, cinco_horas, semana, machine_id, medido_em)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${uso.harness}, ${uso.situacao},
          ${uso.cincoHoras ? jsonb(conn, uso.cincoHoras) : null}, ${uso.semana ? jsonb(conn, uso.semana) : null}, ${maquina}, ${data(uso.medidoEm)})
        on conflict (tenant_id, owner_id, harness) do update set
          situacao = excluded.situacao, cinco_horas = excluded.cinco_horas, semana = excluded.semana,
          machine_id = excluded.machine_id, medido_em = excluded.medido_em, recebido_em = clock_timestamp()
        where uso_do_plano.medido_em < excluded.medido_em`;
    },

    async listar(): Promise<UsoDoPlano[]> {
      const linhas = await conn<Linha[]>`
        select harness, situacao, cinco_horas, semana, medido_em from uso_do_plano
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} order by harness`;
      return linhas.map((l) => ({ harness: l.harness, situacao: l.situacao, cincoHoras: l.cinco_horas, semana: l.semana, medidoEm: ms(l.medido_em) }));
    },
  };
}
