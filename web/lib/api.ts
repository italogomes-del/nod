import type { Snapshot } from "../estado/reducer.ts";

async function parse(res: Response): Promise<Snapshot> {
  const body = await res.json();
  if (!res.ok) throw new Error(body.erro ?? res.statusText);
  return (body.snapshot ?? body) as Snapshot;
}

export const api = {
  async frota(): Promise<Snapshot> {
    return parse(await fetch("/api/frota"));
  },
  async criarAgente(): Promise<Snapshot> {
    const res = await fetch("/api/agentes", { method: "POST" });
    const body = await res.json();
    if (!res.ok) throw new Error(body.erro ?? res.statusText);
    return body.snapshot as Snapshot;
  },
  async enviar(agenteId: string, texto: string): Promise<Snapshot> {
    return parse(
      await fetch(`/api/agentes/${encodeURIComponent(agenteId)}/mensagens`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ texto }),
      }),
    );
  },
  async confirmar(
    agenteId: string,
    propostaId: string,
    extra?: { declaracao?: string; capacidadesLigadas?: string[] },
  ): Promise<Snapshot> {
    return parse(
      await fetch(`/api/agentes/${encodeURIComponent(agenteId)}/propostas/${encodeURIComponent(propostaId)}/confirmar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(extra ?? {}),
      }),
    );
  },
  async recusar(agenteId: string, propostaId: string): Promise<Snapshot> {
    return parse(
      await fetch(`/api/agentes/${encodeURIComponent(agenteId)}/propostas/${encodeURIComponent(propostaId)}/recusar`, {
        method: "POST",
      }),
    );
  },
};
