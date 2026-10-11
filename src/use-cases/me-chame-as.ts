import type { RuntimeEvent } from "../contracts/evento.ts";
import { ACORDAR_MAX_MINUTOS, ACORDAR_MIN_MINUTOS, MOTIVO_MAX_DESPERTAR, VOLTAS_SEGUIDAS_MAX } from "../contracts/ferramentas-trabalho.ts";
import type { CasoNod } from "../contracts/servicos.ts";
import type { Turno } from "../contracts/turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { horaDaFrase } from "../domain/erro-fornecedor.ts";
import { trabalhoAberto } from "../domain/trabalho.ts";
import { autoriaAgente, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import type { Deps } from "./tipos.ts";

/** "às 16:05" no mesmo dia; "em 09/10 às 09:00" em outro (como a frase do limite do plano). */
function quando(instante: number, agora: number): string {
  const frase = horaDaFrase(instante, agora);
  return frase.includes(" às ") ? `em ${frase}` : `às ${frase}`;
}

/**
 * A quem a volta se liga: o turno que chamou ou, se ele mesmo é uma volta, o turno que ELA retoma. Assim voltas seguidas
 * não alongam a cadeia de retomadas (SALTOS_DE_RETOMADA, apoio-l7.ts): a rotina continua rotina e a delegação continua
 * delegação na 11ª volta (revisão do #212).
 */
function origemDaVolta(turno: Turno): string {
  return turno.acordarEm != null && turno.retomaTurnoId ? turno.retomaTurnoId : turno.id;
}

/**
 * Ferramenta `me_chame_as` (ADR-086): o bot vai esperar algo demorado que não depende dele. Em vez de um laço com `sleep`
 * segurando processo e memória no Mac, ele marca a volta e encerra o turno.
 *
 * Revisão do #212: a chamada só ANOTA o pedido no turno (`despertar_em`); a retomada nasce no assentamento
 * (`voltaMarcadaAoAssentar`). Assim a marca de conteúdo de fora que o turno ganhar depois da chamada vai junto, o Parar
 * pedido no meio cancela a volta, e fica uma volta por turno (a última chamada vale).
 */
export const meChameAs: CasoNod<Deps, "me_chame_as"> = async (deps, input) => {
  const turno = await deps.repos.turnos.buscarTravado(input.turnoId);
  if (!turno || turno.agenteId !== input.agenteId) throw new ErroDeDominio("nao_permitido", { cause: "turno de outro bot" });
  const minutos = Math.round(input.em_minutos);
  if (!Number.isFinite(minutos) || minutos < ACORDAR_MIN_MINUTOS || minutos > ACORDAR_MAX_MINUTOS) throw new ErroDeDominio("entrada_invalida", { cause: `em_minutos fora de ${ACORDAR_MIN_MINUTOS}–${ACORDAR_MAX_MINUTOS}` });
  const motivo = input.motivo.trim().slice(0, MOTIVO_MAX_DESPERTAR);
  if (motivo === "") throw new ErroDeDominio("texto_vazio");
  const trabalho = turno.trabalhoId ? await deps.repos.trabalhos.buscar(turno.trabalhoId) : null;
  if (trabalho && !trabalhoAberto(trabalho.estado)) return { data: { ok: false, erro: "task_fechada", instrucao: "Esta task já foi fechada (parada, terminada ou falhou). Não marque volta: encerre o turno." } };
  if ((await deps.repos.turnos.voltasMarcadas(origemDaVolta(turno))) >= VOLTAS_SEGUIDAS_MAX) {
    return { data: { ok: false, erro: "voltas_demais", instrucao: `Você já voltou ${VOLTAS_SEGUIDAS_MAX} vezes para conferir a mesma coisa. Não marque outra volta: diga à pessoa o que está esperando e por quê, e encerre o turno.` } };
  }
  const agora = deps.agora();
  const acordarEm = agora + minutos * 60_000;
  if (!(await deps.repos.turnos.marcarDespertar(turno.id, acordarEm, motivo))) {
    return { data: { ok: false, erro: "turno_parado", instrucao: "A pessoa parou este trabalho. Não marque volta: encerre o turno." } };
  }
  const hora = quando(acordarEm, agora);
  return { data: { ok: true, volta_as: horaDaFrase(acordarEm, agora), acordar_em: new Date(acordarEm).toISOString(), instrucao: `Combinado: você volta sozinho ${hora}, nesta mesma sessão. Pare os comandos que deixou em segundo plano, diga em uma frase o que vai esperar e encerre o turno agora — não fique esperando.` } };
};

/**
 * ADR-086 (revisão do #212): o turno que marcou a volta terminou. Só quando ele concluiu (sem Parar, sem falha) e a task
 * dele segue aberta, nasce a retomada com `acordar_em`: no trabalho e na sessão de AGORA (a rede de 2 min pode tê-lo
 * promovido), com o modelo, o harness, a confiança e a procuração do turno, e com a marca de conteúdo de fora já final.
 * Chamado pelo assentamento, na mesma transação, antes de o trabalho reler o estado.
 */
export async function voltaMarcadaAoAssentar(deps: Deps, turno: Turno, concluiu: boolean): Promise<RuntimeEvent[]> {
  if (!concluiu || turno.pararSolicitadoEm !== null) return [];
  const pedido = await deps.repos.turnos.despertarDoTurno(turno.id);
  if (!pedido) return [];
  const trabalho = turno.trabalhoId ? await deps.repos.trabalhos.buscar(turno.trabalhoId) : null;
  if (trabalho && !trabalhoAberto(trabalho.estado)) return [];
  const agora = deps.agora();
  const retomaTurnoId = origemDaVolta(turno);
  await deps.repos.turnos.travarRetomadas(retomaTurnoId);
  const volta = await deps.repos.turnos.enfileirar({
    conversaId: turno.conversaId,
    agenteId: turno.agenteId,
    origem: "retomada",
    retomaTurnoId,
    trabalhoId: turno.trabalhoId ?? null,
    prazoEm: pedido.em + PRAZO_DECISAO_PADRAO_MS,
    profundidade: turno.profundidade,
    // A hora marcada é fato da criação; a hora de verdade da volta o plano já diz (o Mac pode ter estado fora).
    entradaTexto: `[nod] Você marcou para voltar ${quando(pedido.em, agora)} para conferir: ${pedido.motivo}\nConfira e siga de onde parou. Se ainda não estiver pronto, marque outra volta com me_chame_as e encerre o turno.`,
    entradaConfianca: turno.entradaConfianca,
    sobProcuracaoDe: turno.sobProcuracaoDe ?? null,
    modelo: turno.modelo,
    harness: turno.harness,
    executor: turno.executor,
    acordarEm: pedido.em,
  });
  if (!volta) throw new ErroDeDominio("estado_invalido", { cause: "retomada da volta marcada não criada" });
  // A marca de quem leu algo de fora (ADR-062): lida agora, com o turno assentado — nada que ele leu escapa.
  if (turno.entradaConfianca !== "confiavel" || (await deps.repos.turnos.contaminado(turno.id))) await deps.repos.turnos.contaminar(volta.id, agora);
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher" });
  return [evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: turno.conversaId, turnoId: volta.id, dados: { origem: volta.origem, agente_id: turno.agenteId, retoma_turno_id: retomaTurnoId, trabalho_id: volta.trabalhoId ?? null, acordar_em: pedido.em } })];
}
