import type { MotivoRenovacaoNegada } from "../contracts/ponte.ts";
import { HARNESS_LEGADO, type PreferenciaHarness } from "../contracts/harness.ts";
import type { TurnoPendenteDto } from "../contracts/api.ts";
import type { Executor } from "../contracts/evento.ts";
import type { Confianca } from "../contracts/mensagem.ts";
import type { MotivoFalha, MotivoInterrupcao, MotivoLocalidade, MotivoSemNovidade } from "../contracts/motivos.ts";
import type { EstadoTurno, OrigemTurno, Profundidade, SinaisTurno, Turno } from "../contracts/turno.ts";
import { ENTRADA_DA_VOLTA_DA_COTA, type PortaoDaCota } from "../domain/cota-da-ia.ts";
import { modelosPorIa } from "../domain/ia-do-modelo.ts";
import { ESPERA_MAXIMA_FUNDO_MS } from "../domain/memoria-mac.ts";
import { paraProfundidade } from "../domain/profundidade.ts";
import type { FatosTurnoOrfao } from "../domain/turno-orfao.ts";
import type { VoltaDaCadeia } from "../domain/voltas-sem-novidade.ts";
import { abrirTxEscopada } from "../db/tx.ts";
import { LEASE_MS } from "../shared/constantes.ts";
import type { Conn, Escopo } from "../shared/types.ts";
import { alvoDoTurno } from "./alvo-da-maquina.ts";
import { data, dataOuNull, ms, msOuNull } from "./conversao.ts";

interface Linha {
  tenant_id: string;
  id: string;
  owner_id: string;
  conversa_id: string;
  agente_id: string;
  origem: OrigemTurno;
  estado: EstadoTurno;
  attempted: boolean;
  rejected: boolean;
  prompt_submitted: boolean;
  produced_output: boolean;
  machine_id: string | null;
  lease_ate: Date | null;
  prazo_em: Date;
  motivo_interrupcao: MotivoInterrupcao | null;
  motivo_falha: MotivoFalha | null;
  sem_novidade_motivo: MotivoSemNovidade | null;
  retoma_turno_id: string | null;
  profundidade: number;
  reenvios: number;
  parar_solicitado_em: Date | null;
  entrada_texto: string;
  entrada_anexos: string[];
  entrada_confianca: Confianca;
  custo_usd: string | null;
  modelo: string;
  harness?: PreferenciaHarness;
  executor: Executor;
  criado_em: Date;
  mensagem_origem_id: string | null;
  absorvido_por: string | null;
  sob_procuracao_de: string | null;
  ligacao_id: string | null;
  trabalho_id: string | null;
  acordar_em: Date | null;
}

const COLUNAS =
  "tenant_id, id, owner_id, conversa_id, agente_id, origem, estado, attempted, rejected, prompt_submitted, produced_output, machine_id, lease_ate, prazo_em, motivo_interrupcao, motivo_falha, sem_novidade_motivo, retoma_turno_id, profundidade, reenvios, parar_solicitado_em, entrada_texto, entrada_anexos, entrada_confianca, custo_usd, modelo, harness, executor, criado_em, mensagem_origem_id, absorvido_por, sob_procuracao_de, ligacao_id, trabalho_id, acordar_em";

function paraTurno(l: Linha): Turno {
  return {
    tenantId: l.tenant_id,
    id: l.id,
    conversaId: l.conversa_id,
    agenteId: l.agente_id,
    ownerId: l.owner_id,
    origem: l.origem,
    estado: l.estado,
    sinais: { attempted: l.attempted, rejected: l.rejected, promptSubmitted: l.prompt_submitted, producedOutput: l.produced_output },
    machineId: l.machine_id,
    leaseAte: msOuNull(l.lease_ate),
    prazoEm: ms(l.prazo_em),
    motivoInterrupcao: l.motivo_interrupcao,
    motivoFalha: l.motivo_falha,
    semNovidadeMotivo: l.sem_novidade_motivo,
    retomaTurnoId: l.retoma_turno_id,
    profundidade: paraProfundidade(l.profundidade),
    reenvios: l.reenvios,
    pararSolicitadoEm: msOuNull(l.parar_solicitado_em),
    entradaTexto: l.entrada_texto,
    entradaAnexos: l.entrada_anexos ?? [],
    entradaConfianca: l.entrada_confianca,
    custoUsd: l.custo_usd === null ? null : Number(l.custo_usd),
    modelo: l.modelo,
    harness: l.harness ?? "auto",
    executor: l.executor,
    criadoEm: ms(l.criado_em),
    mensagemOrigemId: l.mensagem_origem_id,
    absorvidoPor: l.absorvido_por,
    sobProcuracaoDe: l.sob_procuracao_de,
    ligacaoId: l.ligacao_id,
    trabalhoId: l.trabalho_id,
    acordarEm: msOuNull(l.acordar_em),
  };
}

/** NOD-219: um pendente que o varredor de órfãos olha, com os fatos de domain/turno-orfao.ts. */
export type OrfaoCandidato = FatosTurnoOrfao & {
  id: string;
  conversaId: string;
  agenteId: string;
  trabalhoId: string | null;
};

export type NovoTurno = {
  id?: string;
  conversaId: string;
  agenteId: string;
  origem: OrigemTurno;
  prazoEm: number;
  profundidade: Profundidade;
  entradaTexto: string;
  /** Fala da pessoa que disparou o turno; a web põe "Na fila" e Cancelar embaixo dela. */
  mensagemOrigemId?: string | null;
  /** Pessoa que pediu o trabalho (ADR-047): só o turno de delegação e as retomadas dele. */
  sobProcuracaoDe?: string | null;
  /** ADR-046: anexos da mensagem que abriu o turno; o plano leva os metadados. */
  entradaAnexos?: readonly string[];
  entradaConfianca: Confianca;
  modelo: string;
  harness?: PreferenciaHarness;
  retomaTurnoId?: string | null;
  reenvios?: number;
  /**
   * NOD-206: obrigatório — sem padrão silencioso. É o melhor palpite de quem enfileira; o plano grava o executor real
   * (`registrarExecutor`), porque é lá que ele é decidido.
   */
  executor: Executor;
  localityReason?: MotivoLocalidade;
  decididoPor?: string;
  /** Turno que já nasce interrompido (executor indisponível, E9.3): nunca entra na fila. */
  interrompidoCom?: MotivoInterrupcao;
  /** definido em 2026-10-04 (ADR-072): o turno-cérebro da ligação e os turnos de trabalho pedidos durante ela. */
  ligacaoId?: string | null;
  /**
   * definido em 2026-10-07 (ADR-083): o trabalho do turno. Ausente numa retomada = o do turno que ela continua (a
   * retomada nunca sai do trabalho, como nunca sai do salto); null explícito = turno da conversa.
   */
  trabalhoId?: string | null;
  /** ADR-086: "me chame às 16:00" — a fila só entrega este turno a partir daqui. Ausente/null = na hora. */
  acordarEm?: number | null;
};

export type Assentamento = {
  estado: "concluido" | "interrompido";
  motivoInterrupcao?: MotivoInterrupcao | null;
  motivoFalha?: MotivoFalha | null;
  sinais?: Partial<SinaisTurno>;
  custoUsd?: number | null;
  tokensEntrada?: number;
  tokensSaida?: number;
  /** 0035: a sessão do CLI e o total que ele informou para ela — custoUsd é a diferença (custo-turno.ts). */
  sessaoCli?: string | null;
  custoSessaoUsd?: number | null;
  /**
   * NOD-241 (0076, emenda da ADR-084): o último sinal de vida do turno que caiu — a régua da retomada automática. Só
   * no interrompido; gravado uma vez (o primeiro valor vence: não sobrescreve o que o varredor já gravou).
   */
  ultimoSinalEm?: number;
};

/**
 * Fila de turnos no Postgres (ADR-010 revisado). O ÚNICO lugar que escreve estado 'pendente' é o
 * INSERT de `enfileirar` (DEFAULT da coluna): tests/conformidade/sem-requeue.test.ts varre src/
 * por UPDATE que volte a 'pendente'. Retomar é turno NOVO com retoma_turno_id (ADR-009).
 */
export function turnosRepo(conn: Conn, escopo: Escopo) {
  return {
    async enfileirar(t: NovoTurno): Promise<Turno | null> {
      const estado: EstadoTurno = t.interrompidoCom ? "interrompido" : "pendente";
      const [l] = await conn<Linha[]>`
        insert into turnos (tenant_id, id, owner_id, conversa_id, agente_id, origem, estado, motivo_interrupcao, prazo_em, profundidade,
          entrada_texto, entrada_anexos, entrada_confianca, modelo, harness, retoma_turno_id, reenvios, executor, locality_reason, decidido_por, mensagem_origem_id, sob_procuracao_de, ligacao_id, trabalho_id, acordar_em)
        values (${escopo.tenantId}, ${t.id ?? conn`gen_random_uuid()`}, ${escopo.pessoaId}, ${t.conversaId}, ${t.agenteId}, ${t.origem}, ${estado},
          ${t.interrompidoCom ?? null}, ${data(t.prazoEm)}, ${t.profundidade}, ${t.entradaTexto}, ${(t.entradaAnexos ?? []) as string[]}::uuid[], ${t.entradaConfianca}, ${t.modelo}, ${t.harness ?? "auto"},
          ${t.retomaTurnoId ?? null}, ${t.reenvios ?? 0}, ${t.executor}, ${t.localityReason ?? "tudo_local_nesta_rodada"},
          ${t.decididoPor ?? "regra:localidade"}, ${t.mensagemOrigemId ?? null}, ${t.sobProcuracaoDe ?? null}, ${t.ligacaoId ?? null},
          ${t.trabalhoId !== undefined ? t.trabalhoId : t.retomaTurnoId ? conn`(select r.trabalho_id from turnos r where r.tenant_id = ${escopo.tenantId} and r.id = ${t.retomaTurnoId})` : null},
          ${dataOuNull(t.acordarEm)})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTurno(l) : null;
    },

    /** O turno disparado por esta fala da pessoa (NOD-156: o reenvio idempotente devolve o mesmo turno). */
    async buscarPorMensagemOrigem(mensagemId: string): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos where tenant_id = ${escopo.tenantId} and mensagem_origem_id = ${mensagemId}
        order by criado_em, id limit 1`;
      return l ? paraTurno(l) : null;
    },

    async buscar(id: string): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from turnos where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l ? paraTurno(l) : null;
    },

    /**
     * Leitura com trava de linha (FOR UPDATE) para quem vai ASSENTAR o turno. medido em 2026-09-16 (e2e da L9):
     * Parar e a entrega do laço correm em transações paralelas — a entrega lia `parar_solicitado_em` NULL
     * (leitura sem trava, READ COMMITTED) e só esperava o commit de Parar no UPDATE seguinte, assentando
     * 'sem_progresso' em vez de 'parado_pela_pessoa'. Com a trava, a leitura espera o commit e vê o pedido.
     */
    async buscarTravado(id: string): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`select ${conn.unsafe(COLUNAS)} from turnos where tenant_id = ${escopo.tenantId} and id = ${id} for update`;
      return l ? paraTurno(l) : null;
    },

    /**
     * Reivindicação por UPDATE condicional + FOR UPDATE SKIP LOCKED numa tx curta (ADR-010).
     * EMENDA 12: turno de conversa/sala/retomada passa na frente de rotina enfileirada.
     * ADR-099 (I6): e, antes de todos eles (menos a ligação), a fala da pessoa na conversa direta — ver o `order by`.
     * EMENDA 13 (agente serial) revista em 2026-10-07 pela ADR-083: a serialização é por FAIXA — a conversa (turno sem
     * trabalho) ou o trabalho —, não mais por agente. O mesmo bot roda a conversa e vários trabalhos ao mesmo tempo.
     *
     * medido em 2026-09-16 (tests/concurrency/serializacao-por-conversa.test.ts, duas conexões
     * reivindicando ao mesmo tempo): só NOT EXISTS + SKIP LOCKED SOBREPÔS — a segunda conexão pulou
     * a linha travada e levou o OUTRO turno da mesma conversa, porque o 'despachando' da primeira
     * ainda não estava commitado (READ COMMITTED). Entrou o fallback anotado no plano: um
     * pg_advisory_xact_lock por (tenant, pessoa) serializa as reivindicações da MESMA pessoa (fila
     * por pessoa, ADR-007); a segunda espera o commit da primeira e então enxerga o 'despachando'.
     * Pessoas diferentes não se bloqueiam. Chamado sobre um pool, abre a própria tx curta.
     *
     * NOD-171: com `harnessesProntosPessoa` (os prontos de todas as máquinas vivas da pessoa), pega também o turno
     * fixado num harness que não está pronto em NENHUMA delas; o despacho o recusa nomeando o harness. Sem isso ele
     * ficava pendente sem aviso no app do Mac. O fixado que outra máquina tem pronto continua esperando por ela.
     * 0068: `harnessesAuto` (ausente = os prontos) são as IAs desta máquina que valem para o turno do Automático — sem a
     * que está no limite enquanto a pessoa tiver outra fora dele (iasParaOAutomatico).
     */
    async reivindicar(p: { machineId: string; agora: number; harnessesProntos?: readonly string[]; harnessesAuto?: readonly string[]; harnessesProntosPessoa?: readonly string[]; aceitaLigacao?: boolean; segurarFundo?: boolean; espacarFundo?: boolean; segurarNovo?: boolean; fundoSemPrazo?: boolean; soComoAlvo?: boolean; cota?: PortaoDaCota | null }): Promise<Turno | null> {
      const dentro = async (trx: Conn): Promise<Turno | null> => {
        await trx`select pg_advisory_xact_lock(hashtext(${`${escopo.tenantId}:${escopo.pessoaId}`}))`;
        // ADR-090: a máquina-alvo do turno `t` (alvo-da-maquina.ts; a lista de trabalhos usa a mesma regra).
        const alvo = alvoDoTurno(trx, p.agora);
        // definido em 2026-10-12 (ADR-099 §7): o portão da cota. A IA do turno: a fixada, ou (Automático) a regra das IAs que
        // podem pegá-lo, decidida antes (portaoDaCota). Mesma regra de `tipoParaCota` e `cotaSegura` (domain/cota-da-ia.ts).
        const cota = p.cota ?? null;
        // NOD-213: a IA do turno `auto` com modelo escolhido é a dona do modelo (iaDoModelo, pelos `modelosPorIa`), não o legado.
        const porIa = modelosPorIa();
        const iaDoTurno = trx`(case when t.harness <> 'auto' then t.harness else coalesce((select x.ia from unnest(${porIa.modelos}::text[], ${porIa.ias}::text[]) as x(modelo, ia) where x.modelo = t.modelo), ${HARNESS_LEGADO}) end)`;
        const naCota = (ias: readonly string[], auto: boolean) => trx`(case when t.harness = 'auto' and t.modelo = 'auto' then ${auto}::boolean else ${iaDoTurno} = any(${[...ias]}::text[]) end)`;
        const [l] = await trx<Linha[]>`
          update turnos set estado = 'despachando', machine_id = ${p.machineId}, lease_ate = ${data(p.agora + LEASE_MS)}, attempted = true
          where (tenant_id, id) = (
            select t.tenant_id, t.id from turnos t
            where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.estado = 'pendente'
              -- ADR-086: a retomada marcada para mais tarde ("me chame às 16:00") só sai a partir da hora.
              and (t.acordar_em is null or t.acordar_em <= ${data(p.agora)})
              -- ADR-090 (revisão do PR): a máquina que é o alvo do turno o pega mesmo sem a IA pronta; o despacho recusa nomeando a
              -- IA (NOD-171), em vez de o turno esperar em silêncio uma máquina que nunca vai pegá-lo.
              ${p.harnessesProntos === undefined ? trx`` : trx`and (${alvo} = ${p.machineId} or (t.harness = 'auto' and t.modelo = 'auto' and ${(p.harnessesAuto ?? p.harnessesProntos).length > 0}) or (not (t.harness = 'auto' and t.modelo = 'auto') and ${iaDoTurno} = any(${[...p.harnessesProntos]}::text[]))
                ${p.harnessesProntosPessoa === undefined ? trx`` : trx`or (not (t.harness = 'auto' and t.modelo = 'auto') and ${iaDoTurno} <> all(${[...p.harnessesProntosPessoa]}::text[]))`})`}
              and exists (select 1 from agentes a where a.tenant_id = t.tenant_id and a.id = t.agente_id and a.excluido_em is null and a.geracao_execucao = t.geracao_execucao)
              -- definido em 2026-10-09 (ADR-090): onde o bot trabalha (o alvo, abaixo). O turno só sai para o alvo; sem alvo, para
              -- qualquer máquina.
              -- A ligação não espera a máquina do bot: a pessoa está na linha, e o cérebro roda em qualquer máquina com voz.
              and (t.origem = 'ligacao' or coalesce(${alvo}, ${p.machineId}) = ${p.machineId})
              -- ADR-092: com o servidor no Mac (modo local), a máquina conectada pela ponte só pega o turno que tem ELA como alvo
              -- (o bot escolhido para ela, ou o padrão da pessoa): sem alvo, o turno é do Mac, onde estão os arquivos dos bots.
              ${p.soComoAlvo === true ? trx`and ${alvo} = ${p.machineId}` : trx``}
              -- definido em 2026-10-04 (ADR-072): o turno da ligação não serializa com o trabalho do bot, nos dois
              -- sentidos — a conversa por voz segue enquanto o bot trabalha, e o trabalho segue durante a ligação. Só
              -- vai para a máquina que anunciou o laço de voz, e passa na frente da fila (a pessoa está esperando).
              and ((t.origem = 'ligacao' and ${p.aceitaLigacao === true})
                or (t.origem <> 'ligacao' and t.trabalho_id is null
                  -- revisto em 2026-10-07 (ADR-083 §3): a faixa é coalesce(trabalho_id, conversa_id). O turno da conversa
                  -- espera só outro turno da MESMA conversa sem trabalho. De propósito: o mesmo bot responde ao mesmo
                  -- tempo na conversa direta e numa sala (conversas diferentes), e o trabalho dele não segura a conversa.
                  and not exists (select 1 from turnos d where d.tenant_id = t.tenant_id and d.conversa_id = t.conversa_id and d.trabalho_id is null and d.estado = 'despachando' and d.origem <> 'ligacao'))
                or (t.origem <> 'ligacao' and t.trabalho_id is not null
                  -- O turno de um trabalho espera só outro turno do MESMO trabalho e o trabalho de que ele depende
                  -- ("Fazer depois da …"), até ele terminar, parar ou falhar.
                  and not exists (select 1 from turnos d where d.tenant_id = t.tenant_id and d.trabalho_id = t.trabalho_id and d.estado = 'despachando')
                  -- definido em 2026-10-08 (ADR-085): com o Mac apertado (pelo "uso do Mac" da pessoa), trabalho NOVO em
                  -- segundo plano — rotina ou pedido de colega que ainda não começou — espera. O que já começou segue,
                  -- e o que a pessoa espera também (a task que ela abriu, "Executar agora", o pedido feito na conversa).
                  -- Revisão do #209: a espera vai até ESPERA_MAXIMA_FUNDO_MS; e, logo depois de um trabalho novo em
                  -- segundo plano começar neste Mac (espacarFundo), o próximo espera, mesmo o que passou da espera máxima.
                  -- Mesma regra de seguravelPeloMac (domain/memoria-mac.ts).
                  ${p.espacarFundo !== true && p.segurarFundo !== true ? trx`` : trx`and not exists (select 1 from trabalhos w where w.tenant_id = t.tenant_id and w.id = t.trabalho_id
                    and w.iniciado_em is null and w.origem in ('rotina', 'colega') and not w.pessoa_esperando
                    ${p.espacarFundo === true || p.fundoSemPrazo === true ? trx`` : trx`and w.criado_em > ${data(p.agora - ESPERA_MAXIMA_FUNDO_MS)}`})`}
                  -- revisto em 2026-10-09 (revisão do #224, decisão do coordenador do #221): a volta marcada ("me chame às
                  -- 16:00", ADR-086) é o próximo passo de uma task já começada — o segundo plano apertado e o espaço entre
                  -- dois começos não a seguram mais (era a revisão do #212); só o disco crítico (segurarNovo, abaixo).
                  -- definido em 2026-10-09 (#219, emenda à ADR-085): com a memória crítica (fundoSemPrazo) o segundo plano
                  -- novo espera mesmo passado da espera máxima (a volta marcada, não: acima). Com o disco crítico (segurarNovo) NENHUM trabalho novo começa, de
                  -- qualquer origem, mesmo com a pessoa esperando, nem a volta marcada. O que já começou segue (o turno
                  -- seguinte de uma task em andamento não espera). Mesma regra de esperaDoMac (domain/memoria-mac.ts).
                  ${p.segurarNovo !== true ? trx`` : trx`and t.acordar_em is null and not exists (select 1 from trabalhos w where w.tenant_id = t.tenant_id and w.id = t.trabalho_id and w.iniciado_em is null)`}
                  and not exists (select 1 from trabalhos x join trabalhos dep on dep.tenant_id = x.tenant_id and dep.id = x.depois_de_trabalho_id
                    where x.tenant_id = t.tenant_id and x.id = t.trabalho_id and dep.estado not in ('terminado', 'parado', 'falhou'))))
              -- definido em 2026-10-12 (ADR-099 §7, decisão do Marlon): a cota da IA. Com a IA do turno na reserva (99% de uma
              -- janela), trabalho NOVO de fundo — task que nunca rodou, de qualquer origem, e rotina ou pedido de colega sem
              -- task — espera: o 1% fica para a conversa com a pessoa. Com a IA no limite, TODO o fundo espera (o que já
              -- começou e a volta marcada também), até a janela renovar, em vez de falhar. A conversa com a pessoa (conversa,
              -- sala, a retomada que ela pediu) e a ligação nunca esperam pela cota.
              ${cota === null ? trx`` : trx`and not (t.origem <> 'ligacao' and (
                (((t.trabalho_id is null and t.origem in ('rotina', 'delegacao', 'peer'))
                    or exists (select 1 from trabalhos w where w.tenant_id = t.tenant_id and w.id = t.trabalho_id and w.iniciado_em is null))
                  and ${naCota(cota.reserva, cota.autoReserva)})
                or ((t.trabalho_id is not null or t.origem in ('rotina', 'delegacao', 'peer') or t.acordar_em is not null)
                  and ${naCota(cota.limite, cota.autoLimite)})))`}
            -- Ligação primeiro; depois a fala da pessoa; depois o que não é rotina nem pedido de colega (o turno ou o trabalho
            -- dele); depois a ordem.
            order by (t.origem = 'ligacao') desc,
              -- A pessoa passa na frente na fila do dono: o turno de conversa que nasceu de uma fala dela (origem 'conversa'
              -- com mensagem_origem_id, o mesmo marcador de absorverPendentes) sai antes da volta marcada (me_chame_as), do
              -- despertar de uma espera, da continuação de colega e de qualquer retorno ao dono. Só fura a fila dos
              -- pendentes: a conversa com turno despachando continua esperando (o not exists acima). Sala, ligação e a
              -- faixa do trabalho não mudam. Entre duas falas dela, vale a ordem de chegada (criado_em, abaixo).
              -- definido em 2026-10-12 (ADR-099, I6)
              (t.trabalho_id is null and t.origem = 'conversa' and t.mensagem_origem_id is not null) desc,
              (t.origem in ('rotina', 'delegacao', 'peer') or (t.trabalho_id is not null and exists (select 1 from trabalhos x where x.tenant_id = t.tenant_id and x.id = t.trabalho_id and x.origem in ('rotina', 'colega')))) asc,
              t.criado_em asc, t.id asc
            for update skip locked limit 1)
          returning ${trx.unsafe(COLUNAS)}`;
        return l ? paraTurno(l) : null;
      };
      // Pool (tem `begin`): a trava só vale dentro de uma transação — abre uma curta. Tx: usa a corrente.
      // definido em 2026-10-15 (NOD-266): a curta é a escopada (prazo de conexão, timeouts, escopo da RLS). Antes era um
      // `conn.begin` cru — sem prazo, pendurava com o pool cheio, e sem escopo a RLS a fazia achar nada.
      if ("begin" in conn && typeof conn.begin === "function") return abrirTxEscopada(conn, escopo)(dentro);
      return dentro(conn);
    },

    /**
     * Batida de 30s (ADR-009/021): os quatro sinais viajam a cada renovação; {ativo:false} quando
     * a pessoa pediu Parar ou o turno já não é desta máquina — o executor aborta.
     */
    /**
     * revisto em 2026-10-12 (NOD-214): `sessaoCli` (a sessão do CLI que a máquina mandou na renovação) é gravada já aqui,
     * não só na entrega — se a entrega se perder num reinício, o assentamento pelo lease ainda a propaga. `aceitaVencido`
     * só na adoção dentro da carência do boot: o lease venceu enquanto o servidor estava fora, mas o turno segue
     * `despachando` (o varredor não o assentou).
     */
    async renovarLease(id: string, machineId: string, sinais: Partial<SinaisTurno>, agora: number, o: { sessaoCli?: string | null; aceitaVencido?: boolean } = {}): Promise<{ ativo: boolean; motivo?: Exclude<MotivoRenovacaoNegada, "sem_plano"> }> {
      const [l] = await conn<{ ativo: boolean; parado: boolean }[]>`
        update turnos set
          lease_ate = case when estado = 'despachando' and parar_solicitado_em is null and exists (select 1 from agentes a where a.tenant_id = turnos.tenant_id and a.id = turnos.agente_id and a.excluido_em is null and a.geracao_execucao = turnos.geracao_execucao) then ${data(agora + LEASE_MS)} else lease_ate end,
          attempted = attempted or ${sinais.attempted ?? false},
          rejected = rejected or ${sinais.rejected ?? false},
          prompt_submitted = prompt_submitted or ${sinais.promptSubmitted ?? false},
          produced_output = produced_output or ${sinais.producedOutput ?? false},
          sessao_cli = coalesce(${o.sessaoCli ?? null}, sessao_cli)
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and machine_id = ${machineId}
          and (lease_ate > ${data(agora)} or (${o.aceitaVencido === true} and estado = 'despachando'))
        returning (estado = 'despachando' and parar_solicitado_em is null and exists (select 1 from agentes a where a.tenant_id = turnos.tenant_id and a.id = turnos.agente_id and a.excluido_em is null and a.geracao_execucao = turnos.geracao_execucao)) as ativo,
          (estado <> 'despachando' or parar_solicitado_em is not null) as parado`;
      // NOD-264 (C20): por que negou, em código (vira a causa do turno_interrompido).
      if (!l) return { ativo: false, motivo: "lease_vencido" };
      if (l.ativo) return { ativo: true };
      return { ativo: false, motivo: l.parado ? "parado" : "agente_excluido" };
    },

    /** Write-ahead (ADR-009): promptSubmitted é gravado ANTES de escrever no stdin. Só liga, nunca desliga. */
    async marcarSinal(id: string, sinal: keyof SinaisTurno): Promise<boolean> {
      const coluna = { attempted: "attempted", rejected: "rejected", promptSubmitted: "prompt_submitted", producedOutput: "produced_output" }[sinal];
      const r = await conn`update turnos set ${conn(coluna)} = true where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },

    /**
     * A ferramenta `sem_novidade` pediu silêncio (definido em 2026-09-21). Só liga, nunca desliga —
     * como marcarSinal: o agente pode chamar duas vezes, e a primeira decisão prevalece. O
     * assentamento lê isso em buscarTravado, na mesma tx.
     */
    async marcarSemNovidade(id: string, motivo: MotivoSemNovidade): Promise<boolean> {
      const r = await conn`
        update turnos set sem_novidade_motivo = coalesce(sem_novidade_motivo, ${motivo})
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },

    /**
     * definido em 2026-09-28 (0032): serializa quem cria retomada de um MESMO turno — decisões decididas em
     * sequência e o assentamento dele. Sem a trava, duas aprovações seguidas viravam duas retomadas.
     */
    async travarRetomadas(retomaTurnoId: string): Promise<void> {
      await conn`select pg_advisory_xact_lock(hashtext(${escopo.tenantId}), hashtext(${`retomada:${retomaTurnoId}`}))`;
    },

    /** A retomada deste turno que ainda não foi reivindicada: a próxima continuação se junta a ela. */
    async retomadaNaFila(retomaTurnoId: string): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and retoma_turno_id = ${retomaTurnoId} and origem = 'retomada' and estado = 'pendente'
          -- ADR-086 (revisão do #212): a volta marcada não recebe a continuação — uma aprovação colada nela esperaria a hora.
          and (acordar_em is null or acordar_em <= now())
        order by criado_em desc limit 1`;
      return l ? paraTurno(l) : null;
    },

    /**
     * ADR-086 (revisão do #212): `me_chame_as` só anota o pedido no turno que está rodando — a volta nasce no
     * assentamento. Só turno vivo e sem Parar pedido; a última chamada vale (uma volta por turno).
     */
    async marcarDespertar(id: string, em: number, motivo: string): Promise<boolean> {
      const linhas = await conn`
        update turnos set despertar_em = ${data(em)}, despertar_motivo = ${motivo}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado = 'despachando' and parar_solicitado_em is null
        returning id`;
      return linhas.length > 0;
    },

    /** ADR-086: o pedido de volta que o turno anotou (null = nenhum). */
    async despertarDoTurno(id: string): Promise<{ em: number; motivo: string } | null> {
      const [l] = await conn<{ despertar_em: Date | null; despertar_motivo: string | null }[]>`
        select despertar_em, despertar_motivo from turnos where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l?.despertar_em ? { em: ms(l.despertar_em), motivo: l.despertar_motivo ?? "" } : null;
    },

    /** ADR-086: quantas voltas marcadas já retomaram este turno (o teto de voltas seguidas). */
    async voltasMarcadas(retomaTurnoId: string): Promise<number> {
      const [l] = await conn<{ n: number }[]>`
        select count(*)::int as n from turnos where tenant_id = ${escopo.tenantId} and retoma_turno_id = ${retomaTurnoId} and acordar_em is not null`;
      return l?.n ?? 0;
    },

    /**
     * ADR-099 §5 (parte 1, definido em 2026-10-12): as últimas voltas marcadas que retomam este turno, da mais nova para a
     * mais antiga, com o que a regra de "nada novo" lê (src/domain/voltas-sem-novidade.ts): se a volta marcou outra, se
     * abriu decisão e se pediu algo a um colega (mensagem `handoff` dela).
     */
    async ultimasVoltas(retomaTurnoId: string, limite: number): Promise<VoltaDaCadeia[]> {
      const linhas = await conn<{ estado: EstadoTurno; marcou_volta: boolean; perguntou: boolean; pediu_a_colega: boolean; por_cota: boolean }[]>`
        -- ADR-099 (parte 2): deixar um comando esperando (esperar_comando) também é marcar outra volta.
        select t.estado, (t.despertar_em is not null or exists (select 1 from esperas e where e.tenant_id = t.tenant_id and e.turno_id = t.id)) as marcou_volta,
          exists (select 1 from decisoes d where d.tenant_id = t.tenant_id and d.turno_id = t.id) as perguntou,
          exists (select 1 from mensagens m where m.tenant_id = t.tenant_id and m.turno_id = t.id and m.kind = 'handoff') as pediu_a_colega,
          -- ADR-099 §7: a volta que a cota no limite marcou (não o bot) não conta como sem novidade.
          starts_with(t.entrada_texto, ${ENTRADA_DA_VOLTA_DA_COTA}) as por_cota
        from turnos t
        where t.tenant_id = ${escopo.tenantId} and t.retoma_turno_id = ${retomaTurnoId} and t.acordar_em is not null
        order by t.criado_em desc, t.id desc limit ${limite}`;
      return linhas.map((l) => ({ estado: l.estado, marcouVolta: l.marcou_volta, perguntou: l.perguntou, pediuAColega: l.pediu_a_colega, porCota: l.por_cota }));
    },

    /** Junta mais uma entrada à retomada que ainda está na fila. Não toca no estado (sem-requeue segue valendo). */
    async juntarEntrada(id: string, texto: string): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        update turnos set entrada_texto = entrada_texto || ${`\n\n${texto}`}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado = 'pendente'
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTurno(l) : null;
    },

    /** O turno que começou a tarefa: sobe pela cadeia de retoma_turno_id (teto de saltos contra ciclo). */
    async raizDaCadeia(id: string): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        with recursive cadeia(id, retoma_turno_id, saltos) as (
          select id, retoma_turno_id, 0 from turnos where tenant_id = ${escopo.tenantId} and id = ${id}
          union all
          select t.id, t.retoma_turno_id, c.saltos + 1 from turnos t join cadeia c on t.tenant_id = ${escopo.tenantId} and t.id = c.retoma_turno_id
          where c.saltos < 50
        )
        select ${conn.unsafe(COLUNAS)} from turnos
        where tenant_id = ${escopo.tenantId} and id = (select id from cadeia order by saltos desc limit 1)`;
      return l ? paraTurno(l) : null;
    },

    /** ADR-052 (0033): o turno trouxe conteúdo da web pelas nativas. A primeira marca fica. */
    async contaminar(id: string, agora: number): Promise<boolean> {
      const r = await conn`update turnos set contaminado_em = coalesce(contaminado_em, ${data(agora)}) where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id}`;
      return r.count === 1;
    },

    async contaminado(id: string): Promise<boolean> {
      const [l] = await conn<{ sim: boolean }[]>`select contaminado_em is not null as sim from turnos where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l?.sim === true;
    },

    /**
     * NOD-206: o executor em que o turno de fato roda só é decidido ao emitir o plano; grava-o aqui para a retomada
     * (sessaoDoTurno) e os relatórios. Só a coluna executor — nunca o estado (tests/conformidade/sem-requeue.test.ts).
     */
    async registrarExecutor(id: string, executor: Executor): Promise<void> {
      await conn`update turnos set executor = ${executor} where tenant_id = ${escopo.tenantId} and id = ${id}`;
    },

    /** ADR-102 (0074): a conta que o plano mandou a máquina usar (null = a pasta padrão da máquina). */
    async registrarConta(id: string, contaId: string | null): Promise<void> {
      await conn`update turnos set conta_id = ${contaId} where tenant_id = ${escopo.tenantId} and id = ${id}`;
    },

    async contaDoTurno(id: string): Promise<string | null> {
      const [l] = await conn<{ conta_id: string | null }[]>`select conta_id from turnos where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l?.conta_id ?? null;
    },

    /** ADR-066: a sessão do CLI que o turno abriu e o executor dele — a retomada de rotina ou de pedido de colega volta nela. */
    async sessaoDoTurno(id: string): Promise<{ sessaoCli: string; executor: string } | null> {
      const [l] = await conn<{ sessao_cli: string | null; executor: string }[]>`select sessao_cli, executor from turnos where tenant_id = ${escopo.tenantId} and id = ${id}`;
      return l?.sessao_cli ? { sessaoCli: l.sessao_cli, executor: l.executor } : null;
    },

    /** "Pode fazer e o resto desta tarefa" (0032): marca a RAIZ; vale para ela e as retomadas dela. */
    async liberarComputador(raizId: string, agora: number): Promise<boolean> {
      const r = await conn`update turnos set computador_liberado_em = coalesce(computador_liberado_em, ${data(agora)}) where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${raizId}`;
      return r.count === 1;
    },

    async computadorLiberado(raizId: string): Promise<boolean> {
      const [l] = await conn<{ liberado: boolean }[]>`select computador_liberado_em is not null as liberado from turnos where tenant_id = ${escopo.tenantId} and id = ${raizId}`;
      return l?.liberado === true;
    },

    /** ADR-055 (0034): "Pode fazer e o resto desta tarefa" num comando do terminal — a mesma regra do computador. */
    async liberarTerminal(raizId: string, agora: number): Promise<boolean> {
      const r = await conn`update turnos set terminal_liberado_em = coalesce(terminal_liberado_em, ${data(agora)}) where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${raizId}`;
      return r.count === 1;
    },

    async terminalLiberado(raizId: string): Promise<boolean> {
      const [l] = await conn<{ liberado: boolean }[]>`select terminal_liberado_em is not null as liberado from turnos where tenant_id = ${escopo.tenantId} and id = ${raizId}`;
      return l?.liberado === true;
    },

    /** Assenta o resultado: só sai de 'despachando' (ou 'pendente' para interrupção antes de rodar). */
    async assentar(id: string, a: Assentamento): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        update turnos set
          estado = ${a.estado},
          motivo_interrupcao = ${a.estado === "interrompido" ? (a.motivoInterrupcao ?? "sem_progresso") : null},
          motivo_falha = ${a.motivoFalha ?? null},
          attempted = attempted or ${a.sinais?.attempted ?? false},
          rejected = rejected or ${a.sinais?.rejected ?? false},
          prompt_submitted = prompt_submitted or ${a.sinais?.promptSubmitted ?? false},
          produced_output = produced_output or ${a.sinais?.producedOutput ?? false},
          custo_usd = coalesce(${a.custoUsd ?? null}, custo_usd),
          tokens_entrada = coalesce(${a.tokensEntrada ?? null}, tokens_entrada),
          tokens_saida = coalesce(${a.tokensSaida ?? null}, tokens_saida),
          sessao_cli = coalesce(${a.sessaoCli ?? null}, sessao_cli),
          custo_sessao_usd = coalesce(${a.custoSessaoUsd ?? null}, custo_sessao_usd),
          ultimo_sinal_em = coalesce(ultimo_sinal_em, ${a.estado === "interrompido" && a.ultimoSinalEm !== undefined ? data(a.ultimoSinalEm) : null}),
          lease_ate = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado in ('pendente', 'despachando')
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTurno(l) : null;
    },

    /**
     * 0035: o total que a sessão do CLI tinha no turno anterior DELA (o maior já registrado, que é o último: o total
     * só cresce dentro de uma sessão). null = nenhum turno desta sessão registrou total ainda.
     */
    async totalAnteriorDaSessao(sessaoCli: string, turnoId: string): Promise<number | null> {
      const [l] = await conn<{ total: string | null }[]>`
        select max(custo_sessao_usd) as total from turnos
        where tenant_id = ${escopo.tenantId} and sessao_cli = ${sessaoCli} and id <> ${turnoId} and custo_sessao_usd is not null`;
      return l?.total === null || l?.total === undefined ? null : Number(l.total);
    },

    /**
     * definido em 2026-10-15 (NOD-264, E8; emenda da ADR-045 sobre a ADR-010): a entrega tardia com SUCESSO de um turno que
     * a queda assentou (`maquina_sem_contato`/`reinicio_servidor`) promove o turno a `concluido` — o trabalho terminou, só
     * a máquina sumiu antes de entregar. Condicional: só o interrompido por queda muda (o UPDATE decide a corrida com a
     * retomada automática), e nunca para 'pendente' (sem requeue). Quem chama já conferiu que não há retomada criada.
     */
    async concluirTardia(id: string, a: Omit<Assentamento, "estado" | "motivoInterrupcao" | "motivoFalha">): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        update turnos set
          estado = 'concluido',
          motivo_interrupcao = null,
          motivo_falha = null,
          attempted = attempted or ${a.sinais?.attempted ?? false},
          rejected = rejected or ${a.sinais?.rejected ?? false},
          prompt_submitted = prompt_submitted or ${a.sinais?.promptSubmitted ?? false},
          produced_output = produced_output or ${a.sinais?.producedOutput ?? false},
          custo_usd = coalesce(${a.custoUsd ?? null}, custo_usd),
          tokens_entrada = coalesce(${a.tokensEntrada ?? null}, tokens_entrada),
          tokens_saida = coalesce(${a.tokensSaida ?? null}, tokens_saida),
          sessao_cli = coalesce(${a.sessaoCli ?? null}, sessao_cli),
          custo_sessao_usd = coalesce(${a.custoSessaoUsd ?? null}, custo_sessao_usd),
          lease_ate = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado = 'interrompido'
          and motivo_interrupcao in ('maquina_sem_contato', 'reinicio_servidor')
          and not exists (select 1 from turnos r where r.tenant_id = ${escopo.tenantId} and r.retoma_turno_id = ${id})
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTurno(l) : null;
    },

    /** NOD-264 (E8): algum turno já retoma este (na fila, rodando ou acabado)? */
    async temRetomada(retomaTurnoId: string): Promise<boolean> {
      const [l] = await conn<{ tem: boolean }[]>`
        select exists (select 1 from turnos where tenant_id = ${escopo.tenantId} and retoma_turno_id = ${retomaTurnoId}) as tem`;
      return l?.tem ?? false;
    },

    /**
     * Transição terminal e idempotente (ADR-010/021): só o que está vivo vira 'interrompido'.
     * NOD-241 (0076): `ultimoSinalEm` grava o último sinal de vida (o primeiro valor vence). `leaseVencidoEm` é a guarda
     * do varredor: `vencidos()` lê sem trava, e o turno que renovou o lease entre a leitura e este UPDATE não é
     * interrompido nem recebe um sinal velho (ADR-045) — devolve null e segue vivo.
     */
    async interromper(id: string, motivo: MotivoInterrupcao, o: { ultimoSinalEm?: number; leaseVencidoEm?: number } = {}): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        update turnos set estado = 'interrompido', motivo_interrupcao = ${motivo},
          ultimo_sinal_em = coalesce(ultimo_sinal_em, ${o.ultimoSinalEm !== undefined ? data(o.ultimoSinalEm) : null}), lease_ate = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado in ('pendente', 'despachando')
          ${o.leaseVencidoEm !== undefined ? conn`and (lease_ate is null or lease_ate < ${data(o.leaseVencidoEm)})` : conn``}
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTurno(l) : null;
    },

    /**
     * definido em 2026-10-15 (NOD-262): o turno de conversa ou sala que respondeu ao pedido de um colega (responder_pedido)
     * tira da fila o turno `delegacao` do pedido — interrompido/'absorvido' apontando para ele, como na fila lida junta.
     * Só o que ainda está 'pendente': o que já começou a rodar responde sozinho; null = não absorveu.
     */
    async absorverDelegacao(id: string, porTurnoId: string): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        update turnos set estado = 'interrompido', motivo_interrupcao = 'absorvido', absorvido_por = ${porTurnoId}, lease_ate = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and origem = 'delegacao' and estado = 'pendente'
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTurno(l) : null;
    },

    /**
     * Fila lida junta (definido em 2026-09-24): logo depois de reivindicar um turno disparado por fala da
     * pessoa, os OUTROS pendentes da mesma conversa e do mesmo agente, também disparados por fala dela,
     * saem como interrompido/'absorvido' apontando para ele, e a entrada dele vira a lista de todas as
     * falas (entradaDaFila). Rotina, retomada e peer nunca entram nem absorvem; ADR-083: só da MESMA faixa (a fala
     * mandada a uma task não entra no turno da conversa, nem o contrário). Só toca 'pendente', então
     * um Cancelar que chegou antes deixa aquela mensagem de fora e um que chega depois recebe estado_invalido.
     */
    async absorverPendentes(turno: Turno, entrada: (textos: readonly string[]) => string): Promise<{ turno: Turno; absorvidos: Turno[] }> {
      if (!turno.mensagemOrigemId || (turno.origem !== "conversa" && turno.origem !== "sala")) return { turno, absorvidos: [] };
      const linhas = await conn<Linha[]>`
        update turnos set estado = 'interrompido', motivo_interrupcao = 'absorvido', absorvido_por = ${turno.id}, lease_ate = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and conversa_id = ${turno.conversaId} and agente_id = ${turno.agenteId}
          and estado = 'pendente' and origem in ('conversa', 'sala') and mensagem_origem_id is not null and id <> ${turno.id}
          and trabalho_id is not distinct from ${turno.trabalhoId ?? null}::uuid
        returning ${conn.unsafe(COLUNAS)}`;
      const absorvidos = linhas.map(paraTurno).sort((a, b) => a.criadoEm - b.criadoEm);
      if (absorvidos.length === 0) return { turno, absorvidos };
      const anexos = [...new Set([...turno.entradaAnexos, ...absorvidos.flatMap((a) => a.entradaAnexos)])];
      const [l] = await conn<Linha[]>`
        update turnos set entrada_texto = ${entrada([turno.entradaTexto, ...absorvidos.map((a) => a.entradaTexto)])}, entrada_anexos = ${anexos as string[]}::uuid[]
        where tenant_id = ${escopo.tenantId} and id = ${turno.id}
        returning ${conn.unsafe(COLUNAS)}`;
      return { turno: l ? paraTurno(l) : turno, absorvidos };
    },

    /**
     * Mensagem nova no meio do trabalho (definido em 2026-10-01, ADR-067): as falas da pessoa que esperavam na fila
     * desta conversa e deste agente entram no turno VIVO — saem interrompido/'absorvido' apontando para ele, como na
     * fila lida junta, mas o texto vai à sessão do CLI em vez de mudar a entrada. Só fala da pessoa (conversa), e só
     * sem anexo: o anexo espera o próximo turno, que o baixa e o entrega inteiro. Quem decide se o turno vivo aceita
     * é o caso de uso (absorverNaSessao).
     * definido em 2026-10-07 (#189): com `ids`, só estas — as que o app confirmou ter escrito na sessão
     * (confirmarNaSessao); sem, todas as da fila, como antes (app que não confirma).
     */
    async absorverNaSessao(turno: Turno, ids?: readonly string[]): Promise<Turno[]> {
      if (ids && ids.length === 0) return [];
      const linhas = await conn<Linha[]>`
        update turnos set estado = 'interrompido', motivo_interrupcao = 'absorvido', absorvido_por = ${turno.id}, lease_ate = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and conversa_id = ${turno.conversaId} and agente_id = ${turno.agenteId}
          and estado = 'pendente' and origem = 'conversa' and mensagem_origem_id is not null and cardinality(entrada_anexos) = 0 and id <> ${turno.id}
          and trabalho_id is null
          ${ids ? conn`and id = any(${ids as string[]}::uuid[])` : conn``}
        returning ${conn.unsafe(COLUNAS)}`;
      return linhas.map(paraTurno).sort((a, b) => a.criadoEm - b.criadoEm);
    },

    /**
     * definido em 2026-10-07 (ADR-083, #193): as falas que esperam na faixa DESTE trabalho (a da pessoa na tela da task
     * e o recado da conversa, os dois com mensagem de origem) entram no turno vivo dele, como absorverNaSessao faz com a
     * conversa. Sem anexo, e nunca a retomada de uma decisão (que não tem mensagem de origem).
     * revisto em 2026-10-08 (revisão do épico, S18): com `ids`, só estas — as que o app confirmou (confirmarNaSessao).
     */
    async absorverDoTrabalho(turno: Turno, ids?: readonly string[]): Promise<Turno[]> {
      if (!turno.trabalhoId || (ids && ids.length === 0)) return [];
      const linhas = await conn<Linha[]>`
        update turnos set estado = 'interrompido', motivo_interrupcao = 'absorvido', absorvido_por = ${turno.id}, lease_ate = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and trabalho_id = ${turno.trabalhoId}
          and estado = 'pendente' and mensagem_origem_id is not null and cardinality(entrada_anexos) = 0 and id <> ${turno.id}
          ${ids ? conn`and id = any(${ids as string[]}::uuid[])` : conn``}
        returning ${conn.unsafe(COLUNAS)}`;
      return linhas.map(paraTurno).sort((a, b) => a.criadoEm - b.criadoEm);
    },

    /**
     * ADR-090: "Rodar em <outra máquina> desta vez" — os turnos AINDA pendentes desta conversa vão para a máquina escolhida
     * pela pessoa, uma vez; o que já foi reivindicado fica onde está. Quem chama já conferiu que a chave é dela.
     */
    async rodarDestaVez(conversaId: string, maquinaId: string): Promise<number> {
      const r = await conn`
        update turnos set maquina_desta_vez = ${maquinaId}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and conversa_id = ${conversaId} and estado = 'pendente'`;
      return r.count;
    },

    /** Cancelar da fila: só o que AINDA está pendente — um turno que o laço acabou de reivindicar fica intacto. */
    async cancelarPendente(id: string): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        update turnos set estado = 'interrompido', motivo_interrupcao = 'parado_pela_pessoa', lease_ate = null
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and estado = 'pendente'
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTurno(l) : null;
    },

    /**
     * NOD-219 (definido em 2026-10-13): os pendentes da pessoa que o varredor de órfãos olha — os que nenhum `reivindicar`
     * pode pegar (agente excluído, ou vivo com outra geração) e os que passaram do prazo da fila — com os fatos de
     * domain/turno-orfao.ts. Ligação e volta marcada para mais tarde não entram. Os impossíveis primeiro; `limite` por
     * passada, para a tx do varredor ficar curta (o resto sai na próxima).
     * revisto em 2026-10-13 (revisão do PR #307): `jaObservados` (os velhos observados na última hora) sai já na consulta,
     * como os adiados do #218 — com o `limite`, pular depois deixava os mesmos 50 velhos na frente e o 51º nunca era
     * observado. Só vale para o velho: um observado que vira impossível (agente excluído no meio) entra de novo.
     */
    async orfaosCandidatos(agora: number, o: { jaObservados?: readonly string[]; limite?: number } = {}): Promise<OrfaoCandidato[]> {
      const jaObservados = [...(o.jaObservados ?? [])];
      const linhas = await conn<{ id: string; conversa_id: string; agente_id: string; origem: OrigemTurno; trabalho_id: string | null; criado_em: Date; prazo_em: Date; acordar_em: Date | null; agente_excluido: boolean; geracao_antiga: boolean; depois_de_aberto: boolean; faixa_ocupada: boolean }[]>`
        select x.* from (
          select t.id, t.conversa_id, t.agente_id, t.origem, t.trabalho_id, t.criado_em, t.prazo_em, t.acordar_em,
            coalesce(a.excluido_em is not null, true) as agente_excluido,
            (a.excluido_em is null and a.geracao_execucao is distinct from t.geracao_execucao) as geracao_antiga,
            (t.trabalho_id is not null and exists (select 1 from trabalhos w join trabalhos dep on dep.tenant_id = w.tenant_id and dep.id = w.depois_de_trabalho_id
              where w.tenant_id = t.tenant_id and w.id = t.trabalho_id and dep.estado not in ('terminado', 'parado', 'falhou'))) as depois_de_aberto,
            (case when t.trabalho_id is null
              then exists (select 1 from turnos d where d.tenant_id = t.tenant_id and d.conversa_id = t.conversa_id and d.trabalho_id is null and d.estado = 'despachando' and d.origem <> 'ligacao')
              else exists (select 1 from turnos d where d.tenant_id = t.tenant_id and d.trabalho_id = t.trabalho_id and d.estado = 'despachando') end) as faixa_ocupada
          from turnos t
          left join agentes a on a.tenant_id = t.tenant_id and a.id = t.agente_id
          where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.estado = 'pendente' and t.origem <> 'ligacao'
            and (t.acordar_em is null or t.acordar_em <= ${data(agora)})
        ) x
        where x.agente_excluido or x.geracao_antiga or (x.prazo_em <= ${data(agora)} and not (x.id::text = any(${jaObservados}::text[])))
        order by (x.agente_excluido or x.geracao_antiga) desc, x.criado_em asc, x.id asc
        limit ${o.limite ?? 50}`;
      return linhas.map((l) => ({
        id: l.id,
        conversaId: l.conversa_id,
        agenteId: l.agente_id,
        origem: l.origem,
        trabalhoId: l.trabalho_id,
        criadoEm: ms(l.criado_em),
        prazoEm: ms(l.prazo_em),
        acordarEm: msOuNull(l.acordar_em),
        agenteExcluido: l.agente_excluido,
        geracaoAntiga: l.geracao_antiga,
        depoisDeAberto: l.depois_de_aberto,
        faixaOcupada: l.faixa_ocupada,
      }));
    },

    /**
     * NOD-219: encerra o pendente que nenhum `reivindicar` pode pegar. UPDATE condicional — o mesmo predicado que o
     * `reivindicar` nega (agente vivo com a mesma geração), mais `estado = 'pendente'`: o turno que uma máquina acabou de
     * reivindicar fica intacto (tests/concurrency/varredor-orfaos-reivindicar.test.ts). `parado_pela_pessoa` porque o
     * enum de motivos não tem outro que sirva; a causa vai no evento `turno_interrompido`.
     */
    async encerrarOrfao(id: string, agora: number): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        update turnos t set estado = 'interrompido', motivo_interrupcao = 'parado_pela_pessoa', lease_ate = null
        where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.id = ${id} and t.estado = 'pendente' and t.origem <> 'ligacao'
          and (t.acordar_em is null or t.acordar_em <= ${data(agora)})
          and not exists (select 1 from agentes a where a.tenant_id = t.tenant_id and a.id = t.agente_id and a.excluido_em is null and a.geracao_execucao = t.geracao_execucao)
        returning ${conn.unsafe(COLUNAS.split(", ").map((c) => `t.${c}`).join(", "))}`;
      return l ? paraTurno(l) : null;
    },

    /** Parar (E5.4): marca o pedido; a próxima renovação devolve {ativo:false} e o laço manda SIGTERM. */
    async pedirInterrupcao(ids: readonly string[], agora: number): Promise<number> {
      if (ids.length === 0) return 0;
      const r = await conn`
        update turnos set parar_solicitado_em = coalesce(parar_solicitado_em, ${data(agora)})
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id in ${conn([...ids])} and estado = 'despachando'`;
      return r.count;
    },

    /** Lease vencido: o varredor converte em 'interrompido' maquina_sem_contato — NUNCA em 'pendente'. */
    async vencidos(agora: number): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado = 'despachando' and lease_ate < ${data(agora)}
        order by criado_em`;
      return linhas.map(paraTurno);
    },

    async despachandoDaPessoa(): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado = 'despachando' order by criado_em`;
      return linhas.map(paraTurno);
    },

    /**
     * definido em 2026-10-15 (NOD-262): os pedidos de colega na fila do bot (turnos `delegacao` pendentes), os mais antigos
     * primeiro — a lista que o prompt da conversa e da sala mostra para o bot fechar com responder_pedido.
     */
    async delegacoesPendentesDoAgente(agenteId: string, limite = 20): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and agente_id = ${agenteId} and origem = 'delegacao' and estado = 'pendente'
        order by criado_em, id limit ${limite}`;
      return linhas.map(paraTurno);
    },

    async pendentesDaPessoa(conversaId?: string): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and estado = 'pendente'
          ${conversaId ? conn`and conversa_id = ${conversaId}` : conn``}
        order by criado_em`;
      return linhas.map(paraTurno);
    },

    async vivosDaConversa(conversaId: string): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos
        where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} and estado in ('pendente', 'despachando') and origem <> 'ligacao'
          -- ADR-086: a volta marcada não está "em curso" — a tela mostraria o bot ocupado por horas.
          and (acordar_em is null or acordar_em <= now())
        order by criado_em`;
      return linhas.map(paraTurno);
    },

    /**
     * EMENDA 13: turno pendente bloqueado é renderizável — "na fila". Desde a ADR-083 (2026-10-07) o bloqueio é só a
     * faixa da conversa, então `conversaId` aponta para a própria. Pendente sem bloqueio conhecido não entra.
     *
     * revisto em 2026-09-30: em dois passos, e o segundo só quando há pendente (o caso comum é nenhum). A versão com as
     * duas subconsultas correlacionadas custava uma varredura de turnos por linha estimada, e a estimativa sob RLS
     * contava todos os turnos da conversa (1.020 estimados, 0 pendentes de fato): medido em 2026-09-30, custo 504 mil,
     * acima do limiar do JIT, e 1,36 s por GET conversa; o índice turnos_por_conversa (0042) sozinho não resolvia
     * (o custo seguiu acima de 500 mil), porque a subconsulta por agente seguia varrendo a tabela.
     */
    async pendentesRenderizaveis(conversaId: string): Promise<TurnoPendenteDto[]> {
      // ADR-083: turno de trabalho não é "agente ocupado" de ninguém, nem espera por isso: tem faixa própria.
      const pendentes = await conn<{ id: string; agente_id: string }[]>`
        select id, agente_id from turnos
        where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} and estado = 'pendente' and origem <> 'ligacao' and trabalho_id is null
          -- ADR-086: a retomada marcada para mais tarde não está "na fila" — ela nem pode sair ainda.
          and (acordar_em is null or acordar_em <= now())
        order by criado_em`;
      if (pendentes.length === 0) return [];
      // revisto em 2026-10-07 (ADR-083): só a faixa da conversa segura um turno dela — o despachando sem trabalho NESTA
      // conversa (o do mesmo agente primeiro). O bot ocupado em outra conversa ou num trabalho não segura mais.
      const ocupados = await conn<{ agente_id: string; conversa_id: string }[]>`
        select agente_id, conversa_id from turnos
        where tenant_id = ${escopo.tenantId} and estado = 'despachando' and origem <> 'ligacao' and trabalho_id is null and conversa_id = ${conversaId}
        order by criado_em`;
      return pendentes.flatMap((p): TurnoPendenteDto[] => {
        const ocupado = ocupados.find((d) => d.agente_id === p.agente_id) ?? ocupados[0];
        return ocupado ? [{ id: p.id, motivo: "agente_ocupado_em", conversaId: ocupado.conversa_id }] : [];
      });
    },

    /** Entrega idempotente (ADR-021): true só na primeira vez de (turno, seq_local). */
    async registrarEntrega(turnoId: string, seqLocal: number): Promise<boolean> {
      const linhas = await conn`
        insert into turno_entregas (tenant_id, owner_id, turno_id, seq_local) values (${escopo.tenantId}, ${escopo.pessoaId}, ${turnoId}, ${seqLocal})
        on conflict (tenant_id, turno_id, seq_local) do nothing returning id`;
      return linhas.length === 1;
    },

    /**
     * Turnos concluídos por conversa, numa consulta (as execuções da frota, definido em 2026-09-30): a contagem real, no
     * índice turnos_por_conversa (0042). Conversa sem nenhum fica de fora.
     */
    async concluidosPorConversa(conversaIds: readonly string[]): Promise<Map<string, number>> {
      if (conversaIds.length === 0) return new Map();
      const linhas = await conn<{ conversa_id: string; n: number }[]>`
        select conversa_id, count(*)::int as n from turnos
        where tenant_id = ${escopo.tenantId} and conversa_id = any(${[...conversaIds]}::uuid[]) and estado = 'concluido'
        group by conversa_id`;
      return new Map(linhas.map((l) => [l.conversa_id, l.n]));
    },

    /**
     * definido em 2026-10-12 (ADR-099 §7, custo visível): a soma de `custo_usd` por bot em cada janela [inicio, fim), pela
     * criação do turno (como o total do Raio-X, raio-x.repo.ts). `janela` é o índice em `janelas`. Só a pessoa (RLS e o
     * filtro do dono); turno sem custo não conta.
     */
    async custoPorAgente(janelas: readonly { inicio: number; fim: number }[]): Promise<{ agenteId: string; janela: number; usd: number }[]> {
      if (janelas.length === 0) return [];
      const inicios = janelas.map((j) => new Date(j.inicio).toISOString());
      const fins = janelas.map((j) => new Date(j.fim).toISOString());
      const linhas = await conn<{ agente_id: string; janela: number; usd: string }[]>`
        select t.agente_id, (j.i - 1)::int as janela, sum(t.custo_usd)::text as usd
        from unnest(${inicios}::text[], ${fins}::text[]) with ordinality as j(inicio, fim, i)
        join turnos t on t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId}
          and t.criado_em >= j.inicio::timestamptz and t.criado_em < j.fim::timestamptz and t.custo_usd is not null
        group by t.agente_id, j.i`;
      return linhas.map((l) => ({ agenteId: l.agente_id, janela: l.janela, usd: Number(l.usd) }));
    },

    /**
     * definido em 2026-10-05: as falas da pessoa barradas por falta de IA desde `desde`, uma por conversa — só a mais
     * nova, e só quando nada veio depois dela na conversa (repetir-barrados-por-ia.ts).
     */
    async barradosPorFaltaDeIa(desde: number): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos t
        where t.tenant_id = ${escopo.tenantId} and t.owner_id = ${escopo.pessoaId} and t.origem = 'conversa' and t.estado = 'interrompido'
          and t.motivo_interrupcao = 'executor_indisponivel' and t.criado_em >= ${data(desde)}
          and not exists (select 1 from turnos n where n.tenant_id = t.tenant_id and n.conversa_id = t.conversa_id and n.criado_em > t.criado_em)
        order by t.criado_em`;
      return linhas.map(paraTurno);
    },

    /**
     * definido em 2026-10-08 (revisão do épico, S20): trava (FOR UPDATE) os turnos pendentes e rodando de um trabalho, em
     * ordem de criação — a mesma em que a renovação e a entrega os pegam (o turno vivo, mais velho, antes dos recados).
     */
    async travarAbertosDoTrabalho(trabalhoId: string): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos
        where tenant_id = ${escopo.tenantId} and trabalho_id = ${trabalhoId} and estado in ('pendente', 'despachando')
        order by criado_em, id for update`;
      return linhas.map(paraTurno);
    },

    /** Os turnos de um trabalho, em ordem (ADR-083): o Parar da task, a retomada e a tela da task. */
    async doTrabalho(trabalhoId: string): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select ${conn.unsafe(COLUNAS)} from turnos where tenant_id = ${escopo.tenantId} and trabalho_id = ${trabalhoId} order by criado_em, id`;
      return linhas.map(paraTurno);
    },

    /**
     * A rede de 2 min (ADR-083, #193): o turno de conversa que está rodando passa a ser do trabalho. Só o que ainda roda
     * e ainda não tem trabalho — duas renovações seguidas não promovem duas vezes.
     */
    async vincularTrabalho(id: string, trabalhoId: string): Promise<Turno | null> {
      const [l] = await conn<Linha[]>`
        update turnos set trabalho_id = ${trabalhoId}
        where tenant_id = ${escopo.tenantId} and owner_id = ${escopo.pessoaId} and id = ${id} and trabalho_id is null and estado = 'despachando'
        returning ${conn.unsafe(COLUNAS)}`;
      return l ? paraTurno(l) : null;
    },

    async listarDaConversa(conversaId: string, limite = 50): Promise<Turno[]> {
      const linhas = await conn<Linha[]>`
        select * from (
          select ${conn.unsafe(COLUNAS)} from turnos where tenant_id = ${escopo.tenantId} and conversa_id = ${conversaId} order by criado_em desc limit ${limite}
        ) r order by criado_em`;
      return linhas.map(paraTurno);
    },
  };
}
