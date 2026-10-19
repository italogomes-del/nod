import type { FalhaRevisao, VereditoRevisao } from "../contracts/revisao.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, msOuNull } from "./conversao.ts";

/** O que a linha registra (0093): o modo decidiu sem a pessoa, ou mandou ao revisor. Texto livre só aqui, nunca na trilha. */
export type TipoAcaoDoModo = "comando" | "arquivo" | "leitura_credencial" | "app" | "mcp";
export type GatilhoAcaoDoModo = "arriscado" | "envio_apos_fora" | "credencial" | "fora_da_pasta" | "comum";

export type NovaAcaoDoModo = {
  agenteId: string;
  conversaId: string;
  turnoId: string;
  decisaoId: string | null;
  modo: "automatico" | "total";
  tipo: TipoAcaoDoModo;
  /** Já redigido por quem chama (`resumoDaAcao`); cortado de novo aqui. */
  resumo: string;
  gatilho: GatilhoAcaoDoModo;
  risco: string | null;
  veredito?: VereditoRevisao | null;
  falha?: FalhaRevisao | null;
  motivo?: string | null;
  revisorModelo?: string | null;
  revisorHarness?: string | null;
  /** A máquina a que o pedido foi; null = cartão direto, sem revisor. Os tetos contam só as linhas com máquina. */
  revisorMaquina?: string | null;
};

export type AcaoDoModo = NovaAcaoDoModo & {
  id: string;
  entregueEm: number | null;
  revisorMs: number | null;
  fichasEntrada: number | null;
  fichasSaida: number | null;
  desfechoPessoa: "aprovou" | "negou" | "venceu" | null;
  criadoEm: number;
};

interface Linha {
  id: string;
  agente_id: string;
  conversa_id: string;
  turno_id: string;
  decisao_id: string | null;
  modo: "automatico" | "total";
  tipo: TipoAcaoDoModo;
  resumo: string;
  gatilho: GatilhoAcaoDoModo;
  risco: string | null;
  veredito: VereditoRevisao | null;
  falha: FalhaRevisao | null;
  motivo: string | null;
  revisor_modelo: string | null;
  revisor_harness: string | null;
  revisor_maquina: string | null;
  entregue_em: Date | null;
  revisor_ms: number | null;
  fichas_entrada: number | null;
  fichas_saida: number | null;
  desfecho_pessoa: "aprovou" | "negou" | "venceu" | null;
  criado_em: Date;
}

const COLUNAS = "id, agente_id, conversa_id, turno_id, decisao_id, modo, tipo, resumo, gatilho, risco, veredito, falha, motivo, revisor_modelo, revisor_harness, revisor_maquina, entregue_em, revisor_ms, fichas_entrada, fichas_saida, desfecho_pessoa, criado_em";

const paraAcao = (l: Linha): AcaoDoModo => ({
  id: l.id,
  agenteId: l.agente_id,
  conversaId: l.conversa_id,
  turnoId: l.turno_id,
  decisaoId: l.decisao_id,
  modo: l.modo,
  tipo: l.tipo,
  resumo: l.resumo,
  gatilho: l.gatilho,
  risco: l.risco,
  veredito: l.veredito,
  falha: l.falha,
  motivo: l.motivo,
  revisorModelo: l.revisor_modelo,
  revisorHarness: l.revisor_harness,
  revisorMaquina: l.revisor_maquina,
  entregueEm: msOuNull(l.entregue_em),
  revisorMs: l.revisor_ms,
  fichasEntrada: l.fichas_entrada,
  fichasSaida: l.fichas_saida,
  desfechoPessoa: l.desfecho_pessoa,
  criadoEm: l.criado_em.getTime(),
});

/** Inteiro não negativo ou null: as fichas e o tempo vêm da máquina (já validados na rota); aqui só a segunda camada. */
const naoNegativo = (n: number | null | undefined): number | null => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), 2_000_000_000) : null);

/**
 * `acoes_pelo_modo` (0093, ADR-115): o registro do que o modo decidiu sem a pessoa. Privado da dona (RLS da
 * `nod_escopar_tabela`); apagável por nod_poda, e a própria dona poda o que passou de 90 dias (varredor de expiração).
 */
export function acoesPeloModoRepo(conn: Conn, escopo: Escopo) {
  return {
    async registrar(a: NovaAcaoDoModo): Promise<string> {
      const [l] = await conn<{ id: string }[]>`
        insert into acoes_pelo_modo (tenant_id, owner_id, agente_id, conversa_id, turno_id, decisao_id, modo, tipo, resumo, gatilho, risco, veredito, falha, motivo, revisor_modelo, revisor_harness, revisor_maquina)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${a.agenteId}, ${a.conversaId}, ${a.turnoId}, ${a.decisaoId}, ${a.modo}, ${a.tipo}, ${a.resumo.slice(0, 500)}, ${a.gatilho},
          ${a.risco?.slice(0, 200) ?? null}, ${a.veredito ?? null}, ${a.falha ?? null}, ${a.motivo?.slice(0, 160) ?? null}, ${a.revisorModelo?.slice(0, 80) ?? null},
          ${a.revisorHarness?.slice(0, 32) ?? null}, ${a.revisorMaquina?.slice(0, 128) ?? null})
        returning id`;
      if (!l) throw new Error("acoes_pelo_modo sem id");
      return l.id;
    },

    async daDecisao(decisaoId: string): Promise<AcaoDoModo | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from acoes_pelo_modo where tenant_id = ${escopo.tenantId} and decisao_id = ${decisaoId}`;
      return l ? paraAcao(l) : null;
    },

    async doTurno(turnoId: string): Promise<AcaoDoModo[]> {
      const linhas = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from acoes_pelo_modo where tenant_id = ${escopo.tenantId} and turno_id = ${turnoId} order by criado_em, id`;
      return linhas.map(paraAcao);
    },

    /**
     * O veredito da fase 3, uma vez só (`veredito is null`): o relato repetido, o prazo e o varredor não regravam.
     * Devolve se gravou.
     */
    async concluir(decisaoId: string, c: { veredito: VereditoRevisao; falha?: FalhaRevisao | null; motivo?: string | null; entregueEm?: number | null; revisorMs?: number | null; fichasEntrada?: number | null; fichasSaida?: number | null }): Promise<boolean> {
      const r = await conn`
        update acoes_pelo_modo set veredito = ${c.veredito}, falha = ${c.falha ?? null}, motivo = ${c.motivo?.slice(0, 160) ?? null},
          entregue_em = ${c.entregueEm ? data(c.entregueEm) : null}, revisor_ms = ${naoNegativo(c.revisorMs)},
          fichas_entrada = ${naoNegativo(c.fichasEntrada)}, fichas_saida = ${naoNegativo(c.fichasSaida)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and decisao_id = ${decisaoId} and veredito is null`;
      return r.count === 1;
    },

    /** Quantas revisões o turno já mandou a uma máquina (o teto de 20, plano 3c). */
    async revisoesDoTurno(turnoId: string): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n from acoes_pelo_modo where tenant_id = ${escopo.tenantId} and turno_id = ${turnoId} and revisor_maquina is not null`;
      return l?.n ?? 0;
    },

    /** Quantas ações deste turno o revisor mandou à pessoa (vai no pedido: revisão de engenharia 3). */
    async pedidasNoTurno(turnoId: string): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n from acoes_pelo_modo where tenant_id = ${escopo.tenantId} and turno_id = ${turnoId} and veredito = 'pede'`;
      return l?.n ?? 0;
    },

    /**
     * Quantas revisões a pessoa mandou a máquinas desde `desde` (o teto do dia). Na tx escopada dela a RLS mostra todas as
     * linhas dela — de todos os bots e de todas as contas de IA —, que é exatamente o que o teto conta.
     */
    async revisoesDaPessoaDesde(desde: number): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n from acoes_pelo_modo
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and criado_em >= ${data(desde)} and revisor_maquina is not null`;
      return l?.n ?? 0;
    },

    /** O desfecho do cartão que a revisão deixou, quando a pessoa decide ou ele vence (só a primeira vez). */
    async registrarDesfechoPessoa(decisaoId: string, desfecho: "aprovou" | "negou" | "venceu"): Promise<void> {
      await conn`update acoes_pelo_modo set desfecho_pessoa = ${desfecho}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and decisao_id = ${decisaoId} and desfecho_pessoa is null`;
    },

    /** Retenção de 90 dias (0093): a dona apaga as próprias linhas mais velhas que `antesDe`. Devolve quantas. */
    async podar(antesDe: number): Promise<number> {
      const r = await conn`delete from acoes_pelo_modo where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and criado_em < ${data(antesDe)}`;
      return r.count;
    },
  };
}
