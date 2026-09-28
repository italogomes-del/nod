import { randomUUID } from "node:crypto";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { PlanoTurno } from "../contracts/plano-turno.ts";
import { classificarComando } from "../domain/comando.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { terminalLiberadoNaTarefa } from "./liberar-na-tarefa.ts";
import { PRAZO_DECISAO_MS } from "./pedir-a-pessoa.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import type { CasoDeUso } from "./tipos.ts";

/** O destino do item de aprovação de um comando: não é conector, é o terminal do Mac da pessoa (ADR-053). */
export const DESTINO_TERMINAL = { conector: "terminal", ferramenta: "bash" } as const;

/** Por que o comando rodou sem card — vai à trilha e aos testes, nunca ao modelo como permissão. */
export type SaidaAutorizarComando = { permitir: true; porque: "leitura" | "aprovado" | "liberado_na_tarefa" } | { aguardar: string };

/**
 * Cada comando do terminal do Mac da pessoa (definido em 2026-09-28, ADR-053, "terminal de verdade, como o
 * inhouse"). O hook do nod manda o comando ANTES de ele rodar; aqui se decide, nesta ordem:
 *
 *  1. só lê (classificarComando) e o turno não trouxe conteúdo da web → roda;
 *  2. a pessoa já aprovou ESTE comando nesta tarefa (a retomada refaz o que ela aprovou depois da espera) → roda;
 *  3. ela respondeu "Pode fazer e o resto desta tarefa" num comando, e o turno está limpo e fora do gate de
 *     rotina → roda;
 *  4. senão → card de aprovação na conversa, e o hook espera a resposta no próprio turno.
 *
 * Turno contaminado pela web (0033) pede até a leitura: um texto de página pode ter mandado o modelo "só olhar"
 * algo que vaza. Plano sem Bash é recusa — o hook de uma máquina antiga não abre porta.
 */
export const autorizarComando: CasoDeUso<{ plano: PlanoTurno; comando: string }, SaidaAutorizarComando> = async (deps, { plano, comando }) => {
  if (!(plano.nativas ?? []).includes("Bash")) throw new ErroDeDominio("nao_permitido", { cause: "Bash fora do plano deste turno" });
  const texto = comando.trim();
  if (texto === "" || texto.length > 8_000) throw new ErroDeDominio("entrada_invalida", { cause: "comando" });
  const contaminado = plano.confiancaEntrada !== "confiavel" || (await deps.repos.turnos.contaminado(plano.turnoId));
  if (classificarComando(texto).tipo === "leitura" && !contaminado) return { data: { permitir: true, porque: "leitura" } };
  if (await deps.repos.itensAprovacao.comandoAprovadoNaCadeia(plano.turnoId, texto)) return { data: { permitir: true, porque: "aprovado" } };
  if (!contaminado && !plano.politicaExecucao.efeitoExternoSoPorAprovacao && (await terminalLiberadoNaTarefa(deps, plano.turnoId))) {
    return { data: { permitir: true, porque: "liberado_na_tarefa" } };
  }

  const agora = deps.agora();
  const agente = await deps.repos.agentes.buscar(plano.agenteId);
  const decisao = await deps.repos.decisoes.criar({
    tipo: "aprovacao",
    agenteId: plano.agenteId,
    conversaId: plano.conversaId,
    turnoId: plano.turnoId,
    prazoDecisaoEm: agora + PRAZO_DECISAO_MS,
    frase: `${agente?.nome ?? "O bot"} quer rodar um comando no seu Mac`,
  });
  if (!decisao) throw new ErroDeDominio("estado_invalido", { cause: "decisão não criada" });
  await deps.repos.itensAprovacao.criarLote(decisao.id, [{ idx: 0, texto, destino: { ...DESTINO_TERMINAL, argumentos: { comando: texto } }, origemSensivel: false, motivoManual: "destino_terminal" }]);
  const evento: RuntimeEvent = {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: agora,
    kind: "decisao_criada",
    autoria: autoriaDoAgente(deps.escopo, plano.agenteId),
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: plano.conversaId,
    turnoId: plano.turnoId,
    dados: { decisao_id: decisao.id, tipo: "aprovacao", itens: 1, sensiveis: 0 },
  };
  return { data: { aguardar: decisao.id }, events: [evento] };
};
