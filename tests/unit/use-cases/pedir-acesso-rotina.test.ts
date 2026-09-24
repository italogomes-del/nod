import { describe, expect, it } from "vitest";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { dispararRotina } from "../../../src/use-cases/disparar-rotina.ts";
import { pedirAcesso } from "../../../src/use-cases/pedir-acesso.ts";
import { depsEmMemoria, esperarErro } from "../../helpers/deps-l6.ts";

/**
 * ADR-044, visto com a Nina: a rotina que lê o Gmail não tinha acesso, pedir_acesso não estava no
 * catálogo da rotina e o prompt mandava "informar o bloqueio" — ela abria um card de texto por
 * execução. Agora o turno de rotina pede por pedir_acesso: só leitura, [] = as ferramentas de leitura
 * do app, e o pedido carrega a rotina para "Permitir e rodar agora".
 */
const INSTRUCAO = "E-mails às 8h, 13h e 18h";

async function cenario(opcoes: { gmailConectado?: boolean } = {}) {
  const { deps, banco } = depsEmMemoria();
  const { data: bot } = await criarAgente(deps, { dono: "pessoa", nome: "Nina" });
  if (opcoes.gmailConectado ?? true) {
    const conector = await deps.repos.conectores.criar({ nome: "Gmail (Composio)", slug: "gmail", transporte: "http", url: "https://example.com/mcp", declaracao: "nao-toca" });
    if (!conector) throw new Error("conector");
    await deps.repos.conectores.registrarSonda(conector.id, {
      ok: true,
      agora: deps.agora(),
      catalogo: [
        { nome: "GMAIL_FETCH_EMAILS", descricao: "Lê e-mails", schema: { type: "object" }, readOnlyHint: true },
        { nome: "GMAIL_LIST_LABELS", descricao: "Lista rótulos", schema: { type: "object" }, readOnlyHint: true },
        { nome: "GMAIL_SEND_EMAIL", descricao: "Envia e-mail", schema: { type: "object" }, readOnlyHint: false },
      ],
    });
    await deps.repos.conectores.habilitar(conector.id, true);
  }
  // A fonte NÃO cita o app: com "Gmail" na fonte o pré-voo (emenda da ADR-044) pararia a janela antes do
  // turno. Aqui o turno roda e descobre no meio que precisa do Gmail — o caminho do pedir_acesso.
  const rotina = await deps.repos.rotinas.criar({ agenteId: bot.agente.id, conversaId: bot.conversa.id, cron: "0 8,13,18 * * *", fusoIana: "America/Sao_Paulo", instrucao: INSTRUCAO, fonte: "a caixa de entrada", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: deps.agora() });
  if (!rotina) throw new Error("rotina");
  const r = await dispararRotina(deps, { rotina, instanteAgendado: deps.agora(), machineId: "m", executor: "catcher" });
  if (!("turno" in r.data)) throw new Error("sem turno");
  const turno = r.data.turno;
  const ctx = { turnoId: turno.id, conversaId: bot.conversa.id, agenteId: bot.agente.id };
  return { deps, banco, bot, rotina, turno, ctx };
}

describe("pedir_acesso num turno de rotina (ADR-044)", () => {
  it("[] com o app conectado vira as ferramentas de LEITURA; proposta e decisão de mesmo id, com a frase da rotina", async () => {
    const c = await cenario();
    const r = await pedirAcesso(c.deps, { ...c.ctx, conector: "gmail", capacidades: [], nivel: "leitura", nao_pedido: [] });
    expect(r.data).toEqual({ proposta_id: expect.any(String), estado: "aguardando_pessoa", instrucao: "o acesso ainda NÃO foi concedido: diga que pediu e encerre o turno" });
    const proposta = c.banco.propostas.find((p) => p.id === r.data.proposta_id);
    expect(proposta?.payload).toEqual({ kind: "acesso", turnoId: c.turno.id, conector: "gmail", capacidades: ["GMAIL_FETCH_EMAILS", "GMAIL_LIST_LABELS"], nivel: "leitura", naoPedido: [], rotinaId: c.rotina.id });
    const decisao = c.banco.decisoes.find((d) => d.id === r.data.proposta_id);
    expect(decisao).toMatchObject({ tipo: "acesso", estado: "pendente", turnoId: c.turno.id, agenteId: c.bot.agente.id });
    expect(decisao?.frase).toBe(`Nina precisa ler seu Gmail para a rotina “${INSTRUCAO}”. Não inclui: enviar, apagar, arquivar.`);
    expect(r.events?.map((e) => e.kind)).toEqual(["proposta_criada", "decisao_criada"]);
    expect(c.banco.concessoes).toHaveLength(0);
  });

  it("escrita é nao_permitido na rotina — pelo nível e pela ferramenta — e nada nasce", async () => {
    const c = await cenario();
    await esperarErro(() => pedirAcesso(c.deps, { ...c.ctx, conector: "gmail", capacidades: [], nivel: "escrita", nao_pedido: [] }), "nao_permitido");
    await esperarErro(() => pedirAcesso(c.deps, { ...c.ctx, conector: "gmail", capacidades: ["GMAIL_SEND_EMAIL"], nivel: "leitura", nao_pedido: [] }), "nao_permitido");
    expect(c.banco.propostas).toHaveLength(0);
    expect(c.banco.decisoes).toHaveLength(0);
  });

  it("app ainda não conectado: só o card de conexão, com a rotina junto; sem decisão", async () => {
    const c = await cenario({ gmailConectado: false });
    const r = await pedirAcesso(c.deps, { ...c.ctx, conector: "gmail", capacidades: [], nivel: "leitura", nao_pedido: [] });
    expect(r.data.estado).toBe("aguardando_pessoa");
    expect(c.banco.propostas.find((p) => p.id === r.data.proposta_id)?.payload).toMatchObject({ conectar: true, capacidades: [], rotinaId: c.rotina.id });
    expect(c.banco.decisoes).toHaveLength(0);
    expect(r.events?.map((e) => e.kind)).toEqual(["proposta_criada"]);
  });

  it("a retomada de um turno de rotina continua sendo da rotina: o pedido dela é o mesmo pedido", async () => {
    const c = await cenario();
    const primeiro = await pedirAcesso(c.deps, { ...c.ctx, conector: "gmail", capacidades: [], nivel: "leitura", nao_pedido: [] });
    const retomada = await c.deps.repos.turnos.enfileirar({ conversaId: c.bot.conversa.id, agenteId: c.bot.agente.id, origem: "retomada", retomaTurnoId: c.turno.id, prazoEm: c.deps.agora() + 60_000, profundidade: 0, entradaTexto: "continue", entradaConfianca: "confiavel", modelo: "sonnet" });
    const deNovo = await c.deps.repos.turnos.enfileirar({ conversaId: c.bot.conversa.id, agenteId: c.bot.agente.id, origem: "retomada", retomaTurnoId: retomada?.id ?? "", prazoEm: c.deps.agora() + 60_000, profundidade: 0, entradaTexto: "continue", entradaConfianca: "confiavel", modelo: "sonnet" });
    const segundo = await pedirAcesso(c.deps, { ...c.ctx, turnoId: deNovo?.id ?? "", conector: "gmail", capacidades: [], nivel: "leitura", nao_pedido: [] });
    expect(segundo.data.proposta_id).toBe(primeiro.data.proposta_id);
    // E na cadeia a regra de nível também vale.
    await esperarErro(() => pedirAcesso(c.deps, { ...c.ctx, turnoId: deNovo?.id ?? "", conector: "gmail", capacidades: [], nivel: "escrita", nao_pedido: [] }), "nao_permitido");
  });

  it("pedido cuja decisão venceu não conta: o disparo seguinte abre um card novo em vez de apontar para um que saiu da tela", async () => {
    const c = await cenario();
    const primeiro = await pedirAcesso(c.deps, { ...c.ctx, conector: "gmail", capacidades: [], nivel: "leitura", nao_pedido: [] });
    await c.deps.repos.decisoes.vencerPendentes(c.deps.agora() + 2 * 86_400_000);
    const depois = await pedirAcesso(c.deps, { ...c.ctx, conector: "gmail", capacidades: [], nivel: "leitura", nao_pedido: [] });
    expect(depois.data.proposta_id).not.toBe(primeiro.data.proposta_id);
    expect(c.banco.decisoes.find((d) => d.id === depois.data.proposta_id)?.estado).toBe("pendente");
  });
});
