import { createHmac, timingSafeEqual } from "node:crypto";
import {
  DISJUNTOR_FALHAS,
  DISJUNTOR_MS,
  REVISOES_POR_MAQUINA,
  SEGREDO_REVISAO_MAX,
  SEGREDO_REVISAO_MIN,
  type ConfigRevisor,
  type PedidoRevisao,
  type PressaoDaMaquinaRevisor,
  type RelatoRevisao,
  type ServicoRevisor,
} from "../../contracts/revisao.ts";
import { lerVeredito } from "../../domain/revisor.ts";
import { log } from "../../obs/log.ts";
import type { Escopo, Relogio } from "../../shared/types.ts";
import type { PedidoNaCaixa, ResultadoRevisao } from "../../use-cases/revisar-acao.ts";

/**
 * A caixa de pedidos de revisão (definido em 2026-10-18, plano dos modos de aprovação, 3c; ADR-115). Memória do processo
 * — produção é um processo só (docs/deploy-gcp.md), o mesmo argumento que mantém `c.planos` em memória; o banco segue
 * sendo a verdade (a decisão `em_revisao`), e o varredor de expiração recolhe o que a caixa perder num deploy.
 *
 * Uma por processo, dividida por todas as pontes (`ponte-interna.renovar` entrega e marca `revisa`; `relatarRevisao`
 * recebe). Guarda, por turno, a máquina, o segredo que o laço mandou (amarrado só antes do prompt) e se a última renovação trouxe
 * `revisa`; por pedido, a decisão, o prazo e quando foi entregue; por máquina, o disjuntor.
 */

export type DepsCaixa = {
  config: ConfigRevisor;
  agora: Relogio;
  /** A fase 3 do prazo e do turno que terminou com a revisão em voo: numa transação nova, pela composição. Nunca lança. */
  vencer(p: { escopo: Escopo; decisaoId: string; resultado: ResultadoRevisao }): Promise<void>;
  /** A pressão da máquina com a histerese (trabalhos-vivos); ausente = sem leitura, nada segura. */
  pressao?(machineId: string): PressaoDaMaquinaRevisor | null;
  /** Injetável no teste: agenda e devolve como cancelar. */
  agendar?(fn: () => void, ms: number): () => void;
};

export type RelatoAceito = { aceito: true; escopo: Escopo; decisaoId: string; resultado: ResultadoRevisao };

export type CaixaRevisoes = ServicoRevisor & {
  /** Depois do commit da fase 1: guarda o pedido e agenda o prazo. */
  enfileirar(p: PedidoNaCaixa): void;
  /**
   * Na renovação (`ponte-interna.renovar`, turno ativo): registra `revisa` e o segredo, confirma os recebidos e devolve os
   * pedidos a entregar — reentregues até a confirmação, no máximo REVISOES_POR_MAQUINA em voo por máquina.
   * `amarraSegredo` (revisão do PR 3a): o turno ainda não tinha `prompt_submitted` no banco antes desta renovação, ou seja,
   * o bot ainda não rodou nada. Só aí um segredo novo é amarrado; depois (o laço antigo que nunca mandou um, ou o mapa
   * vazio depois de um reinício) ninguém amarra, e o turno fica sem revisor (cartão na fase 1).
   */
  naRenovacao(p: { turnoId: string; machineId: string; revisa: boolean; amarraSegredo: boolean; segredo?: string; recebidas?: readonly string[] }): PedidoRevisao[];
  /** Confere o relato (máquina, turno, uso único, prazo, prova). Aceito, o pedido sai da caixa e a fase 3 é de quem chamou. */
  relatar(machineId: string, relato: RelatoRevisao): RelatoAceito | { aceito: false; motivo: string };
  /** O turno foi entregue: a revisão que sobrou vira cartão na hora (o hook já não espera), e o estado do turno sai. */
  esquecerTurno(turnoId: string): void;
  /** Para os testes e o log de saúde. */
  emMemoria(): { turnos: number; pedidos: number };
};

/** `envenenado`: dois segredos diferentes chegaram para o turno — alguém além do laço renovou; o turno perde o revisor. */
type EstadoDoTurno = { machineId: string; segredo: string | null; revisa: boolean; vistoEm: number; envenenado?: true };
type NaCaixa = PedidoNaCaixa & { entregueEm: number | null; confirmado: boolean; cancelar: () => void };

/** Um turno sem renovação há tanto tempo sai da caixa (o lease já venceu muito antes). */
const ESQUECER_TURNO_MS = 10 * 60_000;
const VARRER_A_CADA_MS = 60_000;

/** A prova que só o laço sabe fazer: hexadecimal de HMAC-SHA256(segredo, `${revisaoId}|${decisaoId}`). */
export function provaDaRevisao(segredo: string, revisaoId: string, decisaoId: string): string {
  return createHmac("sha256", segredo).update(`${revisaoId}|${decisaoId}`).digest("hex");
}

export function segredoValido(s: unknown): s is string {
  return typeof s === "string" && s.length >= SEGREDO_REVISAO_MIN && s.length <= SEGREDO_REVISAO_MAX && /^[A-Za-z0-9_-]+$/.test(s);
}

function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

export function criarCaixaRevisoes(deps: DepsCaixa): CaixaRevisoes {
  const agendar = deps.agendar ?? ((fn: () => void, ms: number) => {
    const t = setTimeout(fn, Math.max(0, ms));
    t.unref?.();
    return () => clearTimeout(t);
  });
  const turnos = new Map<string, EstadoDoTurno>();
  const pedidos = new Map<string, NaCaixa>();
  const falhasSeguidas = new Map<string, number>();
  const abertoAte = new Map<string, number>();
  let varridoEm = deps.agora();

  function disjuntor(machineId: string, ok: boolean): void {
    if (ok) {
      falhasSeguidas.delete(machineId);
      return;
    }
    const n = (falhasSeguidas.get(machineId) ?? 0) + 1;
    if (n < DISJUNTOR_FALHAS) {
      falhasSeguidas.set(machineId, n);
      return;
    }
    falhasSeguidas.delete(machineId);
    abertoAte.set(machineId, deps.agora() + DISJUNTOR_MS);
    log("aviso", "revisor_disjuntor_aberto", { machine_id: machineId, falhas: n, por_ms: DISJUNTOR_MS });
  }

  function tirar(revisaoId: string): NaCaixa | null {
    const e = pedidos.get(revisaoId);
    if (!e) return null;
    pedidos.delete(revisaoId);
    e.cancelar();
    return e;
  }

  function vencer(e: NaCaixa, falha: "prazo" | "turno" | "sem_revisor"): void {
    void deps.vencer({ escopo: e.escopo, decisaoId: e.pedido.decisaoId, resultado: { tipo: "falha", falha, entregueEm: e.entregueEm } });
  }

  function varrer(): void {
    const agora = deps.agora();
    if (agora - varridoEm < VARRER_A_CADA_MS) return;
    varridoEm = agora;
    for (const [turnoId, t] of turnos) if (agora - t.vistoEm > ESQUECER_TURNO_MS && ![...pedidos.values()].some((p) => p.pedido.turnoId === turnoId)) turnos.delete(turnoId);
    for (const [machineId, ate] of abertoAte) if (ate <= agora) abertoAte.delete(machineId);
  }

  return {
    config: deps.config,
    ...(deps.pressao ? { pressao: deps.pressao } : {}),

    revisorDoTurno(turnoId) {
      const t = turnos.get(turnoId);
      return t && t.revisa && t.segredo && !t.envenenado ? { machineId: t.machineId } : null;
    },

    disjuntorAberto(machineId) {
      return (abertoAte.get(machineId) ?? 0) > deps.agora();
    },

    enfileirar(p) {
      const revisaoId = p.pedido.revisaoId;
      const cancelar = agendar(() => {
        const e = tirar(revisaoId);
        if (!e) return;
        log("aviso", "revisao_prazo", { turno_id: e.pedido.turnoId, decisao_id: e.pedido.decisaoId, revisao_id: revisaoId, entregue: e.entregueEm !== null });
        disjuntor(e.machineId, false);
        vencer(e, "prazo");
      }, p.pedido.expiraEm - deps.agora());
      pedidos.set(revisaoId, { ...p, entregueEm: null, confirmado: false, cancelar });
    },

    naRenovacao({ turnoId, machineId, revisa, amarraSegredo, segredo, recebidas }) {
      varrer();
      const agora = deps.agora();
      const atual = turnos.get(turnoId);
      if (atual && atual.machineId !== machineId) {
        log("aviso", "revisao_renovacao_de_outra_maquina", { turno_id: turnoId, machine_id: machineId });
        return [];
      }
      if (atual?.envenenado) {
        atual.vistoEm = agora;
        return [];
      }
      const segredoOk = segredoValido(segredo);
      if (atual?.segredo && segredoOk && !iguais(atual.segredo, segredo)) {
        // Dois segredos para o mesmo turno: alguém além do laço renovou (gatilho de reversão da ADR-115). Revisão do PR 3a:
        // não basta recusar o segundo — quem chegou primeiro pode ser o intruso. O turno perde o revisor de vez, e o que
        // estava na caixa vira cartão já.
        log("aviso", "revisao_segredo_recusado", { turno_id: turnoId, machine_id: machineId });
        turnos.set(turnoId, { machineId, segredo: null, revisa: false, vistoEm: agora, envenenado: true });
        for (const e of [...pedidos.values()]) {
          if (e.pedido.turnoId !== turnoId) continue;
          tirar(e.pedido.revisaoId);
          vencer(e, "sem_revisor");
        }
        return [];
      }
      if (segredoOk && !atual?.segredo && !amarraSegredo) log("aviso", "revisao_segredo_tardio", { turno_id: turnoId, machine_id: machineId });
      const novo = segredoOk && amarraSegredo ? segredo : null;
      const estado: EstadoDoTurno = { machineId, segredo: atual?.segredo ?? novo, revisa: revisa && segredoOk, vistoEm: agora };
      turnos.set(turnoId, estado);
      if (!estado.revisa || !estado.segredo) return [];
      for (const id of recebidas ?? []) {
        const e = pedidos.get(id);
        if (e && e.pedido.turnoId === turnoId) e.confirmado = true;
      }
      const doTurno = [...pedidos.values()].filter((e) => e.pedido.turnoId === turnoId && e.machineId === machineId && !e.confirmado);
      let emVoo = [...pedidos.values()].filter((e) => e.machineId === machineId && e.entregueEm !== null).length;
      const saida: PedidoRevisao[] = [];
      for (const e of doTurno) {
        if (e.entregueEm === null) {
          if (emVoo >= REVISOES_POR_MAQUINA) continue;
          e.entregueEm = agora;
          emVoo += 1;
        }
        saida.push(e.pedido);
      }
      return saida;
    },

    relatar(machineId, relato) {
      const e = pedidos.get(relato.revisaoId);
      const ignorar = (motivo: string) => {
        log(motivo === "prova" ? "aviso" : "info", motivo === "prova" ? "revisao_prova_invalida" : "revisao_relato_ignorado", { revisao_id: relato.revisaoId, turno_id: relato.turnoId, machine_id: machineId, motivo });
        return { aceito: false as const, motivo };
      };
      if (!e) return ignorar("desconhecida");
      if (e.pedido.turnoId !== relato.turnoId || e.machineId !== machineId) return ignorar("outro_turno_ou_maquina");
      if (deps.agora() > e.pedido.expiraEm) return ignorar("atrasada");
      const segredo = turnos.get(e.pedido.turnoId)?.segredo;
      if (!segredo || !iguais(provaDaRevisao(segredo, e.pedido.revisaoId, e.pedido.decisaoId), relato.prova)) return ignorar("prova");
      tirar(relato.revisaoId);
      const resultado: ResultadoRevisao = relato.falha
        ? { tipo: "falha", falha: relato.falha, ms: relato.ms, entregueEm: e.entregueEm }
        : { tipo: "saida", saida: relato.saida ?? "", ms: relato.ms, ...(relato.fichasEntrada !== undefined ? { fichasEntrada: relato.fichasEntrada } : {}), ...(relato.fichasSaida !== undefined ? { fichasSaida: relato.fichasSaida } : {}), entregueEm: e.entregueEm };
      disjuntor(machineId, resultado.tipo === "saida" && lerVeredito(resultado.saida) !== null);
      return { aceito: true, escopo: e.escopo, decisaoId: e.pedido.decisaoId, resultado };
    },

    esquecerTurno(turnoId) {
      turnos.delete(turnoId);
      for (const e of [...pedidos.values()]) {
        if (e.pedido.turnoId !== turnoId) continue;
        tirar(e.pedido.revisaoId);
        vencer(e, "turno");
      }
    },

    emMemoria() {
      return { turnos: turnos.size, pedidos: pedidos.size };
    },
  };
}
