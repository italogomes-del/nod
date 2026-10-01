import { describe, expect, it } from "vitest";
import { resumoCron, validarAtualizacaoRotina, validarRotinaNormalizada } from "../../../src/domain/rotina-texto.ts";
import { RotinaInvalida } from "../../../src/domain/rotina-janela.ts";

const agora = Date.parse("2026-09-16T12:00:00-03:00");
const TZ = "America/Sao_Paulo";
const base = { fusoIana: TZ, instrucao: "resumo dos PRs", fonte: "github", entregavel: "lista", limitesAprovacao: "nada sai", politicaSemDado: "diga que não houve", agora };

describe("rotina-texto", () => {
  it("rotina TIPADA vira forma persistível com gate ligado e próxima execução", () => {
    const r = validarRotinaNormalizada({ ...base, cron: "0 8 * * 1-5" });
    expect(r.exigeAprovacao).toBe(true);
    expect(r.resumo).toBe("dias úteis às 08:00 (America/Sao_Paulo)");
    expect(new Date(r.proximaExecucao).toISOString()).toBe("2026-09-17T11:00:00.000Z");
  });

  it("gate não desliga: o tipo é literal true, não há campo de entrada para desligar", () => {
    const r = validarRotinaNormalizada({ ...base, cron: "0 9 * * *" });
    expect(r.exigeAprovacao).toBe(true);
  });

  it("recusa offset numérico, cron malformado e campo vazio com código fechado", () => {
    expect(() => validarRotinaNormalizada({ ...base, cron: "0 8 * * *", fusoIana: "-03:00" })).toThrow(RotinaInvalida);
    try {
      validarRotinaNormalizada({ ...base, cron: "0 8 * * *", fusoIana: "UTC-3" });
    } catch (e) {
      expect((e as RotinaInvalida).codigo).toBe("fuso_invalido");
    }
    expect(() => validarRotinaNormalizada({ ...base, cron: "8h todo dia" })).toThrow(RotinaInvalida);
    expect(() => validarRotinaNormalizada({ ...base, cron: "0 8 * * *", instrucao: "  " })).toThrow(RotinaInvalida);
  });

  it("resumoCron cobre dia do mês, mês e lista de dias", () => {
    expect(resumoCron("30 7 1 * *", TZ)).toBe("dia 1 às 07:30 (America/Sao_Paulo)");
    expect(resumoCron("0 8 1 1 *", TZ)).toBe("dia 1 de jan às 08:00 (America/Sao_Paulo)");
    expect(resumoCron("0 7 * * 1", TZ)).toBe("toda segunda às 07:00 (America/Sao_Paulo)");
    expect(resumoCron("0 7 * * *", TZ)).toBe("todo dia às 07:00 (America/Sao_Paulo)");
  });

  it("so_com_pendencia (item 7 da ADR-066): ausente vira false, boolean passa como veio, outro tipo é entrada_invalida", () => {
    expect(validarRotinaNormalizada({ ...base, cron: "*/20 * * * *" }).soComPendencia).toBe(false);
    expect(validarRotinaNormalizada({ ...base, cron: "*/20 * * * *", soComPendencia: true }).soComPendencia).toBe(true);
    expect(validarRotinaNormalizada({ ...base, cron: "*/20 * * * *", soComPendencia: false }).soComPendencia).toBe(false);
    // "true" em texto não é lido como intenção: o schema diz boolean e o domínio não adivinha.
    // Pelo JSON, como chegaria de um argumento mal tipado: o tipo do TS não deixaria escrever isto direto.
    const emTexto: Parameters<typeof validarRotinaNormalizada>[0] = JSON.parse(JSON.stringify({ ...base, cron: "*/20 * * * *", soComPendencia: "true" }));
    try {
      validarRotinaNormalizada(emTexto);
      throw new Error("deveria recusar");
    } catch (e) {
      expect(e).toBeInstanceOf(RotinaInvalida);
      expect((e as RotinaInvalida).codigo).toBe("entrada_invalida");
    }
  });

  it("atualizar só o so_com_pendencia é mudança; repetir o valor atual não é; atual sem o campo conta como false", () => {
    const atual = { ...base, cron: "*/20 * * * *", soComPendencia: false };
    const liga = validarAtualizacaoRotina({ atual, pedido: { soComPendencia: true }, agora });
    expect(liga.mudou).toEqual(["soComPendencia"]);
    expect(liga.normalizada).toMatchObject({ soComPendencia: true, cron: "*/20 * * * *", instrucao: "resumo dos PRs" });
    const desliga = validarAtualizacaoRotina({ atual: { ...atual, soComPendencia: true }, pedido: { soComPendencia: false }, agora });
    expect(desliga.mudou).toEqual(["soComPendencia"]);
    expect(desliga.normalizada.soComPendencia).toBe(false);
    // O mesmo valor sem nenhum outro campo: proposta vazia, recusada como antes.
    expect(() => validarAtualizacaoRotina({ atual, pedido: { soComPendencia: false }, agora })).toThrow(RotinaInvalida);
    const { soComPendencia: _, ...semCampo } = atual;
    expect(() => validarAtualizacaoRotina({ atual: semCampo, pedido: { soComPendencia: false }, agora })).toThrow(RotinaInvalida);
    expect(validarAtualizacaoRotina({ atual: semCampo, pedido: { soComPendencia: true }, agora }).mudou).toEqual(["soComPendencia"]);
    // Mudar outro campo mantém o flag que a rotina já tinha.
    const outro = validarAtualizacaoRotina({ atual: { ...atual, soComPendencia: true }, pedido: { instrucao: "retome o PR" }, agora });
    expect(outro.mudou).toEqual(["instrucao"]);
    expect(outro.normalizada.soComPendencia).toBe(true);
  });

  it("nenhum parser de intenção sobrevive (Regra 9)", async () => {
    const mod = await import("../../../src/domain/rotina-texto.ts");
    expect("interpretarRotinaTexto" in mod).toBe(false);
    expect("textoTemRecorrencia" in mod).toBe(false);
  });
});
