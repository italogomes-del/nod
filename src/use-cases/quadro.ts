import { createHash } from "node:crypto";
import type { Agente } from "../contracts/agente.ts";
import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { AutorLote, ColunaQuadro, LoteQuadro, OpQuadro, Quadro, QuadroDto, ResumoQuadroParaBot, TarefaDto, TarefaQuadro } from "../contracts/quadro.ts";
import { ehNod } from "../domain/nod.ts";
import { type AgenteDoQuadro, chaveDeBusca, entradaDaResposta, entradaDaTarefa, execucaoDoTurno, metaCumprida, planejarLote, progresso, resumoDaMeta, resumoDoLote } from "../domain/quadro.ts";
import { colunaDeEspera, colunasDe, colunasDto, papelDe } from "../domain/colunas.ts";
import type { FotoLote } from "../repositories/quadros.repo.ts";
import { autoriaAgente, autoriaPessoa, ehUuid, evento, PRAZO_DECISAO_MS } from "./apoio-l7.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { podeRepassar, proximaProfundidade } from "../domain/profundidade.ts";
import type { Profundidade } from "../contracts/turno.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/**
 * O quadro-agente (definido em 2026-10-31, NOD-442). Um só caminho para a pessoa (as rotas) e para qualquer bot (a
 * ferramenta gerir_quadro): cada chamada é um lote, tudo ou nada, com a foto do antes para o Desfazer. As tarefas com
 * responsável que entram em A fazer começam sozinhas: o turno nasce na conversa própria do bot (origem delegacao, sob
 * procuração da pessoa, como um pedido de colega).
 */

export type FalhaQuadro = "experimento_desligado" | "sem_quadro" | "entrada_invalida" | "nao_encontrado";

export type PedidoLote = {
  autor: AutorLote;
  /** O quadro: id, ou nome/id do bot anfitrião. */
  quadro?: string;
  /** O bot da tela (a rota é /agentes/:id/quadro): o anfitrião quando não veio `quadro`. */
  anfitriaoId?: string;
  ops: readonly OpQuadro[];
  /** Onde rodam os turnos que o lote começa (o do turno de quem chamou; a rota, o do servidor). */
  executor: Executor;
  /** O turno de quem chamou (a ferramenta), para a trilha. */
  turnoId?: string | null;
  conversaId?: string | null;
  /**
   * A profundidade do turno de quem chamou (a pessoa, pela tela: 0). O turno que o lote começa soma 1; no limite
   * (PROFUNDIDADE_MAXIMA, ADR-063) nada começa sozinho — senão dois bots se passavam a tarefa sem fim (revisão do PR #612).
   */
  profundidade?: Profundidade;
  /**
   * O turno de quem fez o lote era confiável e limpo (ADR-062). A pessoa pela tela: true (o padrão). O bot: o turno dele
   * confiável e não contaminado. Falso contamina o turno que o lote começa, como o pedir_a_bot (revisão do PR #612).
   */
  origemConfiavel?: boolean;
  /** O bot fala num turno da pessoa (conversa/ligação): começa até a tarefa que já é dele. */
  autorNaConversa?: boolean;
};

export type Comecou = { tarefaId: string; agenteId: string; agenteNome: string; turnoId: string };

export type ResultadoLote =
  | { ok: true; quadro: QuadroDto | null; lote: LoteQuadro | null; comecaram: Comecou[]; desfeito: boolean; /** No limite da corrente: o que ia começar e ficou em A fazer. */ seguradas?: number; /** Um passo de coluna foi para a posição válida mais próxima (NOD-448). */ ajustada?: boolean }
  | { ok: false; erro: FalhaQuadro; detalhe: string };

const falha = (erro: FalhaQuadro, detalhe: string): { data: ResultadoLote } => ({ data: { ok: false, erro, detalhe } });

async function experimentoLigado(deps: Deps): Promise<boolean> {
  return (await deps.repos.preferencias.buscar()).experimentos?.quadro === true;
}

async function agentesDaPessoa(deps: Deps): Promise<Agente[]> {
  return (await deps.repos.agentes.listar()).filter((a) => a.ownerId === deps.escopo.pessoaId);
}

const paraAgenteDoQuadro = (a: Agente): AgenteDoQuadro => ({ id: a.id, nome: a.nome, nod: ehNod(a) });

/** O bot anfitrião que a ferramenta nomeou ao criar o quadro: id ou nome exato (um só); o Nod também pode ter quadro. */
function anfitriaoPeloNome(ref: string, agentes: readonly Agente[]): string | null {
  const r = ref.trim().replace(/^@/, "");
  if (ehUuid(r)) return agentes.some((a) => a.id === r) ? r : null;
  const achados = agentes.filter((a) => chaveDeBusca(a.nome) === chaveDeBusca(r));
  return achados.length === 1 ? achados[0]!.id : null;
}

/** Acha o quadro: id do quadro, ou o bot anfitrião (id ou nome); sem referência, o do bot da tela ou do autor, senão o único. */
async function acharQuadro(deps: Deps, p: PedidoLote, agentes: readonly Agente[]): Promise<Quadro | null | { ambiguo: Quadro[] }> {
  const repo = deps.repos.quadros;
  if (p.quadro !== undefined && p.quadro.trim() !== "") {
    const ref = p.quadro.trim().replace(/^@/, "");
    if (ehUuid(ref)) return (await repo.buscar(ref)) ?? (await repo.doAgente(ref));
    const donos = agentes.filter((a) => chaveDeBusca(a.nome) === chaveDeBusca(ref));
    if (donos.length !== 1) return null;
    return repo.doAgente(donos[0]!.id);
  }
  if (p.anfitriaoId) return repo.doAgente(p.anfitriaoId);
  if (p.autor.tipo === "agente") {
    // O bot no turno de uma tarefa mexe, por padrão, no quadro dessa tarefa, não no dele (revisão rodada 4).
    const daTarefa = p.turnoId ? await repo.doTurno(p.turnoId) : null;
    if (daTarefa) return daTarefa;
    const proprio = await repo.doAgente(p.autor.agenteId);
    if (proprio) return proprio;
  }
  const todos = await repo.listar();
  if (todos.length === 1) return todos[0]!;
  return todos.length === 0 ? null : { ambiguo: todos };
}

/** O quadro como a tela e o bot leem (tarefas, execução de cada uma, nomes, o último lote). */
export async function montarQuadro(deps: Pick<Deps, "repos">, q: Quadro): Promise<QuadroDto> {
  const repo = deps.repos.quadros;
  const tarefas = await repo.tarefas(q.id);
  const estados = await repo.estadosDosTurnos(tarefas.map((t) => t.turnoId).filter((id): id is string => id !== null));
  const ids = new Set([q.agenteId, ...tarefas.map((t) => t.agenteId).filter((id): id is string => id !== null)]);
  const nomes = new Map<string, string>();
  for (const id of ids) {
    const a = await deps.repos.agentes.buscar(id, true);
    if (a) nomes.set(id, a.nome);
  }
  const ultimo = await repo.ultimoLote(q.id);
  const colunas = colunasDe(q);
  const dtos: TarefaDto[] = tarefas.map((t) => ({
    ...t,
    // Só o que ainda está em jogo mostra a execução (um turno concluído de uma tarefa feita não acende nada).
    execucao: ["fazendo", "afazer"].includes(papelDe(colunas, t.status)) ? execucaoDoTurno(t.turnoId ? estados.get(t.turnoId) : null) : null,
    agenteNome: t.agenteId ? nomes.get(t.agenteId) ?? null : null,
  }));
  const { feitas, total } = progresso(tarefas, colunas);
  return {
    ...q,
    agenteNome: nomes.get(q.agenteId) ?? "",
    colunas: colunasDto(colunas),
    tarefas: dtos,
    ultimoLote: ultimo ? { id: ultimo.id, quadroId: ultimo.quadroId, autor: ultimo.autor, resumo: ultimo.resumo, tarefaIds: ultimo.tarefaIds, desfeitoEm: ultimo.desfeitoEm, criadoEm: ultimo.criadoEm } : null,
    feitas,
    total,
  };
}

export function resumoParaBot(q: QuadroDto): ResumoQuadroParaBot {
  return {
    id: q.id,
    anfitriao: q.agenteNome,
    meta: q.meta,
    prazo: q.prazo,
    cumprida: q.cumpridoEm !== null,
    resumo: q.resumo,
    colunas: q.colunas.map((c) => ({ id: c.id, nome: c.nome, grupo: c.grupo })),
    tarefas: q.tarefas.map((t) => ({ id: t.id, titulo: t.titulo, status: t.status, agente: t.agenteNome, linear: t.linearId, pr: t.prUrl, pergunta: t.status === "voce" ? t.pergunta : null, execucao: t.execucao })),
  };
}

function eventoQuadro(deps: Deps, p: PedidoLote, q: { id: string; agenteId: string }, loteId: string | null, tarefas: readonly string[]): RuntimeEvent {
  const autoria = p.autor.tipo === "agente" ? autoriaAgente(p.autor.agenteId, deps.escopo.pessoaId, deps.escopo.pessoaId) : autoriaPessoa(deps.escopo.pessoaId);
  return evento(deps, "quadro_mudou", autoria, { quadroId: q.id, agenteId: q.agenteId, loteId, tarefas: tarefas.join(","), autor: p.autor.tipo }, { conversaId: p.conversaId ?? null, turnoId: p.turnoId ?? null });
}

/** Abre o turno do bot responsável (o começo da tarefa ou a volta depois da resposta). null = o bot não tem conversa. */
async function abrirTurno(deps: Deps, p: PedidoLote, agente: Agente, entradaTexto: string, deFora: boolean): Promise<{ turnoId: string; events: RuntimeEvent[] } | null> {
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(agente.id);
  if (!conversa) return null;
  const turno = await deps.repos.turnos.enfileirar({
    conversaId: conversa.id,
    agenteId: agente.id,
    origem: "delegacao",
    prazoEm: deps.agora() + PRAZO_DECISAO_MS,
    // A corrente de quem moveu a tarefa, mais um (a pessoa pela tela começa em 0).
    profundidade: proximaProfundidade(p.profundidade ?? 0),
    entradaTexto,
    // Confiável como o pedir_a_bot (ADR-062); contaminado logo abaixo quando o pedido traz dado de fora.
    entradaConfianca: "confiavel",
    sobProcuracaoDe: deps.escopo.pessoaId,
    modelo: agente.modelo,
    harness: agente.harness,
    executor: p.executor,
  });
  if (!turno) return null;
  // Dado de fora: a tarefa foi escrita por um turno não confiável (deFora, pegajoso) ou o turno de quem fez o lote não era
  // confiável. O Linear é conteúdo interno (ADR-062 §1, conteudoInterno). Suposição registrada no PR: tarefa criada pela
  // pessoa ou por um bot num turno limpo é pedido confiável.
  if (deFora || p.origemConfiavel === false) await deps.repos.turnos.contaminar(turno.id, deps.agora());
  const autoria = p.autor.tipo === "agente" ? autoriaAgente(p.autor.agenteId, deps.escopo.pessoaId, deps.escopo.pessoaId) : autoriaPessoa(deps.escopo.pessoaId);
  return {
    turnoId: turno.id,
    events: [evento(deps, "turno_criado", autoria, { turnoId: turno.id, agenteId: agente.id, origem: "delegacao", profundidade: turno.profundidade }, { conversaId: conversa.id, turnoId: turno.id })],
  };
}

/**
 * O turno de uma tarefa que deixou de valer (Desfazer, outro responsável, excluída, cancelada): o que está na fila sai;
 * o que já roda recebe o Parar (revisão do PR #612). Nunca o turno de quem chamou (ele está aplicando este lote).
 */
async function pararTurno(deps: Deps, p: PedidoLote, turnoId: string): Promise<void> {
  // A cadeia inteira (revisão rodada 6): a tarefa guarda o turno que a começou, e quem roda agora pode ser uma retomada
  // dele (depois de um cartão, da espera de CI, da resposta de um colega). Se quem chamou está nela, nada para.
  const cadeia = await deps.repos.quadros.cadeiaDoTurno(turnoId);
  if (cadeia.some((t) => t.id === p.turnoId)) return;
  for (const t of cadeia) {
    if (t.estado !== "pendente" && t.estado !== "despachando") continue;
    if (!(await deps.repos.turnos.cancelarPendente(t.id))) await deps.repos.turnos.pedirInterrupcao([t.id], deps.agora());
  }
}

async function avisarComVoce(deps: Deps, t: TarefaQuadro, quemPergunta: string): Promise<RuntimeEvent | null> {
  if (!t.agenteId) return null;
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(t.agenteId);
  if (!conversa) return null;
  // A autoria é de quem escreveu a pergunta (o bot do lote); a pessoa pela tela, o responsável.
  const autoria = autoriaAgente(quemPergunta, deps.escopo.pessoaId);
  const h = createHash("sha256").update(`quadro-voce:${t.id}:${t.mudadoEm}`).digest("hex");
  const m = await deps.repos.mensagens.criar({
    conversaId: conversa.id,
    turnoId: null,
    autoria,
    kind: "texto",
    texto: `Preciso de você no quadro, em "${t.titulo}": ${t.pergunta ?? ""}`.trim(),
    payload: { kind: "aviso_pessoa" },
    confianca: "nao_confiavel",
    idEnvio: `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`,
  });
  return m ? evento(deps, "mensagem_criada", autoria, { mensagem_id: m.id, kind: "texto", aviso: true }, { conversaId: conversa.id, turnoId: null }) : null;
}

/** Desfaz o último lote do quadro: volta à foto do antes e cancela os turnos que ele abriu e ainda não começaram. */
async function desfazer(deps: Deps, p: PedidoLote, q: Quadro, loteId: string | undefined): Promise<{ data: ResultadoLote; events?: RuntimeEvent[] }> {
  const repo = deps.repos.quadros;
  const ultimo = await repo.ultimoLote(q.id);
  if (!ultimo) return falha("nao_encontrado", "não há o que desfazer neste quadro");
  if (loteId && loteId !== ultimo.id) return falha("entrada_invalida", "só o último lote do quadro se desfaz");
  // Um bot desfaz só num turno limpo; o lote da pessoa ou de outro bot, só a pedido dela na conversa (revisão rodada 4).
  if (p.autor.tipo === "agente") {
    if (p.origemConfiavel === false) return falha("entrada_invalida", "desfazer só num turno limpo, em que nada de fora entrou");
    const meu = ultimo.autor.tipo === "agente" && ultimo.autor.agenteId === p.autor.agenteId;
    if (!meu && p.autorNaConversa !== true) return falha("entrada_invalida", "o último lote não é seu: o da pessoa ou de outro bot só se desfaz a pedido dela, na conversa com você");
  }
  const foto: FotoLote = ultimo.antes;
  const atuais = new Map((await repo.tarefas(q.id)).map((t) => [t.id, t]));
  for (const { id, antes } of foto.tarefas) {
    const atual = atuais.get(id);
    if (atual?.turnoId && atual.turnoId !== (antes?.turnoId ?? null)) await pararTurno(deps, p, atual.turnoId);
  }
  if (foto.quadro === null) {
    await repo.apagar(q.id);
    return { data: { ok: true, quadro: null, lote: null, comecaram: [], desfeito: true }, events: [eventoQuadro(deps, p, q, ultimo.id, [])] };
  }
  const estadosAntes = await repo.estadosDosTurnos(foto.tarefas.map((t) => t.antes?.turnoId).filter((id): id is string => !!id));
  // As colunas da foto (ou as de agora, na foto de antes da NOD-448): a tarefa restaurada cai numa coluna que existe.
  const colunasDaFoto = colunasDe(foto.quadro.colunas !== undefined ? { colunas: foto.quadro.colunas } : q);
  for (const { id, antes } of foto.tarefas) {
    if (antes === null) { await repo.apagarTarefa(id); continue; }
    // A foto no andamento com um turno que já parou (o Desfazer interrompeu, ou acabou): volta à espera, sem turno, para
    // não ficar em "falhou" sem ninguém (revisão rodada 3). Recomeça a pedido (mudar_tarefa status afazer).
    const vivo = antes.turnoId !== null && ["pendente", "despachando"].includes(estadosAntes.get(antes.turnoId) ?? "");
    // Só a tarefa cujo turno ESTE lote trocou (passou de mão, parou): a que ele só mudou de coluna (remover, substituir)
    // volta exatamente para onde estava, com o turno que tinha (revisão do PR #615, rodada 2).
    const mexeuNoTurno = (atuais.get(id)?.turnoId ?? null) !== (antes.turnoId ?? null);
    // E a que tinha um turno que não terminou bem (o lote o parou ao mandá-la para Cancelado/Backlog, ou ele caiu): sem
    // isso ela voltaria ao andamento como "Falhou", sem ninguém (revisão 4). Só o turno concluído volta como estava.
    // Só quando o lote a tirou do andamento: a que já estava parada lá e o lote só editou volta igual (revisão 5).
    const atual = atuais.get(id);
    const saiuDoAndamento = !!atual && papelDe(colunasDe(q), atual.status) !== "fazendo";
    const turnoMorto = antes.turnoId !== null && estadosAntes.get(antes.turnoId) !== "concluido" && saiuDoAndamento;
    const andava = papelDe(colunasDaFoto, antes.status) === "fazendo" && (mexeuNoTurno || turnoMorto);
    await repo.restaurarTarefa(andava && !vivo ? { ...antes, status: colunaDeEspera(colunasDaFoto), turnoId: null } : antes);
  }
  await repo.salvar(q.id, foto.quadro);
  await repo.marcarDesfeito(ultimo.id);
  const atualizado = await repo.buscar(q.id);
  return {
    data: { ok: true, quadro: atualizado ? await montarQuadro(deps, atualizado) : null, lote: null, comecaram: [], desfeito: true },
    events: [eventoQuadro(deps, p, q, ultimo.id, foto.tarefas.map((t) => t.id))],
  };
}

/**
 * Aplica um lote (a ferramenta manda vários passos; cada rota, um). Planeja tudo em memória primeiro (o erro volta sem
 * gravar nada), trava o quadro (um lote por vez: duas abas, dois bots), grava, começa as tarefas e fecha a meta.
 */
export async function aplicarLoteQuadro(deps: Deps, p: PedidoLote): Promise<{ data: ResultadoLote; events?: RuntimeEvent[] }> {
  if (!(await experimentoLigado(deps))) return falha("experimento_desligado", "o quadro está desligado nos experimentos da pessoa");
  if (p.ops.length === 0) return falha("entrada_invalida", "acoes vazio");
  const repo = deps.repos.quadros;
  const agentes = await agentesDaPessoa(deps);
  const criando = p.ops[0]!.tipo === "criar_quadro";

  let q: Quadro | null;
  if (criando) {
    // O anfitrião: o bot da tela; senão o que a ferramenta nomeou em `quadro` (id ou nome); senão o próprio bot.
    const anfitriao = p.anfitriaoId ?? (p.quadro?.trim() ? anfitriaoPeloNome(p.quadro, agentes) : p.autor.tipo === "agente" ? p.autor.agenteId : null);
    if (!anfitriao || !agentes.some((a) => a.id === anfitriao)) return falha("nao_encontrado", "bot anfitrião do quadro");
    q = await repo.doAgente(anfitriao);
    if (!q) {
      const desfazerVem = p.ops.some((o) => o.tipo === "desfazer");
      if (desfazerVem) return falha("entrada_invalida", "desfazer vai sozinho na chamada");
      return criarComLote(deps, p, anfitriao, agentes);
    }
  } else {
    const achado = await acharQuadro(deps, p, agentes);
    if (achado && "ambiguo" in achado) return falha("sem_quadro", `a pessoa tem ${achado.ambiguo.length} quadros: diga qual em quadro (o nome do bot anfitrião ou o id): ${achado.ambiguo.map((x) => x.id).join(", ")}`);
    q = achado;
  }
  if (!q) return falha("sem_quadro", "não há quadro: crie com criar_quadro (meta e prazo)");
  const travado = await repo.buscarTravado(q.id);
  if (!travado) return falha("sem_quadro", "o quadro sumiu");
  // Com a trava na mão, de novo (codex rodada 4): o lote que trocou a tarefa de mão pode ter parado este turno enquanto
  // ele esperava a trava. O turno parado não escreve por cima do novo responsável.
  if (p.turnoId) {
    const meu = await deps.repos.turnos.buscar(p.turnoId);
    if (meu && (meu.pararSolicitadoEm != null || meu.estado === "interrompido")) return falha("entrada_invalida", "este turno foi parado: a tarefa mudou de mão ou foi desfeita");
  }
  const so = p.ops[0]!;
  if (so.tipo === "desfazer") {
    if (p.ops.length > 1) return falha("entrada_invalida", "desfazer vai sozinho na chamada");
    return desfazer(deps, p, travado, so.lote);
  }
  return aplicarNoQuadro(deps, p, travado, agentes, false);
}

/**
 * A prévia de um lote (NOD-448): o mesmo planejamento do aplicar, sem gravar nem travar. O substituir_colunas pela
 * conversa usa para validar e montar o card antes de a pessoa confirmar.
 */
export async function preverLoteQuadro(deps: Deps, p: PedidoLote): Promise<{ ok: true; quadro: Quadro; tarefas: TarefaQuadro[]; colunas: ColunaQuadro[] } | { ok: false; erro: FalhaQuadro; detalhe: string }> {
  if (!(await experimentoLigado(deps))) return { ok: false, erro: "experimento_desligado", detalhe: "o quadro está desligado nos experimentos da pessoa" };
  const agentes = await agentesDaPessoa(deps);
  const achado = await acharQuadro(deps, p, agentes);
  if (achado && "ambiguo" in achado) return { ok: false, erro: "sem_quadro", detalhe: `a pessoa tem ${achado.ambiguo.length} quadros: diga qual em quadro (o nome do bot anfitrião ou o id): ${achado.ambiguo.map((x) => x.id).join(", ")}` };
  if (!achado) return { ok: false, erro: "sem_quadro", detalhe: "não há quadro: crie com criar_quadro (meta e prazo)" };
  const tarefas = await deps.repos.quadros.tarefas(achado.id);
  const plano = planejarLote({ quadro: { meta: achado.meta, prazo: achado.prazo, colunas: achado.colunas }, quadroId: achado.id, tarefas, agentes: agentes.map(paraAgenteDoQuadro), autorAgenteId: p.autor.tipo === "agente" ? p.autor.agenteId : null, ops: p.ops, agora: deps.agora(), origemConfiavel: p.origemConfiavel !== false, autorNaConversa: p.autorNaConversa === true });
  if ("erro" in plano) return { ok: false, erro: "entrada_invalida", detalhe: plano.indice >= 0 ? `ação ${plano.indice + 1}: ${plano.erro}` : plano.erro };
  return { ok: true, quadro: achado, tarefas, colunas: colunasDe(plano.quadro) };
}

/** O lote que cria o quadro: o quadro nasce dentro dele (o Desfazer apaga o quadro). */
async function criarComLote(deps: Deps, p: PedidoLote, anfitriao: string, agentes: readonly Agente[]): Promise<{ data: ResultadoLote; events?: RuntimeEvent[] }> {
  const op = p.ops[0]!;
  if (op.tipo !== "criar_quadro") return falha("entrada_invalida", "criar_quadro primeiro");
  // Planeja antes de criar: um passo inválido não deixa quadro órfão.
  const plano = planejarLote({ quadro: null, quadroId: "novo", tarefas: [], agentes: agentes.map(paraAgenteDoQuadro), autorAgenteId: p.autor.tipo === "agente" ? p.autor.agenteId : null, ops: p.ops, agora: deps.agora(), origemConfiavel: p.origemConfiavel !== false, autorNaConversa: p.autorNaConversa === true });
  if ("erro" in plano) return falha("entrada_invalida", plano.indice >= 0 ? `ação ${plano.indice + 1}: ${plano.erro}` : plano.erro);
  const criado = await deps.repos.quadros.criar({ agenteId: anfitriao, meta: op.meta, prazo: op.prazo ?? null });
  // Outro lote criou no mesmo instante (o índice único): o segundo lê o quadro dele e aplica o resto por cima.
  const q = criado ?? (await deps.repos.quadros.doAgente(anfitriao));
  if (!q) return falha("sem_quadro", "o quadro não foi criado");
  const travado = (await deps.repos.quadros.buscarTravado(q.id)) ?? q;
  return aplicarNoQuadro(deps, { ...p, ops: p.ops.slice(1) }, travado, agentes, criado !== null);
}

async function aplicarNoQuadro(deps: Deps, p: PedidoLote, q: Quadro, agentes: readonly Agente[], nasceuAgora: boolean): Promise<{ data: ResultadoLote; events?: RuntimeEvent[] }> {
  const repo = deps.repos.quadros;
  const agora = deps.agora();
  const tarefasAntes = await repo.tarefas(q.id);
  const autorAgenteId = p.autor.tipo === "agente" ? p.autor.agenteId : null;
  const podeComecar = podeRepassar(p.profundidade ?? 0);
  const estados = await repo.estadosDosTurnos(tarefasAntes.map((t) => t.turnoId).filter((id): id is string => id !== null));
  const vivas = new Set(tarefasAntes.filter((t) => t.turnoId && ["pendente", "despachando"].includes(estados.get(t.turnoId) ?? "")).map((t) => t.id));
  const plano = planejarLote({ quadro: { meta: q.meta, prazo: q.prazo, colunas: q.colunas }, quadroId: q.id, tarefas: tarefasAntes, agentes: agentes.map(paraAgenteDoQuadro), autorAgenteId, ops: p.ops, agora, podeComecar, vivas, origemConfiavel: p.origemConfiavel !== false, autorNaConversa: p.autorNaConversa === true });
  if ("erro" in plano) {
    // O quadro que nasceu neste lote não fica de pé sem o resto (tudo ou nada). Não acontece: criarComLote já planejou.
    if (nasceuAgora) await repo.apagar(q.id);
    return falha(plano.erro.includes("não está no quadro") || plano.erro.includes("não encontrado") ? "nao_encontrado" : "entrada_invalida", plano.indice >= 0 ? `ação ${plano.indice + 1}: ${plano.erro}` : plano.erro);
  }
  const antesPorId = new Map(tarefasAntes.map((t) => [t.id, t]));
  const colunasFinais = colunasDe(plano.quadro);
  const espera = colunaDeEspera(colunasFinais);
  const porAgente = new Map(agentes.map((a) => [a.id, a]));
  const idReal = new Map<string, string>();
  const gravadas = new Map<string, TarefaQuadro>();

  // O turno que a tarefa tinha e deixou de valer: excluída, cancelada, de volta ao backlog ou com outro responsável.
  for (const id of plano.apagadas) {
    const velho = antesPorId.get(id)?.turnoId;
    if (velho) await pararTurno(deps, p, velho);
    await repo.apagarTarefa(id);
  }
  for (const id of plano.tocadas) {
    const a = antesPorId.get(id);
    const t = plano.tarefas.find((x) => x.id === id);
    // NOD-448: pelo papel da coluna (a da pessoa em Não iniciado espera como o Backlog; em Fechado, como Cancelado).
    const papel = t ? papelDe(colunasFinais, t.status) : null;
    if (a?.turnoId && t && (t.agenteId !== a.agenteId || papel === "cancelado" || papel === "backlog")) await pararTurno(deps, p, a.turnoId);
  }
  for (const id of plano.tocadas) {
    const t = plano.tarefas.find((x) => x.id === id);
    if (!t) continue;
    if (t.nova) {
      const nova = await repo.inserirTarefa({ quadroId: q.id, titulo: t.titulo, descricao: t.descricao, status: t.status, agenteId: t.agenteId, linearId: t.linearId, linearUrl: t.linearUrl, prUrl: t.prUrl, pergunta: t.pergunta, resposta: t.resposta, deFora: t.deFora });
      idReal.set(id, nova.id);
      gravadas.set(nova.id, nova);
    } else {
      const salva = await repo.salvarTarefa(id, t);
      if (salva) gravadas.set(id, salva);
    }
  }

  // Quem começa: o turno nasce agora; a tarefa guarda o turno (o card mostra Na fila / Rodando / Falhou).
  const pessoaNome = (await deps.repos.pessoas.buscar(deps.escopo.pessoaId))?.nome ?? "a pessoa";
  const deQuem = autorAgenteId ? porAgente.get(autorAgenteId)?.nome ?? null : null;
  const comecaram: Comecou[] = [];
  const events: RuntimeEvent[] = [];
  const abrir = async (idPlano: string, texto: (t: TarefaQuadro) => string) => {
    const id = idReal.get(idPlano) ?? idPlano;
    const t = gravadas.get(id);
    if (!t) return;
    const agente = t.agenteId ? porAgente.get(t.agenteId) : undefined;
    // O responsável oculto ou excluído não recebe turno: a tarefa volta a A fazer, sem ficar em Fazendo (revisão rodada 5).
    if (!agente) {
      const volta = await repo.salvarTarefa(id, { ...t, status: espera, turnoId: null });
      if (volta) gravadas.set(id, volta);
      return;
    }
    // Um turno novo para a tarefa: o anterior não roda em dobro (na fila, cancela; rodando, pede a interrupção).
    if (t.turnoId) await pararTurno(deps, p, t.turnoId);
    const aberto = await abrirTurno(deps, p, agente, texto(t), t.deFora);
    if (!aberto) {
      // Sem turno (o bot sem conversa própria): a tarefa não fica em Fazendo sem ninguém; volta a A fazer (revisão rodada 4).
      const volta = await repo.salvarTarefa(id, { ...t, status: espera, turnoId: null });
      if (volta) gravadas.set(id, volta);
      return;
    }
    const salva = await repo.salvarTarefa(id, { ...t, turnoId: aberto.turnoId });
    if (salva) gravadas.set(id, salva);
    comecaram.push({ tarefaId: id, agenteId: agente.id, agenteNome: agente.nome, turnoId: aberto.turnoId });
    events.push(...aberto.events);
  };
  const meta = plano.quadro.meta;
  const prazo = plano.quadro.prazo;
  for (const id of plano.comecam) {
    await abrir(id, (t) => entradaDaTarefa({ quadroId: q.id, meta, prazo, tarefa: t, pessoaNome, deQuem: deQuem && t.agenteId !== autorAgenteId ? deQuem : null }));
  }
  for (const r of plano.respondidas) {
    await abrir(r.id, (t) => entradaDaResposta({ quadroId: q.id, tarefa: t, resposta: r.resposta, pessoaNome }));
  }

  // "Com você": a pessoa fica sabendo sem abrir o quadro (revisão do PR #612). Um aviso na conversa do responsável, como
  // o avisar_pessoa (o sino e o push da web); marcado não confiável, porque a pergunta pode ter vindo de conteúdo de fora.
  for (const id of plano.tocadas) {
    const t = gravadas.get(idReal.get(id) ?? id);
    const a = antesPorId.get(idReal.get(id) ?? id);
    if (!t || t.status !== "voce" || a?.status === "voce" || !t.agenteId) continue;
    // Como o avisar_pessoa: de turno não confiável ou com pergunta de fora, só o card muda (revisão rodada 3).
    if (p.origemConfiavel === false || t.deFora) continue;
    const ev = await avisarComVoce(deps, t, autorAgenteId ?? t.agenteId);
    if (ev) events.push(ev);
  }

  // A meta fecha (ou reabre) pelo estado final das tarefas.
  const finais = await repo.tarefas(q.id);
  const cumprida = metaCumprida(finais, colunasFinais);
  const nomes = new Map(agentes.map((a) => [a.id, a.nome]));
  const cumpridoEm = cumprida ? q.cumpridoEm ?? agora : null;
  const resumo = cumprida ? (q.cumpridoEm !== null && q.resumo ? q.resumo : resumoDaMeta({ prazo, colunas: colunasFinais }, finais, nomes, agora)) : null;
  const mudouQuadro = meta !== q.meta || prazo !== q.prazo || cumpridoEm !== q.cumpridoEm || resumo !== q.resumo;
  const mudouColunas = plano.mudouColunas;
  if (mudouQuadro || mudouColunas || plano.tocadas.length > 0 || plano.apagadas.length > 0) await repo.salvar(q.id, { meta, prazo, cumpridoEm, resumo, ...(mudouColunas ? { colunas: plano.quadro.colunas } : {}) });

  const tarefaIds = [...plano.tocadas.map((id) => idReal.get(id) ?? id), ...plano.apagadas];
  const foto: FotoLote = {
    quadro: nasceuAgora ? null : { meta: q.meta, prazo: q.prazo, cumpridoEm: q.cumpridoEm, resumo: q.resumo, colunas: q.colunas },
    tarefas: tarefaIds.map((id) => ({ id, antes: antesPorId.get(id) ?? null })),
  };
  const opsDoResumo: OpQuadro[] = nasceuAgora ? [{ tipo: "criar_quadro", meta: q.meta }, ...p.ops] : [...p.ops];
  const lote = nasceuAgora || tarefaIds.length > 0 || mudouQuadro || mudouColunas ? await repo.inserirLote({ quadroId: q.id, autor: p.autor, resumo: resumoDoLote(opsDoResumo, plano.frasesDasColunas), antes: foto, tarefaIds }) : null;
  const atualizado = (await repo.buscar(q.id)) ?? q;
  events.unshift(eventoQuadro(deps, p, atualizado, lote?.id ?? null, tarefaIds));
  // No limite da corrente: o que ia começar e ficou em A fazer (o bot avisa; a pessoa começa pelo quadro).
  const seguradas = plano.seguradas.length;
  return { data: { ok: true, quadro: await montarQuadro(deps, atualizado), lote, comecaram, desfeito: false, ...(seguradas ? { seguradas } : {}), ...(plano.ajustada ? { ajustada: true } : {}) }, events };
}

/** A aba Quadro de um bot: o quadro dele montado (ou null, ainda sem quadro). Experimento desligado = nao_permitido. */
export const verQuadro: CasoDeUso<{ agenteId: string }, { quadro: QuadroDto | null }> = async (deps, input) => {
  if (!(await experimentoLigado(deps))) throw new ErroDeDominio("nao_permitido", { cause: "experimento quadro desligado" });
  const q = await deps.repos.quadros.doAgente(input.agenteId);
  return { data: { quadro: q ? await montarQuadro(deps, q) : null } };
};
