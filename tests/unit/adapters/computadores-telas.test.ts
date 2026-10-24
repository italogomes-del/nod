import { beforeEach, expect, it } from "vitest";
import type { AcaoComputador, DriverComputador, ResultadoComputador } from "../../../src/contracts/computador.ts";
import type { ComputadorDaPessoa, EstadoTelaComputador, TelaComputadorBot } from "../../../src/contracts/computador-motor.ts";
import { criarComputadores, reconciliarTelas } from "../../../src/adapters/fundo/computadores.ts";
import { EsperandoTela } from "../../../src/domain/computador.ts";
import { MARLON } from "../use-cases/deps-l5.ts";

/**
 * NOD-96 PR 4 (ADR-122): o portão no computador da pessoa — uma tela por bot, reserva por tela, a fila da régua quando
 * o supervisor responde esperando_tela, excluir fecha só a tela do bot, ociosidade por tela e a reconciliação com a foto
 * do supervisor. Repositórios em memória do tamanho do que o portão usa (o SQL está em computador-da-pessoa.test.ts).
 */
const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const NOMES: Record<string, string> = { [A]: "Ana Bot", [B]: "Beto Bot" };
const T0 = 1_700_000_000_000;

let agora: number;
let pessoa: ComputadorDaPessoa;
let telas: Map<string, TelaComputadorBot>;
let registros: { id: string; computadorId: string; autor: string; tipo: string; estado: string; motivo?: string | null; agenteId?: string; telaId?: string }[];
let excluidos: Set<string>;
let enviadas: { id: string; acao: AcaoComputador }[];
let paradas: string[];
/** Quantas vezes o supervisor ainda responde esperando_tela (Infinity = nunca abre). */
let semMemoria: number;
let dormiu: number;
/** Roda a cada fatia da espera (o relógio já andou). */
let aoDormir: (() => void | Promise<void>) | null;
/** A ação pendente (aprovação) que executarAprovado lê e o resultado que ela guarda para o turno. */
let pendente: { id: string; computadorId: string; turnoId: string; estado: string; argumentosCifrados: string } | null;
let guardado: string | null;
let iniciados: string[];
/** Turnos que já acabaram (turnoPermitido nega). */
let concluidos: Set<string>;

const tela = (agenteId: string, t: Partial<TelaComputadorBot> = {}): TelaComputadorBot => ({
  id: `tela-${agenteId.slice(-1)}`, computadorId: "pessoa-1", agenteId, estado: "fechada", esperandoDesde: null, controle: "bot", politica: "autonomo",
  ajuda: null, ajudaDecisaoId: null, operacaoId: null, ocupadoAte: null, ultimaAtividadeEm: T0, memoriaMb: null, falhaMotivo: null, criadoEm: 0, ...t,
});
const mudar = (id: string, m: Partial<TelaComputadorBot>) => { const t = telas.get(id); if (t) telas.set(id, { ...t, ...m }); };
const daTelaDo = (agenteId: string) => [...telas.values()].find((t) => t.agenteId === agenteId) ?? null;

const driver: DriverComputador = {
  ambiente: async () => ({ disponivel: true, motivo: null }),
  estado: async () => ({ disponivel: true, ativo: true, motivo: null }),
  iniciar: async (id) => { iniciados.push(id); },
  parar: async (id) => { paradas.push(id); },
  ligados: async () => new Set<string>(),
  executar: async (id, acao): Promise<ResultadoComputador> => {
    enviadas.push({ id, acao });
    if (semMemoria > 0) { semMemoria--; throw new EsperandoTela([B, "nao-e-uuid"]); }
    return { tela: { quadro: "q", imagem: "iVBORw0KGgo=", largura: 1280, altura: 800, url: "https://example.com", titulo: "Exemplo", texto: "ok", abas: [] } };
  },
};

const deps = () => ({
  escopo: MARLON,
  agora: () => agora,
  repos: {
    computadores: {
      obterDaPessoa: async () => pessoa, daPessoa: async () => pessoa, travarDaPessoa: async (id: string) => (id === pessoa.id ? pessoa : null),
      vincularBot: async (_c: string, agenteId: string) => !excluidos.has(agenteId) && agenteId in NOMES,
      registrar: async (r: Omit<(typeof registros)[number], "id">) => { const id = `registro-${registros.length + 1}`; registros.push({ ...r, id }); return { id }; },
      concluir: async (id: string, estado: string, motivo?: string | null) => { const r = registros.find((x) => x.id === id); if (r) { r.estado = estado; r.motivo = motivo ?? null; } },
      registrarSucesso: async () => false,
      registrarFalha: async () => null,
      emUsoPor: async () => ({ titulo: "outra tarefa", deFora: false }),
      atividadeDaTela: async () => [],
      buscarAcao: async (id: string) => (pendente?.id === id ? pendente : null),
      gravarResultado: async (_id: string, cifrado: string) => { guardado = cifrado; },
    },
    computadorTelas: {
      obter: async (_c: string, agenteId: string) => (excluidos.has(agenteId) ? null : daTelaDo(agenteId)),
      buscar: async (_c: string, agenteId: string) => daTelaDo(agenteId),
      travar: async (id: string) => telas.get(id) ?? null,
      doComputador: async () => [...telas.values()].sort((x, y) => y.ultimaAtividadeEm - x.ultimaAtividadeEm),
      fila: async () => [...telas.values()].filter((t) => t.estado === "esperando").sort((x, y) => x.esperandoDesde! - y.esperandoDesde!),
      mudarEstado: async (id: string, estado: EstadoTelaComputador, em: number, de?: readonly EstadoTelaComputador[]) => {
        const t = telas.get(id);
        if (!t || (de && !de.includes(t.estado))) return false;
        mudar(id, { estado, esperandoDesde: estado === "esperando" ? (t.esperandoDesde ?? em) : null });
        return true;
      },
      configurar: async (id: string, c: Partial<TelaComputadorBot> & { atividadeEm?: number }) => {
        const { atividadeEm, ...resto } = c;
        mudar(id, { ...Object.fromEntries(Object.entries(resto).filter(([, v]) => v !== undefined)), ...(atividadeEm !== undefined ? { ultimaAtividadeEm: atividadeEm } : {}) });
      },
      ocupar: async (id: string, operacaoId: string, ate: number) => mudar(id, { operacaoId, ocupadoAte: ate }),
      liberar: async (id: string, operacaoId: string, em?: number) => {
        if (telas.get(id)?.operacaoId === operacaoId) mudar(id, { operacaoId: null, ocupadoAte: null, ...(em !== undefined ? { ultimaAtividadeEm: em } : {}) });
      },
      relatar: async (id: string, r: { memoriaMb: number | null; ultimaAcaoEm: number | null }) => mudar(id, { memoriaMb: r.memoriaMb, ...(r.ultimaAcaoEm ? { ultimaAtividadeEm: r.ultimaAcaoEm } : {}) }),
    },
    turnos: {
      buscar: async (id: string) => ({ id, estado: concluidos.has(id) ? "concluido" : "executando", agenteId: id.endsWith("b") ? B : A, ownerId: MARLON.pessoaId, conversaId: "conversa-1", pararSolicitadoEm: null, motivoInterrupcao: null }),
      contaminado: async () => false,
    },
    agentes: {
      buscar: async (id: string, comExcluido?: boolean) => (id in NOMES && (comExcluido || !excluidos.has(id)) ? { id, nome: NOMES[id], ownerId: MARLON.pessoaId, modoAprovacao: "automatico", excluidoEm: excluidos.has(id) ? T0 : null } : null),
      execucaoBloqueada: async () => false,
    },
    paradas: { ativa: async () => false },
    events: { gravarComOutbox: async () => {} },
  },
});

const computadores = criarComputadores({
  executor: () => "catcher", porPessoa: true, driver, cifrar: (s) => s, decifrar: (s) => s, mudou: () => {}, agora: () => agora,
  dentro: async <T>(_e: unknown, fn: (d: never) => Promise<T>) => fn(deps() as never),
  dormir: async (ms) => { dormiu++; agora += ms; await aoDormir?.(); },
});

const plano = (agenteId: string) => ({
  tenantId: MARLON.tenantId, turnoId: `turno-${agenteId.slice(-1)}`, agenteId, conversaId: "conversa-1", expiraEm: Number.MAX_SAFE_INTEGER, confiancaEntrada: "confiavel",
  autoria: { conta_de_execucao: MARLON.pessoaId },
  catalogo: { ferramentas: [{ nome: "computador_observar", origem: "computador" }, { nome: "computador_navegar", origem: "computador" }] },
}) as never;
const observar = (agenteId: string) => computadores.chamar(MARLON, plano(agenteId), "computador_observar", {});

beforeEach(() => {
  agora = T0;
  pessoa = { id: "pessoa-1", ownerId: MARLON.pessoaId, maquinaId: null, hospedeiraId: null, supervisorPub: null, operacao: null, falhasSeguidas: 0, falhaMotivo: null, indisponivelDesde: null, ultimaAtividadeEm: T0, criadoEm: 0 };
  telas = new Map([tela(A), tela(B)].map((t) => [t.id, t]));
  registros = [];
  excluidos = new Set();
  enviadas = [];
  paradas = [];
  semMemoria = 0;
  dormiu = 0;
  aoDormir = null;
  pendente = null;
  guardado = null;
  iniciados = [];
  concluidos = new Set();
});

it("a ação do bot vai à tela dele; o registro leva o bot e a tela; a tela fica aberta", async () => {
  const r = await observar(A);
  expect(r).toMatchObject({ ok: true });
  expect("isError" in r && r.isError).toBeFalsy();
  expect(enviadas.map((e) => e.id)).toEqual(["tela-a"]);
  expect(registros).toEqual([expect.objectContaining({ computadorId: "pessoa-1", telaId: "tela-a", agenteId: A, autor: "bot", estado: "concluida" })]);
  expect(telas.get("tela-a")).toMatchObject({ estado: "aberta", operacaoId: null, ultimaAtividadeEm: T0 });
  expect(telas.get("tela-b")!.estado).toBe("fechada");
});

it("sem memória para a tela, o bot espera na fila (sem 'Nada foi executado') e a ação sai quando a vez chega", async () => {
  semMemoria = 2;
  const r = await observar(A);
  expect(r).toMatchObject({ ok: true });
  expect("isError" in r && r.isError).toBeFalsy();
  expect(JSON.parse((r as { conteudo: string }).conteudo).tela.url).toBe("https://example.com");
  expect(enviadas).toHaveLength(3);
  expect(dormiu).toBeGreaterThanOrEqual(2);
  expect(telas.get("tela-a")).toMatchObject({ estado: "aberta", esperandoDesde: null, operacaoId: null });
  expect(computadores.esperandoPor("turno-a")).toBeNull();
});

it("passada a janela, o bot recebe 'ainda esperando' com quem usa a máquina, sem erro, e guarda o lugar na fila", async () => {
  semMemoria = Infinity;
  const r = await observar(A);
  expect(r).toMatchObject({ ok: true, confianca: "confiavel" });
  expect("isError" in r && r.isError).toBeFalsy();
  const corpo = JSON.parse((r as { conteudo: string }).conteudo);
  expect(corpo).toMatchObject({ estado: "esperando_tela", quem: ["Beto Bot"] });
  expect(corpo.instrucao).not.toMatch(/Nada foi executado/);
  expect(agora - T0).toBeGreaterThanOrEqual(120_000);
  expect(telas.get("tela-a")).toMatchObject({ estado: "esperando", esperandoDesde: expect.any(Number), operacaoId: null });
  // A espera esgotada é fila, não falha: a Atividade não mostra "falhou/ocupado".
  expect(registros[0]).toMatchObject({ estado: "concluida", motivo: null });
  expect(computadores.esperandoPor("turno-a")).toBe("Beto Bot");
});

it("a fila sai pela ordem de chegada: quem chegou depois espera a primeira, mesmo com memória livre", async () => {
  mudar("tela-b", { estado: "esperando", esperandoDesde: T0 - 1000, ocupadoAte: T0 + 3_600_000, operacaoId: "reserva-b" });
  semMemoria = 1;
  // B segue na frente enquanto a reserva dela vive; na 3ª fatia ela abre e sai da fila, e A tem a vez.
  aoDormir = () => { if (dormiu === 3) mudar("tela-b", { estado: "aberta", esperandoDesde: null, ocupadoAte: null, operacaoId: null }); };
  await observar(A);
  expect(enviadas).toHaveLength(2);
  expect(dormiu).toBe(3);
  expect(telas.get("tela-a")!.estado).toBe("aberta");
});

it("a pessoa não espera: sem tela livre ela recebe estado_invalido na hora e o registro sai falhou/ocupado (nada foi executado)", async () => {
  mudar("tela-a", { controle: "pessoa" });
  semMemoria = Infinity;
  await expect(computadores.humano(MARLON, A, { tipo: "observar" })).rejects.toMatchObject({ codigo: "estado_invalido", cause: "esperando_tela" });
  expect(dormiu).toBe(0);
  expect(registros[0]).toMatchObject({ autor: "pessoa", telaId: "tela-a", estado: "falhou", motivo: "ocupado" });
  expect(registros[0]!.agenteId).toBeUndefined();
});

it("a pessoa assume a tela que espera na fila: assume na hora (sem 'ocupado'), o bot sai da espera e a tela não fica presa em 'esperando'", async () => {
  semMemoria = Infinity;
  let assumiu: Promise<void> | null = null;
  aoDormir = async () => {
    if (dormiu !== 1) return;
    // A espera guarda a reserva da tela; mesmo assim o assumir passa (naFila).
    expect(telas.get("tela-a")).toMatchObject({ estado: "esperando", ocupadoAte: expect.any(Number) });
    assumiu = computadores.configurar(MARLON, A, "assumir");
    await assumiu;
  };
  const r = await observar(A);
  await expect(assumiu).resolves.toBeUndefined();
  expect(r).toMatchObject({ ok: true, isError: true });
  expect(JSON.parse((r as { conteudo: string }).conteudo).erro).not.toBe("esperando_tela");
  expect(dormiu).toBe(1);
  expect(telas.get("tela-a")).toMatchObject({ estado: "fechada", esperandoDesde: null, controle: "pessoa", operacaoId: null, ocupadoAte: null });
  expect(registros.find((x) => x.autor === "pessoa")).toMatchObject({ tipo: "assumir", estado: "concluida" });
});

it("a espera perde a reserva no meio: a tela sai da fila (não segura o FIFO até a ociosidade)", async () => {
  semMemoria = Infinity;
  // Outra reserva tomou a tela (o turno perdeu a dele): aindaPermitido falha e a espera sai com nao_permitido.
  aoDormir = () => { if (dormiu === 2) mudar("tela-a", { operacaoId: "outra", ocupadoAte: agora + 60_000 }); };
  const r = await observar(A);
  expect(r).toMatchObject({ ok: true, isError: true });
  expect(JSON.parse((r as { conteudo: string }).conteudo).erro).toBe("nao_permitido");
  expect(telas.get("tela-a")!.estado).toBe("fechada");
});

it("o turno acaba no meio da espera: a espera sai com nao_permitido e a tela sai da fila", async () => {
  semMemoria = Infinity;
  aoDormir = () => { if (dormiu === 2) concluidos.add("turno-a"); };
  const r = await observar(A);
  expect(r).toMatchObject({ ok: true, isError: true });
  expect(JSON.parse((r as { conteudo: string }).conteudo).erro).toBe("nao_permitido");
  expect(dormiu).toBe(2);
  expect(telas.get("tela-a")).toMatchObject({ estado: "fechada", esperandoDesde: null, operacaoId: null, ocupadoAte: null });
  expect(registros[0]).toMatchObject({ autor: "bot", estado: "falhou" });
});

it("parar e iniciar no modo tela: parar fecha só a tela do bot (fechando → driver.parar → fechada) e iniciar devolve o controle ao bot", async () => {
  mudar("tela-a", { estado: "aberta" });
  mudar("tela-b", { estado: "aberta" });
  const estados: string[] = [];
  const pararOriginal = driver.parar;
  driver.parar = async (id) => { estados.push(telas.get(id)!.estado); await pararOriginal(id); };
  try {
    await computadores.configurar(MARLON, A, "parar");
  } finally {
    driver.parar = pararOriginal;
  }
  expect(estados).toEqual(["fechando"]);
  expect(paradas).toEqual(["tela-a"]);
  expect(telas.get("tela-a")).toMatchObject({ estado: "fechada", controle: "pessoa" });
  expect(telas.get("tela-b")).toMatchObject({ estado: "aberta", controle: "bot" });
  expect(registros.at(-1)).toMatchObject({ autor: "pessoa", tipo: "parar", telaId: "tela-a", estado: "concluida" });

  agora += 1000;
  await computadores.configurar(MARLON, A, "iniciar");
  expect(iniciados).toEqual(["tela-a"]);
  expect(telas.get("tela-a")).toMatchObject({ controle: "bot", operacaoId: null, ocupadoAte: null, ultimaAtividadeEm: agora });
  expect(registros.at(-1)).toMatchObject({ autor: "pessoa", tipo: "iniciar", estado: "concluida" });
});

it("ação aprovada que esgota a espera: guarda 'ainda esperando' para o turno, responde estado_invalido(esperando_tela), sai falhou/ocupado e a tela sai da fila", async () => {
  semMemoria = Infinity;
  pendente = { id: "acao-1", computadorId: "pessoa-1", turnoId: "turno-a", estado: "pendente", argumentosCifrados: JSON.stringify({ tipo: "navegar", url: "https://example.com" }) };
  // O registro pendente é o da aprovação: executar o reaproveita (executando → estado final).
  registros.push({ id: "acao-1", computadorId: "pessoa-1", autor: "bot", tipo: "navegar", estado: "pendente", agenteId: A, telaId: "tela-a" });
  await expect(computadores.executarAprovado({ ...MARLON, agenteId: A, turnoId: "turno-a", acaoId: "acao-1" })).rejects.toMatchObject({ codigo: "estado_invalido", cause: "esperando_tela" });
  expect(JSON.parse(guardado!)).toMatchObject({ estado: "esperando_tela", quem: ["Beto Bot"] });
  expect(enviadas[0]!.acao).toMatchObject({ tipo: "navegar" });
  expect(agora - T0).toBeGreaterThanOrEqual(120_000);
  // A ação aprovada não volta à fila sozinha: a tela não fica presa em 'esperando'.
  expect(telas.get("tela-a")).toMatchObject({ estado: "fechada", esperandoDesde: null, operacaoId: null });
  expect(registros).toEqual([expect.objectContaining({ id: "acao-1", estado: "falhou", motivo: "ocupado" })]);
});

it("a reserva é por tela: a tela de A ocupada não segura a de B", async () => {
  mudar("tela-a", { operacaoId: "outra", ocupadoAte: T0 + 60_000 });
  const ra = await observar(A);
  expect(JSON.parse((ra as { conteudo: string }).conteudo).erro).toBe("computador_ocupado");
  const rb = await observar(B);
  expect("isError" in rb && rb.isError).toBeFalsy();
  expect(enviadas.map((e) => e.id)).toEqual(["tela-b"]);
});

it("excluir o bot fecha só a tela dele; a máquina e a outra tela seguem", async () => {
  mudar("tela-a", { estado: "aberta" });
  mudar("tela-b", { estado: "aberta" });
  excluidos.add(A);
  await computadores.desligarExcluido(MARLON, A);
  expect(paradas).toEqual(["tela-a"]);
  expect(telas.get("tela-a")).toMatchObject({ estado: "fechada", controle: "pessoa" });
  expect(telas.get("tela-b")).toMatchObject({ estado: "aberta", controle: "bot" });
});

it("ociosidade: fecha a tela parada há 15 min; a máquina só dorme quando nenhuma tela a segura", async () => {
  const limite = 15 * 60_000;
  agora = T0 + limite + 1;
  mudar("tela-a", { estado: "aberta", ultimaAtividadeEm: T0 - 1 });
  mudar("tela-b", { estado: "aberta", ultimaAtividadeEm: agora - 60_000 });
  expect(await computadores.desligarOciosos(MARLON, new Set(["pessoa-1", "tela-a", "tela-b"]), limite)).toBe(1);
  expect(paradas).toEqual(["tela-a"]);
  expect(telas.get("tela-a")).toMatchObject({ estado: "fechada", operacaoId: null });

  // B também parou: fecha a tela e a máquina dorme.
  agora += limite;
  paradas = [];
  expect(await computadores.desligarOciosos(MARLON, new Set(["pessoa-1", "tela-b"]), limite)).toBe(2);
  expect(paradas).toEqual(["tela-b", "pessoa-1"]);

  // Tela com a pessoa segura a máquina ligada.
  paradas = [];
  mudar("tela-a", { estado: "aberta", controle: "pessoa", ultimaAtividadeEm: T0 });
  expect(await computadores.desligarOciosos(MARLON, new Set(["pessoa-1", "tela-a"]), limite)).toBe(0);
  expect(paradas).toEqual([]);
});

it("ociosidade: tela que esperou na fila além do limite sem reserva viva sai da fila", async () => {
  const limite = 15 * 60_000;
  agora = T0 + limite + 1;
  mudar("tela-a", { estado: "esperando", esperandoDesde: T0 - 1 });
  await computadores.desligarOciosos(MARLON, new Set(["pessoa-1"]), limite);
  expect(telas.get("tela-a")).toMatchObject({ estado: "fechada", esperandoDesde: null });
});

it("reconciliar: o banco segue a foto do supervisor; 'esperando' do servidor não cai com o fechada dele", async () => {
  mudar("tela-a", { estado: "abrindo" });
  mudar("tela-b", { estado: "esperando", esperandoDesde: T0 });
  await reconciliarTelas(deps() as never, "pessoa-1", { computadorId: "pessoa-1", ligado: true, supervisorPub: "x", telas: [
    { agenteId: A, estado: "aberta", memoriaMb: 420, ultimaAcaoEm: T0 + 5000 },
    { agenteId: B, estado: "fechada", memoriaMb: null, ultimaAcaoEm: null },
    { agenteId: "bot-de-outra-pessoa", estado: "aberta", memoriaMb: 1, ultimaAcaoEm: null },
  ] });
  expect(telas.get("tela-a")).toMatchObject({ estado: "aberta", memoriaMb: 420, ultimaAtividadeEm: T0 + 5000 });
  expect(telas.get("tela-b")!.estado).toBe("esperando");

  // Máquina desligada: as telas abertas ficam fechadas; a fila fica.
  await reconciliarTelas(deps() as never, "pessoa-1", { computadorId: "pessoa-1", ligado: false, supervisorPub: "x", telas: [] });
  expect(telas.get("tela-a")!.estado).toBe("fechada");
  expect(telas.get("tela-b")!.estado).toBe("esperando");
});
