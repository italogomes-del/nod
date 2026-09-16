import type { RuntimeEvent } from "../contracts/evento.ts";
import type { FaixaParada } from "../contracts/turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { montarFaixaParada, type TentativaInterrupcao } from "../domain/parada.ts";
import { redigir } from "../domain/redacao.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";

export type EntradaParar = { conversaId: string | null };

/**
 * Parar (E5.4/E8.1/E8.2/E8.3) com estado persistido: ativa a parada (fica ABERTA e bloqueia o despacho
 * até a pessoa falar de novo — definido em 2026-09-16: "Stop now" do Grok Bot; nova mensagem chama
 * encerrarAbertas), interrompe os pendentes na hora, pede interrupção dos despachando (a próxima
 * renovação devolve {ativo:false}) e tenta o SIGTERM pelo interruptor — falha vira `naoInterrompidas`
 * com motivo, NUNCA catch vazio. Cancela frames ainda não entregues do outbox e devolve a faixa.
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

  const pendentes = await deps.repos.turnos.pendentesDaPessoa(conversaId ?? undefined);
  const pendentesInterrompidos: string[] = [];
  for (const t of pendentes) {
    const i = await deps.repos.turnos.interromper(t.id, "parado_pela_pessoa");
    if (!i) continue;
    pendentesInterrompidos.push(t.id);
    events.push(evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: t.conversaId, turnoId: t.id, dados: { motivo: "parado_pela_pessoa", estava: "pendente" } }));
  }

  const despachando = (await deps.repos.turnos.despachandoDaPessoa()).filter((t) => conversaId === null || t.conversaId === conversaId);
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

  const framesCancelados = await deps.repos.outbox.cancelarPendentesDaPessoa(agora);
  // definido em 2026-09-16: nesta rodada o único efeito externo é item aprovado (L5) e ele é síncrono ao
  // decidir; não há emissão "a caminho" para listar como já entregue — a lista nasce vazia e honesta.
  const faixa = montarFaixaParada({ pendentesInterrompidos, despachando: tentativas, entregues: [] });

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
