import type { Server } from "node:net";
export const ID_VALIDO: RegExp;
export const TIPOS: readonly string[];
export const PRAZO_ABRIR_TELA_MS: number;
export const PRAZO_ACAO_MS: number;
export const BATIMENTO_MS: number;
export const DISPLAY_BASE: number;
export function memoriaDaArvore(pid: number | undefined): number | null;
export function binariosDoAmbiente(env?: Record<string, string | undefined>): Record<string, string | null>;
export function chromiumDoPlaywright(env?: Record<string, string | undefined>): string;
export function destinoDoResolv(arquivo?: string): string;
export type Supervisor = {
  tratar(cmd: unknown): Promise<{ id: string; desfecho: "ok" | "falhou" | "esperando_tela"; motivo?: string; quem?: string[]; resultado?: Record<string, unknown>; progresso?: unknown }>;
  carregar(): Promise<void>;
  estados(): Array<{ computadorId: string; ligado: boolean; supervisorPub: string; telas: Array<{ agenteId: string; estado: string; ultimaAcaoEm: number | null; memoriaMb: number | null }> }>;
  ouvir(f: (m: unknown) => void): () => void;
  assentar(): Promise<void>;
  encerrar(): Promise<void>;
};
export function criarSupervisor(op: {
  raiz?: string; run?: string; terminal?: string; resolv?: string | null; x11?: string; bin?: Record<string, string | null>; sandbox?: boolean; xvfbArgs?: string[];
  /** O tela.mjs a rodar (padrão: NOD_PC_TELA ou o do lado do supervisor). */
  tela?: string; ambienteTela?: Record<string, string>; leitura?: () => { memoria: unknown; processador: unknown }; agora?: () => number; log?: (m: string) => void; batimentoMs?: number;
}): Supervisor;
export function servirControle(s: Supervisor): Server;
export function escutarControle(servidor: Server, caminho: string): Promise<void>;
