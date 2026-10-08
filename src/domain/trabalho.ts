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
  decisaoPendente: boolean;
  ultimo: { estado: EstadoTurno; motivo: MotivoInterrupcao | null } | null;
};

/**
 * A tabela de estados da #192, derivada dos fatos (definido em 2026-10-07). Derivar em vez de transicionar evento a
 * evento deixa um lugar só para a regra: quem muda um turno ou uma decisão de um trabalho chama a sincronização e o
 * estado sai daqui.
 *
 * - turno com o Parar pedido e ainda acabando: `parado` (a renovação seguinte o encerra);
 * - turno rodando: `rodando`, ou `precisa_de_voce` se ele parou numa decisão (a aprovação dentro do turno);
 * - turno na fila: `rodando` se o trabalho já começou, senão `na_fila` (inclusive esperando o `depois_de`);
 * - nada vivo e decisão pendente: `precisa_de_voce` (ou continua `fechado_ocioso`, #194);
 * - nada vivo nem pendente: o desfecho do último turno — concluído `terminado`, parado pela pessoa `parado`, o resto
 *   `falhou` (máquina sumiu sem "Retomar", IA indisponível, erro).
 */
export function estadoDoTrabalho(f: FatosTrabalho): EstadoTrabalho {
  if (f.parando > 0 && f.despachando === 0) return "parado";
  if (f.despachando > 0) return f.decisaoPendente ? "precisa_de_voce" : "rodando";
  if (f.pendentes > 0) return f.iniciado ? "rodando" : "na_fila";
  if (f.decisaoPendente) return f.estadoAtual === "fechado_ocioso" ? "fechado_ocioso" : "precisa_de_voce";
  if (f.ultimo === null) return f.estadoAtual === "parado" ? "parado" : "na_fila";
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

/** `mandar_para_task` é da conversa coordenadora: só turno sem trabalho repassa a uma task. */
export function podeMandarParaTask(trabalho: unknown): boolean {
  return trabalho === null || trabalho === undefined;
}

/** definido em 2026-10-07 (ADR-081 §2): a resposta de conversa que passa disto trabalhando vira task sozinha. */
export const REDE_MS = 120_000;

/**
 * A rede de 2 min (#193): só o turno de CONVERSA da pessoa (nada de sala, ligação, rotina, colega ou retomada), sem
 * trabalho, rodando há REDE_MS, que já chamou ao menos uma ferramenta, e só com harness que bifurca sessão — sem
 * isso a próxima mensagem não teria como seguir a conversa sem atropelar a sessão do trabalho promovido.
 */
export function promoveNaRede(p: { origem: OrigemTurno; trabalhoId: string | null | undefined; estado: EstadoTurno; despachadoHaMs: number; fezFerramenta: boolean; capacidades: CapacidadesHarness }): boolean {
  return p.origem === "conversa" && !p.trabalhoId && p.estado === "despachando" && p.despachadoHaMs >= REDE_MS && p.fezFerramenta && p.capacidades.bifurcaSessao;
}

/** O que a linha "Abriu a task …" diz por origem (texto da mensagem `sistema`; a web desenha pelo payload). */
export function textoTrabalhoAberto(titulo: string, origem: OrigemTrabalho): string {
  return origem === "rede" ? `Virou a task ${titulo}` : `Abriu a task ${titulo}`;
}
