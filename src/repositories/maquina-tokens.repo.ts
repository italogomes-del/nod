import type { ChaveMaquinaDto } from "../contracts/api.ts";
import type { PlataformaMaquina } from "../contracts/ponte.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { data, ms, msOuNull } from "./conversao.ts";

interface Linha {
  id: string;
  nome: string;
  prefixo: string;
  criado_em: Date;
  ultimo_uso_em: Date | null;
  revogado_em: Date | null;
}

const paraDto = (l: Linha): ChaveMaquinaDto => ({ id: l.id, nome: l.nome, prefixo: l.prefixo, criadaEm: ms(l.criado_em), ultimoUsoEm: msOuNull(l.ultimo_uso_em), revogadaEm: msOuNull(l.revogado_em) });

/**
 * Chaves de máquina da pessoa (ADR-031). Guarda só o hash; NENHUM método devolve o hash para fora
 * do repositório exceto `buscarVivaPorHash`, que existe só para a comparação em tempo constante.
 * Sob RLS a pessoa só vê as próprias (owner_id), e o WHERE repete isso (segunda camada, ADR-003).
 */
export function maquinaTokensRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(e: { nome: string; prefixo: string; hash: Buffer }): Promise<ChaveMaquinaDto | null> {
      const [l] = await conn<Linha[]>`
        insert into maquina_tokens (tenant_id, owner_id, nome, prefixo, hash)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${e.nome}, ${e.prefixo}, ${e.hash})
        returning id, nome, prefixo, criado_em, ultimo_uso_em, revogado_em`;
      return l ? paraDto(l) : null;
    },

    async listar(): Promise<ChaveMaquinaDto[]> {
      const linhas = await conn<Linha[]>`
        select id, nome, prefixo, criado_em, ultimo_uso_em, revogado_em from maquina_tokens
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
        order by criado_em desc`;
      return linhas.map(paraDto);
    },

    /** Revogar é idempotente: a primeira data fica. false = a chave não existe (ou é de outra pessoa). */
    async revogar(id: string, agora: number): Promise<boolean> {
      const linhas = await conn`
        update maquina_tokens set revogado_em = coalesce(revogado_em, ${data(agora)})
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
        returning id`;
      return linhas.length > 0;
    },

    /**
     * ADR-102 (revisão do PR #306): a chave passa a vencer em `ate` (ou antes, se já vencia antes). É o "Desconectar e
     * sair das contas": a máquina tem até lá para sair das contas e confirmar; sem confirmação, a chave cai sozinha —
     * gravado no banco, sobrevive a um reinício do servidor.
     */
    async vencerEm(id: string, ate: number): Promise<boolean> {
      const r = await conn`update maquina_tokens set expira_em = least(coalesce(expira_em, ${data(ate)}), ${data(ate)})
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and revogado_em is null returning id`;
      return r.length > 0;
    },

    async buscarVivaPorHash(hash: Buffer, agora: number): Promise<{ id: string; hash: Buffer } | null> {
      const [l] = await conn<{ id: string; hash: Buffer }[]>`
        select id, hash from maquina_tokens
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and hash = ${hash}
          and revogado_em is null and (expira_em is null or expira_em > ${data(agora)})`;
      return l ?? null;
    },

    /** ADR-090 (0067): o sistema que a máquina anunciou ao se conectar. Só escreve quando muda. */
    async registrarPlataforma(id: string, plataforma: PlataformaMaquina): Promise<void> {
      await conn`update maquina_tokens set plataforma = ${plataforma}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and plataforma is distinct from ${plataforma}`;
    },

    /**
     * Nome e sistema de uma chave, revogada ou não (o aviso de uma queda antiga ainda a nomeia). null = não é chave da
     * pessoa — no modo local, o Mac que roda o servidor não tem chave.
     */
    async identificar(id: string): Promise<{ nome: string; plataforma: PlataformaMaquina | null } | null> {
      const [l] = await conn<{ nome: string; plataforma: PlataformaMaquina | null }[]>`
        select nome, plataforma from maquina_tokens where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return l ?? null;
    },

    /** ADR-102 (R2): o nome que a pessoa deu à máquina; a tela e as notas usam este, não o hostname anunciado. */
    async renomear(id: string, nome: string): Promise<boolean> {
      const r = await conn`update maquina_tokens set nome = ${nome} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and revogado_em is null returning id`;
      return r.length > 0;
    },

    async marcarUso(id: string, agora: number): Promise<void> {
      await conn`update maquina_tokens set ultimo_uso_em = ${data(agora)} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
    },
  };
}
