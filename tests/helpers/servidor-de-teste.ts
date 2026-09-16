import type { DepsRoteador, Rota } from "../../src/adapters/http/roteador.ts";
import { listen } from "../../src/adapters/http/server.ts";

export type DepsServidorDeTeste = {
  autorizarTokenTurno?: DepsRoteador["autorizarTokenTurno"];
  segredoSessao?: string;
};

export type ServidorDeTeste = {
  url: string;
  close: () => Promise<void>;
  /** POST /api/sessao/entrar e devolve o cabeçalho cookie pronto para as rotas escopadas. */
  entrar(pessoa: "marlon" | "ana"): Promise<{ cookie: string; tenantId: string; pessoaId: string }>;
  /** fetch já com cookie e JSON; `base` é a URL escopada /api/t/:tenantId. */
  chamar(sessao: { cookie: string; tenantId: string }, metodo: string, caminho: string, corpo?: unknown): Promise<Response>;
};

/**
 * Servidor real em porta 0 (EMENDA 34) sobre o roteador da L1, recebendo as ROTAS e as DEPS da
 * lane que testa (EMENDA 7: este helper não é reescrito; a L9 cria servidor-completo.ts com
 * compor.ts). Sem banco por si: quem precisa de banco injeta nas rotas.
 */
export async function servidorDeTeste(rotas: Rota[], deps: DepsServidorDeTeste = {}): Promise<ServidorDeTeste> {
  const srv = await listen(0, "127.0.0.1", {
    rotas,
    segredoSessao: deps.segredoSessao ?? "segredo-de-teste",
    autorizarTokenTurno: deps.autorizarTokenTurno,
  });
  const url = `http://127.0.0.1:${srv.port}`;
  return {
    url,
    close: srv.close,
    async entrar(pessoa) {
      const r = await fetch(`${url}/api/sessao/entrar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pessoa }),
      });
      if (r.status !== 200) throw new Error(`entrar(${pessoa}) devolveu ${r.status}`);
      const escopo = (await r.json()) as { tenantId: string; pessoaId: string };
      const cookie = (r.headers.get("set-cookie") ?? "").split(";")[0] ?? "";
      return { cookie, ...escopo };
    },
    chamar(sessao, metodo, caminho, corpo) {
      return fetch(`${url}/api/t/${sessao.tenantId}/${caminho.replace(/^\//, "")}`, {
        method: metodo,
        headers: { cookie: sessao.cookie, "content-type": "application/json" },
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
      });
    },
  };
}
