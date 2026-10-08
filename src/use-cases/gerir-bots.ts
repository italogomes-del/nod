import type { AcaoNoLote, MotivoCardDoLote, PayloadPropostaAcesso, PayloadPropostaLoteBots } from "../contracts/conversa.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { AcaoLote, ResultadoGerirBots } from "../contracts/ferramentas-do-nod.ts";
import type { ContextoFerramenta, SaidaCasoDeUso } from "../contracts/servicos.ts";
import { ehErroDeDominio, ErroDeDominio } from "../domain/erro.ts";
import { capacidadesDoNivel } from "../domain/grupos-de-acesso.ts";
import { decidirLote, riscoDaAcao, validarLote, type AcaoResolvida } from "../domain/lote-bots.ts";
import { decidirPeloModo } from "../domain/modo-aprovacao.ts";
import { log } from "../obs/log.ts";
import { autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { semCard, type PorRegra } from "./confirmar-pelo-modo.ts";
import { criarAgente } from "./criar-agente.ts";
import { criarRotinaPelaPessoa } from "./criar-rotina.ts";
import { decidirAcesso } from "./decidir-acesso.ts";
import { duplicarAgente } from "./duplicar-agente.ts";
import { editarPerfil } from "./editar-perfil.ts";
import { gerirAgente } from "./gerir-agente.ts";
import { mudarModoAprovacao } from "./mudar-modo-aprovacao.ts";
import { appsDaPessoa, turnoDoNodComAPessoa } from "./nod.ts";
import { abrirPedidoDeAcesso } from "./pedir-acesso.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * As mãos do Nod (definido em 2026-10-07, ADR-082): `gerir_bots` muda vários bots da pessoa de uma vez. Valida o lote
 * inteiro no domínio (lote-bots.ts) — qualquer problema e nada roda —, deixa o modo do Nod decidir cada ação, executa
 * na hora o que o modo aprova e junta o resto num card só (proposta + decisão 'lote_bots', mesmo id). Confirmar o card
 * (`decidirLoteDeBots`, POST decisoes/:id/decidir) executa as ações marcadas, na ordem.
 *
 * Cada ação roda pelo caso de uso de sempre (criar, duplicar, editar, gerir, rotina, modo), e dar acesso passa pela
 * decisão de acesso (abrirPedidoDeAcesso + decidirAcesso) — o caminho que já pode conceder (ADR-044, emendada pela
 * ADR-082). Cada uma roda num SAVEPOINT: uma que falha volta sozinha e as outras seguem; não há "desfazer o lote".
 */

const FONTE_ROTINA_DO_NOD = "Os apps e o que o bot já sabe.";
const ENTREGAVEL_PADRAO = "Uma mensagem curta na conversa do bot.";
const LIMITES_ROTINA_DO_NOD = "O que muda algo fora do nod segue o modo de aprovação do bot.";
const SEM_DADO_ROTINA_DO_NOD = "Diga em uma linha que não houve nada.";

const VERBO: Record<AcaoLote["tipo"], string> = {
  criar: "Criar",
  duplicar: "Duplicar",
  editar: "Editar",
  mover: "Mover",
  excluir: "Excluir",
  criar_rotina: "Criar rotina",
  dar_acesso: "Dar acesso",
  mudar_modo: "Mudar modo",
};

/** Uma linha legível da ação (a mensagem de sistema do desfecho). */
export function linhaDaAcao(a: Pick<AcaoNoLote, "tipo" | "alvoNome" | "secao" | "app" | "nivel" | "modo">): string {
  const extra = a.tipo === "mover" ? ` para ${a.secao ? `"${a.secao}"` : "fora da seção"}` : a.tipo === "dar_acesso" ? ` ao ${a.app} (${a.nivel === "escrita" ? "ler e alterar" : "ler"})` : a.tipo === "mudar_modo" ? ` para ${a.modo}` : "";
  return `${VERBO[a.tipo]} ${a.alvoNome}${extra}`;
}

/** Roda `fn` num SAVEPOINT da transação do caso de uso: se lança, só o que ela fez volta. */
async function emSavepoint<T>(deps: Deps, fn: () => Promise<T>): Promise<T> {
  return deps.tx(async (trx) => {
    if (typeof (trx as { savepoint?: unknown }).savepoint !== "function") return fn();
    const caixa: { valor?: T } = {};
    await trx.savepoint(async () => {
      caixa.valor = await fn();
    });
    return caixa.valor as T;
  });
}

type Feito = { botId: string; nome: string; events: RuntimeEvent[] };

/** Executa UMA ação já validada sobre o bot alvo (`botId`; null só em criar). Lança ErroDeDominio quando não dá. */
async function executarAcao(deps: Deps, a: AcaoLote & { alvoNome: string }, botId: string | null, ctx: { nodId: string; porRegra: PorRegra | null }): Promise<Feito> {
  const exigirAlvo = (): string => {
    if (!botId) throw new ErroDeDominio("nao_encontrado", { cause: "bot alvo" });
    return botId;
  };
  switch (a.tipo) {
    case "criar": {
      const r = await criarAgente(deps, { dono: "pessoa", nome: a.nome, titulo: a.titulo, descricao: a.descricao, ...(a.modelo ? { modelo: a.modelo } : {}) });
      const events = [...(r.events ?? [])];
      if (a.secao && a.secao.trim() !== "") events.push(...((await gerirAgente(deps, { agenteId: r.data.agente.id, acao: "organizar", secao: a.secao })).events ?? []));
      return { botId: r.data.agente.id, nome: r.data.agente.nome, events };
    }
    case "duplicar": {
      const r = await duplicarAgente(deps, { agenteId: exigirAlvo() });
      return { botId: r.data.agente.id, nome: r.data.agente.nome, events: r.events ?? [] };
    }
    case "editar": {
      const r = await editarPerfil(deps, { agenteId: exigirAlvo(), nome: a.nome, titulo: a.titulo, descricao: a.descricao, modelo: a.modelo, esforco: a.esforco === undefined ? undefined : a.esforco === "" ? null : a.esforco });
      return { botId: r.data.agente.id, nome: r.data.agente.nome, events: r.events ?? [] };
    }
    case "mover": {
      const r = await gerirAgente(deps, { agenteId: exigirAlvo(), acao: "organizar", secao: a.secao ?? "" });
      return { botId: r.data.agente.id, nome: r.data.agente.nome, events: r.events ?? [] };
    }
    case "excluir": {
      const r = await gerirAgente(deps, { agenteId: exigirAlvo(), acao: "excluir" });
      return { botId: r.data.agente.id, nome: r.data.agente.nome, events: r.events ?? [] };
    }
    case "criar_rotina": {
      const r = await criarRotinaPelaPessoa(deps, { agenteId: exigirAlvo(), cron: a.cron ?? "", fusoIana: a.fuso_iana ?? "", instrucao: a.instrucao ?? "", fonte: FONTE_ROTINA_DO_NOD, entregavel: a.entregavel ?? ENTREGAVEL_PADRAO, limitesAprovacao: LIMITES_ROTINA_DO_NOD, politicaSemDado: SEM_DADO_ROTINA_DO_NOD });
      return { botId: exigirAlvo(), nome: a.alvoNome, events: r.events ?? [] };
    }
    case "mudar_modo": {
      const r = await mudarModoAprovacao(deps, { agenteId: exigirAlvo(), modo: a.modo });
      return { botId: r.data.agente.id, nome: r.data.agente.nome, events: r.events ?? [] };
    }
    case "dar_acesso": {
      const alvo = exigirAlvo();
      // Cerca 1: só um app que a PESSOA conectou (o login do app é sempre dela).
      const conector = await deps.repos.conectores.buscarPorSlug(a.app ?? "");
      if (!conector || conector.ownerId !== deps.escopo.pessoaId || !conector.habilitado) throw new ErroDeDominio("estado_invalido", { cause: "app não conectado" });
      const capacidades = capacidadesDoNivel(conector.catalogo, a.nivel ?? "leitura");
      if (capacidades.length === 0) throw new ErroDeDominio("estado_invalido", { cause: "o app não tem ferramenta para esse nível" });
      const conversa = await deps.repos.conversas.buscarPropriaDoAgente(alvo);
      if (!conversa) throw new ErroDeDominio("nao_encontrado", { cause: "conversa do bot" });
      const payload: PayloadPropostaAcesso = { kind: "acesso", conector: conector.slug, capacidades, nivel: a.nivel ?? "leitura", naoPedido: [], para: `Pedido pelo Nod para o ${a.alvoNome}` };
      const aberto = await abrirPedidoDeAcesso(deps, { conversaId: conversa.id, agenteId: alvo, turnoId: null, payload, conector, autoria: autoriaDoAgente(deps.escopo, ctx.nodId) });
      const decidido = await decidirAcesso(deps, { decisaoId: aberto.proposta.id, recusar: false, executor: "catcher", ...(ctx.porRegra ? { porRegra: ctx.porRegra } : {}) });
      return { botId: alvo, nome: a.alvoNome, events: [...semCard(aberto.events), ...(decidido.events ?? [])] };
    }
    default:
      throw new ErroDeDominio("entrada_invalida", { cause: "tipo de ação" });
  }
}

/** Executa, na ordem, as ações indicadas, resolvendo os "@ref" pelos bots que as anteriores criaram. */
async function executarEmOrdem(
  deps: Deps,
  acoes: AcaoNoLote[],
  rodar: (a: AcaoNoLote) => boolean,
  ctx: { nodId: string; porRegraDe: (a: AcaoNoLote) => PorRegra | null },
): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for (const a of acoes) {
    if (!rodar(a)) continue;
    const origem = a.alvoDaAcao !== null ? acoes[a.alvoDaAcao] : null;
    if (origem && (origem.estado !== "feita" || !origem.botId)) {
      a.estado = "falhou";
      a.erro = origem.estado === "recusada" ? "depende_de_acao_recusada" : "depende_de_acao_que_falhou";
      continue;
    }
    const botId = origem ? origem.botId : a.botId;
    try {
      const feito = await emSavepoint(deps, () => executarAcao(deps, origem ? { ...a, alvoNome: origem.alvoNome } : a, botId, { nodId: ctx.nodId, porRegra: ctx.porRegraDe(a) }));
      a.estado = "feita";
      a.erro = null;
      a.botId = feito.botId;
      if (a.tipo === "criar" || a.tipo === "duplicar") a.alvoNome = feito.nome;
      events.push(...feito.events);
    } catch (e) {
      if (!ehErroDeDominio(e)) throw e;
      a.estado = "falhou";
      a.erro = e.codigo;
    }
  }
  return events;
}

/** A regra do modo que aprovou a ação (para a autoria); null = a pessoa. */
function porRegraDoModo(modo: Parameters<typeof decidirPeloModo>[0], risco: MotivoCardDoLote | null): PorRegra | null {
  const d = decidirPeloModo(modo, { arriscada: risco !== null, credencial: false });
  return d?.automatico ? { regra: d.regra, regraVersao: d.versao } : null;
}

export async function gerirBots(deps: Deps, input: ContextoFerramenta & { resumo: string; acoes: AcaoLote[] }): Promise<SaidaCasoDeUso<ResultadoGerirBots>> {
  const ctx = await turnoDoNodComAPessoa(deps, input);
  if (!ctx) return { data: { ok: false, erro: "fora_da_conversa", problemas: [], instrucao: "Só o Nod, na conversa com a pessoa, muda os bots dela." } };
  const pessoaId = deps.escopo.pessoaId;
  const bots = (await deps.repos.agentes.listar({ incluirOcultos: true, incluirExcluidos: true })).filter((b) => b.ownerId === pessoaId);
  const validado = validarLote(input.acoes, bots, await appsDaPessoa(deps), pessoaId);
  if (!validado.ok) return { data: { ok: false, erro: "entrada_invalida", problemas: validado.problemas, instrucao: "Nada foi feito. Corrija os problemas e chame gerir_bots de novo com o lote inteiro." } };

  // Cerca 3: dar acesso (e duplicar um bot com acessos) depois de ler conteúdo de fora vira card também no automático.
  const contaminado = (await deps.repos.turnos.contaminado(input.turnoId)) || input.plano?.confiancaEntrada === "nao_confiavel";
  const riscos: (MotivoCardDoLote | null)[] = [];
  for (const a of validado.acoes) {
    const alvoTemAcessos = a.tipo === "duplicar" && a.alvoId !== null ? (await deps.repos.concessoes.doAgente(a.alvoId)).length > 0 : false;
    riscos.push(riscoDaAcao(a, { contaminado, alvoTemAcessos }));
  }
  const modo = ctx.agente.modoAprovacao;
  const espera = decidirLote(validado.acoes, modo, riscos);
  const acoes: AcaoNoLote[] = validado.acoes.map((a: AcaoResolvida): AcaoNoLote => {
    const { alvoId, alvoDaAcao, i, alvoNome, ...acao } = a;
    return { ...acao, i, estado: "esperando", motivo: espera[i] ?? null, alvoNome, botId: alvoId, alvoDaAcao };
  });

  const events = await executarEmOrdem(deps, acoes, (a) => espera[a.i] === null, { nodId: ctx.agente.id, porRegraDe: (a) => porRegraDoModo(modo, riscos[a.i] ?? null) });
  const esperando = acoes.filter((a) => a.estado === "esperando").map((a) => a.i);
  const agora = deps.agora();
  let decisaoId: string | null = null;
  if (esperando.length > 0) {
    const payload: PayloadPropostaLoteBots = { kind: "lote_bots", resumo: input.resumo.trim(), acoes, turnoId: input.turnoId };
    const proposta = await deps.repos.propostas.criar({ conversaId: input.conversaId, agenteId: ctx.agente.id, payload });
    if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
    const decisao = await deps.repos.decisoes.criar({ id: proposta.id, tipo: "lote_bots", agenteId: ctx.agente.id, conversaId: input.conversaId, turnoId: input.turnoId, prazoDecisaoEm: agora + PRAZO_DECISAO_PADRAO_MS, frase: input.resumo.trim() });
    decisaoId = proposta.id;
    const autoria = autoriaDoAgente(deps.escopo, ctx.agente.id);
    events.push(evento(deps.escopo, { kind: "proposta_criada", autoria, agora, conversaId: input.conversaId, turnoId: input.turnoId, dados: { proposta_id: proposta.id, kind: "lote_bots", acoes: esperando.length } }));
    if (decisao) events.push(evento(deps.escopo, { kind: "decisao_criada", autoria, agora, conversaId: input.conversaId, turnoId: input.turnoId, dados: { decisao_id: decisao.id, tipo: "lote_bots" } }));
  }
  const feitas = acoes.filter((a) => a.estado === "feita").map((a) => ({ i: a.i, tipo: a.tipo, bot_id: a.botId, nome: a.alvoNome }));
  const falhas = acoes.filter((a) => a.estado === "falhou").map((a) => ({ i: a.i, erro: a.erro ?? "falhou" }));
  log("info", "nod_gerir_bots", { acoes: acoes.length, feitas: feitas.length, esperando: esperando.length, falhas: falhas.length, modo: modo ?? "manual" });
  const instrucao = esperando.length > 0
    ? `${feitas.length ? `Feito agora: ${feitas.length}. ` : ""}${esperando.length} ${esperando.length === 1 ? "mudança espera" : "mudanças esperam"} a pessoa no card desta conversa. Diga isso em uma frase (o que fez e o que espera) e encerre o turno; o card executa sozinho quando ela aprovar.`
    : `Tudo feito (${feitas.length}${falhas.length ? `, ${falhas.length} com falha` : ""}). Conte em poucas linhas o que mudou${falhas.length ? " e o que não deu certo" : ""}.`;
  return { data: { ok: true, feitas, esperando, falhas, decisao_id: decisaoId, instrucao }, events };
}

/**
 * O card do lote decidido pela pessoa (POST decisoes/:id/decidir, tipo 'lote_bots'): recusar recusa as que esperavam;
 * aprovar executa as marcadas (`selecionados`, índices; ausente = todas as que esperam), na ordem, como a pessoa —
 * ela é a confirmação. As desmarcadas viram 'recusada'. O desfecho fica no payload e numa linha de sistema na conversa
 * do Nod.
 */
export const decidirLoteDeBots: CasoDeUso<{ decisaoId: string; recusar: boolean; selecionados?: unknown }, { feitas: number; falhas: number; recusadas: number }> = async (deps, input) => {
  if (input.selecionados !== undefined && (!Array.isArray(input.selecionados) || !input.selecionados.every((x) => Number.isInteger(x)))) throw new ErroDeDominio("entrada_invalida", { cause: "selecionados" });
  const proposta = await deps.repos.propostas.buscar(input.decisaoId);
  if (!proposta || proposta.payload.kind !== "lote_bots") throw new ErroDeDominio("nao_encontrado", { cause: "lote" });
  if (proposta.estado !== "pendente") throw new ErroDeDominio("estado_invalido", { cause: `lote ${proposta.estado}` });
  const agora = deps.agora();
  const decidida = await deps.repos.decisoes.decidir(input.decisaoId, { por: deps.escopo.pessoaId, agora });
  if (!decidida) throw new ErroDeDominio("estado_invalido", { cause: "decisão já fechada" });
  const acoes = proposta.payload.acoes.map((a) => ({ ...a }));
  const marcadas = new Set((input.selecionados as number[] | undefined) ?? acoes.filter((a) => a.estado === "esperando").map((a) => a.i));
  const events: RuntimeEvent[] = [];
  if (input.recusar) {
    for (const a of acoes) if (a.estado === "esperando") a.estado = "recusada";
  } else {
    for (const a of acoes) if (a.estado === "esperando" && !marcadas.has(a.i)) a.estado = "recusada";
    events.push(...(await executarEmOrdem(deps, acoes, (a) => a.estado === "esperando", { nodId: proposta.agenteId, porRegraDe: () => null })));
  }
  await deps.repos.propostas.atualizarPayload(proposta.id, { ...proposta.payload, acoes });
  await deps.repos.propostas.decidir(proposta.id, input.recusar ? "recusada" : "confirmada");
  const antes = proposta.payload.acoes;
  const daVez = acoes.filter((a) => antes[a.i]?.estado === "esperando");
  const feitas = daVez.filter((a) => a.estado === "feita");
  const falhas = daVez.filter((a) => a.estado === "falhou");
  const recusadas = daVez.filter((a) => a.estado === "recusada");
  const autoria = autoriaPessoa(deps.escopo);
  const texto = input.recusar
    ? `Recusado: ${recusadas.length} ${recusadas.length === 1 ? "mudança" : "mudanças"} nos seus bots.`
    : [`${feitas.length} de ${daVez.length} ${daVez.length === 1 ? "mudança feita" : "mudanças feitas"}.`, ...feitas.map((a) => `✓ ${linhaDaAcao(a)}`), ...falhas.map((a) => `✗ ${linhaDaAcao(a)} — não deu certo (${a.erro ?? "falhou"})`), ...recusadas.map((a) => `– ${linhaDaAcao(a)} (desmarcada)`)].join("\n");
  const msg = await deps.repos.mensagens.criar({ conversaId: proposta.conversaId, autoria, kind: "sistema", texto, confianca: "confiavel" });
  events.push(evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: proposta.conversaId, turnoId: decidida.turnoId, dados: { decisao_id: decidida.id, tipo: "lote_bots", recusada: input.recusar } }));
  if (msg) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: proposta.conversaId, dados: { mensagem_id: msg.id, kind: "sistema" } }));
  log("info", "nod_lote_decidido", { feitas: feitas.length, falhas: falhas.length, recusadas: recusadas.length });
  return { data: { feitas: feitas.length, falhas: falhas.length, recusadas: recusadas.length }, events };
};
