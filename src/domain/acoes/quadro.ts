import type { DefinicaoAcao } from "../../contracts/acoes.ts";
import { PROPRIEDADES_QUADRO as P } from "../../contracts/ferramentas-quadro.ts";
import type { JsonSchema } from "../../contracts/json-schema.ts";

/**
 * As ações do quadro (definido em 2026-10-31, NOD-442, ADR-135). Todas `vivo`: a rota da tela
 * (src/adapters/http/rotas/quadro.ts) e o gerir_quadro de QUALQUER bot passam pelo mesmo lote
 * (aplicarLoteQuadro, src/use-cases/quadro.ts), e o teste de contrato (tests/integration/paridade-quadro.test.ts) leva os
 * dois ao mesmo estado no banco. Não entram no gerir_bots (sem `lote`): o gerir_quadro é a via.
 *
 * Risco "muda": o quadro é da pessoa e cada lote tem Desfazer; começar uma tarefa abre um turno de delegação, que segue as
 * aprovações do bot responsável; o turno nasce contaminado quando a tarefa foi escrita por um turno não confiável (deFora).
 */

const objeto = (properties: Record<string, JsonSchema>, required: readonly string[]): JsonSchema => ({ type: "object", properties, required, additionalProperties: false });
const VIA = { ferramenta: "gerir_quadro" } as const;
const CONTRATO = "tests/integration/paridade-quadro.test.ts";
const vivo = { estado: "vivo", via: VIA, contrato: CONTRATO } as const;

export const ACOES_QUADRO = [
  {
    id: "quadro.criar",
    titulo: "Criar o quadro de um bot (meta e prazo)",
    schema: objeto({ meta: P.meta, prazo: P.prazo }, ["meta"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.criar",
  },
  {
    id: "quadro.editar",
    titulo: "Mudar a meta ou o prazo do quadro",
    schema: objeto({ meta: P.meta, prazo: P.prazo }, []),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.editar",
  },
  {
    id: "quadro.criar_tarefa",
    titulo: "Criar uma tarefa no quadro",
    schema: objeto({ titulo: P.titulo, descricao: P.descricao, status: P.status, agente: P.agente }, ["titulo"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.criar_tarefa",
  },
  {
    id: "quadro.importar_linear",
    titulo: "Trazer itens do Linear para o quadro",
    schema: objeto({ itens: P.itens }, ["itens"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.importar_linear",
  },
  {
    id: "quadro.mudar_tarefa",
    titulo: "Mudar uma tarefa (status, responsável, PR, pergunta) ou tirá-la do quadro",
    schema: objeto({ tarefa: P.tarefa, titulo: P.titulo, descricao: P.descricao, status: P.status, agente: P.agente, pr_url: P.pr_url, pergunta: P.pergunta, excluir: P.excluir }, ["tarefa"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.mudar_tarefa",
  },
  {
    id: "quadro.responder",
    titulo: "Responder a pergunta de uma tarefa bloqueada",
    schema: objeto({ tarefa: P.tarefa, resposta: P.resposta }, ["tarefa", "resposta"]),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.responder",
  },
  {
    id: "quadro.desfazer",
    titulo: "Desfazer a última mudança no quadro",
    schema: objeto({ lote: P.lote }, []),
    risco: "muda",
    cartaoNoChat: false,
    chat: vivo,
    casoDeUso: "quadro.desfazer",
  },
] as const satisfies readonly DefinicaoAcao[];
