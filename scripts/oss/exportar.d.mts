// Tipos de scripts/oss/exportar.mjs (o script roda com node puro, sem tsx).
export interface Manifesto {
  versao: 1;
  repoPublico: string;
  raizPublica?: string;
  gitleaksConfig?: string;
  excluir: string[];
  imagensRevisadas?: string[];
  reescrever?: { arquivos?: string[]; de?: string; regex?: string; para: string; caixa?: "preservar" }[];
  packageJson?: { remover?: string[]; definir?: Record<string, unknown>; removerScripts?: string[] };
  proibidos?: { padrao?: string; regex?: string; flags?: string; motivo: string }[];
  aceitos?: { arquivos: string[]; proibido: string; porque: string }[];
}
export interface Entrada {
  caminho: string;
  modo: string;
  tipo: string;
  sha?: string;
  conteudo: Buffer;
}
export interface Arquivo {
  modo: string;
  conteudo: Buffer;
}
export interface Achado {
  arquivo: string;
  linha: number;
  motivo: string;
  trecho: string;
}
export interface Resultado {
  sha: string;
  dir: string;
  manifesto: Manifesto;
  arquivos: Map<string, Arquivo>;
  hash: string;
  total: number;
  excluidos: number;
  avisos: string[];
  proibidos: Achado[];
  gitleaks: { arquivo: string; linha: number; regra: string }[] | null;
  pendencias: string[];
}
export const TITULAR_PENDENTE: string;
export function validarManifesto(m: unknown): Manifesto;
export function listarRef(repo: string, ref: string): { caminho: string; modo: string; tipo: string; sha: string }[];
export function lerBlobs(repo: string, shas: string[]): Map<string, Buffer>;
export function comACaixaDe(original: string, para: string): string;
export function ehBinario(buf: Buffer): boolean;
export function planejarExport(
  entradas: Entrada[],
  manifesto: Manifesto,
  extras?: { caminho: string; modo?: string; conteudo: Buffer }[],
): { arquivos: Map<string, Arquivo>; excluidos: string[]; avisos: string[] };
export function reescreverPackageJson(
  json: Record<string, unknown>,
  regras: NonNullable<Manifesto["packageJson"]>,
  excluidos: string[],
): { json: Record<string, unknown> & { scripts?: Record<string, string> }; removidos: string[] };
export function varrerProibidos(arquivos: Map<string, Arquivo>, manifesto: Manifesto): Achado[];
export function rodarGitleaks(dir: string, config?: string): { arquivo: string; linha: number; regra: string }[] | null;
export function gravarSnapshot(dir: string, arquivos: Map<string, Arquivo>): void;
export function hashDoSnapshot(arquivos: Map<string, Arquivo>): string;
export function exportar(o?: { repo?: string; ref?: string; manifestoPath?: string; saida?: string; gitleaks?: boolean }): Resultado;
export function limpo(r: Resultado): boolean;
export function publicar(r: Resultado, o?: { repoPedido?: string; repo?: string; remoto?: string }): string;
