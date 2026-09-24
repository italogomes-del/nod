import { randomUUID } from "node:crypto";
import type { Decisao } from "../contracts/decisao.ts";
import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { Rotina } from "../contracts/rotina.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import { concederLote } from "./conceder.ts";
import { dispararRotina } from "./disparar-rotina.ts";
import { fecharGemeas } from "./fechar-gemeas.ts";
import { pausarRotina } from "./pausar-rotina.ts";
import { recusarProposta } from "./recusar-proposta.ts";
import { retomarAposAcesso } from "./retomar-apos-acesso.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

export type EntradaDecidirAcesso = {
  decisaoId: string;
  recusar: boolean;
  /** Executor do turno que a rotina dispara ao ser liberada (o interruptor da máquina, lido na hora). */
  executor: Executor;
  /** Quem clicou; a rota roda como a DONA (comoDona), mas grava a pessoa da sessão. Default: o escopo. */
  por?: string;
};

export type SaidaDecidirAcesso = { decisao: Decisao; concessoes: number; consentimentoId: string | null; rotinaId: string | null; turnoId: string | null };

/** A rotina do pedido só vale se ainda é DESTE agente e não foi excluída; senão o pedido é da conversa. */
async function rotinaDoPedido(deps: Deps, agenteId: string, rotinaId: string | undefined): Promise<Rotina | null> {
  if (!rotinaId) return null;
  const rotina = await deps.repos.rotinas.buscar(rotinaId);
  return rotina && rotina.agenteId === agenteId && rotina.excluidoEm === null ? rotina : null;
}

/**
 * O botão da decisão 'acesso' (definido em 2026-09-24, ADR-044; antes o miolo morava na rota
 * decisoes.ts). Permitir: fecha a decisão → marca a proposta confirmada (o card da conversa sai; antes
 * quem fazia isso era o confirmar) → concede o lote com UM consentimento → continua. Pedido de rotina
 * reativa a rotina se estava pausada e a dispara AGORA, em modo rotina; pedido da conversa retoma o
 * turno que pediu, como antes. Recusar: recusa a proposta e, se veio de rotina, pausa a rotina — sem o
 * acesso ela pediria de novo a cada disparo.
 */
export const decidirAcesso: CasoDeUso<EntradaDecidirAcesso, SaidaDecidirAcesso> = async (deps, input) => {
  const agora = deps.agora();
  const proposta = await deps.repos.propostas.buscar(input.decisaoId);
  const decisao = await deps.repos.decisoes.decidir(input.decisaoId, { por: input.por ?? deps.escopo.pessoaId, agora });
  if (!decisao) throw new ErroDeDominio("estado_invalido", { cause: "decisão já fechada ou inexistente" });
  if (decisao.tipo !== "acesso" || !proposta || proposta.payload.kind !== "acesso" || proposta.payload.conectar) throw new ErroDeDominio("estado_invalido", { cause: "decisão de acesso sem proposta" });
  const p = proposta.payload;
  const autoria = autoriaPessoa(deps.escopo);
  const events: RuntimeEvent[] = [evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: decisao.conversaId, turnoId: decisao.turnoId, dados: { decisao_id: decisao.id, tipo: decisao.tipo, recusada: input.recusar } })];
  // definido em 2026-09-24: o card "×N" prometia "decidir aqui resolve todos" — os pedidos iguais
  // abertos fecham por regra na MESMA transação, e as propostas deles seguem este clique.
  events.push(...(await fecharGemeas(deps, decisao, input.recusar ? "recusada" : "confirmada")).events);
  const rotina = await rotinaDoPedido(deps, proposta.agenteId, p.rotinaId);

  if (input.recusar) {
    if (proposta.estado === "pendente") events.push(...((await recusarProposta(deps, { propostaId: proposta.id })).events ?? []));
    if (rotina) await pausarRotina(deps, { rotinaId: rotina.id, estado: "pausada" });
    return { data: { decisao, concessoes: 0, consentimentoId: null, rotinaId: rotina?.id ?? null, turnoId: null }, events };
  }

  if (proposta.estado === "pendente") await deps.repos.propostas.decidir(proposta.id, "confirmada");
  const conector = await deps.repos.conectores.buscarPorSlug(p.conector);
  if (!conector) throw new ErroDeDominio("nao_encontrado", { cause: "conector" });
  const lote = await concederLote(deps, { agenteId: proposta.agenteId, conectorId: conector.id, capacidades: p.capacidades, autorTipo: "pessoa" });
  events.push(...(lote.events ?? []));

  let turnoId: string | null = null;
  if (rotina) {
    // Agente excluído ou de outra geração (ADR-034) não roda sozinho — a mesma trava de
    // retomarAposAcesso: a concessão fica registrada, o disparo não acontece.
    if (decisao.turnoId !== null && (await deps.repos.agentes.execucaoBloqueada(decisao.turnoId))) {
      return { data: { decisao, concessoes: lote.data.concessoes.length, consentimentoId: lote.data.mensagemId, rotinaId: rotina.id, turnoId: null }, events };
    }
    const ativa = rotina.estado === "pausada" ? (await pausarRotina(deps, { rotinaId: rotina.id, estado: "ativa" })).data.rotina : rotina;
    // `agora` em ms, SEM arredondar ao minuto (executar-rotina-agora.ts arredonda): o minuto cheio pode
    // ser a janela que o scheduler já reivindicou, e aí o disparo voltaria janelaDeOutro, sem turno.
    const disparo = await dispararRotina(deps, { rotina: ativa, instanteAgendado: deps.agora(), machineId: randomUUID(), executor: input.executor, preservarAgenda: true });
    events.push(...(disparo.events ?? []));
    if ("turno" in disparo.data) turnoId = disparo.data.turno.id;
  } else {
    const retomada = await retomarAposAcesso(deps, { decisao, proposta });
    events.push(...(retomada.events ?? []));
    turnoId = retomada.data.turnoId;
  }
  return { data: { decisao, concessoes: lote.data.concessoes.length, consentimentoId: lote.data.mensagemId, rotinaId: rotina?.id ?? null, turnoId }, events };
};
