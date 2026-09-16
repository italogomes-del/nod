import type { TurnoPendenteDto } from "../contracts/api.ts";
import type { Confianca } from "../contracts/mensagem.ts";
import type { MotivoFalha, MotivoInterrupcao, MotivoLocalidade } from "../contracts/motivos.ts";
import type { EstadoTurno, OrigemTurno, Profundidade, SinaisTurno, Turno } from "../contracts/turno.ts";
import { LEASE_MS } from "../shared/constantes.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms, msOuNull } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  owner_id: string;
  conversa_id: string;
  agente_id: string;
  origem: OrigemTurno;
  estado: EstadoTurno;
  attempted: boolean;
  rejected: boolean;
  prompt_submitted: boolean;
  produced_output: boolean;
  machine_id: string | null;
  lease_ate: Date | null;
  prazo_em: Date;
  motivo_interrupcao: MotivoInterrupcao | null;
  motivo_falha: MotivoFalha | null;
  retoma_turno_id: string | null;
  profundidade: number;
  reenvios: number;
  parar_solicitado_em: Date | null;
  entrada_texto: string;
  entrada_confianca: Confianca;
  custo_usd: string | null;
  modelo: string;
  criado_em: Date;
}

const COLUNAS =
  "tenant_id, id, owner_id, conversa_id, agente_id, origem, estado, attempted, rejected, prompt_submitted, produced_output, machine_id, lease_ate, prazo_em, motivo_interrupcao, motivo_falha, retoma_turno_id, profundidade, reenvios, parar_solicitado_em, entrada_texto, entrada_confianca, custo_usd, modelo, criado_em";

function paraTurno(l: Linha): Turno {
  return {
    tenantId: l.tenant_id,
    id: l.id,
    conversaId: l.conversa_id,
    agenteId: l.agente_id,
    ownerId: l.owner_id,
    origem: l.origem,
    estado: l.estado,
    sinais: { attempted: l.attempted, rejected: l.rejected, promptSubmitted: l.prompt_submitted, producedOutput: l.produced_output },
    machineId: l.machine_id,
    leaseAte: msOuNull(l.lease_ate),
    prazoEm: ms(l.prazo_em),
    motivoInterrupcao: l.motivo_interrupcao,
    motivoFalha: l.motivo_falha,
    retomaTurnoId: l.retoma_turno_id,
    profundidade: l.profundidade === 1 ? 1 : 0,
    reenvios: l.reenvios,
    pararSolicitadoEm: msOuNull(l.parar_solicitado_em),
    entradaTexto: l.entrada_texto,
    entradaConfianca: l.entrada_confianca,
    custoUsd: l.custo_usd === null ? null : Number(l.custo_usd),
    modelo: l.modelo,
    criadoEm: ms(l.criado_em),
  };
}

export type NovoTurno = {
  id?: string;
  conversaId: string;
  agenteId: string;
  origem: OrigemTurno;
  prazoEm: number;
  profundidade: Profundidade;
  entradaTexto: string;
  entradaConfianca: Confianca;
  modelo: string;
  retomaTurnoId?: string | null;
  reenvios?: number;
  executor?: "local" | "catcher";
  localityReason?: MotivoLocalidade;
  decididoPor?: string;
  /** Turno que já nasce interrompido (executor indisponível, E9.3): nunca entra na fila. */
  interrompidoCom?: MotivoInterrupcao;
};

export type Assentamento = {
  estado: "concluido" | "interrompido";
  motivoInterrupcao?: MotivoInterrupcao | null;
  motivoFalha?: MotivoFalha | null;
  sinais?: Partial<SinaisTurno>;
  custoUsd?: number | null;
  tokensEntrada?: number;
  tokensSaida?: number;
};

/**
 * Fila de turnos no Postgres (ADR-010 revisado). O ÚNICO lugar que escreve estado 'pendente' é o
 * INSERT de `enfileirar` (DEFAULT da coluna): tests/conformidade/sem-requeue.test.ts varre src/
 * por UPDATE que volte a 'pendente'. Retomar é turno NOVO com retoma_turno_id (ADR-009).
 */
export function turnosRepo(conn: Conn, escopo: Escopo) {
  return {
    async enfileirar(t: NovoTurno): Promise<Turno | null> {
      const estado: EstadoTurno = t.interrompidoCom ? "interrompido" : "pendente";
      const [l] = await conn<Linha[]>`
        insert into turnos (tenant_id, id, owner_id, conversa_id, agente_id, origem, estado, motivo_interrupcao, prazo_em, profundidade,
          entrada_texto, entrada_confianca, modelo, retoma_turno_id, reenvios, executor, locality_reason, decidido_por)
        values (${escopo.tenantId}, ${t.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${t.conversaId}, ${t.agenteId}, ${t.origem}, ${estado},
          ${t.interrompidoCom ?? null}, ${data(t.prazoEm)}, ${t.profundidade}, ${t.entradaTexto}, ${t.entradaConfianca}, ${t.modelo},
          ${t.retomaTurnoId ?? null}, ${t.reenvios ?? 0}, ${t.executor ?? "catcher"}, ${t.localityReason ?? "tudo_local_nesta_rodada"},
          ${t.decididoPor ?? "regra:localidade"})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTurno(l) : null;
    },

    async buscar(id: string): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from turnos where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraTurno(l) : null;
    },

    /**
     * Reivindicação por UPDATE condicional + FOR UPDATE SKIP LOCKED numa tx curta (ADR-010).
     * EMENDA 12: turno de conversa/sala/retomada passa na frente de rotina enfileirada.
     * EMENDA 13 (agente serial): NOT EXISTS 'despachando' na MESMA CONVERSA e NOT EXISTS
     * 'despachando' do MESMO AGENTE.
     *
     * medido em 2026-09-16 (tests/concurrency/serializacao-por-conversa.test.ts, duas conexões
     * reivindicando ao mesmo tempo): só NOT EXISTS + SKIP LOCKED SOBREPÔS — a segunda conexão pulou
     * a linha travada e levou o OUTRO turno da mesma conversa, porque o 'despachando' da primeira
     * ainda não estava commitado (READ COMMITTED). Entrou o fallback anotado no plano: um
     * pg_advisory_xact_lock por (tenant, pessoa) serializa as reivindicações da MESMA pessoa (fila
     * por pessoa, ADR-007); a segunda espera o commit da primeira e então enxerga o 'despachando'.
     * Pessoas diferentes não se bloqueiam. Chamado sobre um pool, abre a própria tx curta.
     */
    async reivindicar(p: { machineId: string; agora: number }): Promise<Turno | null> {
      const dentro = async (trx: Conn): Promise<Turno | null> => {
        await trx`select pg_advisory_xact_lock(hashtext(${`${escopo.tenantId}:${escopo.pessoaId}`}))`;
        const [l] = await trx<Linha[]>`
          update turnos set estado = 'despachando', machine_id = ${p.machineId}, lease_ate = ${data(p.agora + LEASE_MS)}, attempted = true
          where (tenant_id, id) = (
            select t.tenant_id, t.id from turnos t
            where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.estado = 'pendente'
              and not exists (select 1 from turnos d where d.tenant_id = t.tenant_id and d.conversa_id = t.conversa_id and d.estado = 'despachando')
              and not exists (select 1 from turnos d where d.tenant_id = t.tenant_id and d.agente_id = t.agente_id and d.estado = 'despachando')
            order by (t.origem = 'rotina') asc, t.criado_em asc, t.id asc
            for update skip locked limit 1)
          returning ${trx.unsafe(COLUNAS)}`;
        return l ? paraTurno(l) : null;
      };
      // Pool (tem `begin`): a trava só vale dentro de uma transação — abre uma curta. Tx: usa a corrente.
      if ("begin" in conn && typeof conn.begin === "function") {
        const caixa: { valor: Turno | null } = { valor: null };
        await conn.begin(async (trx) => {
          caixa.valor = await dentro(trx);
        });
        return caixa.valor;
      }
      return dentro(conn);
    },

    /**
     * Batida de 30s (ADR-009/021): os quatro sinais viajam a cada renovação; {ativo:false} quando
     * a pessoa pediu Parar ou o turno já não é desta máquina — o executor aborta.
     */
    async renovarLease(id: string, machineId: string, sinais: Partial<SinaisTurno>, agora: number): Promise<{ ativo: boolean }> {
      const [l] = await conn<{ ativo: boolean }[]>`
        update turnos set
          lease_ate = case when estado = 'despachando' and parar_solicitado_em is null then ${data(agora + LEASE_MS)} else lease_ate end,
          attempted = attempted or ${sinais.attempted ?? false},
          rejected = rejected or ${sinais.rejected ?? false},
          prompt_submitted = prompt_submitted or ${sinais.promptSubmitted ?? false},
          produced_output = produced_output or ${sinais.producedOutput ?? false}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and machine_id = ${machineId}
        returning (estado = 'despachando' and parar_solicitado_em is null) as ativo`;
      return { ativo: l?.ativo === true };
    },

    /** Write-ahead (ADR-009): promptSubmitted é gravado ANTES de escrever no stdin. Só liga, nunca desliga. */
    async marcarSinal(id: string, sinal: keyof SinaisTurno): Promise<boolean> {
      const coluna = { attempted: "attempted", rejected: "rejected", promptSubmitted: "prompt_submitted", producedOutput: "produced_output" }[sinal];
      const r = await conn`update turnos set ${conn(coluna)} = true where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },

    /** Assenta o resultado: só sai de 'despachando' (ou 'pendente' para interrupção antes de rodar). */
    async assentar(id: string, a: Assentamento): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        update turnos set
          estado = ${a.estado},
          motivo_interrupcao = ${a.estado === "interrompido" ? (a.motivoInterrupcao ?? "sem_progresso") : null},
          motivo_falha = ${a.motivoFalha ?? null},
          attempted = attempted or ${a.sinais?.attempted ?? false},
          rejected = rejected or ${a.sinais?.rejected ?? false},
          prompt_submitted = prompt_submitted or ${a.sinais?.promptSubmitted ?? false},
          produced_output = produced_output or ${a.sinais?.producedOutput ?? false},
          custo_usd = coalesce(${a.custoUsd ?? null}, custo_usd),
          tokens_entrada = coalesce(${a.tokensEntrada ?? null}, tokens_entrada),
          tokens_saida = coalesce(${a.tokensSaida ?? null}, tokens_saida),
          lease_ate = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado in ('pendente', 'despachando')
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTurno(l) : null;
    },

    /** Transição terminal e idempotente (ADR-010/021): só o que está vivo vira 'interrompido'. */
    async interromper(id: string, motivo: MotivoInterrupcao): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        update turnos set estado = 'interrompido', motivo_interrupcao = ${motivo}, lease_ate = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado in ('pendente', 'despachando')
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTurno(l) : null;
    },

    /** Parar (E5.4): marca o pedido; a próxima renovação devolve {ativo:false} e o laço manda SIGTERM. */
    async pedirInterrupcao(ids: readonly string[], agora: number): Promise<number> {
      if (ids.length === 0) return 0;
      const r = await conn`
        update turnos set parar_solicitado_em = coalesce(parar_solicitado_em, ${data(agora)})
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id in ${conn([...ids])} and estado = 'despachando'`;
      return r.count;
    },

    /** Lease vencido: o varredor converte em 'interrompido' maquina_sem_contato — NUNCA em 'pendente'. */
    async vencidos(agora: number): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado = 'despachando' and lease_ate < ${data(agora)}
        order by criado_em`;
      return linhas.map(paraTurno);
    },

    async despachandoDaPessoa(): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado = 'despachando' order by criado_em`;
      return linhas.map(paraTurno);
    },

    async pendentesDaPessoa(conversaId?: string): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado = 'pendente'
          ${conversaId ? conn`and conversa_id = ${conversaId}` : conn``}
        order by criado_em`;
      return linhas.map(paraTurno);
    },

    async vivosDaConversa(conversaId: string): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos
        where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} and estado in ('pendente', 'despachando') order by criado_em`;
      return linhas.map(paraTurno);
    },

    /**
     * EMENDA 13: turno pendente bloqueado é renderizável — "na fila — Vera está respondendo em #revisão".
     * conversaId aponta para ONDE o agente está ocupado (outra conversa) ou para a própria, quando a
     * serialização é por conversa. Pendente sem bloqueio conhecido não entra (vai ser reivindicado já).
     */
    async pendentesRenderizaveis(conversaId: string): Promise<TurnoPendenteDto[]> {
      const linhas = await conn<{ id: string; ocupado_em: string }[]>`
        select p.id,
               coalesce(
                 (select d.conversa_id from turnos d where d.tenant_id = p.tenant_id and d.agente_id = p.agente_id and d.estado = 'despachando' order by d.criado_em limit 1),
                 (select d.conversa_id from turnos d where d.tenant_id = p.tenant_id and d.conversa_id = p.conversa_id and d.estado = 'despachando' limit 1)
               ) as ocupado_em
        from turnos p
        where p.tenant_id = ${escopo.tenantId} and p.conversa_id = ${conversaId} and p.estado = 'pendente'
        order by p.criado_em`;
      return linhas.filter((l) => l.ocupado_em !== null).map((l) => ({ id: l.id, motivo: "agente_ocupado_em", conversaId: l.ocupado_em }));
    },

    /** Entrega idempotente (ADR-021): true só na primeira vez de (turno, seq_local). */
    async registrarEntrega(turnoId: string, seqLocal: number): Promise<boolean> {
      const linhas = await conn`
        insert into turno_entregas (tenant_id, owner_id, turno_id, seq_local) values (${escopo.tenantId}, ${escopo.pessoaId}, ${turnoId}, ${seqLocal})
        on conflict (tenant_id, turno_id, seq_local) do nothing returning id`;
      return linhas.length === 1;
    },

    async listarDaConversa(conversaId: string, limite = 50): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select * from (
          select ${conn.unsafe(COLUNAS)} from turnos where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} order by criado_em desc limit ${limite}
        ) r order by criado_em`;
      return linhas.map(paraTurno);
    },
  };
}
