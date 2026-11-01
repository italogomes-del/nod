import type { QuadroDto, TarefaDto } from "../../src/contracts/quadro.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import { STATUS, } from "./quadro.ts";

/**
 * NOD-442 (definido em 2026-10-31): o quadro de verdade na tela, sem DOM. Quem desenha é web/telas/quadro.ts; quem busca e
 * ouve os frames é web/lib/quadro-na-tela.ts. Aqui fica o que dá para testar em unidade: o código do card, quais cards
 * acendem depois de uma mudança, a frase da meta e a resposta que sobe na faixa da conversa no quadro.
 */

/** O código no canto do card: o do Linear; sem ele, os 4 primeiros do id (o card nasceu no quadro). */
export function codigoDaTarefa(t: Pick<TarefaDto, "id" | "linearId">): string {
  return t.linearId ?? `#${t.id.replace(/-/g, "").slice(0, 4)}`;
}

/** As tarefas por coluna (o status é o id dela, NOD-448), na ordem do quadro. */
export function tarefasPorStatus(q: Pick<QuadroDto, "tarefas"> & { colunas?: readonly { id: string }[] }): Record<string, TarefaDto[]> {
  const ids: readonly string[] = q.colunas?.map((c) => c.id) ?? STATUS;
  const por: Record<string, TarefaDto[]> = Object.fromEntries(ids.map((s) => [s, [] as TarefaDto[]]));
  for (const t of [...q.tarefas].sort((a, b) => a.ordem - b.ordem)) por[t.status]?.push(t);
  return por;
}

/** A impressão digital do card: o que, se mudar, faz o card acender (a resposta do agente "mexeu nele"). */
const digital = (t: TarefaDto): string => JSON.stringify([t.titulo, t.descricao, t.status, t.agenteId, t.prUrl, t.pergunta, t.resposta, t.execucao, t.mudadoEm]);

/**
 * Os cards que mudaram entre duas leituras do quadro (os novos inclusive). Sem leitura anterior, nenhum: abrir o quadro
 * não acende nada. `dica` são os ids que o frame `quadro.mudou` disse que mudaram (vêm antes da releitura).
 */
export function acesos(antes: QuadroDto | null, depois: QuadroDto | null, dica: readonly string[] = []): Set<string> {
  const r = new Set<string>();
  if (!antes || !depois || antes.id !== depois.id) return r;
  const velhos = new Map(antes.tarefas.map((t) => [t.id, digital(t)]));
  for (const t of depois.tarefas) if (velhos.get(t.id) !== digital(t) || dica.includes(t.id)) r.add(t.id);
  return r;
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
/** "até 6 nov" a partir de AAAA-MM-DD (sem fuso: o prazo é uma data, não um instante). */
export function fraseDoPrazo(prazo: string | null): string {
  const m = prazo ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(prazo) : null;
  if (!m) return "sem prazo";
  return `até ${Number(m[3])} ${MESES[Number(m[2]) - 1] ?? ""}`.trim();
}

/** O estado da faixa da conversa no quadro (o passo 9 do protótipo: carregando, a resposta, o erro). */
export type Faixa =
  | { tipo: "nada" }
  | { tipo: "aguardando"; pedidoId: string | null }
  | { tipo: "resposta"; texto: string; loteId: string | null; mensagemId: string; pedidoId?: string }
  | { tipo: "erro"; texto: string };

/**
 * A resposta que sobe na faixa: a primeira fala do bot anfitrião depois do pedido da pessoa (`pedidoId`, o id que o envio
 * devolveu; o relógio do aparelho não serve, o do servidor é outro). Uma linha: o texto sem a formatação de markdown, com
 * os espaços colapsados. null = ainda não respondeu (ou o pedido não está na janela).
 */
type Fala = Pick<Mensagem, "id" | "autoria" | "texto" | "criadoEm" | "parcial" | "kind"> & { payload?: Mensagem["payload"] };
export function respostaDoBot(mensagens: readonly Fala[], agenteId: string, pedidoId: string): { id: string; texto: string } | null {
  const i = mensagens.findIndex((m) => m.id === pedidoId);
  if (i < 0) return null;
  // A última fala final dele antes da próxima fala da pessoa: o "Vou organizar" do meio do turno dá lugar ao fecho (codex
  // rodada 5).
  let achada: { id: string; texto: string } | null = null;
  for (const m of mensagens.slice(i + 1)) {
    if (m.autoria.autor_tipo === "pessoa") break;
    if (m.kind !== "texto" || m.parcial || m.autoria.autor_tipo !== "agente" || m.autoria.autor_id !== agenteId || !m.texto.trim()) continue;
    // O aviso "Com você" que o quadro grava não é a resposta ao pedido.
    if (m.payload && typeof m.payload === "object" && "kind" in m.payload && m.payload.kind === "aviso_pessoa") continue;
    achada = { id: m.id, texto: linhaUnica(m.texto) };
  }
  return achada;
}

export function linhaUnica(texto: string): string {
  return texto.replace(/```[\s\S]*?```/g, " ").replace(/[*_`#>]+/g, "").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/\s+/g, " ").trim();
}

/** As últimas trocas do histórico da faixa (até 6), da mais antiga para a mais nova. */
export function historicoDaFaixa(mensagens: readonly Pick<Mensagem, "id" | "autoria" | "texto" | "criadoEm" | "kind" | "parcial">[], agenteId: string, n = 6): { id: string; de: "eu" | "bot"; texto: string; em: number }[] {
  return mensagens
    .filter((m) => m.kind === "texto" && !m.parcial && m.texto.trim() && (m.autoria.autor_tipo === "pessoa" || m.autoria.autor_id === agenteId))
    .slice(-n)
    .map((m) => ({ id: m.id, de: m.autoria.autor_tipo === "pessoa" ? "eu" : "bot", texto: linhaUnica(m.texto), em: m.criadoEm }));
}

/** A tarefa aberta saiu do quadro (excluída ou o quadro trocou): volta para o quadro. */
export function tarefaNoQuadro(q: QuadroDto | null, id: string | null): TarefaDto | null {
  return id && q ? (q.tarefas.find((t) => t.id === id) ?? null) : null;
}

/* ---------- NOD-415 (ADR-141): meta opcional e o menu de prazo ---------- */

const DIA_MS = 86_400_000;
/** O dia de hoje em São Paulo (UTC−3), AAAA-MM-DD. */
export function hojeEmSP(agora: number): string {
  return new Date(agora - 3 * 3_600_000).toISOString().slice(0, 10);
}
const somarDias = (dia: string, n: number): string => new Date(Date.parse(`${dia}T12:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);

/** Os atalhos do menu de prazo (o protótipo): Hoje, Amanhã, Sexta (a próxima, ou hoje se for sexta), Sábado e Fim do mês. */
export function atalhosDePrazo(agora: number): { rotulo: string; valor: string }[] {
  const hoje = hojeEmSP(agora);
  const dow = new Date(`${hoje}T12:00:00Z`).getUTCDay();
  const ate = (alvo: number): number => (alvo - dow + 7) % 7;
  const [a, m] = [Number(hoje.slice(0, 4)), Number(hoje.slice(5, 7))];
  const fimDoMes = new Date(Date.UTC(a, m, 0, 12)).toISOString().slice(0, 10);
  return [
    { rotulo: "Hoje", valor: hoje },
    { rotulo: "Amanhã", valor: somarDias(hoje, 1) },
    { rotulo: "Sexta", valor: somarDias(hoje, ate(5)) },
    { rotulo: "Sábado", valor: somarDias(hoje, ate(6)) },
    { rotulo: "Fim do mês", valor: fimDoMes },
  ];
}

/** Quanto falta para o prazo, pela data de São Paulo: "vence hoje", "falta 1 dia", "faltam 3 dias", "venceu". */
export function faltaParaOPrazo(prazo: string | null, agora: number): string {
  if (!prazo || !/^\d{4}-\d{2}-\d{2}$/.test(prazo)) return "";
  const dias = Math.round((Date.parse(`${prazo}T12:00:00Z`) - Date.parse(`${hojeEmSP(agora)}T12:00:00Z`)) / DIA_MS);
  if (dias < 0) return "venceu";
  if (dias === 0) return "vence hoje";
  return dias === 1 ? "falta 1 dia" : `faltam ${dias} dias`;
}
