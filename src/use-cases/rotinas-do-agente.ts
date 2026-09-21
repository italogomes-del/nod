import type { EstadoRotina } from "../contracts/rotina.ts";
import type { CasoNod } from "../contracts/servicos.ts";
import { ehErroDeDominio, ErroDeDominio } from "../domain/erro.ts";
import { resumoCron } from "../domain/rotina-texto.ts";
import { assertUuid, autoriaAgente } from "./apoio-l7.ts";
import { pausarRotina } from "./pausar-rotina.ts";
import type { Deps } from "./tipos.ts";

/**
 * As três ferramentas que o agente usa sobre rotina que JÁ EXISTE (criar_rotina continua sendo o
 * caminho de nascimento, por proposta). Pausar e reativar aplicam DIRETO, sem proposta: são
 * reversíveis em um clique e já são ato de um botão na web — pedir confirmação aqui seria cerimônia
 * que a própria interface não pede. Atualizar e excluir, que não são reversíveis, passam por
 * proposta.
 *
 * O id vem TIPADO do inventário no prompt de sistema (prompt-sistema.ts); nenhum texto é
 * interpretado aqui — é a Regra 9 de rotina-texto.ts valendo também para o ciclo de vida.
 */

/** `listar_rotinas`: mesma forma do inventário do prompt, para o modelo não ver dois formatos. */
export const listarRotinasDoAgente: CasoNod<Deps, "listar_rotinas"> = async (deps, input) => {
  assertUuid(input.agenteId, "agenteId");
  const rotinas = await deps.repos.rotinas.listarDoAgente(input.agenteId);
  return {
    data: {
      rotinas: rotinas.map((r) => ({
        id: r.id,
        quando: resumoCron(r.cron, r.fusoIana),
        estado: r.estado,
        instrucao: r.instrucao,
      })),
    },
  };
};

/**
 * Tronco de pausar_rotina/reativar_rotina. Erro de domínio volta TIPADO em {erro} para o modelo
 * corrigir a chamada (mesmo contrato de criar_rotina), em vez de virar negação do proxy.
 * A rotina tem que ser DESTE agente: o id vem do modelo, e sem esse filtro um agente mexeria na
 * rotina de outro dentro do mesmo tenant (rotinas.buscar é tenant-wide, por RLS de leitura).
 */
async function alternar(deps: Deps, input: { agenteId: string; rotinaId: string }, estado: EstadoRotina) {
  try {
    assertUuid(input.agenteId, "agenteId");
    assertUuid(input.rotinaId, "rotina_id");
    const atual = await deps.repos.rotinas.buscar(input.rotinaId);
    if (!atual || atual.agenteId !== input.agenteId) throw new ErroDeDominio("nao_encontrado", { cause: "rotina de outro agente ou inexistente" });
    const jaEstava = atual.estado === estado;
    const { data } = await pausarRotina(deps, { rotinaId: input.rotinaId, estado, autoria: autoriaAgente(input.agenteId, deps.escopo.pessoaId) });
    return { data: { rotina_id: data.rotina.id, estado: data.rotina.estado, ja_estava: jaEstava, proxima_execucao: data.rotina.estado === "ativa" ? data.rotina.proximaExecucao : null } };
  } catch (e) {
    if (ehErroDeDominio(e)) return { data: { erro: e.codigo } };
    throw e;
  }
}

export const pausarRotinaPeloAgente: CasoNod<Deps, "pausar_rotina"> = (deps, input) =>
  alternar(deps, { agenteId: input.agenteId, rotinaId: input.rotina_id }, "pausada");

export const reativarRotinaPeloAgente: CasoNod<Deps, "reativar_rotina"> = (deps, input) =>
  alternar(deps, { agenteId: input.agenteId, rotinaId: input.rotina_id }, "ativa");
