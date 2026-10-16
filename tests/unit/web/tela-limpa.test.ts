import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import type { ContaIa } from "../../../src/contracts/contas-ia.ts";
import { HARNESSES } from "../../../src/contracts/harness.ts";
import { RACIOCINIOS, type IaDaPessoa } from "../../../src/contracts/inteligencia.ts";
import type { Inventario } from "../../../src/contracts/inventario.ts";
import { estadoInicial, invalidacoesDaTela, reduzir, type Estado, type TurnoVivo } from "../../../web/estado/reducer.ts";
import { UI_IAS_INICIAL } from "../../../web/telas/cartao-ia.ts";
import { contaEmUso } from "../../../web/telas/contas-lista.ts";
import { htmlComposer, mostraPararNoCampo, renderCabecalhoConversa, tituloDoParar } from "../../../web/telas/conversa.ts";
import { modoDoComposer } from "../../../web/lib/perguntas.ts";
import { aparenciaDoComposer } from "../../../web/telas/pergunta.ts";
import {
  ALERTA_USO, dadosDoSeletor, escolhaDoItem, fraseDoLimite, mioloDoSeletor, pedidoDoSeletor, renderMenuIa, rotuloDoSeletor,
} from "../../../web/telas/seletor-ia.ts";
import type { ContextoInteligencia } from "../../../web/telas/inteligencia.ts";

/**
 * Plano "tela limpa" (PR 1 do docs/plano-limite-e-troca.md, definido em 2026-10-16; protótipos A1, A2, B1 e B2 do canvas
 * "limite e troca"): a pílula no lugar do cabeçalho, o Parar no campo, a nota sem a dica de teclado e o seletor de IA
 * no campo com o anel de uso.
 */
const C = "c1";
const AGORA = Date.UTC(2026, 9, 16, 15, 0);
const PRONTO: Inventario = { estado: "pronto", versao: "1", em: 0 };
const ias = (): IaDaPessoa[] => HARNESSES.map((h) => ({
  id: h.id, nome: h.nome, integrado: h.integrado, limite: null,
  inventario: h.id === "claude-cli" || h.id === "codex-cli" ? PRONTO : { estado: "ausente", motivo: "x", em: 0 },
  recomendado: "recomendado" in h ? h.recomendado : null,
  modelos: h.modelos.map((m) => ({ ...m, recomendado: "recomendado" in h && m.id === h.recomendado.modelo })),
}));

const conta = (id: string, p: Partial<ContaIa> = {}): ContaIa => ({
  id, ia: "claude-cli", impressao: "0".repeat(64), apelido: id, email: `${id}@exemplo.com`, organizacao: null, plano: null, corporativa: false, posicao: 0,
  entraNaTrocaAutomatica: false, noLimiteAte: null, maquinas: [{ maquinaId: "m1", nome: "Mac", estado: "pronta" }], ...p,
});

function cenario(bot: Partial<Agente> = {}, extra: Partial<Estado> = {}): Estado {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
  };
  const e = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA });
  return {
    ...e,
    agora: AGORA,
    sessao: { pessoaId: "p", tenantId: "t" } as never,
    tela: { tipo: "conversa", conversaId: C, agenteId: "a" },
    frota: { agentes: [{ id: "a", nome: "Eng 1", conversaId: C, cor: "c-blue", forma: "shape-circle", ownerId: "p", harness: "auto", modelo: "auto", esforco: null, ...bot }] } as never,
    ias: { ordem: ["claude-cli", "codex-cli"], ordemPadrao: true, ias: ias(), raciocinios: RACIOCINIOS },
    usoDoPlano: { planos: [{ harness: "claude-cli", situacao: "normal", cincoHoras: { utilizacao: 0.62, renovaEm: Date.UTC(2026, 9, 16, 20, 50) }, semana: null, medidoEm: AGORA }] },
    contasIa: { disponivel: true, modo: "perguntar", contas: [conta("marlonwlv (20x)"), conta("gfk", { ia: "codex-cli", apelido: "Assinaturas GFK", posicao: 1 })] },
    ...extra,
  };
}
const ctx = (e: Estado): ContextoInteligencia => ({ ias: e.ias?.ias ?? [], ui: UI_IAS_INICIAL, agora: e.agora });
const vivo = (estado: TurnoVivo["estado"] = "rodando"): Record<string, TurnoVivo> => ({ t1: { turnoId: "t1", conversaId: C, estado, executor: null, machineId: null, desde: AGORA } });

describe("T1: a pílula no lugar do cabeçalho", () => {
  it("mascote, nome e ponto; a presença inteira no aria-label e no title; aria-expanded segue o painel", () => {
    const fechado = renderCabecalhoConversa(cenario(), "a");
    expect(fechado).toContain('class="pilula-bot" data-act="alternar-detalhes"');
    expect(fechado).toContain('<span class="pilula-nome">Eng 1</span>');
    expect(fechado).toContain('aria-expanded="false"');
    expect(fechado).toContain('aria-label="Eng 1 · Disponível. Abrir o painel do bot"');
    expect(fechado).toContain('title="Eng 1 · Disponível"');
    expect(fechado).toContain("data-mascote");
    expect(renderCabecalhoConversa(cenario(), "a", true)).toContain('aria-expanded="true"');
    expect(renderCabecalhoConversa(cenario(), "a", true)).toContain("Fechar o painel do bot");
  });

  it("Disponível não ganha subtítulo; trabalhando, o subtítulo e o ponto verde, e o rótulo sem HTML", () => {
    expect(renderCabecalhoConversa(cenario(), "a")).not.toContain("pilula-sub");
    const html = renderCabecalhoConversa(cenario({}, { turnosVivos: vivo() }), "a");
    expect(html).toContain('<span class="pilula-sub" aria-hidden="true">Trabalhando</span>');
    expect(html).toContain('class="presenca ativa"');
    expect(html).toContain('aria-label="Eng 1 · Trabalhando. Abrir o painel do bot"');
  });

  it("o topo não tem mais MODO DEV, Ligar nem Parar", () => {
    const e = cenario({}, { turnosVivos: vivo(), modoDev: { ligado: true, raioX: {} }, disponibilidadeLigacao: { a: { disponivel: true, consentimentoNecessario: false, versaoConsentimento: 1, provedor: "google" } } });
    const html = renderCabecalhoConversa(e, "a");
    expect(html).not.toContain("MODO DEV");
    expect(html).not.toContain("iniciar-ligacao");
    expect(html).not.toContain("parar-conversa");
  });
});

describe("E11: o Enviar vira Parar no campo", () => {
  it("com turno vivo da conversa, sem turno nem task, e o título diz o que para", () => {
    expect(mostraPararNoCampo(cenario({}, { turnosVivos: vivo() }), "a")).toBe(true);
    expect(mostraPararNoCampo(cenario({}, { turnosVivos: vivo("na_fila" as TurnoVivo["estado"]) }), "a")).toBe(true);
    expect(mostraPararNoCampo(cenario(), "a")).toBe(false);
    expect(tituloDoParar(cenario({}, { turnosVivos: vivo() }), "a")).toBe("Parar o que está rodando nesta conversa");
  });

  it("o campo da conversa nasce com o Parar escondido ao lado do Enviar e o seletor de IA; a sala não tem nenhum dos dois", () => {
    const conversa = htmlComposer("x", [], { aprovacao: true, comandos: true });
    expect(conversa).toContain('<button type="button" class="parar-envio" data-act="parar-conversa" aria-label="Parar"');
    expect(conversa).toMatch(/class="parar-envio"[^>]* hidden>/);
    expect(conversa).toContain('id="composer-ia" data-act="seletor-ia"');
    // O seletor fica entre o texto e o microfone.
    expect(conversa.indexOf("composer-texto")).toBeLessThan(conversa.indexOf("composer-ia"));
    expect(conversa.indexOf("composer-ia")).toBeLessThan(conversa.indexOf('data-act="ditar"') === -1 ? conversa.indexOf('data-act="enviar"') : conversa.indexOf('data-act="ditar"'));
    const sala = htmlComposer("x", ["Nina"]);
    expect(sala).not.toContain("parar-envio");
    expect(sala).not.toContain("composer-ia");
  });
});

describe("T5: a nota sem a dica de teclado", () => {
  it("sem 'Enter envia' em nenhum campo; a nota do modo resposta continua", () => {
    for (const html of [htmlComposer("x"), htmlComposer("x", ["Nina"]), htmlComposer("x", [], { anexos: "tudo", comandos: true, aprovacao: true })]) {
      expect(html).not.toContain("Enter envia");
      expect(html).toContain('<p class="nota" id="composer-nota" data-padrao=""></p>');
    }
    const e = cenario();
    const normal = aparenciaDoComposer(modoDoComposer(e, C), e, { placeholder: "p", nota: "" }, C);
    expect(normal.nota).toBe("");
  });
});

describe("T6: o seletor de IA no campo", () => {
  it("Automático: 'Auto · Opus' com o anel cinza em 62%; fixo: só o modelo", () => {
    const auto = dadosDoSeletor(cenario(), "a")!;
    expect(auto).toMatchObject({ auto: true, ia: "claude-cli", modelo: "Opus", uso: 0.62, conta: "marlonwlv (20x)" });
    expect(rotuloDoSeletor(auto)).toBe("Auto · Opus");
    const m = mioloDoSeletor(auto);
    expect(m.html).toContain('<span class="seletor-rotulo">Auto · Opus</span>');
    expect(m.html).not.toContain("anel-alerta");
    expect(m.html).not.toContain("seletor-pct");
    expect(m.titulo).toBe("IA e modelo: Automático, agora Claude Opus, 62% da janela usada");
    const fixo = dadosDoSeletor(cenario({ harness: "claude-cli", modelo: "sonnet" }), "a")!;
    expect(rotuloDoSeletor(fixo)).toBe("Sonnet");
    expect(fixo.auto).toBe(false);
  });

  it(`a partir de ${ALERTA_USO * 100}% o anel e o número ficam âmbar e o rótulo mostra o número`, () => {
    const e = cenario({}, { usoDoPlano: { planos: [{ harness: "claude-cli", situacao: "perto", cincoHoras: { utilizacao: 0.96, renovaEm: null }, semana: null, medidoEm: AGORA }] } });
    const m = mioloDoSeletor(dadosDoSeletor(e, "a")!);
    expect(m.html).toContain('class="anel anel-alerta"');
    expect(m.html).toContain('<span class="seletor-pct">96%</span>');
    const abaixo = cenario({}, { usoDoPlano: { planos: [{ harness: "claude-cli", situacao: "normal", cincoHoras: { utilizacao: 0.89, renovaEm: null }, semana: null, medidoEm: AGORA }] } });
    expect(mioloDoSeletor(dadosDoSeletor(abaixo, "a")!).html).not.toContain("anel-alerta");
    // Sem o uso (CLI que nunca informou, servidor sem a rota): só o trilho, sem número.
    const sem = mioloDoSeletor(dadosDoSeletor(cenario({}, { usoDoPlano: null }), "a")!);
    expect(sem.html).not.toContain("anel-uso");
    expect(sem.titulo).not.toContain("%");
  });

  it("o cabeçalho do menu: a conta pelo apelido (nunca o e-mail), o uso e o que acontece se acabar", () => {
    const d = dadosDoSeletor(cenario(), "a")!;
    const menu = renderMenuIa(d);
    expect(menu).toContain("<b>Claude · marlonwlv (20x)</b>");
    expect(menu).not.toContain("@exemplo.com");
    expect(menu).toContain('<span class="ia-sel-pct">62%</span>');
    // No Automático, sem outra conta do Claude na troca, segue na próxima IA da ordem (com a conta em uso dela).
    expect(d.seguir).toBe("ChatGPT · Assinaturas GFK");
    expect(fraseDoLimite(d)).toMatch(/^Renova às \d\d:\d\d\. Se acabar, segue no <span class="ia-sel-forte">ChatGPT · Assinaturas GFK<\/span>\.$/);
    expect(fraseDoLimite({ ...d, uso: 0.95 })).toContain("Se acabar agora, a conversa segue no");
    // Fixo: espera a conta voltar.
    const fixo = dadosDoSeletor(cenario({ harness: "claude-cli", modelo: "opus" }), "a")!;
    expect(fixo.seguir).toBeNull();
    expect(fraseDoLimite({ ...fixo, renovaEm: null })).toBe("Se acabar, espera a conta voltar.");
    // Com "Trocar sozinho" e outra conta livre do Claude, segue nela (vale também para o fixo: o modelo não muda).
    const duas = cenario({ harness: "claude-cli", modelo: "opus" }, { contasIa: { disponivel: true, modo: "automatico", contas: [conta("Pessoal"), conta("Equipe", { posicao: 1 })] } });
    expect(dadosDoSeletor(duas, "a")!.seguir).toBe("Claude · Equipe");
  });

  it("Automático marcado, os modelos de cada IA ('fixa o bot neste modelo') e o link para Provedores", () => {
    const menu = renderMenuIa(dadosDoSeletor(cenario(), "a")!);
    expect(menu).toMatch(/role="menuitemradio" aria-checked="true" data-escolha="auto"><span class="ia-sel-txt"><span>Automático<\/span><small>Agora no Opus\. Troca de provedor sozinho se a conta acabar\.<\/small>/);
    expect(menu).toContain('Claude <span>· fixa o bot neste modelo</span>');
    expect(menu).toContain('ChatGPT <span>· fixa o bot neste modelo</span>');
    expect(menu).toContain('data-escolha="modelo" data-ia="claude-cli" data-modelo="opus"');
    expect(menu).toContain('data-escolha="provedores"');
    expect(menu).toContain("Fila de contas e regra de troca");
    // Fixo no Sonnet: o Sonnet marcado, o Automático não.
    const fixo = renderMenuIa(dadosDoSeletor(cenario({ harness: "claude-cli", modelo: "sonnet" }), "a")!);
    expect(fixo).toContain('aria-checked="false" data-escolha="auto"');
    expect(fixo).toContain('aria-checked="true" data-escolha="modelo" data-ia="claude-cli" data-modelo="sonnet"');
  });

  it("a régua mostra só os níveis que o modelo aceita, com o atual e 'N de M no <modelo>'", () => {
    const opus = renderMenuIa(dadosDoSeletor(cenario(), "a")!);
    expect(opus.match(/data-escolha="raciocinio"/g)).toHaveLength(5);
    expect(opus).toContain("<b>Médio</b><small>· 2 de 5 no Opus</small>");
    expect(opus).toContain('aria-checked="true" aria-label="Médio"');
    const haiku = dadosDoSeletor(cenario({ harness: "claude-cli", modelo: "haiku" }), "a")!;
    const niveisHaiku = HARNESSES.find((h) => h.id === "claude-cli")!.modelos.find((m) => m.id === "haiku")!.raciocinios!;
    expect(haiku.niveis).toEqual(niveisHaiku);
    expect(renderMenuIa(haiku).match(/data-escolha="raciocinio"/g)).toHaveLength(niveisHaiku.length);
    expect(renderMenuIa(haiku)).toContain(`de ${niveisHaiku.length} no Haiku`);
  });

  it("o pedido de cada clique: Automático, fixar um modelo e trocar o raciocínio (o atual não grava nada)", () => {
    const e = cenario({ harness: "claude-cli", modelo: "sonnet" });
    const a = e.frota!.agentes[0]!;
    expect(pedidoDoSeletor(a, { tipo: "auto" }, ctx(e))).toEqual({ modo: "auto" });
    expect(pedidoDoSeletor(a, { tipo: "modelo", ia: "claude-cli", modelo: "sonnet" }, ctx(e))).toBeNull();
    expect(pedidoDoSeletor(a, { tipo: "modelo", ia: "codex-cli", modelo: "gpt-5.6-sol" }, ctx(e))).toMatchObject({ modo: "fixa", fixa: "codex-cli", escolhas: { "codex-cli": { modelo: "gpt-5.6-sol" } } });
    const raciocinio = pedidoDoSeletor(a, { tipo: "raciocinio", raciocinio: "high" }, ctx(e));
    expect(raciocinio).toMatchObject({ modo: "fixa", fixa: "claude-cli", escolhas: { "claude-cli": { modelo: "sonnet", raciocinio: "high" } } });
    expect(pedidoDoSeletor(a, { tipo: "raciocinio", raciocinio: "medium" }, ctx(e))).toBeNull();
    const auto = cenario();
    expect(pedidoDoSeletor(auto.frota!.agentes[0]!, { tipo: "auto" }, ctx(auto))).toBeNull();
    expect(pedidoDoSeletor(auto.frota!.agentes[0]!, { tipo: "raciocinio", raciocinio: "max" }, ctx(auto))).toMatchObject({ modo: "auto", escolhas: { "claude-cli": { raciocinio: "max" } } });
    expect(pedidoDoSeletor(a, { tipo: "provedores" }, ctx(e))).toBeNull();
  });

  it("o clique é lido dos data-* do item; item desconhecido não vira escolha", () => {
    expect(escolhaDoItem({ escolha: "auto" })).toEqual({ tipo: "auto" });
    expect(escolhaDoItem({ escolha: "modelo", ia: "codex-cli", modelo: "gpt-6-astra" })).toEqual({ tipo: "modelo", ia: "codex-cli", modelo: "gpt-6-astra" });
    expect(escolhaDoItem({ escolha: "raciocinio", raciocinio: "xhigh" })).toEqual({ tipo: "raciocinio", raciocinio: "xhigh" });
    expect(escolhaDoItem({ escolha: "provedores" })).toEqual({ tipo: "provedores" });
    expect(escolhaDoItem({ escolha: "modelo", ia: "hermes", modelo: "x" })).toBeNull();
    expect(escolhaDoItem({ escolha: "raciocinio", raciocinio: "turbo" })).toBeNull();
  });

  it("quem não é a dona vê o rótulo, sem a seta, e o título diz por quê", () => {
    const e = cenario({ ownerId: "outra" });
    const m = mioloDoSeletor(dadosDoSeletor(e, "a")!);
    expect(m.html).not.toContain("seletor-seta");
    expect(m.titulo).toContain("só a dona do bot muda");
  });

  it("a conta em uso: a primeira da IA fora do limite e logada", () => {
    const contas = [conta("a1", { noLimiteAte: AGORA + 1000 }), conta("a2", { maquinas: [] }), conta("a3"), conta("b1", { ia: "codex-cli" })];
    expect(contaEmUso(contas, AGORA, { ia: "claude-cli" })?.id).toBe("a3");
    expect(contaEmUso(contas, AGORA, { ia: "codex-cli" })?.id).toBe("b1");
    expect(contaEmUso(contas, AGORA)?.id).toBe("a3");
  });

  it("a conversa pede o uso do plano e as contas (o cabeçalho do menu)", () => {
    const e = { ...cenario(), usoDoPlano: undefined, contasIa: null };
    expect(invalidacoesDaTela(e)).toEqual(expect.arrayContaining(["uso-plano", "contas"]));
    expect(reduzir(e, { tipo: "hidratar-uso-plano", usoDoPlano: { planos: [] } }).usoDoPlano).toEqual({ planos: [] });
  });
});

describe("CSS da tela limpa", () => {
  const css = (nome: string) => readFileSync(new URL(`../../../web/${nome}`, import.meta.url), "utf8");

  it("T8: o ⋯ da conta só aparece no hover/foco/menu aberto e fica sempre visível no toque; o da máquina não muda", () => {
    const nav = css("navegacao.css");
    expect(nav).toContain(".cl-linha .cl-mais-bt { opacity: 0; }");
    expect(nav).toContain('.cl-linha:hover .cl-mais-bt, .cl-linha:focus-within .cl-mais-bt, .cl-linha .cl-mais-bt:focus-visible, .cl-linha .cl-mais-bt[aria-expanded="true"] { opacity: 1; }');
    expect(nav).toContain("@media (hover: none) { .cl-linha .cl-mais-bt { opacity: 1; } }");
    // Só o ⋯ dentro da linha da conta some: nenhuma outra regra esconde o .cl-mais-bt (o da máquina mora em .maq-cab).
    expect(nav.split("\n").filter((l) => l.includes(".cl-mais-bt") && l.includes("opacity: 0"))).toEqual([".cl-linha .cl-mais-bt { opacity: 0; }"]);
  });

  it("T7: o aviso de alerta é branco com borda fina; o âmbar só no ícone e o botão é o primário de sempre", () => {
    const estilos = css("estilos.css");
    expect(estilos).toContain(".tom-alerta { background: var(--surface); border-color: var(--line); color: var(--ink); }");
    expect(estilos).toContain(".tom-alerta .aviso-estado-ic { color: var(--warning); }");
    expect(estilos).toContain(".tom-alerta .bt.pri { background: var(--action); border-color: var(--action); color: var(--on-action); }");
    expect(css("interface.css")).toContain(".linha-espera .linha-centro { flex-wrap: wrap; color: var(--ink-2); background: var(--surface); box-shadow: inset 0 0 0 1px var(--line); }");
  });

  it("T1/T4: a pílula não usa o azul do que é novo; coluna e campo com 760 px e a sombra leve do token", () => {
    const i = css("interface.css");
    const pilula = i.split("\n").filter((l) => l.includes("pilula-bot"));
    expect(pilula.some((l) => l.includes("--signal"))).toBe(false);
    expect(i).toContain(".pilula-bot:hover, .pilula-bot:focus-visible { border-color: var(--ink);");
    expect(i).toContain(".timeline { max-width: 760px; }");
    expect(i).toContain(".composer-wrap > .composer { max-width: 760px; margin: 0 auto; }");
    expect(i).toContain("box-shadow: var(--shadow-composer)");
    expect(i).toContain(".composer .nota:empty { display: none; }");
  });
});
