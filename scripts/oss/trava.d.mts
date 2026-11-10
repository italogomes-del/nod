// Tipos de scripts/oss/trava.mjs (NOD-485).
import type { Manifesto } from "./exportar.mjs";
export const ROTULO: string;
export function decidir(o: { arquivos: string[]; manifesto: Manifesto; pr?: number; rotulos?: string[] }): { liberado: boolean; motivo: string; publicos: string[] };
export function arquivosMudados(repo: string, base: string, head?: string): string[];
export function manifestoEm(repo: string, ref: string): Manifesto;
