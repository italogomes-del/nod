import { describe, expect, it, vi } from "vitest";
import type { SuaVezDto } from "../../../src/contracts/api.ts";
import type { TipoDecisao } from "../../../src/contracts/decisao.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { destinoDoEnvio, enviarPeloComposer, inicioDaPergunta, modoDoComposer, MOTIVO_SEM_ANEXO, type ApiDeEnvio } from "../../../web/lib/perguntas.ts";
import { hora } from "../../../web/lib/render.ts";
import { htmlComposer, renderTimeline } from "../../../web/telas/conversa.ts";
import { aparenciaDoComposer, renderTopoComposer, TRECHO_FAIXA_MAX } from "../../../web/telas/pergunta.ts";
import { renderDecisoesDaConversa, renderSuaVez } from "../../../web/telas/sua-vez.ts";

/**
 * Perguntas viram conversa (emenda da ADR-045, definido em 2026-09-24). Antes: a pergunta de
 * pedir_a_pessoa chegava como mensagem ("parei para perguntar…") E como card com caixa de texto
 * ("sua resposta em texto" + "Responder e retomar") — duas caixas para escrever e a frase duas vezes.
 * Agora: balão de pergunta, faixa acima do campo, o campo responde, respostas prontas em botões.
 */
type Item = SuaVezDto["itens"][number];

const AGORA = Date.parse("2026-09-24T12:00:00Z");
const H = 3_600_000;
const autoria = { autor_tipo: "agente", autor_id: "a", sob_procuracao_de: null, conta_de_execucao: "p", executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1 } as const;
const daPessoa = { ...autoria, autor_tipo: "pessoa", autor_id: "p", decidido_por: "pessoa" } as const;

function item(id: string, p: { tipo?: TipoDecisao; criadoEm?: number; vencido?: boolean; frase?: string } = {}): Item {
  const criadoEm = p.criadoEm ?? AGORA - 2 * H;
  return {
    decisao: {
      tenantId: "t", id, ownerId: "p", decisorId: "p", agenteId: "a", conversaId: "c", turnoId: "t1", tipo: p.tipo ?? "pergunta",
      estado: p.vencido ? "vencida" : "pendente",
      prazoDecisaoEm: new Date(p.vencido ? AGORA - 3 * H : criadoEm + 24 * H).toISOString(), prazoExecucaoEm: null,
      frase: p.frase ?? `parei para perguntar a Marlon: pergunta ${id}`,
      desfecho: p.vencido ? { tipo: "expirou_sem_ninguem_ver", em: new Date(AGORA - 3 * H).toISOString() } : null,
      vistaEm: null, criadoEm: new Date(criadoEm).toISOString(), fioId: null,
    },
    estadoColuna: p.vencido ? "vencido" : "pendente", agenteNome: "Nina", aguardandoHaMs: 0, recusaAutomaticaEmMs: 0, gemeas: [], itensAprovacao: [], proposta: null, fio: null,
  };
}

function fala(id: string, decisaoId: string, texto: string, opcoes?: string[], criadoEm = AGORA - 2 * H): Mensagem {
  return { tenantId: "t", id, conversaId: "c", turnoId: "t1", autoria, kind: "texto", texto, payload: { kind: "pedido_a_pessoa", decisaoId, ...(opcoes ? { opcoes } : {}) }, confianca: "confiavel", parcial: false, criadoEm };
}

function resposta(id: string, decisaoId: string, texto: string, criadoEm: number, perguntaEm: number, retomada = true): Mensagem {
  return { tenantId: "t", id, conversaId: "c", turnoId: "t1", autoria: daPessoa, kind: "texto", texto, payload: { kind: "resposta_a_pedido", decisaoId, agenteId: "a", perguntaEm, retomada }, confianca: "confiavel", parcial: false, criadoEm };
}

const nina = { id: "a", tenantId: "t", ownerId: "p", nome: "Nina", titulo: "E-mails", descricao: "", descricaoEstado: "", cor: "c-black", forma: "quadrado", conversaId: "c", confirmado: true, fixado: false, oculto: false, naoLido: false, secao: null, computadorForaDoAr: null } as never;

function conversa(mensagens: Mensagem[]): ConversaEstado {
  return { conversa: { tenantId: "t", id: "c", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens, propostas: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], atividades: {}, carregadaEm: 0 };
}

function cenario(mensagens: Mensagem[], itens: Item[]): Estado {
  return {
    ...estadoInicial,
    agora: AGORA,
    sessao: { tenantId: "t", pessoaId: "p" },
    tela: { tipo: "conversa", conversaId: "c", agenteId: "a" },
    frota: { agentes: [nina], inventario: null, negacoes: [] } as never,
    suaVez: { itens, incidentes: [], foraDoAr: [], vazio: itens.length === 0, ultimaDecisaoEm: null },
    conversas: { c: conversa(mensagens) },
  };
}

const PERGUNTA = "Posso arquivar o PR 7? Ele está parado há duas semanas e sem revisão.";
const umaAberta = (): Estado => cenario([fala("m1", "d1", PERGUNTA)], [item("d1")]);
const timeline = (e: Estado): string => renderTimeline(e.conversas.c ?? null, e);
const PADRAO = { placeholder: "Escreva uma mensagem para Nina…", nota: "Enter envia · Shift+Enter quebra linha" };

describe("a pergunta é a fala do agente, não um card", () => {
  it("aberta vira balão de pergunta com 'Parei aqui até você responder' — sem card, sem caixa de texto, e a frase aparece uma vez", () => {
    const html = timeline(umaAberta());
    expect(html).toContain('class="message bot pergunta"');
    expect(html).toContain('data-pergunta="d1"');
    expect(html).toContain("Parei aqui até você responder");
    expect(html.split("Posso arquivar o PR 7?").length - 1).toBe(1);
    expect(html).not.toContain("Preciso da sua decisão para continuar");
    expect(html).not.toContain('class="decisao');
    expect(html).not.toContain("<input");
    expect(html).not.toContain("Responder e retomar");
    expect(html).not.toContain("parei para perguntar");
    expect(renderDecisoesDaConversa(umaAberta(), "c", new Set())).toBe("");
  });

  it("os outros pedidos da conversa continuam como card: só as três de pedir_a_pessoa viram conversa", () => {
    const e = cenario([fala("m1", "d1", PERGUNTA)], [item("d1"), item("ac", { tipo: "acesso", frase: "Nina precisa ler seu Gmail" })]);
    const cards = renderDecisoesDaConversa(e, "c", new Set());
    expect(cards).toContain('data-decisao="ac"');
    expect(cards).not.toContain('data-decisao="d1"');
    for (const tipo of ["pergunta", "falta_de_dado", "permissao"] as const) {
      expect(renderDecisoesDaConversa(cenario([], [item("x", { tipo })]), "c", new Set()), tipo).toBe("");
    }
  });

  it("respostas prontas viram botões que mandam o TEXTO da opção como resposta, com 'ou responda com suas palavras aí embaixo'", () => {
    const html = timeline(cenario([fala("m1", "d1", PERGUNTA, ["Sim, pode arquivar", "Não, deixe <aberto>"])], [item("d1")]));
    expect(html).toContain('data-act="responder-opcao" data-id="d1" data-texto="Sim, pode arquivar"');
    expect(html).toContain(">Sim, pode arquivar</button>");
    expect(html).toContain("Não, deixe &lt;aberto&gt;");
    expect(html).not.toContain("<aberto>");
    expect(html).toContain("ou responda com suas palavras aí embaixo");
    expect(html.indexOf("Parei aqui até você responder")).toBeLessThan(html.indexOf('data-act="responder-opcao"'));
    expect(timeline(umaAberta())).not.toContain("ou responda com suas palavras");
  });

  it("depois de responder: 'Respondida por você · HH:MM' no balão, 'respondendo à pergunta das HH:MM' na mensagem e 'Nina retomou com a sua resposta'", () => {
    const perguntaEm = AGORA - 2 * H;
    const respondidaEm = AGORA - H;
    const html = timeline(cenario([fala("m1", "d1", PERGUNTA, ["Sim"], perguntaEm), resposta("r1", "d1", "Sim, pode arquivar", respondidaEm, perguntaEm)], []));
    expect(html).toContain(`Respondida por você · ${hora(respondidaEm)}`);
    expect(html).toContain(`respondendo à pergunta das ${hora(perguntaEm)}`);
    expect(html).toContain("Nina retomou com a sua resposta");
    expect(html).not.toContain("Parei aqui até você responder");
    expect(html).not.toContain('data-act="responder-opcao"');
    expect(html.indexOf("respondendo à pergunta das")).toBeLessThan(html.indexOf("Sim, pode arquivar"));
    expect(html.indexOf("Sim, pode arquivar")).toBeLessThan(html.indexOf("Nina retomou"));
    // Sem turno para retomar (decisão de sala esfriada), nada de "retomou".
    expect(timeline(cenario([fala("m1", "d1", PERGUNTA), resposta("r1", "d1", "ok", respondidaEm, perguntaEm, false)], []))).not.toContain("retomou");
  });

  it("vencida continua no balão com o que houve e o Reabrir (ADR-007: recolher não é suprimir)", () => {
    const html = timeline(cenario([fala("m1", "d1", PERGUNTA)], [item("d1", { vencido: true })]));
    expect(html).toContain("Sem resposta · venceu há 3h · ninguém chegou a ver");
    expect(html).toContain('data-act="reabrir" data-id="d1"');
    expect(html).not.toContain("Parei aqui até você responder");
  });
});

describe("a faixa e o campo em modo resposta", () => {
  it("faixa: '{agente} está esperando sua resposta · há 2h · vence em 22h', com 'Ver pergunta' e 'Deixar pra lá' (a dispensa do #46)", () => {
    const e = umaAberta();
    const topo = renderTopoComposer(modoDoComposer(e, "c"), e);
    expect(topo).toContain("<b>Nina</b> está esperando sua resposta · há 2h · vence em 22h");
    expect(topo).toContain('data-act="ver-pergunta" data-id="d1"');
    expect(topo).toContain('data-act="dispensar" data-id="d1"');
    expect(topo).toContain("Deixar pra lá");
    expect(topo).toContain('data-act="composer-responder" aria-pressed="true">Responder à pergunta');
    expect(topo).toContain('data-act="composer-outro" aria-pressed="false">Outro assunto');
    // Uma pergunta só: sem citação.
    expect(topo).not.toContain("Respondendo à");
    // Pergunta de antes da mudança (sem balão ligado): a faixa fica, o "Ver pergunta" não.
    const antiga = cenario([], [item("d1")]);
    expect(renderTopoComposer(modoDoComposer(antiga, "c"), antiga)).not.toContain("ver-pergunta");
    // Sem pergunta aberta, nada acima do campo.
    const nada = cenario([], []);
    expect(renderTopoComposer(modoDoComposer(nada, "c"), nada)).toBe("");
  });

  it("a faixa diz O QUE a pergunta pergunta: o início do balão, ou a frase da fila sem o molde quando não há balão ligado", () => {
    const e = umaAberta();
    const topo = renderTopoComposer(modoDoComposer(e, "c"), e);
    expect(topo).toContain(`class="fp-pergunta" title="${PERGUNTA}">“${PERGUNTA}”`);
    // Pergunta longa: cortada na palavra, com reticências; o title guarda o texto inteiro.
    const longa = "O backlog de não lidos ainda tem 200+ e-mails, e minhas ferramentas só aplicam label um e-mail por vez — prefere que eu continue ou pare o backfill?";
    const el = cenario([fala("m1", "d1", longa)], [item("d1")]);
    const topoLongo = renderTopoComposer(modoDoComposer(el, "c"), el);
    expect(topoLongo).toContain(`“${inicioDaPergunta(longa, TRECHO_FAIXA_MAX)}”`);
    expect(inicioDaPergunta(longa, TRECHO_FAIXA_MAX).endsWith("…")).toBe(true);
    // Sem balão ligado (o caso da Nina em 24/09, 18:19): o trecho vem da frase, sem "parei para perguntar a Marlon:".
    const antiga = cenario([], [item("d1", { frase: "parei para perguntar a Marlon: Continuo o backlog <todo>?" })]);
    const topoAntigo = renderTopoComposer(modoDoComposer(antiga, "c"), antiga);
    expect(topoAntigo).toContain("“Continuo o backlog &lt;todo&gt;?”");
    expect(topoAntigo).not.toContain("parei para perguntar");
    // Com duas abertas a citação já mostra o trecho: a faixa não repete.
    const duas = cenario([fala("m1", "d1", PERGUNTA), fala("m2", "d2", "Outra coisa?", undefined, AGORA - H)], [item("d1"), item("d2", { criadoEm: AGORA - H })]);
    const topoDuas = renderTopoComposer(modoDoComposer(duas, "c"), duas);
    expect(topoDuas).toContain("citacao-pergunta");
    expect(topoDuas).not.toContain("fp-pergunta");
  });

  it("modo resposta: placeholder 'Responda à Nina…', borda realçada, a dica e o clipe desligado com o motivo", () => {
    const e = umaAberta();
    const a = aparenciaDoComposer(modoDoComposer(e, "c"), e, PADRAO);
    expect(a.resposta).toBe(true);
    expect(a.placeholder).toBe("Responda à Nina…");
    expect(a.nota).toBe("Sua próxima mensagem responde à pergunta, e Nina continua de onde parou.");
    expect(a.anexoBloqueado).toBe(MOTIVO_SEM_ANEXO);
    expect(MOTIVO_SEM_ANEXO).toContain("Outro assunto");
    const normal = aparenciaDoComposer(modoDoComposer(cenario([], []), "c"), cenario([], []), PADRAO);
    expect(normal).toEqual({ topo: "", resposta: false, placeholder: PADRAO.placeholder, nota: PADRAO.nota, anexoBloqueado: null });
    // O campo nasce com a região da faixa e guarda a dica de sempre para voltar a ela.
    const html = htmlComposer("x", [], { anexos: "tudo" });
    expect(html).toContain('id="composer-pergunta"');
    expect(html).toContain('id="composer-nota" data-padrao="Enter envia · Shift+Enter quebra linha · arraste ou cole imagens e PDFs"');
  });

  it("duas perguntas: o campo cita a mais antiga — 'Respondendo à Nina · “…” · 1 de 2' com × — e 'Responder a esta' troca a citada", () => {
    const e = cenario([fala("m1", "d1", PERGUNTA, undefined, AGORA - 3 * H), fala("m2", "d2", "E o PR 9, fecho também?", undefined, AGORA - H)], [item("d2", { criadoEm: AGORA - H }), item("d1", { criadoEm: AGORA - 3 * H })]);
    const modo = modoDoComposer(e, "c");
    expect(modo.tipo === "resposta" && modo.alvo.decisao.id).toBe("d1");
    const topo = renderTopoComposer(modo, e);
    expect(topo).toContain(`Respondendo à <b>Nina</b> · “${inicioDaPergunta(PERGUNTA)}” · 1 de 2`);
    expect(inicioDaPergunta(PERGUNTA)).toMatch(/…$/);
    expect(topo).toContain('data-act="composer-outro"');
    expect(topo).toContain("Cancelar a resposta e mandar como mensagem comum");
    const html = timeline(e);
    expect(html).toContain('class="message bot pergunta pergunta-citada" data-mensagem="m1"');
    expect(html).toContain('data-act="composer-responder" data-id="d2"');
    expect(html).not.toContain('data-act="composer-responder" data-id="d1"');

    const outra = reduzir(e, { tipo: "composer", conversaId: "c", escolha: { outroAssunto: false, alvoId: "d2" } });
    const segunda = modoDoComposer(outra, "c");
    expect(segunda.tipo === "resposta" && segunda.alvo.decisao.id).toBe("d2");
    expect(renderTopoComposer(segunda, outra)).toContain("“E o PR 9, fecho também?” · 2 de 2");
  });

  it("'Outro assunto' (ou Esc, ou ×): a próxima mensagem vira mensagem comum e a pergunta continua aberta", () => {
    const e = reduzir(umaAberta(), { tipo: "composer", conversaId: "c", escolha: { outroAssunto: true, alvoId: null } });
    const modo = modoDoComposer(e, "c");
    expect(modo.tipo).toBe("outro");
    expect(destinoDoEnvio(modo)).toEqual({ tipo: "mensagem" });
    const topo = renderTopoComposer(modo, e);
    expect(topo).toContain("está esperando sua resposta");
    expect(topo).toContain('data-act="composer-outro" aria-pressed="true"');
    expect(aparenciaDoComposer(modo, e, PADRAO)).toMatchObject({ resposta: false, placeholder: PADRAO.placeholder, anexoBloqueado: null });
    // A escolha só vale enquanto a conversa tem pergunta: sem ela, "Sua vez" relida esquece a escolha.
    expect(e.composer.c).toBeDefined();
    const semPergunta = reduzir(e, { tipo: "hidratar-sua-vez", suaVez: { itens: [], incidentes: [], foraDoAr: [], vazio: true, ultimaDecisaoEm: null } });
    expect(semPergunta.composer.c).toBeUndefined();
    expect(reduzir(e, { tipo: "composer", conversaId: "c", escolha: null }).composer.c).toBeUndefined();
  });
});

describe("enviar pelo campo", () => {
  const espiao = () => {
    const api = { enviar: vi.fn(async () => ({})), responder: vi.fn(async () => ({})), postarNaSala: vi.fn(async () => ({})) } satisfies ApiDeEnvio;
    return api;
  };

  it("em modo resposta chama POST decisoes/:id/responder (a retomada nasce lá), nunca o envio normal", async () => {
    const api = espiao();
    const e = umaAberta();
    const r = await enviarPeloComposer(api, { conversaId: "c", salaId: null }, destinoDoEnvio(modoDoComposer(e, "c")), "Sim, pode arquivar");
    expect(r).toEqual({ enviado: "resposta" });
    expect(api.responder).toHaveBeenCalledWith("d1", "Sim, pode arquivar");
    expect(api.enviar).not.toHaveBeenCalled();
    expect(api.postarNaSala).not.toHaveBeenCalled();
  });

  it("'Outro assunto' e conversa sem pergunta vão pelo envio normal; sala pela sala", async () => {
    const api = espiao();
    const outro = reduzir(umaAberta(), { tipo: "composer", conversaId: "c", escolha: { outroAssunto: true, alvoId: null } });
    await enviarPeloComposer(api, { conversaId: "c", salaId: null }, destinoDoEnvio(modoDoComposer(outro, "c")), "e o relatório?", ["an1"]);
    expect(api.enviar).toHaveBeenCalledWith("c", "e o relatório?", ["an1"]);
    await enviarPeloComposer(api, { conversaId: "c", salaId: "s1" }, destinoDoEnvio(modoDoComposer(cenario([], []), "c")), "oi, sala");
    expect(api.postarNaSala).toHaveBeenCalledWith("s1", "oi, sala");
    expect(api.responder).not.toHaveBeenCalled();
  });

  it("anexo pronto em modo resposta é recusado por escrito — a resposta não sai e o arquivo não some", async () => {
    const api = espiao();
    const r = await enviarPeloComposer(api, { conversaId: "c", salaId: null }, { tipo: "resposta", decisaoId: "d1" }, "segue o print", ["an1"]);
    expect(r).toEqual({ recusado: "anexo_na_resposta" });
    expect(api.responder).not.toHaveBeenCalled();
    expect(api.enviar).not.toHaveBeenCalled();
  });
});

describe("'Sua vez' (ver todos)", () => {
  it("a pergunta mostra a frase e 'Responder na conversa', sem caixa de texto nem 'abrir conversa' repetido", () => {
    const e = cenario([], [item("d1", { frase: "parei: falta planilha de vendas; quem destrava: Marlon; não vou tentar de novo." })]);
    const html = renderSuaVez(e);
    expect(html).toContain("parei: falta planilha de vendas");
    expect(html).toContain('data-act="responder-na-conversa" data-id="d1" data-conversa="c" data-agente="a"');
    expect(html).toContain(">Responder na conversa</button>");
    expect(html).not.toContain("<input");
    expect(html).not.toContain(">abrir conversa</button>");
    expect(html).toContain('title="Deixar pra lá: fecha sem responder"');
  });

  it("a decisora designada que não é dona da conversa (quem_destrava, EMENDA 1) responde ali mesmo: a conversa de outra pessoa ela não lê", () => {
    const deOutra = item("d9");
    const html = renderSuaVez(cenario([], [{ ...deOutra, decisao: { ...deOutra.decisao, ownerId: "outra-pessoa" } }]));
    expect(html).toContain('data-resposta="d9"');
    expect(html).toContain('placeholder="Responda à Nina…"');
    expect(html).toContain('data-act="responder" data-id="d9"');
    expect(html).not.toContain("responder-na-conversa");
  });
});
