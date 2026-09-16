import type { ConversaDto } from "../contracts/api.ts";
import type { Executor } from "../contracts/evento.ts";
import type { Inventario } from "../contracts/inventario.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import type { OrigemTurno, Turno } from "../contracts/turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { resolverLocalidade } from "../domain/localidade-turno.ts";
import { redigir } from "../domain/redacao.ts";
import { autoriaAgente, autoriaPessoa, evento, inventarioAusente, motorDe, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import type { CasoDeUso, Deps } from "./tipos.ts";

export type EntradaEnviarMensagem = {
  conversaId: string;
  texto: string;
  /** Só para conversa de SALA (a própria já sabe o agente): quem responde, decidido por postarNaSala (L7). */
  agenteId?: string;
  /** Prazo de DECISÃO do turno (relógio de parede, ADR-007); default 24 h. */
  prazoMs?: number;
  executor?: Executor;
  /** Inventário do motor já sondado (ADR-019); ausente = lê o registrado; nenhum = 'ausente' (fail-closed). */
  inventario?: Inventario;
};

export type SaidaEnviarMensagem = { mensagem: Mensagem; turno: Turno; negacao: Mensagem | null };

/**
 * Mensagem da pessoa = mensagem (confiável) + turno enfileirado + eventos, tudo na MESMA tx (ADR-010:
 * o rollback derruba os três). Localidade via resolverLocalidade com o inventário (ADR-022): recusada →
 * o turno NASCE interrompido 'executor_indisponivel' com mensagem de negação renderizável (E9.3, ADR-029).
 * Falar de novo libera a fila: encerra as paradas abertas que cobrem a conversa (E5.4/E8.1).
 */
export const enviarMensagem: CasoDeUso<EntradaEnviarMensagem, SaidaEnviarMensagem> = async (deps, input) => {
  const texto = typeof input.texto === "string" ? input.texto.trim() : "";
  if (texto === "") throw new ErroDeDominio("texto_vazio");
  const conversa = await deps.repos.conversas.buscar(input.conversaId);
  if (!conversa) throw new ErroDeDominio("nao_encontrado");
  const agenteId = conversa.tipo === "propria" ? conversa.agenteId : (input.agenteId ?? null);
  if (!agenteId) throw new ErroDeDominio("estado_invalido", { cause: "conversa de sala sem agente respondente" });
  const agente = await deps.repos.agentes.buscar(agenteId);
  if (!agente) throw new ErroDeDominio("nao_encontrado");
  const origem: OrigemTurno = conversa.tipo === "sala" ? "sala" : "conversa";
  const agora = deps.agora();
  const executor = input.executor ?? "catcher";

  await deps.repos.paradas.encerrarAbertas({ conversaId: conversa.id, agora });

  const autoria = autoriaPessoa(deps.escopo, executor);
  const mensagem = await deps.repos.mensagens.criar({ conversaId: conversa.id, autoria, kind: "texto", texto, confianca: "confiavel" });
  if (!mensagem) throw new ErroDeDominio("nao_permitido");

  const inventario = input.inventario ?? (await deps.repos.inventario.buscar(motorDe(executor))) ?? inventarioAusente(agora);
  const localidade = resolverLocalidade({ origem, tocaAprendiz: false, motorExigido: agente.modelo, inventario });
  const recusado = "recusado" in localidade;

  const turno = await deps.repos.turnos.enfileirar({
    conversaId: conversa.id,
    agenteId: agente.id,
    origem,
    prazoEm: agora + (input.prazoMs ?? PRAZO_DECISAO_PADRAO_MS),
    profundidade: 0,
    entradaTexto: texto,
    entradaConfianca: "confiavel",
    modelo: agente.modelo,
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

/** GET conversas/:id/mensagens (EMENDA 13): mensagens + turnos pendentes renderizáveis ("na fila — ocupado em …"). */
export const lerConversa: CasoDeUso<{ conversaId: string; limite?: number }, ConversaDto> = async (deps, input) => {
  const conversa = await deps.repos.conversas.buscar(input.conversaId);
  if (!conversa) throw new ErroDeDominio("nao_encontrado");
  const [mensagens, turnosPendentes, propostas] = await Promise.all([
    deps.repos.mensagens.listarDaConversa(conversa.id, input.limite),
    deps.repos.turnos.pendentesRenderizaveis(conversa.id),
    deps.repos.propostas.pendentesDaConversa(conversa.id),
  ]);
  return { data: { conversa, mensagens, turnosPendentes, propostas } };
};
