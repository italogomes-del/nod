import { describe, expect, it } from "vitest";
import type { ContaIa, ContasIaDto, LoginNaMaquina } from "../../../src/contracts/contas-ia.ts";
import type { MaquinaDto } from "../../../src/contracts/maquina.ts";
import { criarContasDaPessoa, ligarPedeAvisoDosTermos, type ApiContas } from "../../../web/lib/contas-da-pessoa.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { REGRAS_DA_FILA, renderListaDeContas, renderContasNaMaquina, resumoDasContasNaMaquina, UI_CONTAS_INICIAL, type ContextoContas, type UiContas } from "../../../web/telas/contas-lista.ts";
import { renderMaquinas } from "../../../web/telas/maquinas.ts";
import { renderProvedores } from "../../../web/telas/provedores.ts";

/**
 * ADR-102 (2026-10-13): a lista única de contas em Provedores de IA (protótipos G1/CM1-A), o login na VM pela tela (G1-P3)
 * e o que Máquinas mostra das contas (G2). E-mail e organização vêm do servidor (ADR-105).
 */
const AGORA = Date.UTC(2026, 9, 13, 15, 0);
const VM = "11111111-1111-4111-8111-111111111111";
const MAC = "22222222-2222-4222-8222-222222222222";
const maquina = (id: string, nome: string, o: Partial<MaquinaDto> = {}): MaquinaDto => ({ id, nome, prefixo: "abcd1234", criadaEm: 1, ultimoUsoEm: null, conectada: true, plataforma: "linux", ias: {}, gh: false, ...o });
const MAQUINAS = [maquina(VM, "vm-bots"), maquina(MAC, "MacBook", { plataforma: "darwin" })];
const conta = (id: string, ia: ContaIa["ia"], apelido: string, maquinas: string[], o: Partial<ContaIa> = {}): ContaIa => ({
  id, ia, impressao: id.replace(/-/g, "").padEnd(64, "a").slice(0, 64), apelido, email: null, organizacao: null, plano: "Max", corporativa: false, posicao: 1, entraNaTrocaAutomatica: false, noLimiteAte: null,
  maquinas: maquinas.map((m) => ({ maquinaId: m, nome: m === VM ? "vm-bots" : "MacBook", estado: "pronta" as const })), ...o,
});
// ADR-108: como a 0080 deixa — a 1ª pessoal de cada IA na fila; a corporativa fora.
const PESSOAL = conta("aaaaaaaa-0000-4000-8000-000000000001", "claude-cli", "Pessoal", [VM, MAC], { entraNaTrocaAutomatica: true });
const GPT = conta("aaaaaaaa-0000-4000-8000-000000000002", "codex-cli", "Pessoal", [MAC], { plano: "Plus", entraNaTrocaAutomatica: true });
const LEAPY = conta("aaaaaaaa-0000-4000-8000-000000000003", "claude-cli", "Leapy", [MAC], { plano: "Team", corporativa: true, noLimiteAte: AGORA + 3_600_000 });
const CONTAS: ContasIaDto = { disponivel: true, modo: "perguntar", contas: [PESSOAL, GPT, LEAPY] };

function ctx(o: Partial<Omit<ContextoContas, "ui">> & { ui?: Partial<UiContas> } = {}): ContextoContas {
  return { contas: CONTAS, maquinas: MAQUINAS, detalhes: null, agora: AGORA, noApp: false, botsNaMaquina: () => ["Ze 1"], cartaoDoMac: () => "<div>cartão do mac</div>", ...o, ui: { ...UI_CONTAS_INICIAL, ...o.ui } };
}

const login = (o: Partial<LoginNaMaquina> = {}): LoginNaMaquina => ({ id: "33333333-3333-4333-8333-333333333333", maquinaId: VM, ia: "claude-cli", contaId: GPT.id, apelido: null, fase: "aguardando_pessoa", url: "https://claude.com/cai/oauth/authorize?x=1", codigoDispositivo: null, pedeCodigo: true, chavePublica: "QUJD", codigoEnviado: false, erro: null, contaFinalId: null, criadoEm: AGORA, atualizadoEm: AGORA, ...o });

describe("lista única de contas (ADR-102)", () => {
  it("uma linha por conta, sem agrupar: logo, provedor · apelido, plano, corporativa e uma pílula por máquina", () => {
    const html = renderListaDeContas(ctx());
    expect(html.indexOf("Claude · Pessoal")).toBeLessThan(html.indexOf("ChatGPT · Pessoal"));
    expect(html.indexOf("ChatGPT · Pessoal")).toBeLessThan(html.indexOf("Claude · Leapy"));
    expect(html).toContain("3 contas · em ordem de uso");
    expect(html).toContain("Corporativa");
    expect(html).toContain("No limite até");
    expect(html).toContain("Em uso");
    // A ChatGPT · Pessoal não está na VM: a pílula tracejada leva ao login nela.
    expect(html).toContain(`data-act="cl-entrar" data-id="${GPT.id}" data-maquina="${VM}"`);
    // Fora do app do Mac, o Mac só entra pelo app (a pílula explica, sem clique).
    expect(html).not.toContain(`data-act="cl-entrar" data-id="${PESSOAL.id}" data-maquina="${MAC}"`);
    expect(html).toContain('data-ordem-lista="contas"');
  });

  it("sem e-mail no servidor nem no app, a linha diz só por qual CLI", () => {
    expect(renderListaDeContas(ctx())).not.toContain("@");
    expect(renderListaDeContas(ctx())).toContain("<span>pelo Claude Code</span>");
  });

  it("ADR-105: o e-mail e a organização vêm do servidor, em qualquer máquina (fora do app também)", () => {
    const comEmail = { ...CONTAS, contas: [PESSOAL, GPT, { ...LEAPY, email: "marlon@leapy.com.br", organizacao: "Leapy" }] };
    const html = renderListaDeContas(ctx({ contas: comEmail }));
    expect(html).toContain("marlon@leapy.com.br · organização Leapy · pelo Claude Code");
    // O Detalhes da conta também.
    expect(renderListaDeContas(ctx({ contas: comEmail, ui: { detalhe: LEAPY.id } }))).toContain("<dt>Conta</dt><dd>marlon@leapy.com.br · Leapy</dd>");
  });

  it("ADR-105: o app do Mac que conhece a conta ganha do servidor (é o que o CLI disse agora)", () => {
    const comEmail = { ...CONTAS, contas: [PESSOAL, GPT, { ...LEAPY, email: "antigo@leapy.com.br", organizacao: "Leapy" }] };
    const html = renderListaDeContas(ctx({ contas: comEmail, noApp: true, detalhes: { maquinaId: MAC, contas: [{ impressao: LEAPY.impressao, ia: "claude-cli", email: "marlon@leapy.com.br", organizacao: "Leapy SA", plano: "Team" }] } }));
    expect(html).toContain("marlon@leapy.com.br · organização Leapy SA · pelo Claude Code");
    expect(html).not.toContain("antigo@");
  });

  it("o ⋯ abre Renomear, Detalhes, Sair de cada máquina e Remover de todas", () => {
    const html = renderListaDeContas(ctx({ ui: { menu: PESSOAL.id } }));
    expect(html).toContain('data-act="cl-renomear"');
    expect(html).toContain('data-act="cl-detalhe"');
    expect(html).toContain(`data-act="cl-sair" data-id="${PESSOAL.id}" data-maquina="${VM}"`);
    expect(html).toContain(`data-act="cl-sair" data-id="${PESSOAL.id}" data-maquina="${MAC}"`);
    expect(html).toContain("Remover de todas as máquinas");
  });

  // Regression: ISSUE-004 — o menu dizia "Sair doa vm-qa". Found by /qa on 2026-10-13.
  it("QA do PR #306: o menu diz 'Sair da vm-bots' e 'Sair do Mac'", () => {
    const html = renderListaDeContas(ctx({ ui: { menu: PESSOAL.id } }));
    expect(html).toContain("Sair da vm-bots");
    expect(html).toContain("Sair do Mac");
    expect(html).not.toContain("doa ");
  });

  // Regression: ISSUE-008 — sem máquina nenhuma, a primeira conta aparecia "Em uso". Found by /qa on 2026-10-13.
  it("QA do PR #306: conta sem máquina não aparece 'Em uso'", () => {
    const sem = { ...CONTAS, contas: [{ ...PESSOAL, maquinas: [] }, GPT] };
    const html = renderListaDeContas(ctx({ contas: sem }));
    expect(html.indexOf("Em uso")).toBeGreaterThan(html.indexOf("ChatGPT · Pessoal"));
  });

  // Regression: ISSUE-003 — entrar numa conta que já estava na lista não dizia nada. Found by /qa on 2026-10-13.
  it("QA do PR #306: login de conta nova que era uma conta da lista avisa qual", () => {
    const html = renderListaDeContas(ctx({ ui: { logins: [{ onde: "vm", login: login({ contaId: null, fase: "pronto", contaFinalId: PESSOAL.id }), codigo: "", enviando: false, erroEnvio: null }] } }));
    expect(html).toContain("já estava na lista");
    expect(html).toContain("Claude · Pessoal");
  });

  // Regression: ISSUE-009 — a linha da conta nova seguia "Entrando…" depois do login concluído. Found by /qa on 2026-10-13.
  it("QA do PR #306: a linha da conta nova diz 'Entrou' quando o login termina", () => {
    const html = renderListaDeContas(ctx({ ui: { logins: [{ onde: "vm", login: login({ contaId: null, fase: "pronto" }), codigo: "", enviando: false, erroEnvio: null }] } }));
    expect(html).not.toContain("Entrando…");
    expect(html).toContain(">Entrou</span>");
  });

  it("sair: o diálogo diz o que acontece com os bots da máquina; remover: de quantas máquinas", () => {
    const sair = renderListaDeContas(ctx({ ui: { confirmar: { tipo: "sair", contaId: PESSOAL.id, maquinaId: VM } } }));
    expect(sair).toContain("Sair da Claude · Pessoal na vm-bots?");
    expect(sair).toContain("A vm-bots fica sem conta de IA");
    const remover = renderListaDeContas(ctx({ ui: { confirmar: { tipo: "remover", contaId: PESSOAL.id } } }));
    expect(remover).toContain("Remover das 2 máquinas");
  });

  it("login na VM pela tela: link oficial, campo do código e o aviso de que vai cifrado; o terminal fica escondido", () => {
    const html = renderListaDeContas(ctx({ ui: { logins: [{ onde: "vm", login: login(), codigo: "", enviando: false, erroEnvio: null }] } }));
    expect(html).toContain("Abrir a página da Anthropic");
    expect(html).toContain('data-form="cl-codigo"');
    expect(html).toContain("vai cifrado direto para a vm-bots");
    expect(html).toContain("Prefere o terminal?");
    expect(html).not.toContain("nod-motor entrar claude");
    const aberto = renderListaDeContas(ctx({ ui: { terminal: login().id, logins: [{ onde: "vm", login: login(), codigo: "", enviando: false, erroEnvio: null }] } }));
    expect(aberto).toContain("nod-motor entrar claude");
  });

  it("Codex na VM: o código do aparelho para digitar na página da OpenAI", () => {
    const html = renderListaDeContas(ctx({ ui: { logins: [{ onde: "vm", login: login({ ia: "codex-cli", pedeCodigo: false, codigoDispositivo: "ABCD-1234", url: "https://auth.openai.com/codex/device" }), codigo: "", enviando: false, erroEnvio: null }] } }));
    expect(html).toContain("ABCD-1234");
    expect(html).toContain("Abrir a página da OpenAI");
  });

  it("filtro por máquina: abas, voltar para Máquinas e o botão de entrar nas contas que não estão nela", () => {
    const html = renderListaDeContas(ctx({ ui: { filtro: VM } }));
    expect(html).toContain("Voltar para Máquinas");
    expect(html).toContain(`data-act="cl-entrar" data-id="${LEAPY.id}" data-maquina="${VM}"`);
    expect(html).toContain("Em uso na vm-bots");
  });

  it("ADR-108 (R8): sem o 'Perguntar antes / Trocar sozinho' — um liga/desliga 'na fila' por conta e as três regras do Nod", () => {
    const html = renderListaDeContas(ctx());
    expect(html).not.toContain("cl-modo");
    expect(html).not.toContain("Trocar sozinho");
    expect(html).not.toContain("data-cl-optin");
    expect(html).toContain(`role="switch" aria-checked="true" data-act="cl-fila" data-id="${PESSOAL.id}"`);
    expect(html).toContain(`role="switch" aria-checked="false" data-act="cl-fila" data-id="${LEAPY.id}"`);
    expect(html).toContain("Quando uma conta acabar");
    for (const r of REGRAS_DA_FILA) expect(html).toContain(`<b>${r.titulo}:</b>`);
    expect(html).toContain("Outra IA:</b> só nos bots em Automático");
    expect(html).toContain("o Nod recomenda esperar ou trocar");
    // Fora da fila e livre: a linha diz isso (no lugar de "Disponível").
    const foraLivre = { ...CONTAS, contas: [PESSOAL, GPT, { ...LEAPY, noLimiteAte: null }] };
    expect(renderListaDeContas(ctx({ contas: foraLivre }))).toContain("Fora da fila");
  });

  it("ADR-108 (E4): 'Em uso' é a 1ª da fila livre, nunca a fora da fila antes dela", () => {
    const foraPrimeiro = { ...CONTAS, contas: [{ ...LEAPY, noLimiteAte: null, posicao: 1 }, { ...PESSOAL, posicao: 2 }, { ...GPT, posicao: 3 }] };
    const html = renderListaDeContas(ctx({ contas: foraPrimeiro }));
    const linhaDa = (id: string) => html.slice(html.indexOf(`data-ordem-item="${id}"`), html.indexOf("</li>", html.indexOf(`data-ordem-item="${id}"`)));
    expect(linhaDa(PESSOAL.id)).toContain("Em uso");
    expect(linhaDa(LEAPY.id)).toContain("Fora da fila");
  });

  describe("PR #306: Adicionar conta sem máquina que receba o login", () => {
    const nova = { ia: "claude-cli" as const, apelido: "", maquinas: [] };

    it("sem máquina nenhuma: no lugar do formulário, o porquê e o Conectar uma VM", () => {
      const html = renderListaDeContas(ctx({ maquinas: [], ui: { nova } }));
      expect(html).not.toContain('data-form="cl-nova"');
      expect(html).toContain("o login do Claude e do ChatGPT é feito no Mac, pelo app do nod, ou numa VM");
      expect(html).toContain('data-act="cl-conectar-vm"');
      expect(html).toContain('data-act="cl-nova-fechar"');
      expect(html).toContain("No Mac, o login é feito pelo app do nod");
    });

    it("só o Mac conectado e a pessoa no navegador: o aviso diz para abrir o app nele", () => {
      const html = renderListaDeContas(ctx({ maquinas: [maquina(MAC, "MacBook", { plataforma: "darwin" })], ui: { nova } }));
      expect(html).not.toContain('data-form="cl-nova"');
      expect(html).toContain("Seu Mac já está conectado: abra o app do nod nele");
    });

    it("VM desconectada não conta como máquina para o login", () => {
      const html = renderListaDeContas(ctx({ maquinas: [maquina(VM, "vm-bots", { conectada: false })], ui: { nova } }));
      expect(html).toContain('data-act="cl-conectar-vm"');
    });

    it("com uma VM conectada (ou dentro do app do Mac), o formulário de sempre", () => {
      expect(renderListaDeContas(ctx({ maquinas: [maquina(VM, "vm-bots")], ui: { nova } }))).toContain('data-form="cl-nova"');
      const noMac = renderListaDeContas(ctx({ maquinas: [maquina(MAC, "MacBook", { plataforma: "darwin" })], noApp: true, detalhes: { maquinaId: MAC, contas: [] }, ui: { nova } }));
      expect(noMac).toContain('data-form="cl-nova"');
      expect(noMac).toContain("Este Mac");
    });
  });
});

describe("Provedores e Máquinas com a lista (ADR-102)", () => {
  const estado = (o: Partial<Estado> = {}): Estado => ({ ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" }, maquinas: { maquinas: MAQUINAS, padraoId: null }, contasIa: CONTAS, frota: { agentes: [] } as never, ...o });

  it("Provedores mostra a lista única no modo compartilhado e a tela de antes no modo local", () => {
    expect(renderProvedores(estado())).toContain('data-ordem-lista="contas"');
    expect(renderProvedores(estado({ contasIa: { disponivel: false, modo: "perguntar", contas: [] } }))).not.toContain('data-ordem-lista="contas"');
  });

  it("app do Mac antigo: a tela de antes, com a faixa para atualizar", () => {
    const html = renderProvedores(estado({ contasUi: { ...UI_CONTAS_INICIAL, appAntigo: true } }));
    expect(html).toContain("Atualize o app do nod");
    expect(html).not.toContain('data-ordem-lista="contas"');
  });

  it("Máquinas: o resumo das contas de cada máquina, quantas faltam e o Gerenciar contas", () => {
    const resumo = resumoDasContasNaMaquina(CONTAS, MAQUINAS[0]!);
    expect(resumo).toContain("1 conta · Claude · Pessoal");
    expect(resumo).toContain("2 contas suas ainda não estão aqui");
    expect(resumo).toContain(`data-act="cl-gerenciar" data-maquina="${VM}"`);
    const html = renderMaquinas(estado({ contasUi: { ...UI_CONTAS_INICIAL, maquinaMenu: VM } }));
    expect(html).toContain('data-act="maq-renomear"');
    expect(html).toContain('data-act="maq-desconectar"');
  });

  it("Desconectar: com contas na máquina, a caixa de sair delas vem marcada", () => {
    const html = renderMaquinas(estado({ contasUi: { ...UI_CONTAS_INICIAL, desconectar: { maquinaId: VM, sair: true } } }));
    expect(html).toContain("Desconectar a vm-bots?");
    expect(html).toMatch(/data-maq-sair-contas checked/);
  });

  it("Conectar com convite: o comando leva o convite e a tela espera a máquina, sem o passo do código", () => {
    const html = renderMaquinas(estado({ conectarMaquina: { passo: "comando", codigo: "", pedido: null, erro: null, chavesAntes: [], marcados: [], convite: "abc_DEF-123" } }));
    expect(html).toContain("/motor?convite=abc_DEF-123");
    expect(html).toContain("Esperando a máquina aparecer");
    expect(html).not.toContain("Digitar o código");
  });

  it("passo Contas do Conectar: cada conta com Entrar na máquina nova", () => {
    const html = renderContasNaMaquina({ contas: CONTAS, maquinas: MAQUINAS, detalhes: null, ui: UI_CONTAS_INICIAL, agora: AGORA, noApp: false, botsNaMaquina: () => [], cartaoDoMac: () => "" }, VM);
    expect(html).toContain("✓ logada");
    expect(html).toContain(`data-act="cl-entrar" data-id="${GPT.id}" data-maquina="${VM}"`);
    expect(html).toContain('data-act="cl-nova-na-maquina" data-ia="codex-cli"');
  });
});

describe("controlador da lista (ADR-102)", () => {
  function montar(api: Partial<ApiContas> = {}, termos: { aceita: boolean } = { aceita: true }) {
    let estado = reduzir({ ...estadoInicial, maquinas: { maquinas: MAQUINAS, padraoId: null } }, { tipo: "hidratar-contas", contas: CONTAS, detalhes: null });
    const pendentes: (() => void)[] = [];
    const chamadas: string[] = [];
    const c = criarContasDaPessoa({
      api: () => ({
        ordemContas: async (ids) => { chamadas.push(`ordem:${ids.length}`); return null; },
        mudarConta: async (id, corpo) => { if (corpo.entraNaTrocaAutomatica !== undefined) chamadas.push(`fila:${id}:${corpo.entraNaTrocaAutomatica}`); return null; },
        sairDaConta: async (id, m) => { chamadas.push(`sair:${id}:${m}`); return { ok: true }; },
        removerConta: async (id) => { chamadas.push(`remover:${id}`); return { ok: true }; },
        pedirLogin: async (m, p) => login({ maquinaId: m, contaId: p.contaId ?? null, apelido: p.apelido ?? null, fase: "pedido", url: null }),
        verLogin: async () => login(),
        colarCodigoLogin: async () => { chamadas.push("codigo"); return { ok: true }; },
        cancelarLogin: async () => ({ ok: true }),
        ...api,
      }),
      ui: () => estado.contasUi,
      mudar: (mudanca) => { estado = reduzir(estado, { tipo: "contas-ui", mudanca }); },
      contas: () => estado.contasIa,
      trocarContas: (contas) => { estado = reduzir(estado, { tipo: "trocar-contas", contas }); },
      maquinas: () => estado.maquinas?.maquinas ?? [],
      detalhes: () => estado.detalhesContas,
      invalidar: () => chamadas.push("invalidar"),
      entrarNoMac: async () => true,
      avisarTermos: async (ia) => { chamadas.push(`termos:${ia}`); return termos.aceita; },
      cifrar: async (chave, codigo) => ({ chave, iv: "aXY=", dados: btoa(codigo) }),
      agendar: (fn) => { pendentes.push(fn); },
      agora: () => AGORA,
    });
    const rodar = async () => { for (const fn of pendentes.splice(0)) fn(); await new Promise((r) => setTimeout(r, 0)); };
    return { c, chamadas, rodar, get estado() { return estado; } };
  }

  it("arrastar muda a lista na hora e manda a ordem ao servidor", async () => {
    const m = montar();
    await m.c.reordenar([LEAPY.id, PESSOAL.id, GPT.id]);
    expect(m.estado.contasIa?.contas.map((c) => c.apelido)).toEqual(["Leapy", "Pessoal", "Pessoal"]);
    expect(m.chamadas).toContain("ordem:3");
  });

  it("entrar numa VM abre o login na tela; o código vai cifrado e a tela segue conferindo", async () => {
    const m = montar();
    await m.c.entrar(GPT.id, VM);
    expect(m.estado.contasUi.logins).toHaveLength(1);
    await m.rodar();
    const l = m.estado.contasUi.logins[0]!;
    expect(l.onde === "vm" && l.login.fase).toBe("aguardando_pessoa");
    await m.c.enviarCodigo(l.onde === "vm" ? l.login.id : "", "codigo-da-pagina");
    expect(m.chamadas).toContain("codigo");
    const depois = m.estado.contasUi.logins[0]!;
    expect(depois.onde === "vm" && depois.login.codigoEnviado).toBe(true);
  });

  it("sair e remover passam pela confirmação", async () => {
    const m = montar();
    m.c.pedirSaida(PESSOAL.id, VM);
    await m.c.confirmar();
    m.c.pedirRemocao(LEAPY.id);
    await m.c.confirmar();
    expect(m.chamadas).toEqual(expect.arrayContaining([`sair:${PESSOAL.id}:${VM}`, `remover:${LEAPY.id}`]));
    expect(m.estado.contasIa?.contas.some((c) => c.id === LEAPY.id)).toBe(false);
  });

  it("ADR-108: ligar a corporativa na fila pede os termos; recusado, nada muda; aceito, liga", async () => {
    const recusa = montar({}, { aceita: false });
    await recusa.c.naFila(LEAPY.id, true);
    expect(recusa.chamadas).toEqual(["termos:claude-cli"]);
    expect(recusa.estado.contasIa?.contas.find((c) => c.id === LEAPY.id)?.entraNaTrocaAutomatica).toBe(false);
    const aceita = montar();
    await aceita.c.naFila(LEAPY.id, true);
    expect(aceita.chamadas).toEqual(["termos:claude-cli", `fila:${LEAPY.id}:true`, "invalidar"]);
    expect(aceita.estado.contasIa?.contas.find((c) => c.id === LEAPY.id)?.entraNaTrocaAutomatica).toBe(true);
  });

  it("ADR-108: desligar nunca pede os termos; a 1ª pessoal da IA liga sem pedir; a 2ª da mesma IA pede", async () => {
    const m = montar();
    await m.c.naFila(PESSOAL.id, false);
    expect(m.chamadas).toEqual([`fila:${PESSOAL.id}:false`, "invalidar"]);
    await m.c.naFila(PESSOAL.id, true);
    expect(m.chamadas).not.toContain("termos:claude-cli");
    const segunda = conta("aaaaaaaa-0000-4000-8000-000000000004", "claude-cli", "Pessoal 2", [VM]);
    const comSegunda = { ...CONTAS, contas: [...CONTAS.contas, segunda] };
    expect(ligarPedeAvisoDosTermos(comSegunda, segunda.id)).toBe(true);
    expect(ligarPedeAvisoDosTermos(comSegunda, LEAPY.id)).toBe(true);
    expect(ligarPedeAvisoDosTermos({ ...CONTAS, contas: [{ ...PESSOAL, entraNaTrocaAutomatica: false }, GPT] }, PESSOAL.id)).toBe(false);
  });

  it("o Mac só entra pelo app aberto nele", async () => {
    const m = montar();
    await m.c.entrar(GPT.id, MAC);
    expect(m.estado.contasUi.nota).toContain("abra o app do nod");
    expect(m.estado.contasUi.logins).toHaveLength(0);
  });
});
