import type { PayloadPropostaPerfil, PayloadPropostaRotina } from "../contracts/conversa.ts";
import { ehErroDeDominio, ErroDeDominio } from "../domain/erro.ts";
import { podeCriarRotina } from "../domain/rotina-limites.ts";
import { revisaoAtualDoPerfil } from "./confirmar-perfil.ts";
import { autoriaAgente, evento } from "./autoria-evento.ts";
import { prepararRotina } from "./criar-rotina.ts";
import type { UseCasesNod } from "./tipos.ts";

function opcional(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || v.trim() === "") throw new ErroDeDominio("entrada_invalida", { cause: "campo de perfil" });
  return v.trim();
}

/**
 * Ferramenta nod `atualizar_perfil` (EMENDA 5, E1.1): o modelo PROPÕE nome/título/descrição; nada
 * muda no agente antes de confirmarProposta pela pessoa. Vira Proposta kind 'perfil' + evento
 * proposta_criada (a web renderiza o cartão a partir da Proposta, nunca do texto).
 *
 * definido em 2026-09-28 (ADR-050): `rotinas` traz as tarefas recorrentes da missão junto com o perfil.
 * Cada uma passa pela MESMA validação de criar_rotina e vira proposta 'rotina' SEM decisão em "Sua vez":
 * o card do perfil é o único lugar onde ela se confirma. Uma rotina recusada pelo domínio devolve o erro
 * tipado com o índice e nada é criado — o modelo corrige e chama de novo.
 */
export const atualizarPerfil: UseCasesNod["atualizarPerfil"] = async (deps, input) => {
  const payload: PayloadPropostaPerfil = { kind: "perfil", turnoId: input.turnoId };
  const nome = opcional(input.nome);
  const titulo = opcional(input.titulo);
  const descricao = opcional(input.descricao);
  if (nome !== undefined) payload.nome = nome;
  if (titulo !== undefined) payload.titulo = titulo;
  if (descricao !== undefined) payload.descricao = descricao;
  if (nome === undefined && titulo === undefined && descricao === undefined) throw new ErroDeDominio("entrada_invalida", { cause: "proposta vazia" });

  const rotinas: PayloadPropostaRotina[] = [];
  try {
    for (const r of input.rotinas ?? []) rotinas.push(await prepararRotina(deps, input.agenteId, r));
    // prepararRotina confere o teto de 50 uma a uma; o lote inteiro também precisa caber.
    if (rotinas.length > 0 && !podeCriarRotina((await deps.repos.rotinas.contarDoAgente(input.agenteId)) + rotinas.length - 1)) {
      throw new ErroDeDominio("limite_atingido", { cause: "rotinas por agente" });
    }
  } catch (e) {
    if (ehErroDeDominio(e)) return { data: { erro: e.codigo, rotina: rotinas.length } };
    throw e;
  }

  const ids: string[] = [];
  for (const r of rotinas) {
    const criada = await deps.repos.propostas.criar({ conversaId: input.conversaId, agenteId: input.agenteId, payload: r });
    if (!criada) throw new ErroDeDominio("nao_permitido");
    ids.push(criada.id);
  }
  if (ids.length > 0) payload.rotinas = ids;

  // NOD-190: a revisão do perfil de agora vai no payload; a confirmação só aplica se ele ainda for este.
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (agente) payload.revisao = revisaoAtualDoPerfil(agente);

  const proposta = await deps.repos.propostas.criar({ conversaId: input.conversaId, agenteId: input.agenteId, payload });
  if (!proposta) throw new ErroDeDominio("nao_permitido");
  const agora = deps.agora();
  const autoria = autoriaAgente({ agenteId: input.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher" });
  return {
    data: { proposta_id: proposta.id, rotinas: rotinas.map((r) => ({ resumo: r.resumo })) },
    events: [evento(deps.escopo, { kind: "proposta_criada", autoria, agora, conversaId: input.conversaId, turnoId: input.turnoId, dados: { proposta_id: proposta.id, kind: "perfil", agente_id: input.agenteId, rotinas: ids.length } })],
  };
};
