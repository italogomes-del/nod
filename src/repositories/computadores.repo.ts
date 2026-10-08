import type { Computador, ControleComputador, PoliticaComputador, RegistroComputador } from "../contracts/computador.ts";
import type { MotivoFalhaComputador } from "../contracts/motivos.ts";
import type { Conn, Escopo } from "../shared/types.ts";

type Linha = { id: string; agente_id: string; habilitado: boolean; controle: ControleComputador; politica: PoliticaComputador; ajuda: string | null; ajuda_decisao_id: string | null; ocupado_ate: Date | null; operacao_id: string | null; criado_em: Date; falhas_seguidas: number; falha_motivo: MotivoFalhaComputador | null; indisponivel_desde: Date | null };
type LinhaAcao = { id: string; computador_id: string; turno_id: string | null; autor: RegistroComputador["autor"]; tipo: string; estado: RegistroComputador["estado"]; motivo: MotivoFalhaComputador | null; argumentos_cifrados: string | null; em: Date };
const computador = (l: Linha): Computador => ({ id: l.id, agenteId: l.agente_id, habilitado: l.habilitado, controle: l.controle, politica: l.politica, ajuda: l.ajuda, ajudaDecisaoId: l.ajuda_decisao_id, ocupadoAte: l.ocupado_ate?.getTime() ?? null, operacaoId: l.operacao_id, criadoEm: l.criado_em.getTime(), falhasSeguidas: l.falhas_seguidas, falhaMotivo: l.falha_motivo, indisponivelDesde: l.indisponivel_desde?.getTime() ?? null });
const acao = (l: LinhaAcao): RegistroComputador => ({ id: l.id, computadorId: l.computador_id, turnoId: l.turno_id, autor: l.autor, tipo: l.tipo, estado: l.estado, motivo: l.motivo, em: l.em.getTime() });

export function computadoresRepo(conn: Conn, escopo: Escopo) {
  return {
    async buscarVinculo(agenteId: string): Promise<Computador | null> {
      const [l] = await conn<Linha[]>`select c.*, a.id as agente_id from computadores c join agentes a on a.tenant_id = c.tenant_id and a.computador_id = c.id
        where c.tenant_id = ${escopo.tenantId} and c.owner_id = ${escopo.pessoaId} and a.owner_id = ${escopo.pessoaId} and a.id = ${agenteId}`;
      return l ? computador(l) : null;
    },
    /**
     * NOD-192: o painel só lê — sem FOR UPDATE e sem insert. `undefined` = agente inexistente, excluído ou de
     * outra pessoa (o mesmo 404 de `obter`); `null` = o agente ainda não tem computador.
     */
    async buscarDoAgente(agenteId: string): Promise<Computador | null | undefined> {
      const [l] = await conn<(Partial<Linha> & { dono_agente_id: string; vinculo: string | null })[]>`select c.*, a.id as dono_agente_id, a.computador_id as vinculo from agentes a
        left join computadores c on c.tenant_id = a.tenant_id and c.id = a.computador_id and c.owner_id = ${escopo.pessoaId}
        where a.tenant_id = ${escopo.tenantId} and a.owner_id = ${escopo.pessoaId} and a.id = ${agenteId} and a.excluido_em is null`;
      if (!l) return undefined;
      // Vínculo para uma linha que esta pessoa não vê: o mesmo 404 que `obter` daria.
      if (l.vinculo && !l.id) return undefined;
      return l.id ? computador({ ...l, agente_id: l.dono_agente_id } as Linha) : null;
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
    /** `atividadeEm` (NOD-170): iniciar, assumir e devolver contam como atividade e adiam o desligamento por ociosidade. */
    async configurar(id: string, c: { habilitado?: boolean; controle?: ControleComputador; politica?: PoliticaComputador; ajuda?: string | null; ajudaDecisaoId?: string | null; atividadeEm?: number }): Promise<void> {
      await conn`update computadores set habilitado = coalesce(${c.habilitado ?? null}, habilitado), controle = coalesce(${c.controle ?? null}, controle), politica = coalesce(${c.politica ?? null}, politica),
        ultima_atividade_em = coalesce(${c.atividadeEm === undefined ? null : new Date(c.atividadeEm)}::timestamptz, ultima_atividade_em),
        ajuda = case when ${c.ajuda !== undefined} then ${c.ajuda ?? null} else ajuda end,
        ajuda_decisao_id = case when ${c.ajudaDecisaoId !== undefined} then ${c.ajudaDecisaoId ?? null}::uuid else ajuda_decisao_id end
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
    },
    async ocupar(id: string, operacaoId: string, ate: number): Promise<void> {
      await conn`update computadores set operacao_id = ${operacaoId}, ocupado_ate = ${new Date(ate)} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
    },
    /**
     * `atividadeEm` (NOD-170): o fim de uma ação do bot ou da pessoa é atividade. O varredor de ociosidade libera
     * SEM ela — desligar por ociosidade não pode reiniciar o relógio da ociosidade.
     */
    async liberar(id: string, operacaoId: string, atividadeEm?: number): Promise<void> {
      await conn`update computadores set operacao_id = null, ocupado_ate = null,
        ultima_atividade_em = coalesce(${atividadeEm === undefined ? null : new Date(atividadeEm)}::timestamptz, ultima_atividade_em)
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and operacao_id = ${operacaoId}`;
    },
    /**
     * definido em 2026-10-05 (NOD-170): os computadores desta pessoa sem atividade há `limiteMs`, que o varredor
     * pode desligar. Fora: desabilitado, com a pessoa ou esperando por ela, e com reserva viva. `id` restringe a
     * um: é a rechecagem depois do `travar`. O fora do ar ENTRA (QA 2026-10-05): a ação do bot não chega ao Docker
     * e a saúde não para o container, então ele ficaria ligado para sempre ocupando uma vaga do teto; desligado,
     * segue fora do ar e o "Tentar de novo" religa.
     */
    async ociosos(limiteMs: number, agora: number, id?: string): Promise<Computador[]> {
      const linhas = await conn<Linha[]>`select c.*, a.id as agente_id from computadores c join agentes a on a.tenant_id = c.tenant_id and a.computador_id = c.id
        where c.tenant_id = ${escopo.tenantId} and c.owner_id = ${escopo.pessoaId} and (${id ?? null}::uuid is null or c.id = ${id ?? null}::uuid)
          and c.habilitado and c.controle = 'bot'
          and (c.ocupado_ate is null or c.ocupado_ate <= ${new Date(agora)})
          and c.ultima_atividade_em < ${new Date(agora - limiteMs)}
        order by c.ultima_atividade_em`;
      return linhas.map(computador);
    },
    async registrar(e: { computadorId: string; turnoId?: string; autor: RegistroComputador["autor"]; tipo: string; estado: RegistroComputador["estado"]; argumentosCifrados?: string }): Promise<RegistroComputador> {
      const [l] = await conn<LinhaAcao[]>`insert into computador_acoes (tenant_id, owner_id, computador_id, turno_id, autor, tipo, estado, argumentos_cifrados)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${e.computadorId}, ${e.turnoId ?? null}, ${e.autor}, ${e.tipo}, ${e.estado}, ${e.argumentosCifrados ?? null}) returning *`;
      return acao(l!);
    },
    /**
     * ADR-081 (S5): quem segura o computador agora — o título do trabalho do turno da ação em execução, ou "a conversa"
     * (turno sem trabalho), ou "a pessoa" (ação dela, sem turno). null = nenhuma ação executando.
     */
    async emUsoPor(id: string): Promise<string | null> {
      const [l] = await conn<{ autor: string; turno_id: string | null; titulo: string | null }[]>`
        select a.autor, a.turno_id, w.titulo from computador_acoes a
        left join turnos t on t.tenant_id = a.tenant_id and t.id = a.turno_id
        left join trabalhos w on w.tenant_id = t.tenant_id and w.id = t.trabalho_id
        where a.tenant_id = ${escopo.tenantId} and a.computador_id = ${id} and a.estado = 'executando'
        order by a.em desc limit 1`;
      if (!l) return null;
      return l.titulo ?? (l.turno_id ? "a conversa" : "a pessoa");
    },
    async buscarAcao(id: string): Promise<(RegistroComputador & { argumentosCifrados: string | null }) | null> {
      const [l] = await conn<LinhaAcao[]>`select * from computador_acoes where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} for update`;
      return l ? { ...acao(l), argumentosCifrados: l.argumentos_cifrados } : null;
    },
    /** 0032: o resultado da ação aprovada, cifrado como os argumentos (ADR-037), até o turno recebê-lo. */
    async gravarResultado(id: string, cifrado: string): Promise<void> {
      await conn`update computador_acoes set resultado_cifrado = ${cifrado} where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
    },
    /** Entrega uma vez: devolve o resultado cifrado e o apaga na mesma transação. */
    async tirarResultado(id: string): Promise<string | null> {
      const [l] = await conn<{ resultado_cifrado: string | null }[]>`select resultado_cifrado from computador_acoes where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} for update`;
      if (!l?.resultado_cifrado) return null;
      await conn`update computador_acoes set resultado_cifrado = null where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return l.resultado_cifrado;
    },
    /** `motivo` só na ação que falhou (CHECK computador_acao_motivo_so_na_falha, 0022). */
    async concluir(id: string, estado: RegistroComputador["estado"], motivo: MotivoFalhaComputador | null = null): Promise<void> {
      await conn`update computador_acoes set estado = ${estado}, motivo = ${estado === "falhou" ? motivo : null}, argumentos_cifrados = null where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
    },
    /**
     * definido em 2026-09-24 (emenda da ADR-037): o observar que DEU CERTO continua fora (a tela é
     * lida a cada 2 s); o que falhou entra — era justamente o que a pessoa não via.
     */
    async atividade(id: string): Promise<RegistroComputador[]> {
      const linhas = await conn<LinhaAcao[]>`select * from computador_acoes where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and computador_id = ${id} and (tipo <> 'observar' or estado = 'falhou') order by em desc limit 30`;
      return linhas.map(acao);
    },
    /**
     * Uma falha da MÁQUINA (só as que contam para a saúde). Na `limite`-ésima seguida o computador sai
     * do ar; `virouIndisponivel` é verdadeiro SÓ nessa transição — é ela que escreve a mensagem única.
     * A trava da linha (travar) é de quem chama; o UPDATE lê o valor anterior no mesmo comando.
     */
    async registrarFalha(id: string, p: { motivo: MotivoFalhaComputador; em: number; limite: number }): Promise<{ computador: Computador; virouIndisponivel: boolean } | null> {
      const [l] = await conn<(Linha & { antes: Date | null })[]>`
        with anterior as (
          select id, indisponivel_desde as antes from computadores
          where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
        ), atualizado as (
          update computadores c set
            falhas_seguidas = c.falhas_seguidas + 1,
            falha_motivo = ${p.motivo},
            indisponivel_desde = coalesce(c.indisponivel_desde, case when c.falhas_seguidas + 1 >= ${p.limite} then ${new Date(p.em)}::timestamptz end)
          from anterior a
          where c.tenant_id = ${escopo.tenantId} and c.owner_id = ${escopo.pessoaId} and c.id = a.id
          returning c.*
        )
        select u.*, g.id as agente_id, a.antes from atualizado u
        join anterior a on a.id = u.id
        join agentes g on g.tenant_id = u.tenant_id and g.computador_id = u.id`;
      return l ? { computador: computador(l), virouIndisponivel: l.antes === null && l.indisponivel_desde !== null } : null;
    },
    /** A máquina respondeu: a sequência de falhas acaba e o computador volta às execuções. */
    async registrarSucesso(id: string): Promise<boolean> {
      const linhas = await conn`update computadores set falhas_seguidas = 0, falha_motivo = null, indisponivel_desde = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and falhas_seguidas > 0 returning id`;
      return linhas.length > 0;
    },
    /** Os computadores fora do ar desta pessoa, por agente (a frota diz sem abrir cada um). */
    async foraDoAr(): Promise<Map<string, { desde: number; motivo: MotivoFalhaComputador }>> {
      const linhas = await conn<{ agente_id: string; indisponivel_desde: Date; falha_motivo: MotivoFalhaComputador }[]>`
        select a.id as agente_id, c.indisponivel_desde, c.falha_motivo from computadores c
        join agentes a on a.tenant_id = c.tenant_id and a.computador_id = c.id
        where c.tenant_id = ${escopo.tenantId} and c.owner_id = ${escopo.pessoaId} and c.indisponivel_desde is not null`;
      return new Map(linhas.map((l) => [l.agente_id, { desde: l.indisponivel_desde.getTime(), motivo: l.falha_motivo }]));
    },
  };
}
