import type { Rota } from "../roteador.ts";

export const rotaSaude: Rota = {
  metodo: "GET",
  padrao: /^\/saude$/,
  publica: true,
  async handler(ctx) {
    ctx.json(200, { ok: true });
  },
};
