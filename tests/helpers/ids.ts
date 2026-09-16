import { idDeterministico } from "../../src/db/seed/id-deterministico.ts";

// Só ids de IDENTIDADE (EMENDA 9). Agentes/salas/conversas de teste são criados pelo próprio
// teste dentro do withRollback com randomUUID — nunca dependem do seed.
export const TENANT_LEAPY = idDeterministico("tenant:leapy");
export const PESSOA_MARLON = idDeterministico("pessoa:marlon");
export const PESSOA_ANA = idDeterministico("pessoa:ana");
