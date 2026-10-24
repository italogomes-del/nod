import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { anuncioDaVm } from "../../../desktop/vm-local/ligar.ts";
import { criarPreparador, type Agendar, type DepsPreparador } from "../../../desktop/vm-local/preparador.ts";
import { baixarDisco, nomeDoDisco } from "../../../desktop/vm-local/download.ts";
import { anuncioVmLocal } from "../../../src/adapters/http/rotas/ponte-validacao.ts";
import type { VmLocalAnunciada } from "../../../src/contracts/vm-local.ts";
import { anuncioDaFase } from "../../../src/domain/preparo-vm-local.ts";

/** NOD-93 (passo 9): o preparador da VM local, o anúncio `vmLocal` (1/s) e a validação no servidor. */
const GIB = 1024 ** 3;
const DISCO = Buffer.from("disco-falso-do-nod");
const SHA = createHash("sha256").update(DISCO).digest("hex");
const nome = nomeDoDisco("1.0.0", "arm64");

let cache: string;
beforeEach(async () => { cache = await mkdtemp(join(tmpdir(), "nod-prep-")); });
afterEach(async () => { await rm(cache, { recursive: true, force: true }); });

function cenario(o: Partial<DepsPreparador> = {}) {
  let agora = 1_000;
  const anuncios: VmLocalAnunciada[] = [];
  const agendados: Array<{ fn: () => void; em: number; vivo: boolean }> = [];
  const agendar: Agendar = (fn, ms) => { const a = { fn, em: agora + ms, vivo: true }; agendados.push(a); return { cancelar: () => { a.vivo = false; } }; };
  const paradas: number[] = [];
  const p = criarPreparador({
    versao: "1.0.0", arch: "arm64", macos: "14.5", cache, origem: { urlBase: "https://x/v1.0.0", sha256: SHA },
    modo: () => "equilibrado", ramBytes: 16 * GIB, livreBytes: () => 8 * GIB, cpus: 4,
    parar: async () => { paradas.push(agora); }, aoMudar: (v) => anuncios.push(v), agora: () => agora, agendar,
    baixar: async (r) => {
      r.aoProgresso?.({ recebidos: 5, total: DISCO.length });
      r.aoProgresso?.({ recebidos: 10, total: DISCO.length });
      r.aoProgresso?.({ recebidos: DISCO.length, total: DISCO.length });
      await writeFile(r.destino, DISCO);
      return { tipo: "baixou", bytes: DISCO.length, retomou: false };
    },
    ...o,
  });
  const esperar = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5)); };
  const rodar = (ms: number) => { agora += ms; for (const a of agendados) if (a.vivo && a.em <= agora) { a.vivo = false; a.fn(); } };
  return { p, anuncios, esperar, rodar, paradas };
}

describe("desktop/vm-local/preparador.ts (NOD-93)", () => {
  it("baixa conferindo o sha256 embutido e chega a pronto; o pedido leva a memória do modo", async () => {
    let pedido: { url: string; sha256: string } | null = null;
    const { p, anuncios, esperar } = cenario({ baixar: async (r) => { pedido = r; await writeFile(r.destino, DISCO); return { tipo: "baixou", bytes: DISCO.length, retomou: false }; } });
    await p.iniciar();
    await esperar();
    expect(p.fase().tipo).toBe("pronto");
    expect(pedido).toMatchObject({ url: `https://x/v1.0.0/${nome}`, sha256: SHA });
    expect(p.pedido()).toEqual({ imagem: join(cache, nome), versao: "1.0.0", arch: "arm64", memoriaGiB: 3, cpus: 4 });
    expect(anuncios.map((a) => a.estado)).toEqual(expect.arrayContaining(["baixando", "pronto"]));
  });

  it("throttle: o progresso no mesmo segundo sai uma vez e o último valor vem no fim do segundo", async () => {
    const { p, anuncios, esperar, rodar } = cenario({
      baixar: async (r) => { r.aoProgresso?.({ recebidos: 1, total: 10 }); r.aoProgresso?.({ recebidos: 7, total: 10 }); await new Promise(() => undefined); return { tipo: "falhou", motivo: "nunca" }; },
    });
    await p.iniciar();
    await esperar();
    const baixando = anuncios.filter((a) => a.estado === "baixando");
    expect(baixando).toHaveLength(1);
    rodar(1_000);
    expect(anuncios.at(-1)).toMatchObject({ estado: "baixando", bytes: 7, total: 10 });
  });

  it("abre offline com o disco no cache conferindo com o sha embutido: não baixa de novo", async () => {
    await writeFile(join(cache, nome), DISCO);
    let baixou = false;
    const { p, esperar } = cenario({ fetch: (async () => { throw new Error("offline"); }) as typeof fetch, baixar: async () => { baixou = true; return { tipo: "sem_internet", motivo: "x" }; } });
    await p.iniciar();
    await esperar();
    expect(baixou).toBe(false);
    expect(p.fase().tipo).toBe("pronto");
  });

  it("sem rede: pausado_sem_internet", async () => {
    const { p, esperar } = cenario({ fetch: (async () => { throw new Error("offline"); }) as typeof fetch, baixar: baixarDisco });
    await p.iniciar();
    await esperar();
    expect(p.fase().tipo).toBe("pausado_sem_internet");
  });

  it.each([403, 404])("HTTP %i no disco: falhou com o motivo, sem backoff (não é sem internet)", async (status) => {
    const { p, esperar, rodar } = cenario({ fetch: (async () => new Response("", { status })) as typeof fetch, baixar: baixarDisco });
    await p.iniciar();
    await esperar();
    const fase = p.fase();
    expect(fase.tipo).toBe("falhou");
    expect(fase.tipo === "falhou" && fase.motivo).toContain(String(status));
    rodar(10 * 60_000);
    await esperar();
    expect(p.fase().tipo).toBe("falhou");
  });

  it("HTTP 503 no disco é passageiro: pausado_sem_internet", async () => {
    const { p, esperar } = cenario({ fetch: (async () => new Response("", { status: 503 })) as typeof fetch, baixar: baixarDisco });
    await p.iniciar();
    await esperar();
    expect(p.fase().tipo).toBe("pausado_sem_internet");
  });

  it("macOS 12: macos_antigo, sem baixar, e o anúncio do computador vira sem_suporte", async () => {
    let baixou = false;
    const { p, anuncios, esperar } = cenario({ macos: "12.7", baixar: async () => { baixou = true; return { tipo: "falhou", motivo: "x" }; } });
    await p.iniciar();
    await esperar();
    expect(baixou).toBe(false);
    expect(anuncios.at(-1)?.estado).toBe("macos_antigo");
    expect(anuncioDaVm(anuncios.at(-1)!).computador).toEqual({ estado: "sem_suporte" });
    expect(anuncioDaVm({ estado: "baixando", desde: 1 }).computador).toEqual({ estado: "pronto" });
  });
});

describe("anúncio vmLocal (NOD-93)", () => {
  it("anuncioDaFase: bytes/total só no download, motivo só em falhou", () => {
    expect(anuncioDaFase({ tipo: "baixando", recebidos: 870, total: 1100 }, 5)).toEqual({ estado: "baixando", bytes: 870, total: 1100, desde: 5 });
    expect(anuncioDaFase({ tipo: "baixando", recebidos: 1, total: null }, 5)).toEqual({ estado: "baixando", bytes: 1, desde: 5 });
    expect(anuncioDaFase({ tipo: "falhou", motivo: "sha" }, 5)).toEqual({ estado: "falhou", motivo: "sha", desde: 5 });
    expect(anuncioDaFase({ tipo: "pronto", semTelaDesde: null }, 5)).toEqual({ estado: "pronto", desde: 5 });
  });

  it("anuncioVmLocal: aceita o válido e recusa estado fora da lista, números ruins; motivo com quebra de linha sai fora", () => {
    expect(anuncioVmLocal({ estado: "baixando", bytes: 1, total: 2, desde: 3 })).toEqual({ estado: "baixando", bytes: 1, total: 2, desde: 3 });
    expect(anuncioVmLocal(undefined)).toBeUndefined();
    expect(anuncioVmLocal({ estado: "voando", desde: 1 })).toBeUndefined();
    expect(anuncioVmLocal({ estado: "pronto", desde: -1 })).toBeUndefined();
    expect(anuncioVmLocal({ estado: "pronto", desde: 1.5 })).toBeUndefined();
    expect(anuncioVmLocal({ estado: "falhou", motivo: "a\nb", desde: 1 })).toEqual({ estado: "falhou", desde: 1 });
  });
});
