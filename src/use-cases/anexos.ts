import type { AnexoMeta } from "../contracts/anexo.ts";
import { ehMimeAnexo, nomeSeguro, recusaDoArquivo } from "../domain/anexo.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import type { AnexoGuardado } from "../repositories/anexos.repo.ts";
import type { CasoDeUso } from "./tipos.ts";

export type EntradaReceberAnexo = { conversaId: string; nome: string; mime: string; conteudo: Uint8Array };

/**
 * Upload (ADR-045): o arquivo nasce SOLTO na conversa e só vira parte de uma mensagem no envio. Tipo e
 * tamanho são conferidos aqui e de novo pelos CHECKs da 0021 — o navegador valida antes só por
 * conforto. Conversa que a pessoa não enxerga é nao_encontrado (RLS), como em qualquer rota.
 */
export const receberAnexo: CasoDeUso<EntradaReceberAnexo, AnexoMeta> = async (deps, input) => {
  const mime = input.mime.split(";")[0]?.trim().toLowerCase() ?? "";
  const recusa = recusaDoArquivo(mime, input.conteudo.byteLength);
  if (recusa || !ehMimeAnexo(mime)) throw new ErroDeDominio("entrada_invalida", { cause: `anexo: ${recusa ?? "tipo"}` });
  const conversa = await deps.repos.conversas.buscar(input.conversaId);
  if (!conversa) throw new ErroDeDominio("nao_encontrado", { cause: "conversa" });
  const a = await deps.repos.anexos.criar({ conversaId: conversa.id, nome: nomeSeguro(input.nome), mime, conteudo: input.conteudo });
  if (!a) throw new ErroDeDominio("nao_permitido");
  return { data: { id: a.id, nome: a.nome, mime: a.mime, tamanho: a.tamanho } };
};

/** Bytes para a tela (miniatura, abrir o PDF). Só de anexo desta conversa: o id sozinho não basta. */
export const lerAnexo: CasoDeUso<{ conversaId: string; anexoId: string }, { meta: AnexoGuardado; bytes: Buffer }> = async (deps, input) => {
  const r = await deps.repos.anexos.conteudo(input.anexoId);
  if (!r || r.meta.conversaId !== input.conversaId) throw new ErroDeDominio("nao_encontrado", { cause: "anexo" });
  return { data: r };
};
