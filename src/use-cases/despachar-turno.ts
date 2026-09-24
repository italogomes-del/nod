import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { Inventario } from "../contracts/inventario.ts";
import type { PlanoTurno } from "../contracts/plano-turno.ts";
import type { Turno } from "../contracts/turno.ts";
import { entradaDaFila } from "../domain/entrada-da-fila.ts";
import { ehErroDeDominio, ErroDeDominio } from "../domain/erro.ts";
import { autoriaAgente, autoriaPessoa, evento, inventarioAusente, motorDe } from "./autoria-evento.ts";
import { mensagemExecutorIndisponivel } from "./enviar-mensagem.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

export type EntradaDespacharTurno = {
  machineId: string;
  executor?: Executor;
  /** Inventário anunciado pela máquina no conectar (ADR-021); ausente = lê o registrado; nenhum = 'ausente'. */
  inventario?: Inventario;
  harnessesProntos?: readonly string[];
};

export type MotivoSemPlano = "parada_ativa" | "fila_vazia" | "executor_indisponivel";
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

  const turno = await deps.repos.turnos.reivindicar({ machineId: input.machineId, agora, harnessesProntos: input.harnessesProntos });
  if (!turno) return { data: { plano: null, turno: null, motivo: "fila_vazia" } };

  const paradaConversa = await deps.repos.paradas.ativa(pessoaId, turno.conversaId);
  if (paradaConversa === null) throw new ErroDeDominio("estado_invalido", { cause: "consulta de parada falhou depois da reivindicação" });
  if (paradaConversa) {
    const interrompido = await deps.repos.turnos.interromper(turno.id, "parado_pela_pessoa");
    const autoria = autoriaPessoa(deps.escopo, executor);
    return {
      data: { plano: null, turno: interrompido ?? turno, motivo: "parada_ativa" },
      events: [evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: "parado_pela_pessoa", origem: turno.origem } })],
    };
  }

  // O inventário anunciado pela máquina decide o gate; quem o PERSISTE por pessoa é a sonda com cache da
  // L4 (callback injetado), não o puxar — definido em 2026-09-16: um upsert por puxar (a cada 1 s por pessoa)
  // é churn e travou com o advisory lock da reivindicação em dois puxares paralelos da mesma pessoa.
  const inventario = input.inventario ?? (await deps.repos.inventario.buscar(motorDe(executor))) ?? inventarioAusente(agora);
  if (inventario.estado !== "pronto") return recusarPorExecutor(deps, { turno, executor, inventario, agora });

  // Fila lida junta (definido em 2026-09-24), só depois dos gates: um turno recusado não arrasta as outras
  // falas. As demais pendentes desta conversa entram neste turno e cada uma sai 'absorvido'.
  const { turno: comFila, absorvidos } = await deps.repos.turnos.absorverPendentes(turno, entradaDaFila);
  const autoria = autoriaPessoa(deps.escopo, executor);
  const events = absorvidos.map((a) => evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: a.conversaId, turnoId: a.id, dados: { motivo: "absorvido", absorvido_por: comFila.id } }));

  try {
    const plano = await deps.tx((trx) => deps.services.planos.emitir(trx, comFila.id, input.machineId));
    return { data: { plano, turno: comFila, motivo: null }, events };
  } catch (e) {
    // montarPlano recusa a localidade (inventário mudou entre o gate e o plano): mesmo caminho, nunca silêncio.
    if (ehErroDeDominio(e) && e.codigo === "executor_indisponivel") return recusarPorExecutor(deps, { turno, executor, inventario, agora });
    throw e;
  }
};

async function recusarPorExecutor(
  deps: Deps,
  p: { turno: Turno; executor: Executor; inventario: Inventario; agora: number },
): Promise<{ data: SaidaDespacharTurno; events: RuntimeEvent[] }> {
  // nao_autenticado/motor_ausente são MotivoFalha (do inventário, nunca do classificador); a interrupção é executor_indisponivel.
  const motivoFalha = p.inventario.estado === "nao_autenticado" ? "nao_autenticado" : "motor_ausente";
  const assentado = await deps.repos.turnos.assentar(p.turno.id, { estado: "interrompido", motivoInterrupcao: "executor_indisponivel", motivoFalha });
  const negacao = await mensagemExecutorIndisponivel(deps, { conversaId: p.turno.conversaId, turnoId: p.turno.id, agenteId: p.turno.agenteId, executor: p.executor, inventario: p.inventario, agora: p.agora });
  const autoria = autoriaAgente({ agenteId: p.turno.agenteId, contaDeExecucao: p.turno.ownerId, executor: p.executor, localityReason: "motor_ausente" });
  const events = [
    evento(deps.escopo, { kind: "turno_interrompido", autoria, agora: p.agora, conversaId: p.turno.conversaId, turnoId: p.turno.id, dados: { motivo: "executor_indisponivel", motivo_falha: motivoFalha, inventario: p.inventario.estado } }),
  ];
  if (negacao) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora: p.agora, conversaId: p.turno.conversaId, turnoId: p.turno.id, dados: { mensagem_id: negacao.id, kind: "negacao" } }));
  return { data: { plano: null, turno: assentado ?? p.turno, motivo: "executor_indisponivel" }, events };
}
