import type { Inventario } from "../../contracts/inventario.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import type { EventoStream, ResultadoTurno, SinaisTurno } from "../../contracts/turno.ts";

/**
 * SPI de três camadas (ADR-012): UM Driver com campo `locality`, nunca duas implementações.
 * O executor recebe o PLANO e os SINKS e devolve o resultado; quem grava é o servidor (ADR-018).
 * Nesta rodada há dois drivers no mesmo SPI: claude-cli (real) e catcher (default de dev/CI).
 */
export type IdDriver = "claude-cli" | "codex-cli" | "cursor-cli" | "hermes" | "catcher";

export type Localidade = "local" | "servidor" | "ambos";

export type ConfigDriver = {
  /** Caminho do binário; ausente = resolver no PATH aumentado (ADR-014). */
  bin?: string;
  bins?: Partial<Record<IdDriver, string>>;
  /** Ambiente já filtrado por montarAmbiente(regime, source) — o driver não lê process.env. */
  env: Record<string, string>;
  /** Base para o mkdtemp por turno (EMENDA 11): NOD_HOME/turnos. */
  cwdBase: string;
  /** Roteiro do catcher (marcadores → sequência de eventos); ignorado pelo claude-cli. */
  roteiro?: unknown;
};

/**
 * Sinks do turno (ADR-009): `sinal` é AWAITED antes do efeito que ele anuncia (promptSubmitted
 * antes de escrever no stdin); `evento`/`delta` alimentam renovação de lease e streaming.
 */
export type SinksTurno = {
  sinal(s: keyof SinaisTurno): Promise<void>;
  evento(e: EventoStream): void;
  delta(texto: string): void;
};

export interface Adapter {
  rodarTurno(sinks: SinksTurno): Promise<ResultadoTurno>;
  /** SIGTERM → 5s → SIGKILL. A sonda de 2026-09-16 mediu (s6.log): exit 143 em ~640ms, signal null, filho MCP morre junto. */
  interromper(): Promise<void>;
}

export interface Instance {
  sondar(): Promise<Inventario>;
  adapter(plano: PlanoTurno): Adapter;
  dispose(): Promise<void>;
}

export interface Driver {
  meta: { id: IdDriver; locality: Localidade };
  create(cfg: ConfigDriver): Promise<Instance>;
}

/** create() que falha vira sombra com motivo escrito, nunca derruba o servidor (ADR-012). */
export type RegistroDriver = { estado: "pronto"; driver: Driver; instance: Instance } | { estado: "sombra"; motivo: string };

export type Registry = Record<"claude-cli" | "catcher", RegistroDriver> & Partial<Record<IdDriver, RegistroDriver>>;
