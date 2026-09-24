import type { AnexoMeta, MimeAnexo } from "../contracts/anexo.ts";
import type { Conn, Escopo } from "../shared/types.ts";

interface Linha {
  id: string;
  nome: string;
  mime: string;
  tamanho: number;
  mensagem_id: string | null;
  conversa_id: string;
}

const META = "id, nome, mime, tamanho, mensagem_id, conversa_id";

export type AnexoGuardado = AnexoMeta & { conversaId: string; mensagemId: string | null };

const paraAnexo = (l: Linha): AnexoGuardado => ({
  id: l.id,
  nome: l.nome,
  mime: l.mime as MimeAnexo,
  tamanho: l.tamanho,
  conversaId: l.conversa_id,
  mensagemId: l.mensagem_id,
});

const meta = (a: AnexoGuardado): AnexoMeta => ({ id: a.id, nome: a.nome, mime: a.mime, tamanho: a.tamanho });

/**
 * Anexos de mensagem (ADR-045). Nasce solto (mensagem_id nulo) no upload e é preso à mensagem no
 * envio — só a dona prende (RLS de escrita é owner_id). Os bytes só saem por `conteudo`, nunca junto
 * dos metadados: listar uma conversa não arrasta megabytes.
 */
export function anexosRepo(conn: Conn, escopo: Escopo) {
  return {
    async criar(a: { conversaId: string; nome: string; mime: MimeAnexo; conteudo: Uint8Array }): Promise<AnexoGuardado | null> {
      const [l] = await conn<Linha[]>`
        insert into anexos (tenant_id, owner_id, conversa_id, nome, mime, tamanho, conteudo)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${a.conversaId}, ${a.nome}, ${a.mime}, ${a.conteudo.byteLength}, ${Buffer.from(a.conteudo)})
        returning ${conn.unsafe(META)}`;
      return l ? paraAnexo(l) : null;
    },

    async buscar(id: string): Promise<AnexoGuardado | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(META)} from anexos where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraAnexo(l) : null;
    },

    async conteudo(id: string): Promise<{ meta: AnexoGuardado; bytes: Buffer } | null> {
      const [l] = await conn<(Linha & { conteudo: Buffer })[]>`
        select ${conn.unsafe(META)}, conteudo from anexos where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? { meta: paraAnexo(l), bytes: l.conteudo } : null;
    },

    /**
     * Prende à mensagem os anexos SOLTOS desta conversa e da dona. Devolve os que prendeu, na ordem
     * pedida; quem chama compara o tamanho para recusar id alheio, já usado ou de outra conversa.
     */
    async prender(ids: readonly string[], p: { conversaId: string; mensagemId: string }): Promise<AnexoMeta[]> {
      if (ids.length === 0) return [];
      const linhas = await conn<Linha[]>`
        update anexos set mensagem_id = ${p.mensagemId}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and conversa_id = ${p.conversaId}
          and mensagem_id is null and id = any(${ids as string[]}::uuid[])
        returning ${conn.unsafe(META)}`;
      const porId = new Map(linhas.map((l) => [l.id, meta(paraAnexo(l))]));
      return ids.flatMap((id) => porId.get(id) ?? []);
    },

    async daMensagens(mensagemIds: readonly string[]): Promise<Map<string, AnexoMeta[]>> {
      const saida = new Map<string, AnexoMeta[]>();
      if (mensagemIds.length === 0) return saida;
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(META)} from anexos
        where tenant_id = ${escopo.tenantId} and mensagem_id = any(${mensagemIds as string[]}::uuid[])
        order by criado_em, id`;
      for (const l of linhas) {
        if (!l.mensagem_id) continue;
        saida.set(l.mensagem_id, [...(saida.get(l.mensagem_id) ?? []), meta(paraAnexo(l))]);
      }
      return saida;
    },

    async metas(ids: readonly string[]): Promise<AnexoMeta[]> {
      if (ids.length === 0) return [];
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(META)} from anexos where tenant_id = ${escopo.tenantId} and id = any(${ids as string[]}::uuid[])`;
      const porId = new Map(linhas.map((l) => [l.id, meta(paraAnexo(l))]));
      return ids.flatMap((id) => porId.get(id) ?? []);
    },
  };
}
