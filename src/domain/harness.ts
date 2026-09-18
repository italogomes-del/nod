import { HARNESSES } from "../contracts/harness.ts";
import type { IdHarness, PreferenciaHarness } from "../contracts/harness.ts";
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

export function resolverHarness(p: { harness?: PreferenciaHarness; modelo: string; prontos: readonly IdHarness[]; preferido?: IdHarness | null }): { harness: IdHarness; modelo: string } {
  const pedido = p.harness ?? "auto";
  validarInteligencia(pedido, p.modelo);
  const fixo = pedido !== "auto" ? pedido : p.modelo !== "auto" ? "claude-cli" : null;
  const escolhido = fixo ?? (p.preferido && p.prontos.includes(p.preferido) ? p.preferido : HARNESSES.find((h) => p.prontos.includes(h.id))?.id);
  if (!escolhido || !p.prontos.includes(escolhido)) throw new ErroDeDominio("executor_indisponivel");
  return { harness: escolhido, modelo: p.modelo === "auto" ? (escolhido === "claude-cli" ? "sonnet" : "gpt-5.6-sol") : p.modelo };
}
