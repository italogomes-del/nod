import type { EpochMs } from "./ids.ts";

/**
 * As contas de IA da pessoa em todas as máquinas (definido em 2026-10-13, ADR-102). O servidor guarda a lista (apelido,
 * plano, ordem, limite) e, por máquina, se a conta está logada nela. E-mail e organização nunca chegam aqui: a máquina
 * manda só a impressão (sha256) da conta (ADR-019, ADR-102 item 4).
 */

/** As IAs que têm conta (as do Mac e da VM). */
export const IAS_COM_CONTA = ["claude-cli", "codex-cli"] as const;
export type IaComConta = (typeof IAS_COM_CONTA)[number];

export type EstadoContaNaMaquina = "pronta" | "sem_login" | "sem_acesso";
export const ESTADOS_CONTA_NA_MAQUINA: readonly EstadoContaNaMaquina[] = ["pronta", "sem_login", "sem_acesso"];

/** O que a máquina anuncia de cada conta logada nela (no `conectar` e no `inventario` da ponte). */
export type ContaAnunciada = {
  /** sha256 hex (impressaoDaConta, src/domain/contas-da-pessoa.ts). */
  impressao: string;
  ia: IaComConta;
  estado: EstadoContaNaMaquina;
  /** O plano legível ("Max", "Team", "Plus"); null = o CLI não disse. */
  plano: string | null;
  /** A regra da ADR-101 (contaCorporativa), decidida na máquina, que sabe qual é a conta de sempre. */
  corporativa: boolean;
  /** Quando esta pasta entrou nesta máquina (R4 da revisão: uma conta removida só volta com um login mais novo). */
  logadaEm: EpochMs;
  /** O apelido que a máquina conhece (o do `contas.json` do Mac), usado só quando a conta é nova no servidor. */
  apelidoSugerido?: string;
};

/** Teto do anúncio: 6 contas por IA (CONTAS_POR_IA_MAX) nas duas IAs. */
export const CONTAS_ANUNCIADAS_MAX = 12;

export type MaquinaDaConta = { maquinaId: string; nome: string; estado: EstadoContaNaMaquina };

export type ContaIa = {
  id: string;
  ia: IaComConta;
  /** A impressão, para a máquina local casar com o que ela sabe (o e-mail no app do Mac). */
  impressao: string;
  apelido: string;
  plano: string | null;
  corporativa: boolean;
  posicao: number;
  entraNaTrocaAutomatica: boolean;
  noLimiteAte: EpochMs | null;
  maquinas: MaquinaDaConta[];
};

export type ModoDasContas = "perguntar" | "automatico";

export type ContasIaDto = {
  /** false no modo local (ADR-092): a web mostra a tela da ADR-101. */
  disponivel: boolean;
  modo: ModoDasContas;
  contas: ContaIa[];
};

/** A conta que o plano manda a máquina usar (ADR-102 item 5). */
export type ContaDoPlano = { id: string; impressao: string; apelido: string };

// ── Login de uma conta numa máquina pela tela (ADR-102 item 3) ──────────────────────────────────────────────────────

export type FaseLogin = "pedido" | "abrindo" | "aguardando_pessoa" | "conferindo" | "pronto" | "falhou" | "cancelado";
export const FASES_LOGIN: readonly FaseLogin[] = ["pedido", "abrindo", "aguardando_pessoa", "conferindo", "pronto", "falhou", "cancelado"];
export const FASES_LOGIN_FINAIS: readonly FaseLogin[] = ["pronto", "falhou", "cancelado"];

export type LoginNaMaquina = {
  id: string;
  maquinaId: string;
  ia: IaComConta;
  /** A conta existente que se quer logar nesta máquina; null = uma conta nova (`apelido`). */
  contaId: string | null;
  apelido: string | null;
  fase: FaseLogin;
  /** O link oficial do login (só da lista LINKS_OFICIAIS). */
  url: string | null;
  /** Codex: o código que a pessoa digita na página da OpenAI. */
  codigoDispositivo: string | null;
  /** Claude: a página devolve um código que a pessoa cola aqui. */
  pedeCodigo: boolean;
  /** A chave pública (SPKI, base64) que a máquina gerou para este login: o navegador cifra o código com ela. */
  chavePublica: string | null;
  /** O código já foi entregue à máquina (a tela mostra "Conferindo…"). */
  codigoEnviado: boolean;
  /** Código curto do erro (falhou): "tempo_esgotado", "codigo_recusado", "cli_ausente", "conta_diferente"… */
  erro: string | null;
  /** A conta que entrou (pronto). Diferente de `contaId` = a pessoa entrou com outra conta (a tela avisa). */
  contaFinalId: string | null;
  criadoEm: EpochMs;
  atualizadoEm: EpochMs;
};

/** O código do Claude cifrado no navegador: a chave AES-GCM envolvida em RSA-OAEP, o IV e os dados (base64). */
export type CodigoCifrado = { chave: string; iv: string; dados: string };

/** O que a máquina recebe na puxada de contas. */
export type LoginPendente = {
  id: string;
  ia: IaComConta;
  /** A impressão esperada (login de conta existente); null = conta nova. */
  impressao: string | null;
  apelido: string | null;
  /** Presente uma vez, quando a pessoa colou o código. */
  codigo?: CodigoCifrado;
  cancelado?: boolean;
};

export type PuxadaDeContas = {
  logins: LoginPendente[];
  /** As impressões de que esta máquina deve sair (logout + apagar a pasta). */
  sair: string[];
  /** A pessoa desconectou a máquina pedindo para sair das contas: sair de todas e parar. */
  desconectar: boolean;
};

/** O progresso que a máquina relata de um login. */
export type ProgressoDoLogin = {
  loginId: string;
  fase: Exclude<FaseLogin, "pedido" | "cancelado">;
  url?: string;
  codigoDispositivo?: string;
  pedeCodigo?: boolean;
  chavePublica?: string;
  erro?: string;
  /** pronto: a impressão da conta que entrou (o anúncio seguinte a registra). */
  impressao?: string;
  plano?: string | null;
};

// ── O limite de uma conta na conversa (payload `limite_do_plano.contas`) ─────────────────────────────────────────────

export type ContaLivre = {
  id: string;
  apelido: string;
  ia: IaComConta;
  /** Logada na máquina do turno: "Seguir com". */
  naMaquina: boolean;
  /** Livre só noutra máquina viva da pessoa: "Rodar no <nome> desta vez" (ou "Entrar com ela na <máquina>"). */
  outraMaquina: { id: string; nome: string } | null;
};

export type ContasNoLimite = {
  de: { id: string; apelido: string; ia: IaComConta };
  livres: ContaLivre[];
  /** A máquina do turno (para "Entrar com ela na <máquina>"). */
  maquina: { id: string; nome: string } | null;
  voltaEm: EpochMs | null;
};
