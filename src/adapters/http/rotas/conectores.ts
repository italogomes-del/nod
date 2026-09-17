import { APPS_MARKETPLACE } from "../../../contracts/marketplace.ts";
import { atualizarCredenciaisConector } from "../../../use-cases/atualizar-credenciais-conector.ts";
import type { SensibilidadeDeclarada, TransporteConector } from "../../../contracts/conector.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { habilitarConector } from "../../../use-cases/habilitar-conector.ts";
import { conectorPublico, registrarConector } from "../../../use-cases/registrar-conector.ts";
import { sondarConector } from "../../../use-cases/sondar-conector.ts";
import type { Rota } from "../roteador.ts";
import { executar, type DentroDeTx } from "./dentro-de-tx.ts";

export type DepsRotasConectores = {
  dentro: DentroDeTx;
  /** Cifra o env do conector com a chave do servidor (NOD_CREDENTIAL_KEY via src/db/cifra.ts, composto pela L9). */
  cifrar: (texto: string) => string;
};

type CorpoConector = {
  nome?: unknown;
  slug?: unknown;
  transporte?: unknown;
  comando?: unknown;
  args?: unknown;
  url?: unknown;
  env?: unknown;
  declaracao?: unknown;
};

/**
 * Rotas finas de conectores (tabela ROTAS, lane L5): listar, registrar (nasce desabilitado), sondar,
 * habilitar, desabilitar. A web recebe `Conector` (env só com chaves → true); nada cifrado sai.
 */
export function rotasConectores(deps: DepsRotasConectores): Rota[] {
  return [
    {
      metodo: "PATCH", padrao: /^\/conectores\/(?<id>[^/]+)\/credenciais$/,
      async handler(ctx) {
        const c = await ctx.corpo() as { env?: unknown } | null;
        if (!c || typeof c !== "object") throw new ErroDeDominio("entrada_invalida");
        const conector = await deps.dentro(ctx.escopo, (d) => executar(d, atualizarCredenciaisConector, { conectorId: ctx.params.id ?? "", env: c.env, cifrar: deps.cifrar }));
        ctx.json(200, { conector });
      },
    },
    {
      metodo: "GET",
      padrao: /^\/conectores$/,
      async handler(ctx) {
        const conectores = await deps.dentro(ctx.escopo, async (d) => (await d.repos.conectores.listar()).map(conectorPublico));
        const composioConfigurado = await deps.dentro(ctx.escopo, async (d) => !!(await d.repos.composio.chave()));
        ctx.json(200, { conectores, marketplace: APPS_MARKETPLACE, composioConfigurado });
      },
    },
    {
      metodo: "POST",
      padrao: /^\/conectores$/,
      async handler(ctx) {
        const c = (await ctx.corpo()) as CorpoConector;
        if (typeof c !== "object" || c === null) throw new ErroDeDominio("entrada_invalida");
        const conector = await deps.dentro(ctx.escopo, (d) =>
          executar(d, registrarConector, {
            nome: typeof c.nome === "string" ? c.nome : "",
            slug: typeof c.slug === "string" ? c.slug : "",
            transporte: c.transporte as TransporteConector,
            comando: typeof c.comando === "string" ? c.comando : null,
            args: Array.isArray(c.args) ? (c.args as string[]) : [],
            url: typeof c.url === "string" ? c.url : null,
            env: typeof c.env === "object" && c.env !== null ? (c.env as Record<string, string | true>) : {},
            declaracao: (typeof c.declaracao === "string" ? c.declaracao : undefined) as SensibilidadeDeclarada | undefined,
            cifrar: deps.cifrar,
          }),
        );
        ctx.json(201, { ok: true, ids: { conector: conector.id }, conector });
      },
    },
    {
      metodo: "POST",
      padrao: /^\/conectores\/(?<id>[^/]+)\/sondar$/,
      async handler(ctx) {
        const r = await deps.dentro(ctx.escopo, (d) => executar(d, sondarConector, { conectorId: ctx.params.id ?? "" }));
        ctx.json(200, { ok: r.ok, ids: { conector: r.conector.id }, conector: r.conector });
      },
    },
    {
      metodo: "POST",
      padrao: /^\/conectores\/(?<id>[^/]+)\/habilitar$/,
      async handler(ctx) {
        const conector = await deps.dentro(ctx.escopo, (d) => executar(d, habilitarConector, { conectorId: ctx.params.id ?? "", habilitado: true }));
        ctx.json(200, { ok: true, ids: { conector: conector.id }, conector });
      },
    },
    {
      metodo: "POST",
      padrao: /^\/conectores\/(?<id>[^/]+)\/desabilitar$/,
      async handler(ctx) {
        const conector = await deps.dentro(ctx.escopo, (d) => executar(d, habilitarConector, { conectorId: ctx.params.id ?? "", habilitado: false }));
        ctx.json(200, { ok: true, ids: { conector: conector.id }, conector });
      },
    },
  ];
}
