import type { AnexoMeta, TipoAnexo } from "../contracts/anexo.ts";
import { tipoDoAnexo } from "../domain/anexo.ts";
import type { CapacidadesHarness, IdHarness } from "../contracts/harness.ts";
import type { PlataformaMaquina } from "../contracts/ponte.ts";
import { capacidadesDe, causaHarnessIndisponivel, modeloMaisPotente, resolverHarness } from "../domain/harness.ts";
import { esperaDoTrabalho, pastaRelativa, podeAbrirTask } from "../domain/trabalho.ts";
import { formaEfetiva } from "../domain/frente.ts";
import { trabalhosParaDto } from "./trabalhos.ts";
import { randomUUID } from "node:crypto";
import { MODELOS_LIGACAO_PADRAO, type ModelosLigacao } from "../contracts/modelos.ts";
import { modeloDeVoz } from "../domain/modelo-ligacao.ts";
import { generoDaVoz } from "../domain/vozes.ts";
import { montarPromptLigacao, MENSAGENS_NO_PROMPT_LIGACAO } from "../domain/prompt-ligacao.ts";
import { linhasDoPromptOnboarding } from "../domain/roteiro-onboarding.ts";
import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { Inventario } from "../contracts/inventario.ts";
import { EXPERIMENTOS_DESLIGADOS } from "../contracts/raio-x.ts";
import type { ModoTurno, PlanoTurno } from "../contracts/plano-turno.ts";
import type { Conversa } from "../contracts/conversa.ts";
import type { Agente, EsforcoAgente } from "../contracts/agente.ts";
import type { EscolhasIa } from "../contracts/inteligencia.ts";
import { iasNoLimite, inteligenciaDoAgente, ordemCompleta, ordemEfetiva } from "../domain/inteligencia.ts";
import { contasPelaCota, cotaDasContas, cotaDasIasComContas, tipoParaCota } from "../domain/cota-da-ia.ts";
import { temSessaoNaIa } from "../domain/troca-de-ia.ts";
import type { Turno } from "../contracts/turno.ts";
import { MOTIVO_FALHA_EM_PORTUGUES } from "../domain/computador.ts";
import { COMANDO_GITHUB_NATIVO, SLUG_GITHUB } from "../contracts/github.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { ehNod } from "../domain/nod.ts";
import { marcarExecucaoNaMaquina } from "../domain/github.ts";
import { pendenciasDoPrompt } from "../domain/pendencia.ts";
import { PEDIDOS_NO_PROMPT } from "../domain/pedidos-pendentes.ts";
import { montarPlano, REGRA_MONTAGEM } from "../domain/plano-turno.ts";
import { anexosAnteriores, cortarFalas } from "../domain/historico-do-plano.ts";
import { composicaoDoPlano } from "../domain/raio-x.ts";
import type { ComputadorFora } from "../domain/prompt-sistema.ts";
import { resumoCron } from "../domain/rotina-texto.ts";
import type { TokenTurno } from "../services/token-turno.ts";
import type { Services } from "./tipos.ts";
import type { CasoDeUso } from "./tipos.ts";
import { delegacaoDoTurno, rotinaDoTurno } from "./apoio-l7.ts";
import { contaDoPlano, escolherContaDoTurno, lerContasDaMaquina } from "./contas-do-turno.ts";
import type { IaComConta } from "../contracts/contas-ia.ts";
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
  /** O "A fazer" ligado (NOD_PENDENCIAS=1, lido pelo compositor). Ausente = desligado: nem ferramentas nem lista. */
  aFazer?: boolean;
  /** ADR-082: NOD_GERIR_BOTS=0 desliga as ferramentas do Nod (o interruptor de rollback). Ausente = ligadas. */
  semFerramentasDoNod?: boolean;
  /** ADR-104: NOD_CRIAR_BOTS=0 tira criar_bots do catálogo. */
  semCriarBots?: boolean;
  /** ADR-090: nome e plataforma da máquina do turno, do anúncio dela (só no modo compartilhado). Ausente = Mac. */
  maquina?: { nome: string; plataforma: PlataformaMaquina } | null;
  /**
   * ADR-092: o turno roda numa máquina da ponte enquanto o servidor está no Mac (modo local). Os projetos autorizados são
   * pastas DO MAC e não existem lá: o plano sai sem workspace, como no modo compartilhado. Ausente = o turno roda no Mac.
   */
  maquinaRemota?: boolean;
  /**
   * ADR-103: as capacidades que a máquina do turno anunciou, por IA (só na ponte). O terminal do Codex só vai no plano
   * quando ela anunciou `terminal`: o app ou o motor de antes roda o Codex isolado, e o prompt prometeria o que ele não
   * dá. Ausente = o turno roda neste processo (o driver local decide e avisa o modelo, como no Claude sem o hook).
   */
  capacidadesDaMaquina?: Partial<Record<IdHarness, CapacidadesHarness>>;
  /**
   * ADR-107 (NOD-281): o turno roda numa máquina da ponte. A sessão só é retomada se nasceu NESTA máquina (a sessão sem
   * máquina gravada, de antes da 0079, não). Ausente = o Mac do modo local: a máquina da sessão não é conferida.
   */
  sessaoPorMaquina?: boolean;
  /**
   * definido em 2026-10-12 (NOD-214): RECOMPÕE o plano de um turno que a máquina continuou rodando durante o reinício do
   * servidor (a adoção). Mesmo caminho do despacho — catálogo e concessões lidos AGORA —, mas com o token que a máquina
   * já tem (nenhum token novo), a IA que o despacho escolheu e sem efeito: não regrava o executor, não grava o raio-x nem
   * o evento turno_despachado (o turno já foi despachado).
   */
  recompor?: { tokenDeTurno: string; harness: IdHarness | null };
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
  // NOD-206 (#200): o executor real só é decidido aqui. Quem enfileira grava um palpite (o pedido de colega e a retomada
  // nasciam `catcher` por padrão) e a retomada da cadeia compara com ele para decidir o --resume: grava o que vale.
  if (!input.recompor && turno.executor !== executor) await deps.repos.turnos.registrarExecutor(turno.id, executor);
  // 0068 (emenda da ADR-036): a ordem do bot (ou da pessoa), as IAs no limite e o modelo/raciocínio escolhidos por IA.
  const preferencias = await deps.repos.preferencias.buscar();
  const inteligencia = inteligenciaDoAgente(agente);
  // definido em 2026-10-12 (ADR-099 §7): no trabalho de fundo, o Automático também pula a IA que a cota segura (reserva ou
  // limite) — o 1% que sobra dela fica para a conversa com a pessoa. Todas seguradas: a primeira pronta (iaDoAutomatico).
  const fundo = !input.recompor && executor !== "catcher" && input.harnesses && turno.harness === "auto" && turno.modelo === "auto" && tipoParaCota(turno, null) !== "conversa";
  // ADR-108 (revisão do PR 2, C1): a IA da sessão da task não entra aqui — trocar de IA por cota é decisão da pessoa (o
  // aviso de troca). Se a cota a segura de verdade (o limite medido segura o fundo que já começou), a guarda do despacho
  // (despachar-turno.ts, segurarTaskNaIaDaSessao) já devolveu o turno à espera; na reserva, a task que já começou segue nela.
  const daSessao = fundo && turno.trabalhoId ? await deps.repos.trabalhos.buscar(turno.trabalhoId) : null;
  // ADR-102 (2026-10-13): a conta do turno, pela lista da pessoa e pelo que a máquina do turno tem logado. Com conta
  // anunciada na máquina, a posição da conta em uso de cada IA decide a ordem, e a IA sem conta utilizável entra no
  // "no limite" (o limite é da conta, não mais da IA); sem conta anunciada (motor ou app antigo), nada muda.
  const lidas = executor !== "catcher" && input.harnesses && (await deps.repos.contasIa.temContaNaMaquina(input.machineId)) ? await lerContasDaMaquina(deps, input.machineId) : null;
  // NOD-253 (2026-10-15): no trabalho de fundo, a conta que a cota dela segura (a leitura por conta, 0077) conta como no
  // limite — o plano vai pela outra conta livre da mesma IA, a mesma regra do portão (cotaDasIasComContas).
  const deFundo = !input.recompor && tipoParaCota(turno, null) !== "conversa";
  const usosPorConta = lidas && deFundo ? await deps.repos.usoDoPlano.listarPorConta() : [];
  const daMaquina = lidas && deFundo ? { ...lidas, contas: contasPelaCota(lidas.contas, cotaDasContas({ usos: usosPorConta, agora }), "fundo_seguindo") } : lidas;
  const pelaCota = fundo ? cotaDasIasComContas({ usos: await deps.repos.usoDoPlano.listar(), usosPorConta, limites: preferencias.iasNoLimite, contas: lidas, agora }).map((c) => c.ia).filter((ia) => !temSessaoNaIa(daSessao, ia)) : [];
  const contas = daMaquina ? escolherContaDoTurno(daMaquina, inteligencia.ordem, agora) : null;
  const governadas = (ia: IdHarness) => contas !== null && ia in contas.porIa;
  // NOD-285 (K1): os anexos que existem (o arquivo limpo do disco não tem meta e não filtra) decidem quais IAs servem.
  const metasDosAnexos = await deps.repos.anexos.metas(turno.entradaAnexos);
  const escolha = executor !== "catcher" && input.harnesses
    ? escolherHarness(turno, input.harnesses, {
      tiposDeAnexo: metasDosAnexos.map((a) => tipoDoAnexo(a.mime)),
      ordem: contas
        ? ordemCompleta([...(input.harnessPreferido ? [input.harnessPreferido] : []), ...contas.ordemIas, ...ordemEfetiva({ doBot: inteligencia.ordem, daPessoa: preferencias.ordemIas ?? null })])
        : ordemEfetiva({ doBot: inteligencia.ordem, daPessoa: preferencias.ordemIas ?? null, preferido: input.harnessPreferido }),
      noLimite: [...new Set([...(contas?.iasSemConta ?? []), ...iasNoLimite(preferencias.iasNoLimite, agora).filter((ia) => !governadas(ia)), ...pelaCota])],
      escolhas: inteligencia.escolhas,
    })
    : null;
  // A adoção (NOD-214) recompõe com a conta que o despacho já gravou; o despacho grava a escolhida agora.
  // Revisão do PR #306: a gravada só vale se for da IA que a recomposição escolheu agora; senão, a da lista para essa IA
  // (o plano nunca sai com o harness de uma IA e a conta de outra).
  const daLista = escolha && contas ? (contas.porIa[escolha.harness as IaComConta] ?? null) : null;
  const gravada = input.recompor ? await (async () => { const id = await deps.repos.turnos.contaDoTurno(turno.id); return id ? await deps.repos.contasIa.buscar(id) : null; })() : null;
  const conta = gravada && escolha && gravada.ia === escolha.harness ? gravada : daLista;
  // A coluna nasce nula: só grava quando há conta (o caso comum hoje não paga a escrita na tabela mais quente).
  // ADR-107 (NOD-281): o despacho com IA escolhida grava a IA efetiva e a conta juntas (a retomada da cadeia compara as duas).
  if (!input.recompor && escolha) await deps.repos.turnos.registrarIa(turno.id, escolha.harness, conta?.id ?? null);
  else if (conta && conta.id !== gravada?.id) await deps.repos.turnos.registrarConta(turno.id, conta.id);
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
  // revisto em 2026-10-07 (ADR-083, S3): quem retoma sessão é a capacidade do harness, nunca o nome dele. Sem escolha
  // (catcher, plano de antes dos harnesses) vale como antes.
  const caps = escolha ? capacidadesDe(escolha.harness) : null;
  // ADR-107 (NOD-281): na ponte, a máquina diz se o driver dela retoma (o Codex só com o app-server). Sem anúncio daquela
  // IA, o Codex não retoma (motor de antes) e o Claude segue retomando.
  const retomaNaMaquina = !escolha || input.capacidadesDaMaquina === undefined || (input.capacidadesDaMaquina[escolha.harness]?.retomaSessao ?? escolha.harness !== "codex-cli");
  const retoma = (caps ? caps.retomaSessao : true) && retomaNaMaquina;
  // definido em 2026-10-07 (ADR-083): o turno de um trabalho roda na sessão DO TRABALHO, nunca na da conversa nem na da
  // cadeia (a retomada dele herda o trabalho). Sem `retomaSessao`, recebe o histórico recente, como o Codex hoje.
  const trabalho = turno.trabalhoId ? await deps.repos.trabalhos.buscar(turno.trabalhoId) : null;
  // revisto em 2026-10-08 (revisão do épico, S14): e só para o executor que criou a sessão, como a da conversa (0005) — a
  // sessão do catcher não existe no CLI real, e a do CLI real não serve ao catcher.
  // ADR-102 (R1 da revisão): a sessão do Codex mora na pasta da conta (CODEX_HOME); com outra conta, não há o que retomar.
  // O Claude compartilha `projects/` entre as contas (contas-mac.ts), então retoma em qualquer uma.
  // revisto em 2026-10-15 (ADR-107, NOD-281): igualdade estrita — a sessão criada na pasta padrão também não existe na
  // pasta de uma conta, e vice-versa.
  const mesmaConta = (gravada: string | null) => escolha?.harness !== "codex-cli" || (gravada ?? null) === (conta?.id ?? null);
  // ADR-107 (NOD-281): na ponte, a sessão mora no disco da máquina onde nasceu; em outra, o resume falhava ("sessão
  // rejeitada") e o bot perdia a mensagem. Só retoma a sessão gravada NESTA máquina (a sem máquina, de antes da 0079, não).
  // No Mac do modo local, como antes; a sessão de uma VM recusada ali cai no reenvio sem resume (assentar-turno).
  const mesmaMaquina = (gravada: string | null) => input.sessaoPorMaquina !== true || gravada === input.machineId;
  const ondeOk = async (contaGravada: () => Promise<string | null>, maquinaGravada: () => Promise<string | null>) => mesmaConta(await contaGravada()) && mesmaMaquina(await maquinaGravada());
  const contaDoTrabalhoOk = trabalho?.sessaoCli ? await ondeOk(() => deps.repos.trabalhos.contaDaSessao(trabalho.id), () => deps.repos.trabalhos.maquinaDaSessao(trabalho.id)) : true;
  const contaDaConversaOk = conversa?.sessaoCli ? await ondeOk(() => deps.repos.conversas.contaDaSessao(turno.conversaId), () => deps.repos.conversas.maquinaDaSessao(turno.conversaId)) : true;
  const sessaoDoTrabalho = trabalho && retoma && contaDoTrabalhoOk && input.permitirResume !== false && trabalho.sessaoCli && trabalho.sessaoExecutor === executor && (!escolha || trabalho.sessaoHarness === null || trabalho.sessaoHarness === escolha.harness) ? trabalho.sessaoCli : null;
  const sessaoDoHarness = (escolha ? retoma && conversa?.sessaoHarness === escolha.harness : true) && contaDaConversaOk;
  const sessaoDaConversa = !trabalho && sessaoDoHarness && input.permitirResume !== false && turno.origem !== "rotina" && turno.origem !== "peer" && turno.origem !== "ligacao" && ligacao === null && !ehDelegacao && conversa?.tipo !== "sala" && conversa?.sessaoCli && conversa.sessaoExecutor === executor ? conversa.sessaoCli : null;
  // definido em 2026-10-01 (ADR-066): a retomada de rotina ou de pedido de colega volta na sessão DO TURNO que ela
  // continua (nunca na da conversa, pelos motivos acima). Antes ela começava do zero: em 30/09 o Milton, retomado 13
  // min depois de uma aprovação cujo comentário falhou, leu a task, chamou sem_novidade e não refez nem avisou. Com o
  // terminal fora da conversa, a sessão é o que guarda os arquivos mexidos e o resultado dos testes.
  const continuaCadeia = !trabalho && !sessaoDaConversa && turno.origem === "retomada" && turno.retomaTurnoId !== null && (ligacao !== null || ehDelegacao) && input.permitirResume !== false && retoma;
  const daCadeia = continuaCadeia && turno.retomaTurnoId ? await deps.repos.turnos.sessaoDoTurno(turno.retomaTurnoId) : null;
  // ADR-107 (NOD-281): a cadeia só retoma na mesma IA (a do Codex não existe no Claude), na mesma conta e na mesma máquina.
  // Sem a IA gravada (turno de antes da 0079), como antes.
  const sessaoDaCadeia = daCadeia && daCadeia.executor === executor && (daCadeia.harness === null || !escolha || daCadeia.harness === escolha.harness)
    && mesmaConta(daCadeia.contaId) && mesmaMaquina(daCadeia.machineId) ? daCadeia.sessaoCli : null;
  const sessaoCli = sessaoDoTrabalho ?? sessaoDaConversa ?? sessaoDaCadeia;
  // A rede de 2 min (ADR-083 §2, #193): a sessão da conversa ficou com o trabalho promovido, que segue nela. A próxima
  // mensagem continua numa CÓPIA (`--fork-session` no Claude) e o id novo vira a sessão da conversa. Só com harness que
  // bifurca: sem isso a rede nunca promove, e esta busca não acha nada.
  const bifurcar = sessaoDaConversa !== null && (caps ? caps.bifurcaSessao : true) && (await deps.repos.trabalhos.redeComSessao(turno.conversaId, sessaoDaConversa)) !== null;
  const autorDe = (m: (typeof mensagens)[number]) => (m.autoria.autor_tipo === "pessoa" ? "pessoa" : visiveis.find((a) => a.id === m.autoria.autor_id)?.nome ?? "bot");
  // /nova-sessao (0038): o bot começa do zero — o histórico do prompt só leva o que veio depois do recomeço.
  const recomeco = conversa?.recomecoEm ?? null;
  // definido em 2026-10-12 (ADR-099, I2): a frente sem sessão recebe o histórico DELA (as falas dos turnos dela e os
  // recados), nunca o da conversa do dono — no Codex a frente via a conversa com a pessoa. A task de antes segue igual.
  // revisto em 2026-10-12 (ADR-099, I10): a task de antes, migrada pela 0072 sem lote, segue com o histórico de antes.
  const doHistorico = !sessaoCli && formaEfetiva(trabalho) === "frente" ? await deps.repos.mensagens.doTrabalho(trabalho!.id, MENSAGENS_DO_PLANO) : mensagens;
  // NOD-285 (K2): sem sessão, o modelo só sabe que uma fala trazia arquivo pelo histórico — a fala ganha "[anexou X]".
  // Com sessão, ela já viu o arquivo no turno dele; o histórico nem vai. Só a fala da pessoa: a captura de tela que o
  // bot anexa à própria fala (NOD-200) não volta ao modelo nem pelo nome.
  const janela = !sessaoCli ? doHistorico.filter((m) => recomeco === null || m.criadoEm > recomeco).slice(-HISTORICO_NO_PLANO) : [];
  const daPessoa = janela.filter((m) => m.autoria.autor_tipo === "pessoa").map((m) => m.id);
  const anexosDaJanela = daPessoa.length ? await deps.repos.anexos.daMensagens(daPessoa) : new Map<string, AnexoMeta[]>();
  // ADR-111: a chave "Memória longa" da pessoa (0088) — as falas recentes até 8 mil caracteres e os anexos anteriores.
  // Só no turno sem sessão (a janela vazia não muda nada) e fora da ligação, que tem o próprio histórico curto.
  const experimentos = preferencias.experimentos ?? EXPERIMENTOS_DESLIGADOS;
  const memoriaLonga = experimentos.memoriaLonga && modo !== "ligacao";
  // ADR-112: a chave "Modo WhatsApp" (0089) — só o prompt de texto; a ligação tem o próprio prompt, que não muda.
  const whatsapp = experimentos.whatsapp && modo !== "ligacao";
  const cortes = cortarFalas(janela.map((m) => m.texto), memoriaLonga);
  const comAnexo = (m: (typeof janela)[number], i: number) => {
    const nomes = (anexosDaJanela.get(m.id) ?? []).map((a) => a.nome);
    return nomes.length ? `${cortes[i]} [anexou ${nomes.join(", ")}]` : (cortes[i] ?? "");
  };
  const historico = janela.map((m, i) => ({ autor: autorDe(m), texto: comAnexo(m, i), confianca: m.confianca }));
  const anteriores = memoriaLonga ? anexosAnteriores({ falas: daPessoa, anexosPorFala: anexosDaJanela, jaNoTurno: turno.entradaAnexos, harness: escolha?.harness ?? null }) : [];
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
  const comPendencias = input.aFazer === true && turno.profundidade === 0 && (modo === "conversa" || modo === "criacao" || modo === "rotina");
  const pendencias = comPendencias ? pendenciasDoPrompt(await deps.repos.pendencias.abertasDoAgente(agente.id), agora) : [];

  // ADR-083 (#193): a conversa coordenadora vê as tasks abertas do bot (com o último passo), a cada turno.
  // revisto em 2026-10-08 (revisão do épico, S12): a task de rotina que pode abrir outras também (a mãe, nunca a filha).
  // revisto em 2026-10-12 (ADR-099, parte 1): a task que só espera (volta marcada, colega) vai como "esperando", não
  // "rodando" — em 11/10 o orquestrador via 13 tasks rodando com uma trabalhando e empilhava mais.
  // revisto em 2026-10-12 (ADR-099 item 1a, I7 revista): a triagem do pedido de colega ou de rotina (fora de trabalho)
  // também — é olhando o que está em andamento que o dono decide começar, juntar ou esperar.
  const trabalhosAbertos = podeAbrirTask(trabalho) && (trabalho ? modo === "rotina" : modo === "conversa" || modo === "criacao" || modo === "rotina" || modo === "delegacao") ? (await trabalhosParaDto(deps, await deps.repos.trabalhos.abertosDoAgente(agente.id))).map((t) => ({ id: t.id, titulo: t.titulo, estado: esperaDoTrabalho(t) ? "esperando" : t.estado, ultimoPasso: t.ultimoPasso, ...(t.deFora ? { cuidado: true } : {}) })) : [];

  // NOD-262: na conversa e na sala, os pedidos de colegas ainda na fila do bot — com eles o bot fecha com responder_pedido
  // o que a pessoa já resolveu ali. A pergunta é a tarefa do peer_pedido (o texto do remetente), cortada no domínio.
  const pedidosPendentes = modo === "conversa" || modo === "sala"
    ? await Promise.all((await deps.repos.turnos.delegacoesPendentesDoAgente(agente.id, PEDIDOS_NO_PROMPT + 15)).map(async (d) => {
      const pedido = await deps.repos.mensagens.pedidoDaTarefa(d.id);
      const tarefa = pedido?.payload?.kind === "peer_pedido" ? pedido.payload.delegacao?.tarefa : undefined;
      return { tarefaId: d.id, remetenteNome: visiveis.find((a) => a.id === pedido?.autoria.autor_id)?.nome ?? "outro bot", pergunta: tarefa ?? pedido?.texto ?? d.entradaTexto };
    }))
    : [];

  // Resolvido ANTES de montar: o catálogo depende de haver projeto autorizado, não só do serviço.
  const workspaceId = input.maquinaRemota ? null : await deps.services.workspaces?.id({ ...deps.escopo, conversaId: turno.conversaId }) ?? null;

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
  // revisto em 2026-10-07 (ADR-081): o Nod é a guia — ele no "auto" roda no mais potente, com ou sem onboarding.
  // revisto em 2026-10-10 (0068): o modelo escolhido para a IA na inteligência do Nod também vale (é escolha, não o padrão).
  const guiaNoMaisPotente = (ehNod(agente) || onb.guiaId === agente.id) && turno.modelo === "auto" && !(escolha && inteligencia.escolhas[escolha.harness]?.modelo);
  const modeloEscolhido = escolha ? (guiaNoMaisPotente ? modeloMaisPotente(escolha.harness) : null) ?? escolha.modelo : null;
  const parcial = montarPlano({
    workspace: Boolean(deps.services.workspaces),
    workspaceVinculado: workspaceId !== null,
    computador: Boolean(deps.services.computadores),
    computadorFora,
    turno: { ...turno, sobProcuracaoDe, ...(modeloEscolhido ? { modelo: modeloEscolhido } : {}) },
    agente,
    ...(escolha?.raciocinio ? { raciocinio: escolha.raciocinio } : {}),
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
    anexos: [...metasDosAnexos, ...anteriores],
    ...(experimentos.calibracao ? { calibracao: true } : {}),
    ...(whatsapp ? { whatsapp: true } : {}),
    contextoConversa,
    pessoaNome,
    maquina: input.maquina ?? null,
    colegas: visiveis.filter((a) => ehColega(agente, a)),
    rotinasDoAgente,
    onboarding,
    // ADR-042: a regra é gravada por (conector_id, capacidade) e o catálogo fala `${slug}__${tool}`.
    // Conector que sumiu do registro não vira nome nenhum, então a regra órfã simplesmente não casa.
    // ADR-099 (I7 revista): a frente aberta na triagem de um pedido de colega não tem o peer_pedido; quem pediu é o dela.
    delegacao: ehDelegacao ? { pessoaNome: pessoaDelegante?.nome ?? "a pessoa", remetenteNome: visiveis.find((a) => a.id === (pedidoDelegado?.autoria.autor_id ?? trabalho?.pedidoPorAgenteId))?.nome ?? "outro bot" } : null,
    semprePermitir: permissoes.flatMap((p) => {
      const slug = conectores.find((c) => c.id === p.conectorId)?.slug;
      return slug ? [`${slug}__${p.capacidade}`] : [];
    }),
    pendencias,
    aFazer: input.aFazer === true,
    semFerramentasDoNod: input.semFerramentasDoNod === true,
    semCriarBots: input.semCriarBots === true,
    pastasAutorizadas: pastas !== null,
    // ADR-052: o kit do terminal é do Claude Code real (o driver do Codex não tem hook do nod).
    // ADR-072: a ligação não tem terminal (fala com a pessoa ao vivo; trabalho pesado vai por iniciar_tarefa).
    // revisto em 2026-10-07 (ADR-083, S3): pela capacidade `terminal`, não pelo nome do harness.
    // ADR-103: no Codex, só com a máquina que anunciou o terminal (o app/motor com o hook do Codex).
    terminal: modo !== "ligacao" && executor === "local" && (caps ? caps.terminal : true) && (escolha?.harness !== "codex-cli" || input.capacidadesDaMaquina === undefined || input.capacidadesDaMaquina["codex-cli"]?.terminal === true),
    // ADR-083: o trabalho tem pasta própria dentro da do bot (`~/nod/<bot>/<slug>`); null = a pasta do bot.
    pastaTrabalho: trabalho?.pasta ? pastaRelativa(trabalho.pasta) : null,
    trabalho: trabalho ? { titulo: trabalho.titulo, origem: trabalho.origem, trabalhoMaeId: trabalho.trabalhoMaeId, forma: formaEfetiva(trabalho) } : null,
    trabalhosAbertos,
    pedidosPendentes,
    harness: escolha?.harness ?? null,
    agora,
  });

  parcial.workspaceId = workspaceId;
  if (bifurcar) parcial.entrada = { ...parcial.entrada, bifurcar: true };
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
    // O prompt de voz (prompt-ligacao.ts) substitui o de texto: curto, falado, sem "Formatação:". As partes do de texto
    // (NOD-183) saem junto: o de voz já traz o próprio marcador.
    delete parcial.promptSistemaPartes;
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

  const tokenDeTurno = input.recompor?.tokenDeTurno ?? deps.services.tokenTurno.cunhar(turno.id, { tenantId: deps.escopo.tenantId, pessoaId: deps.escopo.pessoaId, agenteId: agente.id });
  const plano: PlanoTurno = { ...parcial, ...(escolha ? { harness: escolha.harness } : {}), ...(conta ? { conta: contaDoPlano(conta) } : {}), machineId: input.machineId, autoria: { ...parcial.autoria, machine_id: input.machineId }, tokenDeTurno };
  // NOD-214: o recomposto é guardado por quem pediu (tokenTurno.planoOuRecompor), e só se o token ainda for o mesmo.
  if (input.recompor) return { data: plano, events: [] };
  // NOD-291 (0084): o turno roda numa CÓPIA da sessão da conversa — o total que o CLI devolver traz o histórico da mãe,
  // e o assentar desconta o total dela (turnos.totalAnteriorDaSessao). Grava de onde a cópia saiu.
  if (bifurcar && sessaoDaConversa) await deps.repos.turnos.registrarSessaoOrigem(turno.id, sessaoDaConversa);
  guardarPlanoSeSuportado(deps.services.tokenTurno, plano);
  // Modo dev (0036): o que este plano manda ao modelo, por parte. Os textos só com o modo dev da pessoa ligado.
  const { modoDev } = preferencias;
  await deps.repos.raioX.gravarComposicao(turno.id, composicaoDoPlano(plano, { modo, comTexto: modoDev, experimentos: { calibracao: experimentos.calibracao, memoriaLonga, whatsapp, anexosAnteriores: anteriores.length } }));

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
      // NOD-276 (J3): a hora do despacho; a web conta "Trabalhando · há N" daqui (pelo próprio relógio, ao ver o frame).
      despachadoEm: turno.despachadoEm ?? agora,
      // ADR-083: o frame turno.iniciado diz de que trabalho é o turno (a web põe o ao vivo na task, não no chat).
      trabalhoId: turno.trabalhoId ?? null,
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

/** NOD-171: a recusa leva o inventário do harness que faltou, para a negação falar dele e não do motor. */
function escolherHarness(turno: Turno, harnesses: Partial<Record<IdHarness, Inventario>>, ia: { ordem: IdHarness[]; noLimite: IdHarness[]; escolhas: EscolhasIa; tiposDeAnexo: TipoAnexo[] }): { harness: IdHarness; modelo: string; raciocinio?: EsforcoAgente } {
  try {
    return resolverHarness({ harness: turno.harness, modelo: turno.modelo, prontos: (Object.keys(harnesses) as IdHarness[]).filter((id) => harnesses[id]?.estado === "pronto"), ...ia });
  } catch (e) {
    const causa = causaHarnessIndisponivel(e);
    const inventario = causa ? harnesses[causa.harness] : undefined;
    if (causa && inventario) throw new ErroDeDominio("executor_indisponivel", { cause: { ...causa, inventario } });
    throw e;
  }
}
