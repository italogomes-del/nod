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
  /**
   * Sessão viva (definido em 2026-10-01, ADR-067): a fala de uma volta do modelo que NÃO encerra o turno — há comando
   * em segundo plano ou mensagem nova. O laço a manda ao servidor, que a grava na conversa na hora.
   */
  falaIntermediaria?(texto: string): void;
  /**
   * Sessão viva: o modelo respondeu e nada roda em segundo plano. O laço pergunta ao servidor se chegou mensagem nova
   * da pessoa e a entrega por `receberMensagem` antes de responder. `true` = chegou, a sessão segue; `false` = pode
   * fechar, e daqui em diante o servidor não absorve mais nada para este turno.
   */
  ocioso?(): Promise<boolean>;
};

export interface Adapter {
  rodarTurno(sinks: SinksTurno): Promise<ResultadoTurno>;
  /** SIGTERM → 5s → SIGKILL. A sonda de 2026-09-16 mediu (s6.log): exit 143 em ~640ms, signal null, filho MCP morre junto. */
  interromper(): Promise<void>;
  /**
   * Sessão viva (ADR-067): uma mensagem nova da pessoa entra no meio do trabalho, como no Claude Code. `false` = este
   * adapter não tem sessão viva ou ela já fechou a entrada; o laço então não pede mensagens ao servidor.
   */
  receberMensagem?(texto: string): boolean;
  /** true enquanto o adapter aceita mensagem nova (sessão viva com a entrada aberta). */
  aceitaMensagens?(): boolean;
}

/** O veredito do teste de verdade de uma IA e o que ela respondeu (null quando não ficou pronta). */
export type TesteDoMotor = { inventario: Inventario; resposta: string | null };

export interface Instance {
  sondar(): Promise<Inventario>;
  /**
   * definido em 2026-10-05 (emenda da ADR-019): o TESTE de verdade — um turno de uma frase com `pergunta`, pago pela
   * assinatura da pessoa. `sondar()` pode ser só a conferência do login (o app do Mac); isto é o que prova que a conta
   * responde. Ausente no catcher.
   */
  testar?(pergunta: string): Promise<TesteDoMotor>;
  /**
   * NOD-167: este motor, já pronto, roda o laço de voz da ligação? false = não roda (o Codex sem `app-server`); null =
   * não deu para saber agora (sonda lenta). Ausente = o motor não tem esse piso (o Claude Code).
   */
  lacoDeVoz?(): Promise<boolean | null>;
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
