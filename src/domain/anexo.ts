import { ANEXOS_POR_MENSAGEM, MIME_PDF, MIMES_ANEXO, MIMES_IMAGEM, TAMANHO_MAX_ANEXO, type MimeAnexo, type TipoAnexo } from "../contracts/anexo.ts";
import type { IdHarness } from "../contracts/harness.ts";

export function ehMimeAnexo(mime: string): mime is MimeAnexo {
  return (MIMES_ANEXO as readonly string[]).includes(mime);
}

export function tipoDoAnexo(mime: MimeAnexo): TipoAnexo {
  if ((MIMES_IMAGEM as readonly string[]).includes(mime)) return "imagem";
  if (mime === MIME_PDF) return "pdf";
  return "texto";
}

/**
 * O que cada motor lê como conteúdo (definido em 2026-09-24). Claude: imagem e PDF viram blocos da
 * mensagem (medido no dia com `claude -p --input-format stream-json`: leu PNG e PDF certo). Codex:
 * `codex exec --image` só aceita imagem; PDF fica de fora. Texto vira texto da mensagem nos dois.
 * Motor fora da lista não lê anexo nenhum.
 */
const LE: Partial<Record<IdHarness, readonly TipoAnexo[]>> = {
  "claude-cli": ["imagem", "pdf", "texto"],
  "codex-cli": ["imagem", "texto"],
};

export function motorLe(harness: IdHarness, tipo: TipoAnexo): boolean {
  return LE[harness]?.includes(tipo) ?? false;
}

/** Nome vindo do navegador: sem caminho, sem controle, curto. Vazio vira "arquivo". */
export function nomeSeguro(nome: string): string {
  const base = nome.split(/[\\/]/).pop() ?? "";
  const limpo = [...base].filter((c) => { const n = c.charCodeAt(0); return n >= 32 && n !== 127; }).join("").trim().slice(0, 200);
  return limpo === "" ? "arquivo" : limpo;
}

export type RecusaAnexo = "tipo" | "tamanho" | "vazio";

export function recusaDoArquivo(mime: string, tamanho: number): RecusaAnexo | null {
  if (!ehMimeAnexo(mime)) return "tipo";
  if (tamanho <= 0) return "vazio";
  if (tamanho > TAMANHO_MAX_ANEXO) return "tamanho";
  return null;
}

export function excedeQuantidade(n: number): boolean {
  return n > ANEXOS_POR_MENSAGEM;
}

