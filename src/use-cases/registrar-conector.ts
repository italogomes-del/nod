import type { Conector, ConectorGuardado, SensibilidadeDeclarada, TransporteConector } from "../contracts/conector.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import type { CasoDeUso } from "./tipos.ts";

export type EntradaRegistrarConector = {
  nome: string;
  slug: string;
  transporte: TransporteConector;
  comando?: string | null;
  args?: string[];
  url?: string | null;
  /** `true` = placeholder "mantido" (write-only). Recusado para chave NOVA — e no registro toda chave é nova. */
  env?: Record<string, string | true>;
  /** Não declarou = TOCA dado de aprendiz (ADR-002, default fechado). */
  declaracao?: SensibilidadeDeclarada;
  /** Cifra o JSON do env com a chave do servidor (src/db/cifra.ts); injetada pela rota para o caso de uso não conhecer a chave. */
  cifrar: (texto: string) => string;
};

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const TRANSPORTES: readonly TransporteConector[] = ["stdio", "http"];
const DECLARACOES: readonly SensibilidadeDeclarada[] = ["toca", "nao-toca", "nao-declarou"];

/** O que sai para a web: sem `envCifrado`, `env` só com chaves → true (nada legível). */
export function conectorPublico(c: ConectorGuardado): Conector {
  const { envCifrado: _e, ...publico } = c;
  return publico;
}

/**
 * Registro de conector (ADR-013 conector-privado): nasce DESABILITADO (só a sonda habilita), env
 * cifrado no servidor (core-features §credencial), http com dado de aprendiz recusado
 * (`http_toca_aprendiz`: toca OU não declarou, porque não declarou = toca) e placeholder `true` em
 * chave nova recusado (`env_placeholder_chave_nova`). Os CHECKs do banco repetem a regra.
 */
export const registrarConector: CasoDeUso<EntradaRegistrarConector, Conector> = async (deps, input) => {
  if (typeof input.nome !== "string" || input.nome.trim() === "") throw new ErroDeDominio("entrada_invalida", { cause: "nome" });
  if (typeof input.slug !== "string" || !SLUG.test(input.slug)) throw new ErroDeDominio("entrada_invalida", { cause: "slug" });
  if (!TRANSPORTES.includes(input.transporte)) throw new ErroDeDominio("entrada_invalida", { cause: "transporte" });
  const declaracao = input.declaracao ?? "nao-declarou";
  if (!DECLARACOES.includes(declaracao)) throw new ErroDeDominio("entrada_invalida", { cause: "declaracao" });
  if (input.transporte === "stdio" && (typeof input.comando !== "string" || input.comando.trim() === "")) throw new ErroDeDominio("entrada_invalida", { cause: "stdio exige comando" });
  if (input.transporte === "http" && (typeof input.url !== "string" || !/^https?:\/\//.test(input.url))) throw new ErroDeDominio("entrada_invalida", { cause: "http exige url" });
  if (input.transporte === "http" && declaracao !== "nao-toca") throw new ErroDeDominio("http_toca_aprendiz");
  const args = input.args ?? [];
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) throw new ErroDeDominio("entrada_invalida", { cause: "args" });

  const env = input.env ?? {};
  if (typeof env !== "object" || env === null || Array.isArray(env)) throw new ErroDeDominio("entrada_invalida", { cause: "env" });
  const legivel: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === true) throw new ErroDeDominio("env_placeholder_chave_nova", { cause: k });
    if (typeof v !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) throw new ErroDeDominio("entrada_invalida", { cause: `env.${k}` });
    legivel[k] = v;
  }
  const envChaves = Object.keys(legivel).sort();
  const envCifrado = envChaves.length === 0 ? null : input.cifrar(JSON.stringify(legivel));

  const criado = await deps.repos.conectores.criar({
    nome: input.nome.trim(),
    slug: input.slug,
    transporte: input.transporte,
    comando: input.transporte === "stdio" ? (input.comando ?? "").trim() : null,
    args,
    url: input.transporte === "http" ? input.url : null,
    envCifrado,
    envChaves,
    declaracao,
  });
  if (!criado) throw new Error("conector não criado");
  return { data: conectorPublico(criado) };
};
