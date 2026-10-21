import { describe, expect, it } from "vitest";
import { MOTIVOS_NAO_RODOU_ROTINA } from "../../../src/contracts/motivos.ts";
import { CAUSAS_DE_ESPERA_NO_FUNDO, decidirEsperaNoFundo, esperaTransitoriaNoFundo, MOTIVO_NAO_RODOU_DA_CAUSA, type EntradaEsperaNoFundo } from "../../../src/domain/espera-no-fundo.ts";
import { redigir } from "../../../src/domain/redacao.ts";
import { PRAZO_DO_FUNDO_MS, TENTATIVAS_TRANSITORIAS_MAX } from "../../../src/shared/constantes.ts";

const MIN = 60_000;
const HORA = 60 * MIN;
const T0 = Date.UTC(2026, 9, 20, 13, 0); // 10:00 em SP

const base = (e: Partial<EntradaEsperaNoFundo> = {}): EntradaEsperaNoFundo => ({
  causa: "erro_transitorio",
  tentativasTransitorias: 0,
  quedas: 0,
  agora: T0,
  inicioDaCadeia: T0,
  ehRotina: false,
  proximaExecucao: null,
  aleatorio: 0.5,
  ...e,
});

describe("espera no fundo por toda queda (NOD-309)", () => {
  it("backoff do transitório: ~1, ~5 e ~15 min, com jitter de ±25%, preso nas pontas", () => {
    expect([1, 2, 3].map((n) => esperaTransitoriaNoFundo(n, 0.5))).toEqual([1 * MIN, 5 * MIN, 15 * MIN]);
    expect(esperaTransitoriaNoFundo(1, 0)).toBe(0.75 * MIN);
    expect(esperaTransitoriaNoFundo(3, 1)).toBe(1.25 * 15 * MIN);
    expect(esperaTransitoriaNoFundo(2, -3)).toBe(0.75 * 5 * MIN);
    expect(esperaTransitoriaNoFundo(9, 0.5)).toBe(15 * MIN);
  });

  it("transitório espera com a hora da volta e conta a tentativa; no teto de 3, desiste", () => {
    expect(decidirEsperaNoFundo(base())).toEqual({ tipo: "esperar", voltaEm: T0 + MIN, tentativa: 1 });
    expect(decidirEsperaNoFundo(base({ tentativasTransitorias: 2 }))).toEqual({ tipo: "esperar", voltaEm: T0 + 15 * MIN, tentativa: 3 });
    expect(decidirEsperaNoFundo(base({ tentativasTransitorias: TENTATIVAS_TRANSITORIAS_MAX }))).toEqual({ tipo: "desistir", motivo: "tentativas_esgotadas" });
  });

  it("reinício volta agora; máquina sem contato volta quando o Mac voltar (sem hora); 3 quedas desistem", () => {
    expect(decidirEsperaNoFundo(base({ causa: "reinicio_servidor" }))).toEqual({ tipo: "esperar", voltaEm: T0, tentativa: 1 });
    expect(decidirEsperaNoFundo(base({ causa: "maquina_sem_contato", quedas: 1 }))).toEqual({ tipo: "esperar", voltaEm: null, tentativa: 2 });
    for (const causa of ["reinicio_servidor", "maquina_sem_contato"] as const) {
      expect(decidirEsperaNoFundo(base({ causa, quedas: 3 }))).toEqual({ tipo: "desistir", motivo: "quedas_esgotadas" });
    }
    // As quedas não gastam as tentativas transitórias, nem o contrário.
    expect(decidirEsperaNoFundo(base({ causa: "reinicio_servidor", tentativasTransitorias: 3 })).tipo).toBe("esperar");
    expect(decidirEsperaNoFundo(base({ quedas: 3 })).tipo).toBe("esperar");
  });

  it("pedido de colega, frente e lote: 24 h desde o começo da cadeia, contando a hora da volta", () => {
    const inicio = T0 - PRAZO_DO_FUNDO_MS;
    expect(decidirEsperaNoFundo(base({ causa: "reinicio_servidor", inicioDaCadeia: inicio }))).toEqual({ tipo: "desistir", motivo: "prazo_esgotado" });
    expect(decidirEsperaNoFundo(base({ causa: "maquina_sem_contato", inicioDaCadeia: inicio + 1 })).tipo).toBe("esperar");
    // Volta de 15 min que passaria das 24 h: desiste já, não espera para falhar.
    expect(decidirEsperaNoFundo(base({ tentativasTransitorias: 2, inicioDaCadeia: inicio + 10 * MIN }))).toEqual({ tipo: "desistir", motivo: "prazo_esgotado" });
  });

  it("a cota não tem teto nem prazo de 24 h: espera a hora que ela dá (ou sem hora)", () => {
    const longe = T0 + 3 * 24 * HORA;
    expect(decidirEsperaNoFundo(base({ causa: "cota", voltaDaCota: longe, inicioDaCadeia: T0 - 2 * PRAZO_DO_FUNDO_MS, quedas: 5, tentativasTransitorias: 5 }))).toEqual({ tipo: "esperar", voltaEm: longe, tentativa: 1 });
    expect(decidirEsperaNoFundo(base({ causa: "cota" }))).toEqual({ tipo: "esperar", voltaEm: null, tentativa: 1 });
  });

  it("rotina: a volta em ou depois da próxima janela vira 'nao_rodou' com o motivo da causa e a hora; antes, espera", () => {
    const rotina = { ehRotina: true, proximaExecucao: T0 + 10 * MIN } as const;
    expect(decidirEsperaNoFundo(base({ ...rotina }))).toEqual({ tipo: "esperar", voltaEm: T0 + MIN, tentativa: 1 });
    expect(decidirEsperaNoFundo(base({ ...rotina, tentativasTransitorias: 2 }))).toEqual({ tipo: "nao_rodou", voltaEm: T0 + 15 * MIN, motivo: "erro_do_provedor" });
    expect(decidirEsperaNoFundo(base({ ...rotina, causa: "cota", voltaDaCota: T0 + 10 * MIN }))).toEqual({ tipo: "nao_rodou", voltaEm: T0 + 10 * MIN, motivo: "cota_da_ia" });
    expect(decidirEsperaNoFundo(base({ ...rotina, causa: "reinicio_servidor" }))).toEqual({ tipo: "esperar", voltaEm: T0, tentativa: 1 });
    // Sem hora (Mac sem contato), a rotina espera; a janela seguinte a fecha como 'nao_rodou' (disparar-rotina).
    expect(decidirEsperaNoFundo(base({ ...rotina, causa: "maquina_sem_contato" }))).toEqual({ tipo: "esperar", voltaEm: null, tentativa: 1 });
    // A rotina não usa o prazo de 24 h: o prazo dela é a próxima janela.
    expect(decidirEsperaNoFundo(base({ ...rotina, causa: "reinicio_servidor", inicioDaCadeia: T0 - 2 * PRAZO_DO_FUNDO_MS })).tipo).toBe("esperar");
    // Sem próxima execução (rotina sem agenda), espera como qualquer fundo; o teto ainda vale.
    expect(decidirEsperaNoFundo(base({ ehRotina: true, tentativasTransitorias: 2 })).tipo).toBe("esperar");
    expect(decidirEsperaNoFundo(base({ ...rotina, tentativasTransitorias: 3 }))).toEqual({ tipo: "desistir", motivo: "tentativas_esgotadas" });
  });

  it("todo motivo de 'nao_rodou' de uma causa é um motivo de rotina conhecido", () => {
    for (const causa of CAUSAS_DE_ESPERA_NO_FUNDO) expect(MOTIVOS_NAO_RODOU_ROTINA).toContain(MOTIVO_NAO_RODOU_DA_CAUSA[causa]);
  });

  it("os avisos saem preenchidos e em pt-BR, sem chave sobrando", () => {
    const textos = [
      redigir("fundo-espera-maquina", T0, { maquina: "O Mac do Marlon", pedido: "Este pedido" }),
      redigir("fundo-nova-tentativa", T0, { ia: "Claude Code", pedido: "Esta frente", quando: "às 10:05", tentativa: "1", maximo: "3" }),
      redigir("fundo-desistiu", T0, { pedido: "Este pedido", motivo: "erro do provedor", porque: "tentou 3 vezes" }),
      redigir("rotina-nao-rodou", T0, { motivo: "reinício do servidor", quando: "11:00" }),
    ];
    expect(textos[1]).toBe("O serviço do Claude Code está instável. Esta frente tenta de novo às 10:05: tentativa 1 de 3.");
    expect(textos[3]).toBe("Não rodou · reinício do servidor, volta 11:00. A rotina segue a agenda.");
    for (const t of textos) expect(t).not.toMatch(/[{}]/);
  });
});
