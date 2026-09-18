import type { IdHarness } from "../contracts/harness.ts";
import { resolverHarness } from "../domain/harness.ts";
import { randomUUID } from "node:crypto";
import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { Inventario } from "../contracts/inventario.ts";
import type { ModoTurno, PlanoTurno } from "../contracts/plano-turno.ts";
import type { Conversa } from "../contracts/conversa.ts";
import type { Agente } from "../contracts/agente.ts";
import type { Turno } from "../contracts/turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { montarPlano, REGRA_MONTAGEM } from "../domain/plano-turno.ts";
import type { TokenTurno } from "../services/token-turno.ts";
import type { Services } from "./tipos.ts";
import type { CasoDeUso } from "./tipos.ts";
import { conectorPublico } from "./registrar-conector.ts";

export type EntradaEmitirPlano = {
  turnoId: string;
  machineId: string;
  /** Ausente: 'local' quando o inventário do claude-cli está pronto, senão 'catcher' (definido em 2026-09-16: catcher é o default de dev, ADR-012/EMENDA 25). */
  executor?: Executor;
  permitirResume?: boolean;
  harnesses?: Partial<Record<IdHarness, Inventario>>;
  harnessPreferido?: IdHarness | null;
};

/** Motor cujo inventário decide a localidade (ADR-019/022). */
export const MOTOR_CLI = "claude-cli";

export function modoDoTurno(turno: Pick<Turno, "origem" | "profundidade">, conversa: Pick<Conversa, "tipo"> | null, agente: Pick<Agente, "confirmado">): ModoTurno {
  if (turno.profundidade >= 1 || turno.origem === "peer") return "peer";
  if (turno.origem === "rotina") return "rotina";
  if (turno.origem === "sala" || conversa?.tipo === "sala") return "sala";
  return agente.confirmado ? "conversa" : "criacao";
}

function guardarPlanoSeSuportado(tokens: Services["tokenTurno"], plano: PlanoTurno): void {
  const concreto = tokens as Partial<Pick<TokenTurno, "guardarPlano">>;
  if (typeof concreto.guardarPlano === "function") concreto.guardarPlano.call(tokens, plano);
}

/**
 * Plano de turno (ADR-024) emitido no PUXAR, uma vez por turno: catálogo resolvido no servidor
 * (montarPlano: nod por modo + conector habilitado ∩ concessão do agente ∩ profundidade ∩ redução
 * por confiança), prompt de sistema, token de turno cunhado com a identidade (tenant, pessoa,
 * agente) e expiração. A concessão é lida AGORA, no despacho (E6.4/ADR-013): revogada entre
 * enfileirar e puxar, a ferramenta não entra. O plano fica guardado junto do token para
 * GET /api/interno/plano (services/token-turno.ts). Exposto como services.planos.emitir (L9).
 */
export const emitirPlanoTurno: CasoDeUso<EntradaEmitirPlano, PlanoTurno> = async (deps, input) => {
  const agora = deps.agora();
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  if (!turno) throw new ErroDeDominio("nao_encontrado", { cause: "turno" });
  const agente = await deps.repos.agentes.buscar(turno.agenteId);
  if (!agente) throw new ErroDeDominio("nao_encontrado", { cause: "agente" });
  const conversa = await deps.repos.conversas.buscar(turno.conversaId);
  const [memorias, concessoes, guardados, pessoa, visiveis] = await Promise.all([
    deps.repos.memorias.listarDoAgente(agente.id),
    deps.repos.concessoes.doAgente(agente.id),
    deps.repos.conectores.listar(),
    deps.repos.pessoas.buscar(deps.escopo.pessoaId),
    deps.repos.agentes.listar(),
  ]);
  const conectores = guardados.map(conectorPublico);

  const inventarioCli = await deps.repos.inventario.buscar(MOTOR_CLI);
  const executor: Executor = input.executor ?? (inventarioCli?.estado === "pronto" ? "local" : "catcher");
  const escolha = executor !== "catcher" && input.harnesses ? resolverHarness({ harness: turno.harness, modelo: turno.modelo,
    prontos: (Object.keys(input.harnesses) as IdHarness[]).filter((id) => input.harnesses?.[id]?.estado === "pronto"), preferido: input.harnessPreferido }) : null;
  const inventario: Inventario = escolha ? input.harnesses![escolha.harness]! : executor === "catcher" ? { estado: "pronto", versao: "catcher", em: agora } : (inventarioCli ?? { estado: "ausente", motivo: "inventário do claude-cli nunca registrado", em: agora });

  const modo = modoDoTurno(turno, conversa, agente);
  const mensagens = await deps.repos.mensagens.listarDaConversa(turno.conversaId, 50);
  const resposta = mensagens.find((m) => m.turnoId === turno.id && m.payload?.kind === "peer_ask");
  const origemId = resposta?.payload?.kind === "peer_ask" ? resposta.payload.turnoOrigemId : undefined;
  const original = origemId ? await deps.repos.turnos.buscar(origemId) : null;
  // definido em 2026-09-17: rotina e trabalho de colega usam sessão nova com missão e catálogo atuais; o histórico explícito preserva contexto.
  const sessaoCli = !escolha && input.permitirResume !== false && turno.origem !== "rotina" && turno.origem !== "peer" && conversa?.tipo !== "sala" && conversa?.sessaoCli && conversa.sessaoExecutor === executor ? conversa.sessaoCli : null;
  const historico = !sessaoCli ? mensagens.slice(-20).map((m) => ({ autor: m.autoria.autor_tipo === "pessoa" ? "pessoa" : visiveis.find((a) => a.id === m.autoria.autor_id)?.nome ?? "bot", texto: m.texto.slice(0, 1000), confianca: m.confianca })) : [];
  const contextoConversa = JSON.stringify({ ...(original ? { tarefaOriginal: original.entradaTexto.slice(0, 8000) } : {}), historico });
  let rotina: { exigeAprovacao: boolean } | null = null;
  if (turno.origem === "rotina") {
    // A janela reivindicada liga o turno à rotina (rotinaJanelas.buscarPorTurno, 0004 — pendência L5 §6 resolvida).
    // Sem janela (turno de rotina criado fora do scheduler) = gate LIGADO (fail-closed, E7.3).
    const janela = await deps.repos.rotinaJanelas.buscarPorTurno(turno.id);
    const daJanela = janela ? await deps.repos.rotinas.buscar(janela.rotinaId) : null;
    rotina = { exigeAprovacao: daJanela ? daJanela.exigeAprovacao : true };
  }

  const parcial = montarPlano({
    workspace: Boolean(deps.services.workspaces),
    computador: Boolean(deps.services.computadores),
    turno: escolha ? { ...turno, modelo: escolha.modelo } : turno,
    agente,
    memorias,
    concessoes,
    conectores,
    modo,
    confianca: turno.entradaConfianca,
    profundidade: turno.profundidade,
    inventario,
    executor,
    // 0005: --resume só para o MESMO executor que gravou a sessão; senão sessão nova (--session-id).
    sessaoCli,
    contextoConversa,
    pessoaNome: pessoa?.nome ?? "a pessoa",
    colegas: visiveis.filter((a) => a.id !== agente.id && a.ownerId === agente.ownerId && a.confirmado && !a.oculto),
    rotina,
    agora,
  });

  parcial.workspaceId = await deps.services.workspaces?.id({ ...deps.escopo, conversaId: turno.conversaId }) ?? null;

  const tokenDeTurno = deps.services.tokenTurno.cunhar(turno.id, { tenantId: deps.escopo.tenantId, pessoaId: deps.escopo.pessoaId, agenteId: agente.id });
  const plano: PlanoTurno = { ...parcial, ...(escolha ? { harness: escolha.harness } : {}), machineId: input.machineId, autoria: { ...parcial.autoria, machine_id: input.machineId }, tokenDeTurno };
  guardarPlanoSeSuportado(deps.services.tokenTurno, plano);

  const evento: RuntimeEvent = {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: agora,
    kind: "turno_despachado",
    autoria: { ...plano.autoria, decidido_por: REGRA_MONTAGEM, regra_versao: 1 },
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: turno.conversaId,
    turnoId: turno.id,
    dados: {
      machine_id: input.machineId,
      executor,
      harness: escolha?.harness ?? null,
      modelo: plano.entrada.modelo,
      modo,
      ferramentas: plano.catalogo.ferramentas.length,
      servidores: plano.catalogo.servidores.length,
      decidido_por: plano.decididoPor,
      confianca_entrada: plano.confiancaEntrada,
      expira_em: plano.expiraEm,
    },
  };
  return { data: plano, events: [evento] };
};
