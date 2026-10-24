import type { ComandoComputador, EstadoAnuncioComputador, EstadoComputadorRelatado } from "../contracts/computador-motor.ts";
import type { PlataformaMaquina } from "../contracts/ponte.ts";

/**
 * O canal entre o servidor e o motor para o computador da pessoa (definido em 2026-10-22, NOD-96 PR 3, ADR-122). Só
 * regras puras: a forma canônica que a assinatura cobre, os prazos e a escolha da máquina. A fila, a cripto e a ponte
 * ficam nos adapters.
 */

/** definido em 2026-10-22 (ADR-122): o supervisor recusa comando com mais de 2 min; a reserva da puxada é a mesma. */
export const PRAZO_COMANDO_MS = 120_000;
/** definido em 2026-10-22 (ADR-122, risco 6): do pedido até a máquina pronta. Conta depois de acordar (NOD-92). */
export const TETO_PRONTO_MS = 60_000;
/** definido em 2026-10-22: o motor relata o estado a cada 15 s; sem relato há 45 s (3 batimentos), o computador não conta como ligado. */
export const BATIMENTO_ESTADO_MS = 15_000;
export const ESTADO_VALIDO_MS = 3 * BATIMENTO_ESTADO_MS;
/** definido em 2026-10-22 (gancho da NOD-92): ação há menos de 15 min segura a máquina acordada. */
export const ACORDADA_APOS_ACAO_MS = 15 * 60_000;

/**
 * A forma canônica de um valor JSON: chaves em ordem, sem espaços, sem `undefined`. É o que a assinatura Ed25519 cobre
 * (o comando sem o campo `assinatura`); o supervisor refaz a mesma forma para conferir.
 */
export function formaCanonica(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : formaCanonica(x))).join(",")}]`;
  const o = v as Record<string, unknown>;
  const chaves = Object.keys(o).filter((k) => o[k] !== undefined).sort();
  return `{${chaves.map((k) => `${JSON.stringify(k)}:${formaCanonica(o[k])}`).join(",")}}`;
}

/** O que a assinatura cobre: o comando inteiro menos a própria assinatura. */
export function textoAssinado(c: Omit<ComandoComputador, "assinatura">): string {
  const { assinatura: _fora, ...resto } = c as ComandoComputador;
  return formaCanonica(resto);
}

/** Uma máquina conectada da pessoa, como o despachante a vê. */
export type MaquinaCandidata = {
  machineId: string;
  plataforma: PlataformaMaquina;
  /** Ausente = o motor não anuncia o computador (versão antiga, Mac). */
  computador: EstadoAnuncioComputador | null;
  ultimoContato: number;
};

/**
 * Onde o computador roda (ADR-122, item 6): `maquinaId` (a escolha da pessoa, NOD-94), senão `hospedeiraId` (onde o
 * disco está), senão a única máquina Linux que anuncia `computador: pronto`, senão a máquina padrão da pessoa, senão a
 * de contato mais recente. Nunca a máquina do turno. As duas primeiras valem mesmo sem contato: o disco é daquela
 * máquina, e quem chama diz "sem contato" em vez de ligar outra. null = nenhuma máquina conectada serve.
 */
export function escolherMaquina(p: { maquinaId: string | null; hospedeiraId: string | null; padraoId: string | null; conectadas: readonly MaquinaCandidata[] }): string | null {
  if (p.maquinaId) return p.maquinaId;
  if (p.hospedeiraId) return p.hospedeiraId;
  const linux = p.conectadas.filter((m) => m.plataforma === "linux" && m.computador !== null);
  const prontas = linux.filter((m) => m.computador === "pronto");
  if (prontas.length === 1) return prontas[0]!.machineId;
  const padrao = p.padraoId ? prontas.find((m) => m.machineId === p.padraoId) : undefined;
  if (padrao) return padrao.machineId;
  const recente = (l: readonly MaquinaCandidata[]) => [...l].sort((a, b) => b.ultimoContato - a.ultimoContato)[0]?.machineId ?? null;
  // Sem nenhuma pronta, a que anuncia o computador (faltam pacotes, sem suporte): quem chama devolve o motivo dela.
  return recente(prontas) ?? recente(linux);
}

/**
 * Gancho da NOD-92: a máquina gerenciada não dorme enquanto o computador dela tem tela abrindo, aberta ou esperando, ou
 * teve ação há menos de 15 min.
 */
export function motivoParaFicarAcordada(estados: readonly Pick<EstadoComputadorRelatado, "telas">[], ultimaAcaoEm: number | null, agora: number): boolean {
  if (ultimaAcaoEm !== null && agora - ultimaAcaoEm < ACORDADA_APOS_ACAO_MS) return true;
  return estados.some((e) => e.telas.some((t) => t.estado === "abrindo" || t.estado === "aberta" || t.estado === "esperando" || (t.ultimaAcaoEm !== null && agora - t.ultimaAcaoEm < ACORDADA_APOS_ACAO_MS)));
}
