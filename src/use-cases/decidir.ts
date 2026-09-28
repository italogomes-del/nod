import { randomUUID } from "node:crypto";
import type { Decisao } from "../contracts/decisao.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { ItemAprovacao } from "../contracts/item-aprovacao.ts";
import type { DesfechoItem } from "../contracts/motivos.ts";
import type { Turno } from "../contracts/turno.ts";
import { redigirDesfechoAprovacao } from "../domain/aprovacao-desfecho.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { redigir } from "../domain/redacao.ts";
import { rotinaDoTurno } from "./apoio-l7.ts";
import { enfileirarRetomada } from "./enfileirar-retomada.ts";
import { fecharGemeas } from "./fechar-gemeas.ts";
import { PRAZO_DECISAO_MS } from "./pedir-a-pessoa.ts";
import { autoriaDaPessoa } from "./registrar-negacao.ts";
import type { CasoDeUso, Deps, Services } from "./tipos.ts";

export type MarcacaoItem = { id: string; selecionado: boolean; textoFinal?: string };

export type EntradaDecidir = { decisaoId: string; itens?: MarcacaoItem[] };

/** Item pronto para executar FORA da transação (conector resolvido por slug ainda dentro dela). */
export type ItemAExecutar = {
  item: ItemAprovacao;
  conectorId: string | null;
  computador?: { tenantId: string; pessoaId: string; agenteId: string; turnoId: string; acaoId: string };
  /** ADR-048: a dona da decisão — item `execucao: "maquina"` só roda no gh do Mac DELA. */
  dono?: { tenantId: string; pessoaId: string };
  /** ADR-048: a decisão veio de turno de rotina; só então o GitHub App da organização pode atender. */
  rotina?: boolean;
  /** ADR-055: comando no terminal do Mac — aprovar LIBERA; quem roda é o hook do turno, no Mac da pessoa. */
  terminal?: boolean;
};

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
    // Computador e terminal (ADR-055): aprova-se exatamente o que o bot vai fazer — o texto não se edita no card.
    if ((existente.destino.conector === "computador" || existente.destino.conector === "terminal") && marca.textoFinal !== undefined && marca.textoFinal !== existente.textoOriginal) throw new ErroDeDominio("entrada_invalida");
    const marcado = await deps.repos.itensAprovacao.marcar(marca.id, { selecionado: marca.selecionado, textoFinal: marca.textoFinal, agora });
    if (!marcado) throw new ErroDeDominio("nao_permitido", { cause: "item de outra pessoa" });
  }
  const decidida = await deps.repos.decisoes.decidir(decisao.id, { por: deps.escopo.pessoaId, agora });
  if (!decidida) throw new ErroDeDominio("estado_invalido", { cause: "decisão já decidida" });
  const itens = await deps.repos.itensAprovacao.listar(decisao.id);
  const aExecutar: ItemAExecutar[] = [];
  const dono = { tenantId: decisao.tenantId, pessoaId: decisao.ownerId };
  const rotina = decisao.turnoId ? (await rotinaDoTurno(deps.repos, decisao.turnoId)) !== null : false;
  for (const item of itens) {
    if (item.destino.conector === "computador") {
      if (decisao.ownerId !== deps.escopo.pessoaId || !decisao.turnoId || typeof item.destino.argumentos.acaoId !== "string") throw new ErroDeDominio("nao_permitido");
      if (!item.selecionado) await deps.repos.computadores.concluir(item.destino.argumentos.acaoId, "recusada");
      aExecutar.push({ item, conectorId: null, computador: { tenantId: decisao.tenantId, pessoaId: decisao.ownerId, agenteId: decisao.agenteId, turnoId: decisao.turnoId, acaoId: item.destino.argumentos.acaoId } });
      continue;
    }
    // ADR-055: o comando roda no Mac da DONA, pelo hook do turno dela — só ela aprova.
    if (item.destino.conector === "terminal") {
      if (decisao.ownerId !== deps.escopo.pessoaId || !decisao.turnoId) throw new ErroDeDominio("nao_permitido");
      aExecutar.push({ item, conectorId: null, terminal: true });
      continue;
    }
    const conector = item.selecionado ? await deps.repos.conectores.buscarPorSlug(item.destino.conector) : null;
    aExecutar.push({ item, conectorId: conector?.id ?? null, dono, rotina });
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
export async function executarItens(services: Pick<Services, "conectores" | "computadores" | "github">, aExecutar: readonly ItemAExecutar[]): Promise<DesfechoExecutado[]> {
  const desfechos: DesfechoExecutado[] = [];
  for (const { item, conectorId, computador, dono, rotina, terminal } of aExecutar) {
    if (!item.selecionado) {
      desfechos.push({ itemId: item.id, desfecho: item.origemSensivel ? "sensivel_nao_aprovado" : "retirado_pela_pessoa" });
      continue;
    }
    // ADR-055: nada roda no servidor. "executado" é o que o hook lê para soltar o comando (autorizar-comando.ts).
    if (terminal) {
      desfechos.push({ itemId: item.id, desfecho: "executado" });
      continue;
    }
    if (item.destino.execucao === "maquina") {
      // ADR-048: roda no gh do Mac da dona. No modo local o servidor É esse Mac e executa agora; no
      // compartilhado o item fica SEM desfecho e o app desktop da dona o puxa pela ponte (itens-na-maquina.ts).
      const local = dono && services.github?.executarNaMaquina ? await services.github.executarNaMaquina(dono, item.destino.ferramenta, argumentosComTextoFinal(item)).catch(() => null) : null;
      if (local) desfechos.push({ itemId: item.id, desfecho: local.isError ? "falhou_na_execucao" : "executado" });
      continue;
    }
    if (computador) {
      try {
        if (!services.computadores) throw new ErroDeDominio("estado_invalido");
        await services.computadores.executarAprovado(computador);
        desfechos.push({ itemId: item.id, desfecho: "executado" });
      } catch { desfechos.push({ itemId: item.id, desfecho: "falhou_na_execucao" }); }
      continue;
    }
    if (!conectorId) {
      desfechos.push({ itemId: item.id, desfecho: "falhou_na_execucao" });
      continue;
    }
    try {
      const r = await services.conectores.chamar(conectorId, item.destino.ferramenta, argumentosComTextoFinal(item), { rotina: rotina === true });
      desfechos.push({ itemId: item.id, desfecho: r.isError ? "falhou_na_execucao" : "executado" });
    } catch {
      desfechos.push({ itemId: item.id, desfecho: "falhou_na_execucao" });
    }
  }
  return desfechos;
}

/** A entrada da retomada que continua uma aprovação: o desfecho por item, em texto fixo do servidor. */
export function entradaDaAprovacao(decisao: Decisao, itens: readonly ItemAprovacao[], texto: string): string {
  const linhas = itens.map((i) => `- item ${i.idx + 1} (${i.destino.conector}.${i.destino.ferramenta}): ${i.desfecho ?? "sem desfecho"} — ${i.textoFinal}`);
  const noComputador = itens.some((i) => i.destino.conector === "computador" && i.desfecho === "executado");
  // ADR-055: o comando aprovado depois de a espera no turno acabar ainda não rodou — o turno anterior foi negado.
  const noTerminal = itens.some((i) => i.destino.conector === "terminal" && i.desfecho === "executado");
  return [
    // definido em 2026-09-28: não é "turno interrompido" — o turno que pediu concluiu; esta é a continuação dele.
    "Continuando a tarefa: a pessoa decidiu a aprovação que você pediu; nada foi reenviado.",
    `Resultado da aprovação "${decisao.frase}" (${texto}):`,
    ...linhas,
    ...(noComputador ? ["O resultado da ação no computador não veio junto: observe a tela ou os arquivos antes de seguir."] : []),
    ...(noTerminal ? ["O comando aprovado ainda NÃO rodou: rode exatamente o mesmo comando agora — ele passa sem novo pedido."] : []),
    "Continue a partir daqui; nada foi reenviado.",
  ].join("\n");
}

function turnoCriado(deps: Deps, turnoId: string, decisao: Decisao, autoria: RuntimeEvent["autoria"], agora: number): RuntimeEvent {
  return { tenantId: deps.escopo.tenantId, id: randomUUID(), createdAt: agora, kind: "turno_criado", autoria, pessoaDestinoId: deps.escopo.pessoaId, conversaId: decisao.conversaId, turnoId, dados: { origem: "retomada", retoma_turno_id: decisao.turnoId, decisao_id: decisao.id } };
}

/**
 * Rede de segurança (definido em 2026-09-28, 0032): o turno TERMINOU sem receber uma aprovação que já foi
 * decidida — a espera do proxy acabou um instante antes do clique, ou o turno caiu. Chamado pelo
 * assentamento do turno, sob a mesma trava da fase 2. Item ainda executando fica para a fase 2.
 */
export async function continuarAprovacoesDoTurno(deps: Deps, turno: Turno): Promise<RuntimeEvent[]> {
  const agora = deps.agora();
  const events: RuntimeEvent[] = [];
  for (const decisao of await deps.repos.decisoes.aContinuarDoTurno(turno.id)) {
    const itens = await deps.repos.itensAprovacao.listar(decisao.id);
    if (itens.some((i) => i.selecionado && i.desfecho === null)) continue;
    if ((await deps.repos.decisoes.reivindicarContinuacao(decisao.id, "retomada", agora)) !== "minha") continue;
    const pessoa = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
    const texto = redigirDesfechoAprovacao({ itens, aprovadorNome: pessoa?.nome ?? "A pessoa", agora });
    const r = await enfileirarRetomada(deps, { original: turno, prazoEm: agora + PRAZO_DECISAO_MS, entradaTexto: entradaDaAprovacao(decisao, itens, texto) });
    if (r.turno && r.nova) events.push(turnoCriado(deps, r.turno.id, decisao, autoriaDaPessoa(deps.escopo), agora));
  }
  return events;
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
  const noMac = itens.filter((i) => i.selecionado && i.desfecho === null && i.destino.execucao === "maquina");
  if (noMac.length > 0) {
    // ADR-048: aprovado, mas o efeito é do gh do Mac da dona — o resultado e a retomada saem quando
    // ele relatar (itens-na-maquina.ts), ou por expiração. Enquanto isso a conversa diz o que espera.
    const autoriaEspera = autoriaDaPessoa(deps.escopo);
    const espera = await deps.repos.mensagens.criar({
      conversaId: decisao.conversaId,
      turnoId: decisao.turnoId,
      autoria: autoriaEspera,
      kind: "sistema",
      texto: `Aprovado. ${noMac.length === 1 ? "1 ação aguarda" : `${noMac.length} ações aguardam`} seu Mac: com o app nod aberto e o gh logado, o GitHub recebe em instantes e o resultado aparece aqui.`,
      confianca: "confiavel",
    });
    const aviso: RuntimeEvent[] = espera ? [{ tenantId: deps.escopo.tenantId, id: randomUUID(), createdAt: agora, kind: "mensagem_criada", autoria: autoriaEspera, pessoaDestinoId: deps.escopo.pessoaId, conversaId: decisao.conversaId, turnoId: decisao.turnoId, dados: { mensagem_id: espera.id, kind: "sistema", decisao_id: decisao.id, aguardando_maquina: noMac.length } }] : [];
    return { data: { mensagemId: espera?.id ?? null, turnoRetomadaId: null, itens }, events: aviso };
  }
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
    // definido em 2026-09-28 (0032): uma decisão, UMA continuação. A trava do turno serializa esta fase com o
    // assentamento dele. Turno vivo = ele mesmo recebe a decisão (espera do proxy) ou, se terminar sem ela,
    // o assentamento a continua (continuarAprovacoesDoTurno). Antes esta fase SEMPRE criava retomada, e a
    // aprovação dada durante a espera virava duas continuações — dez turnos da Ada em três minutos.
    const original = await deps.repos.turnos.buscarTravado(decisao.turnoId);
    const vivo = original?.estado === "despachando";
    if (original && !vivo && (await deps.repos.decisoes.reivindicarContinuacao(decisao.id, "retomada", agora)) === "minha") {
      const r = await enfileirarRetomada(deps, { original, prazoEm: agora + PRAZO_DECISAO_MS, entradaTexto: entradaDaAprovacao(decisao, itens, texto) });
      turnoRetomadaId = r.turno?.id ?? null;
      if (r.turno && r.nova) events.push(turnoCriado(deps, r.turno.id, decisao, autoria, agora));
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
  // definido em 2026-09-24: o "Retomar" repetido da mesma conversa (×N na fila) sai junto — fase da
  // DONA, a mesma transação que cria o turno de retomada.
  const gemeas = await fecharGemeas(deps, decisao);
  if (!decisao.turnoId) return { data: { turnoRetomadaId: null }, events: gemeas.events };
  const original = await deps.repos.turnos.buscar(decisao.turnoId);
  if (!original) throw new ErroDeDominio("nao_encontrado", { cause: "turno interrompido" });
  const { turno, nova } = await enfileirarRetomada(deps, {
    original,
    prazoEm: agora + PRAZO_DECISAO_MS,
    entradaTexto: redigir("retomada", agora, { motivo: original.motivoInterrupcao ?? "interrupção" }),
    reenvios: original.reenvios + 1,
  });
  const events: RuntimeEvent[] = turno && nova
    ? [{ tenantId: deps.escopo.tenantId, id: randomUUID(), createdAt: agora, kind: "turno_criado", autoria: autoriaDaPessoa(deps.escopo), pessoaDestinoId: deps.escopo.pessoaId, conversaId: decisao.conversaId, turnoId: turno.id, dados: { origem: "retomada", retoma_turno_id: original.id, decisao_id: decisao.id } }]
    : [];
  return { data: { turnoRetomadaId: turno?.id ?? null }, events: [...gemeas.events, ...events] };
};
