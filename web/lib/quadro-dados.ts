import type { ColunaDto, EntradaHistoricoDto, LoteQuadro, QuadroDaPessoaDto, QuadroDto, TarefaDto } from "../../src/contracts/quadro.ts";
import type { Mensagem } from "../../src/contracts/mensagem.ts";
import { STATUS, } from "./quadro.ts";
import { GRUPOS, NOME_DO_GRUPO, comColunas } from "./colunas.ts";

/**
 * NOD-442 (definido em 2026-10-31): o quadro de verdade na tela, sem DOM. Quem desenha é web/telas/quadro.ts; quem busca e
 * ouve os frames é web/lib/quadro-na-tela.ts. Aqui fica o que dá para testar em unidade: o código do card, quais cards
 * acendem depois de uma mudança, a frase da meta e a resposta que sobe na faixa da conversa no quadro.
 */

/** NOD-416: o parâmetro do link da tarefa (`?tarefa=ZE-12`). */
export const PARAMETRO_TAREFA = "tarefa";

/**
 * Revisão 2 do PR #623: em Precisa de você o responsável efetivo é a pessoa. O select do Responsável mostra "Você" com
 * este valor (opção desligada); quem aplica o campo o ignora, porque não é bot nenhum.
 */
export const RESP_VOCE = "__voce__";

/**
 * O código no canto do card: o do quadro (NOD-416: prefixo + número, ZE-12, estável); de um servidor velho sem ele, o do
 * Linear e, por último, os 4 primeiros do id.
 */
export function codigoDaTarefa(t: Pick<TarefaDto, "id" | "linearId"> & { codigo?: string }): string {
  return t.codigo || (t.linearId ?? `#${t.id.replace(/-/g, "").slice(0, 4)}`);
}

/**
 * Revisão 4 do PR #623: o formato que `lerCodigo` (src/domain/codigo-tarefa.ts) aceita. A web não importa valor de src/
 * (só `import type`), então a regra é copiada aqui; tests/unit/web/quadro-real.test.ts confere as duas com os mesmos casos.
 */
export const FORMATO_CODIGO = /^#?([A-Za-z]{1,3}[0-9]*)-([1-9][0-9]{0,8})$/;

/**
 * O que vai para `?tarefa=`. Só o código do quadro resolve no servidor: ele passa em `lerCodigo` e termina no número da
 * tarefa. Revisão 4 do PR #623: número sozinho não basta; com número mas o quadro ainda sem prefixo (o servidor de antes o
 * criou, janela de deploy), o código é o provisório (`#ABCD`, o id do Linear), e aí vai o uuid, que o servidor também aceita.
 * O id do Linear tem cara de código (NOD-12): igual a ele, também vai o uuid.
 */
export function codigoNaUrl(t: Pick<TarefaDto, "id"> & { numero?: number | null; codigo?: string; linearId?: string | null }): string {
  const c = t.codigo?.trim() ?? "";
  const m = FORMATO_CODIGO.exec(c);
  const doQuadro = typeof t.numero === "number" && !!m && Number(m[2]) === t.numero && !c.startsWith("#") && c !== t.linearId;
  return doQuadro ? c : t.id;
}

/**
 * Revisão 2 do PR #623: o recibo de Nova tarefa sai da resposta. A tarefa nasce na primeira espera que não aciona (pode não
 * ser o Backlog) e, num quadro sem ela, nasce sem iniciar; quem começou vem em `comecaram`, nunca de um palpite da tela.
 */
export function reciboDaNovaTarefa(titulo: string, r: { quadro: QuadroDto | null; lote: Pick<LoteQuadro, "tarefaIds"> | null; comecaram?: readonly { agenteNome: string }[] }): string {
  const id = r.lote?.tarefaIds[0];
  const nova = id ? r.quadro?.tarefas.find((x) => x.id === id) : undefined;
  const coluna = nova && r.quadro ? (comColunas(r.quadro).colunas.find((c) => c.id === nova.status)?.nome ?? nova.status) : null;
  const nomes = [...new Set((r.comecaram ?? []).map((c) => c.agenteNome))];
  const quem = nomes.length ? `${nomes.join(" e ")} ${nomes.length === 1 ? "começou" : "começaram"}` : "Ninguém começou";
  return `${titulo}: ${coluna ? `em ${coluna}` : "criada"}. ${quem}.`;
}

/**
 * Revisão 2 do PR #623: o que a faixa diz quando o mover falha. O servidor manda o porquê como `motivo` (lista branca,
 * RECUSAS_DO_MOVER); sem motivo, num 4xx, a frase dele; sem rede, a de sempre. `reler`: o quadro mudou, relê.
 */
const FRASE_DO_MOVER: Record<string, string> = {
  ja_neste_quadro: "ela já está nesse quadro.",
  fora_do_quadro: "ela não está mais neste quadro.",
  tarefa_sumiu: "ela não existe mais.",
  quadro_sumiu: "a tarefa ou o quadro não existe mais.",
  mudou_de_quadro: "outra mudança levou a tarefa para outro quadro antes.",
};
export function fraseDoErroDoMover(e: { status?: number; codigo?: string; motivo?: string | null; message?: string } | null | undefined): { texto: string; reler: boolean } {
  if (e?.codigo === "servidor_indisponivel" || e?.codigo === "sem_internet") return { texto: "Sem conexão com o servidor agora. Tente de novo em instantes.", reler: false };
  const porque = e?.motivo ? FRASE_DO_MOVER[e.motivo] : undefined;
  if (porque) return { texto: `Não deu para mudar a tarefa de quadro: ${porque} Relendo.`, reler: true };
  if (e?.status && e.status >= 400 && e.status < 500 && e.message) return { texto: `Não deu para mudar a tarefa de quadro. ${e.message}`, reler: true };
  return { texto: "Não deu para mudar a tarefa de quadro. Relendo.", reler: true };
}

/**
 * Revisão 2 do PR #623: o link da tarefa espera o bot dela aparecer na lista da pessoa, mas só enquanto a lista não chegou.
 * Lida a lista sem o bot (excluído, oculto ou de outra pessoa), devolve null na hora, para a tela avisar, em vez de
 * esperar o teto (10 s) em silêncio. `esperar` é o relógio (o teste passa um falso).
 */
export async function botDoLink<B>(achar: () => B | undefined, listaLida: () => boolean, esperar: (ms: number) => Promise<void>, vezes = 40): Promise<B | null> {
  for (let i = 0; i < vezes; i++) {
    const b = achar();
    if (b) return b;
    if (listaLida()) return null;
    await esperar(250);
  }
  return achar() ?? null;
}

/** NOD-416: as opções do Status da tarefa aberta, por grupo (Não iniciado, Andamento, Feito, Fechado), na ordem do quadro. */
export function opcoesDeStatus(colunas: readonly Pick<ColunaDto, "id" | "nome" | "grupo">[]): { grupo: string; colunas: { id: string; nome: string }[] }[] {
  return GRUPOS.map((g) => ({ grupo: NOME_DO_GRUPO[g], colunas: colunas.filter((c) => c.grupo === g).map((c) => ({ id: c.id, nome: c.nome })) })).filter((g) => g.colunas.length > 0);
}

/**
 * NOD-416: os bots que podem ser o Responsável da tarefa aberta: os ativos da pessoa. O Nod fica fora (ele não pega
 * tarefa do quadro; revisão do PR #623), e também os excluídos, os ocultos e os de outra pessoa.
 */
export function responsaveisDaTarefa(agentes: readonly { id: string; nome: string; papel?: string | null; ownerId?: string | null; excluidoEm?: number | null; oculto?: boolean | null }[], pessoaId: string | null | undefined): { id: string; nome: string }[] {
  return agentes.filter((a) => a.papel !== "nod" && !a.excluidoEm && !a.oculto && !!pessoaId && a.ownerId === pessoaId).map((a) => ({ id: a.id, nome: a.nome }));
}

/** NOD-416: o "Mover para…": os outros quadros da pessoa (o da tarefa fica de fora), pelo nome do bot. */
export function destinosDaTarefa(quadros: readonly QuadroDaPessoaDto[], quadroId: string): { id: string; nome: string }[] {
  return quadros.filter((q) => q.id !== quadroId).map((q) => ({ id: q.id, nome: q.prefixo ? `${q.agenteNome} (${q.prefixo})` : q.agenteNome })).sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
}

/** A hora em São Paulo; a data só quando não é hoje. */
function quandoFoi(em: number, agora: number): string {
  const hora = new Date(em).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
  if (hojeEmSP(em) === hojeEmSP(agora)) return hora;
  return `${new Date(em).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", day: "numeric", month: "short" }).replace(".", "")}, ${hora}`;
}

/**
 * NOD-416: uma linha do histórico da tarefa aberta: quem (Você, o bot, Regra), o que mudou e quando. A regra é o motor (o
 * começo leva a Fazendo, a coluna que saiu leva as tarefas dela); o autor sem nome é o bot que já saiu.
 */
export function linhaDoHistorico(e: Pick<EntradaHistoricoDto, "campo" | "de" | "para" | "deNome" | "paraNome" | "autor" | "autorNome" | "criadoEm">, agora: number = Date.now()): { quem: string; oque: string; quando: string } {
  const quem = e.autor === "pessoa" ? "Você" : e.autor === "regra" ? "Regra" : (e.autorNome ?? "Um bot");
  const de = e.deNome ?? e.de;
  const para = e.paraNome ?? e.para;
  const oque =
    e.campo === "criada" ? `criou em ${para ?? "—"}`
    : e.campo === "restaurada" ? `restaurou em ${para ?? "—"}`
    : e.campo === "status" ? `Status: ${de ?? "—"} → ${para ?? "—"}`
    : e.campo === "agente" ? (para ? (de ? `Responsável: ${de} → ${para}` : `Responsável: ${para}`) : `tirou o responsável${de ? ` (${de})` : ""}`)
    : `mudou de quadro: ${de ?? "—"} → ${para ?? "—"}`;
  return { quem, oque, quando: quandoFoi(e.criadoEm, agora) };
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
