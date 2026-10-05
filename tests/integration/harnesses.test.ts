import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { editarPerfil } from "../../src/use-cases/editar-perfil.ts";
import { duplicarAgente } from "../../src/use-cases/duplicar-agente.ts";
import { ligar, type ContextoLigacao } from "../../src/use-cases/ligacoes.ts";
import { MODELOS_LIGACAO_PADRAO } from "../../src/contracts/modelos.ts";
import { lerModelosLigacao } from "../../src/domain/modelo-ligacao.ts";
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
  it("a guia do onboarding no automático roda no mais potente do harness no chat, e na ligação no modelo de voz (NOD-164); outro bot e modelo escolhido não mudam", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, escopo);
      const outro = await agenteComConversa(trx, escopo);
      const agora = () => Date.now();
      const deps = depsSobre(repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
      await editarPerfil(deps, { agenteId, harness: "auto", modelo: "auto" });
      await editarPerfil(deps, { agenteId: outro.agenteId, harness: "auto", modelo: "auto" });
      await repos.onboarding.definirGuia(agenteId);
      const plano = async (id: string, modelo: string, harnesses: Parameters<typeof emitirPlanoTurno>[1]["harnesses"]) => {
        const conversa = id === agenteId ? conversaId : outro.conversaId;
        const turno = await repos.turnos.enfileirar({ agenteId: id, conversaId: conversa, origem: "conversa", prazoEm: agora() + 60000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo, harness: "auto" });
        return (await emitirPlanoTurno(deps, { turnoId: turno!.id, machineId: randomUUID(), executor: "local", harnesses })).data;
      };
      expect((await plano(agenteId, "auto", { "claude-cli": pronto })).entrada.modelo).toBe("fable");
      expect((await plano(agenteId, "auto", { "codex-cli": pronto })).entrada.modelo).toBe("gpt-6-astra");
      expect((await plano(agenteId, "haiku", { "claude-cli": pronto })).entrada.modelo).toBe("haiku");
      expect((await plano(outro.agenteId, "auto", { "claude-cli": pronto })).entrada.modelo).toBe("sonnet");

      const contexto: ContextoLigacao = { permitido: true, habilitada: true, maquinaComLigacao: true, iaPronta: true, codexSemVoz: false, drenando: false, vozDisponivel: true, vivasNoServidor: 0, maxSimultaneas: 20, limiteDiarioMs: 0, inicioDoDia: 0, provedorStt: "falso", provedorTts: "falso" };
      const { turno } = (await ligar(deps, { agenteId, contexto, executor: "local", iniciadaPor: "produto" })).data;
      const naLigacao = (await emitirPlanoTurno(deps, { turnoId: turno.id, machineId: randomUUID(), executor: "local", harnesses: { "claude-cli": pronto } })).data;
      expect(naLigacao.ligacaoVoz?.modelo).toBe(MODELOS_LIGACAO_PADRAO["claude-cli"].modelo);
      expect(naLigacao.entrada.modelo).toBe("fable");
    });
  });
});

describeIntegracao("modelo da ligação resolvido no servidor (NOD-164)", () => {
  const contexto: ContextoLigacao = { permitido: true, habilitada: true, maquinaComLigacao: true, iaPronta: true, codexSemVoz: false, drenando: false, vozDisponivel: true, vivasNoServidor: 0, maxSimultaneas: 20, limiteDiarioMs: 0, inicioDoDia: 0, provedorStt: "falso", provedorTts: "falso" };
  it("sem config vale o padrão; com config vale a configurada; a guia, explícita ou no auto, recebe a config", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos, agenteId } = await agenteComConversa(trx, escopo);
      const guia = await agenteComConversa(trx, escopo);
      const codex = await agenteComConversa(trx, escopo);
      const agora = () => Date.now();
      const deps = depsSobre(repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
      await editarPerfil(deps, { agenteId: codex.agenteId, harness: "codex-cli", modelo: "auto" });
      await repos.onboarding.definirGuia(guia.agenteId);
      const configurada = lerModelosLigacao({ NOD_MODELO_LIGACAO_CLAUDE: "claude-sonnet-5-5 esforco=low", NOD_MODELO_LIGACAO_CODEX: "gpt-6-astra" });
      // "produto" dispensa o consentimento de voz (ADR-077); o modelo não depende de quem iniciou.
      const voz = async (id: string, modelosLigacao?: typeof configurada) => {
        const { turno, ligacao } = (await ligar(deps, { agenteId: id, contexto, executor: "local", iniciadaPor: "produto" })).data;
        const plano = (await emitirPlanoTurno(deps, { turnoId: turno.id, machineId: randomUUID(), executor: "local", harnesses: { "claude-cli": pronto, "codex-cli": pronto }, ...(modelosLigacao ? { modelosLigacao } : {}) })).data;
        await repos.ligacoes.encerrar(ligacao.id, { motivo: "pessoa_desligou", agora: agora() });
        return plano.ligacaoVoz;
      };

      const padrao = MODELOS_LIGACAO_PADRAO["claude-cli"];
      expect(await voz(agenteId)).toEqual(expect.objectContaining({ modelo: padrao.modelo, esforco: padrao.esforco, pensamentoAdaptativo: false }));
      expect((await voz(agenteId, lerModelosLigacao({ NOD_MODELO_LIGACAO_CLAUDE: "claude-sonnet-4-6" })))?.esforco).toBeUndefined();
      expect(await voz(agenteId, configurada)).toEqual(expect.objectContaining({ modelo: "claude-sonnet-5-5", esforco: "low", pensamentoAdaptativo: false }));
      expect(await voz(codex.agenteId)).toEqual(expect.objectContaining({ modelo: "gpt-6-luna" }));
      expect(await voz(codex.agenteId, configurada)).toEqual(expect.objectContaining({ modelo: "gpt-6-astra" }));
      expect((await voz(codex.agenteId, configurada))?.pensamentoAdaptativo).toBeUndefined();

      // A guia recebe a config, com modelo explícito ou no "auto" (decisão de 2026-10-05: o mesmo modelo de voz das outras).
      await editarPerfil(deps, { agenteId: guia.agenteId, harness: "claude-cli", modelo: "sonnet" });
      expect(await voz(guia.agenteId, configurada)).toEqual(expect.objectContaining({ modelo: "claude-sonnet-5-5", esforco: "low" }));
      await editarPerfil(deps, { agenteId: guia.agenteId, harness: "auto", modelo: "auto" });
      expect(await voz(guia.agenteId, configurada)).toEqual(expect.objectContaining({ modelo: "claude-sonnet-5-5", esforco: "low", pensamentoAdaptativo: false }));
      expect(await voz(guia.agenteId)).toEqual(expect.objectContaining({ modelo: padrao.modelo, esforco: padrao.esforco, pensamentoAdaptativo: false }));
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
