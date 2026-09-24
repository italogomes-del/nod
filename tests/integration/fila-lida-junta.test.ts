import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { entradaDaFila } from "../../src/domain/entrada-da-fila.ts";
import { cancelarTurno } from "../../src/use-cases/cancelar-turno.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { despacharTurno } from "../../src/use-cases/despachar-turno.ts";
import { enviarMensagem, lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { depsSobreTrx, esperarErro, executar, MARLON } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const PRONTO = { estado: "pronto" as const, versao: "teste", em: 0 };

describeIntegracao("fila da conversa no Postgres (0024): cancelar uma, ler as restantes juntas", () => {
  it("mensagem_origem_id liga fala e turno; cancelar só pega pendente; ao reivindicar, a outra pendente sai absorvida", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const { data: criado } = await executar(deps, criarAgente, { dono: "pessoa" });
      const conversaId = criado.conversa.id;
      const maquina = randomUUID();
      const rodando = await executar(deps, enviarMensagem, { conversaId, texto: "fazer a triagem", inventario: PRONTO });
      await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO });
      const a = await executar(deps, enviarMensagem, { conversaId, texto: "fazer novamente", inventario: PRONTO });
      const b = await executar(deps, enviarMensagem, { conversaId, texto: "fazer novamente", inventario: PRONTO });
      const c = await executar(deps, enviarMensagem, { conversaId, texto: "e o e-mail do Daniel?", inventario: PRONTO });
      expect(a.data.turno.mensagemOrigemId).toBe(a.data.mensagem.id);

      await esperarErro(() => cancelarTurno(deps, { turnoId: rodando.data.turno.id }), "estado_invalido");
      await executar(deps, cancelarTurno, { turnoId: b.data.turno.id });
      const lida = (await lerConversa(deps, { conversaId })).data;
      expect(lida.turnosCancelados).toEqual([{ id: b.data.turno.id, mensagemId: b.data.mensagem.id }]);
      expect(lida.turnosEmCurso.map((t) => [t.estado, t.mensagemId])).toEqual([["despachando", rodando.data.mensagem.id], ["pendente", a.data.mensagem.id], ["pendente", c.data.mensagem.id]]);

      await deps.repos.turnos.assentar(rodando.data.turno.id, { estado: "concluido", sinais: { promptSubmitted: true, producedOutput: true } });
      const d = await executar(deps, despacharTurno, { machineId: maquina, inventario: PRONTO });
      expect(d.data.turno?.id).toBe(a.data.turno.id);
      expect(d.data.plano?.entrada.texto).toBe(entradaDaFila(["fazer novamente", "e o e-mail do Daniel?"]));
      expect(await deps.repos.turnos.buscar(c.data.turno.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: a.data.turno.id });
      await esperarErro(() => cancelarTurno(deps, { turnoId: c.data.turno.id }), "estado_invalido");
    });
  });
});
