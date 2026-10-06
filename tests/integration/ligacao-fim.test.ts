import { expect, it } from "vitest";
import { atenderLigacao, encerrarLigacao, ligar, type ContextoLigacao } from "../../src/use-cases/ligacoes.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/** NOD-168: o fim que a pessoa não escolheu deixa uma linha na conversa dizendo por quê; uma só, mesmo encerrando 2x. */
const escopo = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const contexto: ContextoLigacao = { permitido: true, habilitada: true, maquinaComLigacao: true, iaPronta: true, codexSemVoz: false, drenando: false, vozDisponivel: true, vivasNoServidor: 0, maxSimultaneas: 20, limiteDiarioMs: 0, inicioDoDia: 0, provedorStt: "falso", provedorTts: "falso" };

describeIntegracao("fim da ligação na conversa (NOD-168)", () => {
  it("cerebro_caiu grava UMA linha de sistema com o motivo e o evento dela; a 2ª chamada não duplica", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, escopo);
      const agora = () => Date.now();
      const deps = depsSobre(repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
      const { ligacao } = (await ligar(deps, { agenteId, contexto, executor: "local", iniciadaPor: "produto" })).data;
      await atenderLigacao(deps, { ligacaoId: ligacao.id });

      const r = await encerrarLigacao(deps, { ligacaoId: ligacao.id, motivo: "cerebro_caiu" });
      expect(r.data).toMatchObject({ motivoFim: "cerebro_caiu" });
      const sistema = (await repos.mensagens.listarDaConversa(conversaId, 20)).filter((m) => m.kind === "sistema" && m.payload?.kind !== "ligacao");
      expect(sistema.map((m) => m.texto)).toEqual(["A ligação caiu: o seu Mac parou de responder."]);
      expect(r.events?.map((e) => e.kind)).toEqual(["ligacao_mudou", "mensagem_criada"]);
      expect(r.events?.[1]).toMatchObject({ conversaId, dados: { mensagem_id: sistema[0]?.id, kind: "sistema", ligacao_id: ligacao.id } });

      const deNovo = await encerrarLigacao(deps, { ligacaoId: ligacao.id, motivo: "erro" });
      expect(deNovo.events ?? []).toEqual([]);
      expect(deNovo.data).toMatchObject({ motivoFim: "cerebro_caiu" });
      expect((await repos.mensagens.listarDaConversa(conversaId, 20)).filter((m) => m.kind === "sistema" && m.payload?.kind !== "ligacao")).toHaveLength(1);
    });
  });

  it("pessoa_desligou não grava linha nenhuma além do \"Chat de voz\"", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, escopo);
      const agora = () => Date.now();
      const deps = depsSobre(repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
      const { ligacao } = (await ligar(deps, { agenteId, contexto, executor: "local", iniciadaPor: "produto" })).data;
      await atenderLigacao(deps, { ligacaoId: ligacao.id });

      const r = await encerrarLigacao(deps, { ligacaoId: ligacao.id, motivo: "pessoa_desligou" });
      expect(r.events?.map((e) => e.kind)).toEqual(["ligacao_mudou"]);
      const sistema = (await repos.mensagens.listarDaConversa(conversaId, 20)).filter((m) => m.kind === "sistema");
      expect(sistema.map((m) => m.payload?.kind)).toEqual(["ligacao"]);
    });
  });

  it("recusada (a pessoa seguiu sem voz no onboarding) não grava linha: não foi o bot que recusou", async () => {
    await withRollback(escopo, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, escopo);
      const agora = () => Date.now();
      const deps = depsSobre(repos, escopo, { services: servicosDeTeste({ agora }), agora, trx });
      const { ligacao } = (await ligar(deps, { agenteId, contexto, executor: "local", iniciadaPor: "produto" })).data;

      const r = await encerrarLigacao(deps, { ligacaoId: ligacao.id, motivo: "recusada" });
      expect(r.data).toMatchObject({ motivoFim: "recusada" });
      expect(r.events?.map((e) => e.kind)).toEqual(["ligacao_mudou"]);
      const sistema = (await repos.mensagens.listarDaConversa(conversaId, 20)).filter((m) => m.kind === "sistema" && m.payload?.kind !== "ligacao");
      expect(sistema).toEqual([]);
    });
  });
});
