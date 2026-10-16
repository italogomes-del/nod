import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { CotaDaIa } from "../contracts/cota.ts";
import { HARNESS_LEGADO, HARNESSES, type IdHarness } from "../contracts/harness.ts";
import type { Inventario } from "../contracts/inventario.ts";
import type { PlanoTurno } from "../contracts/plano-turno.ts";
import type { Turno } from "../contracts/turno.ts";
import { portaoDaCota } from "../domain/cota-da-ia.ts";
import { entradaDaFila } from "../domain/entrada-da-fila.ts";
import { ehErroDeDominio, ErroDeDominio } from "../domain/erro.ts";
import { causaHarnessIndisponivel, harnessFixado, inventarioHarnessSemSonda } from "../domain/harness.ts";
import { esperaDoAutomatico, iasParaOAutomatico } from "../domain/inteligencia.ts";
import { autoriaAgente, autoriaPessoa, evento, inventarioAusente, motorDe } from "./autoria-evento.ts";
import { mensagemExecutorIndisponivel } from "./enviar-mensagem.ts";
import { sincronizarDoTurno } from "./trabalhos.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";
import { IAS_COM_CONTA } from "../contracts/contas-ia.ts";
import { PRAZO_SEM_HORARIO_MS } from "../domain/contas-da-ia.ts";
import { inteligenciaDoAgente } from "../domain/inteligencia.ts";
import { log } from "../obs/log.ts";
import { criarNotaDeContas, escolherContaDoTurno, lerContasDaMaquina, notaIgualAberta, semContaParaOTurno, voltaDaNota } from "./contas-do-turno.ts";
import { esperarContaNaFrente } from "./assentar-turno.ts";
import { adiarFala, vigiarLaco } from "./adiar-fala.ts";
import { quandoDaFrase } from "../domain/erro-fornecedor.ts";
import { redigir } from "../domain/redacao.ts";


export type EntradaDespacharTurno = {
  machineId: string;
  executor?: Executor;
  /** Inventário anunciado pela máquina no conectar (ADR-021); ausente = lê o registrado; nenhum = 'ausente'. */
  inventario?: Inventario;
  harnessesProntos?: readonly string[];
  /**
   * NOD-171: os harnesses de TODAS as máquinas vivas da pessoa. Com ele, o reivindicar pega também o turno fixado num
   * harness que não está pronto em nenhuma delas, e o despacho o recusa nomeando o harness, em vez de deixá-lo pendente.
   */
  harnessesDaPessoa?: Partial<Record<IdHarness, Inventario>>;
  /** ADR-072: a máquina anunciou o laço de voz; só então recebe o turno da ligação. */
  aceitaLigacao?: boolean;
  /** ADR-085: o Mac está apertado pelo "uso do Mac" da pessoa — trabalho novo em segundo plano espera. */
  segurarFundo?: boolean;
  /** ADR-085 (revisão do #209): um trabalho novo em segundo plano acabou de começar neste Mac — o próximo espera a vez. */
  espacarFundo?: boolean;
  /** #219 (emenda à ADR-085): disco crítico — nenhum trabalho novo começa, nem o da pessoa. */
  segurarNovo?: boolean;
  /** #219: memória crítica — o segundo plano segurado espera mesmo depois da espera máxima. */
  fundoSemPrazo?: boolean;
  /** ADR-092: a máquina da ponte com o servidor no Mac (modo local) — só pega o turno que tem ela como alvo. */
  soComoAlvo?: boolean;
  /**
   * 0068 (emenda da ADR-036): as IAs da pessoa no limite da assinatura agora. Um turno do Automático não vai para uma
   * máquina que só tem IA no limite enquanto outra máquina viva da pessoa tiver uma fora dele (iasParaOAutomatico).
   */
  noLimite?: readonly string[];
  /**
   * definido em 2026-10-12 (ADR-099 §7): as IAs da pessoa que seguram trabalho de fundo pela cota (cotaDasIas). Ausente ou
   * vazio = nada segura. A conversa com a pessoa nunca espera por isto.
   */
  cota?: readonly CotaDaIa[];
};

export type MotivoSemPlano = "parada_ativa" | "fila_vazia" | "executor_indisponivel" | "ligacao_encerrada";
export type SaidaDespacharTurno = { plano: PlanoTurno; turno: Turno; motivo: null } | { plano: null; turno: Turno | null; motivo: MotivoSemPlano };

/**
 * PUXAR (ADR-021/024): gate de parada persistida → reivindicar (UPDATE condicional, ADR-010) →
 * gate pré-spawn do inventário (ADR-019) → plano emitido na MESMA tx (services.planos.emitir, L5).
 * Fail-closed (E8.1/EMENDA 10): paradasRepo.ativa devolvendo null (consulta falhou) é tratado como
 * parada — antes da reivindicação nada acontece; depois, lança e a tx desfaz a reivindicação.
 */
export const despacharTurno: CasoDeUso<EntradaDespacharTurno, SaidaDespacharTurno> = async (deps, input) => {
  const agora = deps.agora();
  const executor = input.executor ?? "catcher";
  const pessoaId = deps.escopo.pessoaId;

  const paradaGlobal = await deps.repos.paradas.ativa(pessoaId, null);
  if (paradaGlobal !== false) return { data: { plano: null, turno: null, motivo: "parada_ativa" } };

  // A sonda lenta re-sonda em segundos (NOD-178): o turno fixado nesse harness espera, como antes, em vez de ser recusado.
  const prontosPessoa = input.harnessesProntos && input.harnessesDaPessoa
    ? [...new Set([...input.harnessesProntos, ...Object.entries(input.harnessesDaPessoa).filter(([, i]) => i?.estado === "pronto" || (i?.estado === "ausente" && i.causa === "sonda_lenta")).map(([id]) => id)])]
    : undefined;
  const harnessesAuto = input.harnessesProntos && input.noLimite?.length
    ? iasParaOAutomatico({ prontosMaquina: input.harnessesProntos, prontosPessoa: [...new Set([...input.harnessesProntos, ...Object.entries(input.harnessesDaPessoa ?? {}).filter(([, i]) => i?.estado === "pronto").map(([id]) => id)])], noLimite: input.noLimite })
    : undefined;
  // ADR-099 §7: o turno do Automático segura pela cota só se todas as IAs que podem pegá-lo nesta máquina seguram (sem a
  // lista, app anterior: a IA de sempre).
  const cota = input.cota?.length ? portaoDaCota(input.cota, harnessesAuto ?? input.harnessesProntos ?? [HARNESS_LEGADO]) : null;
  const turno = await deps.repos.turnos.reivindicar({ machineId: input.machineId, agora, harnessesProntos: input.harnessesProntos, ...(harnessesAuto ? { harnessesAuto } : {}), harnessesProntosPessoa: prontosPessoa, aceitaLigacao: input.aceitaLigacao, segurarFundo: input.segurarFundo, segurarNovo: input.segurarNovo, fundoSemPrazo: input.fundoSemPrazo, espacarFundo: input.espacarFundo, ...(input.soComoAlvo ? { soComoAlvo: true } : {}), ...(cota ? { cota } : {}) });
  if (!turno) return { data: { plano: null, turno: null, motivo: "fila_vazia" } };
  // NOD-268: o alarme do reenvio em laço (só log; o freio é o teto de reenvios). Revisão do PR #319: a falha da consulta
  // não derruba o despacho de um turno já reivindicado.
  await vigiarLaco(deps, turno, agora).catch((e: unknown) => log("aviso", "vigia_do_laco_falhou", { turno_id: turno.id, erro: e instanceof Error ? e.name : "desconhecido" }));

  // Auditoria A3 (definido em 2026-10-15): o turno-cérebro de uma ligação que já acabou (a pessoa desligou, o prazo do
  // primeiro cérebro venceu, o deploy encerrou) antes de alguma máquina pegá-lo. O plano recusaria com estado_invalido,
  // a ponte desfaria a reivindicação e o mesmo turno voltaria a cada puxar — a ligação passa na frente de tudo, então a
  // máquina com voz não recebia mais nada. Assenta aqui, na mesma tx, e o próximo puxar segue a fila. Só este caso: um
  // erro de domínio qualquer no plano continua desfazendo a reivindicação.
  if (turno.origem === "ligacao") {
    const ligacao = turno.ligacaoId ? await deps.repos.ligacoes.buscar(turno.ligacaoId) : null;
    if (!ligacao || (ligacao.estado !== "chamando" && ligacao.estado !== "em_curso")) {
      const assentado = await encerrarCerebroSemLigacao(deps, turno, executor, agora);
      // Revisão do PR #316: sem o `interromper` assentar, devolver `plano: null` comitaria a reivindicação e o turno
      // ficaria `despachando` nesta máquina sem plano até o varredor de lease. Lança: a tx desfaz, como antes da A3.
      if (assentado.events.length === 0) throw new ErroDeDominio("estado_invalido", { cause: "turno-cérebro sem ligação não assentou depois da reivindicação" });
      return assentado;
    }
  }

  const paradaConversa = await deps.repos.paradas.ativa(pessoaId, turno.conversaId);
  if (paradaConversa === null) throw new ErroDeDominio("estado_invalido", { cause: "consulta de parada falhou depois da reivindicação" });
  if (paradaConversa) {
    const interrompido = await deps.repos.turnos.interromper(turno.id, "parado_pela_pessoa");
    const autoria = autoriaPessoa(deps.escopo, executor);
    return {
      data: { plano: null, turno: interrompido ?? turno, motivo: "parada_ativa" },
      events: [evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: "parado_pela_pessoa", origem: turno.origem } }), ...(await sincronizarDoTurno(deps, turno))],
    };
  }

  // O inventário anunciado pela máquina decide o gate; quem o PERSISTE por pessoa é a sonda com cache da
  // L4 (callback injetado), não o puxar — definido em 2026-09-16: um upsert por puxar (a cada 1 s por pessoa)
  // é churn e travou com o advisory lock da reivindicação em dois puxares paralelos da mesma pessoa.
  const inventario = input.inventario ?? (await deps.repos.inventario.buscar(motorDe(executor))) ?? inventarioAusente(agora);
  if (inventario.estado !== "pronto") return recusarPorExecutor(deps, { turno, executor, inventario, agora, semIaOnde: "maquina_do_bot" });

  // NOD-171: fixado num harness que esta máquina não tem pronto. O reivindicar só entrega isso quando nenhuma máquina
  // viva da pessoa o tem (harnessesProntosPessoa): recusa já, nomeando o harness, e o turno não fica preso na fila.
  const fixo = harnessFixado(turno.harness, turno.modelo);
  if (fixo && input.harnessesProntos && !input.harnessesProntos.includes(fixo)) {
    const doHarness = input.harnessesDaPessoa?.[fixo] ?? inventarioHarnessSemSonda(agora);
    return recusarPorExecutor(deps, { turno, executor, inventario: doHarness, agora, harness: fixo });
  }

  // ADR-102 (2026-10-13): a máquina tem contas anunciadas e nenhuma serve sem a pessoa decidir — na conversa, a nota com
  // as contas livres (sem gastar turno pago); no fundo (task, rotina), o turno volta à fila até a primeira conta renovar.
  if (executor !== "catcher" && turno.origem !== "ligacao") {
    const semConta = await semContaNaMaquina(deps, { turno, machineId: input.machineId, executor, harnessesProntos: input.harnessesProntos, agora });
    if (semConta) return semConta;
  }

  // Fila lida junta (definido em 2026-09-24), só depois dos gates: um turno recusado não arrasta as outras
  // falas. As demais pendentes desta conversa entram neste turno e cada uma sai 'absorvido'.
  const { turno: comFila, absorvidos } = await deps.repos.turnos.absorverPendentes(turno, entradaDaFila);
  const autoria = autoriaPessoa(deps.escopo, executor);
  const events = absorvidos.map((a) => evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: a.conversaId, turnoId: a.id, dados: { motivo: "absorvido", absorvido_por: comFila.id } }));

  // NOD-268: o Automático com todas as IAs desta máquina no limite não roda a primeira delas (gastaria o turno e voltaria
  // como mais um reenvio): a fala (já com a fila junta) espera a renovação mais próxima, com uma linha.
  const adiado = await adiarNoAutomatico(deps, { turno: comFila, executor, prontos: input.harnessesProntos, noLimite: input.noLimite, agora });
  if (adiado) return { data: adiado.data, events: [...events, ...adiado.events] };

  try {
    const plano = await deps.tx((trx) => deps.services.planos.emitir(trx, comFila.id, input.machineId));
    // ADR-083: o trabalho do turno passa a rodando (ou a precisa de você, se uma decisão dele segue aberta).
    events.push(...(await sincronizarDoTurno(deps, comFila)));
    return { data: { plano, turno: comFila, motivo: null }, events };
  } catch (e) {
    // montarPlano recusa a localidade (inventário mudou entre o gate e o plano): mesmo caminho, nunca silêncio.
    // NOD-171: com a causa, a recusa fala do harness que faltou (e do modelo inválido), nunca do motor.
    if (ehErroDeDominio(e) && e.codigo === "executor_indisponivel") {
      const causa = causaHarnessIndisponivel(e);
      if (!causa) return recusarPorExecutor(deps, { turno, executor, inventario, agora, semIaOnde: "maquina_do_bot" });
      const doHarness = causa.inventario ?? input.harnessesDaPessoa?.[causa.harness] ?? (causa.motivo === "modelo_invalido" ? inventario : inventarioHarnessSemSonda(agora));
      return recusarPorExecutor(deps, { turno, executor, inventario: doHarness, agora, harness: causa.harness, modeloInvalido: causa.motivo === "modelo_invalido" ? causa.modelo : undefined });
    }
    throw e;
  }
};

/**
 * NOD-268: turno da conversa no Automático (que ainda não esperou) numa máquina cujas IAs prontas estão TODAS no limite.
 * null = roda como antes (há IA fora do limite, a lista não veio, ou a fala já esperou uma vez).
 */
async function adiarNoAutomatico(
  deps: Deps,
  p: { turno: Turno; executor: Executor; prontos?: readonly string[]; noLimite?: readonly string[]; agora: number },
): Promise<{ data: SaidaDespacharTurno; events: RuntimeEvent[] } | null> {
  const { turno, agora } = p;
  if (turno.origem !== "conversa" || turno.harness !== "auto" || turno.modelo !== "auto" || (turno.acordarEm ?? null) !== null || turno.pararSolicitadoEm !== null) return null;
  const prontos = p.prontos ?? [];
  if (prontos.length === 0 || !prontos.every((id) => p.noLimite?.includes(id))) return null;
  const limites = (await deps.repos.preferencias.buscar()).iasNoLimite;
  const acordarEm = esperaDoAutomatico({ prontos, limites, agora });
  if (acordarEm === null) return null;
  const ia = (prontos.find((id) => limites?.[id as IdHarness]?.renovaEm === acordarEm) ?? prontos[0]) as IdHarness;
  const assentado = await deps.repos.turnos.assentar(turno.id, { estado: "interrompido", motivoInterrupcao: "executor_indisponivel", motivoFalha: "limite_do_plano" });
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor: p.executor, localityReason: "motor_ausente" });
  const texto = redigir("fala-no-limite-espera", agora, { ia: HARNESSES.find((h) => h.id === ia)?.nome ?? ia, quando: quandoDaFrase(acordarEm, agora) });
  const adiada = await adiarFala(deps, { turno, executor: p.executor, acordarEm, autoria, agora, texto, causa: "todas_no_limite" });
  const events: RuntimeEvent[] = [
    evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: "executor_indisponivel", motivo_falha: "limite_do_plano", ia_no_limite: ia, renova_em: acordarEm } }),
    ...(adiada ?? []),
    // Revisão do PR #319: a fala mandada a uma task muda o estado dela como nas outras saídas do despacho.
    ...(await sincronizarDoTurno(deps, turno)),
  ];
  return { data: { plano: null, turno: assentado ?? turno, motivo: "executor_indisponivel" }, events };
}

/** Auditoria A3: a regra que assenta o turno-cérebro de uma ligação que já acabou (autoria do evento). */
export const REGRA_CEREBRO_SEM_LIGACAO = "regra:cerebro-sem-ligacao" as const;

/**
 * Auditoria A3: o turno-cérebro sem ligação viva sai `interrompido`. `parado_pela_pessoa` porque o enum de motivos não
 * tem outro que sirva (o mesmo critério do varredor de órfãos, NOD-219); a causa vai no evento. Sem mensagem na conversa:
 * a linha "Chat de voz" já diz como a ligação terminou.
 */
export async function encerrarCerebroSemLigacao(deps: Deps, turno: Turno, executor: Executor, agora: number): Promise<{ data: SaidaDespacharTurno; events: RuntimeEvent[] }> {
  // Revisão do PR #316: no despacho o turno já foi reivindicado (`despachando`); no fim da ligação, `pendente`. Lido antes
  // do `interromper` (o repo em memória muda o mesmo objeto).
  const estava = turno.estado;
  const interrompido = await deps.repos.turnos.interromper(turno.id, "parado_pela_pessoa");
  log("info", "cerebro_sem_ligacao", { turno_id: turno.id, ligacao_id: turno.ligacaoId ?? null });
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor, decididoPor: REGRA_CEREBRO_SEM_LIGACAO });
  return {
    data: { plano: null, turno: interrompido ?? turno, motivo: "ligacao_encerrada" },
    events: interrompido ? [evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: "parado_pela_pessoa", causa: "ligacao_encerrada", estava, ligacao_id: turno.ligacaoId ?? null } })] : [],
  };
}

async function semContaNaMaquina(
  deps: Deps,
  p: { turno: Turno; machineId: string; executor: Executor; harnessesProntos?: readonly string[]; agora: number },
): Promise<{ data: SaidaDespacharTurno; events: RuntimeEvent[] } | null> {
  const { turno, agora } = p;
  if (!(await deps.repos.contasIa.temContaNaMaquina(p.machineId))) return null;
  const c = await lerContasDaMaquina(deps, p.machineId);
  if (c.naMaquina.size === 0) return null;
  const agente = await deps.repos.agentes.buscar(turno.agenteId);
  const r = escolherContaDoTurno(c, agente ? inteligenciaDoAgente(agente).ordem : null, agora);
  const fixo = harnessFixado(turno.harness, turno.modelo);
  const sem = semContaParaOTurno(c, r, fixo ? [fixo] : (p.harnessesProntos ?? IAS_COM_CONTA), agora);
  if (!sem) return null;
  const assentado = await deps.repos.turnos.assentar(turno.id, { estado: "interrompido", motivoInterrupcao: "executor_indisponivel", motivoFalha: "limite_do_plano" });
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor: p.executor, localityReason: "motor_ausente" });
  if (turno.origem !== "conversa") {
    // ADR-099 §7: nenhuma frente falha por limite — a task espera a conta voltar (1 h sem horário do fornecedor).
    const volta = sem.voltaEm !== null && sem.voltaEm > agora ? sem.voltaEm : agora + PRAZO_SEM_HORARIO_MS;
    const espera = await esperarContaNaFrente(deps, { turno, executor: p.executor, ia: sem.de.ia, renovaEm: volta, autoria, agora });
    if (espera) {
      log("info", "turno_sem_conta_espera", { turno_id: turno.id, acordar_em: volta });
      return { data: { plano: null, turno: assentado ?? turno, motivo: "executor_indisponivel" }, events: [...espera, ...(await sincronizarDoTurno(deps, turno))] };
    }
  }
  // NOD-268 (regressão de 15/10: dez despachos, dez notas iguais): a nota da mesma conta e da mesma volta, ainda aberta,
  // não se repete. Na conversa, a fala espera a conta voltar (1 h sem horário), em silêncio — a nota já diz a hora.
  const repetida = await notaIgualAberta(deps, { conversaId: turno.conversaId, contaId: sem.de.id, voltaEm: voltaDaNota(sem.decisao, sem.voltaEm, agora) });
  const volta = voltaDaNota(sem.decisao, sem.voltaEm, agora) ?? agora + PRAZO_SEM_HORARIO_MS;
  const adiada = await adiarFala(deps, { turno, executor: p.executor, acordarEm: volta, autoria, agora, texto: null, causa: "sem_conta" });
  // QA do NOD-268: a rotina sem task não espera (adiarFala é só da conversa) e cada execução é um turno novo — com a nota
  // igual aberta, ela assenta calada (só log); a nota já diz a hora. A fala da conversa que já esperou ganha a nota de novo.
  const calada = repetida && (adiada !== null || turno.origem !== "conversa");
  const events: RuntimeEvent[] = [
    evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: "executor_indisponivel", motivo_falha: "limite_do_plano", sem_conta: true } }),
    // Revisão do PR #319: a fala que já esperou não espera de novo — sem a nota, ela sumiria calada (nunca silêncio).
    ...(calada ? [] : await criarNotaDeContas(deps, { turno, autoria, agora, de: sem.de, decisao: sem.decisao, maquina: c.nomeDaMaquina ? { id: p.machineId, nome: c.nomeDaMaquina } : null, voltaEm: sem.voltaEm })),
    ...(adiada ?? []),
    ...(await sincronizarDoTurno(deps, turno)),
  ];
  log("info", "turno_sem_conta", { turno_id: turno.id, decisao: sem.decisao.tipo, nota_repetida: calada });
  return { data: { plano: null, turno: assentado ?? turno, motivo: "executor_indisponivel" }, events };
}

async function recusarPorExecutor(
  deps: Deps,
  p: { turno: Turno; executor: Executor; inventario: Inventario; agora: number; harness?: string; modeloInvalido?: string; semIaOnde?: "maquina_do_bot" },
): Promise<{ data: SaidaDespacharTurno; events: RuntimeEvent[] }> {
  // nao_autenticado/motor_ausente são MotivoFalha (do inventário, nunca do classificador); a interrupção é executor_indisponivel.
  const motivoFalha = p.inventario.estado === "nao_autenticado" ? "nao_autenticado" : "motor_ausente";
  const assentado = await deps.repos.turnos.assentar(p.turno.id, { estado: "interrompido", motivoInterrupcao: "executor_indisponivel", motivoFalha });
  const negacao = await mensagemExecutorIndisponivel(deps, { conversaId: p.turno.conversaId, turnoId: p.turno.id, agenteId: p.turno.agenteId, executor: p.executor, inventario: p.inventario, agora: p.agora, harness: p.harness, modeloInvalido: p.modeloInvalido, semIaOnde: p.semIaOnde });
  const autoria = autoriaAgente({ agenteId: p.turno.agenteId, contaDeExecucao: p.turno.ownerId, executor: p.executor, localityReason: "motor_ausente" });
  const events = [
    evento(deps.escopo, { kind: "turno_interrompido", autoria, agora: p.agora, conversaId: p.turno.conversaId, turnoId: p.turno.id, dados: { motivo: "executor_indisponivel", motivo_falha: motivoFalha, inventario: p.inventario.estado } }),
  ];
  if (negacao) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora: p.agora, conversaId: p.turno.conversaId, turnoId: p.turno.id, dados: { mensagem_id: negacao.id, kind: "negacao" } }));
  events.push(...(await sincronizarDoTurno(deps, p.turno)));
  return { data: { plano: null, turno: assentado ?? p.turno, motivo: "executor_indisponivel" }, events };
}
