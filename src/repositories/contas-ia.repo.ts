import { CONTAS_DA_PESSOA_MAX } from "../contracts/contas-ia.ts";
import type { ContaAnunciada, EstadoContaNaMaquina, IaComConta, ModoDasContas } from "../contracts/contas-ia.ts";
import { apelidoPadrao, decidirAnuncio, ehIaComConta, type ContaDaPessoa, type VinculoDaConta } from "../domain/contas-da-pessoa.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, msOuNull } from "./conversao.ts";

interface LinhaConta {
  id: string;
  ia: IaComConta;
  impressao: string;
  apelido: string;
  plano: string | null;
  corporativa: boolean;
  posicao: number;
  entra_na_troca_automatica: boolean;
  no_limite_ate: Date | null;
  removida_em: Date | null;
}
interface LinhaVinculo { conta_id: string; maquina_id: string; estado: EstadoContaNaMaquina; sair_pedido_em: Date | null }

const COLUNAS = "id, ia, impressao, apelido, plano, corporativa, posicao, entra_na_troca_automatica, no_limite_ate, removida_em";

export type ContaGuardadaNoServidor = ContaDaPessoa & { impressao: string };

const paraConta = (l: LinhaConta): ContaGuardadaNoServidor => ({
  id: l.id,
  ia: l.ia,
  impressao: l.impressao,
  apelido: l.apelido,
  plano: l.plano,
  corporativa: l.corporativa,
  posicao: l.posicao,
  entraNaTrocaAutomatica: l.entra_na_troca_automatica,
  noLimiteAte: msOuNull(l.no_limite_ate),
  removidaEm: msOuNull(l.removida_em),
});
const paraVinculo = (l: LinhaVinculo): VinculoDaConta => ({ contaId: l.conta_id, maquinaId: l.maquina_id, estado: l.estado, sairPedidoEm: msOuNull(l.sair_pedido_em) });

/** O resultado de um anúncio: as impressões de que a máquina deve sair (R4) e se a lista mudou (a tela relê). */
export type ResultadoDoAnuncio = { sair: string[]; mudou: boolean };

/**
 * As contas de IA da pessoa (0074, ADR-102). Toda escrita é da dona (RLS e `owner_id`). Anúncio e reordenação tomam o
 * lock da pessoa (R3 da revisão): duas máquinas anunciando contas novas ao mesmo tempo não pegam a mesma posição.
 */
export function contasIaRepo(conn: Conn, escopo: Escopo) {
  // Uma função: os repositórios nascem juntos (criarRepos) e alguns testes passam uma conexão que não é o postgres.js.
  const doDono = () => conn`tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
  const travarPessoa = () => conn`select pg_advisory_xact_lock(hashtext(${`contas_ia:${escopo.tenantId}:${escopo.pessoaId}`}))`;

  async function proximaPosicao(): Promise<number> {
    const [l] = await conn<{ max: number | null }[]>`select max(posicao) as max from contas_ia where ${doDono()} and removida_em is null`;
    return (l?.max ?? 0) + 1;
  }

  return {
    /** Serializa as mudanças da lista da pessoa até o fim da transação (o "Seguir com" clicado duas vezes, R3). */
    travar: async (): Promise<void> => { await travarPessoa(); },
    /** Revisão do PR #306: o despacho só lê a lista inteira quando a máquina tem alguma conta pronta (o caso raro hoje). */
    async temContaNaMaquina(maquinaId: string): Promise<boolean> {
      const [l] = await conn`select 1 from contas_ia_maquinas where ${doDono()} and maquina_id = ${maquinaId} and estado = 'pronta' and sair_pedido_em is null limit 1`;
      return l !== undefined;
    },
    /** As contas (com as removidas, que o anúncio precisa ver) e todos os vínculos com as máquinas. */
    async listar(): Promise<{ contas: ContaGuardadaNoServidor[]; vinculos: VinculoDaConta[] }> {
      const [contas, vinculos] = await Promise.all([
        conn<LinhaConta[]>`select ${conn.unsafe(COLUNAS)} from contas_ia where ${doDono()} order by posicao, criada_em`,
        conn<LinhaVinculo[]>`select conta_id, maquina_id, estado, sair_pedido_em from contas_ia_maquinas where ${doDono()}`,
      ]);
      return { contas: contas.map(paraConta), vinculos: vinculos.map(paraVinculo) };
    },

    async buscar(id: string): Promise<ContaGuardadaNoServidor | null> {
      const [l] = await conn<LinhaConta[]>`select ${conn.unsafe(COLUNAS)} from contas_ia where ${doDono()} and id = ${id}`;
      return l ? paraConta(l) : null;
    },

    /**
     * O anúncio de uma máquina (no `conectar` e no `inventario`): cria as contas novas no fim da lista, atualiza o
     * vínculo das conhecidas, devolve à lista a removida que entrou de novo depois da remoção e pede saída da que a
     * máquina ainda não tinha largado (R4). Vínculo desta máquina que não veio no anúncio é apagado: a máquina não tem
     * mais a conta (saiu, ou cumpriu a saída pedida).
     */
    async doAnuncio(maquinaId: string, anunciadas: readonly ContaAnunciada[], agora: number): Promise<ResultadoDoAnuncio> {
      await travarPessoa();
      const existentes = (await conn<LinhaConta[]>`select ${conn.unsafe(COLUNAS)} from contas_ia where ${doDono()}`).map(paraConta);
      const porChave = new Map(existentes.map((c) => [`${c.ia}:${c.impressao}`, c]));
      const sair: string[] = [];
      const vistas: string[] = [];
      let mudou = false;
      let ativas = existentes.filter((c) => c.removidaEm === null).length;
      for (const a of anunciadas) {
        const existente = porChave.get(`${a.ia}:${a.impressao}`) ?? null;
        const decisao = decidirAnuncio(existente, a.logadaEm);
        if ((decisao === "criar" || decisao === "voltar") && ativas >= CONTAS_DA_PESSOA_MAX) continue;
        if (decisao === "criar" || decisao === "voltar") ativas++;
        let id: string;
        if (decisao === "sair") {
          sair.push(a.impressao);
          id = existente!.id;
          await conn`
            insert into contas_ia_maquinas (tenant_id, owner_id, conta_id, maquina_id, estado, sair_pedido_em, visto_em)
            values (${escopo.tenantId}, ${escopo.pessoaId}, ${id}, ${maquinaId}, ${a.estado}, ${data(agora)}, ${data(agora)})
            on conflict (tenant_id, conta_id, maquina_id) do update set estado = excluded.estado, sair_pedido_em = coalesce(contas_ia_maquinas.sair_pedido_em, excluded.sair_pedido_em), visto_em = excluded.visto_em`;
          vistas.push(id);
          continue;
        }
        if (decisao === "criar") {
          const posicao = await proximaPosicao();
          const [l] = await conn<{ id: string }[]>`
            insert into contas_ia (tenant_id, owner_id, ia, impressao, apelido, plano, corporativa, posicao)
            values (${escopo.tenantId}, ${escopo.pessoaId}, ${a.ia}, ${a.impressao}, ${a.apelidoSugerido ?? apelidoPadrao(posicao)}, ${a.plano}, ${corporativaDe(a)}, ${posicao})
            on conflict (tenant_id, owner_id, ia, impressao) do update set plano = coalesce(excluded.plano, contas_ia.plano)
            returning id`;
          id = l!.id;
          mudou = true;
        } else if (decisao === "voltar") {
          const posicao = await proximaPosicao();
          await conn`update contas_ia set removida_em = null, no_limite_ate = null, posicao = ${posicao}, plano = coalesce(${a.plano}, plano), corporativa = ${corporativaDe(a)} where ${doDono()} and id = ${existente!.id}`;
          id = existente!.id;
          mudou = true;
        } else {
          id = existente!.id;
          if (a.plano !== null && (a.plano !== existente!.plano || corporativaDe(a) !== existente!.corporativa)) {
            await conn`update contas_ia set plano = ${a.plano}, corporativa = ${corporativaDe(a)} where ${doDono()} and id = ${id}`;
            mudou = true;
          }
        }
        const [antes] = await conn<{ estado: string }[]>`select estado from contas_ia_maquinas where ${doDono()} and conta_id = ${id} and maquina_id = ${maquinaId}`;
        if (antes?.estado !== a.estado) mudou = true;
        await conn`
          insert into contas_ia_maquinas (tenant_id, owner_id, conta_id, maquina_id, estado, visto_em)
          values (${escopo.tenantId}, ${escopo.pessoaId}, ${id}, ${maquinaId}, ${a.estado}, ${data(agora)})
          on conflict (tenant_id, conta_id, maquina_id) do update set estado = excluded.estado, visto_em = excluded.visto_em`;
        vistas.push(id);
      }
      const apagados = await conn`
        delete from contas_ia_maquinas where ${doDono()} and maquina_id = ${maquinaId}
          and not (conta_id = any(${vistas}::uuid[]))
        returning conta_id`;
      if (apagados.length > 0) mudou = true;
      return { sair, mudou };
    },

    async renomear(id: string, apelido: string): Promise<boolean> {
      const r = await conn`update contas_ia set apelido = ${apelido} where ${doDono()} and id = ${id} and removida_em is null returning id`;
      return r.length > 0;
    },

    async definirTrocaAutomatica(id: string, entra: boolean): Promise<boolean> {
      const r = await conn`update contas_ia set entra_na_troca_automatica = ${entra} where ${doDono()} and id = ${id} and removida_em is null returning id`;
      return r.length > 0;
    },

    /** A nova ordem: exatamente as contas não removidas, cada uma uma vez. false = a lista mudou no meio (a tela relê). */
    async reordenar(ids: readonly string[]): Promise<boolean> {
      await travarPessoa();
      const atuais = await conn<{ id: string }[]>`select id from contas_ia where ${doDono()} and removida_em is null`;
      const conjunto = new Set(atuais.map((l) => l.id));
      if (ids.length !== conjunto.size || new Set(ids).size !== ids.length || ids.some((id) => !conjunto.has(id))) return false;
      for (const [i, id] of ids.entries()) await conn`update contas_ia set posicao = ${i + 1} where ${doDono()} and id = ${id}`;
      return true;
    },

    async marcarLimite(id: string, ate: number): Promise<void> {
      await conn`update contas_ia set no_limite_ate = ${data(ate)} where ${doDono()} and id = ${id}`;
    },

    /** Um turno deu certo na conta: ela sai do limite antes do prazo. true = estava no limite. */
    async limparLimite(id: string): Promise<boolean> {
      const r = await conn`update contas_ia set no_limite_ate = null where ${doDono()} and id = ${id} and no_limite_ate is not null returning id`;
      return r.length > 0;
    },

    /** "Sair desta máquina": a máquina faz o logout no próximo contato. false = a conta não está nela. */
    async pedirSaida(id: string, maquinaId: string, agora: number): Promise<boolean> {
      const r = await conn`update contas_ia_maquinas set sair_pedido_em = coalesce(sair_pedido_em, ${data(agora)}) where ${doDono()} and conta_id = ${id} and maquina_id = ${maquinaId} returning conta_id`;
      return r.length > 0;
    },

    /** "Remover de todas": some da lista na hora; cada máquina sai dela no próximo contato. */
    async remover(id: string, agora: number): Promise<boolean> {
      const r = await conn`update contas_ia set removida_em = ${data(agora)}, no_limite_ate = null where ${doDono()} and id = ${id} and removida_em is null returning id`;
      if (r.length === 0) return false;
      await conn`update contas_ia_maquinas set sair_pedido_em = coalesce(sair_pedido_em, ${data(agora)}) where ${doDono()} and conta_id = ${id}`;
      return true;
    },

    /** Desconectar a máquina pedindo para sair das contas: todos os vínculos dela ganham a saída. */
    async pedirSaidaDeTodas(maquinaId: string, agora: number): Promise<number> {
      const r = await conn`update contas_ia_maquinas set sair_pedido_em = coalesce(sair_pedido_em, ${data(agora)}) where ${doDono()} and maquina_id = ${maquinaId} returning conta_id`;
      return r.length;
    },

    /** As impressões de que a máquina deve sair (a puxada de contas, a cada 3 s; índice parcial `contas_ia_maquinas_sair`). */
    async saidasPendentes(maquinaId: string): Promise<string[]> {
      const linhas = await conn<{ impressao: string }[]>`
        select c.impressao from contas_ia_maquinas v join contas_ia c on c.tenant_id = v.tenant_id and c.id = v.conta_id
        where v.tenant_id = ${escopo.tenantId} and v.owner_id = ${escopo.pessoaId} and v.maquina_id = ${maquinaId} and v.sair_pedido_em is not null`;
      return linhas.map((l) => l.impressao);
    },

    /** A máquina saiu das contas: o vínculo some. */
    async saiu(maquinaId: string, impressoes: readonly string[]): Promise<number> {
      if (impressoes.length === 0) return 0;
      const r = await conn`
        delete from contas_ia_maquinas v using contas_ia c
        where v.tenant_id = ${escopo.tenantId} and v.owner_id = ${escopo.pessoaId} and v.maquina_id = ${maquinaId}
          and c.tenant_id = v.tenant_id and c.id = v.conta_id and c.impressao = any(${[...impressoes]}::text[])
        returning v.conta_id`;
      return r.length;
    },

    /** A conta sumiu da máquina no meio do turno (`conta_ausente`, R6): o vínculo sai. */
    async apagarVinculo(id: string, maquinaId: string): Promise<void> {
      await conn`delete from contas_ia_maquinas where ${doDono()} and conta_id = ${id} and maquina_id = ${maquinaId}`;
    },

    async modo(): Promise<{ modo: ModoDasContas; escolhidas: Partial<Record<IaComConta, string>> }> {
      const [l] = await conn<{ contas_modo: string; contas_escolhidas: Record<string, unknown> }[]>`
        select contas_modo, contas_escolhidas from preferencias where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}`;
      const escolhidas: Partial<Record<IaComConta, string>> = {};
      for (const [ia, id] of Object.entries(l?.contas_escolhidas ?? {})) if (ehIaComConta(ia) && typeof id === "string") escolhidas[ia] = id;
      return { modo: l?.contas_modo === "automatico" ? "automatico" : "perguntar", escolhidas };
    },

    async definirModo(modo: ModoDasContas): Promise<void> {
      await conn`
        insert into preferencias (tenant_id, owner_id, contas_modo) values (${escopo.tenantId}, ${escopo.pessoaId}, ${modo})
        on conflict (tenant_id, owner_id) do update set contas_modo = excluded.contas_modo, atualizado_em = clock_timestamp()`;
    },

    /** "Seguir com <conta>": a escolhida da IA (null tira). Vale até a primeira da IA renovar (contaDoTurno). */
    async definirEscolhida(ia: IaComConta, id: string | null): Promise<void> {
      const valor = id === null ? conn`preferencias.contas_escolhidas - ${ia}::text` : conn`preferencias.contas_escolhidas || jsonb_build_object(${ia}::text, ${id}::text)`;
      await conn`
        insert into preferencias (tenant_id, owner_id, contas_escolhidas)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${id === null ? conn`'{}'::jsonb` : conn`jsonb_build_object(${ia}::text, ${id}::text)`})
        on conflict (tenant_id, owner_id) do update set contas_escolhidas = ${valor}, atualizado_em = clock_timestamp()`;
    },
  };
}

const corporativaDe = (a: ContaAnunciada): boolean => a.corporativa;
