import { describe, expect, it } from "vitest";
import { catalogoDoPiso, mesclarCatalogo } from "../../../src/domain/catalogo-marketplace.ts";
import { CATEGORIA_PADRAO, DESCRICAO_PADRAO } from "../../../src/contracts/marketplace.ts";

describe("catálogo do marketplace (ADR-041)", () => {
  it("quem diz o que existe é o provedor: app curado e ausente lá não aparece (o nativo, sim)", () => {
    const apps = mesclarCatalogo([{ slug: "slack", nome: "Slack", logo: null }]);
    expect(apps.map((a) => a.slug)).toEqual(["slack", "github"]);
  });

  it("o GitHub é nativo (ADR-048): aparece sem auth config no Composio e não duplica quando há", () => {
    expect(mesclarCatalogo([]).map((a) => a.slug)).toEqual(["github"]);
    const comComposio = mesclarCatalogo([{ slug: "github", nome: "Github", logo: "https://logos.composio.dev/github.png" }]);
    expect(comComposio).toEqual([expect.objectContaining({ slug: "github", nome: "GitHub", logo: "https://logos.composio.dev/github.png" })]);
  });

  it("a curadoria dá nome e descrição em português ao que o provedor entrega cru", () => {
    const app = mesclarCatalogo([{ slug: "sentry", nome: "Sentry", logo: "https://logos.composio.dev/sentry.png" }]).find((a) => a.slug === "sentry");
    expect(app).toMatchObject({
      nome: "Sentry",
      categoria: "Desenvolvimento",
      logo: "https://logos.composio.dev/sentry.png",
    });
    expect(app!.descricao).toContain("erros em produção");
  });

  it("app sem curadoria aparece com o nome do provedor e a descrição padrão", () => {
    const app = mesclarCatalogo([{ slug: "hubspot", nome: "Hubspot", logo: null }]).find((a) => a.slug === "hubspot");
    expect(app).toEqual({
      slug: "hubspot",
      nome: "Hubspot",
      descricao: DESCRICAO_PADRAO,
      categoria: CATEGORIA_PADRAO,
      logo: null,
    });
  });

  it("app novo entra no fim da grade, não no meio do dia a dia", () => {
    const apps = mesclarCatalogo([
      { slug: "zendesk", nome: "Zendesk", logo: null },
      { slug: "gmail", nome: "Gmail", logo: null },
      { slug: "airtable", nome: "Airtable", logo: null },
      { slug: "slack", nome: "Slack", logo: null },
    ]);
    expect(apps.map((a) => a.slug)).toEqual(["slack", "github", "gmail", "airtable", "zendesk"]);
  });

  it("o piso é a curadoria inteira, sem logo: grade velha é melhor que grade vazia", () => {
    const piso = catalogoDoPiso();
    expect(piso.length).toBeGreaterThanOrEqual(12);
    expect(piso.every((a) => a.logo === null)).toBe(true);
    expect(piso.map((a) => a.slug)).toContain("supabase");
  });
});
