import type { Executor } from "../../contracts/evento.ts";
import type { ItemLinear, OpQuadro } from "../../contracts/quadro.ts";
import { ehOpDeTrabalho, lerOp } from "../../domain/quadro.ts";
import type { IdAcao } from "../../domain/acoes/index.ts";
import type { CodigoErro } from "../../domain/erro.ts";
import { ErroDeDominio } from "../../domain/erro.ts";
import { comentarTarefa } from "../comentar-tarefa.ts";
import { trabalhoDaTarefa } from "../quadro-execucoes.ts";
import { aplicarLoteQuadro, type FalhaQuadro, type RecusaDoMover, type ResultadoLote } from "../quadro.ts";
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
  estado_invalido: "estado_invalido",
  // Revisão 2 do PR #623: a tarefa mudou de quadro no meio do mover (409).
  conflito: "estado_invalido",
};

/**
 * Revisão 7 do PR #623: a recusa do mover que a tela distingue. A chave vem tipada do caso de uso (`motivo` da falha) e
 * vai no erro; a rota a lê daqui em vez de achar a chave pelo texto do detalhe. A causa segue sendo o texto (só no log).
 */
export class ErroDoMover extends ErroDeDominio {
  readonly motivo: RecusaDoMover;
  constructor(codigo: CodigoErro, motivo: RecusaDoMover, cause: string) {
    super(codigo, { cause });
    this.motivo = motivo;
  }
}

/**
 * Um lote de uma ação pela tela. O corpo da rota chega sem tipo: passa pelo mesmo lerOp da ferramenta (tetos, status,
 * URL do PR e do Linear). A falha vira o código fechado (o detalhe fica na causa, ADR-002).
 */
function umaAcao<I extends object>(tipo: OpQuadro["tipo"]): CasoDeUso<Base & I, SaidaQuadro> {
  return async (deps, input) => {
    const { anfitriaoId, executor, ...resto } = input;
    const op = lerOp({ ...resto, tipo });
    if ("erro" in op) throw new ErroDeDominio("entrada_invalida", { cause: op.erro });
    const pedido = { autor: { tipo: "pessoa" } as const, anfitriaoId, executor, ops: [op] };
    // NOD-417: comentar não é lote (sem Desfazer): grava e aciona o responsável e os @mencionados.
    // NOD-418: Repetir, Cancelar e recado também não são lote: o trabalho da tarefa.
    const r = op.tipo === "comentar" ? await comentarTarefa(deps, pedido, op) : ehOpDeTrabalho(op) ? await trabalhoDaTarefa(deps, pedido, op) : await aplicarLoteQuadro(deps, pedido);
    if (!r.data.ok) {
      if (r.data.motivo) throw new ErroDoMover(CODIGO[r.data.erro], r.data.motivo, r.data.detalhe);
      throw new ErroDeDominio(CODIGO[r.data.erro], { cause: r.data.detalhe });
    }
    return { data: r.data, events: r.events };
  };
}

type CamposTarefa = { titulo?: string; descricao?: string; status?: string; agente?: string | null };

export const EXECUTORES_QUADRO = {
  "quadro.criar": umaAcao<{ meta?: string | null; prazo?: string | null }>("criar_quadro"),
  "quadro.editar": umaAcao<{ meta?: string | null; prazo?: string | null }>("editar_quadro"),
  "quadro.criar_tarefa": umaAcao<CamposTarefa & { titulo: string }>("criar_tarefa"),
  "quadro.importar_linear": umaAcao<{ itens: ItemLinear[] }>("importar_linear"),
  "quadro.mudar_tarefa": umaAcao<CamposTarefa & { tarefa: string; pr_url?: string | null; pergunta?: string | null; excluir?: boolean; sem_iniciar?: boolean; motivo?: string }>("mudar_tarefa"),
  "quadro.responder": umaAcao<{ tarefa: string; resposta: string }>("responder"),
  "quadro.comentar": umaAcao<{ tarefa: string; texto: string }>("comentar"),
  "quadro.desfazer": umaAcao<{ lote?: string }>("desfazer"),
  "quadro.mover_tarefa": umaAcao<{ tarefa: string; quadro: string }>("mover_quadro"),
  "quadro.remover": umaAcao<{ bot?: string }>("remover_quadro"),
  "quadro.criar_coluna": umaAcao<{ nome: string; grupo: string; depois_de?: string; prazo_min?: number | null }>("criar_coluna"),
  "quadro.renomear_coluna": umaAcao<{ coluna: string; nome?: string; prazo_min?: number | null }>("renomear_coluna"),
  "quadro.mover_coluna": umaAcao<{ coluna: string; antes_de?: string; depois_de?: string }>("mover_coluna"),
  "quadro.remover_coluna": umaAcao<{ coluna: string; destino?: string }>("remover_coluna"),
  // Pela tela a pessoa é a confirmação; pela conversa o gerir_quadro abre o card (proposta colunas_quadro).
  "quadro.substituir_colunas": umaAcao<{ colunas: unknown; destinos?: unknown }>("substituir_colunas"),
  "quadro.definir_passagem": umaAcao<{ coluna: string; agente?: string | null; instrucoes?: string | null }>("definir_passagem"),
  "quadro.terminei": umaAcao<{ tarefa: string }>("terminei"),
  "quadro.travar_coluna": umaAcao<{ coluna: string; sai_para?: string[] | null; so_pessoa?: boolean }>("travar_coluna"),
  "quadro.desfazer_movimento": umaAcao<{ tarefa: string; movimento?: string }>("desfazer_movimento"),
  "quadro.repetir_trabalho": umaAcao<{ tarefa: string }>("repetir_trabalho"),
  "quadro.cancelar_trabalho": umaAcao<{ tarefa: string }>("cancelar_trabalho"),
  "quadro.recado_trabalho": umaAcao<{ tarefa: string; texto: string }>("recado"),
} as const satisfies Partial<Record<IdAcao, CasoDeUso<never, unknown>>>;
