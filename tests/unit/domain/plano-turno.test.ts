import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import type { Concessao } from "../../../src/contracts/concessao.ts";
import type { Conector } from "../../../src/contracts/conector.ts";
import type { Turno } from "../../../src/contracts/turno.ts";
import { ErroDeDominio } from "../../../src/domain/erro.ts";
import { FERRAMENTAS_NOD_POR_MODO, montarPlano, type EntradaPlano } from "../../../src/domain/plano-turno.ts";

const agora = 1_000_000;
const agente: Agente = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Vera", titulo: "", descricao: "revisa PRs", dono: "pessoa", forma: "shape-square", cor: "c-red", fixado: false, oculto: false, confirmado: true, modelo: "claude-haiku-4-5-20251001", duplicadoDe: null, criadoEm: 0 };
const turno: Turno = { tenantId: "t", id: "t1", conversaId: "c1", agenteId: "a1", ownerId: "p", origem: "conversa", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: agora + 86_400_000, motivoInterrupcao: null, motivoFalha: null, retomaTurnoId: null, profundidade: 0, reenvios: 0, pararSolicitadoEm: null, entradaTexto: "oi", entradaConfianca: "confiavel", custoUsd: null, modelo: "claude-haiku-4-5-20251001", criadoEm: agora };
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

  it("modos: criacao propõe perfil/rotina/acesso; rotina só lembra, pede aprovação e pede à pessoa; sala tem passar/encaminhar", () => {
    expect(nomes(montarPlano({ ...base, modo: "criacao" })).filter((n) => !n.includes("__"))).toEqual(["atualizar_perfil", "pedir_acesso", "criar_rotina", "lembrar"]);
    expect(nomes(montarPlano({ ...base, modo: "rotina" })).filter((n) => !n.includes("__"))).toEqual(["lembrar", "pedir_aprovacao", "pedir_a_pessoa"]);
    const sala = nomes(montarPlano({ ...base, modo: "sala" }));
    expect(sala).toContain("passar");
    expect(sala).toContain("encaminhar");
    expect(sala).toContain("pedir_a_pessoa");
  });

  it("EMENDA 15: origem rotina com exige_aprovacao liga efeitoExternoSoPorAprovacao; conversa não", () => {
    const rot = montarPlano({ ...base, turno: { ...turno, origem: "rotina" }, modo: "rotina", rotina: { exigeAprovacao: true } });
    expect(rot.politicaExecucao.efeitoExternoSoPorAprovacao).toBe(true);
    const rotSemGate = montarPlano({ ...base, turno: { ...turno, origem: "rotina" }, modo: "rotina", rotina: { exigeAprovacao: false } });
    expect(rotSemGate.politicaExecucao.efeitoExternoSoPorAprovacao).toBe(false);
    expect(montarPlano(base).politicaExecucao.efeitoExternoSoPorAprovacao).toBe(false);
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
    expect(p.entrada).toEqual({ texto: "oi", sessaoCli: "sess-1", modelo: "claude-haiku-4-5-20251001", maxTurnos: 12 });
    expect(p.politicaExecucao.prazoMs).toBe(86_400_000);
    expect(p.expiraEm).toBe(agora + 3_600_000);
    expect("cwd" in p.politicaExecucao).toBe(false);
  });
});
