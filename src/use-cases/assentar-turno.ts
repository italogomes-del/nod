import type { Autoria, Executor, RuntimeEvent } from "../contracts/evento.ts";
import { HARNESSES, type IdHarness } from "../contracts/harness.ts";
import { MOTIVO_DA_CAUSA, type CausaSemIa, type Inventario } from "../contracts/inventario.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import type { MotivoFalha, MotivoInterrupcao } from "../contracts/motivos.ts";
import type { Entrega } from "../contracts/ponte.ts";
import type { Turno } from "../contracts/turno.ts";
import { comandoDaConversa, textoDaCompactacao, traduzirSaidaDoComando } from "../domain/comandos.ts";
import { custoDoTurno } from "../domain/custo-turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { fraseDoErroFornecedor } from "../domain/erro-fornecedor.ts";
import { descreverNegacao } from "../domain/estado-degradacao.ts";
import { ultimoSinalDoTurno } from "../domain/incidente.ts";
import { NATIVAS_DO_TERMINAL } from "../domain/nativas.ts";
import { motivoEmPortugues, redigir } from "../domain/redacao.ts";
import { usoDoPlanoValido } from "../domain/uso-do-plano.ts";
import { log } from "../obs/log.ts";
import { delegacaoDoTurno, rotinaDoTurno } from "./apoio-l7.ts";
import { autoriaAgente, autoriaPessoa, evento } from "./autoria-evento.ts";
import { aposQuedaDaMaquina } from "./interromper-por-maquina.ts";
import { postarNaSala } from "./postar-na-sala.ts";
import { continuarAprovacoesDoTurno } from "./decidir.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

/** `harness`: o que rodou o turno (vem do plano puxado, nunca da máquina); grava o dono da sessão (0030). */
/**
 * `outraIa` (definido em 2026-10-05): quando o turno voltou com `causaSemIa`, a outra IA que a máquina tem pronta
 * (quem sabe é a ponte, que guarda o inventário anunciado); null = nenhuma.
 */
export type EntradaAssentarTurno = Entrega & { executor?: Executor; harness?: IdHarness | null; outraIa?: IdHarness | null };
export type SaidaAssentarTurno = {
  turno: Turno | null;
  mensagem: Mensagem | null;
  /** (turno, seq_local) já entregue: nada regravado (ADR-021). */
  duplicada: boolean;
  /** Turno já terminal (varredor/parar chegaram antes): a fala entra como anexo parcial, sem reabrir (ADR-010). */
  tardia: boolean;
};

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
  // Trava de linha: Parar (parar_solicitado_em) pode estar commitando em paralelo; a leitura espera por ele (ADR-009: quem decide o motivo é o servidor).
  const turno = await deps.repos.turnos.buscarTravado(entrega.turnoId);
  if (!turno) throw new ErroDeDominio("nao_encontrado");
  if (turno.machineId !== null && turno.machineId !== entrega.machineId) throw new ErroDeDominio("nao_permitido", { cause: "entrega de outra máquina" });

  const agora = deps.agora();
  const executor = entrega.executor ?? "catcher";
  const resultado = entrega.resultado;
  const tardia = turno.estado !== "pendente" && turno.estado !== "despachando";
  const desfecho = desfechoDaEntrega(turno, resultado, agora);
  const interrompido = tardia || desfecho.estado === "interrompido";
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
  const events: RuntimeEvent[] = [];

  // Comando da conversa (0038): /uso e /contexto voltam do Claude Code em inglês; a pessoa lê em português. O
  // /compactar não tem resposta para a pessoa: medido ao vivo em 28/09, o CLI devolveu como resultado a saída do
  // /contexto anterior (o último texto que sobra na sessão compactada). Vale só a linha com os números, abaixo.
  const comandoDoTurno = comandoDaConversa(turno.entradaTexto)?.comando.nome;
  // definido em 2026-10-05: com `causaSemIa` não há fala — o que veio é a recusa do fornecedor, nunca texto do bot.
  const falaTexto = entrega.fala.tipo === "texto" && comandoDoTurno !== "compactar" && !resultado.causaSemIa ? traduzirSaidaDoComando(turno.entradaTexto, entrega.fala.texto, entrega.harness) : "";
  let mensagem: Mensagem | null = null;
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
    const post = await postarNaSala(deps, { salaId: conversa.salaId, texto: falaTexto, autoria, confianca: turno.entradaConfianca, turnoId: turno.id, eRotina: false });
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
  }
  // /compactar não tem fala: a conversa ganha a linha com quanto o histórico ocupava e quanto sobrou.
  const compactacao = resultado.execucao?.compactacoes.at(-1);
  if (!mensagem && !tardia && comandoDoTurno === "compactar" && resultado.desfecho === "sucesso") {
    const agente = await deps.repos.agentes.buscar(turno.agenteId);
    mensagem = await deps.repos.mensagens.criar({ conversaId: turno.conversaId, turnoId: turno.id, autoria, kind: "sistema", texto: textoDaCompactacao(agente?.nome ?? "O bot", compactacao?.antes ?? null, compactacao?.depois ?? null), confianca: "confiavel" });
  }
  if (mensagem) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: mensagem.id, kind: mensagem.kind, parcial: mensagem.parcial } }));

  // 0005: a sessão é do executor que a criou; o catcher não cria sessão real (devolve null).
  // definido em 2026-09-24 (ADR-044): a retomada ligada a uma rotina roda em sessão própria, como a
  // rotina (emitir-plano-turno.ts); gravá-la trocaria a sessão da conversa pela da execução agendada.
  // definido em 2026-09-24 (ADR-047): a tarefa delegada roda em sessão própria (emitir-plano-turno) e não
  // pode virar a sessão da conversa do alvo com a pessoa.
  // definido em 2026-10-04 (ADR-072): a sessão do laço de voz é efêmera e nunca vira a sessão da conversa.
  const sessaoDaConversa = turno.origem !== "rotina" && turno.origem !== "peer" && turno.origem !== "delegacao" && turno.origem !== "ligacao" && !turno.sobProcuracaoDe
    && !(turno.origem === "retomada" && ((await rotinaDoTurno(deps.repos, turno.id)) || (await delegacaoDoTurno(deps.repos, turno))));
  if (resultado.sessaoCli && sessaoDaConversa) await deps.repos.conversas.atualizarSessaoCli(turno.conversaId, resultado.sessaoCli, executor, entrega.harness ?? null);
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

  for (const nome of resultado.negacoesPermissao) {
    // definido em 2026-10-01 (ADR-066): a nativa do kit do terminal que o CLI negou foi o HOOK do nod que negou — comando
    // esperando aprovação, recusado ou numa cerca —, não o catálogo. 5 das 6 falas "Bash negada: fora do catálogo deste
    // turno" de 29 e 30/09 (Clarice, Chico, Nina) eram comandos esperando aprovação, num turno com o Bash no plano.
    const motivo = (NATIVAS_DO_TERMINAL as readonly string[]).includes(nome) ? ("alcance_insuficiente" as const) : ("fora_do_catalogo" as const);
    const negacao = { classe: "ferramenta_negada" as const, nome, motivo, desde: agora, terminal: false };
    const m = await deps.repos.mensagens.criar({
      conversaId: turno.conversaId,
      turnoId: turno.id,
      autoria,
      kind: "negacao",
      texto: descreverNegacao(negacao, agora),
      payload: { kind: "negacao", classe: negacao.classe, nome, motivo: negacao.motivo, terminal: false },
      confianca: "confiavel",
    });
    events.push(evento(deps.escopo, { kind: "negacao", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { nome, motivo: negacao.motivo, classe: negacao.classe, terminal: false, mensagem_id: m?.id ?? null } }));
  }

  if (tardia) {
    // Entrega depois do varredor/parar: aceita como anexo parcial, sem reabrir (ADR-010).
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
  });
  if (!assentado) throw new ErroDeDominio("estado_invalido", { cause: "turno mudou de estado durante a entrega" });

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
  } else if (desfecho.estado === "interrompido") {
    await deps.repos.mensagens.marcarParciaisDoTurno(turno.id);
    const motivo = desfecho.motivoFalha ?? desfecho.motivoInterrupcao ?? "sem_progresso";
    // NOD-174: falha do fornecedor com classe conhecida ganha a frase com ação ("sua conta do Claude Code saiu deste
    // Mac…"); o motivo gravado continua o do protocolo (ADR-009). O cru fica só no diagnóstico (ADR-041).
    const fraseFornecedor = desfecho.motivoFalha ? fraseDoErroFornecedor(entrega.harness ?? null, resultado.erroCru) : null;
    const aviso = await deps.repos.mensagens.criar({
      conversaId: turno.conversaId,
      turnoId: turno.id,
      autoria,
      kind: "sistema",
      texto: redigir("turno-interrompido", agora, { motivo: fraseFornecedor ?? motivoEmPortugues(motivo) }),
      confianca: "confiavel",
    });
    if (aviso) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: aviso.id, kind: "sistema" } }));
    events.push(evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { motivo: desfecho.motivoInterrupcao, motivo_falha: desfecho.motivoFalha, custo_usd: custoUsd } }));
  } else {
    events.push(evento(deps.escopo, { kind: "turno_encerrado", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { estado: "concluido", custo_usd: custoUsd, ferramentas: resultado.ferramentasChamadas.length } }));
  }

  // definido em 2026-09-28 (0032): aprovação já decidida que este turno não chegou a receber (a espera acabou
  // um instante antes do clique) vira UMA retomada — nunca duas, e nunca nenhuma.
  events.push(...(await continuarAprovacoesDoTurno(deps, assentado)));
  return { data: { turno: assentado, mensagem, duplicada: false, tardia: false }, events };
};

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
  const repete = turno.origem === "conversa" && turno.harness === "auto" && turno.modelo === "auto" && p.harness !== null && p.outraIa !== null && p.outraIa !== p.harness;
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
    });
    if (novo) events.push(evento(deps.escopo, { kind: "turno_criado", autoria: autoriaPessoa(deps.escopo, p.executor), agora, conversaId: turno.conversaId, turnoId: novo.id, dados: { origem: "conversa", agente_id: turno.agenteId, repete_turno_id: turno.id } }));
    return events;
  }
  const inventario: Inventario = { estado: "nao_autenticado", causa, motivo: MOTIVO_DA_CAUSA[causa], em: agora };
  const negacao = await deps.repos.mensagens.criar({
    conversaId: turno.conversaId,
    turnoId: turno.id,
    autoria: autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: turno.ownerId, executor: p.executor, localityReason: "motor_ausente" }),
    kind: "negacao",
    texto: redigir("executor-indisponivel", agora, { motivo: `${p.harness ?? "ia"} ${inventario.estado}: ${inventario.motivo}`, desde: new Date(agora).toISOString() }),
    payload: { kind: "negacao", classe: "plano_ausente", nome: p.harness ?? "ia", motivo: "plano_ausente", terminal: true, causa },
    confianca: "confiavel",
  });
  if (negacao) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: turno.conversaId, turnoId: turno.id, dados: { mensagem_id: negacao.id, kind: "negacao" } }));
  return events;
}
