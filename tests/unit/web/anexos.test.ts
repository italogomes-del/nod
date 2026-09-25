import { describe, expect, it } from "vitest";
import { ANEXOS_POR_MENSAGEM, MIME_PDF as MIME_PDF_SRC, MIMES_IMAGEM as IMAGEM_SRC, MIMES_TEXTO as TEXTO_SRC, TAMANHO_MAX_ANEXO } from "../../../src/contracts/anexo.ts";
import { MIME_PDF, MIMES_IMAGEM, MIMES_TEXTO, mimeDe, motivoRecusa, POR_MENSAGEM, renderAnexosDaMensagem, renderItens, resumo, TAMANHO_MAX } from "../../../web/lib/anexos.ts";
import { htmlComposer } from "../../../web/telas/conversa.ts";

describe("anexos na web (ADR-046)", () => {
  it("o espelho da web é igual ao contrato do servidor", () => {
    expect(TAMANHO_MAX).toBe(TAMANHO_MAX_ANEXO);
    expect(POR_MENSAGEM).toBe(ANEXOS_POR_MENSAGEM);
    expect([...MIMES_IMAGEM]).toEqual([...IMAGEM_SRC]);
    expect([...MIMES_TEXTO]).toEqual([...TEXTO_SRC]);
    expect(MIME_PDF).toBe(MIME_PDF_SRC);
  });

  it("tipo vazio do navegador cai na extensão; recusas dizem o porquê", () => {
    expect(mimeDe({ name: "notas.md", type: "" })).toBe("text/markdown");
    expect(mimeDe({ name: "x.bin", type: "application/octet-stream" })).toBe("application/octet-stream");
    expect(motivoRecusa({ name: "v.mov", type: "video/quicktime", size: 10 }, "tudo")).toBe("Tipo não aceito. Use imagem, PDF ou texto.");
    expect(motivoRecusa({ name: "c.pdf", type: "application/pdf", size: 10 }, "sem_pdf")).toBe("Este agente roda no Codex, que não lê PDF.");
    expect(motivoRecusa({ name: "g.png", type: "image/png", size: TAMANHO_MAX + 1 }, "tudo")).toBe("Acima de 10 MB.");
    expect(motivoRecusa({ name: "g.png", type: "image/png", size: 100 }, "tudo")).toBeNull();
  });

  it("cartões escapam o nome e mostram progresso, erro e resumo", () => {
    const html = renderItens([
      { chave: "k1", nome: "<b>x</b>.pdf", mime: "application/pdf", tamanho: 312 * 1024, estado: "pronto", progresso: 1 },
      { chave: "k2", nome: "n.md", mime: "text/markdown", tamanho: 10, estado: "enviando", progresso: 0.62 },
      { chave: "k3", nome: "v.mov", mime: "video/quicktime", tamanho: 10, estado: "erro", progresso: 0, erro: "Tipo não aceito." },
    ]);
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;.pdf");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("312 KB");
    expect(html).toContain("width:62%");
    expect(html).toContain('role="alert"');
    expect(html.match(/data-act="remover-anexo"/g)).toHaveLength(3);
    expect(resumo([{ chave: "a", nome: "a", mime: "image/png", tamanho: 1024 * 1024, estado: "pronto", progresso: 1 }])).toBe(`1 de ${POR_MENSAGEM} · 1,0 MB`);
  });

  it("mensagem enviada: imagem vira miniatura, PDF vira cartão, ambos abrem em aba nova", () => {
    const html = renderAnexosDaMensagem([{ id: "i", nome: "p.png", mime: "image/png", tamanho: 1 }, { id: "d", nome: "c.pdf", mime: "application/pdf", tamanho: 2048 }], (id) => `/u/${id}`);
    expect(html).toContain('<img src="/u/i" alt="p.png"');
    expect(html).toContain('href="/u/d"');
    expect(html).toContain("PDF");
    expect(html.match(/target="_blank" rel="noopener"/g)).toHaveLength(2);
  });

  it("composer: clipe só com anexos; Codex aceita sem PDF; sala segue sem clipe", () => {
    expect(htmlComposer("x")).not.toContain('data-act="anexar"');
    const tudo = htmlComposer("x", [], { anexos: "tudo" });
    expect(tudo).toContain('data-act="anexar"');
    expect(tudo).toContain("application/pdf");
    const codex = htmlComposer("x", [], { anexos: "sem_pdf" });
    expect(codex).not.toContain("application/pdf");
    expect(codex).toContain("Este agente roda no Codex");
  });
});
