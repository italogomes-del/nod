import type { Autoria, Executor, RuntimeEvent } from "../contracts/evento.ts";
import { HARNESSES, type IdHarness } from "../contracts/harness.ts";
import { MOTIVO_DA_CAUSA, type CausaSemIa, type Inventario } from "../contracts/inventario.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import type { MotivoFalha, MotivoInterrupcao } from "../contracts/motivos.ts";
import type { Entrega } from "../contracts/ponte.ts";
import type { ContaNoLimite, Turno } from "../contracts/turno.ts";
import { comandoDaConversa, textoDaCompactacao, traduzirSaidaDoComando } from "../domain/comandos.ts";
import { custoDoTurno } from "../domain/custo-turno.ts";
import { causaDaEntrega } from "../domain/stream-json.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { recusaDoArquivo } from "../domain/anexo.ts";
import { classificarErroFornecedor, fraseDoErroFornecedor, fraseDoLimiteDoPlano, horaDaFrase, horaMinuto, quandoDaFrase } from "../domain/erro-fornecedor.ts";
import { descreverNegacao } from "../domain/estado-degradacao.ts";
import { iaDaNegacao } from "../domain/harness.ts";
import { negacoesDoTurno } from "../domain/negacao-nativa.ts";
import { ultimoSinalDoTurno } from "../domain/incidente.ts";
import { NATIVA_MCP_DA_PESSOA, NATIVAS_DO_TERMINAL, NATIVAS_DO_TERMINAL_CODEX } from "../domain/nativas.ts";
import { motivoEmPortugues, redigir } from "../domain/redacao.ts";
import { iasNoLimite, inteligenciaDoAgente, ordemEfetiva, podeReenviar, prazoDoLimite, proximaIaNoLimite } from "../domain/inteligencia.ts";
import { usoDoPlanoValido } from "../domain/uso-do-plano.ts";
import { trabalhoAberto } from "../domain/trabalho.ts";
import { entradaDaTrocaDeConta, entradaDaVoltaDaCota } from "../domain/cota-da-ia.ts";
import { fraseDaDecisao, PRAZO_SEM_HORARIO_MS } from "../domain/contas-da-ia.ts";
import { decidirLimiteDaConta, fraseDoLimiteDaConta, type ContaDaPessoa, type DecisaoDoLimiteDaConta } from "../domain/contas-da-pessoa.ts";
import { harnessFixado } from "../domain/harness.ts";
import { criarNotaDeContas, lerContasDaMaquina } from "./contas-do-turno.ts";
import { adiarFala } from "./adiar-fala.ts";
import { alvoDoBot } from "./alvo-do-bot.ts";
import { log } from "../obs/log.ts";
import { rotinaDoTurno } from "./apoio-l7.ts";
import { autoriaAgente, autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { aposQuedaDaMaquina } from "./interromper-por-maquina.ts";
import { postarNaSala } from "./postar-na-sala.ts";
import { continuarAprovacoesDoTurno } from "./decidir.ts";
import { confirmarNaSessao } from "./sessao-viva.ts";
import { emSavepoint } from "./savepoint.ts";
import { sincronizarDoTurno } from "./trabalhos.ts";
import { propagarSessaoDoTurno } from "./sessao-do-turno.ts";
import { esperaAoAssentar } from "./esperar-comando.ts";
import { voltaMarcadaAoAssentar } from "./me-chame-as.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/** `harness`: o que rodou o turno (vem do plano puxado, nunca da máquina); grava o dono da sessão (0030). */
/**
 * `outraIa` (definido em 2026-10-05): quando o turno voltou com `causaSemIa`, a outra IA que a máquina tem pronta
 * (quem sabe é a ponte, que guarda o inventário anunciado); null = nenhuma.
 */
/**
 * `bifurcou` (definido em 2026-10-08, revisão do épico, S15): o plano deste turno pediu a cópia da sessão (`bifurcar`).
 * Quem sabe é a ponte, que guardou o plano puxado.
 */
/**
 * `maquinaBifurca` (definido em 2026-10-12, ADR-099, I8): a máquina deste turno anunciou que bifurca sessão com este
 * harness. Sem isso a rede promoveu largando a sessão da conversa (o dono segue com o histórico), e a sessão do turno
 * promovido nunca volta para a conversa. Ausente = como antes (bifurca).
 */
/**
 * `prontosDaPessoa` (definido em 2026-10-10, emenda da ADR-036): as IAs prontas em alguma máquina viva da pessoa (quem
 * sabe é a ponte). No limite da assinatura, o turno do Automático é repetido na próxima delas pela ordem (aposLimite).
 * `prontosPorMaquina` (definido em 2026-10-15, NOD-268; revisão do PR #319): as IAs prontas em cada máquina conectada.
 * Com o bot preso a uma máquina (a dele ou a padrão da pessoa, ADR-090), a troca só vai para uma IA pronta NELA — a de
 * outra máquina nunca pegaria o turno.
 */
export type EntradaAssentarTurno = Entrega & { executor?: Executor; harness?: IdHarness | null; outraIa?: IdHarness | null; bifurcou?: boolean; maquinaBifurca?: boolean; prontosDaPessoa?: readonly IdHarness[]; prontosPorMaquina?: Readonly<Record<string, readonly IdHarness[]>> };
export type SaidaAssentarTurno = {
  turno: Turno | null;
  mensagem: Mensagem | null;
  /** (turno, seq_local) já entregue: nada regravado (ADR-021). */
  duplicada: boolean;
  /** Turno já terminal (varredor/parar chegaram antes): a fala entra como anexo parcial, sem reabrir (ADR-010). */
  tardia: boolean;
  /** 0068: a IA do turno entrou no limite ou saiu dele — a ponte esquece o que leu dos limites e avisa a tela. */
  limiteMudou?: boolean;
};

/** NOD-264 (E8): o "Retomar" do turno que a entrega tardia com sucesso promoveu fecha por esta regra. */
export const REGRA_ENTREGA_TARDIA = "regra:entrega_tardia_com_sucesso" as const;
/** NOD-261 (G3): um turno posterior do mesmo trabalho concluiu; os "Retomar" dos anteriores fecham por esta regra. */
export const REGRA_RETOMAR_SUPERADO = "regra:retomar_superado" as const;

function decididaPorRegra(deps: Deps, d: { id: string; tipo: string; agenteId: string; conversaId: string; turnoId: string | null }, regra: `regra:${string}`, agora: number): RuntimeEvent {
  const autoria = autoriaAgente({ agenteId: d.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher", decididoPor: regra });
  return evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: d.conversaId, turnoId: d.turnoId, dados: { decisao_id: d.id, tipo: d.tipo, regra } });
}

async function fecharRetomarDoTurno(deps: Deps, turno: Turno, regra: typeof REGRA_ENTREGA_TARDIA, agora: number): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = [];
  for (const d of await deps.repos.decisoes.doTurno(turno.id)) {
    if (d.tipo !== "retomar_turno" || (d.estado !== "pendente" && d.estado !== "reaberta")) continue;
    const fechada = await deps.repos.decisoes.fecharPorRegra(d.id, { regra, regraVersao: 1, agora });
    if (fechada) events.push(decididaPorRegra(deps, fechada, regra, agora));
  }
  return events;
}

async function fecharRetomarSuperados(deps: Deps, turno: Turno, agora: number): Promise<RuntimeEvent[]> {
  if (!turno.trabalhoId) return [];
  const fechadas = await deps.repos.decisoes.fecharRetomarAnteriores(turno.trabalhoId, turno.id, { regra: REGRA_RETOMAR_SUPERADO, regraVersao: 1, agora });
  return fechadas.map((d) => decididaPorRegra(deps, d, REGRA_RETOMAR_SUPERADO, agora));
}

/** Código do erro para o log (SQLSTATE ou nome); nunca a mensagem, que pode carregar dado. */
function motivoDoErro(e: unknown): string {
  const codigo = (e as { code?: unknown } | null)?.code;
  if (typeof codigo === "string" && codigo !== "") return codigo;
  return e instanceof Error ? e.name : "desconhecido";
}

/**
 * definido em 2026-10-08 (NOD-200, ADR proposta): a última tela que o bot viu no turno vira anexo png da fala dele.
 * Num SAVEPOINT: a falha (teto, RLS, banco) volta só o anexo, e a mensagem entra igual. O log leva o turno e o
 * motivo, nunca os bytes.
 */
async function anexarCaptura(deps: Deps, p: { turnoId: string; conversaId: string; mensagemId: string; bytes: Uint8Array; agora: number }): Promise<void> {
  const recusa = recusaDoArquivo("image/png", p.bytes.byteLength);
  if (recusa) {
    log("aviso", "captura_turno_falhou", { turno_id: p.turnoId, motivo: recusa === "tamanho" ? "acima_do_teto" : recusa });
    return;
  }
  try {
    await emSavepoint(deps, async () => {
      const anexo = await deps.repos.anexos.criar({ conversaId: p.conversaId, nome: `tela-${horaMinuto(p.agora).replace(":", "")}.png`, mime: "image/png", conteudo: p.bytes });
      if (!anexo) throw new ErroDeDominio("estado_invalido", { cause: "anexo_nao_criado" });
      const presos = await deps.repos.anexos.prender([anexo.id], { conversaId: p.conversaId, mensagemId: p.mensagemId });
      if (presos.length !== 1) throw new ErroDeDominio("estado_invalido", { cause: "anexo_nao_preso" });
    });
  } catch (e) {
    log("aviso", "captura_turno_falhou", { turno_id: p.turnoId, motivo: motivoDoErro(e) });
  }
}

type Desfecho = { estado: "concluido" | "interrompido"; motivoInterrupcao: MotivoInterrupcao | null; motivoFalha: MotivoFalha | null };

/**
 * Regra do servidor (ADR-009, pendência da L2): o classificador não distingue parar de sumiço —
 * interrompido SEM motivo vira parado_pela_pessoa se a pessoa pediu (parar_solicitado_em), senão
 * sem_progresso. definido em 2026-09-16: com quatro estados (ADR-010) a falha técnica do CLI
 * (result com subtype ≠ success) é um turno INTERROMPIDO cujo motivo_falha guarda o subtipo.
 *
 * definido em 2026-09-24 (ADR-045): entrega que NÃO é sucesso com o lease já vencido e sem Parar é a
 * máquina que parou de responder (o Mac dormiu; a renovação voltou {ativo:false} e o laço matou o CLI)
 * — maquina_sem_contato, o mesmo desfecho do varredor. Sucesso depois do lease vencido é trabalho
 * TERMINADO e assenta como concluído.
 */
export function desfechoDaEntrega(turno: Pick<Turno, "pararSolicitadoEm" | "leaseAte">, resultado: Entrega["resultado"], agora: number): Desfecho {
  if (resultado.desfecho === "sucesso") return { estado: "concluido", motivoInterrupcao: null, motivoFalha: null };
  // definido em 2026-10-05: a conta da IA não serviu — o mesmo desfecho de quando o inventário já barra o despacho
  // (despachar-turno.ts, recusarPorExecutor): nenhum trabalho começou.
  if (resultado.causaSemIa) return { estado: "interrompido", motivoInterrupcao: "executor_indisponivel", motivoFalha: "nao_autenticado" };
  if (turno.pararSolicitadoEm === null && turno.leaseAte !== null && turno.leaseAte < agora) return { estado: "interrompido", motivoInterrupcao: "maquina_sem_contato", motivoFalha: resultado.motivoFalha ?? null };
  // definido em 2026-09-18: quem produziu saída e não concluiu NÃO é 'sem_progresso' — o rótulo
  // mentia num turno que tinha lido arquivos e escrito no chat antes de acabar. producedOutput é o
  // sinal que o ADR-009 já grava para isso.
  if (resultado.desfecho === "falha") return { estado: "interrompido", motivoInterrupcao: resultado.sinais.producedOutput ? "trabalho_incompleto" : "sem_progresso", motivoFalha: resultado.motivoFalha ?? "erro_execucao" };
  const semMotivo = turno.pararSolicitadoEm !== null ? "parado_pela_pessoa" : resultado.sinais.producedOutput ? "trabalho_incompleto" : "sem_progresso";
  const motivo = resultado.motivoInterrupcao ?? semMotivo;
  return { estado: "interrompido", motivoInterrupcao: motivo, motivoFalha: resultado.motivoFalha ?? null };
}

/**
 * ENTREGAR (ADR-021): idempotente por (turno, seq_local); grava a fala do agente (autoria composta,
 * confiança do turno, parcial se interrompido), sessão do CLI na conversa, gastos (ADR-015), o estado
 * terminal com motivo, negações de permissão renderizadas (ADR-029) e os eventos — tudo na MESMA tx.
 */
export const assentarTurno: CasoDeUso<EntradaAssentarTurno, SaidaAssentarTurno> = async (deps, entrega) => {
  const primeira = await deps.repos.turnos.registrarEntrega(entrega.turnoId, entrega.seqLocal);
  if (!primeira) return { data: { turno: null, mensagem: null, duplicada: true, tardia: false } };
  // NOD-200: só lida aqui — a ponte a esquece depois do assentar confirmado, em todo ramo; a repetição por impasse acha a mesma.
  const captura = deps.services.capturas?.ler(entrega.turnoId) ?? null;
  // Trava de linha: Parar (parar_solicitado_em) pode estar commitando em paralelo; a leitura espera por ele (ADR-009: quem decide o motivo é o servidor).
  const turno = await deps.repos.turnos.buscarTravado(entrega.turnoId);
  if (!turno) throw new ErroDeDominio("nao_encontrado");
  if (turno.machineId !== null && turno.machineId !== entrega.machineId) throw new ErroDeDominio("nao_permitido", { cause: "entrega de outra máquina" });

  const agora = deps.agora();
  // NOD-206: a ponte sempre manda o executor do plano; sem ele, o que o plano gravou no turno (nunca um padrão fixo).
  const executor = entrega.executor ?? turno.executor;
  const resultado = entrega.resultado;
  const tardia = turno.estado !== "pendente" && turno.estado !== "despachando";
  // Revisão do épico (S19, 2026-10-08): mensagens que o CLI recebeu e cuja confirmação não chegou numa renovação (a
  // última falhou) — a entrega as confirma ANTES de assentar, senão viravam turno próprio e a resposta saía duas vezes.
  // Com a linha do turno já travada (a ordem de sempre: turno, depois os recados, depois o trabalho).
  const confirmadas = entrega.mensagensEntregues?.length && !tardia ? await confirmarNaSessao(deps, { turnoId: turno.id, executor, ids: entrega.mensagensEntregues }) : null;
  const desfecho = desfechoDaEntrega(turno, resultado, agora);
  // NOD-264 (E8, emenda da ADR-045 sobre a ADR-010): o trabalho terminou com sucesso e só a máquina sumiu antes de
  // entregar; sem retomada criada, a entrega promove o turno a `concluido` (a fala entra inteira, não parcial).
  const promoverTardia = tardia && turno.estado === "interrompido" && resultado.desfecho === "sucesso" && !resultado.causaSemIa
    && (turno.motivoInterrupcao === "maquina_sem_contato" || turno.motivoInterrupcao === "reinicio_servidor")
    && !(await deps.repos.turnos.temRetomada(turno.id));
  const interrompido = (tardia && !promoverTardia) || desfecho.estado === "interrompido";
  // A máquina caiu (ADR-045): nesta entrega (lease vencido) ou antes dela, pelo varredor (tardia).
  const quedaDaMaquina = !tardia && desfecho.motivoInterrupcao === "maquina_sem_contato";
  // Lido AGORA: assentar zera lease_ate, e o último sinal de vida (lease − LEASE_MS) é o começo do aviso.
  const perdidoDesde = ultimoSinalDoTurno(turno, agora);
  const caiuAntes = tardia && turno.motivoInterrupcao === "maquina_sem_contato" && resultado.desfecho !== "sucesso";
  // definido em 2026-09-24 (ADR-045): rotina derrubada pela máquina não escreve na conversa — nem a
  // fala parcial, que seria um "Vou verificar…" cortado. A execução vai só para o histórico da rotina.
  // Sucesso tardio continua entrando: é trabalho terminado, e o entregável da rotina É a fala.
  const rotinaCaida = quedaDaMaquina || caiuAntes ? (await rotinaDoTurno(deps.repos, turno.id)) !== null : false;
  // definido em 2026-09-21: o agente chamou `sem_novidade` — consultou e nada mudou, então a fala
  // dele NÃO entra na conversa (era o flood de "nenhum update" a cada execução). Só vale onde
  // ninguém espera resposta: turno de rotina/retomada. Em conversa ou sala a pessoa ficaria no
  // vácuo, e por isso a ferramenta nem é oferecida nesses modos (plano-turno.ts).
  // Um turno interrompido não é silenciado: o texto pode ser um relato parcial de bloqueio, e o
  // silêncio só é honesto quando a execução foi completa.
  const silencioso = turno.semNovidadeMotivo !== null && !interrompido && (turno.origem === "rotina" || turno.origem === "retomada");
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor, machineId: entrega.machineId });
  const events: RuntimeEvent[] = [...(confirmadas?.events ?? [])];

  // Comando da conversa (0038): /uso e /contexto voltam do Claude Code em inglês; a pessoa lê em português. O
  // /compactar não tem resposta para a pessoa: medido ao vivo em 28/09, o CLI devolveu como resultado a saída do
  // /contexto anterior (o último texto que sobra na sessão compactada). Vale só a linha com os números, abaixo.
  const comandoDoTurno = comandoDaConversa(turno.entradaTexto)?.comando.nome;
  // definido em 2026-10-05: com `causaSemIa` não há fala — o que veio é a recusa do fornecedor, nunca texto do bot.
  const falaTexto = entrega.fala.tipo === "texto" && comandoDoTurno !== "compactar" && !resultado.causaSemIa ? traduzirSaidaDoComando(turno.entradaTexto, entrega.fala.texto, entrega.harness) : "";
  let mensagem: Mensagem | null = null;
  /** NOD-200: a fala de texto do bot fora de sala, não silenciada nem tardia — só ela leva a captura. */
  let falaDoBot = false;
  if (entrega.fala.tipo === "passe") {
    const agente = await deps.repos.agentes.buscar(turno.agenteId);
    mensagem = await deps.repos.mensagens.criar({
      conversaId: turno.conversaId,
      turnoId: turno.id,
      autoria,
      kind: "passe",
      texto: redigir("passe", agora, { agente: agente?.nome ?? "agente", motivo: entrega.fala.motivo }),
      payload: { kind: "passe", motivo: entrega.fala.motivo },
      confianca: turno.entradaConfianca,
      parcial: interrompido,
    });
  } else if (falaTexto.trim() !== "" && turno.origem === "sala" && !tardia) {
    // definido em 2026-09-16 (pendência L7 §4): a fala de um bot numa sala entra por postarNaSala para os
    // responders (menção) e o orçamento do canal rodarem na MESMA tx — nunca por mensagens.criar direto.
    const conversa = await deps.repos.conversas.buscar(turno.conversaId);
    if (!conversa?.salaId) throw new ErroDeDominio("estado_invalido", { cause: "turno de sala sem sala" });
    const post = await postarNaSala(deps, { salaId: conversa.salaId, texto: falaTexto, autoria, confianca: turno.entradaConfianca, turnoId: turno.id, executor, eRotina: false });
    mensagem = post.data.mensagem;
    events.push(...(post.events ?? []).filter((ev) => ev.kind !== "mensagem_criada"));
  } else if (falaTexto.trim() !== "" && !silencioso && !rotinaCaida) {
    mensagem = await deps.repos.mensagens.criar({
      conversaId: turno.conversaId,
      turnoId: turno.id,
      autoria,
      kind: "texto",
      texto: falaTexto,
      payload: null,
      confianca: turno.entradaConfianca,
      parcial: interrompido,
    });
    falaDoBot = !tardia;
  }
  if (captura && falaDoBot && mensagem) await anexarCaptura(deps, { turnoId: turno.id, conversaId: turno.conversaId, mensagemId: mensagem.id, bytes: captura, agora });
  // /compactar não tem fala: a conversa ganha a linha com quanto o histórico ocupava e quanto sobrou.
  const compactacao = resultado.execucao?.compactacoes.at(-1);
  if (!mensagem && !tardia && comandoDoTurno === "compactar" && resultado.desfecho === "sucesso") {
    const agente = await deps.repos.agentes.buscar(turno.agenteId);
    mensagem = await deps.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "sistema", texto: textoDaCompactacao(agente?.nome ?? "O bot", compactacao?.antes ?? null, compactacao?.depois ?? null), confianca: "confiavel" });
  }
  if (mensagem) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: mensagem.id, kind: mensagem.kind, parcial: mensagem.parcial } }));

  // Revisto em 2026-10-12 (NOD-214): as regras de onde a sessão vale estão em sessao-do-turno.ts (o varredor também usa).
  await propagarSessaoDoTurno(deps, { turno, sessaoCli: resultado.sessaoCli, executor, harness: entrega.harness ?? null, maquinaBifurca: entrega.maquinaBifurca !== false });
  // Revisão do épico (S15, 2026-10-08): o turno que devia continuar numa cópia da sessão voltou recusado (o CLI daquela
  // máquina não bifurca). A conversa larga a sessão: o próximo plano sai em sessão nova com o histórico recente, em vez de
  // pedir a cópia de novo e ser recusado em laço.
  if (entrega.bifurcou && !turno.trabalhoId && desfecho.motivoInterrupcao === "executor_indisponivel" && !resultado.causaSemIa) await deps.repos.conversas.atualizarSessaoCli(turno.conversaId, null);
  // 0035: o `total_cost_usd` do CLI é o total da SESSÃO; numa sessão retomada ele traz o custo dos turnos
  // anteriores. O turno custa a diferença — em gastos, no turno e nos eventos.
  const anterior = resultado.sessaoCli ? await deps.repos.turnos.totalAnteriorDaSessao(resultado.sessaoCli, turno.id) : null;
  const custoUsd = custoDoTurno(resultado.custoUsd, anterior);
  await deps.repos.gastos.registrar({
    turnoId: turno.id,
    executor,
    tokensEntrada: resultado.tokens.entrada,
    tokensSaida: resultado.tokens.saida,
    custoUsd,
    modelo: turno.modelo,
    em: agora,
  });
  if (turno.trabalhoId && custoUsd !== null && custoUsd > 0) await deps.repos.trabalhos.somarCusto(turno.trabalhoId, custoUsd);
  // Modo dev (0036): cada chamada e as compactações. Também na entrega tardia, que é a que mais pede explicação.
  if (resultado.execucao) await deps.repos.raioX.gravarExecucao(turno.id, resultado.execucao);
  // O "/" do chat (0038): o catálogo do Mac, quando o app mandou um novo.
  if (resultado.comandos) await deps.repos.comandos.gravar(resultado.comandos);
  // NOD-179: o uso do plano que o CLI informou. Só vale para o CLI que rodou o turno (o harness vem do plano puxado,
  // nunca da máquina) e é revalidado aqui, porque a entrega local não passa pela ponte HTTP. Nunca recusa a entrega.
  if (resultado.usoDoPlano) {
    const uso = usoDoPlanoValido(resultado.usoDoPlano, agora);
    if (uso && uso.harness === entrega.harness) await deps.repos.usoDoPlano.gravar(uso, entrega.machineId);
    else log("aviso", "uso_do_plano_descartado", { turno_id: turno.id, harness_do_turno: entrega.harness ?? null, valido: uso !== undefined });
  }

  for (const { nome, causa, vezes } of negacoesDoTurno(resultado)) {
    // definido em 2026-10-01 (ADR-066): a nativa do kit do terminal que o CLI negou foi o HOOK do nod que negou — comando
    // esperando aprovação, recusado ou numa cerca —, não o catálogo. 5 das 6 falas "Bash negada: fora do catálogo deste
    // turno" de 29 e 30/09 (Clarice, Chico, Nina) eram comandos esperando aprovação, num turno com o Bash no plano.
    // ADR-103: o kit do Codex também é do hook.
    const motivo = ([...NATIVAS_DO_TERMINAL, ...NATIVAS_DO_TERMINAL_CODEX, NATIVA_MCP_DA_PESSOA] as readonly string[]).includes(nome) ? ("alcance_insuficiente" as const) : ("fora_do_catalogo" as const);
    const negacao = { classe: "ferramenta_negada" as const, nome, motivo, desde: agora, terminal: false, ...(causa ? { causa } : {}), ...(vezes > 1 ? { vezes } : {}) };
    const m = await deps.repos.mensagens.criar({
      conversaId: turno.conversaId,
      turnoId: turno.id,
      autoria,
      kind: "negacao",
      texto: descreverNegacao(negacao, agora),
      payload: { kind: "negacao", classe: negacao.classe, nome, motivo: negacao.motivo, terminal: false, ...(causa ? { causaNativa: causa, vezes } : {}) },
      confianca: "confiavel",
    });
    events.push(evento(deps.escopo, { kind: "negacao", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { nome, motivo: negacao.motivo, classe: negacao.classe, terminal: false, mensagem_id: m?.id ?? null, ...(causa ? { causa_nativa: causa, vezes } : {}) } }));
  }

  if (tardia && promoverTardia) {
    const promovido = await deps.repos.turnos.concluirTardia(turno.id, {
      sinais: resultado.sinais,
      custoUsd,
      tokensEntrada: resultado.tokens.entrada,
      tokensSaida: resultado.tokens.saida,
      sessaoCli: resultado.sessaoCli,
      custoSessaoUsd: resultado.custoUsd,
    });
    if (promovido) {
      events.push(...(await fecharRetomarDoTurno(deps, promovido, REGRA_ENTREGA_TARDIA, agora)));
      events.push(...(await fecharRetomarSuperados(deps, promovido, agora)));
      events.push(evento(deps.escopo, { kind: "turno_encerrado", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { estado: "concluido", custo_usd: custoUsd, ferramentas: resultado.ferramentasChamadas.length, regra: REGRA_ENTREGA_TARDIA } }));
      events.push(...(await sincronizarDoTurno(deps, promovido)));
      return { data: { turno: promovido, mensagem, duplicada: false, tardia: true }, events };
    }
    // A retomada chegou antes (corrida com o varredor): a fala volta a ser anexo parcial, como hoje.
    await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
  }
  if (tardia) {
    // Entrega depois do varredor/parar: aceita como anexo parcial, sem reabrir (ADR-010).
    events.push(...(await sincronizarDoTurno(deps, turno)));
    return { data: { turno, mensagem, duplicada: false, tardia: true }, events };
  }

  const assentado = await deps.repos.turnos.assentar(turno.id, {
    estado: desfecho.estado,
    motivoInterrupcao: desfecho.motivoInterrupcao,
    motivoFalha: desfecho.motivoFalha,
    sinais: resultado.sinais,
    custoUsd,
    tokensEntrada: resultado.tokens.entrada,
    tokensSaida: resultado.tokens.saida,
    sessaoCli: resultado.sessaoCli,
    custoSessaoUsd: resultado.custoUsd,
    // NOD-241 (emenda da ADR-084): o último sinal do turno que caiu — o da máquina (lease − LEASE_MS) ou agora.
    ultimoSinalEm: desfecho.estado === "interrompido" ? (quedaDaMaquina ? perdidoDesde : agora) : undefined,
  });
  if (!assentado) throw new ErroDeDominio("estado_invalido", { cause: "turno mudou de estado durante a entrega" });

  // 0068 (emenda da ADR-036): o limite da assinatura, pelo protocolo do Claude Code ou pela classe do texto do Codex, vale
  // para a ordem de todos os bots até `renovaEm`; um turno que dá certo na IA a tira do limite antes do prazo.
  const ehLimite = desfecho.estado === "interrompido" && !quedaDaMaquina && !resultado.causaSemIa
    && (desfecho.motivoFalha === "limite_do_plano" || (desfecho.motivoFalha !== null && classificarErroFornecedor(resultado.erroCru) === "limite_de_uso"));
  let limite: { ia: IdHarness; renovaEm: number } | null = null;
  let limiteMudou = false;
  let trocou: RuntimeEvent[] | null = null;
  // ADR-101 (2026-10-12): com outra conta livre na mesma IA, a IA NÃO fica no limite — o Mac trocou de conta ou a pessoa
  // escolhe com quem seguir. Só a conta em uso parou (o Mac guarda isso; o servidor só vê posições).
  const contas = ehLimite ? resultado.contaNoLimite : undefined;
  const contaLivre = contas !== undefined && contas.tipo !== "todas_no_limite";
  // ADR-102 (2026-10-13): a conta da lista que o plano mandou usar. No limite, quem para é ELA (vale em todas as
  // máquinas), não a IA; a decisão segue as regras da lista (contas-da-pessoa.ts).
  const contaDoTurnoId = entrega.harness ? await deps.repos.turnos.contaDoTurno(turno.id) : null;
  const limiteDaConta = ehLimite && contaDoTurnoId && !contaLivre
    ? await decidirLimiteNoAssentamento(deps, { turno, contaId: contaDoTurnoId, machineId: entrega.machineId, ate: desfecho.motivoFalha === "limite_do_plano" ? resultado.limiteVoltaEm ?? null : null, agora })
    : null;
  if (ehLimite && entrega.harness && contaLivre) {
    log("aviso", "conta_no_limite", { turno_id: turno.id, harness: entrega.harness, tipo: contas.tipo, de: contas.de, para: contas.tipo === "trocou" ? contas.para : null });
  } else if (ehLimite && entrega.harness && limiteDaConta) {
    log("aviso", "conta_da_lista_no_limite", { turno_id: turno.id, harness: entrega.harness, conta_id: contaDoTurnoId, decisao: limiteDaConta.decisao.tipo, volta_em: limiteDaConta.voltaEm });
  } else if (ehLimite && entrega.harness) {
    const renovaEm = prazoDoLimite(desfecho.motivoFalha === "limite_do_plano" ? resultado.limiteVoltaEm : null, agora);
    await deps.repos.preferencias.registrarLimite(entrega.harness, { renovaEm, desde: agora });
    limite = { ia: entrega.harness, renovaEm };
    limiteMudou = true;
    log("aviso", "ia_no_limite", { turno_id: turno.id, harness: entrega.harness, renova_em: renovaEm, do_fornecedor: desfecho.motivoFalha === "limite_do_plano" && resultado.limiteVoltaEm === renovaEm });
  } else if (desfecho.estado === "concluido" && entrega.harness) {
    limiteMudou = await deps.repos.preferencias.limparLimite(entrega.harness);
    // ADR-102: o turno deu certo na conta — ela sai do limite antes do prazo.
    if (contaDoTurnoId && (await deps.repos.contasIa.limparLimite(contaDoTurnoId))) limiteMudou = true;
  }

  if (turno.origem === "ligacao") {
    // ADR-072: o turno-cérebro não ganha aviso de interrupção nem card "Retomar" — quem conta como a ligação acabou é a
    // linha "Chat de voz" (e o resumo, quando houve). O evento sai para a tela soltar o turno.
    // definido em 2026-10-05 (rede de segurança da ligação): o evento leva POR QUE o cérebro parou, só em código — o
    // motivo, a IA que rodava e a causa "conta sem acesso" quando o driver a reconheceu. É o que o orquestrador de voz
    // usa para não deixar a ligação muda (src/domain/ligacao-sem-ia.ts). Nunca o texto do fornecedor.
    const porQueParou = { motivo: desfecho.motivoInterrupcao, motivo_falha: desfecho.motivoFalha, harness: entrega.harness ?? null, ...(resultado.causaSemIa ? { causa_sem_ia: resultado.causaSemIa } : {}) };
    events.push(evento(deps.escopo, { kind: desfecho.estado === "interrompido" ? "turno_interrompido" : "turno_encerrado", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { estado: desfecho.estado, origem: "ligacao", custo_usd: custoUsd, ...porQueParou } }));
    if (mensagem && turno.ligacaoId) await deps.repos.ligacoes.marcarResumida(turno.ligacaoId);
  } else if (quedaDaMaquina) {
    // A MESMA regra do varredor (interromper-por-maquina.ts): sem a linha 'sistema' e o evento daqui,
    // que dariam à rotina uma mensagem no chat e à conversa duas linhas para a mesma queda.
    const q = await aposQuedaDaMaquina(deps, assentado, { perdidoDesde });
    events.push(...q.events);
  } else if (resultado.causaSemIa) {
    events.push(...(await aposContaSemAcesso(deps, { turno, executor, harness: entrega.harness ?? null, outraIa: entrega.outraIa ?? null, causa: resultado.causaSemIa, autoria, agora, custoUsd })));
  } else if (resultado.contaAusente && contaDoTurnoId && (trocou = await aposContaAusente(deps, { turno, assentado, executor, contaId: contaDoTurnoId, machineId: entrega.machineId, motivoInterrupcao: desfecho.motivoInterrupcao, motivoFalha: desfecho.motivoFalha, autoria, agora, custoUsd }))) {
    events.push(...trocou);
  } else if (limiteDaConta && (trocou = await aposLimiteDaConta(deps, { turno, assentado, executor, ...limiteDaConta, motivoInterrupcao: desfecho.motivoInterrupcao, motivoFalha: desfecho.motivoFalha, autoria, agora, custoUsd }))) {
    events.push(...trocou);
  } else if (contas?.tipo === "trocou" && entrega.harness && (trocou = await aposTrocaDeConta(deps, { turno, executor, ia: entrega.harness, troca: contas, autoria, agora, custoUsd, motivoInterrupcao: desfecho.motivoInterrupcao, motivoFalha: desfecho.motivoFalha }))) {
    events.push(...trocou);
  } else if (contaLivre && entrega.harness && (trocou = await aposLimiteNoFundo(deps, { turno: assentado, executor, ia: entrega.harness, renovaEm: contas.tipo === "trocou" ? agora : prazoDoLimite(contas.voltaEm, agora), conta: contas, motivoInterrupcao: desfecho.motivoInterrupcao, motivoFalha: desfecho.motivoFalha, autoria, agora, custoUsd }))) {
    // QA do NOD-211 (2026-10-12): a task (frente) cuja conta parou com outra livre não pode cair no aviso de sempre e
    // virar "falhou" (ADR-099 §7). "trocou": segue já, na conta nova; "perguntar": nada troca sozinho, espera a conta voltar.
    events.push(...trocou);
  } else if (limite && (trocou = await aposLimite(deps, { turno, executor, ...limite, prontos: entrega.prontosDaPessoa ?? [], prontosPorMaquina: entrega.prontosPorMaquina ?? null, motivoInterrupcao: desfecho.motivoInterrupcao, motivoFalha: desfecho.motivoFalha, autoria, agora, custoUsd }))) {
    events.push(...trocou);
  } else if (limite && (trocou = await aposLimiteNoFundo(deps, { turno: assentado, executor, ...limite, motivoInterrupcao: desfecho.motivoInterrupcao, motivoFalha: desfecho.motivoFalha, autoria, agora, custoUsd }))) {
    events.push(...trocou);
  } else if (desfecho.estado === "interrompido") {
    await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
    const motivo = desfecho.motivoFalha ?? desfecho.motivoInterrupcao ?? "sem_progresso";
    // NOD-174: falha do fornecedor com classe conhecida ganha a frase com ação ("sua conta do Claude Code saiu deste
    // Mac…"); o motivo gravado continua o do protocolo (ADR-009). O cru fica só no diagnóstico (ADR-041).
    // NOD-171: o limite do plano veio do protocolo e diz quando volta; a frase leva a hora.
    const fraseFornecedor =
      contas && entrega.harness
        ? fraseDaDecisao(contas, { ia: nomeDaIa(entrega.harness), quando: (t) => horaDaFrase(t, agora), quandoVolta: (t) => quandoDaFrase(t, agora) })
        : desfecho.motivoFalha === "limite_do_plano"
        ? fraseDoLimiteDoPlano(entrega.harness ?? null, resultado.limiteVoltaEm, agora)
        : desfecho.motivoFalha
          ? fraseDoErroFornecedor(entrega.harness ?? null, resultado.erroCru)
          : null;
    // NOD-171: o limite do plano (do protocolo ou do texto do Codex) leva o payload, para a tela desenhar o card dele.
    const limite = desfecho.motivoFalha === "limite_do_plano" || (desfecho.motivoFalha && classificarErroFornecedor(resultado.erroCru) === "limite_de_uso");
    const aviso = await deps.repos.mensagens.criar({
      conversaId: turno.conversaId,
      turnoId: turno.id,
      autoria,
      kind: "sistema",
      // ADR-101: a frase das contas já é uma frase inteira ("Conta 1 do Claude Code no limite até 14:00. Seguir com a conta 2?").
      texto: contas && entrega.harness && fraseFornecedor ? fraseFornecedor : redigir("turno-interrompido", agora, { motivo: fraseFornecedor ?? motivoEmPortugues(motivo) }),
      ...(limite ? { payload: { kind: "limite_do_plano" as const, harness: entrega.harness ?? null, voltaEm: desfecho.motivoFalha === "limite_do_plano" && resultado.limiteVoltaEm && resultado.limiteVoltaEm > agora ? resultado.limiteVoltaEm : null, ...(contas ? { conta: contas } : {}) } } : {}),
      confianca: "confiavel",
    });
    if (aviso) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: aviso.id, kind: "sistema" } }));
    events.push(evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: desfecho.motivoInterrupcao, motivo_falha: desfecho.motivoFalha, custo_usd: custoUsd, ...(causaDaEntrega(resultado.causa) ? { causa: causaDaEntrega(resultado.causa) } : {}) } }));
  } else {
    events.push(evento(deps.escopo, { kind: "turno_encerrado", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { estado: "concluido", custo_usd: custoUsd, ferramentas: resultado.ferramentasChamadas.length } }));
  }

  // definido em 2026-09-28 (0032): aprovação já decidida que este turno não chegou a receber (a espera acabou
  // um instante antes do clique) vira UMA retomada — nunca duas, e nunca nenhuma.
  events.push(...(await continuarAprovacoesDoTurno(deps, assentado)));
  // NOD-261 (G3): o trabalho concluiu neste turno — os "Retomar" de turnos anteriores dele ficaram sem objeto.
  if (desfecho.estado === "concluido") events.push(...(await fecharRetomarSuperados(deps, assentado, agora)));
  // ADR-086: o turno marcou uma volta ("me chame às 16:00") — ela nasce agora, antes de o trabalho reler o estado.
  events.push(...(await voltaMarcadaAoAssentar(deps, turno, desfecho.estado === "concluido")));
  // ADR-099 (parte 2): o comando que o turno deixou esperando — se já acabou, a volta nasce agora; se o turno terminou
  // mal, a espera é cancelada.
  events.push(...(await esperaAoAssentar(deps, turno, desfecho.estado === "concluido")));
  // ADR-083: o trabalho do turno muda de estado pelos fatos (terminado, precisa de você, parado, falhou ou segue).
  events.push(...(await sincronizarDoTurno(deps, assentado)));
  return { data: { turno: assentado, mensagem, duplicada: false, tardia: false, ...(limiteMudou ? { limiteMudou } : {}) }, events };
};

/**
 * O turno parou no LIMITE da assinatura (definido em 2026-10-10, emenda da ADR-036; teste do Breno em 09/10: a ligação
 * bateu no limite do Claude e nada trocava de IA sozinho). A fala da pessoa a um bot no Automático é repetida na próxima
 * IA da ordem dele (a própria ou a da pessoa) que esteja pronta em alguma máquina viva e fora do limite, e a conversa
 * ganha a linha "O Claude chegou ao limite · respondendo pelo ChatGPT" (payload `ia_trocada`, causa `limite`). A fila
 * já não entrega o turno novo à IA parada (iasParaOAutomatico) e o plano o resolve na próxima (o limite acabou de ser
 * gravado). null = não repete: bot em "Uma IA só", rotina, sala, pedido entre bots (mesmos motivos de aposContaSemAcesso)
 * ou nenhuma outra IA disponível — então vale o aviso do limite de sempre, com a hora.
 *
 * revisto em 2026-10-15 (NOD-268, a conversa inundada de 15/10): (1) o turno novo sai FIXO na IA escolhida — no `auto`,
 * outra máquina o pegava e o rodava de novo na IA parada; (2) com o bot preso a uma máquina (ADR-090), só vale IA pronta
 * NELA (`prontosPorMaquina` + alvoDoBot); a que está pronta noutra máquina vira a linha "pronto noutra máquina, mas este bot roda em…" e a
 * fala espera a hora do limite; (3) passou do teto de reenvios (TETO_REENVIOS), a fala espera a hora, com UMA linha.
 */
async function aposLimite(
  deps: Deps,
  p: { turno: Turno; executor: Executor; ia: IdHarness; renovaEm: number; prontos: readonly IdHarness[]; prontosPorMaquina: Readonly<Record<string, readonly IdHarness[]>> | null; motivoInterrupcao: MotivoInterrupcao | null; motivoFalha: MotivoFalha | null; autoria: Autoria; agora: number; custoUsd: number | null },
): Promise<RuntimeEvent[] | null> {
  const { turno, autoria, agora } = p;
  if (turno.origem !== "conversa" || turno.harness !== "auto" || turno.modelo !== "auto") return null;
  const [agente, preferencias] = await Promise.all([deps.repos.agentes.buscar(turno.agenteId), deps.repos.preferencias.buscar()]);
  if (!agente) return null;
  const interrompido = evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: p.motivoInterrupcao, motivo_falha: p.motivoFalha, ia_no_limite: p.ia, renova_em: p.renovaEm, custo_usd: p.custoUsd } });
  const esperar = async (texto: string, causa: string): Promise<RuntimeEvent[] | null> => {
    const adiada = await adiarFala(deps, { turno, executor: p.executor, acordarEm: p.renovaEm, autoria, agora, texto, causa });
    return adiada ? [interrompido, ...adiada] : null;
  };
  const quando = quandoDaFrase(p.renovaEm, agora);
  if (!podeReenviar(turno)) return esperar(redigir("fala-no-limite-espera", agora, { ia: nomeDaIa(p.ia), quando }), "teto_de_reenvios");
  const ordem = ordemEfetiva({ doBot: inteligenciaDoAgente(agente).ordem, daPessoa: preferencias.ordemIas ?? null });
  const noLimite = iasNoLimite(preferencias.iasNoLimite, agora);
  // Revisão do PR #319: as prontas da máquina para onde a fala refeita VAI (a do bot ou a padrão, com a chave viva), não
  // as da que entregou — com "Rodar em <outra> desta vez", o turno novo volta à do bot. Fora do ar: nenhuma pronta nela.
  const alvo = p.prontosPorMaquina ? await alvoDoBot(deps, turno.agenteId) : null;
  const prontos = alvo && p.prontosPorMaquina ? (p.prontosPorMaquina[alvo.id] ?? []) : p.prontos;
  const para = proximaIaNoLimite({ ordem, prontos, noLimite, atual: p.ia });
  if (!para) {
    const noutra = alvo ? proximaIaNoLimite({ ordem, prontos: p.prontos, noLimite, atual: p.ia }) : null;
    if (!noutra) return null;
    return esperar(redigir("ia-pronta-noutra-maquina", agora, { ia: nomeDaIa(p.ia), outra: nomeDaIa(noutra), maquina: `em ${alvo!.nome}`, quando }), "ia_noutra_maquina");
  }
  await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
  const events: RuntimeEvent[] = [interrompido];
  const linha = await deps.repos.mensagens.criar({
    conversaId: turno.conversaId,
    turnoId: turno.id,
    autoria,
    kind: "sistema",
    texto: redigir("ia-trocada-limite", agora, { de: nomeDaIa(p.ia), para: nomeDaIa(para), quando: quandoDaFrase(p.renovaEm, agora) }),
    payload: { kind: "ia_trocada", de: p.ia, para, causa: "limite", renovaEm: p.renovaEm },
    confianca: "confiavel",
  });
  if (linha) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: linha.id, kind: "sistema" } }));
  const novo = await deps.repos.turnos.enfileirar({
    conversaId: turno.conversaId,
    agenteId: turno.agenteId,
    origem: "conversa",
    prazoEm: turno.prazoEm,
    profundidade: turno.profundidade,
    entradaTexto: turno.entradaTexto,
    mensagemOrigemId: turno.mensagemOrigemId,
    entradaAnexos: turno.entradaAnexos,
    entradaConfianca: turno.entradaConfianca,
    // NOD-268: fixo na IA escolhida (modelo `auto` = a escolha do bot para ela, senão o recomendado).
    modelo: turno.modelo,
    harness: para,
    reenvios: turno.reenvios + 1,
    executor: p.executor,
    trabalhoId: turno.trabalhoId ?? null,
  });
  if (novo) events.push(evento(deps.escopo, { kind: "turno_criado", autoria: autoriaPessoa(deps.escopo, p.executor), agora, conversaId: turno.conversaId, turnoId: novo.id, dados: { origem: "conversa", agente_id: turno.agenteId, repete_turno_id: turno.id } }));
  // Só códigos e ids (o Marlon lê `ia_trocada` no log de produção depois do deploy).
  log("info", "ia_trocada", { turno_id: turno.id, novo_turno_id: novo?.id ?? null, de: p.ia, para, causa: "limite", renova_em: p.renovaEm });
  return events;
}

/**
 * A conta em uso da IA bateu no limite e o Mac já trocou para outra conta logada (definido em 2026-10-12, ADR-101,
 * "Trocar sozinho" ligado). O turno da conversa é repetido na MESMA IA e no mesmo modelo — quem roda já está na conta
 * nova, guardada no Mac —, com uma linha discreta que diz só posições ("conta 1", "conta 3"; o apelido mora no app).
 * null = não é turno da conversa ou a pessoa pediu Parar: fica o aviso de sempre, com a frase das contas.
 */
async function aposTrocaDeConta(
  deps: Deps,
  p: { turno: Turno; executor: Executor; ia: IdHarness; troca: Extract<ContaNoLimite, { tipo: "trocou" }>; motivoInterrupcao: MotivoInterrupcao | null; motivoFalha: MotivoFalha | null; autoria: Autoria; agora: number; custoUsd: number | null },
): Promise<RuntimeEvent[] | null> {
  const { turno, autoria, agora, troca } = p;
  if (turno.origem !== "conversa" || turno.pararSolicitadoEm !== null) return null;
  const interrompido = evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: p.motivoInterrupcao, motivo_falha: p.motivoFalha, conta_de: troca.de, conta_para: troca.para, custo_usd: p.custoUsd } });
  // NOD-268: passou do teto de reenvios — a fala espera a conta que parou voltar, com uma linha (null: o aviso de sempre).
  // Revisão do PR #319: já esperou — o aviso do limite sem o "Seguindo com" (a fala não segue).
  if (!podeReenviar(turno)) {
    const acordarEm = prazoDoLimite(troca.voltaEm, agora);
    return (await esperarNoTeto(deps, { turno, executor: p.executor, ia: p.ia, acordarEm, autoria, agora, interrompido })) ?? avisoNoTeto(deps, { turno, ia: p.ia, voltaEm: acordarEm, autoria, agora, interrompido });
  }
  await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
  const events: RuntimeEvent[] = [interrompido];
  const linha = await deps.repos.mensagens.criar({
    conversaId: turno.conversaId,
    turnoId: turno.id,
    autoria,
    kind: "sistema",
    texto: fraseDaDecisao(troca, { ia: nomeDaIa(p.ia), quando: (t) => horaDaFrase(t, agora), quandoVolta: (t) => quandoDaFrase(t, agora) }),
    payload: { kind: "conta_trocada", harness: p.ia, de: troca.de, para: troca.para, voltaEm: troca.voltaEm, foraDaTroca: troca.foraDaTroca },
    confianca: "confiavel",
  });
  if (linha) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: linha.id, kind: "sistema" } }));
  const novo = await deps.repos.turnos.enfileirar({
    conversaId: turno.conversaId,
    agenteId: turno.agenteId,
    origem: "conversa",
    prazoEm: turno.prazoEm,
    profundidade: turno.profundidade,
    entradaTexto: turno.entradaTexto,
    mensagemOrigemId: turno.mensagemOrigemId,
    entradaAnexos: turno.entradaAnexos,
    entradaConfianca: turno.entradaConfianca,
    modelo: turno.modelo,
    harness: turno.harness,
    reenvios: turno.reenvios + 1,
    executor: p.executor,
    trabalhoId: turno.trabalhoId ?? null,
  });
  if (novo) events.push(evento(deps.escopo, { kind: "turno_criado", autoria: autoriaPessoa(deps.escopo, p.executor), agora, conversaId: turno.conversaId, turnoId: novo.id, dados: { origem: "conversa", agente_id: turno.agenteId, repete_turno_id: turno.id } }));
  log("info", "conta_trocada", { turno_id: turno.id, novo_turno_id: novo?.id ?? null, harness: p.ia, de: troca.de, para: troca.para });
  return events;
}

/**
 * ADR-102: o turno que usou uma conta da lista bateu no limite. Marca a conta (vale em todas as máquinas), tira a escolha
 * que apontava para ela e decide pela lista. Com a IA fixa no bot, trocar de IA não vale: a decisão fica entre as contas
 * dela (perguntar, ou trocar com "Trocar sozinho").
 */
async function decidirLimiteNoAssentamento(
  deps: Deps,
  p: { turno: Turno; contaId: string; machineId: string; ate: number | null; agora: number },
): Promise<{ conta: ContaDaPessoa; decisao: DecisaoDoLimiteDaConta; maquina: { id: string; nome: string } | null; voltaEm: number } | null> {
  const c = await lerContasDaMaquina(deps, p.machineId);
  const conta = c.contas.find((x) => x.id === p.contaId);
  if (!conta) return null;
  const voltaEm = p.ate !== null && p.ate > p.agora ? p.ate : p.agora + PRAZO_SEM_HORARIO_MS;
  await deps.repos.contasIa.marcarLimite(conta.id, voltaEm);
  if (c.escolhidas[conta.ia] === conta.id) await deps.repos.contasIa.definirEscolhida(conta.ia, null);
  const agente = await deps.repos.agentes.buscar(p.turno.agenteId);
  const fixo = harnessFixado(p.turno.harness, p.turno.modelo);
  // Com a IA fixa, só as contas dela contam como "nesta máquina" (as outras aparecem como livres noutro lugar).
  const naMaquina = fixo ? new Set([...c.naMaquina].filter((id) => c.contas.find((x) => x.id === id)?.ia === fixo)) : c.naMaquina;
  const { decisao } = decidirLimiteDaConta({ contas: c.contas, naMaquina, noutraMaquina: c.noutraMaquina, modo: c.modo, escolhidas: c.escolhidas, ordemDoBot: agente ? inteligenciaDoAgente(agente).ordem : null, contaId: conta.id, ate: voltaEm, agora: p.agora });
  return { conta, decisao, maquina: c.nomeDaMaquina ? { id: p.machineId, nome: c.nomeDaMaquina } : null, voltaEm };
}

/**
 * ADR-102: depois do limite de uma conta da lista. Trocou (de conta ou de IA): a fala da pessoa é refeita (o próximo plano
 * já escolhe a outra conta) com a linha "Claude · Pessoal no limite até 14:00. Seguindo com ChatGPT · Pessoal."; a task
 * segue na hora. Perguntar ou todas no limite: a nota com as contas livres (a tela desenha "Seguir com", "Entrar com ela
 * na <máquina>", "Rodar no <outra> desta vez"); a task espera a conta voltar. null = a pessoa pediu Parar (vale o aviso
 * de sempre).
 */
async function aposLimiteDaConta(
  deps: Deps,
  p: { turno: Turno; assentado: Turno; executor: Executor; conta: ContaDaPessoa; decisao: DecisaoDoLimiteDaConta; maquina: { id: string; nome: string } | null; voltaEm: number; motivoInterrupcao: MotivoInterrupcao | null; motivoFalha: MotivoFalha | null; autoria: Autoria; agora: number; custoUsd: number | null },
): Promise<RuntimeEvent[] | null> {
  const { turno, autoria, agora, decisao } = p;
  if (turno.pararSolicitadoEm !== null) return null;
  const segue = decisao.tipo === "trocou" || decisao.tipo === "outra_ia";
  if (turno.trabalhoId) return aposLimiteNoFundo(deps, { turno: p.assentado, executor: p.executor, ia: p.conta.ia, renovaEm: segue ? agora : p.voltaEm, motivoInterrupcao: p.motivoInterrupcao, motivoFalha: p.motivoFalha, autoria, agora, custoUsd: p.custoUsd });
  const interrompido = evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: p.motivoInterrupcao, motivo_falha: p.motivoFalha, conta_no_limite: p.conta.id, decisao: decisao.tipo, custo_usd: p.custoUsd } });
  // NOD-268: a troca já foi usada nesta fala — ela espera a conta voltar, com uma linha. Já esperou (revisão do PR #319):
  // o aviso do limite sem o "Seguindo com" da nota (a fala não segue).
  if (segue && turno.origem === "conversa" && !podeReenviar(turno)) {
    return (await esperarNoTeto(deps, { turno, executor: p.executor, ia: p.conta.ia, acordarEm: p.voltaEm, autoria, agora, interrompido })) ?? avisoNoTeto(deps, { turno, ia: p.conta.ia, voltaEm: p.voltaEm, autoria, agora, interrompido });
  }
  await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
  const events: RuntimeEvent[] = [interrompido];
  if (!segue || turno.origem !== "conversa") {
    events.push(...(await criarNotaDeContas(deps, { turno, autoria, agora, de: p.conta, decisao, maquina: p.maquina, voltaEm: p.voltaEm })));
    return events;
  }
  const linha = await deps.repos.mensagens.criar({
    conversaId: turno.conversaId,
    turnoId: turno.id,
    autoria,
    kind: "sistema",
    texto: fraseDoLimiteDaConta(p.conta, decisao, { maquina: p.maquina?.nome ?? null, quando: (t) => horaDaFrase(t, agora), quandoVolta: (t) => quandoDaFrase(t, agora), voltaEm: p.voltaEm }),
    payload: { kind: "conta_seguiu", de: { id: p.conta.id, apelido: p.conta.apelido, ia: p.conta.ia }, para: { id: decisao.para.id, apelido: decisao.para.apelido, ia: decisao.para.ia }, voltaEm: p.voltaEm },
    confianca: "confiavel",
  });
  if (linha) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: linha.id, kind: "sistema" } }));
  events.push(...(await repetirNaConversa(deps, { turno, executor: p.executor, agora })));
  log("info", "conta_seguiu", { turno_id: turno.id, de: p.conta.id, para: decisao.para.id, troca_de_ia: decisao.tipo === "outra_ia" });
  return events;
}

/**
 * ADR-102 (R6 da revisão): a máquina não tinha mais a conta do plano (saiu dela entre o anúncio e o turno). O vínculo sai
 * e o turno é refeito UMA vez (o próximo plano escolhe outra conta); na segunda, vale o aviso de sempre.
 */
async function aposContaAusente(
  deps: Deps,
  p: { turno: Turno; assentado: Turno; executor: Executor; contaId: string; machineId: string; motivoInterrupcao: MotivoInterrupcao | null; motivoFalha: MotivoFalha | null; autoria: Autoria; agora: number; custoUsd: number | null },
): Promise<RuntimeEvent[] | null> {
  await deps.repos.contasIa.apagarVinculo(p.contaId, p.machineId);
  log("aviso", "conta_ausente_na_maquina", { turno_id: p.turno.id, conta_id: p.contaId, machine_id: p.machineId });
  if (p.turno.pararSolicitadoEm !== null || !podeReenviar(p.turno)) return null;
  // Revisão do PR #306: a task não passa pelo caminho do limite (não houve limite; a frase e a IA sairiam erradas, e a
  // retomada não leva `reenvios`, então a trava acima não valeria). Vale o aviso de sempre; sem o vínculo, o próximo
  // plano já escolhe outra conta.
  if (p.turno.origem !== "conversa" || p.turno.trabalhoId) return null;
  await deps.repos.mensagens.marcarParciaisDoTurno(p.turno.id);
  return [
    evento(deps.escopo, { kind: "turno_interrompido", autoria: p.autoria, agora: p.agora, conversaId: p.turno.conversaId, turnoId: p.turno.id, dados: { motivo: p.motivoInterrupcao, motivo_falha: p.motivoFalha, conta_ausente: p.contaId, custo_usd: p.custoUsd } }),
    ...(await repetirNaConversa(deps, { turno: p.turno, executor: p.executor, agora: p.agora })),
  ];
}

/**
 * A fala da pessoa de novo na fila (a mesma entrada; `reenvios` + 1), como na troca de IA e de conta. Quem chama já
 * conferiu o teto (podeReenviar, NOD-268).
 */
async function repetirNaConversa(deps: Deps, p: { turno: Turno; executor: Executor; agora: number }): Promise<RuntimeEvent[]> {
  const { turno } = p;
  const novo = await deps.repos.turnos.enfileirar({
    conversaId: turno.conversaId,
    agenteId: turno.agenteId,
    origem: "conversa",
    prazoEm: turno.prazoEm,
    profundidade: turno.profundidade,
    entradaTexto: turno.entradaTexto,
    mensagemOrigemId: turno.mensagemOrigemId,
    entradaAnexos: turno.entradaAnexos,
    entradaConfianca: turno.entradaConfianca,
    modelo: turno.modelo,
    harness: turno.harness,
    reenvios: turno.reenvios + 1,
    executor: p.executor,
    trabalhoId: turno.trabalhoId ?? null,
  });
  return novo ? [evento(deps.escopo, { kind: "turno_criado", autoria: autoriaPessoa(deps.escopo, p.executor), agora: p.agora, conversaId: turno.conversaId, turnoId: novo.id, dados: { origem: "conversa", agente_id: turno.agenteId, repete_turno_id: turno.id } })] : [];
}

/**
 * NOD-268: a fala que passou do teto espera a hora (`acordarEm`) com a linha "O <IA> está no limite… volta sozinha às
 * HH:MM". null = ela já esperou uma vez (ou não é conversa): quem chama segue com o aviso de sempre.
 */
async function esperarNoTeto(
  deps: Deps,
  p: { turno: Turno; executor: Executor; ia: IdHarness; acordarEm: number; autoria: Autoria; agora: number; interrompido: RuntimeEvent },
): Promise<RuntimeEvent[] | null> {
  const texto = redigir("fala-no-limite-espera", p.agora, { ia: nomeDaIa(p.ia), quando: quandoDaFrase(p.acordarEm, p.agora) });
  const adiada = await adiarFala(deps, { turno: p.turno, executor: p.executor, acordarEm: p.acordarEm, autoria: p.autoria, agora: p.agora, texto, causa: "teto_de_reenvios" });
  return adiada ? [p.interrompido, ...adiada] : null;
}

/**
 * NOD-268 (revisão do PR #319): a fala no teto que já esperou a hora uma vez e bateu no limite de novo. Nada refaz nem
 * espera: o aviso do limite com a hora (o card do limite), sem "Seguindo com" — a frase da troca prometeria uma resposta
 * que não vem.
 */
async function avisoNoTeto(
  deps: Deps,
  p: { turno: Turno; ia: IdHarness; voltaEm: number; autoria: Autoria; agora: number; interrompido: RuntimeEvent },
): Promise<RuntimeEvent[]> {
  await deps.repos.mensagens.marcarParciaisDoTurno(p.turno.id);
  const aviso = await deps.repos.mensagens.criar({
    conversaId: p.turno.conversaId,
    turnoId: p.turno.id,
    autoria: p.autoria,
    kind: "sistema",
    texto: redigir("turno-interrompido", p.agora, { motivo: fraseDoLimiteDoPlano(p.ia, p.voltaEm, p.agora) }),
    payload: { kind: "limite_do_plano", harness: p.ia, voltaEm: p.voltaEm > p.agora ? p.voltaEm : null },
    confianca: "confiavel",
  });
  return [p.interrompido, ...(aviso ? [evento(deps.escopo, { kind: "mensagem_criada", autoria: p.autoria, agora: p.agora, conversaId: p.turno.conversaId, turnoId: p.turno.id, dados: { mensagem_id: aviso.id, kind: "sistema" } })] : [])];
}

/**
 * ADR-102 (2026-10-13): a frente cujo turno chegou à máquina sem conta livre (todas no limite) espera do mesmo jeito que a
 * frente no limite da ADR-099 §7 — o turno fica interrompido e uma retomada nasce com hora para acordar. Nunca volta a
 * 'pendente' (ADR-009/010). null = não é frente com task aberta (quem chamou segue com a nota na conversa).
 */
export function esperarContaNaFrente(
  deps: Deps,
  p: { turno: Turno; executor: Executor; ia: IdHarness; renovaEm: number; autoria: Autoria; agora: number },
): Promise<RuntimeEvent[] | null> {
  return aposLimiteNoFundo(deps, { ...p, motivoInterrupcao: "executor_indisponivel", motivoFalha: "limite_do_plano", custoUsd: null });
}

/**
 * A task (frente) bateu no LIMITE da assinatura e não trocou de IA (definido em 2026-10-12, ADR-099 §7: "nenhuma frente
 * falha por limite: espera e volta"). Em vez do aviso de interrupção e da task em "não terminou", nasce a retomada do
 * mesmo trabalho com `acordar_em` na renovação (o prazo do limite, prazoDoLimite: o horário do fornecedor ou 1 h), e a
 * task ganha uma linha dizendo quando volta. A fila só a entrega depois da hora e com a cota fora do limite (reivindicar);
 * quem a pega segue na mesma sessão do trabalho. null = não é task aberta (a conversa, a ligação e o turno sem trabalho
 * ficam com o aviso de sempre), ou a pessoa pediu Parar.
 */
async function aposLimiteNoFundo(
  deps: Deps,
  p: { turno: Turno; executor: Executor; ia: IdHarness; renovaEm: number; conta?: Exclude<ContaNoLimite, { tipo: "todas_no_limite" }>; motivoInterrupcao: MotivoInterrupcao | null; motivoFalha: MotivoFalha | null; autoria: Autoria; agora: number; custoUsd: number | null },
): Promise<RuntimeEvent[] | null> {
  const { turno, autoria, agora, conta } = p;
  if (!turno.trabalhoId || turno.origem === "ligacao" || turno.pararSolicitadoEm !== null) return null;
  const trabalho = await deps.repos.trabalhos.buscar(turno.trabalhoId);
  if (!trabalho || !trabalhoAberto(trabalho.estado)) return null;
  const retomaTurnoId = turno.retomaTurnoId ?? turno.id;
  await deps.repos.turnos.travarRetomadas(retomaTurnoId);
  await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
  const volta = await deps.repos.turnos.enfileirar({
    conversaId: turno.conversaId,
    agenteId: turno.agenteId,
    origem: "retomada",
    retomaTurnoId,
    trabalhoId: turno.trabalhoId,
    prazoEm: p.renovaEm + PRAZO_DECISAO_PADRAO_MS,
    profundidade: turno.profundidade,
    entradaTexto: conta?.tipo === "trocou" ? entradaDaTrocaDeConta(nomeDaIa(p.ia), conta.de, conta.para) : entradaDaVoltaDaCota(nomeDaIa(p.ia)),
    entradaConfianca: turno.entradaConfianca,
    sobProcuracaoDe: turno.sobProcuracaoDe ?? null,
    modelo: turno.modelo,
    harness: turno.harness,
    executor: turno.executor,
    acordarEm: p.renovaEm,
  });
  if (!volta) throw new ErroDeDominio("estado_invalido", { cause: "retomada depois do limite não criada" });
  // A marca de quem leu algo de fora (ADR-062) segue para a volta, como na volta marcada (me-chame-as.ts).
  if (turno.entradaConfianca !== "confiavel" || (await deps.repos.turnos.contaminado(turno.id))) await deps.repos.turnos.contaminar(volta.id, agora);
  const events: RuntimeEvent[] = [
    evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: p.motivoInterrupcao, motivo_falha: p.motivoFalha, ia_no_limite: p.ia, renova_em: p.renovaEm, volta_turno_id: volta.id, custo_usd: p.custoUsd } }),
    evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: turno.conversaId, turnoId: volta.id, dados: { origem: volta.origem, agente_id: turno.agenteId, retoma_turno_id: retomaTurnoId, trabalho_id: turno.trabalhoId, acordar_em: p.renovaEm } }),
  ];
  const linha = await deps.repos.mensagens.criar({
    conversaId: turno.conversaId,
    turnoId: turno.id,
    autoria,
    kind: "sistema",
    // ADR-101: com outra conta, a linha diz só posições — "Seguindo com a conta 2" (troca) ou "A conta 1 … espera" (perguntar).
    ...(conta?.tipo === "trocou"
      ? { texto: fraseDaDecisao(conta, { ia: nomeDaIa(p.ia), quando: (t) => horaDaFrase(t, agora), quandoVolta: (t) => quandoDaFrase(t, agora) }), payload: { kind: "conta_trocada" as const, harness: p.ia, de: conta.de, para: conta.para, voltaEm: conta.voltaEm, foraDaTroca: conta.foraDaTroca } }
      : { texto: conta ? redigir("conta-no-limite-espera", agora, { de: String(conta.de), ia: nomeDaIa(p.ia), quando: quandoDaFrase(p.renovaEm, agora) }) : redigir("cota-no-limite-espera", agora, { ia: nomeDaIa(p.ia), quando: quandoDaFrase(p.renovaEm, agora) }) }),
    confianca: "confiavel",
  });
  if (linha) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: linha.id, kind: "sistema" } }));
  // Só códigos e ids: para medir o "pronto quando" da parte 7 (nenhuma frente falha por limite).
  log("info", "cota_limite_task_espera", { turno_id: turno.id, volta_turno_id: volta.id, trabalho_id: turno.trabalhoId, harness: p.ia, renova_em: p.renovaEm, ...(conta ? { conta_tipo: conta.tipo, conta_de: conta.de } : {}) });
  return events;
}

/**
 * O turno falhou porque a CONTA da IA não serve (definido em 2026-10-05; medido em produção nesse dia: conta do Claude
 * Code logada, de uma organização que desativou o uso por assinatura).
 *
 * - Fala da pessoa a um bot em "automático" (harness e modelo `auto`) com OUTRA IA pronta na máquina: o pedido é
 *   repetido nela, e a conversa ganha uma linha dizendo por quem o bot passou a responder. A fila só entrega o turno
 *   novo à outra IA: a reprovada já saiu do inventário da máquina (ponte-interna, reprovarHarness), e o despacho de um
 *   turno `auto/auto` aceita qualquer IA pronta (turnos.repo, reivindicar).
 * - Em qualquer outro caso (IA escolhida à mão, nenhuma outra pronta, rotina, sala, pedido entre bots): a mesma negação
 *   "nenhum trabalho começou" de quando o inventário já barra o despacho, agora com a causa. Rotina e pedido entre bots
 *   não são repetidos aqui porque carregam vínculos próprios (execução, tarefa) que este caminho não reconstrói.
 */
const nomeDaIa = (id: IdHarness): string => HARNESSES.find((h) => h.id === id)?.nome ?? id;

async function aposContaSemAcesso(
  deps: Deps,
  p: { turno: Turno; executor: Executor; harness: IdHarness | null; outraIa: IdHarness | null; causa: CausaSemIa; autoria: Autoria; agora: number; custoUsd: number | null },
): Promise<RuntimeEvent[]> {
  const { turno, causa, autoria, agora } = p;
  const events: RuntimeEvent[] = [
    evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: "executor_indisponivel", motivo_falha: "nao_autenticado", causa, custo_usd: p.custoUsd } }),
  ];
  // NOD-268: no teto de reenvios, a negação com a causa (a conta sem acesso não volta sozinha com a hora).
  const repete = turno.origem === "conversa" && turno.harness === "auto" && turno.modelo === "auto" && p.harness !== null && p.outraIa !== null && p.outraIa !== p.harness && podeReenviar(turno);
  if (repete && p.harness && p.outraIa) {
    const linha = await deps.repos.mensagens.criar({
      conversaId: turno.conversaId,
      turnoId: turno.id,
      autoria,
      kind: "sistema",
      texto: redigir("ia-trocada", agora, { de: nomeDaIa(p.harness), para: nomeDaIa(p.outraIa) }),
      payload: { kind: "ia_trocada", de: p.harness, para: p.outraIa, causa },
      confianca: "confiavel",
    });
    if (linha) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: linha.id, kind: "sistema" } }));
    const novo = await deps.repos.turnos.enfileirar({
      conversaId: turno.conversaId,
      agenteId: turno.agenteId,
      origem: "conversa",
      prazoEm: turno.prazoEm,
      profundidade: turno.profundidade,
      entradaTexto: turno.entradaTexto,
      mensagemOrigemId: turno.mensagemOrigemId,
      entradaAnexos: turno.entradaAnexos,
      entradaConfianca: turno.entradaConfianca,
      modelo: turno.modelo,
      harness: turno.harness,
      reenvios: turno.reenvios + 1,
      executor: p.executor,
      trabalhoId: turno.trabalhoId ?? null,
    });
    if (novo) events.push(evento(deps.escopo, { kind: "turno_criado", autoria: autoriaPessoa(deps.escopo, p.executor), agora, conversaId: turno.conversaId, turnoId: novo.id, dados: { origem: "conversa", agente_id: turno.agenteId, repete_turno_id: turno.id } }));
    return events;
  }
  const inventario: Inventario = { estado: "nao_autenticado", causa, motivo: MOTIVO_DA_CAUSA[causa], em: agora };
  const ia = iaDaNegacao(p.harness); // NOD-220: a IA que negou, para a web nunca dizer "já voltou" pela sonda de outra
  const negacao = await deps.repos.mensagens.criar({
    conversaId: turno.conversaId,
    turnoId: turno.id,
    autoria: autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor: p.executor, localityReason: "motor_ausente" }),
    kind: "negacao",
    texto: redigir("executor-indisponivel", agora, { motivo: `${p.harness ?? "ia"} ${inventario.estado}: ${inventario.motivo}`, desde: horaDaFrase(agora, agora) }),
    payload: { kind: "negacao", classe: "plano_ausente", nome: p.harness ?? "ia", motivo: "plano_ausente", terminal: true, causa, ...(ia ? { ia } : {}) },
    confianca: "confiavel",
  });
  if (negacao) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: negacao.id, kind: "negacao" } }));
  return events;
}
