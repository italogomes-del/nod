import type { IdHarness } from "../contracts/harness.ts";
import { modeloMaisPotente, resolverHarness } from "../domain/harness.ts";
import { randomUUID } from "node:crypto";
import { MODELOS_LIGACAO_PADRAO, type ModelosLigacao } from "../contracts/modelos.ts";
import { modeloDeVoz } from "../domain/modelo-ligacao.ts";
import { generoDaVoz } from "../domain/vozes.ts";
import { montarPromptLigacao, MENSAGENS_NO_PROMPT_LIGACAO } from "../domain/prompt-ligacao.ts";
import { linhasDoPromptOnboarding } from "../domain/roteiro-onboarding.ts";
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
import { pendenciasDoPrompt } from "../domain/pendencia.ts";
import { montarPlano, REGRA_MONTAGEM } from "../domain/plano-turno.ts";
import { composicaoDoPlano } from "../domain/raio-x.ts";
import type { ComputadorFora } from "../domain/prompt-sistema.ts";
import { resumoCron } from "../domain/rotina-texto.ts";
import type { TokenTurno } from "../services/token-turno.ts";
import type { Services } from "./tipos.ts";
import type { CasoDeUso } from "./tipos.ts";
import { delegacaoDoTurno, rotinaDoTurno } from "./apoio-l7.ts";
import { conectorPublico } from "./registrar-conector.ts";
import { ehColega } from "./ver-colegas.ts";

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
  /**
   * NOD-164 (emenda à ADR-072): o modelo da ligação por harness, já lido e validado pelo compositor
   * (`lerModelosLigacao` sobre o env do servidor). Ausente = MODELOS_LIGACAO_PADRAO. O caso de uso não lê `process.env`.
   */
  modelosLigacao?: ModelosLigacao;
};

/**
 * definido em 2026-09-16: sem --resume, o modelo vê as últimas HISTORICO_NO_PLANO falas, tiradas das
 * MENSAGENS_DO_PLANO mais recentes.
 */
export const MENSAGENS_DO_PLANO = 50;
export const HISTORICO_NO_PLANO = 20;
/** definido em 2026-09-28 (0030): o que chegou depois da sessão vai quase inteiro — o checklist da rotina das 8h tem ~3k. */
const TEXTO_DESDE_A_SESSAO = 8000;

/** Motor cujo inventário decide a localidade (ADR-019/022). */
export const MOTOR_CLI = "claude-cli";

/**
 * `ligadoARotina`: o turno leva a uma rotina pela janela (rotinaDoTurno). definido em 2026-09-24
 * (ADR-044): a RETOMADA de um turno de rotina continua rotina — antes ela caía em 'conversa' e voltava
 * com o catálogo inteiro e sem o gate, depois de ter lido e-mail como entrada não confiável.
 * `ligadoADelegacao` (definido em 2026-09-24, ADR-047): o pedido de colega e as retomadas dele são 'delegacao'.
 * revisto em 2026-09-29 (ADR-058): profundidade não é mais 'peer' — no limite (ADR-063) ela só corta o salto. A
 * continuação de quem pediu (retomada do turno dele, um passe mais funda) volta no modo dele: conversa, sala, rotina
 * ou, se quem pediu cumpria um pedido de colega, delegação.
 * 'peer' fica para o turno legado de perguntar_a_bot que ainda estiver na fila.
 */
export function modoDoTurno(turno: Pick<Turno, "origem" | "profundidade">, conversa: Pick<Conversa, "tipo"> | null, agente: Pick<Agente, "confirmado">, ligadoARotina = false, ligadoADelegacao = false): ModoTurno {
  // definido em 2026-10-04 (ADR-072): o turno-cérebro da ligação tem modo próprio (catálogo e prompt de voz).
  if (turno.origem === "ligacao") return "ligacao";
  if (turno.origem === "delegacao" || ligadoADelegacao) return "delegacao";
  if (turno.origem === "peer") return "peer";
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
  // definido em 2026-09-28 (0030): com harness escolhido, a sessão só vale para o harness que a criou. Antes
  // `!escolha` desligava o --resume de todo turno real desde os harnesses (18/09), e cada mensagem abria uma
  // sessão com 20 falas de 1.000 caracteres. Só o Claude Code retoma sessão hoje (o Codex devolve null).
  const sessaoDoHarness = escolha ? escolha.harness === "claude-cli" && conversa?.sessaoHarness === escolha.harness : true;
  const sessaoDaConversa = sessaoDoHarness && input.permitirResume !== false && turno.origem !== "rotina" && turno.origem !== "peer" && turno.origem !== "ligacao" && ligacao === null && !ehDelegacao && conversa?.tipo !== "sala" && conversa?.sessaoCli && conversa.sessaoExecutor === executor ? conversa.sessaoCli : null;
  // definido em 2026-10-01 (ADR-066): a retomada de rotina ou de pedido de colega volta na sessão DO TURNO que ela
  // continua (nunca na da conversa, pelos motivos acima). Antes ela começava do zero: em 30/09 o Milton, retomado 13
  // min depois de uma aprovação cujo comentário falhou, leu a task, chamou sem_novidade e não refez nem avisou. Com o
  // terminal fora da conversa, a sessão é o que guarda os arquivos mexidos e o resultado dos testes.
  const continuaCadeia = !sessaoDaConversa && turno.origem === "retomada" && turno.retomaTurnoId !== null && (ligacao !== null || ehDelegacao) && input.permitirResume !== false && (escolha ? escolha.harness === "claude-cli" : true);
  const daCadeia = continuaCadeia && turno.retomaTurnoId ? await deps.repos.turnos.sessaoDoTurno(turno.retomaTurnoId) : null;
  const sessaoDaCadeia = daCadeia && daCadeia.executor === executor ? daCadeia.sessaoCli : null;
  const sessaoCli = sessaoDaConversa ?? sessaoDaCadeia;
  const autorDe = (m: (typeof mensagens)[number]) => (m.autoria.autor_tipo === "pessoa" ? "pessoa" : visiveis.find((a) => a.id === m.autoria.autor_id)?.nome ?? "bot");
  // /nova-sessao (0038): o bot começa do zero — o histórico do prompt só leva o que veio depois do recomeço.
  const recomeco = conversa?.recomecoEm ?? null;
  const historico = !sessaoCli ? mensagens.filter((m) => recomeco === null || m.criadoEm > recomeco).slice(-HISTORICO_NO_PLANO).map((m) => ({ autor: autorDe(m), texto: m.texto.slice(0, 1000), confianca: m.confianca })) : [];
  // A sessão retomada não viu o que a conversa ganhou depois dela (rotina, colega, turno de outro harness):
  // entra aqui. A fala que disparou este turno e as que ele absorveu já vão na entrada (criadas depois dele).
  // Na sessão da cadeia, o que mudou desde ela (a decisão, a resposta do colega) já vem na entrada da retomada.
  const vistaAte = sessaoDaConversa ? conversa?.sessaoEm ?? null : null;
  const desdeSuaUltimaVez = vistaAte === null ? [] : mensagens
    .filter((m) => m.criadoEm > vistaAte && m.criadoEm < turno.criadoEm && m.id !== turno.mensagemOrigemId)
    .slice(-HISTORICO_NO_PLANO)
    .map((m) => ({ autor: autorDe(m), texto: m.texto.slice(0, TEXTO_DESDE_A_SESSAO), confianca: m.confianca }));
  const contextoConversa = JSON.stringify({ ...(original ? { tarefaOriginal: original.entradaTexto.slice(0, 8000) } : {}), historico, ...(desdeSuaUltimaVez.length ? { desdeSuaUltimaVez } : {}) });
  // revisto em 2026-10-01 (ADR-066): saíram o gate da rotina (E7.3/ADR-044) e a trava da rotina de quem pediu
  // (ADR-058). Quem decide quando o bot para e pergunta é o modo de aprovação, igual em toda origem.

  // Inventário para o modelo escolher SOBRE QUAL rotina agir (o estado vem computado por COLUNAS:
  // geração antiga do agente lê como 'pausada'). resumoCron traduz o cron para o texto humano.
  const rotinasDoAgente = (await deps.repos.rotinas.listarDoAgente(agente.id)).map((r) => ({
    id: r.id,
    resumo: resumoCron(r.cron, r.fusoIana),
    instrucao: r.instrucao,
    estado: r.estado,
  }));

  // definido em 2026-09-30 (ADR-064): a lista do que o bot deixou para depois entra quando alguém de fora da corrente
  // de colegas chamou o bot — a pessoa ou uma rotina (profundidade 0: conversa, criação, rotina e as retomadas
  // delas). É isso que "na próxima rotina ou conversa" quer dizer; no meio de um pedido de colega, ela não aparece.
  const comPendencias = turno.profundidade === 0 && (modo === "conversa" || modo === "criacao" || modo === "rotina");
  const pendencias = comPendencias ? pendenciasDoPrompt(await deps.repos.pendencias.abertasDoAgente(agente.id), agora) : [];

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

  // De quem é o trabalho e quem pediu (ADR-047/058): a pessoa vem de `sob_procuracao_de` da tarefa; o
  // remetente, do peer_pedido ligado a ela, lido direto pelo turno.
  const pedidoDelegado = delegacao ? await deps.repos.mensagens.pedidoDaTarefa(delegacao.id) : null;
  const sobProcuracaoDe = turno.sobProcuracaoDe ?? delegacao?.sobProcuracaoDe ?? null;
  const pessoaDelegante = sobProcuracaoDe && sobProcuracaoDe !== pessoa?.id ? await deps.repos.pessoas.buscar(sobProcuracaoDe) : pessoa;
  // Resolvido ANTES de montar: as nativas dependem de haver projeto autorizado E do modo/confiança (nativas.ts).
  const pastas = workspaceId ? await deps.services.workspaces?.pastasDoHarness({ ...deps.escopo, conversaId: turno.conversaId }) ?? null : null;
  // ADR-077: o apelido que a pessoa deu na entrevista do onboarding é o nome dela em todos os prompts. A ligação que o
  // produto iniciou com o onboarding em curso (a da guia) ganha as ferramentas e o roteiro do onboarding.
  const onb = await deps.repos.onboarding.buscar();
  const pessoaNome = onb.campos.apelido ?? pessoa?.nome ?? "a pessoa";
  const ligacaoDoTurno = modo === "ligacao" && turno.ligacaoId ? await deps.repos.ligacoes.buscar(turno.ligacaoId) : null;
  const onboarding = ligacaoDoTurno?.iniciadaPor === "produto" && onb.guiaId === agente.id && (onb.etapa === "chamando" || onb.etapa === "entrevista" || onb.etapa === "configurando");
  // definido em 2026-10-04: a guia no "auto" roda no mais potente do harness (MODELO_MAIS_POTENTE) no chat; um modelo
  // escolhido no perfil dela vale como em qualquer bot. revisto em 2026-10-05 (NOD-164): na ligação, não — ver abaixo.
  const guiaNoMaisPotente = onb.guiaId === agente.id && turno.modelo === "auto";
  const modeloEscolhido = escolha ? (guiaNoMaisPotente ? modeloMaisPotente(escolha.harness) : null) ?? escolha.modelo : null;
  const parcial = montarPlano({
    workspace: Boolean(deps.services.workspaces),
    workspaceVinculado: workspaceId !== null,
    computador: Boolean(deps.services.computadores),
    computadorFora,
    turno: { ...turno, sobProcuracaoDe, ...(modeloEscolhido ? { modelo: modeloEscolhido } : {}) },
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
    pessoaNome,
    colegas: visiveis.filter((a) => ehColega(agente, a)),
    rotinasDoAgente,
    onboarding,
    // ADR-042: a regra é gravada por (conector_id, capacidade) e o catálogo fala `${slug}__${tool}`.
    // Conector que sumiu do registro não vira nome nenhum, então a regra órfã simplesmente não casa.
    delegacao: ehDelegacao ? { pessoaNome: pessoaDelegante?.nome ?? "a pessoa", remetenteNome: visiveis.find((a) => a.id === pedidoDelegado?.autoria.autor_id)?.nome ?? "outro bot" } : null,
    semprePermitir: permissoes.flatMap((p) => {
      const slug = conectores.find((c) => c.id === p.conectorId)?.slug;
      return slug ? [`${slug}__${p.capacidade}`] : [];
    }),
    pendencias,
    pastasAutorizadas: pastas !== null,
    // ADR-052: o kit do terminal é do Claude Code real (o driver do Codex não tem hook do nod).
    // ADR-072: a ligação não tem terminal (fala com a pessoa ao vivo; trabalho pesado vai por iniciar_tarefa).
    terminal: modo !== "ligacao" && executor === "local" && (escolha ? escolha.harness === "claude-cli" : true),
    agora,
  });

  parcial.workspaceId = workspaceId;
  if (input.ghNaMaquina) {
    // O login do gh serve à dona: só o conector github DELA roda na máquina; o de outra pessoa, nunca.
    const meu = guardados.find((c) => c.slug === SLUG_GITHUB && c.comando === COMANDO_GITHUB_NATIVO && c.ownerId === deps.escopo.pessoaId);
    parcial.catalogo.ferramentas = marcarExecucaoNaMaquina(parcial.catalogo.ferramentas, meu?.id ?? null);
  }
  // definido em 2026-09-28: sem nativas o driver nem recebe as pastas — cwd temporário e `--tools ""`, também
  // num app desktop antigo que ainda decide as nativas só pela presença das pastas.
  parcial.workspacePastas = parcial.nativas?.length ? pastas : null;

  // ADR-072: o turno da ligação leva o que o laço de voz precisa (a ligação, o modelo rápido, o nome e o gênero da voz).
  if (modo === "ligacao") {
    const lig = ligacaoDoTurno;
    if (!lig || (lig.estado !== "chamando" && lig.estado !== "em_curso")) throw new ErroDeDominio("estado_invalido", { cause: "ligação do turno não está viva" });
    const base = { ligacaoId: lig.id, nomeBot: agente.nome, generoVoz: generoDaVoz(lig.voz) };
    // NOD-164 (2026-10-05): a guia no "auto" também — o mais potente fica no chat dela (modeloEscolhido, acima).
    parcial.ligacaoVoz = { ...base, ...modeloDeVoz(escolha?.harness ?? "claude-cli", input.modelosLigacao ?? MODELOS_LIGACAO_PADRAO) };
    // O prompt de voz (prompt-ligacao.ts) substitui o de texto: curto, falado, sem "Formatação:".
    parcial.promptSistema = montarPromptLigacao({
      nomeBot: agente.nome,
      generoVoz: generoDaVoz(lig.voz),
      titulo: agente.titulo,
      descricao: agente.descricao,
      pessoaNome,
      memorias,
      ultimasMensagens: mensagens.filter((m) => m.kind === "texto").slice(-MENSAGENS_NO_PROMPT_LIGACAO).map((m) => ({ autor: autorDe(m), texto: m.texto })),
      colegas: visiveis.filter((a) => ehColega(agente, a)).map((a) => ({ nome: a.nome, titulo: a.titulo })),
      apps: parcial.catalogo.servidores.map((s) => s.nome),
      modoAprovacao: agente.modoAprovacao ?? "manual",
      iniciarTarefa: parcial.catalogo.ferramentas.some((f) => f.nome === "iniciar_tarefa"),
      onboarding,
      ...(onboarding ? { roteiroOnboarding: linhasDoPromptOnboarding({ nomeGuia: agente.nome, campos: onb.campos, etapa: onb.etapa }) } : {}),
    });
  }

  const tokenDeTurno = deps.services.tokenTurno.cunhar(turno.id, { tenantId: deps.escopo.tenantId, pessoaId: deps.escopo.pessoaId, agenteId: agente.id });
  const plano: PlanoTurno = { ...parcial, ...(escolha ? { harness: escolha.harness } : {}), machineId: input.machineId, autoria: { ...parcial.autoria, machine_id: input.machineId }, tokenDeTurno };
  guardarPlanoSeSuportado(deps.services.tokenTurno, plano);
  // Modo dev (0036): o que este plano manda ao modelo, por parte. Os textos só com o modo dev da pessoa ligado.
  const { modoDev } = await deps.repos.preferencias.buscar();
  await deps.repos.raioX.gravarComposicao(turno.id, composicaoDoPlano(plano, { modo, comTexto: modoDev }));

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
