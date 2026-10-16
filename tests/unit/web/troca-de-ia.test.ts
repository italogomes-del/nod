import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import type { InteligenciaBot } from "../../../src/contracts/inteligencia.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import type { PayloadTrocaDeIa } from "../../../src/contracts/troca-de-ia.ts";
import { cartaoTrocaDeIa, linhaContaSeguiu } from "../../../web/telas/ia-fora.ts";
import { destinoDoPedido, htmlDaPreviaDaTroca, mudaAIaDoBot } from "../../../web/telas/inteligencia.ts";

/** ADR-108 (2026-10-16, canvas C1–C4 e D1): o aviso de troca de IA na conversa do bot e a prévia ao trocar a IA. */
const AGORA = Date.UTC(2026, 9, 15, 23, 39);
const MIN = 60_000;
const AGENTE = "aaaaaaaa-0000-4000-8000-000000000001";
const CONVERSA = "bbbbbbbb-0000-4000-8000-000000000001";

const aviso = (p: Partial<PayloadTrocaDeIa> = {}): Mensagem => ({
  tenantId: "t",
  id: "cccccccc-0000-4000-8000-000000000001",
  conversaId: CONVERSA,
  turnoId: null,
  autoria: { autor_tipo: "agente", autor_id: AGENTE, sob_procuracao_de: null, conta_de_execucao: "p", executor: "local", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:localidade", regra_versao: 1 },
  kind: "sistema",
  texto: "O Claude chegou ao limite.",
  payload: { kind: "troca_de_ia", trocaId: "t1", agenteId: AGENTE, iaDe: "claude-cli", iaPara: "codex-cli", recomendacao: "esperar", voltaEm: AGORA + 11 * MIN, tasks: 19, aplicarEm: null, ...p },
  confianca: "confiavel",
  criadoEm: AGORA,
  parcial: false,
});

describe("o aviso de troca de IA (R4, canvas C1/C2)", () => {
  it("volta perto: título com a volta, recomenda esperar (primeira opção, marcada) e o rodapé sem prazo", () => {
    const html = cartaoTrocaDeIa(aviso(), { nomeDoBot: "Eng 1", agora: AGORA })!;
    expect(html).toContain("O Claude chegou ao limite · volta às");
    expect(html).toContain("Para as 19 tasks, recomendo esperar: o Claude volta em 11 min e elas continuam de onde pararam.");
    expect(html.indexOf('data-act="troca-esperar"')).toBeLessThan(html.indexOf('data-act="troca-levar"'));
    expect(html).toMatch(/class="troca-opcao recomendada" data-act="troca-esperar"[^>]*><span class="troca-opcao-tit">Esperar o Claude<span class="troca-reco">Recomendado<\/span>/);
    expect(html).toContain("Levar as tasks para o ChatGPT");
    expect(html).toContain("Seguem agora, mas recomeçam do resumo de cada frente.");
    expect(html).toContain("Se você não escolher, eu sigo a recomendação.");
    expect(html).toContain(`data-id="${AGENTE}" data-conversa="${CONVERSA}"`);
    // Usa as classes de aviso existentes (a outra frente cuida da cor); nada de âmbar novo.
    expect(html).toContain('class="aviso-estado tom-info aviso-troca"');
  });

  it("volta longe: recomenda levar (primeira opção, marcada) e avisa que em 10 min segue sozinho", () => {
    const html = cartaoTrocaDeIa(aviso({ recomendacao: "levar", voltaEm: AGORA + 16 * 60 * MIN, aplicarEm: AGORA + 10 * MIN }), { nomeDoBot: "Eng 1", agora: AGORA })!;
    expect(html).toContain("recomendo levar para o ChatGPT: esperar seriam 16 horas paradas.");
    expect(html.indexOf('data-act="troca-levar"')).toBeLessThan(html.indexOf('data-act="troca-esperar"'));
    expect(html).toMatch(/class="troca-opcao recomendada" data-act="troca-levar"/);
    expect(html).toContain("Se você não escolher em 10 min, eu sigo a recomendação.");
  });

  it("fechado: vira uma linha leve com o desfecho, sem botões", () => {
    const levado = cartaoTrocaDeIa(aviso({ decisao: "expirou", decididoEm: AGORA }), { nomeDoBot: "Eng 1", agora: AGORA })!;
    expect(levado).toContain("Sem escolha em 10 min: as tasks foram para o ChatGPT, como recomendado.");
    expect(levado).not.toContain("data-act");
    expect(cartaoTrocaDeIa(aviso({ decisao: "voltou", decididoEm: AGORA }), { nomeDoBot: "Eng 1", agora: AGORA })).toContain("O Claude voltou");
  });

  it("outra mensagem: null", () => {
    expect(cartaoTrocaDeIa({ ...aviso(), payload: { kind: "boas_vindas" } } as Mensagem, { nomeDoBot: null, agora: AGORA })).toBeNull();
  });
});

describe("o aviso do bot fixo (R6, canvas C3)", () => {
  it("o estado, que ele volta sozinho, e os dois caminhos: a conta fora da fila e a outra IA até a volta", () => {
    const html = cartaoTrocaDeIa(aviso({ fixo: true, voltaEm: AGORA + 13 * 60 * MIN, conta: { id: "dddddddd-0000-4000-8000-000000000001", apelido: "Leapy", corporativa: true }, tasks: 19 }), { nomeDoBot: "Eng 1", agora: AGORA })!;
    expect(html).toContain("O Eng 1 está parado até");
    expect(html).toContain("Se você não fizer nada, ele volta sozinho");
    expect(html).toContain('data-act="cl-seguir" data-id="dddddddd-0000-4000-8000-000000000001"');
    expect(html).toContain("Continuar na conta Claude · Leapy");
    expect(html).toContain("É a conta da empresa.");
    expect(html).toContain('data-act="troca-outra-ia"');
    expect(html).toMatch(/Continuar no ChatGPT até/);
    expect(html).not.toContain("Recomendado");
    expect(html).not.toContain("troca-esperar");
  });

  it("sem conta fora da fila: só o caminho da outra IA", () => {
    const html = cartaoTrocaDeIa(aviso({ fixo: true, conta: null }), { nomeDoBot: "Eng 1", agora: AGORA })!;
    expect(html).not.toContain("cl-seguir");
    expect(html).toContain("troca-outra-ia");
  });
});

describe("mesma IA (R7, canvas C4)", () => {
  it("a linha leve, sem cartão, com o texto do servidor", () => {
    const m = { ...aviso(), texto: "marlonwlv (20x) acabou às 20:39 → seguindo no Claude · Marlon 20x · mesmo modelo", payload: { kind: "conta_seguiu", de: { id: "a", apelido: "marlonwlv (20x)", ia: "claude-cli" }, para: { id: "b", apelido: "Marlon 20x", ia: "claude-cli" }, voltaEm: null } } as Mensagem;
    const html = linhaContaSeguiu(m)!;
    expect(html).toContain("linha-centro");
    expect(html).toContain("marlonwlv (20x) acabou às 20:39 → seguindo no Claude · Marlon 20x · mesmo modelo");
    expect(html).not.toContain("aviso-estado");
  });
});

describe("a prévia ao trocar a IA do bot (R5, canvas D1)", () => {
  const bot = (i: Partial<InteligenciaBot> | null): Pick<Agente, "harness" | "modelo" | "esforco" | "inteligencia"> =>
    i ? { harness: i.modo === "fixa" ? i.fixa ?? "auto" : "auto", modelo: "auto", esforco: null, inteligencia: { modo: "auto", fixa: null, ordem: null, escolhas: {}, ...i } } : { harness: "auto", modelo: "auto", esforco: null };

  it("só pergunta quando a IA muda (modo ou IA fixa); mudar o modelo da mesma IA não pergunta", () => {
    expect(mudaAIaDoBot(bot(null), { modo: "fixa", fixa: "codex-cli" })).toBe(true);
    expect(mudaAIaDoBot(bot({ modo: "fixa", fixa: "claude-cli" }), { modo: "auto" })).toBe(true);
    expect(mudaAIaDoBot(bot({ modo: "fixa", fixa: "claude-cli" }), { modo: "fixa", fixa: "claude-cli", escolhas: { "claude-cli": { modelo: "claude-sonnet-4-6" } } })).toBe(false);
    expect(mudaAIaDoBot(bot(null), { modo: "auto" })).toBe(false);
    expect(destinoDoPedido({ modo: "fixa", fixa: "codex-cli" })).toBe("o ChatGPT");
    expect(destinoDoPedido({ modo: "auto" })).toBe("o Automático");
  });

  it("o padrão é 'Só daqui em diante' (primário, com o foco); 'Levar as tasks também' é a outra", () => {
    const html = htmlDaPreviaDaTroca({ nomeDoBot: "Eng 1", destino: "o ChatGPT", tasks: 19 });
    expect(html).toContain("Passar Eng 1 para o ChatGPT?");
    expect(html).toContain("Muda agora: a conversa e o que Eng 1 começar daqui em diante.");
    expect(html).toContain("As 19 tasks em andamento ficam na IA de agora e continuam de onde pararam. Se forem junto, recomeçam do resumo.");
    expect(html).toMatch(/<button class="bt pri" data-so-daqui type="button" autofocus>Só daqui em diante<\/button>/);
    expect(html).toContain("data-levar");
  });
});
