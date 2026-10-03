import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server } from "node:http";
import { desafioDe, PRAZO_PAREAMENTO_MS } from "../src/services/pareamento-maquina.ts";

/**
 * Pareamento pelo navegador (ADR-069, RFC 8252 "loopback" + PKCE da RFC 7636): o app abre uma porta
 * só em 127.0.0.1, manda o navegador ao nod com o desafio, recebe de volta um código de uso único e o
 * troca pela chave com o verificador, que nunca saiu deste processo. A chave não passa por URL nem
 * pelo histórico do navegador.
 */
export class FalhaPareamento extends Error {
  readonly codigo: "sem_resposta" | "recusado" | "servidor_fora";
  constructor(codigo: FalhaPareamento["codigo"]) { super(codigo); this.codigo = codigo; }
}

export type PedidoNoNavegador = { porta: number; estado: string; desafio: string; nome: string };

export function urlDePareamento(servidor: string, p: PedidoNoNavegador): string {
  const u = new URL("/", servidor);
  u.searchParams.set("parear-mac", "1");
  u.searchParams.set("porta", String(p.porta));
  u.searchParams.set("estado", p.estado);
  u.searchParams.set("desafio", p.desafio);
  u.searchParams.set("nome", p.nome.slice(0, 60));
  return u.toString();
}

const iguais = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const pagina = (titulo: string, texto: string) =>
  `<!doctype html><meta charset="utf-8"><title>nod</title><body style="font:16px -apple-system,sans-serif;max-width:420px;margin:80px auto;color:#23312a"><h1 style="font-size:24px">${titulo}</h1><p>${texto}</p></body>`;

export async function parearPeloNavegador(o: {
  servidor: string;
  nome: string;
  abrir(url: string): Promise<void>;
  fetchImpl?: typeof fetch;
  prazoMs?: number;
}): Promise<string> {
  const verificador = randomBytes(32).toString("base64url");
  const estado = randomBytes(24).toString("base64url");
  let servidorLocal: Server | null = null;
  const codigo = await new Promise<string>((resolver, rejeitar) => {
    const srv = createServer((req, res) => {
      const u = new URL(req.url ?? "/", "http://127.0.0.1");
      const c = u.searchParams.get("codigo") ?? "";
      if (req.method !== "GET" || u.pathname !== "/retorno" || !iguais(u.searchParams.get("estado") ?? "", estado) || !c) {
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" }).end(pagina("Pedido inválido", "Volte ao app do nod e clique em Entrar com Google de novo."));
        return;
      }
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(pagina("Pronto", "Este Mac está conectado ao nod. Pode fechar esta aba e voltar ao app."));
      resolver(c);
    });
    servidorLocal = srv;
    const limite = setTimeout(() => rejeitar(new FalhaPareamento("sem_resposta")), o.prazoMs ?? PRAZO_PAREAMENTO_MS);
    limite.unref();
    srv.on("error", () => rejeitar(new FalhaPareamento("sem_resposta")));
    srv.listen(0, "127.0.0.1", () => {
      const porta = (srv.address() as { port: number }).port;
      o.abrir(urlDePareamento(o.servidor, { porta, estado, desafio: desafioDe(verificador), nome: o.nome })).catch(() => rejeitar(new FalhaPareamento("sem_resposta")));
    });
  }).finally(() => { (servidorLocal as Server | null)?.close(); });

  let r: Response;
  try {
    r = await (o.fetchImpl ?? fetch)(new URL("/api/pareamento/trocar", o.servidor), {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ codigo, verificador }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch { throw new FalhaPareamento("servidor_fora"); }
  if (r.status === 400 || r.status === 403) throw new FalhaPareamento("recusado");
  if (!r.ok) throw new FalhaPareamento("servidor_fora");
  const { chave } = (await r.json()) as { chave?: unknown };
  if (typeof chave !== "string" || chave.length === 0 || chave.length > 1024) throw new FalhaPareamento("servidor_fora");
  return chave;
}
