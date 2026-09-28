import type { ComposicaoRaioX, ExecucaoRaioX, Preferencias } from "../contracts/raio-x.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, jsonb, ms } from "./conversao.ts";

/** Um turno com o que o Raio-X guardou dele; o caso de uso monta o resumo (domain/raio-x.ts). */
export type TurnoComRaioX = {
  turnoId: string;
  agenteId: string;
  estado: string;
  custoUsd: number | null;
  criadoEm: number;
  composicao: ComposicaoRaioX | null;
  execucao: ExecucaoRaioX | null;
};

interface Linha {
  id: string;
  agente_id: string;
  estado: string;
  custo_usd: string | null;
  criado_em: Date;
  composicao: ComposicaoRaioX | null;
  execucao: ExecucaoRaioX | null;
}

function paraTurno(l: Linha): TurnoComRaioX {
  return {
    turnoId: l.id,
    agenteId: l.agente_id,
    estado: l.estado,
    custoUsd: l.custo_usd === null ? null : Number(l.custo_usd),
    criadoEm: ms(l.criado_em),
    composicao: l.composicao,
    execucao: l.execucao,
  };
}

/**
 * Raio-X do turno (modo dev, 0036). As duas metades chegam em momentos diferentes — a composição na emissão do
 * plano, a execução na entrega — e cada uma faz upsert só da sua coluna. A leitura parte de `turnos`: turno que a
 * pessoa não vê (RLS) não tem Raio-X, e turno sem linha aqui (anterior à 0036) ainda mostra o custo.
 */
export function raioXRepo(conn: Conn, escopo: Escopo) {
  return {
    async gravarComposicao(turnoId: string, composicao: ComposicaoRaioX): Promise<void> {
      await conn`
        insert into turno_raio_x (tenant_id, owner_id, turno_id, composicao)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${turnoId}, ${jsonb(conn, composicao)})
        on conflict (tenant_id, turno_id) do update set composicao = excluded.composicao, atualizado_em = clock_timestamp()`;
    },

    async gravarExecucao(turnoId: string, execucao: ExecucaoRaioX): Promise<void> {
      await conn`
        insert into turno_raio_x (tenant_id, owner_id, turno_id, execucao)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${turnoId}, ${jsonb(conn, execucao)})
        on conflict (tenant_id, turno_id) do update set execucao = excluded.execucao, atualizado_em = clock_timestamp()`;
    },

    async doTurno(turnoId: string): Promise<TurnoComRaioX | null> {
      const [l] = await conn<Linha[]>`
        select t.id, t.agente_id, t.estado, t.custo_usd, t.criado_em, r.composicao, r.execucao
        from turnos t
        left join turno_raio_x r on r.tenant_id = t.tenant_id and r.turno_id = t.id
        where t.tenant_id = ${escopo.tenantId} and t.id = ${turnoId}`;
      return l ? paraTurno(l) : null;
    },

    /** Os turnos mais recentes da conversa, sem a composição (a faixa dev só precisa da execução). */
    async daConversa(conversaId: string, limite: number): Promise<TurnoComRaioX[]> {
      const linhas = await conn<Linha[]>`
        select t.id, t.agente_id, t.estado, t.custo_usd, t.criado_em, null as composicao, r.execucao
        from turnos t
        left join turno_raio_x r on r.tenant_id = t.tenant_id and r.turno_id = t.id
        where t.tenant_id = ${escopo.tenantId} and t.conversa_id = ${conversaId}
        order by t.criado_em desc
        limit ${limite}`;
      return linhas.map(paraTurno);
    },

    /** Custo e turnos da conversa desde `desde` (a meia-noite de quem pergunta). Turno sem custo não conta. */
    async totalDesde(conversaId: string, desde: number): Promise<{ custoUsd: number; turnos: number }> {
      const [l] = await conn<{ custo: string | null; turnos: number }[]>`
        select sum(custo_usd) as custo, count(*)::int as turnos
        from turnos
        where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} and criado_em >= ${data(desde)} and custo_usd is not null`;
      return { custoUsd: l?.custo === null || l?.custo === undefined ? 0 : Number(l.custo), turnos: l?.turnos ?? 0 };
    },
  };
}

/** Preferências da pessoa (0036). Sem linha = tudo desligado. */
export function preferenciasRepo(conn: Conn, escopo: Escopo) {
  return {
    async buscar(): Promise<Preferencias> {
      const [l] = await conn<{ modo_dev: boolean }[]>`
        select modo_dev from preferencias where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
      return { modoDev: l?.modo_dev ?? false };
    },

    async gravar(p: Preferencias): Promise<Preferencias> {
      const [l] = await conn<{ modo_dev: boolean }[]>`
        insert into preferencias (tenant_id, owner_id, modo_dev)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${p.modoDev})
        on conflict (tenant_id, owner_id) do update set modo_dev = excluded.modo_dev, atualizado_em = clock_timestamp()
        returning modo_dev`;
      return { modoDev: l?.modo_dev ?? p.modoDev };
    },
  };
}
