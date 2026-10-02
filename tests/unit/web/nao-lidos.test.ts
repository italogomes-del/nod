import { describe, expect, it } from "vitest";
import type { ConversaNaoLida } from "../../../src/contracts/nao-lidos.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, invalidacoesDaTela, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { renderTimeline } from "../../../web/telas/conversa.ts";
import { naoLidaDe, quando, renderNaoLidos, rotuloNaoLidos } from "../../../web/telas/nao-lidos.ts";

/**
 * Não lidos na web (definido em 2026-09-29, 0039; canvas "Nod — tela do agente", página "Não lidos"): o frame de
 * mensagem nova relê a lista, a tela junta o que chegou e a conversa desenha a linha "Novas" onde a pessoa parou.
 */
const AGORA = new Date(2026, 8, 29, 12, 0).getTime();
const AS_8 = new Date(2026, 8, 29, 8, 0).getTime();
const AUTORIA = { sob_procuracao_de: null, conta_de_execucao: "p", executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1 } as const;

function mensagem(id: string, texto: string, extra: Partial<Mensagem> = {}): Mensagem {
  return { tenantId: "t", id, conversaId: "c1", turnoId: null, kind: "texto", texto, payload: null, confianca: "confiavel", parcial: false, criadoEm: AS_8, autoria: { ...AUTORIA, autor_tipo: "agente", autor_id: "a1" }, ...extra };
}

function naoLida(extra: Partial<ConversaNaoLida> = {}): ConversaNaoLida {
  const m = mensagem("m2", "Os três pareceres estão prontos.");
  return { conversaId: "c1", tipo: "propria", agenteId: "a1", salaId: null, total: 2, primeiraId: "m1", desde: AS_8, ultimaEm: AS_8, mensagens: [m], daRotina: false, ...extra };
}

const base: Estado = {
  ...estadoInicial,
  agora: AGORA,
  sessao: { tenantId: "t", pessoaId: "p" },
  frota: { agentes: [{ id: "a1", nome: "Dev 1", titulo: "Dev Sr", cor: "c-green", forma: "shape-cloud", ownerId: "p", conversaId: "c1" }, { id: "a2", nome: "Milton", titulo: "PM", cor: "c-black", forma: "shape-drop", ownerId: "p", conversaId: "c2" }] } as never,
};

describe("não lidos no estado da web", () => {
  it("mensagem nova relê a lista; a lista falta em qualquer tela até chegar", () => {
    const e = reduzir(base, { tipo: "frame", frame: { tipo: "mensagem.nova", dados: { conversaId: "c1" } } as never, agora: AGORA });
    expect(e.invalidacoes).toContain("nao-lidos");
    expect(invalidacoesDaTela({ ...base, tela: { tipo: "rotinas" } })).toContain("nao-lidos");
    const com = reduzir(base, { tipo: "hidratar-nao-lidos", naoLidos: { conversas: [naoLida()] } });
    expect(invalidacoesDaTela(com)).not.toContain("nao-lidos");
    expect(naoLidaDe(com, "c1")?.total).toBe(2);
  });

  it("a linha Novas vale enquanto a pessoa está na conversa: navegar para qualquer lugar a apaga", () => {
    const e = reduzir(base, { tipo: "novas-desde", conversaId: "c1", mensagemId: "m1", em: AS_8 });
    expect(e.novasDesde.c1).toEqual({ mensagemId: "m1", em: AS_8 });
    expect(reduzir(e, { tipo: "navegar", tela: { tipo: "nao-lidos" } }).novasDesde).toEqual({});
  });

  it("trocar de pessoa esquece a lista da anterior", () => {
    const com = reduzir(base, { tipo: "hidratar-nao-lidos", naoLidos: { conversas: [naoLida()] } });
    expect(reduzir(com, { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "outra" } }).naoLidos).toBeNull();
  });
});

describe("a tela Não lidos", () => {
  it("vazia, diz o que vai aparecer e não oferece marcar tudo", () => {
    const html = renderNaoLidos({ ...base, naoLidos: { conversas: [] } });
    expect(html).toContain("Nada novo");
    expect(html).not.toContain('data-act="marcar-tudo-lido"');
    expect(rotuloNaoLidos({ naoLidos: { conversas: [] } })).toBe("Não lidos: nada novo");
  });

  it("uma conversa por grupo: nome, chip, quantas novas, as mensagens e as duas ações", () => {
    const html = renderNaoLidos({ ...base, naoLidos: { conversas: [naoLida()] } });
    expect(html).toContain("1 conversa · o mais antigo é de hoje, 08:00");
    expect(html).toContain('data-act="marcar-tudo-lido"');
    expect(html).toContain("<b>Dev 1</b>");
    expect(html).toContain('<i class="chip">Dev Sr</i>');
    expect(html).toContain("· 2 novas");
    expect(html).toContain("Os três pareceres estão prontos.");
    expect(html).toContain("1 anterior na conversa");
    expect(html).toContain('data-act="abrir-conversa" data-conversa="c1" data-agente="a1"');
    expect(html).toContain('data-act="marcar-lida" data-conversa="c1"');
  });

  it("rotina diz de quando é; pedido aberto do bot vira a tag âmbar; sala mostra quem escreveu", () => {
    const suaVez = { itens: [{ decisao: { id: "d1", agenteId: "a2", tipo: "acesso", estado: "pendente" }, estadoColuna: "pendente", gemeas: [] }], incidentes: [], foraDoAr: [], vazio: false, ultimaDecisaoEm: null } as never;
    const sala = naoLida({ conversaId: "c9", tipo: "sala", agenteId: null, salaId: "s1", total: 1, mensagens: [mensagem("m9", "Subi a revisão do PR #5.", { conversaId: "c9", autoria: { ...AUTORIA, autor_tipo: "agente", autor_id: "a2" } })] });
    const html = renderNaoLidos({
      ...base,
      suaVez,
      salas: [{ sala: { id: "s1", nome: "geral" }, membros: [] }] as never,
      naoLidos: { conversas: [naoLida({ daRotina: true, total: 1 }), naoLida({ conversaId: "c2", agenteId: "a2", total: 1 }), sala] },
    });
    expect(html).toContain("· rotina das 08:00");
    expect(html).toContain('<span class="tag tag-ambar">esperando sua decisão</span>');
    expect(html).toContain("# geral");
    expect(html).toContain("<small>Milton</small>");
    expect(html).toContain('data-act="abrir-sala" data-sala="s1" data-conversa="c9"');
    expect(html).toContain("3 conversas");
  });

  it("quando: hoje, ontem ou a data", () => {
    expect(quando(AS_8, AGORA)).toBe("hoje, 08:00");
    expect(quando(AS_8 - 86_400_000, AGORA)).toBe("ontem, 08:00");
    expect(quando(AS_8 - 3 * 86_400_000, AGORA)).toMatch(/^26\/09/);
  });
});

describe("a linha Novas na conversa", () => {
  function comConversa(novasDesde: Estado["novasDesde"]): Estado {
    const c: ConversaEstado = { conversa: { tenantId: "t", id: "c1", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a1", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens: [mensagem("m0", "Começando pelo #420."), mensagem("m1", "Os três pareceres estão prontos.")], propostas: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], carregadaEm: 0 };
    return { ...base, conversas: { c1: c }, novasDesde };
  }

  it("entra logo acima da primeira não lida, com a hora", () => {
    const html = renderTimeline(comConversa({ c1: { mensagemId: "m1", em: AS_8 } }).conversas.c1!, comConversa({ c1: { mensagemId: "m1", em: AS_8 } }));
    expect(html).toContain('<div class="linha-novas" role="separator" aria-label="Mensagens novas"><span>Novas · desde 08:00</span></div>');
    expect(html.indexOf("Começando pelo #420.")).toBeLessThan(html.indexOf("linha-novas"));
    expect(html.indexOf("linha-novas")).toBeLessThan(html.indexOf("Os três pareceres"));
  });

  it("sem marca, não há linha", () => {
    const e = comConversa({});
    expect(renderTimeline(e.conversas.c1!, e)).not.toContain("linha-novas");
  });
});
