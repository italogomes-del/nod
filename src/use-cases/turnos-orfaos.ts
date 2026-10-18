import type { RuntimeEvent } from "../contracts/evento.ts";
import { decidirTurnoOrfao, deveObservar, textoDaCausa, type BloqueioFila, type CausaOrfao } from "../domain/turno-orfao.ts";
import { redigir } from "../domain/redacao.ts";
import { log } from "../obs/log.ts";
import type { Metricas } from "../obs/metricas.ts";
import type { OrfaoCandidato } from "../repositories/turnos.repo.ts";
import { autoriaAgente, evento } from "./autoria-evento.ts";
import { registrarDesfechoRotina } from "./disparar-rotina.ts";
import { avisarFalhaDelegacao } from "./entregar-resposta-peer.ts";
import type { Deps } from "./tipos.ts";
import { sincronizarDoTurno } from "./trabalhos.ts";

/** A regra que encerra o pendente órfão (autoria do evento e da mensagem). */
export const REGRA_TURNO_ORFAO = "regra:turno-orfao" as const;

/**
 * Quando cada turno velho foi observado pela última vez (turnoId → instante), mantida pelo varredor entre as passadas.
 * Fica em memória, como os pedidos adiados: um reinício só custa uma observação a mais por turno.
 */
export type TurnosObservados = Map<string, number>;

export type SaidaTurnosOrfaos = { encerrados: { turnoId: string; causa: CausaOrfao }[]; observados: { turnoId: string; bloqueio: BloqueioFila }[] };

/**
 * NOD-219 (definido em 2026-10-13, plano da Ada): uma passada do varredor sobre os pendentes da pessoa.
 *  - Encerra o pendente impossível de rodar (domain/turno-orfao.ts) pelo UPDATE condicional `encerrarOrfao` — se uma
 *    máquina o reivindicou no meio, nada acontece. Efeitos por origem, como a queda de máquina: rotina registra a
 *    execução interrompida (sem mensagem); ligação nem entra; o resto ganha a linha de sistema com a causa. O trabalho do
 *    turno sincroniza, e o pedido de colega avisa quem pediu.
 *  - O pendente velho que ainda pode sair só é observado: log `turno_velho_na_fila` e a métrica, no máximo 1×/h.
 */
/**
 * Roda o encerramento de UM candidato isolado (o varredor passa um SAVEPOINT da tx dele): se lança, só o que ele fez
 * volta e a passada segue para os outros. Sem isso (testes de unidade), roda direto.
 */
export type Isolar = <T>(fn: () => Promise<T>) => Promise<T>;

export async function cuidarDosTurnosOrfaos(deps: Deps, o: { observados?: TurnosObservados; metricas?: Metricas; isolar?: Isolar; limite?: number } = {}): Promise<{ data: SaidaTurnosOrfaos; events: RuntimeEvent[] }> {
  const agora = deps.agora();
  const saida: SaidaTurnosOrfaos = { encerrados: [], observados: [] };
  const events: RuntimeEvent[] = [];
  // O mapa é um só para todas as pessoas (o laço passa por cada uma): sai dele só o que já pode ser observado de novo —
  // o efeito é o mesmo de estar lá, e o mapa não cresce sem fim com turnos que já rodaram.
  if (o.observados) for (const [id, em] of o.observados) if (deveObservar(em, agora)) o.observados.delete(id);
  const candidatos = await deps.repos.turnos.orfaosCandidatos(agora, { jaObservados: o.observados ? [...o.observados.keys()] : [], ...(o.limite ? { limite: o.limite } : {}) });
  const isolar: Isolar = o.isolar ?? ((fn) => fn());
  for (const c of candidatos) {
    const decisao = decidirTurnoOrfao(c, agora);
    if (decisao.tipo === "manter") continue;
    if (decisao.tipo === "encerrar") {
      // revisto em 2026-10-13 (revisão do PR #307): um candidato que lança não derruba a passada inteira — antes, como os
      // impossíveis vêm primeiro, o mesmo turno desfazia todas as passadas seguintes e nenhum órfão da pessoa saía.
      try {
        const r = await isolar(() => encerrar(deps, c, decisao.causa));
        if (r) {
          saida.encerrados.push({ turnoId: c.id, causa: decisao.causa });
          events.push(...r);
        }
      } catch (e) {
        log("erro", "turno_orfao_falhou", { turno_id: c.id, causa: decisao.causa, erro: e instanceof Error ? ((e as { codigo?: string }).codigo ?? e.name) : "desconhecido" });
      }
      continue;
    }
    if (o.observados && !deveObservar(o.observados.get(c.id), agora)) continue;
    o.observados?.set(c.id, agora);
    saida.observados.push({ turnoId: c.id, bloqueio: decisao.bloqueio });
    log("aviso", "turno_velho_na_fila", { turno_id: c.id, agente_id: c.agenteId, trabalho_id: c.trabalhoId, origem: c.origem, bloqueio: decisao.bloqueio, idade_s: Math.round((agora - c.criadoEm) / 1000) });
    o.metricas?.incrementar({ metrica: "turno_velho_na_fila", bloqueio: decisao.bloqueio, tenant_id: deps.escopo.tenantId, pessoa_id: deps.escopo.pessoaId });
  }
  return { data: saida, events };
}

async function encerrar(deps: Deps, c: OrfaoCandidato, causa: CausaOrfao): Promise<RuntimeEvent[] | null> {
  const agora = deps.agora();
  const turno = await deps.repos.turnos.encerrarOrfao(c.id, agora);
  if (!turno) return null;
  const events: RuntimeEvent[] = [];
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor: "catcher", decididoPor: REGRA_TURNO_ORFAO });
  events.push(evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: "parado_pela_pessoa", causa, estava: "pendente", trabalho_id: turno.trabalhoId ?? null } }));
  // Rotina registra a execução interrompida (sem mensagem: o silêncio da ADR de rotinas), com a autoria desta regra. A
  // ligação nem chega aqui (a consulta e o UPDATE a deixam de fora).
  const rotina = await registrarDesfechoRotina(deps, { turnoId: turno.id, desfecho: "interrompida", motivo: null, regra: REGRA_TURNO_ORFAO });
  events.push(...(rotina.events ?? []));
  if ("ignorado" in rotina.data && rotina.data.ignorado === "nao_e_rotina") {
    const aviso = await deps.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "sistema", assunto: "turno.orfao", texto: redigir("turno-orfao-encerrado", agora, { causa: textoDaCausa(causa) }), confianca: "confiavel" });
    if (aviso) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: aviso.id, kind: "sistema" } }));
  }
  events.push(...(await sincronizarDoTurno(deps, turno)));
  // O pedido de colega não fica esperando para sempre: quem pediu recebe a falha (ignora o que não é delegação).
  const peer = await avisarFalhaDelegacao(deps, { turnoId: turno.id, motivo: `O pedido não foi feito: ${textoDaCausa(causa)}.`, semEsperar: true });
  events.push(...(peer.events ?? []));
  log("info", "turno_orfao_encerrado", { turno_id: turno.id, agente_id: turno.agenteId, trabalho_id: turno.trabalhoId ?? null, origem: turno.origem, causa, idade_s: Math.round((agora - turno.criadoEm) / 1000) });
  return events;
}
