import type { AcaoComputador, ControleComputador, PoliticaComputador, ResultadoComputador } from "./computador.ts";
import type { EpochMs } from "./ids.ts";
import type { MotivoFalhaComputador } from "./motivos.ts";
import type { UsoDoMac } from "./raio-x.ts";

/**
 * definido em 2026-10-22 (NOD-96, ADR-122): o computador da pessoa roda no motor, numa máquina dela, atrás de
 * NOD_COMPUTADORES=motor. Um computador por pessoa (`modelo` 'por_pessoa'), uma tela e um Chrome por bot, logins em
 * comum. Com a flag desligada nada disto é lido: o modo docker segue com `modelo` 'por_bot'.
 */
export const MODELOS_COMPUTADOR = ["por_bot", "por_pessoa"] as const;
export type ModeloComputador = (typeof MODELOS_COMPUTADOR)[number];
/** Mesma ordem do enum estado_tela_computador (0106); o gate motivos-enum compara. */
export const ESTADOS_TELA_COMPUTADOR = ["fechada", "esperando", "abrindo", "aberta", "fechando"] as const;
export type EstadoTelaComputador = (typeof ESTADOS_TELA_COMPUTADOR)[number];
/** Mesma ordem do enum operacao_computador (0106). */
export const OPERACOES_COMPUTADOR = ["atualizar", "redefinir", "sair_de_todos"] as const;
export type OperacaoComputador = (typeof OPERACOES_COMPUTADOR)[number];

/** A operação em curso no computador da pessoa (Atualizar, Redefinir, Sair de todos os sites), com o progresso relatado. */
export type OperacaoEmCurso = { tipo: OperacaoComputador; progresso: number | null; etapa: string | null; desde: EpochMs };

/** O computador da pessoa no motor (ADR-122). `maquinaId` nulo = "onde o nod roda" (contrato da NOD-94). */
export type ComputadorDaPessoa = {
  id: string;
  ownerId: string;
  maquinaId: string | null;
  hospedeiraId: string | null;
  /** X25519 do supervisor, em base64, gravada no primeiro contato (TOFU); nula até lá e depois do Redefinir. */
  supervisorPub: string | null;
  operacao: OperacaoEmCurso | null;
  falhasSeguidas: number;
  falhaMotivo: MotivoFalhaComputador | null;
  indisponivelDesde: EpochMs | null;
  ultimaAtividadeEm: EpochMs;
  criadoEm: EpochMs;
};

/** A tela de um bot no computador da pessoa: o controle, a política e o pedido de ajuda passam a ser por tela. */
export type TelaComputadorBot = {
  id: string;
  computadorId: string;
  agenteId: string;
  estado: EstadoTelaComputador;
  esperandoDesde: EpochMs | null;
  controle: ControleComputador;
  politica: PoliticaComputador;
  ajuda: string | null;
  ajudaDecisaoId: string | null;
  operacaoId: string | null;
  ocupadoAte: EpochMs | null;
  ultimaAtividadeEm: EpochMs;
  memoriaMb: number | null;
  falhaMotivo: MotivoFalhaComputador | null;
  criadoEm: EpochMs;
};

export const TIPOS_COMANDO_COMPUTADOR = ["iniciar", "abrir_tela", "acao", "fechar_tela", "parar", "atualizar", "redefinir", "sair_de_todos"] as const;
export type TipoComandoComputador = (typeof TIPOS_COMANDO_COMPUTADOR)[number];

/**
 * O que o servidor manda ao supervisor do computador pela ponte. Assinado com Ed25519 pela chave do servidor; o
 * supervisor recusa comando sem assinatura válida ou com prazo vencido. `agenteId` diz a tela (ausente nos comandos do
 * computador inteiro); `acao` só em `tipo: "acao"`. `segredoSelado`: segredo da loja de logins selado para
 * `supervisorPub` (X25519), nunca em claro. `uso` é a régua da pessoa (ADR-085/097): o supervisor recusa abrir tela
 * além dela e responde `esperando_tela`.
 */
export type ComandoComputador = {
  id: string;
  computadorId: string;
  tipo: TipoComandoComputador;
  agenteId?: string;
  acao?: AcaoComputador;
  uso: UsoDoMac;
  segredoSelado?: string;
  prazoMs: number;
  /** Ed25519 em base64 sobre a forma canônica do comando sem este campo. */
  assinatura: string;
};

export const DESFECHOS_COMANDO_COMPUTADOR = ["ok", "falhou", "esperando_tela"] as const;
export type DesfechoComandoComputador = (typeof DESFECHOS_COMANDO_COMPUTADOR)[number];

/** A resposta a um comando. `quem`: em `esperando_tela`, os bots cujas telas ocupam a vez. `motivo` só em `falhou`. */
export type ResultadoComandoComputador = {
  id: string;
  desfecho: DesfechoComandoComputador;
  resultado?: ResultadoComputador;
  motivo?: MotivoFalhaComputador;
  quem?: string[];
  progresso?: { pct: number; etapa: string };
};

/** A foto do computador que o supervisor manda sem ser perguntado (ao ligar, a cada mudança de tela e no batimento). */
export type EstadoComputadorRelatado = {
  computadorId: string;
  ligado: boolean;
  /** X25519 em base64. */
  supervisorPub: string;
  telas: { agenteId: string; estado: EstadoTelaComputador; ultimaAcaoEm: EpochMs | null; memoriaMb: number | null }[];
};

/** O que sobe do supervisor ao servidor: a resposta de um comando ou a foto do computador. */
export type RelatoComputador = ({ tipo: "resultado" } & ResultadoComandoComputador) | ({ tipo: "estado" } & EstadoComputadorRelatado);

export const ESTADOS_ANUNCIO_COMPUTADOR = ["pronto", "faltam_pacotes", "sem_suporte"] as const;
export type EstadoAnuncioComputador = (typeof ESTADOS_ANUNCIO_COMPUTADOR)[number];
/** Parte do anúncio da máquina (AnuncioMaquina.computador): se ela roda o computador e, se não, o que falta instalar. */
export type AnuncioComputador = { estado: EstadoAnuncioComputador; falta?: string[] };
