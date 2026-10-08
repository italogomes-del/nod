import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { OrigemTrabalho } from "../../src/contracts/trabalho.ts";
import type { Tx } from "../../src/shared/types.ts";
import { ESPERA_MAXIMA_FUNDO_MS } from "../../src/domain/memoria-mac.ts";
import { gravarPreferencias, lerPreferencias } from "../../src/use-cases/raio-x.ts";
import { criarTrabalho, listarTrabalhos } from "../../src/use-cases/trabalhos.ts";
import { esperarErro } from "../helpers/deps-l6.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-085 (definido em 2026-10-08): com o Mac apertado, o `reivindicar` segura só trabalho NOVO em segundo plano —
 * rotina e pedido de colega que ainda não começaram. Conversa, task aberta pela pessoa e trabalho já iniciado seguem.
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };

async function montar(trx: Tx) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const { deps, repos } = depsSobre(trx, MARLON);
  const turno = async (trabalhoId: string | null, origem: "conversa" | "rotina" = "conversa") => {
    const t = await repos.turnos.enfileirar({ conversaId: base.conversaId, agenteId: base.agenteId, origem, prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "faça", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId });
    if (!t) throw new Error("turno");
    return t;
  };
  const task = async (origem: OrigemTrabalho, titulo: string, pessoaEsperando = false) => (await criarTrabalho(deps, { agenteId: base.agenteId, conversaId: base.conversaId, titulo, origem, pessoaEsperando })).trabalho;
  /** Todos os turnos que o reivindicar entrega, um por faixa, até a fila (desta pessoa) não ter mais o que dar. */
  const reivindicarTudo = async (segurarFundo: boolean, meus: ReadonlySet<string>, espacarFundo = false) => {
    const pegos: string[] = [];
    for (let i = 0; i < 40; i++) {
      const r = await repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now(), segurarFundo, espacarFundo });
      if (!r) break;
      if (meus.has(r.id)) pegos.push(r.id);
    }
    return pegos;
  };
  return { ...base, deps, repos, turno, task, reivindicarTudo };
}

describeIntegracao("uso do Mac (ADR-085)", () => {
  it("Mac apertado: rotina e pedido de colega novos esperam; conversa, task da pessoa e trabalho já iniciado seguem", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const rotina = await m.task("rotina", "Verificar o Slack");
      const colega = await m.task("colega", "Revisar o PR do Dev 2");
      const daPessoa = await m.task("pessoa", "Liberar espaço no Mac");
      const rotinaIniciada = await m.task("rotina", "Orquestrar a etapa de engenharia");
      await m.repos.trabalhos.mudarEstado(rotinaIniciada.id, "rodando", Date.now());
      const tConversa = await m.turno(null);
      const tRotina = await m.turno(rotina.id, "rotina");
      const tColega = await m.turno(colega.id);
      const tPessoa = await m.turno(daPessoa.id);
      const tIniciada = await m.turno(rotinaIniciada.id, "rotina");
      const meus = new Set([tConversa.id, tRotina.id, tColega.id, tPessoa.id, tIniciada.id]);

      const comMacApertado = await m.reivindicarTudo(true, meus);
      expect(new Set(comMacApertado)).toEqual(new Set([tConversa.id, tPessoa.id, tIniciada.id]));
      expect((await m.repos.turnos.buscar(tRotina.id))?.estado).toBe("pendente");
      expect((await m.repos.turnos.buscar(tColega.id))?.estado).toBe("pendente");

      // O Mac aliviou: os que esperavam saem na ordem de sempre.
      expect(new Set(await m.reivindicarTudo(false, meus))).toEqual(new Set([tRotina.id, tColega.id]));
    });
  });

  it("revisão do #209: quem a pessoa espera não é segurado; a espera máxima solta o antigo; o espaço segura até ele", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const agora = await m.task("rotina", "Executar agora", true);
      const antiga = await m.task("rotina", "Rotina das 9h");
      await trx`update trabalhos set criado_em = now() - make_interval(secs => ${(ESPERA_MAXIMA_FUNDO_MS + 60_000) / 1000}) where id = ${antiga.id}`;
      const nova = await m.task("colega", "Pedido de um bot");
      const tAgora = await m.turno(agora.id, "rotina");
      const tAntiga = await m.turno(antiga.id, "rotina");
      const tNova = await m.turno(nova.id);
      const meus = new Set([tAgora.id, tAntiga.id, tNova.id]);

      // Logo depois de um trabalho em segundo plano começar: só o que a pessoa espera sai, nem o antigo.
      expect(await m.reivindicarTudo(false, meus, true)).toEqual([tAgora.id]);
      // Mac apertado, sem o espaço: o antigo passou da espera máxima e sai; o novo espera.
      expect(await m.reivindicarTudo(true, meus)).toEqual([tAntiga.id]);
      expect(await m.reivindicarTudo(false, meus)).toEqual([tNova.id]);
    });
  });

  it("a preferência: padrão 'equilibrado', grava 'pouco' e 'livre', recusa valor fora do tipo e não apaga o resto", async () => {
    await withRollback(MARLON, async (trx) => {
      const { deps } = depsSobre(trx, MARLON);
      expect((await lerPreferencias(deps, {})).data.usoDoMac).toBe("equilibrado");
      await gravarPreferencias(deps, { faixaTrabalhosRecolhida: true });
      expect((await gravarPreferencias(deps, { usoDoMac: "pouco" })).data).toMatchObject({ usoDoMac: "pouco", faixaTrabalhosRecolhida: true });
      expect((await gravarPreferencias(deps, { usoDoMac: "livre" })).data.usoDoMac).toBe("livre");
      for (const usoDoMac of ["muito", 3, null, ""]) await esperarErro(() => gravarPreferencias(deps, { usoDoMac }), "entrada_invalida");
      expect((await lerPreferencias(deps, {})).data.usoDoMac).toBe("livre");
    });
  });

  it("a lista de Trabalhos: memória só de quem tem processo vivo; processador e 'segurando' pelo pior Mac e pela preferência", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const parada = await m.task("pessoa", "Esperando você responder");
      await m.repos.trabalhos.atualizarMemoria([]);
      await trx`update trabalhos set memoria_mb = 400 where id = ${parada.id}`;
      let leitura: { nivel: "verde" | "amarela" | "vermelha"; totalMb: number; processador: "verde" | "amarela" | "vermelha" | null; carga: number | null } | null = { nivel: "verde", totalMb: 600, processador: "vermelha", carga: 1.4 };
      const deps = { ...m.deps, services: { ...m.deps.services, trabalhosVivos: { ultimaFerramenta: () => null, memoria: () => leitura } } };

      const rotina = await m.task("rotina", "Verificar o Slack");
      const dto = (await listarTrabalhos(deps, {})).data;
      expect(dto.trabalhos.find((t) => t.id === parada.id)?.memoriaMb).toBeNull();
      // A linha diz "esperando o Mac aliviar" pela marca do servidor (a mesma regra do reivindicar).
      expect(dto.trabalhos.find((t) => t.id === rotina.id)?.seguravel).toBe(true);
      expect(dto.trabalhos.find((t) => t.id === parada.id)?.seguravel).toBe(false);
      expect(dto).toMatchObject({ pressao: "verde", processador: "vermelha", cargaProcessador: 1.4, segurando: true });

      await gravarPreferencias(m.deps, { usoDoMac: "livre" });
      expect((await listarTrabalhos(deps, {})).data.segurando).toBe(false);
      leitura = null;
      expect((await listarTrabalhos(deps, {})).data).toMatchObject({ processador: null, segurando: false });
    });
  });
});
