import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { OpQuadro, Quadro, TarefaQuadro } from "../contracts/quadro.ts";
import { type DesfechoExecucao, type ExecucaoDto, type TrabalhoParaBot, type ExecucaoQuadro, type ExecucoesDaTarefa, INTERVALO_NOVA_TENTATIVA_MS, type RecadoQuadro } from "../contracts/quadro-execucoes.ts";
import type { Profundidade } from "../contracts/turno.ts";
import { acionaNaColuna, colunaDeAndamento, colunaDeEspera, colunasDe, papelDe } from "../domain/colunas.ts";
import { ehErroDeDominio, ErroDeDominio } from "../domain/erro.ts";
import { log } from "../obs/log.ts";
import { cercado, entradaDaTarefa, etapaDaTarefa, resolverTarefa, voltaDaResposta } from "../domain/quadro.ts";
import { decidirAposTermino, entradaDoNovoTrabalho, entradaDoRecado, esperandoNaCadeia, estadoDaExecucao, molduraDoRecado, motivoDaFalha, recadosNaEntrada, type RecadoNaEntrada, tentativasAutomaticasSeguidas, terminada } from "../domain/quadro-execucoes.ts";
import type { DesfechoComFrase } from "../repositories/quadro-execucoes.repo.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import { fecharPedidoSemAcordar } from "./entregar-resposta-peer.ts";
import { abrirTurno, acharQuadro, agentesDaPessoa, avisarComVoce, eventoQuadro, experimentoLigado, falhaDoAchado, montarQuadro, pararTurno, type PedidoLote, type ResultadoLote } from "./quadro.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";
import type { Isolar } from "./turnos-orfaos.ts";

/**
 * Os trabalhos de uma tarefa do quadro (definido em 2026-11-02, NOD-418): a lista na tarefa aberta, Repetir, Cancelar,
 * o recado e o passo do varredor que trata o fim de cada trabalho (nova tentativa na falha transitória, Bloqueado no
 * erro do agente). Trabalho concluído não move a tarefa: quem move é o bot (gerir_quadro) ou a pessoa.
 *
 * O recado com o trabalho rodando entra na sessão viva (ADR-083, emenda NOD-418): fica pendente em quadro_recados e o
 * renovar da ponte o oferece no próximo passo (ofertarRecadosDoQuadro). Na fila, ele se junta ao pedido do turno. Sem
 * nada vivo, vira o próximo trabalho. O que a sessão não chegou a ler vira o próximo trabalho quando o atual termina.
 *
 * Tudo com o quadro travado (buscarTravado): o varredor, um lote e o Repetir não se cruzam.
 */

type OpTrabalho = Extract<OpQuadro, { tipo: "repetir_trabalho" | "cancelar_trabalho" | "recado" }>;
type Origem = "repetir" | "automatica" | "recado";

/** Na tela, a nota do recado: entra no próximo passo (rodando), quando começar (fila) ou já virou um trabalho. */
export type EntregaRecado = "agora" | "quando_comecar" | "novo";

/** A decisão da cadeia antiga que o Repetir ou o Cancelar soltou (domain/decisoes.ts tem a frase). */
export const REGRA_TRABALHO_SUBSTITUIDO = "regra:trabalho_do_quadro_substituido" as const;

const falha = (erro: Extract<ResultadoLote, { ok: false }>["erro"], detalhe: string): { data: ResultadoLote } => ({ data: { ok: false, erro, detalhe } });

/** Só a fazer e fazendo repetem sozinhas ou vão para Bloqueado (decisão da Ada). */
const andando = (q: Quadro, t: TarefaQuadro): boolean => {
  const papel = papelDe(colunasDe(q), t.status);
  return papel === "afazer" || papel === "fazendo";
};

async function desfechosDe(deps: Deps, execs: readonly ExecucaoQuadro[]): Promise<Map<string, DesfechoComFrase>> {
  return deps.repos.quadroExecucoes.desfechos(execs.map((e) => e.turnoId));
}

type Vivo = { e: ExecucaoQuadro; d: DesfechoComFrase };

/**
 * Os trabalhos vivos da tarefa (na fila, rodando ou com a cadeia esperando a pessoa ou o CI), do mais recente ao
 * primeiro. Pode haver mais de um: o lote começa um trabalho de comentário enquanto outro ainda espera.
 */
function vivosDe(execs: readonly ExecucaoQuadro[], desfechos: Map<string, DesfechoComFrase>): Vivo[] {
  const vivos: Vivo[] = [];
  for (const e of [...execs].reverse()) {
    const d = desfechos.get(e.turnoId);
    if (d && !terminada(estadoDaExecucao(e, d))) vivos.push({ e, d });
  }
  return vivos;
}

/** O trabalho que roda de verdade (fila ou um turno despachado), não só esperando: o Repetir não passa por cima dele. */
const rodandoDe = (vivos: readonly Vivo[]): Vivo | null => vivos.find((v) => !esperandoNaCadeia(v.d)) ?? null;

/** O desfecho a gravar no tratamento: o estado terminado e, na falha, o motivo em palavras. */
function desfechoDoFim(estado: DesfechoExecucao, d: DesfechoComFrase | undefined): [DesfechoExecucao, string | null] {
  return [estado, estado === "falhou" && d ? motivoDaFalha(d) : null];
}

/** A decisão da cadeia antiga que o varredor soltou ao abrir a nova tentativa sozinho ou ao bloquear a tarefa. */
export const REGRA_TRABALHO_TRATADO = "regra:trabalho_do_quadro_tratado" as const;

/**
 * O Repetir, o Cancelar e o varredor (nova tentativa, Bloqueado) soltam as cadeias antigas: as decisões abertas fecham
 * por regra (ninguém continua: a resposta tardia, o "Retomar" da queda ou o veredito do revisor não abrem a retomada
 * antiga em paralelo com o trabalho novo ou com o card Bloqueado) e os comandos de fundo que rodam (o CI) saem
 * cancelados. O mesmo fechamento do Parar de um trabalho (trabalhos.ts, fecharDecisoesDoTrabalho).
 *
 * Revisão 5 do PR #625: com `p` (o Repetir e o Cancelar), o pedido a um colega que a cadeia ainda esperava também fecha
 * (o peer_ask de fecho, sem acordar a cadeia velha) e o turno do colega para: a resposta tardia não reabre a cadeia
 * velha ao lado do trabalho novo, e o colega não segue trabalhando para ninguém.
 */
async function soltarCadeias(deps: Deps, raizes: readonly string[], regra: typeof REGRA_TRABALHO_SUBSTITUIDO | typeof REGRA_TRABALHO_TRATADO = REGRA_TRABALHO_SUBSTITUIDO, p?: PedidoLote): Promise<RuntimeEvent[]> {
  const agora = deps.agora();
  const events: RuntimeEvent[] = [];
  if (p) {
    for (const colega of await deps.repos.quadroExecucoes.pedidosAbertosDasCadeias(raizes)) {
      const f = await fecharPedidoSemAcordar(deps, { turnoId: colega, motivo: "o trabalho do quadro que pediu foi repetido ou cancelado" });
      events.push(...(f.events ?? []));
      await pararTurno(deps, p, colega);
    }
  }
  const autoria = { ...autoriaPessoa(deps.escopo), decidido_por: regra };
  for (const id of await deps.repos.quadroExecucoes.decisoesAbertasDasCadeias(raizes)) {
    // Revisão 3 do PR #625: a `em_revisao` (ADR-115) fecha junto; o veredito tardio a acha fechada.
    const fechada = await deps.repos.decisoes.fecharPorRegra(id, { regra, regraVersao: 1, agora, tambemEmRevisao: true });
    if (!fechada) continue;
    await deps.repos.decisoes.reivindicarContinuacao(fechada.id, "turno", agora);
    const proposta = await deps.repos.propostas.buscar(fechada.id);
    if (proposta?.estado === "pendente") await deps.repos.propostas.decidir(proposta.id, "recusada");
    events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: fechada.conversaId, turnoId: fechada.turnoId, dados: { decisao_id: fechada.id, tipo: fechada.tipo, regra } }));
  }
  await deps.repos.quadroExecucoes.cancelarEsperasDasCadeias(raizes, regra === REGRA_TRABALHO_TRATADO ? "o quadro abriu outra tentativa ou bloqueou a tarefa" : "o trabalho do quadro foi repetido ou cancelado", agora);
  return events;
}

/** Cancela, trata e para cada trabalho vivo, no turno dele (não no que a tarefa guarda: o de comentário roda noutro). */
async function cancelarVivos(deps: Deps, p: PedidoLote, vivos: readonly Vivo[]): Promise<void> {
  for (const v of vivos) {
    await deps.repos.quadroExecucoes.cancelar(v.e.id);
    await deps.repos.quadroExecucoes.tratar(v.e.id, "cancelado", null);
    await pararTurno(deps, p, v.e.turnoId);
  }
}

/** O nome do bot que repassou o recado (a moldura diz "repassada por"). */
async function nomesDeQuemRepassou(deps: Deps, recados: readonly Pick<RecadoQuadro, "repassadoPor">[]): Promise<Map<string, string>> {
  const nomes = new Map<string, string>();
  for (const id of new Set(recados.map((r) => r.repassadoPor).filter((x): x is string => x !== null))) {
    nomes.set(id, (await deps.repos.agentes.buscar(id))?.nome ?? "o bot");
  }
  return nomes;
}

const repassador = (p: PedidoLote): string | null => (p.autor.tipo === "agente" ? p.autor.agenteId : null);

/** Os trabalhos da tarefa como a tela lê: do mais recente ao primeiro, os recados e a conversa onde rodam. */
export async function trabalhosDaTarefa(deps: Deps, t: TarefaQuadro): Promise<ExecucoesDaTarefa> {
  const execs = await deps.repos.quadroExecucoes.daTarefa(t.id);
  const desfechos = await desfechosDe(deps, execs);
  let seguidas = 0;
  const dtos: ExecucaoDto[] = execs.map((e) => {
    // A mesma conta de tentativasAutomaticasSeguidas: o trabalho de comentário não zera.
    if (e.origem !== "comentario") seguidas = e.origem === "automatica" ? seguidas + 1 : 0;
    const d = desfechos.get(e.turnoId);
    return {
      id: e.id, numero: e.numero, origem: e.origem, turnoId: e.turnoId, motivo: e.motivo, criadoEm: e.criadoEm,
      estado: estadoDaExecucao(e, d),
      esperando: estadoDaExecucao(e, d) === "rodando" && esperandoNaCadeia(d),
      turnoAtual: d?.turnoAtual ?? e.turnoId,
      comecouEm: d?.despachadoEm ?? null,
      ultimaFrase: d?.ultimaFrase ?? null,
      tentativa: e.origem === "automatica" ? seguidas : null,
      novaTentativaEm: e.novaTentativaEm,
    };
  });
  const recados = (await deps.repos.quadroExecucoes.recadosDaTela(t.id)).map((r) => ({ id: r.id, texto: r.texto, criadoEm: r.criadoEm, entregue: r.entregueEm !== null }));
  const conversa = t.agenteId ? await deps.repos.conversas.buscarPropriaDoAgente(t.agenteId) : null;
  return { execucoes: dtos.reverse(), recados, conversaId: conversa?.id ?? null, semAgente: !t.agenteId };
}

/**
 * Revisão 4 do PR #625: o trabalho atual de cada tarefa como o bot o lê no resumo do quadro (gerir_quadro). O motivo da
 * falha sai cercado (ADR-047): carrega a frase do erro, que pode trazer texto de fora (a saída do comando, do provedor).
 */
export async function trabalhosParaBot(deps: Deps, tarefaIds: readonly string[]): Promise<Map<string, TrabalhoParaBot>> {
  const atuais = await deps.repos.quadroExecucoes.atuaisDasTarefas(tarefaIds);
  const desfechos = await desfechosDe(deps, atuais);
  const r = new Map<string, TrabalhoParaBot>();
  for (const e of atuais) {
    const d = desfechos.get(e.turnoId);
    const estado = estadoDaExecucao(e, d);
    const motivo = estado === "falhou" ? (e.motivo ?? (d ? motivoDaFalha(d) : null)) : null;
    r.set(e.tarefaId, { numero: e.numero, estado, esperando: estado === "rodando" && esperandoNaCadeia(d), motivo: motivo === null ? null : cercado(motivo),
      novaTentativaEm: e.novaTentativaEm === null ? null : new Date(e.novaTentativaEm).toISOString() });
  }
  return r;
}

/** Bloqueada (Bloqueado, ou Precisa de você com a coluna de antes guardada): o trabalho novo a devolve para onde estava. */
function estaBloqueada(q: Quadro, t: TarefaQuadro): boolean {
  const papel = papelDe(colunasDe(q), t.status);
  return papel === "bloqueado" || (papel === "voce" && t.voltarPara !== null && t.voltarPara !== t.status);
}

/**
 * Onde um trabalho novo pode abrir: nas colunas que acionam o responsável (acionaNaColuna, a regra da NOD-417 e do
 * varredor) ou na tarefa bloqueada, que o trabalho novo devolve para onde estava. Feito, Cancelado e Backlog não.
 */
const podeAbrirTrabalho = (q: Quadro, t: TarefaQuadro): boolean => acionaNaColuna(colunasDe(q), t.status) || estaBloqueada(q, t);

/**
 * Um trabalho novo na tarefa: o pedido da tarefa e os recados pendentes (na origem recado, só os recados). Quem chama
 * já cancelou e parou os vivos (cada um no turno dele); aqui só o turno que a tarefa guarda e que não é trabalho nenhum
 * (dado de antes dos trabalhos) é parado. A tarefa Bloqueada volta para onde estava (o Repetir é o "resolvi"); no quadro sem a
 * coluna Bloqueado ela caiu em "voce" com a coluna de antes guardada, e volta igual. null = sem responsável ou sem
 * conversa.
 */
async function novoTrabalho(deps: Deps, p: PedidoLote, q: Quadro, t: TarefaQuadro, origem: Origem, recadoNovo?: string): Promise<{ execucao: ExecucaoQuadro; events: RuntimeEvent[] } | null> {
  const agente = t.agenteId ? await deps.repos.agentes.buscar(t.agenteId) : null;
  if (!agente || agente.ownerId !== deps.escopo.pessoaId) return null;
  const execs = await deps.repos.quadroExecucoes.daTarefa(t.id);
  const ultimo = execs.at(-1);
  const anterior = ultimo ? await deps.repos.turnos.buscar(ultimo.turnoId) : null;
  const pessoaNome = (await deps.repos.pessoas.buscar(deps.escopo.pessoaId))?.nome ?? "a pessoa";
  // Revisão 4 do PR #625: os pendentes saem da fila AQUI (update ... returning) e o pedido leva só o que este update
  // marcou. A confirmação da sessão viva que chega no meio não os acha mais pendentes: o recado não sai em dois lugares.
  const pendentes = await deps.repos.quadroExecucoes.tomarPendentes(t.id);
  const nomes = await nomesDeQuemRepassou(deps, [...pendentes, { repassadoPor: repassador(p) }]);
  const textos: RecadoNaEntrada[] = [
    ...pendentes.map((r) => ({ texto: r.texto, repassadoPor: r.repassadoPor ? nomes.get(r.repassadoPor) ?? null : null })),
    ...(recadoNovo ? [{ texto: recadoNovo, repassadoPor: nomes.get(repassador(p) ?? "") ?? null }] : []),
  ];
  const colunas = colunasDe(q);
  const bloqueada = estaBloqueada(q, t);
  const status = bloqueada ? (t.voltarPara && t.voltarPara !== t.status ? voltaDaResposta(colunas, t) : colunaDeAndamento(colunas) ?? colunaDeEspera(colunas)) : t.status;
  // Revisão 2 do PR #625: o pedido parte da tarefa de agora (título, descrição, a etapa da coluna para onde ela vai) e
  // dos recados pendentes, não do pedido do trabalho anterior (que já levava recados entregues ou nem tinha a tarefa).
  const texto = origem === "recado"
    ? entradaDoRecado({ titulo: t.titulo, tarefaId: t.id, quadroId: q.id, recados: textos, pessoaNome })
    : entradaDoNovoTrabalho({ pedido: entradaDaTarefa({ quadroId: q.id, meta: q.meta, prazo: q.prazo, tarefa: t, pessoaNome, deQuem: null, etapa: etapaDaTarefa(colunas, status) }), automatica: origem === "automatica", recados: textos, pessoaNome, titulo: t.titulo });
  if (t.turnoId && !execs.some((e) => e.turnoId === t.turnoId)) await pararTurno(deps, p, t.turnoId);
  // A mesma corrente do trabalho anterior (o +1 é do abrirTurno); contaminado se a tarefa ou o anterior eram.
  const profundidade = (anterior ? Math.max(0, anterior.profundidade - 1) : (p.profundidade ?? 0)) as Profundidade;
  const deFora = t.deFora || (anterior ? await deps.repos.turnos.contaminado(anterior.id) : false);
  const aberto = await abrirTurno(deps, { ...p, executor: anterior?.executor ?? p.executor, profundidade }, agente, texto, deFora);
  if (!aberto) {
    await deps.repos.quadroExecucoes.devolverTomados(t.id, pendentes.map((r) => r.id));
    return null;
  }
  // O trabalho novo toma o lugar da nova tentativa agendada (o Repetir, o recado, a própria tentativa).
  await deps.repos.quadroExecucoes.desagendarNovaTentativa({ tarefaId: t.id });
  await deps.repos.quadros.salvarTarefa(t.id, { ...t, status, turnoId: aberto.turnoId, ...(bloqueada ? { pergunta: null, voltarPara: null } : {}) });
  const execucao = await deps.repos.quadroExecucoes.inserir({ tarefaId: t.id, origem, turnoId: aberto.turnoId });
  if (!execucao) throw new ErroDeDominio("estado_invalido", { cause: "o turno novo já era um trabalho" });
  const levados = [...pendentes.map((r) => r.id)];
  if (recadoNovo) levados.push((await deps.repos.quadroExecucoes.inserirRecado(t.id, recadoNovo, repassador(p))).id);
  await deps.repos.quadroExecucoes.levarRecados(t.id, execucao.id, aberto.turnoId, levados);
  return { execucao, events: aberto.events };
}

/** Os fins ainda não tratados saem tratados (o Repetir e o recado novo tomam o lugar deles: nada repete por cima). */
async function tratarTerminados(deps: Deps, execs: readonly ExecucaoQuadro[], desfechos: Map<string, DesfechoComFrase>): Promise<void> {
  for (const e of execs) {
    if (e.tratadaEm !== null) continue;
    const d = desfechos.get(e.turnoId);
    const estado = estadoDaExecucao(e, d);
    if (terminada(estado)) await deps.repos.quadroExecucoes.tratar(e.id, ...desfechoDoFim(estado as DesfechoExecucao, d));
  }
}

/**
 * Repetir, Cancelar e recado (as ops repetir_trabalho, cancelar_trabalho e recado): a tela e o gerir_quadro chegam aqui
 * pelo mesmo pedido. A resposta traz o trabalho que ficou (número e estado) e a vista inteira da tarefa.
 */
export async function trabalhoDaTarefa(deps: Deps, p: PedidoLote, op: OpTrabalho): Promise<{ data: ResultadoLote; events?: RuntimeEvent[] }> {
  if (!(await experimentoLigado(deps))) return falha("experimento_desligado", "o quadro está desligado nos experimentos da pessoa");
  const agentes = await agentesDaPessoa(deps);
  const achado = await acharQuadro(deps, p, agentes);
  if (achado && ("ambiguo" in achado || "semNome" in achado)) { const f = falhaDoAchado(achado, agentes); return falha(f.erro, f.detalhe); }
  if (!achado) return falha("sem_quadro", "não há quadro: crie com criar_quadro");
  const q = await deps.repos.quadros.buscarTravado(achado.id);
  if (!q) return falha("sem_quadro", "o quadro sumiu");
  const tarefas = await deps.repos.quadros.tarefas(q.id);
  const achada = resolverTarefa(tarefas.map((t) => ({ ...t, nova: false })), op.tarefa);
  if ("erro" in achada) return falha(achada.erro.includes("não está no quadro") ? "nao_encontrado" : "entrada_invalida", achada.erro);
  const t = tarefas.find((x) => x.id === achada.id)!;
  const execs = await deps.repos.quadroExecucoes.daTarefa(t.id);
  const desfechos = await desfechosDe(deps, execs);
  const vivos = vivosDe(execs, desfechos);
  const rodando = rodandoDe(vivos);
  const events: RuntimeEvent[] = [];
  let trabalho: { numero: number | null; entregue?: EntregaRecado; cancelados?: number };

  if (op.tipo === "cancelar_trabalho") {
    // Não move a tarefa (decisão da Ada): cancela e para cada trabalho vivo (no turno dele), solta o que as cadeias
    // esperavam e os recados que aguardavam. Nada vivo = nada muda.
    await cancelarVivos(deps, p, vivos);
    events.push(...(await soltarCadeias(deps, vivos.map((v) => v.e.turnoId), REGRA_TRABALHO_SUBSTITUIDO, p)));
    const cancelados = await deps.repos.quadroExecucoes.cancelarRecados(t.id);
    // Revisão 4 do PR #625: a nova tentativa agendada (a espera depois da queda) também sai: Cancelar é parar tudo.
    await deps.repos.quadroExecucoes.desagendarNovaTentativa({ tarefaId: t.id });
    trabalho = { numero: vivos[0]?.e.numero ?? null, cancelados };
  } else {
    if (!t.agenteId) return falha("entrada_invalida", "sem agente responsável: a tarefa precisa de um bot para trabalhar (mudar_tarefa com agente)");
    // Repetir com um trabalho rodando de verdade não abre outro (o duplo clique, o Repetir do chat): cancele antes.
    if (op.tipo === "repetir_trabalho" && rodando) return falha("estado_invalido", "Já está rodando: cancele antes (cancelar_trabalho) se a pessoa quer repetir");
    const vivo = op.tipo === "recado" ? rodando ?? vivos[0] ?? null : null;
    if (op.tipo === "recado" && vivo) {
      const pessoaNome = (await deps.repos.pessoas.buscar(deps.escopo.pessoaId))?.nome ?? "a pessoa";
      const nomes = await nomesDeQuemRepassou(deps, [{ repassadoPor: repassador(p) }]);
      const bloco = recadosNaEntrada([{ texto: op.texto, repassadoPor: nomes.get(repassador(p) ?? "") ?? null }], pessoaNome, t.titulo)[0]!;
      if (vivo.d.estado === "pendente" && !vivo.d.parado && (await deps.repos.turnos.juntarEntrada(vivo.e.turnoId, bloco))) {
        // Na fila: o recado entra no pedido do turno, que ainda não começou.
        const r = await deps.repos.quadroExecucoes.inserirRecado(t.id, op.texto, repassador(p));
        await deps.repos.quadroExecucoes.levarRecados(t.id, vivo.e.id, vivo.e.turnoId, [r.id]);
        trabalho = { numero: vivo.e.numero, entregue: "quando_comecar" };
      } else {
        // Rodando: a sessão viva lê no próximo passo (ofertarRecadosDoQuadro). Esperando (a pessoa, o CI): entra quando
        // a retomada começar. Se não ler, vira o próximo trabalho.
        await deps.repos.quadroExecucoes.inserirRecado(t.id, op.texto, repassador(p));
        trabalho = { numero: vivo.e.numero, entregue: esperandoNaCadeia(vivo.d) ? "quando_comecar" : "agora" };
      }
    } else {
      // Revisão 2 do PR #625: fora do andamento (Feito, Cancelado, Backlog) nada abre trabalho; a pessoa move a tarefa antes.
      if (!podeAbrirTrabalho(q, t)) return falha("estado_invalido", "a tarefa não está em andamento: mova-a antes");
      // Repetir abre um trabalho novo e zera a conta das automáticas. O que só esperava (a pessoa, o CI) sai cancelado,
      // e as cadeias antigas soltam o que esperavam: a resposta tardia não reabre o trabalho antigo.
      await cancelarVivos(deps, p, vivos);
      events.push(...(await soltarCadeias(deps, execs.filter((e) => e.canceladaEm === null || vivos.some((v) => v.e.id === e.id)).map((e) => e.turnoId), REGRA_TRABALHO_SUBSTITUIDO, p)));
      await tratarTerminados(deps, execs, desfechos);
      const r = await novoTrabalho(deps, p, q, t, op.tipo === "recado" ? "recado" : "repetir", op.tipo === "recado" ? op.texto : undefined);
      if (!r) return falha("entrada_invalida", "sem agente responsável que possa trabalhar: o bot não tem conversa própria");
      events.push(...r.events);
      trabalho = { numero: r.execucao.numero, ...(op.tipo === "recado" ? { entregue: "novo" as const } : {}) };
    }
  }
  events.unshift(eventoQuadro(deps, p, q, null, [t.id]));
  const atual = (await deps.repos.quadros.tarefa(t.id)) ?? t;
  const trabalhos = await trabalhosDaTarefa(deps, atual);
  const estado = trabalhos.execucoes.find((e) => e.numero === trabalho.numero)?.estado ?? null;
  return { data: { ok: true, quadro: await montarQuadro(deps, q), lote: null, comecaram: [], desfeito: false, trabalho: { ...trabalho, estado }, trabalhos }, events };
}

/** Os trabalhos de uma tarefa do quadro do bot da tela. Só lê. */
export const verTrabalhos: CasoDeUso<{ agenteId: string; tarefaId: string }, ExecucoesDaTarefa> = async (deps, input) => {
  if (!(await experimentoLigado(deps))) throw new ErroDeDominio("nao_permitido", { cause: "experimento quadro desligado" });
  const q = await deps.repos.quadros.doAgente(input.agenteId);
  const t = q ? (await deps.repos.quadros.tarefas(q.id)).find((x) => x.id === input.tarefaId) : undefined;
  if (!t) throw new ErroDeDominio("nao_encontrado", { cause: "tarefa fora do quadro" });
  return { data: await trabalhosDaTarefa(deps, t) };
};

/**
 * Os recados pendentes da tarefa cujo trabalho roda nesta cadeia, emoldurados como fala da pessoa (o renovar da ponte
 * os põe na sessão viva e confirma pelo id quando a sessão os aceita). Vazio = o turno não é de um trabalho do quadro.
 */
export async function ofertarRecadosDoQuadro(deps: Deps, turnoId: string): Promise<{ id: string; texto: string }[]> {
  // Só o turno de um trabalho do quadro (o começo é delegação; a cadeia, retomadas): a conversa, a rotina e o colega
  // não leem nada daqui (sai cedo, sem subir cadeia).
  const turno = await deps.repos.turnos.buscar(turnoId);
  if (!turno || (turno.origem !== "delegacao" && turno.origem !== "retomada")) return [];
  // Roda em toda renovação: sem nenhum recado pendente da pessoa (o comum), nem sobe a cadeia (revisão 2 do PR #625).
  if (!(await deps.repos.quadroExecucoes.temRecadoPendente())) return [];
  const raiz = await deps.repos.turnos.raizDaCadeia(turnoId);
  const execucao = raiz ? await deps.repos.quadroExecucoes.doTurnoRaiz(raiz.id) : null;
  if (!execucao || execucao.canceladaEm !== null) return [];
  const pendentes = await deps.repos.quadroExecucoes.recadosPendentes(execucao.tarefaId);
  if (pendentes.length === 0) return [];
  const t = await deps.repos.quadros.tarefa(execucao.tarefaId);
  if (!t) return [];
  // O recado vai para o trabalho vivo mais recente da tarefa (o mesmo que a nota da tela aponta), seja o que a tarefa
  // guarda, seja o de um comentário.
  const execs = await deps.repos.quadroExecucoes.daTarefa(t.id);
  const vivo = rodandoDe(vivosDe(execs, await desfechosDe(deps, execs)));
  if (vivo?.e.id !== execucao.id) return [];
  const pessoaNome = (await deps.repos.pessoas.buscar(deps.escopo.pessoaId))?.nome ?? "a pessoa";
  const nomes = await nomesDeQuemRepassou(deps, pendentes);
  return pendentes.map((r) => ({ id: r.id, texto: molduraDoRecado({ titulo: t.titulo, texto: r.texto, pessoaNome, repassadoPor: r.repassadoPor ? nomes.get(r.repassadoPor) ?? null : null }) }));
}

/**
 * Revisão 3 do PR #625: a cadeia deste turno é de um trabalho do quadro que já foi substituído ou tratado de vez — o
 * Retomar dela rodaria a cadeia velha junto do trabalho novo, ou com o card Bloqueado. Substituído: cancelado, ou com
 * um trabalho posterior na tarefa que não seja de comentário (o de comentário roda ao lado, não no lugar). Tratado de
 * vez: o fim já foi tratado e a tarefa ficou bloqueada por ele (o caminho é o Repetir). null = pode retomar (não é
 * trabalho do quadro, ou é o atual e a tarefa não está bloqueada: o varredor reabre o trabalho quando a retomada nasce).
 */
export async function cadeiaDoQuadroEncerrada(deps: Pick<Deps, "repos">, turnoId: string): Promise<string | null> {
  const raiz = await deps.repos.turnos.raizDaCadeia(turnoId);
  const execucao = raiz ? await deps.repos.quadroExecucoes.doTurnoRaiz(raiz.id) : null;
  if (!execucao) return null;
  if (execucao.canceladaEm !== null) return "o trabalho do quadro foi cancelado";
  const execs = await deps.repos.quadroExecucoes.daTarefa(execucao.tarefaId);
  if (execs.some((e) => e.numero > execucao.numero && e.origem !== "comentario")) return "o trabalho do quadro já foi substituído por outro";
  if (execucao.tratadaEm === null) return null;
  const t = await deps.repos.quadros.tarefa(execucao.tarefaId);
  const q = t ? await deps.repos.quadros.buscar(t.quadroId) : null;
  if (t && q && t.turnoId === execucao.turnoId && estaBloqueada(q, t)) return "a tarefa do quadro está bloqueada: use Repetir";
  return null;
}

/**
 * O passo do varredor (por pessoa): o fim de cada trabalho ainda não tratado. Só o trabalho atual da tarefa (o turno que
 * ela guarda) repete ou bloqueia; o que um lote já substituiu só fica tratado. O trabalho tratado cuja cadeia ganhou uma
 * retomada viva (o "Retomar" da queda, a resposta que chegou depois) é reaberto: volta a ser tratado quando ela acabar.
 * O recado que a sessão não leu vira o próximo trabalho quando nada está vivo e a tarefa anda; fora do andamento (Feito,
 * Cancelado) ele sai cancelado. O trabalho novo roda onde o anterior rodou (o executor do turno).
 *
 * Revisão 3 do PR #625: cada tarefa roda em `isolar` (o varredor passa um SAVEPOINT): a que lança volta sozinha, fica no
 * log com o id e as outras saem. Sem `isolar` (os testes que não querem), cada tarefa só ganha o try/catch.
 */
export async function cuidarDasExecucoesDoQuadro(deps: Deps, o: { isolar?: Isolar } = {}): Promise<{ tratadas: number; events: RuntimeEvent[]; falharam: string[] }> {
  if (!(await experimentoLigado(deps))) return { tratadas: 0, events: [], falharam: [] };
  const isolar: Isolar = o.isolar ?? ((fn) => fn());
  const events: RuntimeEvent[] = [];
  const falharam: string[] = [];
  let tratadas = 0;
  // As travas dos quadros ficam até o fim da transação: em ordem de id (revisão 2 do PR #625), dois varredores ou um
  // varredor e um lote que pegam mais de um quadro não se travam um esperando o outro.
  const abertas: TarefaQuadro[] = [];
  for (const id of await deps.repos.quadroExecucoes.tarefasAbertas()) {
    const antes = await deps.repos.quadros.tarefa(id);
    if (antes) abertas.push(antes);
  }
  abertas.sort((x, y) => (x.quadroId === y.quadroId ? (x.id < y.id ? -1 : 1) : x.quadroId < y.quadroId ? -1 : 1));
  for (const antes of abertas) {
    try {
      const r = await isolar(() => cuidarDaTarefa(deps, antes));
      tratadas += r.tratadas;
      events.push(...r.events);
    } catch (e) {
      falharam.push(antes.id);
      log("erro", "execucoes_quadro_tarefa_falhou", { tarefa_id: antes.id, quadro_id: antes.quadroId, erro: ehErroDeDominio(e) ? e.codigo : e instanceof Error ? e.name : "desconhecido" });
    }
  }
  return { tratadas, events, falharam };
}

/** Um passo do varredor numa tarefa, com o quadro travado. Os eventos só saem se a tarefa inteira passou. */
async function cuidarDaTarefa(deps: Deps, antes: TarefaQuadro): Promise<{ tratadas: number; events: RuntimeEvent[] }> {
  const events: RuntimeEvent[] = [];
  let tratadas = 0;
  // Com a trava do quadro: um lote ou um Repetir concorrente termina antes, e a decisão sai com a tarefa de agora.
  const q = await deps.repos.quadros.buscarTravado(antes.quadroId);
  const t = q ? await deps.repos.quadros.tarefa(antes.id) : null;
  if (!q || !t) return { tratadas, events };
  const execs = await deps.repos.quadroExecucoes.daTarefa(t.id);
  const desfechos = await desfechosDe(deps, execs);
  // O executor do trabalho anterior (o turno atual da cadeia; o da tarefa, se a cadeia foi podada). Sem nenhum, nada
  // novo abre: não há onde rodar sem chutar. Revisão 5 do PR #625: o último trabalho da tarefa, não o de um comentário
  // (que roda ao lado, noutro turno): o estado dele decide se o recado guardado vira trabalho sozinho.
  const ultimo = [...execs].reverse().find((e) => e.origem !== "comentario") ?? execs.at(-1);
  const guardado = t.turnoId ? await deps.repos.turnos.buscar(t.turnoId) : null;
  const executor: Executor | undefined = (ultimo ? desfechos.get(ultimo.turnoId)?.executor : undefined) ?? guardado?.executor;
  const p: PedidoLote | null = executor ? { autor: { tipo: "pessoa" }, ops: [], executor, profundidade: 0 } : null;
  const haRecado = (await deps.repos.quadroExecucoes.recadosPendentes(t.id)).length > 0;
  let vivo = vivosDe(execs, desfechos).length > 0;
  let bloqueou = false;
  /** Bloqueado (ou Precisa de você): o motivo na linha 1 do card e o aviso na conversa do responsável. */
  const bloquear = async (e: ExecucaoQuadro, motivo: string): Promise<void> => {
    // Revisão 3 do PR #625: Bloqueado solta a cadeia velha (o Retomar não a roda com o card parado; o caminho é o Repetir).
    events.push(...(await soltarCadeias(deps, [e.turnoId], REGRA_TRABALHO_TRATADO)));
    const atual = (await deps.repos.quadros.tarefa(t.id)) ?? t;
    const destino = colunasDe(q).some((c) => c.id === "bloqueado") ? "bloqueado" : "voce";
    const salva = await deps.repos.quadros.salvarTarefa(t.id, { ...atual, status: destino, voltarPara: atual.status, pergunta: motivo });
    events.push(eventoQuadro(deps, DO_VARREDOR, q, null, [t.id]));
    // Revisão 5 do PR #625: a tarefa escrita de fora (deFora) não leva o título ao aviso: o texto dela fica fora da conversa.
    const texto = atual.deFora ? `Uma tarefa parou no quadro. ${motivo}` : `"${atual.titulo}" parou no quadro. ${motivo}`;
    const aviso = salva && atual.agenteId ? await avisarComVoce(deps, salva, atual.agenteId, { texto, chave: e.id }) : null;
    if (aviso) events.push(aviso);
    bloqueou = true;
  };
  for (const e of execs) {
    const d = desfechos.get(e.turnoId);
    const estado = estadoDaExecucao(e, d);
    if (!terminada(estado)) {
      if (e.tratadaEm !== null && (await deps.repos.quadroExecucoes.reabrir(e.id))) events.push(eventoQuadro(deps, DO_VARREDOR, q, null, [t.id]));
      continue;
    }
    if (e.tratadaEm !== null) continue;
    await deps.repos.quadroExecucoes.tratar(e.id, ...desfechoDoFim(estado as DesfechoExecucao, d));
    tratadas++;
    if (e.turnoId !== t.turnoId || vivo) continue;
    const decisao = decidirAposTermino({ estado, desfecho: d, automaticasSeguidas: tentativasAutomaticasSeguidas(execs), haRecado, andando: andando(q, t) });
    if (decisao.tipo === "repetir") {
      // Revisão 4 do PR #625: a nova tentativa espera INTERVALO_NOVA_TENTATIVA_MS depois do tratamento (a queda da
      // máquina costuma durar mais que um passo do varredor). Ela abre num passo seguinte. Revisão 5: a hora sai do
      // relógio do app (deps.agora()), o mesmo que decide se venceu. Sem onde rodar (nenhum executor), Bloqueado.
      if (p) await deps.repos.quadroExecucoes.agendarNovaTentativa(e.id, deps.agora() + INTERVALO_NOVA_TENTATIVA_MS);
      else await bloquear(e, SEM_NOVA_TENTATIVA);
    } else if (decisao.tipo === "bloquear") {
      await bloquear(e, decisao.motivo);
    }
  }
  // A nova tentativa agendada que venceu sempre sai da agenda (revisão 5 do PR #625: com o recado guardado no Backlog
  // ela ficava agendada e prendia a tarefa no varredor). Abre se o trabalho ainda é o atual, nada está vivo e a tarefa
  // anda; com recado pendente, quem abre é o recado (logo abaixo). Devia abrir e não abriu (sem onde rodar, o bot sem
  // conversa): Bloqueado com aviso — o caminho é o Repetir. A que ainda não venceu fica para o próximo passo.
  const agendada = execs.find((e) => e.novaTentativaEm !== null);
  let faltouAbrir: ExecucaoQuadro | null = null;
  if (agendada && agendada.novaTentativaEm! <= deps.agora()) {
    await deps.repos.quadroExecucoes.desagendarNovaTentativa({ id: agendada.id });
    const deveAbrir = !bloqueou && agendada.turnoId === t.turnoId && agendada.canceladaEm === null && !vivo && andando(q, t);
    if (deveAbrir) faltouAbrir = agendada;
    const r = deveAbrir && !haRecado && p ? await novoTrabalho(deps, p, q, t, "automatica") : null;
    if (r) {
      // Revisão 3 do PR #625: com a nova tentativa aberta (na mesma transação), a cadeia velha solta o que esperava (o
      // "Retomar" que a queda abriu, consequencias em interromper-por-maquina.ts): o Retomar tardio não a roda junto do
      // trabalho novo.
      events.push(...(await soltarCadeias(deps, [agendada.turnoId], REGRA_TRABALHO_TRATADO)));
      events.push(...r.events, eventoQuadro(deps, DO_VARREDOR, q, null, [t.id]));
      vivo = true;
      faltouAbrir = null;
    }
  }
  // O recado entra quando nada está vivo e a tarefa anda: o fim que acabou de ser tratado (entregar_recado) ou um que
  // já estava. A tarefa que saiu do andamento (Feito, Cancelado) não reabre trabalho: o recado sai cancelado.
  if (haRecado && !vivo && !bloqueou) {
    const atual = (await deps.repos.quadros.tarefa(t.id)) ?? t;
    const papel = papelDe(colunasDe(q), atual.status);
    if (papel === "feito" || papel === "cancelado") {
      await deps.repos.quadroExecucoes.cancelarRecados(t.id);
      return { tratadas, events };
    }
    // Revisão 4 do PR #625: a mesma regra do Repetir (podeAbrirTrabalho: Backlog não abre) e o trabalho que terminou
    // cancelado (o Parar de fora, sem o Cancelar do quadro) não vira outro sozinho. O recado fica guardado: vai no
    // próximo Repetir ou início (e a tarefa sai da conta do varredor: tarefasAbertas).
    const ultimoEstado = ultimo ? estadoDaExecucao(ultimo, desfechos.get(ultimo.turnoId)) : null;
    if (!podeAbrirTrabalho(q, atual) || ultimoEstado === "cancelado") return { tratadas, events };
    const r = p ? await novoTrabalho(deps, p, q, atual, "recado") : null;
    if (r) {
      // O recado tomou o lugar da nova tentativa agendada: a cadeia dela solta o que esperava, como a tentativa faria.
      if (agendada && agendada.novaTentativaEm !== null) events.push(...(await soltarCadeias(deps, [agendada.turnoId], REGRA_TRABALHO_TRATADO)));
      events.push(...r.events, eventoQuadro(deps, DO_VARREDOR, q, null, [t.id]));
      faltouAbrir = null;
    }
  }
  if (faltouAbrir) await bloquear(faltouAbrir, SEM_NOVA_TENTATIVA);
  return { tratadas, events };
}

/** Revisão 5 do PR #625: a nova tentativa sozinha não abriu (o bot sem onde rodar ou sem conversa). */
const SEM_NOVA_TENTATIVA = "Não deu para abrir a nova tentativa sozinho: o bot ficou sem onde rodar. Use Repetir.";

/** A trilha do que o varredor muda no quadro (sem turno de quem chamou). */
const DO_VARREDOR = { autor: { tipo: "pessoa" } } as const;
