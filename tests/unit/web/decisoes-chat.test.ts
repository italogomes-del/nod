import { describe, expect, it } from "vitest";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import type { Proposta } from "../../../src/contracts/conversa.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { renderMensagem, renderTimeline } from "../../../web/telas/conversa.ts";
import { renderDecisoesDaConversa, renderSuaVez } from "../../../web/telas/sua-vez.ts";

const item: SuaVezDto["itens"][number] = {
  decisao: { tenantId: "t", id: "d", ownerId: "p", decisorId: "p", agenteId: "a", conversaId: "c", turnoId: null, tipo: "acesso", estado: "pendente", prazoDecisaoEm: "2026-09-18T00:00:00Z", prazoExecucaoEm: null, frase: "Ler Slack <script>alert(1)</script>", desfecho: null, vistaEm: null, criadoEm: "2026-09-17T00:00:00Z" },
  estadoColuna: "pendente", agenteNome: "Milton", aguardandoHaMs: 0, recusaAutomaticaEmMs: 60_000, itensAprovacao: [], proposta: null,
};
const estado: Estado = { ...estadoInicial, suaVez: { itens: [item], incidentes: [], foraDoAr: [], vazio: false, ultimaDecisaoEm: null } };
const conversa: ConversaEstado = { conversa: { tenantId: "t", id: "c", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens: [], propostas: [], turnosPendentes: [], atividades: {}, carregadaEm: 0 };

describe("decisões no chat", () => {
  it("mostra a autorização na conversa de origem com as mesmas ações da fila", () => {
    const html = renderTimeline(conversa, estado);
    expect(html).toContain("Preciso da sua decisão para continuar");
    expect(html).toContain('data-act="decidir-proposta"');
    expect(html).toContain('data-id="d"');
    // ADR-044: um clique concede E continua, e o botão diz isso.
    expect(html).toContain("Permitir e continuar");
    expect(html).toContain("Não permitir");
    expect(html).not.toContain('data-act="abrir-conversa"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(renderDecisoesDaConversa(estado, "outra", new Set())).toBe("");
  });

  it("não duplica a decisão que já tem proposta e remove o cartão quando a fila é reidratada", () => {
    expect(renderDecisoesDaConversa(estado, "c", new Set(["d"]))).toBe("");
    const atualizado = reduzir(estado, { tipo: "hidratar-sua-vez", suaVez: { itens: [], incidentes: [], foraDoAr: [], vazio: true, ultimaDecisaoEm: "2026-09-17T00:01:00Z" } });
    expect(renderTimeline(conversa, atualizado)).not.toContain("Permitir e continuar");
  });

  it("pedido vencido oferece reabertura e não concede acesso", () => {
    const vencido: Estado = { ...estado, suaVez: { ...estado.suaVez!, itens: [{ ...item, estadoColuna: "vencido", decisao: { ...item.decisao, estado: "vencida" } }] } };
    const html = renderTimeline(conversa, vencido);
    expect(html).toContain("Pedidos vencidos");
    expect(html).toContain('data-act="reabrir"');
    expect(html).not.toContain('data-act="decidir-proposta"');
  });

  it("aprovação de conteúdo sensível continua desmarcada no chat", () => {
    const sensivel = { tenantId: "t", id: "i", decisaoId: "d", idx: 0, textoOriginal: "Olá", textoFinal: "Olá", destino: { conector: "slack", ferramenta: "send", argumentos: {} }, selecionado: false, origemSensivel: true, justificativa: "Confirme antes de enviar", marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null };
    const e: Estado = { ...estado, suaVez: { ...estado.suaVez!, itens: [{ ...item, decisao: { ...item.decisao, tipo: "aprovacao" }, itensAprovacao: [sensivel] }] } };
    const html = renderTimeline(conversa, e);
    expect(html).toContain('data-item="i"');
    expect(html).not.toContain("checked");
    expect(html).toContain("Confirme antes de enviar");
    expect(html).toContain('data-contador>0</span> de 1');
  });

  it("um item só: pergunta sem lista, CTA nomeia a consequência e o jargão fica no disclosure", () => {
    const i = { tenantId: "t", id: "i", decisaoId: "d", idx: 0, textoOriginal: "Avisar o time", textoFinal: "Avisar o time", destino: { conector: "slack", ferramenta: "send_message", argumentos: { channel: "#vendas" } }, selecionado: true, origemSensivel: false, justificativa: null, marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null };
    const e: Estado = {
      ...estado,
      conectores: [{ tenantId: "t", id: "cx", ownerId: "p", visibility: "privado", nome: "Slack", slug: "slack", transporte: "stdio", comando: null, args: [], url: null, env: {}, declaracao: "nao-toca", habilitado: true, catalogo: [], sondadoEm: null, ultimaFalha: null, criadoEm: 0 }],
      suaVez: { ...estado.suaVez!, itens: [{ ...item, decisao: { ...item.decisao, tipo: "aprovacao" }, itensAprovacao: [i] }] },
    };
    const html = renderTimeline(conversa, e);
    expect(html).toContain("Pode fazer");
    expect(html).toContain("Agora não");
    expect(html).not.toContain("Aprovar 1 de 1");
    expect(html).not.toContain("Não aprovar nada");
    // Item único e não sensível dispensa a lista: a pergunta já está na frase da decisão.
    expect(html).not.toContain('class="ap-lista"');
    // "no Slack" vem de Conector.nome, que já está no estado da web — sem campo novo no DTO.
    expect(html).toContain("no Slack");
    // O nome técnico e os argumentos existem, mas atrás do disclosure.
    expect(html).toContain("Ver detalhes");
    expect(html).toContain("slack.send_message");
    expect(html).toContain("#vendas");
    expect(html.indexOf("Ver detalhes")).toBeLessThan(html.indexOf("slack.send_message"));
  });

  it("dois itens mantêm a lista marcável e o contador só aparece quando informa", () => {
    const base = { tenantId: "t", decisaoId: "d", textoOriginal: "x", selecionado: true, origemSensivel: false, justificativa: null, marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null };
    const a = { ...base, id: "i1", idx: 0, textoFinal: "Avisar o time", destino: { conector: "slack", ferramenta: "send_message", argumentos: {} } };
    const b = { ...base, id: "i2", idx: 1, textoFinal: "Arquivar a planilha", destino: { conector: "drive", ferramenta: "move_file", argumentos: {} } };
    const e: Estado = { ...estado, suaVez: { ...estado.suaVez!, itens: [{ ...item, decisao: { ...item.decisao, tipo: "aprovacao" }, itensAprovacao: [a, b] }] } };
    const html = renderTimeline(conversa, e);
    expect(html).toContain('class="ap-lista"');
    expect(html).toContain('data-item="i1"');
    expect(html).toContain('data-item="i2"');
    expect(html).toContain("Avisar o time");
    expect(html).toContain("Arquivar a planilha");
    // Tudo marcado e nada sensível: contar "2 de 2" não acrescenta nada.
    expect(html).toContain("Pode fazer");
    expect(html).not.toContain("data-contador");
    // Slug sem conector casado no estado cai no próprio slug, nunca inventa nome.
    expect(html).toContain("no drive");
  });

  it("preserva registro imutável de consentimento recolhido sem repetir o catálogo", () => {
    const m: Mensagem = { tenantId: "t", id: "m", conversaId: "c", turnoId: null, kind: "consentimento", texto: "Registro original <auditoria>", payload: { kind: "consentimento", conectorId: "slack", slug: "slack", capacidade: "SLACK_SEARCH_MESSAGES", naoInclui: ["outras ferramentas"] }, confianca: "confiavel", parcial: false, criadoEm: 0, autoria: { autor_tipo: "pessoa", autor_id: "p", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 } };
    const html = renderMensagem(m, estado);
    expect(html).toContain("Acesso permitido · slack");
    expect(html).toContain("SLACK_SEARCH_MESSAGES");
    expect(html).toContain("Registro original &lt;auditoria&gt;");
    expect(html).toContain("Ver registro de autorização");
    expect(html).not.toContain(" open");
  });

  it("o terceiro botão nomeia a ferramenta e avisa que vale para qualquer destino", () => {
    const i = { tenantId: "t", id: "i", decisaoId: "d", idx: 0, textoOriginal: "Avisar", textoFinal: "Avisar", destino: { conector: "slack", ferramenta: "send_message", argumentos: {} }, selecionado: true, origemSensivel: false, justificativa: null, marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null };
    const e: Estado = { ...estado, suaVez: { ...estado.suaVez!, itens: [{ ...item, decisao: { ...item.decisao, tipo: "aprovacao" }, itensAprovacao: [i] }] } };
    const html = renderTimeline(conversa, e);
    expect(html).toContain('data-act="decidir-aprovacao-sempre"');
    expect(html).toContain("Sempre permitir slack.send_message");
    expect(html).toContain("em qualquer destino");
    expect(html).not.toContain("disabled");
  });

  it("card só com item sensível mostra o botão DESABILITADO com o motivo, nunca ausente", () => {
    const sens = { tenantId: "t", id: "i", decisaoId: "d", idx: 0, textoOriginal: "Rel", textoFinal: "Rel", destino: { conector: "slack", ferramenta: "send_message", argumentos: {} }, selecionado: false, origemSensivel: true, justificativa: "dado de aprendiz", marcadoPor: null, marcadoEm: null, editadoPor: null, desfecho: null, motivoManual: null };
    const e: Estado = { ...estado, suaVez: { ...estado.suaVez!, itens: [{ ...item, decisao: { ...item.decisao, tipo: "aprovacao" }, itensAprovacao: [sens] }] } };
    const html = renderTimeline(conversa, e);
    // ADR-029: a pessoa lê por que não pode, em vez de procurar um botão que sumiu.
    expect(html).toContain('data-act="decidir-aprovacao-sempre"');
    expect(html).toContain("disabled");
    expect(html).toContain("Dado de aprendiz sempre passa por você");
  });

  it("mudança e exclusão de rotina no chat decidem pela decisão, não por propostas/:id/confirmar", () => {
    const base = { tenantId: "t", conversaId: "c", agenteId: "a", estado: "pendente" as const, criadoEm: 0 };
    const propostas: Proposta[] = [
      { ...base, id: "pa", kind: "rotina_atualizacao", payload: { kind: "rotina_atualizacao", rotinaId: "r1", cron: "0 9 * * *", resumo: "todo dia às 09:00", fusoIana: "America/Sao_Paulo", proximaExecucao: 0, antes: { resumo: "a cada 5 min", instrucao: "x" } } as Proposta["payload"] },
      { ...base, id: "pe", kind: "rotina_exclusao", payload: { kind: "rotina_exclusao", rotinaId: "r2", resumo: "a cada 15 min", instrucao: "y" } },
    ];
    const html = renderTimeline({ ...conversa, propostas }, { ...estadoInicial });
    expect(html).not.toContain('data-act="confirmar-proposta"');
    expect(html).not.toContain('data-act="recusar-proposta"');
    expect(html).toContain("Aplicar mudança");
    expect(html).toContain("Excluir rotina");
    expect(html.match(/data-act="decidir-proposta"/g)).toHaveLength(2);
    expect(html.match(/data-act="recusar-decisao"/g)).toHaveLength(2);
  });

  it("proposta de rotina com decisão vencida sai do chat e dá lugar à decisão vencida com Reabrir", () => {
    const proposta: Proposta = { tenantId: "t", id: "d", conversaId: "c", agenteId: "a", estado: "pendente", criadoEm: 0, kind: "rotina_exclusao", payload: { kind: "rotina_exclusao", rotinaId: "r", resumo: "a cada 15 min", instrucao: "y" } };
    const decisao = { ...item.decisao, tipo: "rotina_exclusao" as const };
    const vencido: Estado = { ...estado, suaVez: { ...estado.suaVez!, itens: [{ ...item, estadoColuna: "vencido", decisao: { ...decisao, estado: "vencida" } }] } };
    const html = renderTimeline({ ...conversa, propostas: [proposta] }, vencido);
    expect(html).not.toContain("Manter rotina");
    expect(html).not.toContain('data-act="decidir-proposta"');
    expect(html).toContain('data-act="reabrir"');

    const reaberta: Estado = { ...estado, suaVez: { ...estado.suaVez!, itens: [{ ...item, estadoColuna: "pendente", decisao: { ...decisao, estado: "reaberta" } }] } };
    const aberto = renderTimeline({ ...conversa, propostas: [proposta] }, reaberta);
    expect(aberto.match(/data-act="decidir-proposta"/g)).toHaveLength(1);
    expect(aberto).toContain("Excluir rotina");
  });

  describe("pedido de acesso em um clique (ADR-044)", () => {
    const FRASE = "Nina precisa ler seu Gmail para a rotina “E-mails às 8h, 13h e 18h”. Não inclui: enviar, apagar, arquivar.";
    const deRotina: Proposta = { tenantId: "t", id: "d", conversaId: "c", agenteId: "a", estado: "pendente", criadoEm: 0, kind: "acesso", payload: { kind: "acesso", conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"], nivel: "leitura", naoPedido: [], turnoId: "t1", rotinaId: "r1" } };
    const comDecisao = (p: Proposta, estadoColuna: "pendente" | "vencido" = "pendente"): Estado => ({
      ...estado,
      suaVez: { ...estado.suaVez!, itens: [{ ...item, estadoColuna, decisao: { ...item.decisao, estado: estadoColuna === "vencido" ? "vencida" : "pendente", frase: FRASE }, proposta: p }] },
    });

    it("pedido de rotina: a frase do domínio, 'Permitir e rodar agora' / 'Pausar rotina' pela decisão, e as ferramentas só no <details>", () => {
      const html = renderTimeline({ ...conversa, propostas: [deRotina] }, comDecisao(deRotina));
      expect(html).toContain("Nina precisa ler seu Gmail");
      expect(html).toContain("Permitir e rodar agora");
      expect(html).toContain("Pausar rotina");
      expect(html.match(/data-act="decidir-proposta"/g)).toHaveLength(1);
      expect(html.match(/data-act="recusar-decisao"/g)).toHaveLength(1);
      expect(html).not.toContain('data-act="confirmar-proposta"');
      expect(html).not.toContain("Revisar acesso");
      // O card da proposta e o item da decisão são o MESMO pedido: aparece uma vez só.
      expect(html).not.toContain("Preciso da sua decisão para continuar");
      expect(html.indexOf("<details")).toBeLessThan(html.indexOf("GMAIL_FETCH_EMAILS"));
      expect(html).toContain("Ver as 2 ações pedidas");
    });

    it("pedido da conversa: 'Permitir e continuar' / 'Não permitir'", () => {
      const daConversa: Proposta = { ...deRotina, payload: { kind: "acesso", conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS"], nivel: "leitura", naoPedido: [], turnoId: "t1" } };
      const html = renderTimeline({ ...conversa, propostas: [daConversa] }, comDecisao(daConversa));
      expect(html).toContain("Permitir e continuar");
      expect(html).toContain("Não permitir");
      expect(html).toContain("Ver a ação pedida");
    });

    it("pedido anterior, sem decisão em Sua vez, continua com 'Revisar acesso'", () => {
      const html = renderTimeline({ ...conversa, propostas: [deRotina] }, { ...estadoInicial });
      expect(html).toContain('data-act="confirmar-proposta"');
      expect(html).toContain("Revisar acesso");
      expect(html).not.toContain('data-act="decidir-proposta"');
    });

    it("decisão de acesso vencida tira o card e deixa a decisão vencida com Reabrir", () => {
      const html = renderTimeline({ ...conversa, propostas: [deRotina] }, comDecisao(deRotina, "vencido"));
      expect(html).not.toContain("Pausar rotina");
      expect(html).not.toContain('data-act="decidir-proposta"');
      expect(html).toContain('data-act="reabrir"');
    });

    it("card de conexão leva o nível para o botão (leitura vira card de um clique; escrita volta ao agente)", () => {
      const conectar: Proposta = { ...deRotina, id: "k", payload: { kind: "acesso", conector: "gmail", conectar: true, capacidades: [], nivel: "leitura", naoPedido: [], rotinaId: "r1" } };
      const conectado: Estado = { ...estadoInicial, conectores: [{ tenantId: "t", id: "cx", ownerId: "p", visibility: "privado", nome: "Gmail", slug: "gmail", transporte: "http", comando: null, args: [], url: null, env: {}, declaracao: "nao-toca", habilitado: true, catalogo: [], sondadoEm: null, ultimaFalha: null, criadoEm: 0 }] };
      const html = renderTimeline({ ...conversa, propostas: [conectar] }, conectado);
      expect(html).toContain('data-act="retomar-conexao"');
      expect(html).toContain('data-nivel="leitura"');
    });

    it("'Sua vez' usa os mesmos rótulos, vindos de item.proposta, e mostra as ações pedidas no <details>", () => {
      const html = renderSuaVez(comDecisao(deRotina));
      expect(html).toContain("Permitir e rodar agora");
      expect(html).toContain("Pausar rotina");
      expect(html).toContain("Ver as 2 ações pedidas");
      expect(renderSuaVez(estado)).toContain("Permitir e continuar");
    });

    it("consentimento em lote mostra a contagem; o registro com cada ferramenta fica recolhido", () => {
      const m: Mensagem = { tenantId: "t", id: "m", conversaId: "c", turnoId: null, kind: "consentimento", texto: "Concedido por Marlon em 2026-09-24 12:00 UTC: gmail.GMAIL_FETCH_EMAILS, gmail.GMAIL_LIST_LABELS; não inclui: …", payload: { kind: "consentimento", conectorId: "cx", slug: "gmail", capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"], naoInclui: [] }, confianca: "confiavel", parcial: false, criadoEm: 0, autoria: { autor_tipo: "pessoa", autor_id: "p", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 } };
      const html = renderMensagem(m, estado);
      expect(html).toContain("Acesso permitido · gmail");
      expect(html).toContain("2 ações");
      expect(html.indexOf("<details")).toBeLessThan(html.indexOf("GMAIL_FETCH_EMAILS"));
    });
  });

  it("× só onde dispensar vale: vencida sempre, aberta só se responde com texto; 'Limpar vencidos' a partir de duas", () => {
    const vencida = (id: string): typeof item => ({ ...item, estadoColuna: "vencido", decisao: { ...item.decisao, id, estado: "vencida", tipo: "falta_de_dado" } });
    const falta: typeof item = { ...item, decisao: { ...item.decisao, id: "f", tipo: "falta_de_dado" } };
    const com = (itens: (typeof item)[]): Estado => ({ ...estado, suaVez: { ...estado.suaVez!, itens } });

    const aberta = renderDecisoesDaConversa(com([item]), "c", new Set());
    expect(aberta).not.toContain('data-act="dispensar"');
    expect(renderDecisoesDaConversa(com([falta]), "c", new Set())).toContain('data-act="dispensar" data-id="f"');

    const uma = renderDecisoesDaConversa(com([vencida("v1")]), "c", new Set());
    expect(uma).toContain('data-act="dispensar" data-id="v1"');
    expect(uma).not.toContain("Limpar vencidos");

    const duas = renderDecisoesDaConversa(com([falta, vencida("v1"), vencida("v2")]), "c", new Set());
    expect(duas).toContain("Limpar vencidos (2)");
    expect(duas).toContain('data-ids="v1,v2"');
  });
});
