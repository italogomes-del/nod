import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { previaDaMensagem } from "../../src/domain/descricao-agente.ts";
import { listarFrota } from "../../src/use-cases/listar-frota.ts";
import { depsSobreTrx, MARLON } from "../helpers/deps-l6.ts";
import { agenteComConversa, autoriaAgente, autoriaPessoa } from "../helpers/fabricas.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * listarFrota em lote (revisto em 2026-09-30): as contagens e a prévia saem de consultas por lista de agentes e de
 * conversas, não mais uma rodada por agente. O que a linha mostra não muda — exceto as execuções, que passam a ser a
 * contagem real: antes eram os concluídos entre os 1.000 turnos mais recentes da conversa.
 */
describeIntegracao("frota em lote: consultas fixas, execuções reais", () => {
  it("conta todos os concluídos (1.001, além da janela antiga de 1.000), a concessão e a última fala; agente sem nada ou sem conversa sai zerado", async () => {
    await withRollback(MARLON, async (trx) => {
      const deps = depsSobreTrx(trx, MARLON);
      const a = await agenteComConversa(trx, MARLON, { nome: "Com histórico" });
      const b = await agenteComConversa(trx, MARLON, { nome: "Sem nada" });
      const semConversa = await deps.repos.agentes.criar({ id: randomUUID(), nome: "Sem conversa", dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "claude-haiku-4-5-20251001" });

      // Por SQL: o caso de uso levaria um turno por vez. Um interrompido não conta como execução.
      await trx`
        insert into turnos (tenant_id, owner_id, conversa_id, agente_id, origem, estado, prazo_em, entrada_texto, entrada_confianca, modelo)
        select ${MARLON.tenantId}, ${MARLON.pessoaId}, ${a.conversaId}, ${a.agenteId}, 'conversa', 'concluido', now() + interval '1 day', 'pedido ' || g, 'confiavel', 'sonnet'
        from generate_series(1, 1001) g`;
      await trx`
        insert into turnos (tenant_id, owner_id, conversa_id, agente_id, origem, estado, motivo_interrupcao, prazo_em, entrada_texto, entrada_confianca, modelo)
        values (${MARLON.tenantId}, ${MARLON.pessoaId}, ${a.conversaId}, ${a.agenteId}, 'conversa', 'interrompido', 'parado_pela_pessoa', now() + interval '1 day', 'parado', 'confiavel', 'sonnet')`;

      const conector = await deps.repos.conectores.criar({ nome: "Exemplo", slug: "exemplo", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
      const consentimento = await deps.repos.mensagens.criar({
        conversaId: a.conversaId,
        autoria: autoriaPessoa(MARLON.pessoaId),
        kind: "consentimento",
        texto: "Concedido por Marlon: exemplo.listar_contatos",
        payload: { kind: "consentimento", conectorId: conector?.id ?? "", slug: "exemplo", capacidade: "listar_contatos", naoInclui: [] },
        confianca: "confiavel",
      });
      await deps.repos.concessoes.conceder({ agenteId: a.agenteId, conectorId: conector?.id ?? "", capacidade: "listar_contatos", mensagemId: consentimento?.id ?? "" });
      const ultima = await deps.repos.mensagens.criar({ conversaId: a.conversaId, autoria: autoriaAgente(a.agenteId, MARLON.pessoaId), kind: "texto", texto: "**Pronto**: relatório enviado.", confianca: "nao_confiavel" });

      const frota = (await listarFrota(deps, {})).data.agentes;
      expect(frota.find((x) => x.id === a.agenteId)).toMatchObject({
        conversaId: a.conversaId,
        descricaoEstado: "1 acesso · executou 1001 vezes",
        ultimaMensagem: { previa: previaDaMensagem(ultima?.texto ?? ""), em: ultima?.criadoEm },
      });
      expect(frota.find((x) => x.id === b.agenteId)).toMatchObject({ conversaId: b.conversaId, descricaoEstado: "sem acessos · nunca executou", ultimaMensagem: null });
      expect(frota.find((x) => x.id === semConversa?.id)).toMatchObject({ conversaId: "", naoLido: false, descricaoEstado: "sem acessos · nunca executou", ultimaMensagem: null });
    });
  });
});
