import { randomUUID } from "node:crypto";
import type { AcaoComputador, Computador, ComputadorDto, DriverComputador, ResultadoComputador } from "../../contracts/computador.ts";
import { FERRAMENTAS_COMPUTADOR } from "../../contracts/ferramentas-computador.ts";
import type { MotivoFalhaComputador } from "../../contracts/motivos.ts";
import type { PlanoTurno } from "../../contracts/plano-turno.ts";
import { alteraComputador, CONTA_PARA_SAUDE, ehFalhaComputador, type FalhaComputador, instrucaoDaFalha, LIMITE_FALHAS_SEGUIDAS, MOTIVO_FALHA_EM_PORTUGUES, resumirDetalhe, resumoAcaoComputador, validarAcaoComputador } from "../../domain/computador.ts";
import { ehErroDeDominio, ErroDeDominio } from "../../domain/erro.ts";
import { decidirPeloModo } from "../../domain/modo-aprovacao.ts";
import { redigir } from "../../domain/redacao.ts";
import { log } from "../../obs/log.ts";
import { computadorLiberadoNaTarefa } from "../../use-cases/liberar-na-tarefa.ts";
import type { Escopo } from "../../shared/types.ts";
import { autoriaAgente, evento } from "../../use-cases/autoria-evento.ts";
import { errosDoSchema, type ResultadoChamada } from "../../use-cases/chamar-ferramenta.ts";
import { pedirAprovacaoComputador } from "../../use-cases/pedir-aprovacao.ts";
import { pedirAPessoa } from "../../use-cases/pedir-a-pessoa.ts";
import { registrarNegacao } from "../../use-cases/registrar-negacao.ts";
import { fecharComResposta, retomarComResposta } from "../../use-cases/responder-decisao.ts";
import type { Deps } from "../../use-cases/tipos.ts";

type Dentro = <T>(escopo: Escopo, fn: (d: Deps) => Promise<T>) => Promise<T>;
/** `saude`: o computador entrou ou saiu do ar — a frota (lateral, cabeçalho, painel) precisa reler. */
type Opcoes = { executor(): "local" | "catcher"; dentro: Dentro; driver: DriverComputador; cifrar(s: string): string; decifrar(s: string): string; mudou(escopo: Escopo, agenteId: string, saude?: boolean): void };
type Reserva = { computador: Computador; operacao: string; acao: AcaoComputador; registroId: string; turnoId?: string; aprovado: boolean };

// definido em 2026-09-18: reserva confirmada ANTES do efeito; watchdog do runtime encerra em 55 s.
const LEASE_MS = 300_000;
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
  const registro = registroId ?? (await d.repos.computadores.registrar({ computadorId: c.id, turnoId, autor, tipo: acao.tipo, estado: "executando" })).id;
  if (registroId) await d.repos.computadores.concluir(registroId, "executando");
  await d.repos.computadores.ocupar(c.id, operacao, d.agora() + LEASE_MS);
  return { computador: c, operacao, acao, registroId: registro, turnoId, aprovado: Boolean(registroId) };
}
async function turnoPermitido(d: Deps, turnoId: string, agenteId: string, aprovado = false): Promise<boolean> {
  const t = await d.repos.turnos.buscar(turnoId);
  return Boolean(t && (aprovado || (t.prazoEm > d.agora() && t.estado !== "concluido" && t.estado !== "interrompido")) && t.agenteId === agenteId && t.ownerId === d.escopo.pessoaId && !t.pararSolicitadoEm &&
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
  return { erro: motivo, instrucao: instrucaoDaFalha(motivo) };
}

/** Para a borda HTTP: a falha da máquina é estado (409), nunca falha interna (500). */
function comoErroDeDominio(e: unknown): unknown {
  return ehFalhaComputador(e) ? new ErroDeDominio("estado_invalido", { cause: e.motivo }) : e;
}

/** "O computador está fora do ar desde …" para o agente, sem tocar no Docker (falha rápida). */
function foraDoArParaAgente(c: Computador): { erro: MotivoFalhaComputador; instrucao: string } {
  const motivo = c.falhaMotivo ?? "sem_resposta";
  return { erro: motivo, instrucao: `O computador está fora do ar desde ${new Date(c.indisponivelDesde ?? 0).toISOString()}: ${MOTIVO_FALHA_EM_PORTUGUES[motivo]}. A pessoa já foi avisada. Não tente usá-lo neste turno; siga com os acessos que você tem e diga em uma frase o que ficou de fora.` };
}

export function criarComputadores(o: Opcoes) {
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
        // A ação falhou numa máquina que RESPONDEU (tela alterada, ocupado…): ela está viva.
        respondeu = !CONTA_PARA_SAUDE.has(e.motivo);
      }
      throw e;
    } finally {
      const saude = await o.dentro(escopo, async (d) => {
        const c = await d.repos.computadores.travar(r.computador.id);
        await d.repos.computadores.concluir(r.registroId, estado, falha?.motivo ?? null);
        await d.repos.computadores.liberar(r.computador.id, r.operacao);
        return registrarSaude(d, c, r.acao.tipo, falha, respondeu);
      });
      o.mudou(escopo, r.computador.agenteId, saude);
    }
  }
  return {
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
    async consultar(escopo: Escopo, agenteId: string): Promise<ComputadorDto> {
      const c = await o.dentro(escopo, async (d) => {
        const computador = await obter(d, agenteId);
        return { computador, atividade: await d.repos.computadores.atividade(computador.id) };
      });
      return { ...c, ...await o.driver.estado(c.computador.id) };
    },
    async configurar(escopo: Escopo, agenteId: string, operacao: string): Promise<void> {
      const operacaoId = randomUUID();
      let registroId: string | undefined;
      const c = await o.dentro(escopo, async (d) => {
        const c = await obter(d, agenteId);
        if (operacao !== "parar") livre(c, d.agora());
        if (operacao === "assumir") await d.repos.computadores.configurar(c.id, { controle: "pessoa" });
        else if (operacao === "devolver") {
          await d.repos.computadores.configurar(c.id, { controle: "bot", ajuda: null, ajudaDecisaoId: null });
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
        else if (operacao === "iniciar") await d.repos.computadores.configurar(c.id, { habilitado: true });
        else throw new ErroDeDominio("entrada_invalida");
        if (operacao === "iniciar") await d.repos.computadores.ocupar(c.id, operacaoId, d.agora() + LEASE_MS);
        registroId = (await d.repos.computadores.registrar({ computadorId: c.id, autor: "pessoa", tipo: operacao, estado: operacao === "iniciar" || operacao === "parar" ? "executando" : "concluida" })).id;
        return c;
      });
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
          if (operacao === "iniciar") await d.repos.computadores.liberar(c.id, operacaoId);
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
        if (c.controle !== "bot") return { ok: true, conteudo: JSON.stringify({ estado: "aguardando_pessoa", instrucao: "A pessoa está com o computador. Encerre o turno e aguarde a devolução." }), confianca: "confiavel" };
        const args = argumentos as Record<string, unknown>;
        if (nome === "computador_pedir_ajuda") {
          livre(c, d.agora());
          const motivo = String(args.motivo).slice(0, 1000);
          const ajuda = await pedirAPessoa(d, { turnoId: plano.turnoId, agenteId: plano.agenteId, conversaId: plano.conversaId, tipo: "pergunta", texto: `Abra meu computador para concluir este passo: ${motivo}. Use Assumir controle; depois, Devolver ao bot. Não envie senha ou código aqui.` });
          await d.repos.computadores.configurar(c.id, { controle: "aguardando_pessoa", ajuda: motivo, ajudaDecisaoId: ajuda.data.decisao_id });
          if (ajuda.events?.length) await d.repos.events.gravarComOutbox(ajuda.events);
          await d.repos.computadores.registrar({ computadorId: c.id, turnoId: plano.turnoId, autor: "bot", tipo: "pedir_ajuda", estado: "concluida" });
          return { ok: true, conteudo: JSON.stringify(ajuda.data), confianca: "confiavel" };
        }
        let acao: AcaoComputador;
        try { acao = validarAcaoComputador({ ...args, ...(nome !== "computador_interagir" ? { tipo: nome.slice(11) } : {}), ...(nome === "computador_arquivos" ? { caminho: args.caminho ?? "." } : {}) }); }
        catch { return negar("args_invalidos"); }
        // definido em 2026-09-28 (emenda da ADR-037): "Pode fazer e o resto desta tarefa" dispensa o card nas próximas
        // ações da MESMA tarefa. Nunca vence o gate de rotina, nunca vale em turno não confiável (ADR-026) nem depois
        // da web (ADR-062: a marca de 0033 ficava de fora, e o terminal já a olhava — autorizar-comando.ts).
        const liberadaNaTarefa = !plano.politicaExecucao.efeitoExternoSoPorAprovacao && plano.confiancaEntrada === "confiavel" && alteraComputador(acao) && !(await d.repos.turnos.contaminado(plano.turnoId)) && await computadorLiberadoNaTarefa(d, plano.turnoId);
        // ADR-059: o modo do bot aprova a ação no computador DELE como aprova o resto. Nada ali é "arriscado" no
        // sentido do Mac (o computador é isolado, ADR-037); o que para é conteúdo de fora e a trava herdada.
        const aprovadaPeloModo = async () => {
          const agente = await d.repos.agentes.buscar(plano.agenteId);
          const conteudoDeFora = plano.confiancaEntrada !== "confiavel" || await d.repos.turnos.contaminado(plano.turnoId);
          return decidirPeloModo(agente?.modoAprovacao, { arriscada: false, credencial: false, conteudoDeFora, travaHerdada: plano.politicaExecucao.travaHerdada === true })?.automatico === true;
        };
        if (alteraComputador(acao) && !liberadaNaTarefa && (c.politica === "supervisionado" || plano.politicaExecucao.efeitoExternoSoPorAprovacao) && !(await aprovadaPeloModo())) {
          const registro = await d.repos.computadores.registrar({ computadorId: c.id, turnoId: plano.turnoId, autor: "bot", tipo: acao.tipo, estado: "pendente", argumentosCifrados: o.cifrar(JSON.stringify(acao)) });
          const pedido = await pedirAprovacaoComputador(d, { turnoId: plano.turnoId, agenteId: plano.agenteId, conversaId: plano.conversaId, resumo: "Ação no computador do bot", itens: [{ texto: resumoAcaoComputador(acao), destino: { conector: "computador", ferramenta: "executar", argumentos: { acaoId: registro.id } } }] });
          if (pedido.events?.length) await d.repos.events.gravarComOutbox(pedido.events);
          if (pedido.data.estado !== "pendente") throw new ErroDeDominio("estado_invalido");
          return { aguardar: pedido.data.decisao_id };
        }
        return reservar(d, c, acao, "bot", plano.turnoId);
      });
      o.mudou(escopo, plano.agenteId);
      if (!("operacao" in resultado)) return resultado;
      try {
        const r = await executar(escopo, resultado);
        const imagem = r.tela?.imagem;
        return { ok: true, isError: r.codigoSaida !== undefined && r.codigoSaida !== 0, conteudo: JSON.stringify({ ...r, audio: undefined, ...(r.tela ? { tela: { ...r.tela, imagem: undefined } } : {}) }), confianca: "nao_confiavel", ...(r.audio ? { audio: r.audio } : {}), ...(imagem ? { imagem: { mimeType: "image/png" as const, data: imagem } } : {}) };
      } catch (e) {
        return { ok: true, isError: true, conteudo: JSON.stringify(erroDaFerramenta(nome, e)), confianca: "confiavel" };
      }
    },
    async executarAprovado(p: Escopo & { agenteId: string; turnoId: string; acaoId: string }): Promise<void> {
      const { r, tipo } = await o.dentro(p, async (d) => {
        const c = await obter(d, p.agenteId);
        if (!c.habilitado || c.controle !== "bot" || !await turnoPermitido(d, p.turnoId, p.agenteId, true)) throw new ErroDeDominio("nao_permitido");
        if (c.indisponivelDesde !== null) throw new ErroDeDominio("estado_invalido", { cause: "computador fora do ar" });
        const a = await d.repos.computadores.buscarAcao(p.acaoId);
        if (!a || a.computadorId !== c.id || a.turnoId !== p.turnoId || a.estado !== "pendente" || !a.argumentosCifrados) throw new ErroDeDominio("estado_invalido");
        const acao = validarAcaoComputador(JSON.parse(o.decifrar(a.argumentosCifrados)));
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
