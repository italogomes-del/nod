import type { Assunto } from "../contracts/destino-no-chat.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { COLUNAS_MENSAGEM, paraMensagem, type LinhaMensagem } from "./mensagens.repo.ts";

/**
 * As três fontes da Atividade do bot num dia (definido em 2026-10-18, chat limpo, PR 1; ADR-114). O dia é uma FAIXA em
 * `criado_em`/`em`/`terminado_em` (`[ini, fim)`), calculada uma vez pelo Postgres no fuso; nunca
 * `(em at time zone fuso)::date = dia`, que não usa índice (trilha.repo.ts `filtrar`).
 *
 * - mensagens: a conversa própria, no índice mensagens_por_conversa (tenant, conversa, criado_em), com os assuntos que a
 *   Atividade lista. `trabalho_aberto`, `frentes_abertas` e `frentes_terminadas` de um trabalho que a fonte 3 já conta
 *   naquele dia não repetem;
 * - trilha: as negações de conector indisponível do bot, no índice parcial trilha_negacoes_por_agente (0091), uma linha
 *   por conector e causa;
 * - trabalhos: os do bot que começaram ou terminaram no dia (trabalhos_por_conversa), uma linha por começo e uma por fim.
 *
 * As contagens usam os MESMOS filtros das listas: `contagem=1` e o `total` da página batem sempre. Os `coalesce` na não
 * repetição são de propósito: sem eles, a mensagem sem payload dava `not (null)` e sumia (medido em 2026-10-18 no teste
 * de integração: o "Anotei" do dia não aparecia).
 */
export type Faixa = { ini: Date; fim: Date };

/** Os motivos da negação de conector indisponível (adapters/mcp-proxy/negacao.ts): a trilha não grava a classe. */
export const MOTIVOS_DE_CONECTOR = ["conector_indisponivel", "timeout_transporte", "falha_tecnica"] as const;

export type LinhaNegacaoDeConector = { chave: string; motivo: string; ferramenta: string; conector: string | null; vezes: number; em: Date };
export type LinhaTrabalhoDoDia = { id: string; titulo: string; forma: "task" | "frente"; origem: string; estado: string; criado_em: Date; terminado_em: Date | null };

export function atividadeRepo(conn: Conn, escopo: Escopo) {
  /** Os trabalhos da conversa que começaram ou terminaram no dia (o recorte da fonte 3 e da não repetição). */
  const filtroTrabalhos = (conversaId: string, f: Faixa) => conn`
    tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} and criado_em < ${f.fim}
      and (criado_em >= ${f.ini} or (terminado_em >= ${f.ini} and terminado_em < ${f.fim}))`;
  const trabalhosDoDia = (conversaId: string, f: Faixa) => conn`select id from trabalhos where ${filtroTrabalhos(conversaId, f)}`;

  const filtroMensagens = (conversaId: string, f: Faixa, assuntos: readonly string[]) => conn`
    m.tenant_id = ${escopo.tenantId} and m.conversa_id = ${conversaId} and m.criado_em >= ${f.ini} and m.criado_em < ${f.fim}
      and m.assunto = any(${[...assuntos]}::text[])
      and not (coalesce(m.payload->>'kind', '') = 'trabalho_aberto' and coalesce(m.payload->>'trabalhoId', '') in (select d.id::text from (${trabalhosDoDia(conversaId, f)}) d))
      and not (coalesce(m.payload->>'kind', '') in ('frentes_abertas', 'frentes_terminadas') and exists (
        select 1 from jsonb_array_elements(coalesce(m.payload->'frentes', '[]'::jsonb)) fr
        where fr->>'trabalhoId' in (select d.id::text from (${trabalhosDoDia(conversaId, f)}) d)))`;

  const filtroTrilha = (agenteId: string, f: Faixa) => conn`
    t.tenant_id = ${escopo.tenantId} and t.agente_id = ${agenteId} and t.kind = 'negacao' and t.em >= ${f.ini} and t.em < ${f.fim}
      and t.motivo = any(${[...MOTIVOS_DE_CONECTOR]}::text[])`;

  return {
    /** `[ini, fim)` do dia no fuso, pelo relógio de fusos do Postgres (o mesmo que compara as colunas). */
    async faixaDoDia(dia: string, fuso: string): Promise<Faixa> {
      const [l] = await conn<{ ini: Date; fim: Date }[]>`
        select (${dia}::date::timestamp at time zone ${fuso}) as ini, ((${dia}::date + 1)::timestamp at time zone ${fuso}) as fim`;
      if (!l) throw new Error("faixa do dia sem resposta");
      return l;
    },

    /** As mensagens do dia com o assunto gravado (sempre um dos `assuntos`: o filtro garante). */
    async mensagens(conversaId: string, f: Faixa, assuntos: readonly Assunto[], limite: number): Promise<{ mensagem: Mensagem; assunto: Assunto }[]> {
      const linhas = await conn<LinhaMensagem[]>`
        select ${conn.unsafe(COLUNAS_MENSAGEM.split(", ").map((c) => `m.${c}`).join(", "))} from mensagens m
        where ${filtroMensagens(conversaId, f, assuntos)}
        order by m.criado_em desc, m.id desc limit ${limite}`;
      return linhas.flatMap((l) => {
        const assunto = assuntos.find((a) => a === l.assunto);
        return assunto ? [{ mensagem: paraMensagem(l), assunto }] : [];
      });
    },

    async contarMensagens(conversaId: string, f: Faixa, assuntos: readonly string[]): Promise<number> {
      const [l] = await conn<{ n: number }[]>`select count(*)::int as n from mensagens m where ${filtroMensagens(conversaId, f, assuntos)}`;
      return l?.n ?? 0;
    },

    /** Uma linha por conector (ou ferramenta, sem conector) e causa, com quantas vezes e a mais recente. */
    async negacoesDeConector(agenteId: string, f: Faixa): Promise<LinhaNegacaoDeConector[]> {
      return conn<LinhaNegacaoDeConector[]>`
        select coalesce(t.conector_id::text, t.ferramenta) as chave, t.motivo, max(t.ferramenta) as ferramenta, max(c.nome) as conector,
          count(*)::int as vezes, max(t.em) as em
        from trilha t left join conectores c on c.tenant_id = t.tenant_id and c.id = t.conector_id
        where ${filtroTrilha(agenteId, f)}
        group by coalesce(t.conector_id::text, t.ferramenta), t.motivo
        order by max(t.em) desc`;
    },

    async contarNegacoesDeConector(agenteId: string, f: Faixa): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n from (select 1 from trilha t where ${filtroTrilha(agenteId, f)} group by coalesce(t.conector_id::text, t.ferramenta), t.motivo) g`;
      return l?.n ?? 0;
    },

    // O filtro direto, sem `id in (…)`: medido em 2026-10-18 (EXPLAIN num banco sintético de 3.000 trabalhos), o `in`
    // levava o Postgres a varrer a tabela inteira para o lado de fora do hash join.
    async trabalhos(conversaId: string, f: Faixa, limite: number): Promise<LinhaTrabalhoDoDia[]> {
      return conn<LinhaTrabalhoDoDia[]>`
        select id, titulo, forma, origem, estado, criado_em, terminado_em from trabalhos
        where ${filtroTrabalhos(conversaId, f)}
        order by greatest(criado_em, coalesce(terminado_em, criado_em)) desc, id desc limit ${limite}`;
    },

    /** Um item por começo no dia e um por fim no dia (o trabalho que começou e terminou hoje conta dois). */
    async contarTrabalhos(conversaId: string, f: Faixa): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        select (count(*) filter (where criado_em >= ${f.ini}) + count(*) filter (where terminado_em >= ${f.ini} and terminado_em < ${f.fim}))::int as n
        from trabalhos where ${filtroTrabalhos(conversaId, f)}`;
      return l?.n ?? 0;
    },
  };
}
