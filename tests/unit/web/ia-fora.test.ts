import { afterEach, describe, expect, it } from "vitest";
import type { Inventario } from "../../../src/contracts/inventario.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { HARNESSES } from "../../../src/contracts/harness.ts";
import { capacidadesDe } from "../../../src/domain/harness.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { renderMensagem } from "../../../web/telas/conversa.ts";
import { inventarioDaIa, linhaIaTrocada, pedeInstalar } from "../../../web/telas/ia-fora.ts";
import { hora } from "../../../web/lib/render.ts";

/**
 * A conversa quando a conta da IA não serve (definido em 2026-10-05; protótipo "primeira sessão sem tropeços", jornada 3).
 * Medido em produção nesse dia: a recusa do Claude Code entrava em inglês como fala do bot.
 */
const autoria = { autor_tipo: "agente" as const, autor_id: "frida", sob_procuracao_de: null, conta_de_execucao: "marcelo", executor: "local" as const, locality: "local" as const, locality_reason: "motor_ausente" as const, machine_id: null, decidido_por: "regra:localidade" as const, regra_versao: 1 };
const TEXTO = "Nenhum trabalho começa: executor indisponível (claude-cli: conta sem acesso) desde 2026-10-05T14:46:55.000Z.";
const negacao = (causa: "conta_sem_acesso" | "teste_falhou" = "conta_sem_acesso"): Mensagem => ({ tenantId: "t", id: "m1", conversaId: "c1", turnoId: "t1", autoria, kind: "negacao", texto: TEXTO, payload: { kind: "negacao", classe: "plano_ausente", nome: "claude-cli", motivo: "plano_ausente", terminal: true, causa }, confianca: "confiavel", parcial: false, criadoEm: 0 });
const SEM_ACESSO: Inventario = { estado: "nao_autenticado", causa: "conta_sem_acesso", motivo: "x", em: 0 };
// NOD-213: a sonda "pronto" é posterior à negação (criadoEm 0); uma sonda anterior não prova que a IA voltou.
const PRONTO: Inventario = { estado: "pronto", versao: "1", em: 1 };
const AUSENTE: Inventario = { estado: "ausente", motivo: "x", em: 0 };

function com(p: { claude: Inventario; codex: Inventario }): Estado {
  const opcoes = HARNESSES.map((h) => ({ ...h, capacidades: capacidadesDe(h.id), inventario: h.id === "claude-cli" ? p.claude : h.id === "codex-cli" ? p.codex : AUSENTE }));
  const emUso = p.claude.estado === "pronto" ? p.claude : p.codex.estado === "pronto" ? p.codex : p.claude;
  return { ...estadoInicial, sessao: { tenantId: "t", pessoaId: "marcelo" }, inventario: emUso, executor: { atual: "claude-cli", opcoes: [], recusa: null, harnesses: { padrao: null, simulacao: false, legado: "claude-cli", opcoes } } };
}
const noApp = (sim: boolean) => { if (sim) (globalThis as Record<string, unknown>).nodDesktop = {}; else delete (globalThis as Record<string, unknown>).nodDesktop; };
afterEach(() => noApp(false));

describe("aviso: a conta da IA entrou e não serve", () => {
  it("no app do Mac, com tudo fora: diz o que houve em português, que a mensagem fica guardada, e traz os dois botões com logo", () => {
    noApp(true);
    const html = renderMensagem(negacao(), com({ claude: SEM_ACESSO, codex: AUSENTE }));
    expect(html).toContain("tom-alerta");
    expect(html).toContain("aviso-ia-fora");
    expect(html).toContain("a conta do Claude Code deste Mac está sem acesso (a organização dela desativou o uso por assinatura)");
    expect(html).toContain("Sua mensagem fica guardada");
    expect(html).toContain('data-act="ia-entrar"');
    expect(html).toContain("Entrar com outra conta");
    expect(html).toContain('data-act="ia-conectar"');
    expect(html).toContain("Instalar o Codex");
    expect(html.match(/class="ia-logo"/g)).toHaveLength(2);
    // A frase técnica fica atrás de "Detalhes técnicos"; nada em inglês do fornecedor na frente.
    expect(html).toContain("<summary>Detalhes técnicos</summary>");
    expect(html).not.toContain("subscription");
  });

  it("cada botão leva a IA certa: entrar de novo na que falhou, conectar a outra", () => {
    noApp(true);
    const html = renderMensagem(negacao(), com({ claude: SEM_ACESSO, codex: AUSENTE }));
    const botoes = [...html.matchAll(/<button[^>]*>/g)].map((b) => b[0]);
    expect(botoes.find((b) => b.includes('data-act="ia-entrar"'))).toContain('data-ia="claude-cli"');
    expect(botoes.find((b) => b.includes('data-act="ia-conectar"'))).toContain('data-ia="codex-cli"');
  });

  it("a outra IA instalada e sem login: o botão é 'Conectar o ChatGPT', não 'Instalar'", () => {
    noApp(true);
    const html = renderMensagem(negacao(), com({ claude: SEM_ACESSO, codex: { estado: "nao_autenticado", motivo: "x", em: 0 } }));
    expect(html).toContain("Conectar o ChatGPT");
    expect(html).not.toContain("Instalar o Codex");
  });

  it("fora do app (navegador): um botão só, para a seção Conexão; nada que dependa do app", () => {
    const html = renderMensagem(negacao(), com({ claude: SEM_ACESSO, codex: AUSENTE }));
    expect(html).toContain('data-act="secao-espaco"');
    expect(html).toContain("Conectar IA");
    expect(html).not.toContain("ia-entrar");
    expect(html).not.toContain("ia-conectar");
  });

  it("já há uma IA pronta: aviso neutro, sem botão, e sem prometer o que não sabe", () => {
    noApp(true);
    const html = renderMensagem(negacao("teste_falhou"), com({ claude: SEM_ACESSO, codex: PRONTO }));
    expect(html).toContain("tom-info");
    expect(html).toContain("Na hora, a conta do Claude Code deste Mac entrou, mas não respondeu.");
    expect(html).toContain("mande a mensagem de novo");
    expect(html).not.toContain("ia-entrar");
    expect(html).not.toContain("ia-conectar");
    expect(html).not.toContain("Conectar IA");
  });

  it("NOD-178: a outra IA 'ausente' só porque demorou: o botão conecta, não manda instalar", () => {
    noApp(true);
    const lento: Inventario = { estado: "ausente", causa: "sonda_lenta", motivo: "O Codex demorou para responder; o Mac está carregado. Tente de novo em instantes.", em: 0 };
    const html = renderMensagem(negacao(), com({ claude: SEM_ACESSO, codex: lento }));
    expect(html).toContain('data-act="ia-conectar"');
    expect(html).toContain("Conectar o ChatGPT");
    expect(html).not.toContain("Instalar");
    expect(pedeInstalar(lento)).toBe(false);
    expect(pedeInstalar(AUSENTE)).toBe(true);
    expect(pedeInstalar(PRONTO)).toBe(false);
    expect(pedeInstalar(null)).toBe(false);
  });

  it("negação sem causa (app antigo) segue no aviso de sempre", () => {
    const antiga: Mensagem = { ...negacao(), payload: { kind: "negacao", classe: "plano_ausente", nome: "claude-cli", motivo: "plano_ausente", terminal: true } };
    const html = renderMensagem(antiga, com({ claude: AUSENTE, codex: AUSENTE }));
    expect(html).toContain("Nenhum trabalho começou.");
    expect(html).not.toContain("aviso-ia-fora");
  });
});

describe("linha: o bot em automático passou a responder por outra IA", () => {
  const sistema: Mensagem = { ...negacao(), kind: "sistema", texto: "Respondendo pelo Codex: a conta do Claude Code neste computador está sem acesso.", payload: { kind: "ia_trocada", de: "claude-cli", para: "codex-cli", causa: "conta_sem_acesso" } };

  it("tela 3: uma linha centralizada e discreta, com o logo de quem assumiu; o porquê e o caminho ficam atrás do clique", () => {
    const html = renderMensagem(sistema, com({ claude: SEM_ACESSO, codex: PRONTO }));
    expect(html).toContain("linha-centro-wrap linha-ia");
    expect(html).toMatch(/<summary class="linha-centro">.*A conta do Claude está sem acesso ·<\/span><b>respondendo pelo ChatGPT<\/b><\/summary>/);
    expect(html).toContain("A conta do Claude deste Mac entrou, mas não tem acesso ao Claude Code pela assinatura");
    expect(html.match(/class="ia-logo"/g)).toHaveLength(1);
    expect(html).toContain('data-act="secao-espaco" data-secao="conexao">Ver em Provedores de IA');
    expect(html).not.toContain("aviso-estado");
  });

  it("no limite: 'O Claude chegou ao limite · respondendo pelo ChatGPT', com a hora em que renova e a volta sozinha", () => {
    const renovaEm = Date.UTC(2026, 9, 9, 17, 0);
    const limite: Mensagem = { ...sistema, criadoEm: renovaEm - 3_600_000, payload: { kind: "ia_trocada", de: "claude-cli", para: "codex-cli", causa: "limite", renovaEm } };
    const html = linhaIaTrocada(limite, { modelo: "GPT-5.6 Sol" }) ?? "";
    expect(html).toContain("O Claude chegou ao limite ·</span><b>respondendo pelo ChatGPT</b>");
    expect(html).toContain(`renova às ${hora(renovaEm)}`);
    expect(html).toContain("usam o ChatGPT (GPT-5.6 Sol)");
    expect(html).toContain("voltam sozinhos para o Claude");
  });

  it("payload com IA desconhecida não vira linha de troca (cai no texto de sistema)", () => {
    expect(linhaIaTrocada({ ...sistema, payload: { kind: "ia_trocada", de: "cursor-cli", para: "codex-cli", causa: "conta_sem_acesso" } })).toBeNull();
    expect(linhaIaTrocada(negacao())).toBeNull();
  });

  it("o inventário de uma IA sai do catálogo que a tela já tem; sem catálogo, null", () => {
    expect(inventarioDaIa(com({ claude: SEM_ACESSO, codex: PRONTO }), "codex-cli")).toEqual(PRONTO);
    expect(inventarioDaIa({ executor: null }, "claude-cli")).toBeNull();
  });
});
