import { describe, expect, it } from "vitest";
import type { CapacidadeConector } from "../../../src/contracts/conector.ts";
import { capacidadesDoPedido, conectoresCitados, faltaDeAcesso, janelasQueNaoRodaram, necessidadesDaRotina, type ConectorRegistrado } from "../../../src/domain/rotina-acessos.ts";

/**
 * Emenda da ADR-044 ("rotina se trava sozinha"): o que a rotina precisa, decidido antes de gastar um
 * turno. A citação é o casamento EXATO de confiancaDaFonte, só sobre o que a pessoa registrou.
 */
const cap = (nome: string, readOnlyHint: boolean): CapacidadeConector => ({ nome, descricao: nome, schema: { type: "object" }, readOnlyHint });
const GMAIL: ConectorRegistrado = { id: "c-gmail", slug: "gmail", nome: "Gmail (Composio)", habilitado: true, catalogo: [cap("GMAIL_FETCH_EMAILS", true), cap("GMAIL_LIST_LABELS", true), cap("GMAIL_SEND_EMAIL", false)] };
const SLACK: ConectorRegistrado = { id: "c-slack", slug: "slack", nome: "Slack", habilitado: false, catalogo: [cap("SLACK_LIST", true)] };
const LINEAR: ConectorRegistrado = { id: "c-linear", slug: "linear", nome: "Linear", habilitado: true, catalogo: [cap("LINEAR_LIST", true)] };

describe("conectoresCitados", () => {
  it("casa slug OU nome contido na fonte, sem caixa — só entre os registrados", () => {
    expect(conectoresCitados("E-mails do GMAIL da semana", [GMAIL, SLACK]).map((c) => c.slug)).toEqual(["gmail"]);
    expect(conectoresCitados("canal #geral no slack e gmail (composio)", [GMAIL, SLACK]).map((c) => c.slug)).toEqual(["gmail", "slack"]);
  });

  it("'regressão linear' não cita o Linear se ele não está registrado; registrado, cita (o casamento é o mesmo de confiancaDaFonte)", () => {
    expect(conectoresCitados("planilha de regressão linear", [GMAIL, SLACK])).toEqual([]);
    expect(conectoresCitados("planilha de regressão linear", [GMAIL, LINEAR]).map((c) => c.slug)).toEqual(["linear"]);
  });
});

describe("necessidadesDaRotina", () => {
  it("sem acessos declarados: os apps citados, pedindo leitura (capacidades null), em ordem de slug", () => {
    expect(necessidadesDaRotina({ fonte: "slack e gmail" }, [GMAIL, SLACK])).toEqual([
      { slug: "gmail", conector: GMAIL, capacidades: null },
      { slug: "slack", conector: SLACK, capacidades: null },
    ]);
    expect(necessidadesDaRotina({ fonte: "slack", acessos: null }, [GMAIL, SLACK]).map((n) => n.slug)).toEqual(["slack"]);
  });

  it("declarado ganha da fonte — mesmo vazio; app declarado sem registro vira conector null", () => {
    expect(necessidadesDaRotina({ fonte: "gmail", acessos: [{ conector: "slack", capacidades: ["SLACK_LIST", "SLACK_LIST"] }] }, [GMAIL, SLACK])).toEqual([{ slug: "slack", conector: SLACK, capacidades: ["SLACK_LIST"] }]);
    expect(necessidadesDaRotina({ fonte: "gmail", acessos: [] }, [GMAIL, SLACK])).toEqual([]);
    expect(necessidadesDaRotina({ fonte: "", acessos: [{ conector: "notion", capacidades: ["LER"] }] }, [GMAIL])).toEqual([{ slug: "notion", conector: null, capacidades: ["LER"] }]);
  });

  it("o card pede as declaradas, ou as de leitura do catálogo (nunca escrita)", () => {
    expect(capacidadesDoPedido({ slug: "gmail", conector: GMAIL, capacidades: null })).toEqual(["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"]);
    expect(capacidadesDoPedido({ slug: "gmail", conector: GMAIL, capacidades: ["GMAIL_FETCH_EMAILS"] })).toEqual(["GMAIL_FETCH_EMAILS"]);
  });
});

describe("faltaDeAcesso", () => {
  const gmail = necessidadesDaRotina({ fonte: "gmail" }, [GMAIL]);

  it("sem_conexao: registrado e desligado, ou declarado sem registro", () => {
    expect(faltaDeAcesso(necessidadesDaRotina({ fonte: "slack" }, [SLACK]), [])).toMatchObject({ motivo: "sem_conexao", necessidade: { slug: "slack" } });
    expect(faltaDeAcesso([{ slug: "notion", conector: null, capacidades: ["LER"] }], [])?.motivo).toBe("sem_conexao");
  });

  it("sem_acesso: ligado e sem concessão; a de ESCRITA sozinha não serve para quem só lê", () => {
    expect(faltaDeAcesso(gmail, [])).toMatchObject({ motivo: "sem_acesso", necessidade: { slug: "gmail" } });
    expect(faltaDeAcesso(gmail, [{ conectorId: "c-gmail", capacidade: "GMAIL_SEND_EMAIL" }])?.motivo).toBe("sem_acesso");
    // Concessão de OUTRO conector não conta.
    expect(faltaDeAcesso(gmail, [{ conectorId: "c-slack", capacidade: "GMAIL_FETCH_EMAILS" }])?.motivo).toBe("sem_acesso");
  });

  it("ok: rotina legada se satisfaz com UMA de leitura; declarada exige todas", () => {
    expect(faltaDeAcesso(gmail, [{ conectorId: "c-gmail", capacidade: "GMAIL_LIST_LABELS" }])).toBeNull();
    const declarada = [{ slug: "gmail", conector: GMAIL, capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"] }];
    expect(faltaDeAcesso(declarada, [{ conectorId: "c-gmail", capacidade: "GMAIL_LIST_LABELS" }])?.motivo).toBe("sem_acesso");
    expect(faltaDeAcesso(declarada, [{ conectorId: "c-gmail", capacidade: "GMAIL_LIST_LABELS" }, { conectorId: "c-gmail", capacidade: "GMAIL_FETCH_EMAILS" }])).toBeNull();
    expect(faltaDeAcesso([], [])).toBeNull();
  });

  it("app legado sem ferramenta de leitura no catálogo não trava (não haveria o que pedir por botão)", () => {
    const soEscrita: ConectorRegistrado = { ...GMAIL, catalogo: [cap("GMAIL_SEND_EMAIL", false)] };
    expect(faltaDeAcesso(necessidadesDaRotina({ fonte: "gmail" }, [soEscrita]), [])).toBeNull();
  });

  it("devolve a PRIMEIRA que falta, na ordem dada", () => {
    const ambos = necessidadesDaRotina({ fonte: "gmail e slack" }, [{ ...SLACK, habilitado: true }, GMAIL]);
    expect(faltaDeAcesso(ambos, [])?.necessidade.slug).toBe("gmail");
    expect(faltaDeAcesso(ambos, [{ conectorId: "c-gmail", capacidade: "GMAIL_FETCH_EMAILS" }])?.necessidade.slug).toBe("slack");
  });
});

describe("janelasQueNaoRodaram", () => {
  const e = (desfecho: "bloqueada" | "executou", motivo: string | null, instanteAgendado: number) => ({ desfecho, motivo, instanteAgendado });
  it("as bloqueadas por conexão/acesso seguidas, da mais recente até a primeira que rodou", () => {
    expect(janelasQueNaoRodaram([e("bloqueada", "sem_acesso", 3), e("bloqueada", "sem_conexao", 2), e("executou", null, 1), e("bloqueada", "sem_acesso", 0)])).toEqual([3, 2]);
    // A pergunta pendente não é falta de acesso: encerra a contagem.
    expect(janelasQueNaoRodaram([e("bloqueada", "aguardando_resposta", 2), e("bloqueada", "sem_acesso", 1)])).toEqual([]);
    expect(janelasQueNaoRodaram([])).toEqual([]);
  });
});
