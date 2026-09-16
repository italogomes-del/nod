import { describe, expect, it } from "vitest";
import { FERRAMENTAS_NOD } from "../../../src/contracts/ferramentas-nod.ts";
import type { FerramentaPlano, PlanoTurno } from "../../../src/contracts/plano-turno.ts";
import { chamarFerramenta, errosDoSchema, validarArgsNod } from "../../../src/use-cases/chamar-ferramenta.ts";
import type { Deps } from "../../../src/use-cases/tipos.ts";
import { planoDeTeste } from "../../helpers/l5.ts";
import { depsFalsos, type OpcoesDepsFalsos } from "./deps-l5.ts";

const AGORA = 1_758_000_000_000;

const nod = (nome: keyof typeof FERRAMENTAS_NOD): FerramentaPlano => ({ nome, nomeMcp: `mcp__nod__${nome}`, origem: "nod", conectorId: null, readOnlyHint: false, tocaAprendiz: false, schema: FERRAMENTAS_NOD[nome] });

async function cenario(opcoes: OpcoesDepsFalsos = {}, plano: Partial<PlanoTurno> = {}) {
  const { deps, banco, chamadas } = depsFalsos({ agora: AGORA, ...opcoes });
  const agente = await deps.repos.agentes.criar({ nome: "Vera", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "m" });
  const conversa = await deps.repos.conversas.criar({ tipo: "propria", agenteId: agente?.id ?? "" });
  const conector = await deps.repos.conectores.criar({ nome: "Exemplo", slug: "exemplo", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
  const conectorId = conector?.id ?? "";
  await deps.repos.conectores.registrarSonda(conectorId, {
    ok: true,
    agora: AGORA,
    catalogo: [
      { nome: "somar", descricao: "soma", schema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] }, readOnlyHint: true },
      { nome: "enviar", descricao: "envia", schema: { type: "object", properties: { para: { type: "string" } }, required: ["para"] }, readOnlyHint: false },
    ],
  });
  const consentimento = await deps.repos.mensagens.criar({ conversaId: conversa?.id ?? "", autoria: { autor_tipo: "pessoa", autor_id: deps.escopo.pessoaId, sob_procuracao_de: null, conta_de_execucao: deps.escopo.pessoaId, executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 }, kind: "consentimento", texto: "ok", confianca: "confiavel" });
  await deps.repos.concessoes.conceder({ agenteId: agente?.id ?? "", conectorId, capacidade: "somar", mensagemId: consentimento?.id ?? "" });
  const turno = await deps.repos.turnos.enfileirar({ conversaId: conversa?.id ?? "", agenteId: agente?.id ?? "", origem: "conversa", prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
  await deps.repos.turnos.reivindicar({ machineId: "m1", agora: AGORA });
  const turnoId = turno?.id ?? "";
  const agenteId = agente?.id ?? "";
  const conversaId = conversa?.id ?? "";
  const planoBase = planoDeTeste({
    turnoId,
    agenteId,
    conversaId,
    expiraEm: AGORA + 60_000,
    catalogo: {
      ferramentas: [
        nod("lembrar"),
        nod("pedir_aprovacao"),
        nod("pedir_a_pessoa"),
        { nome: "exemplo__somar", nomeMcp: "mcp__nod__exemplo__somar", origem: "conector", conectorId, readOnlyHint: true, tocaAprendiz: false, schema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] } },
        { nome: "exemplo__enviar", nomeMcp: "mcp__nod__exemplo__enviar", origem: "conector", conectorId, readOnlyHint: false, tocaAprendiz: false, schema: { type: "object", properties: { para: { type: "string" } }, required: ["para"] } },
      ],
      servidores: [{ conectorId, nome: "exemplo", trust: "untrusted", transporte: "stdio" }],
    },
    ...plano,
  });
  const chamar = (nome: string, argumentos: unknown, p: PlanoTurno | null = planoBase) => chamarFerramenta(deps as Deps, { turnoId, agenteId, nome, argumentos, plano: p });
  const trilha = () => banco.trilha.map((l) => [l.kind, l.ferramenta, l.motivo] as const);
  const turnoAtual = () => banco.turnos.find((t) => t.id === turnoId);
  return { deps, banco, chamadas, chamar, trilha, turnoAtual, turnoId, agenteId, conversaId, conectorId, consentimentoId: consentimento?.id ?? "", plano: planoBase };
}

describe("chamarFerramenta: gates, despacho por tabela e trilha (ADR-013, EMENDA 5/10/15/16)", () => {
  it("sem plano ou plano expirado → negação terminal plano_ausente, trilha escrita, turno interrompido", async () => {
    const c = await cenario();
    const r1 = await c.chamar("lembrar", { tipo: "fato", texto: "x" }, null);
    expect(r1.data).toMatchObject({ ok: false, negacao: { classe: "plano_ausente", motivo: "plano_ausente", terminal: true, desde: AGORA } });
    const r2 = await c.chamar("lembrar", { tipo: "fato", texto: "x" }, { ...c.plano, expiraEm: AGORA });
    expect(r2.data).toMatchObject({ ok: false, negacao: { motivo: "plano_expirado", terminal: true } });
    expect(c.trilha()).toEqual([
      ["negacao", "lembrar", "plano_ausente"],
      ["negacao", "lembrar", "plano_expirado"],
    ]);
    expect(c.turnoAtual()?.pararSolicitadoEm).toBe(AGORA);
    expect(r1.events?.map((e) => e.kind)).toEqual(["negacao"]);
  });

  it("parada ativa é terminal; consulta que FALHA (null) também é parada (EMENDA 10)", async () => {
    const c = await cenario();
    await c.deps.repos.paradas.ativar({ conversaId: c.conversaId, agora: AGORA });
    const r = await c.chamar("lembrar", { tipo: "fato", texto: "x" });
    expect(r.data).toMatchObject({ ok: false, negacao: { classe: "ferramenta_negada", motivo: "parada_ativa", terminal: true } });
    expect(c.chamadas).toHaveLength(0);

    const d = await cenario();
    d.deps.repos.paradas.ativa = async () => null;
    const rNull = await d.chamar("exemplo__somar", { a: 1, b: 2 });
    expect(rNull.data).toMatchObject({ ok: false, negacao: { motivo: "parada_ativa", terminal: true } });
    expect(d.chamadas).toHaveLength(0);
  });

  it("nome fora do plano → fora_do_catalogo terminal (nunca chega ao conector)", async () => {
    const c = await cenario();
    const r = await c.chamar("exemplo__apagar_tudo", {});
    expect(r.data).toMatchObject({ ok: false, negacao: { motivo: "fora_do_catalogo", terminal: true } });
    expect(c.chamadas).toHaveLength(0);
    expect(c.turnoAtual()?.pararSolicitadoEm).toBe(AGORA);
  });

  it("ferramenta nod: args inválidos → args_invalidos transitória (turno segue); args válidos despacham para deps.useCases pela tabela", async () => {
    const c = await cenario();
    const ruim = await c.chamar("lembrar", { tipo: "opiniao", texto: "x" });
    expect(ruim.data).toMatchObject({ ok: false, negacao: { motivo: "args_invalidos", terminal: false } });
    expect(c.turnoAtual()?.pararSolicitadoEm).toBeNull();
    const bom = await c.chamar("lembrar", { tipo: "fato", texto: "gosta de café" });
    expect(bom.data).toEqual({ ok: true, conteudo: JSON.stringify({ ok: true, id: "memoria-falsa" }), confianca: "confiavel" });
    expect(c.trilha()).toEqual([
      ["negacao", "lembrar", "args_invalidos"],
      ["tool_call", "lembrar", null],
    ]);
    expect(c.banco.catcher.map((r) => r.tipo)).toEqual(["tool_call"]);
  });

  it("pedir_aprovacao pendente vira {aguardar}; pedir_a_pessoa malformado vira decisão tipo 'pergunta', nunca 'permissao' (EMENDA 16)", async () => {
    const c = await cenario();
    const email = await c.deps.repos.conectores.criar({ nome: "Email", slug: "email", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
    await c.deps.repos.conectores.registrarSonda(email?.id ?? "", { ok: true, agora: AGORA, catalogo: [{ nome: "enviar", descricao: "", schema: { type: "object" }, readOnlyHint: false }] });
    const r = await c.chamar("pedir_aprovacao", { resumo: "enviar", itens: [{ texto: "a", destino: { conector: "email", ferramenta: "enviar", argumentos: {} } }] });
    expect(r.data).toHaveProperty("aguardar");
    const decisaoId = (r.data as { aguardar: string }).aguardar;
    expect(c.banco.decisoes.find((d) => d.id === decisaoId)?.tipo).toBe("aprovacao");

    const p = await c.chamar("pedir_a_pessoa", { tipo: "permissao_total", quem_destrava: 42 });
    expect(p.data).toMatchObject({ ok: true, confianca: "confiavel" });
    const pergunta = c.banco.decisoes.find((d) => d.tipo === "pergunta");
    expect(pergunta).toBeDefined();
    expect(pergunta?.decisorId).toBe(c.deps.escopo.pessoaId);
    expect(c.banco.decisoes.some((d) => d.tipo === "permissao")).toBe(false);
    expect(c.banco.mensagens.some((m) => m.texto.startsWith("parei para perguntar"))).toBe(true);
  });

  it("conector: concessão ativa lida AGORA — somar (concedida) chama o conector e volta nao_confiavel; enviar (sem concessão) é capacidade_desligada terminal", async () => {
    const c = await cenario();
    const ok = await c.chamar("exemplo__somar", { a: 17, b: 25 });
    expect(ok.data).toEqual({ ok: true, conteudo: "ok:somar", confianca: "nao_confiavel" });
    expect(c.chamadas).toEqual([{ conectorId: c.conectorId, tool: "somar", args: { a: 17, b: 25 } }]);
    const negada = await c.chamar("exemplo__enviar", { para: "x" });
    expect(negada.data).toMatchObject({ ok: false, negacao: { motivo: "capacidade_desligada", terminal: true } });
    expect(c.chamadas).toHaveLength(1);
    expect(c.trilha()).toEqual([
      ["tool_call", "exemplo__somar", null],
      ["negacao", "exemplo__enviar", "capacidade_desligada"],
    ]);
    expect(c.banco.trilha[0]?.conectorId).toBe(c.conectorId);
  });

  it("revogação entre enfileirar e chamar → capacidade_desligada; conector desabilitado idem", async () => {
    const c = await cenario();
    const [g] = await c.deps.repos.concessoes.doAgente(c.agenteId);
    await c.deps.repos.concessoes.revogar(g?.id ?? "");
    expect((await c.chamar("exemplo__somar", { a: 1, b: 2 })).data).toMatchObject({ ok: false, negacao: { motivo: "capacidade_desligada" } });
    const d = await cenario();
    await d.deps.repos.conectores.habilitar(d.conectorId, false);
    expect((await d.chamar("exemplo__somar", { a: 1, b: 2 })).data).toMatchObject({ ok: false, negacao: { motivo: "capacidade_desligada" } });
    expect(c.chamadas.length + d.chamadas.length).toBe(0);
  });

  it("EMENDA 15: rotina com gate ligado recusa conector sem readOnlyHint como alcance_insuficiente TRANSITÓRIA; readOnly passa", async () => {
    const c = await cenario({}, { politicaExecucao: { prazoMs: 1, orcamentoResultadoChars: 8000, efeitoExternoSoPorAprovacao: true } });
    await c.deps.repos.concessoes.conceder({ agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "enviar", mensagemId: c.consentimentoId });
    const r = await c.chamar("exemplo__enviar", { para: "x" });
    expect(r.data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente", terminal: false } });
    expect(c.turnoAtual()?.pararSolicitadoEm).toBeNull();
    expect((await c.chamar("exemplo__somar", { a: 1, b: 2 })).data).toMatchObject({ ok: true });
    expect(c.chamadas.map((x) => x.tool)).toEqual(["somar"]);
  });

  it("conector que cai → conector_indisponivel transitória, ultimaFalha gravada; args fora do schema do conector → args_invalidos", async () => {
    const c = await cenario({ responder: () => { throw new Error("conector_indisponivel"); } });
    const r = await c.chamar("exemplo__somar", { a: 1, b: 2 });
    expect(r.data).toMatchObject({ ok: false, negacao: { classe: "conector_indisponivel", motivo: "conector_indisponivel", terminal: false } });
    expect((await c.deps.repos.conectores.buscar(c.conectorId))?.ultimaFalha).toEqual({ motivo: "conector_indisponivel", em: AGORA });
    const invalido = await c.chamar("exemplo__somar", { a: "um" });
    expect(invalido.data).toMatchObject({ ok: false, negacao: { motivo: "args_invalidos" } });
    expect(c.chamadas).toHaveLength(1);
  });
});

describe("validação pelo subconjunto JSON Schema", () => {
  it("required, additionalProperties false, enum, minLength, minItems, items, integer e tipos aninhados", () => {
    expect(validarArgsNod("lembrar", { tipo: "fato", texto: "x" })).toEqual({ ok: true, args: { tipo: "fato", texto: "x" } });
    expect(validarArgsNod("lembrar", { tipo: "fato" })).toMatchObject({ ok: false, erros: ["$.texto: obrigatório"] });
    expect(validarArgsNod("lembrar", { tipo: "fato", texto: "", extra: 1 })).toMatchObject({ ok: false });
    expect(validarArgsNod("pedir_acesso", { conector: "x", capacidades: [], nivel: "leitura", nao_pedido: [] })).toMatchObject({ ok: false, erros: ["$.capacidades: mínimo 1 itens"] });
    expect(validarArgsNod("pedir_acesso", { conector: "x", capacidades: [1], nivel: "raiz", nao_pedido: [] })).toMatchObject({ ok: false });
    expect(validarArgsNod("pedir_aprovacao", { resumo: "r", itens: [{ texto: "t", destino: { conector: "c", ferramenta: "f", argumentos: { livre: true } } }] }).ok).toBe(true);
    expect(validarArgsNod("pedir_aprovacao", { resumo: "r", itens: [{ texto: "t", destino: { conector: "c", ferramenta: "f" } }] })).toMatchObject({ ok: false, erros: ["$.itens[0].destino.argumentos: obrigatório"] });
    expect(errosDoSchema({ type: "integer" }, 1.5)).toEqual(["$: esperado inteiro"]);
    expect(errosDoSchema({ type: "object" }, null)).toEqual(["$: esperado object, veio null"]);
    expect(errosDoSchema({ type: "object" }, [])).toEqual(["$: esperado object, veio array"]);
  });
});
