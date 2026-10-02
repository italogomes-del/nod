import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { editarPerfil } from "../../src/use-cases/editar-perfil.ts";
import { duplicarAgente } from "../../src/use-cases/duplicar-agente.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";
const escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto = { estado: "pronto", versao: "teste", em: Date.now() } as const;
describeIntegracao("harness por agente", () => {
  it("persiste, duplica, congela preferência da tarefa e mantém histórico sem reutilizar sessão de outro harness", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, escopo);
      const agora = () => Date.now();
      const deps = depsSobre(repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
      await editarPerfil(deps, { agenteId, harness: "codex-cli", modelo: "gpt-6-astra" });
      expect(await repos.agentes.buscar(agenteId)).toMatchObject({ harness: "codex-cli", modelo: "gpt-6-astra" });
      const copia = await duplicarAgente(deps, { agenteId });
      expect(copia.data.agente).toMatchObject({ harness: "codex-cli", modelo: "gpt-6-astra" });
      const turno = await repos.turnos.enfileirar({ agenteId, conversaId, origem: "conversa", prazoEm: agora() + 60000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "gpt-6-astra", harness: "codex-cli" });
      await editarPerfil(deps, { agenteId, harness: "claude-cli", modelo: "haiku" });
      await repos.conversas.atualizarSessaoCli(conversaId, randomUUID(), "local");
      const plano = (await emitirPlanoTurno(deps, { turnoId: turno!.id, machineId: randomUUID(), executor: "local", harnesses: { "codex-cli": pronto, "claude-cli": pronto } })).data;
      expect(plano.harness).toBe("codex-cli"); expect(plano.entrada.modelo).toBe("gpt-6-astra"); expect(plano.entrada.sessaoCli).toBeNull();
      expect(plano.catalogo.ferramentas.some((f) => f.nome === "atualizar_perfil")).toBe(true);
      await expect(emitirPlanoTurno(deps, { turnoId: turno!.id, machineId: randomUUID(), executor: "local", harnesses: { "claude-cli": pronto } })).rejects.toThrow("executor_indisponivel");
    });
  });
  it("automático funciona só com Codex disponível e não exige inventário do Claude", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, escopo);
      const agora = () => Date.now();
      const deps = depsSobre(repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
      const turno = await repos.turnos.enfileirar({ agenteId, conversaId, origem: "conversa", prazoEm: agora() + 60000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "auto", harness: "auto" });
      const p = (await emitirPlanoTurno(deps, { turnoId: turno!.id, machineId: randomUUID(), executor: "local", harnesses: { "codex-cli": pronto } })).data;
      expect(p).toMatchObject({ harness: "codex-cli", entrada: { modelo: "gpt-5.6-sol" } });
    });
  });
});

describeIntegracao("roteamento por capacidade do computador", () => {
it("fila não deixa um computador com Claude reivindicar um turno fixado no Codex", async () => {
  await withRollback(escopo, async (trx) => {
    const { repos, agenteId, conversaId } = await agenteComConversa(trx, escopo);
    const turno = await repos.turnos.enfileirar({ agenteId, conversaId, origem: "conversa", prazoEm: Date.now() + 60000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "auto", harness: "codex-cli" });
    expect(await repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now(), harnessesProntos: ["claude-cli"] })).toBeNull();
    expect(await repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now(), harnessesProntos: ["codex-cli"] })).toMatchObject({ id: turno!.id, harness: "codex-cli" });
  });
});

});
