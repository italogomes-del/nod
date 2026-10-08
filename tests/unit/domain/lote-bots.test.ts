import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import type { Turno } from "../../../src/contracts/turno.ts";
import type { AcaoLote, AppConectado } from "../../../src/contracts/ferramentas-do-nod.ts";
import { decidirLote, resolverBot, riscoDaAcao, validarLote, type BotDoLote } from "../../../src/domain/lote-bots.ts";
import { FERRAMENTAS_DO_NOD, montarPlano, type EntradaPlano } from "../../../src/domain/plano-turno.ts";
import { MANUAL_DO_NOD, TETO_MANUAL_DO_NOD } from "../../../src/domain/manual-do-nod.ts";

/** ADR-082: o lote do Nod, puro — validar tudo antes, resolver alvos e "@ref", risco e modo. */
const P = "pessoa";
const bot = (id: string, nome: string, extra: Partial<BotDoLote> = {}): BotDoLote => ({ id, nome, ownerId: P, dono: "pessoa", papel: null, excluidoEm: null, ...extra });
const BOTS: BotDoLote[] = [
  bot("b1", "Dev 1"),
  bot("b2", "Dev 2"),
  bot("nod", "Nod", { papel: "nod" }),
  bot("velho", "Dev antigo", { excluidoEm: 1 }),
  bot("outro", "Da Ana", { ownerId: "ana" }),
  bot("emp", "Da empresa", { dono: "empresa" }),
  bot("x1", "Gêmeo"),
  bot("x2", "gêmeo"),
];
const APPS: AppConectado[] = [{ slug: "github", nome: "GitHub", niveis: ["leitura", "escrita"] }, { slug: "agenda", nome: "Agenda", niveis: ["leitura"] }];
const valida = (acoes: AcaoLote[]) => validarLote(acoes, BOTS, APPS, P);

describe("validarLote (ADR-082)", () => {
  it("o pedido do Marlon: duplicar três e criar dois numa seção resolve os alvos por nome e por id", () => {
    const r = valida([
      { tipo: "duplicar", bot: "dev 1" },
      { tipo: "duplicar", bot: "b2" },
      { tipo: "criar", nome: "Revisor de PR", descricao: "Revisa os PRs.", secao: "Engenharia", ref: "rev" },
      { tipo: "dar_acesso", bot: "@rev", app: "github", nivel: "escrita" },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.acoes.map((a) => [a.alvoId, a.alvoDaAcao, a.alvoNome])).toEqual([["b1", null, "Dev 1"], ["b2", null, "Dev 2"], [null, null, "Revisor de PR"], [null, 2, "Revisor de PR"]]);
  });

  it("qualquer problema recusa o lote inteiro e lista todos, com o índice", () => {
    const r = valida([
      { tipo: "excluir", bot: "Nod" },
      { tipo: "editar", bot: "Da Ana", nome: "x" },
      { tipo: "mover", bot: "Da empresa", secao: "" },
      { tipo: "excluir", bot: "Dev antigo" },
      { tipo: "editar", bot: "Gêmeo", titulo: "x" },
      { tipo: "dar_acesso", bot: "Dev 1", app: "gmail", nivel: "leitura" },
      { tipo: "dar_acesso", bot: "Dev 1", app: "agenda", nivel: "escrita" },
      { tipo: "criar", nome: "nod", descricao: "x" },
      { tipo: "criar", nome: "Sem descrição" },
      { tipo: "editar", bot: "Dev 1" },
      { tipo: "excluir", bot: "@nada" },
      { tipo: "excluir", bot: "Ninguém" },
      { tipo: "criar_rotina", bot: "Dev 1", cron: "0 8 * * *" },
      { tipo: "excluir", bot: "Dev 1", ref: "r" },
    ]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const por = Object.fromEntries(r.problemas.map((p) => [p.i, p.motivo]));
    expect(por[0]).toContain("o Nod não mexe em si mesmo");
    expect(por[1]).toContain("não é um bot seu");
    expect(por[2]).toContain("não é um bot seu");
    expect(por[3]).toContain("não achei");
    expect(por[4]).toContain("mais de um bot");
    expect(por[5]).toContain("não está conectado");
    expect(por[6]).toContain("não tem ferramentas de escrita");
    expect(por[7]).toContain("o nome Nod é do bot fixo");
    expect(por[8]).toContain("descrição");
    expect(por[9]).toContain("sem nada para mudar");
    expect(por[10]).toContain("não é o ref de uma ação anterior");
    expect(por[11]).toContain("não achei");
    expect(por[12]).toContain("cron, fuso_iana e instrucao");
    expect(por[13]).toContain("ref só vale em criar e duplicar");
  });

  it("o bot excluído não é achado por nome, mas pelo id diz que foi excluído; @ref à frente ou a si mesmo não vale", () => {
    expect(resolverBot("velho", BOTS, P)).toEqual({ motivo: '"Dev antigo" foi excluído' });
    const r = valida([{ tipo: "duplicar", bot: "@a", ref: "a" }, { tipo: "excluir", bot: "@b" }, { tipo: "criar", nome: "B", descricao: "x", ref: "b" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problemas.map((p) => p.i)).toEqual([0, 1]);
  });

  it("mais de 20 ações, ou nenhuma, recusa", () => {
    const muitas = Array.from({ length: 21 }, (): AcaoLote => ({ tipo: "excluir", bot: "Dev 1" }));
    expect(valida(muitas).ok).toBe(false);
    expect(valida([]).ok).toBe(false);
  });
});

describe("risco e modo (ADR-082)", () => {
  it("excluir e mudar o modo são arriscados sempre; dar acesso e duplicar com acessos, só depois de conteúdo de fora", () => {
    const limpo = { contaminado: false, alvoTemAcessos: true };
    const sujo = { contaminado: true, alvoTemAcessos: true };
    expect(riscoDaAcao({ tipo: "excluir" }, limpo)).toBe("arriscada");
    expect(riscoDaAcao({ tipo: "mudar_modo" }, limpo)).toBe("arriscada");
    expect(riscoDaAcao({ tipo: "dar_acesso" }, limpo)).toBeNull();
    expect(riscoDaAcao({ tipo: "dar_acesso" }, sujo)).toBe("conteudo_de_fora");
    expect(riscoDaAcao({ tipo: "duplicar" }, sujo)).toBe("conteudo_de_fora");
    expect(riscoDaAcao({ tipo: "duplicar" }, { contaminado: true, alvoTemAcessos: false })).toBeNull();
    for (const tipo of ["criar", "editar", "mover", "criar_rotina"] as const) expect(riscoDaAcao({ tipo }, sujo)).toBeNull();
  });

  it("manual espera tudo; automático faz o seguro e espera o arriscado; total faz tudo; quem depende de quem espera, espera", () => {
    const r = valida([{ tipo: "criar", nome: "Novo", descricao: "x", ref: "n" }, { tipo: "excluir", bot: "Dev 2" }, { tipo: "dar_acesso", bot: "@n", app: "github", nivel: "leitura" }]);
    if (!r.ok) throw new Error("lote inválido");
    const riscos = [null, "arriscada" as const, null];
    expect(decidirLote(r.acoes, "manual", riscos)).toEqual(["manual", "arriscada", "manual"]);
    expect(decidirLote(r.acoes, "automatico", riscos)).toEqual([null, "arriscada", null]);
    expect(decidirLote(r.acoes, "total", riscos)).toEqual([null, null, null]);
    // O criar espera (conteúdo de fora não pesa no criar, mas um card manual sim) → o acesso ao bot que ele cria espera junto.
    expect(decidirLote(r.acoes, "automatico", ["arriscada", null, null])).toEqual(["arriscada", null, "arriscada"]);
  });
});

describe("catálogo e prompt do Nod (ADR-081/082)", () => {
  const agora = 1_000_000;
  const agente: Agente = { tenantId: "t", id: "nod", ownerId: "p", visibility: "privado", nome: "Nod", titulo: "Ajudante", descricao: "o bot fixo", dono: "pessoa", forma: "shape-square", cor: "c-black", fixado: true, oculto: false, confirmado: true, modelo: "auto", duplicadoDe: null, criadoEm: 0, papel: "nod" };
  const turno: Turno = { tenantId: "t", id: "t1", conversaId: "c1", agenteId: "nod", ownerId: "p", origem: "conversa", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: agora + 1, motivoInterrupcao: null, motivoFalha: null, semNovidadeMotivo: null, retomaTurnoId: null, profundidade: 0, reenvios: 0, pararSolicitadoEm: null, entradaTexto: "oi", entradaAnexos: [], entradaConfianca: "confiavel", custoUsd: null, modelo: "auto", criadoEm: agora, mensagemOrigemId: "m0" };
  const base: EntradaPlano = { turno, agente, memorias: [], concessoes: [], conectores: [], modo: "conversa", confianca: "confiavel", profundidade: 0, inventario: { estado: "pronto", versao: "2.1.290", em: agora }, executor: "local", sessaoCli: null, pessoaNome: "Marlon", agora };
  const nomes = (e: EntradaPlano) => montarPlano(e).catalogo.ferramentas.map((f) => f.nome);

  it("as ferramentas do Nod entram só no turno DELE com a pessoa (conversa, criação); nunca em rotina, sala, ligação nem delegação", () => {
    for (const modo of ["conversa", "criacao"] as const) expect(nomes({ ...base, modo })).toEqual(expect.arrayContaining([...FERRAMENTAS_DO_NOD]));
    for (const modo of ["rotina", "sala", "ligacao", "delegacao", "peer"] as const) {
      const n = nomes({ ...base, modo, ...(modo === "delegacao" ? { delegacao: { pessoaNome: "Marlon", remetenteNome: "Vera" } } : {}) });
      for (const f of FERRAMENTAS_DO_NOD) expect(n).not.toContain(f);
    }
    // Outro bot, mesmo na conversa: nada.
    const comum = nomes({ ...base, agente: { ...agente, id: "a1", nome: "Vera", papel: null } });
    for (const f of FERRAMENTAS_DO_NOD) expect(comum).not.toContain(f);
    // NOD_GERIR_BOTS=0: o interruptor tira as três.
    for (const f of FERRAMENTAS_DO_NOD) expect(nomes({ ...base, semFerramentasDoNod: true })).not.toContain(f);
  });

  it("o manual do Nod vai na parte estável só do Nod, e cabe no teto", () => {
    expect(MANUAL_DO_NOD.length).toBeLessThanOrEqual(TETO_MANUAL_DO_NOD);
    const doNod = montarPlano(base);
    expect(doNod.promptSistemaPartes?.estavel).toContain(MANUAL_DO_NOD);
    expect(doNod.promptSistemaPartes?.volatil ?? "").not.toContain("gerir_bots (");
    const comum = montarPlano({ ...base, agente: { ...agente, id: "a1", nome: "Vera", papel: null } });
    expect(comum.promptSistema).not.toContain("Você é o Nod");
  });
});
