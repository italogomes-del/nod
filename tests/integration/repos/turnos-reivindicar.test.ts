import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { criarRepos } from "../../../src/repositories/index.ts";
import { LEASE_MS } from "../../../src/shared/constantes.ts";
import { expectRejected } from "../../helpers/expect-rejected.ts";
import { agenteComConversa } from "../../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_LEAPY } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON };
const MAQUINA = randomUUID();
const base = (conversaId: string, agenteId: string, extra: Partial<Parameters<ReturnType<typeof criarRepos>["turnos"]["enfileirar"]>[0]> = {}) => ({
  conversaId,
  agenteId,
  origem: "conversa" as const,
  prazoEm: Date.now() + 60_000,
  profundidade: 0 as const,
  entradaTexto: "oi",
  entradaConfianca: "confiavel" as const,
  modelo: "claude-haiku-4-5-20251001",
  ...extra,
});

describeIntegracao("turnosRepo: fila por conversa (ADR-010), prioridade humana (EMENDA 12) e agente serial (EMENDA 13)", () => {
  it("nasce pendente com sinais zerados; reivindicar põe despachando com lease e attempted; 2º da mesma conversa espera o 1º assentar", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const t1 = await repos.turnos.enfileirar(base(conversaId, agenteId));
      const t2 = await repos.turnos.enfileirar(base(conversaId, agenteId));
      expect(t1).toMatchObject({ estado: "pendente", sinais: { attempted: false, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null });

      const agora = Date.now();
      const r1 = await repos.turnos.reivindicar({ machineId: MAQUINA, agora });
      expect(r1).toMatchObject({ id: t1?.id, estado: "despachando", machineId: MAQUINA, sinais: { attempted: true } });
      expect(r1?.leaseAte).toBe(agora + LEASE_MS);

      // Serialização por conversa: t2 não sai enquanto t1 está despachando.
      expect(await repos.turnos.reivindicar({ machineId: MAQUINA, agora })).toBeNull();
      expect(await repos.turnos.pendentesRenderizaveis(conversaId)).toEqual([{ id: t2?.id, motivo: "agente_ocupado_em", conversaId }]);

      await repos.turnos.assentar(t1?.id ?? "", { estado: "concluido", sinais: { promptSubmitted: true, producedOutput: true }, custoUsd: 0.02 });
      const r2 = await repos.turnos.reivindicar({ machineId: MAQUINA, agora });
      expect(r2?.id).toBe(t2?.id);
      expect((await repos.turnos.buscar(t1?.id ?? ""))).toMatchObject({ estado: "concluido", custoUsd: 0.02, leaseAte: null, sinais: { promptSubmitted: true, producedOutput: true } });
    });
  });

  it("EMENDA 12: turno de conversa enfileirado DEPOIS passa na frente de rotina enfileirada ANTES", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const outra = await agenteComConversa(trx, MARLON);
      const rotina = await repos.turnos.enfileirar(base(conversaId, agenteId, { origem: "rotina" }));
      const humano = await repos.turnos.enfileirar(base(outra.conversaId, outra.agenteId, { origem: "conversa" }));
      const primeiro = await repos.turnos.reivindicar({ machineId: MAQUINA, agora: Date.now() });
      expect(primeiro?.id).toBe(humano?.id);
      const segundo = await repos.turnos.reivindicar({ machineId: MAQUINA, agora: Date.now() });
      expect(segundo?.id).toBe(rotina?.id);
    });
  });

  it("EMENDA 13: o mesmo agente não roda em duas conversas ao mesmo tempo, e o pendente diz ONDE ele está ocupado", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const sala = await repos.conversas.criar({ tipo: "sala", salaId: randomUUID() });
      // conversa de sala exige a sala (FK deferida): cria a sala apontando para a conversa
      await repos.salas.criarComMembros({ id: sala?.salaId ?? "", nome: "revisão", conversaId: sala?.id ?? "" }, [{ agenteId, pessoaLeitoraId: PESSOA_MARLON }]);

      const naSala = await repos.turnos.enfileirar(base(sala?.id ?? "", agenteId, { origem: "sala" }));
      const naPropria = await repos.turnos.enfileirar(base(conversaId, agenteId));
      const ganhou = await repos.turnos.reivindicar({ machineId: MAQUINA, agora: Date.now() });
      expect(ganhou?.id).toBe(naSala?.id);
      expect(await repos.turnos.reivindicar({ machineId: MAQUINA, agora: Date.now() })).toBeNull();
      expect(await repos.turnos.pendentesRenderizaveis(conversaId)).toEqual([{ id: naPropria?.id, motivo: "agente_ocupado_em", conversaId: sala?.id }]);
    });
  });

  it("renovarLease leva os sinais e devolve {ativo:false} depois de pedirInterrupcao ou com outra máquina", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      await repos.turnos.enfileirar(base(conversaId, agenteId));
      const t = await repos.turnos.reivindicar({ machineId: MAQUINA, agora: Date.now() });
      const id = t?.id ?? "";
      expect(await repos.turnos.renovarLease(id, MAQUINA, { promptSubmitted: true }, Date.now())).toEqual({ ativo: true });
      expect(await repos.turnos.renovarLease(id, randomUUID(), {}, Date.now())).toEqual({ ativo: false });
      expect(await repos.turnos.marcarSinal(id, "producedOutput")).toBe(true);
      expect((await repos.turnos.buscar(id))?.sinais).toEqual({ attempted: true, rejected: false, promptSubmitted: true, producedOutput: true });

      expect(await repos.turnos.pedirInterrupcao([id], Date.now())).toBe(1);
      expect(await repos.turnos.renovarLease(id, MAQUINA, {}, Date.now())).toEqual({ ativo: false });
      expect((await repos.turnos.despachandoDaPessoa()).map((x) => x.id)).toContain(id);
    });
  });

  it("máquina reconectada não ressuscita lease vencido antes do varredor", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      await repos.turnos.enfileirar(base(conversaId, agenteId));
      const agora = Date.now();
      const t = await repos.turnos.reivindicar({ machineId: MAQUINA, agora });
      expect(await repos.turnos.renovarLease(t!.id, MAQUINA, { promptSubmitted: true }, agora + LEASE_MS + 1)).toEqual({ ativo: false });
      expect((await repos.turnos.buscar(t!.id))?.leaseAte).toBe(agora + LEASE_MS);
    });
  });

  it("interromper é terminal e idempotente; 'interrompido' sem motivo é recusado pelo CHECK; profundidade só de 0 a 3 (0043, ADR-063)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const t = await repos.turnos.enfileirar(base(conversaId, agenteId));
      const id = t?.id ?? "";
      expect((await repos.turnos.interromper(id, "parado_pela_pessoa"))?.motivoInterrupcao).toBe("parado_pela_pessoa");
      expect(await repos.turnos.interromper(id, "sem_progresso")).toBeNull();
      expect(await repos.turnos.assentar(id, { estado: "concluido" })).toBeNull();

      await expectRejected(trx, () => trx`update turnos set estado = 'interrompido', motivo_interrupcao = null where id = ${id}`, "23514");
      await expectRejected(
        trx,
        () => trx`insert into turnos (owner_id, conversa_id, agente_id, origem, prazo_em, profundidade, entrada_texto, entrada_confianca, modelo)
          values (${PESSOA_MARLON}, ${conversaId}, ${agenteId}, 'peer', now(), 4, 'x', 'confiavel', 'm')`,
        "23514",
      );
      await expectRejected(
        trx,
        () => trx`insert into turnos (owner_id, conversa_id, agente_id, origem, prazo_em, profundidade, entrada_texto, entrada_confianca, modelo)
          values (${PESSOA_MARLON}, ${conversaId}, ${agenteId}, 'peer', now(), -1, 'x', 'confiavel', 'm')`,
        "23514",
      );
      // 3 é o limite da corrente e cabe no CHECK (nasce interrompido para não entrar na fila deste teste).
      expect((await repos.turnos.enfileirar(base(conversaId, agenteId, { profundidade: 3, interrompidoCom: "executor_indisponivel" })))?.profundidade).toBe(3);
      // Nasce já interrompido (executor indisponível): nunca entra na fila.
      const morto = await repos.turnos.enfileirar(base(conversaId, agenteId, { interrompidoCom: "executor_indisponivel" }));
      expect(morto).toMatchObject({ estado: "interrompido", motivoInterrupcao: "executor_indisponivel" });
      expect(await repos.turnos.reivindicar({ machineId: MAQUINA, agora: Date.now() })).toBeNull();
    });
  });

  it("vencidos lista só lease vencido; registrarEntrega é idempotente por (turno, seq_local); retomada é turno NOVO", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      await repos.turnos.enfileirar(base(conversaId, agenteId));
      const agora = Date.now();
      const t = await repos.turnos.reivindicar({ machineId: MAQUINA, agora });
      const id = t?.id ?? "";
      expect(await repos.turnos.vencidos(agora + LEASE_MS - 1)).toEqual([]);
      expect((await repos.turnos.vencidos(agora + LEASE_MS + 1)).map((x) => x.id)).toEqual([id]);

      expect(await repos.turnos.registrarEntrega(id, 1)).toBe(true);
      expect(await repos.turnos.registrarEntrega(id, 1)).toBe(false);
      expect(await repos.turnos.registrarEntrega(id, 2)).toBe(true);

      await repos.turnos.interromper(id, "maquina_sem_contato");
      const retomada = await repos.turnos.enfileirar(base(conversaId, agenteId, { origem: "retomada", retomaTurnoId: id, reenvios: 1 }));
      expect(retomada).toMatchObject({ estado: "pendente", retomaTurnoId: id, reenvios: 1, origem: "retomada" });
      expect((await repos.turnos.listarDaConversa(conversaId)).map((x) => x.id)).toEqual([id, retomada?.id]);
    });
  });
});
