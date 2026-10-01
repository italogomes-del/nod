import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rotasInternas } from "../../src/adapters/http/rotas/interno.ts";
import { FERRAMENTAS_NOD } from "../../src/contracts/ferramentas-nod.ts";
import { NATIVAS_DO_TERMINAL } from "../../src/domain/nativas.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { PESSOA_MARLON, TENANT_LEAPY } from "../helpers/ids.ts";
import { dentroEmMemoria, planoDeTeste, servicosDeTeste } from "../helpers/l5.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";

const MARLON = { tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON };
const CATALOGO = [
  { nome: "ler", descricao: "lê", schema: { type: "object" as const }, readOnlyHint: true },
  { nome: "enviar", descricao: "envia", schema: { type: "object" as const }, readOnlyHint: false },
];

/**
 * ADR-052 pela rota interna REAL: o hook do nod confirma cada nativa — só a que está no plano do turno; a trilha
 * registra sempre; WebFetch/WebSearch marcam o turno.
 * revisto em 2026-10-01 (ADR-066): a marca não vira mais "escrita só por item aprovado" — ela só tira o "Sempre
 * permitir" do manual; o automático e o total seguem. Chamar um app de fora (fora da curadoria) também marca. E a
 * gravação fora de ~/nod/<bot> (o hook manda `arquivo`) passa pela mesma decisão do comando do terminal.
 */
describe("rota /interno/nativas: confirmação do hook e turno contaminado (ADR-052)", () => {
  const agora = () => Date.now();
  const tokens = criarTokenTurno({ agora });
  const services = servicosDeTeste({ agora, tokens });
  const memoria = dentroEmMemoria({ services, agora });
  let srv: ServidorDeTeste;

  beforeAll(async () => {
    srv = await servidorDeTeste(rotasInternas({ dentro: memoria.dentro, tokens, agora }), { autorizarTokenTurno: tokens.autorizar });
  });
  afterAll(() => srv.close());

  async function turno(nativas: readonly string[]) {
    const repos = memoria.repos(MARLON);
    const agente = await repos.agentes.criar({ nome: "Ada", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
    const agenteId = agente?.id ?? "";
    const conversaId = (await repos.conversas.criar({ tipo: "propria", agenteId }))?.id ?? "";
    const email = await repos.conectores.criar({ nome: "Email", slug: `email-${agenteId.slice(0, 8)}`, transporte: "stdio", comando: "node", declaracao: "nao-toca" });
    await repos.conectores.registrarSonda(email?.id ?? "", { ok: true, catalogo: CATALOGO, agora: agora() });
    await repos.conectores.habilitar(email?.id ?? "", true);
    for (const capacidade of ["ler", "enviar"]) await repos.concessoes.conceder({ agenteId, conectorId: email?.id ?? "", capacidade, mensagemId: randomUUID() });
    const turnoId = randomUUID();
    await repos.turnos.enfileirar({ id: turnoId, conversaId, agenteId, origem: "conversa", prazoEm: agora() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
    const token = tokens.cunhar(turnoId, { ...MARLON, agenteId });
    const slug = email?.slug ?? "";
    tokens.guardarPlano(planoDeTeste({
      turnoId, agenteId, conversaId, expiraEm: agora() + 60_000, tokenDeTurno: token, nativas,
      catalogo: {
        ferramentas: [
          { nome: "pedir_aprovacao", nomeMcp: "mcp__nod__pedir_aprovacao", origem: "nod", conectorId: null, readOnlyHint: false, tocaAprendiz: false, schema: FERRAMENTAS_NOD.pedir_aprovacao },
          { nome: `${slug}__enviar`, nomeMcp: `mcp__nod__${slug}__enviar`, origem: "conector", conectorId: email?.id ?? "", readOnlyHint: false, tocaAprendiz: false, schema: { type: "object" } },
        ],
        servidores: [{ conectorId: email?.id ?? "", nome: slug, trust: "untrusted", transporte: "stdio" }],
      },
    }));
    const interno = (metodo: string, caminho: string, corpo?: unknown) =>
      fetch(`${srv.url}/api/interno/${caminho}`, { method: metodo, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const enviar = async () => (await (await interno("POST", `ferramentas/${slug}__enviar`, { argumentos: {} })).json()) as { ok: boolean; negacao?: { motivo: string } };
    /** O "Sempre permitir" que a pessoa clicou em enviar (ADR-042). */
    const semprePermitirEnviar = () => repos.permissoesPermanentes.criar({ agenteId, conectorId: email?.id ?? "", capacidade: "enviar", itemOrigemId: randomUUID(), mensagemId: randomUUID(), regraVersao: 1 });
    return { repos, turnoId, slug, interno, agenteId, enviar, semprePermitirEnviar };
  }

  it("só a nativa que está no plano é confirmada, e cada uma deixa linha na trilha", async () => {
    const t = await turno(NATIVAS_DO_TERMINAL);
    expect((await t.interno("POST", "nativas", { ferramenta: "Write" })).status).toBe(200);
    expect((await t.interno("POST", "nativas", { ferramenta: "Task" })).status).toBe(403);
    expect((await t.repos.trilha.doTurno(t.turnoId)).map((l) => l.ferramenta)).toEqual(["nativa__Write"]);
    const semKit = await turno([]);
    expect((await semKit.interno("POST", "nativas", { ferramenta: "Write" })).status).toBe(403);
  });

  it("WebFetch marca o turno; ADR-066: a marca só derruba o 'Sempre permitir' do manual — no automático a escrita em conector segue", async () => {
    const t = await turno(NATIVAS_DO_TERMINAL);
    await t.semprePermitirEnviar();
    expect(await t.repos.turnos.contaminado(t.turnoId)).toBe(false);
    // O hook manda contamina:false de propósito: quem decide é o servidor, pela ferramenta.
    expect((await t.interno("POST", "nativas", { ferramenta: "WebFetch", contamina: false })).status).toBe(200);
    expect(await t.repos.turnos.contaminado(t.turnoId)).toBe(true);
    // Manual: depois da web a regra da pessoa cai (ADR-042 claim 6) e a chamada direta recebe "peça aprovação".
    expect(await t.enviar()).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente" } });
    // Automático: conteúdo de fora não para mais (antes desta ADR, a web negava a escrita direta em todo modo).
    await t.repos.agentes.definirModoAprovacao(t.agenteId, "automatico");
    expect((await t.enviar()).ok).toBe(true);
  });

  it("ADR-066: chamar um app de fora (e-mail, fora da curadoria) também marca o turno — o 'Sempre permitir' do manual vale até ali", async () => {
    const t = await turno(NATIVAS_DO_TERMINAL);
    await t.semprePermitirEnviar();
    expect((await t.enviar()).ok).toBe(true);
    expect(await t.repos.turnos.contaminado(t.turnoId)).toBe(true);
    expect(await t.enviar()).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente" } });
  });

  it("ADR-059: o comando que o modo aprovou leva a regra do modo na trilha (o gatilho da ADR-055 não dispara à toa)", async () => {
    const t = await turno(NATIVAS_DO_TERMINAL);
    await t.repos.agentes.definirModoAprovacao(t.agenteId, "automatico");
    expect(await (await t.interno("POST", "nativas", { ferramenta: "Bash", comando: "git commit -am x" })).json()).toEqual({ ok: true });
    expect(await (await t.interno("POST", "nativas", { ferramenta: "Bash", comando: "git status" })).json()).toEqual({ ok: true });
    const trilha = await t.repos.trilha.doTurno(t.turnoId);
    expect(trilha.map((l) => [l.ferramenta, l.regra])).toEqual([["nativa__Bash", "regra:modo_automatico"], ["nativa__Bash", "regra:chamar_ferramenta"]]);
    // ADR-066: o conjunto que o automático deixa passar mudou (conteúdo de fora não o para mais) — a versão subiu para 2.
    expect(trilha[0]?.regraVersao).toBe(2);
    const arriscado = await (await t.interno("POST", "nativas", { ferramenta: "Bash", comando: "rm -rf dist" })).json() as { aguardar?: string };
    expect(typeof arriscado.aguardar).toBe("string");
  });

  it("ADR-066: Write/Edit/NotebookEdit com `arquivo` (fora de ~/nod/<bot>) passam pela decisão do terminal; sem `arquivo` (dentro da pasta), só a trilha", async () => {
    const t = await turno(NATIVAS_DO_TERMINAL);
    // Dentro da pasta do bot o hook não manda `arquivo`: a rota confirma e grava a trilha, como antes.
    expect(await (await t.interno("POST", "nativas", { ferramenta: "Write" })).json()).toEqual({ ok: true });
    // Fora dela, no manual: card "Gravar <arquivo>", e o hook espera a decisão; nada vai à trilha antes de rodar.
    const fora = (await (await t.interno("POST", "nativas", { ferramenta: "Edit", arquivo: "/Users/m/code/app/src/filtros.tsx" })).json()) as { aguardar?: string };
    expect(typeof fora.aguardar).toBe("string");
    expect(await t.repos.itensAprovacao.listar(fora.aguardar ?? "")).toMatchObject([{ textoOriginal: "Gravar /Users/m/code/app/src/filtros.tsx", destino: { conector: "terminal", argumentos: { arquivo: "/Users/m/code/app/src/filtros.tsx" } } }]);
    // No automático, grava sem card e a trilha leva a regra do modo.
    await t.repos.agentes.definirModoAprovacao(t.agenteId, "automatico");
    expect(await (await t.interno("POST", "nativas", { ferramenta: "NotebookEdit", arquivo: "/Users/m/notas/analise.ipynb" })).json()).toEqual({ ok: true });
    const trilha = await t.repos.trilha.doTurno(t.turnoId);
    expect(trilha.map((l) => [l.ferramenta, l.regra])).toEqual([["nativa__Write", "regra:chamar_ferramenta"], ["nativa__NotebookEdit", "regra:modo_automatico"]]);
  });
});
