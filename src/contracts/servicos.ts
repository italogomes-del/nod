import type { Conector } from "./conector.ts";
import type { RuntimeEvent } from "./evento.ts";
import type { ContratoFerramentaNod, NomeFerramentaNod } from "./ferramentas-nod.ts";
import type { FrameSse, TipoFrame } from "./frame.ts";
import type { CapacidadeConector } from "./conector.ts";
import type { MotivoNegacao, MotivoPasse } from "./motivos.ts";
import type { PlanoTurno } from "./plano-turno.ts";
import type { Rotina } from "./rotina.ts";

/** Identidade derivada do token de turno — o remetente nunca vem do texto (ADR-024). */
export type IdentidadeDeTurno = { turnoId: string; tenantId: string; pessoaId: string; agenteId: string };
/** O que `cunhar` recebe: a identidade menos o turno (que é o primeiro argumento). */
export type IdentidadeSemTurno = Omit<IdentidadeDeTurno, "turnoId">;

export type ResultadoSonda = { ok: true; ferramentas: CapacidadeConector[] } | { ok: false; motivo: MotivoNegacao };

/**
 * Contrato `Services` completo (EMENDA 18). Genérico em `Trx` porque src/contracts não importa
 * nada de fora (nem src/shared/types.ts); src/use-cases/tipos.ts fixa `Services = ServicesNod<Tx>`.
 * Fatias: planos/conectores/tokenTurno ← L5; interruptor ← L6; rotinas/sala ← L7; barramento ← L8;
 * catcher ← L4/L3; relogio ← L9 (relogio-sistema). L9 compõe.
 */
export interface ServicesNod<Trx> {
  workspaces?: {
    id(i: { tenantId: string; pessoaId: string; conversaId: string }): Promise<string | null>;
    /** Pasta onde o harness abre e as que ele alcança; null quando não há projeto autorizado. */
    pastasDoHarness(i: { tenantId: string; pessoaId: string; conversaId: string }): Promise<{ ativa: string; aprovadas: string[] } | null>;
  };
  computadores?: {
    executarAprovado(p: { tenantId: string; pessoaId: string; agenteId: string; turnoId: string; acaoId: string }): Promise<void>;
  };
  relogio: () => number;
  tokenTurno: {
    /** definido em 2026-09-16 (L9, pendência L5 §2): cunhar RECEBE a identidade — `autorizar` a devolve, logo ela entra aqui. */
    cunhar(turnoId: string, identidade: IdentidadeSemTurno): string;
    autorizar(token: string): IdentidadeDeTurno | null;
    revogar(turnoId: string): void;
  };
  planos: {
    emitir(trx: Trx, turnoId: string, machineId: string): Promise<PlanoTurno>;
    /** O plano emitido para um turno vivo (GET /api/interno/plano); null sem token/plano. */
    buscar(turnoId: string): PlanoTurno | null;
  };
  rotinas: { ativar(trx: Trx, propostaId: string): Promise<Rotina> };
  conectores: {
    chamar(conectorId: string, tool: string, args: Record<string, unknown>): Promise<{ conteudo: string; isError: boolean }>;
    sondar(conector: Conector): Promise<ResultadoSonda>;
  };
  interruptor: {
    registrar(turnoId: string, fn: () => Promise<void>): void;
    interromper(turnoId: string): Promise<boolean>;
  };
  /** `tipo` é rótulo snake_case ('plano_recebido', 'tool_use'), nunca prosa: CHECK catcher_registros_tipo (^[a-z_]+$) na 0002. */
  catcher: { registrar(trx: Trx, turnoId: string, tipo: string, dados: Record<string, unknown>): Promise<void> };
  sala: {
    encaminhar(trx: Trx, p: { turnoId: string; paraAgente: string; motivo: string }): Promise<{ ok: true }>;
    passar(trx: Trx, p: { turnoId: string; motivo: MotivoPasse }): Promise<{ ok: true }>;
    perguntar(trx: Trx, p: { turnoId: string; agente: string; pergunta: string }): Promise<{ tarefaId: string }>;
  };
  barramento: { publicar(pessoaId: string, tipo: TipoFrame, dados: Record<string, unknown>): FrameSse };
}

/**
 * Quem chamou a ferramenta, derivado do token (nunca do corpo). `plano` é o PLANO JÁ PUXADO
 * (ADR-013/024): a regra de aprovação automática é avaliada localmente a partir dele, nunca por
 * consulta na hora da chamada. AUSENTE = nunca automático — o caminho do computador
 * (adapters/fundo/computadores.ts) chama pedirAprovacaoComputador sem plano, e fail-closed é o
 * comportamento certo ali (ADR-042 claim 1).
 */
export type ContextoFerramenta = { turnoId: string; agenteId: string; conversaId: string; plano?: PlanoTurno };

export type SaidaCasoDeUso<O> = { data: O; events?: RuntimeEvent[] };

/**
 * Uma implementação por ferramenta nod (EMENDA 5): chamar-ferramenta.ts valida args pelo schema,
 * aplica gate de parada/catálogo/trilha e DESPACHA para `deps.useCases[nome]`. Genérico em `Deps`
 * pelo mesmo motivo de ServicesNod. lembrar/atualizarPerfil ← L6; criarRotina/passar/encaminhar/
 * perguntarABot ← L7; pedirAcesso/pedirAprovacao/pedirAPessoa ← L5.
 */
export type CasoNod<Deps, N extends NomeFerramentaNod> = (
  deps: Deps,
  input: ContextoFerramenta & ContratoFerramentaNod[N]["args"],
) => Promise<SaidaCasoDeUso<ContratoFerramentaNod[N]["resultado"]>>;

export interface UseCasesNod<Deps> {
  lembrar: CasoNod<Deps, "lembrar">;
  atualizarPerfil: CasoNod<Deps, "atualizar_perfil">;
  pedirAcesso: CasoNod<Deps, "pedir_acesso">;
  criarRotina: CasoNod<Deps, "criar_rotina">;
  listarRotinasDoAgente: CasoNod<Deps, "listar_rotinas">;
  pausarRotinaPeloAgente: CasoNod<Deps, "pausar_rotina">;
  reativarRotinaPeloAgente: CasoNod<Deps, "reativar_rotina">;
  atualizarRotinaPeloAgente: CasoNod<Deps, "atualizar_rotina">;
  excluirRotinaPeloAgente: CasoNod<Deps, "excluir_rotina">;
  pedirAprovacao: CasoNod<Deps, "pedir_aprovacao">;
  pedirAPessoa: CasoNod<Deps, "pedir_a_pessoa">;
  passar: CasoNod<Deps, "passar">;
  encaminhar: CasoNod<Deps, "encaminhar">;
  semNovidade: CasoNod<Deps, "sem_novidade">;
  perguntarABot: CasoNod<Deps, "perguntar_a_bot">;
}

/** Mapa nome da ferramenta → chave em UseCasesNod (o despacho é por tabela, não por if). */
export const USE_CASE_POR_FERRAMENTA = {
  lembrar: "lembrar",
  atualizar_perfil: "atualizarPerfil",
  pedir_acesso: "pedirAcesso",
  criar_rotina: "criarRotina",
  listar_rotinas: "listarRotinasDoAgente",
  pausar_rotina: "pausarRotinaPeloAgente",
  reativar_rotina: "reativarRotinaPeloAgente",
  atualizar_rotina: "atualizarRotinaPeloAgente",
  excluir_rotina: "excluirRotinaPeloAgente",
  pedir_aprovacao: "pedirAprovacao",
  pedir_a_pessoa: "pedirAPessoa",
  passar: "passar",
  encaminhar: "encaminhar",
  sem_novidade: "semNovidade",
  perguntar_a_bot: "perguntarABot",
} as const satisfies Record<NomeFerramentaNod, keyof UseCasesNod<unknown>>;
