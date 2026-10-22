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
import { botoesDoCampo, htmlComposer, mostraPararNoCampo, renderCabecalhoConversa, tituloDoParar } from "../../../web/telas/conversa.ts";
import { modoDoComposer } from "../../../web/lib/perguntas.ts";
import { aparenciaDoComposer } from "../../../web/telas/pergunta.ts";
import {
  ALERTA_USO, dadosDoSeletor, escolhaDoItem, fraseDoLimite, mioloDoSeletor, pedidoDoSeletor, renderMenuIa, rotuloDoSeletor,
} from "../../../web/telas/seletor-ia.ts";
import { lerEscolhas } from "../../../src/domain/inteligencia.ts";
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
  it("mascote, nome e ponto; a presença inteira no aria-label e no title; o HTML não depende do painel", () => {
    const html = renderCabecalhoConversa(cenario(), "a");
    expect(html).toContain('class="pilula-bot" data-act="alternar-detalhes" aria-controls="detalhes"');
    expect(html).toContain('<span class="pilula-nome">Eng 1</span>');
    expect(html).toContain('aria-label="Painel de Eng 1 · Disponível"');
    expect(html).toContain('title="Eng 1 · Disponível"');
    expect(html).toContain("data-mascote");
    // Revisão do PR 1 (2026-10-16): o aria-expanded é do main (marcarPainelNaPilula), não da string — senão o cabeçalho
    // regravava a cada clique e o atributo ficava velho quando a janela trocava de largura.
    expect(html).not.toContain("aria-expanded");
  });

  it("Disponível não ganha subtítulo; trabalhando, o subtítulo e o ponto verde, e o rótulo sem HTML", () => {
    expect(renderCabecalhoConversa(cenario(), "a")).not.toContain("pilula-sub");
    const html = renderCabecalhoConversa(cenario({}, { turnosVivos: vivo() }), "a");
    expect(html).toContain('<span class="pilula-sub" aria-hidden="true">Trabalhando</span>');
    expect(html).toContain('class="presenca ativa"');
    expect(html).toContain('aria-label="Painel de Eng 1 · Trabalhando"');
  });

  it("o topo não tem mais MODO DEV, Ligar nem Parar", () => {
    const e = cenario({}, { turnosVivos: vivo(), modoDev: { ligado: true, raioX: {} }, disponibilidadeLigacao: { a: { disponivel: true, consentimentoNecessario: false, versaoConsentimento: 1, provedor: "google" } } });
    const html = renderCabecalhoConversa(e, "a");
    expect(html).not.toContain("MODO DEV");
    expect(html).not.toContain("iniciar-ligacao");
    expect(html).not.toContain("parar-conversa");
  });
});

describe("E11: o Parar no campo", () => {
  it("o bot trabalha com turno vivo da conversa (na fila ou rodando); sem turno, não; o título diz o que para", () => {
    expect(mostraPararNoCampo(cenario({}, { turnosVivos: vivo() }), "a")).toBe(true);
    expect(mostraPararNoCampo(cenario({}, { turnosVivos: vivo("na_fila" as TurnoVivo["estado"]) }), "a")).toBe(true);
    expect(mostraPararNoCampo(cenario(), "a")).toBe(false);
    expect(tituloDoParar(cenario({}, { turnosVivos: vivo() }), "a")).toBe("Parar o que está rodando nesta conversa");
  });

  it("o Parar fica alcançável enquanto o bot trabalha, mesmo com rascunho, anexo ou ditado (revisão do PR 1)", () => {
    // Bot livre: só o Enviar, com ou sem texto.
    expect(botoesDoCampo({ trabalhando: false, temConteudo: false, ditando: false })).toEqual({ enviar: true, parar: false });
    expect(botoesDoCampo({ trabalhando: false, temConteudo: true, ditando: false })).toEqual({ enviar: true, parar: false });
    // Trabalhando com o campo vazio: só o Parar.
    expect(botoesDoCampo({ trabalhando: true, temConteudo: false, ditando: false })).toEqual({ enviar: false, parar: true });
    // Trabalhando com rascunho ou anexo, ou ditando: os dois — antes o Parar sumia aqui.
    expect(botoesDoCampo({ trabalhando: true, temConteudo: true, ditando: false })).toEqual({ enviar: true, parar: true });
    expect(botoesDoCampo({ trabalhando: true, temConteudo: false, ditando: true })).toEqual({ enviar: true, parar: true });
    // Toda combinação com o bot trabalhando mostra o Parar.
    for (const temConteudo of [false, true]) for (const ditando of [false, true]) expect(botoesDoCampo({ trabalhando: true, temConteudo, ditando }).parar).toBe(true);
  });

  it("o campo da conversa nasce com o Parar (secundário, com o nome do bot) antes do Enviar e o seletor de IA; a sala não tem nenhum dos dois", () => {
    const conversa = htmlComposer("x", [], { aprovacao: true, comandos: true, bot: "Eng 1" });
    expect(conversa).toContain('<button type="button" class="parar-envio" data-act="parar-conversa" aria-label="Parar Eng 1"');
    expect(conversa).toMatch(/class="parar-envio"[^>]* hidden>/);
    expect(conversa.indexOf('data-act="parar-conversa"')).toBeLessThan(conversa.indexOf('data-act="enviar"'));
    expect(htmlComposer("x", [], { aprovacao: true })).toContain('data-act="parar-conversa" aria-label="Parar"');
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
    expect(m.html).toContain('class="anel-uso"');
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

  it("o cabeçalho do menu: o número é da janela da IA, a conta em uso à parte (pelo apelido, nunca o e-mail)", () => {
    const d = dadosDoSeletor(cenario(), "a")!;
    const menu = renderMenuIa(d);
    expect(menu).toContain('<b class="ia-sel-pct">62% da janela do Claude</b>');
    expect(menu).toContain('<p class="ia-sel-quem">conta: marlonwlv (20x)</p>');
    // O apelido não vai colado no número (uso_do_plano é por pessoa + IA, não por conta).
    expect(menu).not.toContain("Claude · marlonwlv");
    expect(menu).not.toContain("@exemplo.com");
    expect(fraseDoLimite(d)).toMatch(/^Renova às \d\d:\d\d\. Se acabar, a conversa segue no <span class="ia-sel-forte">ChatGPT<\/span>\.$/);
    expect(fraseDoLimite({ ...d, uso: 0.95 })).toContain("Se acabar agora, a conversa segue no");
    // Sem o uso, o cabeçalho mostra só a IA (sem número nem barra).
    const sem = renderMenuIa(dadosDoSeletor(cenario({}, { usoDoPlano: null }), "a")!);
    expect(sem).toContain("<b>Claude</b>");
    expect(sem).not.toContain("ia-sel-barra");
  });

  it("'Se acabar' espelha decidirLimiteDaConta: outra conta no Trocar sozinho, outra IA no Automático, perguntar, esperar", () => {
    const frase = (e: Estado) => fraseDoLimite({ ...dadosDoSeletor(e, "a")!, renovaEm: null });
    const fixo = { harness: "claude-cli" as const, modelo: "opus" };
    // 1. "Trocar sozinho" e outra conta livre do Claude pronta e na fila: segue nela (vale também para o fixo: o modelo não muda).
    const duas = (modo: "automatico" | "perguntar", p: Partial<ContaIa> = {}) => ({ contasIa: { disponivel: true, modo, contas: [conta("Pessoal", { entraNaTrocaAutomatica: true }), conta("Equipe", { posicao: 1, entraNaTrocaAutomatica: true, ...p })] } });
    expect(dadosDoSeletor(cenario(fixo, duas("automatico")), "a")!.seguir).toEqual({ tipo: "conta", apelido: "Equipe" });
    expect(frase(cenario(fixo, duas("automatico")))).toBe('Se acabar, segue na conta <span class="ia-sel-forte">Equipe</span>.');
    // 2. No modo "perguntar" com outra conta livre: o Nod pergunta antes de trocar de conta.
    expect(frase(cenario(fixo, duas("perguntar")))).toBe("Se acabar, o Nod pergunta antes de trocar de conta.");
    // NOD-308: a corporativa na fila segue como qualquer conta; qualquer conta fora da fila (pessoal ou não) não.
    expect(dadosDoSeletor(cenario(fixo, duas("automatico", { corporativa: true })), "a")!.seguir).toEqual({ tipo: "conta", apelido: "Equipe" });
    expect(frase(cenario(fixo, duas("automatico", { entraNaTrocaAutomatica: false })))).toBe("Se acabar, o Nod pergunta antes de trocar de conta.");
    // 3. Automático com outra IA pronta: a conversa segue nela (só o nome da IA).
    expect(frase(cenario())).toBe('Se acabar, a conversa segue no <span class="ia-sel-forte">ChatGPT</span>.');
    // 4. Fixo, sem outra conta da IA: espera a conta voltar.
    expect(dadosDoSeletor(cenario(fixo), "a")!.seguir).toEqual({ tipo: "esperar" });
    expect(frase(cenario(fixo))).toBe("Se acabar, espera a conta voltar.");
    // A máquina do bot conta: a outra conta pronta só noutra máquina não troca sozinha (o servidor pergunta).
    const noutra = cenario({ ...fixo, maquinaId: "m1" }, duas("automatico", { maquinas: [{ maquinaId: "m2", nome: "VM", estado: "pronta" }] }));
    expect(frase(noutra)).toBe("Se acabar, o Nod pergunta antes de trocar de conta.");
    // A outra conta no limite não conta.
    expect(frase(cenario(fixo, duas("automatico", { noLimiteAte: AGORA + 60_000 })))).toBe("Se acabar, espera a conta voltar.");
  });

  it("a janela que já renovou não mostra número nem 'Renova às' no passado", () => {
    const passou = cenario({}, { usoDoPlano: { planos: [{ harness: "claude-cli", situacao: "perto", cincoHoras: { utilizacao: 0.97, renovaEm: AGORA - 1 }, semana: null, medidoEm: AGORA - 3_600_000 }] } });
    const d = dadosDoSeletor(passou, "a")!;
    expect(d.uso).toBeNull();
    expect(d.renovaEm).toBeNull();
    expect(mioloDoSeletor(d).html).not.toContain("anel-alerta");
    expect(fraseDoLimite(d)).not.toContain("Renova às");
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

  it("o pedido de cada clique leva só o que muda (o atual não grava nada)", () => {
    const e = cenario({ harness: "claude-cli", modelo: "sonnet" });
    const a = e.frota!.agentes[0]!;
    // Revisão do PR 1 (2026-10-16): o delta — nada de ordem, e o raciocínio não manda modo nem fixa.
    expect(pedidoDoSeletor(a, { tipo: "auto" }, ctx(e))).toEqual({ modo: "auto" });
    expect(pedidoDoSeletor(a, { tipo: "modelo", ia: "claude-cli", modelo: "sonnet" }, ctx(e))).toBeNull();
    expect(pedidoDoSeletor(a, { tipo: "modelo", ia: "codex-cli", modelo: "gpt-5.6-sol" }, ctx(e))).toEqual({ modo: "fixa", fixa: "codex-cli", escolhas: { "claude-cli": { modelo: "sonnet" }, "codex-cli": { modelo: "gpt-5.6-sol" } } });
    expect(pedidoDoSeletor(a, { tipo: "raciocinio", raciocinio: "high" }, ctx(e))).toEqual({ escolhas: { "claude-cli": { modelo: "sonnet", raciocinio: "high" } } });
    expect(pedidoDoSeletor(a, { tipo: "raciocinio", raciocinio: "medium" }, ctx(e))).toBeNull();
    const auto = cenario();
    expect(pedidoDoSeletor(auto.frota!.agentes[0]!, { tipo: "auto" }, ctx(auto))).toBeNull();
    expect(pedidoDoSeletor(auto.frota!.agentes[0]!, { tipo: "raciocinio", raciocinio: "max" }, ctx(auto))).toEqual({ escolhas: { "claude-cli": { raciocinio: "max" } } });
    expect(pedidoDoSeletor(a, { tipo: "provedores" }, ctx(e))).toBeNull();
  });

  it("escolhas vai inteiro (o servidor troca o mapa todo) e o raciocínio que o modelo novo não aceita fica de fora", () => {
    const haikuNiveis: readonly string[] = HARNESSES.find((h) => h.id === "claude-cli")!.modelos.find((m) => m.id === "haiku")!.raciocinios!;
    const fora = RACIOCINIOS.map((r) => r.id).find((r) => !haikuNiveis.includes(r))!;
    const inteligencia = { modo: "fixa" as const, fixa: "claude-cli" as const, ordem: null, escolhas: { "claude-cli": { modelo: "opus", raciocinio: fora }, "codex-cli": { modelo: "gpt-5.6-sol", raciocinio: "high" as const } } };
    const e = cenario({ harness: "claude-cli", modelo: "opus", inteligencia });
    const a = e.frota!.agentes[0]!;
    const pedido = pedidoDoSeletor(a, { tipo: "modelo", ia: "claude-cli", modelo: "haiku" }, ctx(e))!;
    expect(pedido.escolhas).toEqual({ "claude-cli": { modelo: "haiku" }, "codex-cli": { modelo: "gpt-5.6-sol", raciocinio: "high" } });
    // O servidor aceita o mapa (lerEscolhas recusa raciocínio que o modelo não aceita) e o ChatGPT não perde a escolha.
    expect(lerEscolhas(pedido.escolhas)).toEqual(pedido.escolhas);
    const r = pedidoDoSeletor(a, { tipo: "raciocinio", raciocinio: "high" }, ctx(e))!;
    expect(r).toEqual({ escolhas: { "claude-cli": { modelo: "opus", raciocinio: "high" }, "codex-cli": { modelo: "gpt-5.6-sol", raciocinio: "high" } } });
  });

  it("o clique é lido dos data-* do item; item desconhecido não vira escolha", () => {
    expect(escolhaDoItem({ escolha: "auto" })).toEqual({ tipo: "auto" });
    expect(escolhaDoItem({ escolha: "modelo", ia: "codex-cli", modelo: "gpt-6-astra" })).toEqual({ tipo: "modelo", ia: "codex-cli", modelo: "gpt-6-astra" });
    expect(escolhaDoItem({ escolha: "raciocinio", raciocinio: "xhigh" })).toEqual({ tipo: "raciocinio", raciocinio: "xhigh" });
    expect(escolhaDoItem({ escolha: "provedores" })).toEqual({ tipo: "provedores" });
    expect(escolhaDoItem({ escolha: "modelo", ia: "hermes", modelo: "x" })).toBeNull();
    expect(escolhaDoItem({ escolha: "raciocinio", raciocinio: "turbo" })).toBeNull();
  });

  it("quem não é a dona vê o rótulo, sem a seta, sem anel nem conta (o uso seria o do visitante), e o título diz por quê", () => {
    const e = cenario({ ownerId: "outra" });
    const d = dadosDoSeletor(e, "a")!;
    expect(d).toMatchObject({ dona: false, uso: null, renovaEm: null, conta: null });
    const m = mioloDoSeletor(d);
    expect(m.html).not.toContain("seletor-seta");
    expect(m.html).not.toContain("anel-uso");
    expect(m.titulo).toContain("só a dona do bot muda");
    expect(m.titulo).not.toContain("%");
    expect(renderMenuIa(d)).not.toContain("conta:");
  });

  it("ARIA do menu: o cabeçalho fora do role=menu; só menuitemradio, group e menuitem dentro dele", () => {
    const menu = renderMenuIa(dadosDoSeletor(cenario(), "a")!);
    expect(menu.indexOf("ia-sel-cab")).toBeLessThan(menu.indexOf('role="menu"'));
    const dentro = menu.slice(menu.indexOf('role="menu"'));
    const papeis = [...dentro.matchAll(/role="([a-z]+)"/g)].map((m) => m[1]);
    expect(new Set(papeis)).toEqual(new Set(["menu", "menuitemradio", "group", "menuitem"]));
    expect(dentro).not.toContain('role="radio"');
    expect(dentro).not.toContain("radiogroup");
    expect(dentro).toContain('role="group" aria-label="Claude: fixa o bot neste modelo"');
    expect(dentro).toContain('class="ia-sel-regua" role="group" aria-label="Raciocínio do Opus: Médio, 2 de 5"');
    expect(dentro).toContain('role="menuitemradio" class="ia-sel-ponto atual" aria-checked="true" aria-label="Médio"');
    expect(dentro).toContain('class="ia-sel-link" role="menuitem" data-escolha="provedores"');
  });

  it("o agente devolvido pelo PUT entra na frota e na gestão na hora, sem perder os campos da frota", () => {
    const e = cenario();
    const comGestao: Estado = { ...e, gestao: { agentes: [{ ...e.frota!.agentes[0]! }] } as never };
    // O PUT devolve o Agente (sem os campos da frota, como conversaId).
    const devolvido: Agente = { id: "a", nome: "Eng 1", ownerId: "p", harness: "codex-cli", modelo: "gpt-5.6-sol", esforco: null, inteligencia: { modo: "fixa", fixa: "codex-cli", ordem: null, escolhas: { "codex-cli": { modelo: "gpt-5.6-sol" } } } } as never;
    const depois = reduzir(comGestao, { tipo: "agente-gravado", agente: devolvido });
    expect(depois.frota!.agentes[0]).toMatchObject({ conversaId: C, harness: "codex-cli", inteligencia: { modo: "fixa", fixa: "codex-cli" } });
    expect(depois.gestao!.agentes[0]).toMatchObject({ harness: "codex-cli" });
    expect(dadosDoSeletor(depois, "a")).toMatchObject({ auto: false, ia: "codex-cli" });
  });

  it("a conta em uso: a primeira da IA fora do limite e logada", () => {
    const contas = [conta("a1", { noLimiteAte: AGORA + 1000 }), conta("a2", { maquinas: [] }), conta("a3"), conta("b1", { ia: "codex-cli" })];
    expect(contaEmUso(contas, AGORA, { ia: "claude-cli" })?.id).toBe("a3");
    expect(contaEmUso(contas, AGORA, { ia: "codex-cli" })?.id).toBe("b1");
    expect(contaEmUso(contas, AGORA)?.id).toBe("a3");
  });

  it("a conversa pede o uso do plano e as contas (o cabeçalho do menu); sem a rota (null), não pede de novo", () => {
    const e = { ...cenario(), usoDoPlano: undefined, contasIa: null };
    expect(invalidacoesDaTela(e)).toEqual(expect.arrayContaining(["uso-plano", "contas"]));
    expect(reduzir(e, { tipo: "hidratar-uso-plano", usoDoPlano: { planos: [] } }).usoDoPlano).toEqual({ planos: [] });
    expect(invalidacoesDaTela({ ...e, usoDoPlano: null })).not.toContain("uso-plano");
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

  it("F8: o véu do topo não cobre a primeira mensagem — o padding da rolagem é a altura dele, também com #erro à vista", () => {
    const i = css("interface.css");
    const veu = Number(/\.cabecalho\.cabecalho-pilula::before \{[^}]*height: (\d+)px/.exec(i)?.[1]);
    const padding = Number(/\.cabecalho\.cabecalho-pilula ~ \.timeline-wrap \{ padding-top: (\d+)px; \}/.exec(i)?.[1]);
    const margemErro = Number(/\.cabecalho\.cabecalho-pilula \+ #erro:not\(:empty\) \{[^}]*margin-top: (\d+)px/.exec(i)?.[1]);
    const comErro = Number(/\.cabecalho\.cabecalho-pilula \+ #erro:not\(:empty\) \+ \.timeline-wrap \{ padding-top: (\d+)px; \}/.exec(i)?.[1]);
    expect(veu).toBeGreaterThan(0);
    expect(padding).toBeGreaterThanOrEqual(veu);
    // Com a faixa de erro no fluxo, a rolagem começa depois dela: a margem mais o padding já passam do véu.
    expect(margemErro + comErro).toBeGreaterThanOrEqual(veu);
  });

  it("F7/F2/F9: o subtítulo da pílula só no hover/foco; o Parar é secundário (sem a cor de ação); 44 px no toque", () => {
    const i = css("interface.css");
    expect(i).toMatch(/\.pilula-sub \{ display: none;/);
    expect(i).toContain(".pilula-bot:hover + .pilula-sub, .pilula-bot:focus-visible + .pilula-sub { display: block; }");
    const parar = i.split("\n").find((l) => l.startsWith(".composer .parar-envio {"))!;
    expect(parar).not.toContain("--action");
    expect(parar).toContain("border-radius: 50%");
    expect(i).not.toContain(".composer .box.gravando .parar-envio { display: none; }");
    const m = css("mobile.css");
    expect(m).toContain(".composer .send, .composer .clipe, .composer .parar-envio { min-width: 44px; min-height: 44px; }");
    expect(m).toContain(".composer .seletor-ia { min-height: 44px;");
  });
});
