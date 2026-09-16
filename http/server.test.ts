import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { listen } from "./server.ts";

describe("http api — jornada Meus agentes", () => {
  let close: () => Promise<void>;
  let base: string;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "nod-"));
    process.env.NOD_DATA_DIR = dir;
    process.env.NOD_CREDENTIAL_KEY = "0".repeat(64);
    const srv = await listen(0, "127.0.0.1");
    close = srv.close;
    base = `http://127.0.0.1:${srv.port}`;
  });

  afterAll(async () => {
    await close();
    await rm(dir, { recursive: true, force: true });
  });

  it("cria agente, define papel, rotina e conecta Notion", async () => {
    const created = await fetch(`${base}/api/agentes`, { method: "POST" }).then((r) => r.json());
    const agenteId = created.agente.id as string;
    expect(created.agente.nome).toBe("Novo Bot");

    let snap = await fetch(`${base}/api/agentes/${agenteId}/mensagens`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        texto: "Quero um agente que resuma páginas do Notion toda manhã.",
      }),
    }).then((r) => r.json());
    const papel = snap.mensagens.find((m: { kind: string }) => m.kind === "proposta-papel");
    expect(papel).toBeTruthy();

    snap = await fetch(`${base}/api/agentes/${agenteId}/propostas/${papel.id}/confirmar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }).then((r) => r.json());
    expect(snap.agentes[0].confirmado).toBe(true);

    snap = await fetch(`${base}/api/agentes/${agenteId}/mensagens`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texto: "faz o resumo todo dia às 8h e me mostra antes de mandar" }),
    }).then((r) => r.json());
    const rotina = snap.mensagens.find((m: { kind: string }) => m.kind === "proposta-rotina");
    snap = await fetch(`${base}/api/agentes/${agenteId}/propostas/${rotina.id}/confirmar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    }).then((r) => r.json());
    expect(snap.rotinas[0].estado).toBe("ativa");
    expect(snap.rotinas[0].exigeAprovacao).toBe(true);
    expect(snap.rotinas[0].fusoIana).toBe("America/Sao_Paulo");

    snap = await fetch(`${base}/api/agentes/${agenteId}/mensagens`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ texto: "conecta com o Notion" }),
    }).then((r) => r.json());
    const notion = [...snap.mensagens]
      .reverse()
      .find((m: { kind: string; payload?: { conectorId?: string } }) => m.kind === "proposta-concessao" && m.payload?.conectorId === "notion");
    expect(notion).toBeTruthy();
    snap = await fetch(`${base}/api/agentes/${agenteId}/propostas/${notion.id}/confirmar`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ declaracao: "toca", capacidadesLigadas: ["ler-paginas"] }),
    }).then((r) => r.json());
    const conc = snap.concessoes.find((c: { conectorId: string }) => c.conectorId === "notion");
    expect(conc.estado).toBe("conectada");
    expect(conc.capacidadesLigadas).toEqual(["ler-paginas"]);
  });
});
