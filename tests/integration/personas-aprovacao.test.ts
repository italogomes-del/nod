import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ModoAprovacao } from "../../src/contracts/agente.ts";
import type { CapacidadeConector } from "../../src/contracts/conector.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { Turno } from "../../src/contracts/turno.ts";
import { capacidadesDoNivel } from "../../src/domain/grupos-de-acesso.ts";
import { NATIVAS_DO_TERMINAL } from "../../src/domain/nativas.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Repos } from "../../src/repositories/tipos.ts";
import type { Tx } from "../../src/shared/types.ts";
import { autorizarComando } from "../../src/use-cases/autorizar-comando.ts";
import { chamarFerramenta, type ResultadoChamada } from "../../src/use-cases/chamar-ferramenta.ts";
import { decidir } from "../../src/use-cases/decidir.ts";
import { decidirAcesso } from "../../src/use-cases/decidir-acesso.ts";
import { dispararRotina } from "../../src/use-cases/disparar-rotina.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { entregarRespostaPeer } from "../../src/use-cases/entregar-resposta-peer.ts";
import { liberarNaTarefa } from "../../src/use-cases/liberar-na-tarefa.ts";
import { mudarModoAprovacao } from "../../src/use-cases/mudar-modo-aprovacao.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { permitirSempre } from "../../src/use-cases/permitir-sempre.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_LEAPY } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste, useCasesDeTeste, type ChamadaConector } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * O sistema de aprovações contra três PERSONAS, sobre o código real (casos de uso + Postgres sob withRollback).
 * Onde o fluxo real passa pelo modelo, o teste faz as chamadas de ferramenta que o modelo faria, pelo MESMO
 * caminho do proxy (`chamarFerramenta` com o plano emitido por `emitirPlanoTurno`). Nada aqui é mock de regra:
 * o conector é o falso da L5 (registra a chamada), o resto é o servidor.
 *
 * - Rita — conservadora, bot em MANUAL. Quer card antes de toda escrita em app; mas "Sempre permitir" clicado
 *   = nunca mais aquela ação; e leitura de um app aprovada = nenhum outro card de leitura do mesmo app.
 * - Marlon — lê às vezes, bot em AUTOMÁTICO. O bot trabalha sozinho (lê e escreve no ClickUp/Slack que ele
 *   conectou) e só para no arriscado (apagar, merge, credencial). Clicou "Sempre permitir" em comentar e criar
 *   task no ClickUp. Os bots dele leem ClickUp, Slack e e-mail o tempo todo e conversam entre si (pedir_a_bot).
 * - Bruno — autonomia total, bot em TOTAL ("Ignorar todas as aprovações"). Nunca quer card, exceto credencial.
 *
 * Os testes ASSERTAM O COMPORTAMENTO ATUAL. Foram escritos sobre a main em 024b1ac (2026-09-30) e revistos com a
 * Onda 1 da ADR-062 — onde o comportamento mudou, o comentário diz "ADR-062". Onde ele ainda diverge da expectativa
 * da persona (leitura por app e "Sempre permitir" por grupo ficam para a Onda 2) há um "ESPERADO PELA PERSONA: …".
 *
 * A persona é o MODO do bot. As três rodam sob a identidade do Marlon (ids.ts) — o caminho de aprovação não olha
 * quem é a pessoa, só o dono do bot e o modo dele. Cada bot tem um colega do mesmo dono, no mesmo modo.
 * Conectores são cadastrados como os do marketplace (`declaracao: "toca"`, rotas/marketplace.ts). ClickUp e Slack
 * usam o slug de verdade, porque é por ele que a curadoria de conteúdo de fora os reconhece (ADR-062); o GitHub, um
 * slug único, porque `github` é o nativo que roda no Mac (ADR-048) — e ele continua sendo de fora. Concessão inicial = "Ler e alterar" do ClickUp (capacidadesDoNivel 'escrita', sem apagar) e o merge
 * do GitHub dado pelo nome; o Slack começa sem acesso.
 */
const ESCOPO = { tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON };
const JANELA = Date.parse("2026-09-30T11:00:00Z");

type NomePersona = "Rita" | "Marlon" | "Bruno";
type Persona = { nome: NomePersona; modo: ModoAprovacao };
const RITA: Persona = { nome: "Rita", modo: "manual" };
const MARLON: Persona = { nome: "Marlon", modo: "automatico" };
const BRUNO: Persona = { nome: "Bruno", modo: "total" };
const PERSONAS: Persona[] = [RITA, MARLON, BRUNO];

/** O que a pessoa vê: a ação rodou sem card (e sob qual regra), virou card (com o motivo de cada item), ou a chamada direta rodou/foi negada. */
type Resultado =
  | { tipo: "roda"; regra: string }
  | { tipo: "card"; motivos: (string | null)[] }
  | { tipo: "executou" }
  | { tipo: "negado"; motivo: string };
const roda = (regra: string): Resultado => ({ tipo: "roda", regra });
const card = (...motivos: (string | null)[]): Resultado => ({ tipo: "card", motivos });
const EXECUTOU: Resultado = { tipo: "executou" };
const negado = (motivo: string): Resultado => ({ tipo: "negado", motivo });

type App = "clickup" | "slack" | "github";
const cap = (nome: string, readOnlyHint = false): CapacidadeConector => ({ nome, descricao: nome.toLowerCase(), schema: { type: "object" }, readOnlyHint });
const CATALOGO: Record<App, CapacidadeConector[]> = {
  clickup: [cap("CLICKUP_GET_TASK", true), cap("CLICKUP_GET_TASK_COMMENTS", true), cap("CLICKUP_CREATE_TASK_COMMENT"), cap("CLICKUP_CREATE_TASK"), cap("CLICKUP_UPDATE_TASK"), cap("CLICKUP_DELETE_TASK")],
  slack: [cap("SLACK_SEARCH_MESSAGES", true), cap("SLACK_FETCH_CONVERSATION_HISTORY", true), cap("SLACK_SEND_MESSAGE")],
  github: [cap("GITHUB_GET_A_PULL_REQUEST", true), cap("GITHUB_MERGE_A_PULL_REQUEST")],
};
const NOME_APP: Record<App, string> = { clickup: "ClickUp", slack: "Slack", github: "GitHub" };

type Bot = { agenteId: string; conversaId: string; nome: string };
type Mundo = { trx: Tx; deps: Deps; repos: Repos; chamadas: ChamadaConector[]; persona: Persona; bot: Bot; colega: Bot; slug: Record<App, string>; conectorId: Record<App, string> };

async function montar(trx: Tx, persona: Persona, opcoes: { semprePermitir?: string[] } = {}): Promise<Mundo> {
  const repos = criarRepos(trx, ESCOPO);
  const chamadas: ChamadaConector[] = [];
  const deps = depsSobre(repos, ESCOPO, { services: servicosDeTeste({ chamadas }), useCases: useCasesDeTeste({ pedirABot }), trx });
  const bot = { ...(await agenteComConversa(trx, ESCOPO, { nome: `${persona.nome} Bot` })), nome: `${persona.nome} Bot` };
  const colega = { ...(await agenteComConversa(trx, ESCOPO, { nome: `${persona.nome} Colega` })), nome: `${persona.nome} Colega` };
  for (const a of [bot, colega]) await repos.agentes.atualizarPerfil(a.agenteId, { confirmado: true });
  const sufixo = randomUUID().slice(0, 8);
  const slug: Record<App, string> = { clickup: "clickup", slack: "slack", github: `github-${sufixo}` };
  const conector = async (app: App): Promise<string> => {
    const criado = await repos.conectores.criar({ nome: NOME_APP[app], slug: slug[app], transporte: "stdio", comando: "node", declaracao: "toca" });
    const sondado = await repos.conectores.registrarSonda(criado?.id ?? "", { ok: true, catalogo: CATALOGO[app], agora: Date.now() });
    if (!sondado) throw new Error(`conector ${app}`);
    return sondado.id;
  };
  const conectorId: Record<App, string> = { clickup: await conector("clickup"), slack: await conector("slack"), github: await conector("github") };
  const m: Mundo = { trx, deps, repos, chamadas, persona, bot, colega, slug, conectorId };
  for (const a of [bot, colega]) {
    await conceder(m, a, "clickup", capacidadesDoNivel(CATALOGO.clickup, "escrita"));
    await conceder(m, a, "github", ["GITHUB_GET_A_PULL_REQUEST", "GITHUB_MERGE_A_PULL_REQUEST"]);
  }
  // O "Sempre permitir" nasce de um card de verdade, clicado quando o bot ainda estava no manual (no automático e
  // no total não há card onde clicar); depois a dona escolhe o modo da persona.
  if (opcoes.semprePermitir?.length) await clicarSemprePermitir(m, opcoes.semprePermitir);
  for (const a of [bot, colega]) await mudarModoAprovacao(deps, { agenteId: a.agenteId, modo: persona.modo });
  expect((await repos.agentes.buscar(bot.agenteId))?.modoAprovacao).toBe(persona.modo);
  return m;
}

async function conceder(m: Mundo, a: Bot, app: App, capacidades: readonly string[]): Promise<void> {
  const consentimento = await m.repos.mensagens.criar({ conversaId: a.conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "consentimento", texto: `Permitir ${app}`, confianca: "confiavel" });
  for (const capacidade of capacidades) await m.repos.concessoes.conceder({ agenteId: a.agenteId, conectorId: m.conectorId[app], capacidade, mensagemId: consentimento?.id ?? "" });
}

async function turnoConversa(m: Mundo, o: { agente?: Bot; retomaTurnoId?: string } = {}): Promise<Turno> {
  const a = o.agente ?? m.bot;
  const t = await m.repos.turnos.enfileirar({ conversaId: a.conversaId, agenteId: a.agenteId, origem: o.retomaTurnoId ? "retomada" : "conversa", retomaTurnoId: o.retomaTurnoId ?? null, prazoEm: Date.now() + 3_600_000, profundidade: 0, entradaTexto: "comenta na task 86abc que o deploy saiu", entradaConfianca: "confiavel", modelo: "m" });
  if (!t) throw new Error("turno");
  return t;
}

/** O turno está rodando (o proxy segura a espera de pedir_aprovacao dentro dele). */
async function vivo(m: Mundo, turnoId: string): Promise<void> {
  await m.trx`update turnos set estado = 'despachando' where id = ${turnoId}`;
}

async function plano(m: Mundo, turnoId: string): Promise<PlanoTurno> {
  return (await emitirPlanoTurno(m.deps, { turnoId, machineId: randomUUID(), executor: "catcher" })).data;
}

async function turnoDeRotina(m: Mundo, fonte: string): Promise<Turno> {
  const rotina = await m.repos.rotinas.criar({ agenteId: m.bot.agenteId, conversaId: m.bot.conversaId, cron: "0 8 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: "Resumo das tasks do dia", fonte, entregavel: "chat", limitesAprovacao: "", politicaSemDado: "", proximaExecucao: JANELA });
  if (!rotina) throw new Error("rotina");
  // A rotina nasce com exige_aprovacao = true (default da 0002; não há tela para desligar — ADR-059).
  expect(rotina.exigeAprovacao).toBe(true);
  const r = await dispararRotina(m.deps, { rotina, instanteAgendado: JANELA, machineId: randomUUID(), executor: "catcher" });
  if (!("turno" in r.data)) throw new Error(`a rotina não disparou: ${JSON.stringify(r.data)}`);
  return r.data.turno;
}

async function decisoesDoTurno(m: Mundo, turnoId: string): Promise<{ id: string; desfecho: { tipo: string; regra?: string } | null }[]> {
  return m.trx<{ id: string; desfecho: { tipo: string; regra?: string } | null }[]>`select id, desfecho from decisoes where turno_id = ${turnoId}`;
}

async function lerResultado(m: Mundo, turnoId: string, antes: readonly { id: string }[], data: ResultadoChamada): Promise<Resultado> {
  if ("aguardar" in data) {
    const itens = await m.repos.itensAprovacao.listar(data.aguardar);
    return card(...[...itens].sort((a, b) => a.idx - b.idx).map((i) => i.motivoManual));
  }
  if ("negacao" in data) return negado(data.negacao.motivo);
  if ("ok" in data && data.ok) {
    expect(JSON.parse(data.conteudo)).toMatchObject({ estado: "decidida" });
    const nova = (await decisoesDoTurno(m, turnoId)).find((d) => !antes.some((x) => x.id === d.id));
    if (nova?.desfecho?.tipo !== "decidida_por_regra" || !nova.desfecho.regra) throw new Error(`decisão automática sem regra: ${JSON.stringify(nova)}`);
    return roda(nova.desfecho.regra);
  }
  throw new Error(`resultado inesperado: ${JSON.stringify(data)}`);
}

/** O modelo chama pedir_aprovacao pelo proxy: um item por [app, ferramenta]. */
async function pedir(m: Mundo, p: PlanoTurno, itens: readonly [App, string][]): Promise<{ r: Resultado; decisaoId: string | null }> {
  const antes = await decisoesDoTurno(m, p.turnoId);
  const argumentos = { resumo: "Atualizar o trabalho", itens: itens.map(([app, ferramenta]) => ({ texto: `${ferramenta} na 86abc`, destino: { conector: m.slug[app], ferramenta, argumentos: { task_id: "86abc", texto: "deploy saiu" } } })) };
  const c = await chamarFerramenta(m.deps, { turnoId: p.turnoId, agenteId: p.agenteId, nome: "pedir_aprovacao", argumentos, plano: p });
  return { r: await lerResultado(m, p.turnoId, antes, c.data), decisaoId: "aguardar" in c.data ? c.data.aguardar : null };
}
const aprovar = async (m: Mundo, p: PlanoTurno, itens: readonly [App, string][]): Promise<Resultado> => (await pedir(m, p, itens)).r;

/** O modelo chama a ferramenta do conector DIRETO (sem pedir_aprovacao), como o catálogo do plano permite. */
async function direto(m: Mundo, p: PlanoTurno, app: App, ferramenta: string): Promise<Resultado> {
  const c = await chamarFerramenta(m.deps, { turnoId: p.turnoId, agenteId: p.agenteId, nome: `${m.slug[app]}__${ferramenta}`, argumentos: {}, plano: p });
  if ("negacao" in c.data) return negado(c.data.negacao.motivo);
  if ("ok" in c.data && c.data.ok) return EXECUTOU;
  throw new Error(`resultado inesperado: ${JSON.stringify(c.data)}`);
}

async function pedirAcesso(m: Mundo, p: PlanoTurno, app: App, capacidades: string[], nivel: "leitura" | "escrita" = "leitura"): Promise<{ estado: string; proposta_id: string }> {
  const c = await chamarFerramenta(m.deps, { turnoId: p.turnoId, agenteId: p.agenteId, nome: "pedir_acesso", argumentos: { conector: m.slug[app], capacidades, nivel, nao_pedido: [] }, plano: p });
  if (!("ok" in c.data) || !c.data.ok) throw new Error(`pedir_acesso: ${JSON.stringify(c.data)}`);
  return JSON.parse(c.data.conteudo) as { estado: string; proposta_id: string };
}

async function pedirAoColega(m: Mundo, p: PlanoTurno): Promise<Turno> {
  const c = await chamarFerramenta(m.deps, { turnoId: p.turnoId, agenteId: p.agenteId, nome: "pedir_a_bot", argumentos: { agente: m.colega.nome, pedido: "comente na task 86abc o status do deploy" }, plano: p });
  if (!("ok" in c.data) || !c.data.ok) throw new Error(`pedir_a_bot: ${JSON.stringify(c.data)}`);
  const tarefa = await m.repos.turnos.buscar((JSON.parse(c.data.conteudo) as { tarefa_id: string }).tarefa_id);
  if (!tarefa) throw new Error("tarefa");
  return tarefa;
}

async function terminal(m: Mundo, p: PlanoTurno, comando: string): Promise<{ r: Resultado; decisaoId: string | null }> {
  // O kit do terminal é do harness Claude Code real (executor local); a decisão de cada comando só olha nativas,
  // confiança, contaminação, gate e o modo ATUAL do agente — o resto do plano é o mesmo.
  const a = await autorizarComando(m.deps, { plano: { ...p, nativas: [...NATIVAS_DO_TERMINAL] }, comando });
  if ("aguardar" in a.data) {
    const [item] = await m.repos.itensAprovacao.listar(a.data.aguardar);
    return { r: card(item?.motivoManual ?? null), decisaoId: a.data.aguardar };
  }
  return { r: roda(a.data.porque), decisaoId: null };
}

/** A pessoa clica "Sempre permitir" num card real de pedir_aprovacao (a rota faz decidir + permitirSempre). */
async function clicarSemprePermitir(m: Mundo, ferramentas: readonly string[]): Promise<void> {
  const t = await turnoConversa(m);
  await vivo(m, t.id);
  const { r, decisaoId } = await pedir(m, await plano(m, t.id), ferramentas.map((f) => ["clickup", f] as [App, string]));
  expect(r.tipo).toBe("card");
  await decidir(m.deps, { decisaoId: decisaoId ?? "" });
  const itens = await m.repos.itensAprovacao.listar(decisaoId ?? "");
  expect((await permitirSempre(m.deps, { decisaoId: decisaoId ?? "", itemIds: itens.map((i) => i.id) })).data.criadas).toHaveLength(ferramentas.length);
  await m.repos.turnos.assentar(t.id, { estado: "concluido" });
}

describeIntegracao("personas × aprovações (Rita manual · Marlon automático · Bruno total)", () => {
  describe("1. escrita no ClickUp num turno de conversa confiável, sem regra permanente", () => {
    const ATUAL: Record<NomePersona, Resultado> = {
      Rita: card("sem_regra_permanente"),
      Marlon: roda("regra:modo_automatico"),
      Bruno: roda("regra:modo_total"),
    };
    it.each(PERSONAS)("$nome ($modo): pedir_aprovacao(CLICKUP_CREATE_TASK_COMMENT)", async (persona) => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, persona);
        const p = await plano(m, (await turnoConversa(m)).id);
        expect(p.catalogo.ferramentas.map((f) => f.nome)).toContain(`${m.slug.clickup}__CLICKUP_CREATE_TASK_COMMENT`);
        expect(await aprovar(m, p, [["clickup", "CLICKUP_CREATE_TASK_COMMENT"]])).toEqual(ATUAL[persona.nome]);
      });
    });

    it.each(PERSONAS)("$nome ($modo): a mesma escrita chamada DIRETO pelo modelo passa pela mesma decisão do card", async (persona) => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, persona);
        const p = await plano(m, (await turnoConversa(m)).id);
        // ADR-062: antes, no manual, a chamada direta ia ao conector sem card (só o prompt mandava usar pedir_aprovacao).
        // Agora quem não passaria sozinho no card recebe "peça aprovação" e o modelo refaz por pedir_aprovacao.
        const ATUAL: Record<NomePersona, Resultado> = { Rita: negado("alcance_insuficiente"), Marlon: EXECUTOU, Bruno: EXECUTOU };
        expect(await direto(m, p, "clickup", "CLICKUP_CREATE_TASK_COMMENT")).toEqual(ATUAL[persona.nome]);
        expect(m.chamadas.map((c) => c.tool)).toEqual(persona.modo === "manual" ? [] : ["CLICKUP_CREATE_TASK_COMMENT"]);
      });
    });
  });

  describe("2. a mesma escrita depois de o turno trazer conteúdo de fora", () => {
    it.each(PERSONAS)("$nome ($modo): depois de LER o ClickUp pelo conector o turno não é marcado — nada muda", async (persona) => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, persona);
        const t = await turnoConversa(m);
        const p = await plano(m, t.id);
        expect(await direto(m, p, "clickup", "CLICKUP_GET_TASK")).toEqual(EXECUTOU);
        // O resultado do conector volta 'nao_confiavel' ao modelo (ADR-026), mas só a web pelas nativas contamina (0033).
        expect(await m.repos.turnos.contaminado(t.id)).toBe(false);
        const ATUAL: Record<NomePersona, Resultado> = { Rita: card("sem_regra_permanente"), Marlon: roda("regra:modo_automatico"), Bruno: roda("regra:modo_total") };
        expect(await aprovar(m, p, [["clickup", "CLICKUP_CREATE_TASK_COMMENT"]])).toEqual(ATUAL[persona.nome]);
        expect(await direto(m, p, "clickup", "CLICKUP_UPDATE_TASK")).toEqual(persona.modo === "manual" ? negado("alcance_insuficiente") : EXECUTOU);
      });
    });

    it.each(PERSONAS)("$nome ($modo): depois da RESPOSTA de um colega (pedir_a_bot) a continuação é confiável e no modo conversa", async (persona) => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, persona);
        const t = await turnoConversa(m);
        const tarefa = await pedirAoColega(m, await plano(m, t.id));
        await m.repos.turnos.assentar(tarefa.id, { estado: "concluido" });
        const entrega = await entregarRespostaPeer(m.deps, { tarefaId: tarefa.id, texto: "Levantei: 3 tasks atrasadas, a 86abc é a do deploy." });
        if (!("continuacao" in entrega.data)) throw new Error("sem continuação");
        const p = await plano(m, entrega.data.continuacao.id);
        expect({ confianca: p.confiancaEntrada, modo: p.modoTurno }).toEqual({ confianca: "confiavel", modo: "conversa" });
        const ATUAL: Record<NomePersona, Resultado> = { Rita: card("sem_regra_permanente"), Marlon: roda("regra:modo_automatico"), Bruno: roda("regra:modo_total") };
        expect(await aprovar(m, p, [["clickup", "CLICKUP_CREATE_TASK_COMMENT"]])).toEqual(ATUAL[persona.nome]);
      });
    });

    it.each(PERSONAS)("$nome ($modo): depois da resposta de um colega que leu a WEB, a continuação herda a marca", async (persona) => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, persona);
        const t = await turnoConversa(m);
        const tarefa = await pedirAoColega(m, await plano(m, t.id));
        await m.repos.turnos.contaminar(tarefa.id, Date.now());
        await m.repos.turnos.assentar(tarefa.id, { estado: "concluido" });
        const entrega = await entregarRespostaPeer(m.deps, { tarefaId: tarefa.id, texto: "Achei na web: o deploy saiu." });
        if (!("continuacao" in entrega.data)) throw new Error("sem continuação");
        // ADR-062: antes a continuação nascia limpa — pedir a um colega lavava a página que ele leu.
        expect(await m.repos.turnos.contaminado(entrega.data.continuacao.id)).toBe(true);
        const p = await plano(m, entrega.data.continuacao.id);
        const ATUAL: Record<NomePersona, Resultado> = { Rita: card("regra_suspensa_conteudo_nao_confiavel"), Marlon: card("regra_suspensa_conteudo_nao_confiavel"), Bruno: roda("regra:modo_total") };
        expect(await aprovar(m, p, [["clickup", "CLICKUP_CREATE_TASK_COMMENT"]])).toEqual(ATUAL[persona.nome]);
      });
    });

    it.each(PERSONAS)("$nome ($modo): depois da web, a RETOMADA do card continua marcada", async (persona) => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, persona);
        const t = await turnoConversa(m);
        const p = await plano(m, t.id);
        await m.repos.turnos.contaminar(t.id, Date.now());
        const { decisaoId } = await pedir(m, p, [["clickup", "CLICKUP_UPDATE_TASK"]]);
        if (!decisaoId) {
          expect(persona.modo).toBe("total");
          return;
        }
        // O turno não está vivo: a decisão abre a retomada (a sessão volta pelo --resume, com a página no contexto).
        const d = await decidir(m.deps, { decisaoId });
        const retomada = d.data.turnoRetomadaId ?? "";
        // ADR-062: antes a retomada nascia limpa, e o número de cards dependia de quanto a pessoa demorava.
        expect(await m.repos.turnos.contaminado(retomada)).toBe(true);
        expect(await aprovar(m, await plano(m, retomada), [["clickup", "CLICKUP_CREATE_TASK_COMMENT"]])).toEqual(card("regra_suspensa_conteudo_nao_confiavel"));
      });
    });

    it.each(PERSONAS)("$nome ($modo): depois de ler a WEB pelas nativas (turno contaminado)", async (persona) => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, persona);
        const t = await turnoConversa(m);
        const p = await plano(m, t.id);
        // O que POST /interno/nativas faz para WebFetch/WebSearch (NATIVAS_QUE_CONTAMINAM).
        await m.repos.turnos.contaminar(t.id, Date.now());
        const ATUAL: Record<NomePersona, Resultado> = {
          Rita: card("regra_suspensa_conteudo_nao_confiavel"),
          // ESPERADO PELA PERSONA (Marlon): comentar no ClickUp dele sem card — ele só quer parar no arriscado. A ADR-059
          // escolheu parar tudo depois de conteúdo de fora no automático ("quem quer seguir escolhe o total").
          Marlon: card("regra_suspensa_conteudo_nao_confiavel"),
          Bruno: roda("regra:modo_total"),
        };
        expect(await aprovar(m, p, [["clickup", "CLICKUP_CREATE_TASK_COMMENT"]])).toEqual(ATUAL[persona.nome]);
        // A chamada direta é negada em TODO modo, até no total: o modelo recebe a negação e tem de refazer por pedir_aprovacao.
        expect(await direto(m, p, "clickup", "CLICKUP_CREATE_TASK_COMMENT")).toEqual(negado("alcance_insuficiente"));
      });
    });
  });

  describe("3. \"Sempre permitir\" clicado", () => {
    it("Rita (manual): o clique vale já no turno que está rodando, na retomada e nos próximos turnos", async () => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, RITA);
        const t1 = await turnoConversa(m);
        await vivo(m, t1.id);
        const p1 = await plano(m, t1.id);
        const primeiro = await pedir(m, p1, [["clickup", "CLICKUP_CREATE_TASK_COMMENT"]]);
        expect(primeiro.r).toEqual(card("sem_regra_permanente"));
        // O clique: aprova este item E grava a regra (rotas/decisoes.ts: decidir + permitirSempre).
        const d = await decidir(m.deps, { decisaoId: primeiro.decisaoId ?? "" });
        expect(d.data.turnoRetomadaId).toBeNull(); // o turno vivo recebe a decisão no long-poll
        const itens = await m.repos.itensAprovacao.listar(primeiro.decisaoId ?? "");
        expect((await permitirSempre(m.deps, { decisaoId: primeiro.decisaoId ?? "", itemIds: itens.map((i) => i.id) })).data.criadas).toHaveLength(1);

        // MESMO turno, comentário em outra task. ADR-062: a regra é lida na hora (regras-vivas.ts); antes era a lista
        // congelada no plano, e o card voltava até o turno acabar (o do print do Milton saiu 34 s depois do clique).
        expect(await aprovar(m, p1, [["clickup", "CLICKUP_CREATE_TASK_COMMENT"]])).toEqual(roda("regra:aprovacao_permanente"));

        // Retomada do mesmo trabalho (turno novo, plano novo): a regra vale.
        const retomada = await turnoConversa(m, { retomaTurnoId: t1.id });
        expect(await aprovar(m, await plano(m, retomada.id), [["clickup", "CLICKUP_CREATE_TASK_COMMENT"]])).toEqual(roda("regra:aprovacao_permanente"));
        // Próximo turno: vale.
        const t2 = await turnoConversa(m);
        expect(await aprovar(m, await plano(m, t2.id), [["clickup", "CLICKUP_CREATE_TASK_COMMENT"]])).toEqual(roda("regra:aprovacao_permanente"));
        // Próximo turno depois de ler o ClickUp pelo conector: vale (conector não contamina).
        const t3 = await turnoConversa(m);
        const p3 = await plano(m, t3.id);
        await direto(m, p3, "clickup", "CLICKUP_GET_TASK");
        expect(await aprovar(m, p3, [["clickup", "CLICKUP_CREATE_TASK_COMMENT"]])).toEqual(roda("regra:aprovacao_permanente"));
        // Próximo turno depois da web: a regra cai (ADR-042 claim 6).
        // ESPERADO PELA PERSONA: literalmente "não quer ver de novo"; como é conservadora, a pausa depois da web é aceitável.
        const t4 = await turnoConversa(m);
        const p4 = await plano(m, t4.id);
        await m.repos.turnos.contaminar(t4.id, Date.now());
        expect(await aprovar(m, p4, [["clickup", "CLICKUP_CREATE_TASK_COMMENT"]])).toEqual(card("regra_suspensa_conteudo_nao_confiavel"));
      });
    });

    it.each([MARLON, BRUNO])("$nome ($modo): a regra ganha do modo na conversa; depois da web só o total segue", async (persona) => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, persona, { semprePermitir: ["CLICKUP_CREATE_TASK_COMMENT", "CLICKUP_CREATE_TASK"] });
        const t2 = await turnoConversa(m);
        const p2 = await plano(m, t2.id);
        expect(p2.semprePermitir).toEqual(expect.arrayContaining([`${m.slug.clickup}__CLICKUP_CREATE_TASK_COMMENT`, `${m.slug.clickup}__CLICKUP_CREATE_TASK`]));
        // A regra permanente é conferida ANTES do modo (aprovacao-permanente.ts passo 8): é ela que assina.
        expect(await aprovar(m, p2, [["clickup", "CLICKUP_CREATE_TASK_COMMENT"]])).toEqual(roda("regra:aprovacao_permanente"));
        const t4 = await turnoConversa(m);
        const p4 = await plano(m, t4.id);
        await m.repos.turnos.contaminar(t4.id, Date.now());
        const ATUAL: Record<NomePersona, Resultado> = {
          Rita: card("regra_suspensa_conteudo_nao_confiavel"),
          // ESPERADO PELA PERSONA (Marlon): clicou "Sempre permitir" em comentar — não quer card, só no arriscado.
          Marlon: card("regra_suspensa_conteudo_nao_confiavel"),
          Bruno: roda("regra:modo_total"),
        };
        expect(await aprovar(m, p4, [["clickup", "CLICKUP_CREATE_TASK_COMMENT"]])).toEqual(ATUAL[persona.nome]);
      });
    });
  });

  describe("4. \"Sempre permitir\" de CLICKUP_CREATE_TASK_COMMENT e uma ferramenta DIFERENTE do mesmo app e nível (CLICKUP_UPDATE_TASK)", () => {
    const ATUAL: Record<NomePersona, Resultado> = {
      // A regra é por ferramenta (ADR-042), não por app nem por nível. Rita é conservadora: ser perguntada numa ação
      // nova é o que ela quer.
      Rita: card("sem_regra_permanente"),
      Marlon: roda("regra:modo_automatico"),
      Bruno: roda("regra:modo_total"),
    };
    it.each(PERSONAS)("$nome ($modo)", async (persona) => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, persona, { semprePermitir: ["CLICKUP_CREATE_TASK_COMMENT"] });
        const p = await plano(m, (await turnoConversa(m)).id);
        expect(await aprovar(m, p, [["clickup", "CLICKUP_UPDATE_TASK"]])).toEqual(ATUAL[persona.nome]);
        expect(await aprovar(m, p, [["clickup", "CLICKUP_CREATE_TASK_COMMENT"]])).toEqual(roda("regra:aprovacao_permanente"));
      });
    });
  });

  describe("5. lote misto: um item com regra permanente + um sem", () => {
    it.each(PERSONAS)("$nome ($modo): na conversa, [comentar (com regra), atualizar (sem regra)]", async (persona) => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, persona, { semprePermitir: ["CLICKUP_CREATE_TASK_COMMENT"] });
        const p = await plano(m, (await turnoConversa(m)).id);
        const ATUAL: Record<NomePersona, Resultado> = {
          // O lote inteiro pergunta (decidirLote): o item com regra vai ao card junto, com motivo nulo.
          // ESPERADO PELA PERSONA (Rita): não ver o comentário de novo; ver só o "atualizar".
          Rita: card(null, "sem_regra_permanente"),
          // Entre as regras que passaram, assina a que mais concede: o modo, não a permanente (pedir-aprovacao.ts).
          Marlon: roda("regra:modo_automatico"),
          Bruno: roda("regra:modo_total"),
        };
        const antes = m.chamadas.length; // o clique em "Sempre permitir" já executou o comentário daquele card
        expect(await aprovar(m, p, [["clickup", "CLICKUP_CREATE_TASK_COMMENT"], ["clickup", "CLICKUP_UPDATE_TASK"]])).toEqual(ATUAL[persona.nome]);
        expect(m.chamadas.slice(antes).map((c) => c.tool)).toEqual(persona.modo === "manual" ? [] : ["CLICKUP_CREATE_TASK_COMMENT", "CLICKUP_UPDATE_TASK"]);
      });
    });

    it.each(PERSONAS)("$nome ($modo): numa rotina, [comentar (com regra), apagar task]", async (persona) => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, persona, { semprePermitir: ["CLICKUP_CREATE_TASK_COMMENT"] });
        await conceder(m, m.bot, "clickup", ["CLICKUP_DELETE_TASK"]);
        const p = await plano(m, (await turnoDeRotina(m, "a agenda do dia")).id);
        const ATUAL: Record<NomePersona, Resultado> = {
          // ESPERADO PELA PERSONA (Rita): o comentário com "Sempre permitir" não voltaria; o gate da rotina vem antes da regra.
          Rita: card("gate_de_rotina", "gate_de_rotina"),
          // O comentário passaria; o apagar para — e o lote inteiro espera. Para Marlon, parar no apagar é o esperado.
          Marlon: card(null, "acao_arriscada"),
          Bruno: roda("regra:modo_total"),
        };
        expect(await aprovar(m, p, [["clickup", "CLICKUP_CREATE_TASK_COMMENT"], ["clickup", "CLICKUP_DELETE_TASK"]])).toEqual(ATUAL[persona.nome]);
      });
    });
  });

  describe("6. leitura: aprovar/conceder a leitura do Slack e usar OUTRA ferramenta de leitura do mesmo app", () => {
    it("Rita (manual): pedido com o NOME de uma ferramenta concede só ela — a próxima leitura do Slack abre outro card", async () => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, RITA);
        const t = await turnoConversa(m);
        const pedido = await pedirAcesso(m, await plano(m, t.id), "slack", ["SLACK_SEARCH_MESSAGES"]);
        expect(pedido.estado).toBe("aguardando_pessoa");
        expect((await decidirAcesso(m.deps, { decisaoId: pedido.proposta_id, recusar: false, executor: "catcher" })).data.concessoes).toBe(1);
        const p2 = await plano(m, (await turnoConversa(m)).id);
        expect(await direto(m, p2, "slack", "SLACK_SEARCH_MESSAGES")).toEqual(EXECUTOU);
        // ESPERADO PELA PERSONA: "já aprovei ler o Slack" — nenhum card a mais. A concessão é por ferramenta quando o
        // modelo nomeia (o prompt aceita "os nomes exatos, ou []").
        expect(await direto(m, p2, "slack", "SLACK_FETCH_CONVERSATION_HISTORY")).toEqual(negado("fora_do_catalogo"));
        expect((await pedirAcesso(m, p2, "slack", ["SLACK_FETCH_CONVERSATION_HISTORY"])).estado).toBe("aguardando_pessoa");
      });
    });

    it("Rita (manual): pedido pelo NÍVEL ([] leitura) concede todas as leituras — as outras rodam sem card; pedir de novo abre card repetido", async () => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, RITA);
        const pedido = await pedirAcesso(m, await plano(m, (await turnoConversa(m)).id), "slack", []);
        expect(pedido.estado).toBe("aguardando_pessoa");
        expect((await decidirAcesso(m.deps, { decisaoId: pedido.proposta_id, recusar: false, executor: "catcher" })).data.concessoes).toBe(2);
        const p2 = await plano(m, (await turnoConversa(m)).id);
        expect(await direto(m, p2, "slack", "SLACK_FETCH_CONVERSATION_HISTORY")).toEqual(EXECUTOU);
        // Leitura embrulhada em pedir_aprovacao também passa (regra do conector, não da pessoa).
        expect(await aprovar(m, p2, [["slack", "SLACK_SEARCH_MESSAGES"]])).toEqual(roda("regra:consulta_sem_decisao"));
        // O bot pede de novo o que JÁ tem (outro turno): nasce outro card; ninguém confere a concessão existente.
        // ESPERADO PELA PERSONA: nenhum card de leitura do Slack depois de já ter permitido ler o Slack.
        expect((await pedirAcesso(m, p2, "slack", [])).estado).toBe("aguardando_pessoa");
      });
    });

    it.each([MARLON, BRUNO])("$nome ($modo): na conversa o modo concede sozinho, ferramenta a ferramenta (sem card, com uma volta de turno)", async (persona) => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, persona);
        const pedido = await pedirAcesso(m, await plano(m, (await turnoConversa(m)).id), "slack", ["SLACK_SEARCH_MESSAGES"]);
        expect(pedido.estado).toBe("concedido");
        const p2 = await plano(m, (await turnoConversa(m)).id);
        expect(await direto(m, p2, "slack", "SLACK_FETCH_CONVERSATION_HISTORY")).toEqual(negado("fora_do_catalogo"));
        expect((await pedirAcesso(m, p2, "slack", ["SLACK_FETCH_CONVERSATION_HISTORY"])).estado).toBe("concedido");
      });
    });

    it.each(PERSONAS)("$nome ($modo): na ROTINA, falta de leitura vira card em todo modo — no pré-voo e no pedir_acesso do turno", async (persona) => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, persona);
        // Pré-voo: a rotina cita o Slack e o bot não lê o Slack → a janela para sem turno, com card de acesso.
        const rotina = await m.repos.rotinas.criar({ agenteId: m.bot.agenteId, conversaId: m.bot.conversaId, cron: "0 8 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: "Resumo do canal", fonte: "o canal #deploy do Slack", entregavel: "chat", limitesAprovacao: "", politicaSemDado: "", proximaExecucao: JANELA });
        const disparo = await dispararRotina(m.deps, { rotina: rotina!, instanteAgendado: JANELA, machineId: randomUUID(), executor: "catcher" });
        if (!("bloqueada" in disparo.data)) throw new Error("esperava a rotina bloqueada");
        // ESPERADO PELA PERSONA (Bruno): nunca ver card (só credencial). Marlon: a rotina da noite para por um acesso de leitura.
        expect(disparo.data.bloqueada).toBe("sem_acesso");
        expect(await m.repos.decisoes.buscar(disparo.data.propostaId ?? "")).toMatchObject({ tipo: "acesso", estado: "pendente" });
        // No turno de rotina, pedir_acesso nunca passa pelo modo (pedir-acesso.ts: o ramo da rotina volta antes).
        const p = await plano(m, (await turnoDeRotina(m, "a agenda do dia")).id);
        expect((await pedirAcesso(m, p, "slack", [])).estado).toBe("aguardando_pessoa");
      });
    });
  });

  describe("7. ação arriscada: apagar task e merge de PR", () => {
    it.each(PERSONAS)("$nome ($modo): quem dá o acesso de apagar — na conversa, o modo concede sozinho", async (persona) => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, persona);
        const r = await pedirAcesso(m, await plano(m, (await turnoConversa(m)).id), "clickup", ["CLICKUP_DELETE_TASK"], "escrita");
        expect(r.estado).toBe(persona.modo === "manual" ? "aguardando_pessoa" : "concedido");
      });
    });

    it.each(PERSONAS)("$nome ($modo): pedido NA CONVERSA", async (persona) => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, persona);
        await conceder(m, m.bot, "clickup", ["CLICKUP_DELETE_TASK"]);
        const p = await plano(m, (await turnoConversa(m)).id);
        const ATUAL: Record<NomePersona, Resultado> = { Rita: card("sem_regra_permanente"), Marlon: roda("regra:modo_automatico"), Bruno: roda("regra:modo_total") };
        // Emenda de 2026-09-30: apagar e merge que a pessoa pediu na conversa saem sozinhos no automático.
        expect(await aprovar(m, p, [["clickup", "CLICKUP_DELETE_TASK"]])).toEqual(ATUAL[persona.nome]);
        expect(await aprovar(m, p, [["github", "GITHUB_MERGE_A_PULL_REQUEST"]])).toEqual(ATUAL[persona.nome]);
        // Direto: o merge é negado em todo modo (nuncaPermanente). ADR-062: o APAGAR direto segue a decisão do card —
        // antes rodava sem card até no manual.
        expect(await direto(m, p, "github", "GITHUB_MERGE_A_PULL_REQUEST")).toEqual(negado("alcance_insuficiente"));
        expect(await direto(m, p, "clickup", "CLICKUP_DELETE_TASK")).toEqual(persona.modo === "manual" ? negado("alcance_insuficiente") : EXECUTOU);
      });
    });

    it.each(PERSONAS)("$nome ($modo): pedido numa ROTINA (sem conteúdo de fora)", async (persona) => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, persona);
        await conceder(m, m.bot, "clickup", ["CLICKUP_DELETE_TASK"]);
        const p = await plano(m, (await turnoDeRotina(m, "a agenda do dia")).id);
        const ATUAL: Record<NomePersona, Resultado> = { Rita: card("gate_de_rotina"), Marlon: card("acao_arriscada"), Bruno: roda("regra:modo_total") };
        expect(await aprovar(m, p, [["clickup", "CLICKUP_DELETE_TASK"]])).toEqual(ATUAL[persona.nome]);
        expect(await aprovar(m, p, [["github", "GITHUB_MERGE_A_PULL_REQUEST"]])).toEqual(ATUAL[persona.nome]);
        // Sob o gate da rotina a escrita direta é negada em todo modo.
        expect(await direto(m, p, "clickup", "CLICKUP_DELETE_TASK")).toEqual(negado("alcance_insuficiente"));
      });
    });

    it.each(PERSONAS)("$nome ($modo): pedido de COLEGA nascido na conversa (sem trava) — o colega apaga", async (persona) => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, persona);
        await conceder(m, m.colega, "clickup", ["CLICKUP_DELETE_TASK"]);
        const tarefa = await pedirAoColega(m, await plano(m, (await turnoConversa(m)).id));
        const p = await plano(m, tarefa.id);
        expect(p.modoTurno).toBe("delegacao");
        const ATUAL: Record<NomePersona, Resultado> = { Rita: card("sem_regra_permanente"), Marlon: card("acao_arriscada"), Bruno: roda("regra:modo_total") };
        expect(await aprovar(m, p, [["clickup", "CLICKUP_DELETE_TASK"]])).toEqual(ATUAL[persona.nome]);
        // ADR-062: o apagar que ninguém pediu na conversa para também pela chamada direta (antes rodava sem card, com a
        // concessão, em todo modo).
        expect(await direto(m, p, "clickup", "CLICKUP_DELETE_TASK")).toEqual(persona.modo === "total" ? EXECUTOU : negado("alcance_insuficiente"));
      });
    });
  });

  describe("8. rotina da própria pessoa (gate efeitoExternoSoPorAprovacao) e pedido de colega (trava herdada)", () => {
    it.each(PERSONAS)("$nome ($modo): rotina própria que não lê app (entrada confiável), com \"Sempre permitir\" de comentar", async (persona) => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, persona, { semprePermitir: ["CLICKUP_CREATE_TASK_COMMENT"] });
        const p = await plano(m, (await turnoDeRotina(m, "a agenda do dia")).id);
        expect({ gate: p.politicaExecucao.efeitoExternoSoPorAprovacao, confianca: p.confiancaEntrada }).toEqual({ gate: true, confianca: "confiavel" });
        const ATUAL: Record<NomePersona, Resultado> = {
          // ESPERADO PELA PERSONA (Rita): clicou "Sempre permitir" em comentar; na rotina o gate vem antes da regra.
          Rita: card("gate_de_rotina"),
          // No automático e no total o gate da rotina própria não obriga pessoa, e a regra permanente assina (passo 8,
          // antes do modo) — o mesmo "Sempre permitir" que na Rita não vale.
          Marlon: roda("regra:aprovacao_permanente"),
          Bruno: roda("regra:aprovacao_permanente"),
        };
        expect(await aprovar(m, p, [["clickup", "CLICKUP_CREATE_TASK_COMMENT"]])).toEqual(ATUAL[persona.nome]);
        expect(await direto(m, p, "clickup", "CLICKUP_CREATE_TASK_COMMENT")).toEqual(negado("alcance_insuficiente"));
      });
    });

    it.each(PERSONAS)("$nome ($modo): rotina própria cuja FONTE cita o ClickUp e o Slack (conteúdo interno → turno confiável)", async (persona) => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, persona, { semprePermitir: ["CLICKUP_CREATE_TASK_COMMENT"] });
        await conceder(m, m.bot, "slack", ["SLACK_SEARCH_MESSAGES"]);
        const p = await plano(m, (await turnoDeRotina(m, "as tasks atrasadas do ClickUp e as mensagens no Slack")).id);
        // ADR-062: a confiança é da curadoria de conteúdo de fora, não da declaração 'toca' — com ela, 440 de 440 rotinas
        // do Marlon nasciam não confiáveis, e o automático e o "Sempre permitir" nunca valiam numa rotina.
        expect({ confianca: p.confiancaEntrada, semprePermitir: p.semprePermitir }).toEqual({ confianca: "confiavel", semprePermitir: [`${m.slug.clickup}__CLICKUP_CREATE_TASK_COMMENT`] });
        const ATUAL: Record<NomePersona, Resultado> = {
          // ESPERADO PELA PERSONA (Rita): clicou "Sempre permitir" em comentar; na rotina o gate vem antes da regra.
          Rita: card("gate_de_rotina"),
          Marlon: roda("regra:aprovacao_permanente"),
          Bruno: roda("regra:aprovacao_permanente"),
        };
        expect(await aprovar(m, p, [["clickup", "CLICKUP_CREATE_TASK_COMMENT"]])).toEqual(ATUAL[persona.nome]);
      });
    });

    it.each(PERSONAS)("$nome ($modo): rotina própria cuja FONTE cita o GitHub (conteúdo de fora → turno não confiável)", async (persona) => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, persona, { semprePermitir: ["CLICKUP_CREATE_TASK_COMMENT"] });
        const p = await plano(m, (await turnoDeRotina(m, "os PRs abertos no GitHub")).id);
        // Issue e PR podem ser de qualquer pessoa: o GitHub não está na curadoria (conteudoInterno), como todo app novo.
        expect({ confianca: p.confiancaEntrada, semprePermitir: p.semprePermitir }).toEqual({ confianca: "nao_confiavel", semprePermitir: [] });
        expect(p.catalogo.ferramentas.map((f) => f.nome)).not.toContain(`${m.slug.clickup}__CLICKUP_CREATE_TASK_COMMENT`);
        const ATUAL: Record<NomePersona, Resultado> = {
          Rita: card("gate_de_rotina"),
          Marlon: card("regra_suspensa_conteudo_nao_confiavel"),
          Bruno: roda("regra:modo_total"),
        };
        expect(await aprovar(m, p, [["clickup", "CLICKUP_CREATE_TASK_COMMENT"]])).toEqual(ATUAL[persona.nome]);
      });
    });

    it.each(PERSONAS)("$nome ($modo): pedido de COLEGA nascido de uma rotina confiável com gate — entre bots da mesma pessoa, sem trava", async (persona) => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, persona);
        const tarefa = await pedirAoColega(m, await plano(m, (await turnoDeRotina(m, "a agenda do dia")).id));
        const p = await plano(m, tarefa.id);
        // ADR-062 (decisão do Marlon): a rotina de um bot não trava o colega da MESMA pessoa — quem decide é o modo de
        // quem recebe. Antes, os bots do Marlon no automático viravam card um na conversa do outro.
        expect({ modo: p.modoTurno, trava: p.politicaExecucao.travaHerdada, confianca: p.confiancaEntrada }).toEqual({ modo: "delegacao", trava: undefined, confianca: "confiavel" });
        const ATUAL: Record<NomePersona, Resultado> = { Rita: card("sem_regra_permanente"), Marlon: roda("regra:modo_automatico"), Bruno: roda("regra:modo_total") };
        expect(await aprovar(m, p, [["clickup", "CLICKUP_CREATE_TASK_COMMENT"]])).toEqual(ATUAL[persona.nome]);
        expect(await direto(m, p, "clickup", "CLICKUP_CREATE_TASK_COMMENT")).toEqual(persona.modo === "manual" ? negado("alcance_insuficiente") : EXECUTOU);
      });
    });

    it.each(PERSONAS)("$nome ($modo): pedido de COLEGA nascido de uma rotina que lê conteúdo de fora (trava herdada)", async (persona) => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, persona);
        const tarefa = await pedirAoColega(m, await plano(m, (await turnoDeRotina(m, "os PRs abertos no GitHub")).id));
        const p = await plano(m, tarefa.id);
        // A trava continua quando quem pediu leu conteúdo de fora: é por aí que um texto de fora mandaria no colega.
        expect({ modo: p.modoTurno, trava: p.politicaExecucao.travaHerdada, confianca: p.confiancaEntrada }).toEqual({ modo: "delegacao", trava: true, confianca: "confiavel" });
        const ATUAL: Record<NomePersona, Resultado> = { Rita: card("gate_de_rotina"), Marlon: card("gate_de_rotina"), Bruno: roda("regra:modo_total") };
        expect(await aprovar(m, p, [["clickup", "CLICKUP_CREATE_TASK_COMMENT"]])).toEqual(ATUAL[persona.nome]);
        expect(await direto(m, p, "clickup", "CLICKUP_CREATE_TASK_COMMENT")).toEqual(negado("alcance_insuficiente"));
      });
    });

    it.each(PERSONAS)("$nome ($modo): pedido de COLEGA nascido na conversa — a regra do bot não vale para o colega", async (persona) => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, persona, { semprePermitir: ["CLICKUP_CREATE_TASK_COMMENT"] });
        const tarefa = await pedirAoColega(m, await plano(m, (await turnoConversa(m)).id));
        const p = await plano(m, tarefa.id);
        expect(p.politicaExecucao.travaHerdada).toBeUndefined();
        const ATUAL: Record<NomePersona, Resultado> = {
          // ESPERADO PELA PERSONA (Rita): "Sempre permitir" comentar — mas a regra é por (bot, ferramenta) e o colega é outro bot.
          Rita: card("sem_regra_permanente"),
          Marlon: roda("regra:modo_automatico"),
          Bruno: roda("regra:modo_total"),
        };
        expect(await aprovar(m, p, [["clickup", "CLICKUP_CREATE_TASK_COMMENT"]])).toEqual(ATUAL[persona.nome]);
      });
    });
  });

  describe("9. terminal do Mac (autorizar-comando)", () => {
    it("Rita (manual): leitura roda; escrita é card; \"Pode fazer e o resto desta tarefa\" solta os próximos", async () => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, RITA);
        const t = await turnoConversa(m);
        await vivo(m, t.id);
        const p = await plano(m, t.id);
        expect((await terminal(m, p, "git status")).r).toEqual(roda("leitura"));
        const commit = await terminal(m, p, "git commit -am 'fix: acento'");
        expect(commit.r).toEqual(card("destino_terminal"));
        const d = await decidir(m.deps, { decisaoId: commit.decisaoId ?? "" });
        expect((await liberarNaTarefa(m.deps, { decisao: d.data.decisao })).data.liberado).toBe(true);
        expect((await terminal(m, p, "git commit -am 'fix: acento'")).r).toEqual(roda("aprovado"));
        expect((await terminal(m, p, "npm install left-pad")).r).toEqual(roda("liberado_na_tarefa"));
        // ADR-062: "o resto desta tarefa" não cobre o arriscado nem a credencial — antes os dois passavam sem card.
        expect((await terminal(m, p, "rm -rf dist")).r).toEqual(card("destino_terminal"));
        expect((await terminal(m, p, "cat ~/.aws/credentials")).r).toEqual(card("destino_terminal"));
      });
    });

    it("Marlon (automático): escrita roda, arriscado para; depois da web até a LEITURA vira card", async () => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, MARLON);
        const t = await turnoConversa(m);
        const p = await plano(m, t.id);
        expect((await terminal(m, p, "git status")).r).toEqual(roda("leitura"));
        expect((await terminal(m, p, "git commit -am 'fix: acento'")).r).toEqual(roda("modo_automatico"));
        expect((await terminal(m, p, "gh pr create --fill")).r).toEqual(roda("modo_automatico"));
        expect((await terminal(m, p, "gh pr merge 466 --squash")).r).toEqual(roda("modo_automatico"));
        expect((await terminal(m, p, "rm -rf dist")).r).toEqual(card("acao_arriscada"));
        expect((await terminal(m, p, "cat ~/.aws/credentials")).r).toEqual(card("toca_credencial"));
        await m.repos.turnos.contaminar(t.id, Date.now());
        // ESPERADO PELA PERSONA: comando que só lê roda sempre; parar só no arriscado.
        expect((await terminal(m, p, "git log --oneline -5")).r).toEqual(card("regra_suspensa_conteudo_nao_confiavel"));
        expect((await terminal(m, p, "git commit -am x")).r).toEqual(card("regra_suspensa_conteudo_nao_confiavel"));
      });
    });

    it("Bruno (total): tudo roda, até depois da web; só a credencial para", async () => {
      await withRollback(ESCOPO, async (trx) => {
        const m = await montar(trx, BRUNO);
        const t = await turnoConversa(m);
        const p = await plano(m, t.id);
        expect((await terminal(m, p, "git status")).r).toEqual(roda("leitura"));
        expect((await terminal(m, p, "rm -rf dist")).r).toEqual(roda("modo_total"));
        await m.repos.turnos.contaminar(t.id, Date.now());
        expect((await terminal(m, p, "git push --force origin fix/x")).r).toEqual(roda("modo_total"));
        expect((await terminal(m, p, "git status")).r).toEqual(roda("modo_total"));
        expect((await terminal(m, p, "gh auth token")).r).toEqual(card("toca_credencial"));
      });
    });
  });
});
