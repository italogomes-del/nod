import type { DonoDto, EsperaDoDonoDto, EstadoDoDono } from "../contracts/dono.ts";
import { VOLTAS_SEM_NOVIDADE } from "../contracts/ferramentas-trabalho.ts";
import type { Trabalho } from "../contracts/trabalho.ts";
import { estadoDoDono, tentativaDaEspera, ultimaLinha } from "../domain/estado-do-dono.ts";
import { linhaCurta, trabalhoAberto } from "../domain/trabalho.ts";
import type { FatosCrusDosDonos } from "../repositories/donos.repo.ts";
import type { Deps } from "./tipos.ts";

type DepsDono = Pick<Deps, "repos" | "agora">;

/**
 * O dono de cada bot para a tela (definido em 2026-10-12, ADR-099 item 10, I10): o estado da linha (calculado no
 * servidor, src/domain/estado-do-dono.ts), as esperas e a fila. `abertos`: os trabalhos abertos que quem chama já leu
 * (GET trabalhos, a conversa); ausente, lê os de cada bot. Vai em `GET trabalhos` (por bot), no `ConversaDto` (o bot da
 * conversa própria) e, só o estado, no frame `trabalho.mudou` (despachar-outbox.ts).
 */
export async function donosDosBots(deps: DepsDono, agenteIds: readonly string[], abertos?: readonly Trabalho[]): Promise<Map<string, DonoDto>> {
  const ids = [...new Set(agenteIds)];
  const agora = deps.agora();
  const crus = await deps.repos.donos.fatos(ids, agora);
  const esperas = await esperasDosDonos(deps, crus);
  const donos = new Map<string, DonoDto>();
  for (const agenteId of ids) {
    const frentes = (abertos ?? (await deps.repos.trabalhos.abertosDoAgente(agenteId))).filter((t) => t.agenteId === agenteId && trabalhoAberto(t.estado));
    const minhas = esperas.filter((e) => e.agenteId === agenteId).map(({ agenteId: _a, ...e }) => e);
    // A rotina aparece pela primeira linha da instrução, como a etiqueta da task (`rotinaNome`).
    const fila = crus.fila.filter((p) => p.agenteId === agenteId).map(({ agenteId: _a, ...p }) => (p.de === "rotina" && p.nome ? { ...p, nome: linhaCurta(p.nome) } : p));
    const estado = estadoDoDono({
      agenteId,
      frentes: frentes.map((t) => ({ id: t.id, estado: t.estado, vivo: crus.frentesVivas.has(t.id), iniciadoEm: t.iniciadoEm, criadoEm: t.criadoEm })),
      conversaTrabalhandoDesde: crus.vivos.get(agenteId) ?? null,
      conversaPropriaTrabalhandoDesde: crus.vivosPropria.get(agenteId) ?? null,
      decisoes: crus.decisoes.get(agenteId) ?? { quantas: 0, desde: null },
      esperas: minhas,
      fila,
    });
    donos.set(agenteId, { estado, esperas: minhas, fila });
  }
  return donos;
}

/** Só o estado (a linha fechada) de um bot, lido agora — o que o frame `trabalho.mudou` leva. */
export async function estadoDoDonoAgora(deps: DepsDono, agenteId: string): Promise<EstadoDoDono | null> {
  return (await donosDosBots(deps, [agenteId])).get(agenteId)?.estado ?? null;
}

/**
 * As esperas de todos os bots lidos, na ordem em que começaram: os comandos (com a última linha da tentativa anterior e a
 * tentativa N de 3, pelas voltas da mesma cadeia), as voltas marcadas e os pedidos a colega sem resposta.
 */
async function esperasDosDonos(deps: DepsDono, crus: FatosCrusDosDonos): Promise<(EsperaDoDonoDto & { agenteId: string })[]> {
  const comandos: (EsperaDoDonoDto & { agenteId: string })[] = [];
  for (const c of crus.comandos) {
    const voltas = c.emVolta ? (await deps.repos.turnos.ultimasVoltas(c.origem, VOLTAS_SEM_NOVIDADE + 1)).slice(1) : [];
    comandos.push({ agenteId: c.agenteId, tipo: "comando", trabalhoId: c.trabalhoId, motivo: c.motivo, desde: c.desde, comando: c.comando, ultimaLinha: ultimaLinha(c.saidaAnterior), tentativa: tentativaDaEspera(voltas, c.emVolta), tentativas: VOLTAS_SEM_NOVIDADE });
  }
  const voltas = crus.voltas.map((v) => ({ agenteId: v.agenteId, tipo: "volta" as const, trabalhoId: v.trabalhoId, motivo: v.motivo?.trim() || "a volta marcada", desde: v.desde, acordaEm: v.acordaEm }));
  const colegas = crus.colegas.map((c) => ({
    agenteId: c.agenteId, tipo: "colega" as const, trabalhoId: c.trabalhoId, motivo: c.nome ?? "um colega", desde: c.desde,
    colega: { id: c.colegaId, removido: c.colegaRemovido, trabalhando: c.colegaTrabalhando, fila: c.colegaFila },
  }));
  return [...comandos, ...voltas, ...colegas].sort((a, b) => a.desde - b.desde);
}

