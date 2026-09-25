import type { Agente } from "../../src/contracts/agente.ts";
import type { CapacidadeConector, Conector } from "../../src/contracts/conector.ts";
import type { Estado } from "../estado/reducer.ts";
import { esc } from "../lib/render.ts";

/**
 * O que o card do chat, o marketplace e o painel do bot dizem sobre um app (definido em 2026-09-25,
 * jornadas de conexão). A web só importa tipos de src/: o grupo de cada ação chega pronto de
 * GET /conectores (`grupo`, src/domain/grupos-de-acesso.ts) e o nível é a mesma regra daquele arquivo.
 */

export type Nivel = "nenhum" | "leitura" | "escrita";
export type IdGrupo = NonNullable<CapacidadeConector["grupo"]>;
type Ctx = Pick<Estado, "conectores" | "marketplace" | "sessao">;

export const ROTULO_GRUPO: Record<IdGrupo, string> = { ler: "Ler", criar: "Criar e enviar", alterar: "Editar", comentar: "Comentar", apagar: "Apagar" };
const ORDEM: readonly IdGrupo[] = ["ler", "criar", "alterar", "comentar", "apagar"];
export const ROTULO_NIVEL: Record<Nivel, string> = { nenhum: "Nenhum", leitura: "Ler", escrita: "Ler e alterar" };

export function nomeDoApp(ctx: Pick<Estado, "conectores" | "marketplace">, slug: string): string {
  return ctx.marketplace.find((a) => a.slug === slug)?.nome ?? ctx.conectores.find((c) => c.slug === slug)?.nome ?? slug;
}

/** O conector DESTA pessoa para o app (o habilitado, se houver dois registros). */
export function conectorDoApp(ctx: Ctx, slug: string): Conector | undefined {
  const meus = ctx.conectores.filter((c) => c.slug === slug && (!ctx.sessao || c.ownerId === ctx.sessao.pessoaId));
  return meus.find((c) => c.habilitado) ?? meus[0];
}

export type SituacaoApp = "nao_conectado" | "conectando" | "conectado" | "atencao";

/**
 * Um estado só por app (o marketplace mostrava ✓ e erro no mesmo cartão). A falha só vale se é MAIS
 * NOVA que a última sonda boa: um erro velho de rede não pinta de âmbar um app que já voltou.
 */
export function situacaoDoApp(estado: Ctx & Pick<Estado, "conectando">, slug: string): SituacaoApp {
  const c = conectorDoApp(estado, slug);
  if (estado.conectando[slug] && !estado.conectando[slug]?.falhou) return "conectando";
  if (!c) return "nao_conectado";
  const falhaNova = c.ultimaFalha && (c.sondadoEm === null || c.ultimaFalha.em >= c.sondadoEm);
  if (falhaNova) return "atencao";
  return c.habilitado ? "conectado" : c.sondadoEm ? "atencao" : "nao_conectado";
}

function grupoDe(cap: Pick<CapacidadeConector, "readOnlyHint" | "grupo">): IdGrupo {
  return cap.grupo ?? (cap.readOnlyHint ? "ler" : "alterar");
}

/** Mesma regra de capacidadesDoNivel (src/domain/grupos-de-acesso.ts). */
export function capacidadesDoNivel(catalogo: readonly CapacidadeConector[], nivel: Nivel): string[] {
  if (nivel === "nenhum") return [];
  return catalogo.filter((c) => (nivel === "leitura" ? grupoDe(c) === "ler" : grupoDe(c) !== "apagar")).map((c) => c.nome);
}

export function nivelDoBot(estado: Pick<Estado, "concessoes">, agenteId: string, conector: Conector): Nivel {
  const concedidas = (estado.concessoes[agenteId] ?? []).filter((g) => g.conectorId === conector.id).map((g) => g.capacidade);
  if (concedidas.length === 0) return "nenhum";
  const leitura = new Set(conector.catalogo.filter((c) => c.readOnlyHint).map((c) => c.nome));
  return concedidas.some((n) => !leitura.has(n)) ? "escrita" : "leitura";
}

export function botsQueUsam(estado: Pick<Estado, "concessoes" | "frota" | "sessao">, conector: Conector): { agente: Agente; nivel: Nivel }[] {
  return meusBots(estado).map((agente) => ({ agente, nivel: nivelDoBot(estado, agente.id, conector) })).filter((b) => b.nivel !== "nenhum");
}

export function meusBots(estado: Pick<Estado, "frota" | "sessao">): Agente[] {
  return (estado.frota?.agentes ?? []).filter((a) => a.ownerId === estado.sessao?.pessoaId && a.confirmado);
}

/** Os grupos de um conjunto de ações, na ordem fixa: "Ler · 12 ações". */
export function gruposDe(catalogo: readonly CapacidadeConector[], nomes: readonly string[]): { id: IdGrupo; rotulo: string; capacidades: string[] }[] {
  const por = new Map<IdGrupo, string[]>();
  const porNome = new Map(catalogo.map((c) => [c.nome, c]));
  for (const n of nomes) {
    const cap = porNome.get(n);
    const g = cap ? grupoDe(cap) : "alterar";
    por.set(g, [...(por.get(g) ?? []), n]);
  }
  return ORDEM.filter((g) => por.has(g)).map((g) => ({ id: g, rotulo: ROTULO_GRUPO[g], capacidades: por.get(g) ?? [] }));
}

export const acoes = (n: number): string => `${n} ${n === 1 ? "ação" : "ações"}`;

/**
 * O que o nível deixa o bot fazer e o que fica de fora, em frases — antes do login não há catálogo, então
 * a frase é do nível; o "não inclui" curado (naoIncluiNaLeitura) ganha da genérica.
 */
export function podeENao(ctx: Pick<Estado, "conectores" | "marketplace">, slug: string, nivel: "leitura" | "escrita", naoPedido: readonly string[] = []): { pode: string[]; nao: string[] } {
  const nome = nomeDoApp(ctx, slug);
  const curado = ctx.marketplace.find((m) => m.slug === slug)?.naoIncluiNaLeitura;
  if (nivel === "leitura") {
    const nao = curado?.length ? [`Não inclui: ${curado.join(", ")}`] : [`Não cria, altera nem apaga nada no ${nome}`];
    return { pode: [`Ver e ler o que está no ${nome}`], nao: [...nao, ...naoPedido.map((n) => `Não inclui: ${n}`)] };
  }
  return { pode: [`Ler, criar, editar e comentar no ${nome}`], nao: ["Apagar fica de fora", ...naoPedido.map((n) => `Não inclui: ${n}`)] };
}

const CHECK = '<svg class="ic-ok" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3 7-7"></path></svg>';
const XIS = '<svg class="ic-nao" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"></path></svg>';
export const SETA_EXTERNA = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 3h7v7M13 3 5 11"></path></svg>';
export const GIRO = '<span class="giro" aria-hidden="true"></span>';
export { CHECK as ICONE_OK };

export function listaPodeENao(pn: { pode: string[]; nao: string[] }): string {
  return `<ul class="pode-nao">${pn.pode.map((t) => `<li>${CHECK}${esc(t)}</li>`).join("")}${pn.nao.map((t) => `<li class="nao">${XIS}${esc(t)}</li>`).join("")}</ul>`;
}

/** Os dois passos do card: 1 entrar no app, 2 permitir ao bot. */
export function passos(app: string, bot: string, ativo: 1 | 2): string {
  const passo = (n: 1 | 2, rotulo: string) => {
    const estado = n < ativo ? "feito" : n === ativo ? "ativo" : "depois";
    return `<li class="passo passo-${estado}"><span class="passo-num">${n < ativo ? CHECK : n}</span>${esc(rotulo)}</li>`;
  };
  return `<ol class="passos" aria-label="Passos">${passo(1, `Entrar no ${app}`)}${passo(2, `Permitir ao ${bot}`)}</ol>`;
}

/** O bloco "esperando você entrar" (card do chat, gaveta e cartão do marketplace). */
export function blocoEsperando(nome: string, url: string | null, curto = false): string {
  const link = url ? `<a class="link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Abrir o login de novo ${SETA_EXTERNA}</a>` : "";
  return curto
    ? `<div class="esperando esperando-curto">${GIRO}<span>Esperando você entrar no ${esc(nome)}…</span></div>`
    : `<div class="esperando">${GIRO}<div><b>Esperando você entrar no ${esc(nome)}</b><p>A janela de login está aberta. Quando terminar, isto continua sozinho.</p>${link}</div></div>`;
}

export function blocoFalhou(frase: string): string {
  return `<p class="conexao-falhou" role="status">${esc(frase)}</p>`;
}
