import type { ConversaDto } from "../contracts/api.ts";
import type { Executor } from "../contracts/evento.ts";
import type { Inventario } from "../contracts/inventario.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import type { OrigemTurno, Turno } from "../contracts/turno.ts";
import type { IdHarness } from "../contracts/harness.ts";
import { excedeQuantidade, motorLe, tipoDoAnexo } from "../domain/anexo.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { resolverLocalidade } from "../domain/localidade-turno.ts";
import { redigir } from "../domain/redacao.ts";
import { log } from "../obs/log.ts";
import { autoriaAgente, autoriaPessoa, evento, inventarioAusente, motorDe, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { fiosDaConversa } from "./fios-da-pergunta.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

export type EntradaEnviarMensagem = {
  conversaId: string;
  texto: string;
  /** ADR-046: ids de anexos já enviados (soltos) desta conversa. Com anexo, o texto pode vir vazio. */
  anexos?: readonly string[];
  /** Só para conversa de SALA (a própria já sabe o agente): quem responde, decidido por postarNaSala (L7). */
  agenteId?: string;
  /** Prazo de DECISÃO do turno (relógio de parede, ADR-007); default 24 h. */
  prazoMs?: number;
  executor?: Executor;
  /** Inventário do motor já sondado (ADR-019); ausente = lê o registrado; nenhum = 'ausente' (fail-closed). */
  inventario?: Inventario;
  /** Chave de idempotência (UUID) que o compositor cria, uma por fala (NOD-156): o reenvio devolve a mesma mensagem e o mesmo turno. */
  idEnvio?: string;
};

export type SaidaEnviarMensagem = { mensagem: Mensagem; turno: Turno; negacao: Mensagem | null };

/**
 * Mensagem da pessoa = mensagem (confiável) + turno enfileirado + eventos, tudo na MESMA tx (ADR-010:
 * o rollback derruba os três). Localidade via resolverLocalidade com o inventário (ADR-022): recusada →
 * o turno NASCE interrompido 'executor_indisponivel' com mensagem de negação renderizável (E9.3, ADR-029).
 * Falar de novo libera a fila: encerra as paradas abertas que cobrem a conversa (E5.4/E8.1).
 *
 * definido em 2026-10-06 (NOD-156): com `idEnvio`, a fala já gravada com a mesma chave volta como está (mesma
 * mensagem, mesmo turno, sem eventos e sem mexer em paradas). Na corrida, o `on conflict do nothing` do insert
 * faz a perdedora esperar o commit da vencedora e voltar sem linha; aí ela lê a vencedora. Pegar a violação do
 * índice não serve: no Postgres ela aborta a transação inteira.
 */
export const enviarMensagem: CasoDeUso<EntradaEnviarMensagem, SaidaEnviarMensagem> = async (deps, input) => {
  const texto = typeof input.texto === "string" ? input.texto.trim() : "";
  const anexoIds = [...new Set(input.anexos ?? [])];
  if (texto === "" && anexoIds.length === 0) throw new ErroDeDominio("texto_vazio");
  if (excedeQuantidade(anexoIds.length)) throw new ErroDeDominio("entrada_invalida", { cause: "anexos demais" });
  const conversa = await deps.repos.conversas.buscar(input.conversaId);
  if (!conversa) throw new ErroDeDominio("nao_encontrado");
  const agenteId = conversa.tipo === "propria" ? conversa.agenteId : (input.agenteId ?? null);
  if (!agenteId) throw new ErroDeDominio("estado_invalido", { cause: "conversa de sala sem agente respondente" });
  const agente = await deps.repos.agentes.buscar(agenteId);
  if (!agente) throw new ErroDeDominio("nao_encontrado");
  const origem: OrigemTurno = conversa.tipo === "sala" ? "sala" : "conversa";
  const agora = deps.agora();
  const executor = input.executor ?? "catcher";
  const idEnvio = input.idEnvio;

  if (idEnvio) {
    const existente = await deps.repos.mensagens.buscarPorIdEnvio(conversa.id, idEnvio);
    if (existente) return { data: await envioRepetido(deps, existente, texto, anexoIds), events: [] };
  }

  const autoria = autoriaPessoa(deps.escopo, executor);
  const criada = await deps.repos.mensagens.criar({ conversaId: conversa.id, autoria, kind: "texto", texto, confianca: "confiavel", idEnvio });
  if (!criada && idEnvio) {
    // Perdeu a corrida: a outra transação gravou a mesma chave e já fez commit.
    const vencedora = await deps.repos.mensagens.buscarPorIdEnvio(conversa.id, idEnvio);
    if (vencedora) return { data: await envioRepetido(deps, vencedora, texto, anexoIds), events: [] };
  }
  if (!criada) throw new ErroDeDominio("nao_permitido");
  // Depois do insert (NOD-156): o reenvio de uma fala já gravada não pode encerrar uma parada aberta depois dela.
  await deps.repos.paradas.encerrarAbertas({ conversaId: conversa.id, agora });
  // Prende só o que é solto, desta conversa e da dona; qualquer id que sobrar derruba a tx inteira.
  const anexos = await deps.repos.anexos.prender(anexoIds, { conversaId: conversa.id, mensagemId: criada.id });
  if (anexos.length !== anexoIds.length) throw new ErroDeDominio("entrada_invalida", { cause: "anexo de outra conversa, já enviado ou inexistente" });
  // PDF para um agente cujo motor declarado não lê PDF: recusa escrita em vez de o modelo não ver o arquivo.
  const naoLido = agente.harness && agente.harness !== "auto" ? anexos.find((a) => !motorLe(agente.harness as IdHarness, tipoDoAnexo(a.mime))) : undefined;
  if (naoLido) throw new ErroDeDominio("entrada_invalida", { cause: `${agente.harness} não lê ${tipoDoAnexo(naoLido.mime)}` });
  const mensagem: Mensagem = anexos.length > 0 ? { ...criada, anexos } : criada;

  const inventario = input.inventario ?? (await deps.repos.inventario.buscar(motorDe(executor))) ?? inventarioAusente(agora);
  const localidade = resolverLocalidade({ origem, tocaDadoPessoal: false, motorExigido: agente.modelo, inventario });
  const recusado = "recusado" in localidade;

  const turno = await deps.repos.turnos.enfileirar({
    conversaId: conversa.id,
    agenteId: agente.id,
    origem,
    prazoEm: agora + (input.prazoMs ?? PRAZO_DECISAO_PADRAO_MS),
    profundidade: 0,
    entradaTexto: texto,
    mensagemOrigemId: mensagem.id,
    entradaAnexos: anexos.map((a) => a.id),
    entradaConfianca: "confiavel",
    modelo: agente.modelo,
    harness: agente.harness,
    executor,
    localityReason: localidade.motivo,
    decididoPor: localidade.decididoPor,
    interrompidoCom: recusado ? "executor_indisponivel" : undefined,
  });
  if (!turno) throw new ErroDeDominio("nao_permitido");

  const events = [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: conversa.id, turnoId: turno.id, dados: { mensagem_id: mensagem.id, kind: "texto" } })];
  let negacao: Mensagem | null = null;
  if (recusado) {
    negacao = await mensagemExecutorIndisponivel(deps, { conversaId: conversa.id, turnoId: turno.id, agenteId: agente.id, executor, inventario, agora });
    events.push(evento(deps.escopo, { kind: "turno_interrompido", autoria, agora, conversaId: conversa.id, turnoId: turno.id, dados: { motivo: "executor_indisponivel", inventario: inventario.estado } }));
    if (negacao) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: conversa.id, turnoId: turno.id, dados: { mensagem_id: negacao.id, kind: "negacao" } }));
  } else {
    events.push(evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: conversa.id, turnoId: turno.id, dados: { origem, agente_id: agente.id } }));
  }
  return { data: { mensagem, turno, negacao }, events };
};

/**
 * A fala já gravada com a mesma chave (NOD-156). Texto ou anexos diferentes com a mesma chave são erro do cliente,
 * não reenvio: recusa sem gravar nada (devolver a fala antiga perderia os anexos novos em silêncio). O turno se acha
 * por `mensagemOrigemId`.
 */
async function envioRepetido(deps: Deps, existente: Mensagem, texto: string, anexoIds: readonly string[]): Promise<SaidaEnviarMensagem> {
  if (existente.texto !== texto) throw new ErroDeDominio("estado_invalido", { cause: "id_envio_reusado" });
  const anexos = (await deps.repos.anexos.daMensagens([existente.id])).get(existente.id) ?? [];
  const gravados = anexos.map((a) => a.id).sort();
  const pedidos = anexoIds.map((id) => id.toLowerCase()).sort();
  if (gravados.length !== pedidos.length || gravados.some((id, i) => id !== pedidos[i])) throw new ErroDeDominio("estado_invalido", { cause: "id_envio_reusado" });
  const turno = await deps.repos.turnos.buscarPorMensagemOrigem(existente.id);
  if (!turno) throw new ErroDeDominio("estado_invalido", { cause: "id_envio sem turno" });
  log("info", "envio_repetido", { conversa_id: existente.conversaId, mensagem_id: existente.id });
  return { mensagem: anexos.length > 0 ? { ...existente, anexos } : existente, turno, negacao: null };
}

/**
 * Negação renderizável de executor indisponível (ADR-029): classe 'plano_ausente' porque nenhum plano
 * pode ser emitido sem motor 'pronto'; o texto vem da redação fixa com motivo e instante.
 */
export async function mensagemExecutorIndisponivel(
  deps: Deps,
  p: { conversaId: string; turnoId: string; agenteId: string; executor: Executor; inventario: Inventario; agora: number },
): Promise<Mensagem | null> {
  const motivo = p.inventario.estado === "pronto" ? "motor pronto" : `${motorDe(p.executor)} ${p.inventario.estado}: ${p.inventario.motivo}`;
  return deps.repos.mensagens.criar({
    conversaId: p.conversaId,
    turnoId: p.turnoId,
    autoria: autoriaAgente({ agenteId: p.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: p.executor, localityReason: "motor_ausente" }),
    kind: "negacao",
    texto: redigir("executor-indisponivel", p.agora, { motivo, desde: new Date(p.inventario.em).toISOString() }),
    payload: { kind: "negacao", classe: "plano_ausente", nome: motorDe(p.executor), motivo: "plano_ausente", terminal: true },
    confianca: "confiavel",
  });
}

/**
 * GET conversas/:id/mensagens (EMENDA 13): mensagens + turnos pendentes renderizáveis ("na fila — ocupado em …").
 * definido em 2026-09-24 (fio da pergunta): + os fios das perguntas com mensagem na janela, já com o estado.
 */
export const lerConversa: CasoDeUso<{ conversaId: string; limite?: number }, ConversaDto> = async (deps, input) => {
  const conversa = await deps.repos.conversas.buscar(input.conversaId);
  if (!conversa) throw new ErroDeDominio("nao_encontrado");
  const [lidas, turnosPendentes, vivos, propostas] = await Promise.all([
    deps.repos.mensagens.listarDaConversa(conversa.id, input.limite),
    deps.repos.turnos.pendentesRenderizaveis(conversa.id),
    deps.repos.turnos.vivosDaConversa(conversa.id),
    deps.repos.propostas.pendentesDaConversa(conversa.id),
  ]);
  const anexos = await deps.repos.anexos.daMensagens(lidas.filter((m) => m.autoria.autor_tipo === "pessoa").map((m) => m.id));
  const mensagens = anexos.size === 0 ? lidas : lidas.map((m) => (anexos.has(m.id) ? { ...m, anexos: anexos.get(m.id) } : m));
  // Cancelado antes de rodar = interrompido pela pessoa sem nunca ter sido reivindicado (attempted
  // nasce false e só o reivindicar o liga). Um Parar no meio da execução não entra: aquele rodou.
  const turnosCancelados = (await deps.repos.turnos.listarDaConversa(conversa.id))
    .filter((t) => t.estado === "interrompido" && t.motivoInterrupcao === "parado_pela_pessoa" && !t.sinais.attempted && t.mensagemOrigemId)
    .map((t) => ({ id: t.id, mensagemId: t.mensagemOrigemId as string }));
  const turnosEmCurso = vivos
    .filter((t): t is typeof t & { estado: "pendente" | "despachando" } => t.estado === "pendente" || t.estado === "despachando")
    .map((t) => ({ id: t.id, estado: t.estado, desde: t.criadoEm, mensagemId: t.mensagemOrigemId ?? null }));
  const fios = await fiosDaConversa(deps.repos, mensagens);
  return { data: { conversa, mensagens, turnosPendentes, turnosEmCurso, turnosCancelados, propostas, fios } };
};
