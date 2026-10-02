import type { AnexoMeta } from "../contracts/anexo.ts";
import { traduzirParaOCli } from "./comandos.ts";
import type { Agente } from "../contracts/agente.ts";
import type { Concessao } from "../contracts/concessao.ts";
import type { Conector } from "../contracts/conector.ts";
import type { Autoria, Executor } from "../contracts/evento.ts";
import { FERRAMENTAS_NOD, type NomeFerramentaNod } from "../contracts/ferramentas-nod.ts";
import type { Inventario } from "../contracts/inventario.ts";
import type { Memoria } from "../contracts/memoria.ts";
import type { Confianca } from "../contracts/mensagem.ts";
import type { Pendencia } from "../contracts/pendencia.ts";
import type { FerramentaPlano, ModoTurno, PlanoTurno, ServidorPlano } from "../contracts/plano-turno.ts";
import type { Profundidade, Turno } from "../contracts/turno.ts";
import { ORCAMENTO_RESULTADO_CHARS } from "../shared/constantes.ts";
import { nuncaPermanente } from "./aprovacao-permanente.ts";
import { conectorTocaDadoPessoal } from "./dado-pessoal.ts";
import { ErroDeDominio } from "./erro.ts";
import { comArquivoDoMac } from "./arquivo-do-mac.ts";
import { resolverLocalidade } from "./localidade-turno.ts";
import { montarFerramentas } from "./montagem-ferramentas.ts";
import { motivoSemTerminal, nativasDoTurno, pastaDoBot } from "./nativas.ts";
import { montarPromptSistema, type RotinaNoPrompt } from "./prompt-sistema.ts";
import { FERRAMENTAS_COMPUTADOR } from "../contracts/ferramentas-computador.ts";
import { FERRAMENTA_LER_MAIS } from "../contracts/ferramentas-proxy.ts";
import type { ComputadorFora } from "./prompt-sistema.ts";
import { FERRAMENTAS_WORKSPACE } from "../contracts/ferramentas-workspace.ts";

/**
 * Ferramentas nod por modo (definido em 2026-09-16): conversa e sala têm o kit completo; rotina
 * pede a colega (definido em 2026-09-17; pedir_a_bot desde 2026-09-29, ADR-058) e encerra em silêncio por sem_novidade
 * (definido em 2026-09-21 — só faz sentido onde ninguém está esperando resposta, por isso não entra
 * em conversa nem em sala); peer é texto-só, sem salto (E12.4). pedir_a_pessoa (EMENDA 16) entra
 * onde há pessoa para destravar: criação, conversa, sala e rotina — não em peer (o remetente é outro bot).
 *
 * Criação (revisto em 2026-09-28, ADR-050, "bot novo é bot completo"): é o kit da conversa MAIS
 * atualizar_perfil. Antes eram só quatro ferramentas, e a Tarsila, pedida para assumir o que três
 * colegas faziam, respondeu "não consigo" cinco vezes — não via os colegas, não perguntava, não
 * delegava. Perfil vazio não é trava de capacidade: é uma linha no prompt (prompt-sistema.ts).
 * ver_colegas (ADR-050) entra onde a pessoa está: criação, conversa e sala.
 *
 * pedir_acesso entra na rotina desde 2026-09-24 (ADR-044): ele só PROPÕE — quem decide é a pessoa,
 * num botão —, e sem ele a rotina sem acesso pedia por pedir_a_pessoa em texto a cada execução. No
 * turno de rotina o domínio só aceita leitura (pedido-acesso.ts).
 *
 * Ciclo de vida de rotina (listar/pausar/reativar, definido em 2026-09-21) só em conversa e sala,
 * onde a pessoa está presente para pedir e conferir — e, desde a ADR-050, na criação, pelo mesmo motivo.
 * FORA de propósito em: peer (quem fala é outro bot,
 * e mexer em rotina por pedido de bot burlaria o corte de segundo salto do ADR-035) e rotina — este
 * é o caso perigoso: um turno acordado por agendamento que pudesse se pausar sozinho viraria uma
 * rotina que se desliga por conta própria, e o modo rotina já é explicitamente "a própria execução",
 * não a hora de reconfigurar. Quem reconfigura é a pessoa, na conversa.
 *
 * delegacao (definido em 2026-09-24, ADR-047; revisto em 2026-09-29, ADR-058): o turno de quem cumpre um
 * pedido de colega (pedir_a_bot), com os acessos dele. Tem pedir_acesso (inclusive escrita) e os caminhos
 * de aprovação; não tem rotina. pedir_a_bot entra em todo modo em que um bot trabalha para a pessoa: criação,
 * conversa, sala e rotina — e, desde 2026-09-30 (ADR-063), também na delegação: o Chico, pedido pela Clarice a
 * acionar os Devs, não tinha como. Quem corta o salto é a profundidade (montarFerramentas), não o modo.
 * peer é legado (perguntar_a_bot saiu na ADR-058).
 *
 * publicar_artefato/ler_artefato (definido em 2026-09-28, ADR-051) entram onde o bot fala com UMA pessoa
 * na conversa dele: conversa e rotina — e a retomada, que cai num dos dois (modoDoTurno). Fora da sala
 * (o estado é por pessoa e a sala tem várias; a RLS do artefato não tem perna de sala), da criação, do
 * peer (quem lê é outro bot) e da delegação (o resultado volta ao remetente, não à pessoa).
 *
 * revisto em 2026-10-01 (ADR-066, "o bot tem o que você deu; o modo decide"): rotina e delegação ganham ver_colegas
 * (leitura confiável que "não incomoda ninguém"), e a delegação, o artefato — o turno dela roda na conversa própria
 * de quem recebe, onde o artefato aparece. Criar e mudar rotina continuam fora da rotina e da delegação: a rotina
 * zera a corrente (ADR-063), e isso lavaria o limite de passes.
 *
 * Pendências (definido em 2026-09-30, ADR-064): anotar_pendencia entra em todo modo em que o bot trabalha —
 * criação, conversa, sala, rotina e delegação —, inclusive no limite da corrente de colegas, que é justamente
 * quando algo fica para depois. concluir/descartar_pendencia entram onde a lista aparece: conversa, criação e
 * rotina (emitir-plano-turno.ts só a manda em profundidade 0).
 */
export const FERRAMENTAS_NOD_POR_MODO: Record<ModoTurno, readonly NomeFerramentaNod[]> = {
  criacao: ["atualizar_perfil", "lembrar", "pedir_aprovacao", "pedir_acesso", "criar_rotina", "listar_rotinas", "pausar_rotina", "reativar_rotina", "atualizar_rotina", "excluir_rotina", "ver_colegas", "pedir_a_bot", "pedir_a_pessoa", "publicar_artefato", "ler_artefato", "anotar_pendencia", "concluir_pendencia", "descartar_pendencia"],
  conversa: ["lembrar", "pedir_aprovacao", "pedir_acesso", "criar_rotina", "listar_rotinas", "pausar_rotina", "reativar_rotina", "atualizar_rotina", "excluir_rotina", "ver_colegas", "pedir_a_bot", "pedir_a_pessoa", "publicar_artefato", "ler_artefato", "anotar_pendencia", "concluir_pendencia", "descartar_pendencia"],
  sala: ["lembrar", "pedir_aprovacao", "pedir_acesso", "criar_rotina", "listar_rotinas", "pausar_rotina", "reativar_rotina", "atualizar_rotina", "excluir_rotina", "ver_colegas", "pedir_a_bot", "pedir_a_pessoa", "passar", "encaminhar", "anotar_pendencia"],
  rotina: ["lembrar", "pedir_aprovacao", "pedir_acesso", "ver_colegas", "pedir_a_pessoa", "pedir_a_bot", "sem_novidade", "publicar_artefato", "ler_artefato", "anotar_pendencia", "concluir_pendencia", "descartar_pendencia"],
  peer: ["lembrar"],
  delegacao: ["lembrar", "pedir_acesso", "pedir_aprovacao", "ver_colegas", "pedir_a_pessoa", "pedir_a_bot", "publicar_artefato", "ler_artefato", "anotar_pendencia"],
};

/**
 * revisto em 2026-10-01 (ADR-067): o plano vale enquanto o turno vive. Era 1 h (a janela do cache ephemeral_1h do CLI,
 * 2026-09-16) — e um turno de testes, CI ou QA que passava de uma hora ficava sem nenhuma ferramenta. Quem encerra o
 * plano é o fim do turno: a entrega revoga o token, o Parar e a exclusão do agente negam a chamada (execucaoBloqueada,
 * paradas) e o lease vencido assenta o turno. O campo `expiraEm` continua no contrato, com este valor.
 */
export const PLANO_SEM_VALIDADE = Number.MAX_SAFE_INTEGER;

export const REGRA_MONTAGEM = "regra:montagem-ferramentas" as const;

function ferramentaNod(nome: NomeFerramentaNod): FerramentaPlano {
  const base: FerramentaPlano = { nome, nomeMcp: `mcp__nod__${nome}`, origem: "nod", conectorId: null, readOnlyHint: false, tocaDadoPessoal: false, schema: FERRAMENTAS_NOD[nome] };
  // definido em 2026-09-28 (ADR-051): ler_artefato só lê, e o resultado dela tem orçamento próprio no
  // proxy — o do turno (8 000) cortaria o HTML que a ferramenta promete devolver.
  return nome === "ler_artefato" ? { ...base, readOnlyHint: true } : base;
}

/** conector habilitado ∩ concessão do agente por capacidade → `${slug}__${tool}` (E6). */
function ferramentasDeConectores(conectores: readonly Conector[], concessoes: readonly Concessao[], agenteId: string): { ferramentas: FerramentaPlano[]; servidores: ServidorPlano[] } {
  const ferramentas: FerramentaPlano[] = [];
  const servidores: ServidorPlano[] = [];
  for (const c of conectores) {
    if (!c.habilitado) continue;
    const minhas = concessoes.filter((g) => g.agenteId === agenteId && g.conectorId === c.id).map((g) => g.capacidade);
    const caps = c.catalogo.filter((cap) => minhas.includes(cap.nome));
    if (caps.length === 0) continue;
    // definido em 2026-09-16: todo conteúdo de conector é não confiável (ADR-026), logo o servidor é 'untrusted' sempre
    servidores.push({ conectorId: c.id, nome: c.slug, trust: "untrusted", transporte: c.transporte });
    for (const cap of caps) {
      const nome = `${c.slug}__${cap.nome}`;
      // ADR-068: o campo de arquivo do app (`s3key`) diz ao bot que aceita o caminho do Mac.
      ferramentas.push({ nome, nomeMcp: `mcp__nod__${nome}`, origem: "conector", conectorId: c.id, readOnlyHint: cap.readOnlyHint, tocaDadoPessoal: conectorTocaDadoPessoal(c), schema: comArquivoDoMac(cap.schema) });
    }
  }
  return { ferramentas, servidores };
}

export type EntradaPlano = {
  workspace?: boolean;
  /** Já existe projeto autorizado? Sem ele o catálogo oferece só consultar e propor. */
  workspaceVinculado?: boolean;
  computador?: boolean;
  /**
   * definido em 2026-09-24 (emenda da ADR-037): o computador do bot existe mas não serve AGORA — a
   * pessoa desligou, ou três falhas seguidas o tiraram do ar. As ferramentas computador_* saem e o
   * prompt ganha uma linha (antes o plano as oferecia até com o computador desligado).
   */
  computadorFora?: ComputadorFora | null;
  turno: Turno;
  agente: Agente;
  memorias: readonly Memoria[];
  concessoes: readonly Concessao[];
  conectores: readonly Conector[];
  modo: ModoTurno;
  confianca: Confianca;
  profundidade: Profundidade;
  inventario: Inventario;
  executor: Executor;
  sessaoCli: string | null;
  /** ADR-046: metadados dos anexos da mensagem do turno, lidos pelo caso de uso. */
  anexos?: readonly AnexoMeta[];
  pessoaNome: string;
  colegas?: readonly Pick<Agente, "id" | "nome" | "titulo" | "descricao">[];
  contextoConversa?: string;
  /** Inventário para o modelo escolher SOBRE QUAL rotina agir; não confundir com `rotina` acima. */
  rotinasDoAgente?: readonly RotinaNoPrompt[];
  /** Nomes `${slug}__${tool}` das regras ATIVAS da pessoa para este agente (ADR-042). */
  semprePermitir?: readonly string[];
  /** Turno de quem cumpre um pedido de colega (ADR-047/058): de quem é o trabalho e quem pediu, para a linha do prompt. */
  delegacao?: { pessoaNome: string; remetenteNome: string } | null;
  /**
   * As pendências que o bot anotou (ADR-064), já filtradas por pendenciasDoPrompt: só nos turnos em que a pessoa
   * ou uma rotina chamou o bot (profundidade 0). Ausente ou vazia = a linha não entra.
   */
  pendencias?: readonly Pendencia[];
  /** A conversa tem projeto autorizado (ADR-039): só então as nativas de arquivo podem entrar (`nativasDoTurno`). */
  pastasAutorizadas?: boolean;
  /** O harness do turno é o Claude Code real, com o hook do nod (ADR-052): libera o kit do terminal. */
  terminal?: boolean;
  agora: number;
};

/**
 * Plano de turno (ADR-024) montado no PUXAR, uma vez por turno: catálogo = nod por modo +
 * (conector ∩ concessão) ∩ profundidade — sem redução por confiança desde a ADR-066. Lança executor_indisponivel
 * quando a localidade recusa (inventário não 'pronto'). tokenDeTurno e machineId são do servidor.
 */
export function montarPlano(entrada: EntradaPlano): Omit<PlanoTurno, "tokenDeTurno" | "machineId"> {
  const tocaDadoPessoal = entrada.conectores.some((c) => c.habilitado && conectorTocaDadoPessoal(c));
  const localidade = resolverLocalidade({ origem: entrada.turno.origem, tocaDadoPessoal, motorExigido: entrada.turno.modelo, inventario: entrada.inventario });
  if ("recusado" in localidade) throw new ErroDeDominio("executor_indisponivel", { cause: localidade.motivo });

  // revisto em 2026-09-29 (ADR-058): profundidade não é mais "peer". No limite (ADR-063: três passes) ela corta o
  // salto (montarFerramentas tira pedir_a_bot e encaminhar), e o modo vem de modoDoTurno: quem cumpre o pedido é
  // 'delegacao', e a continuação de quem pediu é a retomada do turno dele (conversa, sala, rotina ou delegação).
  const modo: ModoTurno = entrada.modo;
  const nod = FERRAMENTAS_NOD_POR_MODO[modo].map(ferramentaNod);
  const { ferramentas: deConectores, servidores } = ferramentasDeConectores(entrada.conectores, entrada.concessoes, entrada.agente.id);
  // definido em 2026-09-24 (ADR-047): delegação sem computador na v1 — o alcance é o dos conectores concedidos.
  // revisto em 2026-09-28 (ADR-050): a criação também tem computador — bot novo é bot completo.
  // revisto em 2026-10-01 (ADR-066): a delegação também — era escopo da v1, sem argumento de risco, e a rotina, sem
  // ninguém olhando, já tinha. Só o peer legado fica sem.
  const temComputador = entrada.computador === true && modo !== "peer";
  const computador: FerramentaPlano[] = temComputador && !entrada.computadorFora ? Object.entries(FERRAMENTAS_COMPUTADOR).map(([nome, schema]) => ({ nome, nomeMcp: `mcp__nod__${nome}`, origem: "computador", conectorId: null, readOnlyHint: ["computador_observar", "computador_arquivos", "computador_ler_arquivo", "computador_ler_texto"].includes(nome), tocaDadoPessoal: true, schema })) : [];
  /**
   * definido em 2026-09-18: sem projeto autorizado o agente só enxerga consultar e propor. Ver um
   * martelo que ainda não pode usar era o que o levava a tentar, falhar e virar tutorial de menu.
   */
  const SEM_PROJETO = ["workspace_consultar", "workspace_propor_pasta"];
  // revisto em 2026-10-01 (ADR-066): em todo modo menos o peer legado — a emenda da ADR-039 já dizia "em qualquer turno",
  // e o corte só na conversa (18/09) não tinha motivo escrito. O workspace passa pelo proxy e o modo decide.
  const workspace: FerramentaPlano[] = entrada.workspace && modo !== "peer"
    ? Object.entries(FERRAMENTAS_WORKSPACE)
      .filter(([nome]) => entrada.workspaceVinculado || SEM_PROJETO.includes(nome))
      .map(([nome, schema]) => ({ nome, nomeMcp: `mcp__nod__${nome}`, origem: "workspace", conectorId: null, readOnlyHint: ["workspace_consultar", "workspace_arquivos", "workspace_ler_texto", "workspace_propor_pasta"].includes(nome), tocaDadoPessoal: true, schema }))
    : [];
  // revisto em 2026-10-01 (ADR-066): o catálogo não encolhe mais por confiança. Em 30/09 a Clarice não mandava Slack nem
  // punha label no Gmail na rotina (0 de 269 turnos, contra 67 de 67 na conversa) e o Chico não movia task no ClickUp
  // na rotina de 10 min: a fonte citava um app "de fora" e as ferramentas de escrita sumiam caladas. Conteúdo de fora
  // agora só pesa no modo manual, na hora de decidir cada ação (aprovacao-permanente.ts).
  let ferramentas = montarFerramentas({ catalogo: [...nod, ...deConectores, ...computador, ...workspace], allowlistAgente: null, alcanceCanal: null, profundidade: entrada.profundidade });
  const decididoPor: `regra:${string}` = REGRA_MONTAGEM;
  // definido em 2026-09-28: quem pode receber resposta grande (conector, computador, pasta) recebe também
  // `ler_mais`, atendida pelo proxy. Leitura pura, em todo turno.
  if (ferramentas.some((f) => f.origem !== "nod")) ferramentas = [...ferramentas, FERRAMENTA_LER_MAIS];
  const conectoresUsados = new Set(ferramentas.map((f) => f.conectorId));
  const servidoresUsados = servidores.filter((s) => conectoresUsados.has(s.conectorId));

  const autoria: Autoria = {
    autor_tipo: "agente",
    autor_id: entrada.agente.id,
    sob_procuracao_de: entrada.turno.sobProcuracaoDe ?? null,
    conta_de_execucao: entrada.turno.ownerId,
    executor: entrada.executor,
    locality: "local",
    locality_reason: localidade.motivo,
    machine_id: null,
    decidido_por: localidade.decididoPor,
    regra_versao: localidade.regraVersao,
  };

  const prazoMs = Math.max(0, entrada.turno.prazoEm - entrada.agora);
  const nativas = nativasDoTurno({ modo, confianca: entrada.confianca, pastasAutorizadas: entrada.pastasAutorizadas === true, terminal: entrada.terminal === true });
  const pasta = nativas.includes("Bash") ? pastaDoBot(entrada.agente.nome) : undefined;
  return {
    tenantId: entrada.turno.tenantId,
    turnoId: entrada.turno.id,
    conversaId: entrada.turno.conversaId,
    agenteId: entrada.agente.id,
    localidade: "local",
    executor: entrada.executor,
    superficie: "maquina_da_pessoa",
    decididoPor,
    autoria,
    confiancaEntrada: entrada.confianca,
    profundidade: entrada.profundidade,
    catalogo: { ferramentas, servidores: servidoresUsados },
    nativas,
    ...(pasta ? { pastaDoBot: pasta } : {}),
    promptSistema: montarPromptSistema({ agente: entrada.agente, memorias: entrada.memorias, ferramentas, nativas, pastaDoBot: pasta, pessoaNome: entrada.pessoaNome, modo, colegas: entrada.colegas, contextoConversa: entrada.contextoConversa, conectores: entrada.conectores, rotinas: entrada.rotinasDoAgente, computadorFora: temComputador ? entrada.computadorFora ?? null : null, delegacao: modo === "delegacao" ? entrada.delegacao ?? null : null, profundidade: entrada.profundidade, pendencias: entrada.pendencias, semTerminal: motivoSemTerminal({ modo, confianca: entrada.confianca, terminal: entrada.terminal === true }) }),
    entrada: { texto: traduzirParaOCli(entrada.turno.entradaTexto), sessaoCli: entrada.sessaoCli, modelo: entrada.turno.modelo, ...(entrada.anexos?.length ? { anexos: [...entrada.anexos] } : {}), ...(entrada.agente.esforco ? { esforco: entrada.agente.esforco } : {}) },
    politicaExecucao: {
      prazoMs,
      orcamentoResultadoChars: ORCAMENTO_RESULTADO_CHARS,
    },
    modoAprovacao: entrada.agente.modoAprovacao ?? "manual",
    modoTurno: modo,
    /**
     * ADR-042: resolvido aqui, no PUXAR, e cruzado com o catálogo JÁ montado — a regra
     * evita a pergunta, nunca amplia alcance (ADR-038). Turno não confiável recebe lista VAZIA: o
     * domínio também recusa por confiança, e as duas camadas são de propósito (a lista vazia é o
     * estado, a recusa é a explicação que a pessoa lê). Ação que nunca é permanente (ADR-047: aprovar
     * PR, merge) sai mesmo com linha ativa — uma regra gravada antes da lista não vale.
     */
    semprePermitir: entrada.confianca === "nao_confiavel" ? [] : semprePermitirNoCatalogo(entrada.semprePermitir ?? [], ferramentas),
    expiraEm: PLANO_SEM_VALIDADE,
  };
}

/**
 * As regras "Sempre permitir" que valem num catálogo: só ferramenta de conector que está nele e que pode ser
 * permanente (ADR-047). O plano usa no PUXAR; desde 2026-09-30 (ADR-062) o pedir_aprovacao e a chamada direta usam
 * de novo, lendo as regras AGORA, para o clique valer já no turno que ainda está rodando.
 */
export function semprePermitirNoCatalogo(nomes: readonly string[], ferramentas: readonly FerramentaPlano[]): string[] {
  return nomes.filter((n) => ferramentas.some((f) => f.nome === n && f.origem === "conector" && !nuncaPermanente(n, f.readOnlyHint)));
}
