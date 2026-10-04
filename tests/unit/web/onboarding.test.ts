import { describe, expect, it } from "vitest";
import type { FrotaDto } from "../../../src/contracts/api.ts";
import type { EstadoOnboarding, ModeloDeBot } from "../../../src/contracts/onboarding.ts";
import { estadoInicial, invalidacoesDaTela, reduzir } from "../../../web/estado/reducer.ts";
import { lerMsgServidor } from "../../../web/lib/ligacao-protocolo.ts";
import { partesDaLigacao, type EstadoTelaLigacao } from "../../../web/telas/ligacao.ts";
import { htmlMenuConta } from "../../../web/telas/menu-conta.ts";
import {
  estadoDoCardIa, htmlCamada, htmlChamando, htmlExecutor, htmlGuia, htmlOla, htmlPainelEntrevista, linhasContou, linhasMontado, notaForaDoApp,
  secaoOnboardingDetalhes, textoTudoMontado, type EstadoTelaOnboarding,
} from "../../../web/telas/onboarding.ts";

/** Onboarding por ligação na web (definido em 2026-10-04, ADR-077): as telas puras, o protocolo e o reducer. */

const modelo: ModeloDeBot = {
  objetivo: "clientes",
  fala: "Responder clientes mais rápido",
  curto: "responder clientes mais rápido",
  nome: "Atendente",
  papel: "Clientes",
  descricao: "Lê os e-mails de clientes e escreve rascunhos no meu tom.",
  forma: "shape-triangle",
  cor: "c-amber",
  app: { slug: "gmail", nome: "Gmail", letra: "G", cor: "#d93025" },
  pode: ["Ler e-mails da caixa de entrada", "Criar rascunhos de resposta"],
  nao: "Enviar sem a sua aprovação",
  rotinas: [
    { quando: "Dias úteis, 8:00", oque: "O que pede resposta hoje", cron: "0 8 * * 1-5", instrucao: "x" },
    { quando: "De hora em hora", oque: "Avisar quando chegar algo urgente", cron: "0 * * * *", instrucao: "y" },
    { quando: "Sexta, 17:00", oque: "Resumo dos clientes da semana", cron: "0 17 * * 5", instrucao: "z" },
  ],
};

function dados(p: Partial<EstadoOnboarding> = {}): EstadoOnboarding {
  return {
    etapa: null,
    mostrar: true,
    campos: { apelido: null, comoConheceu: null, objetivo: null, tamanhoTime: null },
    modelo,
    guia: { id: "g1", nome: "Nina", conversaId: "cg", forma: "shape-square", cor: "c-blue" },
    bot: null,
    passo: "bot",
    pendentes: { bot: null, acesso: null, rotina: null },
    appConectado: false,
    rotinaCriada: null,
    concluidoEm: null,
    ligacao: null,
    recusa: null,
    executor: { pronto: true, ias: [{ id: "claude-cli", estado: "pronto" }] },
    ...p,
  };
}

function tela(p: Partial<EstadoTelaOnboarding> = {}): EstadoTelaOnboarding {
  return { dados: dados(), fase: "configurando", procurando: false, iaEntrando: null, notaIa: null, atendendo: false, emLigacao: true, appConectando: false, ocupado: false, ...p };
}

describe("abertura e a IA do Mac", () => {
  it("'olá' é um botão de tela cheia que pula a abertura", () => {
    expect(htmlOla()).toContain('data-act="onboarding-pular-ola"');
    expect(htmlOla()).toContain(">olá<");
  });

  it("procurando: só o texto da busca, sem cards", () => {
    const h = htmlExecutor(tela({ procurando: true }));
    expect(h).toContain("A IA dos seus bots");
    expect(h).toContain("Procurando o Claude Code e o Codex neste Mac…");
    expect(h).not.toContain("ob-card-ia");
  });

  it("os quatro cards: Claude e ChatGPT pelo inventário; Grok e Gemini em breve", () => {
    const ias = [{ id: "claude-cli", estado: "nao_autenticado" }, { id: "codex-cli", estado: "ausente" }] as const;
    const h = htmlExecutor(tela({ dados: dados({ executor: { pronto: false, ias: [...ias] } }) }));
    for (const nome of ["Claude", "ChatGPT", "Grok", "Gemini"]) expect(h).toContain(`<b>${nome}</b>`);
    expect(h.match(/em-breve/g)).toHaveLength(2);
    expect(h).toContain("Claude Code instalado · falta entrar");
    expect(h).toContain('data-act="onboarding-ia-entrar" data-ia="claude-cli"');
    expect(h).toContain("Codex não está neste Mac");
    expect(h).toContain('data-act="onboarding-ia-instalar" data-ia="codex-cli"');
    expect(h).toContain("Dá para trocar ou adicionar outra depois, em Ajustes.");
  });

  it("card clicado: 'Termine no navegador…' e 'Esperando' com a roda; pronto vira 'Conectado' sem clique", () => {
    expect(estadoDoCardIa("claude-cli", [{ id: "claude-cli", estado: "nao_autenticado" }], "claude-cli")).toMatchObject({ estado: "Termine no navegador…", acao: "Esperando", act: null, girando: true });
    expect(estadoDoCardIa("codex-cli", [{ id: "codex-cli", estado: "pronto" }], null)).toMatchObject({ estado: "Conectado", tom: "ok", act: null });
  });

  it("fora do app do Mac, a orientação diz o comando do próprio CLI", () => {
    expect(notaForaDoApp("claude-cli", "entrar")).toContain("claude auth login");
    expect(notaForaDoApp("codex-cli", "entrar")).toContain("codex login");
  });
});

describe("'está te ligando'", () => {
  it("Atender e 'Configurar sem voz', com a linha da voz sob o Atender e o 'saber mais'", () => {
    const h = htmlChamando(tela({ fase: "chamando" }));
    expect(h).toContain("<b>Nina</b><span>está te ligando</span>");
    expect(h).toContain('data-act="onboarding-atender"');
    expect(h).toContain('data-act="onboarding-sem-voz"');
    expect(h).toContain("Configurar sem voz");
    expect(h).toContain("Sua fala é transcrita pelo Google, nos EUA; nada é gravado");
    expect(h).toContain('data-act="onboarding-saber-mais"');
    expect(h).toContain('aria-describedby="ob-aviso-voz"');
  });

  it("depois do clique os dois botões ficam desabilitados", () => {
    expect(htmlChamando(tela({ fase: "chamando", atendendo: true })).match(/ disabled/g)).toHaveLength(2);
  });
});

describe("entrevista: o painel 'O que você contou'", () => {
  it("vazio mostra o convite; preenchido, as quatro linhas com os rótulos do protótipo", () => {
    expect(htmlPainelEntrevista(dados())).toContain("Aparece aqui durante a ligação.");
    const d = dados({ campos: { apelido: "Marlon", comoConheceu: "Indicação", objetivo: "Responder clientes", tamanhoTime: "2_10" } });
    expect(linhasContou(d.campos)).toEqual([
      { rotulo: "Nome", valor: "Marlon" },
      { rotulo: "Conheceu por", valor: "Indicação" },
      { rotulo: "Quer", valor: "Responder clientes" },
      { rotulo: "Time", valor: "2 a 10" },
    ]);
    expect(htmlPainelEntrevista(d)).toContain("<b>Marlon</b>");
  });

  it("a camada da entrevista só aparece com a ligação em tela cheia", () => {
    expect(htmlCamada(tela({ fase: "entrevista" }), true)).toContain("ob-painel-entrevista");
    expect(htmlCamada(tela({ fase: "entrevista" }), false)).toBe("");
    expect(htmlCamada(tela({ fase: "configurando" }), true)).toBe("");
  });

  it("os chips 'Diga algo como' da ligação aparecem na tela cheia e embaixo da pílula", () => {
    const base: EstadoTelaLigacao = { ligacao: { id: "l1" } as EstadoTelaLigacao["ligacao"], agente: { id: "g1", nome: "Nina", cor: "c-blue", forma: "shape-square" }, modo: "cheia", fase: "ouvindo", rotulo: null, desde: 0, agora: 0, legendas: [], janela: null, mudo: false, teclado: false, voz: "clara", velocidade: 1, aviso: null, quemFala: null, audioSuspenso: false, sugestoes: ["Me chama de Marlon"] };
    const cheia = partesDaLigacao(base, null);
    expect(cheia.legenda).toContain("Diga algo como");
    expect(cheia.legenda).toContain('data-texto="Me chama de Marlon"');
    const pilula = partesDaLigacao({ ...base, modo: "pilula" }, null);
    expect(pilula.legenda).toContain("Me chama de Marlon");
    expect(pilula.esqueleto).toContain('class="lp-sugestoes"');
  });
});

describe("configuração guiada", () => {
  it("passo bot: 'Novo bot · preenchido com o que você contou' do modelo, com Nome e 'O que ele faz' editáveis", () => {
    const h = htmlGuia(tela({ dados: dados({ etapa: "configurando", campos: { apelido: "Marlon", comoConheceu: null, objetivo: null, tamanhoTime: null } }) }));
    expect(h).toContain("Oi, Marlon. Seguimos na ligação");
    expect(h).toContain("Novo bot · preenchido com o que você contou");
    expect(h).toContain('value="Atendente"');
    expect(h).toContain("O que ele faz");
    expect(h).toContain('data-form="onboarding-bot"');
    expect(h).not.toContain("data-decisao-bot");
    expect(h).toContain("Criar bot");
  });

  it("com a proposta da Nina pendente, o card é dela e decide pela decisão", () => {
    const d = dados({ etapa: "configurando", pendentes: { bot: { decisaoId: "d1", nome: "Lia", descricao: "Cuida dos clientes", forma: "shape-hex", cor: "c-pink", voz: null }, acesso: null, rotina: null } });
    const h = htmlGuia(tela({ dados: d }));
    expect(h).toContain('data-decisao-bot="d1"');
    expect(h).toContain('value="Lia"');
    expect(h).toContain('data-act="onboarding-recusar-bot"');
  });

  it("passo app: 'Conectar para o {bot}' com o que pode e o que não, e o botão do login", () => {
    const d = dados({ etapa: "configurando", passo: "app", bot: { id: "b1", nome: "Lia", conversaId: "cb", forma: "shape-hex", cor: "c-pink" } });
    const h = htmlGuia(tela({ dados: d }));
    expect(h).toContain("Conectar para o Lia");
    expect(h).toContain("<b class=\"ob-titulo\">Gmail</b>");
    expect(h).toContain("Ler e-mails da caixa de entrada");
    expect(h).toContain("Enviar sem a sua aprovação");
    expect(h).toContain('data-act="onboarding-conectar-app" data-slug="gmail"');
    expect(h).toContain("Entrar e conectar");
    expect(htmlGuia(tela({ dados: d, appConectando: true }))).toContain("Esperando o navegador");
    expect(htmlGuia(tela({ dados: { ...d, pendentes: { bot: null, acesso: { decisaoId: "a1", app: "gmail", conectar: false }, rotina: null } } }))).toContain('data-act="onboarding-permitir-app" data-id="a1"');
  });

  it("passo rotina: 'Rotina do {bot}' com as três opções; a proposta pendente vem destacada", () => {
    const d = dados({ etapa: "configurando", passo: "rotina", appConectado: true, bot: { id: "b1", nome: "Lia", conversaId: "cb", forma: "shape-hex", cor: "c-pink" } });
    const h = htmlGuia(tela({ dados: d }));
    expect(h).toContain("Rotina do Lia");
    expect(h.match(/data-act="onboarding-escolher-rotina"/g)).toHaveLength(3);
    expect(h).toContain("Dias úteis, 8:00");
    const comProposta = htmlGuia(tela({ dados: { ...d, pendentes: { bot: null, acesso: null, rotina: { decisaoId: "r1", resumo: "Todo dia às 9h" } } } }));
    expect(comProposta).toContain('data-act="onboarding-criar-rotina-proposta"');
    expect(comProposta).toContain("Todo dia às 9h");
  });

  it("fim: 'Tudo montado…' e 'Ver o onboarding de novo'", () => {
    const h = htmlGuia(tela({ fase: "fim", dados: dados({ etapa: "configurando", passo: "fim" }) }));
    expect(h).toContain(textoTudoMontado("Nina"));
    expect(h).toContain("Tudo montado. Quando quiser, é só chamar a Nina por aqui.");
    expect(h).toContain('data-act="onboarding-de-novo"');
  });

  it("sem voz, a abertura não fala da ligação", () => {
    expect(htmlGuia(tela({ emLigacao: false }))).toContain("Vamos montar o seu primeiro bot");
  });

  it("painel da guia: 'O que você contou' e 'Montado até agora'", () => {
    const d = dados({ etapa: "configurando", bot: { id: "b1", nome: "Lia", conversaId: "cb", forma: "shape-hex", cor: "c-pink" }, appConectado: true, rotinaCriada: { resumo: "Dias úteis às 8h" } });
    expect(linhasMontado(d)).toEqual(["Bot Lia", "Gmail conectado", "Rotina: dias úteis às 8h"]);
    const h = secaoOnboardingDetalhes(d);
    expect(h).toContain("O que você contou");
    expect(h).toContain("Montado até agora");
    expect(secaoOnboardingDetalhes(dados())).toContain("Nada ainda.");
  });
});

describe("protocolo: os frames do onboarding", () => {
  it("aceita onboarding e sugestões bem formados", () => {
    const campos = { apelido: "Marlon", comoConheceu: null, objetivo: null, tamanhoTime: "so_eu" };
    expect(lerMsgServidor(JSON.stringify({ t: "onboarding", etapa: "entrevista", campos }))).toEqual({ t: "onboarding", etapa: "entrevista", campos });
    expect(lerMsgServidor(JSON.stringify({ t: "sugestoes", itens: ["Só eu", "Somos uns cinco"] }))).toEqual({ t: "sugestoes", itens: ["Só eu", "Somos uns cinco"] });
    expect(lerMsgServidor(JSON.stringify({ t: "sugestoes", itens: [] }))).toEqual({ t: "sugestoes", itens: [] });
  });

  it("recusa etapa desconhecida, tamanho fora dos códigos, campo do tipo errado, chips demais ou longos", () => {
    const campos = { apelido: null, comoConheceu: null, objetivo: null, tamanhoTime: null };
    expect(lerMsgServidor(JSON.stringify({ t: "onboarding", etapa: "dormindo", campos }))).toBeNull();
    expect(lerMsgServidor(JSON.stringify({ t: "onboarding", etapa: "entrevista", campos: { ...campos, tamanhoTime: "muitos" } }))).toBeNull();
    expect(lerMsgServidor(JSON.stringify({ t: "onboarding", etapa: "entrevista", campos: { ...campos, apelido: 3 } }))).toBeNull();
    expect(lerMsgServidor(JSON.stringify({ t: "sugestoes", itens: ["a", "b", "c", "d", "e"] }))).toBeNull();
    expect(lerMsgServidor(JSON.stringify({ t: "sugestoes", itens: ["x".repeat(81)] }))).toBeNull();
    expect(lerMsgServidor(JSON.stringify({ t: "sugestoes", itens: [1] }))).toBeNull();
  });
});

describe("reducer: resolverInicio e o onboarding", () => {
  const frota: FrotaDto = {
    agentes: [{ tenantId: "t1", id: "a1", ownerId: "p1", visibility: "privado", nome: "Lia", titulo: "", descricao: "x", dono: "pessoa", forma: "shape-square", cor: "c-pink", fixado: false, oculto: false, confirmado: true, modelo: "auto", duplicadoDe: null, criadoEm: 1, conversaId: "c1", descricaoEstado: "", computadorForaDoAr: null, ultimaMensagem: null }],
    inventario: { estado: "pronto", versao: "catcher", em: 1 },
    negacoes: [],
  };
  const comSessao = reduzir(estadoInicial, { tipo: "sessao", escopo: { tenantId: "t1", pessoaId: "p1" } });

  it("com sessão e sem leitura, o onboarding é buscado uma vez", () => {
    expect(invalidacoesDaTela(comSessao)).toContain("onboarding");
    expect(invalidacoesDaTela(reduzir(comSessao, { tipo: "hidratar-onboarding", onboarding: null }))).not.toContain("onboarding");
  });

  it("não concluiu: abre o onboarding na conversa da guia, mesmo se a frota chegou antes", () => {
    let e = reduzir(comSessao, { tipo: "hidratar-frota", frota });
    expect(e.tela).toMatchObject({ tipo: "conversa", conversaId: "c1" });
    e = reduzir(e, { tipo: "hidratar-onboarding", onboarding: dados() });
    expect(e.onboardingAberto).toBe(true);
    expect(e.tela).toEqual({ tipo: "conversa", conversaId: "cg", agenteId: "g1" });
    // Uma releitura não reabre o que a pessoa fechou.
    e = reduzir(reduzir(e, { tipo: "onboarding-aberto", aberto: false }), { tipo: "hidratar-onboarding", onboarding: dados() });
    expect(e.onboardingAberto).toBe(false);
  });

  it("concluído (ou falha na leitura): o app abre normal", () => {
    const e = reduzir(reduzir(comSessao, { tipo: "hidratar-onboarding", onboarding: dados({ mostrar: false, etapa: "concluido" }) }), { tipo: "hidratar-frota", frota });
    expect(e.onboardingAberto).toBe(false);
    expect(e.tela).toMatchObject({ tipo: "conversa", conversaId: "c1" });
    expect(reduzir(comSessao, { tipo: "hidratar-onboarding", onboarding: null }).onboardingAberto).toBe(false);
  });
});

describe("menu da conta", () => {
  it("tem 'Ver o onboarding de novo'", () => {
    expect(htmlMenuConta({ faixa: null, conexao: "", avisos: "", modoDev: false, banco: null })).toContain("Ver o onboarding de novo");
  });
});
