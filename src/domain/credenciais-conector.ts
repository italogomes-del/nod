import type { TransporteConector } from "../contracts/conector.ts";
import { ErroDeDominio } from "./erro.ts";

/** definido em 2026-09-17: credenciais stdio são env; HTTP recebe apenas os headers explicitamente cadastrados. */
export function validarCredenciais(env: unknown, transporte: TransporteConector): Record<string, string> {
  if (typeof env !== "object" || env === null || Array.isArray(env)) throw new ErroDeDominio("entrada_invalida");
  const legivel: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === true) throw new ErroDeDominio("env_placeholder_chave_nova");
    const chaveValida = transporte === "stdio" ? /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) : /^[A-Za-z][A-Za-z0-9_-]*$/.test(k);
    if (typeof v !== "string" || !chaveValida || (transporte === "http" && (/[\r\n]/.test(v) || ["host", "content-length", "connection", "transfer-encoding", "mcp-session-id", "mcp-protocol-version", "content-type", "accept"].includes(k.toLowerCase())))) throw new ErroDeDominio("entrada_invalida");
    legivel[k] = v;
  }
  return legivel;
}
