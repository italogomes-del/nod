import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ESTADOS_ABERTOS_TRABALHO, type TrabalhoDto } from "../../../src/contracts/trabalho.ts";
import type { FrameSse } from "../../../src/contracts/frame.ts";
import { aplicarFrame, conversaIdNaTela, estadoInicial, invalidacoesDaTela, reduzir, type Estado, type Tela } from "../../../web/estado/reducer.ts";
import { ESPERA_TELEMETRIA_MS, LOTE_TELEMETRIA, criarTelemetria } from "../../../web/lib/telemetria-linhas.ts";
import { ESTADOS_ABERTOS, agrupar, filtrar, memoriaLegivel, pilulaMemoria, telaAoFechar, telaDaTask, textoPararTasks } from "../../../web/lib/trabalhos.ts";
import { comFerramenta, comTexto, ATIVIDADE_VAZIA } from "../../../web/lib/atividade.ts";
import { renderDetalhes } from "../../../web/telas/detalhes.ts";
import { renderTaxasLinhas } from "../../../web/telas/modo-dev.ts";
import { chipTrabalhosDoBot, htmlAcoesDaTask, renderFaixaTrabalhos, renderGavetaTrabalhos, renderIconeTrabalhos, renderTelaTrabalho, renderTodosOsTrabalhos, renderTopoTrabalho } from "../../../web/telas/trabalhos.ts";

/** As telas dos trabalhos (#195, filha 07; #196, filha 08): faixa, tela da task, barra, gaveta, "Todos os trabalhos", memória. */

const MIN = 60_000;
const AGORA = new Date(2026, 9, 7, 21, 0).getTime();
const HOJE = new Date(2026, 9, 7, 20, 0).getTime();
const ONTEM = new Date(2026, 9, 6, 18, 0).getTime();

const trabalho = (id: string, extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id, agenteId: "leo", conversaId: "c-leo", titulo: id, origem: "pessoa", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: HOJE, iniciadoEm: HOJE, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: null, esperandoComputadorDe: null, ...extra,
});

function estadoCom(trabalhos: TrabalhoDto[], extra: Partial<Estado> = {}): Estado {
  return {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
    frota: { agentes: [
      { id: "leo", nome: "Leonardo", conversaId: "c-leo", cor: "c-purple", forma: "shape-circle", ownerId: "p", titulo: "Dados", descricao: "", confirmado: true },
      { id: "dev1", nome: "Dev 1", conversaId: "c-dev1", cor: "c-green", forma: "shape-square", ownerId: "p", titulo: "Dev", descricao: "", confirmado: true },
    ] } as never,
    trabalhos: { trabalhos, pressao: null, memoriaTotalMb: null },
    tela: { tipo: "conversa", conversaId: "c-leo", agenteId: "leo" },
    ...extra,
  };
}

/**
 * O cliente REST da web usa XMLHttpRequest (DOM), e o tsconfig.server.json — que também checa tests/ — não tem a lib DOM:
 * o módulo entra por `vi.importActual`, que o tsc não segue; o tipo abaixo é só o que estes testes chamam.
 */
type ApiDeTeste = { criarApi: (escopo: { tenantId: string; pessoaId: string }) => {
  gravarPreferencias(p: { faixaTrabalhosRecolhida: boolean }): Promise<unknown>;
  escreverNoTrabalho(id: string, texto: string): Promise<unknown>;
  pararTrabalho(id: string): Promise<unknown>;
  trabalhoDepois(id: string, depoisDe: string): Promise<unknown>;
  trabalhoFazerAqui(id: string): Promise<unknown>;
} };
const criarApi = async (escopo: { tenantId: string; pessoaId: string }) => (await vi.importActual<ApiDeTeste>("../../../web/lib/api.ts")).criarApi(escopo);

const css = readFileSync(new URL("../../../web/interface.css", import.meta.url), "utf8");

describe("faixa de Trabalhos e pílula (#195, K1/K6)", () => {
  const migrar = trabalho("migrar", { titulo: "Migrar relatórios", ultimoPasso: "18 de 42", iniciadoEm: AGORA - 15 * MIN });
  const churn = trabalho("churn", { titulo: "Dashboard de churn Q3", criadoEm: HOJE + MIN, estado: "na_fila", depoisDeTrabalhoId: "migrar" });
  const pedido = trabalho("rev", { titulo: "Revisar dados do #505", origem: "colega", pedidoPorAgenteId: "chico", pedidoPorNome: "Chico", criadoEm: HOJE + 2 * MIN });

  it("aparece com trabalho aberto do bot, uma linha por trabalho (ponto, título, origem, progresso, seta → tela da task)", () => {
    const html = renderFaixaTrabalhos(estadoCom([migrar, churn, pedido, trabalho("feito", { estado: "terminado", terminadoEm: AGORA })]), "leo");
    expect(html).toContain("<span>Trabalhos do Leonardo</span><span class=\"ft-n\">3</span>");
    expect(html.match(/class="ft-linha"/g)).toHaveLength(3);
    expect(html).toContain('data-act="abrir-trabalho" data-id="migrar"');
    expect(html).toContain('<span class="ponto-trabalho c-purple pulso-trab"');
    expect(html).toContain('<span class="etiqueta-origem">de você</span>');
    expect(html).toContain('<span class="etiqueta-origem">pedido do Chico</span>');
    expect(html).toContain("18 de 42 · 15 min");
    expect(html).toContain("começa depois da Migrar relatórios");
    expect(html).toContain('data-act="faixa-trabalhos" data-recolher="1"');
    expect(html).not.toContain("feito");
  });

  it("some sem trabalho aberto (o terminado não conta; o de outro bot também não)", () => {
    expect(renderFaixaTrabalhos(estadoCom([trabalho("x", { estado: "terminado" }), trabalho("y", { agenteId: "dev1" })]), "leo")).toBe("");
    expect(renderFaixaTrabalhos(estadoCom([]), "leo")).toBe("");
  });

  it("recolhida, vira a pílula '● N trabalhando' que abre a faixa de novo", () => {
    const html = renderFaixaTrabalhos(estadoCom([migrar, churn], { faixaTrabalhosRecolhida: true }), "leo");
    expect(html).toContain("<span><b>2</b> trabalhando</span>");
    expect(html).toContain('data-act="faixa-trabalhos" data-recolher="0"');
    expect(html).not.toContain("ft-linha");
  });

  it("a escolha é guardada no estado e vai para PUT preferencias", async () => {
    expect(reduzir(estadoInicial, { tipo: "faixa-trabalhos", recolhida: true }).faixaTrabalhosRecolhida).toBe(true);
    const chamadas: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { chamadas.push({ url, init }); return new Response(JSON.stringify({ modoDev: false, avisosFechados: [], faixaTrabalhosRecolhida: true })); });
    await (await criarApi({ tenantId: "t", pessoaId: "p" })).gravarPreferencias({ faixaTrabalhosRecolhida: true });
    expect(chamadas[0]?.url).toBe("/api/t/t/preferencias");
    expect(chamadas[0]?.init.method).toBe("PUT");
    expect(JSON.parse(String(chamadas[0]?.init.body))).toEqual({ faixaTrabalhosRecolhida: true });
  });

  it("CSS: a faixa cola no campo (o campo perde os cantos de cima) e a região some vazia", () => {
    expect(css).toMatch(/\.lugar-faixa-trabalhos:empty \{ display: none; \}/);
    expect(css).toMatch(/\.lugar-faixa-trabalhos:has\(\.faixa-trab\) \+ \.composer-wrap \.composer \.box \{ border-top-left-radius: 0; border-top-right-radius: 0; \}/);
    expect(readFileSync(new URL("../../../web/index.html", import.meta.url), "utf8")).toMatch(/id="pilula-novas"[^\n]*\n[^\n]*\n\s*<div class="lugar-faixa-trabalhos" id="faixa-trabalhos"><\/div>\n\s*<footer class="composer-wrap" id="composer">/);
  });
});

afterEach(() => vi.unstubAllGlobals());

describe("a tela da task (#195, K2/K7)", () => {
  const login = trabalho("login", {
    agenteId: "dev1", conversaId: "c-dev1", titulo: "Login do app", origem: "colega", pedidoPorAgenteId: "chico", pedidoPorNome: "Chico", pasta: "~/nod/Dev 1/leapy-86akr9u9u",
    iniciadoEm: AGORA - 19 * MIN, turnoVivoId: "tv", esperandoComputadorDe: "Soft delete",
  });

  it("o topo: chip com ponto vivo, mascote, título e tempo; a linha de quem pediu, acessos e pasta; a espera do computador", () => {
    const html = renderTopoTrabalho(estadoCom([login]), "login");
    expect(html).toContain('<span class="tk-chip"><span class="ponto-trabalho c-green pulso-trab"');
    expect(html).toContain('<span class="tk-titulo">Login do app</span><span class="tk-tempo">· 19 min</span>');
    expect(html).toContain("task do Dev 1, pedida pelo Chico · com os acessos do Dev 1 · pasta ~/nod/Dev 1/leapy-86akr9u9u");
    expect(html).toContain("esperando o computador do Dev 1 (em uso por: Soft delete)");
  });

  it("o corpo: a conversa com quem pediu (com as falas do meio) e os passos centralizados do ao vivo", () => {
    const autoria = (id: string) => ({ autor_tipo: "agente", autor_id: id, sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:teste", regra_versao: 1 });
    const mensagens = [
      { tenantId: "t", id: "m1", conversaId: "c-dev1", turnoId: "tv", autoria: autoria("chico"), kind: "texto", texto: "Dev 1, pega o login", payload: { kind: "peer_pedido", conversaOrigemId: "c-chico", turnoOrigemId: "tc" }, confianca: "confiavel", parcial: false, criadoEm: HOJE, trabalhoId: "login", fimDoTurno: false },
      { tenantId: "t", id: "m2", conversaId: "c-dev1", turnoId: "tv", autoria: autoria("dev1"), kind: "texto", texto: "Pego. Reproduzi o bug.", payload: null, confianca: "confiavel", parcial: false, criadoEm: HOJE + MIN, trabalhoId: "login", fimDoTurno: false },
    ];
    let atividade = comFerramenta(comTexto(ATIVIDADE_VAZIA, "Criou a worktree."), "Bash");
    atividade = comTexto(atividade, "Gravando o vídeo do QA:");
    atividade = comFerramenta(atividade, "Bash");
    const e = reduzir(estadoCom([login], { tela: { tipo: "trabalho", id: "login", voltar: { tipo: "inicio" } } }), { tipo: "hidratar-trabalho", detalhe: { trabalho: login, mensagens: mensagens as never }, agora: AGORA });
    const html = renderTelaTrabalho({ ...e, atividades: { "c-dev1": { tv: { ...atividade, atual: "" } } } }, "login");
    expect(html).toContain("· pedido do Chico · a resposta volta para o Chico");
    expect(html).toContain("Dev 1, pega o login");
    expect(html).toContain("Pego. Reproduzi o bug.");
    expect(html).toContain('<div class="passo"><span class="passo-ok" aria-hidden="true">✓</span><span>Criou a worktree.</span></div>');
    expect(html).toContain('<div class="passo passo-agora">');
    expect(css).toMatch(/\.passo \{ display: flex; align-items: center; justify-content: center;/);
  });

  it("Parar task usa a rota do trabalho; Fechar volta à tela de antes (e não empilha tasks)", async () => {
    const acoes = htmlAcoesDaTask("login");
    expect(acoes).toContain('data-act="parar-trabalho" data-id="login"');
    expect(acoes).toContain(">Parar task<");
    expect(acoes).toContain('data-act="fechar-trabalho"');
    const conversa: Tela = { tipo: "conversa", conversaId: "c-leo", agenteId: "leo" };
    const task = telaDaTask(conversa, "login");
    expect(task).toEqual({ tipo: "trabalho", id: "login", voltar: conversa });
    expect(telaAoFechar(task)).toEqual(conversa);
    expect(telaDaTask(task, "outra").voltar).toEqual(conversa);
    expect(telaAoFechar(conversa)).toBeNull();
    const chamadas: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => { chamadas.push({ url, init }); return new Response(JSON.stringify({ ok: true, ids: {} })); });
    const api = await criarApi({ tenantId: "t", pessoaId: "p" });
    await api.escreverNoTrabalho("login", "cobre o cadastro também");
    await api.pararTrabalho("login");
    await api.trabalhoDepois("churn", "migrar");
    await api.trabalhoFazerAqui("churn");
    expect(chamadas.map((c) => `${c.init.method} ${c.url}`)).toEqual(["POST /api/t/t/trabalhos/login/mensagens", "POST /api/t/t/trabalhos/login/parar", "POST /api/t/t/trabalhos/churn/depois", "POST /api/t/t/trabalhos/churn/fazer-aqui"]);
    expect(JSON.parse(String(chamadas[0]?.init.body))).toEqual({ texto: "cobre o cadastro também" });
    expect(JSON.parse(String(chamadas[2]?.init.body))).toEqual({ depoisDe: "migrar" });
  });

  it("o Parar do chat com tasks abertas lista antes", () => {
    expect(textoPararTasks([{ titulo: "Migrar relatórios" }, { titulo: "Dashboard de churn" }])).toBe("Parar 2 tasks: Migrar relatórios e Dashboard de churn?");
    expect(textoPararTasks([{ titulo: "Migrar relatórios" }])).toBe("Parar a task Migrar relatórios?");
  });
});

describe("reducer: trabalhos, a tela da task e a memória", () => {
  const frame = (tipo: FrameSse["tipo"], dados: Record<string, unknown>): FrameSse => ({ tipo, dados } as FrameSse);

  it("trabalho.mudou relê os trabalhos e a conversa do bot; a tela da task aberta também", () => {
    const e = aplicarFrame(estadoCom([]), frame("trabalho.mudou", { trabalhoId: "migrar", agenteId: "leo", conversaId: "c-leo", estado: "rodando" }), AGORA);
    expect(e.invalidacoes).toEqual(expect.arrayContaining(["trabalhos", "conversa:c-leo"]));
    expect(e.invalidacoes).not.toContain("trabalho:migrar");
    const naTask = aplicarFrame(estadoCom([], { tela: { tipo: "trabalho", id: "migrar", voltar: { tipo: "inicio" } } }), frame("trabalho.mudou", { trabalhoId: "migrar", conversaId: "c-leo" }), AGORA);
    expect(naTask.invalidacoes).toContain("trabalho:migrar");
  });

  it("memoria.mudou atualiza a pressão na hora e relê os trabalhos; nível fora do formato é ignorado", () => {
    const e = aplicarFrame(estadoCom([]), frame("memoria.mudou", { nivel: "amarela" }), AGORA);
    expect(e.pressao).toBe("amarela");
    expect(e.invalidacoes).toContain("trabalhos");
    const lixo = estadoCom([]);
    expect(aplicarFrame(lixo, frame("memoria.mudou", { nivel: "roxa" }), AGORA)).toBe(lixo);
    expect(reduzir(estadoInicial, { tipo: "hidratar-trabalhos", trabalhos: { trabalhos: [], pressao: "vermelha", memoriaTotalMb: 9800 } }).pressao).toBe("vermelha");
  });

  it("a tela da task: pede o detalhe, guarda o ao vivo do turno dela (mesmo de outro bot) e recarregada volta a ser viva", () => {
    const tela: Tela = { tipo: "trabalho", id: "login", voltar: { tipo: "inicio" } };
    const base = { ...estadoCom([]), tela };
    expect(invalidacoesDaTela(base)).toContain("trabalho:login");
    const login = trabalho("login", { agenteId: "dev1", conversaId: "c-dev1", turnoVivoId: "tv", iniciadoEm: AGORA - MIN });
    const e = reduzir(base, { tipo: "hidratar-trabalho", detalhe: { trabalho: login, mensagens: [] }, agora: AGORA });
    expect(conversaIdNaTela(e)).toBe("c-dev1");
    expect(e.turnosVivos.tv).toMatchObject({ conversaId: "c-dev1", estado: "rodando", trabalhoId: "login" });
    const comDelta = aplicarFrame(e, frame("turno.delta", { turnoId: "tv", conversaId: "c-dev1", texto: "gravando" }), AGORA);
    expect(comDelta.atividades["c-dev1"]?.tv?.atual).toBe("gravando");
    // Fala nova na conversa do bot da task: a tela da task relê as mensagens dela.
    expect(aplicarFrame(e, frame("turno.fala", { turnoId: "tv", conversaId: "c-dev1" }), AGORA).invalidacoes).toContain("trabalho:login");
    expect(aplicarFrame(e, frame("turno.fala", { turnoId: "tx", conversaId: "c-outra" }), AGORA).invalidacoes).not.toContain("trabalho:login");
    // O frame turno.iniciado marca o turno do trabalho (o chat não o desenha).
    const iniciado = aplicarFrame(estadoCom([]), frame("turno.iniciado", { turnoId: "t9", conversaId: "c-leo", kind: "turno_despachado", trabalhoId: "migrar" }), AGORA);
    expect(iniciado.turnosVivos.t9?.trabalhoId).toBe("migrar");
  });

  it("trabalhos são lidos com a sessão; trocar de pessoa os esquece", () => {
    expect(invalidacoesDaTela({ ...estadoInicial, sessao: { tenantId: "t", pessoaId: "p" } })).toContain("trabalhos");
    const outra = reduzir(estadoCom([trabalho("x")], { pressao: "amarela" }), { tipo: "sessao", escopo: { tenantId: "t", pessoaId: "outra" } });
    expect(outra.trabalhos).toBeNull();
    expect(outra.pressao).toBeNull();
  });

  it("os estados abertos da web são os do contrato", () => {
    expect([...ESTADOS_ABERTOS]).toEqual([...ESTADOS_ABERTOS_TRABALHO]);
  });
});

describe("barra lateral (#196, K8 variante 3)", () => {
  it("bot com trabalho rodando: chip com o número e o ponto na cor do bot piscando; sem trabalho, nada", () => {
    const e = estadoCom([trabalho("a"), trabalho("b", { estado: "na_fila" })]);
    expect(chipTrabalhosDoBot(e, { id: "leo", cor: "c-purple", conversaId: "c-leo" })).toBe('<span class="chip-trab" title="2 trabalhos abertos"><span class="ponto-trabalho c-purple pulso-trab" aria-hidden="true"></span>2</span>');
    expect(chipTrabalhosDoBot(e, { id: "dev1", cor: "c-green", conversaId: "c-dev1" })).toBe("");
    // Só na fila (nenhum rodando): o número fica, o ponto não pisca.
    expect(chipTrabalhosDoBot(estadoCom([trabalho("b", { estado: "na_fila" })]), { id: "leo", cor: "c-purple", conversaId: "c-leo" })).not.toContain("pulso-trab");
  });

  it("CSS: opacidade em 1,6 s e nenhuma animação com prefers-reduced-motion", () => {
    expect(css).toMatch(/@keyframes pulsa-trab \{ 0%, 100% \{ opacity: 1; \} 50% \{ opacity: \.3; \} \}/);
    expect(css).toMatch(/\.pulso-trab \{ animation: pulsa-trab 1\.6s ease-in-out infinite; \}/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.pulso-trab \{ animation: none; \} \}/);
    expect(css).toMatch(/\.ponto-trabalho \{[^}]*background: var\(--mascote-cor, var\(--ink-3\)\);/);
  });

  it("o ícone 'Trabalhos' do topo só com trabalho aberto, com o número", () => {
    expect(renderIconeTrabalhos(estadoCom([trabalho("x", { estado: "terminado" })]))).toBe("");
    const html = renderIconeTrabalhos(estadoCom([trabalho("a"), trabalho("b", { agenteId: "dev1" })]));
    expect(html).toContain('data-act="navegar" data-tela="trabalhos"');
    expect(html).toContain('aria-label="Trabalhos: 2 abertos"');
    expect(html).toContain('<span class="contagem-topo" aria-hidden="true">2</span>');
  });
});

describe("gaveta e 'Todos os trabalhos' (#196, K3/K9/M3)", () => {
  const lista = [
    trabalho("churn", { titulo: "Dashboard de churn Q3", estado: "precisa_de_voce", ultimoPasso: "pergunta: por plano ou por segmento?" }),
    trabalho("migrar", { titulo: "Migrar relatórios", memoriaMb: 800 }),
    trabalho("rev", { titulo: "Revisar dados", origem: "colega", pedidoPorNome: "Chico", memoriaMb: 1400 }),
    trabalho("nps", { titulo: "Relatório de NPS", estado: "na_fila" }),
    trabalho("vendas", { titulo: "Atualizar vendas", origem: "rotina", rotinaNome: "Vendas", estado: "terminado", terminadoEm: HOJE + 30 * MIN }),
    trabalho("velho", { titulo: "De ontem", estado: "terminado", terminadoEm: ONTEM }),
    trabalho("dev", { agenteId: "dev1", titulo: "Login do app", origem: "colega", pedidoPorNome: "Chico", memoriaMb: 2100 }),
  ];

  it("os grupos: Precisa de você, Trabalhando (os que mais usam memória primeiro), Na fila e Terminados hoje (o de ontem sai)", () => {
    const g = agrupar(lista, AGORA);
    expect(g.precisa.map((t) => t.id)).toEqual(["churn"]);
    expect(g.trabalhando.map((t) => t.id)).toEqual(["dev", "rev", "migrar"]);
    expect(g.fila.map((t) => t.id)).toEqual(["nps"]);
    expect(g.terminados.map((t) => t.id)).toEqual(["vendas"]);
  });

  it("a gaveta do bot: o nível 'Trabalhos' com os grupos dele; a visão geral leva até lá", () => {
    const e = estadoCom(lista);
    const html = renderGavetaTrabalhos(e, "leo");
    const ordem = ["Precisa de você · 1", "Trabalhando · 2", "Na fila · 1", "Terminados hoje · 1"].map((t) => html.indexOf(t));
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(html).not.toContain("De ontem");
    expect(html).not.toContain("Login do app");
    expect(html).toContain('data-act="abrir-trabalho" data-id="rev"');
    expect(renderDetalhes(e)).toContain('data-act="gaveta" data-nivel="trabalhos" data-agente="leo"');
    expect(renderDetalhes({ ...e, gaveta: { agenteId: "leo", nivel: { tipo: "trabalhos" } } })).toContain("Trabalhos de Leonardo");
  });

  it("'Todos os trabalhos': todos os bots, o resumo, a memória de cada um e os filtros De você / Rotinas / Entre bots", () => {
    const e = estadoCom(lista, { tela: { tipo: "trabalhos" }, trabalhos: { trabalhos: lista, pressao: null, memoriaTotalMb: 3174 } });
    const html = renderTodosOsTrabalhos(e);
    expect(html).toContain("3 rodando · 1 na fila · 1 precisa de você · os bots usam 3,1 GB do seu Mac");
    expect(html.indexOf("Login do app")).toBeLessThan(html.indexOf("Revisar dados"));
    expect(html.indexOf("Revisar dados")).toBeLessThan(html.indexOf("Migrar relatórios"));
    expect(html).toContain("2,1 GB");
    expect(html).toContain("os que mais usam memória primeiro");
    expect(html).toContain('data-act="filtro-trabalhos" data-id="bots" aria-pressed="false"');
    const bots = renderTodosOsTrabalhos(e, "bots");
    expect(bots).toContain("Login do app");
    expect(bots).not.toContain("Migrar relatórios");
    expect(filtrar(lista, "rotinas").map((t) => t.id)).toEqual(["vendas"]);
    expect(filtrar(lista, "voce").map((t) => t.id)).toEqual(["churn", "migrar", "nps", "velho"]);
    expect(memoriaLegivel(620)).toBe("620 MB");
  });
});

describe("memória (#196, M1/M2/M3)", () => {
  it("amarela e vermelha, centralizadas, com 'Ver' que abre 'Todos os trabalhos'; verde ou sem leitura, nada", () => {
    expect(pilulaMemoria("verde", 3)).toBe("");
    expect(pilulaMemoria(null, 3)).toBe("");
    const amarela = pilulaMemoria("amarela", 18);
    expect(amarela).toMatch(/^<div class="linha-centro-wrap"/);
    expect(amarela).toContain("<b>Pouca memória no seu Mac</b><span class=\"pm-detalhe\">· 18 trabalhos abertos</span><span class=\"pm-ver\">Ver</span>");
    expect(amarela).toContain('data-act="navegar" data-tela="trabalhos"');
    expect(pilulaMemoria("vermelha", 24)).toContain("<b>Seu Mac está quase sem memória</b><span class=\"pm-detalhe\">· pode travar; 24 trabalhos abertos</span>");
  });

  it("no topo de 'Todos os trabalhos' sob pressão", () => {
    const e = estadoCom([trabalho("a")], { tela: { tipo: "trabalhos" }, pressao: "amarela" });
    const html = renderTodosOsTrabalhos(e);
    expect(html.indexOf("Pouca memória no seu Mac")).toBeGreaterThan(-1);
    expect(html.indexOf("Pouca memória no seu Mac")).toBeLessThan(html.indexOf("Trabalhando ·"));
    expect(css).toMatch(/\.pilula-memoria\.amarela \{ background: var\(--warning-soft\);/);
    expect(css).toMatch(/\.pilula-memoria\.vermelha \{ background: var\(--danger-soft\);/);
  });
});

describe("telemetria das linhas (#191)", () => {
  it("'mostrada' uma vez por linha por carga; 'aberta' a cada clique; sai em lote depois da espera", () => {
    const enviados: unknown[][] = [];
    const agenda: (() => void)[] = [];
    const t = criarTelemetria(async (e) => { enviados.push(e); }, (fn, ms) => { expect(ms).toBe(ESPERA_TELEMETRIA_MS); agenda.push(fn); });
    const linha = { tipo: "rotina" as const, agenteId: "leo", chaveLinha: "rotina:trabalho:r1" };
    t.mostrada(linha);
    t.mostrada(linha);
    t.aberta(linha);
    t.aberta(linha);
    expect(enviados).toEqual([]);
    expect(agenda).toHaveLength(1);
    agenda[0]!();
    expect(enviados).toEqual([[{ ...linha, acao: "mostrada" }, { ...linha, acao: "aberta" }, { ...linha, acao: "aberta" }]]);
  });

  it("o lote cheio sai na hora; a falha de rede não quebra nada", () => {
    let lotes = 0;
    const t = criarTelemetria(() => { lotes++; return Promise.reject(new Error("sem rede")); }, () => undefined);
    for (let i = 0; i < LOTE_TELEMETRIA; i++) t.mostrada({ tipo: "bots", agenteId: "a", chaveLinha: `k${i}` });
    expect(lotes).toBe(1);
    const lança = criarTelemetria(() => { throw new Error("sem sessão"); }, () => undefined);
    lança.aberta({ tipo: "task", agenteId: "a", chaveLinha: "x" });
    expect(() => lança.descarregar()).not.toThrow();
  });

  it("o Modo dev mostra a taxa por tipo", () => {
    const e = { ...estadoInicial, modoDev: { ligado: true, raioX: {}, taxasLinhas: [{ tipo: "rotina" as const, mostradas: 50, abertas: 6, taxa: 0.12 }, { tipo: "task" as const, mostradas: 0, abertas: 0, taxa: null }] } };
    expect(renderTaxasLinhas(e)).toContain("Linhas abertas: rotina 12% · task —");
    expect(renderTaxasLinhas({ ...e, modoDev: { ...e.modoDev, ligado: false } })).toBe("");
  });
});
