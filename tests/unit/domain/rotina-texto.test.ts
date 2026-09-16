import { describe, expect, it } from "vitest";
import { interpretarRotinaTexto, textoTemRecorrencia } from "../../../src/domain/rotina-texto.ts";
import { RotinaInvalida } from "../../../src/domain/rotina-janela.ts";

const agora = Date.parse("2026-09-16T12:00:00-03:00");
const TZ = "America/Sao_Paulo";

describe("interpretarRotinaTexto", () => {
  it("todo dia às 8h vira cron com fuso IANA e gate ligado", () => {
    const r = interpretarRotinaTexto({
      texto: "faz o resumo todo dia às 8h e me mostra antes de mandar",
      fusoIana: TZ,
      agora,
    });
    expect(r.cron).toBe("0 8 * * *");
    expect(r.fusoIana).toBe(TZ);
    expect(r.exigeAprovacao).toBe(true);
    expect(r.resumo).toContain("America/Sao_Paulo");
  });

  it("toda segunda às 7h — jornada da Carolina", () => {
    const r = interpretarRotinaTexto({
      texto: "faz esse fechamento toda segunda às 7h e me manda antes de qualquer coisa sair",
      fusoIana: TZ,
      agora,
    });
    expect(r.cron).toBe("0 7 * * 1");
    expect(r.exigeAprovacao).toBe(true);
  });

  it("gate não desliga mesmo se o texto pedir para mandar direto", () => {
    const r = interpretarRotinaTexto({
      texto: "todo dia às 9h manda sem me perguntar",
      fusoIana: TZ,
      agora,
    });
    expect(r.exigeAprovacao).toBe(true);
  });

  it("recusa offset no texto", () => {
    expect(() =>
      interpretarRotinaTexto({ texto: "todo dia às 8h UTC-3", fusoIana: TZ, agora }),
    ).toThrow(RotinaInvalida);
  });

  it("textoTemRecorrencia reconhece a frase da jornada", () => {
    expect(textoTemRecorrencia("faz esse fechamento toda segunda às 7h")).toBe(true);
    expect(textoTemRecorrencia("responde o formulário da LGPD")).toBe(false);
  });
});
