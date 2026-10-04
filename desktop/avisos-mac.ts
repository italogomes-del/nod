import { LIMITES_AVISO, type AlvoAviso, type AvisoDesktop, type PreferenciasDesktop, type TemaDesktop } from "../src/contracts/desktop.ts";

/**
 * O que o processo principal aceita da janela web (definido em 2026-09-24, "aviso no Mac"). A janela
 * carrega uma página REMOTA (o servidor do time): cada argumento que chega por IPC é validado aqui e
 * copiado para um objeto novo — nada da página vai direto ao macOS. Sem Electron: testável no vitest
 * (tests/unit/desktop/avisos-mac.test.ts).
 */

/** A origem de uma URL ("https://nod.acme.com.br"); URL inválida ou opaca → null. */
export function origemDe(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const origem = new URL(url).origin;
    return origem === "null" ? null : origem;
  } catch {
    return null;
  }
}

/** O frame que chamou é o principal e está na origem do servidor configurado. */
export function remetenteWebValido(r: { frameUrl: string | null | undefined; frameDeTopo: boolean; servidor: string | null | undefined }): boolean {
  const servidor = origemDe(r.servidor);
  return r.frameDeTopo && servidor !== null && origemDe(r.frameUrl) === servidor;
}

const ID = /^[\w-]+$/;

function texto(v: unknown, max: number, vazio: boolean): string | null {
  if (typeof v !== "string" || v.length > max || (!vazio && v.trim() === "")) return null;
  return v;
}

function id(v: unknown): string | null {
  return typeof v === "string" && v.length <= LIMITES_AVISO.id && ID.test(v) ? v : null;
}

function lerAlvo(v: unknown): AlvoAviso | null {
  if (typeof v !== "object" || v === null || !("tipo" in v)) return null;
  if (v.tipo === "sua-vez") return { tipo: "sua-vez" };
  if (v.tipo !== "conversa" || !("conversaId" in v) || !("agenteId" in v)) return null;
  const conversaId = id(v.conversaId);
  const agenteId = id(v.agenteId);
  return conversaId && agenteId ? { tipo: "conversa", conversaId, agenteId } : null;
}

/** O aviso redigido pela web, ou null se algo não confere (título vazio, texto longo, alvo estranho). */
export function lerAviso(dados: unknown): AvisoDesktop | null {
  if (typeof dados !== "object" || dados === null || !("titulo" in dados) || !("corpo" in dados) || !("alvo" in dados)) return null;
  const titulo = texto(dados.titulo, LIMITES_AVISO.titulo, false);
  const corpo = texto(dados.corpo, LIMITES_AVISO.corpo, true);
  const alvo = lerAlvo(dados.alvo);
  return titulo !== null && corpo !== null && alvo ? { titulo, corpo, alvo } : null;
}

/** O número do Dock: inteiro de 0 a 9999; qualquer outra coisa → null. */
export function lerContador(n: unknown): number | null {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? Math.min(n, LIMITES_AVISO.contador) : null;
}

/** O tema que a página pede (ou que está no arquivo): só os três valores; qualquer outra coisa → null. */
export function lerTemaDesktop(valor: unknown): TemaDesktop | null {
  return valor === "sistema" || valor === "claro" || valor === "escuro" ? valor : null;
}

/** preferencias.json: sem arquivo, corrompido ou sem o campo, os avisos nascem ligados e o tema segue o sistema. */
export function lerPreferencias(conteudo: string | null): Pick<PreferenciasDesktop, "avisos" | "tema"> {
  let lido: unknown = null;
  try {
    lido = conteudo === null ? null : JSON.parse(conteudo);
  } catch {
    // arquivo corrompido: volta ao padrão
  }
  const obj = typeof lido === "object" && lido !== null ? lido : {};
  return {
    avisos: "avisos" in obj && typeof obj.avisos === "boolean" ? obj.avisos : true,
    tema: ("tema" in obj ? lerTemaDesktop(obj.tema) : null) ?? "sistema",
  };
}
