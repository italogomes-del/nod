import { randomUUID } from "node:crypto";
import type { Decisao } from "../contracts/decisao.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { DestinoItem } from "../contracts/item-aprovacao.ts";
import type { PlanoTurno } from "../contracts/plano-turno.ts";
import { USO_DO_MAC_PADRAO } from "../contracts/raio-x.ts";
import { COMANDO_REVISOR_MAX, TETO_REVISOES_POR_TURNO, type FalhaRevisao, type PedidoRevisao } from "../contracts/revisao.ts";
import { cotaDasContas, cotaDasIas, situacaoDaIa } from "../domain/cota-da-ia.ts";
import { portaoDoMac } from "../domain/memoria-mac.ts";
import { REGRA_REVISOR, VERSAO_REGRA_REVISOR, type GatilhoDeRevisao } from "../domain/modo-aprovacao.ts";
import {
  FRASE_DA_FALHA,
  FRASE_SEM_REVISOR_NO_CODEX,
  FRASE_TETO_DO_TURNO,
  MENSAGENS_DA_PESSOA_MAX,
  lerVeredito,
  pedidoDoRevisor,
  resumoDaAcao,
  type AcaoParaRevisor,
  type OrigemParaRevisor,
} from "../domain/revisor.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { log } from "../obs/log.ts";
import type { Escopo } from "../shared/types.ts";
import type { TipoAcaoDoModo } from "../repositories/acoes-pelo-modo.repo.ts";
import { rotinaDoTurno } from "./apoio-l7.ts";
import { PRAZO_DECISAO_MS } from "./pedir-a-pessoa.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import { JANELA_CONVERSA_DE_FORA_MS } from "./medir-revisao.ts";
import { sincronizarTrabalho } from "./trabalhos.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * O revisor do Automático no servidor (definido em 2026-10-18, plano dos modos de aprovação, 3d; ADR-115), em três fases,
 * como o NOD-263:
 *
 *  1. `revisarAcaoFase1`, NA tx do pedido: cria a decisão `em_revisao` com o item (o mesmo do cartão) e a linha em
 *     `acoes_pelo_modo`, e devolve o pedido que a rota põe na caixa do turno DEPOIS do commit. Antes de criar, vai direto
 *     ao cartão (pendente, `revisor_falhou`, frase da causa) quando o revisor não pode rodar: Codex ou outra IA sem
 *     revisor; a mesma ação já levou "pede", foi negada ou venceu na cadeia; teto do turno (20) ou do dia; a última
 *     renovação do turno não trouxe `revisa` e o segredo; o disjuntor da máquina; a conta do turno no limite; a memória
 *     da máquina no nível que segura trabalho novo; comando longo demais.
 *  2. Na máquina (o laço do turno, PR 3b): a renovação entrega, o laço roda o CLI e relata pela rota `revisao`.
 *  3. `assentarRevisao`, numa tx NOVA, sob a trava do turno (`buscarTravado`, como decidir.ts): libera só com o turno
 *     `despachando`, sem Parar pedido, o bot vivo e o modo ATUAL automático; senão — e no "pede", na falha e no prazo —
 *     a decisão vira o cartão `pendente` de sempre. Idempotente (`where estado = 'em_revisao'`).
 */

/** O que a rota guarda na caixa do turno depois do commit da fase 1. */
export type PedidoNaCaixa = { escopo: Escopo; machineId: string; pedido: PedidoRevisao };

export type EntradaRevisarAcao = {
  plano: PlanoTurno;
  /** O texto do item (o comando, `Gravar …` ou o pedido ao MCP): é o que a segunda consulta do hook compara. */
  texto: string;
  tipo: Extract<TipoAcaoDoModo, "comando" | "arquivo" | "mcp">;
  acao: AcaoParaRevisor;
  destino: DestinoItem;
  gatilho: GatilhoDeRevisao;
  /** Frase fixa do domínio (comandoArriscado, ou a do gatilho). */
  risco: string;
  contaminado: boolean;
  frase: string;
  agente: { nome: string; titulo: string; descricao: string } | null;
};

export type SaidaRevisarAcao = { aguardar: string; revisao: PedidoNaCaixa | null };

const DIA_MS = 24 * 60 * 60_000;
/** Quantas mensagens da pessoa a fase 1 lê para o pedido (o corte de 600 caracteres vem depois, no domínio). */
const MENSAGENS_LIDAS = 12;

function origemDoTurno(plano: PlanoTurno): OrigemParaRevisor {
  switch (plano.modoTurno) {
    case "rotina":
      return "rotina";
    case "peer":
    case "delegacao":
      return "colega";
    case "sala":
      return "sala";
    default:
      return "conversa";
  }
}

/** ADR-102/NOD-253: a conta da lista que o turno usa no limite; sem conta da lista, a IA do turno no limite. */
async function contaNoLimite(deps: Deps, plano: PlanoTurno): Promise<boolean> {
  const agora = deps.agora();
  if (plano.conta) {
    if (cotaDasContas({ usos: await deps.repos.usoDoPlano.listarPorConta(), agora }).get(plano.conta.id)?.situacao === "limite") return true;
    const conta = (await deps.repos.contasIa.listar()).contas.find((c) => c.id === plano.conta!.id);
    return (conta?.noLimiteAte ?? 0) > agora;
  }
  const preferencias = await deps.repos.preferencias.buscar();
  const cota = cotaDasIas({ usos: await deps.repos.usoDoPlano.listar(), limites: preferencias.iasNoLimite, agora });
  return situacaoDaIa(cota, plano.harness ?? "claude-cli") === "limite";
}

/** A memória (ou o disco) da máquina no nível que segura trabalho novo (`portaoDoMac`, com o "uso do Mac" da pessoa). */
async function memoriaApertada(deps: Deps, machineId: string): Promise<boolean> {
  const pressao = deps.services.revisor?.pressao?.(machineId) ?? null;
  if (!pressao) return false;
  const uso = (await deps.repos.preferencias.buscar()).usoDoMac ?? USO_DO_MAC_PADRAO;
  const portao = portaoDoMac(uso, pressao);
  return portao.tudoNovo !== null || portao.semPrazo;
}

/**
 * A instrução da rotina e se é da pessoa: a rotina nasce da proposta de MESMO id; fechada por regra = criada pelo modo.
 * revisto em 2026-10-18 (revisão do PR 3a): vale a ÚLTIMA palavra sobre a rotina — se o bot a mudou depois e o modo
 * confirmou (`atualizar_rotina` no automático, sem cartão), a instrução atual é do bot, e vai à parte não confiável.
 */
export async function rotinaParaRevisor(deps: Deps, turnoId: string): Promise<{ instrucao: string; daPessoa: boolean } | null> {
  const r = await rotinaDoTurno(deps.repos, turnoId);
  if (!r) return null;
  const mudanca = await deps.repos.propostas.ultimaMudancaDaRotina(r.rotina.id);
  if (mudanca) return { instrucao: r.rotina.instrucao, daPessoa: !mudanca.porRegra };
  const decisao = await deps.repos.decisoes.buscar(r.rotina.id);
  return { instrucao: r.rotina.instrucao, daPessoa: decisao?.desfecho?.tipo !== "decidida_por_regra" };
}

type NaoVai = { falha: FalhaRevisao; frase: string };

/** Por que a fase 1 não manda ao revisor, ou a máquina a que manda; na ordem: o mais barato e o mais seguro primeiro. */
async function paraOndeVai(deps: Deps, e: EntradaRevisarAcao): Promise<{ naoVai: NaoVai } | { machineId: string }> {
  const servico = deps.services.revisor;
  const harness = e.plano.harness ?? "claude-cli";
  if (!servico || harness !== "claude-cli") return { naoVai: { falha: "sem_revisor", frase: harness === "codex-cli" ? FRASE_SEM_REVISOR_NO_CODEX : FRASE_DA_FALHA.sem_revisor } };
  if (e.texto.length > COMANDO_REVISOR_MAX) return { naoVai: { falha: "longo", frase: FRASE_DA_FALHA.longo } };
  if (await deps.repos.itensAprovacao.recusadoNaCadeia(e.plano.turnoId, e.texto)) return { naoVai: { falha: "repetida", frase: FRASE_DA_FALHA.repetida } };
  if ((await deps.repos.acoesPeloModo.revisoesDoTurno(e.plano.turnoId)) >= TETO_REVISOES_POR_TURNO) return { naoVai: { falha: "teto", frase: FRASE_TETO_DO_TURNO } };
  if ((await deps.repos.acoesPeloModo.revisoesDaPessoaDesde(deps.agora() - DIA_MS)) >= servico.config.tetoDia) return { naoVai: { falha: "teto", frase: FRASE_DA_FALHA.teto } };
  const maquina = servico.revisorDoTurno(e.plano.turnoId);
  if (!maquina) return { naoVai: { falha: "sem_revisor", frase: FRASE_DA_FALHA.sem_revisor } };
  if (servico.disjuntorAberto(maquina.machineId)) return { naoVai: { falha: "disjuntor", frase: FRASE_DA_FALHA.disjuntor } };
  if (await contaNoLimite(deps, e.plano)) return { naoVai: { falha: "cota", frase: FRASE_DA_FALHA.cota } };
  if (await memoriaApertada(deps, maquina.machineId)) return { naoVai: { falha: "memoria", frase: FRASE_DA_FALHA.memoria } };
  return { machineId: maquina.machineId };
}

function eventoDecisaoCriada(deps: Deps, decisao: Pick<Decisao, "id" | "agenteId" | "conversaId" | "turnoId">): RuntimeEvent {
  return {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: deps.agora(),
    kind: "decisao_criada",
    autoria: autoriaDoAgente(deps.escopo, decisao.agenteId),
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: decisao.conversaId,
    turnoId: decisao.turnoId,
    dados: { decisao_id: decisao.id, tipo: "aprovacao", itens: 1, sensiveis: 0 },
  };
}

/** FASE 1 (na tx do pedido). Só é chamada com o revisor ligado e o desfecho "revisar" do modo. */
export const revisarAcaoFase1: CasoDeUso<EntradaRevisarAcao, SaidaRevisarAcao> = async (deps, e) => {
  const agora = deps.agora();
  const destino = await paraOndeVai(deps, e);
  const resumo = resumoDaAcao(e.acao);
  const base = { agenteId: e.plano.agenteId, conversaId: e.plano.conversaId, turnoId: e.plano.turnoId, modo: "automatico" as const, tipo: e.tipo, resumo, gatilho: e.gatilho, risco: e.risco };
  // A montagem só lê o que o pedido precisa (mensagens, rotina, pedidas no turno) quando ele vai mesmo sair.
  const modo = e.plano.modoTurno;
  // revisto em 2026-10-18 (revisão do PR 3a): o revisor lê se o turno OU a conversa nas últimas 24 h leu conteúdo de
  // fora (plano, 3b). No arriscado o gatilho não depende disso, e a marca que chegava era só a do turno: a sessão do CLI
  // retomada carrega o e-mail do turno anterior, e o pedido dizia "não leu conteúdo de fora". A leitura que falha conta
  // como lida (o lado seguro).
  const contaminado = "naoVai" in destino || e.contaminado ? e.contaminado : await deps.repos.turnos.conversaLeuDeFora(e.plano.conversaId, { agora, janelaMs: JANELA_CONVERSA_DE_FORA_MS }).catch(() => true);
  const montado = "naoVai" in destino ? null : pedidoDoRevisor({
    acao: e.acao,
    gatilho: e.gatilho,
    risco: e.risco,
    origem: origemDoTurno(e.plano),
    contaminado,
    mensagensDaPessoa: !modo || modo === "conversa" || modo === "criacao" || modo === "sala" || modo === "ligacao" ? await deps.repos.mensagens.textosDaPessoa(e.plano.conversaId, MENSAGENS_LIDAS) : [],
    rotina: modo === "rotina" ? await rotinaParaRevisor(deps, e.plano.turnoId) : null,
    pedidoDeColega: modo === "peer" || modo === "delegacao" ? e.plano.entrada.texto.slice(0, MENSAGENS_DA_PESSOA_MAX * 2) : null,
    bot: e.agente ?? { nome: "O bot", titulo: "", descricao: "" },
    jaPediuNoTurno: await deps.repos.acoesPeloModo.pedidasNoTurno(e.plano.turnoId),
  });
  const naoVai: NaoVai | null = "naoVai" in destino ? destino.naoVai : montado && montado.tipo !== "pedido" ? { falha: montado.tipo, frase: FRASE_DA_FALHA[montado.tipo] } : null;

  const decisao = await deps.repos.decisoes.criar({
    tipo: "aprovacao",
    agenteId: e.plano.agenteId,
    conversaId: e.plano.conversaId,
    turnoId: e.plano.turnoId,
    prazoDecisaoEm: agora + PRAZO_DECISAO_MS,
    frase: e.frase,
    ...(naoVai ? {} : { estado: "em_revisao" as const }),
  });
  if (!decisao) throw new ErroDeDominio("estado_invalido", { cause: "decisão não criada" });
  // O item nasce com o motivo de quando o revisor NÃO responde: se a fase 3 nunca vier (caixa perdida num deploy), o
  // cartão que o varredor solta já diz a verdade. A fase 3 troca pelo motivo certo.
  await deps.repos.itensAprovacao.criarLote(decisao.id, [{ idx: 0, texto: e.texto, destino: e.destino, origemSensivel: false, motivoManual: "revisor_falhou", justificativa: naoVai ? naoVai.frase : FRASE_DA_FALHA.prazo }]);

  if (naoVai || "naoVai" in destino || montado?.tipo !== "pedido") {
    const causa = naoVai ?? { falha: "sem_revisor" as const, frase: FRASE_DA_FALHA.sem_revisor };
    await deps.repos.acoesPeloModo.registrar({ ...base, decisaoId: decisao.id, veredito: "nao_revisado", falha: causa.falha, motivo: causa.frase });
    log("info", "revisao_sem_revisor", { turno_id: e.plano.turnoId, decisao_id: decisao.id, gatilho: e.gatilho, falha: causa.falha });
    return { data: { aguardar: decisao.id, revisao: null }, events: [eventoDecisaoCriada(deps, decisao)] };
  }
  const config = deps.services.revisor!.config;
  await deps.repos.acoesPeloModo.registrar({ ...base, decisaoId: decisao.id, revisorModelo: config.modelo, revisorHarness: "claude-cli", revisorMaquina: destino.machineId });
  const pedido: PedidoRevisao = {
    revisaoId: randomUUID(),
    decisaoId: decisao.id,
    turnoId: e.plano.turnoId,
    modelo: config.modelo,
    ...(config.esforco ? { esforco: config.esforco } : {}),
    prompt: montado.prompt,
    entrada: montado.entrada,
    expiraEm: agora + config.prazoMs,
  };
  log("info", "revisao_pedida", { turno_id: e.plano.turnoId, decisao_id: decisao.id, revisao_id: pedido.revisaoId, gatilho: e.gatilho, machine_id: destino.machineId });
  return { data: { aguardar: decisao.id, revisao: { escopo: deps.escopo, machineId: destino.machineId, pedido } } };
};

/** O que chegou para a fase 3: o texto cru do laço, ou a falha (do laço, do prazo ou do varredor). */
export type ResultadoRevisao =
  | { tipo: "saida"; saida: string; ms?: number; fichasEntrada?: number; fichasSaida?: number; entregueEm?: number | null }
  | { tipo: "falha"; falha: FalhaRevisao; ms?: number; entregueEm?: number | null };

export type SaidaAssentarRevisao = { estado: "liberada" | "cartao" | "ja_assentada"; veredito: "libera" | "pede" | null };

export const FRASE_MODO_MUDOU = "O modo do bot mudou durante a revisão; confira você.";

/**
 * FASE 3 (tx nova, sob a trava do turno). Nunca libera no erro: só o JSON estrito com "libera" e o turno vivo no modo
 * automático soltam a ação; o resto vira o cartão `pendente`, com `decisao_criada` e a task em "precisa de você".
 */
export const assentarRevisao: CasoDeUso<{ decisaoId: string; resultado: ResultadoRevisao }, SaidaAssentarRevisao> = async (deps, { decisaoId, resultado }) => {
  const agora = deps.agora();
  const antes = await deps.repos.decisoes.buscar(decisaoId);
  if (!antes || antes.estado !== "em_revisao" || !antes.turnoId) return { data: { estado: "ja_assentada", veredito: null } };
  const turno = await deps.repos.turnos.buscarTravado(antes.turnoId);
  const veredito = resultado.tipo === "saida" ? lerVeredito(resultado.saida) : null;
  const medidas = { entregueEm: resultado.entregueEm ?? null, revisorMs: resultado.ms ?? null, ...(resultado.tipo === "saida" ? { fichasEntrada: resultado.fichasEntrada ?? null, fichasSaida: resultado.fichasSaida ?? null } : {}) };
  const itens = await deps.repos.itensAprovacao.listar(decisaoId);
  let falha: FalhaRevisao | null = resultado.tipo === "falha" ? resultado.falha : veredito === null ? "saida" : null;
  let frase: string | null = null;

  if (veredito?.decisao === "libera") {
    const agente = await deps.repos.agentes.buscar(antes.agenteId, true);
    const turnoVivo = turno?.estado === "despachando" && !turno.pararSolicitadoEm && !(await deps.repos.agentes.execucaoBloqueada(turno.id));
    const modoAutomatico = agente !== null && !agente.excluidoEm && agente.modoAprovacao === "automatico";
    if (turnoVivo && modoAutomatico) {
      const fechada = await deps.repos.decisoes.concluirRevisao(decisaoId, { liberar: { regra: REGRA_REVISOR, regraVersao: VERSAO_REGRA_REVISOR }, agora });
      if (!fechada) return { data: { estado: "ja_assentada", veredito: null } };
      for (const i of itens) await deps.repos.itensAprovacao.marcarRevisao(i.id, { liberado: true });
      await deps.repos.acoesPeloModo.concluir(decisaoId, { veredito: "libera", motivo: veredito.motivo, ...medidas });
      log("info", "revisao_liberou", { turno_id: antes.turnoId, decisao_id: decisaoId, ms: resultado.ms ?? null });
      return { data: { estado: "liberada", veredito: "libera" } };
    }
    falha = "turno";
    frase = turnoVivo ? FRASE_MODO_MUDOU : FRASE_DA_FALHA.turno;
  }

  const aberta = await deps.repos.decisoes.concluirRevisao(decisaoId, { pendente: { prazoDecisaoEm: agora + PRAZO_DECISAO_MS }, agora });
  if (!aberta) return { data: { estado: "ja_assentada", veredito: null } };
  const pediu = veredito?.decisao === "pede";
  const justificativa = pediu ? veredito.motivo : (frase ?? FRASE_DA_FALHA[falha ?? "saida"]);
  for (const i of itens) await deps.repos.itensAprovacao.marcarRevisao(i.id, { motivoManual: pediu ? "revisor_pediu" : "revisor_falhou", justificativa });
  await deps.repos.acoesPeloModo.concluir(decisaoId, { veredito: veredito?.decisao ?? "falhou", falha: pediu ? null : falha, motivo: justificativa, ...medidas });
  log("info", pediu ? "revisao_pediu" : "revisao_falhou", { turno_id: antes.turnoId, decisao_id: decisaoId, falha: pediu ? null : falha, ms: resultado.ms ?? null });
  // O frame só agora: a tela nunca viu a revisão. A task do turno vai a "precisa de você" (revisão de engenharia 23).
  const events: RuntimeEvent[] = [eventoDecisaoCriada(deps, aberta)];
  if (turno?.trabalhoId) events.push(...(await sincronizarTrabalho(deps, turno.trabalhoId)));
  return { data: { estado: "cartao", veredito: veredito?.decisao ?? null }, events };
};

/**
 * O passo novo do varredor de expiração: a decisão `em_revisao` mais velha que `recolherMs` (2 × o prazo) vira cartão
 * (`prazo`). É o que recolhe a revisão de uma caixa perdida num deploy (a caixa e o segredo do turno são memória).
 */
export async function recolherRevisoesVelhas(deps: Deps, p: { recolherMs: number }): Promise<{ recolhidas: number; events: RuntimeEvent[] }> {
  const events: RuntimeEvent[] = [];
  let recolhidas = 0;
  for (const d of await deps.repos.decisoes.emRevisaoAntesDe(deps.agora() - p.recolherMs)) {
    const r = await assentarRevisao(deps, { decisaoId: d.id, resultado: { tipo: "falha", falha: "prazo" } });
    if (r.data.estado === "cartao") recolhidas += 1;
    events.push(...(r.events ?? []));
  }
  if (recolhidas > 0) log("aviso", "revisoes_recolhidas", { pessoa_id: deps.escopo.pessoaId, recolhidas });
  return { recolhidas, events };
}
