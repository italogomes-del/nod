import type { ContaAnunciada, ContaIa, ContasIaDto, MotivoDaNota } from "../contracts/contas-ia.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { MOTIVOS_FALHA_DE_ESPERA } from "../domain/pedido-parado.ts";
import { nomeDaConta, ordemIasDaLista } from "../domain/contas-da-pessoa.ts";
import { ORDEM_IAS_PADRAO } from "../domain/inteligencia.ts";
import { log } from "../obs/log.ts";
import type { ContaGuardadaNoServidor, ResultadoDoAnuncio } from "../repositories/contas-ia.repo.ts";
import type { PayloadMensagem } from "../contracts/mensagem.ts";
import type { Turno } from "../contracts/turno.ts";
import { avaliarOrcamento } from "../domain/canal-orcamento.ts";
import { harnessFixado } from "../domain/harness.ts";
import { redigir } from "../domain/redacao.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import { CONTATO_RECENTE_MS, lerContasDaMaquina, notaDeLimite } from "./contas-do-turno.ts";
import type { Deps } from "./tipos.ts";
import { seguirNaContaFechaATroca } from "./trocas-de-ia.ts";

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
  // NOD-277 (definido em 2026-10-15): conta que acabou de ficar pronta nesta máquina acorda a espera da cota da IA dela. A
  // corporativa fora da troca automática não acorda nada sozinha (NOD-221): ela só recebe esse fundo quando a pessoa a
  // escolhe ("Seguir com" ou posição 1). O portão da cota continua segurando se o limite persistir.
  for (const ia of new Set(r.prontasAgora.filter((c) => !c.corporativa || c.entraNaTrocaAutomatica).map((c) => c.ia))) {
    const acordados = await d.repos.turnos.anteciparEsperasDaCota(ia);
    if (acordados.length > 0) log("info", "espera_da_cota_antecipada", { gatilho: "conta_nova", ia, maquina_id: maquinaId, turnos: acordados.length });
  }
  return r;
}

/** NOD-277: "Seguir com <conta>" resolve a espera da cota da IA da conta (a escolhida passa a valer já). */
async function anteciparPelaEscolha(d: Deps, ia: string, contaId: string): Promise<number> {
  const acordados = await d.repos.turnos.anteciparEsperasDaCota(ia);
  if (acordados.length > 0) log("info", "espera_da_cota_antecipada", { gatilho: "seguir_com", ia, conta_id: contaId, turnos: acordados.length });
  return acordados.length;
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
 * NOD-280/NOD-284 (definido em 2026-10-15): por que um botão da nota de limite não refez a fala. Em código na resposta; a
 * tela mostra o texto (redacao.ts, `nota-*`).
 */
/** NOD-284: por que a nota não refez a fala (o contrato fica em contracts/contas-ia.ts, para a web). */
export type MotivoNaoRefez = MotivoDaNota;

export type SaidaDaNota = { data: { turnoId: string | null; motivo: MotivoNaoRefez | null }; events: RuntimeEvent[] };

const ORIGENS_REFAZIVEIS: readonly Turno["origem"][] = ["conversa", "sala"];

/**
 * O turno parou na conta: no limite (`limite_do_plano`, no fim do turno) ou recusado no despacho sem conta utilizável
 * (`sem_conta`, NOD-269 na main desde o #340) — os dois deixam a mesma nota de limite na conversa.
 */
const paradoPelaConta = (turno: Turno): boolean => (MOTIVOS_FALHA_DE_ESPERA as readonly (string | null)[]).includes(turno.motivoFalha ?? null);

/** O turno da nota: pelo `turnoId` do botão (NOD-284), na conversa dele. Outro id, ou de outra conversa = não encontrado. */
async function turnoDaNota(d: Deps, p: { conversaId: string; turnoId: string }): Promise<Turno> {
  const turno = await d.repos.turnos.buscar(p.turnoId);
  if (!turno || turno.conversaId !== p.conversaId) throw new ErroDeDominio("nao_encontrado", { cause: "turno" });
  return turno;
}

/** A conta serve para refazer o turno? De outra IA (NOD-224, bot fixo) ou no limite = não, com o motivo. */
function contaNaoServe(conta: Pick<ContaGuardadaNoServidor, "ia" | "noLimiteAte">, turno: Turno | null, agora: number): MotivoNaoRefez | null {
  const fixo = turno ? harnessFixado(turno.harness, turno.modelo) : null;
  if (fixo !== null && fixo !== conta.ia) return "conta_de_outra_ia";
  if (conta.noLimiteAte !== null && conta.noLimiteAte > agora) return "conta_no_limite";
  return null;
}

/**
 * O núcleo dos três botões da nota de limite (NOD-280 + NOD-284, definido em 2026-10-15): refaz UMA vez o turno que parou no
 * limite da conta. Decide pelo estado do turno (interrompido por `limite_do_plano` ou `sem_conta`), nunca pelas últimas mensagens; "já
 * refeito" = um turno posterior do MESMO bot, da mesma fala (`mensagemOrigemId`; na sala, que não a tem, o mesmo texto),
 * que não seja a cópia adiada à espera da conta — essa sai da fila (PR #319) antes de refazer. O turno novo tem a mesma
 * origem (conversa ou sala), `reenvios`+1 e, no "desta vez", a máquina escolhida. Na sala passa pelo orçamento do canal como
 * um responder. Quem chama segura `contasIa.travar()` (dois cliques esperam um pelo outro e o segundo vê o primeiro).
 */
export async function refazerTurnoDaNota(
  d: Deps,
  p: { turno: Turno; linha: { texto: string; payload?: PayloadMensagem }; maquinaDestaVez?: string | null },
): Promise<SaidaDaNota> {
  const { turno } = p;
  const agora = d.agora();
  const nada = (motivo: MotivoNaoRefez): SaidaDaNota => ({ data: { turnoId: null, motivo }, events: [] });
  if (turno.estado !== "interrompido" || !paradoPelaConta(turno) || !ORIGENS_REFAZIVEIS.includes(turno.origem)) return nada("turno_nao_interrompido");
  const mesmaFala = (t: Turno) => t.id !== turno.id && t.agenteId === turno.agenteId && t.criadoEm >= turno.criadoEm
    && (turno.mensagemOrigemId ? t.mensagemOrigemId === turno.mensagemOrigemId : t.entradaTexto === turno.entradaTexto);
  const posteriores = (await d.repos.turnos.listarDaConversa(turno.conversaId, 50)).filter(mesmaFala);
  const adiadas = posteriores.filter((t) => t.estado === "pendente" && (t.acordarEm ?? null) !== null);
  if (posteriores.some((t) => !adiadas.includes(t))) return nada("ja_refeito");
  if (turno.origem === "sala") {
    const sala = await d.repos.salas.buscarPorConversa(turno.conversaId);
    if (!sala || !(await d.repos.salas.membros(sala.id)).some((m) => m.agenteId === turno.agenteId)) return nada("bot_fora_da_sala");
    // O clique é da pessoa: o ritmo não conta (como a resposta logo depois de uma fala humana); o anel e o teto, sim.
    if (avaliarOrcamento({ estado: { ...sala.orcamento, ultimoPostEm: null }, candidatoAgenteId: turno.agenteId, eRotina: false, agora }) !== "permitir") return nada("orcamento_da_sala");
  }
  const autoria = autoriaPessoa(d.escopo, turno.executor);
  const events: RuntimeEvent[] = [];
  for (const t of adiadas) {
    // Cópia já reivindicada entre a leitura e aqui (cancelarPendente null): ela é a refeita.
    if (!(await d.repos.turnos.cancelarPendente(t.id))) return { data: { turnoId: null, motivo: "ja_refeito" }, events };
    events.push(evento(d.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: t.conversaId, turnoId: t.id, dados: { motivo: "parado_pela_pessoa", substituido_por_escolha: true } }));
  }
  const linha = await d.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "sistema", texto: p.linha.texto, ...(p.linha.payload ? { payload: p.linha.payload } : {}), confianca: "confiavel" });
  if (linha) events.push(evento(d.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: linha.id, kind: "sistema" } }));
  const novo = await d.repos.turnos.enfileirar({
    conversaId: turno.conversaId,
    agenteId: turno.agenteId,
    origem: turno.origem,
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
    maquinaDestaVez: p.maquinaDestaVez ?? null,
    // NOD-287: a fala refeita na conta escolhida leva a marca da web do turno que bateu no limite.
    contaminadoDe: turno.id,
  });
  if (novo) events.push(evento(d.escopo, { kind: "turno_criado", autoria, agora, conversaId: turno.conversaId, turnoId: novo.id, dados: { origem: turno.origem, agente_id: turno.agenteId, repete_turno_id: turno.id, maquina_desta_vez: p.maquinaDestaVez ?? null } }));
  log("info", "nota_refez_turno", { turno_id: turno.id, novo_turno_id: novo?.id ?? null, origem: turno.origem, maquina_desta_vez: p.maquinaDestaVez ?? null });
  return { data: { turnoId: novo?.id ?? null, motivo: null }, events };
}

/**
 * "Seguir com <conta>" na nota do limite (ADR-102, CMD-1): a conta vira a escolhida da IA dela e o turno que parou no
 * limite é refeito (antes a pessoa precisava mandar a mensagem de novo).
 *
 * NOD-268 (regressão de 15/10): a conta que não está pronta na máquina que vai pegar o turno (a do bot ou a padrão, ADR-090;
 * sem nenhuma, qualquer máquina conectada) não refaz a fala — refeita, ela voltava à mesma nota, em laço. A conversa ganha UMA
 * vez a linha "A conta X não está em <máquina>…". O clique da pessoa não passa pelo teto de reenvios, só por esta trava.
 *
 * NOD-284 (definido em 2026-10-15): o botão leva o `turnoId` da nota (sem ele, o botão antigo: a última nota da conversa).
 * Valida ANTES de gravar: conta de outra IA (NOD-224), no limite ou fora da máquina = nada gravado, com o motivo. Conta
 * válida grava a escolhida (NOD-221: vale também para o fundo) e refaz pelo núcleo — na sala também, só aquele bot.
 *
 * ADR-108 (R6 a, "Continuar na conta …" do aviso do bot fixo): sem `turnoId`, a nota pode ser o aviso `troca_de_ia` com o
 * turno da fala. A conta gravada também acorda as tasks do bot da conversa que esperavam a IA dela e fecha o aviso de troca
 * dele. A conta recusada (outra IA, no limite, fora da máquina) não acorda nada.
 */
export async function seguirComConta(d: Deps, p: { contaId: string; conversaId: string; turnoId?: string | null }): Promise<SaidaDaNota> {
  // Revisão do PR #306: dois cliques (ou duas abas) esperam um pelo outro; o segundo já vê o "Seguindo com" do primeiro.
  await d.repos.contasIa.travar();
  const conta = await d.repos.contasIa.buscar(p.contaId);
  if (!conta || conta.removidaEm !== null) throw new ErroDeDominio("nao_encontrado", { cause: "conta" });
  const agora = d.agora();
  let turno: Turno | null;
  let semNota: MotivoNaoRefez | null = null;
  if (p.turnoId) turno = await turnoDaNota(d, { conversaId: p.conversaId, turnoId: p.turnoId });
  else {
    const nota = notaDeLimite(await d.repos.mensagens.listarDaConversa(p.conversaId, 30), undefined, true);
    turno = nota?.nota.turnoId ? await d.repos.turnos.buscar(nota.nota.turnoId) : null;
    if (nota && !nota.aberta) semNota = "ja_refeito";
  }
  const naoServe = contaNaoServe(conta, turno, agora);
  if (naoServe) return { data: { turnoId: null, motivo: naoServe }, events: [] };
  if (!turno) {
    await d.repos.contasIa.definirEscolhida(conta.ia, conta.id);
    const acordou = await fecharTrocaDaConta(d, { conta, conversaId: p.conversaId, agenteId: null, agora });
    const esperas = await anteciparPelaEscolha(d, conta.ia, conta.id);
    // Re-QA do PR #329 (merge com o ADR-108): o "Continuar na conta" do aviso só de tasks não tem fala a refazer — acordar
    // as tasks e fechar o aviso é o efeito do clique; um motivo aqui faria a tela dizer que nada aconteceu. Idem o
    // "Seguir com" da task parada pela cota (Trabalhos, NOD-277), que acorda a espera dela.
    return { data: { turnoId: null, motivo: acordou.length > 0 || esperas > 0 ? null : (semNota ?? "turno_nao_interrompido") }, events: acordou };
  }
  const fora = await contaForaDaMaquina(d, { contaId: conta.id, agenteId: turno.agenteId });
  if (fora) {
    const events: RuntimeEvent[] = [];
    const autoria = autoriaPessoa(d.escopo, turno.executor);
    const texto = redigir("conta-fora-da-maquina", agora, { conta: nomeDaConta(conta), maquina: fora.nome ? `em ${fora.nome}` : "em nenhuma máquina ligada" });
    // O mesmo clique de novo não repete a linha.
    const recentes = await d.repos.mensagens.listarDaConversa(p.conversaId, 30);
    if (!recentes.some((m) => m.kind === "sistema" && m.turnoId === turno.id && m.texto === texto)) {
      const linha = await d.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "sistema", texto, confianca: "confiavel" });
      if (linha) events.push(evento(d.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: linha.id, kind: "sistema" } }));
    }
    log("info", "conta_fora_da_maquina", { turno_id: turno.id, conta_id: conta.id, maquina_id: fora.id });
    // Revisão do PR #319: a conta recusada não vira a escolhida da IA (o próximo plano seguiria uma conta que não está lá).
    return { data: { turnoId: null, motivo: "conta_fora_da_maquina" }, events };
  }
  await d.repos.contasIa.definirEscolhida(conta.ia, conta.id);
  const acordou = await fecharTrocaDaConta(d, { conta, conversaId: p.conversaId, agenteId: turno.agenteId, agora });
  // NOD-277 (main, #341): a escolhida passa a valer já para o fundo que esperava a cota da IA dela.
  const esperas = await anteciparPelaEscolha(d, conta.ia, conta.id);
  // A nota já refeita não repete a fala; se o clique acordou tasks ou a espera da cota (o botão da task), ele fez efeito.
  if (semNota) return { data: { turnoId: null, motivo: acordou.length > 0 || esperas > 0 ? null : semNota }, events: acordou };
  const r = await refazerTurnoDaNota(d, {
    turno,
    linha: { texto: `Seguindo com ${nomeDaConta(conta)}.`, payload: { kind: "conta_escolhida", contaId: conta.id, apelido: conta.apelido, ia: conta.ia } },
  });
  log("info", "conta_escolhida", { turno_id: turno.id, novo_turno_id: r.data.turnoId, conta_id: conta.id, motivo: r.data.motivo });
  return { data: r.data, events: [...acordou, ...r.events] };
}

/**
 * ADR-108 (R6 a): a conta escolhida acorda as tasks do bot da conversa que esperavam a IA dela e fecha o aviso de troca
 * dele. Sem o bot do turno, o da conversa.
 */
async function fecharTrocaDaConta(
  d: Deps,
  p: { conta: Pick<ContaGuardadaNoServidor, "id" | "ia">; conversaId: string; agenteId: string | null; agora: number },
): Promise<RuntimeEvent[]> {
  const agenteId = p.agenteId ?? (await d.repos.conversas.buscar(p.conversaId))?.agenteId ?? null;
  if (!agenteId) return [];
  const r = await seguirNaContaFechaATroca(d, { agenteId, ia: p.conta.ia, agora: p.agora });
  if (r.acordadas === 0 && !r.fechou) return [];
  log("info", "conta_escolhida_acordou_tasks", { agente_id: agenteId, conta_id: p.conta.id, tasks: r.acordadas });
  return [evento(d.escopo, { kind: "agente_atualizado", autoria: autoriaPessoa(d.escopo), agora: p.agora, conversaId: p.conversaId, dados: { agente_id: agenteId, acao: "troca_de_ia", decisao: "conta", tasks: r.acordadas } })];
}

/**
 * "Rodar no <máquina> desta vez" na nota (NOD-280, definido em 2026-10-15): refaz o turno da nota, uma vez, com
 * `maquina_desta_vez` (ADR-090) — antes o botão mexia só em pendentes e não fazia nada. A máquina precisa estar viva e com
 * contato recente, e ter uma conta da mesma IA pronta e fora do limite. Com `contaId` (a corporativa fora da troca, o botão
 * nomeado), ela vira a escolhida (NOD-221 item 3); sem, nada é gravado: "desta vez" vale só para este turno.
 */
export async function rodarDestaVezComConta(d: Deps, p: { conversaId: string; turnoId: string; maquinaId: string; contaId?: string | null }): Promise<SaidaDaNota> {
  await d.repos.contasIa.travar();
  const turno = await turnoDaNota(d, p);
  const agora = d.agora();
  const nada = (motivo: MotivoNaoRefez): SaidaDaNota => ({ data: { turnoId: null, motivo }, events: [] });
  const chave = (await d.repos.maquinaTokens.listar()).find((c) => c.id === p.maquinaId && c.revogadaEm === null);
  if (!chave) throw new ErroDeDominio("nao_encontrado", { cause: "máquina" });
  if (chave.ultimoUsoEm === null || agora - chave.ultimoUsoEm >= CONTATO_RECENTE_MS) return nada("maquina_sem_contato");
  const c = await lerContasDaMaquina(d, p.maquinaId);
  const fixo = harnessFixado(turno.harness, turno.modelo);
  let conta: ContaGuardadaNoServidor | null = null;
  if (p.contaId) {
    conta = c.contas.find((x) => x.id === p.contaId && x.removidaEm === null) ?? null;
    if (!conta) throw new ErroDeDominio("nao_encontrado", { cause: "conta" });
    const naoServe = contaNaoServe(conta, turno, agora);
    if (naoServe) return nada(naoServe);
    if (!c.naMaquina.has(conta.id)) return nada("conta_fora_da_maquina");
  } else {
    // Alguma conta da IA do turno pronta e fora do limite naquela máquina (no Automático, de qualquer IA com conta).
    const serve = c.contas.some((x) => x.removidaEm === null && c.naMaquina.has(x.id) && (fixo === null || x.ia === fixo) && (x.noLimiteAte === null || x.noLimiteAte <= agora));
    if (!serve) return nada("conta_fora_da_maquina");
  }
  const r = await refazerTurnoDaNota(d, { turno, maquinaDestaVez: p.maquinaId, linha: { texto: redigir("rodando-desta-vez", agora, { maquina: chave.nome }) } });
  // NOD-221 item 3: a corporativa fora da troca, nomeada no botão, é escolha explícita — só depois de refazer de fato.
  if (conta && r.data.turnoId !== null) await d.repos.contasIa.definirEscolhida(conta.ia, conta.id);
  log("info", "turno_rodar_desta_vez", { turno_id: turno.id, novo_turno_id: r.data.turnoId, maquina_id: p.maquinaId, motivo: r.data.motivo });
  return r;
}

/**
 * "Tentar de novo com <conta>" (NOD-280, definido em 2026-10-15): depois de um upgrade, a pessoa não espera a hora gravada.
 * Limpa o limite da conta; com `turnoId` (na nota) refaz aquele turno uma vez; sem (em Provedores), acorda agora as falas
 * que esperavam o limite passar. Não grava a escolhida (NOD-221). Se a conta seguir no limite, o próximo turno marca de novo
 * e mostra a nota — sem laço: cada clique faz no máximo um turno.
 */
export async function tentarDeNovoComConta(d: Deps, p: { contaId: string; conversaId?: string | null; turnoId?: string | null }): Promise<SaidaDaNota & { data: { acordados: number } }> {
  await d.repos.contasIa.travar();
  const conta = await d.repos.contasIa.buscar(p.contaId);
  if (!conta || conta.removidaEm !== null) throw new ErroDeDominio("nao_encontrado", { cause: "conta" });
  const agora = d.agora();
  if (p.turnoId) {
    if (!p.conversaId) throw new ErroDeDominio("entrada_invalida", { cause: "conversa" });
    const turno = await turnoDaNota(d, { conversaId: p.conversaId, turnoId: p.turnoId });
    const fixo = harnessFixado(turno.harness, turno.modelo);
    if (fixo !== null && fixo !== conta.ia) return { data: { turnoId: null, motivo: "conta_de_outra_ia", acordados: 0 }, events: [] };
    await d.repos.contasIa.limparLimite(conta.id);
    const r = await refazerTurnoDaNota(d, { turno, linha: { texto: redigir("tentando-de-novo", agora, { conta: nomeDaConta(conta) }) } });
    log("info", "conta_tentar_de_novo", { conta_id: conta.id, turno_id: turno.id, novo_turno_id: r.data.turnoId, motivo: r.data.motivo });
    return { data: { ...r.data, acordados: 0 }, events: r.events };
  }
  await d.repos.contasIa.limparLimite(conta.id);
  const acordados = await d.repos.turnos.anteciparEsperasDoLimite({ ia: conta.ia, agora });
  log("info", "conta_tentar_de_novo", { conta_id: conta.id, turno_id: null, acordados });
  return { data: { turnoId: null, motivo: null, acordados }, events: [] };
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
