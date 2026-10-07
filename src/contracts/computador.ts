import type { EpochMs } from "./ids.ts";
import type { MotivoFalhaComputador } from "./motivos.ts";

export type ControleComputador = "bot" | "pessoa" | "aguardando_pessoa";
export type PoliticaComputador = "supervisionado" | "autonomo";
export type Computador = {
  id: string;
  agenteId: string;
  habilitado: boolean;
  controle: ControleComputador;
  politica: PoliticaComputador;
  ajuda: string | null;
  ajudaDecisaoId: string | null;
  ocupadoAte: number | null;
  operacaoId: string | null;
  criadoEm: number;
  /**
   * Saúde (definido em 2026-09-24, emenda da ADR-037): falhas SEGUIDAS da máquina (só as que contam
   * para a saúde), o motivo da última e quando ela foi dada como fora do ar — a partir daí o plano sai
   * sem as ferramentas computador_* e a pessoa religa. Uma resposta da máquina zera tudo.
   */
  falhasSeguidas: number;
  falhaMotivo: MotivoFalhaComputador | null;
  indisponivelDesde: EpochMs | null;
};
export type AcaoComputador =
  /** `forcar` (NOD-161): devolve imagem e texto mesmo se iguais à última entrega; não vai ao runtime. */
  | { tipo: "observar"; forcar?: boolean }
  | { tipo: "navegar"; url: string }
  | { tipo: "clicar"; x: number; y: number; quadro: string; botao?: number; vezes?: number }
  | { tipo: "arrastar"; x: number; y: number; destinoX: number; destinoY: number; quadro: string }
  | { tipo: "dialogo"; aceitar: boolean; texto?: string; quadro: string }
  | { tipo: "audio"; segundos: number }
  | { tipo: "digitar"; texto: string; quadro: string }
  | { tipo: "tecla"; tecla: string; quadro: string }
  | { tipo: "rolar"; delta: number; quadro: string }
  | { tipo: "abas"; aba?: number }
  | { tipo: "arquivos"; caminho: string }
  | { tipo: "ler_arquivo"; caminho: string }
  | { tipo: "ler_texto"; caminho: string; inicio: number; revisao?: string }
  | { tipo: "gravar_texto"; caminho: string; texto: string; revisao: string }
  | { tipo: "gravar_arquivo"; caminho: string; base64: string }
  | { tipo: "anexar"; caminho: string; quadro: string }
  | { tipo: "terminal"; comando: string };
export type TelaComputador = {
  quadro: string;
  imagem: string;
  largura: number;
  altura: number;
  url: string;
  titulo: string;
  texto: string;
  dialogo?: { tipo: string; mensagem: string };
  abas: { titulo: string; url: string; ativa: boolean }[];
};
export type ArquivoComputador = { nome: string; caminho: string; tamanho: number; diretorio: boolean };
export type ResultadoComputador = {
  tela?: TelaComputador;
  arquivos?: ArquivoComputador[];
  arquivo?: { nome: string; base64: string };
  texto?: { conteudo: string; inicio: number; proximo: number | null; total: number; revisao: string };
  revisao?: string;
  saida?: string;
  codigoSaida?: number;
  audio?: { mimeType: "audio/wav"; data: string };
};
export type RegistroComputador = {
  id: string;
  computadorId: string;
  turnoId: string | null;
  autor: "bot" | "pessoa";
  tipo: string;
  estado: "pendente" | "executando" | "concluida" | "falhou" | "recusada";
  /** Só na ação que falhou: o código fechado, para a atividade dizer o que houve. */
  motivo: MotivoFalhaComputador | null;
  em: number;
};
/**
 * NOD-192: o que o painel vê. Um bot que nunca usou o computador não tem linha em `computadores`: o GET
 * devolve o padrão (computadorPadrao) com `id` e `criadoEm` nulos, sem criar nada. A web age pelo agente.
 */
export type ComputadorVisto = Omit<Computador, "id" | "criadoEm"> & { id: string | null; criadoEm: number | null };
export type ComputadorDto = {
  computador: ComputadorVisto;
  disponivel: boolean;
  ativo: boolean;
  motivo: string | null;
  /** Quantas vezes o Docker reiniciou o container (docker inspect); null quando não se sabe. */
  reinicios?: number | null;
  /** NOD-170: o teto de computadores ligados no host e a ociosidade em minutos (0 = não desliga), para o cartão do limite. */
  limite?: { maximo: number; ociosoMin: number };
  atividade: RegistroComputador[];
};
/** O ambiente do servidor (Docker, cofre, imagem), sem olhar nenhuma máquina. */
export type AmbienteComputador = { disponivel: boolean; motivo: string | null; limite?: { maximo: number; ociosoMin: number } };
export interface DriverComputador {
  /** NOD-192: o painel de um bot sem computador mostra só o ambiente — não há container para inspecionar. */
  ambiente(): Promise<AmbienteComputador>;
  estado(id: string): Promise<{ disponivel: boolean; ativo: boolean; motivo: string | null; reinicios?: number | null; limite?: { maximo: number; ociosoMin: number } }>;
  iniciar(id: string): Promise<void>;
  parar(id: string): Promise<void>;
  executar(id: string, acao: AcaoComputador): Promise<ResultadoComputador>;
  /** NOD-170: os ids dos computadores ligados NESTE host (de qualquer pessoa; os proxies nod-egress-* não contam). */
  ligados(): Promise<Set<string>>;
}
