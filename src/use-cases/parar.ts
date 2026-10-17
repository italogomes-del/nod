import type { RuntimeEvent } from "../contracts/evento.ts";
import type { FaixaParada } from "../contracts/turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { montarFaixaParada, type TentativaInterrupcao } from "../domain/parada.ts";
import { redigir } from "../domain/redacao.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import { avisarFalhaDelegacao, cadeiaDaDelegacao } from "./entregar-resposta-peer.ts";
import { cancelarEsperas } from "./esperar-comando.ts";
import { marcarParado } from "./trabalhos.ts";
import type { Turno } from "../contracts/turno.ts";
import { registrarInterrupcaoPorParada } from "./interrupcao-por-parada.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

export type EntradaParar = { conversaId: string | null };

/**
 * Parar (E5.4/E8.1/E8.2/E8.3) com estado persistido: ativa a parada (fica ABERTA e bloqueia o despacho
 * até a pessoa falar de novo — definido em 2026-09-16: "Stop now" do Grok Bot; nova mensagem chama
 * encerrarAbertas), interrompe os pendentes na hora, pede interrupção dos despachando (a próxima
 * renovação devolve {ativo:false}) e tenta o SIGTERM pelo interruptor — falha vira `naoInterrompidas`
 * com motivo, NUNCA catch vazio. Cancela frames ainda não entregues do outbox (da conversa parada, ou todos sem
 * conversa) e devolve a faixa.
 */
export const parar: CasoDeUso<EntradaParar, FaixaParada> = async (deps, input) => {
  const conversaId = input.conversaId;
  if (conversaId !== null && typeof conversaId !== "string") throw new ErroDeDominio("entrada_invalida", { cause: "conversaId" });
  if (conversaId !== null && !(await deps.repos.conversas.buscar(conversaId))) throw new ErroDeDominio("nao_encontrado");
  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  const events: RuntimeEvent[] = [];

  const parada = await deps.repos.paradas.ativar({ conversaId, agora });
  if (!parada) throw new ErroDeDominio("estado_invalido", { cause: "parada não gravada" });
  // definido em 2026-10-07 (ADR-083): o Parar do chat para tudo do bot, inclusive as tasks dele (os turnos delas
  // moram na conversa do bot e já caem abaixo); sem conversa, as de todos os bots. A lista volta para a tela.
  const conversa = conversaId !== null ? await deps.repos.conversas.buscar(conversaId) : null;
  const abertos = conversaId === null
    ? (await deps.repos.trabalhos.listar({ terminadosDesde: agora + 1 }))
    : conversa?.tipo === "propria" && conversa.agenteId ? await deps.repos.trabalhos.abertosDoAgente(conversa.agenteId) : [];

  const nomeDoBot = conversa?.agenteId ? ((await deps.repos.agentes.buscar(conversa.agenteId))?.nome ?? "o bot") : "o bot";
  // definido em 2026-10-15 (NOD-256, F1.2): o Parar no chat do bot também para o que ele pediu a colegas e ainda não
  // voltou — a delegação no colega (e as retomadas dela). Sem conversa, a parada global já pega todos os turnos.
  const delegacoes = conversaId !== null ? await delegacoesAbertas(deps, conversaId) : [];
  const dasDelegacoes = new Set(delegacoes.map((t) => t.id));

  // definido em 2026-10-04 (ADR-072): o Parar é do trabalho do bot; a ligação se encerra pelo Desligar.
  const daConversa = (await deps.repos.turnos.pendentesDaPessoa(conversaId ?? undefined)).filter((t) => t.origem !== "ligacao");
  const pendentes = [...daConversa, ...delegacoes.filter((t) => t.estado === "pendente" && !daConversa.some((p) => p.id === t.id))];
  const pendentesInterrompidos: string[] = [];
  for (const t of pendentes) {
    const i = await deps.repos.turnos.interromper(t.id, "parado_pela_pessoa");
    if (!i) continue;
    pendentesInterrompidos.push(t.id);
    events.push(evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: t.conversaId, turnoId: t.id, dados: { motivo: "parado_pela_pessoa", estava: "pendente" } }));
    // NOD-252 + merge do #334 (decisão da PM, 17/10/2026): o pendente que o próprio Parar derruba segue o #343 — a rotina
    // vai ao histórico como interrompida · parado_pela_pessoa, SILENCIOSA; a delegação avisa quem pediu, uma vez.
    // A linha `parada_aberta` (desfechoDaParada) é só do despacho barrado por uma parada que JÁ estava aberta.
    events.push(...(await registrarInterrupcaoPorParada(deps, { turnoId: t.id })));
  }

  const dosTrabalhos = new Set(abertos.map((t) => t.id));
  const despachando = (await deps.repos.turnos.despachandoDaPessoa()).filter((t) => t.origem !== "ligacao" && (conversaId === null || t.conversaId === conversaId || dasDelegacoes.has(t.id) || (t.trabalhoId !== null && t.trabalhoId !== undefined && dosTrabalhos.has(t.trabalhoId))));
  await deps.repos.turnos.pedirInterrupcao(despachando.map((t) => t.id), agora);
  const tentativas: TentativaInterrupcao[] = [];
  for (const t of despachando) {
    try {
      const ok = await deps.services.interruptor.interromper(t.id);
      // false = nenhum processo registrado NESTE servidor (outra máquina/reinício): o lease pedido acima
      // faz a próxima renovação devolver {ativo:false} e o laço de lá interrompe — ou o varredor encerra.
      tentativas.push({ turnoId: t.id, interrompido: ok, motivo: ok ? null : "sem_processo_neste_servidor_aguarda_renovacao_do_lease" });
    } catch (e) {
      tentativas.push({ turnoId: t.id, interrompido: false, motivo: e instanceof Error ? e.name : "erro_desconhecido" });
    }
  }

  // ADR-099 (parte 2): o Parar cancela os comandos que o bot deixou esperando, como cancela a volta marcada (o pendente
  // acima). Na conversa, todos os do bot dela, tasks inclusive; sem conversa, todos da pessoa.
  const canceladas = await cancelarEsperas(deps, conversaId === null ? { todas: true } : { conversaId });
  // definido em 2026-10-15 (NOD-257, H4; decisão NOD-225): a espera cancelada de um pedido de colega avisa quem pediu —
  // nada é enfileirado no bot parado. avisarFalhaDelegacao ignora o turno fora de delegação e sai uma vez por pedido.
  for (const turnoId of new Set(canceladas.map((c) => c.turnoId))) {
    const turno = await deps.repos.turnos.buscar(turnoId);
    if (!turno) continue;
    const bot = (await deps.repos.agentes.buscar(turno.agenteId))?.nome ?? nomeDoBot;
    events.push(...((await avisarFalhaDelegacao(deps, { turnoId, motivo: `a pessoa parou ${bot} e cancelou a espera`, semEsperar: true })).events ?? []));
  }
  // NOD-265: na conversa, só os frames dela; os de outro bot da pessoa seguem saindo (a fala final dele não some da tela).
  const framesCancelados = await deps.repos.outbox.cancelarPendentesDaPessoa(agora, conversaId);
  // definido em 2026-09-16: nesta rodada o único efeito externo é item aprovado (L5) e ele é síncrono ao
  // decidir; não há emissão "a caminho" para listar como já entregue — a lista nasce vazia e honesta.
  const faixa: FaixaParada = { ...montarFaixaParada({ pendentesInterrompidos, despachando: tentativas, entregues: [] }), ...(abertos.length > 0 ? { trabalhosParados: abertos.map((t) => ({ id: t.id, titulo: t.titulo })) } : {}) };
  for (const t of abertos) events.push(...(await marcarParado(deps, t)));

  if (conversaId !== null) {
    const texto = faixa.nadaRodando
      ? redigir("parada-nada-rodando", agora)
      : `Parado por você: ${faixa.interrompidas} interrompida(s), ${faixa.naoInterrompidas.length} não interrompida(s).`;
    const m = await deps.repos.mensagens.criar({
      conversaId,
      autoria,
      kind: "parada",
      texto,
      payload: { kind: "parada", interrompidas: faixa.interrompidas, nadaRodando: faixa.nadaRodando },
      confianca: "confiavel",
    });
    if (m) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId, dados: { mensagem_id: m.id, kind: "parada" } }));
  }
  events.push(
    evento(deps.escopo, {
      kind: "parada",
      autoria,
      agora,
      conversaId,
      dados: {
        parada_id: parada.id,
        interrompidas: faixa.interrompidas,
        nao_interrompidas: faixa.naoInterrompidas.length,
        ja_entregues: faixa.jaEntregues.length,
        nada_rodando: faixa.nadaRodando,
        frames_cancelados: framesCancelados,
      },
    }),
  );
  return { data: faixa, events };
};

/**
 * NOD-256 (F1.2): os turnos vivos (pendentes ou em despacho) das delegações que o bot da conversa pediu e que ainda não
 * voltaram — handoff com tarefaId sem peer_ask da mesma tarefa (a regra de pedidosEmAberto), mais as retomadas delas.
 */
async function delegacoesAbertas(deps: Pick<Deps, "repos">, conversaId: string): Promise<Turno[]> {
  const mensagens = await deps.repos.mensagens.listarDaConversa(conversaId, 500);
  const voltaram = new Set(mensagens.flatMap((m) => (m.payload?.kind === "peer_ask" ? [m.payload.tarefaId] : [])));
  const tarefas = new Set(mensagens.flatMap((m) => (m.payload?.kind === "handoff" && m.payload.tarefaId && !voltaram.has(m.payload.tarefaId) ? [m.payload.tarefaId] : [])));
  const vivos: Turno[] = [];
  for (const id of tarefas) {
    const tarefa = await deps.repos.turnos.buscar(id);
    if (!tarefa || tarefa.origem !== "delegacao") continue;
    for (const t of await cadeiaDaDelegacao(deps, tarefa)) if (t.estado === "pendente" || t.estado === "despachando") vivos.push(t);
  }
  return vivos;
}
