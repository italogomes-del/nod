import type { LugarDoComputador } from "../../../src/contracts/computador.ts";
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
/** NOD-96 PR 5: o que o driver.operar faz (resolve, rejeita ou segura) e os avisos no chat. */
let operar: (tipo: string) => Promise<{ supervisorPub?: string }>;
let operacoes: string[];
let avisos: { conversaId: string; texto: string; payload: unknown }[];
let perfisApagados: string[];
let supervisor: { trocado: string | null; esquecido: boolean };
/** Roda a cada fatia da espera (o relógio já andou). */
let aoDormir: (() => void | Promise<void>) | null;
/** A ação pendente (aprovação) que executarAprovado lê e o resultado que ela guarda para o turno. */
let pendente: { id: string; computadorId: string; turnoId: string; estado: string; argumentosCifrados: string } | null;
let guardado: string | null;
let iniciados: string[];
/** Turnos que já acabaram (turnoPermitido nega). */
let concluidos: Set<string>;
let lugarPedidoNaCriacao: string | null;

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
  operar: async (_id, tipo) => { operacoes.push(tipo); return operar(tipo); },
  apagarPerfil: async (id, agenteId) => { perfisApagados.push(`${id}:${agenteId}`); },
  maquinaDoComputador: async () => ({ id: "maq-1", nome: "Servidor de casa", contato: T0, foto: { ligadoDesde: T0 - 60_000, memoriaTotalMb: 8000, titulos: { [A]: "Gmail" } } }),
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
      obterDaPessoa: async (maquinaId: string | null = null) => { lugarPedidoNaCriacao = maquinaId; return pessoa; }, daPessoa: async () => pessoa, travarDaPessoa: async (id: string) => (id === pessoa.id ? pessoa : null),
      vincularBot: async (_c: string, agenteId: string) => !excluidos.has(agenteId) && agenteId in NOMES,
      registrar: async (r: Omit<(typeof registros)[number], "id">) => { const id = `registro-${registros.length + 1}`; registros.push({ ...r, id }); return { id }; },
      concluir: async (id: string, estado: string, motivo?: string | null) => { const r = registros.find((x) => x.id === id); if (r) { r.estado = estado; r.motivo = motivo ?? null; } },
      registrarSucesso: async () => false,
      registrarFalha: async () => null,
      emUsoPor: async () => ({ titulo: "outra tarefa", deFora: false }),
      atividadeDaTela: async () => [],
      iniciarOperacao: async (_id: string, tipo: "atualizar", em: number) => { if (pessoa.operacao) return false; pessoa = { ...pessoa, operacao: { tipo, progresso: 0, etapa: null, desde: em } }; return true; },
      terminarOperacao: async (_id: string, tipo: string) => { if (pessoa.operacao?.tipo !== tipo) return false; pessoa = { ...pessoa, operacao: null }; return true; },
      trocarSupervisor: async (_id: string, pub: Uint8Array) => { if (pessoa.operacao?.tipo !== "redefinir") return false; supervisor.trocado = Buffer.from(pub).toString("base64"); return true; },
      esquecerSupervisor: async () => { supervisor.esquecido = true; },
      atividadeDaPessoa: async () => [{ agenteId: A, autor: "bot", tipo: "navegar", estado: "concluida", em: T0 - 1000 }, { agenteId: null, autor: "pessoa", tipo: "atualizar", estado: "falhou", em: T0 - 2000 }],
      avisoRecriado: async () => true,
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
      apagar: async (id: string) => { telas.delete(id); },
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
    conversas: { buscarPropriaDoAgente: async (agenteId: string) => ({ id: `conversa-${agenteId.slice(-1)}` }) },
    mensagens: { criar: async (m: { conversaId: string; texto: string; payload: unknown }) => { avisos.push({ conversaId: m.conversaId, texto: m.texto, payload: m.payload }); return { id: `msg-${avisos.length}` }; } },
    events: { gravarComOutbox: async () => {} },
  },
});

const computadores = criarComputadores({
  executor: () => "catcher", porPessoa: true, driver, cifrar: (s) => s, decifrar: (s) => s, mudou: () => {}, agora: () => agora,
  lugarPadraoNaCriacao: () => "maquina-inicial",
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
  pessoa = { id: "pessoa-1", ownerId: MARLON.pessoaId, maquinaId: null, hospedeiraId: null, supervisorPub: null, saidasPendentesDe: [], operacao: null, falhasSeguidas: 0, falhaMotivo: null, indisponivelDesde: null, ultimaAtividadeEm: T0, criadoEm: 0 };
  lugarPedidoNaCriacao = null;
  telas = new Map([tela(A), tela(B)].map((t) => [t.id, t]));
  registros = [];
  excluidos = new Set();
  enviadas = [];
  paradas = [];
  semMemoria = 0;
  dormiu = 0;
  aoDormir = null;
  operar = async () => ({});
  operacoes = [];
  avisos = [];
  perfisApagados = [];
  supervisor = { trocado: null, esquecido: false };
  pendente = null;
  guardado = null;
  iniciados = [];
  concluidos = new Set();
});

it("NOD-365: o lugar padrão é entregue ao INSERT do computador, não escolhido pelo primeiro iniciar", async () => {
  await observar(A);
  expect(lugarPedidoNaCriacao).toBe("maquina-inicial");
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
  // NOD-96 PR 5: o perfil do bot sai da máquina e a tela sai do banco.
  expect(perfisApagados).toEqual([`pessoa-1:${A}`]);
  expect(telas.has("tela-a")).toBe(false);
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

// ---- NOD-96 PR 5: operações do computador da pessoa ----

it("Atualizar: marca a operação, avisa no chat de cada bot com tela aberta, roda em segundo plano e fecha as telas", async () => {
  mudar("tela-a", { estado: "aberta" });
  let soltar!: () => void;
  operar = () => new Promise((r) => { soltar = () => r({}); });
  const { concluida } = await computadores.operarDaPessoa(MARLON, "atualizar");
  expect(pessoa.operacao).toMatchObject({ tipo: "atualizar" });
  expect(operacoes).toEqual(["atualizar"]);
  expect(avisos).toEqual([{ conversaId: "conversa-a", texto: expect.stringMatching(/Fechei a tela de Ana Bot.*atualizar o computador.*tenta de novo sozinho/), payload: { kind: "computador_em_operacao", agenteId: A, operacao: "atualizar" } }]);
  // Uma por vez: a segunda operação é recusada enquanto a primeira vive.
  await expect(computadores.operarDaPessoa(MARLON, "sair_de_todos")).rejects.toMatchObject({ codigo: "estado_invalido" });
  expect((await computadores.consultarDaPessoa(MARLON)).estado).toBe("operando");
  soltar();
  await concluida;
  expect(pessoa.operacao).toBeNull();
  expect(telas.get("tela-a")!.estado).toBe("fechada");
  expect(registros.find((r) => r.tipo === "atualizar")).toMatchObject({ autor: "pessoa", estado: "concluida" });
});

it("Sair de todos: não avisa 'Fechei a tela' nem marca as telas como fechadas (só limpa os cookies)", async () => {
  mudar("tela-a", { estado: "aberta" });
  mudar("tela-b", { estado: "abrindo" });
  operar = async () => ({});
  await (await computadores.operarDaPessoa(MARLON, "sair_de_todos")).concluida;
  expect(operacoes).toEqual(["sair_de_todos"]);
  expect(avisos).toEqual([]);
  expect(telas.get("tela-a")!.estado).toBe("aberta");
  expect(telas.get("tela-b")!.estado).toBe("abrindo");
  expect(pessoa.operacao).toBeNull();
  expect(registros.find((r) => r.tipo === "sair_de_todos")).toMatchObject({ autor: "pessoa", estado: "concluida" });
});

it("Esquecer senhas (NOD-97 PR 6): avisa no chat de cada bot com tela aberta, não marca as telas fechadas e registra a pessoa", async () => {
  mudar("tela-a", { estado: "aberta" });
  let soltar!: () => void;
  operar = () => new Promise((r) => { soltar = () => r({}); });
  const { concluida } = await computadores.operarDaPessoa(MARLON, "esquecer_senhas");
  expect(operacoes).toEqual(["esquecer_senhas"]);
  expect(pessoa.operacao).toMatchObject({ tipo: "esquecer_senhas" });
  // Só o bot com tela aberta é avisado (a tela do Beto está fechada).
  expect(avisos).toEqual([{ conversaId: "conversa-a", texto: expect.stringMatching(/Fechei a tela de Ana Bot.*esquecer as senhas salvas/), payload: { kind: "computador_em_operacao", agenteId: A, operacao: "esquecer_senhas" } }]);
  // Uma por vez: com Esquecer senhas viva, outra operação (ou a mesma) é recusada (409 na rota).
  await expect(computadores.operarDaPessoa(MARLON, "esquecer_senhas")).rejects.toMatchObject({ codigo: "estado_invalido" });
  await expect(computadores.operarDaPessoa(MARLON, "redefinir")).rejects.toMatchObject({ codigo: "estado_invalido" });
  soltar();
  await concluida;
  // O supervisor fecha e religa as telas: o banco não as marca fechadas (a foto reconcilia).
  expect(telas.get("tela-a")!.estado).toBe("aberta");
  expect(telas.get("tela-b")!.estado).toBe("fechada");
  expect(pessoa.operacao).toBeNull();
  expect(registros.filter((r) => r.tipo === "esquecer_senhas")).toEqual([expect.objectContaining({ autor: "pessoa", estado: "concluida", computadorId: "pessoa-1" })]);
});

it("Esquecer senhas com outra operação em curso é recusado; a que falha no supervisor fica registrada como falhou", async () => {
  pessoa = { ...pessoa, operacao: { tipo: "atualizar", progresso: 40, etapa: "Reiniciando", desde: T0 } };
  await expect(computadores.operarDaPessoa(MARLON, "esquecer_senhas")).rejects.toMatchObject({ codigo: "estado_invalido" });
  expect(operacoes).toEqual([]);
  pessoa = { ...pessoa, operacao: null };
  const { FalhaComputador } = await import("../../../src/domain/computador.ts");
  operar = async () => { throw new FalhaComputador("acao_falhou"); };
  await (await computadores.operarDaPessoa(MARLON, "esquecer_senhas")).concluida;
  expect(pessoa.operacao).toBeNull();
  expect(registros.find((r) => r.tipo === "esquecer_senhas")).toMatchObject({ autor: "pessoa", estado: "falhou", motivo: "acao_falhou" });
});

it("ociosidade: operação presa além do teto (o servidor caiu no meio) não impede a máquina de dormir", async () => {
  const limite = 15 * 60_000;
  agora = T0 + 2 * limite;
  mudar("tela-a", { estado: "fechada", ultimaAtividadeEm: T0 - 1 });
  mudar("tela-b", { estado: "fechada", ultimaAtividadeEm: T0 - 1 });
  // Viva (dentro do teto): segura a máquina acordada.
  pessoa = { ...pessoa, operacao: { tipo: "atualizar", progresso: 40, etapa: "Reiniciando", desde: agora - 60_000 } };
  expect(await computadores.desligarOciosos(MARLON, new Set(["pessoa-1"]), limite)).toBe(0);
  expect(paradas).toEqual([]);
  // Vencida (passou dos 15 min): a máquina dorme.
  pessoa = { ...pessoa, operacao: { tipo: "atualizar", progresso: 40, etapa: "Reiniciando", desde: agora - limite - 1 } };
  expect(await computadores.desligarOciosos(MARLON, new Set(["pessoa-1"]), limite)).toBe(1);
  expect(paradas).toEqual(["pessoa-1"]);
});

it("Redefinir: troca a X25519 fixada pela que o supervisor novo devolveu; falha encerra a operação do mesmo jeito", async () => {
  operar = async () => ({ supervisorPub: "bm92YQ==" });
  await (await computadores.operarDaPessoa(MARLON, "redefinir")).concluida;
  expect(supervisor.trocado).toBe("bm92YQ==");
  expect(pessoa.operacao).toBeNull();

  const { FalhaComputador } = await import("../../../src/domain/computador.ts");
  operar = async () => { throw new FalhaComputador("sem_resposta"); };
  await (await computadores.operarDaPessoa(MARLON, "redefinir")).concluida;
  expect(pessoa.operacao).toBeNull();
  expect(registros.filter((r) => r.tipo === "redefinir").map((r) => r.estado)).toEqual(["concluida", "falhou"]);
});

it("durante a operação a ação do bot espera (sem erro); a operação acaba e a ação sai", async () => {
  pessoa = { ...pessoa, operacao: { tipo: "atualizar", progresso: 40, etapa: "Reiniciando", desde: T0 } };
  aoDormir = () => { if (dormiu === 2) pessoa = { ...pessoa, operacao: null }; };
  const r = await observar(A);
  expect("isError" in r && r.isError).toBeFalsy();
  expect(JSON.parse((r as { conteudo: string }).conteudo).tela.url).toBe("https://example.com");
  expect(dormiu).toBe(2);
  expect(enviadas).toHaveLength(1);
});

it("operação que não acaba na janela: o bot recebe 'o computador está atualizando' (espera, não erro)", async () => {
  pessoa = { ...pessoa, operacao: { tipo: "redefinir", progresso: 10, etapa: "Preparando", desde: T0 } };
  const r = await observar(A);
  expect(r).toMatchObject({ ok: true, confianca: "confiavel" });
  expect("isError" in r && r.isError).toBeFalsy();
  const corpo = JSON.parse((r as { conteudo: string }).conteudo);
  expect(corpo.estado).toBe("atualizando");
  expect(corpo.instrucao).toMatch(/atualizando; tento de novo quando terminar/);
  expect(enviadas).toHaveLength(0);
  expect(registros[0]).toMatchObject({ estado: "falhou", motivo: "atualizando" });
});

it("o supervisor responde 'atualizando' antes de o banco saber: o bot espera uma fatia e tenta de novo", async () => {
  const { FalhaComputador } = await import("../../../src/domain/computador.ts");
  let vezes = 0;
  const executar = driver.executar;
  driver.executar = async (id, acao) => { if (vezes++ === 0) throw new FalhaComputador("atualizando"); return executar(id, acao); };
  try {
    const r = await observar(A);
    expect("isError" in r && r.isError).toBeFalsy();
    expect(dormiu).toBe(1);
  } finally { driver.executar = executar; }
});

it("GET /computador: estado, máquina, telas com título, fila, memória com o total, atividade em português e o aviso", async () => {
  mudar("tela-a", { estado: "aberta", memoriaMb: 600 });
  mudar("tela-b", { estado: "esperando", esperandoDesde: T0 });
  const dto = await computadores.consultarDaPessoa(MARLON);
  expect(dto).toMatchObject({
    estado: "pronto", maquina: { id: "maq-1", nome: "Servidor de casa", contato: T0 }, esperando: [B], operacao: null, falha: null,
    memoria: { usadaMb: 600, totalMb: 8000 }, ligadoDesde: T0 - 60_000, aviso_recriado: true,
    atividade: [{ agenteId: A, texto: expect.any(String), em: T0 - 1000 }, { agenteId: null, texto: "atualizou o computador (não deu certo)", em: T0 - 2000 }],
  });
  expect(dto.telas.find((t) => t.agenteId === A)).toMatchObject({ titulo: "Gmail", memoriaMb: 600, controle: "bot", ultimaAcaoEm: T0 });

  pessoa = { ...pessoa, falhasSeguidas: 3, falhaMotivo: "sem_resposta", indisponivelDesde: T0 - 5000 };
  expect(await computadores.consultarDaPessoa(MARLON)).toMatchObject({ estado: "fora_do_ar", falha: { motivo: "sem_resposta", desde: T0 - 5000 } });
});

it("fora do ar no computador da pessoa: o aviso no chat traz a ação do painel que resolve", async () => {
  const { FalhaComputador } = await import("../../../src/domain/computador.ts");
  const executar = driver.executar;
  driver.executar = async () => { throw new FalhaComputador("sem_resposta"); };
  try {
    const comFalha = criarComputadores({
      executor: () => "catcher", porPessoa: true, driver, cifrar: (s) => s, decifrar: (s) => s, mudou: () => {}, agora: () => agora,
      dentro: async <T>(_e: unknown, fn: (d: never) => Promise<T>) => { const d = deps(); (d.repos.computadores as Record<string, unknown>).registrarFalha = async () => ({ computador: { indisponivelDesde: T0 }, virouIndisponivel: true }); return fn(d as never); },
      dormir: async (ms) => { agora += ms; },
    });
    await comFalha.chamar(MARLON, plano(A), "computador_observar", {});
    expect(avisos).toEqual([expect.objectContaining({ texto: expect.stringMatching(/use "⚙ Atualizar o computador" no painel do computador/), payload: expect.objectContaining({ kind: "computador_fora_do_ar", acao: { op: "atualizar", rotulo: "⚙ Atualizar o computador" } }) })]);
  } finally { driver.executar = executar; }
});

// ---- NOD-365: onde o computador mora ----

it("trocar de máquina: valida o destino, uma troca por vez, avança o progresso, fecha as telas e registra; sem os logins, o aviso volta", async () => {
  const { FalhaComputador } = await import("../../../src/domain/computador.ts");
  const lugares: LugarDoComputador[] = [
    { maquinaId: "maq-1", nome: "Servidor de casa", tipo: "onde_o_nod_roda" as const, atual: true, pronta: true },
    { maquinaId: "maq-2", nome: "vps-sp", tipo: "outra_maquina" as const, atual: false, pronta: true },
    { maquinaId: "maq-3", nome: "vps-rj", tipo: "outra_maquina" as const, atual: false, pronta: false },
  ];
  pessoa = { ...pessoa, maquinaId: "maq-1", hospedeiraId: "maq-1" };
  mudar("tela-a", { estado: "aberta" });
  let soltar!: () => void;
  const pedidos: { destino: string; semLogins: boolean }[] = [];
  const progresso: number[] = [];
  driver.lugares = async () => lugares;
  driver.trocar = async (_id, destino, op) => {
    pedidos.push({ destino, semLogins: op.semLogins });
    await op.aoProgresso?.({ pct: 40, etapa: "Levando para a máquina nova" });
    await new Promise<void>((r) => { soltar = r; });
  };
  const comProgresso = criarComputadores({
    executor: () => "catcher", porPessoa: true, driver, cifrar: (s) => s, decifrar: (s) => s, mudou: () => {}, agora: () => agora,
    dentro: async <T>(_e: unknown, fn: (d: never) => Promise<T>) => { const d = deps(); (d.repos.computadores as Record<string, unknown>).progredirOperacao = async (_c: string, _t: string, p: { pct: number }) => { progresso.push(p.pct); return true; }; return fn(d as never); },
    dormir: async (ms) => { agora += ms; },
  });
  try {
    // O destino é o atual, não está na lista ou não está pronto: estado_invalido, sem operação.
    for (const m of ["maq-1", "maq-9", "maq-3"]) await expect(comProgresso.trocarLugarDaPessoa(MARLON, { maquinaId: m, semLogins: false })).rejects.toMatchObject({ codigo: "estado_invalido" });
    expect(pessoa.operacao).toBeNull();

    const simultaneas = await Promise.allSettled([
      comProgresso.trocarLugarDaPessoa(MARLON, { maquinaId: "maq-2", semLogins: false }),
      comProgresso.trocarLugarDaPessoa(MARLON, { maquinaId: "maq-2", semLogins: false }),
    ]);
    expect(simultaneas.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(simultaneas.filter((r) => r.status === "rejected")).toEqual([expect.objectContaining({ reason: expect.objectContaining({ codigo: "estado_invalido" }) })]);
    const concluida = (simultaneas.find((r) => r.status === "fulfilled") as PromiseFulfilledResult<{ concluida: Promise<void> }>).value.concluida;
    expect(pessoa.operacao).toMatchObject({ tipo: "trocar" });
    expect(avisos).toEqual([expect.objectContaining({ conversaId: "conversa-a", payload: { kind: "computador_em_operacao", agenteId: A, operacao: "trocar" } })]);
    // A chamada perdedora recebeu estado_invalido; enquanto a vencedora segue, Atualizar também é recusado.
    await expect(comProgresso.operarDaPessoa(MARLON, "atualizar")).rejects.toMatchObject({ codigo: "estado_invalido" });
    soltar();
    await concluida;
    expect(pedidos).toEqual([{ destino: "maq-2", semLogins: false }]);
    expect(progresso).toEqual([40]);
    expect(pessoa.operacao).toBeNull();
    expect(telas.get("tela-a")!.estado).toBe("fechada");
    expect(registros.filter((r) => r.tipo.startsWith("trocar"))).toEqual([expect.objectContaining({ tipo: "trocar", autor: "pessoa", estado: "concluida" })]);

    // A origem com contato mas sem os pacotes (não pronta) ainda entrega a loja: a troca segue, sem a recusa.
    lugares[0] = { ...lugares[0]!, pronta: false, conectada: true };
    const soltarAntigo = soltar;
    const comContato = await comProgresso.trocarLugarDaPessoa(MARLON, { maquinaId: "maq-2", semLogins: false });
    for (let i = 0; i < 500 && soltar === soltarAntigo; i++) await Promise.resolve();
    soltar();
    await comContato.concluida;
    expect(pedidos.at(-1)).toEqual({ destino: "maq-2", semLogins: false });
    // A origem sem contato: a recusa sai na hora com o nome dela (a tela diz "<origem> está sem contato…"), sem operação.
    lugares[0] = { ...lugares[0]!, pronta: false, conectada: false };
    await expect(comProgresso.trocarLugarDaPessoa(MARLON, { maquinaId: "maq-2", semLogins: false })).rejects.toEqual(expect.objectContaining({ motivo: "maquina_sem_contato", maquina: "Servidor de casa" }));
    expect(pessoa.operacao).toBeNull();
    // Trocar sem os logins segue e registra para a faixa "entre nos sites de novo".
    driver.trocar = async (_id, destino, op) => { pedidos.push({ destino, semLogins: op.semLogins }); };
    await (await comProgresso.trocarLugarDaPessoa(MARLON, { maquinaId: "maq-2", semLogins: true })).concluida;
    expect(pedidos.at(-1)).toEqual({ destino: "maq-2", semLogins: true });
    expect(registros.filter((r) => r.tipo === "trocar_sem_logins")).toEqual([expect.objectContaining({ autor: "pessoa", estado: "concluida" })]);

    // A troca que falha no driver encerra a operação e não registra o sem-logins.
    driver.trocar = async () => { throw new FalhaComputador("nao_iniciou"); };
    await (await comProgresso.trocarLugarDaPessoa(MARLON, { maquinaId: "maq-2", semLogins: true })).concluida;
    expect(pessoa.operacao).toBeNull();
    expect(registros.filter((r) => r.tipo === "trocar").at(-1)).toMatchObject({ estado: "falhou", motivo: "nao_iniciou" });
    expect(registros.filter((r) => r.tipo === "trocar_sem_logins")).toHaveLength(1);
  } finally {
    delete driver.lugares;
    delete driver.trocar;
  }
});
