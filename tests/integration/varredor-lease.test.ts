import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-lease.ts";
import { LEASE_MS } from "../../src/shared/constantes.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { enviarMensagem } from "../../src/use-cases/enviar-mensagem.ts";
import { depsSobreTrx, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };

describeIntegracao("varredor de lease (ADR-010/021, E9.4): órfão vira interrompido + decisão, nunca reenvio", () => {
  it("lease vencido → interrompido maquina_sem_contato, fala parcial, decisão 'retomar_turno', mensagem e eventos; 2x → UMA decisão; nunca 'pendente'", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const deps = depsSobreTrx(trx, MARLON, { relogio: () => agora });
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: PRONTO });
      const maquina = randomUUID();
      const turnoId = (await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO })).data.plano?.turnoId ?? "";
      await deps.repos.mensagens.criar({ conversaId: criado.conversa.id, turnoId, autoria: { ...(await deps.repos.mensagens.ultimaDaConversa(criado.conversa.id))!.autoria, autor_tipo: "agente", autor_id: criado.agente.id }, kind: "texto", texto: "comecei a resp", confianca: "confiavel" });

      expect(await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS - 1)).toEqual({ interrompidos: [], decisoes: [] });
      const primeira = await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 1);
      expect(primeira.interrompidos).toEqual([turnoId]);
      expect(primeira.decisoes).toHaveLength(1);
      expect(await deps.repos.turnos.buscar(turnoId)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "maquina_sem_contato", leaseAte: null });
      const decisao = await deps.repos.decisoes.buscar(primeira.decisoes[0] ?? "");
      expect(decisao).toMatchObject({ tipo: "retomar_turno", estado: "pendente", turnoId, conversaId: criado.conversa.id, decisorId: MARLON.pessoaId });
      const mensagens = (await deps.repos.mensagens.listarDaConversa(criado.conversa.id)).filter((m) => m.turnoId === turnoId);
      expect(mensagens.map((m) => [m.kind, m.parcial])).toEqual([
        ["texto", true],
        ["sistema", false],
      ]);
      const eventos = await trx<{ kind: string }[]>`select kind from events where turno_id = ${turnoId} and created_at > ${new Date(agora)}`;
      expect(eventos.map((e) => e.kind).sort()).toEqual(["decisao_criada", "mensagem_criada", "turno_interrompido"]);

      const segunda = await varrerPessoa(deps.tx, MARLON, agora + LEASE_MS + 5000);
      expect(segunda).toEqual({ interrompidos: [], decisoes: [] });
      expect(await deps.repos.decisoes.pendentesDaConversa(criado.conversa.id)).toHaveLength(1);
      expect(await deps.repos.turnos.renovarLease(turnoId, maquina, {}, agora + LEASE_MS + 5000)).toEqual({ ativo: false });
      expect(await deps.repos.turnos.reivindicar({ machineId: maquina, agora: agora + LEASE_MS + 5000 })).toBeNull();
      const estados = await trx<{ estado: string }[]>`select estado from turnos where conversa_id = ${criado.conversa.id}`;
      expect(estados.map((e) => e.estado)).toEqual(["interrompido"]);
    });
  });
});
