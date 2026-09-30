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
 * registra sempre; WebFetch/WebSearch marcam o turno, e dali em diante escrita em conector só por item aprovado.
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
    return { repos, turnoId, slug, interno, agenteId };
  }

  it("só a nativa que está no plano é confirmada, e cada uma deixa linha na trilha", async () => {
    const t = await turno(NATIVAS_DO_TERMINAL);
    expect((await t.interno("POST", "nativas", { ferramenta: "Write" })).status).toBe(200);
    expect((await t.interno("POST", "nativas", { ferramenta: "Task" })).status).toBe(403);
    expect((await t.repos.trilha.doTurno(t.turnoId)).map((l) => l.ferramenta)).toEqual(["nativa__Write"]);
    const semKit = await turno([]);
    expect((await semKit.interno("POST", "nativas", { ferramenta: "Write" })).status).toBe(403);
  });

  it("WebFetch marca o turno: escrita em conector que passava vira negação do gate", async () => {
    const t = await turno(NATIVAS_DO_TERMINAL);
    const enviar = async () => (await (await t.interno("POST", `ferramentas/${t.slug}__enviar`, { argumentos: {} })).json()) as { ok: boolean; negacao?: { motivo: string } };
    expect((await enviar()).ok).toBe(true);
    expect(await t.repos.turnos.contaminado(t.turnoId)).toBe(false);
    // O hook manda contamina:false de propósito: quem decide é o servidor, pela ferramenta.
    expect((await t.interno("POST", "nativas", { ferramenta: "WebFetch", contamina: false })).status).toBe(200);
    expect(await t.repos.turnos.contaminado(t.turnoId)).toBe(true);
    expect(await enviar()).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente" } });
  });

  it("ADR-059: o comando que o modo aprovou leva a regra do modo na trilha (o gatilho da ADR-055 não dispara à toa)", async () => {
    const t = await turno(NATIVAS_DO_TERMINAL);
    await t.repos.agentes.definirModoAprovacao(t.agenteId, "automatico");
    expect(await (await t.interno("POST", "nativas", { ferramenta: "Bash", comando: "git commit -am x" })).json()).toEqual({ ok: true });
    expect(await (await t.interno("POST", "nativas", { ferramenta: "Bash", comando: "git status" })).json()).toEqual({ ok: true });
    const trilha = await t.repos.trilha.doTurno(t.turnoId);
    expect(trilha.map((l) => [l.ferramenta, l.regra])).toEqual([["nativa__Bash", "regra:modo_automatico"], ["nativa__Bash", "regra:chamar_ferramenta"]]);
    const arriscado = await (await t.interno("POST", "nativas", { ferramenta: "Bash", comando: "rm -rf dist" })).json() as { aguardar?: string };
    expect(typeof arriscado.aguardar).toBe("string");
  });
});
