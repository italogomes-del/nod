import { describe, expect, it } from "vitest";
import type { FerramentaPlano } from "../../../src/contracts/plano-turno.ts";
import {
  decidirAprovacao,
  decidirLote,
  REGRA_APROVACAO_PERMANENTE,
  REGRA_CONSULTA_SEM_DECISAO,
  VERSAO_APROVACAO_PERMANENTE,
  type EntradaAprovacao,
} from "../../../src/domain/aprovacao-permanente.ts";

const schema = { type: "object" as const, properties: {}, required: [], additionalProperties: false };

function ferramenta(nome: string, extra: Partial<FerramentaPlano> = {}): FerramentaPlano {
  return { nome, nomeMcp: `mcp__nod__${nome}`, origem: "conector", conectorId: "c1", readOnlyHint: false, tocaAprendiz: false, schema, ...extra };
}

function plano(extra: Partial<EntradaAprovacao["plano"] & object> = {}): NonNullable<EntradaAprovacao["plano"]> {
  return {
    catalogo: { ferramentas: [ferramenta("slack__send_message"), ferramenta("slack__search", { readOnlyHint: true })], servidores: [] },
    politicaExecucao: { prazoMs: 60_000, orcamentoResultadoChars: 10_000, efeitoExternoSoPorAprovacao: false },
    confiancaEntrada: "confiavel",
    semprePermitir: [],
    ...extra,
  };
}

const enviar = { conector: "slack", ferramenta: "send_message", argumentos: {} };
const buscar = { conector: "slack", ferramenta: "search", argumentos: {} };

describe("aprovação automática: o que NEGA vem antes do que PERMITE", () => {
  it("sem plano não é automático, nem com tudo o mais permissivo (fail-closed)", () => {
    expect(decidirAprovacao({ plano: null, destino: buscar, origemSensivel: false })).toEqual({ automatico: false, motivo: "sem_plano" });
  });

  it("origem sensível perde para readOnly E para regra da pessoa ao mesmo tempo", () => {
    // Os três insumos mais permissivos juntos: só-leitura, na lista, turno confiável.
    const d = decidirAprovacao({ plano: plano({ semprePermitir: ["slack__search"] }), destino: buscar, origemSensivel: true });
    expect(d).toEqual({ automatico: false, motivo: "origem_sensivel" });
  });

  it("gate de rotina segura mesmo item readOnly com regra (ADR-037: rotina continua exigindo)", () => {
    const p = plano({ politicaExecucao: { prazoMs: 1, orcamentoResultadoChars: 1, efeitoExternoSoPorAprovacao: true }, semprePermitir: ["slack__search"] });
    expect(decidirAprovacao({ plano: p, destino: buscar, origemSensivel: false })).toEqual({ automatico: false, motivo: "gate_de_rotina" });
  });

  it("turno não confiável suspende a regra da PESSOA e diz por quê", () => {
    const p = plano({ confiancaEntrada: "nao_confiavel", semprePermitir: ["slack__send_message"] });
    expect(decidirAprovacao({ plano: p, destino: enviar, origemSensivel: false })).toEqual({ automatico: false, motivo: "regra_suspensa_conteudo_nao_confiavel" });
  });

  it("turno não confiável NÃO suspende a regra do CONECTOR: readOnly já passa no catálogo reduzido", () => {
    const p = plano({ confiancaEntrada: "nao_confiavel" });
    expect(decidirAprovacao({ plano: p, destino: buscar, origemSensivel: false })).toMatchObject({ automatico: true, regra: REGRA_CONSULTA_SEM_DECISAO });
  });

  it("destino computador nunca é automático (ADR-037: aprovação vinculada à ação cifrada)", () => {
    const p = plano({ semprePermitir: ["computador__executar"] });
    const d = decidirAprovacao({ plano: p, destino: { conector: "computador", ferramenta: "executar", argumentos: { acaoId: "x" } }, origemSensivel: false });
    expect(d).toEqual({ automatico: false, motivo: "destino_computador" });
  });

  it("ferramenta fora do catálogo do plano pergunta, mesmo nomeada na regra", () => {
    const p = plano({ semprePermitir: ["gmail__send"] });
    expect(decidirAprovacao({ plano: p, destino: { conector: "gmail", ferramenta: "send", argumentos: {} }, origemSensivel: false })).toEqual({ automatico: false, motivo: "fora_do_catalogo" });
  });

  it("readOnlyHint de ferramenta que NÃO é de conector nunca auto-aprova", () => {
    // Lista escrita no código (computador/workspace) e ferramenta nod não passam pela sonda:
    // a declaração tem que ser do conector, senão o critério deixa de ser verificável.
    for (const origem of ["nod", "computador", "workspace"] as const) {
      const p = plano({ catalogo: { ferramentas: [ferramenta("x__y", { origem, readOnlyHint: true })], servidores: [] } });
      expect(decidirAprovacao({ plano: p, destino: { conector: "x", ferramenta: "y", argumentos: {} }, origemSensivel: false })).toEqual({ automatico: false, motivo: "fora_do_catalogo" });
    }
  });
});

describe("aprovação automática: o que PERMITE", () => {
  it("readOnlyHint do conector dispensa a pergunta desde o dia um, sem regra nenhuma", () => {
    expect(decidirAprovacao({ plano: plano(), destino: buscar, origemSensivel: false })).toEqual({ automatico: true, regra: REGRA_CONSULTA_SEM_DECISAO, versao: 1 });
  });

  it("ferramenta de escrita na lista da pessoa dispensa a pergunta", () => {
    const p = plano({ semprePermitir: ["slack__send_message"] });
    expect(decidirAprovacao({ plano: p, destino: enviar, origemSensivel: false })).toEqual({ automatico: true, regra: REGRA_APROVACAO_PERMANENTE, versao: VERSAO_APROVACAO_PERMANENTE });
  });

  it("escrita sem regra continua perguntando", () => {
    expect(decidirAprovacao({ plano: plano(), destino: enviar, origemSensivel: false })).toEqual({ automatico: false, motivo: "sem_regra_permanente" });
  });

  it("regra é por FERRAMENTA, não por destino: o mesmo nome vale para qualquer argumento", () => {
    const p = plano({ semprePermitir: ["slack__send_message"] });
    for (const argumentos of [{ channel: "#vendas" }, { channel: "#diretoria" }, {}]) {
      expect(decidirAprovacao({ plano: p, destino: { ...enviar, argumentos }, origemSensivel: false })).toMatchObject({ automatico: true });
    }
  });
});

describe("lote misto", () => {
  it("se UM item precisa de pessoa, o lote inteiro pergunta — mas cada item guarda seu motivo", () => {
    const p = plano({ semprePermitir: [] });
    const r = decidirLote([
      { plano: p, destino: buscar, origemSensivel: false },
      { plano: p, destino: enviar, origemSensivel: false },
    ]);
    expect(r.automatico).toBe(false);
    expect(r.porItem[0]).toMatchObject({ automatico: true, regra: REGRA_CONSULTA_SEM_DECISAO });
    expect(r.porItem[1]).toEqual({ automatico: false, motivo: "sem_regra_permanente" });
  });

  it("lote todo automático quando cada item passa por si", () => {
    const p = plano({ semprePermitir: ["slack__send_message"] });
    const r = decidirLote([
      { plano: p, destino: buscar, origemSensivel: false },
      { plano: p, destino: enviar, origemSensivel: false },
    ]);
    expect(r.automatico).toBe(true);
  });

  it("lote vazio não é automático (nada a executar não é permissão)", () => {
    expect(decidirLote([]).automatico).toBe(false);
  });
});
