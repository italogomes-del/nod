import type { RuntimeEvent } from "../../contracts/evento.ts";
import { redigir } from "../../domain/redacao.ts";
import { log } from "../../obs/log.ts";
import { criarRepos } from "../../repositories/index.ts";
import type { Db, Escopo, Relogio, Transacao } from "../../shared/types.ts";
import { autoriaAgente, evento, PRAZO_DECISAO_PADRAO_MS } from "../../use-cases/autoria-evento.ts";
import { paraCadaPessoa, type OpcoesLaco } from "./escopos-de-fundo.ts";

/** definido em 2026-09-16: um sexto do lease (90 s) — um turno órfão fica no máximo 15 s a mais como 'despachando' (ADR-010). */
export const INTERVALO_VARREDOR_LEASE_MS = 15_000;

export type OpcoesVarredor = OpcoesLaco & { prazoDecisaoMs?: number };
export type ResultadoVarredura = { interrompidos: string[]; decisoes: string[] };

/**
 * Lease vencido (ADR-010/021, E9.4): o turno vira 'interrompido' maquina_sem_contato — transição
 * terminal e idempotente (só o que está vivo muda) — com a fala já gravada marcada como parcial, uma
 * decisão 'retomar_turno' em "Sua vez" e os eventos, na MESMA tx. NUNCA volta a 'pendente', NUNCA
 * reenvia (ADR-009): retomar é a pessoa, por turno novo. Rodar duas vezes cria UMA decisão porque
 * a segunda varredura já não vê o turno como 'despachando'.
 */
export async function varrerPessoa(tx: Transacao, escopo: Escopo, agora: number, opcoes: { prazoDecisaoMs?: number } = {}): Promise<ResultadoVarredura> {
  return tx(async (trx) => {
    const repos = criarRepos(trx, escopo);
    const saida: ResultadoVarredura = { interrompidos: [], decisoes: [] };
    const events: RuntimeEvent[] = [];
    for (const t of await repos.turnos.vencidos(agora)) {
      const interrompido = await repos.turnos.interromper(t.id, "maquina_sem_contato");
      if (!interrompido) continue;
      saida.interrompidos.push(t.id);
      await repos.mensagens.marcarParciaisDoTurno(t.id);
      const autoria = autoriaAgente({ agenteId: t.agenteId, contaDeExecucao: t.ownerId, executor: "catcher", machineId: t.machineId, decididoPor: "regra:varredor_lease" });
      const frase = redigir("turno-interrompido", agora, { motivo: "maquina_sem_contato" });
      const decisao = await repos.decisoes.criar({
        tipo: "retomar_turno",
        agenteId: t.agenteId,
        conversaId: t.conversaId,
        turnoId: t.id,
        prazoDecisaoEm: agora + (opcoes.prazoDecisaoMs ?? PRAZO_DECISAO_PADRAO_MS),
        frase,
      });
      const aviso = await repos.mensagens.criar({ conversaId: t.conversaId, turnoId: t.id, autoria, kind: "sistema", texto: frase, confianca: "confiavel" });
      events.push(evento(escopo, { kind: "turno_interrompido", autoria, agora, conversaId: t.conversaId, turnoId: t.id, dados: { motivo: "maquina_sem_contato", machine_id: t.machineId, lease_ate: t.leaseAte } }));
      if (decisao) {
        saida.decisoes.push(decisao.id);
        events.push(evento(escopo, { kind: "decisao_criada", autoria, agora, conversaId: t.conversaId, turnoId: t.id, dados: { decisao_id: decisao.id, tipo: "retomar_turno" } }));
      }
      if (aviso) events.push(evento(escopo, { kind: "mensagem_criada", autoria, agora, conversaId: t.conversaId, turnoId: t.id, dados: { mensagem_id: aviso.id, kind: "sistema" } }));
    }
    if (events.length) await repos.events.gravarComOutbox(events);
    return saida;
  });
}

/** Uma varredura por pessoa (paraCadaPessoa: tx REAL por pessoa; uma que falha não impede as outras). */
export async function varrer(db: Db, agora: number, opcoes: OpcoesVarredor = {}): Promise<Record<string, ResultadoVarredura>> {
  const saida: Record<string, ResultadoVarredura> = {};
  await paraCadaPessoa(
    db,
    async (escopo, tx) => {
      const r = await varrerPessoa(tx, escopo, agora, { prazoDecisaoMs: opcoes.prazoDecisaoMs });
      if (r.interrompidos.length) {
        saida[escopo.pessoaId] = r;
        log("aviso", "lease_vencido", { pessoa_id: escopo.pessoaId, interrompidos: r.interrompidos.length, decisoes: r.decisoes.length });
      }
    },
    { listarPessoas: opcoes.listarPessoas, aoFalhar: opcoes.aoFalhar },
  );
  return saida;
}

export function iniciarVarredorLease(p: { db: Db; relogio?: Relogio; intervaloMs?: number; opcoes?: OpcoesVarredor }): { parar(): void } {
  const relogio = p.relogio ?? (() => Date.now());
  let rodando = false;
  const tick = async () => {
    if (rodando) return;
    rodando = true;
    try {
      await varrer(p.db, relogio(), p.opcoes);
    } finally {
      rodando = false;
    }
  };
  const timer = setInterval(() => void tick(), p.intervaloMs ?? INTERVALO_VARREDOR_LEASE_MS);
  return { parar: () => clearInterval(timer) };
}
