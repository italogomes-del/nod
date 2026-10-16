import type { Executor } from "../contracts/evento.ts";
import type { JanelaRotina } from "../contracts/rotina.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  rotina_id: string;
  instante_agendado: Date;
  executor: Executor;
  machine_id: string;
  turno_id: string | null;
}

/** Resolvido na 0003/L3.5: JanelaRotina.turnoId já é `string | null` no contrato. Alias mantido para quem importou o nome antigo. */
export type JanelaReivindicada = JanelaRotina;

const paraJanela = (l: Linha): JanelaRotina => ({
  tenantId: l.tenant_id,
  rotinaId: l.rotina_id,
  instanteAgendado: ms(l.instante_agendado),
  executor: l.executor,
  machineId: l.machine_id,
  turnoId: l.turno_id,
});

/**
 * Trava de execução (ADR-011): UNIQUE (tenant_id, rotina_id, instante_agendado). INSERT ... ON
 * CONFLICT DO NOTHING — a segunda máquina recebe false, sem erro, e cala. Registra QUAL executor
 * ganhou. Provado em tests/concurrency/rotina-janela-unique.test.ts com duas conexões.
 */
export function rotinaJanelasRepo(conn: Conn, escopo: Escopo) {
  const repo = {
    async reivindicar(p: { rotinaId: string; instanteAgendado: number; machineId: string; executor: Executor }): Promise<boolean> {
      const linhas = await conn`
        insert into rotina_janelas (tenant_id, owner_id, rotina_id, instante_agendado, executor, machine_id)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${p.rotinaId}, ${data(p.instanteAgendado)}, ${p.executor}, ${p.machineId})
        on conflict (tenant_id, rotina_id, instante_agendado) do nothing returning id`;
      return linhas.length === 1;
    },

    /** O turno nasce na mesma tx logo depois da reivindicação; aqui ele é ligado à janela. */
    async vincularTurno(p: { rotinaId: string; instanteAgendado: number; turnoId: string }): Promise<boolean> {
      const r = await conn`
        update rotina_janelas set turno_id = ${p.turnoId}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and rotina_id = ${p.rotinaId} and instante_agendado = ${data(p.instanteAgendado)}`;
      return r.count === 1;
    },

    /**
     * Trava a linha da janela (FOR UPDATE) até o fim da tx. definido em 2026-09-24 (ADR-045): quem
     * registra desfecho da janela (varredor, entrega, retomada) passa aqui, e a segunda transação lê a
     * execução que a primeira gravou — uma linha por janela, nunca duas.
     */
    async travar(rotinaId: string, instanteAgendado: number): Promise<boolean> {
      const linhas = await conn`
        select 1 from rotina_janelas
        where tenant_id = ${escopo.tenantId} and rotina_id = ${rotinaId} and instante_agendado = ${data(instanteAgendado)}
        for update`;
      return linhas.length === 1;
    },

    /**
     * O turno de uma janela desta rotina que ainda está pendente ou rodando, ou cujo trabalho ainda tem turno vivo
     * (ADR-045: uma execução aberta por rotina). null = pode abrir outra.
     */
    async turnoAberto(rotinaId: string): Promise<string | null> {
      return (await repo.execucaoAberta(rotinaId))?.turnoId ?? null;
    },

    /**
     * definido em 2026-10-15 (pacote A3): a mesma execução aberta de `turnoAberto`, com o instante da janela dela — a lista
     * de rotinas conta os horários pulados desde ali (src/domain/janelas-puladas.ts).
     */
    async execucaoAberta(rotinaId: string): Promise<{ turnoId: string; instanteAgendado: number } | null> {
      const [l] = await conn<{ turno_id: string; instante_agendado: Date }[]>`
        select j.turno_id, j.instante_agendado from rotina_janelas j
        join turnos t on t.tenant_id = j.tenant_id and t.id = j.turno_id
        where j.tenant_id = ${escopo.tenantId} and j.rotina_id = ${rotinaId}
          and (t.estado in ('pendente', 'despachando')
            -- ADR-086 (revisão do #212): a execução que marcou uma volta ("me chame às 16:00") ainda está aberta, mesmo
            -- com o turno da janela já concluído — senão a próxima janela empilhava outra execução por cima.
            or (t.trabalho_id is not null and exists (select 1 from turnos v where v.tenant_id = t.tenant_id and v.trabalho_id = t.trabalho_id and v.estado in ('pendente', 'despachando')))
            -- revisto em 2026-10-12 (ADR-099, I7 revista): a execução sem trabalho (o pedido na fila do dono) continua aberta
            -- enquanto uma retomada dela (a volta marcada, o retorno do lote, a resposta da pessoa) espera ou roda.
            or (t.trabalho_id is null and exists (
              with recursive c(id, n) as (
                select t.id, 0
                union all
                select r.id, c.n + 1 from c join turnos r on r.tenant_id = t.tenant_id and r.retoma_turno_id = c.id and r.origem = 'retomada' where c.n < 10
              ) select 1 from c join turnos v on v.tenant_id = t.tenant_id and v.id = c.id where v.estado in ('pendente', 'despachando'))))
        order by j.instante_agendado desc limit 1`;
      return l ? { turnoId: l.turno_id, instanteAgendado: ms(l.instante_agendado) } : null;
    },

    /**
     * definido em 2026-10-15 (NOD-255, I3): a retomada da execução que começou em `raizId` (a volta marcada, a resposta da
     * pessoa, o retorno do lote) que ainda espera ou roda — a mesma cadeia que turnoAberto segue (retoma_turno_id, origem
     * 'retomada', até 10 saltos). `exceto` é o turno que está registrando o desfecho agora: ele não segura a si mesmo.
     */
    async retomadaPendenteDe(raizId: string, exceto: string): Promise<string | null> {
      const [l] = await conn<{ id: string }[]>`
        with recursive c(id, n) as (
          select ${raizId}::uuid, 0
          union all
          select r.id, c.n + 1 from c join turnos r on r.tenant_id = ${escopo.tenantId} and r.retoma_turno_id = c.id and r.origem = 'retomada' where c.n < 10
        ) select v.id from c join turnos v on v.tenant_id = ${escopo.tenantId} and v.id = c.id
        where c.n > 0 and v.id <> ${exceto}::uuid and v.estado in ('pendente', 'despachando')
        limit 1`;
      return l?.id ?? null;
    },

    /** A janela que ligou este turno à rotina (índice rotina_janelas_turno_idx, 0004) — pendência L7 §5. */
    async buscarPorTurno(turnoId: string): Promise<JanelaRotina | null> {
      const [l] = await conn<Linha[]>`
        select tenant_id, rotina_id, instante_agendado, executor, machine_id, turno_id from rotina_janelas
        where tenant_id = ${escopo.tenantId} and turno_id = ${turnoId}`;
      return l ? paraJanela(l) : null;
    },

    async listar(rotinaId: string): Promise<JanelaRotina[]> {
      const linhas = await conn<Linha[]>`
        select tenant_id, rotina_id, instante_agendado, executor, machine_id, turno_id from rotina_janelas
        where tenant_id = ${escopo.tenantId} and rotina_id = ${rotinaId} order by instante_agendado`;
      return linhas.map(paraJanela);
    },
  };
  return repo;
}
