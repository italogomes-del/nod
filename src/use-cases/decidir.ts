import { MODELO_AGENTE_PADRAO } from "../contracts/modelos.ts";
import { randomUUID } from "node:crypto";
import type { Decisao } from "../contracts/decisao.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { ItemAprovacao } from "../contracts/item-aprovacao.ts";
import type { DesfechoItem } from "../contracts/motivos.ts";
import { redigirDesfechoAprovacao } from "../domain/aprovacao-desfecho.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { redigir } from "../domain/redacao.ts";
import { PRAZO_DECISAO_MS } from "./pedir-a-pessoa.ts";
import { autoriaDaPessoa } from "./registrar-negacao.ts";
import type { CasoDeUso, Deps, Services } from "./tipos.ts";

export type MarcacaoItem = { id: string; selecionado: boolean; textoFinal?: string };

export type EntradaDecidir = { decisaoId: string; itens?: MarcacaoItem[] };

/** Item pronto para executar FORA da transação (conector resolvido por slug ainda dentro dela). */
export type ItemAExecutar = { item: ItemAprovacao; conectorId: string | null };

export type SaidaMarcarEDecidir = { decisao: Decisao; itens: ItemAprovacao[]; aExecutar: ItemAExecutar[] };

export type DesfechoExecutado = { itemId: string; desfecho: DesfechoItem };

export type SaidaDecidir = {
  decisao: Decisao;
  itens: ItemAprovacao[];
  desfechos: DesfechoExecutado[];
  mensagemId: string | null;
  turnoRetomadaId: string | null;
};

/**
 * FASE 1 (na tx da rota): marca/desmarca/edita os itens (marcado_por = pessoa da sessão), fecha a
 * decisão (idempotente: já decidida → estado_invalido) e devolve o que executar. Só 'aprovacao' e
 * 'retomar_turno' são decididos aqui; perfil/rotina/gate_rotina/acesso e as três de pedir_a_pessoa
 * são compostas pela L9 com os casos de uso da L6/L7 (ver PENDENCIA-CONTRATO.md).
 */
export const marcarEDecidir: CasoDeUso<EntradaDecidir, SaidaMarcarEDecidir> = async (deps, input) => {
  const agora = deps.agora();
  const decisao = await deps.repos.decisoes.buscar(input.decisaoId);
  if (!decisao) throw new ErroDeDominio("nao_encontrado", { cause: "decisão" });
  if ((await deps.repos.agentes.buscar(decisao.agenteId, true))?.excluidoEm || (decisao.turnoId && await deps.repos.agentes.execucaoBloqueada(decisao.turnoId))) throw new ErroDeDominio("estado_invalido");
  if (decisao.estado !== "pendente" && decisao.estado !== "reaberta") throw new ErroDeDominio("estado_invalido", { cause: `decisão ${decisao.estado}` });
  if (decisao.tipo !== "aprovacao" && decisao.tipo !== "retomar_turno") {
    throw new ErroDeDominio("estado_invalido", { cause: `decisão do tipo ${decisao.tipo} não é decidida por este caso de uso` });
  }
  for (const marca of input.itens ?? []) {
    const existente = await deps.repos.itensAprovacao.buscar(marca.id);
    if (!existente || existente.decisaoId !== decisao.id) throw new ErroDeDominio("entrada_invalida", { cause: `item ${marca.id} não pertence à decisão` });
    const marcado = await deps.repos.itensAprovacao.marcar(marca.id, { selecionado: marca.selecionado, textoFinal: marca.textoFinal, agora });
    if (!marcado) throw new ErroDeDominio("nao_permitido", { cause: "item de outra pessoa" });
  }
  const decidida = await deps.repos.decisoes.decidir(decisao.id, { por: deps.escopo.pessoaId, agora });
  if (!decidida) throw new ErroDeDominio("estado_invalido", { cause: "decisão já decidida" });
  const itens = await deps.repos.itensAprovacao.listar(decisao.id);
  const aExecutar: ItemAExecutar[] = [];
  for (const item of itens) {
    const conector = item.selecionado ? await deps.repos.conectores.buscarPorSlug(item.destino.conector) : null;
    aExecutar.push({ item, conectorId: conector?.id ?? null });
  }
  const evento: RuntimeEvent = {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: agora,
    kind: "decisao_decidida",
    autoria: autoriaDaPessoa(deps.escopo),
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: decidida.conversaId,
    turnoId: decidida.turnoId,
    dados: { decisao_id: decidida.id, tipo: decidida.tipo, selecionados: itens.filter((i) => i.selecionado).length, total: itens.length },
  };
  return { data: { decisao: decidida, itens, aExecutar }, events: [evento] };
};

/** E4.3: a ação usa o texto EDITADO — todo argumento string igual ao texto original é trocado pelo final (definido em 2026-09-16). */
export function argumentosComTextoFinal(item: ItemAprovacao): Record<string, unknown> {
  if (item.textoFinal === item.textoOriginal) return item.destino.argumentos;
  const saida: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(item.destino.argumentos)) saida[k] = v === item.textoOriginal ? item.textoFinal : v;
  return saida;
}

/**
 * Execução FORA da transação (sem banco): exatamente os itens selecionados vão ao conector
 * (E4.1); desmarcado sensível = sensivel_nao_aprovado, desmarcado comum = retirado_pela_pessoa,
 * erro ou isError do conector = falhou_na_execucao (E4.5: nunca "enviado" quando falhou).
 */
export async function executarItens(services: Pick<Services, "conectores">, aExecutar: readonly ItemAExecutar[]): Promise<DesfechoExecutado[]> {
  const desfechos: DesfechoExecutado[] = [];
  for (const { item, conectorId } of aExecutar) {
    if (!item.selecionado) {
      desfechos.push({ itemId: item.id, desfecho: item.origemSensivel ? "sensivel_nao_aprovado" : "retirado_pela_pessoa" });
      continue;
    }
    if (!conectorId) {
      desfechos.push({ itemId: item.id, desfecho: "falhou_na_execucao" });
      continue;
    }
    try {
      const r = await services.conectores.chamar(conectorId, item.destino.ferramenta, argumentosComTextoFinal(item));
      desfechos.push({ itemId: item.id, desfecho: r.isError ? "falhou_na_execucao" : "executado" });
    } catch {
      desfechos.push({ itemId: item.id, desfecho: "falhou_na_execucao" });
    }
  }
  return desfechos;
}

export type EntradaAssentarAprovacao = { decisaoId: string; desfechos: readonly DesfechoExecutado[] };
export type SaidaAssentarAprovacao = { mensagemId: string | null; turnoRetomadaId: string | null; itens: ItemAprovacao[] };

/**
 * FASE 2 (tx nova): grava o desfecho por item, escreve a mensagem PERMANENTE 'resultado_aprovacao'
 * ("Marlon aprovou 2 de 4; não enviado: …", E4.5) e cria o turno de RETOMADA (origem 'retomada',
 * retoma_turno_id → o turno que pediu; --resume pela sessão da conversa) com prompt tipado por item.
 */
export const assentarAprovacao: CasoDeUso<EntradaAssentarAprovacao, SaidaAssentarAprovacao> = async (deps, input) => {
  const agora = deps.agora();
  const decisao = await deps.repos.decisoes.buscar(input.decisaoId);
  if (!decisao) throw new ErroDeDominio("nao_encontrado", { cause: "decisão" });
  for (const d of input.desfechos) await deps.repos.itensAprovacao.registrarDesfecho(d.itemId, d.desfecho);
  const itens = await deps.repos.itensAprovacao.listar(decisao.id);
  const pessoa = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
  const aprovadorNome = pessoa?.nome ?? "A pessoa";
  const texto = redigirDesfechoAprovacao({ itens, aprovadorNome, agora });
  const autoria = autoriaDaPessoa(deps.escopo);
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: decisao.conversaId,
    turnoId: decisao.turnoId,
    autoria,
    kind: "resultado_aprovacao",
    texto,
    payload: { kind: "resultado_aprovacao", decisaoId: decisao.id, itens: itens.map((i) => ({ idx: i.idx, desfecho: i.desfecho ?? "falhou_na_execucao" })) },
    confianca: "confiavel",
  });
  const events: RuntimeEvent[] = [];
  let turnoRetomadaId: string | null = null;
  if (decisao.turnoId) {
    const original = await deps.repos.turnos.buscar(decisao.turnoId);
    const linhas = itens.map((i) => `- item ${i.idx + 1} (${i.destino.conector}.${i.destino.ferramenta}): ${i.desfecho ?? "sem desfecho"} — ${i.textoFinal}`);
    const entradaTexto = [`${redigir("retomada", agora, { motivo: "aprovação decidida" })}`, `Resultado da aprovação "${decisao.frase}" (${texto}):`, ...linhas, "Continue a partir daqui; nada foi reenviado."].join("\n");
    const turno = await deps.repos.turnos.enfileirar({
      conversaId: decisao.conversaId,
      agenteId: decisao.agenteId,
      origem: "retomada",
      prazoEm: agora + PRAZO_DECISAO_MS,
      profundidade: 0,
      entradaTexto,
      entradaConfianca: "confiavel",
      modelo: original?.modelo ?? MODELO_AGENTE_PADRAO,
      retomaTurnoId: decisao.turnoId,
    });
    turnoRetomadaId = turno?.id ?? null;
    if (turno) {
      events.push({
        tenantId: deps.escopo.tenantId,
        id: randomUUID(),
        createdAt: agora,
        kind: "turno_criado",
        autoria,
        pessoaDestinoId: deps.escopo.pessoaId,
        conversaId: decisao.conversaId,
        turnoId: turno.id,
        dados: { origem: "retomada", retoma_turno_id: decisao.turnoId, decisao_id: decisao.id },
      });
    }
  }
  if (mensagem) {
    events.push({
      tenantId: deps.escopo.tenantId,
      id: randomUUID(),
      createdAt: agora,
      kind: "mensagem_criada",
      autoria,
      pessoaDestinoId: deps.escopo.pessoaId,
      conversaId: decisao.conversaId,
      turnoId: decisao.turnoId,
      dados: { mensagem_id: mensagem.id, kind: "resultado_aprovacao", decisao_id: decisao.id, executados: itens.filter((i) => i.desfecho === "executado").length, total: itens.length },
    });
  }
  return { data: { mensagemId: mensagem?.id ?? null, turnoRetomadaId, itens }, events };
};

/**
 * Caminho completo sobre os MESMOS deps (uma transação): fase 1 → execução → fase 2. A rota da L9
 * pode separar as fases em duas transações para a chamada ao conector não segurar a tx.
 * 'retomar_turno' cria o turno novo sem executar nada.
 */
export const decidir: CasoDeUso<EntradaDecidir, SaidaDecidir> = async (deps: Deps, input) => {
  const fase1 = await marcarEDecidir(deps, input);
  const events: RuntimeEvent[] = [...(fase1.events ?? [])];
  if (fase1.data.decisao.tipo === "retomar_turno") {
    const r = await retomarPorDecisao(deps, { decisao: fase1.data.decisao });
    events.push(...(r.events ?? []));
    return { data: { decisao: fase1.data.decisao, itens: [], desfechos: [], mensagemId: null, turnoRetomadaId: r.data.turnoRetomadaId }, events };
  }
  const desfechos = await executarItens(deps.services, fase1.data.aExecutar);
  const fase2 = await assentarAprovacao(deps, { decisaoId: fase1.data.decisao.id, desfechos });
  events.push(...(fase2.events ?? []));
  return { data: { decisao: fase1.data.decisao, itens: fase2.data.itens, desfechos, mensagemId: fase2.data.mensagemId, turnoRetomadaId: fase2.data.turnoRetomadaId }, events };
};

/**
 * Decisão 'retomar_turno' (ADR-009/010: retomar = turno NOVO com retoma_turno_id, nunca requeue).
 * O texto de entrada é a redação fixa de retomada; a sessão do CLI vem da conversa (--resume).
 */
export const retomarPorDecisao: CasoDeUso<{ decisao: Decisao }, { turnoRetomadaId: string | null }> = async (deps, { decisao }) => {
  const agora = deps.agora();
  if (!decisao.turnoId) return { data: { turnoRetomadaId: null } };
  const original = await deps.repos.turnos.buscar(decisao.turnoId);
  if (!original) throw new ErroDeDominio("nao_encontrado", { cause: "turno interrompido" });
  const turno = await deps.repos.turnos.enfileirar({
    conversaId: decisao.conversaId,
    agenteId: decisao.agenteId,
    origem: "retomada",
    prazoEm: agora + PRAZO_DECISAO_MS,
    profundidade: original.profundidade,
    entradaTexto: redigir("retomada", agora, { motivo: original.motivoInterrupcao ?? "interrupção" }),
    entradaConfianca: original.entradaConfianca,
    modelo: original.modelo,
    retomaTurnoId: original.id,
    reenvios: original.reenvios + 1,
  });
  const events: RuntimeEvent[] = turno
    ? [{ tenantId: deps.escopo.tenantId, id: randomUUID(), createdAt: agora, kind: "turno_criado", autoria: autoriaDaPessoa(deps.escopo), pessoaDestinoId: deps.escopo.pessoaId, conversaId: decisao.conversaId, turnoId: turno.id, dados: { origem: "retomada", retoma_turno_id: original.id, decisao_id: decisao.id } }]
    : [];
  return { data: { turnoRetomadaId: turno?.id ?? null }, events };
};
