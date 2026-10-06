import { describe, expect, it } from "vitest";
import { chaveAvisoModo, MODOS, renderAvisoModo, renderChipModo, renderMenuModo } from "../../../web/telas/aprovacoes.ts";
import { htmlComposer } from "../../../web/telas/conversa.ts";
import { porqueDaPausa } from "../../../web/telas/sua-vez.ts";

describe("o chip de aprovações no campo (ADR-059)", () => {
  it("só a conversa própria ganha o chip e o lugar do aviso; a sala não", () => {
    const conversa = htmlComposer("Escreva…", [], { anexos: "tudo", comandos: true, aprovacao: true });
    expect(conversa).toContain('id="composer-modo"');
    expect(conversa).toContain('data-act="modo-aprovacao"');
    expect(conversa).toContain('id="composer-aviso"');
    // O chip fica depois do clipe e antes do campo, como no Claude e no ChatGPT.
    expect(conversa.indexOf('data-act="anexar"')).toBeLessThan(conversa.indexOf('id="composer-modo"'));
    expect(conversa.indexOf('id="composer-modo"')).toBeLessThan(conversa.indexOf("<textarea"));
    const sala = htmlComposer("Escreva…", ["Vera"]);
    expect(sala).not.toContain("composer-modo");
    expect(sala).not.toContain("composer-aviso");
  });

  it("o miolo diz o modo; a seta de abrir só aparece para a dona", () => {
    expect(renderChipModo("automatico", true).html).toContain("Auto");
    expect(renderChipModo("automatico", true).html).toContain("m6 9 6 6 6-6");
    expect(renderChipModo("total", false).html).toContain("Sem aprovações");
    expect(renderChipModo("total", false).html).not.toContain("m6 9 6 6 6-6");
    expect(renderChipModo("total", false).titulo).toContain("só a dona do bot muda");
  });

  it("o menu traz os três modos na ordem, com o atual marcado", () => {
    const html = renderMenuModo("Dev 1", "automatico");
    const ordem = ["manual", "automatico", "total"].map((m) => html.indexOf(`data-modo="${m}"`));
    expect(ordem.every((i, k) => i > 0 && (k === 0 || i > ordem[k - 1]!))).toBe(true);
    expect(html).toContain('aria-checked="true" data-modo="automatico"');
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    for (const m of Object.values(MODOS)) expect(html).toContain(m.titulo);
    expect(html).toContain("Como Dev 1 aprova as próprias ações?");
  });

  it("o aviso só aparece nos modos que aprovam sozinhos, e o total avisa do risco", () => {
    expect(renderAvisoModo("Dev 1", "manual")).toBe("");
    expect(renderAvisoModo("Dev 1", "automatico")).toContain("A aprovação automática está ligada.");
    const total = renderAvisoModo("Clarice", "total");
    expect(total).toContain("aviso-total");
    expect(total).toContain("Clarice está sem aprovações.");
    expect(total).toContain('data-act="fechar-aviso-modo"');
    expect(renderAvisoModo("<b>x</b>", "total")).not.toContain("<b>x</b>");
  });

  it("2026-10-06: o aviso fechado vale pelo modo, não pelo bot — a mesma chave para qualquer bot", () => {
    expect(chaveAvisoModo("total")).toBe("modo:total");
    expect(chaveAvisoModo("automatico")).toBe("modo:automatico");
  });
});

describe("o card que parou mesmo no automático diz por quê", () => {
  it("arriscado traz a frase do domínio; credencial e conteúdo de fora têm a sua; o resto não ganha linha", () => {
    expect(porqueDaPausa({ motivoManual: "acao_arriscada", justificativa: "apaga pastas inteiras", origemSensivel: false })).toContain("Parou para você: apaga pastas inteiras. Na aprovação automática, o arriscado sempre pergunta.");
    expect(porqueDaPausa({ motivoManual: "acao_arriscada", justificativa: null, origemSensivel: false })).toContain("é uma ação arriscada");
    expect(porqueDaPausa({ motivoManual: "toca_credencial", justificativa: null, origemSensivel: false })).toContain("toca uma credencial do Mac");
    expect(porqueDaPausa({ motivoManual: "regra_suspensa_conteudo_nao_confiavel", justificativa: null, origemSensivel: false })).toContain("conteúdo de fora");
    expect(porqueDaPausa({ motivoManual: "destino_terminal", justificativa: null, origemSensivel: false })).toBe("");
    expect(porqueDaPausa({ motivoManual: null, justificativa: null, origemSensivel: false })).toBe("");
  });
});
