import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { ContaAnunciada } from "../../src/contracts/contas-ia.ts";
import { depsSobre } from "../helpers/deps-l7.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * 0074 (ADR-102): as contas de IA da pessoa em todas as máquinas. A mesma conta (a mesma impressão) anunciada por duas
 * máquinas vira UMA linha com dois vínculos; a lista é da pessoa (RLS); a remoção não ressuscita por uma máquina que
 * estava desligada (R4 da revisão).
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_ANA };
const AGORA = Date.now();
const imp = (n: number) => n.toString(16).padStart(64, "0");
const anuncio = (n: number, extra: Partial<ContaAnunciada> = {}): ContaAnunciada => ({ impressao: imp(n), ia: "claude-cli", estado: "pronta", plano: "Max", corporativa: false, logadaEm: AGORA - 60_000, ...extra });

describeIntegracao("contas de IA da pessoa (0074, ADR-102)", () => {
  it("duas máquinas, a mesma conta: uma linha com os dois vínculos; conta nova vai para o fim com o apelido sugerido", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos } = depsSobre(trx, MARLON);
      const mac = randomUUID();
      const vm = randomUUID();
      expect(await repos.contasIa.doAnuncio(mac, [anuncio(1, { apelidoSugerido: "Pessoal" }), anuncio(2, { ia: "codex-cli", plano: "Plus" })], AGORA)).toEqual({ sair: [], mudou: true });
      expect(await repos.contasIa.doAnuncio(vm, [anuncio(1), anuncio(3, { plano: "Team", corporativa: true })], AGORA)).toEqual({ sair: [], mudou: true });
      const { contas, vinculos } = await repos.contasIa.listar();
      expect(contas.map((c) => [c.apelido, c.ia, c.posicao, c.corporativa])).toEqual([["Pessoal", "claude-cli", 1, false], ["Conta 2", "codex-cli", 2, false], ["Conta 3", "claude-cli", 3, true]]);
      const pessoal = contas[0]!.id;
      expect(vinculos.filter((v) => v.contaId === pessoal).map((v) => v.maquinaId).sort()).toEqual([mac, vm].sort());
      // O mesmo anúncio de novo não muda nada.
      expect(await repos.contasIa.doAnuncio(vm, [anuncio(1), anuncio(3, { plano: "Team", corporativa: true })], AGORA)).toEqual({ sair: [], mudou: false });
    });
  });

  it("a máquina que não anuncia mais uma conta perde o vínculo; a saída pedida aparece na puxada até ela sair", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos } = depsSobre(trx, MARLON);
      const vm = randomUUID();
      await repos.contasIa.doAnuncio(vm, [anuncio(1), anuncio(2)], AGORA);
      const [a, b] = (await repos.contasIa.listar()).contas;
      expect(await repos.contasIa.pedirSaida(b!.id, vm, AGORA)).toBe(true);
      expect(await repos.contasIa.saidasPendentes(vm)).toEqual([imp(2)]);
      expect(await repos.contasIa.saiu(vm, [imp(2)])).toBe(1);
      expect(await repos.contasIa.saidasPendentes(vm)).toEqual([]);
      await repos.contasIa.doAnuncio(vm, [], AGORA);
      expect((await repos.contasIa.listar()).vinculos.filter((v) => v.contaId === a!.id)).toEqual([]);
    });
  });

  it("removida some da lista; a máquina desligada que volta com o login antigo recebe a saída (R4); um login novo a devolve", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos } = depsSobre(trx, MARLON);
      const vm = randomUUID();
      await repos.contasIa.doAnuncio(vm, [anuncio(1), anuncio(2)], AGORA - 3_600_000);
      const [, b] = (await repos.contasIa.listar()).contas;
      expect(await repos.contasIa.remover(b!.id, AGORA)).toBe(true);
      expect(await repos.contasIa.doAnuncio(vm, [anuncio(1), anuncio(2, { logadaEm: AGORA - 7_200_000 })], AGORA + 1000)).toMatchObject({ sair: [imp(2)] });
      expect((await repos.contasIa.buscar(b!.id))?.removidaEm).toBe(AGORA);
      await repos.contasIa.doAnuncio(vm, [anuncio(1), anuncio(2, { logadaEm: AGORA + 5_000 })], AGORA + 10_000);
      const voltou = await repos.contasIa.buscar(b!.id);
      expect(voltou?.removidaEm).toBeNull();
      expect(voltou?.posicao).toBe(2);
    });
  });

  it("reordenar exige exatamente as contas da lista; renomear, limite e modo/escolhida", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos } = depsSobre(trx, MARLON);
      await repos.contasIa.doAnuncio(randomUUID(), [anuncio(1), anuncio(2, { ia: "codex-cli" }), anuncio(3)], AGORA);
      const ids = (await repos.contasIa.listar()).contas.map((c) => c.id);
      expect(await repos.contasIa.reordenar([ids[0]!, ids[1]!])).toBe(false);
      expect(await repos.contasIa.reordenar([ids[2]!, ids[0]!, ids[1]!])).toBe(true);
      expect((await repos.contasIa.listar()).contas.map((c) => c.id)).toEqual([ids[2], ids[0], ids[1]]);
      expect(await repos.contasIa.renomear(ids[0]!, "Leapy")).toBe(true);
      await repos.contasIa.marcarLimite(ids[0]!, AGORA + 3_600_000);
      expect((await repos.contasIa.buscar(ids[0]!))?.noLimiteAte).toBe(AGORA + 3_600_000);
      expect(await repos.contasIa.limparLimite(ids[0]!)).toBe(true);
      expect(await repos.contasIa.limparLimite(ids[0]!)).toBe(false);
      expect(await repos.contasIa.modo()).toEqual({ modo: "perguntar", escolhidas: {} });
      await repos.contasIa.definirModo("automatico");
      await repos.contasIa.definirEscolhida("claude-cli", ids[2]!);
      expect(await repos.contasIa.modo()).toEqual({ modo: "automatico", escolhidas: { "claude-cli": ids[2] } });
      await repos.contasIa.definirEscolhida("claude-cli", null);
      expect((await repos.contasIa.modo()).escolhidas).toEqual({});
    });
  });

  it("RLS: as contas são da pessoa (a Ana não vê as do Marlon)", async () => {
    await withRollback(MARLON, async (trx) => {
      await depsSobre(trx, MARLON).repos.contasIa.doAnuncio(randomUUID(), [anuncio(1)], AGORA);
    });
    await withRollback(ANA, async (trx) => {
      expect((await depsSobre(trx, ANA).repos.contasIa.listar()).contas).toEqual([]);
    });
  });
});
