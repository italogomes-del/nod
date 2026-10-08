import { describe, expect, it, vi } from "vitest";
import type { NodDesktop, PreferenciasDesktop } from "../../../src/contracts/desktop.ts";
import { canalMac } from "../../../web/lib/canal-avisos-mac.ts";

/**
 * O som dos avisos no canal do Mac (NOD-196, web/lib/canal-avisos-mac.ts; o do navegador não tem som): o canal só expõe som()/alternarSom() quando a ponte tem definirSom (app
 * antigo não tem); alternar chama definirSom(!atual) e aplica as preferências que voltam; falha da ponte não quebra nada.
 */
const PADRAO: PreferenciasDesktop = { avisos: true, tema: "sistema", som: true, bloqueados: false };

function ponte(p: { prefs?: Partial<PreferenciasDesktop>; definirSom?: NodDesktop["definirSom"] } = {}): NodDesktop & { chamadas: boolean[] } {
  let atual: PreferenciasDesktop = { ...PADRAO, ...p.prefs };
  const chamadas: boolean[] = [];
  const base: NodDesktop & { chamadas: boolean[] } = {
    chamadas,
    avisar: async () => true,
    contador: async () => undefined,
    preferencias: async () => atual,
    definirAvisos: async (ligado) => (atual = { ...atual, avisos: ligado }),
    aoAbrir: () => undefined,
  };
  if (p.definirSom) base.definirSom = p.definirSom;
  else if (!("definirSom" in p)) {
    base.definirSom = async (ligado) => {
      chamadas.push(ligado);
      return (atual = { ...atual, som: ligado });
    };
  }
  return base;
}

function canal(mac: NodDesktop) {
  const aoMudar = vi.fn();
  return { canal: canalMac(mac, () => undefined, aoMudar), aoMudar };
}

const esperarMicrotarefas = () => new Promise((r) => setTimeout(r, 0));

describe("canal de avisos: som (NOD-196)", () => {
  it("ponte sem definirSom (app antigo): o canal não expõe o som", async () => {
    const { canal: c } = canal(ponte({ definirSom: undefined }));
    await esperarMicrotarefas();
    expect(c.som).toBeUndefined();
    expect(c.alternarSom).toBeUndefined();
    expect(c.estado()).toEqual({ onde: "mac", situacao: "ligados" });
  });

  it("lê o som da ponte e avisa a página quando ele muda", async () => {
    const mac = ponte({ prefs: { som: false } });
    const { canal: c, aoMudar } = canal(mac);
    expect(c.som?.()).toBe(true); // antes de a ponte responder, o padrão
    await esperarMicrotarefas();
    expect(c.som?.()).toBe(false);
    expect(aoMudar).toHaveBeenCalledTimes(1);
  });

  it("alternarSom chama definirSom(!atual) e aplica as preferências que voltam", async () => {
    const mac = ponte();
    const { canal: c, aoMudar } = canal(mac);
    await esperarMicrotarefas();
    aoMudar.mockClear();
    await c.alternarSom?.();
    expect(mac.chamadas).toEqual([false]);
    expect(c.som?.()).toBe(false);
    expect(aoMudar).toHaveBeenCalledTimes(1);
    await c.alternarSom?.();
    expect(mac.chamadas).toEqual([false, true]);
    expect(c.som?.()).toBe(true);
    // O som não mexe nos avisos.
    expect(c.ligado()).toBe(true);
  });

  it("com os avisos desligados, o som continua alternável e guardado", async () => {
    const mac = ponte({ prefs: { avisos: false } });
    const { canal: c } = canal(mac);
    await esperarMicrotarefas();
    await c.alternarSom?.();
    expect(c.som?.()).toBe(false);
    expect(c.estado().situacao).toBe("desligados");
  });

  it("falha da ponte não quebra o canal: o estado fica como estava", async () => {
    const mac = ponte({ definirSom: () => Promise.reject(new Error("ipc caiu")) });
    const { canal: c, aoMudar } = canal(mac);
    await esperarMicrotarefas();
    aoMudar.mockClear();
    await expect(c.alternarSom?.()).resolves.toBeUndefined();
    expect(c.som?.()).toBe(true);
    expect(aoMudar).not.toHaveBeenCalled();
    expect(c.ligado()).toBe(true);
  });
});

describe("canal de avisos: app antigo (NOD-196)", () => {
  it("preferências sem `som` não disparam aoMudar nem mudam os avisos", async () => {
    const antigo = ponte({ definirSom: undefined });
    antigo.preferencias = async () => ({ avisos: true, tema: "sistema", bloqueados: false }) as unknown as PreferenciasDesktop;
    const { canal: c, aoMudar } = canal(antigo);
    await esperarMicrotarefas();
    expect(aoMudar).not.toHaveBeenCalled();
    expect(c.ligado()).toBe(true);
  });
});
