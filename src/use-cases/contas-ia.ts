import type { ContaAnunciada, ContaIa, ContasIaDto } from "../contracts/contas-ia.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { nomeDaConta, ordemIasDaLista } from "../domain/contas-da-pessoa.ts";
import { ORDEM_IAS_PADRAO } from "../domain/inteligencia.ts";
import { log } from "../obs/log.ts";
import type { ResultadoDoAnuncio } from "../repositories/contas-ia.repo.ts";
import { redigir } from "../domain/redacao.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import { notaDeLimite } from "./contas-do-turno.ts";
import type { Deps } from "./tipos.ts";

/**
 * As contas de IA da pessoa em todas as máquinas (definido em 2026-10-13, ADR-102). A lista é do servidor; as máquinas
 * anunciam o que têm logado; a tela gerencia tudo em Provedores de IA (1A + 1B).
 */

/** A lista que a tela mostra: as contas não removidas, em ordem, cada uma com as máquinas onde está logada. */
export async function contasDaPessoa(d: Deps): Promise<Omit<ContasIaDto, "disponivel">> {
  const [{ contas, vinculos }, chaves, { modo }] = await Promise.all([d.repos.contasIa.listar(), d.repos.maquinaTokens.listar(), d.repos.contasIa.modo()]);
  const vivas = new Map(chaves.filter((c) => c.revogadaEm === null).map((c) => [c.id, c.nome]));
  const lista: ContaIa[] = contas
    .filter((c) => c.removidaEm === null)
    .map((c) => ({
      id: c.id,
      ia: c.ia,
      impressao: c.impressao,
      apelido: c.apelido,
      email: c.email,
      organizacao: c.organizacao,
      plano: c.plano,
      corporativa: c.corporativa,
      posicao: c.posicao,
      entraNaTrocaAutomatica: c.entraNaTrocaAutomatica,
      noLimiteAte: c.noLimiteAte !== null && c.noLimiteAte > d.agora() ? c.noLimiteAte : null,
      // Uma saída pedida já não conta como "logada aqui": a tela mostra o que vai ficar.
      maquinas: vinculos
        .filter((v) => v.contaId === c.id && v.sairPedidoEm === null && vivas.has(v.maquinaId))
        .map((v) => ({ maquinaId: v.maquinaId, nome: vivas.get(v.maquinaId)!, estado: v.estado })),
    }));
  return { modo, contas: lista };
}

/** O anúncio de uma máquina; a ordem das IAs da pessoa acompanha a lista quando ela muda (suposição 3 da ADR-102). */
export async function anunciarContasDaMaquina(d: Deps, maquinaId: string, anunciadas: readonly ContaAnunciada[]): Promise<ResultadoDoAnuncio> {
  // Red team do PR #306: as primeiras contas da pessoa entram na ordem de IAs que ela já tinha (quem preferia o ChatGPT
  // segue nele), não na ordem em que a máquina as descobriu.
  const vazia = (await d.repos.contasIa.listar()).contas.every((c) => c.removidaEm !== null);
  const ordem = vazia ? ((await d.repos.preferencias.buscar()).ordemIas ?? ORDEM_IAS_PADRAO) : null;
  const naOrdem = ordem ? [...anunciadas].sort((a, b) => posicaoNaOrdem(ordem, a.ia) - posicaoNaOrdem(ordem, b.ia)) : anunciadas;
  const r = await d.repos.contasIa.doAnuncio(maquinaId, naOrdem, d.agora());
  if (r.mudou) await recalcularOrdemIas(d);
  if (r.sair.length > 0) log("info", "contas_saida_pedida_no_anuncio", { maquina_id: maquinaId, contas: r.sair.length });
  return r;
}

const posicaoNaOrdem = (ordem: readonly string[], ia: string): number => { const i = ordem.indexOf(ia); return i < 0 ? ordem.length : i; };

export async function recalcularOrdemIas(d: Deps): Promise<void> {
  const { contas } = await d.repos.contasIa.listar();
  if (contas.every((c) => c.removidaEm !== null)) return;
  await d.repos.preferencias.gravar({ ordemIas: ordemIasDaLista(contas, ORDEM_IAS_PADRAO) });
}

export async function reordenarContas(d: Deps, ids: readonly string[]): Promise<void> {
  if (!(await d.repos.contasIa.reordenar(ids))) throw new ErroDeDominio("estado_invalido", { cause: "a lista de contas mudou" });
  await recalcularOrdemIas(d);
}

export async function removerConta(d: Deps, id: string): Promise<void> {
  if (!(await d.repos.contasIa.remover(id, d.agora()))) throw new ErroDeDominio("nao_encontrado", { cause: "conta" });
  // A escolhida que apontava para ela deixa de valer.
  const { escolhidas } = await d.repos.contasIa.modo();
  for (const [ia, escolhida] of Object.entries(escolhidas)) if (escolhida === id) await d.repos.contasIa.definirEscolhida(ia as keyof typeof escolhidas, null);
  await recalcularOrdemIas(d);
}

/**
 * "Seguir com <conta>" na nota do limite (ADR-102, CMD-1): a conta vira a escolhida da IA dela e o turno que parou no
 * limite é refeito (antes a pessoa precisava mandar a mensagem de novo). Refaz só o último turno da conversa que parou
 * no limite e ainda não foi refeito; nada a refazer = só grava a escolha.
 *
 * NOD-268 (regressão de 15/10): a conta que não está pronta na máquina que vai pegar o turno (a do bot ou a padrão, ADR-090;
 * sem nenhuma, qualquer máquina conectada) não refaz a fala — refeita, ela voltava à mesma nota, em laço. A conversa ganha UMA
 * vez a linha "A conta X não está em <máquina>…". O clique da pessoa não passa pelo teto de reenvios, só por esta trava.
 */
export async function seguirComConta(d: Deps, p: { contaId: string; conversaId: string }): Promise<{ data: { turnoId: string | null }; events: RuntimeEvent[] }> {
  // Revisão do PR #306: dois cliques (ou duas abas) esperam um pelo outro; o segundo já vê o "Seguindo com" do primeiro.
  await d.repos.contasIa.travar();
  const conta = await d.repos.contasIa.buscar(p.contaId);
  if (!conta || conta.removidaEm !== null) throw new ErroDeDominio("nao_encontrado", { cause: "conta" });
  const mensagens = await d.repos.mensagens.listarDaConversa(p.conversaId, 30);
  const nota = notaDeLimite(mensagens);
  const turno = nota?.nota.turnoId ? await d.repos.turnos.buscar(nota.nota.turnoId) : null;
  // Já refeito: depois do aviso veio a resposta do bot ou outro "Seguindo com" (o segundo clique não repete a fala).
  if (!nota || !turno || turno.origem !== "conversa" || turno.estado !== "interrompido" || !nota.aberta) {
    await d.repos.contasIa.definirEscolhida(conta.ia, conta.id);
    return { data: { turnoId: null }, events: [] };
  }
  const agora = d.agora();
  const autoria = autoriaPessoa(d.escopo, turno.executor);
  const events: RuntimeEvent[] = [];
  const fora = await contaForaDaMaquina(d, { contaId: conta.id, agenteId: turno.agenteId });
  if (fora) {
    const texto = redigir("conta-fora-da-maquina", agora, { conta: nomeDaConta(conta), maquina: fora.nome ? `em ${fora.nome}` : "em nenhuma máquina ligada" });
    // O mesmo clique de novo não repete a linha.
    if (mensagens.slice(nota.pos + 1).some((m) => m.kind === "sistema" && m.texto === texto)) return { data: { turnoId: null }, events: [] };
    const linha = await d.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "sistema", texto, confianca: "confiavel" });
    if (linha) events.push(evento(d.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: linha.id, kind: "sistema" } }));
    log("info", "conta_fora_da_maquina", { turno_id: turno.id, conta_id: conta.id, maquina_id: fora.id });
    // Revisão do PR #319: a conta recusada não vira a escolhida da IA (o próximo plano seguiria uma conta que não está lá).
    return { data: { turnoId: null }, events };
  }
  await d.repos.contasIa.definirEscolhida(conta.ia, conta.id);
  // Revisão do PR #319: a cópia da fala que esperava a conta (semContaNaMaquina, NOD-268) sai da fila — refeita agora, ela
  // seria absorvida pela nova e o bot leria o mesmo pedido duas vezes.
  if (turno.mensagemOrigemId) {
    for (const t of await d.repos.turnos.listarDaConversa(turno.conversaId, 20)) {
      if (t.estado !== "pendente" || t.mensagemOrigemId !== turno.mensagemOrigemId || (t.acordarEm ?? null) === null) continue;
      if (await d.repos.turnos.cancelarPendente(t.id)) events.push(evento(d.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: t.conversaId, turnoId: t.id, dados: { motivo: "parado_pela_pessoa", substituido_por_escolha: true } }));
    }
  }
  const linha = await d.repos.mensagens.criar({
    conversaId: turno.conversaId,
    turnoId: turno.id,
    autoria,
    kind: "sistema",
    texto: `Seguindo com ${nomeDaConta(conta)}.`,
    payload: { kind: "conta_escolhida", contaId: conta.id, apelido: conta.apelido, ia: conta.ia },
    confianca: "confiavel",
  });
  if (linha) events.push(evento(d.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: linha.id, kind: "sistema" } }));
  const novo = await d.repos.turnos.enfileirar({
    conversaId: turno.conversaId,
    agenteId: turno.agenteId,
    origem: "conversa",
    prazoEm: agora + Math.max(60_000, turno.prazoEm - turno.criadoEm),
    profundidade: turno.profundidade,
    entradaTexto: turno.entradaTexto,
    mensagemOrigemId: turno.mensagemOrigemId,
    entradaAnexos: turno.entradaAnexos,
    entradaConfianca: turno.entradaConfianca,
    modelo: turno.modelo,
    harness: turno.harness,
    reenvios: turno.reenvios + 1,
    executor: turno.executor,
    trabalhoId: turno.trabalhoId ?? null,
    // NOD-287: a fala refeita na conta escolhida leva a marca da web do turno que bateu no limite.
    contaminadoDe: turno.id,
  });
  if (novo) events.push(evento(d.escopo, { kind: "turno_criado", autoria, agora, conversaId: turno.conversaId, turnoId: novo.id, dados: { origem: "conversa", agente_id: turno.agenteId, repete_turno_id: turno.id } }));
  log("info", "conta_escolhida", { turno_id: turno.id, novo_turno_id: novo?.id ?? null, conta_id: conta.id });
  return { data: { turnoId: novo?.id ?? null }, events };
}

/**
 * NOD-268: a máquina que vai pegar a fala refeita não tem a conta pronta? Com o bot preso a uma máquina (a dele ou a padrão
 * da pessoa, ADR-090), vale só ela; sem nenhuma, basta uma máquina conectada com a conta pronta. null = a conta serve.
 */
async function contaForaDaMaquina(d: Deps, p: { contaId: string; agenteId: string }): Promise<{ id: string | null; nome: string | null } | null> {
  const [agente, preferencias, { vinculos }, chaves] = await Promise.all([d.repos.agentes.buscar(p.agenteId), d.repos.preferencias.buscar(), d.repos.contasIa.listar(), d.repos.maquinaTokens.listar()]);
  const alvo = agente?.maquinaId ?? preferencias.maquinaPadraoId ?? null;
  const prontaEm = new Set(vinculos.filter((v) => v.contaId === p.contaId && v.estado === "pronta" && v.sairPedidoEm === null).map((v) => v.maquinaId));
  if (alvo !== null) return prontaEm.has(alvo) ? null : { id: alvo, nome: chaves.find((c) => c.id === alvo)?.nome ?? null };
  return chaves.some((c) => c.revogadaEm === null && prontaEm.has(c.id)) ? null : { id: null, nome: null };
}
