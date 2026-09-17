import type { AnuncioMaquina, PonteInterna } from "../../contracts/ponte.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import { versaoAceita } from "../../domain/versao-app.ts";

export class FalhaPonte extends Error {
  readonly codigo: "servidor_fora" | "chave_invalida" | "atualize_app" | "reconectar" | "resposta_invalida";
  constructor(codigo: FalhaPonte["codigo"]) { super(codigo); this.codigo = codigo; }
}

/** definido em 2026-09-17: somente HTTPS; loopback HTTP só quando explicitamente habilitado em desenvolvimento. */
export function urlServidor(valor: unknown, desenvolvimento = false): string {
  if (typeof valor !== "string") throw new FalhaPonte("resposta_invalida");
  const u = new URL(valor);
  if (u.username || u.password || u.search || u.hash || u.pathname !== "/" || (u.protocol !== "https:" && !(desenvolvimento && u.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)))) throw new FalhaPonte("resposta_invalida");
  return u.origin;
}

export function criarPonteHttp(o: { url: string; chave: string; versao: string; fetchImpl?: typeof fetch; aoFalhar?: (codigo: FalhaPonte["codigo"]) => void }) {
  const f = o.fetchImpl ?? fetch;
  let anuncio: AnuncioMaquina | null = null;
  let delta = "";
  const ativos = new Set<AbortController>();
  async function chamar<T>(nome: string, corpo: unknown): Promise<T> {
    const ctrl = new AbortController(); ativos.add(ctrl);
    const timer = setTimeout(() => ctrl.abort(), 35_000);
    try {
      const r = await f(`${o.url}/api/maquina/${nome}`, { method: "POST", headers: { authorization: `Bearer ${o.chave}`, "content-type": "application/json", "x-nod-versao": o.versao }, body: JSON.stringify(corpo), signal: ctrl.signal, redirect: "error" });
      const minima = r.headers.get("x-nod-versao-minima");
      if (r.status === 426 || (minima && !versaoAceita(o.versao, minima))) throw new FalhaPonte("atualize_app");
      if (r.status === 401 || r.status === 403) throw new FalhaPonte("chave_invalida");
      if (r.status === 409) throw new FalhaPonte("reconectar");
      if (!r.ok) throw new FalhaPonte("servidor_fora");
      return await r.json() as T;
    } catch (e) {
      const erro = e instanceof FalhaPonte ? e : new FalhaPonte("servidor_fora");
      o.aoFalhar?.(erro.codigo);
      throw erro;
    } finally { clearTimeout(timer); ativos.delete(ctrl); }
  }
  const ponte: PonteInterna = {
    async conectar(m) { anuncio = m; await chamar("conectar", m); },
    async puxar() {
      try { return (await chamar<{ plano: PlanoTurno | null }>("puxar", {})).plano; }
      catch (e) {
        if (e instanceof FalhaPonte && e.codigo === "reconectar" && anuncio) await ponte.conectar(anuncio);
        throw e;
      }
    },
    async renovar(p) {
      const texto = delta; delta = "";
      try { return await chamar("renovar", { ...p, delta: texto }); }
      catch { return { ativo: false, versaoMinimaApp: o.versao }; }
    },
    async entregar(e) {
      for (let tentativa = 0; ; tentativa++) {
        try { await chamar("entregar", e); return; }
        catch (erro) {
          if (!(erro instanceof FalhaPonte) || erro.codigo !== "servidor_fora" || tentativa >= 2) throw erro;
          await new Promise((r) => setTimeout(r, 1_000));
        }
      }
    },
    async desconectar() { await chamar("desconectar", {}); },
  };
  return { ponte, delta(texto: string) { delta = (delta + texto).slice(-16_000); }, cancelar() { for (const c of ativos) c.abort(); } };
}
