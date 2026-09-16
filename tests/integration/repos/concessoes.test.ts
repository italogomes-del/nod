import { expect, it } from "vitest";
import { expectRejected } from "../../helpers/expect-rejected.ts";
import { agenteComConversa, autoriaPessoa } from "../../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_LEAPY } from "../../helpers/ids.ts";
import { describeIntegracao } from "../../helpers/integracao.ts";
import { withRollback } from "../../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON };

describeIntegracao("concessoesRepo: por agente e capacidade, presa à mensagem de consentimento (E6)", () => {
  it("conceder cita a mensagem; repetir a mesma capacidade devolve null; revogar apaga; procuração é fail-closed por ausência", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const conector = await repos.conectores.criar({ nome: "Exemplo", slug: "exemplo", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
      const consentimento = await repos.mensagens.criar({
        conversaId,
        autoria: autoriaPessoa(PESSOA_MARLON),
        kind: "consentimento",
        texto: "Concedido por Marlon: exemplo.listar_contatos; não inclui: enviar_email",
        payload: { kind: "consentimento", conectorId: conector?.id ?? "", slug: "exemplo", capacidade: "listar_contatos", naoInclui: ["enviar_email"] },
        confianca: "confiavel",
      });
      const c = await repos.concessoes.conceder({ agenteId, conectorId: conector?.id ?? "", capacidade: "listar_contatos", mensagemId: consentimento?.id ?? "" });
      expect(c).toMatchObject({ agenteId, conectorId: conector?.id, capacidade: "listar_contatos", mensagemId: consentimento?.id });
      expect(await repos.concessoes.conceder({ agenteId, conectorId: conector?.id ?? "", capacidade: "listar_contatos", mensagemId: consentimento?.id ?? "" })).toBeNull();
      // Sem mensagem de consentimento não há concessão (FK).
      await expectRejected(trx, () => repos.concessoes.conceder({ agenteId, conectorId: conector?.id ?? "", capacidade: "enviar_email", mensagemId: agenteId }), "23503");

      expect((await repos.concessoes.doAgente(agenteId)).map((x) => x.capacidade)).toEqual(["listar_contatos"]);
      expect(await repos.concessoes.buscar(c?.id ?? "")).toMatchObject({ id: c?.id });
      expect(await repos.concessoes.revogar(c?.id ?? "")).toBe(true);
      expect(await repos.concessoes.revogar(c?.id ?? "")).toBe(false);
      expect(await repos.concessoes.doAgente(agenteId)).toEqual([]);

      expect(await repos.procuracoes.listarDoBeneficiario(agenteId)).toEqual([]);
      const outro = await agenteComConversa(trx, MARLON);
      const p = await repos.procuracoes.criar({ agenteConcedenteId: outro.agenteId, agenteBeneficiarioId: agenteId, classesPermitidas: ["leitura"], tetoDiario: 10 });
      expect((await repos.procuracoes.listarDoBeneficiario(agenteId)).map((x) => x.id)).toEqual([p?.id]);
    });
  });

  it("inventário por pessoa e motor (ADR-019): upsert, três estados, sem email; gastos somam o mês", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const em = Date.now();
      expect(await repos.inventario.buscar("claude-cli")).toBeNull();
      expect(await repos.inventario.registrar("claude-cli", { estado: "ausente", motivo: "binário não encontrado", em })).toEqual({ estado: "ausente", motivo: "binário não encontrado", em });
      expect(await repos.inventario.registrar("claude-cli", { estado: "pronto", versao: "2.1.272", em: em + 1 })).toEqual({ estado: "pronto", versao: "2.1.272", em: em + 1 });
      expect(await repos.inventario.buscar("claude-cli")).toEqual({ estado: "pronto", versao: "2.1.272", em: em + 1 });
      expect((await repos.inventario.listar()).map((i) => i.motor)).toEqual(["claude-cli"]);
      const [cols] = await trx<{ n: number }[]>`select count(*)::int as n from information_schema.columns where table_name = 'inventario_motores' and column_name ilike '%email%'`;
      expect(cols?.n).toBe(0);

      const turno = await repos.turnos.enfileirar({ conversaId, agenteId, origem: "conversa", prazoEm: em + 60_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
      await repos.gastos.registrar({ turnoId: turno?.id ?? "", executor: "local", tokensEntrada: 18, tokensSaida: 90, custoUsd: 0.0207631, modelo: "claude-haiku-4-5-20251001", em });
      await repos.gastos.registrar({ turnoId: turno?.id ?? "", executor: "local", tokensEntrada: 5, tokensSaida: 10, custoUsd: 0.0032996, modelo: "claude-haiku-4-5-20251001", em });
      expect((await repos.gastos.doTurno(turno?.id ?? "")).map((g) => g.custoUsd)).toEqual([0.0207631, 0.0032996]);
      expect(await repos.gastos.somarMes(em)).toBeCloseTo(0.0240627, 6);
    });
  });

  it("paradas: ativa cobre a conversa (ou todas), encerrar grava a faixa, ativa devolve boolean (nunca lança: null só em falha de consulta)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, conversaId } = await agenteComConversa(trx, MARLON);
      const outra = await agenteComConversa(trx, MARLON);
      const agora = Date.now();
      expect(await repos.paradas.ativa(PESSOA_MARLON, conversaId)).toBe(false);
      const p = await repos.paradas.ativar({ conversaId, agora });
      expect(await repos.paradas.ativa(PESSOA_MARLON, conversaId)).toBe(true);
      expect(await repos.paradas.ativa(PESSOA_MARLON, outra.conversaId)).toBe(false);
      const global = await repos.paradas.ativar({ conversaId: null, agora });
      expect(await repos.paradas.ativa(PESSOA_MARLON, outra.conversaId)).toBe(true);
      expect((await repos.paradas.listarAbertas()).map((x) => x.id).sort()).toEqual([p?.id, global?.id].sort());

      const faixa = { interrompidas: 1, naoInterrompidas: [], jaEntregues: [], nadaRodando: false };
      expect((await repos.paradas.encerrar(p?.id ?? "", { faixa, agora: agora + 1 }))?.faixa).toEqual(faixa);
      expect(await repos.paradas.encerrar(p?.id ?? "", { faixa, agora: agora + 2 })).toBeNull();
      expect(await repos.paradas.encerrarAbertas({ conversaId: outra.conversaId, agora: agora + 3 })).toBe(1);
      expect(await repos.paradas.ativa(PESSOA_MARLON, conversaId)).toBe(false);

      // Consulta que falha → null (EMENDA 10): uma transação abortada faz qualquer SELECT falhar.
      await trx`savepoint sp`;
      await trx.unsafe("select 1/0").catch(() => undefined);
      expect(await repos.paradas.ativa(PESSOA_MARLON, conversaId)).toBeNull();
      await trx`rollback to savepoint sp`;
    });
  });

  it("catcher_registros nasce 'equipe' e é lido por turno e por recência", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const turno = await repos.turnos.enfileirar({ conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 60_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
      await repos.catcher.registrar({ turnoId: turno?.id ?? "", tipo: "plano_recebido", dados: { ferramentas: ["mcp__nod__lembrar"] } });
      await repos.catcher.registrar({ turnoId: turno?.id ?? "", tipo: "tool_use", dados: { nome: "lembrar", input: { tipo: "fato", texto: "x" } } });
      expect((await repos.catcher.listar(turno?.id ?? "")).map((r) => r.tipo)).toEqual(["plano_recebido", "tool_use"]);
      expect((await repos.catcher.listarRecentes(1)).map((r) => r.tipo)).toEqual(["tool_use"]);
      const [v] = await trx<{ visibility: string }[]>`select visibility from catcher_registros where turno_id = ${turno?.id ?? ""} limit 1`;
      expect(v?.visibility).toBe("equipe");
      await expectRejected(trx, () => repos.catcher.registrar({ turnoId: turno?.id ?? "", tipo: "Tipo Livre", dados: {} }), "23514");
    });
  });
});
