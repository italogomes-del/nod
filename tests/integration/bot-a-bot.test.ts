import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import { montarPlano } from "../../src/domain/plano-turno.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import { entregarRespostaPeer } from "../../src/use-cases/entregar-resposta-peer.ts";
import { CLASSE_PERGUNTAR_A_BOT, perguntarABot } from "../../src/use-cases/perguntar-a-bot.ts";
import { contexto, depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_LEAPY } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON };
const ANA = { tenantId: TENANT_LEAPY, pessoaId: PESSOA_ANA };
const AGORA = Date.parse("2026-09-16T15:00:00Z");

describeIntegracao("bot-a-bot (E12.4 eixo 1, ADR-025/026): tarefa_id, peer_ask não confiável, continuação em profundidade 1, outro dono negado", () => {
  it("mesmo dono: tarefa_id = turno peer no alvo (profundidade 1, nao_confiavel); ao assentar, peer_ask nao_confiavel + continuação sem perguntar_a_bot; contrato services.sala.perguntar", async () => {
    await withRollback(MARLON, async (trx) => {
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const tuca = await agenteComConversa(trx, MARLON, { nome: "Tuca" });
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      const turnoVera = await repos.turnos.enfileirar({ conversaId: vera.conversaId, agenteId: vera.agenteId, origem: "conversa", prazoEm: AGORA + 1, profundidade: 0, entradaTexto: "pergunte ao Tuca o status do PR 42", entradaConfianca: "confiavel", modelo: "m" });

      const r = await perguntarABot(deps, { ...contexto(vera.agenteId, vera.conversaId, turnoVera?.id), agente: "Tuca", pergunta: "qual o status do PR 42?" });
      const tarefa = await repos.turnos.buscar(r.data.tarefa_id);
      expect(tarefa).toMatchObject({ agenteId: tuca.agenteId, conversaId: tuca.conversaId, origem: "peer", profundidade: 1, entradaConfianca: "nao_confiavel", estado: "pendente", ownerId: PESSOA_MARLON });
      expect((await repos.mensagens.listarDaConversa(tuca.conversaId)).map((m) => [m.turnoId, m.autoria.autor_id, m.confianca])).toEqual([[tarefa?.id, vera.agenteId, "nao_confiavel"]]);
      await repos.events.gravarComOutbox(r.events ?? []);

      // O contrato Services.sala.perguntar resolve o remetente pelo turno.
      const pelaInterface = await deps.services.sala.perguntar(trx, { turnoId: turnoVera?.id ?? "", agente: "tuca", pergunta: "e o PR 43?" });
      expect((await repos.turnos.buscar(pelaInterface.tarefaId))?.origem).toBe("peer");

      const entrega = await entregarRespostaPeer(deps, { tarefaId: r.data.tarefa_id, texto: "PR 42 aprovado; falta o merge." });
      if (!("mensagem" in entrega.data)) throw new Error("deveria entregar");
      expect(entrega.data.mensagem).toMatchObject({ conversaId: vera.conversaId, kind: "peer_ask", confianca: "nao_confiavel", payload: { kind: "peer_ask", agenteId: tuca.agenteId, nome: "Tuca", naoSupervisionado: true, tarefaId: r.data.tarefa_id } });
      expect(entrega.data.continuacao).toMatchObject({ conversaId: vera.conversaId, agenteId: vera.agenteId, origem: "peer", profundidade: 1 });
      const agente = await repos.agentes.buscar(vera.agenteId);
      const plano = montarPlano({ turno: entrega.data.continuacao, agente: agente!, memorias: [], concessoes: [], conectores: [], modo: "conversa", confianca: "nao_confiavel", profundidade: 1, inventario: { estado: "pronto", versao: "x", em: AGORA }, executor: "catcher", sessaoCli: null, pessoaNome: "Marlon", agora: AGORA });
      expect(plano.catalogo.ferramentas.map((f) => f.nome)).toEqual(["lembrar"]);
      expect(plano.profundidade).toBe(1);
      // a continuação não é tarefa: entregar sobre ela é ignorado
      expect((await entregarRespostaPeer(deps, { tarefaId: entrega.data.continuacao.id, texto: "x" })).data).toEqual({ ignorado: "nao_e_tarefa_peer" });
    });
  });

  it("outro dono sem procuração → nao_permitido e nenhum turno; com procuração da classe perguntar_a_bot (concedida pela dona do alvo) → tarefa", async () => {
    await withRollback(MARLON, async (trx) => {
      const vera = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      await vincularEscopo(trx, ANA);
      const tuca = await agenteComConversa(trx, ANA, { nome: "Tuca", dono: "empresa" });
      await vincularEscopo(trx, MARLON);
      const { deps, repos } = depsSobre(trx, MARLON, { agora: () => AGORA });
      await expect(perguntarABot(deps, { ...contexto(vera.agenteId, vera.conversaId), agente: "Tuca", pergunta: "oi" })).rejects.toMatchObject({ codigo: "nao_permitido" });
      expect(await repos.turnos.listarDaConversa(vera.conversaId)).toEqual([]);

      // Ana (dona de Tuca) concede a procuração; Marlon a enxerga? A procuração é privada de Ana: sob a policy, Marlon não a vê,
      // então continua negado — fail-closed até haver rota/visibilidade de procuração (registrado).
      await vincularEscopo(trx, ANA);
      await criarRepos(trx, ANA).procuracoes.criar({ agenteConcedenteId: tuca.agenteId, agenteBeneficiarioId: vera.agenteId, classesPermitidas: [CLASSE_PERGUNTAR_A_BOT], tetoDiario: 5 });
      await vincularEscopo(trx, MARLON);
      await expect(perguntarABot(deps, { ...contexto(vera.agenteId, vera.conversaId), agente: "Tuca", pergunta: "oi" })).rejects.toMatchObject({ codigo: "nao_permitido" });
      // Uma procuração visível ao remetente (equipe) autoriza — e a conversa própria do alvo precisa ser visível também.
      await vincularEscopo(trx, ANA);
      await trx`update procuracoes set visibility = 'equipe' where agente_beneficiario_id = ${vera.agenteId}`;
      await trx`update conversas set visibility = 'equipe' where id = ${tuca.conversaId}`;
      await vincularEscopo(trx, MARLON);
      const original = await repos.turnos.enfileirar({ conversaId: vera.conversaId, agenteId: vera.agenteId, origem: "conversa", prazoEm: AGORA + 1000, profundidade: 0, entradaTexto: "consulte Tuca", entradaConfianca: "confiavel", modelo: "m" });
      const r = await perguntarABot(deps, { ...contexto(vera.agenteId, vera.conversaId, original!.id), agente: "Tuca", pergunta: "oi" });
      expect((await repos.turnos.buscar(r.data.tarefa_id))).toMatchObject({ agenteId: tuca.agenteId, origem: "peer", profundidade: 1, ownerId: PESSOA_MARLON });
    });
  });
});
