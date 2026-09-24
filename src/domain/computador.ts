import type { AcaoComputador } from "../contracts/computador.ts";
import type { MotivoFalhaComputador } from "../contracts/motivos.ts";
import { ErroDeDominio } from "./erro.ts";

/**
 * definido em 2026-09-24 (emenda da ADR-037): a falha do computador do bot com código FECHADO. Antes o
 * adaptador jogava tudo em "estado_invalido" e a ferramenta devolvia "indisponível ou tela alterada"
 * em toda execução — o Chromium travado por um SingletonLock velho ficou dois dias assim. `detalhe` é
 * a 1ª linha do stderr (só para o log, passada por resumirDetalhe); `reinicios` vem do docker inspect.
 */
export class FalhaComputador extends Error {
  readonly motivo: MotivoFalhaComputador;
  readonly detalhe: string | null;
  readonly reinicios: number | null;
  constructor(motivo: MotivoFalhaComputador, extra: { detalhe?: string | null; reinicios?: number | null } = {}) {
    super(motivo);
    this.name = "FalhaComputador";
    this.motivo = motivo;
    this.detalhe = extra.detalhe ?? null;
    this.reinicios = extra.reinicios ?? null;
  }
}

export function ehFalhaComputador(e: unknown): e is FalhaComputador {
  return e instanceof FalhaComputador;
}

/** Só a MÁQUINA sem responder conta para a saúde; a ação que falhou numa máquina viva não conta. */
export const CONTA_PARA_SAUDE: ReadonlySet<MotivoFalhaComputador> = new Set<MotivoFalhaComputador>(["docker_indisponivel", "imagem_ausente", "nao_iniciou", "cofre_invalido", "navegador_nao_abriu", "sem_resposta"]);

/**
 * definido em 2026-09-24, NÃO medido: três falhas seguidas da máquina tiram o computador das próximas
 * execuções (uma mensagem só, na transição). Uma falha isolada é rede ou reinício; três seguidas, com
 * a mesma resposta, é a máquina quebrada — e cada tentativa custava um turno inteiro do agente.
 */
export const LIMITE_FALHAS_SEGUIDAS = 3;

/** O motivo em português, para a mensagem da conversa e as instruções ao agente. */
export const MOTIVO_FALHA_EM_PORTUGUES: Readonly<Record<MotivoFalhaComputador, string>> = {
  docker_indisponivel: "o Docker do servidor não está respondendo",
  imagem_ausente: "a imagem do computador não foi preparada no servidor",
  nao_iniciou: "o computador não conseguiu ligar",
  cofre_invalido: "o cofre de logins do computador não abriu",
  navegador_nao_abriu: "o navegador do computador não abriu",
  sem_resposta: "o computador parou de responder",
  acao_falhou: "a ação falhou dentro do computador",
  tela_alterada: "a tela mudou desde a última observação",
  ocupado: "outra ação estava em andamento",
};

/**
 * O que a FERRAMENTA devolve ao agente em cada falha (tabela fixa, sem catch-all). Máquina fora do
 * ar: não insistir neste turno. Ação que falhou: observar antes de repetir.
 */
export function instrucaoDaFalha(motivo: MotivoFalhaComputador): string {
  if (CONTA_PARA_SAUDE.has(motivo)) return `O computador não respondeu: ${MOTIVO_FALHA_EM_PORTUGUES[motivo]}. Não tente de novo neste turno; siga com os acessos que você tem e diga em uma frase o que ficou de fora.`;
  if (motivo === "tela_alterada") return "A tela mudou desde a sua observação. Observe de novo e reavalie antes de agir; nada foi executado.";
  if (motivo === "ocupado") return "Outra ação estava em andamento no computador. Observe a tela antes de tentar de novo; nada foi executado.";
  return "A ação falhou. Observe a tela antes de tentar novamente; não afirme que executou.";
}

/**
 * A 1ª linha não vazia do stderr, com até 200 caracteres e sem nada com cara de segredo. Só vai para
 * o log (computador_falhou) — nunca para a pessoa, o agente ou o banco.
 */
export function resumirDetalhe(texto: string | null | undefined): string | null {
  const linha = (texto ?? "").split(/\r?\n/).map((l) => l.trim()).find((l) => l !== "");
  if (!linha) return null;
  return linha
    .replace(/(bearer\s+)\S+/gi, "$1[redigido]")
    .replace(/\b(senha|password|passwd|token|secret|segredo|chave|key|authorization|cookie)(\s*[=:]\s*)\S+/gi, "$1$2[redigido]")
    .replace(/[A-Za-z0-9+_=-]{40,}/g, "[redigido]")
    .replace(/\b[a-f0-9]{32,}\b/gi, "[redigido]")
    .slice(0, 200);
}

export function validarAcaoComputador(valor: unknown): AcaoComputador {
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) throw new ErroDeDominio("entrada_invalida");
  const a = valor as Record<string, unknown>;
  const texto = (k: string, max = 8000) => {
    if (typeof a[k] !== "string" || (a[k] as string).length > max) throw new ErroDeDominio("entrada_invalida");
    return a[k] as string;
  };
  const numero = (k: string, min: number, max: number) => {
    const n = a[k];
    if (typeof n !== "number" || !Number.isFinite(n) || n < min || n > max) throw new ErroDeDominio("entrada_invalida");
    return n;
  };
  const quadro = () => { const q = texto("quadro", 64); if (!/^[a-f0-9]{64}$/.test(q)) throw new ErroDeDominio("entrada_invalida"); return q; };
  const caminho = () => {
    const c = texto("caminho", 500).replace(/^\/workspace(?:\/|$)/, "");
    if (c.startsWith("/") || c.includes("\\") || c.includes("\0") || c.split("/").includes("..")) throw new ErroDeDominio("entrada_invalida");
    return c || ".";
  };
  switch (a.tipo) {
    case "observar": return { tipo: a.tipo };
    case "navegar": {
      const url = texto("url", 4000);
      // definido em 2026-09-18: DNS/endereço de destino são validados novamente no proxy de saída.
      if (!/^https?:\/\/[^\s]+$/i.test(url) || /^https?:\/\/[^/]*@/i.test(url)) throw new ErroDeDominio("entrada_invalida");
      return { tipo: a.tipo, url };
    }
    case "clicar": return { tipo: a.tipo, quadro: quadro(), x: numero("x", 0, 1279), y: numero("y", 0, 799), ...(a.botao === undefined ? {} : { botao: numero("botao", 1, 3) }), ...(a.vezes === undefined ? {} : { vezes: numero("vezes", 1, 2) }) };
    case "arrastar": return { tipo: a.tipo, quadro: quadro(), x: numero("x", 0, 1279), y: numero("y", 0, 799), destinoX: numero("destinoX", 0, 1279), destinoY: numero("destinoY", 0, 799) };
    case "dialogo": if (typeof a.aceitar !== "boolean") throw new ErroDeDominio("entrada_invalida"); return { tipo: a.tipo, aceitar: a.aceitar, quadro: quadro(), ...(a.texto === undefined ? {} : { texto: texto("texto") }) };
    case "audio": return { tipo: a.tipo, segundos: numero("segundos", 1, 10) };
    case "digitar": return { tipo: a.tipo, quadro: quadro(), texto: texto("texto") };
    case "tecla": {
      const tecla = texto("tecla", 60);
      if (!/^(?:(?:Control|Meta|Alt|Shift)\+)*(?:Enter|Tab|Escape|Backspace|Delete|ArrowUp|ArrowDown|ArrowLeft|ArrowRight|Home|End|PageUp|PageDown|Space|F[1-9]|F1[0-2]|[a-zA-Z0-9])$/.test(tecla)) throw new ErroDeDominio("entrada_invalida");
      return { tipo: a.tipo, quadro: quadro(), tecla };
    }
    case "rolar": return { tipo: a.tipo, quadro: quadro(), delta: numero("delta", -2000, 2000) };
    case "abas": return a.aba === undefined ? { tipo: a.tipo } : { tipo: a.tipo, aba: Math.floor(numero("aba", 0, 30)) };
    case "arquivos": case "ler_arquivo": return { tipo: a.tipo, caminho: caminho() };
    case "ler_texto": {
      const inicio = a.inicio === undefined ? 0 : numero("inicio", 0, 2_097_152);
      const revisao = a.revisao === undefined ? undefined : texto("revisao", 64);
      if (!Number.isInteger(inicio) || (revisao !== undefined && !/^[a-f0-9]{64}$/.test(revisao)) || (inicio > 0 && !revisao)) throw new ErroDeDominio("entrada_invalida");
      return { tipo: a.tipo, caminho: caminho(), inicio, ...(revisao ? { revisao } : {}) };
    }
    case "gravar_texto": {
      const revisao = texto("revisao", 64);
      if (revisao !== "novo" && !/^[a-f0-9]{64}$/.test(revisao)) throw new ErroDeDominio("entrada_invalida");
      return { tipo: a.tipo, caminho: caminho(), texto: texto("texto", 131072), revisao };
    }
    case "gravar_arquivo": {
      const base64 = texto("base64", 699052);
      if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) throw new ErroDeDominio("entrada_invalida");
      return { tipo: a.tipo, caminho: caminho(), base64 };
    }
    case "anexar": return { tipo: a.tipo, quadro: quadro(), caminho: caminho() };
    case "terminal": { const comando = texto("comando"); if (!comando.trim()) throw new ErroDeDominio("entrada_invalida"); return { tipo: a.tipo, comando }; }
    default: throw new ErroDeDominio("entrada_invalida");
  }
}

export function alteraComputador(a: AcaoComputador): boolean {
  return !["observar", "arquivos", "ler_arquivo", "ler_texto", "audio"].includes(a.tipo) && !(a.tipo === "abas" && a.aba === undefined);
}

export function resumoAcaoComputador(a: AcaoComputador): string {
  if (a.tipo === "terminal") return `Executar no terminal: ${a.comando}`;
  if (a.tipo === "navegar") return `Abrir no navegador: ${a.url}`;
  if (a.tipo === "clicar") return `Clicar na posição ${a.x}, ${a.y} da tela observada`;
  if (a.tipo === "digitar") return `Digitar na tela: ${a.texto}`;
  if (a.tipo === "tecla") return `Pressionar ${a.tecla}`;
  if ("caminho" in a) return `${a.tipo}: ${a.caminho}`;
  return a.tipo;
}
