import type { Workspaces } from "../../fundo/workspaces.ts";
import type { Rota } from "../roteador.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";

export function rotasWorkspaces(w?: Workspaces): Rota[] {
  return [
    { metodo: "GET", padrao: /^\/conversas\/(?<id>[^/]+)\/workspace$/, async handler(c) { c.json(200, { disponivel: Boolean(w), vinculo: w ? await w.consultar(c.escopo, c.params.id!) : null }); } },
    { metodo: "POST", padrao: /^\/conversas\/(?<id>[^/]+)\/workspace\/pastas$/, async handler(c) {
      if (!w) throw new ErroDeDominio("nao_permitido");
      const b = await c.corpo() as { caminho?: unknown };
      if (b?.caminho !== undefined && typeof b.caminho !== "string") throw new ErroDeDominio("entrada_invalida");
      c.json(200, await w.listar(c.escopo, c.params.id!, b?.caminho));
    } },
    { metodo: "POST", padrao: /^\/conversas\/(?<id>[^/]+)\/workspace$/, async handler(c) {
      if (!w) throw new ErroDeDominio("nao_permitido");
      const b = await c.corpo() as { pasta?: unknown };
      if (typeof b?.pasta !== "string") throw new ErroDeDominio("entrada_invalida");
      c.json(200, await w.escolher(c.escopo, c.params.id!, b.pasta));
    } },
    { metodo: "DELETE", padrao: /^\/conversas\/(?<id>[^/]+)\/workspace$/, async handler(c) { if (!w) throw new ErroDeDominio("nao_permitido"); await w.revogar(c.escopo, c.params.id!); c.json(200, { ok: true }); } },
  ];
}
