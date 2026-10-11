import type { EpochMs } from "../contracts/ids.ts";
import type { EstadoDaIa, EstadoIa, InstalacaoDaIa, LoginDaIa, OrigemDoBinario } from "../contracts/estado-ia.ts";
import type { Inventario } from "../contracts/inventario.ts";

/**
 * O estado único de uma IA (definido em 2026-10-09; o contrato e o significado de cada estado estão em
 * src/contracts/estado-ia.ts). Puro: o app do Mac junta o que sabe e chama `estadoDaIa`; a web, quando só tem o
 * inventário do servidor, chama com o resto vazio.
 *
 * Precedência (a primeira que vale ganha): instalando (o app está mexendo no CLI) › entrando (login aberto) › testando
 * › procurando (sem sonda ainda) › no_limite › o que o inventário diz. Uma instalação ou um login já terminados não
 * mudam o estado — vão junto, para a tela mostrar o resultado.
 */
export type EntradaEstadoIa = {
  ia: EstadoIa["ia"];
  /** O inventário já com o veredito do teste (o que a vigia anuncia); null antes da primeira sonda. */
  inventario: Inventario | null;
  instalacao?: InstalacaoDaIa | null;
  login?: LoginDaIa | null;
  testando?: boolean;
  /** A assinatura está no limite até este instante (vem com o PR do servidor; null = sem limite conhecido). */
  limiteAte?: EpochMs | null;
  binario?: { caminho: string; origem: OrigemDoBinario } | null;
  agora: EpochMs;
};

/** As frases curtas de cada estado (a tela põe o nome da IA ao lado). */
export const MENSAGEM_DO_ESTADO: Record<EstadoDaIa, string> = {
  procurando: "Procurando neste Mac…",
  nao_instalada: "Não está instalado neste Mac.",
  instalando: "Instalando…",
  desatualizada: "A versão deste Mac é antiga para o nod.",
  sem_node: "Precisa do Node.js, que não foi encontrado neste Mac.",
  falta_entrar: "Falta entrar na sua conta.",
  entrando: "Esperando você entrar na conta…",
  testando: "Testando a conta…",
  pronta: "Pronto.",
  sem_acesso: "A conta entrou, mas não respondeu.",
  no_limite: "A assinatura chegou ao limite.",
  config_invalida: "A configuração tem um erro.",
  lenta: "Demorou para responder; tentando de novo.",
};

function doInventario(inv: Inventario): Pick<EstadoIa, "estado" | "mensagem" | "versao" | "minima" | "causa"> {
  if (inv.estado === "pronto") return { estado: "pronta", mensagem: MENSAGEM_DO_ESTADO.pronta, versao: inv.versao };
  const versao = inv.versao ? { versao: inv.versao } : {};
  if (inv.causa === "sonda_lenta") return { estado: "lenta", mensagem: MENSAGEM_DO_ESTADO.lenta, ...versao };
  if (inv.estado === "ausente") {
    if (inv.causa === "cli_antigo") {
      const minima = inv.minima ? { minima: inv.minima } : {};
      const frase = inv.versao && inv.minima ? `A versão deste Mac (${inv.versao}) é antiga; o nod precisa da ${inv.minima} ou mais nova.` : MENSAGEM_DO_ESTADO.desatualizada;
      return { estado: "desatualizada", mensagem: frase, ...versao, ...minima };
    }
    if (inv.causa === "sem_node") return { estado: "sem_node", mensagem: MENSAGEM_DO_ESTADO.sem_node };
    if (inv.causa === "config_invalida") return { estado: "config_invalida", mensagem: MENSAGEM_DO_ESTADO.config_invalida };
    return { estado: "nao_instalada", mensagem: MENSAGEM_DO_ESTADO.nao_instalada };
  }
  if (inv.causa === "conta_sem_acesso") return { estado: "sem_acesso", mensagem: "A conta entrou, mas está sem acesso: a organização desativou o uso por assinatura.", causa: inv.causa, ...versao };
  if (inv.causa === "teste_falhou") return { estado: "sem_acesso", mensagem: "A conta entrou, mas não respondeu ao teste.", causa: inv.causa, ...versao };
  return { estado: "falta_entrar", mensagem: MENSAGEM_DO_ESTADO.falta_entrar, ...versao };
}

export function estadoDaIa(e: EntradaEstadoIa): EstadoIa {
  const extras: Partial<EstadoIa> = {
    ...(e.binario ? { detalhe: { binario: e.binario.caminho, origem: e.binario.origem } } : {}),
    ...(e.instalacao ? { instalacao: e.instalacao } : {}),
    ...(e.login ? { login: e.login } : {}),
  };
  const base = (estado: EstadoDaIa, mensagem = MENSAGEM_DO_ESTADO[estado]): EstadoIa => ({ ia: e.ia, estado, mensagem, ...extras, em: e.agora });
  if (e.instalacao?.fase === "instalando") return base("instalando", e.instalacao.mensagem || MENSAGEM_DO_ESTADO.instalando);
  if (e.login?.fase === "aguardando") return base("entrando", e.login.mensagem || MENSAGEM_DO_ESTADO.entrando);
  if (e.testando) return base("testando");
  if (!e.inventario) return base("procurando");
  const doInv = doInventario(e.inventario);
  if (doInv.estado === "pronta" && e.limiteAte && e.limiteAte > e.agora) return { ...base("no_limite"), ...(doInv.versao ? { versao: doInv.versao } : {}), ate: e.limiteAte };
  return { ia: e.ia, ...doInv, ...extras, em: e.agora };
}
