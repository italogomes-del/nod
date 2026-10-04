import { FECHAMENTOS_VOZ, QUADRO_MICROFONE, QUADRO_MS, QUADRO_VOZ, TAXA_VOZ_HZ, type FaseLigacao, type MotivoFimLigacao, type MsgCerebroServidor, type MsgMidiaServidor, type TipoFalaBot } from "../../contracts/voz.ts";
import { ehEco } from "../../domain/ligacao-eco.ts";
import { escolherFala, FALAS_DE_ESPERA, TEMPOS_ESPERA, type CategoriaEspera, type EsperaTocada, type FalaDeEspera } from "../../domain/ligacao-espera.ts";
import { criarSegmentador, removerAberturaRepetida, textoFalavel } from "../../domain/ligacao-frases.ts";
import { ouvidoAte } from "../../domain/ligacao-ouvido.ts";
import { confirmaInterrupcao, ehBackchannel, esperaDeFimDeTurno, modoDeInterrupcao } from "../../domain/ligacao-turno.ts";
import { criarVad } from "../../domain/ligacao-vad.ts";
import { interpretarComando, validarComando, type PerfilComando } from "../../domain/comando-de-voz.ts";
import { sugestoesDoOnboarding } from "../../domain/roteiro-onboarding.ts";
import type { CamposEntrevista, EtapaOnboarding, PassoConfiguracao } from "../../contracts/onboarding.ts";
import { randomUUID } from "node:crypto";
import { log } from "../../obs/log.ts";
import type { ProvedoresVoz, ResultadoStt, SessaoStt } from "./spi.ts";
import { lerJson, type CanalVoz } from "./ws.ts";

/**
 * Orquestrador de voz (definido em 2026-10-04, ADR-071/073): uma `LigacaoViva` por ligação, em memória, dentro do
 * processo do nod. Liga a mídia (o microfone e o alto-falante do app) ao STT, decide a vez da pessoa, leva a vez ao
 * cérebro (o CLI no Mac), corta a resposta em trechos falados, toca falas de espera enquanto o cérebro pensa e trata a
 * interrupção. As regras são funções puras do domínio (src/domain/ligacao-*.ts); aqui só há relógio, canais e fila.
 *
 * Não importa banco: grava pelo `PersistenciaVoz` injetado na composição. Nenhum áudio é guardado; o texto falado
 * nunca vai para log.
 */

export type RefLigacao = { ligacaoId: string; tenantId: string; pessoaId: string; agenteId: string; conversaId: string; turnoId: string };

export type RegistroLigacao = RefLigacao & {
  voz: string;
  velocidade: number;
  nomeBot: string;
  genero: "feminina" | "masculina";
  /** Teto da ligação em segundos. */
  maxS: number;
  onboarding?: boolean;
  /** Vocabulário para o STT (nomes de bots e apps). */
  vocabulario?: readonly string[];
  /** ADR-077: a primeira fala, no lugar de "Oi! Aqui é {bot}." (o roteiro do onboarding). */
  saudacao?: string;
  /**
   * ADR-077: a ligação do onboarding nasce tocando antes do consentimento (o "Atender" é o consentimento). Até
   * `liberar`, a mídia é recusada (4403): nenhum áudio sobe sem o aceite gravado.
   */
  aguardandoConsentimento?: boolean;
};

/** O que o orquestrador precisa do onboarding para conduzir a ligação (ADR-077): a etapa, os campos e o passo. */
export type EstadoVozOnboarding = { etapa: EtapaOnboarding | null; campos: CamposEntrevista; passo: PassoConfiguracao; nomeBot: string | null; pessoaNome: string | null };

export type FalaParaGravar = { seq: number; autor: "pessoa" | "bot"; tipo: "fala" | "texto" | "leitura"; texto: string; inicioMs: number; fimMs: number; interrompida: boolean; confianca?: number | null };

export type MetricasVoz = {
  trocas: number;
  interrupcoes: number;
  sttSegundos: number;
  ttsCaracteres: number;
  custoEstimadoUsd: number | null;
  latenciaP50Ms: number | null;
  latenciaP95Ms: number | null;
};

export interface PersistenciaVoz {
  atender(ref: RefLigacao): Promise<void>;
  gravarFala(ref: RefLigacao, fala: FalaParaGravar): Promise<void>;
  encerrar(ref: RefLigacao, motivo: MotivoFimLigacao, metricas: MetricasVoz): Promise<void>;
  /** O que não cabe na fala (código, tabela, link, resto de resposta longa) vai para o chat como mensagem do bot. */
  mandarNoChat?(ref: RefLigacao, texto: string): Promise<void>;
  /** ADR-077: o estado do onboarding da pessoa (só nas ligações de onboarding). */
  estadoOnboarding?(ref: RefLigacao): Promise<EstadoVozOnboarding | null>;
}

/** Clipes das falas de espera já sintetizados (falas-de-espera.ts); ausente = nenhuma espera toca. */
export interface FonteDeEsperas {
  obterPronto(fala: FalaDeEspera, voz: string, velocidade: number): Int16Array | null;
  aquecer(falas: readonly FalaDeEspera[], voz: string, velocidade: number): void;
}

export type DepsVoz = {
  provedores: ProvedoresVoz;
  persistencia: PersistenciaVoz;
  esperas?: FonteDeEsperas;
  relogio?: () => number;
  aleatorio?: () => number;
  /** Prazos (testes encurtam). */
  prazos?: Partial<typeof PRAZOS_PADRAO>;
};

export const PRAZOS_PADRAO = {
  /** Mídia caída: espera reconectar antes de encerrar. */
  midiaReconexaoMs: 10_000,
  /** Cérebro caído (Mac dormiu, rede): espera o laço religar. */
  cerebroReconexaoMs: 20_000,
  /** Depois de atender, o cérebro tem este prazo para aparecer. */
  cerebroPrimeiroMs: 30_000,
  /** Interrupção não confirmada: o volume volta. */
  confirmarInterrupcaoMs: 1_200,
  /** Fala da pessoa com o bot falando: confirma a interrupção a partir deste tanto de fala. */
  interrupcaoPorFalaMs: 600,
  /** O resumo final do cérebro depois do `fim`. */
  resumoMs: 30_000,
  /** Silêncio total da ligação (sem ninguém falar) antes da despedida. */
  ociosidadeMs: 180_000,
  /** ADR-077: a ligação do onboarding toca por até 2 min esperando o "Atender"; depois vira não atendida. */
  naoAtendidaMs: 120_000,
};

/** definido em 2026-10-04: a pessoa que volta a falar até 3 s depois da vez, sem o bot ter dito nada, refaz a vez. */
const JANELA_REFAZER_VEZ_MS = 3_000;
/** definido em 2026-10-04: pré-roll do STT — o começo da fala que o VAD só confirma depois de 3 quadros. */
const PRE_ROLL_QUADROS = 15;
/** definido em 2026-10-04: pedaço de voz mandado ao cliente (100 ms a 24 kHz). */
const AMOSTRAS_POR_PEDACO = 2400;
/** definido em 2026-10-04: áudio subindo acima de 1,2× o tempo real (com 2 s de folga) é abuso e fecha a conexão. */
const FATOR_ABUSO = 1.2;

/** Preço de lista por provedor (definido em 2026-10-04, docs/plano-modo-ligacao.md "Custos"). */
const PRECOS: Record<string, { sttPorSegundo: number; ttsPorCaractere: number }> = {
  google: { sttPorSegundo: 0.0089 / 60, ttsPorCaractere: 30 / 1_000_000 },
};

export interface ServicoVoz {
  registrar(r: RegistroLigacao): void;
  existe(ligacaoId: string): boolean;
  /** ADR-077: o consentimento foi gravado (o "Atender" do onboarding): a mídia pode abrir. */
  liberar(ligacaoId: string): void;
  anexarMidia(p: { pessoaId: string; ligacaoId: string; retomar: boolean; canal: CanalVoz }): number | null;
  anexarCerebro(p: { turnoId: string; ligacaoId: string; canal: CanalVoz }): number | null;
  encerrar(ligacaoId: string, motivo: MotivoFimLigacao): Promise<void>;
  /** Aviso do sistema ao cérebro (resultado de tarefa, decisão): vira `[nod] …`; com `falar`, o bot responde em voz numa brecha. */
  nota(ligacaoId: string, texto: string, confiavel: boolean, falar?: boolean): void;
  vivas(): number;
  /** ADR-074: um card pendente na conversa da ligação — o bot o lê e abre a janela de aprovação por voz. */
  pedirAprovacao(ligacaoId: string, p: PedidoAprovacaoVoz): void;
  /** A rota de decisão confere (e gasta) o comando de voz antes de decidir: só vale uma vez, por 10 s. */
  conferirComando(p: { pessoaId: string; ligacaoId: string; comandoId: string; decisaoId: string; acao: "aprovar" | "recusar" }): boolean;
  /** A decisão foi decidida (por voz ou clique): fecha a janela e conta o resultado. */
  decisaoDecidida(ligacaoId: string, p: { decisaoId: string; resultado: "aprovado" | "recusado" | "decidido"; porVoz: boolean }): void;
  /** A ligação viva de uma conversa (para ligar os frames da conversa à ligação). */
  daConversa(pessoaId: string, conversaId: string): string | null;
  /** Para de aceitar ligação nova e encerra as vivas com aviso (deploy). */
  drenar(motivo?: MotivoFimLigacao): Promise<void>;
  drenando(): boolean;
  /** Deploy (SIGTERM): recusa ligação nova e avisa as vivas falando; elas seguem até acabar ou até o prazo. */
  iniciarDrenagem(): void;
  fechar(): Promise<void>;
}

function percentil(valores: readonly number[], p: number): number | null {
  if (valores.length === 0) return null;
  const ord = [...valores].sort((a, b) => a - b);
  return Math.round(ord[Math.min(ord.length - 1, Math.floor((p / 100) * ord.length))]!);
}

export function quadroDeVoz(seq: number, utt: number, pcm: Int16Array): Uint8Array {
  const buf = new Uint8Array(7 + pcm.byteLength);
  const v = new DataView(buf.buffer);
  v.setUint8(0, QUADRO_VOZ);
  v.setUint32(1, seq >>> 0, true);
  v.setUint16(5, utt & 0xffff, true);
  buf.set(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength), 7);
  return buf;
}

export function lerQuadroMicrofone(b: Uint8Array): { seq: number; pcm: Int16Array } | null {
  if (b.byteLength < 5 || b[0] !== QUADRO_MICROFONE || (b.byteLength - 5) % 2 !== 0) return null;
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const copia = b.slice(5);
  return { seq: v.getUint32(1, true), pcm: new Int16Array(copia.buffer, copia.byteOffset, copia.byteLength / 2) };
}

export type PedidoAprovacaoVoz = { decisaoId: string; leitura: string; perfil: PerfilComando };

type Utt = { utt: number; tipo: TipoFalaBot; texto: string; duracaoMs: number; tocadoMs: number; fim: boolean; n: number | null; enviadoEm: number; fimEm?: number; aoTerminar?: () => void };
type ItemFila = { tipo: TipoFalaBot; texto: string; n: number | null; pcm?: Int16Array; aoTerminar?: () => void };

export function criarServicoVoz(deps: DepsVoz): ServicoVoz {
  const relogio = deps.relogio ?? (() => Date.now());
  const aleatorio = deps.aleatorio ?? Math.random;
  const prazos = { ...PRAZOS_PADRAO, ...deps.prazos };
  const ligacoes = new Map<string, ReturnType<typeof criarLigacaoViva>>();
  let emDrenagem = false;

  function criarLigacaoViva(r: RegistroLigacao) {
    const r0 = r;
    const ref: RefLigacao = { ligacaoId: r.ligacaoId, tenantId: r.tenantId, pessoaId: r.pessoaId, agenteId: r.agenteId, conversaId: r.conversaId, turnoId: r.turnoId };
    const inicio = relogio();
    let midia: CanalVoz | null = null;
    let cerebro: CanalVoz | null = null;
    let stt: SessaoStt | null = null;
    let abrindoStt: Promise<void> | null = null;
    let encerrada = false;
    let atendida = false;
    let mudo = false;
    let fase: FaseLigacao = "chamando";
    const vad = criarVad();
    const preRoll: Int16Array[] = [];
    let falando = false;
    let inicioFalaEm = 0;
    let fimFalaEm = 0;
    let legendaId = 0;
    let seqFala = 0;
    let seqQuadro = 0;
    let uttSeq = 0;
    let nVez = 0;
    let vezAtual = 0;
    let vezCancelada = -1;
    let vezEm = 0;
    let primeiroSomDaVez = true;
    let ferramentaRodando: string | null = null;
    let textoDaVez = "";
    // Início e fim de cada trecho de fala, na ordem: o final do STT chega depois (whisper) e às vezes com outro trecho já
    // começado — a transcrição e o eco usam os tempos do trecho certo.
    const trechos: { inicio: number; fim: number }[] = [];
    let vezRefeita = false;
    let proximoOuvido: string | null = null;
    let ultimaEspera: { categoria: CategoriaEspera; texto: string } | null = null;
    let respostaTexto = "";
    let respostaFoiProChat = false;
    let botPerguntou = false;
    let ultimaAtividadeEm = relogio();
    let audioRecebidoMs = 0;
    let midiaDesde = 0;
    let sttSegundos = 0;
    let ttsCaracteres = 0;
    let trocas = 0;
    let interrupcoes = 0;
    const latencias: number[] = [];
    const historicoEspera: EsperaTocada[] = [];
    const utts = new Map<number, Utt>();
    const fila: ItemFila[] = [];
    let tocandoFila = false;
    let abortTts: AbortController | null = null;
    const pendente: { textos: string[]; timer: ReturnType<typeof setTimeout> | null } = { textos: [], timer: null };
    const barge: { ativa: boolean; desde: number; timer: ReturnType<typeof setTimeout> | null; confirmado: boolean } = { ativa: false, desde: 0, timer: null, confirmado: false };
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let timersEspera: ReturnType<typeof setTimeout>[] = [];
    let timerMidiaCaida: ReturnType<typeof setTimeout> | null = null;
    let timerCerebroCaido: ReturnType<typeof setTimeout> | null = null;
    let timerCerebroPrimeiro: ReturnType<typeof setTimeout> | null = null;
    let timerOciosidade: ReturnType<typeof setTimeout> | null = null;
    const notasPendentes: string[] = [];
    const vezesSemCerebro: { n: number; texto: string; ouvidoAte?: string }[] = [];
    let saudou = false;
    let liberada = r.aguardandoConsentimento !== true;
    const saudacao = r.saudacao ?? `Oi! Aqui é ${r.nomeBot}.`;

    const agendar = (ms: number, fn: () => void): ReturnType<typeof setTimeout> => {
      const t = setTimeout(() => {
        timers.delete(t);
        try {
          fn();
        } catch (e) {
          log("erro", "voz_timer_falhou", { ligacao_id: r.ligacaoId, erro: e instanceof Error ? e.name : "desconhecido" });
        }
      }, Math.max(0, ms));
      timers.add(t);
      return t;
    };
    const cancelar = (t: ReturnType<typeof setTimeout> | null) => {
      if (t) {
        clearTimeout(t);
        timers.delete(t);
      }
    };
    const paraMidia = (m: MsgMidiaServidor) => midia?.enviarJson(m);
    const paraCerebro = (m: MsgCerebroServidor) => cerebro?.enviarJson(m);
    const mudarFase = (f: FaseLigacao, rotulo?: string) => {
      fase = f;
      paraMidia({ t: "estado", fase: f, ...(rotulo ? { rotulo } : {}) });
    };
    const msDesdeInicio = () => relogio() - inicio;
    const seguro = (p: Promise<unknown>, evento: string) => {
      p.catch((e: unknown) => log("erro", evento, { ligacao_id: r.ligacaoId, erro: e instanceof Error ? e.name : "desconhecido" }));
    };

    function gravarFala(f: Omit<FalaParaGravar, "seq">): void {
      if (f.texto.trim() === "") return;
      const fala = { ...f, seq: seqFala++ };
      seguro(deps.persistencia.gravarFala(ref, fala), "voz_gravar_fala_falhou");
    }

    function botTocando(): boolean {
      const agora = relogio();
      for (const u of utts.values()) {
        // Sem relato do cliente, a fala acaba pela duração (+500 ms de folga).
        if (!u.fim && agora - u.enviadoEm < u.duracaoMs + 500) return true;
      }
      return tocandoFila;
    }

    function reiniciarOciosidade(): void {
      ultimaAtividadeEm = relogio();
      cancelar(timerOciosidade);
      timerOciosidade = agendar(prazos.ociosidadeMs, () => {
        if (encerrada) return;
        tocarEspera("ociosidade_final");
        agendar(4_000, () => void encerrar("ociosidade"));
      });
    }

    // ---- falas de espera --------------------------------------------------------------------------------------------

    function tocarEspera(categoria: CategoriaEspera, ferramenta?: string): boolean {
      if (!deps.esperas || encerrada || !midia || janela || lendo) return false;
      const fala = escolherFala(categoria, historicoEspera, relogio(), aleatorio, ferramenta);
      if (!fala) return false;
      const pcm = deps.esperas.obterPronto(fala, r.voz, r.velocidade);
      if (!pcm) return false;
      historicoEspera.push({ id: fala.id, categoria, em: relogio() });
      ultimaEspera = { categoria, texto: fala.texto };
      enfileirar({ tipo: "espera", texto: fala.texto, n: null, pcm });
      return true;
    }

    function cancelarEsperas(): void {
      for (const t of timersEspera) cancelar(t);
      timersEspera = [];
    }

    function agendarEsperasDaVez(n: number, texto: string): void {
      cancelarEsperas();
      const social = texto.split(/\s+/).length <= 3;
      const reconhecer = !r.onboarding && !social && aleatorio() < 0.4;
      if (reconhecer) timersEspera.push(agendar(TEMPOS_ESPERA.reconhecimentoMs, () => { if (vezAtual === n && primeiroSomDaVez) tocarEspera("reconhecimento"); }));
      timersEspera.push(agendar(TEMPOS_ESPERA.pensandoMs, () => { if (vezAtual === n && primeiroSomDaVez && !ferramentaRodando) tocarEspera("pensando"); }));
      timersEspera.push(agendar(TEMPOS_ESPERA.pensandoLongoMs, () => { if (vezAtual === n && primeiroSomDaVez && !ferramentaRodando) tocarEspera("pensando_longo"); }));
    }

    // ---- voz do bot: fila e TTS -------------------------------------------------------------------------------------

    function enfileirar(item: ItemFila): void {
      fila.push(item);
      if (!tocandoFila) void tocarFila();
    }

    async function tocarFila(): Promise<void> {
      tocandoFila = true;
      try {
        while (fila.length > 0 && !encerrada) {
          const item = fila.shift()!;
          if (item.n !== null && item.n === vezCancelada) continue;
          await tocarItem(item);
        }
      } finally {
        tocandoFila = false;
        if (!encerrada && fila.length === 0 && (fase === "falando" || fase === "pensando") && vezRespondida) mudarFase("ouvindo");
        if (!encerrada && filaDecisoes.length > 0) agendar(300, proximaDecisao);
        if (!encerrada && notasParaFalar.length > 0) agendar(700, proximaNota);
      }
    }

    let vezRespondida = true;

    async function tocarItem(item: ItemFila): Promise<void> {
      const utt = ++uttSeq;
      const u: Utt = { utt, tipo: item.tipo, texto: item.texto, duracaoMs: 0, tocadoMs: 0, fim: false, n: item.n, enviadoEm: relogio(), aoTerminar: item.aoTerminar };
      utts.set(utt, u);
      paraMidia({ t: "bot-fala", utt, tipo: item.tipo, texto: item.texto });
      if (item.tipo === "conteudo" || item.tipo === "leitura" || item.tipo === "aviso") mudarFase("falando");
      const mandar = (pcm: Int16Array) => {
        for (let i = 0; i < pcm.length; i += AMOSTRAS_POR_PEDACO) {
          const pedaco = pcm.subarray(i, Math.min(pcm.length, i + AMOSTRAS_POR_PEDACO));
          midia?.enviarBinario(quadroDeVoz(seqQuadro++, utt, pedaco));
          u.duracaoMs += (pedaco.length / TAXA_VOZ_HZ) * 1000;
        }
      };
      const primeiroSom = () => {
        if (item.n !== null && item.n === vezAtual && primeiroSomDaVez) {
          primeiroSomDaVez = false;
          latencias.push(relogio() - vezEm);
        }
      };
      const agendarFim = () => {
        // Sem `tocou-fim` do cliente, a fala acaba pela duração (+500 ms).
        if (u.aoTerminar) agendar(Math.max(0, u.enviadoEm + u.duracaoMs + 500 - relogio()), () => terminarUtt(u));
      };
      if (item.pcm) {
        primeiroSom();
        mandar(item.pcm);
        agendarFim();
        return;
      }
      const ac = new AbortController();
      abortTts = ac;
      ttsCaracteres += item.texto.length;
      try {
        for await (const pcm of deps.provedores.tts.sintetizar({ texto: item.texto, voz: r.voz, velocidade: r.velocidade, sinal: ac.signal })) {
          if (ac.signal.aborted || encerrada) break;
          if (item.n !== null && item.n === vezCancelada) break;
          primeiroSom();
          mandar(pcm);
        }
      } catch (e) {
        if (!ac.signal.aborted) {
          log("aviso", "voz_tts_falhou", { ligacao_id: r.ligacaoId, erro: e instanceof Error ? e.name : "desconhecido" });
          // Sem voz, a ligação segue com a legenda: o texto já saiu em `bot-fala`.
          paraMidia({ t: "aviso", texto: "A voz falhou nesta frase; ela está na legenda." });
        }
      } finally {
        if (abortTts === ac) abortTts = null;
        agendarFim();
      }
    }

    function terminarUtt(u: Utt): void {
      u.fim = true;
      u.fimEm ??= relogio();
      const fn = u.aoTerminar;
      u.aoTerminar = undefined;
      fn?.();
    }

    function falarConteudo(texto: string, n: number | null, tipo: TipoFalaBot = "conteudo"): void {
      const { falavel, foiProChat } = textoFalavel(texto);
      if (foiProChat) respostaFoiProChat = true;
      const limpo = n !== null && ultimaEspera?.categoria === "reconhecimento" ? removerAberturaRepetida(falavel, ultimaEspera.texto) : falavel;
      if (limpo.trim() === "") return;
      enfileirar({ tipo, texto: limpo, n });
    }

    // ---- interrupção ------------------------------------------------------------------------------------------------

    function uttAtual(): Utt | null {
      let ultima: Utt | null = null;
      for (const u of utts.values()) if (!u.fim) ultima = u;
      return ultima;
    }

    function interromperBot(textoPessoa: string): void {
      const atual = uttAtual();
      cancelarEsperas();
      fila.length = 0;
      abortTts?.abort();
      if (atual) paraMidia({ t: "interromper", utt: atual.utt });
      interrupcoes++;
      // O que a pessoa ouviu da resposta em curso: frases inteiras já tocadas + a parcial cortada numa palavra.
      const daVez = [...utts.values()].filter((u) => u.n !== null && u.n === vezAtual && u.tipo === "conteudo");
      const ouvido = ouvidoAte({ frases: daVez.map((u) => ({ texto: u.texto, duracaoMs: u.duracaoMs || 1 })), tocadoMs: daVez.reduce((s, u) => s + (u.fim ? u.duracaoMs : u.tocadoMs), 0) });
      for (const u of utts.values()) u.fim = true;
      if (vezAtual > 0 && !vezRespondida) {
        vezCancelada = vezAtual;
        if (ouvido.trim() !== "") gravarFala({ autor: "bot", tipo: "fala", texto: ouvido, inicioMs: msDesdeInicio(), fimMs: msDesdeInicio(), interrompida: true });
        proximoOuvido = ouvido;
        paraCerebro({ t: "interromper", modo: modoDeInterrupcao({ texto: textoPessoa, ferramentaRodando: ferramentaRodando !== null }) });
        vezRespondida = true;
      }
      mudarFase("ouvindo");
    }

    function confirmarBarge(texto: string): void {
      if (!barge.ativa || barge.confirmado) return;
      barge.confirmado = true;
      cancelar(barge.timer);
      interromperBot(texto);
    }

    function iniciarBarge(): void {
      barge.ativa = true;
      barge.confirmado = false;
      barge.desde = relogio();
      cancelar(barge.timer);
      const verificar = () => {
        // A pessoa ainda está falando: espera mais (o final do STT pode confirmar depois).
        if (!barge.confirmado && barge.ativa && falando) {
          barge.timer = agendar(300, verificar);
          return;
        }
        if (!barge.confirmado && barge.ativa) {
          barge.ativa = false;
          const atual = uttAtual();
          if (atual) paraMidia({ t: "subir", utt: atual.utt });
        }
      };
      barge.timer = agendar(prazos.confirmarInterrupcaoMs, verificar);
    }

    // ---- aprovação por voz (ADR-074) --------------------------------------------------------------------------------

    const filaDecisoes: PedidoAprovacaoVoz[] = [];
    let lendo: PedidoAprovacaoVoz | null = null;
    let janela: { pedido: PedidoAprovacaoVoz; abertaEm: number; timer: ReturnType<typeof setTimeout>; pediuDeNovo: boolean } | null = null;
    const comandos = new Map<string, { decisaoId: string; acao: "aprovar" | "recusar"; criadoEm: number; usado: boolean }>();

    function emBrecha(): boolean {
      return !botTocando() && vezRespondida && pendente.textos.length === 0 && !falando;
    }

    function proximaDecisao(): void {
      if (encerrada || lendo || janela || filaDecisoes.length === 0 || !midia) return;
      if (!emBrecha()) {
        agendar(400, proximaDecisao);
        return;
      }
      lerDecisao(filaDecisoes.shift()!);
    }

    function lerDecisao(pedido: PedidoAprovacaoVoz): void {
      lendo = pedido;
      gravarFala({ autor: "bot", tipo: "leitura", texto: pedido.leitura, inicioMs: msDesdeInicio(), fimMs: msDesdeInicio(), interrompida: false });
      enfileirar({ tipo: "leitura", texto: pedido.leitura, n: null, aoTerminar: () => agendar(300, () => abrirJanela(pedido)) });
    }

    function abrirJanela(pedido: PedidoAprovacaoVoz): void {
      if (encerrada || lendo !== pedido) return;
      lendo = null;
      const ate = relogio() + 20_000;
      janela = { pedido, abertaEm: relogio(), pediuDeNovo: false, timer: agendar(20_000, () => fecharJanela(pedido.decisaoId)) };
      paraMidia({ t: "janela", decisaoId: pedido.decisaoId, ate });
      mudarFase("ouvindo");
    }

    function fecharJanela(decisaoId: string): void {
      if (!janela || janela.pedido.decisaoId !== decisaoId) return;
      cancelar(janela.timer);
      janela = null;
      paraMidia({ t: "janela-fechada", decisaoId });
      agendar(300, proximaDecisao);
    }

    function falarAviso(texto: string): void {
      gravarFala({ autor: "bot", tipo: "fala", texto, inicioMs: msDesdeInicio(), fimMs: msDesdeInicio(), interrompida: false });
      enfileirar({ tipo: "aviso", texto, n: null });
    }

    /** Uma fala final dentro da janela: comando (gramática fechada) ou fala normal, que fecha a janela. */
    function tratarNaJanela(texto: string): boolean {
      // A fala tem de ter sido DETECTADA depois da abertura (o pré-roll de 60 ms não conta).
      if (!janela || inicioFalaEm + 3 * QUADRO_MS < janela.abertaEm) return false;
      const r = interpretarComando(texto, janela.pedido.perfil, r0.nomeBot);
      if (r.acao === "aprovar" || r.acao === "recusar") {
        const comandoId = randomUUID();
        comandos.set(comandoId, { decisaoId: janela.pedido.decisaoId, acao: r.acao, criadoEm: relogio(), usado: false });
        paraMidia({ t: "comando", comandoId, decisaoId: janela.pedido.decisaoId, acao: r.acao });
        const decisaoId = janela.pedido.decisaoId;
        cancelar(janela.timer);
        janela.timer = agendar(5_000, () => {
          if (janela?.pedido.decisaoId === decisaoId) {
            falarAviso("Não consegui registrar. Aprova na tela, por favor.");
            fecharJanela(decisaoId);
          }
        });
        return true;
      }
      if (r.acao === "repetir") {
        const pedido = janela.pedido;
        cancelar(janela.timer);
        janela = null;
        lerDecisao(pedido);
        return true;
      }
      if (r.acao === "confirmar_de_novo" && !janela.pediuDeNovo) {
        janela.pediuDeNovo = true;
        falarAviso(janela.pedido.perfil === "estrito" ? "Para aprovar, diga: eu aprovo." : "Pode confirmar? Diga: pode criar.");
        return true;
      }
      fecharJanela(janela.pedido.decisaoId);
      return false;
    }

    function pedirAprovacao(pedido: PedidoAprovacaoVoz): void {
      if (filaDecisoes.some((p) => p.decisaoId === pedido.decisaoId) || lendo?.decisaoId === pedido.decisaoId || janela?.pedido.decisaoId === pedido.decisaoId) return;
      filaDecisoes.push(pedido);
      proximaDecisao();
    }

    function conferirComando(comandoId: string, decisaoId: string, acao: "aprovar" | "recusar"): boolean {
      const c = comandos.get(comandoId);
      if (!c || c.decisaoId !== decisaoId || c.acao !== acao || !validarComando(c, relogio())) return false;
      c.usado = true;
      return true;
    }

    function decisaoDecidida(decisaoId: string, resultado: "aprovado" | "recusado" | "decidido", porVoz: boolean): void {
      const idx = filaDecisoes.findIndex((p) => p.decisaoId === decisaoId);
      if (idx >= 0) filaDecisoes.splice(idx, 1);
      const estavaNaJanela = janela?.pedido.decisaoId === decisaoId || lendo?.decisaoId === decisaoId;
      if (lendo?.decisaoId === decisaoId) lendo = null;
      if (janela?.pedido.decisaoId === decisaoId) fecharJanela(decisaoId);
      if (porVoz || estavaNaJanela) falarAviso(resultado === "aprovado" ? "Pronto, aprovado." : resultado === "recusado" ? "Ok, recusado." : "Pronto, registrado.");
      nota(`A pessoa ${resultado === "aprovado" ? "aprovou" : resultado === "recusado" ? "recusou" : "decidiu"}${porVoz ? " por voz" : " na tela"} um pedido seu. Isso já foi dito a ela; não repita.`);
      atualizarOnboarding();
    }

    // ---- onboarding (ADR-077) ----------------------------------------------------------------------------------------

    /**
     * Relê o onboarding e manda à mídia a etapa com os campos (o painel "O que você contou"; `configurando` encolhe
     * para a pílula) e os chips "Diga algo como" da etapa. Só nas ligações de onboarding; o banco é da composição.
     */
    function atualizarOnboarding(): void {
      const ler = deps.persistencia.estadoOnboarding;
      if (!r.onboarding || !ler || encerrada) return;
      ler(ref)
        .then((e) => {
          if (!e || encerrada) return;
          if (e.etapa === "entrevista" || e.etapa === "configurando") paraMidia({ t: "onboarding", etapa: e.etapa, campos: e.campos });
          paraMidia({ t: "sugestoes", itens: sugestoesDoOnboarding({ etapa: e.etapa, campos: e.campos, pessoaNome: e.pessoaNome, passo: e.passo, nomeBot: e.nomeBot }) });
        })
        .catch((e: unknown) => log("aviso", "voz_onboarding_falhou", { ligacao_id: r.ligacaoId, erro: e instanceof Error ? e.name : "desconhecido" }));
    }
    function liberar(): void {
      liberada = true;
    }
    // A ligação do onboarding toca até o "Atender"; sem ele, vira não atendida (o onboarding segue sem voz).
    if (r.onboarding) agendar(prazos.naoAtendidaMs, () => { if (!atendida && !encerrada) void encerrar("nao_atendida"); });

    // ---- a vez da pessoa ----------------------------------------------------------------------------------------------

    function decidirVez(): void {
      cancelar(pendente.timer);
      pendente.timer = null;
      const texto = pendente.textos.join(" ").replace(/\s+/g, " ").trim();
      pendente.textos = [];
      if (texto === "" || encerrada) return;
      const n = ++nVez;
      vezAtual = n;
      vezEm = relogio();
      primeiroSomDaVez = true;
      vezRespondida = false;
      respostaTexto = "";
      respostaFoiProChat = false;
      segmentador = criarSegmentador();
      trocas++;
      const ouvido = proximoOuvido ?? undefined;
      proximoOuvido = null;
      textoDaVez = texto;
      // A vez refeita leva a fala inteira; o cérebro já viu o começo e precisa saber que aquela resposta não vale.
      const textoCerebro = vezRefeita ? `[nod] A pessoa ainda não tinha terminado; ignore a resposta anterior. A fala completa é:\n${texto}` : texto;
      vezRefeita = false;
      if (cerebro) paraCerebro({ t: "vez", n, texto: textoCerebro, ...(ouvido ? { ouvidoAte: ouvido } : {}) });
      else vezesSemCerebro.push({ n, texto: textoCerebro, ...(ouvido ? { ouvidoAte: ouvido } : {}) });
      mudarFase("pensando");
      agendarEsperasDaVez(n, texto);
    }

    /**
     * Refazer a vez (definido em 2026-10-04, plano "Camada de conversa"; teste do Marlon): a pessoa fez uma pausa no meio
     * do pensamento, a vez foi decidida, e ela voltou a falar antes de o bot dizer qualquer coisa. A resposta em curso é
     * descartada (interrupção dura no cérebro) e a fala inteira vira uma vez só — antes, cada pedaço virava uma resposta
     * ("Desculpa, não entendi").
     */
    function refazerVezSePreciso(agora: number): void {
      // Só antes de o cérebro mandar qualquer texto: depois disso a resposta já está saindo, e quem decide é a interrupção.
      if (vezAtual === 0 || vezRespondida || !primeiroSomDaVez || respostaTexto !== "" || ferramentaRodando || janela || lendo) return;
      if (agora - vezEm > JANELA_REFAZER_VEZ_MS || !textoDaVez) return;
      vezCancelada = vezAtual;
      vezRespondida = true;
      cancelarEsperas();
      fila.length = 0;
      abortTts?.abort();
      const atual = uttAtual();
      if (atual) paraMidia({ t: "interromper", utt: atual.utt });
      paraCerebro({ t: "interromper", modo: "duro" });
      pendente.textos = [textoDaVez];
      vezRefeita = true;
      mudarFase("ouvindo");
    }

    function agendarDecisao(): void {
      cancelar(pendente.timer);
      const texto = pendente.textos.join(" ");
      const espera = esperaDeFimDeTurno({ texto, botPerguntou, ditado: false });
      pendente.timer = agendar(fimFalaEm + espera - relogio(), decidirVez);
    }

    function aoResultadoStt(res: ResultadoStt): void {
      if (encerrada) return;
      const texto = res.texto.trim();
      if (!res.final) {
        if (texto === "") return;
        paraMidia({ t: "legenda", id: legendaId, texto, final: false });
        if (barge.ativa && !barge.confirmado && confirmaInterrupcao({ texto, falaMs: relogio() - barge.desde, ehEco: false, lendoConteudoNaoConfiavel: false })) confirmarBarge(texto);
        return;
      }
      const id = legendaId++;
      const trecho = trechos.shift();
      const iniT = trecho?.inicio ?? inicioFalaEm;
      const fimT = trecho && trecho.fim > 0 ? trecho.fim : fimFalaEm;
      if (texto === "") {
        // Fala longa que virou nada: pede para repetir (uma vez por trecho).
        if (fimT - iniT > 1_200 && !botTocando()) tocarEspera("nao_entendi");
        return;
      }
      // ADR-074: na janela de aprovação a guarda de eco por similaridade fica desligada — a frase de comando é justamente
      // a que o bot acabou de ler; quem protege é o tempo (só vale fala que começou depois da abertura).
      if (janela && !botTocando()) {
        paraMidia({ t: "legenda", id, texto, final: true });
        gravarFala({ autor: "pessoa", tipo: "fala", texto, inicioMs: iniT - inicio, fimMs: fimT - inicio, interrompida: false, confianca: res.confianca });
        if (tratarNaJanela(texto)) return;
        pendente.textos.push(texto);
        agendarDecisao();
        return;
      }
      const falasBot = [...utts.values()].filter((u) => u.tipo !== "espera").map((u) => ({ texto: u.texto, inicioMs: u.enviadoEm, fimMs: u.fimEm ?? u.enviadoEm + u.duracaoMs }));
      if (ehEco({ texto, inicioMs: iniT, fimMs: fimT, falasBot })) {
        log("info", "voz_eco_descartado", { ligacao_id: r.ligacaoId });
        return;
      }
      if (botTocando() && !barge.confirmado) {
        if (ehBackchannel(texto)) {
          // "uhum" com o bot falando: só a transcrição, sem interromper.
          gravarFala({ autor: "pessoa", tipo: "fala", texto, inicioMs: iniT - inicio, fimMs: fimT - inicio, interrompida: false, confianca: res.confianca });
          barge.ativa = false;
          const atual = uttAtual();
          if (atual) paraMidia({ t: "subir", utt: atual.utt });
          return;
        }
        // O final pode chegar depois da janela de confirmação (whisper local transcreve só no fim da fala): uma fala que
        // interrompe ("para", duas palavras de verdade) interrompe mesmo assim.
        if (confirmaInterrupcao({ texto, falaMs: fimT - iniT, ehEco: false, lendoConteudoNaoConfiavel: false })) {
          barge.ativa = true;
          confirmarBarge(texto);
        }
      }
      barge.ativa = false;
      paraMidia({ t: "legenda", id, texto, final: true });
      gravarFala({ autor: "pessoa", tipo: "fala", texto, inicioMs: iniT - inicio, fimMs: fimT - inicio, interrompida: false, confianca: res.confianca });
      reiniciarOciosidade();
      // Backchannel com o bot calado e sem pergunta pendente: só transcrição.
      if (ehBackchannel(texto) && !botPerguntou && vezRespondida && !botTocando()) return;
      pendente.textos.push(texto);
      agendarDecisao();
    }

    async function garantirStt(): Promise<void> {
      if (stt || encerrada) return;
      abrindoStt ??= (async () => {
        try {
          stt = await deps.provedores.stt.abrir({
            idioma: "pt-BR",
            // definido em 2026-10-04: termos do produto que o STT errava no teste local ("bote" no lugar de "bot").
            vocabulario: [r.nomeBot, "nod", "bot", "bots", "rotina", "e-mail", "aprovo", "recuso", ...(r.vocabulario ?? [])],
            aoResultado: aoResultadoStt,
            aoErro: (e) => {
              log("aviso", "voz_stt_falhou", { ligacao_id: r.ligacaoId, erro: e.name });
              stt = null;
              paraMidia({ t: "aviso", texto: "Não estou conseguindo te ouvir direito. Se continuar, use o teclado." });
            },
          });
        } catch (e) {
          log("aviso", "voz_stt_nao_abriu", { ligacao_id: r.ligacaoId, erro: e instanceof Error ? e.name : "desconhecido" });
          paraMidia({ t: "aviso", texto: "A transcrição não abriu. Você pode digitar pelo teclado." });
        } finally {
          abrindoStt = null;
        }
      })();
      await abrindoStt;
    }

    function aoQuadroMicrofone(pcm: Int16Array): void {
      const agora = relogio();
      audioRecebidoMs += (pcm.length / 16_000) * 1000;
      if (midiaDesde > 0 && audioRecebidoMs > (agora - midiaDesde) * FATOR_ABUSO + 2_000) {
        log("aviso", "voz_audio_acima_do_tempo_real", { ligacao_id: r.ligacaoId });
        midia?.fechar(FECHAMENTOS_VOZ.abuso, "audio acima do tempo real");
        return;
      }
      if (mudo || encerrada) return;
      vad.definirBotFalando(botTocando());
      const ev = vad.passo(pcm, agora);
      if (!falando) {
        preRoll.push(pcm);
        if (preRoll.length > PRE_ROLL_QUADROS) preRoll.shift();
      }
      if (ev?.tipo === "inicio") {
        falando = true;
        inicioFalaEm = agora - 3 * QUADRO_MS;
        cancelar(pendente.timer);
        pendente.timer = null;
        refazerVezSePreciso(agora);
        trechos.push({ inicio: inicioFalaEm, fim: 0 });
        if (botTocando()) iniciarBarge();
        if (stt) for (const q of preRoll) stt.enviar(q);
        sttSegundos += (preRoll.length * QUADRO_MS) / 1000;
        preRoll.length = 0;
        return;
      }
      if (falando) {
        stt?.enviar(pcm);
        sttSegundos += QUADRO_MS / 1000;
        if (barge.ativa && !barge.confirmado && agora - barge.desde >= prazos.interrupcaoPorFalaMs) confirmarBarge("");
      }
      if (ev?.tipo === "fim") {
        falando = false;
        fimFalaEm = agora;
        const aberto = trechos.find((x) => x.fim === 0);
        if (aberto) aberto.fim = agora;
        stt?.fimDeFala();
        // O final do STT agenda a decisão; se ele demorar, a vez espera por ele (nunca decide sem texto).
      }
    }

    // ---- canais -----------------------------------------------------------------------------------------------------

    function saudar(): void {
      if (saudou) return;
      saudou = true;
      const texto = saudacao;
      gravarFala({ autor: "bot", tipo: "fala", texto, inicioMs: msDesdeInicio(), fimMs: msDesdeInicio(), interrompida: false });
      enfileirar({ tipo: "conteudo", texto, n: null });
      botPerguntou = true;
    }

    function anexarMidia(canal: CanalVoz, retomar: boolean): number | null {
      if (encerrada) return FECHAMENTOS_VOZ.encerrada;
      if (!liberada) return FECHAMENTOS_VOZ.origem;
      if (midia && !retomar) return FECHAMENTOS_VOZ.jaEmLigacao;
      if (midia) midia.fechar(1000, "substituida");
      midia = canal;
      midiaDesde = relogio();
      audioRecebidoMs = 0;
      cancelar(timerMidiaCaida);
      canal.aoMensagem((m) => {
        if ("binario" in m) {
          const q = lerQuadroMicrofone(m.binario);
          if (q) aoQuadroMicrofone(q.pcm);
          return;
        }
        aoControleMidia(m.texto);
      });
      canal.aoFechar(() => {
        if (midia !== canal || encerrada) return;
        midia = null;
        timerMidiaCaida = agendar(prazos.midiaReconexaoMs, () => void encerrar("midia_caiu"));
      });
      paraMidia({ t: "pronto", maxS: r.maxS, stt: { parciais: deps.provedores.stt.capacidades.parciais } });
      paraMidia({ t: "cerebro", online: cerebro !== null });
      mudarFase(cerebro ? "ouvindo" : "conectando");
      void garantirStt();
      if (!atendida) {
        atendida = true;
        seguro(deps.persistencia.atender(ref), "voz_atender_falhou");
        saudar();
        reiniciarOciosidade();
        // Teto da ligação (NOD_LIGACAO_MAX_S): aviso 1 min antes, depois encerra.
        const maxMs = r.maxS * 1000;
        if (maxMs > 90_000) agendar(maxMs - 60_000, () => tocarEspera("limite_proximo"));
        agendar(maxMs, () => void encerrar("tempo_maximo"));
        atualizarOnboarding();
        timerCerebroPrimeiro = cerebro ? null : agendar(prazos.cerebroPrimeiroMs, () => {
          if (!cerebro && !encerrada) {
            tocarEspera("queda_cerebro");
            agendar(3_000, () => void encerrar("cerebro_caiu"));
          }
        });
      }
      return null;
    }

    function aoControleMidia(texto: string): void {
      const msg = lerJson(texto);
      if (!msg) return;
      switch (msg.t) {
        case "tocado": {
          const u = typeof msg.utt === "number" ? utts.get(msg.utt) : undefined;
          if (u && typeof msg.ms === "number") u.tocadoMs = Math.max(u.tocadoMs, msg.ms);
          return;
        }
        case "tocou-fim":
        case "interrompido": {
          const u = typeof msg.utt === "number" ? utts.get(msg.utt) : undefined;
          if (u) {
            if (typeof msg.ms === "number") u.tocadoMs = msg.ms;
            if (msg.t === "interrompido") {
              u.fim = true;
              u.aoTerminar = undefined;
            } else terminarUtt(u);
          }
          // Esquece as falas muito antigas (só as últimas importam para o eco e o "ouviu até").
          for (const [id, x] of utts) if (x.fim && relogio() - x.enviadoEm > 15_000) utts.delete(id);
          return;
        }
        case "texto": {
          const conteudo = typeof msg.conteudo === "string" ? msg.conteudo.trim().slice(0, 4000) : "";
          if (conteudo === "") return;
          if (botTocando()) interromperBot(conteudo);
          gravarFala({ autor: "pessoa", tipo: "texto", texto: conteudo, inicioMs: msDesdeInicio(), fimMs: msDesdeInicio(), interrompida: false });
          reiniciarOciosidade();
          pendente.textos.push(conteudo);
          decidirVez();
          return;
        }
        case "mudo":
          mudo = msg.ativo === true;
          if (mudo && falando) {
            falando = false;
            stt?.descartar();
          }
          return;
        case "ping":
          paraMidia({ t: "pong" });
          return;
        case "tchau":
          void encerrar("pessoa_desligou");
          return;
        default:
          return;
      }
    }

    function anexarCerebro(canal: CanalVoz): number | null {
      if (encerrada) return FECHAMENTOS_VOZ.encerrada;
      if (cerebro) cerebro.fechar(1000, "substituido");
      cerebro = canal;
      cancelar(timerCerebroCaido);
      cancelar(timerCerebroPrimeiro);
      canal.aoMensagem((m) => {
        if ("texto" in m) aoControleCerebro(m.texto);
      });
      canal.aoFechar(() => {
        if (cerebro !== canal) return;
        cerebro = null;
        if (encerrada) {
          finalizar();
          return;
        }
        paraMidia({ t: "cerebro", online: false });
        mudarFase("reconectando");
        tocarEspera("queda_cerebro");
        timerCerebroCaido = agendar(prazos.cerebroReconexaoMs, () => void encerrar("cerebro_caiu"));
      });
      paraMidia({ t: "cerebro", online: true });
      // A primeira mensagem aquece o cache do CLI e conta o que o bot já disse; a resposta a ela não é falada.
      paraCerebro({ t: "vez", n: 0, texto: `[nod] A ligação começou. Você já disse à pessoa: "${saudacao}" Não responda nada a esta mensagem além de "ok". Espere a pessoa falar.` });
      for (const v of vezesSemCerebro.splice(0)) paraCerebro({ t: "vez", ...v });
      for (const t of notasPendentes.splice(0)) paraCerebro({ t: "nota", texto: t, confiavel: true });
      if (midia && fase !== "falando" && fase !== "pensando") mudarFase("ouvindo");
      return null;
    }

    let segmentador = criarSegmentador();
    let timerVencer: ReturnType<typeof setTimeout> | null = null;

    function aoControleCerebro(texto: string): void {
      const msg = lerJson(texto);
      if (!msg) return;
      switch (msg.t) {
        case "fala": {
          if (typeof msg.n !== "number" || typeof msg.delta !== "string") return;
          if (msg.n === 0 || msg.n !== vezAtual || msg.n === vezCancelada || vezRespondida || desligando) return;
          cancelarEsperas();
          respostaTexto += msg.delta;
          for (const trecho of segmentador.adicionar(msg.delta, relogio())) falarConteudo(trecho, msg.n);
          cancelar(timerVencer);
          const n = msg.n;
          timerVencer = agendar(450, () => {
            if (vezAtual !== n || vezRespondida) return;
            const t = segmentador.vencer(relogio());
            if (t) falarConteudo(t, n);
          });
          return;
        }
        case "fala-fim": {
          if (typeof msg.n !== "number" || msg.n === 0 || msg.n !== vezAtual || msg.n === vezCancelada || vezRespondida) return;
          cancelar(timerVencer);
          for (const trecho of segmentador.fechar()) falarConteudo(trecho, msg.n);
          vezRespondida = true;
          cancelarEsperas();
          const resposta = respostaTexto.trim();
          botPerguntou = resposta.endsWith("?");
          if (resposta !== "") gravarFala({ autor: "bot", tipo: "fala", texto: textoFalavel(resposta).falavel || resposta, inicioMs: vezEm - inicio, fimMs: msDesdeInicio(), interrompida: false });
          if (respostaFoiProChat && resposta !== "" && deps.persistencia.mandarNoChat) seguro(deps.persistencia.mandarNoChat(ref, resposta), "voz_mandar_no_chat_falhou");
          if (!tocandoFila && fila.length === 0) mudarFase("ouvindo");
          reiniciarOciosidade();
          return;
        }
        case "atividade": {
          const nome = typeof msg.nome === "string" ? msg.nome.slice(0, 80) : "";
          if (msg.tipo === "inicio") {
            // O texto depois da ferramenta é outro bloco: sem isto, "Até mais!" e "Desligando" grudavam.
            if (respostaTexto !== "" && !/\s$/.test(respostaTexto)) {
              respostaTexto += " ";
              segmentador.adicionar(" ", relogio());
            }
            ferramentaRodando = nome;
            mudarFase("trabalhando", nome);
            const n = vezAtual;
            timersEspera.push(agendar(TEMPOS_ESPERA.ferramentaMs, () => { if (ferramentaRodando === nome && vezAtual === n && !botTocando()) tocarEspera("ferramenta", nome); }));
            timersEspera.push(agendar(TEMPOS_ESPERA.tarefaLongaMs[0], () => { if (ferramentaRodando === nome && vezAtual === n && !botTocando()) tocarEspera("tarefa_longa"); }));
          } else if (ferramentaRodando === nome) {
            ferramentaRodando = null;
            if (!vezRespondida) mudarFase("pensando");
          }
          // ADR-077: uma ferramenta que mexe no onboarding terminou — o painel, a pílula e os chips acompanham.
          if (msg.tipo === "fim" && /(^|__)(anotar_entrevista|concluir_entrevista|propor_bot|pedir_acesso|criar_rotina)$/.test(nome)) atualizarOnboarding();
          // ADR-072: o bot chamou `desligar` — encerra depois da última frase dele.
          if (msg.tipo === "inicio" && /(^|__)desligar$/.test(nome)) desligando = true;
          if (msg.tipo === "fim" && /(^|__)desligar$/.test(nome)) desligarDepoisDeFalar();
          return;
        }
        case "ping":
          paraCerebro({ t: "pong" });
          return;
        default:
          return;
      }
    }

    // Depois do `desligar`, o que o modelo ainda escrever não é falado (ele repetia a despedida).
    let desligando = false;
    function desligarDepoisDeFalar(): void {
      // O modelo às vezes chama `desligar` sem se despedir: a despedida gravada cobre.
      if (primeiroSomDaVez) tocarEspera("despedida");
      const tentar = (restante: number) => {
        if (encerrada) return;
        if ((!vezRespondida || botTocando() || fila.length > 0) && restante > 0) {
          agendar(300, () => tentar(restante - 300));
          return;
        }
        void encerrar("bot_desligou");
      };
      tentar(15_000);
    }

    // ---- fim ----------------------------------------------------------------------------------------------------------

    let finalizado = false;
    function finalizar(): void {
      if (finalizado) return;
      finalizado = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      cerebro?.fechar(1000, "fim");
      cerebro = null;
      ligacoes.delete(r.ligacaoId);
    }

    async function encerrar(motivo: MotivoFimLigacao): Promise<void> {
      if (encerrada) return;
      encerrada = true;
      for (const t of timers) clearTimeout(t);
      timers.clear();
      abortTts?.abort();
      fila.length = 0;
      const sessao = stt;
      stt = null;
      if (sessao) seguro(sessao.fechar(), "voz_stt_fechar_falhou");
      paraMidia({ t: "fim", motivo });
      const m = midia;
      midia = null;
      if (m) setTimeout(() => m.fechar(1000, "fim"), 200);
      const precos = PRECOS[deps.provedores.stt.id];
      const metricas: MetricasVoz = {
        trocas,
        interrupcoes,
        sttSegundos: Math.round(sttSegundos),
        ttsCaracteres,
        custoEstimadoUsd: precos ? Math.round((sttSegundos * precos.sttPorSegundo + ttsCaracteres * precos.ttsPorCaractere) * 10_000) / 10_000 : 0,
        latenciaP50Ms: percentil(latencias, 50),
        latenciaP95Ms: percentil(latencias, 95),
      };
      try {
        await deps.persistencia.encerrar(ref, motivo, metricas);
      } catch (e) {
        log("erro", "voz_encerrar_falhou", { ligacao_id: r.ligacaoId, erro: e instanceof Error ? e.name : "desconhecido" });
      }
      if (cerebro) {
        // O laço de voz pede o resumo ao CLI e fecha; o canal fecha quando o turno termina.
        paraCerebro({ t: "fim", motivo });
        setTimeout(finalizar, prazos.resumoMs);
      } else finalizar();
      log("info", "voz_ligacao_encerrada", { ligacao_id: r.ligacaoId, motivo, trocas, interrupcoes, latencia_p50_ms: metricas.latenciaP50Ms, audio_recebido_ms: Math.round(audioRecebidoMs), fala_ms: Math.round(sttSegundos * 1000), piso_vad: Math.round(vad.piso() * 10_000) / 10_000, limiar_vad: Math.round(vad.limiar() * 10_000) / 10_000 });
    }

    /**
     * Aviso do sistema ao cérebro. `falar=false`: só contexto (ex.: decisão já dita). `falar=true`: o bot fala a
     * resposta numa brecha (pessoa calada, bot calado, fora da janela) — é assim que "terminei a tarefa" chega à ligação.
     */
    const notasParaFalar: { texto: string; confiavel: boolean }[] = [];
    function nota(texto: string, falar = false, confiavel = true): void {
      const linha = texto.startsWith("[nod]") ? texto : `[nod] ${texto}`;
      if (!falar) {
        if (cerebro) paraCerebro({ t: "nota", texto: linha, confiavel });
        else notasPendentes.push(linha);
        return;
      }
      notasParaFalar.push({ texto: linha, confiavel });
      proximaNota();
    }
    function proximaNota(): void {
      if (encerrada || notasParaFalar.length === 0 || !cerebro) return;
      if (!emBrecha() || lendo || janela || silencioDaPessoaMs() < 700) {
        agendar(500, proximaNota);
        return;
      }
      const { texto, confiavel } = notasParaFalar.shift()!;
      const n = ++nVez;
      vezAtual = n;
      vezEm = relogio();
      primeiroSomDaVez = true;
      vezRespondida = false;
      respostaTexto = "";
      respostaFoiProChat = false;
      segmentador = criarSegmentador();
      paraCerebro({ t: "nota", texto, confiavel, n });
      mudarFase("pensando");
    }
    function silencioDaPessoaMs(): number {
      return falando ? 0 : relogio() - Math.max(fimFalaEm, inicio);
    }

    deps.esperas?.aquecer(FALAS_DE_ESPERA, r.voz, r.velocidade);

    return {
      registro: r,
      liberar,
      anexarMidia,
      anexarCerebro,
      encerrar,
      nota,
      pedirAprovacao,
      conferirComando,
      decisaoDecidida,
      avisar: (texto: string) => falarAviso(texto),
      encerrada: () => encerrada,
      ultimaAtividadeEm: () => ultimaAtividadeEm,
    };
  }

  return {
    registrar(r) {
      const antiga = ligacoes.get(r.ligacaoId);
      if (antiga && !antiga.encerrada()) return;
      ligacoes.set(r.ligacaoId, criarLigacaoViva(r));
    },
    existe: (id) => ligacoes.has(id),
    liberar(id) {
      ligacoes.get(id)?.liberar();
    },
    anexarMidia({ pessoaId, ligacaoId, retomar, canal }) {
      const l = ligacoes.get(ligacaoId);
      if (!l || l.registro.pessoaId !== pessoaId) return FECHAMENTOS_VOZ.naoEncontrada;
      return l.anexarMidia(canal, retomar);
    },
    anexarCerebro({ turnoId, ligacaoId, canal }) {
      const l = ligacoes.get(ligacaoId);
      if (!l || l.registro.turnoId !== turnoId) return FECHAMENTOS_VOZ.naoEncontrada;
      return l.anexarCerebro(canal);
    },
    async encerrar(ligacaoId, motivo) {
      await ligacoes.get(ligacaoId)?.encerrar(motivo);
    },
    nota(ligacaoId, texto, confiavel, falar) {
      ligacoes.get(ligacaoId)?.nota(texto, falar ?? false, confiavel);
    },
    pedirAprovacao(ligacaoId, p) {
      ligacoes.get(ligacaoId)?.pedirAprovacao(p);
    },
    conferirComando({ pessoaId, ligacaoId, comandoId, decisaoId, acao }) {
      const l = ligacoes.get(ligacaoId);
      return !!l && l.registro.pessoaId === pessoaId && l.conferirComando(comandoId, decisaoId, acao);
    },
    decisaoDecidida(ligacaoId, p) {
      ligacoes.get(ligacaoId)?.decisaoDecidida(p.decisaoId, p.resultado, p.porVoz);
    },
    daConversa(pessoaId, conversaId) {
      for (const l of ligacoes.values()) if (!l.encerrada() && l.registro.pessoaId === pessoaId && l.registro.conversaId === conversaId) return l.registro.ligacaoId;
      return null;
    },
    vivas: () => [...ligacoes.values()].filter((l) => !l.encerrada()).length,
    async drenar(motivo = "drenagem") {
      emDrenagem = true;
      await Promise.all([...ligacoes.values()].map((l) => l.encerrar(motivo)));
    },
    drenando: () => emDrenagem,
    iniciarDrenagem() {
      if (emDrenagem) return;
      emDrenagem = true;
      for (const l of ligacoes.values()) if (!l.encerrada()) l.avisar("Daqui a pouco eu preciso reiniciar. Se a ligação cair, é só me ligar de novo.");
    },
    async fechar() {
      emDrenagem = true;
      await Promise.all([...ligacoes.values()].map((l) => l.encerrar("reinicio_servidor")));
      ligacoes.clear();
    },
  };
}
