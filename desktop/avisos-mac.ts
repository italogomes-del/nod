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
  // NOD-114: o pedido nascido numa task abre a task (ADR-083); o id passa pela mesma régua.
  if (v.tipo === "trabalho") {
    const trabalhoId = "trabalhoId" in v ? id(v.trabalhoId) : null;
    const agenteId = "agenteId" in v ? id(v.agenteId) : null;
    const conversaId = "conversaId" in v ? id(v.conversaId) : null;
    return trabalhoId && agenteId && conversaId ? { tipo: "trabalho", trabalhoId, agenteId, conversaId } : null;
  }
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
  // NOD-114: o grupo (o bot) é opcional; presente, passa pela régua do id — fora dela, o aviso inteiro é recusado.
  const grupo = "grupo" in dados && dados.grupo !== undefined ? id(dados.grupo) : undefined;
  if (titulo === null || corpo === null || !alvo || grupo === null) return null;
  return grupo ? { titulo, corpo, alvo, grupo } : { titulo, corpo, alvo };
}

/** O número do Dock: inteiro de 0 a 9999; qualquer outra coisa → null. */
export function lerContador(n: unknown): number | null {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? Math.min(n, LIMITES_AVISO.contador) : null;
}

/** O tema que a página pede (ou que está no arquivo): só os três valores; qualquer outra coisa → null. */
export function lerTemaDesktop(valor: unknown): TemaDesktop | null {
  return valor === "sistema" || valor === "claro" || valor === "escuro" ? valor : null;
}

/**
 * preferencias.json: sem arquivo, corrompido ou sem o campo, os avisos e o som (NOD-196) nascem ligados e o tema segue
 * o sistema.
 */
export function lerPreferencias(conteudo: string | null): Pick<PreferenciasDesktop, "avisos" | "tema" | "som"> {
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
    som: "som" in obj && typeof obj.som === "boolean" ? obj.som : true,
  };
}

/** O agrupamento dos avisos no Centro de Notificações: o grupo do nod; com bot (NOD-114), um grupo por bot dentro dele. */
export const GRUPO_AVISOS = "nod-sua-vez";

export function grupoDoAviso(aviso: Pick<AvisoDesktop, "grupo">): string {
  return aviso.grupo ? `${GRUPO_AVISOS}:${aviso.grupo}` : GRUPO_AVISOS;
}

/**
 * As opções do `new Notification` do Electron para um aviso (NOD-196). Som desligado → `silent: true`: o aviso aparece
 * igual (banner, clique, Dock), só sem som. Som ligado → `silent: false`, que só deixa o macOS tocar o som padrão; o Foco
 * e os Ajustes do Sistema continuam mandando.
 */
export function opcoesDoAviso(aviso: AvisoDesktop, p: { som: boolean }): { title: string; body: string; groupId: string; silent: boolean } {
  return { title: aviso.titulo, body: aviso.corpo, groupId: grupoDoAviso(aviso), silent: !p.som };
}
