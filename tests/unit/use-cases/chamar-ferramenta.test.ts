import { describe, expect, it, vi } from "vitest";
import { ErroTransporteMcp } from "../../../src/adapters/mcp-proxy/cliente-mcp.ts";
import { ErroBancoOcupado, ErroTxEncerrada } from "../../../src/db/tx.ts";
import { FERRAMENTAS_NOD } from "../../../src/contracts/ferramentas-nod.ts";
import type { FerramentaPlano, PlanoTurno } from "../../../src/contracts/plano-turno.ts";
import { chamarFerramenta, errosDoSchema, validarArgsNod } from "../../../src/use-cases/chamar-ferramenta.ts";
import type { Deps } from "../../../src/use-cases/tipos.ts";
import { criarConectoresVivos } from "../../../src/services/conectores-vivos.ts";
import { planoDeTeste } from "../../helpers/l5.ts";
import { depsFalsos, type OpcoesDepsFalsos } from "./deps-l5.ts";

const AGORA = 1_758_000_000_000;

const nod = (nome: keyof typeof FERRAMENTAS_NOD): FerramentaPlano => ({ nome, nomeMcp: `mcp__nod__${nome}`, origem: "nod", conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: FERRAMENTAS_NOD[nome] });

async function cenario(opcoes: OpcoesDepsFalsos = {}, plano: Partial<PlanoTurno> = {}) {
  const { deps, banco, chamadas, contextos } = depsFalsos({ agora: AGORA, ...opcoes });
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
  const turno = await deps.repos.turnos.enfileirar({ executor: "catcher", conversaId: conversa?.id ?? "", agenteId: agente?.id ?? "", origem: "conversa", prazoEm: AGORA + 60_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
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
        { nome: "exemplo__somar", nomeMcp: "mcp__nod__exemplo__somar", origem: "conector", conectorId, readOnlyHint: true, tocaDadoPessoal: false, schema: { type: "object", properties: { a: { type: "number" }, b: { type: "number" } }, required: ["a", "b"] } },
        { nome: "exemplo__enviar", nomeMcp: "mcp__nod__exemplo__enviar", origem: "conector", conectorId, readOnlyHint: false, tocaDadoPessoal: false, schema: { type: "object", properties: { para: { type: "string" } }, required: ["para"] } },
      ],
      servidores: [{ conectorId, nome: "exemplo", trust: "untrusted", transporte: "stdio" }],
    },
    ...plano,
  });
  const chamar = (nome: string, argumentos: unknown, p: PlanoTurno | null = planoBase) => chamarFerramenta(deps as Deps, { turnoId, agenteId, nome, argumentos, plano: p });
  const trilha = () => banco.trilha.map((l) => [l.kind, l.ferramenta, l.motivo] as const);
  const turnoAtual = () => banco.turnos.find((t) => t.id === turnoId);
  return { deps, banco, chamadas, contextos, chamar, trilha, turnoAtual, turnoId, agenteId, conversaId, conectorId, consentimentoId: consentimento?.id ?? "", plano: planoBase };
}

describe("chamarFerramenta: gates, despacho por tabela e trilha (ADR-013, EMENDA 5/10/16; sem o gate da EMENDA 15 desde a ADR-066)", () => {
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
    await c.deps.repos.concessoes.conceder({ agenteId: c.agenteId, conectorId: email?.id ?? "", capacidade: "enviar", mensagemId: c.consentimentoId });
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
    // Emenda da ADR-045: a conversa recebe a fala do agente LIGADA à decisão. Plano "pergunta com botões" (2026-10-18): a
    // frase da fila é a mesma fala, inteira — o molde "parei para perguntar a …" saiu.
    const fala = c.banco.mensagens.find((m) => m.payload?.kind === "pedido_a_pessoa");
    expect(fala?.payload).toEqual({ kind: "pedido_a_pessoa", decisaoId: pergunta?.id });
    expect(fala?.texto).toBe("(pedido sem texto)");
    expect(pergunta?.frase).toBe("(pedido sem texto)");
    expect(c.banco.mensagens.some((m) => m.texto.startsWith("parei"))).toBe(false);
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

  it("ADR-066: não há mais gate de rotina — num turno de rotina a escrita direta passa pela decisão do modo: no manual, alcance_insuficiente TRANSITÓRIA (peça aprovação); no automático roda; readOnly passa sempre", async () => {
    const c = await cenario({}, { modoTurno: "rotina", politicaExecucao: { prazoMs: 1, orcamentoResultadoChars: 8000 } });
    await c.deps.repos.concessoes.conceder({ agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "enviar", mensagemId: c.consentimentoId });
    const r = await c.chamar("exemplo__enviar", { para: "x" });
    expect(r.data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente", terminal: false } });
    expect(c.turnoAtual()?.pararSolicitadoEm).toBeNull();
    expect((await c.chamar("exemplo__somar", { a: 1, b: 2 })).data).toMatchObject({ ok: true });
    await c.deps.repos.agentes.definirModoAprovacao(c.agenteId, "automatico");
    expect((await c.chamar("exemplo__enviar", { para: "x" })).data).toMatchObject({ ok: true });
    expect(c.chamadas.map((x) => x.tool)).toEqual(["somar", "enviar"]);
  });

  it("ADR-066: ler um app de fora marca o turno; dali em diante, no manual, a regra 'Sempre permitir' cai e a escrita direta volta ao pedir_aprovacao — no automático segue", async () => {
    const c = await cenario();
    await c.deps.repos.concessoes.conceder({ agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "enviar", mensagemId: c.consentimentoId });
    await c.deps.repos.permissoesPermanentes.criar({ agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "enviar", itemOrigemId: "i", mensagemId: c.consentimentoId, regraVersao: 1 });
    expect(await c.deps.repos.turnos.contaminado(c.turnoId)).toBe(false);
    expect((await c.chamar("exemplo__enviar", { para: "x" })).data).toMatchObject({ ok: true });
    // "exemplo" não tem curadoria de conteúdo interno: chamar o app marca o turno (conectorTrazConteudoDeFora).
    expect(await c.deps.repos.turnos.contaminado(c.turnoId)).toBe(true);
    expect((await c.chamar("exemplo__enviar", { para: "x" })).data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente", terminal: false } });
    await c.deps.repos.agentes.definirModoAprovacao(c.agenteId, "automatico");
    expect((await c.chamar("exemplo__enviar", { para: "x" })).data).toMatchObject({ ok: true });
    expect(c.chamadas.map((x) => x.tool)).toEqual(["enviar", "enviar"]);
  });

  it("ADR-066: merge e aprovar PR não têm mais negação direta — no manual pedem a pessoa até com 'Sempre permitir' (nunca permanente); no automático rodam na conversa e numa rotina (merge de PR não é 'apagar'; mesclar registros continua sendo)", async () => {
    const montar = async (capacidade: string, modoTurno: PlanoTurno["modoTurno"]) => {
      const c = await cenario();
      const catalogo = (await c.deps.repos.conectores.buscar(c.conectorId))?.catalogo ?? [];
      await c.deps.repos.conectores.registrarSonda(c.conectorId, { ok: true, agora: AGORA, catalogo: [...catalogo, { nome: capacidade, descricao: capacidade, schema: { type: "object" }, readOnlyHint: false }] });
      await c.deps.repos.concessoes.conceder({ agenteId: c.agenteId, conectorId: c.conectorId, capacidade, mensagemId: c.consentimentoId });
      const nome = `exemplo__${capacidade}`;
      const plano: PlanoTurno = { ...c.plano, modoTurno, catalogo: { ...c.plano.catalogo, ferramentas: [...c.plano.catalogo.ferramentas, { nome, nomeMcp: `mcp__nod__${nome}`, origem: "conector", conectorId: c.conectorId, readOnlyHint: false, tocaDadoPessoal: false, schema: { type: "object" } }] } };
      return { ...c, agir: () => c.chamar(nome, {}, plano) };
    };
    const manual = await montar("pr_merge", "conversa");
    await manual.deps.repos.permissoesPermanentes.criar({ agenteId: manual.agenteId, conectorId: manual.conectorId, capacidade: "pr_merge", itemOrigemId: "i", mensagemId: manual.consentimentoId, regraVersao: 1 });
    expect((await manual.agir()).data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente", terminal: false } });
    expect(manual.chamadas).toHaveLength(0);
    // Antes da ADR-066 o merge era negado direto em QUALQUER modo (só por item de pedir_aprovacao).
    const naConversa = await montar("pr_merge", "conversa");
    await naConversa.deps.repos.agentes.definirModoAprovacao(naConversa.agenteId, "automatico");
    expect((await naConversa.agir()).data).toMatchObject({ ok: true });
    // Numa rotina (ninguém pediu na conversa), o arriscado pararia o automático: merge e revisar PR não são mais arriscados.
    const rodados: string[] = [];
    for (const capacidade of ["pr_merge", "GITHUB_MERGE_A_PULL_REQUEST", "pr_revisar"]) {
      const naRotina = await montar(capacidade, "rotina");
      await naRotina.deps.repos.agentes.definirModoAprovacao(naRotina.agenteId, "automatico");
      expect({ capacidade, r: (await naRotina.agir()).data }).toMatchObject({ capacidade, r: { ok: true } });
      rodados.push(...naRotina.chamadas.map((x) => x.tool));
    }
    expect([...naConversa.chamadas.map((x) => x.tool), ...rodados]).toEqual(["pr_merge", "pr_merge", "GITHUB_MERGE_A_PULL_REQUEST", "pr_revisar"]);
    // Mesclar REGISTROS (apaga um deles) continua no grupo "apagar": numa rotina, o automático para.
    const mesclar = await montar("CONTACTS_MERGE", "rotina");
    await mesclar.deps.repos.agentes.definirModoAprovacao(mesclar.agenteId, "automatico");
    expect((await mesclar.agir()).data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente", terminal: false } });
    expect(mesclar.chamadas).toHaveLength(0);
  });

  it("ADR-062: a escrita direta passa pela decisão do card — no manual pede aprovação, com regra ou no automático roda", async () => {
    const c = await cenario();
    await c.deps.repos.concessoes.conceder({ agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "enviar", mensagemId: c.consentimentoId });
    expect((await c.chamar("exemplo__enviar", { para: "x" })).data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente", terminal: false } });
    // A regra "Sempre permitir" vale pela linha ativa agora, no mesmo turno.
    const regra = await c.deps.repos.permissoesPermanentes.criar({ agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "enviar", itemOrigemId: "i", mensagemId: c.consentimentoId, regraVersao: 1 });
    expect((await c.chamar("exemplo__enviar", { para: "x" })).data).toMatchObject({ ok: true });
    await c.deps.repos.permissoesPermanentes.desativar(regra?.id ?? "", "revogada_pela_pessoa", AGORA);
    expect((await c.chamar("exemplo__enviar", { para: "x" })).data).toMatchObject({ ok: false, negacao: { motivo: "alcance_insuficiente" } });
    await c.deps.repos.agentes.definirModoAprovacao(c.agenteId, "automatico");
    expect((await c.chamar("exemplo__enviar", { para: "x" })).data).toMatchObject({ ok: true });
    expect(c.chamadas.map((x) => x.tool)).toEqual(["enviar", "enviar"]);
  });

  it("ADR-062: pedir_aprovacao confere os argumentos no schema do conector — o erro volta ao bot como dado, sem card", async () => {
    const c = await cenario();
    await c.deps.repos.concessoes.conceder({ agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "enviar", mensagemId: c.consentimentoId });
    const r = await c.chamar("pedir_aprovacao", { resumo: "enviar", itens: [{ texto: "a", destino: { conector: "exemplo", ferramenta: "enviar", argumentos: {} } }] });
    expect(r.data).toMatchObject({ ok: true });
    const volta = JSON.parse((r.data as { conteudo: string }).conteudo) as { estado: string; erros: string[]; instrucao: string };
    expect(volta.estado).toBe("recusada");
    expect(volta.erros.join(" ")).toContain("para");
    expect(volta.erros.join(" ")).toContain("exemplo.enviar");
    expect(c.banco.decisoes).toHaveLength(0);
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

  it("NOD-157: o readOnlyHint chega ao serviço como somenteLeitura; ferramenta sem o hint é tratada como escrita", async () => {
    const c = await cenario();
    await c.chamar("exemplo__somar", { a: 1, b: 2 });
    expect(c.contextos).toEqual([{ rotina: false, somenteLeitura: true }]);
    // Escrita (hint falso) e ferramenta sem o hint: as duas chegam como escrita, que só repete em 429.
    await c.deps.repos.concessoes.conceder({ agenteId: c.agenteId, conectorId: c.conectorId, capacidade: "enviar", mensagemId: c.consentimentoId });
    await c.deps.repos.agentes.definirModoAprovacao(c.agenteId, "automatico");
    await c.chamar("exemplo__enviar", { para: "x" });
    expect(c.contextos[1]).toEqual({ rotina: false, somenteLeitura: false });
    const semHint = { ...c.plano, catalogo: { ...c.plano.catalogo, ferramentas: c.plano.catalogo.ferramentas.map((f) => (f.nome === "exemplo__enviar" ? { ...f, readOnlyHint: undefined as unknown as boolean } : f)) } };
    await c.chamar("exemplo__enviar", { para: "x" }, semHint);
    expect(c.contextos[2]).toEqual({ rotina: false, somenteLeitura: false });
  });

  it("NOD-157: chamada que recupera dentro do serviço não marca falha; a que esgota marca UMA vez e nega com conector_indisponivel", async () => {
    const ok = await cenario();
    await ok.chamar("exemplo__somar", { a: 1, b: 2 });
    expect((await ok.deps.repos.conectores.buscar(ok.conectorId))?.ultimaFalha).toBeNull();

    const c = await cenario({ responder: () => { throw new Error("conector_indisponivel"); } });
    const marcar = vi.spyOn(c.deps.repos.conectores, "marcarFalha");
    const r = await c.chamar("exemplo__somar", { a: 1, b: 2 });
    expect(marcar).toHaveBeenCalledTimes(1);
    expect(r.data).toMatchObject({ ok: false, negacao: { classe: "conector_indisponivel", motivo: "conector_indisponivel", terminal: false } });
    expect(r.data).not.toHaveProperty("negacao.causa");
  });

  it.each([
    ["banco_ocupado", () => new ErroBancoOcupado("c0ffee00-0000-4000-8000-000000000000", 10_000)],
    ["tx_encerrada", () => new ErroTxEncerrada()],
    ["statement_timeout (57014)", () => Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" })],
    ["lock_timeout (55P03)", () => Object.assign(new Error("canceling statement due to lock timeout"), { code: "55P03" })],
  ])("NOD-266: %s durante a chamada é falha nossa, não do app — relança sem marcarFalha nem negação", async (_nome, erro) => {
    const c = await cenario({ responder: () => { throw erro(); } });
    const marcar = vi.spyOn(c.deps.repos.conectores, "marcarFalha");
    await expect(c.chamar("exemplo__somar", { a: 1, b: 2 })).rejects.toBeInstanceOf(erro().constructor);
    expect(marcar).not.toHaveBeenCalled();
    expect((await c.deps.repos.conectores.buscar(c.conectorId))?.ultimaFalha).toBeNull();
  });

  it("NOD-193: sessão MCP expirada (404 com mcp-session-id) uma vez e depois 200 → ok: true, sem marcarFalha", async () => {
    let sessoes = 0;
    let expirar = 1;
    const metodos: string[] = [];
    const fetchImpl: typeof fetch = async (_u, init) => {
      const q = JSON.parse(String(init?.body)) as { id?: number; method: string };
      metodos.push(q.method);
      if (q.method === "initialize") return Response.json({ jsonrpc: "2.0", id: q.id, result: {} }, { headers: { "mcp-session-id": `S${++sessoes}` } });
      if (!q.id) return new Response(null, { status: 202 });
      if (expirar-- > 0) return new Response("x", { status: 404 });
      return Response.json({ jsonrpc: "2.0", id: q.id, result: { content: [{ type: "text", text: "3" }] } });
    };
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const vivos = criarConectoresVivos({ agora: () => AGORA, fetchImpl, carregar: async () => ({ nome: "exemplo", transporte: "http", url: "https://mcp.exemplo.com/mcp" }) });
    try {
      const c = await cenario({ responder: (ch) => vivos.chamar(ch.conectorId, ch.tool, ch.args, { rotina: false, somenteLeitura: true }) });
      const marcar = vi.spyOn(c.deps.repos.conectores, "marcarFalha");
      const r = await c.chamar("exemplo__somar", { a: 1, b: 2 });
      expect(r.data).toMatchObject({ ok: true });
      expect(marcar).not.toHaveBeenCalled();
      expect((await c.deps.repos.conectores.buscar(c.conectorId))?.ultimaFalha).toBeNull();
      expect(metodos.filter((m) => m === "tools/call")).toHaveLength(2);
      expect(metodos.filter((m) => m === "initialize")).toHaveLength(2);
    } finally {
      log.mockRestore();
      await vivos.fechar();
    }
  });

  it("NOD-157: 401/403 do conector nega com causa acesso_recusado (falha_tecnica), sem enum novo e sem dizer 'servidor fora'", async () => {
    for (const status of [401, 403]) {
      const c = await cenario({ responder: () => { throw new ErroTransporteMcp("conector_indisponivel", `http ${status}`, { status }); } });
      const r = await c.chamar("exemplo__somar", { a: 1, b: 2 });
      expect(r.data).toMatchObject({ ok: false, negacao: { classe: "conector_indisponivel", motivo: "falha_tecnica", causa: "acesso_recusado", terminal: false } });
      expect((await c.deps.repos.conectores.buscar(c.conectorId))?.ultimaFalha).toEqual({ motivo: "falha_tecnica", em: AGORA });
    }
  });
});

describe("validação pelo subconjunto JSON Schema", () => {
  it("required, additionalProperties false, enum, minLength, minItems, items, integer e tipos aninhados", () => {
    expect(validarArgsNod("lembrar", { tipo: "fato", texto: "x" })).toEqual({ ok: true, args: { tipo: "fato", texto: "x" } });
    expect(validarArgsNod("lembrar", { tipo: "fato" })).toMatchObject({ ok: false, erros: ["$.texto: obrigatório"] });
    expect(validarArgsNod("lembrar", { tipo: "fato", texto: "", extra: 1 })).toMatchObject({ ok: false });
    expect(validarArgsNod("pedir_acesso", { conector: "x", capacidades: [], nivel: "leitura", nao_pedido: [] })).toMatchObject({ ok: true });
    expect(validarArgsNod("pedir_acesso", { conector: "x", capacidades: [1], nivel: "raiz", nao_pedido: [] })).toMatchObject({ ok: false });
    expect(validarArgsNod("pedir_aprovacao", { resumo: "r", itens: [{ texto: "t", destino: { conector: "c", ferramenta: "f", argumentos: { livre: true } } }] }).ok).toBe(true);
    expect(validarArgsNod("pedir_aprovacao", { resumo: "r", itens: [{ texto: "t", destino: { conector: "c", ferramenta: "f" } }] })).toMatchObject({ ok: false, erros: ["$.itens[0].destino.argumentos: obrigatório"] });
    expect(errosDoSchema({ type: "array", minItems: 1, items: { type: "string" } }, [])).toEqual(["$: mínimo 1 itens"]);
    // definido em 2026-09-24 (emenda da ADR-045): o teto que o subconjunto expõe (opcoes de pedir_a_pessoa) também valida.
    expect(errosDoSchema({ type: "array", maxItems: 2, items: { type: "string", maxLength: 3 } }, ["abc", "abcd", "x"])).toEqual(["$: máximo 2 itens", "$[1]: máximo 3 caracteres"]);
    expect(errosDoSchema({ type: "integer" }, 1.5)).toEqual(["$: esperado inteiro"]);
    expect(errosDoSchema({ type: "object" }, null)).toEqual(["$: esperado object, veio null"]);
    expect(errosDoSchema({ type: "object" }, [])).toEqual(["$: esperado object, veio array"]);
  });
});
