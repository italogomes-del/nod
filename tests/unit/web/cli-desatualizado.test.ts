import { afterEach, describe, expect, it } from "vitest";
import type { FrotaDto } from "../../../src/contracts/api.ts";
import { HARNESSES, type CatalogoHarness } from "../../../src/contracts/harness.ts";
import type { Inventario } from "../../../src/contracts/inventario.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import type { IaNoMac } from "../../../src/contracts/onboarding.ts";
import { estadoInicial, type Estado } from "../../../web/estado/reducer.ts";
import { hora } from "../../../web/lib/render.ts";
import { renderMensagem } from "../../../web/telas/conversa.ts";
import { situacaoMotorFora, textoInventario } from "../../../web/telas/frota.ts";
import { COMANDO_ATUALIZAR_IA, desatualizado, fraseDesatualizado, pedeInstalar, versaoLegivel } from "../../../web/telas/ia-fora.ts";
import { motivoDoInventario, renderInteligencia } from "../../../web/telas/inteligencia.ts";
import { estadoDoCardIa, situacaoDaIa } from "../../../web/telas/onboarding.ts";

/**
 * NOD-171, fatia (d): a UI do CLI abaixo do piso, do harness fixado indisponível e do limite do plano (protótipo do Gil,
 * docs do Linear "NOD-171 · protótipo"). O CLI desatualizado ESTÁ no Mac: nenhuma tela diz "não está neste Mac" nem
 * "Instalar"; todas dizem a versão instalada, a mínima e "Atualizar".
 */
const ANTIGO: Inventario = { estado: "ausente", causa: "cli_antigo", versao: "0.147.0", minima: "0.159.0", motivo: "O Codex deste Mac (0.147.0) é mais antigo que o testado pelo nod. Atualize para a versão 0.159.0 ou mais nova.", em: 0 };
const PRONTO: Inventario = { estado: "pronto", versao: "2.1.300", em: 0 };
const AUSENTE: Inventario = { estado: "ausente", motivo: "binario_nao_encontrado", em: 0 };
const SEM_LOGIN: Inventario = { estado: "nao_autenticado", motivo: "x", em: 0 };

describe("as funções de base", () => {
  it("desatualizado só com cli_antigo, versão e mínima", () => {
    expect(desatualizado(ANTIGO)).toEqual({ versao: "0.147.0", minima: "0.159.0" });
    expect(desatualizado({ ...ANTIGO, minima: undefined } as Inventario)).toBeNull();
    expect(desatualizado(AUSENTE)).toBeNull();
    expect(desatualizado(PRONTO)).toBeNull();
    expect(desatualizado(null)).toBeNull();
  });

  it("o CLI desatualizado não pede instalação; o ausente de verdade pede", () => {
    expect(pedeInstalar(ANTIGO)).toBe(false);
    expect(pedeInstalar(AUSENTE)).toBe(true);
  });

  it("a mínima como a pessoa lê: 0.159.0 vira 0.159; 2.1.290 fica", () => {
    expect(versaoLegivel("0.159.0")).toBe("0.159");
    expect(versaoLegivel("0.159.2")).toBe("0.159.2");
    expect(versaoLegivel("2.1.290")).toBe("2.1.290");
    expect(fraseDesatualizado("codex-cli", { versao: "0.147.0", minima: "0.159.0" })).toBe("Seu Codex está na versão 0.147.0. O nod precisa da 0.159 ou mais nova.");
  });

  it("um comando de atualizar por IA", () => {
    expect(COMANDO_ATUALIZAR_IA["codex-cli"]).toBe("npm install -g @openai/codex@latest");
    expect(COMANDO_ATUALIZAR_IA["claude-cli"]).toBe("claude update");
  });
});

describe("rodapé, menu da conta e Conexão", () => {
  it("a faixa diz a versão e a mínima da IA em uso, nunca 'não foi encontrada'", () => {
    expect(situacaoMotorFora(ANTIGO as Exclude<Inventario, { estado: "pronto" }>, "codex-cli")).toBe("Seu Codex está na versão 0.147.0. O nod precisa da 0.159 ou mais nova.");
    expect(situacaoMotorFora(ANTIGO as Exclude<Inventario, { estado: "pronto" }>, "catcher")).toBe("Sua IA está desatualizada");
    expect(situacaoMotorFora(AUSENTE as Exclude<Inventario, { estado: "pronto" }>, "codex-cli")).toBe("Sua IA não foi encontrada");
  });

  it("o texto do inventário diz 'desatualizado', não 'ausente'", () => {
    const texto = textoInventario(ANTIGO, 0);
    expect(texto).toContain("0.147.0 desatualizado");
    expect(texto).toContain("0.159 ou mais nova");
    expect(texto).not.toContain("ausente");
  });
});

describe("onboarding: o card da IA desatualizada", () => {
  const ias: IaNoMac[] = [
    { id: "claude-cli", estado: "pronto" },
    { id: "codex-cli", estado: "ausente", causa: "cli_antigo", versao: "0.147.0", minima: "0.159.0" },
  ];

  it("diz a versão, a mínima e 'Atualizar' (que abre a página oficial), com o comando para copiar", () => {
    expect(situacaoDaIa("codex-cli", ias, null).situacao).toBe("desatualizado");
    const card = estadoDoCardIa("codex-cli", ias, null);
    expect(card.estado).toBe("Codex 0.147.0 · o nod precisa da 0.159 ou mais nova");
    expect(card.tom).toBe("aviso");
    expect(card.acao).toBe("Atualizar");
    expect(card.act).toBe("onboarding-ia-instalar");
    expect(card.comando).toBe("npm install -g @openai/codex@latest");
    expect(card.estado).not.toContain("não está neste Mac");
  });

  it("com o teste rodando e veredito 'ausente' do Mac, o servidor que viu a versão antiga manda", () => {
    const teste = { rodando: false, testando: [], vereditos: { "codex-cli": { ia: "codex-cli" as const, estado: "ausente" as const } } };
    expect(situacaoDaIa("codex-cli", ias, null, teste).situacao).toBe("desatualizado");
  });

  it("o CLI de fato ausente continua 'Instalar e entrar'", () => {
    const card = estadoDoCardIa("codex-cli", [{ id: "codex-cli", estado: "ausente" }], null);
    expect(card.acao).toBe("Instalar e entrar");
    expect(card.comando).toBeNull();
  });
});

const autoria = { autor_tipo: "agente" as const, autor_id: "gil", sob_procuracao_de: null, conta_de_execucao: "marcelo", executor: "local" as const, locality: "local" as const, locality_reason: "motor_ausente" as const, machine_id: null, decidido_por: "regra:localidade" as const, regra_versao: 1 };
const negacao = (nome: string): Mensagem => ({ tenantId: "t", id: "m1", conversaId: "c1", turnoId: "t1", autoria, kind: "negacao", texto: "Nenhum trabalho começa: executor indisponível (codex-cli: desatualizado).", payload: { kind: "negacao", classe: "plano_ausente", nome, motivo: "plano_ausente", terminal: true }, confianca: "confiavel", parcial: false, criadoEm: 0 });
const gil = (harness: string) => ({ id: "gil", nome: "Gil", harness, modelo: "auto", conversaId: "c1", ownerId: "marcelo", excluidoEm: null }) as unknown as FrotaDto["agentes"][number];

function com(p: { claude: Inventario; codex: Inventario; harnessDoGil?: string }): Estado {
  const opcoes = HARNESSES.map((h) => ({ ...h, inventario: h.id === "claude-cli" ? p.claude : h.id === "codex-cli" ? p.codex : AUSENTE }));
  return {
    ...estadoInicial,
    agora: Date.UTC(2026, 9, 6, 12, 0),
    sessao: { tenantId: "t", pessoaId: "marcelo" },
    inventario: p.claude,
    frota: { agentes: [gil(p.harnessDoGil ?? "codex-cli")], negacoes: [] } as unknown as Estado["frota"],
    executor: { atual: "claude-cli", opcoes: [], recusa: null, harnesses: { padrao: null, simulacao: false, opcoes } },
  };
}
const noApp = (sim: boolean) => { if (sim) (globalThis as Record<string, unknown>).nodDesktop = {}; else delete (globalThis as Record<string, unknown>).nodDesktop; };
afterEach(() => noApp(false));

describe("conversa: o bot fixado numa IA que não está pronta", () => {
  it("desatualizada: nomeia a IA, a versão e a mínima; 'Atualizar o Codex' e 'Trocar a IA do bot'", () => {
    noApp(true);
    const html = renderMensagem(negacao("codex-cli"), com({ claude: PRONTO, codex: ANTIGO }));
    expect(html).toContain("tom-erro");
    expect(html).toContain("Gil não começou: o Codex deste Mac está desatualizado.");
    expect(html).toContain("Gil usa o ChatGPT (Codex). A versão instalada é a 0.147.0, e o nod precisa da 0.159 ou mais nova.");
    expect(html).toContain("Sua mensagem fica guardada");
    expect(html).toMatch(/data-act="ia-atualizar" data-ia="codex-cli">Atualizar o Codex</);
    expect(html).toMatch(/data-act="inteligencia" data-id="gil">Trocar a IA de Gil</);
    expect(html).not.toContain("Instalar");
  });

  it("revisão: desatualizada fora do app, o próprio aviso traz o comando com 'Copiar' (a Conexão só fala da IA em uso)", () => {
    const html = renderMensagem(negacao("codex-cli"), com({ claude: PRONTO, codex: ANTIGO }));
    expect(html).toContain("<code>npm install -g @openai/codex@latest</code>");
    expect(html).toContain('data-act="copiar-texto"');
    expect(html).not.toContain('data-act="ia-atualizar"');
    expect(html).toMatch(/data-act="inteligencia" data-id="gil">Trocar a IA de Gil</);
  });

  it("QA: conta sem acesso no Claude com o Codex desatualizado: a outra IA pede 'Atualizar o Codex', nunca 'Conectar' nem 'Instalar'", () => {
    noApp(true);
    const m = negacao("claude-cli");
    const semAcesso: Mensagem = { ...m, payload: { kind: "negacao", classe: "plano_ausente", nome: "claude-cli", motivo: "plano_ausente", terminal: true, causa: "conta_sem_acesso" } };
    const html = renderMensagem(semAcesso, com({ claude: { ...SEM_LOGIN, causa: "conta_sem_acesso" }, codex: ANTIGO, harnessDoGil: "auto" }));
    expect(html).toMatch(/data-act="ia-atualizar" data-ia="codex-cli">.*Atualizar o Codex</);
    expect(html).not.toMatch(/data-act="ia-conectar" data-ia="codex-cli"/);
    expect(html).not.toContain("Instalar");
  });

  it("sem login: 'falta entrar no Claude Code' e o botão de entrar", () => {
    noApp(true);
    const html = renderMensagem(negacao("claude-cli"), com({ claude: SEM_LOGIN, codex: PRONTO, harnessDoGil: "claude-cli" }));
    expect(html).toContain("Gil não começou: falta entrar no Claude Code.");
    expect(html).toContain("Ele está instalado neste Mac, mas sem conta conectada.");
    expect(html).toContain('data-act="ia-entrar"');
    expect(html).toContain("Entrar no Claude");
  });

  it("fora do app do Mac, o botão de resolver leva à Conexão", () => {
    const html = renderMensagem(negacao("claude-cli"), com({ claude: SEM_LOGIN, codex: PRONTO, harnessDoGil: "claude-cli" }));
    expect(html).toContain('data-act="secao-espaco"');
    expect(html).not.toContain('data-act="ia-entrar"');
  });

  it("bot no automático: o nome da negação é só o motor; fica o aviso de sempre", () => {
    const html = renderMensagem(negacao("codex-cli"), com({ claude: SEM_LOGIN, codex: ANTIGO, harnessDoGil: "auto" }));
    expect(html).toContain("Nenhum trabalho começou.");
    expect(html).not.toContain("deste Mac está desatualizado");
    expect(html).not.toContain('data-act="ia-atualizar"');
  });

  it("a IA do bot já voltou: fica o aviso de sempre ('mande de novo')", () => {
    const html = renderMensagem(negacao("codex-cli"), com({ claude: PRONTO, codex: PRONTO }));
    expect(html).toContain("Nenhum trabalho começou.");
  });

  it("revisão: fixado no Codex sem catálogo ou só lento, com o Claude pronto, nunca diz que a IA 'já voltou'", () => {
    const semCatalogo = { ...com({ claude: PRONTO, codex: PRONTO }), executor: { atual: "claude-cli", opcoes: [], recusa: null } } as Estado;
    const lento = com({ claude: PRONTO, codex: { estado: "ausente", motivo: "a sonda demorou", em: 0, causa: "sonda_lenta" } as Inventario });
    for (const estado of [semCatalogo, lento]) {
      const html = renderMensagem(negacao("codex-cli"), estado);
      expect(html).toContain("Nenhum trabalho começou.");
      expect(html).not.toContain("já voltou");
      expect(html).toContain("Sua mensagem fica guardada");
    }
  });

  it("revisão: modelo recusado pela IA pronta pede outro modelo, nunca 'já voltou' nem 'conectar'", () => {
    const m = negacao("codex-cli");
    const comModelo: Mensagem = { ...m, payload: { kind: "negacao", classe: "plano_ausente", nome: "codex-cli", motivo: "plano_ausente", terminal: true, modelo: "gpt-<b>x</b>" } };
    const html = renderMensagem(comModelo, com({ claude: PRONTO, codex: PRONTO }));
    expect(html).toContain("Gil não começou: o Codex não aceita o modelo gpt-&lt;b&gt;x&lt;/b&gt;.");
    expect(html).toContain("Escolha outro modelo para Gil e mande a mensagem de novo.");
    expect(html).toMatch(/data-act="inteligencia" data-id="gil">Trocar o modelo de Gil</);
    expect(html).not.toContain("já voltou");
    expect(html).not.toContain("Conectar IA");
  });
});

describe("conversa: o limite do plano", () => {
  const limite = (harness: "claude-cli" | "codex-cli", voltaEm: number | null): Mensagem => ({ ...negacao("x"), kind: "sistema", texto: "Turno interrompido: seu plano do Claude Code atingiu o limite de uso; volta a funcionar às 14:00. O que já saiu fica marcado como parcial; nada foi reenviado.", payload: { kind: "limite_do_plano", harness, voltaEm } });

  it("Claude: diz quando volta, na hora local, que o bot parou no meio e que o nod não tenta sozinho", () => {
    const estado = com({ claude: PRONTO, codex: PRONTO });
    const voltaEm = estado.agora + 5 * 3_600_000;
    const html = renderMensagem(limite("claude-cli", voltaEm), estado);
    expect(html).toContain("tom-alerta");
    expect(html).toContain("Seu plano do Claude atingiu o limite de uso.");
    expect(html).toContain(`Volta a funcionar às ${hora(voltaEm)}.`);
    expect(html).toContain("Gil parou no meio, e o que já fez está acima. O nod não tenta de novo sozinho.");
    expect(html).toMatch(/data-act="inteligencia" data-id="gil">Trocar a IA de Gil</);
    expect(html).toContain("<summary>Detalhes técnicos</summary>");
  });

  it("Codex: o fornecedor não diz quando volta; o card 'parece' e manda conferir o plano no ChatGPT", () => {
    const html = renderMensagem(limite("codex-cli", null), com({ claude: PRONTO, codex: PRONTO }));
    expect(html).toContain("Seu plano do ChatGPT parece ter atingido o limite de uso.");
    expect(html).toContain("Confira o uso do seu plano no ChatGPT");
    expect(html).not.toContain("Volta a funcionar");
  });

  it("uma hora que já passou não aparece", () => {
    const estado = com({ claude: PRONTO, codex: PRONTO });
    const html = renderMensagem(limite("claude-cli", estado.agora - 60_000), estado);
    expect(html).not.toContain("Volta a funcionar");
    expect(html).toContain("Espere o uso renovar e tente de novo.");
  });
});

describe("seletor de Inteligência", () => {
  const catalogo: CatalogoHarness = { padrao: "claude-cli", simulacao: false, opcoes: HARNESSES.map((h) => ({ ...h, integrado: h.id === "claude-cli" || h.id === "codex-cli" ? true : h.integrado, inventario: h.id === "codex-cli" ? ANTIGO : PRONTO })) };

  it("o grupo da IA desatualizada diz 'desatualizado', com as opções desabilitadas e a ajuda", () => {
    const html = renderInteligencia({ modelo: "auto", harness: "auto" }, catalogo);
    expect(html).toContain('<optgroup label="Codex · desatualizado">');
    expect(html).toMatch(/value="codex-cli:auto" disabled/);
    expect(html).toContain("Os modelos do Codex voltam quando ele for atualizado neste Mac.");
    expect(html).toContain("Desatualizado");
  });

  it("o motivo diz 'Atualize', nunca 'Instale'", () => {
    const motivo = motivoDoInventario("Codex", ANTIGO);
    expect(motivo).toBe("O Codex deste Mac está na versão 0.147.0. Atualize para a 0.159 ou mais nova para usá-lo no nod.");
    expect(motivo).not.toContain("Instale");
  });

  it("o modelo gravado que saiu da lista continua selecionado, com 'fora da lista'", () => {
    const html = renderInteligencia({ modelo: "gpt-antigo", harness: "codex-cli" }, catalogo);
    expect(html).toContain('<option selected value="codex-cli:gpt-antigo">gpt-antigo · configuração atual · fora da lista</option>');
  });

  it("revisão: sem o catálogo ainda, o modelo gravado não é chamado de 'fora da lista'", () => {
    const html = renderInteligencia({ modelo: "gpt-5.6-sol", harness: "codex-cli" });
    expect(html).toContain("configuração atual</option>");
    expect(html).not.toContain("fora da lista");
  });
});
