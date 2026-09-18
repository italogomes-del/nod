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
};
export type AcaoComputador =
  | { tipo: "observar" }
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
  em: number;
};
export type ComputadorDto = {
  computador: Computador;
  disponivel: boolean;
  ativo: boolean;
  motivo: string | null;
  atividade: RegistroComputador[];
};
export interface DriverComputador {
  estado(id: string): Promise<{ disponivel: boolean; ativo: boolean; motivo: string | null }>;
  iniciar(id: string): Promise<void>;
  parar(id: string): Promise<void>;
  executar(id: string, acao: AcaoComputador): Promise<ResultadoComputador>;
}
