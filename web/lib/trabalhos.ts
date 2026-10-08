import type { EstadoTrabalho, NivelPressao, TrabalhoDto } from "../../src/contracts/trabalho.ts";
import type { Estado, FiltroTrabalhos, Tela } from "../estado/reducer.ts";
import { duracaoCurta } from "./relogio.ts";
import { esc } from "./render.ts";

/**
 * Trabalhos (ADR-081, épico #188): o que a faixa, a barra, a gaveta, "Todos os trabalhos" e as linhas do chat leem dos
 * trabalhos da pessoa. Puro: recebe o estado (ou a lista) e devolve dados ou HTML curto, sem DOM.
 */

/**
 * Os estados em que o trabalho conta como aberto. É a lista de `ESTADOS_ABERTOS_TRABALHO` (src/contracts/trabalho.ts):
 * a web só importa TIPO de src/ (eslint), então ela é repetida aqui e tests/unit/web/trabalhos.test.ts confere as duas.
 */
export const ESTADOS_ABERTOS: readonly EstadoTrabalho[] = ["na_fila", "rodando", "precisa_de_voce", "fechado_ocioso"];

export const aberto = (t: Pick<TrabalhoDto, "estado">): boolean => ESTADOS_ABERTOS.includes(t.estado);

/**
 * Os trabalhos que a tela conhece: a lista de `GET trabalhos` primeiro (é a mais nova a cada `trabalho.mudou`), depois os
 * que a conversa trouxe (`ConversaDto.trabalhos`, os abertos do bot dela) e os das telas de task já abertas.
 */
export function trabalhosConhecidos(estado: Pick<Estado, "trabalhos" | "conversas" | "trabalhoDetalhe">, conversaId?: string | null): TrabalhoDto[] {
  const lista: TrabalhoDto[] = [...(estado.trabalhos?.trabalhos ?? [])];
  const ids = new Set(lista.map((t) => t.id));
  const somar = (t: TrabalhoDto): void => {
    if (ids.has(t.id)) return;
    ids.add(t.id);
    lista.push(t);
  };
  for (const t of conversaId ? estado.conversas[conversaId]?.trabalhos ?? [] : []) somar(t);
  for (const d of Object.values(estado.trabalhoDetalhe)) somar(d.trabalho);
  return lista;
}

export function trabalhoPorId(estado: Pick<Estado, "trabalhos" | "conversas" | "trabalhoDetalhe">, id: string): TrabalhoDto | undefined {
  return estado.trabalhoDetalhe[id]?.trabalho ?? trabalhosConhecidos(estado).find((t) => t.id === id) ?? Object.values(estado.conversas).flatMap((c) => c.trabalhos ?? []).find((t) => t.id === id);
}

/** Os trabalhos abertos de um bot, do mais antigo ao mais novo (a ordem da faixa). */
export function abertosDoBot(estado: Pick<Estado, "trabalhos" | "conversas" | "trabalhoDetalhe">, agenteId: string, conversaId?: string | null): TrabalhoDto[] {
  return trabalhosConhecidos(estado, conversaId)
    .filter((t) => t.agenteId === agenteId && aberto(t))
    .sort((a, b) => a.criadoEm - b.criadoEm);
}

/** A etiqueta de origem ("de você", "rotina", "pedido do Chico"): a mesma na faixa, na gaveta e em "Todos os trabalhos". */
export function etiquetaOrigem(t: Pick<TrabalhoDto, "origem" | "pedidoPorNome">): string {
  if (t.origem === "rotina") return "rotina";
  if (t.origem === "colega") return `pedido do ${t.pedidoPorNome ?? "colega"}`;
  return "de você";
}

/** O instante em que o trabalho começou a contar tempo: o início do primeiro turno, ou a criação. */
export const inicioDe = (t: Pick<TrabalhoDto, "iniciadoEm" | "criadoEm">): number => t.iniciadoEm ?? t.criadoEm;

/** "26 min" rodando; terminado, a duração inteira (do início ao fim). */
export function tempoDe(t: Pick<TrabalhoDto, "iniciadoEm" | "criadoEm" | "terminadoEm">, agora: number): string {
  return duracaoCurta((t.terminadoEm ?? agora) - inicioDe(t));
}

/**
 * O que o trabalho está fazendo, em poucas palavras: o último passo, quem segura o computador, ou o estado. Sem o tempo
 * (quem desenha junta "· 15 min" quando cabe).
 */
export function situacaoDe(t: TrabalhoDto, todos: readonly TrabalhoDto[] = []): string {
  if (t.esperandoComputadorDe) return `esperando o computador (em uso por: ${t.esperandoComputadorDe})`;
  switch (t.estado) {
    case "na_fila": {
      const antes = t.depoisDeTrabalhoId ? todos.find((x) => x.id === t.depoisDeTrabalhoId) : undefined;
      return antes ? `começa depois da ${antes.titulo}` : "na fila";
    }
    case "precisa_de_voce":
      return t.ultimoPasso ?? "precisa de você";
    case "fechado_ocioso":
      return "esperando você · fechada para liberar memória";
    case "rodando":
      return t.ultimoPasso ?? "trabalhando";
    case "terminado":
      return "terminou";
    case "parado":
      return "você parou";
    case "falhou":
      return "não terminou";
  }
}

/** "620 MB", "1,4 GB". */
export function memoriaLegivel(mb: number): string {
  if (mb < 1024) return `${Math.round(mb)} MB`;
  return `${(mb / 1024).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} GB`;
}

/** A meia-noite do dia de `agora` no relógio da pessoa: "Terminados hoje" vale a partir dela. */
export function meiaNoiteDe(agora: number): number {
  const d = new Date(agora);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export type GruposTrabalhos = { precisa: TrabalhoDto[]; trabalhando: TrabalhoDto[]; fila: TrabalhoDto[]; terminados: TrabalhoDto[] };

/** Os que mais usam memória primeiro; sem leitura, depois deles, do mais novo ao mais antigo. */
const porMemoria = (a: TrabalhoDto, b: TrabalhoDto): number => (b.memoriaMb ?? -1) - (a.memoriaMb ?? -1) || b.criadoEm - a.criadoEm;

/**
 * Os grupos da gaveta e de "Todos os trabalhos" (#196): Precisa de você (esperando a pessoa, aberto ou fechado para
 * liberar memória), Trabalhando, Na fila e Terminados hoje — o que terminou (ou parou, ou falhou) antes da meia-noite sai.
 */
export function agrupar(lista: readonly TrabalhoDto[], agora: number): GruposTrabalhos {
  const hoje = meiaNoiteDe(agora);
  const precisa = lista.filter((t) => t.estado === "precisa_de_voce" || t.estado === "fechado_ocioso").sort(porMemoria);
  const trabalhando = lista.filter((t) => t.estado === "rodando").sort(porMemoria);
  const fila = lista.filter((t) => t.estado === "na_fila").sort((a, b) => a.criadoEm - b.criadoEm);
  const terminados = lista
    .filter((t) => !aberto(t) && (t.terminadoEm ?? t.criadoEm) >= hoje)
    .sort((a, b) => (b.terminadoEm ?? b.criadoEm) - (a.terminadoEm ?? a.criadoEm));
  return { precisa, trabalhando, fila, terminados };
}

export function filtrar(lista: readonly TrabalhoDto[], filtro: FiltroTrabalhos | undefined): TrabalhoDto[] {
  if (!filtro || filtro === "todos") return [...lista];
  if (filtro === "rotinas") return lista.filter((t) => t.origem === "rotina");
  if (filtro === "bots") return lista.filter((t) => t.origem === "colega");
  return lista.filter((t) => t.origem === "pessoa" || t.origem === "rede");
}

/** "A", "A e B", "A, B e C". */
export function juntar(nomes: readonly string[]): string {
  if (nomes.length <= 1) return nomes[0] ?? "";
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** O Parar do chat com tasks abertas pergunta antes (#195): "Parar 2 tasks: Migrar relatórios e Dashboard de churn?". */
export function textoPararTasks(lista: readonly Pick<TrabalhoDto, "titulo">[]): string {
  if (lista.length === 1) return `Parar a task ${lista[0]?.titulo ?? ""}?`;
  return `Parar ${lista.length} tasks: ${juntar(lista.map((t) => t.titulo))}?`;
}

/** O ponto do trabalho: na cor do bot (`c-*`), piscando enquanto roda; azul quando espera a pessoa; vazado na fila. */
export function pontoTrabalho(t: Pick<TrabalhoDto, "estado">, cor: string | undefined): string {
  if (t.estado === "precisa_de_voce" || t.estado === "fechado_ocioso") return '<span class="ponto-trabalho precisa" aria-hidden="true"></span>';
  if (t.estado === "na_fila") return '<span class="ponto-trabalho na-fila" aria-hidden="true"></span>';
  if (!aberto(t)) return '<span class="ponto-trabalho feito" aria-hidden="true">✓</span>';
  return `<span class="ponto-trabalho ${esc(cor ?? "")}${t.estado === "rodando" ? " pulso-trab" : ""}" aria-hidden="true"></span>`;
}

/**
 * A pílula de memória (#196): amarela "Pouca memória no seu Mac · N trabalhos abertos · Ver" e vermelha "Seu Mac está
 * quase sem memória · pode travar". Centralizada; o "Ver" abre "Todos os trabalhos". Verde ou sem leitura, nada.
 */
export function pilulaMemoria(nivel: NivelPressao | null, abertos: number, comVer = true): string {
  if (nivel !== "amarela" && nivel !== "vermelha") return "";
  const n = `${abertos} ${abertos === 1 ? "trabalho aberto" : "trabalhos abertos"}`;
  const miolo = nivel === "amarela"
    ? `<b>Pouca memória no seu Mac</b><span class="pm-detalhe">· ${n}</span>`
    : `<b>Seu Mac está quase sem memória</b><span class="pm-detalhe">· pode travar; ${n}</span>`;
  const papel = nivel === "vermelha" ? ' role="alert"' : ' role="status"';
  return comVer
    ? `<div class="linha-centro-wrap"${papel}><button type="button" class="pilula-memoria ${nivel}" data-act="navegar" data-tela="trabalhos">${miolo}<span class="pm-ver">Ver</span></button></div>`
    : `<div class="linha-centro-wrap"${papel}><span class="pilula-memoria ${nivel}">${miolo}</span></div>`;
}

/**
 * A tela da task a partir da tela atual (#195): o Fechar volta para onde a pessoa estava. De dentro de outra task (ou de
 * uma linha), o `voltar` de fora continua — Fechar nunca vira uma pilha de tasks.
 */
export function telaDaTask(atual: Tela, id: string): Extract<Tela, { tipo: "trabalho" }> {
  return { tipo: "trabalho", id, voltar: atual.tipo === "trabalho" || atual.tipo === "linha" ? atual.voltar : atual };
}

/** Para onde o Fechar (ou o Esc) da tela da task e da tela provisória leva; null = não é uma delas. */
export function telaAoFechar(atual: Tela): Tela | null {
  return atual.tipo === "trabalho" || atual.tipo === "linha" ? atual.voltar : null;
}
