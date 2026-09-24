import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import type { MotivoFalha, MotivoInterrupcao } from "../contracts/motivos.ts";
import type { Entrega } from "../contracts/ponte.ts";
import type { Turno } from "../contracts/turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { descreverNegacao } from "../domain/estado-degradacao.ts";
import { ultimoSinalDoTurno } from "../domain/incidente.ts";
import { motivoEmPortugues, redigir } from "../domain/redacao.ts";
import { delegacaoDoTurno, rotinaDoTurno } from "./apoio-l7.ts";
import { autoriaAgente, evento } from "./autoria-evento.ts";
import { aposQuedaDaMaquina } from "./interromper-por-maquina.ts";
import { postarNaSala } from "./postar-na-sala.ts";
import type { CasoDeUso } from "./tipos.ts";

export type EntradaAssentarTurno = Entrega & { executor?: Executor };
export type SaidaAssentarTurno = {
  turno: Turno | null;
  mensagem: Mensagem | null;
  /** (turno, seq_local) já entregue: nada regravado (ADR-021). */
  duplicada: boolean;
  /** Turno já terminal (varredor/parar chegaram antes): a fala entra como anexo parcial, sem reabrir (ADR-010). */
  tardia: boolean;
};

type Desfecho = { estado: "concluido" | "interrompido"; motivoInterrupcao: MotivoInterrupcao | null; motivoFalha: MotivoFalha | null };

/**
 * Regra do servidor (ADR-009, pendência da L2): o classificador não distingue parar de sumiço —
 * interrompido SEM motivo vira parado_pela_pessoa se a pessoa pediu (parar_solicitado_em), senão
 * sem_progresso. definido em 2026-09-16: com quatro estados (ADR-010) a falha técnica do CLI
 * (result com subtype ≠ success) é um turno INTERROMPIDO cujo motivo_falha guarda o subtipo.
 *
 * definido em 2026-09-24 (ADR-045): entrega que NÃO é sucesso com o lease já vencido e sem Parar é a
 * máquina que parou de responder (o Mac dormiu; a renovação voltou {ativo:false} e o laço matou o CLI)
 * — maquina_sem_contato, o mesmo desfecho do varredor. Sucesso depois do lease vencido é trabalho
 * TERMINADO e assenta como concluído.
 */
export function desfechoDaEntrega(turno: Pick<Turno, "pararSolicitadoEm" | "leaseAte">, resultado: Entrega["resultado"], agora: number): Desfecho {
  if (resultado.desfecho === "sucesso") return { estado: "concluido", motivoInterrupcao: null, motivoFalha: null };
  if (turno.pararSolicitadoEm === null && turno.leaseAte !== null && turno.leaseAte < agora) return { estado: "interrompido", motivoInterrupcao: "maquina_sem_contato", motivoFalha: resultado.motivoFalha ?? null };
  // definido em 2026-09-18: quem produziu saída e não concluiu NÃO é 'sem_progresso' — o rótulo
  // mentia num turno que tinha lido arquivos e escrito no chat antes de acabar. producedOutput é o
  // sinal que o ADR-009 já grava para isso.
  if (resultado.desfecho === "falha") return { estado: "interrompido", motivoInterrupcao: resultado.sinais.producedOutput ? "trabalho_incompleto" : "sem_progresso", motivoFalha: resultado.motivoFalha ?? "erro_execucao" };
  const semMotivo = turno.pararSolicitadoEm !== null ? "parado_pela_pessoa" : resultado.sinais.producedOutput ? "trabalho_incompleto" : "sem_progresso";
  const motivo = resultado.motivoInterrupcao ?? semMotivo;
  return { estado: "interrompido", motivoInterrupcao: motivo, motivoFalha: resultado.motivoFalha ?? null };
}

/**
 * ENTREGAR (ADR-021): idempotente por (turno, seq_local); grava a fala do agente (autoria composta,
 * confiança do turno, parcial se interrompido), sessão do CLI na conversa, gastos (ADR-015), o estado
 * terminal com motivo, negações de permissão renderizadas (ADR-029) e os eventos — tudo na MESMA tx.
 */
export const assentarTurno: CasoDeUso<EntradaAssentarTurno, SaidaAssentarTurno> = async (deps, entrega) => {
  const primeira = await deps.repos.turnos.registrarEntrega(entrega.turnoId, entrega.seqLocal);
  if (!primeira) return { data: { turno: null, mensagem: null, duplicada: true, tardia: false } };
  // Trava de linha: Parar (parar_solicitado_em) pode estar commitando em paralelo; a leitura espera por ele (ADR-009: quem decide o motivo é o servidor).
  const turno = await deps.repos.turnos.buscarTravado(entrega.turnoId);
  if (!turno) throw new ErroDeDominio("nao_encontrado");
  if (turno.machineId !== null && turno.machineId !== entrega.machineId) throw new ErroDeDominio("nao_permitido", { cause: "entrega de outra máquina" });

  const agora = deps.agora();
  const executor = entrega.executor ?? "catcher";
  const resultado = entrega.resultado;
  const tardia = turno.estado !== "pendente" && turno.estado !== "despachando";
  const desfecho = desfechoDaEntrega(turno, resultado, agora);
  const interrompido = tardia || desfecho.estado === "interrompido";
  // A máquina caiu (ADR-045): nesta entrega (lease vencido) ou antes dela, pelo varredor (tardia).
  const quedaDaMaquina = !tardia && desfecho.motivoInterrupcao === "maquina_sem_contato";
  // Lido AGORA: assentar zera lease_ate, e o último sinal de vida (lease − LEASE_MS) é o começo do aviso.
  const perdidoDesde = ultimoSinalDoTurno(turno, agora);
  const caiuAntes = tardia && turno.motivoInterrupcao === "maquina_sem_contato" && resultado.desfecho !== "sucesso";
  // definido em 2026-09-24 (ADR-045): rotina derrubada pela máquina não escreve na conversa — nem a
  // fala parcial, que seria um "Vou verificar…" cortado. A execução vai só para o histórico da rotina.
  // Sucesso tardio continua entrando: é trabalho terminado, e o entregável da rotina É a fala.
  const rotinaCaida = quedaDaMaquina || caiuAntes ? (await rotinaDoTurno(deps.repos, turno.id)) !== null : false;
  // definido em 2026-09-21: o agente chamou `sem_novidade` — consultou e nada mudou, então a fala
  // dele NÃO entra na conversa (era o flood de "nenhum update" a cada execução). Só vale onde
  // ninguém espera resposta: turno de rotina/retomada. Em conversa ou sala a pessoa ficaria no
  // vácuo, e por isso a ferramenta nem é oferecida nesses modos (plano-turno.ts).
  // Um turno interrompido não é silenciado: o texto pode ser um relato parcial de bloqueio, e o
  // silêncio só é honesto quando a execução foi completa.
  const silencioso = turno.semNovidadeMotivo !== null && !interrompido && (turno.origem === "rotina" || turno.origem === "retomada");
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor, machineId: entrega.machineId });
  const events: RuntimeEvent[] = [];

  let mensagem: Mensagem | null = null;
  if (entrega.fala.tipo === "passe") {
    const agente = await deps.repos.agentes.buscar(turno.agenteId);
    mensagem = await deps.repos.mensagens.criar({
      conversaId: turno.conversaId,
      turnoId: turno.id,
      autoria,
      kind: "passe",
      texto: redigir("passe", agora, { agente: agente?.nome ?? "agente", motivo: entrega.fala.motivo }),
      payload: { kind: "passe", motivo: entrega.fala.motivo },
      confianca: turno.entradaConfianca,
      parcial: interrompido,
    });
  } else if (entrega.fala.texto.trim() !== "" && turno.origem === "sala" && !tardia) {
    // definido em 2026-09-16 (pendência L7 §4): a fala de um bot numa sala entra por postarNaSala para os
    // responders (menção) e o orçamento do canal rodarem na MESMA tx — nunca por mensagens.criar direto.
    const conversa = await deps.repos.conversas.buscar(turno.conversaId);
    if (!conversa?.salaId) throw new ErroDeDominio("estado_invalido", { cause: "turno de sala sem sala" });
    const post = await postarNaSala(deps, { salaId: conversa.salaId, texto: entrega.fala.texto, autoria, confianca: turno.entradaConfianca, turnoId: turno.id, eRotina: false });
    mensagem = post.data.mensagem;
    events.push(...(post.events ?? []).filter((ev) => ev.kind !== "mensagem_criada"));
  } else if (entrega.fala.texto.trim() !== "" && !silencioso && !rotinaCaida) {
    mensagem = await deps.repos.mensagens.criar({
      conversaId: turno.conversaId,
      turnoId: turno.id,
      autoria,
      kind: "texto",
      texto: entrega.fala.texto,
      payload: null,
      confianca: turno.entradaConfianca,
      parcial: interrompido,
    });
  }
  if (mensagem) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: mensagem.id, kind: mensagem.kind, parcial: mensagem.parcial } }));

  // 0005: a sessão é do executor que a criou; o catcher não cria sessão real (devolve null).
  // definido em 2026-09-24 (ADR-044): a retomada ligada a uma rotina roda em sessão própria, como a
  // rotina (emitir-plano-turno.ts); gravá-la trocaria a sessão da conversa pela da execução agendada.
  // definido em 2026-09-24 (ADR-046): a tarefa delegada roda em sessão própria (emitir-plano-turno) e não
  // pode virar a sessão da conversa do alvo com a pessoa.
  const sessaoDaConversa = turno.origem !== "rotina" && turno.origem !== "peer" && turno.origem !== "delegacao"
    && !(turno.origem === "retomada" && ((await rotinaDoTurno(deps.repos, turno.id)) || (await delegacaoDoTurno(deps.repos, turno))));
  if (resultado.sessaoCli && sessaoDaConversa) await deps.repos.conversas.atualizarSessaoCli(turno.conversaId, resultado.sessaoCli, executor);
  await deps.repos.gastos.registrar({
    turnoId: turno.id,
    executor,
    tokensEntrada: resultado.tokens.entrada,
    tokensSaida: resultado.tokens.saida,
    custoUsd: resultado.custoUsd,
    modelo: turno.modelo,
    em: agora,
  });

  for (const nome of resultado.negacoesPermissao) {
    const negacao = { classe: "ferramenta_negada" as const, nome, motivo: "fora_do_catalogo" as const, desde: agora, terminal: false };
    const m = await deps.repos.mensagens.criar({
      conversaId: turno.conversaId,
      turnoId: turno.id,
      autoria,
      kind: "negacao",
      texto: descreverNegacao(negacao, agora),
      payload: { kind: "negacao", classe: negacao.classe, nome, motivo: negacao.motivo, terminal: false },
      confianca: "confiavel",
    });
    events.push(evento(deps.escopo, { kind: "negacao", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { nome, motivo: negacao.motivo, classe: negacao.classe, terminal: false, mensagem_id: m?.id ?? null } }));
  }

  if (tardia) {
    // Entrega depois do varredor/parar: aceita como anexo parcial, sem reabrir (ADR-010).
    return { data: { turno, mensagem, duplicada: false, tardia: true }, events };
  }

  const assentado = await deps.repos.turnos.assentar(turno.id, {
    estado: desfecho.estado,
    motivoInterrupcao: desfecho.motivoInterrupcao,
    motivoFalha: desfecho.motivoFalha,
    sinais: resultado.sinais,
    custoUsd: resultado.custoUsd,
    tokensEntrada: resultado.tokens.entrada,
    tokensSaida: resultado.tokens.saida,
  });
  if (!assentado) throw new ErroDeDominio("estado_invalido", { cause: "turno mudou de estado durante a entrega" });

  if (quedaDaMaquina) {
    // A MESMA regra do varredor (interromper-por-maquina.ts): sem a linha 'sistema' e o evento daqui,
    // que dariam à rotina uma mensagem no chat e à conversa duas linhas para a mesma queda.
    const q = await aposQuedaDaMaquina(deps, assentado, { perdidoDesde });
    events.push(...q.events);
  } else if (desfecho.estado === "interrompido") {
    await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
    const motivo = desfecho.motivoFalha ?? desfecho.motivoInterrupcao ?? "sem_progresso";
    const aviso = await deps.repos.mensagens.criar({
      conversaId: turno.conversaId,
      turnoId: turno.id,
      autoria,
      kind: "sistema",
      texto: redigir("turno-interrompido", agora, { motivo: motivoEmPortugues(motivo) }),
      confianca: "confiavel",
    });
    if (aviso) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: aviso.id, kind: "sistema" } }));
    events.push(evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: desfecho.motivoInterrupcao, motivo_falha: desfecho.motivoFalha, custo_usd: resultado.custoUsd } }));
  } else {
    events.push(evento(deps.escopo, { kind: "turno_encerrado", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { estado: "concluido", custo_usd: resultado.custoUsd, ferramentas: resultado.ferramentasChamadas.length } }));
  }

  return { data: { turno: assentado, mensagem, duplicada: false, tardia: false }, events };
};
