import { describe, expect, it } from "vitest";
import { ERROS_DITADO } from "../../../src/contracts/ditado.ts";
import { TEXTO_CONSENTIMENTO_VOZ, VERSAO_CONSENTIMENTO_VOZ } from "../../../src/contracts/ligacao.ts";
import { energiaPcm, lerMsgDitado } from "../../../web/lib/ditado-protocolo.ts";
import { htmlComposer } from "../../../web/telas/conversa.ts";
import { formatarTempo, juntarAoCampo, textoDaFalha } from "../../../web/telas/ditado.ts";
import { TEXTO_CONSENTIMENTO, VERSAO_CONSENTIMENTO } from "../../../web/telas/ligacao.ts";

describe("ditado na web (ADR-095)", () => {
  it("todo composer traz o 🎤 e a pílula escondidos, antes do enviar", () => {
    for (const html of [htmlComposer("x"), htmlComposer("x", ["Vera"]), htmlComposer("x", [], { anexos: "tudo", comandos: true, aprovacao: true })]) {
      expect(html).toMatch(/<button type="button" class="mic" data-act="ditar"[^>]* hidden>/);
      expect(html).toMatch(/<div class="ditado" id="composer-ditado" hidden>/);
      expect(html).toContain('data-act="ditado-parar"');
      expect(html.indexOf('data-act="ditar"')).toBeLessThan(html.indexOf('data-act="enviar"'));
      expect(html.indexOf('id="composer-texto"')).toBeLessThan(html.indexOf('data-act="ditar"'));
    }
  });

  it("o tempo da pílula é m:ss", () => {
    expect(formatarTempo(0)).toBe("0:00");
    expect(formatarTempo(8_400)).toBe("0:08");
    expect(formatarTempo(65_000)).toBe("1:05");
    expect(formatarTempo(299_999)).toBe("4:59");
  });

  it("o texto ditado entra depois do que já estava no campo", () => {
    expect(juntarAoCampo("", "Oi, tudo bem?")).toBe("Oi, tudo bem?");
    expect(juntarAoCampo("Bom dia.", " e o relatório? ")).toBe("Bom dia. e o relatório?");
    expect(juntarAoCampo("Bom dia.\n\n", "Segue")).toBe("Bom dia. Segue");
    expect(juntarAoCampo("fica igual", "   ")).toBe("fica igual");
  });

  it("toda falha tem aviso, e o do microfone negado diz onde liberar", () => {
    for (const c of [...ERROS_DITADO, "microfone-negado", "microfone-restrito", "microfone-indisponivel", "caiu", "vazio", "teto", "tela-bloqueou"] as const) {
      expect(textoDaFalha(c, true).length).toBeGreaterThan(10);
    }
    expect(textoDaFalha("microfone-negado", true)).toContain("Ajustes do Sistema");
    expect(textoDaFalha("microfone-negado", false)).toContain("navegador");
  });

  it("lê só as mensagens do servidor no formato certo", () => {
    expect(lerMsgDitado('{"t":"pronto","maxS":300}')).toEqual({ t: "pronto", maxS: 300 });
    expect(lerMsgDitado('{"t":"texto","texto":"oi"}')).toEqual({ t: "texto", texto: "oi" });
    expect(lerMsgDitado('{"t":"texto","texto":"oi","teto":true}')).toEqual({ t: "texto", texto: "oi", teto: true });
    expect(lerMsgDitado('{"t":"erro","codigo":"voz_fora"}')).toEqual({ t: "erro", codigo: "voz_fora" });
    expect(lerMsgDitado('{"t":"erro","codigo":"outro"}')).toBeNull();
    expect(lerMsgDitado('{"t":"texto","texto":1}')).toBeNull();
    expect(lerMsgDitado("não é json")).toBeNull();
  });

  it("o nível é a energia do quadro, de 0 a 1", () => {
    expect(energiaPcm(new Int16Array(320))).toBe(0);
    expect(energiaPcm(new Int16Array(320).fill(32767))).toBeCloseTo(1, 3);
  });

  it("o aviso da voz é o mesmo do servidor e fala do ditado", () => {
    expect(TEXTO_CONSENTIMENTO).toBe(TEXTO_CONSENTIMENTO_VOZ);
    expect(VERSAO_CONSENTIMENTO).toBe(VERSAO_CONSENTIMENTO_VOZ);
    expect(TEXTO_CONSENTIMENTO).toMatch(/ditado/i);
    // NOD-106: v3, o aviso também fala de ouvir uma resposta fora da ligação.
    expect(VERSAO_CONSENTIMENTO).toBe(3);
    expect(TEXTO_CONSENTIMENTO).toMatch(/ouve uma resposta/);
  });
});
