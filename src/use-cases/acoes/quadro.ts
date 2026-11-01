import type { Executor } from "../../contracts/evento.ts";
import type { ItemLinear, OpQuadro } from "../../contracts/quadro.ts";
import { lerOp } from "../../domain/quadro.ts";
import type { IdAcao } from "../../domain/acoes/index.ts";
import type { CodigoErro } from "../../domain/erro.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { aplicarLoteQuadro, type FalhaQuadro, type ResultadoLote } from "../quadro.ts";
import type { CasoDeUso } from "../tipos.ts";

/**
 * Os executores únicos do quadro (definido em 2026-10-31, NOD-442, ADR-135). Cada id é UM lote de uma ação só, pelo
 * mesmo aplicarLoteQuadro que o gerir_quadro chama com várias: a tela e o chat chegam ao mesmo estado (o teste de
 * contrato prova). Aqui o autor é a pessoa (a tela); o gerir_quadro passa o bot como autor.
 */

/** O bot da aba Quadro (o anfitrião) e onde rodam os turnos que o lote começar. */
type Base = { anfitriaoId: string; executor: Executor };
export type SaidaQuadro = Extract<ResultadoLote, { ok: true }>;

const CODIGO: Record<FalhaQuadro, CodigoErro> = {
  experimento_desligado: "nao_permitido",
  sem_quadro: "nao_encontrado",
  nao_encontrado: "nao_encontrado",
  entrada_invalida: "entrada_invalida",
};

/**
 * Um lote de uma ação pela tela. O corpo da rota chega sem tipo: passa pelo mesmo lerOp da ferramenta (tetos, status,
 * URL do PR e do Linear). A falha vira o código fechado (o detalhe fica na causa, ADR-002).
 */
function umaAcao<I extends object>(tipo: OpQuadro["tipo"]): CasoDeUso<Base & I, SaidaQuadro> {
  return async (deps, input) => {
    const { anfitriaoId, executor, ...resto } = input;
    const op = lerOp({ ...resto, tipo });
    if ("erro" in op) throw new ErroDeDominio("entrada_invalida", { cause: op.erro });
    const r = await aplicarLoteQuadro(deps, { autor: { tipo: "pessoa" }, anfitriaoId, executor, ops: [op] });
    if (!r.data.ok) throw new ErroDeDominio(CODIGO[r.data.erro], { cause: r.data.detalhe });
    return { data: r.data, events: r.events };
  };
}

type CamposTarefa = { titulo?: string; descricao?: string; status?: string; agente?: string | null };

export const EXECUTORES_QUADRO = {
  "quadro.criar": umaAcao<{ meta?: string | null; prazo?: string | null }>("criar_quadro"),
  "quadro.editar": umaAcao<{ meta?: string | null; prazo?: string | null }>("editar_quadro"),
  "quadro.criar_tarefa": umaAcao<CamposTarefa & { titulo: string }>("criar_tarefa"),
  "quadro.importar_linear": umaAcao<{ itens: ItemLinear[] }>("importar_linear"),
  "quadro.mudar_tarefa": umaAcao<CamposTarefa & { tarefa: string; pr_url?: string | null; pergunta?: string | null; excluir?: boolean }>("mudar_tarefa"),
  "quadro.responder": umaAcao<{ tarefa: string; resposta: string }>("responder"),
  "quadro.desfazer": umaAcao<{ lote?: string }>("desfazer"),
  "quadro.remover": umaAcao<{ bot?: string }>("remover_quadro"),
  "quadro.criar_coluna": umaAcao<{ nome: string; grupo: string; depois_de?: string }>("criar_coluna"),
  "quadro.renomear_coluna": umaAcao<{ coluna: string; nome: string }>("renomear_coluna"),
  "quadro.mover_coluna": umaAcao<{ coluna: string; antes_de?: string; depois_de?: string }>("mover_coluna"),
  "quadro.remover_coluna": umaAcao<{ coluna: string; destino?: string }>("remover_coluna"),
  // Pela tela a pessoa é a confirmação; pela conversa o gerir_quadro abre o card (proposta colunas_quadro).
  "quadro.substituir_colunas": umaAcao<{ colunas: unknown; destinos?: unknown }>("substituir_colunas"),
} as const satisfies Partial<Record<IdAcao, CasoDeUso<never, unknown>>>;
