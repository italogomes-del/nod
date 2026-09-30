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
import type { FerramentaPlano, ModoTurno, PlanoTurno, ServidorPlano } from "../contracts/plano-turno.ts";
import type { Profundidade, Turno } from "../contracts/turno.ts";
import { ORCAMENTO_RESULTADO_CHARS } from "../shared/constantes.ts";
import { nuncaPermanente } from "./aprovacao-permanente.ts";
import { catalogoReduzido, REGRA_REDUCAO_POR_CONFIANCA } from "./confianca.ts";
import { conectorTocaAprendiz } from "./dado-pessoal.ts";
import { ErroDeDominio } from "./erro.ts";
import { resolverLocalidade } from "./localidade-turno.ts";
import { montarFerramentas } from "./montagem-ferramentas.ts";
import { nativasDoTurno, pastaDoBot } from "./nativas.ts";
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
 * de aprovação; não tem salto (profundidade 1), nem rotina. pedir_a_bot entra em todo modo em que um bot
 * trabalha para a pessoa: criação, conversa, sala e rotina. peer é legado (perguntar_a_bot saiu na ADR-058).
 *
 * publicar_artefato/ler_artefato (definido em 2026-09-28, ADR-051) entram onde o bot fala com UMA pessoa
 * na conversa dele: conversa e rotina — e a retomada, que cai num dos dois (modoDoTurno). Fora da sala
 * (o estado é por pessoa e a sala tem várias; a RLS do artefato não tem perna de sala), da criação, do
 * peer (quem lê é outro bot) e da delegação (o resultado volta ao remetente, não à pessoa).
 */
export const FERRAMENTAS_NOD_POR_MODO: Record<ModoTurno, readonly NomeFerramentaNod[]> = {
  criacao: ["atualizar_perfil", "lembrar", "pedir_aprovacao", "pedir_acesso", "criar_rotina", "listar_rotinas", "pausar_rotina", "reativar_rotina", "atualizar_rotina", "excluir_rotina", "ver_colegas", "pedir_a_bot", "pedir_a_pessoa", "publicar_artefato", "ler_artefato"],
  conversa: ["lembrar", "pedir_aprovacao", "pedir_acesso", "criar_rotina", "listar_rotinas", "pausar_rotina", "reativar_rotina", "atualizar_rotina", "excluir_rotina", "ver_colegas", "pedir_a_bot", "pedir_a_pessoa", "publicar_artefato", "ler_artefato"],
  sala: ["lembrar", "pedir_aprovacao", "pedir_acesso", "criar_rotina", "listar_rotinas", "pausar_rotina", "reativar_rotina", "atualizar_rotina", "excluir_rotina", "ver_colegas", "pedir_a_bot", "pedir_a_pessoa", "passar", "encaminhar"],
  rotina: ["lembrar", "pedir_aprovacao", "pedir_acesso", "pedir_a_pessoa", "pedir_a_bot", "sem_novidade", "publicar_artefato", "ler_artefato"],
  peer: ["lembrar"],
  delegacao: ["lembrar", "pedir_acesso", "pedir_aprovacao", "pedir_a_pessoa"],
};

/** definido em 2026-09-16: 1 h = janela do cache ephemeral_1h do CLI (mapa-cli); plano mais velho que isso é fail-closed. */
export const PLANO_VALIDADE_MS = 3_600_000;

export const REGRA_MONTAGEM = "regra:montagem-ferramentas" as const;

function ferramentaNod(nome: NomeFerramentaNod): FerramentaPlano {
  const base: FerramentaPlano = { nome, nomeMcp: `mcp__nod__${nome}`, origem: "nod", conectorId: null, readOnlyHint: false, tocaAprendiz: false, schema: FERRAMENTAS_NOD[nome] };
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
      ferramentas.push({ nome, nomeMcp: `mcp__nod__${nome}`, origem: "conector", conectorId: c.id, readOnlyHint: cap.readOnlyHint, tocaAprendiz: conectorTocaAprendiz(c), schema: cap.schema });
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
  /** Turno de rotina OU retomada ligada a uma rotina (ADR-044): liga efeitoExternoSoPorAprovacao (EMENDA 15). */
  rotina?: { exigeAprovacao: boolean } | null;
  /** Inventário para o modelo escolher SOBRE QUAL rotina agir; não confundir com `rotina` acima. */
  rotinasDoAgente?: readonly RotinaNoPrompt[];
  /** Nomes `${slug}__${tool}` das regras ATIVAS da pessoa para este agente (ADR-042). */
  semprePermitir?: readonly string[];
  /**
   * Turno de quem cumpre um pedido de colega (ADR-047/058): de quem é o trabalho, quem pediu e se a trava da
   * rotina de onde o pedido nasceu vale aqui (`trava`, que também chega por `rotina`), para a linha do prompt.
   */
  delegacao?: { pessoaNome: string; remetenteNome: string; trava?: boolean } | null;
  /** A conversa tem projeto autorizado (ADR-039): só então as nativas de arquivo podem entrar (`nativasDoTurno`). */
  pastasAutorizadas?: boolean;
  /** O harness do turno é o Claude Code real, com o hook do nod (ADR-052): libera o kit do terminal. */
  terminal?: boolean;
  agora: number;
};

/**
 * Plano de turno (ADR-024) montado no PUXAR, uma vez por turno: catálogo = nod por modo +
 * (conector ∩ concessão) ∩ profundidade ∩ redução por confiança. Lança executor_indisponivel
 * quando a localidade recusa (inventário não 'pronto'). tokenDeTurno e machineId são do servidor.
 */
export function montarPlano(entrada: EntradaPlano): Omit<PlanoTurno, "tokenDeTurno" | "machineId"> {
  const tocaAprendiz = entrada.conectores.some((c) => c.habilitado && conectorTocaAprendiz(c));
  const localidade = resolverLocalidade({ origem: entrada.turno.origem, tocaAprendiz, motorExigido: entrada.turno.modelo, inventario: entrada.inventario });
  if ("recusado" in localidade) throw new ErroDeDominio("executor_indisponivel", { cause: localidade.motivo });

  // revisto em 2026-09-29 (ADR-058): profundidade 1 não é mais "peer". Ela corta o salto (montarFerramentas
  // tira pedir_a_bot e encaminhar), e o modo vem de modoDoTurno: quem cumpre o pedido é 'delegacao', e a
  // continuação de quem pediu é a retomada do turno dele (conversa, sala ou rotina, com a trava da rotina).
  const modo: ModoTurno = entrada.modo;
  const nod = FERRAMENTAS_NOD_POR_MODO[modo].map(ferramentaNod);
  const { ferramentas: deConectores, servidores } = ferramentasDeConectores(entrada.conectores, entrada.concessoes, entrada.agente.id);
  // definido em 2026-09-24 (ADR-047): delegação sem computador na v1 — o alcance é o dos conectores concedidos.
  // revisto em 2026-09-28 (ADR-050): a criação também tem computador — bot novo é bot completo.
  const temComputador = entrada.computador === true && modo !== "peer" && modo !== "delegacao";
  const computador: FerramentaPlano[] = temComputador && !entrada.computadorFora ? Object.entries(FERRAMENTAS_COMPUTADOR).map(([nome, schema]) => ({ nome, nomeMcp: `mcp__nod__${nome}`, origem: "computador", conectorId: null, readOnlyHint: ["computador_observar", "computador_arquivos", "computador_ler_arquivo", "computador_ler_texto"].includes(nome), tocaAprendiz: true, schema })) : [];
  /**
   * definido em 2026-09-18: sem projeto autorizado o agente só enxerga consultar e propor. Ver um
   * martelo que ainda não pode usar era o que o levava a tentar, falhar e virar tutorial de menu.
   */
  const SEM_PROJETO = ["workspace_consultar", "workspace_propor_pasta"];
  const workspace: FerramentaPlano[] = entrada.workspace && (modo === "conversa" || modo === "criacao")
    ? Object.entries(FERRAMENTAS_WORKSPACE)
      .filter(([nome]) => entrada.workspaceVinculado || SEM_PROJETO.includes(nome))
      .map(([nome, schema]) => ({ nome, nomeMcp: `mcp__nod__${nome}`, origem: "workspace", conectorId: null, readOnlyHint: ["workspace_consultar", "workspace_arquivos", "workspace_ler_texto", "workspace_propor_pasta"].includes(nome), tocaAprendiz: true, schema }))
    : [];
  let ferramentas = montarFerramentas({ catalogo: [...nod, ...deConectores, ...computador, ...workspace], allowlistAgente: null, alcanceCanal: null, profundidade: entrada.profundidade });
  let decididoPor: `regra:${string}` = REGRA_MONTAGEM;
  if (entrada.confianca === "nao_confiavel") {
    ferramentas = catalogoReduzido(ferramentas);
    decididoPor = REGRA_REDUCAO_POR_CONFIANCA;
  }
  // definido em 2026-09-28: quem pode receber resposta grande (conector, computador, pasta) recebe também
  // `ler_mais`, atendida pelo proxy. Leitura pura: fica até no catálogo reduzido do turno não confiável.
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
    promptSistema: montarPromptSistema({ agente: entrada.agente, memorias: entrada.memorias, ferramentas, nativas, pastaDoBot: pasta, pessoaNome: entrada.pessoaNome, modo, colegas: entrada.colegas, contextoConversa: entrada.contextoConversa, conectores: entrada.conectores, rotinas: entrada.rotinasDoAgente, computadorFora: temComputador ? entrada.computadorFora ?? null : null, delegacao: modo === "delegacao" ? entrada.delegacao ?? null : null }),
    entrada: { texto: traduzirParaOCli(entrada.turno.entradaTexto), sessaoCli: entrada.sessaoCli, modelo: entrada.turno.modelo, ...(entrada.anexos?.length ? { anexos: [...entrada.anexos] } : {}), ...(entrada.agente.esforco ? { esforco: entrada.agente.esforco } : {}) },
    politicaExecucao: {
      prazoMs,
      orcamentoResultadoChars: ORCAMENTO_RESULTADO_CHARS,
      // definido em 2026-09-24 (ADR-044): o gate vem da ROTINA ligada, não da origem — a retomada de um
      // turno de rotina (origem 'retomada') perdia o gate e voltava com o catálogo da conversa.
      efeitoExternoSoPorAprovacao: entrada.rotina?.exigeAprovacao === true,
      // ADR-059: a trava que veio da rotina de quem pediu (ADR-058) não é desligada pelo modo automático de quem recebe.
      ...(modo === "delegacao" && entrada.delegacao?.trava === true && entrada.rotina?.exigeAprovacao === true ? { travaHerdada: true } : {}),
    },
    modoAprovacao: entrada.agente.modoAprovacao ?? "manual",
    modoTurno: modo,
    /**
     * ADR-042: resolvido aqui, no PUXAR, e cruzado com o catálogo JÁ montado e já reduzido — a regra
     * evita a pergunta, nunca amplia alcance (ADR-038). Turno não confiável recebe lista VAZIA: o
     * domínio também recusa por confiança, e as duas camadas são de propósito (a lista vazia é o
     * estado, a recusa é a explicação que a pessoa lê). Ação que nunca é permanente (ADR-047: aprovar
     * PR, merge) sai mesmo com linha ativa — uma regra gravada antes da lista não vale.
     */
    semprePermitir: entrada.confianca === "nao_confiavel" ? [] : (entrada.semprePermitir ?? []).filter((n) => ferramentas.some((f) => f.nome === n && f.origem === "conector" && !nuncaPermanente(n, f.readOnlyHint))),
    expiraEm: Math.min(entrada.turno.prazoEm, entrada.agora + PLANO_VALIDADE_MS),
  };
}
