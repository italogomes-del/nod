import type { Computador, ControleComputador, PoliticaComputador, RegistroComputador } from "../contracts/computador.ts";
import type { ComputadorDaPessoa, OperacaoComputador } from "../contracts/computador-motor.ts";
import type { MotivoFalhaComputador } from "../contracts/motivos.ts";
import type { Conn, Escopo } from "../shared/types.ts";

type Linha = { id: string; agente_id: string; habilitado: boolean; controle: ControleComputador; politica: PoliticaComputador; ajuda: string | null; ajuda_decisao_id: string | null; ocupado_ate: Date | null; operacao_id: string | null; criado_em: Date; falhas_seguidas: number; falha_motivo: MotivoFalhaComputador | null; indisponivel_desde: Date | null };
type LinhaAcao = { id: string; computador_id: string; turno_id: string | null; autor: RegistroComputador["autor"]; tipo: string; estado: RegistroComputador["estado"]; motivo: MotivoFalhaComputador | null; argumentos_cifrados: string | null; em: Date };
const computador = (l: Linha): Computador => ({ id: l.id, agenteId: l.agente_id, habilitado: l.habilitado, controle: l.controle, politica: l.politica, ajuda: l.ajuda, ajudaDecisaoId: l.ajuda_decisao_id, ocupadoAte: l.ocupado_ate?.getTime() ?? null, operacaoId: l.operacao_id, criadoEm: l.criado_em.getTime(), falhasSeguidas: l.falhas_seguidas, falhaMotivo: l.falha_motivo, indisponivelDesde: l.indisponivel_desde?.getTime() ?? null });
type LinhaDaPessoa = { id: string; owner_id: string; maquina_id: string | null; hospedeira_id: string | null; supervisor_pub: Buffer | null; operacao: OperacaoComputador | null; operacao_progresso: number | null; operacao_etapa: string | null; operacao_desde: Date | null; falhas_seguidas: number; falha_motivo: MotivoFalhaComputador | null; indisponivel_desde: Date | null; ultima_atividade_em: Date; criado_em: Date };
const daPessoa = (l: LinhaDaPessoa): ComputadorDaPessoa => ({
  id: l.id, ownerId: l.owner_id, maquinaId: l.maquina_id, hospedeiraId: l.hospedeira_id, supervisorPub: l.supervisor_pub ? l.supervisor_pub.toString("base64") : null,
  operacao: l.operacao && l.operacao_desde ? { tipo: l.operacao, progresso: l.operacao_progresso, etapa: l.operacao_etapa, desde: l.operacao_desde.getTime() } : null,
  falhasSeguidas: l.falhas_seguidas, falhaMotivo: l.falha_motivo, indisponivelDesde: l.indisponivel_desde?.getTime() ?? null, ultimaAtividadeEm: l.ultima_atividade_em.getTime(), criadoEm: l.criado_em.getTime(),
});
/** O resultado do primeiro contato do supervisor (TOFU, ADR-122): gravou agora, já era esta, ou é outra (recusar). */
export type DesfechoSupervisor = "gravada" | "igual" | "diferente";
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
          and c.habilitado and c.controle = 'bot' and c.modelo = 'por_bot'
          and (c.ocupado_ate is null or c.ocupado_ate <= ${new Date(agora)})
          and c.ultima_atividade_em < ${new Date(agora - limiteMs)}
        order by c.ultima_atividade_em`;
      return linhas.map(computador);
    },
    /** NOD-96 (0106): no computador da pessoa, `agenteId` diz o bot (ausente = a pessoa) e `telaId` a tela dele. */
    async registrar(e: { computadorId: string; turnoId?: string; autor: RegistroComputador["autor"]; tipo: string; estado: RegistroComputador["estado"]; argumentosCifrados?: string; agenteId?: string; telaId?: string }): Promise<RegistroComputador> {
      const [l] = await conn<LinhaAcao[]>`insert into computador_acoes (tenant_id, owner_id, computador_id, turno_id, autor, tipo, estado, argumentos_cifrados, agente_id, tela_id)
        values (${escopo.tenantId}, ${escopo.pessoaId}, ${e.computadorId}, ${e.turnoId ?? null}, ${e.autor}, ${e.tipo}, ${e.estado}, ${e.argumentosCifrados ?? null}, ${e.agenteId ?? null}, ${e.telaId ?? null}) returning *`;
      return acao(l!);
    },
    /** NOD-96: a Atividade de UM bot no computador da pessoa (índice computador_acoes_por_bot), com a mesma regra do observar. */
    async atividadeDoBot(id: string, agenteId: string): Promise<RegistroComputador[]> {
      const linhas = await conn<LinhaAcao[]>`select * from computador_acoes where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and computador_id = ${id} and agente_id = ${agenteId}
        and (tipo <> 'observar' or estado = 'falhou') order by em desc limit 30`;
      return linhas.map(acao);
    },

    /** NOD-96 PR 4: a Atividade da tela de um bot (as ações dele e as da pessoa nela), com a mesma regra do observar. */
    async atividadeDaTela(id: string, telaId: string): Promise<RegistroComputador[]> {
      const linhas = await conn<LinhaAcao[]>`select * from computador_acoes where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and computador_id = ${id} and tela_id = ${telaId}
        and (tipo <> 'observar' or estado = 'falhou') order by em desc limit 30`;
      return linhas.map(acao);
    },

    // ---- NOD-96 (ADR-122): o computador da pessoa no motor, um por pessoa ('por_pessoa'). Só com NOD_COMPUTADORES=motor.

    /** O computador vivo (não arquivado) desta pessoa no motor; null = ainda não tem. Só lê. */
    async daPessoa(): Promise<ComputadorDaPessoa | null> {
      const [l] = await conn<LinhaDaPessoa[]>`select * from computadores where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
        and modelo = 'por_pessoa' and arquivado_em is null`;
      return l ? daPessoa(l) : null;
    },
    /**
     * O computador da pessoa, criado na primeira vez (índice único computadores_um_por_pessoa: duas chamadas
     * concorrentes dão a mesma linha). `maquinaId` só vale na criação; nulo = "onde o nod roda" (NOD-94).
     */
    async obterDaPessoa(maquinaId: string | null = null): Promise<ComputadorDaPessoa> {
      await conn`insert into computadores (tenant_id, owner_id, modelo, maquina_id) values (${escopo.tenantId}, ${escopo.pessoaId}, 'por_pessoa', ${maquinaId})
        on conflict (tenant_id, owner_id) where arquivado_em is null and modelo = 'por_pessoa' do nothing`;
      const [l] = await conn<LinhaDaPessoa[]>`select * from computadores where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId}
        and modelo = 'por_pessoa' and arquivado_em is null`;
      return daPessoa(l!);
    },
    async travarDaPessoa(id: string): Promise<ComputadorDaPessoa | null> {
      const [l] = await conn<LinhaDaPessoa[]>`select * from computadores where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}
        and modelo = 'por_pessoa' and arquivado_em is null for update`;
      return l ? daPessoa(l) : null;
    },
    /** O bot passa a usar o computador da pessoa (vários bots no mesmo: o UNIQUE caiu na 0106). Falso = bot que não é dela. */
    async vincularBot(id: string, agenteId: string): Promise<boolean> {
      const linhas = await conn`update agentes a set computador_id = c.id from computadores c
        where a.tenant_id = ${escopo.tenantId} and a.owner_id = ${escopo.pessoaId} and a.id = ${agenteId} and a.excluido_em is null
          and c.tenant_id = a.tenant_id and c.owner_id = ${escopo.pessoaId} and c.id = ${id} and c.modelo = 'por_pessoa' and c.arquivado_em is null
        returning a.id`;
      return linhas.length > 0;
    },
    /** A máquina em que o computador roda (NOD-94; nula = "onde o nod roda") e a hospedeira escolhida para ele. */
    async fixarMaquina(id: string, m: { maquinaId: string | null; hospedeiraId?: string | null }): Promise<void> {
      await conn`update computadores set maquina_id = ${m.maquinaId},
        hospedeira_id = case when ${m.hospedeiraId !== undefined} then ${m.hospedeiraId ?? null}::uuid else hospedeira_id end
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and modelo = 'por_pessoa'`;
    },
    /**
     * TOFU (ADR-122): a primeira chave X25519 que o supervisor mostra fica; outra depois disso é recusada até o
     * Redefinir esquecê-la. Comparação no banco, na mesma linha: duas chaves concorrentes, só uma grava.
     */
    async fixarSupervisor(id: string, pub: Uint8Array): Promise<DesfechoSupervisor | null> {
      const chave = Buffer.from(pub);
      const gravou = await conn`update computadores set supervisor_pub = ${chave}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and modelo = 'por_pessoa' and supervisor_pub is null returning id`;
      if (gravou.length > 0) return "gravada";
      const [l] = await conn<{ igual: boolean }[]>`select supervisor_pub = ${chave} as igual from computadores
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and modelo = 'por_pessoa'`;
      if (!l) return null;
      return l.igual ? "igual" : "diferente";
    },
    /** O Redefinir apaga o computador na máquina: o próximo supervisor mostra chave nova e ela é aceita (TOFU de novo). */
    async esquecerSupervisor(id: string): Promise<void> {
      await conn`update computadores set supervisor_pub = null where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and modelo = 'por_pessoa'`;
    },
    /**
     * NOD-96 PR 5: o Redefinir trocou a X25519 do supervisor. A chave nova veio na resposta do comando `redefinir`, que
     * foi assinado com a chave do servidor; por isso só vale com o Redefinir em curso (nunca por uma foto qualquer).
     */
    async trocarSupervisor(id: string, pub: Uint8Array): Promise<boolean> {
      const linhas = await conn`update computadores set supervisor_pub = ${Buffer.from(pub)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and modelo = 'por_pessoa' and operacao = 'redefinir' returning id`;
      return linhas.length > 0;
    },
    /**
     * NOD-96 PR 5: a pessoa tinha computadores por bot (modo antigo, arquivados pelo `computador:legado`) e ainda não
     * dispensou o "Entre nos sites de novo uma vez" (registro 'aviso_recriado' no computador dela).
     */
    async avisoRecriado(id: string): Promise<boolean> {
      const [l] = await conn<{ mostrar: boolean }[]>`select
          exists (select 1 from computadores where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and modelo = 'por_bot' and arquivado_em is not null)
          and not exists (select 1 from computador_acoes where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and computador_id = ${id} and tipo = 'aviso_recriado')
          as mostrar`;
      return l?.mostrar === true;
    },
    /** Começa Atualizar, Redefinir ou Sair de todos. Falso = já há uma operação em curso (uma de cada vez). */
    async iniciarOperacao(id: string, tipo: OperacaoComputador, em: number): Promise<boolean> {
      const linhas = await conn`update computadores set operacao = ${tipo}, operacao_desde = ${new Date(em)}, operacao_progresso = 0, operacao_etapa = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and modelo = 'por_pessoa' and operacao is null returning id`;
      return linhas.length > 0;
    },
    /** O progresso que o supervisor relatou; só vale para a operação em curso. `pct` fica entre 0 e 100. */
    async progredirOperacao(id: string, tipo: OperacaoComputador, p: { pct: number; etapa: string | null }): Promise<boolean> {
      const pct = Math.max(0, Math.min(100, Math.round(p.pct)));
      const etapa = p.etapa === null ? null : p.etapa.slice(0, 80);
      const linhas = await conn`update computadores set operacao_progresso = ${pct}, operacao_etapa = ${etapa}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and operacao = ${tipo} returning id`;
      return linhas.length > 0;
    },
    async terminarOperacao(id: string, tipo: OperacaoComputador): Promise<boolean> {
      const linhas = await conn`update computadores set operacao = null, operacao_desde = null, operacao_progresso = null, operacao_etapa = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and operacao = ${tipo} returning id`;
      return linhas.length > 0;
    },
    /**
     * ADR-122: ao passar ao motor, os computadores por bot (docker) da pessoa são arquivados — o do motor nasce do zero,
     * sem migrar perfil. Os bots deixam de apontar para eles. Devolve os ids arquivados (para o driver docker apagar).
     */
    async arquivarLegado(em: number): Promise<string[]> {
      const linhas = await conn<{ id: string }[]>`update computadores set arquivado_em = ${new Date(em)}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and modelo = 'por_bot' and arquivado_em is null returning id`;
      const ids = linhas.map((l) => l.id);
      if (ids.length > 0) await conn`update agentes set computador_id = null where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and computador_id = any(${ids}::uuid[])`;
      return ids;
    },
    /** NOD-96 PR 5 (`npm run computador:legado`): os computadores por bot já arquivados, com a data do arquivamento. */
    async legadosArquivados(): Promise<{ id: string; arquivadoEm: number }[]> {
      const linhas = await conn<{ id: string; arquivado_em: Date }[]>`select id, arquivado_em from computadores
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and modelo = 'por_bot' and arquivado_em is not null order by arquivado_em`;
      return linhas.map((l) => ({ id: l.id, arquivadoEm: l.arquivado_em.getTime() }));
    },
    /**
     * ADR-083 (S5): quem segura o computador agora — o título do trabalho do turno da ação em execução, ou "a conversa"
     * (turno sem trabalho), ou "a pessoa" (ação dela, sem turno). null = nenhuma ação executando.
     */
    /**
     * Quem segura o computador agora. revisto em 2026-10-08 (revisão do épico, S24): `deFora` quando o título é de uma
     * task de colega ou de uma que leu conteúdo de fora — quem repassa o título ao modelo o marca não confiável.
     */
    async emUsoPor(id: string, telaId?: string): Promise<{ titulo: string; deFora: boolean } | null> {
      const [l] = await conn<{ autor: string; turno_id: string | null; titulo: string | null; de_fora: boolean | null }[]>`
        select a.autor, a.turno_id, w.titulo,
          (w.origem = 'colega' or exists (select 1 from turnos x where x.tenant_id = w.tenant_id and x.trabalho_id = w.id
            and (x.contaminado_em is not null or x.entrada_confianca <> 'confiavel'))) as de_fora
        from computador_acoes a
        left join turnos t on t.tenant_id = a.tenant_id and t.id = a.turno_id
        left join trabalhos w on w.tenant_id = t.tenant_id and w.id = t.trabalho_id
        where a.tenant_id = ${escopo.tenantId} and a.computador_id = ${id} and a.estado = 'executando'
          and (${telaId ?? null}::uuid is null or a.tela_id = ${telaId ?? null}::uuid)
        order by a.em desc limit 1`;
      if (!l) return null;
      return l.titulo ? { titulo: l.titulo, deFora: l.de_fora === true } : { titulo: l.turno_id ? "a conversa" : "a pessoa", deFora: false };
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
     * NOD-96 PR 5: a atividade do computador da pessoa para o painel, com o bot (o da ação ou o dono da tela) e sem os
     * observar que deram certo. Mais nova primeiro.
     */
    async atividadeDaPessoa(id: string, limite = 8): Promise<{ agenteId: string | null; autor: RegistroComputador["autor"]; tipo: string; estado: RegistroComputador["estado"]; em: number }[]> {
      const linhas = await conn<{ agente_id: string | null; autor: RegistroComputador["autor"]; tipo: string; estado: RegistroComputador["estado"]; em: Date }[]>`
        select coalesce(a.agente_id, t.agente_id) as agente_id, a.autor, a.tipo, a.estado, a.em from computador_acoes a
        left join computador_telas t on t.id = a.tela_id
        where a.tenant_id = ${escopo.tenantId} and a.owner_id = ${escopo.pessoaId} and a.computador_id = ${id}
          and (a.tipo <> 'observar' or a.estado = 'falhou') and a.tipo <> 'aviso_recriado' and a.estado <> 'pendente'
        order by a.em desc limit ${limite}`;
      return linhas.map((l) => ({ agenteId: l.autor === "bot" ? l.agente_id : null, autor: l.autor, tipo: l.tipo, estado: l.estado, em: l.em.getTime() }));
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
