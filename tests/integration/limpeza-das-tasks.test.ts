import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { LIMPAR_APOS_MS } from "../../src/domain/limpeza-das-tasks.ts";
import { pastasParaLimpar } from "../../src/use-cases/limpeza-das-tasks.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-088 (definido em 2026-10-09): o servidor diz ao Mac quais pastas de task podem ser limpas. Só task encerrada
 * (terminada ou falha), sem turno vivo nem volta marcada, sem decisão pendente, fora das 2 h da retomada automática.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const HORA = 3_600_000;
const DIA = 24 * HORA;

describeIntegracao("limpeza das pastas de task (ADR-088)", () => {
  it("só oferece task encerrada sem retomada possível; a de menos de 3 dias só com PR mergeado", async () => {
    await withRollback(MARLON, async (trx) => {
      const agora = Date.now();
      const { agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => agora });
      const criar = async (slug: string, estado: "terminado" | "falhou" | "parado" | "rodando" | null, haMs: number, pasta: string | null = `~/nod/Vera/${slug}`) => {
        const t = await repos.trabalhos.criar({ agenteId, conversaId, titulo: slug, origem: "pessoa", pasta });
        if (estado) await repos.trabalhos.mudarEstado(t!.id, estado, agora - haMs);
        return t!.id;
      };
      const turnoDo = (trabalhoId: string, acordarEm: number | null = null) =>
        repos.turnos.enfileirar({ executor: "catcher", conversaId, agenteId, origem: "conversa", prazoEm: agora + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m", trabalhoId, acordarEm });

      const antiga = await criar("antiga-aaaaaa", "terminado", 4 * DIA);
      const falhaRecente = await criar("falha-bbbbbb", "falhou", DIA);
      await criar("acabou-agora-cccccc", "terminado", HORA);
      await criar("ativa-dddddd", "rodando", 0);
      await criar("parada-eeeeee", "parado", 10 * DIA);
      // A decisão pendente vem de um turno que já acabou (o "Retomar" e a pergunta ficam depois do turno).
      const comPergunta = await criar("pergunta-hhhhhh", "terminado", 4 * DIA);
      const t = await turnoDo(comPergunta);
      expect((await repos.turnos.reivindicar({ machineId: randomUUID(), agora }))?.id).toBe(t!.id);
      await repos.turnos.assentar(t!.id, { estado: "concluido" });
      await repos.decisoes.criar({ tipo: "pergunta", agenteId, conversaId, turnoId: t!.id, prazoDecisaoEm: agora + DIA, frase: "Qual?" });
      const comVolta = await criar("com-volta-ffffff", "terminado", 4 * DIA);
      await turnoDo(comVolta, agora + HORA);
      const naFila = await criar("na-fila-gggggg", "terminado", 4 * DIA);
      await turnoDo(naFila);
      await criar("sem-pasta", "terminado", 4 * DIA, null);
      await criar("raiz-do-bot", "terminado", 4 * DIA, "~/nod/Vera");
      await criar("velha-iiiiii", "terminado", 40 * DIA);
      // Pasta decidida por quem chamou e dividida com uma task aberta: nunca.
      await criar("dividida", "terminado", 4 * DIA, "~/nod/Vera/compartilhada");
      await criar("dividida-aberta", null, 0, "~/nod/Vera/compartilhada");

      const oferecidas = await pastasParaLimpar(deps);
      expect(oferecidas).toEqual([
        { trabalhoId: antiga, pasta: "Vera/antiga-aaaaaa", quando: "encerrada" },
        { trabalhoId: falhaRecente, pasta: "Vera/falha-bbbbbb", quando: "so_com_pr_mergeado" },
      ]);

      // ADR-096: com o disco apertado, a encerrada há mais de 2 h já vale como encerrada.
      expect(await pastasParaLimpar(deps, { apertado: true })).toEqual([
        { trabalhoId: antiga, pasta: "Vera/antiga-aaaaaa", quando: "encerrada" },
        { trabalhoId: falhaRecente, pasta: "Vera/falha-bbbbbb", quando: "encerrada" },
      ]);

      // A task reaberta (mensagem nova) sai da lista; quando volta a acabar, o relógio dos 3 dias recomeça.
      await repos.trabalhos.mudarEstado(antiga, "rodando", agora);
      expect((await pastasParaLimpar(deps)).map((p) => p.trabalhoId)).toEqual([falhaRecente]);
      await repos.trabalhos.mudarEstado(antiga, "terminado", agora - LIMPAR_APOS_MS + HORA);
      expect(await pastasParaLimpar(deps)).toContainEqual({ trabalhoId: antiga, pasta: "Vera/antiga-aaaaaa", quando: "so_com_pr_mergeado" });
    });
  });
});
