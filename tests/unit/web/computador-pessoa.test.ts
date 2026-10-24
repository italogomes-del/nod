import { describe, expect, it } from "vitest";
import {
  MEMORIA_INICIAL,
  MS_AINDA_ESPERANDO,
  MS_OK,
  UI_INICIAL,
  estadoDaGaveta,
  htmlAvisoDeFalha,
  htmlGavetaTela,
  htmlItemMenu,
  htmlLinhaDoChat,
  htmlLogin,
  htmlPedidoDeTela,
  textoDeEntrou,
  htmlPainelComputadorDoBot,
  htmlPilula,
  lembrarComputador,
  lerComputadorPessoa,
  resumoDasTelas,
  type ComputadorPessoaDto,
  type TelaDaPessoa,
} from "../../../web/lib/computador-pessoa.ts";
import { estadoInicial, reduzir } from "../../../web/estado/reducer.ts";
import { secoesDoEspaco } from "../../../web/telas/espaco.ts";
import { htmlMenuConta } from "../../../web/telas/menu-conta.ts";

/** NOD-96, PR 6: a web do computador do bot v2 (um computador por pessoa, uma tela por bot). */
const bot = (id: string, nome: string) => ({ id, nome, cor: "c-red", forma: "shape-square" }) as never as { id: string; nome: string; cor: string; forma: string };
const BOTS = [bot("a", "Dev 2"), bot("b", "Dev 3"), bot("c", "Dev 4")] as never[];
const NOMES = { a: "Dev 2", b: "Dev 3", c: "Dev 4" };
const tela = (agenteId: string, o: Partial<TelaDaPessoa> = {}): TelaDaPessoa => ({ agenteId, estado: "aberta", controle: "bot", memoriaMb: 400, ...o });
const pc = (o: Partial<ComputadorPessoaDto> = {}): ComputadorPessoaDto => ({ estado: "pronto", maquina: { id: "vm", nome: "vm-sp", contato: 1 }, telas: [], esperando: [], ...o });

describe("contrato e flag", () => {
  it("lê só a forma do plano; o resto (404, lixo) vira null e a web fica na v1", () => {
    expect(lerComputadorPessoa(null)).toBeNull();
    expect(lerComputadorPessoa({ estado: "outro" })).toBeNull();
    expect(lerComputadorPessoa({ estado: "dormindo" })).toEqual({ estado: "dormindo", maquina: null, telas: [], esperando: [] });
  });

  it("Seu espaço ganha a seção depois de Máquinas só na v2; Computadores vira Chaves", () => {
    const v1 = secoesDoEspaco(false).map((s) => s.id);
    const v2 = secoesDoEspaco(true);
    expect(v1).not.toContain("computador-do-bot");
    const ids = v2.map((s) => s.id);
    expect(ids.indexOf("computador-do-bot")).toBe(ids.indexOf("maquinas") + 1);
    expect(v2.find((s) => s.id === "computadores")?.nome).toBe("Chaves");
    expect(secoesDoEspaco(false).find((s) => s.id === "computadores")?.nome).not.toBe("Chaves");
  });

  it("sem v2 o menu da conta fica como hoje; com v2 o item novo entra e Computadores vira Chaves", () => {
    const base = { faixa: null, conexao: "Conectada", avisos: "Ligados", modoDev: false, banco: null } as const;
    const v1 = htmlMenuConta(base);
    expect(v1).toContain("Computadores");
    expect(v1).not.toContain("Computador do bot");
    const v2 = htmlMenuConta({ ...base, computadorDoBot: htmlItemMenu(pc()) });
    expect(v2).toContain("Computador do bot");
    expect(v2).toContain("Chaves");
  });

  it("o reducer guarda o computador e o apaga quando a rota some", () => {
    const e0 = { ...estadoInicial, sessao: { tenantId: "t", pessoaId: "p" } } as never;
    const e1 = reduzir(e0, { tipo: "hidratar-computador-pessoa", dto: pc({ esperando: ["a"] }), agora: 1 });
    expect(e1.computadorPessoa?.estado).toBe("pronto");
    expect(e1.computadorMemoria.esperas.a?.motivo).toBe("memoria");
    const e2 = reduzir(e1, { tipo: "hidratar-computador-pessoa", dto: null, agora: 2 });
    expect(e2.computadorPessoa).toBeNull();
  });
});

describe("gaveta e tela cheia", () => {
  it("mostra miniatura, sem tela, dormindo, acordando ou fora", () => {
    expect(estadoDaGaveta(pc({ telas: [tela("a")] }), "a")).toBe("miniatura");
    expect(estadoDaGaveta(pc({ telas: [tela("b")] }), "a")).toBe("sem_tela");
    expect(estadoDaGaveta(pc({ estado: "dormindo" }), "a")).toBe("dormindo");
    expect(estadoDaGaveta(pc({ estado: "ligando" }), "a")).toBe("acordando");
    expect(estadoDaGaveta(pc({ estado: "fora_do_ar" }), "a")).toBe("fora");
    const mini = htmlGavetaTela(pc({ telas: [tela("a")] }), BOTS[0] as never);
    expect(mini).toContain("Tela de Dev 2");
    expect(mini).toContain('data-act="abrir-computador"');
    expect(htmlGavetaTela(pc(), BOTS[0] as never)).toContain("Dev 2 não está usando o navegador agora.");
    expect(htmlGavetaTela(pc({ estado: "dormindo" }), BOTS[0] as never)).toContain('data-op="acordar"');
    expect(htmlGavetaTela(pc({ estado: "ligando" }), BOTS[0] as never)).toContain("Acordando…");
  });

  it("a pílula: Assistindo · Assumir o controle, depois Você está no controle · Parar", () => {
    expect(htmlPilula("Dev 2", "assistindo")).toMatch(/Assistindo[\s\S]*Assumir o controle/);
    expect(htmlPilula("Dev 2", "assumindo")).toContain("Assumindo… Dev 2 termina a ação em curso");
    expect(htmlPilula("Dev 2", "controle")).toMatch(/Você está no controle[\s\S]*data-c="devolver">Parar/);
  });
});

describe("chat: espera e erro", () => {
  it("espera por memória é cinza, com quem está usando; depois de 10 min vira Ainda esperando…", () => {
    const dto = pc({ telas: [tela("b"), tela("c")], esperando: ["a"] });
    const mem = lembrarComputador(null, dto, MEMORIA_INICIAL, 1000);
    const linha = htmlLinhaDoChat(dto, mem, "a", NOMES, 2000);
    expect(linha).toContain("Esperando uma tela livre");
    expect(linha).toContain("Dev 3 e Dev 4 estão usando o computador");
    expect(linha).toContain("ver telas");
    expect(htmlLinhaDoChat(dto, mem, "a", NOMES, 1000 + MS_AINDA_ESPERANDO)).toContain("Ainda esperando…");
  });

  it("ligando mostra o chip; quando a tela abre, ✓ Tela aberta por alguns segundos", () => {
    const ligando = pc({ estado: "ligando", esperando: ["a"] });
    const m1 = lembrarComputador(null, ligando, MEMORIA_INICIAL, 0);
    expect(htmlLinhaDoChat(ligando, m1, "a", NOMES, 0)).toContain("Ligando o computador…");
    const memoria = pc({ esperando: ["a"] });
    const m2 = lembrarComputador(null, memoria, MEMORIA_INICIAL, 0);
    const aberta = pc({ telas: [tela("a")] });
    const m3 = lembrarComputador(memoria, aberta, m2, 100);
    expect(htmlLinhaDoChat(aberta, m3, "a", NOMES, 200)).toContain("Tela aberta");
    expect(htmlLinhaDoChat(aberta, m3, "a", NOMES, 100 + 7000)).toBe("");
  });

  it("redefinir fecha as telas abertas com uma linha em cada chat e acende o ✓ do menu no fim", () => {
    const antes = pc({ telas: [tela("a"), tela("b")] });
    const durante = pc({ estado: "operando", telas: [], operacao: { tipo: "redefinir", pct: 34, etapa: "Criando" } });
    const m = lembrarComputador(antes, durante, MEMORIA_INICIAL, 0);
    expect(m.fechadas?.agentes).toEqual(["a", "b"]);
    expect(htmlLinhaDoChat(durante, m, "b", NOMES, 0)).toContain("A tela de Dev 3 fechou");
    const fim = lembrarComputador(durante, pc(), m, 500);
    expect(fim.fechadas).toBeNull();
    expect(fim.okMenuAte).toBe(500 + MS_OK);
    expect(MS_OK).toBe(2_000);
  });

  it("o link do erro abre a ação no painel: Ver computador do bot realça Atualizar", () => {
    const fora = pc({ estado: "fora_do_ar", falha: { motivo: "sem_resposta", desde: 0 } as never });
    const aviso = htmlAvisoDeFalha(fora)!;
    expect(aviso).toContain('data-act="ver-computador-do-bot" data-realce="atualizar"');
    expect(aviso).toContain('data-op="tentar_de_novo"');
    expect(htmlAvisoDeFalha(pc())).toBeNull();
    const painel = htmlPainelComputadorDoBot(fora, BOTS as never, { ...UI_INICIAL, realce: "atualizar" }, 0);
    expect(painel).toMatch(/data-pc-acao="atualizar"[^>]*>[\s\S]*?sugerido/);
    expect(painel).toContain("pc-acao realce");
  });
});

describe("painel e menu", () => {
  it("Redefinir confirma com os nomes das telas que fecham; as etapas mostram a atual e o %", () => {
    const dto = pc({ telas: [tela("a"), tela("b")] });
    const conf = htmlPainelComputadorDoBot(dto, BOTS as never, { ...UI_INICIAL, confirmar: "redefinir" }, 0);
    expect(conf).toContain("Redefinir o computador?");
    expect(conf).toContain("As telas de Dev 2 e Dev 3 fecham agora");
    expect(conf).toContain('data-act="pc-cancelar" data-cl-autofoco');
    const op = pc({ estado: "operando", operacao: { tipo: "redefinir", pct: 34, etapa: "Criando" } });
    const etapas = htmlPainelComputadorDoBot(op, BOTS as never, { ...UI_INICIAL, etapasAbertas: true }, 0);
    expect(etapas).toMatch(/aria-current="step"[^>]*>[\s\S]*?Criando<span class="pc-pct">34%/);
    expect(etapas).toContain("Continuar em segundo plano");
  });

  it("o progresso fica no item de menu (anel e dica), sem toast", () => {
    const item = htmlItemMenu(pc({ estado: "operando", operacao: { tipo: "redefinir", pct: 34, etapa: null } }));
    expect(item).toContain("Redefinindo · 34%");
    expect(item).not.toContain('class="mc-meta"');
    expect(item.match(/34%/g)).toHaveLength(2); // a dica e o aria-label, sem o meta repetido
    expect(item).toContain('data-secao="computador-do-bot"');
    expect(htmlItemMenu(pc({ estado: "dormindo" }))).toContain("Dormindo");
  });

  it("o aviso de recriação pede para entrar nos sites de novo uma vez, até a pessoa dispensar", () => {
    const dto = pc({ aviso_recriado: true });
    expect(htmlPainelComputadorDoBot(dto, BOTS as never, UI_INICIAL, 0)).toContain("Entre nos sites de novo uma vez");
    expect(htmlPainelComputadorDoBot(dto, BOTS as never, UI_INICIAL, 0, true)).not.toContain("Entre nos sites de novo uma vez");
  });

  it("Esta máquina resume as telas abertas", () => {
    expect(resumoDasTelas(pc({ telas: [tela("a"), tela("b")] }), BOTS as never)).toBe("Computador do bot · 2 telas abertas: Dev 2 e Dev 3");
    expect(resumoDasTelas(pc({ estado: "dormindo" }), BOTS as never)).toBe("Computador do bot dormindo");
  });
});

describe("pedido de ajuda (login leve)", () => {
  it("depois de entrar vira uma linha só, ✓ Entrou no <site>", () => {
    const linha = htmlPedidoDeTela("entrar no LinkedIn para ver as mensagens", "a", false);
    expect(linha).toContain("cb-ok");
    expect(linha).toContain("Entrou no LinkedIn");
    expect(linha).not.toContain("A tela voltou para o bot");
    expect(linha.match(/class="cb-seg"/g)).toHaveLength(1);
    expect(htmlPedidoDeTela("verificar que é humano na Amazon", "a", false)).toContain("Entrou na Amazon");
    expect(htmlPedidoDeTela("fazer o login", "a", false)).toContain("Entrou no site");
    // O texto do protótipo aprovado: o lugar dito no pedido, mesmo sem nome próprio.
    expect(textoDeEntrou("Entrar no portal de vendas")).toBe("Entrou no portal de vendas");
    expect(textoDeEntrou("Entre na conta do banco, depois confirme o 2FA")).toBe("Entrou na conta do banco");
    expect(textoDeEntrou("Faça login no Linear para eu ver as issues.")).toBe("Entrou no Linear");
    // O nome não engole a frase seguinte nem o ponto final.
    expect(textoDeEntrou("Preciso do 2FA no LinkedIn. Depois sigo.")).toBe("Entrou no LinkedIn");
    expect(textoDeEntrou("Resolva o CAPTCHA no Mercado Livre")).toBe("Entrou no Mercado Livre");
    expect(htmlPedidoDeTela("entrar no Gmail", "a", true)).toContain('data-assumir="1"');
  });

  it("sem miniatura, o Abrir fica sempre à vista", () => {
    expect(htmlLogin({ agenteId: "a", titulo: "entrar no Gmail" })).toContain('class="cb-login-mini sem-imagem"');
    expect(htmlLogin({ agenteId: "a", titulo: "entrar no Gmail", src: "data:image/png;base64,AA" })).toContain('class="cb-login-mini"');
  });
});
