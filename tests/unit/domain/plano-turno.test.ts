import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import type { Concessao } from "../../../src/contracts/concessao.ts";
import type { Conector } from "../../../src/contracts/conector.ts";
import type { Turno } from "../../../src/contracts/turno.ts";
import { ErroDeDominio } from "../../../src/domain/erro.ts";
import { FERRAMENTAS_NOD_POR_MODO, montarPlano, type EntradaPlano } from "../../../src/domain/plano-turno.ts";

const agora = 1_000_000;
const agente: Agente = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Vera", titulo: "", descricao: "revisa PRs", dono: "pessoa", forma: "shape-square", cor: "c-red", fixado: false, oculto: false, confirmado: true, modelo: "claude-haiku-4-5-20251001", duplicadoDe: null, criadoEm: 0 };
const turno: Turno = { tenantId: "t", id: "t1", conversaId: "c1", agenteId: "a1", ownerId: "p", origem: "conversa", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: agora + 86_400_000, motivoInterrupcao: null, motivoFalha: null, semNovidadeMotivo: null, retomaTurnoId: null, profundidade: 0, reenvios: 0, pararSolicitadoEm: null, entradaTexto: "oi", entradaAnexos: [], entradaConfianca: "confiavel", custoUsd: null, modelo: "claude-haiku-4-5-20251001", criadoEm: agora, mensagemOrigemId: "m0" };
const conector: Conector = { tenantId: "t", id: "k1", ownerId: "p", visibility: "privado", nome: "Exemplo", slug: "exemplo", transporte: "stdio", comando: "node", args: [], url: null, env: {}, declaracao: "nao-toca", habilitado: true, catalogo: [
  { nome: "listar_contatos", descricao: "lista", schema: { type: "object" }, readOnlyHint: true },
  { nome: "enviar_email", descricao: "envia", schema: { type: "object" }, readOnlyHint: false },
], sondadoEm: agora, ultimaFalha: null, criadoEm: 0 };
const concessoes: Concessao[] = [
  { tenantId: "t", id: "g1", ownerId: "p", agenteId: "a1", conectorId: "k1", capacidade: "listar_contatos", mensagemId: "m", criadoEm: 0 },
  { tenantId: "t", id: "g2", ownerId: "p", agenteId: "a1", conectorId: "k1", capacidade: "enviar_email", mensagemId: "m", criadoEm: 0 },
];
const base: EntradaPlano = { turno, agente, memorias: [], concessoes, conectores: [conector], modo: "conversa", confianca: "confiavel", profundidade: 0, inventario: { estado: "pronto", versao: "2.1.272", em: agora }, executor: "local", sessaoCli: null, pessoaNome: "Marlon", agora };
const nomes = (p: ReturnType<typeof montarPlano>) => p.catalogo.ferramentas.map((f) => f.nome);

describe("montarPlano", () => {
  it("conversa: ferramentas nod do modo + conector ∩ concessão como slug__tool com nomeMcp exato", () => {
    const p = montarPlano(base);
    for (const n of FERRAMENTAS_NOD_POR_MODO.conversa) expect(nomes(p)).toContain(n);
    expect(nomes(p)).toContain("exemplo__listar_contatos");
    expect(nomes(p)).toContain("exemplo__enviar_email");
    expect(p.catalogo.ferramentas.find((f) => f.nome === "exemplo__enviar_email")?.nomeMcp).toBe("mcp__nod__exemplo__enviar_email");
    expect(p.catalogo.servidores).toEqual([{ conectorId: "k1", nome: "exemplo", trust: "untrusted", transporte: "stdio" }]);
    expect(p.superficie).toBe("maquina_da_pessoa");
    expect(p.localidade).toBe("local");
    expect(p.autoria).toMatchObject({ autor_tipo: "agente", autor_id: "a1", conta_de_execucao: "p", locality_reason: "tudo_local_nesta_rodada", decidido_por: "regra:localidade" });
    expect(p.decididoPor).toBe("regra:montagem-ferramentas");
    expect(p.promptSistema).toContain("mcp__nod__exemplo__enviar_email");
  });

  it("sem concessão a ferramenta do conector não entra; conector desabilitado some inteiro", () => {
    const so = montarPlano({ ...base, concessoes: [concessoes[0]!] });
    expect(nomes(so)).toContain("exemplo__listar_contatos");
    expect(nomes(so)).not.toContain("exemplo__enviar_email");
    const off = montarPlano({ ...base, conectores: [{ ...conector, habilitado: false }] });
    expect(nomes(off).some((n) => n.startsWith("exemplo__"))).toBe(false);
    expect(off.catalogo.servidores).toEqual([]);
  });

  it("profundidade 1 vira modo peer: sem perguntar_a_bot nem encaminhar (E12.4)", () => {
    const p = montarPlano({ ...base, modo: "sala", profundidade: 1 });
    expect(nomes(p)).not.toContain("perguntar_a_bot");
    expect(nomes(p)).not.toContain("encaminhar");
    expect(p.profundidade).toBe(1);
    expect(p.promptSistema).toContain("outro bot");
  });

  it("entrada nao_confiavel: só readOnly de conector; nod fica; decididoPor nomeia a regra", () => {
    const p = montarPlano({ ...base, confianca: "nao_confiavel" });
    expect(nomes(p)).toContain("exemplo__listar_contatos");
    expect(nomes(p)).not.toContain("exemplo__enviar_email");
    expect(nomes(p)).toContain("pedir_aprovacao");
    expect(p.confiancaEntrada).toBe("nao_confiavel");
    expect(p.decididoPor).toBe("regra:reducao_por_confianca");
  });

  it("modos: criacao propõe perfil/rotina/acesso; rotina permite consulta a colega, pedir acesso e silêncio; sala tem passar/encaminhar", () => {
    expect(nomes(montarPlano({ ...base, modo: "criacao" })).filter((n) => !n.includes("__"))).toEqual(["atualizar_perfil", "pedir_acesso", "criar_rotina", "lembrar"]);
    // ADR-044: pedir_acesso só propõe (a pessoa decide num botão); sem ele a rotina pedia acesso em texto a cada disparo.
    expect(nomes(montarPlano({ ...base, modo: "rotina" })).filter((n) => !n.includes("__"))).toEqual(["lembrar", "pedir_aprovacao", "pedir_acesso", "pedir_a_pessoa", "perguntar_a_bot", "sem_novidade"]);
    const sala = nomes(montarPlano({ ...base, modo: "sala" }));
    expect(sala).toContain("passar");
    expect(sala).toContain("encaminhar");
    expect(sala).toContain("pedir_a_pessoa");
    // sem_novidade é só de rotina: em sala/conversa alguém está esperando resposta.
    expect(sala).not.toContain("sem_novidade");
  });

  it("agente acordado por rotina pode consultar colega sem transferir escrita nem permitir outro salto", () => {
    const rotina = montarPlano({ ...base, modo: "rotina", turno: { ...turno, origem: "rotina" }, confianca: "nao_confiavel", rotina: { exigeAprovacao: true } });
    expect(nomes(rotina)).toContain("perguntar_a_bot");
    expect(nomes(rotina)).toContain("exemplo__listar_contatos");
    expect(nomes(rotina)).not.toContain("exemplo__enviar_email");
    expect(rotina.politicaExecucao.efeitoExternoSoPorAprovacao).toBe(true);
    const colega = montarPlano({ ...base, modo: "peer", profundidade: 1, confianca: "nao_confiavel" });
    expect(nomes(colega)).not.toContain("perguntar_a_bot");
    expect(nomes(colega)).not.toContain("exemplo__enviar_email");
  });

  it("EMENDA 15: origem rotina com exige_aprovacao liga efeitoExternoSoPorAprovacao; conversa não", () => {
    const rot = montarPlano({ ...base, turno: { ...turno, origem: "rotina" }, modo: "rotina", rotina: { exigeAprovacao: true } });
    expect(rot.politicaExecucao.efeitoExternoSoPorAprovacao).toBe(true);
    const rotSemGate = montarPlano({ ...base, turno: { ...turno, origem: "rotina" }, modo: "rotina", rotina: { exigeAprovacao: false } });
    expect(rotSemGate.politicaExecucao.efeitoExternoSoPorAprovacao).toBe(false);
    expect(montarPlano(base).politicaExecucao.efeitoExternoSoPorAprovacao).toBe(false);
  });

  it("ADR-044: o gate vem da rotina LIGADA, não da origem — a retomada de uma rotina com gate continua com gate", () => {
    const retomada = montarPlano({ ...base, turno: { ...turno, origem: "retomada", retomaTurnoId: "t0" }, modo: "rotina", confianca: "nao_confiavel", rotina: { exigeAprovacao: true } });
    expect(retomada.politicaExecucao.efeitoExternoSoPorAprovacao).toBe(true);
    expect(nomes(retomada)).not.toContain("exemplo__enviar_email");
    expect(nomes(retomada)).not.toContain("pausar_rotina");
    expect(retomada.promptSistema).toContain("Você foi acordado por um agendamento");
    // Retomada sem rotina ligada é conversa: sem gate.
    expect(montarPlano({ ...base, turno: { ...turno, origem: "retomada" } }).politicaExecucao.efeitoExternoSoPorAprovacao).toBe(false);
  });

  it("inventário não pronto → executor_indisponivel (nunca promove em silêncio)", () => {
    expect(() => montarPlano({ ...base, inventario: { estado: "ausente", motivo: "claude ausente", em: agora } })).toThrow(ErroDeDominio);
    try {
      montarPlano({ ...base, inventario: { estado: "nao_autenticado", motivo: "sem login", em: agora } });
    } catch (e) {
      expect((e as ErroDeDominio).codigo).toBe("executor_indisponivel");
    }
  });

  it("entrada, prazo e expiração vêm do turno/relógio; sessaoCli passa para --resume; sem cwd (EMENDA 11)", () => {
    const p = montarPlano({ ...base, sessaoCli: "sess-1" });
    expect(p.entrada).toEqual({ texto: "oi", sessaoCli: "sess-1", modelo: "claude-haiku-4-5-20251001" });
    expect(p.politicaExecucao.prazoMs).toBe(86_400_000);
    expect(p.expiraEm).toBe(agora + 3_600_000);
    expect("cwd" in p.politicaExecucao).toBe(false);
  });
});

describe("catálogo de workspace conforme haja projeto autorizado", () => {
  // definido em 2026-09-18: ver ferramentas que ainda não pode usar levava o agente a tentar,
  // falhar e virar tutorial de menu. Sem projeto, só consultar e propor.
  it("sem projeto autorizado oferece apenas consultar e propor", () => {
    const p = montarPlano({ ...base, workspace: true, workspaceVinculado: false });
    const doWorkspace = p.catalogo.ferramentas.filter((f) => f.origem === "workspace").map((f) => f.nome);
    expect(doWorkspace.sort()).toEqual(["workspace_consultar", "workspace_propor_pasta"]);
    expect(doWorkspace).not.toContain("workspace_gravar_texto");
    expect(doWorkspace).not.toContain("workspace_terminal");
  });
  it("com projeto autorizado oferece o catálogo completo", () => {
    const p = montarPlano({ ...base, workspace: true, workspaceVinculado: true });
    const doWorkspace = p.catalogo.ferramentas.filter((f) => f.origem === "workspace").map((f) => f.nome);
    expect(doWorkspace).toContain("workspace_gravar_texto");
    expect(doWorkspace).toContain("workspace_terminal");
    expect(doWorkspace).toContain("workspace_trocar_projeto");
  });
  it("sem o serviço de workspace não oferece nenhuma", () => {
    expect(montarPlano({ ...base, workspace: false, workspaceVinculado: true }).catalogo.ferramentas.filter((f) => f.origem === "workspace")).toHaveLength(0);
  });
  it("fora da conversa própria não oferece nenhuma", () => {
    for (const modo of ["sala", "criacao"] as const) {
      expect(montarPlano({ ...base, modo, workspace: true, workspaceVinculado: true }).catalogo.ferramentas.filter((f) => f.origem === "workspace")).toHaveLength(0);
    }
  });
});
