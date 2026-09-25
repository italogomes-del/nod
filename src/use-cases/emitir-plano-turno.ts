import type { IdHarness } from "../contracts/harness.ts";
import { resolverHarness } from "../domain/harness.ts";
import { randomUUID } from "node:crypto";
import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { Inventario } from "../contracts/inventario.ts";
import type { ModoTurno, PlanoTurno } from "../contracts/plano-turno.ts";
import type { Conversa } from "../contracts/conversa.ts";
import type { Agente } from "../contracts/agente.ts";
import type { Turno } from "../contracts/turno.ts";
import { MOTIVO_FALHA_EM_PORTUGUES } from "../domain/computador.ts";
import { COMANDO_GITHUB_NATIVO, SLUG_GITHUB } from "../contracts/github.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { marcarExecucaoNaMaquina } from "../domain/github.ts";
import { montarPlano, REGRA_MONTAGEM } from "../domain/plano-turno.ts";
import type { ComputadorFora } from "../domain/prompt-sistema.ts";
import { resumoCron } from "../domain/rotina-texto.ts";
import type { TokenTurno } from "../services/token-turno.ts";
import type { Services } from "./tipos.ts";
import type { CasoDeUso } from "./tipos.ts";
import { delegacaoDoTurno, rotinaDoTurno } from "./apoio-l7.ts";
import { conectorPublico } from "./registrar-conector.ts";

export type EntradaEmitirPlano = {
  turnoId: string;
  machineId: string;
  /** Ausente: 'local' quando o inventário do claude-cli está pronto, senão 'catcher' (definido em 2026-09-16: catcher é o default de dev, ADR-012/EMENDA 25). */
  executor?: Executor;
  permitirResume?: boolean;
  harnesses?: Partial<Record<IdHarness, Inventario>>;
  harnessPreferido?: IdHarness | null;
  /**
   * definido em 2026-09-24 (ADR-048): a máquina DESTE turno tem o gh logado e é da pessoa do turno.
   * As ferramentas do GitHub nativo DELA vão marcadas para rodar na máquina (o proxy executa).
   */
  ghNaMaquina?: boolean;
};

/**
 * definido em 2026-09-16: sem --resume, o modelo vê as últimas HISTORICO_NO_PLANO falas, tiradas das
 * MENSAGENS_DO_PLANO mais recentes. Exportados porque delegar_tarefa confere a mesma janela (ADR-047).
 */
export const MENSAGENS_DO_PLANO = 50;
export const HISTORICO_NO_PLANO = 20;

/** Motor cujo inventário decide a localidade (ADR-019/022). */
export const MOTOR_CLI = "claude-cli";

/**
 * `ligadoARotina`: o turno leva a uma rotina pela janela (rotinaDoTurno). definido em 2026-09-24
 * (ADR-044): a RETOMADA de um turno de rotina continua rotina — antes ela caía em 'conversa' e voltava
 * com o catálogo inteiro e sem o gate, depois de ter lido e-mail como entrada não confiável.
 * `ligadoADelegacao` (definido em 2026-09-24, ADR-047): a tarefa delegada e as retomadas dela são
 * 'delegacao' ANTES da regra de profundidade — ela roda em profundidade 1 e caía em 'peer'.
 */
export function modoDoTurno(turno: Pick<Turno, "origem" | "profundidade">, conversa: Pick<Conversa, "tipo"> | null, agente: Pick<Agente, "confirmado">, ligadoARotina = false, ligadoADelegacao = false): ModoTurno {
  if (turno.origem === "delegacao" || ligadoADelegacao) return "delegacao";
  if (turno.profundidade >= 1 || turno.origem === "peer") return "peer";
  if (turno.origem === "rotina" || ligadoARotina) return "rotina";
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
  const [memorias, concessoes, guardados, pessoa, visiveis, permissoes] = await Promise.all([
    deps.repos.memorias.listarDoAgente(agente.id),
    deps.repos.concessoes.doAgente(agente.id),
    deps.repos.conectores.listar(),
    deps.repos.pessoas.buscar(deps.escopo.pessoaId),
    deps.repos.agentes.listar(),
    deps.repos.permissoesPermanentes.ativasDoAgente(agente.id),
  ]);
  const conectores = guardados.map(conectorPublico);

  const inventarioCli = await deps.repos.inventario.buscar(MOTOR_CLI);
  const executor: Executor = input.executor ?? (inventarioCli?.estado === "pronto" ? "local" : "catcher");
  const escolha = executor !== "catcher" && input.harnesses ? resolverHarness({ harness: turno.harness, modelo: turno.modelo,
    prontos: (Object.keys(input.harnesses) as IdHarness[]).filter((id) => input.harnesses?.[id]?.estado === "pronto"), preferido: input.harnessPreferido }) : null;
  const inventario: Inventario = escolha ? input.harnesses![escolha.harness]! : executor === "catcher" ? { estado: "pronto", versao: "catcher", em: agora } : (inventarioCli ?? { estado: "ausente", motivo: "inventário do claude-cli nunca registrado", em: agora });

  // A janela reivindicada liga o turno à rotina (rotina_janelas.turno_id, 0004 — pendência L5 §6
  // resolvida); a retomada segue a cadeia de retomaTurnoId até o turno disparado (ADR-044).
  const ligacao = turno.origem === "rotina" || turno.origem === "retomada" ? await rotinaDoTurno(deps.repos, turno.id) : null;
  const delegacao = turno.origem === "delegacao" || turno.origem === "retomada" ? await delegacaoDoTurno(deps.repos, turno) : null;
  // Fail-closed (revisão da ADR-047): toda retomada copia `sob_procuracao_de`; se a cadeia passou do teto
  // de saltos e a raiz não foi achada, o turno continua delegação — nunca cai em conversa com --resume.
  const ehDelegacao = delegacao !== null || Boolean(turno.sobProcuracaoDe);
  const modo = modoDoTurno(turno, conversa, agente, ligacao !== null, ehDelegacao);
  const mensagens = await deps.repos.mensagens.listarDaConversa(turno.conversaId, MENSAGENS_DO_PLANO);
  const resposta = mensagens.find((m) => m.turnoId === turno.id && m.payload?.kind === "peer_ask");
  const origemId = resposta?.payload?.kind === "peer_ask" ? resposta.payload.turnoOrigemId : undefined;
  const original = origemId ? await deps.repos.turnos.buscar(origemId) : null;
  // definido em 2026-09-17: rotina e trabalho de colega usam sessão nova com missão e catálogo atuais; o histórico explícito preserva contexto.
  // definido em 2026-09-24 (ADR-044): a retomada ligada a uma rotina também — o --resume da conversa a levaria de volta ao modo conversa.
  // definido em 2026-09-24 (ADR-047): a tarefa delegada também — a sessão da conversa é do alvo com a pessoa.
  const sessaoCli = !escolha && input.permitirResume !== false && turno.origem !== "rotina" && turno.origem !== "peer" && ligacao === null && !ehDelegacao && conversa?.tipo !== "sala" && conversa?.sessaoCli && conversa.sessaoExecutor === executor ? conversa.sessaoCli : null;
  const historico = !sessaoCli ? mensagens.slice(-HISTORICO_NO_PLANO).map((m) => ({ autor: m.autoria.autor_tipo === "pessoa" ? "pessoa" : visiveis.find((a) => a.id === m.autoria.autor_id)?.nome ?? "bot", texto: m.texto.slice(0, 1000), confianca: m.confianca })) : [];
  const contextoConversa = JSON.stringify({ ...(original ? { tarefaOriginal: original.entradaTexto.slice(0, 8000) } : {}), historico });
  // Turno de rotina sem janela (criado fora do scheduler) = gate LIGADO (fail-closed, E7.3). A retomada
  // ligada a uma rotina herda o gate DELA (ADR-044); retomada sem rotina não tem gate.
  const rotina: { exigeAprovacao: boolean } | null = ligacao ? { exigeAprovacao: ligacao.rotina.exigeAprovacao } : turno.origem === "rotina" ? { exigeAprovacao: true } : null;

  // Inventário para o modelo escolher SOBRE QUAL rotina agir (o estado vem computado por COLUNAS:
  // geração antiga do agente lê como 'pausada'). resumoCron traduz o cron para o texto humano.
  const rotinasDoAgente = (await deps.repos.rotinas.listarDoAgente(agente.id)).map((r) => ({
    id: r.id,
    resumo: resumoCron(r.cron, r.fusoIana),
    instrucao: r.instrucao,
    estado: r.estado,
  }));

  // Resolvido ANTES de montar: o catálogo depende de haver projeto autorizado, não só do serviço.
  const workspaceId = await deps.services.workspaces?.id({ ...deps.escopo, conversaId: turno.conversaId }) ?? null;

  // definido em 2026-09-24 (emenda da ADR-037): o computador que ainda não existe nasce ligado (as
  // ferramentas entram); o que existe só entra ligado e respondendo — desligado ou fora do ar, o plano
  // sai sem computador_* e o prompt diz por quê.
  const computadorDoAgente = deps.services.computadores ? await deps.repos.computadores.buscarVinculo(agente.id) : null;
  const computadorFora: ComputadorFora | null = !computadorDoAgente ? null
    : !computadorDoAgente.habilitado ? { estado: "desligado" }
      : computadorDoAgente.indisponivelDesde !== null ? { estado: "fora_do_ar", motivo: MOTIVO_FALHA_EM_PORTUGUES[computadorDoAgente.falhaMotivo ?? "sem_resposta"] }
        : null;

  // Quem pediu e por meio de quem (ADR-047): a pessoa vem de `sob_procuracao_de` da tarefa; o remetente,
  // do peer_pedido ligado a ela. Fora da janela de mensagens, o prompt cai no genérico.
  const pedidoDelegado = delegacao ? mensagens.find((m) => m.turnoId === delegacao.id && m.payload?.kind === "peer_pedido") : undefined;
  const sobProcuracaoDe = turno.sobProcuracaoDe ?? delegacao?.sobProcuracaoDe ?? null;
  const pessoaDelegante = sobProcuracaoDe && sobProcuracaoDe !== pessoa?.id ? await deps.repos.pessoas.buscar(sobProcuracaoDe) : pessoa;
  const parcial = montarPlano({
    workspace: Boolean(deps.services.workspaces),
    workspaceVinculado: workspaceId !== null,
    computador: Boolean(deps.services.computadores),
    computadorFora,
    turno: { ...turno, sobProcuracaoDe, ...(escolha ? { modelo: escolha.modelo } : {}) },
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
    anexos: await deps.repos.anexos.metas(turno.entradaAnexos),
    contextoConversa,
    pessoaNome: pessoa?.nome ?? "a pessoa",
    colegas: visiveis.filter((a) => a.id !== agente.id && a.ownerId === agente.ownerId && a.confirmado && !a.oculto),
    rotina,
    rotinasDoAgente,
    // ADR-042: a regra é gravada por (conector_id, capacidade) e o catálogo fala `${slug}__${tool}`.
    // Conector que sumiu do registro não vira nome nenhum, então a regra órfã simplesmente não casa.
    delegacao: ehDelegacao ? { pessoaNome: pessoaDelegante?.nome ?? "A pessoa", remetenteNome: visiveis.find((a) => a.id === pedidoDelegado?.autoria.autor_id)?.nome ?? "outro bot" } : null,
    semprePermitir: permissoes.flatMap((p) => {
      const slug = conectores.find((c) => c.id === p.conectorId)?.slug;
      return slug ? [`${slug}__${p.capacidade}`] : [];
    }),
    agora,
  });

  parcial.workspaceId = workspaceId;
  if (input.ghNaMaquina) {
    // O login do gh serve à dona: só o conector github DELA roda na máquina; o de outra pessoa, nunca.
    const meu = guardados.find((c) => c.slug === SLUG_GITHUB && c.comando === COMANDO_GITHUB_NATIVO && c.ownerId === deps.escopo.pessoaId);
    parcial.catalogo.ferramentas = marcarExecucaoNaMaquina(parcial.catalogo.ferramentas, meu?.id ?? null);
  }
  parcial.workspacePastas = workspaceId ? await deps.services.workspaces?.pastasDoHarness({ ...deps.escopo, conversaId: turno.conversaId }) ?? null : null;

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
