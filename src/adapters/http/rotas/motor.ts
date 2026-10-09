import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Rota } from "../roteador.ts";
import { ARQUIVOS_DO_MOTOR, scriptDeInstalacao, servidorParaScript } from "../motor-instalacao.ts";

/**
 * ADR-090: o servidor distribui o motor da própria versão. `GET /api/motor/instalar` (e `/motor`, que redireciona para
 * cá) devolve o script com o endereço deste servidor; `GET /api/motor/arquivos/<nome>` devolve os três arquivos de
 * dist/motor. Públicas e sem segredo: o motor só vale depois do pareamento, que exige a pessoa logada aprovando o código.
 */
export function rotasMotor(o: { pasta: string; versao: string; urlPublica?: string }): Rota[] {
  return [
    {
      metodo: "GET",
      padrao: /^\/motor\/instalar$/,
      publica: true,
      async handler(ctx) {
        const h = ctx.req.headers;
        const proto = String(h["x-forwarded-proto"] ?? ("encrypted" in ctx.req.socket && ctx.req.socket.encrypted ? "https" : "http"));
        const servidor = o.urlPublica ?? servidorParaScript(proto, String(h["x-forwarded-host"] ?? h.host ?? ""));
        if (!servidor) { ctx.json(400, { codigo: "entrada_invalida", mensagem: "Abra este endereço pelo HTTPS do seu Nod." }); return; }
        ctx.res.writeHead(200, { "content-type": "text/x-shellscript; charset=utf-8", "cache-control": "no-store" });
        ctx.res.end(scriptDeInstalacao({ servidor, versao: o.versao }));
      },
    },
    {
      metodo: "GET",
      padrao: /^\/motor\/arquivos\/(?<nome>[^/]+)$/,
      publica: true,
      async handler(ctx) {
        const nome = ARQUIVOS_DO_MOTOR.find((a) => a === ctx.params.nome);
        if (!nome) { ctx.json(404, { codigo: "nao_encontrado" }); return; }
        let corpo: Buffer;
        try { corpo = await readFile(join(o.pasta, nome)); }
        catch { ctx.json(404, { codigo: "nao_encontrado", mensagem: "Este servidor não tem o motor empacotado (npm run motor:build)." }); return; }
        ctx.res.writeHead(200, { "content-type": "text/javascript; charset=utf-8", "cache-control": "no-store" });
        ctx.res.end(corpo);
      },
    },
  ];
}
