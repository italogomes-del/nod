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
import { catalogoReduzido, REGRA_REDUCAO_POR_CONFIANCA } from "./confianca.ts";
import { conectorTocaAprendiz } from "./dado-pessoal.ts";
import { ErroDeDominio } from "./erro.ts";
import { resolverLocalidade } from "./localidade-turno.ts";
import { montarFerramentas } from "./montagem-ferramentas.ts";
import { montarPromptSistema, type RotinaNoPrompt } from "./prompt-sistema.ts";
import { FERRAMENTAS_COMPUTADOR } from "../contracts/ferramentas-computador.ts";
import type { ComputadorFora } from "./prompt-sistema.ts";
import { FERRAMENTAS_WORKSPACE } from "../contracts/ferramentas-workspace.ts";

/**
 * Ferramentas nod por modo (definido em 2026-09-16): criação propõe perfil/rotina/acesso; conversa
 * e sala têm o kit completo; rotina permite consulta a colega (definido em 2026-09-17) e encerrar em
 * silêncio por sem_novidade (definido em 2026-09-21 — só faz sentido onde ninguém está esperando
 * resposta, por isso não entra em conversa nem em sala); peer é texto-só, sem
 * salto (E12.4). pedir_a_pessoa (EMENDA 16) entra onde há pessoa para destravar: conversa, sala e
 * rotina — não em criação (o modelo pergunta em texto) nem em peer (o remetente é outro bot).
 *
 * pedir_acesso entra na rotina desde 2026-09-24 (ADR-044): ele só PROPÕE — quem decide é a pessoa,
 * num botão —, e sem ele a rotina sem acesso pedia por pedir_a_pessoa em texto a cada execução. No
 * turno de rotina o domínio só aceita leitura (pedido-acesso.ts).
 *
 * Ciclo de vida de rotina (listar/pausar/reativar, definido em 2026-09-21) só em conversa e sala,
 * onde a pessoa está presente para pedir e conferir. FORA de propósito em:
 * criação (o agente ainda não tem rotina: o inventário seria vazio), peer (quem fala é outro bot,
 * e mexer em rotina por pedido de bot burlaria o corte de segundo salto do ADR-035) e rotina — este
 * é o caso perigoso: um turno acordado por agendamento que pudesse se pausar sozinho viraria uma
 * rotina que se desliga por conta própria, e o modo rotina já é explicitamente "a própria execução",
 * não a hora de reconfigurar. Quem reconfigura é a pessoa, na conversa.
 */
export const FERRAMENTAS_NOD_POR_MODO: Record<ModoTurno, readonly NomeFerramentaNod[]> = {
  criacao: ["atualizar_perfil", "pedir_acesso", "criar_rotina", "lembrar"],
  conversa: ["lembrar", "pedir_aprovacao", "pedir_acesso", "criar_rotina", "listar_rotinas", "pausar_rotina", "reativar_rotina", "atualizar_rotina", "excluir_rotina", "perguntar_a_bot", "pedir_a_pessoa"],
  sala: ["lembrar", "pedir_aprovacao", "pedir_acesso", "criar_rotina", "listar_rotinas", "pausar_rotina", "reativar_rotina", "atualizar_rotina", "excluir_rotina", "perguntar_a_bot", "pedir_a_pessoa", "passar", "encaminhar"],
  rotina: ["lembrar", "pedir_aprovacao", "pedir_acesso", "pedir_a_pessoa", "perguntar_a_bot", "sem_novidade"],
  peer: ["lembrar"],
};

/** definido em 2026-09-16: 1 h = janela do cache ephemeral_1h do CLI (mapa-cli); plano mais velho que isso é fail-closed. */
export const PLANO_VALIDADE_MS = 3_600_000;

export const REGRA_MONTAGEM = "regra:montagem-ferramentas" as const;

function ferramentaNod(nome: NomeFerramentaNod): FerramentaPlano {
  return { nome, nomeMcp: `mcp__nod__${nome}`, origem: "nod", conectorId: null, readOnlyHint: false, tocaAprendiz: false, schema: FERRAMENTAS_NOD[nome] };
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
  pessoaNome: string;
  colegas?: readonly Pick<Agente, "id" | "nome" | "titulo" | "descricao">[];
  contextoConversa?: string;
  /** Turno de rotina OU retomada ligada a uma rotina (ADR-044): liga efeitoExternoSoPorAprovacao (EMENDA 15). */
  rotina?: { exigeAprovacao: boolean } | null;
  /** Inventário para o modelo escolher SOBRE QUAL rotina agir; não confundir com `rotina` acima. */
  rotinasDoAgente?: readonly RotinaNoPrompt[];
  /** Nomes `${slug}__${tool}` das regras ATIVAS da pessoa para este agente (ADR-042). */
  semprePermitir?: readonly string[];
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

  const modo: ModoTurno = entrada.profundidade >= 1 ? "peer" : entrada.modo;
  const nod = FERRAMENTAS_NOD_POR_MODO[modo].map(ferramentaNod);
  const { ferramentas: deConectores, servidores } = ferramentasDeConectores(entrada.conectores, entrada.concessoes, entrada.agente.id);
  const temComputador = entrada.computador === true && modo !== "peer" && modo !== "criacao";
  const computador: FerramentaPlano[] = temComputador && !entrada.computadorFora ? Object.entries(FERRAMENTAS_COMPUTADOR).map(([nome, schema]) => ({ nome, nomeMcp: `mcp__nod__${nome}`, origem: "computador", conectorId: null, readOnlyHint: ["computador_observar", "computador_arquivos", "computador_ler_arquivo", "computador_ler_texto"].includes(nome), tocaAprendiz: true, schema })) : [];
  /**
   * definido em 2026-09-18: sem projeto autorizado o agente só enxerga consultar e propor. Ver um
   * martelo que ainda não pode usar era o que o levava a tentar, falhar e virar tutorial de menu.
   */
  const SEM_PROJETO = ["workspace_consultar", "workspace_propor_pasta"];
  const workspace: FerramentaPlano[] = entrada.workspace && modo === "conversa"
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
  const conectoresUsados = new Set(ferramentas.map((f) => f.conectorId));
  const servidoresUsados = servidores.filter((s) => conectoresUsados.has(s.conectorId));

  const autoria: Autoria = {
    autor_tipo: "agente",
    autor_id: entrada.agente.id,
    sob_procuracao_de: null,
    conta_de_execucao: entrada.turno.ownerId,
    executor: entrada.executor,
    locality: "local",
    locality_reason: localidade.motivo,
    machine_id: null,
    decidido_por: localidade.decididoPor,
    regra_versao: localidade.regraVersao,
  };

  const prazoMs = Math.max(0, entrada.turno.prazoEm - entrada.agora);
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
    promptSistema: montarPromptSistema({ agente: entrada.agente, memorias: entrada.memorias, ferramentas, pessoaNome: entrada.pessoaNome, modo, colegas: entrada.colegas, contextoConversa: entrada.contextoConversa, conectores: entrada.conectores, rotinas: entrada.rotinasDoAgente, computadorFora: temComputador ? entrada.computadorFora ?? null : null }),
    entrada: { texto: entrada.turno.entradaTexto, sessaoCli: entrada.sessaoCli, modelo: entrada.turno.modelo },
    politicaExecucao: {
      prazoMs,
      orcamentoResultadoChars: ORCAMENTO_RESULTADO_CHARS,
      // definido em 2026-09-24 (ADR-044): o gate vem da ROTINA ligada, não da origem — a retomada de um
      // turno de rotina (origem 'retomada') perdia o gate e voltava com o catálogo da conversa.
      efeitoExternoSoPorAprovacao: entrada.rotina?.exigeAprovacao === true,
    },
    /**
     * ADR-042: resolvido aqui, no PUXAR, e cruzado com o catálogo JÁ montado e já reduzido — a regra
     * evita a pergunta, nunca amplia alcance (ADR-038). Turno não confiável recebe lista VAZIA: o
     * domínio também recusa por confiança, e as duas camadas são de propósito (a lista vazia é o
     * estado, a recusa é a explicação que a pessoa lê).
     */
    semprePermitir: entrada.confianca === "nao_confiavel" ? [] : (entrada.semprePermitir ?? []).filter((n) => ferramentas.some((f) => f.nome === n && f.origem === "conector")),
    expiraEm: Math.min(entrada.turno.prazoEm, entrada.agora + PLANO_VALIDADE_MS),
  };
}
