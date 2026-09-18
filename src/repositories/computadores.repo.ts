import type { Computador, ControleComputador, PoliticaComputador, RegistroComputador } from "../contracts/computador.ts";
import type { Conn, Escopo } from "../shared/types.ts";

type Linha = { id: string; agente_id: string; habilitado: boolean; controle: ControleComputador; politica: PoliticaComputador; ajuda: string | null; ajuda_decisao_id: string | null; ocupado_ate: Date | null; operacao_id: string | null; criado_em: Date };
type LinhaAcao = { id: string; computador_id: string; turno_id: string | null; autor: RegistroComputador["autor"]; tipo: string; estado: RegistroComputador["estado"]; argumentos_cifrados: string | null; em: Date };
const computador = (l: Linha): Computador => ({ id: l.id, agenteId: l.agente_id, habilitado: l.habilitado, controle: l.controle, politica: l.politica, ajuda: l.ajuda, ajudaDecisaoId: l.ajuda_decisao_id, ocupadoAte: l.ocupado_ate?.getTime() ?? null, operacaoId: l.operacao_id, criadoEm: l.criado_em.getTime() });
const acao = (l: LinhaAcao): RegistroComputador => ({ id: l.id, computadorId: l.computador_id, turnoId: l.turno_id, autor: l.autor, tipo: l.tipo, estado: l.estado, em: l.em.getTime() });

export function computadoresRepo(conn: Conn, escopo: Escopo) {
  return {
    async buscarVinculo(agenteId: string): Promise<Computador | null> {
      const [l] = await conn<Linha[]>`select c.*, a.id as agente_id from computadores c join agentes a on a.tenant_id = c.tenant_id and a.computador_id = c.id
        where c.tenant_id = ${escopo.tenantId} and c.owner_id = ${escopo.pessoaId} and a.owner_id = ${escopo.pessoaId} and a.id = ${agenteId}`;
      return l ? computador(l) : null;
    },
    async obter(agenteId: string): Promise<Computador | null> {
      const [agente] = await conn<{ id: string; computador_id: string | null }[]>`select id, computador_id from agentes where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${agenteId} and excluido_em is null for update`;
      if (!agente) return null;
      if (!agente.computador_id) {
        const [novo] = await conn<{ id: string }[]>`insert into computadores (tenant_id, owner_id) values (${escopo.tenantId}, ${escopo.pessoaId}) returning id`;
        await conn`update agentes set computador_id = ${novo!.id} where tenant_id = ${escopo.tenantId} and id = ${agenteId}`;
      }
      const [l] = await conn<Linha[]>`select c.*, a.id as agente_id from computadores c join agentes a on a.tenant_id = c.tenant_id and a.computador_id = c.id
        where c.tenant_id = ${escopo.tenantId} and c.owner_id = ${escopo.pessoaId} and a.id = ${agenteId} and a.excluido_em is null`;
      return l ? computador(l) : null;
    },
    async travar(id: string): Promise<Computador | null> {
      const [l] = await conn<Linha[]>`select c.*, a.id as agente_id from computadores c join agentes a on a.tenant_id = c.tenant_id and a.computador_id = c.id where c.tenant_id = ${escopo.tenantId} and c.owner_id = ${escopo.pessoaId} and c.id = ${id} for update of c`;
      return l ? computador(l) : null;
    },
    async configurar(id: string, c: { habilitado?: boolean; controle?: ControleComputador; politica?: PoliticaComputador; ajuda?: string | null; ajudaDecisaoId?: string | null }): Promise<void> {
      await conn`update computadores set habilitado = coalesce(${c.habilitado ?? null}, habilitado), controle = coalesce(${c.controle ?? null}, controle), politica = coalesce(${c.politica ?? null}, politica),
        ajuda = case when ${c.ajuda !== undefined} then ${c.ajuda ?? null} else ajuda end,
        ajuda_decisao_id = case when ${c.ajudaDecisaoId !== undefined} then ${c.ajudaDecisaoId ?? null}::uuid else ajuda_decisao_id end
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
    },
    async ocupar(id: string, operacaoId: string, ate: number): Promise<void> {
      await conn`update computadores set operacao_id = ${operacaoId}, ocupado_ate = ${new Date(ate)} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
    },
    async liberar(id: string, operacaoId: string): Promise<void> {
      await conn`update computadores set operacao_id = null, ocupado_ate = null where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and operacao_id = ${operacaoId}`;
    },
    async registrar(e: { computadorId: string; turnoId?: string; autor: RegistroComputador["autor"]; tipo: string; estado: RegistroComputador["estado"]; argumentosCifrados?: string }): Promise<RegistroComputador> {
      const [l] = await conn<LinhaAcao[]>`insert into computador_acoes (tenant_id, owner_id, computador_id, turno_id, autor, tipo, estado, argumentos_cifrados)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${e.computadorId}, ${e.turnoId ?? null}, ${e.autor}, ${e.tipo}, ${e.estado}, ${e.argumentosCifrados ?? null}) returning *`;
      return acao(l!);
    },
    async buscarAcao(id: string): Promise<(RegistroComputador & { argumentosCifrados: string | null }) | null> {
      const [l] = await conn<LinhaAcao[]>`select * from computador_acoes where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} for update`;
      return l ? { ...acao(l), argumentosCifrados: l.argumentos_cifrados } : null;
    },
    async concluir(id: string, estado: RegistroComputador["estado"]): Promise<void> {
      await conn`update computador_acoes set estado = ${estado}, argumentos_cifrados = null where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
    },
    async atividade(id: string): Promise<RegistroComputador[]> {
      const linhas = await conn<LinhaAcao[]>`select * from computador_acoes where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and computador_id = ${id} and tipo <> 'observar' order by em desc limit 30`;
      return linhas.map(acao);
    },
  };
}
