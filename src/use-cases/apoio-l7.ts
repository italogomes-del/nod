import { randomUUID } from "node:crypto";
import type { Agente } from "../contracts/agente.ts";
import type { Autoria, DadosEvento, KindEvento, RuntimeEvent } from "../contracts/evento.ts";
import type { Rotina } from "../contracts/rotina.ts";
import type { Turno } from "../contracts/turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { redigir } from "../domain/redacao.ts";
import { assentar, HANDOFFS_POR_RODADA, type DesfechoRodada, type Fala } from "../domain/rodada-sala.ts";
import { resumoCron } from "../domain/rotina-texto.ts";
import type { Repos } from "../repositories/tipos.ts";
import type { Escopo } from "../shared/types.ts";
import type { Deps } from "./tipos.ts";

/**
 * Apoio comum aos casos de uso de rotinas, salas e bot-a-bot (L7). Arquivo extra da lane, fora
 * da lista do plano: concentra o que os treze casos de uso repetiriam (autoria de sistema, eventos,
 * carimbos, a ligação turno → rotina) para não haver treze cópias divergindo.
 */

/**
 * definido em 2026-09-16: 24 h é o prazo de decisão do exemplo canônico da spec (E3.2: "item criado
 * às 8h com prazo de 24h"). NOD_PRAZO_DECISAO_MS existe no .env, mas `Deps` não carrega config;
 * até a L9 ligar o valor por composição, o prazo é esta constante (pendência de contrato registrada).
 */
export const PRAZO_DECISAO_MS = 24 * 60 * 60 * 1000;

/**
 * definido em 2026-09-16: um id que não tem o formato uuid nunca chega ao Postgres — viraria 22P02
 * (500 falha_interna, sem código na tabela fixa de erros.ts). Quem recebe id de fora (rota, corpo,
 * argumento de ferramenta) confere aqui e lança entrada_invalida.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function ehUuid(valor: unknown): valor is string {
  return typeof valor === "string" && UUID.test(valor);
}

export function assertUuid(valor: unknown, campo: string): string {
  if (!ehUuid(valor)) throw new ErroDeDominio("entrada_invalida", { cause: `campo ${campo}` });
  return valor;
}

/**
 * definido em 2026-09-16: mensagens e eventos escritos pelo SERVIDOR em nome da pessoa levam o
 * executor 'catcher', a mesma convenção de tests/helpers/fabricas.ts (executor padrão desta rodada,
 * AGENTS.md). Quando o turno vier do claude-cli, quem sabe o executor é o plano (L5/L9), e o
 * ContextoFerramenta não o carrega — pendência de contrato.
 */
export function autoriaPessoa(pessoaId: string, regra: `regra:${string}` | "pessoa" = "pessoa"): Autoria {
  return {
    autor_tipo: "pessoa",
    autor_id: pessoaId,
    sob_procuracao_de: null,
    conta_de_execucao: pessoaId,
    executor: "catcher",
    locality: "local",
    locality_reason: "tudo_local_nesta_rodada",
    machine_id: null,
    decidido_por: regra,
    regra_versao: 1,
  };
}

export function autoriaAgente(agenteId: string, contaDeExecucao: string, sobProcuracaoDe: string | null = null): Autoria {
  return {
    ...autoriaPessoa(contaDeExecucao, "regra:localidade"),
    autor_tipo: "agente",
    autor_id: agenteId,
    sob_procuracao_de: sobProcuracaoDe,
  };
}

/** Evento completo (ADR-005) dirigido à pessoa do escopo: o outbox só aceita owner = pessoa da sessão. */
export function evento(
  deps: Pick<Deps, "escopo" | "agora">,
  kind: KindEvento,
  autoria: Autoria,
  dados: DadosEvento,
  ref: { conversaId?: string | null; turnoId?: string | null } = {},
): RuntimeEvent {
  return {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: deps.agora(),
    kind,
    autoria,
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: ref.conversaId ?? null,
    turnoId: ref.turnoId ?? null,
    dados,
  };
}

/** "16/09/2026 08:00" no fuso dado (pt-BR, 24 h). Sem fuso = UTC com o rótulo. */
export function carimbo(instante: number, fusoIana = "UTC"): string {
  const texto = new Intl.DateTimeFormat("pt-BR", {
    timeZone: fusoIana,
    hourCycle: "h23",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(instante));
  return fusoIana === "UTC" ? `${texto} UTC` : texto;
}

/** Texto fixo de "rotina ativa" com periodicidade, próxima execução e fuso NOMEADO (E7.1). */
export function textoRotinaAtiva(rotina: Pick<Rotina, "cron" | "fusoIana" | "proximaExecucao">, agora: number): string {
  return redigir("rotina-proxima-execucao", agora, {
    resumo: resumoCron(rotina.cron, rotina.fusoIana),
    proxima: carimbo(rotina.proximaExecucao, rotina.fusoIana),
    fuso: rotina.fusoIana,
  });
}

export function exigir<T>(valor: T | null | undefined, codigo: "nao_encontrado" | "estado_invalido" = "nao_encontrado", cause?: string): T {
  if (valor === null || valor === undefined) throw new ErroDeDominio(codigo, { cause });
  return valor;
}

export async function agenteVisivel(repos: Repos, agenteId: string): Promise<Agente> {
  return exigir(await repos.agentes.buscar(agenteId), "nao_encontrado", "agente");
}

/**
 * Liga um turno à rotina que o disparou pela janela reivindicada (rotina_janelas.turno_id, índice da
 * 0004 — pendência L7 §5 resolvida). Turno de retomada segue `retomaTurnoId` um salto.
 */
export async function rotinaDoTurno(repos: Repos, turnoId: string): Promise<{ rotina: Rotina; turnoDisparado: Turno; instanteAgendado: number } | null> {
  const turno = await repos.turnos.buscar(turnoId);
  if (!turno) return null;
  const idDisparado = turno.origem === "retomada" && turno.retomaTurnoId ? turno.retomaTurnoId : turno.id;
  const disparado = idDisparado === turno.id ? turno : await repos.turnos.buscar(idDisparado);
  if (!disparado || disparado.origem !== "rotina") return null;
  const janela = await repos.rotinaJanelas.buscarPorTurno(disparado.id);
  if (!janela) return null;
  const rotina = await repos.rotinas.buscar(janela.rotinaId);
  return rotina ? { rotina, turnoDisparado: disparado, instanteAgendado: janela.instanteAgendado } : null;
}

export function mesmoEscopo(a: Escopo, b: Escopo): boolean {
  return a.tenantId === b.tenantId && a.pessoaId === b.pessoaId;
}

export type Rodada = { presentes: string[]; falas: Fala[]; desdeMs: number; desfecho: DesfechoRodada };

/**
 * Reconstrói a rodada corrente da sala a partir de DADO TIPADO (GRUPO.passe-tipado): a rodada é
 * tudo depois da última fala de PESSOA (autor_tipo, nunca inferido — ADR-023); as falas são as
 * mensagens de agente (kind texto → fala, kind passe → passe com motivo do payload); a causa de um
 * passe negado_fail_closed vem da mensagem `negacao` do MESMO agente e turno que a precede (o payload
 * de passe não tem `causa` — pendência de contrato registrada); presentes = quem teve turno na
 * rodada ou passou por ausência. O desfecho é o assentamento por contagem do domínio.
 */
export async function rodadaDaSala(repos: Repos, conversaId: string): Promise<Rodada> {
  const mensagens = await repos.mensagens.listarDaConversa(conversaId, 500);
  let desdeMs = 0;
  for (const m of mensagens) if (m.autoria.autor_tipo === "pessoa" && m.kind === "texto") desdeMs = m.criadoEm;
  const daRodada = mensagens.filter((m) => m.criadoEm > desdeMs);
  const falas: Fala[] = [];
  const presentes = new Set<string>();
  for (const m of daRodada) {
    if (m.autoria.autor_tipo !== "agente") continue;
    if (m.kind === "texto") falas.push({ agenteId: m.autoria.autor_id, tipo: "texto" });
    if (m.kind === "passe" && m.payload?.kind === "passe") {
      const anterior = [...daRodada].reverse().find((n) => n.criadoEm < m.criadoEm && n.kind === "negacao" && n.autoria.autor_id === m.autoria.autor_id && n.turnoId === m.turnoId);
      const causa = anterior?.payload?.kind === "negacao" ? anterior.payload.motivo : undefined;
      falas.push(causa ? { agenteId: m.autoria.autor_id, tipo: "passe", motivo: m.payload.motivo, causa } : { agenteId: m.autoria.autor_id, tipo: "passe", motivo: m.payload.motivo });
      presentes.add(m.autoria.autor_id);
    }
  }
  for (const t of await repos.turnos.listarDaConversa(conversaId, 200)) if (t.criadoEm > desdeMs) presentes.add(t.agenteId);
  const lista = [...presentes];
  return { presentes: lista, falas, desdeMs, desfecho: assentar(lista, falas) };
}

const TEXTO_DESFECHO: Record<Exclude<DesfechoRodada, "em_andamento">, string> = {
  assentou: "A rodada assentou: todos os bots presentes passaram a vez.",
  teto: `A rodada encerrou pelo teto de encaminhamentos (${HANDOFFS_POR_RODADA} por rodada sem fala humana).`,
  ninguem_disponivel: "Ninguém disponível nesta rodada.",
};

/** Escreve o desfecho da rodada como mensagem de sistema quando a fala recém-gravada a fechou (uma vez só). */
export async function fecharRodadaSeAssentou(deps: Pick<Deps, "repos" | "escopo" | "agora">, conversaId: string, antes: DesfechoRodada): Promise<DesfechoRodada> {
  const depois = (await rodadaDaSala(deps.repos, conversaId)).desfecho;
  if (antes === "em_andamento" && depois !== "em_andamento") {
    await deps.repos.mensagens.criar({
      conversaId,
      autoria: autoriaPessoa(deps.escopo.pessoaId, "regra:rodada-sala"),
      kind: "sistema",
      texto: TEXTO_DESFECHO[depois],
      confianca: "confiavel",
    });
  }
  return depois;
}
