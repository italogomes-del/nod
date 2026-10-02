import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { ContextoFerramenta } from "../contracts/servicos.ts";
import type { ResultadoResolverPendencia } from "../contracts/ferramentas-pendencia.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import type { Pendencia, RespostaPendencias } from "../contracts/pendencia.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import {
  APARECE_SEM_HORA,
  idDePendenciaValido,
  lerAPartirDe,
  mesmoTexto,
  normalizarTexto,
  PENDENCIAS_ABERTAS_MAX,
  REPEDIR_APOS_MS,
  TEXTO_PENDENCIA_MAX,
} from "../domain/pendencia.ts";
import { redigir } from "../domain/redacao.ts";
import { autoriaAgente, autoriaPessoa, evento } from "./autoria-evento.ts";
import { enviarMensagem, type SaidaEnviarMensagem } from "./enviar-mensagem.ts";
import type { CasoDeUso, Deps, UseCasesNod } from "./tipos.ts";

/**
 * Pendências do bot (definido em 2026-09-30, ADR-064). O bot anota o que vai deixar para depois; o nod guarda e
 * devolve a lista nos turnos que a pessoa ou uma rotina abrem (emitir-plano-turno.ts). Sem alarme. Três
 * ferramentas do bot (anotar, concluir, descartar) e três ações da pessoa (listar, descartar, fazer agora).
 */

const executorDo = (input: ContextoFerramenta): Executor => input.plano?.executor ?? "catcher";

/** Sem o ponto final: a frase fixa de sistema ("Feito: {texto}. {como}") põe o dela. */
function semPontoFinal(texto: string): string {
  return texto.replace(/[\s.!…]+$/u, "");
}

/** O "como" e o "por quê" do bot viram a segunda frase da linha: maiúscula no começo e ponto no fim. */
function comoFrase(texto: string): string {
  const t = normalizarTexto(texto);
  const maiuscula = t.charAt(0).toLocaleUpperCase("pt-BR") + t.slice(1);
  return t === "" || /[.!?…]$/u.test(t) ? maiuscula : `${maiuscula}.`;
}

/**
 * Ferramenta `anotar_pendencia`: a pendência vai para a conversa PRÓPRIA do bot, venha o turno de uma sala ou de um
 * pedido de colega. Texto igual a uma aberta devolve a que já existe (o modelo que anota de novo não duplica); no
 * teto, a instrução pede para limpar antes. `cuidado` é fail-closed: turno não achado, entrada não confiável ou
 * conteúdo de fora lido nele.
 */
export const anotarPendencia: UseCasesNod["anotarPendencia"] = async (deps, input) => {
  const texto = normalizarTexto(typeof input.texto === "string" ? input.texto : "");
  if (texto === "") return { data: { ok: false, erro: "texto_vazio", instrucao: "Escreva em uma frase o que fica para depois e para quem." } };
  const agora = deps.agora();
  const quando = lerAPartirDe(input.a_partir_de, agora);
  if (!quando.ok) return { data: { ok: false, erro: "a_partir_de_invalido", instrucao: "Use ISO 8601 com fuso, como 2026-10-01T16:20:00-03:00, até um ano à frente; ou anote sem a_partir_de." } };
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(input.agenteId);
  if (!conversa) throw new ErroDeDominio("nao_encontrado", { cause: "conversa própria do agente" });

  const aparece = (em: number | null) => (em === null ? APARECE_SEM_HORA : new Date(em).toISOString());
  const abertas = await deps.repos.pendencias.abertasDoAgente(input.agenteId);
  const igual = abertas.find((p) => mesmoTexto(p.texto, texto));
  if (igual) return { data: { ok: true, pendencia_id: igual.id, ja_estava: true, aparece: aparece(igual.aPartirDe) } };
  if (abertas.length >= PENDENCIAS_ABERTAS_MAX) {
    return { data: { ok: false, erro: "limite_de_pendencias", instrucao: `Você já tem ${PENDENCIAS_ABERTAS_MAX} pendências abertas: conclua ou descarte as que perderam o sentido antes de anotar outra.` } };
  }

  const turno = await deps.repos.turnos.buscar(input.turnoId);
  const cuidado = !turno || turno.entradaConfianca !== "confiavel" || (await deps.repos.turnos.contaminado(turno.id));
  const pendencia = await deps.repos.pendencias.criar({
    agenteId: input.agenteId,
    conversaId: conversa.id,
    turnoId: turno?.id ?? null,
    texto: texto.slice(0, TEXTO_PENDENCIA_MAX),
    aPartirDe: quando.em,
    cuidado,
    profundidade: turno?.profundidade ?? 0,
  });
  if (!pendencia) throw new ErroDeDominio("nao_permitido");
  const autoria = autoriaAgente({ agenteId: input.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: executorDo(input) });
  return {
    data: { ok: true, pendencia_id: pendencia.id, ja_estava: false, aparece: aparece(pendencia.aPartirDe) },
    events: [evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, conversaId: conversa.id, turnoId: input.turnoId, dados: { agente_id: input.agenteId, acao: "pendencia_anotada", pendencia_id: pendencia.id } })],
  };
};

/**
 * O bot conclui ou descarta uma pendência DELE (a de outro bot é "não encontrada", sem dizer que existe). A
 * resolução deixa uma linha de sistema na conversa própria: a pessoa vê que o bot cumpriu o que deixou para depois.
 */
async function resolverPeloBot(
  deps: Deps,
  input: ContextoFerramenta & { id: string },
  estado: "feita" | "descartada",
  motivo: string,
): Promise<{ data: ResultadoResolverPendencia; events?: RuntimeEvent[] }> {
  if (!idDePendenciaValido(input.id)) return { data: { ok: false, erro: "pendencia_nao_encontrada" } };
  const p = await deps.repos.pendencias.buscar(input.id);
  if (!p || p.agenteId !== input.agenteId) return { data: { ok: false, erro: "pendencia_nao_encontrada" } };
  if (p.estado !== "aberta") return { data: { ok: false, erro: "pendencia_ja_resolvida" } };
  const agora = deps.agora();
  const resolvida = await deps.repos.pendencias.resolver(p.id, { estado, por: "bot", turnoId: input.turnoId, motivo: normalizarTexto(motivo).slice(0, TEXTO_PENDENCIA_MAX), agora });
  if (!resolvida) return { data: { ok: false, erro: "pendencia_ja_resolvida" } };

  const autoria = autoriaAgente({ agenteId: input.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: executorDo(input) });
  const texto = estado === "feita"
    ? redigir("pendencia-feita", agora, { texto: semPontoFinal(p.texto), como: comoFrase(motivo) })
    : redigir("pendencia-descartada", agora, { texto: semPontoFinal(p.texto), motivo: comoFrase(motivo) });
  const mensagem = await deps.repos.mensagens.criar({ conversaId: p.conversaId, turnoId: input.turnoId, autoria, kind: "sistema", texto, confianca: "confiavel" });
  const events: RuntimeEvent[] = [evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, conversaId: p.conversaId, turnoId: input.turnoId, dados: { agente_id: input.agenteId, acao: estado === "feita" ? "pendencia_concluida" : "pendencia_descartada", pendencia_id: p.id } })];
  if (mensagem) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: p.conversaId, turnoId: input.turnoId, dados: { mensagem_id: mensagem.id, kind: "sistema" } }));
  return { data: { ok: true }, events };
}

/** Ferramenta `concluir_pendencia`. */
export const concluirPendencia: UseCasesNod["concluirPendencia"] = (deps, input) => resolverPeloBot(deps, input, "feita", input.como);

/** Ferramenta `descartar_pendencia`. */
export const descartarPendencia: UseCasesNod["descartarPendencia"] = (deps, input) => resolverPeloBot(deps, input, "descartada", input.por_que);

/** A pendência do bot que a pessoa tocou: de outro bot (ou inexistente) é 404, como qualquer linha que ela não vê. */
async function pendenciaDoBot(deps: Deps, agenteId: string, pendenciaId: string): Promise<Pendencia> {
  const p = await deps.repos.pendencias.buscar(pendenciaId);
  if (!p || p.agenteId !== agenteId) throw new ErroDeDominio("nao_encontrado");
  return p;
}

/** GET agentes/:id/pendencias: as abertas do bot, com hora futura ou não (a tela mostra todas). */
export const listarPendencias: CasoDeUso<{ agenteId: string }, RespostaPendencias> = async (deps, input) => {
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (!agente) throw new ErroDeDominio("nao_encontrado");
  return { data: { pendencias: await deps.repos.pendencias.abertasDoAgente(agente.id) } };
};

/** A pessoa descarta: a pendência sai da lista e a conversa ganha "Você descartou: …". */
export const descartarPendenciaPelaPessoa: CasoDeUso<{ agenteId: string; pendenciaId: string }, { pendencia: Pendencia; mensagem: Mensagem | null }> = async (deps, input) => {
  const p = await pendenciaDoBot(deps, input.agenteId, input.pendenciaId);
  const agora = deps.agora();
  const resolvida = await deps.repos.pendencias.resolver(p.id, { estado: "descartada", por: "pessoa", turnoId: null, motivo: null, agora });
  if (!resolvida) throw new ErroDeDominio("estado_invalido", { cause: "pendência já resolvida" });
  const autoria = autoriaPessoa(deps.escopo);
  const mensagem = await deps.repos.mensagens.criar({ conversaId: p.conversaId, turnoId: null, autoria, kind: "sistema", texto: redigir("pendencia-descartada-pela-pessoa", agora, { texto: semPontoFinal(p.texto) }), confianca: "confiavel" });
  const events: RuntimeEvent[] = [evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, conversaId: p.conversaId, dados: { agente_id: p.agenteId, acao: "pendencia_descartada", pendencia_id: p.id } })];
  if (mensagem) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: p.conversaId, dados: { mensagem_id: mensagem.id, kind: "sistema" } }));
  return { data: { pendencia: resolvida, mensagem }, events };
};

/** A ressalva que a fala do "Fazer agora" leva quando a pendência veio de um turno que leu conteúdo de fora. */
export const RESSALVA_CUIDADO = "anotada depois de ler conteúdo de fora: confira na fonte antes de agir";

/** A fala da pessoa: com `cuidado`, o clique dela não lava a origem da pendência (ADR-064). */
export function falaFazerAgora(p: Pick<Pendencia, "texto" | "cuidado">): string {
  return p.cuidado ? `Fazer agora: ${semPontoFinal(p.texto)} (${RESSALVA_CUIDADO})` : `Fazer agora: ${p.texto}`;
}

/**
 * "Fazer agora": a pessoa manda na conversa do bot a fala "Fazer agora: <texto>", pelo mesmo caminho do chat
 * (enviarMensagem) — um turno de conversa, profundidade 0, confiável: a corrente de colegas recomeça porque o
 * clique é dela. A pendência continua aberta até o bot concluir; `pedida_em` segura o duplo clique. A pendência com
 * `cuidado` leva a ressalva na fala: sem ela, o texto que veio de fora chegaria ao bot como pedido limpo da pessoa.
 */
export const fazerPendenciaAgora: CasoDeUso<{ agenteId: string; pendenciaId: string; prazoMs?: number; executor?: Executor }, SaidaEnviarMensagem> = async (deps, input) => {
  const p = await pendenciaDoBot(deps, input.agenteId, input.pendenciaId);
  if (p.estado !== "aberta") throw new ErroDeDominio("estado_invalido", { cause: "pendência já resolvida" });
  const agora = deps.agora();
  const marcada = await deps.repos.pendencias.marcarPedida(p.id, agora, REPEDIR_APOS_MS);
  if (!marcada) throw new ErroDeDominio("estado_invalido", { cause: "pedido enviado há pouco" });
  const r = await enviarMensagem(deps, { conversaId: p.conversaId, texto: falaFazerAgora(p), prazoMs: input.prazoMs, executor: input.executor });
  const autoria = autoriaPessoa(deps.escopo, input.executor);
  return { data: r.data, events: [...(r.events ?? []), evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, conversaId: p.conversaId, dados: { agente_id: p.agenteId, acao: "pendencia_pedida", pendencia_id: p.id } })] };
};
