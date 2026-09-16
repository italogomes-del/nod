/** Transporte atrás de interface de 4 campos + JITTER (ADR-016). Stub da v1. */
export type LiveEvents = {
  connect: () => void;
  disconnect: () => void;
  subscribe: (fn: (ev: unknown) => void) => () => void;
  send: (cmd: unknown) => void;
};
