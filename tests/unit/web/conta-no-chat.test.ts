import { describe, expect, it, vi } from "vitest";
import { ErroApi } from "../../../web/lib/erro-api.ts";
import { criarContaNoChat, htmlBlocoConta, htmlEtapa, resumoDoEspaco, type ApiConta, type DepsConta } from "../../../web/telas/conta-no-chat.ts";
import { deveLembrar, htmlLembrete, jaFalou, marcarFalou } from "../../../web/telas/lembrete-conta.ts";
import { htmlMenuConta } from "../../../web/telas/menu-conta.ts";

/**
 * NOD-345: os cartões da conta na conversa. Sem DOM: o HTML sai puro e o controlador recebe a API, o relógio e a leitura
 * dos campos falsos. O que se prova aqui: as etapas do protótipo, "Conferindo…" sem envio duplo, "Restam N", a falha da
 * importação que não muda nada, a resposta neutra da recuperação e que a senha nunca chega ao HTML nem às linhas.
 */
const SENHA = "uma-senha-bem-longa-123";
const vista = { ocupado: false, google: true, agora: 0 };
const form = (valores: Record<string, string>) => ({ valores });
const campo = (f: object, nome: string) => (f as { valores: Record<string, string> }).valores[nome] ?? "";
const el = (dados: Record<string, string> = {}) => ({ dataset: dados });

function montar(api: Partial<ApiConta>, extra: Partial<DepsConta> = {}) {
  const ticks: (() => void)[] = [];
  const entrou = vi.fn(async () => undefined);
  const irParaConversa = vi.fn();
  const c = criarContaNoChat({
    api: () => api as ApiConta,
    conversaDoNod: () => ({ conversaId: "conv-nod", agenteId: "nod" }),
    conversaDaTela: () => "conv-tela",
    irParaConversa,
    aoMudar: () => undefined,
    google: () => true,
    noApp: () => false,
    entrou,
    contaMudou: () => undefined,
    abrirUrl: () => undefined,
    agora: () => 1_000,
    intervalo: (fn) => { ticks.push(fn); return () => { ticks.splice(ticks.indexOf(fn), 1); }; },
    campo,
    ...extra,
  });
  const bloco = () => c.blocoNaConversa("conv-nod");
  return { c, bloco, entrou, irParaConversa, ticks };
}
const esperar = () => new Promise((r) => setTimeout(r, 0));

describe("cartões: HTML puro", () => {
  it("início: Google (quando há), e-mail, Agora não, entrar e código", () => {
    const h = htmlEtapa({ tipo: "inicio" }, vista);
    for (const t of ["Conta no nod", "Continuar com Google", "Usar e-mail", "Agora não", "Já tenho conta com e-mail", "Tenho um código"]) expect(h).toContain(t);
    expect(htmlEtapa({ tipo: "inicio" }, { ...vista, google: false })).not.toContain("Continuar com Google");
  });

  it("código: Restam N, vencido pede outro, ocupado = Conferindo… desabilitado", () => {
    const base = { tipo: "codigo" as const, email: "a@b.com", restantes: 3, vencido: false, reenviado: false };
    expect(htmlEtapa(base, vista)).toContain("Restam 3");
    const venc = htmlEtapa({ ...base, vencido: true }, vista);
    expect(venc).toContain("venceu");
    expect(venc).not.toContain('data-form="conta-codigo"');
    const ocup = htmlEtapa(base, { ...vista, ocupado: true });
    expect(ocup).toMatch(/type="submit" class="bt pri" disabled aria-busy="true">Conferindo…/);
  });

  it("código que não saiu (provedor fora): diz que ainda não saiu e pede outro, sem 'Mandamos'", () => {
    const h = htmlEtapa({ tipo: "codigo", email: "a@b.com", restantes: null, vencido: false, reenviado: false, naoEnviado: true }, vista);
    expect(h).toContain("ainda não saiu");
    expect(h).toContain("Tente mandar outro");
    expect(h).not.toContain("Mandamos");
  });

  it("escolha e falha: 'nada mudou' com Tentar de novo e Continuar sem conta", () => {
    const e = { tipo: "escolha" as const, email: "a@b.com", espaco: { bots: 2, conversas: 5, mensagens: 40, rotinas: 1, artefatos: 0 }, falhou: false, confirmado: true };
    const h = htmlEtapa(e, vista);
    for (const t of ["E-mail confirmado", "Levar para esta conta", "Usar outra conta", "Agora não", "2 bots, 5 conversas e 1 rotina"]) expect(h).toContain(t);
    const f = htmlEtapa({ ...e, falhou: true }, vista);
    expect(f).toContain("Nada mudou");
    expect(f).toContain("Tentar de novo");
    expect(f).toContain("Continuar sem conta");
  });

  it("sessões: lista, 'Sair de N sessões' em vermelho só depois de pedir", () => {
    const dados = { atual: "s1", sessoes: [
      { id: "s1", origem: "web" as const, aparelho: "Mac · Chrome", criadaEm: 0, ultimoUsoEm: 0, revogadaEm: null },
      { id: "s2", origem: "web" as const, aparelho: "Windows · Edge", criadaEm: 0, ultimoUsoEm: 0, revogadaEm: null },
      { id: "s3", origem: "maquina" as const, aparelho: "macOS · app do nod", criadaEm: 0, ultimoUsoEm: 0, revogadaEm: null },
      { id: "s4", origem: "web" as const, aparelho: "Velha", criadaEm: 0, ultimoUsoEm: 0, revogadaEm: 5 },
    ] };
    const lista = htmlEtapa({ tipo: "sessoes", dados, confirmar: false }, vista);
    expect(lista).toContain("esta sessão");
    expect(lista).not.toContain("Velha");
    const conf = htmlEtapa({ tipo: "sessoes", dados, confirmar: true }, vista);
    expect(conf).toMatch(/class="bt danger" data-act="conta-sair-outras">Sair de 2 sessões/);
  });

  it("pareamento: código grande com o prazo; pedido mostra os símbolos e Sim, conectar / Não reconheço", () => {
    const g = htmlEtapa({ tipo: "parear-gerar", codigo: "123456", expiraEm: 301_000, pedido: null, vencido: false }, { ...vista, agora: 1_000 });
    expect(g).toContain("123 456");
    expect(g).toContain("5:00");
    const p = htmlEtapa({ tipo: "parear-gerar", codigo: "123456", expiraEm: 0, pedido: { aparelho: "Windows · Edge", simbolos: ["sol", "lua", "peixe"] }, vencido: false }, vista);
    expect(p).toContain("Sim, conectar");
    expect(p).toContain("Não reconheço");
    expect(p).toContain("☀️");
    expect(htmlEtapa({ tipo: "parear-gerar", codigo: "1", expiraEm: 0, pedido: null, vencido: true }, vista)).toContain("Gerar novo código");
  });

  it("campos de senha são password, sem value, e o bloco só tem linhas sem senha", () => {
    for (const e of [{ tipo: "cadastro", erro: null }, { tipo: "entrar", erro: null }, { tipo: "senha", erro: null, salva: null }] as const) {
      const h = htmlEtapa(e, vista);
      expect(h).toMatch(/type="password"/);
      expect(h).not.toMatch(/value=/);
    }
    expect(htmlBlocoConta({ etapa: null, ocupado: false, resolvidas: [], google: false, agora: 0 })).toBe("");
  });

  it("resumoDoEspaco: só o que tem", () => {
    expect(resumoDoEspaco({ bots: 0, conversas: 0, mensagens: 0, rotinas: 0, artefatos: 0 })).toBeNull();
    expect(resumoDoEspaco({ bots: 1, conversas: 0, mensagens: 0, rotinas: 0, artefatos: 3 })).toBe("1 bot e 3 artefatos");
  });
});

describe("controlador", () => {
  it("o que começa pelo menu abre na conversa do Nod; fora dela o bloco é vazio", async () => {
    const { c, irParaConversa, bloco } = montar({});
    await c.abrir("inicio", true);
    expect(irParaConversa).toHaveBeenCalledWith("conv-nod", "nod");
    expect(bloco()).toContain("Usar e-mail");
    expect(c.blocoNaConversa("outra")).toBe("");
  });

  it("cadastro → código → Restam N → convertida vira uma linha sem a senha", async () => {
    const api = {
      cadastrar: vi.fn(async () => ({ enviado: true, email: "ana@x.com" })),
      verificar: vi.fn().mockResolvedValueOnce({ resultado: "errado", restantes: 4 }).mockResolvedValueOnce({ resultado: "convertida", email: "ana@x.com" }),
      estado: vi.fn(async () => ({ conta: { email: "ana@x.com", senha: true, google: false }, escolha: null, verificando: null })),
    };
    const { c, bloco } = montar(api as Partial<ApiConta>);
    await c.abrir("cadastro");
    await c.forms["conta-cadastro"]!(form({ email: " ana@x.com ", senha: SENHA }));
    expect(api.cadastrar).toHaveBeenCalledWith("ana@x.com", SENHA);
    expect(bloco()).toContain("Confira seu e-mail");
    await c.forms["conta-codigo"]!(form({ codigo: "111111" }));
    expect(bloco()).toContain("Restam 4");
    await c.forms["conta-codigo"]!(form({ codigo: "222222" }));
    expect(bloco()).toContain("Conta criada: ana@x.com");
    expect(bloco()).not.toContain(SENHA);
    expect(c.etapa()).toBeNull();
  });

  it("R11: senha curta (por caractere, não por unidade UTF-16) é barrada no cartão, sem chamar a API", async () => {
    const cadastrar = vi.fn(async () => ({ enviado: true, email: "a@b.com" }));
    const trocarSenha = vi.fn(async () => ({ resultado: "trocada" as const, encerradas: 0 }));
    const { c, bloco } = montar({ cadastrar, trocarSenha });
    await c.abrir("cadastro");
    // 11 emojis = 22 unidades UTF-16, mas 11 caracteres para quem digita.
    await c.forms["conta-cadastro"]!(form({ email: "a@b.com", senha: "😀".repeat(11) }));
    expect(bloco()).toContain("A senha precisa de pelo menos 12 caracteres.");
    expect(cadastrar).not.toHaveBeenCalled();
    await c.forms["conta-cadastro"]!(form({ email: "a@b.com", senha: "😀".repeat(12) }));
    expect(cadastrar).toHaveBeenCalledTimes(1);
    await c.abrir("senha");
    await c.forms["conta-senha"]!(form({ atual: "a", nova: "curta", nova2: "curta" }));
    expect(bloco()).toContain("A senha precisa de pelo menos 12 caracteres.");
    expect(trocarSenha).not.toHaveBeenCalled();
  });

  it("R11: código certo de e-mail da pessoa de time diz que ela entra pelo Google", async () => {
    const api = {
      cadastrar: vi.fn(async () => ({ enviado: true, email: "ana@empresa.com" })),
      verificar: vi.fn(async () => ({ resultado: "pelo_google", email: "ana@empresa.com" })),
    };
    const { c, bloco } = montar(api as unknown as Partial<ApiConta>);
    await c.abrir("cadastro");
    await c.forms["conta-cadastro"]!(form({ email: "ana@empresa.com", senha: SENHA }));
    await c.forms["conta-codigo"]!(form({ codigo: "111111" }));
    expect(bloco()).toContain("ana@empresa.com entra pelo Google");
    expect(bloco()).not.toContain(SENHA);
  });

  it("R11: erro da API vira frase pelo código (a mensagem da API é fixa e não decide nada)", async () => {
    const cadastrar = vi.fn()
      .mockRejectedValueOnce(new ErroApi(400, "entrada_invalida", "Algum dado do pedido não está certo."))
      .mockRejectedValueOnce(new ErroApi(409, "estado_invalido", "Isso não pode ser feito agora."));
    const { c, bloco } = montar({ cadastrar } as unknown as Partial<ApiConta>);
    await c.abrir("cadastro");
    await c.forms["conta-cadastro"]!(form({ email: "a@b.com", senha: SENHA }));
    expect(bloco()).toContain("Confira o que foi digitado.");
    await c.forms["conta-cadastro"]!(form({ email: "a@b.com", senha: SENHA }));
    expect(bloco()).toContain("Isso não vale mais. Comece de novo.");
  });

  it("Conferindo…: o segundo envio enquanto o primeiro corre não chama a API de novo", async () => {
    let soltar!: () => void;
    const verificar = vi.fn(() => new Promise((r) => { soltar = () => r({ resultado: "errado", restantes: 2 }); }));
    const cadastrar = vi.fn(async () => ({ enviado: true, email: "a@b.com" }));
    const { c: c2, bloco: bloco2 } = montar({ verificar, cadastrar } as unknown as Partial<ApiConta>);
    await c2.abrir("cadastro");
    await c2.forms["conta-cadastro"]!(form({ email: "a@b.com", senha: SENHA }));
    const um = c2.forms["conta-codigo"]!(form({ codigo: "123456" }));
    expect(bloco2()).toContain("Conferindo…");
    const dois = c2.forms["conta-codigo"]!(form({ codigo: "123456" }));
    soltar();
    await Promise.all([um, dois]);
    expect(verificar).toHaveBeenCalledTimes(1);
    expect(bloco2()).toContain("Restam 2");
  });

  it("importar que falha: 'nada mudou'; tentar de novo leva e entra no espaço novo", async () => {
    const importar = vi.fn().mockResolvedValueOnce({ resultado: "falhou" }).mockResolvedValueOnce({ resultado: "importado", contagem: { bots: 1, conversas: 2, mensagens: 3, rotinas: 0, artefatos: 0 }, trocaApp: "troca-123" });
    const api = {
      entrar: vi.fn(async () => ({ resultado: "escolher", email: "ana@x.com" })),
      estado: vi.fn(async () => ({ conta: null, escolha: { email: "ana@x.com", espaco: { bots: 1, conversas: 2, mensagens: 3, rotinas: 0, artefatos: 0 } }, verificando: null })),
      importar,
    };
    const { c, bloco, entrou } = montar(api as unknown as Partial<ApiConta>);
    await c.abrir("entrar");
    await c.forms["conta-entrar"]!(form({ email: "ana@x.com", senha: SENHA }));
    expect(bloco()).toContain("Levar para esta conta");
    await c.acoes["conta-importar"]!(el());
    expect(bloco()).toContain("Nada mudou");
    expect(entrou).not.toHaveBeenCalled();
    await c.acoes["conta-importar"]!(el());
    expect(bloco()).toContain("Levado para ana@x.com: 1 bot e 2 conversas");
    expect(entrou).toHaveBeenCalledWith("troca-123");
  });

  it("importar sem resposta (rede): não promete 'nada mudou' nem oferece 'Continuar sem conta'; tentar de novo leva", async () => {
    const importar = vi.fn().mockRejectedValueOnce(new ErroApi(0, "rede", "x")).mockResolvedValueOnce({ resultado: "importado", contagem: { bots: 0, conversas: 1, mensagens: 1, rotinas: 0, artefatos: 0 }, trocaApp: null });
    const api = { estado: vi.fn(async () => ({ conta: null, escolha: { email: "a@b.com", espaco: null }, verificando: null })), importar };
    const { c, bloco, entrou } = montar(api as unknown as Partial<ApiConta>);
    await c.retomar();
    await c.acoes["conta-importar"]!(el());
    expect(bloco()).toContain("Não deu para confirmar");
    expect(bloco()).not.toContain("Nada mudou");
    expect(bloco()).not.toContain("Continuar sem conta");
    await c.acoes["conta-importar"]!(el());
    expect(bloco()).toContain("Levado para a@b.com");
    expect(entrou).toHaveBeenCalledWith(null);
  });

  it("importar sem sessão (403, a importação pode ter ido): não diz 'nada mudou'; manda entrar na conta para conferir", async () => {
    const api = { estado: vi.fn(async () => ({ conta: null, escolha: { email: "a@b.com", espaco: null }, verificando: null })), importar: vi.fn(async () => { throw new ErroApi(403, "nao_permitido", "x"); }) };
    const { c, bloco } = montar(api as unknown as Partial<ApiConta>);
    await c.retomar();
    await c.acoes["conta-importar"]!(el());
    expect(bloco()).toContain("Entre para conferir");
    expect(bloco()).toContain("a@b.com");
    expect(bloco()).not.toContain("Nada mudou");
    expect(bloco()).not.toContain("Continuar sem conta");
    await c.acoes["conta-ir-entrar"]!(el());
    expect(c.etapa()).toMatchObject({ tipo: "entrar" });
  });

  it("importar recusado pelo servidor (4xx): a transação voltou, então é 'nada mudou'", async () => {
    const api = { estado: vi.fn(async () => ({ conta: null, escolha: { email: "a@b.com", espaco: null }, verificando: null })), importar: vi.fn(async () => { throw new ErroApi(409, "estado_invalido", "x"); }) };
    const { c, bloco } = montar(api as unknown as Partial<ApiConta>);
    await c.retomar();
    await c.acoes["conta-importar"]!(el());
    expect(bloco()).toContain("Nada mudou");
    expect(bloco()).toContain("Continuar sem conta");
  });

  it("entrar recusado e limite: frases no cartão, nada de 'e-mail não existe'", async () => {
    const entrar = vi.fn().mockResolvedValueOnce({ resultado: "recusado" }).mockRejectedValueOnce(new ErroApi(429, "limite_atingido", "entrar"));
    const { c, bloco } = montar({ entrar } as unknown as Partial<ApiConta>);
    await c.abrir("entrar");
    await c.forms["conta-entrar"]!(form({ email: "x@y.com", senha: "s" }));
    expect(bloco()).toContain("E-mail ou senha não conferem.");
    await c.forms["conta-entrar"]!(form({ email: "x@y.com", senha: "s" }));
    expect(bloco()).toContain("Muitas tentativas");
  });

  it("recuperar: resposta neutra com o e-mail digitado", async () => {
    const recuperar = vi.fn(async () => ({ ok: true as const }));
    const { c, bloco } = montar({ recuperar });
    await c.abrir("recuperar");
    await c.forms["conta-recuperar"]!(form({ email: "quem@x.com" }));
    expect(bloco()).toContain("Se existir uma conta com <b>quem@x.com</b>");
  });

  it("trocar senha: as duas novas precisam bater; trocada diz quantas outras saíram", async () => {
    const trocarSenha = vi.fn(async () => ({ resultado: "trocada" as const, encerradas: 2 }));
    const { c, bloco } = montar({ trocarSenha });
    await c.abrir("senha");
    await c.forms["conta-senha"]!(form({ atual: "a", nova: SENHA, nova2: "outra" }));
    expect(bloco()).toContain("não são iguais");
    expect(trocarSenha).not.toHaveBeenCalled();
    await c.forms["conta-senha"]!(form({ atual: "a", nova: SENHA, nova2: SENHA }));
    expect(bloco()).toContain("Senha nova salva");
    expect(bloco()).toContain("as outras 2 sessões");
    expect(bloco()).not.toContain(SENHA);
  });

  it("pareamento no computador novo: pede, mostra os símbolos, espera e entra", async () => {
    const esperarPareamento = vi.fn().mockResolvedValueOnce({ estado: "esperando" }).mockResolvedValueOnce({ estado: "entrou", trocaApp: null });
    const { c, bloco, entrou, ticks } = montar({ pedirPareamento: vi.fn(async () => ({ resultado: "pedido" as const, simbolos: ["sol", "lua", "flor"] })), esperarPareamento } as unknown as Partial<ApiConta>);
    await c.abrir("parear-entrar");
    await c.forms["conta-parear-pedir"]!(form({ codigo: "123 456" }));
    expect(bloco()).toContain("🌸");
    ticks[0]!(); await esperar();
    expect(bloco()).toContain("Esperando");
    ticks[0]!(); await esperar(); await esperar();
    expect(bloco()).toContain("Computador conectado.");
    expect(entrou).toHaveBeenCalledWith(null);
    expect(ticks).toHaveLength(0);
  });

  it("pareamento num provisório: confirmado no outro, abre a escolha de levar (não entra direto)", async () => {
    const esperarPareamento = vi.fn().mockResolvedValueOnce({ estado: "escolher", email: "ana@x.com" });
    const estado = vi.fn(async () => ({ conta: null, escolha: { email: "ana@x.com", espaco: null }, verificando: null }));
    const { c, bloco, entrou, ticks } = montar({ pedirPareamento: vi.fn(async () => ({ resultado: "pedido" as const, simbolos: ["sol", "lua", "flor"] })), esperarPareamento, estado } as unknown as Partial<ApiConta>);
    await c.abrir("parear-entrar");
    await c.forms["conta-parear-pedir"]!(form({ codigo: "123 456" }));
    ticks[0]!(); await esperar(); await esperar();
    expect(bloco()).toContain("Levar para esta conta");
    expect(entrou).not.toHaveBeenCalled();
    expect(ticks).toHaveLength(0);
  });

  it("pareamento no computador da conta: o pedido aparece; 'Não reconheço' recusa", async () => {
    const decidirPareamento = vi.fn(async () => ({ estado: "recusado" as const }));
    const api = {
      gerarPareamento: vi.fn(async () => ({ codigo: "654321", expiraEm: 301_000 })),
      pareamento: vi.fn(async () => ({ pareamento: { estado: "pedido" as const, aparelho: "Windows · Edge", simbolos: ["sol", "lua", "flor"], expiraEm: 301_000 } })),
      decidirPareamento,
    };
    const { c, bloco, ticks } = montar(api as unknown as Partial<ApiConta>);
    await c.abrir("parear-gerar");
    expect(bloco()).toContain("654 321");
    ticks[0]!(); await esperar(); await esperar();
    expect(bloco()).toContain("Windows · Edge");
    await c.acoes["conta-parear-decidir"]!(el({ confirmar: "nao" }));
    expect(decidirPareamento).toHaveBeenCalledWith(false);
    expect(bloco()).toContain("Pedido recusado");
  });

  it("o código vencido do pareamento pede um novo, sem chamar o servidor", async () => {
    let agora = 1_000;
    const pareamento = vi.fn();
    const { c, bloco, ticks } = montar({ gerarPareamento: vi.fn(async () => ({ codigo: "654321", expiraEm: 2_000 })), pareamento } as unknown as Partial<ApiConta>, { agora: () => agora });
    await c.abrir("parear-gerar");
    agora = 3_000;
    ticks[0]!(); await esperar();
    expect(bloco()).toContain("Gerar novo código");
    expect(pareamento).not.toHaveBeenCalled();
  });

  it("retomar: código pendente no servidor reabre o cartão do código", async () => {
    const { c, bloco } = montar({ estado: vi.fn(async () => ({ conta: null, escolha: null, verificando: { email: "a@b.com" } })) });
    await c.retomar();
    expect(bloco()).toContain("Mandamos um código para <b>a@b.com</b>");
  });

  it("retomar antes da frota: o cartão pendente aparece quando a conversa do Nod chega", async () => {
    let frota = false;
    const { c, bloco } = montar(
      { estado: vi.fn(async () => ({ conta: null, escolha: null, verificando: { email: "a@b.com" } })) },
      { conversaDoNod: () => (frota ? { conversaId: "conv-nod", agenteId: "nod" } : null), conversaDaTela: () => null },
    );
    await c.retomar();
    expect(bloco()).toBe("");
    frota = true;
    expect(bloco()).toContain("Mandamos um código para <b>a@b.com</b>");
  });

  it("Google no app: 'termine no navegador'; na volta, recusado vira linha", async () => {
    const abrirUrl = vi.fn();
    const { c, bloco } = montar({ google: vi.fn(async () => ({ url: "https://accounts.google.com/x" })), estado: vi.fn(async () => ({ conta: null, escolha: null, verificando: null })) }, { noApp: () => true, abrirUrl });
    await c.abrir("inicio");
    await c.acoes["conta-google"]!(el());
    expect(abrirUrl).toHaveBeenCalledWith("https://accounts.google.com/x");
    expect(bloco()).toContain("Termine no navegador");
    await c.aoVoltarDoGoogle("recusado");
    expect(bloco()).toContain("Crie com e-mail e senha; nada mudou.");
  });
});

describe("lembrete e menu (opção 2)", () => {
  it("fala uma vez: só com contas, sem conta, com rotina e sem ter falado", () => {
    const base = { contas: true, temConta: false, rotinas: 1, jaFalou: false };
    expect(deveLembrar(base)).toBe(true);
    expect(deveLembrar({ ...base, contas: false })).toBe(false);
    expect(deveLembrar({ ...base, temConta: true })).toBe(false);
    expect(deveLembrar({ ...base, temConta: null })).toBe(false);
    expect(deveLembrar({ ...base, rotinas: 0 })).toBe(false);
    expect(deveLembrar({ ...base, jaFalou: true })).toBe(false);
    const mem = new Map<string, string>();
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    expect(jaFalou(st)).toBe(false);
    marcarFalou(st);
    expect(jaFalou(st)).toBe(true);
    expect(htmlLembrete()).toContain('data-act="conta-abrir"');
  });

  it("menu: sem conta, a linha fixa; com conta, e-mail e as ações; sem contas no servidor, nada", () => {
    const base = { faixa: null, conexao: "Conectada", avisos: "Ligados", modoDev: false, banco: null };
    expect(htmlMenuConta(base)).not.toContain("data-conta=");
    const sem = htmlMenuConta({ ...base, conta: { email: null, senha: false } });
    expect(sem).toContain("Criar conta ou entrar");
    expect(sem).toContain("Seu espaço está só neste computador");
    const com = htmlMenuConta({ ...base, conta: { email: "ana@x.com", senha: true } });
    for (const t of ["ana@x.com", "Trocar senha", "Sessões", "Conectar outro computador", 'data-conta="sair"']) expect(com).toContain(t);
    expect(htmlMenuConta({ ...base, conta: { email: "g@gmail.com", senha: false } })).not.toContain("Trocar senha");
  });
});
