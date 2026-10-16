import type { Agente } from "../contracts/agente.ts";
import type { IdHarness } from "../contracts/harness.ts";
import type { IasDaPessoa, InteligenciaBot } from "../contracts/inteligencia.ts";
import type { Inventario } from "../contracts/inventario.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { inventarioHarnessSemSonda } from "../domain/harness.ts";
import { aplicarPedidoInteligencia, derivadosDa, iasDaPessoa, inteligenciaDoAgente } from "../domain/inteligencia.ts";
import { nomeDoProvedor } from "../domain/troca-de-ia.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";
import { levarTasksParaAInteligencia } from "./trocas-de-ia.ts";

/**
 * `GET /agentes/:id/inteligencia` (definido em 2026-10-10, emenda da ADR-036): o modo, a IA fixa, a ordem própria e as
 * escolhas por IA do bot. Ver é de quem vê o bot (a policy); mudar é só da dona (definirInteligenciaDoBot).
 */
export const lerInteligenciaDoBot: CasoDeUso<{ agenteId: string }, { inteligencia: InteligenciaBot }> = async (deps, input) => {
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (!agente) throw new ErroDeDominio("nao_encontrado");
  return { data: { inteligencia: inteligenciaDoAgente(agente) } };
};

/**
 * `PUT /agentes/:id/inteligencia`: a tela 2B (e a gaveta, 2A) mudam o modo, a ordem própria e o modelo e o raciocínio
 * de cada IA. Só a dona; o Nod também (ADR-081: modelo e esforço continuam livres). Grava os derivados junto
 * (harness/modelo/esforco) e, se a IA ou o modelo que o turno copia mudou, a próxima mensagem começa sessão nova do CLI,
 * como no PATCH de antes (outro modelo não retoma a sessão do anterior).
 * ADR-108 (R5, E8): `levarTasks: true` leva também as tasks pendentes do bot para a inteligência nova (e acorda as que
 * esperavam a cota); ausente ou false = só daqui em diante. O campo sai do pedido ANTES de `aplicarPedidoInteligencia`,
 * que recusa chave desconhecida.
 */
export const definirInteligenciaDoBot: CasoDeUso<{ agenteId: string; pedido: unknown }, { agente: Agente; tasksLevadas?: number }> = async (deps, input) => {
  const existente = await deps.repos.agentes.buscar(input.agenteId);
  if (!existente) throw new ErroDeDominio("nao_encontrado");
  if (existente.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
  const { levarTasks, pedido } = separarLevarTasks(input.pedido);
  const antes = inteligenciaDoAgente(existente);
  const nova = aplicarPedidoInteligencia(antes, pedido);
  const agente = await deps.repos.agentes.atualizarPerfil(input.agenteId, { inteligencia: nova });
  if (!agente) throw new ErroDeDominio("nao_permitido");
  const de = derivadosDa(antes);
  const para = derivadosDa(nova);
  const sessaoMudou = de.harness !== para.harness || de.modelo !== para.modelo || de.esforco !== para.esforco || JSON.stringify(antes.escolhas) !== JSON.stringify(nova.escolhas);
  if (sessaoMudou) {
    const conversa = await deps.repos.conversas.buscarPropriaDoAgente(agente.id);
    if (conversa) await deps.repos.conversas.atualizarSessaoCli(conversa.id, null);
  }
  const autoria = autoriaPessoa(deps.escopo);
  const tasksLevadas = levarTasks
    ? await levarTasksParaAInteligencia(deps, { agenteId: agente.id, harness: para.harness, modelo: para.modelo, nomeDe: nomeDaInteligencia(de.harness), nomePara: nomeDaInteligencia(para.harness), agora: deps.agora() })
    : undefined;
  return {
    data: { agente, ...(tasksLevadas !== undefined ? { tasksLevadas } : {}) },
    events: [evento(deps.escopo, { kind: "agente_atualizado", autoria, agora: deps.agora(), dados: { agente_id: agente.id, acao: "inteligencia", modo: nova.modo, fixa: nova.fixa, nome: agente.nome, ...(tasksLevadas !== undefined ? { tasks_levadas: tasksLevadas } : {}) } })],
  };
};

const nomeDaInteligencia = (harness: string): string => (harness === "auto" ? "Automático" : nomeDoProvedor(harness));

/** R5: tira `levarTasks` (boolean) do corpo; o resto segue para `aplicarPedidoInteligencia`, que valida estrito. */
function separarLevarTasks(corpo: unknown): { levarTasks: boolean; pedido: unknown } {
  if (typeof corpo !== "object" || corpo === null || Array.isArray(corpo) || !("levarTasks" in corpo)) return { levarTasks: false, pedido: corpo };
  const { levarTasks, ...pedido } = corpo as Record<string, unknown>;
  if (typeof levarTasks !== "boolean") throw new ErroDeDominio("entrada_invalida", { cause: "levarTasks" });
  return { levarTasks, pedido };
}

/**
 * `GET /ias`: as IAs da pessoa como Provedores de IA e a tela 2B mostram — a ordem dela (efetiva), o inventário das
 * máquinas vivas com o limite em vigor por cima, e os modelos com os níveis de raciocínio e o recomendado. O inventário
 * vem da composição (a ponte em memória); a ordem e os limites, do banco.
 */
export const lerIasDaPessoa: CasoDeUso<{ inventarios: Partial<Record<IdHarness, Inventario>> }, IasDaPessoa> = async (deps, input) => {
  const agora = deps.agora();
  const p = await deps.repos.preferencias.buscar();
  return { data: iasDaPessoa({ ordem: p.ordemIas ?? null, limites: p.iasNoLimite ?? {}, inventarios: input.inventarios, agora, semSonda: () => inventarioHarnessSemSonda(agora) }) };
};
