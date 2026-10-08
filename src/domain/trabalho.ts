import type { CapacidadesHarness } from "../contracts/harness.ts";
import type { MotivoInterrupcao } from "../contracts/motivos.ts";
import { ESTADOS_ABERTOS_TRABALHO, type EstadoTrabalho, type OrigemTrabalho } from "../contracts/trabalho.ts";
import type { EstadoTurno, OrigemTurno } from "../contracts/turno.ts";

/**
 * Regras puras dos trabalhos (definido em 2026-10-07, ADR-081, épico #188). Quem lê o banco e grava é o caso de uso
 * (src/use-cases/trabalhos.ts); aqui só decisão.
 */

/** CHECK trabalho_titulo da 0060. */
export const TITULO_TRABALHO_MAX = 200;

/** Estados em que o trabalho acabou: o `depois_de` de outro libera, e a linha vai para "Terminados hoje". */
export const ESTADOS_FINAIS_TRABALHO = ["terminado", "parado", "falhou"] as const satisfies readonly EstadoTrabalho[];

export function trabalhoAberto(estado: EstadoTrabalho): boolean {
  return (ESTADOS_ABERTOS_TRABALHO as readonly EstadoTrabalho[]).includes(estado);
}

export function trabalhoFinal(estado: EstadoTrabalho): boolean {
  return (ESTADOS_FINAIS_TRABALHO as readonly EstadoTrabalho[]).includes(estado);
}

/**
 * definido em 2026-10-07: o título vem do que o bot ou a pessoa escreveu — a primeira linha, sem espaço repetido,
 * cortada em 80 caracteres com reticências (a faixa e a linha do chat têm uma linha só). Vazio vira "Trabalho".
 */
export function tituloDoTrabalho(texto: string): string {
  const primeira = texto.split("\n").map((l) => l.replace(/\s+/g, " ").trim()).find((l) => l !== "") ?? "";
  if (primeira === "") return "Trabalho";
  return primeira.length > 80 ? `${primeira.slice(0, 79).trimEnd()}…` : primeira;
}

/**
 * A pasta do trabalho dentro da pasta do bot (convenção da ADR-065: `~/nod/<bot>/<repo>-<task>`). definido em
 * 2026-10-07: o slug do título mais os 6 primeiros caracteres do id — dois trabalhos com o mesmo título nunca
 * dividem pasta (critério 2 da #192). Só [a-z0-9-], até 40 caracteres antes do sufixo.
 */
export function slugDoTrabalho(titulo: string, id: string): string {
  const base = titulo
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");
  const sufixo = id.replace(/[^a-z0-9]/gi, "").slice(0, 6).toLowerCase();
  return `${base === "" ? "task" : base}-${sufixo}`;
}

/** `~/nod/<pastaDoBot>/<slug>`, a forma que `trabalhos.pasta` guarda e a tela mostra. */
export function pastaDoTrabalho(pastaDoBot: string, titulo: string, id: string): string {
  return `~/nod/${pastaDoBot}/${slugDoTrabalho(titulo, id)}`;
}

/** O caminho relativo a `~/nod` que o plano leva em `pastaDoBot` (o driver faz `join(home, "nod", …)`). */
export function pastaRelativa(pasta: string): string | null {
  const m = /^~\/nod\/(.+)$/.exec(pasta);
  return m?.[1] ?? null;
}

/**
 * O que se sabe de um trabalho para decidir o estado dele, lido de uma vez (trabalhosRepo.fatos). `ultimo` é o
 * turno terminal mais recente; `decisaoPendente`: alguma decisão pendente (pergunta, aprovação, acesso, "Retomar")
 * de um turno dele.
 */
export type FatosTrabalho = {
  estadoAtual: EstadoTrabalho;
  iniciado: boolean;
  /** Turnos rodando com o Parar já pedido (o processo ainda está acabando). */
  parando: number;
  despachando: number;
  pendentes: number;
  /** O trabalho de `depois_de` ("Fazer depois da …") ainda não acabou: o turno na fila espera por ele. */
  esperandoOutro: boolean;
  decisaoPendente: boolean;
  /**
   * definido em 2026-10-08 (revisão do épico, S3): pedidos a colegas (`pedir_a_bot`) feitos por um turno do trabalho que
   * ainda não voltaram — handoff sem peer_ask da mesma tarefa, a regra de `pedidosEmAberto` (entregar-resposta-peer.ts).
   * A resposta vira a continuação do trabalho: até lá ele está trabalhando, não terminou.
   */
  aguardandoColega: boolean;
  ultimo: { estado: EstadoTurno; motivo: MotivoInterrupcao | null } | null;
};

/**
 * A tabela de estados da #192, derivada dos fatos (definido em 2026-10-07). Derivar em vez de transicionar evento a
 * evento deixa um lugar só para a regra: quem muda um turno ou uma decisão de um trabalho chama a sincronização e o
 * estado sai daqui.
 *
 * - turno com o Parar pedido e ainda acabando, sem outro na fila: `parado` (a renovação seguinte o encerra);
 * - turno rodando: `rodando`, ou `precisa_de_voce` se ele parou numa decisão (a aprovação dentro do turno) — ou segue
 *   `fechado_ocioso` se a memória já mandou soltar essa espera (#194) e o processo está acabando;
 * - turno na fila: `rodando` se o trabalho já começou, senão `na_fila`; esperando o `depois_de`, sempre `na_fila`
 *   (revisto em 2026-10-08: "Fazer depois" com a task já começada a devolve à fila — fazerDepois);
 * - nada vivo e já `parado`: continua `parado` (revisão do épico, S1, 2026-10-08) — nem a decisão que sobrou nem o
 *   desfecho do turno que acabou depois do Parar o reabrem; só um turno novo (a pessoa escreveu na task) o tira daí;
 * - nada vivo e decisão pendente: `precisa_de_voce` (ou continua `fechado_ocioso`, #194);
 * - nada vivo e pedido a colega sem resposta: `rodando` (S3) — a resposta volta como turno do trabalho;
 * - nada vivo nem pendente: o desfecho do último turno — concluído `terminado`, parado pela pessoa `parado`, o resto
 *   `falhou` (máquina sumiu sem "Retomar", IA indisponível, erro).
 */
export function estadoDoTrabalho(f: FatosTrabalho): EstadoTrabalho {
  if (f.parando > 0 && f.despachando === 0 && f.pendentes === 0) return "parado";
  if (f.despachando > 0) return f.decisaoPendente ? (f.estadoAtual === "fechado_ocioso" ? "fechado_ocioso" : "precisa_de_voce") : "rodando";
  if (f.pendentes > 0) return f.iniciado && !f.esperandoOutro ? "rodando" : "na_fila";
  if (f.estadoAtual === "parado") return "parado";
  if (f.decisaoPendente) return f.estadoAtual === "fechado_ocioso" ? "fechado_ocioso" : "precisa_de_voce";
  if (f.aguardandoColega) return "rodando";
  if (f.ultimo === null) return "na_fila";
  if (f.ultimo.estado === "concluido") return "terminado";
  if (f.ultimo.motivo === "parado_pela_pessoa") return "parado";
  return "falhou";
}

/**
 * Quem pode abrir task (`abrir_task`, #193): a conversa (turno sem trabalho) e o trabalho de rotina sem mãe
 * (profundidade 1: a rotina abre, as filhas não). Trabalho da pessoa, de colega ou da rede não abre: ele já é a task.
 */
export function podeAbrirTask(trabalho: { origem: OrigemTrabalho; trabalhoMaeId: string | null } | null): boolean {
  return trabalho === null || (trabalho.origem === "rotina" && trabalho.trabalhoMaeId === null);
}

/**
 * definido em 2026-10-08 (revisão do épico, S12, decisão do Marlon): uma execução de rotina abre no máximo isto de tasks;
 * a seguinte é recusada com instrução. Sem teto por bot — o limite é a máquina (ADR-081 §4).
 */
export const TETO_TASKS_POR_EXECUCAO_DE_ROTINA = 10;

/** `mandar_para_task` é da conversa coordenadora: só turno sem trabalho repassa a uma task. */
export function podeMandarParaTask(trabalho: unknown): boolean {
  return trabalho === null || trabalho === undefined;
}

/**
 * definido em 2026-10-07 (ADR-081 §4, #194): sob pressão amarela (ou pior), a task que espera a pessoa DENTRO do turno
 * há mais disto solta a espera: o turno encerra, o processo fecha e a decisão segue pendente, voltando por --resume.
 */
export const FECHAR_OCIOSA_SOB_PRESSAO_MS = 5 * 60_000;

/** A espera de uma decisão dentro do turno deve ser solta para liberar memória? Só com a máquina sob pressão. */
export function soltarPorMemoria(p: { nivel: "verde" | "amarela" | "vermelha" | null; esperandoDesde: number; agora: number }): boolean {
  return (p.nivel === "amarela" || p.nivel === "vermelha") && p.agora - p.esperandoDesde > FECHAR_OCIOSA_SOB_PRESSAO_MS;
}

/** definido em 2026-10-07 (ADR-081 §2): a resposta de conversa que passa disto trabalhando vira task sozinha. */
export const REDE_MS = 120_000;

/**
 * A rede de 2 min (#193): só o turno de CONVERSA da pessoa (nada de sala, ligação, rotina, colega ou retomada), sem
 * trabalho, rodando há REDE_MS, que já chamou ao menos uma ferramenta, e só com harness que bifurca sessão — sem
 * isso a próxima mensagem não teria como seguir a conversa sem atropelar a sessão do trabalho promovido.
 * `redeMs` existe só para o e2e (definido em 2026-10-08): ausente, vale REDE_MS.
 */
export function promoveNaRede(p: { origem: OrigemTurno; trabalhoId: string | null | undefined; estado: EstadoTurno; despachadoHaMs: number; fezFerramenta: boolean; capacidades: CapacidadesHarness; redeMs?: number }): boolean {
  return p.origem === "conversa" && !p.trabalhoId && p.estado === "despachando" && p.despachadoHaMs >= (p.redeMs ?? REDE_MS) && p.fezFerramenta && p.capacidades.bifurcaSessao;
}

/** O que a linha "Abriu a task …" diz por origem (texto da mensagem `sistema`; a web desenha pelo payload). */
export function textoTrabalhoAberto(titulo: string, origem: OrigemTrabalho): string {
  return origem === "rede" ? `Virou a task ${titulo}` : `Abriu a task ${titulo}`;
}
