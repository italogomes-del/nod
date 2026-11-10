// Tipos de scripts/oss/varrer.mjs (NOD-485).
export function arquivosDe(dir: string, ref?: string): Map<string, { conteudo: Buffer; modo: string }>;
export function varrer(
  dir: string,
  o?: { ref?: string; manifestoPath?: string; gitleaks?: boolean },
): { total: number; proibidos: { arquivo: string; linha: number; motivo: string; trecho: string }[]; gitleaks: { arquivo: string; linha: number; regra: string }[]; limpo: boolean };
