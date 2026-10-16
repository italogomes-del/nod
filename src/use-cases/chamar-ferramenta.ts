import type { RuntimeEvent } from "../contracts/evento.ts";
import { FERRAMENTAS_NOD, type ContratoFerramentaNod, type NomeFerramentaNod } from "../contracts/ferramentas-nod.ts";
import type { Confianca } from "../contracts/mensagem.ts";
import type { MotivoNegacao } from "../contracts/motivos.ts";
import type { Negacao } from "../contracts/negacao.ts";
import type { FerramentaPlano, PlanoTurno } from "../contracts/plano-turno.ts";
import { USE_CASE_POR_FERRAMENTA, type ContextoFerramenta, type SaidaCasoDeUso } from "../contracts/servicos.ts";
import { acaoArriscadaNoApp, decidirAprovacao } from "../domain/aprovacao-permanente.ts";
import { conectorTrazConteudoDeFora } from "../domain/conteudo-de-fora.ts";
import { errosDoSchema } from "../domain/schema-args.ts";
import { ehErroDeInfraDaTx } from "../db/tx.ts";
import { rotinaDoTurno } from "./apoio-l7.ts";
import { normalizarPedidoAPessoa } from "./pedir-a-pessoa.ts";
import { semprePermitirVivo } from "./regras-vivas.ts";
import { nomeParaTrilha, registrarNegacao } from "./registrar-negacao.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";
import { sincronizarTrabalho } from "./trabalhos.ts";

/** Corpo devolvido por POST /api/interno/ferramentas/:nome (o proxy consome; src/adapters/executor/cliente-nod.ts espelha). */
export type ResultadoChamada =
  | { ok: true; conteudo: string; confianca: Confianca; isError?: boolean; imagem?: { mimeType: "image/png"; data: string }; audio?: { mimeType: "audio/wav"; data: string } }
  | { ok: false; negacao: Negacao }
  | { aguardar: string }
  /**
   * definido em 2026-09-24 (ADR-048): o servidor decidiu (parada, catálogo, concessão, gate de rotina,
   * schema, trilha) e a ferramenta roda NA MÁQUINA do turno — o proxy executa pelo gh do Mac e relata
   * o desfecho em POST interno/execucoes-locais. O conteúdo que voltar é não confiável (ADR-026).
   */
  | { executarLocal: { capacidade: string; argumentos: Record<string, unknown> } };

export type EntradaChamarFerramenta = {
  /** Identidade derivada do TOKEN (rota interna), nunca do corpo (ADR-024). */
  turnoId: string;
  agenteId: string;
  nome: string;
  argumentos: unknown;
  /** Plano do turno guardado junto do token (services/token-turno.ts); null = plano ausente. */
  plano: PlanoTurno | null;
};

export const REGRA_CHAMADA = "regra:chamar_ferramenta" as const;
export const VERSAO_REGRA_CHAMADA = 1 as const;

// ---------------------------------------------------------------------------------------------
export { errosDoSchema } from "../domain/schema-args.ts";

/**
 * Parse validado: devolve os args TIPADOS da ferramenta nod ou a lista de erros. O único `as` deste
 * arquivo vive aqui, depois de o schema ter sido conferido — é a fronteira entre JSON e contrato.
 */
export function validarArgsNod<N extends NomeFerramentaNod>(nome: N, args: unknown): { ok: true; args: ContratoFerramentaNod[N]["args"] } | { ok: false; erros: string[] } {
  const erros = errosDoSchema(FERRAMENTAS_NOD[nome], args);
  if (erros.length > 0) return { ok: false, erros };
  return { ok: true, args: args as ContratoFerramentaNod[N]["args"] };
}

// ---------------------------------------------------------------------------------------------
// Despacho por tabela (EMENDA 5): cada nome tem o seu caso em UseCasesNod — a lista é FECHADA e
// tests/conformidade/capabilities-consumidas.test.ts prova que os nove nomes aparecem aqui.

type Despacho = { [N in NomeFerramentaNod]: (deps: Deps, ctx: ContextoFerramenta, args: ContratoFerramentaNod[N]["args"]) => Promise<SaidaCasoDeUso<ContratoFerramentaNod[N]["resultado"]>> };

const DESPACHO: Despacho = {
  lembrar: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.lembrar](deps, { ...ctx, ...args }),
  atualizar_perfil: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.atualizar_perfil](deps, { ...ctx, ...args }),
  pedir_acesso: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.pedir_acesso](deps, { ...ctx, ...args }),
  criar_rotina: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.criar_rotina](deps, { ...ctx, ...args }),
  listar_rotinas: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.listar_rotinas](deps, { ...ctx, ...args }),
  pausar_rotina: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.pausar_rotina](deps, { ...ctx, ...args }),
  reativar_rotina: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.reativar_rotina](deps, { ...ctx, ...args }),
  atualizar_rotina: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.atualizar_rotina](deps, { ...ctx, ...args }),
  excluir_rotina: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.excluir_rotina](deps, { ...ctx, ...args }),
  pedir_aprovacao: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.pedir_aprovacao](deps, { ...ctx, ...args }),
  pedir_a_pessoa: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.pedir_a_pessoa](deps, { ...ctx, ...args }),
  passar: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.passar](deps, { ...ctx, ...args }),
  encaminhar: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.encaminhar](deps, { ...ctx, ...args }),
  sem_novidade: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.sem_novidade](deps, { ...ctx, ...args }),
  pedir_a_bot: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.pedir_a_bot](deps, { ...ctx, ...args }),
  ver_colegas: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.ver_colegas](deps, { ...ctx, ...args }),
  publicar_artefato: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.publicar_artefato](deps, { ...ctx, ...args }),
  ler_artefato: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.ler_artefato](deps, { ...ctx, ...args }),
  anotar_pendencia: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.anotar_pendencia](deps, { ...ctx, ...args }),
  concluir_pendencia: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.concluir_pendencia](deps, { ...ctx, ...args }),
  descartar_pendencia: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.descartar_pendencia](deps, { ...ctx, ...args }),
  iniciar_tarefa: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.iniciar_tarefa](deps, { ...ctx, ...args }),
  desligar: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.desligar](deps, { ...ctx, ...args }),
  anotar_entrevista: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.anotar_entrevista](deps, { ...ctx, ...args }),
  concluir_entrevista: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.concluir_entrevista](deps, { ...ctx, ...args }),
  propor_bot: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.propor_bot](deps, { ...ctx, ...args }),
  abrir_task: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.abrir_task](deps, { ...ctx, ...args }),
  mandar_para_task: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.mandar_para_task](deps, { ...ctx, ...args }),
  me_chame_as: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.me_chame_as](deps, { ...ctx, ...args }),
  abrir_frentes: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.abrir_frentes](deps, { ...ctx, ...args }),
  mandar_para_frente: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.mandar_para_frente](deps, { ...ctx, ...args }),
  devolver_resumo: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.devolver_resumo](deps, { ...ctx, ...args }),
  esperar_comando: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.esperar_comando](deps, { ...ctx, ...args }),
  gerir_bots: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.gerir_bots](deps, { ...ctx, ...args }),
  ver_apps_conectados: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.ver_apps_conectados](deps, { ...ctx, ...args }),
  registrar_relato: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.registrar_relato](deps, { ...ctx, ...args }),
  criar_bots: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.criar_bots](deps, { ...ctx, ...args }),
  responder_pedido: (deps, ctx, args) => deps.useCases[USE_CASE_POR_FERRAMENTA.responder_pedido](deps, { ...ctx, ...args }),
};

/**
 * Ferramentas nod cujo resultado é conteúdo que o modelo NÃO escreveu agora e que chega marcado como não
 * confiável (ADR-026): definido em 2026-09-28 (ADR-051), ler_artefato — o estado foi gravado pela página,
 * que é código do bot rodando no navegador, e o HTML pode ter vindo de um turno que leu conteúdo de fora.
 */
const NOD_DE_CONTEUDO_NAO_CONFIAVEL: ReadonlySet<NomeFerramentaNod> = new Set(["ler_artefato"]);

/** As ferramentas nod que deixam uma decisão aberta para a pessoa (o estado da task do turno muda, ADR-083). */
const FERRAMENTAS_QUE_PEDEM_A_PESSOA: ReadonlySet<NomeFerramentaNod> = new Set(["pedir_a_pessoa", "pedir_aprovacao", "pedir_acesso"]);

function ehNomeNod(nome: string): nome is NomeFerramentaNod {
  return Object.prototype.hasOwnProperty.call(FERRAMENTAS_NOD, nome);
}

/** Valida pelo schema do nome e chama o caso correlato da tabela (união correlata: sem cast). */
async function rodarValidado<N extends NomeFerramentaNod>(deps: Deps, ctx: ContextoFerramenta, nome: N, args: unknown): Promise<SaidaCasoDeUso<ContratoFerramentaNod[N]["resultado"]> | { erros: string[] }> {
  const v = validarArgsNod(nome, args);
  if (!v.ok) return { erros: v.erros };
  return DESPACHO[nome](deps, ctx, v.args);
}

async function despacharNod(deps: Deps, ctx: ContextoFerramenta, nome: NomeFerramentaNod, args: unknown): Promise<{ resultado: ResultadoChamada; events: RuntimeEvent[] } | { erros: string[] }> {
  // EMENDA 16: pedir_a_pessoa nunca é recusada por args — malformado vira pergunta (julgamento humano).
  if (nome === "pedir_a_pessoa") {
    const saida = await DESPACHO.pedir_a_pessoa(deps, ctx, normalizarPedidoAPessoa(args));
    return { resultado: { ok: true, conteudo: JSON.stringify(saida.data), confianca: "confiavel" }, events: saida.events ?? [] };
  }
  const saida = await rodarValidado(deps, ctx, nome, args);
  if ("erros" in saida) return saida;
  const data: unknown = saida.data;
  if (nome === "pedir_aprovacao" && typeof data === "object" && data !== null && (data as { estado?: unknown }).estado === "pendente") {
    return { resultado: { aguardar: String((data as { decisao_id: string }).decisao_id) }, events: saida.events ?? [] };
  }
  return { resultado: { ok: true, conteudo: JSON.stringify(data), confianca: NOD_DE_CONTEUDO_NAO_CONFIAVEL.has(nome) ? "nao_confiavel" : "confiavel" }, events: saida.events ?? [] };
}

// ---------------------------------------------------------------------------------------------

/**
 * Ponto de decisão do servidor para tools/call (ADR-013): gate de PARADA (consulta falhou = parada,
 * EMENDA 10) → plano válido e nome no catálogo → nod: valida args pelo schema e DESPACHA para
 * deps.useCases (EMENDA 5) → conector: exige conector habilitado e concessão ATIVA do agente (lida
 * agora, não no enfileirar — E6.4), aplica EMENDA 15 (rotina com gate: só readOnly fora de item
 * aprovado), chama services.conectores e marca o conteúdo como não confiável (ADR-026). Toda
 * chamada e toda negação deixam linha na trilha com a regra (E8.4).
 */
export const chamarFerramenta: CasoDeUso<EntradaChamarFerramenta, ResultadoChamada> = async (deps, input) => {
  const agora = deps.agora();
  const events: RuntimeEvent[] = [];
  const plano = input.plano;

  const negar = async (motivo: MotivoNegacao, classe: Negacao["classe"], conectorId: string | null = null, viaGateDeRotina = false, causa?: Negacao["causa"]): Promise<{ data: ResultadoChamada; events: RuntimeEvent[] }> => {
    const n = await registrarNegacao(deps, {
      turnoId: input.turnoId,
      agenteId: input.agenteId,
      conversaId: plano?.conversaId ?? null,
      nome: input.nome,
      motivo,
      classe,
      conectorId,
      viaGateDeRotina,
      ...(causa ? { causa } : {}),
      autoria: plano?.autoria,
    });
    return { data: { ok: false, negacao: n.data }, events: [...events, ...(n.events ?? [])] };
  };

  if (!plano || plano.turnoId !== input.turnoId) return negar("plano_ausente", "plano_ausente");
  if (await deps.repos.agentes.execucaoBloqueada(input.turnoId)) return negar("parada_ativa", "ferramenta_negada");
  if (!(plano.expiraEm > agora)) return negar("plano_expirado", "plano_ausente");

  // Gate de parada: boolean | null — null (consulta falhou) É parada (fail-closed no caso de uso, EMENDA 10).
  const parada = await deps.repos.paradas.ativa(deps.escopo.pessoaId, plano.conversaId);
  if (parada !== false) return negar("parada_ativa", "ferramenta_negada");

  const ferramenta: FerramentaPlano | undefined = plano.catalogo.ferramentas.find((f) => f.nome === input.nome);
  if (!ferramenta) return negar("fora_do_catalogo", "ferramenta_negada");

  // O plano viaja no contexto para a regra do ADR-042 ser avaliada LOCALMENTE em pedir_aprovacao,
  // a partir do que já foi puxado — nunca por consulta na hora da chamada (ADR-013).
  const ctx: ContextoFerramenta = { turnoId: input.turnoId, agenteId: input.agenteId, conversaId: plano.conversaId, plano };
  const registrarChamada = (conectorId: string | null) =>
    deps.repos.trilha.registrar({ agenteId: input.agenteId, turnoId: input.turnoId, conectorId, ferramenta: nomeParaTrilha(input.nome), kind: "tool_call", regra: REGRA_CHAMADA, regraVersao: VERSAO_REGRA_CHAMADA, em: agora });

  if (ferramenta.origem === "nod") {
    if (!ehNomeNod(ferramenta.nome)) return negar("fora_do_catalogo", "ferramenta_negada");
    const r = await despacharNod(deps, ctx, ferramenta.nome, input.argumentos ?? {});
    if ("erros" in r) return negar("args_invalidos", "ferramenta_negada");
    await registrarChamada(null);
    if (plano.executor === "catcher") await deps.repos.catcher.registrar({ turnoId: input.turnoId, tipo: "tool_call", dados: { nome: input.nome, origem: "nod" } });
    // ADR-083: a ferramenta que abre uma decisão põe a task do turno em "precisa de você" na hora.
    if (FERRAMENTAS_QUE_PEDEM_A_PESSOA.has(ferramenta.nome)) r.events.push(...(await sincronizarTrabalho(deps, (await deps.repos.turnos.buscar(input.turnoId))?.trabalhoId)));
    return { data: r.resultado, events: [...events, ...r.events] };
  }

  // Conector: concessão ativa lida AGORA (E6.4) + conector habilitado + gate de rotina (EMENDA 15).
  const conectorId = ferramenta.conectorId;
  if (!conectorId) return negar("fora_do_catalogo", "ferramenta_negada");
  const conector = await deps.repos.conectores.buscar(conectorId);
  if (!conector || !conector.habilitado) return negar("capacidade_desligada", "ferramenta_negada", conectorId);
  const tool = ferramenta.nome.startsWith(`${conector.slug}__`) ? ferramenta.nome.slice(conector.slug.length + 2) : ferramenta.nome;
  const concessoes = await deps.repos.concessoes.doAgente(input.agenteId);
  if (!concessoes.some((c) => c.conectorId === conectorId && c.capacidade === tool)) return negar("capacidade_desligada", "ferramenta_negada", conectorId);
  // revisto em 2026-10-01 (ADR-066, "o bot tem o que você deu; o modo decide"): saíram as duas negações que vinham
  // antes desta decisão — a do gate da rotina e da web lida (escrita só por item) e a do merge e aprovar PR (só por
  // item, em qualquer modo). As duas viraram uma ida e volta até o pedir_aprovacao, que no automático e no total
  // aprovava sozinho; o Dev 3 tentou três vezes um comentário em 30/09. Agora tudo passa pela decisão abaixo, e o
  // modo diz quando parar. No manual, merge e aprovar PR seguem pedindo a pessoa e nunca viram "Sempre permitir".
  // definido em 2026-09-30 (ADR-062): a chamada direta passa pela MESMA decisão do card. Antes, escrever e até apagar
  // direto rodavam sem card no modo manual (só o prompt pedia pedir_aprovacao), e um colega apagava direto no
  // automático o que, pedido por item, pararia em `acao_arriscada`. Quem não passaria sozinho no card recebe a
  // negação transitória "peça aprovação" e cai no pedir_aprovacao, com o motivo gravado no item.
  if (!ferramenta.readOnlyHint) {
    const modo = (await deps.repos.agentes.buscar(input.agenteId))?.modoAprovacao ?? "manual";
    const capacidade = conector.catalogo.find((c) => c.nome === tool);
    const semprePermitir = await semprePermitirVivo(deps, input.agenteId, plano);
    const destino = { conector: conector.slug, ferramenta: tool, argumentos: (input.argumentos ?? {}) as Record<string, unknown> };
    const contaminado = await deps.repos.turnos.contaminado(input.turnoId);
    const d = decidirAprovacao({ plano: { ...plano, semprePermitir }, destino, origemSensivel: false, modo, arriscada: capacidade ? acaoArriscadaNoApp(capacidade) : true, contaminado });
    if (!d.automatico) return negar("alcance_insuficiente", "ferramenta_negada", conectorId, true);
  }
  const erros = errosDoSchema(ferramenta.schema, input.argumentos ?? {});
  if (erros.length > 0) return negar("args_invalidos", "ferramenta_negada", conectorId);

  await registrarChamada(conectorId);
  // definido em 2026-10-01 (ADR-066): chamar um app de fora (Gmail, GitHub, MCP próprio) marca o turno, como a web já
  // marcava — também quando roda no gh do Mac (ADR-048). Substitui a rotina "desconfiada" pelo nome do app na fonte: a
  // marca vem do que o bot leu, não do que a instrução cita. Só pesa no manual (a regra "Sempre permitir" cai).
  if (conectorTrazConteudoDeFora(conector)) await deps.repos.turnos.contaminar(input.turnoId, agora);
  if (plano.executor === "catcher") await deps.repos.catcher.registrar({ turnoId: input.turnoId, tipo: "tool_call", dados: { nome: input.nome, origem: "conector", conector_id: conectorId } });
  // ADR-048: todos os portões acima valem igual; só o EFEITO muda de lugar — o gh é o do Mac do turno.
  if (ferramenta.execucao === "maquina") return { data: { executarLocal: { capacidade: tool, argumentos: (input.argumentos ?? {}) as Record<string, unknown> } }, events };
  // O GitHub App da organização só atende turno de rotina (ADR-048): ninguém olhando, nada em nome da pessoa.
  const rotina = (await rotinaDoTurno(deps.repos, input.turnoId)) !== null;
  try {
    const r = await deps.services.conectores.chamar(conectorId, tool, (input.argumentos ?? {}) as Record<string, unknown>, { rotina, somenteLeitura: ferramenta.readOnlyHint === true });
    const conteudo = r.isError ? `erro do conector ${conector.slug}: ${r.conteudo}` : r.conteudo;
    return { data: { ok: true, conteudo, confianca: "nao_confiavel" }, events };
  } catch (e) {
    // definido em 2026-10-15 (NOD-266): banco ocupado ou tx encerrada é falha NOSSA, não do app — relança sem marcar o
    // conector como falho (a marca o desligaria para a pessoa) e sem escrever mais nada numa tx que pode estar morta.
    if (ehErroDeInfraDaTx(e)) throw e;
    // definido em 2026-10-05 (NOD-157): 401/403 do conector não é "servidor fora" — o acesso ao app foi recusado. Sem enum novo:
    // falha_tecnica com `causa`, que muda só a redação. A chamada que chega aqui já esgotou as tentativas do cliente.
    const recusado = e instanceof Error && "status" in e && (e.status === 401 || e.status === 403);
    const motivo: MotivoNegacao = recusado ? "falha_tecnica" : e instanceof Error && e.message === "timeout_transporte" ? "timeout_transporte" : "conector_indisponivel";
    await deps.repos.conectores.marcarFalha(conectorId, motivo, agora);
    return negar(motivo, "conector_indisponivel", conectorId, false, recusado ? "acesso_recusado" : undefined);
  }
};

export const REGRA_EXECUCAO_LOCAL = "regra:execucao_local" as const;

/**
 * O desfecho de uma ferramenta que rodou NA MÁQUINA (ADR-048), relatado pelo proxy: vai à trilha como
 * `execucao_local` com o código fechado (null = ok). Só vale para ferramenta do plano marcada
 * `execucao: "maquina"`; qualquer outra é recusada — a máquina não inventa linha de trilha.
 */
export async function registrarExecucaoLocal(deps: Deps, input: { turnoId: string; agenteId: string; plano: PlanoTurno | null; nome: string; codigo: string }): Promise<boolean> {
  const f = input.plano?.turnoId === input.turnoId ? input.plano.catalogo.ferramentas.find((x) => x.nome === input.nome) : undefined;
  if (!f || f.execucao !== "maquina" || !/^[a-z_]{1,40}$/.test(input.codigo)) return false;
  await deps.repos.trilha.registrar({ agenteId: input.agenteId, turnoId: input.turnoId, conectorId: f.conectorId, ferramenta: nomeParaTrilha(input.nome), kind: "execucao_local", motivo: input.codigo === "ok" ? null : input.codigo, regra: REGRA_EXECUCAO_LOCAL, regraVersao: 1, em: deps.agora() });
  return true;
}
