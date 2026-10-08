import { CAPACIDADES_HARNESS, HARNESSES, SEM_CAPACIDADES } from "../contracts/harness.ts";
import type { CapacidadesHarness, CatalogoHarness, IdHarness, PreferenciaHarness } from "../contracts/harness.ts";
import type { Inventario } from "../contracts/inventario.ts";
import { MODELO_MAIS_POTENTE } from "../contracts/modelos.ts";
import { ErroDeDominio } from "./erro.ts";

export function validarInteligencia(harness: unknown, modelo: unknown): asserts harness is PreferenciaHarness {
  if (typeof modelo !== "string" || !modelo.trim() || modelo.length > 160 || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/.test(modelo)) throw new ErroDeDominio("entrada_invalida");
  if (harness === "auto") {
    if (modelo === "auto") return;
    // definido em 2026-09-18: modelos anteriores à seleção de harness continuam vinculados ao Claude.
    if (["sonnet", "haiku", "opus"].includes(modelo) || modelo.startsWith("claude-")) return;
    throw new ErroDeDominio("entrada_invalida");
  }
  const opcao = HARNESSES.find((h) => h.id === harness && h.integrado);
  if (!opcao) throw new ErroDeDominio("entrada_invalida");
  if (modelo === "auto" || opcao.modelos.some((m) => m.id === modelo) || (harness === "claude-cli" && modelo.startsWith("claude-"))) return;
  throw new ErroDeDominio("entrada_invalida");
}

/**
 * NOD-171: a causa do `executor_indisponivel` que `resolverHarness` lança. Diz qual harness faltou, para a negação
 * usar o inventário DELE e nunca o do motor. `modelo_invalido` = o agente gravou um modelo que o harness não aceita:
 * vira recusa escrita no despacho, em vez de um `entrada_invalida` que desfazia a reivindicação a cada puxar.
 * `inventario` é anexado por quem conhece o inventário de cada harness (emitir-plano-turno).
 */
export type CausaHarnessIndisponivel = { harness: IdHarness; modelo?: string; motivo?: "modelo_invalido"; inventario?: Inventario };

export function causaHarnessIndisponivel(e: unknown): CausaHarnessIndisponivel | null {
  if (!(e instanceof ErroDeDominio) || e.codigo !== "executor_indisponivel") return null;
  const c = e.cause as Partial<CausaHarnessIndisponivel> | undefined;
  return c && typeof c === "object" && typeof c.harness === "string" ? (c as CausaHarnessIndisponivel) : null;
}

/** O harness em que o turno está fixado; null = `auto`/`auto`, que vai para qualquer harness pronto. */
export function harnessFixado(harness: string | undefined, modelo: string): IdHarness | null {
  const pedido = harness ?? "auto";
  return pedido !== "auto" ? (pedido as IdHarness) : modelo !== "auto" ? "claude-cli" : null;
}

export function resolverHarness(p: { harness?: PreferenciaHarness; modelo: string; prontos: readonly IdHarness[]; preferido?: IdHarness | null }): { harness: IdHarness; modelo: string } {
  const pedido = p.harness ?? "auto";
  const fixo = harnessFixado(pedido, p.modelo);
  try {
    validarInteligencia(pedido, p.modelo);
  } catch (e) {
    if (e instanceof ErroDeDominio && e.codigo === "entrada_invalida") {
      throw new ErroDeDominio("executor_indisponivel", { cause: { harness: fixo ?? "claude-cli", modelo: p.modelo, motivo: "modelo_invalido" } satisfies CausaHarnessIndisponivel });
    }
    throw e;
  }
  const escolhido = fixo ?? (p.preferido && p.prontos.includes(p.preferido) ? p.preferido : HARNESSES.find((h) => p.prontos.includes(h.id))?.id);
  if (!escolhido || !p.prontos.includes(escolhido)) throw new ErroDeDominio("executor_indisponivel", { cause: escolhido ? ({ harness: escolhido } satisfies CausaHarnessIndisponivel) : undefined });
  return { harness: escolhido, modelo: p.modelo === "auto" ? (escolhido === "claude-cli" ? "sonnet" : "gpt-5.6-sol") : p.modelo };
}

/** O modelo mais potente do harness (MODELO_MAIS_POTENTE); null para harness ainda sem catálogo. */
export function modeloMaisPotente(harness: IdHarness): string | null {
  return harness === "claude-cli" || harness === "codex-cli" ? MODELO_MAIS_POTENTE[harness] : null;
}

const SEM_SONDA_DO_HARNESS = "não está pronto em nenhum computador conectado";

/** Nenhuma máquina viva da pessoa anunciou este harness: não se sabe se falta instalar, logar ou atualizar. */
export function inventarioHarnessSemSonda(agora: number): Inventario {
  return { estado: "ausente", motivo: SEM_SONDA_DO_HARNESS, em: agora };
}

/**
 * NOD-171: o motivo da negação de harness indisponível, sempre do harness ESCOLHIDO e com o estado DELE, em pt-BR.
 * Nunca "motor pronto": um harness pronto só chega aqui se outra regra o recusou, e então diz só que está indisponível.
 * Sem sonda do harness não afirma "não instalado": diz só que nenhum computador conectado o tem pronto.
 */
export function motivoHarnessIndisponivel(harness: string, inventario: Inventario, modeloInvalido?: string): string {
  const nome = HARNESSES.find((h) => h.id === harness)?.nome ?? harness;
  if (modeloInvalido !== undefined) return `${nome}: o modelo ${modeloInvalido} não é aceito; escolha outro modelo no agente`;
  if (inventario.estado === "pronto") return `${nome} indisponível`;
  if (inventario.estado === "ausente" && inventario.motivo === SEM_SONDA_DO_HARNESS) return `${nome} ${SEM_SONDA_DO_HARNESS}`;
  const estado = inventario.estado === "nao_autenticado" ? "sem conta conectada"
    : inventario.causa === "cli_antigo" ? "desatualizado"
    : inventario.causa === "sonda_lenta" ? "sem resposta"
    : "não instalado";
  return `${nome} ${estado}: ${inventario.motivo}`;
}

/**
 * NOD-171: a IA que o GET executor do modo compartilhado chama de "atual". Sem nenhuma pronta, a que está no Mac
 * (desatualizada ou sem login) vence um Claude ausente: senão o rodapé diria "não foi encontrada" com o Codex instalado
 * e só desatualizado.
 */
export function iaAtualDoCatalogo(catalogo: CatalogoHarness): IdHarness {
  const noMac = catalogo.opcoes.find((h) => h.integrado && ((h.inventario.estado === "ausente" && h.inventario.causa === "cli_antigo") || h.inventario.estado === "nao_autenticado"));
  return catalogo.padrao ?? noMac?.id ?? "claude-cli";
}

/**
 * definido em 2026-10-07 (ADR-081): o que o harness sabe fazer. Toda diferença entre harnesses fora do driver passa
 * por aqui; harness desconhecido (ou ausente) não tem nenhuma capacidade.
 */
export function capacidadesDe(harness: string | null | undefined): CapacidadesHarness {
  if (!harness || !Object.hasOwn(CAPACIDADES_HARNESS, harness)) return SEM_CAPACIDADES;
  return CAPACIDADES_HARNESS[harness as IdHarness];
}
