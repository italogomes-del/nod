import { USO_DO_MAC_PADRAO, type ComposicaoRaioX, type ExecucaoRaioX, type Preferencias, type UsoDoMac } from "../contracts/raio-x.ts";
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
  type Linha = { modo_dev: boolean; avisos_fechados: string[]; faixa_trabalhos_recolhida: boolean; uso_do_mac: UsoDoMac };
  const paraPreferencias = (l: Linha | undefined): Preferencias => ({ modoDev: l?.modo_dev ?? false, avisosFechados: l?.avisos_fechados ?? [], faixaTrabalhosRecolhida: l?.faixa_trabalhos_recolhida ?? false, usoDoMac: l?.uso_do_mac ?? USO_DO_MAC_PADRAO });
  return {
    async buscar(): Promise<Preferencias> {
      const [l] = await conn<Linha[]>`
        select modo_dev, avisos_fechados, faixa_trabalhos_recolhida, uso_do_mac from preferencias where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
      return paraPreferencias(l);
    },

    /** O que vier muda; o que faltar fica como está (ADR-083: `faixaTrabalhosRecolhida` chega sozinho da faixa). */
    async gravar(p: { modoDev?: boolean; faixaTrabalhosRecolhida?: boolean; usoDoMac?: UsoDoMac }): Promise<Preferencias> {
      const [l] = await conn<Linha[]>`
        insert into preferencias (tenant_id, owner_id, modo_dev, faixa_trabalhos_recolhida, uso_do_mac)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${p.modoDev ?? false}, ${p.faixaTrabalhosRecolhida ?? false}, ${p.usoDoMac ?? USO_DO_MAC_PADRAO})
        on conflict (tenant_id, owner_id) do update set
          modo_dev = coalesce(${p.modoDev ?? null}::boolean, preferencias.modo_dev),
          faixa_trabalhos_recolhida = coalesce(${p.faixaTrabalhosRecolhida ?? null}::boolean, preferencias.faixa_trabalhos_recolhida),
          uso_do_mac = coalesce(${p.usoDoMac ?? null}::text, preferencias.uso_do_mac),
          atualizado_em = clock_timestamp()
        returning modo_dev, avisos_fechados, faixa_trabalhos_recolhida, uso_do_mac`;
      return paraPreferencias(l);
    },

    /** 0059: guarda a chave do aviso fechado, sem repetir. Idempotente: fechar de novo não muda nada. */
    async fecharAviso(chave: string): Promise<Preferencias> {
      const [l] = await conn<Linha[]>`
        insert into preferencias (tenant_id, owner_id, avisos_fechados)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${[chave]}::text[])
        on conflict (tenant_id, owner_id) do update set
          avisos_fechados = case when ${chave} = any(preferencias.avisos_fechados) then preferencias.avisos_fechados
            else array_append(preferencias.avisos_fechados, ${chave}) end,
          atualizado_em = clock_timestamp()
        returning modo_dev, avisos_fechados, faixa_trabalhos_recolhida, uso_do_mac`;
      return paraPreferencias(l);
    },
  };
}
