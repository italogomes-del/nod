/**
 * Anexo de mensagem (ADR-046): arquivo que a pessoa manda na conversa para o MODELO ler naquele turno.
 * Não vai para o computador do bot nem para a pasta autorizada. Os bytes ficam no servidor; o plano
 * leva só estes metadados e o driver baixa o conteúdo pela rota interna com o token do turno.
 */

/** definido em 2026-09-24: 10 MB por arquivo, 5 por mensagem — cabe folgado no limite de imagem/PDF da API. */
export const TAMANHO_MAX_ANEXO = 10 * 1024 * 1024;
export const ANEXOS_POR_MENSAGEM = 5;

export const MIMES_IMAGEM = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export const MIMES_TEXTO = ["text/plain", "text/markdown", "text/csv", "application/json"] as const;
export const MIME_PDF = "application/pdf";
export const MIMES_ANEXO = [...MIMES_IMAGEM, MIME_PDF, ...MIMES_TEXTO] as const;

export type MimeAnexo = (typeof MIMES_ANEXO)[number];
export type TipoAnexo = "imagem" | "pdf" | "texto";

export type AnexoMeta = {
  id: string;
  nome: string;
  mime: MimeAnexo;
  tamanho: number;
};
