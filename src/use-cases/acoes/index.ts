import { EXECUTORES_BOTS } from "./bots.ts";
import { EXECUTORES_CONVERSA } from "./conversa.ts";
import { EXECUTORES_QUADRO } from "./quadro.ts";
import { EXECUTORES_TIMES } from "./times.ts";

/** A união das tabelas id → executor único (ADR-135): o teste dos executores compara as chaves com as ações `vivo`. */
export const EXECUTORES = { ...EXECUTORES_BOTS, ...EXECUTORES_QUADRO, ...EXECUTORES_CONVERSA, ...EXECUTORES_TIMES } as const;
