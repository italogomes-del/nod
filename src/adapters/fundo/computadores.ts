import { createHash, randomUUID } from "node:crypto";
import type { AcaoComputador, Computador, ComputadorDto, DriverComputador, ResultadoComputador } from "../../contracts/computador.ts";
import { FERRAMENTAS_COMPUTADOR } from "../../contracts/ferramentas-computador.ts";
import type { MotivoFalhaComputador } from "../../contracts/motivos.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import { alteraComputador, computadorPadrao, CONTA_PARA_SAUDE, ehFalhaComputador, type FalhaComputador, instrucaoDaFalha, LIMITE_FALHAS_SEGUIDAS, MOTIVO_FALHA_EM_PORTUGUES, resumirDetalhe, resumoAcaoComputador, validarAcaoComputador } from "../../domain/computador.ts";
import { ehErroDeDominio, ErroDeDominio } from "../../domain/erro.ts";
import { deduplicarObservacao, type HashesObservacao } from "../../domain/observacao-computador.ts";
import { decidirPeloModo } from "../../domain/modo-aprovacao.ts";
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
  guardarTelas?: boolean };
type Reserva = { computador: Computador; operacao: string; acao: AcaoComputador; registroId: string; turnoId?: string; aprovado: boolean };

// definido em 2026-09-18: reserva confirmada ANTES do efeito; watchdog do runtime encerra em 55 s.
const LEASE_MS = 300_000;
/**
 * definido em 2026-10-05 (NOD-170): a reserva do varredor de ociosidade cobre o `parar` (stop da máquina e do
 * proxy, 20 s cada com 30 s de prazo, mais os inspects). Uma ação que chega no meio recebe estado_invalido (livre()).
 */
const LEASE_OCIOSIDADE_MS = 90_000;
async function obter(d: Deps, agenteId: string): Promise<Computador> {
  const c = await d.repos.computadores.obter(agenteId);
  if (!c) throw new ErroDeDominio("nao_encontrado");
  return (await d.repos.computadores.travar(c.id))!;
}
function livre(c: Computador, agora: number): void {
  if (c.ocupadoAte && c.ocupadoAte > agora) throw new ErroDeDominio("estado_invalido");
}
async function reservar(d: Deps, c: Computador, acao: AcaoComputador, autor: "bot" | "pessoa", turnoId?: string, registroId?: string): Promise<Reserva> {
  livre(c, d.agora());
  const operacao = randomUUID();
  // NOD-161: `forcar` é decisão do servidor; o runtime recebe o observar de sempre.
  if (acao.tipo === "observar") acao = { tipo: "observar" };
  const registro = registroId ?? (await d.repos.computadores.registrar({ computadorId: c.id, turnoId, autor, tipo: acao.tipo, estado: "executando" })).id;
  if (registroId) await d.repos.computadores.concluir(registroId, "executando");
  await d.repos.computadores.ocupar(c.id, operacao, d.agora() + LEASE_MS);
  return { computador: c, operacao, acao, registroId: registro, turnoId, aprovado: Boolean(registroId) };
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
  return { erro: motivo, instrucao: instrucaoDaFalha(motivo, ehFalhaComputador(e) ? e.limite : null) };
}

/** Para a borda HTTP: a falha da máquina é estado (409), nunca falha interna (500). */
function comoErroDeDominio(e: unknown): unknown {
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

export function criarComputadores(o: Opcoes) {
  const agora = o.agora ?? Date.now;
  /** S5: o turno que pediu o computador ocupado e quem o segurava, até a próxima ação dele passar (TrabalhoDto). */
  const esperando = new Map<string, string>();
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
  async function avisarForaDoAr(d: Deps, c: Computador, motivo: MotivoFalhaComputador): Promise<void> {
    const agente = await d.repos.agentes.buscar(c.agenteId);
    const conversa = agente ? await d.repos.conversas.buscarPropriaDoAgente(agente.id) : null;
    if (!agente || !conversa) return;
    const agora = d.agora();
    const autoria = autoriaAgente({ agenteId: agente.id, contaDeExecucao: d.escopo.pessoaId, executor: o.executor(), decididoPor: "regra:saude_computador" });
    const texto = redigir("computador-fora-do-ar", agora, { agente: agente.nome, motivo: MOTIVO_FALHA_EM_PORTUGUES[motivo] });
    const m = await d.repos.mensagens.criar({ conversaId: conversa.id, turnoId: null, autoria, kind: "sistema", texto, payload: { kind: "computador_fora_do_ar", agenteId: agente.id, desde: c.indisponivelDesde ?? agora, motivo }, confianca: "confiavel" });
    if (m) await d.repos.events.gravarComOutbox([evento(d.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: conversa.id, turnoId: null, dados: { mensagem_id: m.id, kind: "sistema" } })]);
  }

  /**
   * A saúde anda com o registro da ação, na MESMA transação e com a linha travada. Só a máquina sem
   * responder conta (CONTA_PARA_SAUDE); qualquer resposta dela zera a sequência. Computador desligado
   * pela pessoa no meio não conta — quem parou foi ela. Devolve se a frota precisa reler.
   */
  async function registrarSaude(d: Deps, c: Computador | null, etapa: string, falha: FalhaComputador | null, respondeu: boolean): Promise<boolean> {
    if (!c) return false;
    if (!falha || !CONTA_PARA_SAUDE.has(falha.motivo)) return respondeu ? d.repos.computadores.registrarSucesso(c.id) : false;
    if (!c.habilitado) return false;
    const r = await d.repos.computadores.registrarFalha(c.id, { motivo: falha.motivo, em: d.agora(), limite: LIMITE_FALHAS_SEGUIDAS });
    // Sem segredos: o detalhe é a 1ª linha do stderr, curta e redigida (resumirDetalhe).
    log("aviso", "computador_falhou", { computador_id: c.id, agente_id: c.agenteId, motivo: falha.motivo, etapa, falhas_seguidas: r?.computador.falhasSeguidas ?? null, fora_do_ar: (r?.computador.indisponivelDesde ?? null) !== null, detalhe: resumirDetalhe(falha.detalhe), reinicios: falha.reinicios });
    if (r?.virouIndisponivel) await avisarForaDoAr(d, r.computador, falha.motivo);
    return Boolean(r?.virouIndisponivel);
  }

  async function executar(escopo: Escopo, r: Reserva): Promise<ResultadoComputador> {
    let estado: "concluida" | "falhou" = "falhou";
    let falha: FalhaComputador | null = null;
    let respondeu = false;
    try {
      await o.driver.iniciar(r.computador.id);
      respondeu = true;
      const estadoAtual = await o.dentro(escopo, async d => {
        const c = await d.repos.computadores.travar(r.computador.id);
        const agente = c ? await d.repos.agentes.buscar(c.agenteId) : null;
        return { desligar: !c?.habilitado || !agente, permitido: Boolean(c?.habilitado && c.controle === r.computador.controle && c.operacaoId === r.operacao && c.ocupadoAte && c.ocupadoAte > d.agora() && agente && (!r.turnoId || await turnoPermitido(d, r.turnoId, c.agenteId, r.aprovado))) };
      });
      if (!estadoAtual.permitido) { if (estadoAtual.desligar) await o.driver.parar(r.computador.id); throw new ErroDeDominio("nao_permitido"); }
      const resultado = await o.driver.executar(r.computador.id, r.acao);
      estado = resultado.codigoSaida !== undefined && resultado.codigoSaida !== 0 ? "falhou" : "concluida";
      return resultado;
    } catch (e) {
      if (ehFalhaComputador(e)) {
        falha = e;
        // A ação falhou numa máquina que RESPONDEU (tela alterada, ocupado…): ela está viva. O teto do host
        // (NOD-170) não é resposta nem falha da máquina: não zera nem soma falhas_seguidas.
        respondeu = !CONTA_PARA_SAUDE.has(e.motivo) && e.motivo !== "limite_de_computadores";
      }
      throw e;
    } finally {
      const saude = await o.dentro(escopo, async (d) => {
        const c = await d.repos.computadores.travar(r.computador.id);
        await d.repos.computadores.concluir(r.registroId, estado, falha?.motivo ?? null);
        await d.repos.computadores.liberar(r.computador.id, r.operacao, d.agora());
        return registrarSaude(d, c, r.acao.tipo, falha, respondeu);
      });
      o.mudou(escopo, r.computador.agenteId, saude);
    }
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
          await o.driver.parar(c.id);
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
        const c = await d.repos.computadores.buscarVinculo(agenteId);
        if (c) await d.repos.computadores.configurar(c.id, { habilitado: false, controle: "pessoa" });
        return c;
      });
      if (c) await o.driver.parar(c.id);
      o.mudou(escopo, agenteId);
    },
    /**
     * definido em 2026-10-07 (NOD-192): abrir o painel só lê — sem FOR UPDATE (não disputa com o turno nem com uma
     * ação do mesmo bot) e sem criar a linha. Sem computador, devolve o padrão desligado e pergunta ao driver só o
     * ambiente (Docker, cofre, imagem): não há container para inspecionar. A 1ª ação cria, em `obter`.
     */
    async consultar(escopo: Escopo, agenteId: string): Promise<ComputadorDto> {
      const c = await o.dentro(escopo, async (d) => {
        const computador = await d.repos.computadores.buscarDoAgente(agenteId);
        if (computador === undefined) throw new ErroDeDominio("nao_encontrado");
        return computador && { computador, atividade: await d.repos.computadores.atividade(computador.id) };
      });
      if (!c) return { computador: computadorPadrao(agenteId), ativo: false, atividade: [], ...await o.driver.ambiente() };
      return { ...c, ...await o.driver.estado(c.computador.id) };
    },
    async configurar(escopo: Escopo, agenteId: string, operacao: string): Promise<void> {
      const operacaoId = randomUUID();
      let registroId: string | undefined;
      const c = await o.dentro(escopo, async (d) => {
        const c = await obter(d, agenteId);
        if (operacao !== "parar") livre(c, d.agora());
        if (operacao === "assumir") await d.repos.computadores.configurar(c.id, { controle: "pessoa", atividadeEm: d.agora() });
        else if (operacao === "devolver") {
          await d.repos.computadores.configurar(c.id, { controle: "bot", ajuda: null, ajudaDecisaoId: null, atividadeEm: d.agora() });
          if (c.ajudaDecisaoId) {
            const decisao = await d.repos.decisoes.buscar(c.ajudaDecisaoId);
            if (decisao && (decisao.estado === "pendente" || decisao.estado === "reaberta")) {
              const r = await fecharComResposta(d, { decisaoId: decisao.id, texto: "Concluí o passo no computador e devolvi o controle. Observe a tela e continue." });
              if (r.events?.length) await d.repos.events.gravarComOutbox(r.events);
              const retomada = await retomarComResposta(d, { decisao: r.data.decisao, texto: "Concluí o passo no computador e devolvi o controle. Observe a tela e continue.", respondidaPor: { id: escopo.pessoaId, nome: "A pessoa" }, executor: o.executor() });
              if (retomada.events?.length) await d.repos.events.gravarComOutbox(retomada.events);
            }
          }
        } else if (operacao === "supervisionado" || operacao === "autonomo") await d.repos.computadores.configurar(c.id, { politica: operacao });
        else if (operacao === "parar") await d.repos.computadores.configurar(c.id, { habilitado: false, controle: "pessoa" });
        else if (operacao === "iniciar") await d.repos.computadores.configurar(c.id, { habilitado: true, atividadeEm: d.agora() });
        else throw new ErroDeDominio("entrada_invalida");
        if (operacao === "iniciar") await d.repos.computadores.ocupar(c.id, operacaoId, d.agora() + LEASE_MS);
        registroId = (await d.repos.computadores.registrar({ computadorId: c.id, autor: "pessoa", tipo: operacao, estado: operacao === "iniciar" || operacao === "parar" ? "executando" : "concluida" })).id;
        return c;
      });
      // NOD-161: a tela mudou fora do bot; a próxima observação do turno vai completa.
      if (operacao === "assumir" || operacao === "devolver" || operacao === "parar") esquecerComputador(c.id);
      let sucesso = false;
      let falha: FalhaComputador | null = null;
      let ligou = false;
      try {
        if (operacao === "iniciar") {
          await o.driver.iniciar(c.id);
          ligou = true;
          const habilitado = await o.dentro(escopo, async d => (await d.repos.computadores.travar(c.id))?.habilitado);
          if (!habilitado) { await o.driver.parar(c.id); throw new ErroDeDominio("estado_invalido"); }
        }
        if (operacao === "parar") await o.driver.parar(c.id);
        sucesso = true;
      } catch (e) {
        if (ehFalhaComputador(e)) falha = e;
        throw comoErroDeDominio(e);
      } finally {
        const saude = await o.dentro(escopo, async d => {
          if (operacao === "iniciar") await d.repos.computadores.liberar(c.id, operacaoId, d.agora());
          if (registroId) await d.repos.computadores.concluir(registroId, sucesso ? "concluida" : "falhou", falha?.motivo ?? null);
          // "Ligar" e "Tentar de novo" são o mesmo iniciar: ligou zera a saúde; não ligou conta como falha.
          if (operacao !== "iniciar" || (!ligou && !falha)) return false;
          return registrarSaude(d, await d.repos.computadores.travar(c.id), "iniciar", ligou ? null : falha, ligou);
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
          const uso = (await d.repos.computadores.emUsoPor(c.id)) ?? { titulo: "outra tarefa", deFora: false };
          esperando.set(plano.turnoId, uso.titulo);
          // Turno que acabou esperando não volta para tirar a marca: guarda as 500 mais novas.
          if (esperando.size > 500) esperando.delete(esperando.keys().next().value!);
          // Revisão do épico (S24, 2026-10-08): o título de uma task de colega (ou que leu conteúdo de fora) é texto de
          // fora — o resultado vai marcado não confiável, como todo conteúdo de fora que entra no turno.
          return { ok: true, isError: true, conteudo: ocupadoParaAgente(uso.titulo, c.ocupadoAte, d.agora()), confianca: uso.deFora ? "nao_confiavel" : "confiavel" };
        }
        esperando.delete(plano.turnoId);
        if (nome === "computador_pedir_ajuda") {
          livre(c, d.agora());
          const motivo = String(args.motivo).slice(0, 1000);
          const ajuda = await pedirAjudaDoComputador(d, { turnoId: plano.turnoId, agenteId: plano.agenteId, conversaId: plano.conversaId, tipo: "pergunta", texto: `Abra meu computador para concluir este passo: ${motivo}. Use Assumir controle; depois, Devolver ao bot. Não envie senha ou código aqui.` });
          await d.repos.computadores.configurar(c.id, { controle: "aguardando_pessoa", ajuda: motivo, ajudaDecisaoId: ajuda.data.decisao_id });
          if (ajuda.events?.length) await d.repos.events.gravarComOutbox(ajuda.events);
          await d.repos.computadores.registrar({ computadorId: c.id, turnoId: plano.turnoId, autor: "bot", tipo: "pedir_ajuda", estado: "concluida" });
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
          return decidirPeloModo(agente?.modoAprovacao, { arriscada: false, credencial: false })?.automatico === true;
        };
        if (alteraComputador(acao) && !liberadaNaTarefa && c.politica === "supervisionado" && !(await aprovadaPeloModo())) {
          const registro = await d.repos.computadores.registrar({ computadorId: c.id, turnoId: plano.turnoId, autor: "bot", tipo: acao.tipo, estado: "pendente", argumentosCifrados: o.cifrar(JSON.stringify(acao)) });
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
        if (!a || a.computadorId !== c.id || a.turnoId !== p.turnoId || a.estado !== "pendente" || !a.argumentosCifrados) throw new ErroDeDominio("estado_invalido");
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
