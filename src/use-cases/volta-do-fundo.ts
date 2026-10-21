import type { Turno } from "../contracts/turno.ts";
import { ehFundo, ehVoltaDoFundo, entradaDaVolta, RETORNO_DO_LOTE } from "../domain/cota-da-ia.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { SALTOS_DE_RETOMADA } from "./apoio-l7.ts";
import { PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import type { Deps } from "./tipos.ts";

/**
 * A volta do trabalho de FUNDO na fila (definido em 2026-10-20, NOD-309): o que a espera da cota, a nova tentativa do erro
 * transitório (assentar-turno) e a retomada da queda (interromper-por-maquina) dividem. Fica fora de assentar-turno porque
 * o varredor de lease (DepsQueda) também enfileira a volta, e assentar-turno já importa interromper-por-maquina.
 */
type DepsFundo = Pick<Deps, "repos" | "agora">;

/**
 * definido em 2026-10-20 (NOD-309; extraído de aposLimiteNoFundo): a volta do trabalho de fundo na fila — a mesma cadeia
 * (`retomaTurnoId`), o mesmo trabalho, a inteligência e o executor do turno, a hora de acordar (`acordarEm`), a marca de
 * quem leu algo de fora e o contador de quedas transitórias da cadeia. O retorno do lote continua retorno do lote, e o
 * lote passa a apontar para a volta. Serve à cota e ao erro transitório; a linha e o aviso ficam com quem chama.
 */
export async function enfileirarVoltaDoFundo(
  deps: DepsFundo,
  p: { turno: Turno; retomaTurnoId: string; entradaTexto: string; acordarEm: number; tentativasTransitorias?: number; agora: number },
): Promise<Turno> {
  const { turno } = p;
  const volta = await deps.repos.turnos.enfileirar({
    conversaId: turno.conversaId,
    agenteId: turno.agenteId,
    origem: "retomada",
    retomaTurnoId: p.retomaTurnoId,
    trabalhoId: turno.trabalhoId ?? null,
    prazoEm: p.acordarEm + PRAZO_DECISAO_PADRAO_MS,
    profundidade: turno.profundidade,
    entradaTexto: p.entradaTexto,
    entradaConfianca: turno.entradaConfianca,
    sobProcuracaoDe: turno.sobProcuracaoDe ?? null,
    // NOD-279 D7 revisto pelo ADR-108 (#358): a volta segue com a inteligência do turno. A task com sessão já fica na IA da
    // sessão pela guarda do despacho e do plano (segurarTaskNaIaDaSessao); fixar o harness aqui a tiraria do Automático e
    // anularia o "levar" (a task sem sessão seguiria presa na IA no limite).
    modelo: turno.modelo,
    harness: turno.harness,
    executor: turno.executor,
    acordarEm: p.acordarEm,
    // NOD-309: o teto de 3 tentativas conta por cadeia — a volta herda o contador (a do transitório, já somado).
    tentativasTransitorias: p.tentativasTransitorias ?? turno.tentativasTransitorias ?? 0,
    // NOD-258: a volta do retorno do lote continua retorno do lote (portão da cota, refazer uma vez).
    ...(turno.decididoPor === RETORNO_DO_LOTE ? { decididoPor: RETORNO_DO_LOTE, reenvios: turno.reenvios } : {}),
    // A marca de quem leu algo de fora (ADR-062) segue para a volta no mesmo INSERT (NOD-287).
    contaminadoDe: turno.id,
  });
  if (!volta) throw new ErroDeDominio("estado_invalido", { cause: "volta do fundo não criada" });
  // NOD-258: o lote passa a apontar para a volta — se ela cair, refazerRetornoDoLote acha o lote por ela.
  if (turno.decididoPor === RETORNO_DO_LOTE) {
    const lote = await deps.repos.frentes.loteDoRetorno(turno.id);
    if (lote) await deps.repos.frentes.trocarRetorno(lote.id, volta.id);
  }
  // A entrada de fora também marca a volta, como na volta marcada (me-chame-as.ts).
  if (turno.entradaConfianca !== "confiavel") await deps.repos.turnos.contaminar(volta.id, p.agora);
  return volta;
}

/**
 * NOD-274: o turno é trabalho de fundo pelo tipo dele (ehFundo) ou, sendo uma retomada, pelo da raiz da cadeia — a volta
 * de uma rotina ou de um pedido de colega tem origem 'retomada' e continua sendo fundo. A retomada de uma conversa não.
 */
export async function fundoNaCadeia(deps: Pick<Deps, "repos">, turno: Turno): Promise<boolean> {
  if (ehFundo(turno)) return true;
  if (turno.origem !== "retomada" || !turno.retomaTurnoId) return false;
  return ehFundo(await raizDaCadeia(deps, turno));
}

/**
 * NOD-269 (G2): a entrada da volta do fundo. O pedido vem da raiz da cadeia (o da frente, da rotina, do colega); o
 * retorno do lote é ele mesmo o pedido (os resumos das frentes), e a volta de uma volta reaproveita a entrada dela, que
 * já leva o pedido — nunca "Pedido original" aninhado.
 */
export function entradaDaVoltaDoFundo(p: { turno: Turno; raiz: Turno; base: string; sessaoRetomavel: boolean }): string {
  const { turno } = p;
  // NOD-309: a volta da nova tentativa também já leva o pedido (nunca aninhado).
  if (turno.origem === "retomada" && ehVoltaDoFundo(turno.entradaTexto)) {
    return p.sessaoRetomavel ? p.base : turno.entradaTexto.includes("\n\nPedido original da frente:\n") ? `${p.base}${turno.entradaTexto.slice(turno.entradaTexto.indexOf("\n\nPedido original da frente:\n"))}` : p.base;
  }
  const pedido = turno.decididoPor === RETORNO_DO_LOTE ? turno.entradaTexto : p.raiz.origem === "retomada" ? null : p.raiz.entradaTexto;
  return entradaDaVolta({ base: p.base, sessaoRetomavel: p.sessaoRetomavel, pedidoOriginal: pedido });
}

/** NOD-269: o primeiro turno da cadeia de retomadas (o que trouxe o pedido). Mesmo teto de saltos de rotinaDoTurno. */
export async function raizDaCadeia(deps: Pick<Deps, "repos">, turno: Turno): Promise<Turno> {
  let atual = turno;
  for (let saltos = 0; atual.origem === "retomada" && atual.retomaTurnoId && saltos < SALTOS_DE_RETOMADA; saltos++) {
    const anterior = await deps.repos.turnos.buscar(atual.retomaTurnoId);
    if (!anterior) break;
    atual = anterior;
  }
  return atual;
}
