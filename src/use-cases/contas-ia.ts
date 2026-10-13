import type { ContaAnunciada, ContaIa, ContasIaDto } from "../contracts/contas-ia.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { nomeDaConta, ordemIasDaLista } from "../domain/contas-da-pessoa.ts";
import { ORDEM_IAS_PADRAO } from "../domain/inteligencia.ts";
import { log } from "../obs/log.ts";
import type { ResultadoDoAnuncio } from "../repositories/contas-ia.repo.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
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
 */
export async function seguirComConta(d: Deps, p: { contaId: string; conversaId: string }): Promise<{ data: { turnoId: string | null }; events: RuntimeEvent[] }> {
  // Revisão do PR #306: dois cliques (ou duas abas) esperam um pelo outro; o segundo já vê o "Seguindo com" do primeiro.
  await d.repos.contasIa.travar();
  const conta = await d.repos.contasIa.buscar(p.contaId);
  if (!conta || conta.removidaEm !== null) throw new ErroDeDominio("nao_encontrado", { cause: "conta" });
  await d.repos.contasIa.definirEscolhida(conta.ia, conta.id);
  const mensagens = await d.repos.mensagens.listarDaConversa(p.conversaId, 30);
  const posAviso = mensagens.map((m) => m.payload?.kind === "limite_do_plano" && m.turnoId !== null).lastIndexOf(true);
  const aviso = posAviso >= 0 ? mensagens[posAviso] : undefined;
  const turno = aviso?.turnoId ? await d.repos.turnos.buscar(aviso.turnoId) : null;
  // Já refeito: depois do aviso veio a resposta do bot ou outro "Seguindo com" (o segundo clique não repete a fala).
  const jaRefeito = mensagens.slice(posAviso + 1).some((m) => m.autoria.autor_tipo === "agente" || m.payload?.kind === "conta_escolhida" || m.payload?.kind === "conta_seguiu");
  if (!turno || turno.origem !== "conversa" || turno.estado !== "interrompido" || jaRefeito) return { data: { turnoId: null }, events: [] };
  const agora = d.agora();
  const autoria = autoriaPessoa(d.escopo, turno.executor);
  const events: RuntimeEvent[] = [];
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
  });
  if (novo) events.push(evento(d.escopo, { kind: "turno_criado", autoria, agora, conversaId: turno.conversaId, turnoId: novo.id, dados: { origem: "conversa", agente_id: turno.agenteId, repete_turno_id: turno.id } }));
  log("info", "conta_escolhida", { turno_id: turno.id, novo_turno_id: novo?.id ?? null, conta_id: conta.id });
  return { data: { turnoId: novo?.id ?? null }, events };
}
