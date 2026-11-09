// Tipos de scripts/oss/seguir-readme.mjs (roda com node puro, sem tsx).
export interface Passo {
  readonly nome: string;
  readonly comandos: string[];
}
export interface Roteiro {
  readonly preparar: string[];
  readonly subir: string[];
  readonly conferir: string[];
  readonly trocas: string[];
}
export const URL_PUBLICA: string;
export const ORDEM: readonly string[];
export function extrairPassos(texto: string): Passo[];
export function montarRoteiro(
  passos: Passo[],
  o: { origem: string; banco: "docker" | "proprio"; temMise: boolean; portaApi: number; portaPg: number },
): Roteiro;
export function ambienteLimpo(
  pai: Record<string, string | undefined>,
  o: { portaApi: number; portaWeb: number; portaPg: number; nodHome: string; projetoCompose?: string },
): Record<string, string | undefined>;
export function aspas(s: string): string;
export function prepararPasta(pasta: string): string;
export function exigirPortaLivre(porta: number): Promise<undefined>;
export function conferirUmaVez(comandos: string[], env: NodeJS.ProcessEnv, prazoMs: number): { ok: boolean; saida: string };
export function encerrarGrupo(filho: import("node:child_process").ChildProcess | undefined, prazoMs: number): Promise<void>;
