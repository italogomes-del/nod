import { describe, expect, it } from "vitest";
import type { FrotaDto } from "../../../src/contracts/api.ts";
import { frotaAoSoltar, ordemAoSoltar } from "../../../web/lib/arrastar.ts";

type Bot = FrotaDto["agentes"][number];
const bot = (id: string, criadoEm: number, extra: Partial<Bot> = {}): Bot => ({ id, ownerId: "p", nome: id, fixado: false, secao: "", posicao: null, criadoEm, ...extra }) as Bot;

describe("arrastar na barra lateral (canvas “Menu, sidebar e gaveta”)", () => {
  const frota = [
    bot("clarice", 1, { fixado: true, posicao: 0 }),
    bot("milton", 2, { fixado: true, posicao: 1 }),
    bot("nina", 3),
    bot("dev1", 4, { secao: "Devs" }),
    bot("dev2", 5, { secao: "Devs" }),
    bot("da-ana", 6, { ownerId: "ana", fixado: true }),
  ];

  it("soltar na grade põe o bot na posição e deixa de fora bot de outra pessoa", () => {
    expect(ordemAoSoltar(frota, "p", "dev1", { grupo: "fixados" }, 1)).toEqual(["clarice", "dev1", "milton"]);
    expect(ordemAoSoltar(frota, "p", "dev1", { grupo: "fixados" }, 99)).toEqual(["clarice", "milton", "dev1"]);
  });

  it("reordenar dentro do próprio grupo não conta o bot duas vezes", () => {
    expect(ordemAoSoltar(frota, "p", "milton", { grupo: "fixados" }, 0)).toEqual(["milton", "clarice"]);
  });

  it("a barra se reorganiza na hora: o bot muda de grupo e o grupo segue a ordem nova", () => {
    const ordem = ordemAoSoltar(frota, "p", "nina", { grupo: "secao", secao: "Devs" }, 1);
    expect(ordem).toEqual(["dev1", "nina", "dev2"]);
    const nova = frotaAoSoltar(frota, "nina", { grupo: "secao", secao: "Devs" }, ordem);
    expect(nova.filter((b) => !b.fixado && b.secao === "Devs").map((b) => b.id)).toEqual(["dev1", "nina", "dev2"]);
    expect(nova.find((b) => b.id === "nina")).toMatchObject({ fixado: false, secao: "Devs", posicao: 1 });
  });

  it("tirar da grade para uma seção desafixa; fixar mantém a seção guardada", () => {
    const desafixado = frotaAoSoltar(frota, "clarice", { grupo: "secao", secao: "" }, ["nina", "clarice"]);
    expect(desafixado.find((b) => b.id === "clarice")).toMatchObject({ fixado: false, secao: "", posicao: 1 });
    const fixado = frotaAoSoltar(frota, "dev2", { grupo: "fixados" }, ["dev2", "clarice", "milton"]);
    expect(fixado.filter((b) => b.fixado && b.ownerId === "p").map((b) => b.id)).toEqual(["dev2", "clarice", "milton"]);
    expect(fixado.find((b) => b.id === "dev2")?.secao).toBe("Devs");
  });
});
