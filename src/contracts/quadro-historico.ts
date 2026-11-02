import type { AutorLote } from "./quadro.ts";

/**
 * NOD-416 (ADR-144): o histórico da tarefa, o link pelo código e os quadros da pessoa. Fica separado do quadro.ts para
 * não passar do teto de linhas dos contratos; o quadro.ts reexporta tudo.
 */

/** Quem fez uma mudança no histórico: a pessoa, um bot ou o próprio quadro (a regra). */
export type AutorHistorico = AutorLote | { tipo: "regra" };
/** `restaurada` = o Desfazer devolveu a tarefa que o lote tinha excluído (`para` = a coluna em que ela voltou). */
export type CampoHistorico = "criada" | "status" | "agente" | "quadro" | "restaurada";

/** Uma mudança da tarefa. `de`/`para` = o id da coluna (status), do bot (agente; null = ninguém) ou do quadro. */
export type MudancaTarefa = { tarefaId: string; campo: CampoHistorico; de: string | null; para: string | null; autor: AutorHistorico };

/** A linha do histórico como a tela a recebe: com os nomes já resolvidos. */
export type EntradaHistoricoDto = {
  id: string;
  campo: CampoHistorico;
  de: string | null;
  para: string | null;
  /** O nome legível de `de`/`para` (a coluna, o bot ou o anfitrião do quadro); null quando não há mais. */
  deNome: string | null;
  paraNome: string | null;
  autor: "pessoa" | "agente" | "regra";
  autorAgenteId: string | null;
  autorNome: string | null;
  criadoEm: number;
};

/** O link da tarefa (`?tarefa=ZE-12`) resolvido: onde ela está hoje e o código atual (difere quando ela mudou de quadro). */
export type TarefaPorCodigoDto = { agenteId: string; quadroId: string; tarefaId: string; codigo: string; codigoAtual: string };

/** Um quadro da pessoa, para o "Mover para…" da tarefa aberta. */
export type QuadroDaPessoaDto = { id: string; agenteId: string; agenteNome: string; prefixo: string | null };
