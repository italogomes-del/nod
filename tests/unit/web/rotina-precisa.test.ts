import { describe, expect, it } from "vitest";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import type { Conector } from "../../../src/contracts/conector.ts";
import type { PayloadPropostaRotina, Proposta } from "../../../src/contracts/conversa.ts";
import type { AppComLogo } from "../../../src/contracts/marketplace.ts";
import { estadoInicial, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { renderTimeline } from "../../../web/telas/conversa.ts";
import { renderSuaVez } from "../../../web/telas/sua-vez.ts";

/**
 * Emenda da ADR-044, "rotina nasce com o acesso" (2026-09-24), o mockup aprovado: o card da rotina mostra
 * "Precisa · Ler seu Gmail · Não inclui: enviar, apagar, arquivar" e o botão "Criar rotina e permitir
 * leitura"; com o Gmail por conectar, "Conectar Gmail" vem primeiro e o botão fica desabilitado, com
 * "Liberado assim que o Gmail conectar."
 */
const LEITURA = ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"];
const cap = (nome: string, readOnlyHint: boolean) => ({ nome, descricao: nome, schema: { type: "object" as const }, readOnlyHint });
const gmail = (habilitado: boolean): Conector => ({ tenantId: "t", id: "cg", ownerId: "p", visibility: "privado", nome: "Gmail (Composio)", slug: "gmail", transporte: "http", comando: null, args: [], url: "https://x", env: {}, declaracao: "nao-toca", habilitado, catalogo: [cap("GMAIL_FETCH_EMAILS", true), cap("GMAIL_LIST_LABELS", true), cap("GMAIL_SEND_EMAIL", false)], sondadoEm: 1, ultimaFalha: null, criadoEm: 0 });
const MARKETPLACE: AppComLogo[] = [{ slug: "gmail", nome: "Gmail", descricao: "", categoria: "Comunicação", naoIncluiNaLeitura: ["enviar", "apagar", "arquivar"], logo: null }];

const payload = (acessos: PayloadPropostaRotina["acessos"]): PayloadPropostaRotina => ({ kind: "rotina", cron: "0 8,13,18 * * *", fusoIana: "America/Sao_Paulo", instrucao: "E-mails às 8h, 13h e 18h", fonte: "Gmail do Marlon", entregavel: "resumo", limitesAprovacao: "nada sai", politicaSemDado: "silêncio", proximaExecucao: 0, resumo: "todo dia às 08:00, 13:00, 18:00 (America/Sao_Paulo)", ...(acessos ? { acessos } : {}) });
const proposta = (acessos: PayloadPropostaRotina["acessos"]): Proposta => ({ tenantId: "t", id: "pr", conversaId: "c", agenteId: "a", kind: "rotina", estado: "pendente", payload: payload(acessos), criadoEm: 0 });
const conversa = (p: Proposta): ConversaEstado => ({ conversa: { tenantId: "t", id: "c", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens: [], propostas: [p], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], atividades: {}, carregadaEm: 0 });
const estado = (conectores: Conector[]): Estado => ({ ...estadoInicial, conectores, marketplace: MARKETPLACE, suaVez: { itens: [], incidentes: [], foraDoAr: [], vazio: true, ultimaDecisaoEm: null } });

const LER_GMAIL = [{ conector: "gmail", capacidades: LEITURA, nivel: "leitura" as const, naoPedido: [] }];

describe("card da rotina proposta com acessos (chat)", () => {
  it("Gmail conectado: linha 'Precisa' com o app, 'Ler seu Gmail', o 'Não inclui' curado e as ações atrás do <details>; botão 'Criar rotina e permitir leitura'", () => {
    const html = renderTimeline(conversa(proposta(LER_GMAIL)), estado([gmail(true)]));
    expect(html).toContain('class="rotina-precisa" data-app="gmail"');
    expect(html).toContain('class="app-logo app-gmail"');
    expect(html).toContain("Precisa");
    expect(html).toContain("Ler seu Gmail");
    expect(html).toContain("Não inclui: enviar, apagar, arquivar.");
    expect(html).toContain("Ver as 2 ações");
    expect(html.indexOf("Ver as 2 ações")).toBeLessThan(html.indexOf("gmail.GMAIL_FETCH_EMAILS"));
    expect(html).toMatch(/<button type="button" class="bt pri" data-act="confirmar-proposta" data-id="pr">Criar rotina e permitir leitura<\/button>/);
    expect(html).toContain('data-act="recusar-proposta" data-id="pr">Deixar de lado</button>');
    expect(html).not.toContain("Conectar Gmail");
    expect(html).not.toContain("Liberado assim que");
  });

  it("Gmail por conectar: 'Conectar Gmail' (abrir-conexao) vem primeiro e o botão de criar fica desabilitado, com 'Liberado assim que o Gmail conectar.'", () => {
    const declarado = [{ conector: "gmail", capacidades: [], nivel: "leitura" as const, naoPedido: [], conectar: true as const }];
    const html = renderTimeline(conversa(proposta(declarado)), estado([]));
    expect(html).toContain("Ler seu Gmail");
    const conectar = html.indexOf('data-act="abrir-conexao" data-id="gmail">Conectar Gmail</button>');
    const criar = html.indexOf('data-act="confirmar-proposta" data-id="pr" disabled title="Liberado assim que o Gmail conectar.">Criar rotina e permitir leitura</button>');
    expect(conectar).toBeGreaterThan(-1);
    expect(criar).toBeGreaterThan(conectar);
    expect(html).toContain('<p class="rp-liberado mudo">Liberado assim que o Gmail conectar.</p>');
    // Conectou: o mesmo card libera o botão, com as ferramentas de leitura do catálogo de agora.
    const depois = renderTimeline(conversa(proposta(declarado)), estado([gmail(true)]));
    expect(depois).toMatch(/class="bt pri" data-act="confirmar-proposta" data-id="pr">Criar rotina e permitir leitura/);
    expect(depois).toContain("Ver as 2 ações");
    expect(depois).not.toContain("Liberado assim que");
  });

  it("escrita declarada: 'Ler e alterar seu Gmail', o que fica de fora e 'Criar rotina e permitir acesso'", () => {
    const html = renderTimeline(conversa(proposta([{ conector: "gmail", capacidades: [...LEITURA, "GMAIL_SEND_EMAIL"], nivel: "escrita", naoPedido: [] }])), estado([gmail(true)]));
    expect(html).toContain("Ler e alterar seu Gmail");
    expect(html).toContain("Criar rotina e permitir acesso");
    expect(html).toContain("Ver as 3 ações");
  });

  it("rotina sem acessos declarados segue com o card de sempre", () => {
    const html = renderTimeline(conversa(proposta(undefined)), estado([gmail(true)]));
    expect(html).not.toContain("rotina-precisa");
    expect(html).toContain('data-act="confirmar-proposta" data-id="pr">Confirmar</button>');
  });
});

describe("card da rotina proposta com acessos (Sua vez)", () => {
  const item = (p: Proposta): SuaVezDto["itens"][number] => ({
    decisao: { tenantId: "t", id: "pr", ownerId: "p", decisorId: "p", agenteId: "a", conversaId: "c", turnoId: null, tipo: "rotina", estado: "pendente", prazoDecisaoEm: "2026-09-25T00:00:00Z", prazoExecucaoEm: null, frase: "Rotina proposta: todo dia", desfecho: null, vistaEm: null, criadoEm: "2026-09-24T00:00:00Z", fioId: null },
    estadoColuna: "pendente", agenteNome: "Nina", aguardandoHaMs: 0, recusaAutomaticaEmMs: 60_000, gemeas: [], itensAprovacao: [], proposta: p, fio: null, rotinaParada: null,
  });

  it("mesma linha 'Precisa' e o mesmo botão, pela decisão; sem conexão, 'Conectar Gmail' e o botão desabilitado", () => {
    const pronto: Estado = { ...estado([gmail(true)]), tela: { tipo: "sua-vez" }, suaVez: { itens: [item(proposta(LER_GMAIL))], incidentes: [], foraDoAr: [], vazio: false, ultimaDecisaoEm: null } };
    const html = renderSuaVez(pronto);
    expect(html).toContain("Ler seu Gmail");
    expect(html).toContain('class="bt pri" data-act="decidir-proposta" data-id="pr">Criar rotina e permitir leitura</button>');
    expect(html).toContain('data-act="recusar-decisao" data-id="pr">Deixar de lado</button>');
    const semGmail = renderSuaVez({ ...pronto, conectores: [gmail(false)] });
    expect(semGmail).toContain('data-act="abrir-conexao" data-id="gmail">Conectar Gmail</button>');
    expect(semGmail).toContain('data-act="decidir-proposta" data-id="pr" disabled');
    expect(semGmail).toContain("Liberado assim que o Gmail conectar.");
  });
});
