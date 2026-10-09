import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { describe, expect, it, vi } from "vitest";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { AnuncioMaquina } from "../../src/contracts/ponte.ts";
import { VERSAO_MINIMA_APP, type PonteInternaNod } from "../../src/adapters/fundo/ponte-interna.ts";
import { criarPonteHttpServidor } from "../../src/adapters/http/rotas/ponte.ts";
import { criarPonteHttp, urlServidor } from "../../src/adapters/executor/ponte-http.ts";
import { versaoAceita } from "../../src/domain/versao-app.ts";
import { entrega, falas, inventario, memoria, sinais, trechos } from "../../src/adapters/http/rotas/ponte-validacao.ts";
import { TEXTO_ENTREGA_MAX_CHARS } from "../../src/shared/constantes.ts";

describe("desktop: fronteiras HTTP", () => {
  it("só aceita HTTPS sem credenciais ou caminhos; loopback exige opção de desenvolvimento", () => {
    expect(urlServidor("https://nod.example")).toBe("https://nod.example");
    for (const u of ["http://nod.example", "http://127.0.0.1:8888", "https://user:secret@nod.example", "file:///tmp/a", "https://nod.example/api", "https://nod.example/?token=x"]) expect(() => urlServidor(u)).toThrow();
    expect(urlServidor("http://127.0.0.1:8888", true)).toBe("http://127.0.0.1:8888");
  });
  it("compara versões numericamente e recusa entradas malformadas", () => {
    expect(versaoAceita("0.10.0", "0.2.0")).toBe(true);
    for (const v of [undefined, ["0.2.0"], "0.1.9", "0.2.0-beta", "wat"]) expect(versaoAceita(v, "0.2.0")).toBe(false);
  });
  it("manda só bearer da máquina e versão, recusa redirect, nunca Origin", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ plano: null }), { headers: { "x-nod-versao-minima": "0.1.0" } }));
    const c = criarPonteHttp({ url: "https://nod.example", chave: "test-only", versao: "0.1.0", fetchImpl: f });
    expect(await c.ponte.puxar("id-ignorado")).toBeNull();
    expect(f).toHaveBeenCalledWith("https://nod.example/api/maquina/puxar", expect.objectContaining({ redirect: "error", body: "{}", headers: { authorization: "Bearer test-only", "content-type": "application/json", "x-nod-versao": "0.1.0" } }));
  });
  it.each([401, 426, 503])("renovação que falha (%i) manda abortar o CLI", async (status) => {
    const c = criarPonteHttp({ url: "https://nod.example", chave: "test", versao: "0.1.0", fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(new Response("", { status })) });
    expect((await c.ponte.renovar({ turnoId: "x", machineId: "y", sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false }, eventos: [] })).ativo).toBe(false);
  });
  it("não confia no relógio nem em prosa do inventário remoto", () => {
    expect(inventario({ estado: "ausente", em: Infinity, motivo: "segredo" }, 100)).toEqual({ estado: "ausente", em: 100, motivo: "Harness não encontrado neste computador" });
    expect(() => sinais({ attempted: "true" })).toThrow();
    // NOD-178: a causa conhecida atravessa, com a frase do servidor; causa desconhecida é descartada.
    expect(inventario({ estado: "nao_autenticado", em: 1, motivo: "segredo", causa: "sonda_lenta" }, 100)).toEqual({ estado: "nao_autenticado", em: 100, motivo: "O harness demorou para responder; o Mac está carregado. Tente de novo em instantes.", causa: "sonda_lenta" });
    // Anunciado por harness, a frase diz quem demorou.
    expect(inventario({ estado: "ausente", em: 1, motivo: "Instale", causa: "sonda_lenta" }, 100, "Codex")).toEqual({ estado: "ausente", em: 100, motivo: "O Codex demorou para responder; o Mac está carregado. Tente de novo em instantes.", causa: "sonda_lenta" });
    expect(inventario({ estado: "ausente", em: 1, motivo: "x", causa: "inventada" }, 100)).toEqual({ estado: "ausente", em: 100, motivo: "Harness não encontrado neste computador" });
    // NOD-171: cli_antigo atravessa com as versões no formato x.y.z[-pre]; a frase é do servidor, nunca do Mac.
    expect(inventario({ estado: "ausente", em: 1, motivo: "texto do Mac", causa: "cli_antigo", versao: "0.158.9", minima: "0.159.0" }, 100, "Codex")).toEqual({ estado: "ausente", em: 100, causa: "cli_antigo", versao: "0.158.9", minima: "0.159.0", motivo: "O Codex deste Mac (0.158.9) é mais antigo que o testado pelo nod. Atualize para a versão 0.159.0 ou mais nova." });
    for (const versao of [undefined, "", "2.1", "<script>", "1.2.3 (Claude Code)", 3]) {
      expect(inventario({ estado: "ausente", em: 1, causa: "cli_antigo", versao, minima: "2.1.290" }, 100)).toEqual({ estado: "ausente", em: 100, motivo: "Harness não encontrado neste computador" });
    }
    expect(inventario({ estado: "nao_autenticado", em: 1, causa: "cli_antigo", versao: "2.1.1", minima: "2.1.290" }, 100)).toEqual({ estado: "nao_autenticado", em: 100, motivo: "Entre na conta do harness neste computador" });
    expect(() => entrega({ resultado: { desfecho: "inventado" }, fala: {}, seqLocal: -1 }, "x")).toThrow();
  });
  it("conta sem acesso (2026-10-05): a causa é código fechado, a frase é do servidor, e o erro cru atravessa só até o teto", () => {
    expect(inventario({ estado: "nao_autenticado", causa: "conta_sem_acesso", motivo: "texto do Mac", versao: "9" }, 7)).toEqual({ estado: "nao_autenticado", causa: "conta_sem_acesso", motivo: "A conta entrou, mas está sem acesso: a organização dela desativou o uso por assinatura.", em: 7 });
    // App antigo (sem o campo) ou valor inventado: sem causa, com a frase de sempre.
    for (const causa of [undefined, "porque sim", 3, ["conta_sem_acesso"]]) expect(inventario({ estado: "nao_autenticado", causa }, 7)).toEqual({ estado: "nao_autenticado", motivo: "Entre na conta do harness neste computador", em: 7 });
    // A causa não muda uma IA pronta.
    expect(inventario({ estado: "pronto", versao: "1", causa: "conta_sem_acesso" }, 7)).toEqual({ estado: "pronto", versao: "1", em: 7 });

    const base = { turnoId: "11111111-1111-4111-8111-111111111111", seqLocal: 1, fala: { tipo: "texto", texto: "" } };
    const resultado = { desfecho: "falha", motivoFalha: "nao_autenticado", texto: "", sessaoCli: null, custoUsd: null, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
    const ok = entrega({ ...base, resultado: { ...resultado, causaSemIa: "conta_sem_acesso", erroCru: "success | Your organization has disabled…" } }, "maq");
    expect(ok.resultado).toMatchObject({ causaSemIa: "conta_sem_acesso", erroCru: "success | Your organization has disabled…", motivoFalha: "nao_autenticado" });
    const estranho = entrega({ ...base, resultado: { ...resultado, causaSemIa: "inventada", erroCru: "x".repeat(8_001) } }, "maq").resultado;
    expect("causaSemIa" in estranho).toBe(false);
    expect("erroCru" in estranho).toBe(false);
    expect("erroCru" in entrega({ ...base, resultado: { ...resultado, erroCru: { texto: "objeto" } } }, "maq").resultado).toBe(false);
  });
  it("NOD-179: o uso do plano atravessa validado; fora do formato some e a entrega é aceita", () => {
    const agora = Date.UTC(2026, 9, 6, 12);
    const base = { turnoId: "11111111-1111-4111-8111-111111111111", seqLocal: 1, fala: { tipo: "texto", texto: "ok" } };
    const resultado = { desfecho: "sucesso", texto: "ok", sessaoCli: null, custoUsd: null, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
    const usoDoPlano = { harness: "claude-cli", situacao: "normal", cincoHoras: { utilizacao: 0.1, renovaEm: agora + 3_600_000 }, semana: null, medidoEm: agora - 1000 };
    expect(entrega({ ...base, resultado: { ...resultado, usoDoPlano } }, "maq", agora).resultado.usoDoPlano).toEqual(usoDoPlano);
    for (const utilizacao of [Number.NaN, -1, 5]) {
      const r = entrega({ ...base, resultado: { ...resultado, usoDoPlano: { ...usoDoPlano, cincoHoras: { utilizacao, renovaEm: null } } } }, "maq", agora).resultado;
      expect(r.desfecho).toBe("sucesso");
      expect("usoDoPlano" in r).toBe(false);
    }
    expect("usoDoPlano" in entrega({ ...base, resultado }, "maq", agora).resultado).toBe(false);
  });
  it("NOD-171: limite_do_plano atravessa com a hora em que volta; hora absurda, ou sem o limite, some", () => {
    const agora = Date.UTC(2026, 9, 6, 12);
    const base = { turnoId: "11111111-1111-4111-8111-111111111111", seqLocal: 1, fala: { tipo: "texto", texto: "" } };
    const resultado = { desfecho: "falha", motivoFalha: "limite_do_plano", texto: "", sessaoCli: null, custoUsd: null, sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false }, tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [] };
    const voltaEm = agora + 3_600_000;
    expect(entrega({ ...base, resultado: { ...resultado, limiteVoltaEm: voltaEm } }, "maq", agora).resultado).toMatchObject({ motivoFalha: "limite_do_plano", limiteVoltaEm: voltaEm });
    for (const ruim of [agora + 40 * 86_400_000, -1, 1.5, "amanhã", null]) {
      const r = entrega({ ...base, resultado: { ...resultado, limiteVoltaEm: ruim } }, "maq", agora).resultado;
      expect(r.motivoFalha).toBe("limite_do_plano");
      expect("limiteVoltaEm" in r).toBe(false);
    }
    expect("limiteVoltaEm" in entrega({ ...base, resultado: { ...resultado, motivoFalha: "erro_execucao", limiteVoltaEm: voltaEm } }, "maq", agora).resultado).toBe(false);
  });
  it("renovação leva texto e ferramentas NA ORDEM, juntando texto seguido, esvazia a fila e não mistura turnos", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ativo: true, versaoMinimaApp: "0.1.0" })));
    const c = criarPonteHttp({ url: "https://nod.example", chave: "k", versao: "0.1.0", fetchImpl: f });
    c.delta("x", "Próximo "); c.delta("x", "lote."); c.ferramenta("x", "mcp__nod__gmail__search_threads"); c.delta("x", "44 processados.");
    c.delta("outro", "de outro turno");
    const pedido = { turnoId: "x", machineId: "y", sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, eventos: [] };
    await c.ponte.renovar(pedido);
    expect(JSON.parse(String(f.mock.calls[0]?.[1]?.body)).trechos).toEqual([{ texto: "Próximo lote." }, { ferramenta: "mcp__nod__gmail__search_threads" }, { texto: "44 processados." }]);
    await c.ponte.renovar(pedido);
    expect(JSON.parse(String(f.mock.calls[1]?.[1]?.body)).trechos).toEqual([]);
    // Pool de laços: cada turno renova só o próprio texto.
    await c.ponte.renovar({ ...pedido, turnoId: "outro" });
    expect(JSON.parse(String(f.mock.calls[2]?.[1]?.body)).trechos).toEqual([{ texto: "de outro turno" }]);
  });
  it("vigia (NOD-73): o aviso novo substitui o que ainda não saiu; o servidor só aceita nome e números", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ativo: true, versaoMinimaApp: "0.1.0" })));
    const c = criarPonteHttp({ url: "https://nod.example", chave: "k", versao: "0.1.0", fetchImpl: f });
    c.delta("x", "oi"); c.vigia("x", { mudoMs: 600_000, emFundo: 0 }); c.vigia("x", { mudoMs: 1_200_000, aberta: "Bash", emFundo: 1 });
    await c.ponte.renovar({ turnoId: "x", machineId: "y", sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, eventos: [] });
    expect(JSON.parse(String(f.mock.calls[0]?.[1]?.body)).trechos).toEqual([{ texto: "oi" }, { vigia: { mudoMs: 1_200_000, aberta: "Bash", emFundo: 1 } }]);

    const valido = { mudoMs: 600_000, aberta: "mcp__nod__gmail__search_threads", emFundo: 2, repeticao: { nome: "Bash", vezes: 10 } };
    expect(trechos([{ vigia: valido }])).toEqual([{ vigia: valido }]);
    expect(trechos([{ vigia: { mudoMs: 0, emFundo: 0 } }])).toEqual([{ vigia: { mudoMs: 0, emFundo: 0 } }]);
    // Estrito: campo a mais (argumento), nome fora do formato, limiar inventado ou número fora da faixa somem.
    expect(trechos([
      { vigia: { ...valido, input: { command: "cat .env" } } },
      { vigia: { ...valido, repeticao: { nome: "Bash", vezes: 10, input: "x" } } },
      { vigia: { ...valido, aberta: "rm -rf /" } },
      { vigia: { ...valido, repeticao: { nome: "Bash", vezes: 7 } } },
      { vigia: { mudoMs: -1, emFundo: 0 } },
      { vigia: { mudoMs: 1.5, emFundo: 0 } },
      { vigia: { mudoMs: 0, emFundo: 1001 } },
      { vigia: "x" },
      { texto: "ok" },
    ])).toEqual([{ texto: "ok" }]);
  });
  it("fila acima de 16k de texto descarta o mais antigo", async () => {
    const f = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ ativo: true, versaoMinimaApp: "0.1.0" })));
    const c = criarPonteHttp({ url: "https://nod.example", chave: "k", versao: "0.1.0", fetchImpl: f });
    c.delta("x", "a".repeat(10_000)); c.ferramenta("x", "Bash"); c.delta("x", "b".repeat(10_000));
    await c.ponte.renovar({ turnoId: "x", machineId: "y", sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true }, eventos: [] });
    const enviados = JSON.parse(String(f.mock.calls[0]?.[1]?.body)).trechos as { texto?: string }[];
    expect(enviados.reduce((n, t) => n + (t.texto?.length ?? 0), 0)).toBe(16_000);
    expect(enviados.at(-1)?.texto).toBe("b".repeat(10_000));
  });
  it("ADR-085: a leitura de memória aceita o processador (opcional); fora do formato ele é ignorado, não a leitura toda (revisão do #209)", () => {
    expect(memoria({ nivel: "verde", totalMb: 10, porTurno: [] })).toEqual({ nivel: "verde", totalMb: 10, porTurno: [] });
    expect(memoria({ nivel: "verde", totalMb: 10, porTurno: [], processador: { nivel: "amarela", carga: 0.8 } })).toEqual({ nivel: "verde", totalMb: 10, porTurno: [], processador: { nivel: "amarela", carga: 0.8 } });
    for (const processador of [{ nivel: "laranja", carga: 1 }, { nivel: "verde", carga: -1 }, { nivel: "verde", carga: 5000 }, { nivel: "verde" }, "alto", null]) {
      expect(memoria({ nivel: "verde", totalMb: 10, porTurno: [], processador })).toEqual({ nivel: "verde", totalMb: 10, porTurno: [] });
    }
    expect(() => memoria({ nivel: "laranja", totalMb: 10, porTurno: [] })).toThrow();
  });

  it("servidor: trecho fora do formato cai sozinho; acima do teto, nada passa", () => {
    expect(trechos([{ texto: "oi" }, { ferramenta: "mcp__nod__x" }, { ferramenta: "rm -rf /" }, { texto: "a", ferramenta: "b" }, 3])).toEqual([{ texto: "oi" }, { ferramenta: "mcp__nod__x" }]);
    expect(trechos([{ texto: "a".repeat(9_000) }, { texto: "b".repeat(9_000) }])).toEqual([]);
    expect(trechos("texto")).toEqual([]);
  });
  it("servidor: a lista de tarefas do bot passa validada; fora do formato ou acima de 50, o trecho some", () => {
    const tarefas = [{ id: "1", titulo: "Ler o diff", estado: "feita" }, { id: "2", titulo: "Checar SQL", estado: "andamento" }];
    expect(trechos([{ tarefas }])).toEqual([{ tarefas }]);
    expect(trechos([{ tarefas: [{ id: "1", titulo: "x", estado: "concluida" }] }, { texto: "ok" }])).toEqual([{ texto: "ok" }]);
    expect(trechos([{ tarefas: Array.from({ length: 51 }, (_, i) => ({ id: String(i), titulo: "t", estado: "pendente" })) }])).toEqual([]);
  });
  it("ADR-067: falas da sessão viva — seq inteiro ≥ 1 e texto dentro do teto; fora do formato a renovação é recusada (o executor reenvia)", () => {
    expect(falas(undefined)).toEqual([]);
    expect(falas([{ seq: 1, texto: "Disparei os testes." }, { seq: 2, texto: "Verdes." }])).toEqual([{ seq: 1, texto: "Disparei os testes." }, { seq: 2, texto: "Verdes." }]);
    for (const ruim of [[{ seq: 0, texto: "x" }], [{ seq: 1.5, texto: "x" }], [{ seq: 1 }], [{ seq: 1, texto: "x".repeat(TEXTO_ENTREGA_MAX_CHARS + 1) }], "x", Array.from({ length: 51 }, (_, i) => ({ seq: i + 1, texto: "t" }))]) {
      expect(() => falas(ruim), JSON.stringify(ruim).slice(0, 60)).toThrow();
    }
  });
});

describe("NOD-175: ponte do servidor na drenagem", () => {
  const escopo = { tenantId: "00000000-0000-4000-8000-000000000001", pessoaId: "00000000-0000-4000-8000-000000000002" };
  const LONGPOLL_MS = 2_000;
  const plano = { turnoId: "00000000-0000-4000-8000-000000000003" } as PlanoTurno;

  function montar(puxar: PonteInternaNod["puxar"]) {
    const ponte: PonteInternaNod = { conectar: async () => undefined, puxar, renovar: async () => ({ ativo: true, versaoMinimaApp: VERSAO_MINIMA_APP }), entregar: async () => undefined, desconectar: async () => undefined, maquinasConectadas: () => [], escopoDoTurno: () => null };
    const p = criarPonteHttpServidor({
      criar: () => ponte, persistir: async () => undefined, autorizar: async () => ({ ...escopo, chaveId: "m1" }),
      segredo: "s", seguro: false, agora: () => Date.now(), delta: () => undefined, ferramenta: () => undefined, tarefas: () => undefined, longpollMs: LONGPOLL_MS,
    });
    const chamar = async (nome: string, corpo: unknown = {}) => {
      const rota = p.rotas.find((r) => r.padrao.test(`/${nome}`));
      let resposta: { status: number; body: unknown } | null = null;
      const req = new IncomingMessage(new Socket());
      req.headers = { authorization: "Bearer k", "x-nod-versao": VERSAO_MINIMA_APP };
      await rota!.handler({ req, res: new ServerResponse(req), escopo, params: { chaveId: "m1" }, corpo: async () => corpo, json: (status, body) => { resposta = { status, body }; } });
      return resposta!;
    };
    return { p, chamar };
  }
  const conectar = { versaoContrato: 1, nome: "Mac", inventario: { estado: "pronto", versao: "fake", em: 0 } };

  it("reserva em voo quando a drenagem começa: o plano é entregue e reservasEmVoo volta de 1 a 0", async () => {
    let soltar: (p: PlanoTurno) => void = () => undefined;
    const { p, chamar } = montar(() => new Promise((r) => { soltar = r; }));
    await chamar("conectar", conectar);
    const puxando = chamar("puxar");
    await vi.waitFor(() => expect(p.reservasEmVoo()).toBe(1));
    p.iniciarDrenagem();
    soltar(plano);
    expect(await puxando).toEqual({ status: 200, body: { plano } });
    expect(p.reservasEmVoo()).toBe(0);
  });

  it("ADR-085: o puxar leva a leitura do Mac (com o processador) até a ponte; app antigo manda {} e a ponte recebe undefined", async () => {
    const puxar = vi.fn<PonteInternaNod["puxar"]>().mockResolvedValue(plano);
    const { chamar } = montar(puxar);
    await chamar("conectar", conectar);
    const leitura = { nivel: "verde", totalMb: 900, porTurno: [], processador: { nivel: "vermelha", carga: 1.4 } };
    await chamar("puxar", { memoria: leitura });
    expect(puxar).toHaveBeenLastCalledWith(escopo.pessoaId, leitura);
    await chamar("puxar", {});
    expect(puxar).toHaveBeenLastCalledWith(escopo.pessoaId, undefined);
  });

  it("revisão do #209: leitura com defeito no puxar vai como 'sem leitura' (nunca 400); a leitura entra uma vez por pedido, não a cada volta da espera", async () => {
    const puxar = vi.fn<PonteInternaNod["puxar"]>().mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValue(plano);
    const { chamar } = montar(puxar);
    await chamar("conectar", conectar);
    const leitura = { nivel: "amarela", totalMb: 900, porTurno: [] };
    expect(await chamar("puxar", { memoria: leitura })).toEqual({ status: 200, body: { plano } });
    expect(puxar.mock.calls.map((c) => c[1])).toEqual([leitura, undefined, undefined]);
    puxar.mockClear();
    expect(await chamar("puxar", { memoria: { nivel: "laranja" } })).toEqual({ status: 200, body: { plano } });
    expect(puxar).toHaveBeenLastCalledWith(escopo.pessoaId, undefined);
  });

  it("drenando: o puxar volta {plano:null} na hora, sem chamar a ponte; drenagem no meio do long-poll também corta a espera", async () => {
    const puxar = vi.fn<PonteInternaNod["puxar"]>().mockResolvedValue(null);
    const { p, chamar } = montar(puxar);
    await chamar("conectar", conectar);
    const esperando = chamar("puxar");
    await vi.waitFor(() => expect(puxar).toHaveBeenCalled());
    const inicio = Date.now();
    p.iniciarDrenagem();
    expect(await esperando).toEqual({ status: 200, body: { plano: null } });
    // NOD-194: o que importa é não ter esperado o long-poll; afirmado contra ele, não contra um número mágico.
    expect(Date.now() - inicio).toBeLessThan(LONGPOLL_MS / 2);
    puxar.mockClear();
    expect(await chamar("puxar")).toEqual({ status: 200, body: { plano: null } });
    expect(puxar).not.toHaveBeenCalled();
    expect(p.reservasEmVoo()).toBe(0);
  });
});

describe("NOD-167: Codex sem app-server no anúncio do Mac", () => {
  const escopo = { tenantId: "00000000-0000-4000-8000-000000000001", pessoaId: "00000000-0000-4000-8000-000000000002" };
  function montar() {
    const maquinas = new Map<string, AnuncioMaquina>();
    const ponte: PonteInternaNod = { conectar: async (m) => { maquinas.set(m.machineId, m); }, puxar: async () => null, renovar: async () => ({ ativo: true, versaoMinimaApp: VERSAO_MINIMA_APP }), entregar: async () => undefined, desconectar: async () => undefined, maquinasConectadas: () => [...maquinas.values()], escopoDoTurno: () => null };
    const p = criarPonteHttpServidor({
      criar: () => ponte, persistir: async () => undefined, autorizar: async () => ({ ...escopo, chaveId: "m1" }),
      segredo: "s", seguro: false, agora: () => Date.now(), delta: () => undefined, ferramenta: () => undefined, tarefas: () => undefined, longpollMs: 2_000,
    });
    const conectar = async (corpo: unknown) => {
      const rota = p.rotas.find((r) => r.padrao.test("/conectar"));
      const req = new IncomingMessage(new Socket());
      req.headers = { authorization: "Bearer k", "x-nod-versao": VERSAO_MINIMA_APP };
      await rota!.handler({ req, res: new ServerResponse(req), escopo, params: { chaveId: "m1" }, corpo: async () => corpo, json: () => undefined });
    };
    return { p, maquinas, conectar };
  }
  const pronto = { estado: "pronto", versao: "fake", em: 0 };
  const base = { versaoContrato: 1, nome: "Mac", inventario: pronto, ligacao: true };

  it("o Codex pronto anunciado sem app-server recusa; app antigo (sem o campo), lixo no campo ou Codex fora não recusam", async () => {
    const { p, maquinas, conectar } = montar();
    await conectar({ ...base, harnesses: { "claude-cli": pronto, "codex-cli": pronto }, semLacoDeVoz: ["codex-cli", "hermes", 7, "__proto__"] });
    expect(maquinas.get("m1")?.semLacoDeVoz).toEqual(["codex-cli"]);
    expect(p.semLacoDeVozDaPessoa(escopo.pessoaId, "codex-cli")).toBe(true);
    expect(p.semLacoDeVozDaPessoa(escopo.pessoaId, "claude-cli")).toBe(false);
    expect(p.semLacoDeVozDaPessoa("outra-pessoa", "codex-cli")).toBe(false);

    await conectar({ ...base, harnesses: { "claude-cli": pronto, "codex-cli": pronto } });
    expect(maquinas.get("m1")?.semLacoDeVoz).toBeUndefined();
    expect(p.semLacoDeVozDaPessoa(escopo.pessoaId, "codex-cli")).toBe(false);

    await conectar({ ...base, harnesses: { "claude-cli": pronto, "codex-cli": pronto }, semLacoDeVoz: "codex-cli" });
    expect(p.semLacoDeVozDaPessoa(escopo.pessoaId, "codex-cli")).toBe(false);

    // Codex não pronto: a recusa é a de sempre (sem_ia), não esta.
    await conectar({ ...base, harnesses: { "claude-cli": pronto, "codex-cli": { estado: "ausente", motivo: "x", em: 0 } }, semLacoDeVoz: ["codex-cli"] });
    expect(p.semLacoDeVozDaPessoa(escopo.pessoaId, "codex-cli")).toBe(false);
  });

  /** Revisão do épico #188 (S15, 2026-10-08): o anúncio das capacidades chega à ponte só com chaves e harnesses conhecidos. */
  it("S15: as capacidades anunciadas chegam à ponte; ausentes ou lixo, o anúncio sai sem elas", async () => {
    const { maquinas, conectar } = montar();
    await conectar({ ...base, harnesses: { "claude-cli": pronto }, capacidades: { "claude-cli": { bifurcaSessao: true, retomaSessao: "sim", inventada: true }, hermes: { bifurcaSessao: true }, __proto__: { x: 1 } } });
    expect(maquinas.get("m1")?.capacidades).toEqual({ "claude-cli": { mensagemNoMeio: false, retomaSessao: false, bifurcaSessao: true, processoProprio: false, terminal: false } });
    await conectar({ ...base, harnesses: { "claude-cli": pronto } });
    expect(maquinas.get("m1")?.capacidades).toBeUndefined();
    await conectar({ ...base, harnesses: { "claude-cli": pronto }, capacidades: ["claude-cli"] });
    expect(maquinas.get("m1")?.capacidades).toBeUndefined();
  });
});
