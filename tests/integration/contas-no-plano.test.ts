import { randomBytes, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { ContaAnunciada } from "../../src/contracts/contas-ia.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * ADR-102 item 5: o servidor escolhe a conta do turno pela lista da pessoa e pelo que a máquina tem logado. A ordem
 * intercalada decide a IA; a conta vai no plano e fica no turno; a sessão do Codex só é retomada na mesma conta (R1).
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const AGORA = Date.now();
const pronto: Inventario = { estado: "pronto", versao: "2.1.296", em: AGORA };
const imp = (n: number) => n.toString(16).padStart(64, "0");
const anuncio = (n: number, ia: ContaAnunciada["ia"], apelido: string): ContaAnunciada => ({ impressao: imp(n), ia, estado: "pronta", plano: "Max", corporativa: false, logadaEm: AGORA - 60_000, apelidoSugerido: apelido });

describeIntegracao("a conta do turno no plano (ADR-102)", () => {
  async function montar(trx: Parameters<Parameters<typeof withRollback>[1]>[0]) {
    const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Ze 1" });
    await repos.agentes.atualizarPerfil(agenteId, { confirmado: true });
    await repos.inventario.registrar("claude-cli", pronto);
    const chave = await repos.maquinaTokens.criar({ nome: "vm-bots", prefixo: randomBytes(4).toString("hex"), hash: randomBytes(32) });
    const vm = chave!.id;
    const agora = () => AGORA;
    const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
    const plano = async () => {
      const turno = await repos.turnos.enfileirar({ executor: "local", conversaId, agenteId, origem: "conversa", prazoEm: AGORA + 600_000, profundidade: 0, entradaTexto: "ola", entradaConfianca: "confiavel", modelo: "auto", harness: "auto" });
      const r = await emitirPlanoTurno(deps, { turnoId: turno!.id, machineId: vm, executor: "local", harnesses: { "claude-cli": pronto, "codex-cli": pronto } });
      return { plano: r.data, turnoId: turno!.id };
    };
    return { repos, vm, conversaId, plano };
  }

  it("a lista intercalada decide a IA: ChatGPT · Pessoal na frente leva o turno ao Codex com a conta no plano e no turno", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.contasIa.doAnuncio(m.vm, [anuncio(1, "claude-cli", "Pessoal"), anuncio(2, "codex-cli", "Pessoal")], AGORA);
      const [cPessoal, gPessoal] = (await m.repos.contasIa.listar()).contas;
      const primeiro = await m.plano();
      expect(primeiro.plano.harness).toBe("claude-cli");
      expect(primeiro.plano.conta).toEqual({ id: cPessoal!.id, impressao: imp(1), apelido: "Pessoal" });
      expect(await m.repos.turnos.contaDoTurno(primeiro.turnoId)).toBe(cPessoal!.id);
      expect(await m.repos.contasIa.reordenar([gPessoal!.id, cPessoal!.id])).toBe(true);
      const segundo = await m.plano();
      expect(segundo.plano.harness).toBe("codex-cli");
      expect(segundo.plano.conta?.id).toBe(gPessoal!.id);
    });
  });

  it("a conta no limite tira a IA da vez (o limite é da conta, não da IA)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.contasIa.doAnuncio(m.vm, [anuncio(1, "claude-cli", "Pessoal"), anuncio(2, "codex-cli", "Pessoal")], AGORA);
      const [cPessoal, gPessoal] = (await m.repos.contasIa.listar()).contas;
      await m.repos.contasIa.marcarLimite(cPessoal!.id, AGORA + 3_600_000);
      const p = await m.plano();
      expect(p.plano.harness).toBe("codex-cli");
      expect(p.plano.conta?.id).toBe(gPessoal!.id);
    });
  });

  it("máquina sem conta anunciada: o plano sai sem conta, como antes", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.contasIa.doAnuncio(randomUUID(), [anuncio(1, "claude-cli", "Pessoal")], AGORA);
      const p = await m.plano();
      expect(p.plano.conta).toBeUndefined();
      expect(await m.repos.turnos.contaDoTurno(p.turnoId)).toBeNull();
    });
  });

  it("R1: a conta da sessão é gravada com a sessão e some quando a sessão muda", async () => {
    // O Codex ainda não retoma sessão (capacidades: retomaSessao false); a regra do plano (emitir-plano-turno, R1) é a
    // proteção para quando retomar. Aqui, o que ela lê: a conta guardada junto da sessão da conversa.
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      await m.repos.contasIa.doAnuncio(m.vm, [anuncio(2, "codex-cli", "Pessoal")], AGORA);
      const [gPessoal] = (await m.repos.contasIa.listar()).contas;
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, randomUUID(), "local", "codex-cli");
      await m.repos.conversas.definirContaDaSessao(m.conversaId, gPessoal!.id);
      expect(await m.repos.conversas.contaDaSessao(m.conversaId)).toBe(gPessoal!.id);
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, randomUUID(), "local", "codex-cli");
      expect(await m.repos.conversas.contaDaSessao(m.conversaId)).toBeNull();
      expect((await m.plano()).plano.entrada.sessaoCli).toBeNull();
    });
  });
});
