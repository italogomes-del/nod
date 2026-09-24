import { describe, expect, it } from "vitest";
import { CAPACIDADES_GITHUB } from "../../../src/contracts/github.ts";
import { ArgumentoGithubInvalido, escolherJeitoGithub, validarArgsGithub, validarRepositorio } from "../../../src/domain/github.ts";

describe("escolha do jeito de conectar o GitHub (ADR-047)", () => {
  it("na máquina da pessoa, o gh logado ganha de tudo", () => {
    expect(escolherJeitoGithub("maquina_da_pessoa", { gh: true, token: true, composio: true, app: true })).toEqual({ ok: true, jeito: "gh" });
  });

  it("na máquina sem gh: token, depois Composio — e o App da organização nunca é usado ali", () => {
    expect(escolherJeitoGithub("maquina_da_pessoa", { gh: false, token: true, composio: true })).toEqual({ ok: true, jeito: "token" });
    expect(escolherJeitoGithub("maquina_da_pessoa", { composio: true, app: true })).toEqual({ ok: true, jeito: "composio" });
    const nada = escolherJeitoGithub("maquina_da_pessoa", { app: true });
    expect(nada.ok).toBe(false);
    if (!nada.ok) expect(nada.frase).toContain("gh auth login");
  });

  it("no servidor: App → Composio → token, e NUNCA o gh, mesmo logado", () => {
    expect(escolherJeitoGithub("servidor", { gh: true, token: true, composio: true, app: true })).toEqual({ ok: true, jeito: "app" });
    expect(escolherJeitoGithub("servidor", { gh: true, token: true, composio: true })).toEqual({ ok: true, jeito: "composio" });
    expect(escolherJeitoGithub("servidor", { gh: true, token: true })).toEqual({ ok: true, jeito: "token" });
    const soGh = escolherJeitoGithub("servidor", { gh: true });
    expect(soGh.ok).toBe(false);
    if (!soGh.ok) expect(soGh.frase).toContain("para rotinas noturnas, conecte o GitHub da organização");
  });
});

describe("argumentos do conector github", () => {
  it("aceita dono/nome e tira o .git", () => {
    expect(validarRepositorio("leapy/nod")).toEqual({ dono: "leapy", repo: "nod" });
    expect(validarRepositorio("marlonwlv/nod.git")).toEqual({ dono: "marlonwlv", repo: "nod" });
  });

  it.each(["foo/bar;rm -rf ~", "--repo=x", "--repo=x/y", "foo", "a/b/c", "-x/y", "foo/..", "foo/ bar", "foo/bar$(id)", "foo/`id`", "", "foo/bar\nbaz"])("recusa repositório %j antes de qualquer processo", (r) => {
    expect(() => validarRepositorio(r)).toThrow(ArgumentoGithubInvalido);
  });

  it("número só inteiro positivo; string, fração e negativo caem", () => {
    for (const n of ["466", 1.5, -1, 0, Number.NaN, 1e12]) expect(() => validarArgsGithub("pr_ver", { repositorio: "leapy/nod", numero: n })).toThrow(ArgumentoGithubInvalido);
    expect(validarArgsGithub("pr_ver", { repositorio: "leapy/nod", numero: 466 })).toEqual({ capacidade: "pr_ver", alvo: { dono: "leapy", repo: "nod" }, numero: 466 });
  });

  it("arquivo_ler recusa .. no caminho e ref que parece opção", () => {
    expect(validarArgsGithub("arquivo_ler", { repositorio: "leapy/nod", caminho: "/src/index.ts", ref: "feat/x" })).toMatchObject({ caminho: "src/index.ts", ref: "feat/x" });
    expect(() => validarArgsGithub("arquivo_ler", { repositorio: "leapy/nod", caminho: "../../etc/passwd" })).toThrow(ArgumentoGithubInvalido);
    expect(() => validarArgsGithub("arquivo_ler", { repositorio: "leapy/nod", caminho: "a", ref: "--output=x" })).toThrow(ArgumentoGithubInvalido);
    expect(() => validarArgsGithub("arquivo_ler", { repositorio: "leapy/nod", caminho: "a", ref: "main..dev" })).toThrow(ArgumentoGithubInvalido);
  });

  it("pr_revisar: approve aceita sem texto; comment e request_changes exigem; evento fora da lista cai", () => {
    expect(validarArgsGithub("pr_revisar", { repositorio: "leapy/nod", numero: 1, evento: "approve" })).toMatchObject({ evento: "approve", texto: null });
    expect(() => validarArgsGithub("pr_revisar", { repositorio: "leapy/nod", numero: 1, evento: "comment" })).toThrow(ArgumentoGithubInvalido);
    expect(() => validarArgsGithub("pr_revisar", { repositorio: "leapy/nod", numero: 1, evento: "merge", texto: "x" })).toThrow(ArgumentoGithubInvalido);
  });

  it("os nomes são estáveis e só as duas escritas não são readOnly", () => {
    expect(CAPACIDADES_GITHUB.map((c) => c.nome)).toEqual(["pr_ver", "pr_diff", "pr_arquivos", "pr_comentarios", "pr_checks", "arquivo_ler", "issue_ver", "pr_comentar", "pr_revisar"]);
    expect(CAPACIDADES_GITHUB.filter((c) => !c.readOnlyHint).map((c) => c.nome)).toEqual(["pr_comentar", "pr_revisar"]);
  });
});
