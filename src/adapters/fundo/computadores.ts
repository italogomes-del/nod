import { createHash, randomUUID } from "node:crypto";
import type { AcaoComputador, Computador, ComputadorDto, ControleComputador, DriverComputador, OrigemControle, PoliticaComputador, RegistroComputador, ResultadoComputador } from "../../contracts/computador.ts";
import type { ComputadorDaPessoa, EstadoComputadorRelatado, TelaComputadorBot } from "../../contracts/computador-motor.ts";
import { FERRAMENTAS_COMPUTADOR } from "../../contracts/ferramentas-computador.ts";
import type { MotivoFalhaComputador } from "../../contracts/motivos.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import { alteraComputador, computadorPadrao, CONTA_PARA_SAUDE, ehEsperandoTela, ehFalhaComputador, type FalhaComputador, instrucaoDaFalha, LIMITE_FALHAS_SEGUIDAS, MOTIVO_FALHA_EM_PORTUGUES, resumirDetalhe, resumoAcaoComputador, textoPedidoDeTela, validarAcaoComputador } from "../../domain/computador.ts";
import { ehErroDeDominio, ErroDeDominio } from "../../domain/erro.ts";
import { deduplicarObservacao, type HashesObservacao } from "../../domain/observacao-computador.ts";
import { decidirPeloModo, semRevisor } from "../../domain/modo-aprovacao.ts";
import { redigir } from "../../domain/redacao.ts";
import { log } from "../../obs/log.ts";
import { computadorLiberadoNaTarefa } from "../../use-cases/liberar-na-tarefa.ts";
import type { Escopo } from "../../shared/types.ts";
import { autoriaAgente, evento } from "../../use-cases/autoria-evento.ts";
import { errosDoSchema, type ResultadoChamada } from "../../use-cases/chamar-ferramenta.ts";
import { pedirAprovacaoComputador } from "../../use-cases/pedir-aprovacao.ts";
import { pedirAjudaDoComputador } from "../../use-cases/pedir-a-pessoa.ts";
import { registrarNegacao } from "../../use-cases/registrar-negacao.ts";
import { fecharComResposta, retomarComResposta } from "../../use-cases/responder-decisao.ts";
import type { Deps } from "../../use-cases/tipos.ts";

type Dentro = <T>(escopo: Escopo, fn: (d: Deps) => Promise<T>) => Promise<T>;
/** `saude`: o computador entrou ou saiu do ar — a frota (lateral, cabeçalho, painel) precisa reler. */
type Opcoes = { executor(): "local" | "catcher"; dentro: Dentro; driver: DriverComputador; cifrar(s: string): string; decifrar(s: string): string; mudou(escopo: Escopo, agenteId: string, saude?: boolean): void; agora?: () => number;
  /** NOD-200: guarda a última tela do turno para virar anexo da fala (NOD_CAPTURA_NO_TRANSCRIPT). Desligado, nada fica em memória. */
  guardarTelas?: boolean;
  /**
   * NOD-96 PR 4 (ADR-122): o computador é o da pessoa, no motor, com uma tela por bot (NOD_COMPUTADORES=motor, lida só em
   * compor.ts). Reserva, controle, política e ajuda passam a ser da tela; sem tela livre a ação espera na fila.
   * Desligado: o caminho de sempre, um computador (docker) por bot.
   */
  porPessoa?: boolean;
  dormir?: (ms: number) => Promise<void> };
/**
 * NOD-96 PR 4: onde a ação roda. No modo docker é o computador do bot (`telaId` nulo, `computadorId` = `id`). No modo
 * por pessoa o `id` é o da tela do bot (é ele que o portão passa ao driver), `computadorId` o da pessoa, e a saúde
 * (falhas seguidas, fora do ar) é a do computador da pessoa.
 */
type Vaga = Computador & { computadorId: string; telaId: string | null };
type Reserva = { computador: Vaga; operacao: string; acao: AcaoComputador; registroId: string; turnoId?: string; aprovado: boolean;
  /** NOD-96 PR 4: até quando a ação do bot espera a vez na fila de telas; ausente = não espera (a da pessoa). */
  esperaAte?: number };
const doDocker = (c: Computador): Vaga => ({ ...c, computadorId: c.id, telaId: null });
const daTela = (p: ComputadorDaPessoa, t: TelaComputadorBot): Vaga => ({
  id: t.id, agenteId: t.agenteId, habilitado: true, controle: t.controle, politica: t.politica, ajuda: t.ajuda, ajudaDecisaoId: t.ajudaDecisaoId,
  ocupadoAte: t.ocupadoAte, operacaoId: t.operacaoId, criadoEm: t.criadoEm, falhasSeguidas: p.falhasSeguidas, falhaMotivo: p.falhaMotivo,
  indisponivelDesde: p.indisponivelDesde, computadorId: p.id, telaId: t.id,
});

// definido em 2026-09-18: reserva confirmada ANTES do efeito; watchdog do runtime encerra em 55 s.
const LEASE_MS = 300_000;
/**
 * definido em 2026-10-05 (NOD-170): a reserva do varredor de ociosidade cobre o `parar` (stop da máquina e do
 * proxy, 20 s cada com 30 s de prazo, mais os inspects). Uma ação que chega no meio recebe estado_invalido (livre()).
 */
const LEASE_OCIOSIDADE_MS = 90_000;
/**
 * definido em 2026-10-22 (NOD-96 PR 4, protótipo v2 aprovado): sem memória para a tela, a ação do bot espera a vez na
 * fila em vez de voltar "Nada foi executado". A janela cabe no prazo da ferramenta no proxy (240 s, cliente-nod.ts) com
 * folga para a ação em si (90 s, PRAZO_RESPOSTA_ACAO_MS); passada a janela, o bot recebe "ainda esperando" e chama de
 * novo, sem perder o lugar. A fila anda em fatias de 5 s (a vez é da tela que chegou primeiro).
 */
const JANELA_ESPERA_TELA_MS = 120_000;
const FATIA_ESPERA_TELA_MS = 5_000;
/** A janela acabou e a tela ainda não abriu: não é falha, é a vez que não chegou. */
class EsperaEsgotada extends Error {
  readonly quem: string[];
  constructor(quem: string[]) {
    super("espera_esgotada");
    this.quem = quem;
  }
}
function esperandoTelaParaAgente(quem: string[]): string {
  const uso = quem.length ? ` ${quem.join(", ")} ${quem.length === 1 ? "está" : "estão"} usando o computador agora.` : "";
  return JSON.stringify({ estado: "esperando_tela", quem, instrucao: `Ainda esperando uma tela livre no computador; seu lugar na fila continua.${uso} Chame a mesma ferramenta de novo para seguir esperando; não diga que o computador está fora do ar.` });
}
function livre(c: Computador, agora: number): void {
  if (c.ocupadoAte && c.ocupadoAte > agora) throw new ErroDeDominio("estado_invalido");
}
async function reservarCom(lugar: Lugar, d: Deps, c: Vaga, acao: AcaoComputador, autor: "bot" | "pessoa", turnoId?: string, registroId?: string): Promise<Reserva> {
  livre(c, d.agora());
  const operacao = randomUUID();
  // NOD-161: `forcar` é decisão do servidor; o runtime recebe o observar de sempre.
  if (acao.tipo === "observar") acao = { tipo: "observar" };
  const registro = registroId ?? (await lugar.registrar(d, c, { turnoId, autor, tipo: acao.tipo, estado: "executando" })).id;
  if (registroId) await d.repos.computadores.concluir(registroId, "executando");
  await lugar.ocupar(d, c, operacao, d.agora() + LEASE_MS);
  // A ação do bot espera a vez na fila de telas (só no computador da pessoa); a da pessoa não espera.
  return { computador: c, operacao, acao, registroId: registro, turnoId, aprovado: Boolean(registroId), ...(c.telaId && autor === "bot" ? { esperaAte: d.agora() + JANELA_ESPERA_TELA_MS } : {}) };
}
/** revisto em 2026-10-01 (ADR-067): sem o `prazoEm` — o turno vivo usa o computador enquanto não acabou, sem relógio. */
async function turnoPermitido(d: Deps, turnoId: string, agenteId: string, aprovado = false): Promise<boolean> {
  const t = await d.repos.turnos.buscar(turnoId);
  return Boolean(t && (aprovado || (t.estado !== "concluido" && t.estado !== "interrompido")) && t.agenteId === agenteId && t.ownerId === d.escopo.pessoaId && !t.pararSolicitadoEm &&
    t.motivoInterrupcao !== "parado_pela_pessoa" && !(await d.repos.agentes.execucaoBloqueada(turnoId)) &&
    await d.repos.paradas.ativa(d.escopo.pessoaId, t.conversaId) === false);
}

/** A ferramenta de texto tem instrução própria quando a ação falha (caminho, UTF-8, revisão). */
const FERRAMENTAS_DE_TEXTO = new Set(["computador_ler_texto", "computador_gravar_texto"]);

/**
 * definido em 2026-09-24 (emenda da ADR-037): o que a ferramenta devolve ao agente — código fechado e
 * instrução de tabela, nunca mais o catch-all "indisponível ou tela alterada".
 */
function erroDaFerramenta(nome: string, e: unknown): { erro: string; instrucao: string } {
  if (ehErroDeDominio(e) && e.codigo === "nao_permitido") return { erro: "nao_permitido", instrucao: "O computador foi desligado, assumido pela pessoa ou a tarefa foi parada antes da ação. Nada foi executado; não tente de novo neste turno." };
  // Erro que não é falha tipada (bug ou driver novo): vira acao_falhou, mas fica no log com o nome.
  if (!ehFalhaComputador(e)) log("erro", "computador_erro_inesperado", { ferramenta: nome, erro: e instanceof Error ? e.name : "desconhecido" });
  const motivo = ehFalhaComputador(e) ? e.motivo : "acao_falhou";
  if (motivo === "acao_falhou" && FERRAMENTAS_DE_TEXTO.has(nome)) return { erro: motivo, instrucao: "A operação de texto falhou. Confira caminho, tamanho, UTF-8 e revisão; releia o arquivo antes de editar. Não afirme que gravou." };
  return { erro: motivo, instrucao: instrucaoDaFalha(motivo, ehFalhaComputador(e) ? e.limite : null, ehFalhaComputador(e) ? e.maquina : null) };
}

/** Para a borda HTTP: a falha da máquina é estado (409), nunca falha interna (500). */
function comoErroDeDominio(e: unknown): unknown {
  if (ehEsperandoTela(e)) return new ErroDeDominio("estado_invalido", { cause: "esperando_tela" });
  return ehFalhaComputador(e) ? new ErroDeDominio("estado_invalido", { cause: e.motivo }) : e;
}

/**
 * definido em 2026-10-05 (NOD-161): a última tela entregue ao modelo vive 30 min por turno+computador,
 * no máximo 500 entradas (sai a mais antiga). Não há gancho de fim de turno aqui; turno novo traz
 * turnoId novo, e um restart só faz a próxima observação ir completa.
 */
const OBSERVACAO_TTL_MS = 30 * 60_000;
const OBSERVACOES_MAX = 500;
const AVISO_TELA_IGUAL = "Tela igual à anterior; use computador_observar com forcar: true para vê-la de novo.";
/**
 * definido em 2026-10-08 (NOD-200): a última tela do turno, para anexar à fala do bot no assentar. Fica 2 h
 * (turno longo com aprovação no meio) e no máximo 200 turnos (sai o mais antigo); o assentar a toma e esquece.
 */
const TELA_DO_TURNO_TTL_MS = 2 * 60 * 60_000;
const TELAS_DO_TURNO_MAX = 200;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** "O computador está fora do ar desde …" para o agente, sem tocar no Docker (falha rápida). */
function foraDoArParaAgente(c: Computador): { erro: MotivoFalhaComputador; instrucao: string } {
  const motivo = c.falhaMotivo ?? "sem_resposta";
  return { erro: motivo, instrucao: `O computador está fora do ar desde ${new Date(c.indisponivelDesde ?? 0).toISOString()}: ${MOTIVO_FALHA_EM_PORTUGUES[motivo]}. A pessoa já foi avisada. Não tente usá-lo neste turno; siga com os acessos que você tem e diga em uma frase o que ficou de fora.` };
}

/**
 * definido em 2026-10-07 (ADR-083, S5): o computador é um por bot (ADR-037), e com tasks em paralelo a segunda que o
 * pede encontra a reserva da primeira. Antes isso subia como 409, e o proxy tratava como servidor fora do ar. Agora
 * volta como resultado para o modelo, com quem está usando e quando tentar de novo; nenhuma das duas falha.
 */
const TENTE_EM_MIN_S = 5;
const TENTE_EM_MAX_S = 60;
function ocupadoParaAgente(emUsoPor: string, ocupadoAte: number, agora: number): string {
  const tenteEmS = Math.min(TENTE_EM_MAX_S, Math.max(TENTE_EM_MIN_S, Math.ceil((ocupadoAte - agora) / 1000)));
  return JSON.stringify({ erro: "computador_ocupado", emUsoPor, tenteEmS, instrucao: `Seu computador está em uso por ${emUsoPor}. Nada foi executado. Siga com o que dá sem ele e tente de novo em ${tenteEmS} s; não diga que o computador está fora do ar.` });
}

type DadosRegistro = { turnoId?: string; autor: RegistroComputador["autor"]; tipo: string; estado: RegistroComputador["estado"]; argumentosCifrados?: string };
type Ajuste = { habilitado?: boolean; controle?: ControleComputador; politica?: PoliticaComputador; ajuda?: string | null; ajudaDecisaoId?: string | null; atividadeEm?: number };
/** NOD-96 PR 4: as operações do portão sobre a vaga, uma implementação por modelo (docker por bot; tela no da pessoa). */
type Lugar = {
  obter(d: Deps, agenteId: string): Promise<Vaga>;
  /** Relê a vaga com a linha travada (a tela; o computador por bot). */
  travar(d: Deps, v: Vaga): Promise<Vaga | null>;
  configurar(d: Deps, v: Vaga, c: Ajuste): Promise<void>;
  ocupar(d: Deps, v: Vaga, operacao: string, ate: number): Promise<void>;
  liberar(d: Deps, v: Vaga, operacao: string, atividadeEm?: number): Promise<void>;
  registrar(d: Deps, v: Vaga, e: DadosRegistro): Promise<RegistroComputador>;
  emUsoPor(d: Deps, v: Vaga): Promise<{ titulo: string; deFora: boolean } | null>;
};
const lugarDocker: Lugar = {
  async obter(d, agenteId) {
    const c = await d.repos.computadores.obter(agenteId);
    if (!c) throw new ErroDeDominio("nao_encontrado");
    return doDocker((await d.repos.computadores.travar(c.id))!);
  },
  async travar(d, v) {
    const c = await d.repos.computadores.travar(v.id);
    return c && doDocker(c);
  },
  configurar: (d, v, c) => d.repos.computadores.configurar(v.id, c),
  ocupar: (d, v, operacao, ate) => d.repos.computadores.ocupar(v.id, operacao, ate),
  liberar: (d, v, operacao, em) => d.repos.computadores.liberar(v.id, operacao, em),
  registrar: (d, v, e) => d.repos.computadores.registrar({ ...e, computadorId: v.id }),
  emUsoPor: (d, v) => d.repos.computadores.emUsoPor(v.id),
};
/**
 * A tela do bot no computador da pessoa. O bot é vinculado ao computador dela na primeira vez (vincularBot) e a tela
 * nasce fechada (computadorTelas.obter); bot excluído ou de outra pessoa não tem tela (nao_encontrado). O registro da
 * ação leva o bot (`agente_id`) e a tela; a da pessoa leva só a tela.
 */
const lugarTela: Lugar = {
  async obter(d, agenteId) {
    const p = await d.repos.computadores.obterDaPessoa();
    if (!await d.repos.computadores.vincularBot(p.id, agenteId)) throw new ErroDeDominio("nao_encontrado");
    const t = await d.repos.computadorTelas.obter(p.id, agenteId);
    const travada = t && await d.repos.computadorTelas.travar(t.id);
    if (!travada) throw new ErroDeDominio("nao_encontrado");
    return daTela(p, travada);
  },
  async travar(d, v) {
    const t = await d.repos.computadorTelas.travar(v.id);
    const p = t && await d.repos.computadores.daPessoa();
    return t && p && p.id === t.computadorId ? daTela(p, t) : null;
  },
  async configurar(d, v, { habilitado: _, ...c }) { await d.repos.computadorTelas.configurar(v.id, c); },
  ocupar: (d, v, operacao, ate) => d.repos.computadorTelas.ocupar(v.id, operacao, ate),
  liberar: (d, v, operacao, em) => d.repos.computadorTelas.liberar(v.id, operacao, em),
  registrar: (d, v, e) => d.repos.computadores.registrar({ ...e, computadorId: v.computadorId, telaId: v.id, ...(e.autor === "bot" ? { agenteId: v.agenteId } : {}) }),
  emUsoPor: (d, v) => d.repos.computadores.emUsoPor(v.computadorId, v.id),
};

/**
 * NOD-96 PR 4 (ADR-122): o banco segue a foto do supervisor. A tela relatada leva o estado, a memória medida e a última
 * ação (que adia a ociosidade); a tela do banco que o supervisor não relata (ou com o computador desligado) e estava
 * aberta, abrindo ou fechando fica fechada. 'esperando' é do servidor (a fila): o "fechada" do supervisor não a tira de
 * lá. Tela relatada sem linha no banco (bot de outra pessoa, excluído) é ignorada.
 */
export async function reconciliarTelas(d: Deps, computadorId: string, relato: EstadoComputadorRelatado): Promise<void> {
  const agora = d.agora();
  const relatadas = new Map(relato.ligado ? relato.telas.map((t) => [t.agenteId, t]) : []);
  for (const t of await d.repos.computadorTelas.doComputador(computadorId)) {
    const r = relatadas.get(t.agenteId);
    if (!r) {
      if (t.estado === "aberta" || t.estado === "abrindo" || t.estado === "fechando") await d.repos.computadorTelas.mudarEstado(t.id, "fechada", agora, ["aberta", "abrindo", "fechando"]);
      continue;
    }
    if (r.memoriaMb !== t.memoriaMb || (r.ultimaAcaoEm !== null && r.ultimaAcaoEm > t.ultimaAtividadeEm)) await d.repos.computadorTelas.relatar(t.id, { memoriaMb: r.memoriaMb, ultimaAcaoEm: r.ultimaAcaoEm });
    if (r.estado !== t.estado && !(t.estado === "esperando" && r.estado === "fechada")) await d.repos.computadorTelas.mudarEstado(t.id, r.estado, agora);
  }
}

export function criarComputadores(o: Opcoes) {
  const agora = o.agora ?? Date.now;
  const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const porPessoa = o.porPessoa === true;
  const lugar = porPessoa ? lugarTela : lugarDocker;
  const obter = (d: Deps, agenteId: string) => lugar.obter(d, agenteId);
  const reservar = (d: Deps, c: Vaga, acao: AcaoComputador, autor: "bot" | "pessoa", turnoId?: string, registroId?: string) => reservarCom(lugar, d, c, acao, autor, turnoId, registroId);
  /** S5: o turno que pediu o computador ocupado e quem o segurava, até a próxima ação dele passar (TrabalhoDto). */
  const esperando = new Map<string, string>();
  function marcarEspera(turnoId: string, por: string): void {
    esperando.set(turnoId, por);
    // Turno que acabou esperando não volta para tirar a marca: guarda as 500 mais novas.
    if (esperando.size > 500) esperando.delete(esperando.keys().next().value!);
  }
  const observacoes = new Map<string, HashesObservacao & { em: number }>();
  const chaveObservacao = (turnoId: string, computadorId: string) => `${turnoId}:${computadorId}`;
  /** O modelo pode não ter a tela no contexto (aprovação, pessoa no controle): a próxima vai completa. */
  const esquecerObservacao = (turnoId: string, computadorId: string) => { observacoes.delete(chaveObservacao(turnoId, computadorId)); };
  /** A pessoa mexeu no controle (assumir/devolver/parar) sem turno à mão: esquece o computador em todos os turnos. */
  const esquecerComputador = (computadorId: string) => { for (const k of observacoes.keys()) if (k.endsWith(`:${computadorId}`)) observacoes.delete(k); };
  function lembrarObservacao(chave: string, hashes: HashesObservacao): void {
    observacoes.delete(chave);
    observacoes.set(chave, { ...hashes, em: agora() });
    for (const [k, v] of observacoes) if (observacoes.size > OBSERVACOES_MAX || agora() - v.em > OBSERVACAO_TTL_MS) observacoes.delete(k); else break;
  }
  /** NOD-200: base64 da última tela do turno (qualquer computador), antes da dedup. */
  const telasDoTurno = new Map<string, { imagem: string; em: number }>();
  function guardarTela(turnoId: string, imagem: string): void {
    telasDoTurno.delete(turnoId);
    telasDoTurno.set(turnoId, { imagem, em: agora() });
    for (const [k, v] of telasDoTurno) if (telasDoTurno.size > TELAS_DO_TURNO_MAX || agora() - v.em > TELA_DO_TURNO_TTL_MS) telasDoTurno.delete(k); else break;
  }
  function ultimaTela(turnoId: string): string | null {
    const v = telasDoTurno.get(turnoId);
    if (v && agora() - v.em > TELA_DO_TURNO_TTL_MS) { telasDoTurno.delete(turnoId); return null; }
    return v?.imagem ?? null;
  }
  function ultimaObservacao(chave: string): HashesObservacao | undefined {
    const v = observacoes.get(chave);
    if (v && agora() - v.em > OBSERVACAO_TTL_MS) { observacoes.delete(chave); return undefined; }
    return v;
  }

  /**
   * A MENSAGEM ÚNICA da transição para fora do ar (a web a mostra como cartão, com a hora local). Na
   * conversa própria do bot; as execuções seguintes saem sem as ferramentas de computador.
   */
  async function avisarForaDoAr(d: Deps, agenteId: string, desde: number | null, motivo: MotivoFalhaComputador): Promise<void> {
    // NOD-96 PR 4: no computador da pessoa o aviso vai à conversa do bot que pediu (não a de um bot qualquer dela).
    const agente = await d.repos.agentes.buscar(agenteId);
    const conversa = agente ? await d.repos.conversas.buscarPropriaDoAgente(agente.id) : null;
    if (!agente || !conversa) return;
    const agora = d.agora();
    const autoria = autoriaAgente({ agenteId: agente.id, contaDeExecucao: d.escopo.pessoaId, executor: o.executor(), decididoPor: "regra:saude_computador" });
    const texto = redigir("computador-fora-do-ar", agora, { agente: agente.nome, motivo: MOTIVO_FALHA_EM_PORTUGUES[motivo] });
    const m = await d.repos.mensagens.criar({ conversaId: conversa.id, turnoId: null, autoria, kind: "sistema", texto, payload: { kind: "computador_fora_do_ar", agenteId: agente.id, desde: desde ?? agora, motivo }, confianca: "confiavel" });
    if (m) await d.repos.events.gravarComOutbox([evento(d.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: conversa.id, turnoId: null, dados: { mensagem_id: m.id, kind: "sistema" } })]);
  }

  /** NOD-97: a linha cinza "Você fechou a tela…" na conversa própria do bot, no padrão do aviso de fora do ar. */
  async function avisarTelaFechada(d: Deps, c: Computador): Promise<void> {
    const agente = await d.repos.agentes.buscar(c.agenteId);
    const conversa = agente ? await d.repos.conversas.buscarPropriaDoAgente(agente.id) : null;
    if (!agente || !conversa) return;
    const agora = d.agora();
    const autoria = autoriaAgente({ agenteId: agente.id, contaDeExecucao: d.escopo.pessoaId, executor: o.executor(), decididoPor: "regra:tela_fechada" });
    const texto = redigir("computador-tela-fechada", agora, { agente: agente.nome });
    const m = await d.repos.mensagens.criar({ conversaId: conversa.id, turnoId: null, autoria, kind: "sistema", texto, payload: { kind: "computador_tela_fechada", agenteId: agente.id }, confianca: "confiavel" });
    if (m) await d.repos.events.gravarComOutbox([evento(d.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: conversa.id, turnoId: null, dados: { mensagem_id: m.id, kind: "sistema" } })]);
  }

  /**
   * A saúde anda com o registro da ação, na MESMA transação e com a linha travada. Só a máquina sem
   * responder conta (CONTA_PARA_SAUDE); qualquer resposta dela zera a sequência. Computador desligado
   * pela pessoa no meio não conta — quem parou foi ela. Devolve se a frota precisa reler.
   */
  async function registrarSaude(d: Deps, c: Vaga | null, etapa: string, falha: FalhaComputador | null, respondeu: boolean): Promise<boolean> {
    if (!c) return false;
    // A saúde é do computador da pessoa (a máquina), travado depois da tela (a ordem é sempre tela → computador).
    if (c.telaId && !await d.repos.computadores.travarDaPessoa(c.computadorId)) return false;
    if (!falha || !CONTA_PARA_SAUDE.has(falha.motivo)) return respondeu ? d.repos.computadores.registrarSucesso(c.computadorId) : false;
    if (!c.habilitado) return false;
    const r = await d.repos.computadores.registrarFalha(c.computadorId, { motivo: falha.motivo, em: d.agora(), limite: LIMITE_FALHAS_SEGUIDAS });
    // Sem segredos: o detalhe é a 1ª linha do stderr, curta e redigida (resumirDetalhe).
    log("aviso", "computador_falhou", { computador_id: c.computadorId, agente_id: c.agenteId, ...(c.telaId ? { tela_id: c.telaId } : {}), motivo: falha.motivo, etapa, falhas_seguidas: r?.computador.falhasSeguidas ?? null, fora_do_ar: (r?.computador.indisponivelDesde ?? null) !== null, detalhe: resumirDetalhe(falha.detalhe), reinicios: falha.reinicios });
    if (r?.virouIndisponivel) await avisarForaDoAr(d, c.agenteId, r.computador.indisponivelDesde, falha.motivo);
    return Boolean(r?.virouIndisponivel);
  }

  /** A vaga ainda é desta reserva: habilitada, o mesmo controle, a reserva viva, o bot vivo e o turno permitido. */
  async function aindaPermitido(d: Deps, r: Reserva): Promise<{ desligar: boolean; permitido: boolean; vaga: Vaga | null }> {
    const c = await lugar.travar(d, r.computador);
    const agente = c ? await d.repos.agentes.buscar(c.agenteId) : null;
    return { vaga: c, desligar: !c?.habilitado || !agente, permitido: Boolean(c?.habilitado && c.controle === r.computador.controle && c.operacaoId === r.operacao && c.ocupadoAte && c.ocupadoAte > d.agora() && agente && (!r.turnoId || await turnoPermitido(d, r.turnoId, c.agenteId, r.aprovado))) };
  }

  /** Os nomes dos bots que ocupam o computador (o supervisor diz os ids das telas); id que não é bot da pessoa sai. */
  async function nomesDosBots(escopo: Escopo, ids: readonly string[]): Promise<string[]> {
    if (!ids.length) return [];
    return o.dentro(escopo, async (d) => {
      const nomes: string[] = [];
      for (const id of ids.slice(0, 10)) {
        const a = /^[0-9a-f-]{36}$/i.test(id) ? await d.repos.agentes.buscar(id) : null;
        if (a && a.ownerId === escopo.pessoaId) nomes.push(a.nome);
      }
      return nomes;
    });
  }

  /**
   * NOD-96 PR 4: a tela do bot espera a vez (estado 'esperando', pela ordem de chegada). A cada fatia confere se ainda
   * pode (turno vivo, controle, reserva), renova a reserva e, quando é a primeira da fila que ainda espera de verdade
   * (com reserva viva), volta para tentar de novo. Passada a janela: EsperaEsgotada, com o lugar guardado.
   */
  async function esperarVez(escopo: Escopo, r: Reserva, quem: string[]): Promise<void> {
    if (r.turnoId) marcarEspera(r.turnoId, quem.length ? quem.join(", ") : "outros bots");
    let primeira = true;
    for (;;) {
      const vez = await o.dentro(escopo, async (d) => {
        const atual = await aindaPermitido(d, r);
        if (!atual.permitido || !atual.vaga?.telaId) return "nao" as const;
        await d.repos.computadorTelas.mudarEstado(atual.vaga.telaId, "esperando", d.agora());
        await lugar.ocupar(d, atual.vaga, r.operacao, d.agora() + LEASE_MS);
        const primeiraDaFila = (await d.repos.computadorTelas.fila(atual.vaga.computadorId)).find((t) => t.id === atual.vaga!.telaId || (t.ocupadoAte !== null && t.ocupadoAte > d.agora()));
        return primeiraDaFila?.id === atual.vaga.telaId ? "tentar" as const : "esperar" as const;
      });
      if (vez === "nao") throw new ErroDeDominio("nao_permitido");
      if (vez === "tentar" && !primeira) return;
      primeira = false;
      if (agora() >= (r.esperaAte ?? 0)) throw new EsperaEsgotada(quem);
      await dormir(FATIA_ESPERA_TELA_MS);
    }
  }

  async function executar(escopo: Escopo, r: Reserva): Promise<ResultadoComputador> {
    let estado: "concluida" | "falhou" = "falhou";
    let falha: FalhaComputador | null = null;
    let motivoSemFalha: MotivoFalhaComputador | null = null;
    let respondeu = false;
    let abriu = false;
    /** Esta ação pôs a tela na fila (esperarVez gravou 'esperando'). */
    let esperou = false;
    /** A janela acabou com o lugar guardado de propósito (EsperaEsgotada): a tela fica na fila. */
    let guardouLugar = false;
    try {
      await o.driver.iniciar(r.computador.id, escopo);
      respondeu = true;
      const estadoAtual = await o.dentro(escopo, (d) => aindaPermitido(d, r));
      if (!estadoAtual.permitido) { if (estadoAtual.desligar) await o.driver.parar(r.computador.id, escopo); throw new ErroDeDominio("nao_permitido"); }
      let resultado: ResultadoComputador;
      for (;;) {
        try {
          resultado = await o.driver.executar(r.computador.id, r.acao, escopo);
          break;
        } catch (e) {
          // Sem memória para a tela (régua, ADR-085/097): o bot espera a vez; a pessoa recebe "ocupado" na hora.
          if (!ehEsperandoTela(e) || r.esperaAte === undefined) throw e;
          esperou = true;
          await esperarVez(escopo, r, await nomesDosBots(escopo, e.quem));
        }
      }
      abriu = true;
      estado = resultado.codigoSaida !== undefined && resultado.codigoSaida !== 0 ? "falhou" : "concluida";
      return resultado;
    } catch (e) {
      // NOD-96 PR 4: só o bot na fila com a janela esgotada não falhou (o lugar fica guardado e ele chama de novo): o
      // registro sai concluído sem motivo. A ação da pessoa sem memória para a tela (409 esperando_tela) e a ação
      // aprovada que esgota a espera (não volta à fila sozinha) não foram executadas: falhou/ocupado, e a tela sai da fila.
      if (e instanceof EsperaEsgotada && !r.aprovado) { estado = "concluida"; guardouLugar = true; }
      else if (e instanceof EsperaEsgotada || ehEsperandoTela(e)) motivoSemFalha = "ocupado";
      if (ehFalhaComputador(e)) {
        falha = e;
        // A ação falhou numa máquina que RESPONDEU (tela alterada, ocupado…): ela está viva. O teto do host
        // (NOD-170) não é resposta nem falha da máquina: não zera nem soma falhas_seguidas.
        respondeu = !CONTA_PARA_SAUDE.has(e.motivo) && e.motivo !== "limite_de_computadores";
      }
      throw e;
    } finally {
      const saude = await o.dentro(escopo, async (d) => {
        const c = await lugar.travar(d, r.computador);
        await d.repos.computadores.concluir(r.registroId, estado, falha?.motivo ?? motivoSemFalha);
        await lugar.liberar(d, r.computador, r.operacao, d.agora());
        // A tela respondeu: saiu da fila (se estava) e está aberta; o relato do supervisor confirma depois.
        if (abriu && c?.telaId) await d.repos.computadorTelas.mudarEstado(c.telaId, "aberta", d.agora(), ["fechada", "esperando", "abrindo"]);
        // Saiu da espera por erro ou cancelamento (a pessoa assumiu, o turno acabou, o controle mudou): a tela não fica
        // presa em 'esperando' sem reserva até a ociosidade, nem segura o FIFO de `fila()`.
        else if (esperou && !guardouLugar && c?.telaId) await d.repos.computadorTelas.mudarEstado(c.telaId, "fechada", d.agora(), ["esperando"]);
        return registrarSaude(d, c, r.acao.tipo, falha, respondeu);
      });
      o.mudou(escopo, r.computador.agenteId, saude);
    }
  }
  /**
   * NOD-96 PR 4 (ADR-122): a ociosidade no computador da pessoa. Fecha a tela do bot sem atividade há `limiteMs` (com o
   * bot no controle e sem reserva), e põe a máquina para dormir quando nenhuma tela teve atividade no limite, nenhuma
   * está com a pessoa e nenhuma tem reserva. A tela que esperou na fila além do limite sem ninguém esperando por ela
   * (sem reserva viva) sai da fila. Reserva sob trava, como no docker; o `parar` vai fora da transação.
   */
  async function desligarOciososDaPessoa(escopo: Escopo, ligados: ReadonlySet<string>, limiteMs: number): Promise<number> {
    const operacao = randomUUID();
    const plano = await o.dentro(escopo, async (d) => {
      const p = await d.repos.computadores.daPessoa();
      if (!p) return null;
      const agora = d.agora();
      const ocupada = (t: TelaComputadorBot) => t.ocupadoAte !== null && t.ocupadoAte > agora;
      const fechar: TelaComputadorBot[] = [];
      for (const lida of await d.repos.computadorTelas.doComputador(p.id)) {
        if (lida.estado === "esperando" && !ocupada(lida) && (lida.esperandoDesde ?? agora) < agora - limiteMs) {
          await d.repos.computadorTelas.mudarEstado(lida.id, "fechada", agora, ["esperando"]);
          continue;
        }
        if (!ligados.has(lida.id) || lida.controle !== "bot" || ocupada(lida) || lida.ultimaAtividadeEm >= agora - limiteMs) continue;
        // Rechecar DEPOIS da trava: uma ação ou o assumir pode ter chegado entre a leitura e o lock.
        const t = await d.repos.computadorTelas.travar(lida.id);
        if (!t || t.controle !== "bot" || ocupada(t) || t.ultimaAtividadeEm >= agora - limiteMs) continue;
        await d.repos.computadorTelas.ocupar(t.id, operacao, agora + LEASE_OCIOSIDADE_MS * (fechar.length + 1));
        await d.repos.computadorTelas.mudarEstado(t.id, "fechando", agora);
        fechar.push(t);
      }
      const fechando = new Set(fechar.map((t) => t.id));
      const telas = await d.repos.computadorTelas.doComputador(p.id);
      const segura = (t: TelaComputadorBot) => !fechando.has(t.id) && (ocupada(t) || t.ultimaAtividadeEm >= agora - limiteMs || (t.estado !== "fechada" && t.controle !== "bot"));
      const deveDormir = ligados.has(p.id) && p.operacao === null && !telas.some(segura);
      return { p, fechar, deveDormir, abertas: telas.filter((t) => t.estado !== "fechada" && t.estado !== "esperando").map((t) => t.id) };
    });
    if (!plano) return 0;
    let desligados = 0;
    for (const t of plano.fechar) {
      try {
        await o.driver.parar(t.id, escopo);
        desligados++;
        log("info", "computador_tela_fechada_por_ociosidade", { computador_id: plano.p.id, tela_id: t.id, agente_id: t.agenteId, ocioso_min: Math.round(limiteMs / 60_000) });
      } catch (e) {
        log("aviso", "computador_ociosidade_falhou", { computador_id: plano.p.id, tela_id: t.id, agente_id: t.agenteId, motivo: ehFalhaComputador(e) ? e.motivo : "desconhecido" });
      } finally {
        await o.dentro(escopo, async (d) => {
          await d.repos.computadorTelas.mudarEstado(t.id, "fechada", d.agora(), ["fechando"]);
          await d.repos.computadorTelas.liberar(t.id, operacao);
        });
        o.mudou(escopo, t.agenteId);
      }
    }
    if (plano.deveDormir) {
      try {
        await o.driver.parar(plano.p.id, escopo);
        desligados++;
        await o.dentro(escopo, async (d) => { for (const id of plano.abertas) await d.repos.computadorTelas.mudarEstado(id, "fechada", d.agora(), ["aberta", "abrindo", "fechando"]); });
        log("info", "computador_desligado_por_ociosidade", { computador_id: plano.p.id, ocioso_min: Math.round(limiteMs / 60_000) });
      } catch (e) {
        log("aviso", "computador_ociosidade_falhou", { computador_id: plano.p.id, motivo: ehFalhaComputador(e) ? e.motivo : "desconhecido" });
      }
    }
    return desligados;
  }

  return {
    /** NOD-170: os computadores ligados neste host, lidos UMA vez por volta do varredor e fora de transação. */
    ligados: (): Promise<Set<string>> => o.driver.ligados(),
    /**
     * definido em 2026-10-05 (NOD-170): desliga os computadores desta pessoa que estão LIGADOS e sem atividade há
     * `limiteMs`. Reserva sob trava (a mesma do `livre()`) para o `parar` fora da transação, e libera sem tocar
     * a atividade. Não mexe em `habilitado`: a próxima ação do bot religa como antes. Devolve quantos desligou.
     */
    async desligarOciosos(escopo: Escopo, ligados: ReadonlySet<string>, limiteMs: number): Promise<number> {
      if (!ligados.size || limiteMs <= 0) return 0;
      if (porPessoa) return desligarOciososDaPessoa(escopo, ligados, limiteMs);
      const operacao = randomUUID();
      const alvos = await o.dentro(escopo, async (d) => {
        const agora = d.agora();
        const reservados: Computador[] = [];
        for (const c of await d.repos.computadores.ociosos(limiteMs, agora)) {
          if (!ligados.has(c.id)) continue;
          // Rechecar DEPOIS da trava: uma ação ou o assumir pode ter chegado entre a leitura e o lock.
          if (!await d.repos.computadores.travar(c.id)) continue;
          const [ainda] = await d.repos.computadores.ociosos(limiteMs, agora, c.id);
          if (!ainda) continue;
          // Os `parar` vão um depois do outro (até ~70 s cada): a reserva do N-ésimo cobre os N anteriores, senão
          // venceria antes da vez dele e uma ação do bot entraria na máquina que está sendo desligada.
          await d.repos.computadores.ocupar(c.id, operacao, agora + LEASE_OCIOSIDADE_MS * (reservados.length + 1));
          reservados.push(ainda);
        }
        return reservados;
      });
      let desligados = 0;
      for (const c of alvos) {
        try {
          await o.driver.parar(c.id, escopo);
          desligados++;
          log("info", "computador_desligado_por_ociosidade", { computador_id: c.id, agente_id: c.agenteId, ocioso_min: Math.round(limiteMs / 60_000) });
        } catch (e) {
          log("aviso", "computador_ociosidade_falhou", { computador_id: c.id, agente_id: c.agenteId, motivo: ehFalhaComputador(e) ? e.motivo : "desconhecido" });
        } finally {
          await o.dentro(escopo, (d) => d.repos.computadores.liberar(c.id, operacao));
          o.mudou(escopo, c.agenteId);
        }
      }
      return desligados;
    },
    async desligarExcluido(escopo: Escopo, agenteId: string): Promise<void> {
      const c = await o.dentro(escopo, async d => {
        const agente = await d.repos.agentes.buscar(agenteId, true);
        if (!agente?.excluidoEm || agente.ownerId !== escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
        if (porPessoa) {
          // NOD-96 PR 4: no computador da pessoa, excluir o bot fecha só a tela dele; a máquina e as outras telas seguem.
          const p = await d.repos.computadores.daPessoa();
          const t = p && await d.repos.computadorTelas.buscar(p.id, agenteId);
          if (!t) return null;
          await d.repos.computadorTelas.travar(t.id);
          await d.repos.computadorTelas.configurar(t.id, { controle: "pessoa" });
          await d.repos.computadorTelas.mudarEstado(t.id, "fechando", d.agora());
          return { id: t.id, telaId: t.id };
        }
        const c = await d.repos.computadores.buscarVinculo(agenteId);
        if (c) await d.repos.computadores.configurar(c.id, { habilitado: false, controle: "pessoa" });
        return c;
      });
      if (c) await o.driver.parar(c.id, escopo);
      if (c && "telaId" in c) await o.dentro(escopo, (d) => d.repos.computadorTelas.mudarEstado(c.telaId, "fechada", d.agora(), ["fechando"]));
      o.mudou(escopo, agenteId);
    },
    /**
     * definido em 2026-10-07 (NOD-192): abrir o painel só lê — sem FOR UPDATE (não disputa com o turno nem com uma
     * ação do mesmo bot) e sem criar a linha. Sem computador, devolve o padrão desligado e pergunta ao driver só o
     * ambiente (Docker, cofre, imagem): não há container para inspecionar. A 1ª ação cria, em `obter`.
     */
    async consultar(escopo: Escopo, agenteId: string): Promise<ComputadorDto> {
      const c = porPessoa ? await o.dentro(escopo, async (d) => {
        // NOD-96 PR 4: o painel do bot é a tela dele no computador da pessoa; só lê (sem criar nem travar).
        const agente = await d.repos.agentes.buscar(agenteId);
        if (!agente || agente.ownerId !== escopo.pessoaId) throw new ErroDeDominio("nao_encontrado");
        const p = await d.repos.computadores.daPessoa();
        const t = p && await d.repos.computadorTelas.buscar(p.id, agenteId);
        if (!p || !t) return null;
        const { computadorId: _c, telaId: _t, ...computador } = daTela(p, t);
        return { computador, atividade: await d.repos.computadores.atividadeDaTela(p.id, t.id) };
      }) : await o.dentro(escopo, async (d) => {
        const computador = await d.repos.computadores.buscarDoAgente(agenteId);
        if (computador === undefined) throw new ErroDeDominio("nao_encontrado");
        return computador && { computador, atividade: await d.repos.computadores.atividade(computador.id) };
      });
      if (!c) return { computador: computadorPadrao(agenteId), ativo: false, atividade: [], ...await o.driver.ambiente() };
      return { ...c, ...await o.driver.estado(c.computador.id, escopo) };
    },
    /**
     * revisto em 2026-10-22 (NOD-97, parte 3): `origem` diz de onde veio a troca (ORIGENS_CONTROLE; sem ela, "botao").
     * `devolver` com `fechou_tela` é o fetch keepalive da web ao fechar a tela no controle: vira no-op (sem registro,
     * sem linha no chat) com pedido de ajuda aberto, com o controle já do bot ou com o computador desligado — o
     * close e o pagehide mandam a mesma chamada duas vezes. Ele não espera a reserva (`livre`): é a última chance de
     * devolver, e a ação da pessoa em curso só termina. Devolvido, grava a linha cinza no chat e a máquina volta a
     * poder dormir (`ociosos()` só olha controle = 'bot').
     */
    async configurar(escopo: Escopo, agenteId: string, operacao: string, origem: OrigemControle = "botao"): Promise<void> {
      const operacaoId = randomUUID();
      let registroId: string | undefined;
      const fechouTela = operacao === "devolver" && origem === "fechou_tela";
      const c = await o.dentro(escopo, async (d) => {
        const c = await obter(d, agenteId);
        if (fechouTela && (c.ajudaDecisaoId !== null || c.controle === "bot" || !c.habilitado)) return null;
        // NOD-96 PR 4: assumir a tela que espera na fila não espera a vez (o laço da espera vê o controle mudar e sai).
        const naFila = c.telaId !== null && operacao === "assumir" && (await d.repos.computadorTelas.buscar(c.computadorId, agenteId))?.estado === "esperando";
        if (operacao !== "parar" && !naFila && !fechouTela) livre(c, d.agora());
        if (operacao === "assumir") await lugar.configurar(d, c, { controle: "pessoa", atividadeEm: d.agora() });
        else if (operacao === "devolver") {
          await lugar.configurar(d, c, { controle: "bot", ajuda: null, ajudaDecisaoId: null, atividadeEm: d.agora() });
          if (c.ajudaDecisaoId) {
            const decisao = await d.repos.decisoes.buscar(c.ajudaDecisaoId);
            if (decisao && (decisao.estado === "pendente" || decisao.estado === "reaberta")) {
              const r = await fecharComResposta(d, { decisaoId: decisao.id, texto: "Concluí o passo no computador e devolvi o controle. Observe a tela e continue." });
              if (r.events?.length) await d.repos.events.gravarComOutbox(r.events);
              const retomada = await retomarComResposta(d, { decisao: r.data.decisao, texto: "Concluí o passo no computador e devolvi o controle. Observe a tela e continue.", respondidaPor: { id: escopo.pessoaId, nome: "A pessoa" }, executor: o.executor() });
              if (retomada.events?.length) await d.repos.events.gravarComOutbox(retomada.events);
            }
          }
        } else if (operacao === "supervisionado" || operacao === "autonomo") await lugar.configurar(d, c, { politica: operacao });
        // NOD-96 PR 4: no computador da pessoa, "parar" fecha a tela deste bot (a pessoa assume; os outros bots seguem)
        // e "iniciar" volta o controle ao bot; a máquina liga na próxima ação.
        else if (operacao === "parar") {
          await lugar.configurar(d, c, { habilitado: false, controle: "pessoa" });
          if (c.telaId) await d.repos.computadorTelas.mudarEstado(c.telaId, "fechando", d.agora());
        } else if (operacao === "iniciar") await lugar.configurar(d, c, { habilitado: true, ...(c.telaId ? { controle: "bot" as const } : {}), atividadeEm: d.agora() });
        else throw new ErroDeDominio("entrada_invalida");
        if (operacao === "iniciar") await lugar.ocupar(d, c, operacaoId, d.agora() + LEASE_MS);
        registroId = (await lugar.registrar(d, c, { autor: "pessoa", tipo: operacao, estado: operacao === "iniciar" || operacao === "parar" ? "executando" : "concluida" })).id;
        if (fechouTela) await avisarTelaFechada(d, c);
        return c;
      });
      if (!c) return;
      // NOD-161: a tela mudou fora do bot; a próxima observação do turno vai completa.
      if (operacao === "assumir" || operacao === "devolver" || operacao === "parar") esquecerComputador(c.id);
      let sucesso = false;
      let falha: FalhaComputador | null = null;
      let ligou = false;
      try {
        if (operacao === "iniciar") {
          await o.driver.iniciar(c.id, escopo);
          ligou = true;
          const habilitado = await o.dentro(escopo, async d => (await lugar.travar(d, c))?.habilitado);
          if (!habilitado) { await o.driver.parar(c.id, escopo); throw new ErroDeDominio("estado_invalido"); }
        }
        if (operacao === "parar") await o.driver.parar(c.id, escopo);
        if (operacao === "parar" && c.telaId) await o.dentro(escopo, (d) => d.repos.computadorTelas.mudarEstado(c.telaId!, "fechada", d.agora(), ["fechando"]));
        sucesso = true;
      } catch (e) {
        if (ehFalhaComputador(e)) falha = e;
        throw comoErroDeDominio(e);
      } finally {
        const saude = await o.dentro(escopo, async d => {
          if (operacao === "iniciar") await lugar.liberar(d, c, operacaoId, d.agora());
          if (registroId) await d.repos.computadores.concluir(registroId, sucesso ? "concluida" : "falhou", falha?.motivo ?? null);
          // "Ligar" e "Tentar de novo" são o mesmo iniciar: ligou zera a saúde; não ligou conta como falha.
          if (operacao !== "iniciar" || (!ligou && !falha)) return false;
          return registrarSaude(d, await lugar.travar(d, c), "iniciar", ligou ? null : falha, ligou);
        });
        o.mudou(escopo, agenteId, saude);
      }
    },
    async humano(escopo: Escopo, agenteId: string, valor: unknown): Promise<ResultadoComputador> {
      const acao = validarAcaoComputador(valor);
      const r = await o.dentro(escopo, async (d) => {
        const c = await obter(d, agenteId);
        if (!c.habilitado || (acao.tipo !== "observar" && acao.tipo !== "arquivos" && acao.tipo !== "ler_arquivo" && acao.tipo !== "ler_texto" && acao.tipo !== "audio" && c.controle !== "pessoa")) throw new ErroDeDominio("nao_permitido");
        // Fora do ar: só "Tentar de novo" (iniciar) religa; a ação não vai ao Docker.
        if (c.indisponivelDesde !== null) throw new ErroDeDominio("estado_invalido", { cause: "computador fora do ar" });
        return reservar(d, c, acao, "pessoa");
      });
      return executar(escopo, r).catch((e: unknown) => { throw comoErroDeDominio(e); });
    },
    async chamar(escopo: Escopo, plano: PlanoTurno, nome: string, argumentos: unknown): Promise<ResultadoChamada> {
      let forcar = false;
      const resultado = await o.dentro(escopo, async (d): Promise<ResultadoChamada | Reserva> => {
        const negar = async (motivo: "parada_ativa" | "fora_do_catalogo" | "args_invalidos" | "capacidade_desligada" | "plano_expirado") => {
          const n = await registrarNegacao(d, { turnoId: plano.turnoId, agenteId: plano.agenteId, conversaId: plano.conversaId, nome, motivo, classe: "ferramenta_negada", autoria: plano.autoria });
          if (n.events?.length) await d.repos.events.gravarComOutbox(n.events);
          return { ok: false as const, negacao: n.data };
        };
        if (plano.tenantId !== escopo.tenantId || plano.autoria.conta_de_execucao !== escopo.pessoaId || !plano.catalogo.ferramentas.some((f) => f.nome === nome && f.origem === "computador")) return negar("fora_do_catalogo");
        if (plano.expiraEm <= d.agora()) return negar("plano_expirado");
        if (!await turnoPermitido(d, plano.turnoId, plano.agenteId)) return negar("parada_ativa");
        const schema = FERRAMENTAS_COMPUTADOR[nome as keyof typeof FERRAMENTAS_COMPUTADOR];
        if (!schema || errosDoSchema(schema, argumentos).length) return negar("args_invalidos");
        const c = await obter(d, plano.agenteId);
        if (!c.habilitado) return negar("capacidade_desligada");
        // definido em 2026-09-24 (emenda da ADR-037): fora do ar, a ferramenta responde na hora — sem
        // Docker, sem reserva. O plano seguinte já sai sem as ferramentas computador_*.
        if (c.indisponivelDesde !== null) return { ok: true, isError: true, conteudo: JSON.stringify(foraDoArParaAgente(c)), confianca: "confiavel" };
        if (c.controle !== "bot") { esquecerObservacao(plano.turnoId, c.id); return { ok: true, conteudo: JSON.stringify({ estado: "aguardando_pessoa", instrucao: "A pessoa está com o computador. Encerre o turno e aguarde a devolução." }), confianca: "confiavel" }; }
        const args = argumentos as Record<string, unknown>;
        // ADR-083 (S5): ocupado por outra ação (outra task do bot, a conversa ou a pessoa) volta como resultado.
        if (c.ocupadoAte && c.ocupadoAte > d.agora()) {
          const uso = (await lugar.emUsoPor(d, c)) ?? { titulo: "outra tarefa", deFora: false };
          marcarEspera(plano.turnoId, uso.titulo);
          // Revisão do épico (S24, 2026-10-08): o título de uma task de colega (ou que leu conteúdo de fora) é texto de
          // fora — o resultado vai marcado não confiável, como todo conteúdo de fora que entra no turno.
          return { ok: true, isError: true, conteudo: ocupadoParaAgente(uso.titulo, c.ocupadoAte, d.agora()), confianca: uso.deFora ? "nao_confiavel" : "confiavel" };
        }
        esperando.delete(plano.turnoId);
        if (nome === "computador_pedir_ajuda") {
          livre(c, d.agora());
          const motivo = String(args.motivo).slice(0, 1000);
          const ajuda = await pedirAjudaDoComputador(d, { turnoId: plano.turnoId, agenteId: plano.agenteId, conversaId: plano.conversaId, tipo: "pergunta", texto: textoPedidoDeTela(motivo) });
          await lugar.configurar(d, c, { controle: "aguardando_pessoa", ajuda: motivo, ajudaDecisaoId: ajuda.data.decisao_id });
          if (ajuda.events?.length) await d.repos.events.gravarComOutbox(ajuda.events);
          await lugar.registrar(d, c, { turnoId: plano.turnoId, autor: "bot", tipo: "pedir_ajuda", estado: "concluida" });
          esquecerObservacao(plano.turnoId, c.id);
          return { ok: true, conteudo: JSON.stringify(ajuda.data), confianca: "confiavel" };
        }
        let acao: AcaoComputador;
        try { acao = validarAcaoComputador({ ...args, ...(nome !== "computador_interagir" ? { tipo: nome.slice(11) } : {}), ...(nome === "computador_arquivos" ? { caminho: args.caminho ?? "." } : {}) }); }
        catch { return negar("args_invalidos"); }
        // definido em 2026-09-28 (emenda da ADR-037): "Pode fazer e o resto desta tarefa" dispensa o card nas próximas
        // ações da MESMA tarefa. Nunca vale em turno não confiável (ADR-026) nem depois da web (ADR-062: a marca de
        // 0033 ficava de fora, e o terminal já a olhava — autorizar-comando.ts).
        // revisto em 2026-10-01 (ADR-066): saiu o gate da rotina; quem pede a pessoa é a política do computador e o modo.
        const liberadaNaTarefa = plano.confiancaEntrada === "confiavel" && alteraComputador(acao) && !(await d.repos.turnos.contaminado(plano.turnoId)) && await computadorLiberadoNaTarefa(d, plano.turnoId);
        // ADR-059: o modo do bot aprova a ação no computador DELE como aprova o resto. Nada ali é "arriscado" no
        // sentido do Mac (o computador é isolado, ADR-037). ADR-066: conteúdo de fora não para o automático nem o total.
        const aprovadaPeloModo = async () => {
          const agente = await d.repos.agentes.buscar(plano.agenteId);
          return semRevisor(decidirPeloModo(agente?.modoAprovacao, { arriscada: false, credencial: false }))?.automatico === true;
        };
        if (alteraComputador(acao) && !liberadaNaTarefa && c.politica === "supervisionado" && !(await aprovadaPeloModo())) {
          const registro = await lugar.registrar(d, c, { turnoId: plano.turnoId, autor: "bot", tipo: acao.tipo, estado: "pendente", argumentosCifrados: o.cifrar(JSON.stringify(acao)) });
          const pedido = await pedirAprovacaoComputador(d, { turnoId: plano.turnoId, agenteId: plano.agenteId, conversaId: plano.conversaId, resumo: "Ação no computador do bot", itens: [{ texto: resumoAcaoComputador(acao), destino: { conector: "computador", ferramenta: "executar", argumentos: { acaoId: registro.id } } }] });
          if (pedido.events?.length) await d.repos.events.gravarComOutbox(pedido.events);
          if (pedido.data.estado !== "pendente") throw new ErroDeDominio("estado_invalido");
          esquecerObservacao(plano.turnoId, c.id);
          return { aguardar: pedido.data.decisao_id };
        }
        forcar = acao.tipo === "observar" && acao.forcar === true;
        return reservar(d, c, acao, "bot", plano.turnoId);
      });
      o.mudou(escopo, plano.agenteId);
      if (!("operacao" in resultado)) return resultado;
      try {
        const r = await executar(escopo, resultado);
        esperando.delete(plano.turnoId);
        const isError = r.codigoSaida !== undefined && r.codigoSaida !== 0;
        let imagem = r.tela?.imagem;
        let tela: Record<string, unknown> | undefined = r.tela ? { ...r.tela, imagem: undefined } : undefined;
        let aviso: string | undefined;
        // NOD-200: a captura é a tela que o bot viu, inclusive a repetida que a dedup abaixo omite ao modelo.
        if (o.guardarTelas && !isError && r.tela?.imagem && resultado.computador.controle === "bot") guardarTela(plano.turnoId, r.tela.imagem);
        // NOD-161: a tela igual à última entregue no turno sai sem imagem/texto. Resultado com erro não
        // conta como entregue e sai inteiro; quadro, url, título, abas e diálogo saem sempre.
        if (r.tela && !isError) {
          const chave = chaveObservacao(plano.turnoId, resultado.computador.id);
          const dedup = deduplicarObservacao(ultimaObservacao(chave), { imagem: sha256(r.tela.imagem), texto: sha256(r.tela.texto) }, forcar);
          if (dedup.omitirImagem) { imagem = undefined; aviso = AVISO_TELA_IGUAL; tela = { ...tela, tela_igual_a_anterior: true }; }
          if (dedup.omitirTexto) tela = { ...tela, texto: "", texto_igual_ao_anterior: true };
          // `texto` é descartado pelo log (dado pessoal); por isso imagem_igual/texto_igual.
          if (dedup.omitirImagem || dedup.omitirTexto) log("info", "computador_observacao_deduplicada", { computador_id: resultado.computador.id, imagem_igual: dedup.omitirImagem, texto_igual: dedup.omitirTexto, bytes_poupados: (dedup.omitirImagem ? r.tela.imagem.length : 0) + (dedup.omitirTexto ? r.tela.texto.length : 0) });
          if (r.tela.imagem) lembrarObservacao(chave, dedup.entregue);
        }
        return { ok: true, isError, conteudo: JSON.stringify({ ...r, audio: undefined, ...(tela ? { tela } : {}), ...(aviso ? { aviso } : {}) }), confianca: "nao_confiavel", ...(r.audio ? { audio: r.audio } : {}), ...(imagem ? { imagem: { mimeType: "image/png" as const, data: imagem } } : {}) };
      } catch (e) {
        // NOD-96 PR 4: a vez não chegou na janela; não é erro (o bot chama de novo e segue na fila).
        if (e instanceof EsperaEsgotada) return { ok: true, conteudo: esperandoTelaParaAgente(e.quem), confianca: "confiavel" };
        return { ok: true, isError: true, conteudo: JSON.stringify(erroDaFerramenta(nome, e)), confianca: "confiavel" };
      }
    },
    /** NOD-200: a última tela guardada do turno (base64), sem esquecer; null se não há. */
    ultimaTela,
    /** NOD-200: a ponte chama depois do assentar confirmado (serviço `capturas.esquecer`). */
    esquecerTurno(turnoId: string): void {
      telasDoTurno.delete(turnoId);
    },
    /** ADR-083 (S5): quem segurava o computador quando este turno o pediu pela última vez; null = não espera. */
    esperandoPor(turnoId: string): string | null {
      return esperando.get(turnoId) ?? null;
    },
    async executarAprovado(p: Escopo & { agenteId: string; turnoId: string; acaoId: string }): Promise<void> {
      const { r, tipo } = await o.dentro(p, async (d) => {
        const c = await obter(d, p.agenteId);
        if (!c.habilitado || c.controle !== "bot" || !await turnoPermitido(d, p.turnoId, p.agenteId, true)) throw new ErroDeDominio("nao_permitido");
        if (c.indisponivelDesde !== null) throw new ErroDeDominio("estado_invalido", { cause: "computador fora do ar" });
        const a = await d.repos.computadores.buscarAcao(p.acaoId);
        if (!a || a.computadorId !== c.computadorId || a.turnoId !== p.turnoId || a.estado !== "pendente" || !a.argumentosCifrados) throw new ErroDeDominio("estado_invalido");
        const acao = validarAcaoComputador(JSON.parse(o.decifrar(a.argumentosCifrados)));
        // O resultado aprovado volta sem imagem (guardar abaixo): o modelo não viu esta tela.
        esquecerObservacao(p.turnoId, c.id);
        return { r: await reservar(d, c, acao, "bot", p.turnoId, a.id), tipo: acao.tipo };
      });
      // definido em 2026-09-28 (0032): o resultado volta ao turno que esperava a aprovação — antes era jogado
      // fora, e a saída do terminal aprovado nunca chegava ao bot (11 casos de "a saída não voltou").
      // Cifrado como os argumentos (ADR-037) e apagado quando entregue (resultadoDaAcao).
      const guardar = (conteudo: unknown) => o.dentro(p, (d) => d.repos.computadores.gravarResultado(p.acaoId, o.cifrar(JSON.stringify(conteudo))));
      let resultado: Awaited<ReturnType<typeof executar>>;
      try {
        resultado = await executar(p, r);
      } catch (e) {
        if (e instanceof EsperaEsgotada) {
          // A ação aprovada não volta à fila sozinha: o turno recebe "ainda esperando" e o bot a pede de novo.
          await guardar(JSON.parse(esperandoTelaParaAgente(e.quem)));
          throw new ErroDeDominio("estado_invalido", { cause: "esperando_tela" });
        }
        await guardar(erroDaFerramenta(`computador_${tipo}`, e));
        throw e;
      }
      await guardar({ ...resultado, audio: undefined, ...(resultado.tela ? { tela: { ...resultado.tela, imagem: undefined } } : {}) });
      if (resultado.codigoSaida !== undefined && resultado.codigoSaida !== 0) throw new ErroDeDominio("estado_invalido");
    },
    /** 0032: o resultado da ação aprovada, uma vez, para o turno que a esperava; null se não há. */
    async resultadoDaAcao(escopo: Escopo, acaoId: string): Promise<string | null> {
      const cifrado = await o.dentro(escopo, (d) => d.repos.computadores.tirarResultado(acaoId));
      return cifrado ? o.decifrar(cifrado) : null;
    },
  };
}
export type Computadores = ReturnType<typeof criarComputadores>;
