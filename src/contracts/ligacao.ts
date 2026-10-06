import type { EpochMs } from "./ids.ts";
import type { MotivoFimLigacao } from "./voz.ts";

/** Estado da linha em `ligacoes` (CHECK `ligacao_estado` da 0048). */
export type EstadoLigacao = "chamando" | "em_curso" | "encerrada" | "nao_atendida";

export type Ligacao = {
  id: string;
  agenteId: string;
  conversaId: string;
  estado: EstadoLigacao;
  iniciadaPor: "pessoa" | "produto";
  harness: string | null;
  modelo: string | null;
  provedorStt: string;
  provedorTts: string;
  voz: string;
  mensagemId: string | null;
  iniciadaEm: EpochMs;
  atendidaEm: EpochMs | null;
  encerradaEm: EpochMs | null;
  motivoFim: MotivoFimLigacao | null;
  duracaoMs: number | null;
  religacoes: number;
  trocas: number;
  interrupcoes: number;
  sttSegundos: number;
  ttsCaracteres: number;
  custoEstimadoUsd: number | null;
  latenciaP50Ms: number | null;
  latenciaP95Ms: number | null;
  avaliacao: "boa" | "ruim" | null;
  transcricaoApagadaEm: EpochMs | null;
  resumida: boolean;
};

export type FalaLigacao = {
  seq: number;
  autor: "pessoa" | "bot";
  tipo: "fala" | "texto" | "leitura";
  texto: string;
  inicioMs: number;
  fimMs: number;
  interrompida: boolean;
};

/**
 * Por que não dá para ligar agora (definido em 2026-10-04): resposta 200 de `GET ligacoes/disponibilidade`, nunca
 * erro — a tela mostra o texto e, quando houver, a ação. Os limites usam o `limite_atingido` existente no POST.
 */
export type MotivoRecusaLigacao =
  | "desligada"
  | "sem_permissao"
  | "sem_mac"
  | "sem_ia"
  | "app_antigo"
  | "codex_em_breve"
  /** NOD-167: o Codex do Mac não tem `codex app-server` (versão antiga): o laço de voz não sobe. */
  | "codex_sem_app_server"
  | "ja_em_ligacao"
  | "bot_ocupado_em_ligacao"
  | "sala"
  | "conversa_de_equipe"
  | "voz_indisponivel"
  | "limite_diario"
  | "limite_simultaneas"
  | "drenagem"
  | "sem_consentimento";

export type DisponibilidadeLigacao =
  | { disponivel: true; consentimentoNecessario: boolean; versaoConsentimento: number; provedor: string }
  | { disponivel: false; motivo: MotivoRecusaLigacao; texto: string };

/** POST ligacoes: o que a tela precisa para abrir a mídia. */
export type LigacaoCriada = { ligacao: Ligacao; maxS: number };

/** Payload da mensagem `sistema` que vira a linha "Chat de voz · mm:ss" na conversa. */
export type PayloadLinhaLigacao = { kind: "ligacao"; ligacaoId: string; duracaoMs: number | null; estado: EstadoLigacao };

/** definido em 2026-10-04 (ADR-075): sobe quando muda o provedor ou o suboperador do áudio. */
export const VERSAO_CONSENTIMENTO_VOZ = 1;
export const TEXTO_CONSENTIMENTO_VOZ =
  "Na ligação, sua fala é transcrita pelo Google (nos EUA) e a voz do bot também é gerada lá. Nada é gravado: fica só a transcrição em texto, que você pode apagar.";
