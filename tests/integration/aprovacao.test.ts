import { expect, it } from "vitest";
import { decidir } from "../../src/use-cases/decidir.ts";
import { pedirAprovacao } from "../../src/use-cases/pedir-aprovacao.ts";
import { expectRejected } from "../helpers/expect-rejected.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste, type ChamadaConector } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const destino = (texto: string) => ({ conector: "email", ferramenta: "enviar", argumentos: { texto } });

/**
 * E4.1/E4.2/E4.5 sobre Postgres real: itens como linhas próprias (CHECK item_sensivel_marcado_exige_pessoa
 * vivo), decidir 2 de 4 executa EXATAMENTE 2 no conector falso, desfechos por item, mensagem
 * 'resultado_aprovacao' permanente e turno de RETOMADA com retoma_turno_id (ADR-009: nunca requeue).
 */
describeIntegracao("aprovação em lista tipada: pedir → decidir → executar → retomar", () => {
  it("4 itens (2 sensíveis desmarcados com justificativa) → decidir 2 → 2 chamadas, desfechos certos, mensagem e retomada", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const email = await repos.conectores.criar({ nome: "Email", slug: "email", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
      await repos.conectores.registrarSonda(email?.id ?? "", { ok: true, catalogo: [{ nome: "enviar", descricao: "envia", schema: { type: "object" }, readOnlyHint: false }], agora: Date.now() });
      const consentimento = await repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "consentimento", texto: "ok", confianca: "confiavel" });
      await repos.concessoes.conceder({ agenteId, conectorId: email?.id ?? "", capacidade: "enviar", mensagemId: consentimento?.id ?? "" });
      await repos.conectores.criar({ nome: "CRM", slug: "crm", transporte: "stdio", comando: "node", declaracao: "toca" });
      const turno = await repos.turnos.enfileirar({ conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
      const chamadas: ChamadaConector[] = [];
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ chamadas }), trx });

      const pedido = await pedirAprovacao(deps, {
        turnoId: turno?.id ?? "",
        agenteId,
        conversaId,
        resumo: "enviar 4 e-mails",
        itens: [
          { texto: "ana", destino: destino("ana") },
          { texto: "bia (do CRM)", destino: destino("bia"), origem_conector: "crm" },
          { texto: "caio", destino: destino("caio") },
          { texto: "dani (do CRM)", destino: destino("dani"), origem_conector: "crm" },
        ],
      });
      if (pedido.data.estado !== "pendente") throw new Error("esperava pendente");
      await repos.events.gravarComOutbox(pedido.events ?? []);
      const decisaoId = pedido.data.decisao_id;
      // A classificação por origem está DESLIGADA (ADR-002, refinamento 2026-09-21): nenhum item
      // nasce sensível. O mecanismo continua no banco, e este cenário o exercita marcando dois itens
      // como sensíveis pela DONA — é assim que a trava e o desfecho próprio seguem provados.
      const criados = await repos.itensAprovacao.listar(decisaoId);
      expect(criados.every((i) => !i.origemSensivel && i.selecionado)).toBe(true);
      for (const idx of [1, 3]) {
        await trx`update itens_aprovacao set origem_sensivel = true, selecionado = false, justificativa = 'do CRM' where id = ${criados[idx]?.id ?? ""}`;
      }
      const itens = await repos.itensAprovacao.listar(decisaoId);
      expect(itens.map((i) => [i.idx, i.selecionado, i.origemSensivel, i.justificativa !== null])).toEqual([
        [0, true, false, false],
        [1, false, true, true],
        [2, true, false, false],
        [3, false, true, true],
      ]);
      // A trava do banco (E4.2 (3)): sensível marcado sem pessoa é recusado pelo CHECK, não por convenção.
      await expectRejected(trx, () => trx`update itens_aprovacao set selecionado = true where id = ${itens[1]?.id ?? ""}`, "23514");

      const [ana, bia, caio, dani] = itens;
      const r = await decidir(deps, { decisaoId, itens: [{ id: bia?.id ?? "", selecionado: true }, { id: caio?.id ?? "", selecionado: false }] });
      await repos.events.gravarComOutbox(r.events ?? []);
      expect(chamadas.map((c) => c.args.texto)).toEqual(["ana", "bia"]);
      expect(chamadas.every((c) => c.conectorId === email?.id && c.tool === "enviar")).toBe(true);

      const finais = await repos.itensAprovacao.listar(decisaoId);
      const desfechoDe = (id: string | undefined) => finais.find((i) => i.id === id)?.desfecho;
      expect(desfechoDe(ana?.id)).toBe("executado");
      expect(desfechoDe(bia?.id)).toBe("executado");
      expect(desfechoDe(caio?.id)).toBe("retirado_pela_pessoa");
      expect(desfechoDe(dani?.id)).toBe("sensivel_nao_aprovado");
      expect(finais.find((i) => i.id === bia?.id)).toMatchObject({ marcadoPor: PESSOA_MARLON, selecionado: true });
      expect((await repos.decisoes.buscar(decisaoId))?.estado).toBe("decidida");

      const mensagens = await repos.mensagens.listarDaConversa(conversaId);
      const resultado = mensagens.find((m) => m.kind === "resultado_aprovacao");
      expect(resultado?.texto).toMatch(/aprovou 2 de 4; não enviado: caio \(retirado pela pessoa\); dani \(do CRM\) \(sensível, não aprovado\)\.$/);
      expect(resultado?.payload).toMatchObject({ kind: "resultado_aprovacao", decisaoId });
      expect(resultado?.turnoId).toBe(turno?.id);

      const retomada = await repos.turnos.buscar(r.data.turnoRetomadaId ?? "");
      expect(retomada).toMatchObject({ origem: "retomada", estado: "pendente", retomaTurnoId: turno?.id, conversaId, agenteId });
      expect(retomada?.entradaTexto).toContain("item 4 (email.enviar): sensivel_nao_aprovado");

      await expect(decidir(deps, { decisaoId })).rejects.toMatchObject({ codigo: "estado_invalido" });
      expect(chamadas).toHaveLength(2);
    });
  });
});
