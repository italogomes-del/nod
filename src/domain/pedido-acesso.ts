import type { AcessoPedido } from "../contracts/acesso.ts";
import type { CapacidadeConector, Conector } from "../contracts/conector.ts";
import type { ArgsPedirAcesso } from "../contracts/ferramentas-nod.ts";
import { APPS_MARKETPLACE } from "../contracts/marketplace.ts";
import { ErroDeDominio } from "./erro.ts";

type Catalogo = readonly Pick<CapacidadeConector, "nome" | "readOnlyHint">[];

/**
 * definido em 2026-09-24: a rotina não tem nome (ADR-043); o que a pessoa lê na lista de rotinas é a
 * instrução, então ela vira o nome na frase — primeira linha, cortada em palavra inteira.
 */
export const NOME_DA_ROTINA_NA_FRASE = 60;

/** As ferramentas que a sonda marcou como leitura (readOnlyHint, ADR-013): o que "só ler" concede. */
export function capacidadesDeLeitura(catalogo: Catalogo): string[] {
  return catalogo.filter((c) => c.readOnlyHint === true).map((c) => c.nome);
}

/**
 * Pedido de acesso com escopo nomeado (E6.2), puro desde 2026-09-24 (ADR-044; antes morava em
 * pedir-acesso.ts). Capacidade fora do catálogo sondado é recusada antes de chegar à conversa — o
 * agente nunca inventa escopo. App ausente ou desabilitado com capacidades [] vira pedido de CONEXÃO.
 * Em turno de rotina só se pede leitura, e [] quer dizer "as ferramentas de leitura deste app",
 * resolvidas aqui pelo catálogo. O nível segue o que é pedido de fato: 'leitura' com ferramenta de
 * escrita dentro seria rótulo mentiroso no card, então sobe para 'escrita' (e é recusado na rotina).
 */
export function normalizarPedidoAcesso(entrada: { pedido: ArgsPedirAcesso; conector: Pick<Conector, "habilitado" | "catalogo"> | null; emRotina: boolean }): AcessoPedido {
  const { pedido, conector, emRotina } = entrada;
  if (emRotina && pedido.nivel !== "leitura") throw new ErroDeDominio("nao_permitido", { cause: "turno de rotina só pede leitura" });
  const naoPedido = [...pedido.nao_pedido];
  const pedidas = [...new Set(pedido.capacidades)];
  if ((!conector || !conector.habilitado) && pedidas.length === 0) {
    if (!conector && !APPS_MARKETPLACE.some((app) => app.slug === pedido.conector)) throw new ErroDeDominio("entrada_invalida", { cause: `conector ${pedido.conector} não registrado` });
    return { conector: pedido.conector, capacidades: [], nivel: pedido.nivel, naoPedido, conectar: true };
  }
  if (!conector) throw new ErroDeDominio("entrada_invalida", { cause: `conector ${pedido.conector} não registrado` });
  const capacidades = pedidas.length === 0 && emRotina ? capacidadesDeLeitura(conector.catalogo) : pedidas;
  if (capacidades.length === 0) throw new ErroDeDominio("entrada_invalida", { cause: emRotina ? "o app não tem ferramenta de leitura" : "capacidades vazias para app já conectado" });
  const porNome = new Map(conector.catalogo.map((c) => [c.nome, c]));
  const desconhecidas = capacidades.filter((c) => !porNome.has(c));
  if (desconhecidas.length > 0) throw new ErroDeDominio("entrada_invalida", { cause: `capacidades fora do catálogo: ${desconhecidas.join(", ")}` });
  const escrita = capacidades.filter((c) => porNome.get(c)?.readOnlyHint !== true);
  if (emRotina && escrita.length > 0) throw new ErroDeDominio("nao_permitido", { cause: `turno de rotina só pede leitura: ${escrita.join(", ")}` });
  return { conector: pedido.conector, capacidades, nivel: escrita.length > 0 ? "escrita" : pedido.nivel, naoPedido };
}

function nomeDaRotina(instrucao: string): string {
  const linha = (instrucao.trim().split("\n")[0] ?? "").replace(/\s+/g, " ");
  if (linha.length <= NOME_DA_ROTINA_NA_FRASE) return linha;
  const corte = linha.slice(0, NOME_DA_ROTINA_NA_FRASE);
  const espaco = corte.lastIndexOf(" ");
  return `${(espaco > NOME_DA_ROTINA_NA_FRASE / 2 ? corte.slice(0, espaco) : corte).trimEnd()}…`;
}

const acoes = (n: number): string => `${n} ${n === 1 ? "ação" : "ações"}`;

/**
 * A frase da decisão 'acesso' em português de gente (definido em 2026-09-24, ADR-044): o nome do app,
 * o verbo pelo que é pedido DE FATO (ler/alterar, lido do readOnlyHint do catálogo, nunca do nível
 * que o modelo declarou) e o que fica de fora. Sem nome de ferramenta: a lista técnica vai para o
 * <details> do card. Sem artigo antes do nome do agente ("Nina precisa…"): o nome não diz o gênero.
 * Nada aqui vem de texto do modelo.
 */
export function fraseDoPedidoDeAcesso(entrada: {
  agente: string;
  slug: string;
  /** Nome que a pessoa deu ao conector no registro; o da curadoria do marketplace ganha dele. */
  nomeConector?: string | null;
  capacidades: readonly string[];
  catalogo: Catalogo;
  /** Instrução da rotina que pediu; ausente = pedido da conversa. */
  rotina?: string | null;
}): string {
  const curado = APPS_MARKETPLACE.find((a) => a.slug === entrada.slug);
  const app = curado?.nome ?? entrada.nomeConector ?? entrada.slug;
  const porNome = new Map(entrada.catalogo.map((c) => [c.nome, c]));
  const leitura = entrada.capacidades.filter((c) => porNome.get(c)?.readOnlyHint === true).length;
  const escrita = entrada.capacidades.length - leitura;
  const verbo = escrita === 0 ? "ler" : leitura === 0 ? "alterar" : "ler e alterar";
  const quem = `${entrada.agente} precisa ${verbo} seu ${app}${entrada.rotina ? ` para a rotina “${nomeDaRotina(entrada.rotina)}”` : ""}`;
  if (escrita === 0) {
    const deEscrita = entrada.catalogo.filter((c) => c.readOnlyHint !== true).length;
    const contagem = deEscrita > 0 ? ` (${acoes(deEscrita)} de escrita ${deEscrita === 1 ? "fica" : "ficam"} de fora)` : "";
    const fora = curado?.naoIncluiNaLeitura?.length ? curado.naoIncluiNaLeitura.join(", ") : `nada que altere o ${app}${contagem}`;
    return `${quem}. Não inclui: ${fora}.`;
  }
  const outras = entrada.catalogo.filter((c) => !entrada.capacidades.includes(c.nome)).length;
  return `${quem} (${acoes(entrada.capacidades.length)}).${outras > 0 ? ` Não inclui as outras ${acoes(outras)} do ${app}.` : ""}`;
}
