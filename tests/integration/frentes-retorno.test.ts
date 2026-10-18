import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { Turno } from "../../src/contracts/turno.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { INSTRUCAO_DO_RETORNO } from "../../src/domain/retorno-do-lote.ts";
import { entregarRespostaPeer } from "../../src/use-cases/entregar-resposta-peer.ts";
import { fecharLoteSePronto } from "../../src/use-cases/fechar-lote.ts";
import { abrirFrentes, devolverResumo } from "../../src/use-cases/frentes.ts";
import { parar } from "../../src/use-cases/parar.ts";
import { pedirABot } from "../../src/use-cases/pedir-a-bot.ts";
import { criarTrabalho, pararTrabalho, sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { contexto, depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre as depsL5, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const TRES = [
  { titulo: "Login no Safari", pedido: "Conserte o login no Safari." },
  { titulo: "CI vermelha", pedido: "Descubra por que a CI quebrou." },
  { titulo: "Notas da versão", pedido: "Escreva as notas da versão." },
];

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
async function montar(trx: Trx) {
  const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  const { deps, repos } = depsSobre(trx, MARLON);
  const turnoDaConversa = async (p: { agenteId?: string; conversaId?: string; texto?: string } = {}) =>
    (await repos.turnos.enfileirar({ executor: "catcher", conversaId: p.conversaId ?? ada.conversaId, agenteId: p.agenteId ?? ada.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: p.texto ?? "conserte o login, a CI e as notas", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" }))!;
  const abrir = async (dono: Turno, frentes = TRES, avisar = false) => {
    const r = await abrirFrentes(deps, { ...contexto(dono.agenteId, dono.conversaId, dono.id), frentes, avisar_a_cada_uma: avisar });
    if (!r.data.ok) throw new Error(`deveria abrir: ${r.data.instrucao}`);
    return { loteId: r.data.lote_id, ids: r.data.frentes.map((f) => f.trabalho_id) };
  };
  const turnoDa = async (trabalhoId: string) => (await repos.turnos.doTrabalho(trabalhoId))[0]!;
  /** A frente termina: o turno dela assenta e o trabalho relê os fatos (o caminho do assentamento de verdade). */
  const terminar = async (trabalhoId: string, feito?: string) => {
    const t = await turnoDa(trabalhoId);
    if (feito) await devolverResumo(deps, { ...contexto(t.agenteId, t.conversaId, t.id), feito });
    await repos.turnos.assentar(t.id, { estado: "concluido" });
    return sincronizarTrabalho(deps, trabalhoId);
  };
  const retomadasDe = async (dono: Turno) => (await repos.turnos.listarDaConversa(dono.conversaId, 500)).filter((t) => t.origem === "retomada" && t.retomaTurnoId === dono.id);
  const linhas = async (conversaId: string, kind: string) => (await repos.mensagens.listarDaConversa(conversaId, 500)).filter((m) => m.payload?.kind === kind);
  return { ada, deps, repos, turnoDaConversa, abrir, turnoDa, terminar, retomadasDe, linhas };
}

describeIntegracao("frentes: o lote volta ao dono numa mensagem só (ADR-099, I3)", () => {
  it("3 frentes → exatamente 1 retomada do dono, com os resumos, a marca de fora e a linha; o turno seguinte da pessoa nasce limpo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { loteId, ids } = await m.abrir(dono);
      // A CI leu uma página de fora: o retorno nasce marcado.
      await m.repos.turnos.contaminar((await m.turnoDa(ids[1]!)).id, Date.now());
      await m.repos.turnos.assentar(dono.id, { estado: "concluido" });

      await m.terminar(ids[0]!, "Corrigi o login no Safari");
      await m.terminar(ids[1]!);
      expect(await m.retomadasDe(dono)).toHaveLength(0);
      expect((await m.repos.frentes.buscarLote(loteId))?.devolvidoEm).toBeNull();

      const events = await m.terminar(ids[2]!, "Notas escritas");
      const [retorno, ...mais] = await m.retomadasDe(dono);
      expect(mais).toHaveLength(0);
      expect(retorno).toMatchObject({ estado: "pendente", trabalhoId: null, agenteId: m.ada.agenteId, entradaConfianca: "confiavel" });
      expect(retorno!.entradaTexto).toContain("As 3 frentes que você abriu para este pedido terminaram.");
      expect(retorno!.entradaTexto).toContain(INSTRUCAO_DO_RETORNO);
      const json = JSON.parse(retorno!.entradaTexto.split("\n")[1]!) as Record<string, unknown>[];
      expect(json.map((f) => [f.titulo, f.estado, f.feito])).toEqual([
        ["Login no Safari", "terminado", "Corrigi o login no Safari"],
        ["CI vermelha", "terminado", "A frente terminou sem dizer o que fez."],
        ["Notas da versão", "terminado", "Notas escritas"],
      ]);
      expect(json.map((f) => f.cuidado ?? false)).toEqual([false, true, false]);
      expect(await m.repos.turnos.contaminado(retorno!.id)).toBe(true);
      expect(await m.repos.frentes.buscarLote(loteId)).toMatchObject({ retornoTurnoId: retorno!.id, devolvidoEm: expect.any(Number) });

      const [linha, ...outras] = await m.linhas(m.ada.conversaId, "frentes_terminadas");
      expect(outras).toHaveLength(0);
      expect(linha).toMatchObject({ kind: "sistema", turnoId: retorno!.id, texto: "3 frentes terminaram", confianca: "confiavel", payload: { loteId, frentes: ids.map((id) => ({ trabalhoId: id, estado: "terminado" })) } });
      expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(["trabalho_mudou", "turno_criado", "mensagem_criada"]));

      // Idempotente: um fecho a mais (o mesmo trabalho, de novo) não cria outro retorno nem outra linha.
      expect(await fecharLoteSePronto(m.deps, (await m.repos.trabalhos.buscar(ids[2]!))!)).toEqual([]);
      expect(await m.retomadasDe(dono)).toHaveLength(1);
      // O turno seguinte da pessoa nasce limpo (a marca é por turno).
      expect(await m.repos.turnos.contaminado((await m.turnoDaConversa({ texto: "e agora?" })).id)).toBe(false);
    });
  });

  it("avisar_a_cada_uma: um retorno por frente, e só o último fecha o lote", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { loteId, ids } = await m.abrir(dono, TRES.slice(0, 2), true);
      await m.terminar(ids[0]!, "Login corrigido");
      const [primeiro] = await m.retomadasDe(dono);
      expect(primeiro!.entradaTexto).toContain('A frente "Login no Safari" deste pedido terminou; falta 1.');
      expect((await m.repos.frentes.buscarLote(loteId))?.devolvidoEm).toBeNull();
      await m.terminar(ids[1]!, "CI verde");
      const retornos = await m.retomadasDe(dono);
      expect(retornos).toHaveLength(2);
      expect(retornos[1]!.entradaTexto).toContain("era a última");
      expect((await m.repos.frentes.buscarLote(loteId))?.retornoTurnoId).toBe(retornos[1]!.id);
      expect((await m.linhas(m.ada.conversaId, "frentes_terminadas")).map((l) => l.texto)).toEqual(["A frente Login no Safari terminou", "A frente CI vermelha terminou"]);
    });
  });

  it("frente parada pela pessoa conta como encerrada: o lote fecha com o que tiver", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { ids } = await m.abrir(dono, TRES.slice(0, 2));
      await m.terminar(ids[0]!, "Login corrigido");
      await pararTrabalho(m.deps, { trabalhoId: ids[1]! });
      const [retorno, ...mais] = await m.retomadasDe(dono);
      expect(mais).toHaveLength(0);
      const json = JSON.parse(retorno!.entradaTexto.split("\n")[1]!) as Record<string, unknown>[];
      expect(json[1]).toMatchObject({ titulo: "CI vermelha", estado: "parado", motivo: "parada pela pessoa" });
    });
  });

  it("o Parar do chat para o dono: o lote fecha com uma linha só, sem acordar o dono", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const dono = await m.turnoDaConversa();
      const { loteId } = await m.abrir(dono);
      await parar(m.deps, { conversaId: m.ada.conversaId });
      expect(await m.retomadasDe(dono)).toHaveLength(0);
      expect(await m.repos.frentes.buscarLote(loteId)).toMatchObject({ retornoTurnoId: null, devolvidoEm: expect.any(Number) });
      expect((await m.linhas(m.ada.conversaId, "frentes_terminadas")).map((l) => l.texto)).toEqual(["3 frentes terminaram"]);
    });
  });

  it("um pedido nunca espera frentes de outro: dois lotes do mesmo bot voltam cada um no seu tempo", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const primeiro = await m.turnoDaConversa();
      const a = await m.abrir(primeiro, TRES.slice(0, 1));
      const segundo = await m.turnoDaConversa({ texto: "e escreva as notas" });
      const b = await m.abrir(segundo, TRES.slice(2));
      await m.terminar(b.ids[0]!, "Notas escritas");
      expect(await m.retomadasDe(segundo)).toHaveLength(1);
      expect(await m.retomadasDe(primeiro)).toHaveLength(0);
      await m.terminar(a.ids[0]!, "Login corrigido");
      expect(await m.retomadasDe(primeiro)).toHaveLength(1);
      expect(await m.retomadasDe(segundo)).toHaveLength(1);
    });
  });

  it("lote de colega: a resposta vai direto a quem pediu, sem turno no dono, e o dono só ganha a linha", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const bia = await agenteComConversa(trx, MARLON, { nome: "Bia" });
      const daAda = await m.turnoDaConversa({ texto: "peça à Bia" });
      await m.repos.turnos.assentar(daAda.id, { estado: "concluido" });
      const pedido = await pedirABot(m.deps, { ...contexto(m.ada.agenteId, m.ada.conversaId, daAda.id), agente: "Bia", pedido: "Revise o login e a CI" });
      if (!pedido.data.ok) throw new Error(pedido.data.instrucao);
      // O turno curto da triagem roda na conversa da Bia, fora de task (com a triagem, o pedido já nasce assim).
      expect((await m.repos.turnos.buscar(pedido.data.tarefa_id))?.trabalhoId ?? null).toBeNull();
      const triagem = (await m.repos.turnos.buscar(pedido.data.tarefa_id))!;
      const { loteId, ids } = await m.abrir(triagem, TRES.slice(0, 2));
      await m.repos.turnos.assentar(triagem.id, { estado: "concluido" });
      // O "comecei 2 frentes" da triagem não é o resultado: a entrega espera o lote.
      expect((await entregarRespostaPeer(m.deps, { tarefaId: triagem.id, texto: "Comecei duas frentes." })).data).toEqual({ ignorado: "aguardando_frentes" });

      await m.terminar(ids[0]!, "Login revisado: ok");
      expect((await m.linhas(m.ada.conversaId, "peer_ask"))).toHaveLength(0);
      await m.terminar(ids[1]!, "CI: um teste instável");

      // Nenhum turno novo na Bia além das frentes e da triagem.
      expect(await m.retomadasDe(triagem)).toHaveLength(0);
      const [resposta, ...mais] = await m.linhas(m.ada.conversaId, "peer_ask");
      expect(mais).toHaveLength(0);
      expect(resposta!.texto).toBe("- Login no Safari: Login revisado: ok\n- CI vermelha: CI: um teste instável");
      const continuacao = (await m.repos.turnos.buscar(resposta!.turnoId!))!;
      expect(continuacao).toMatchObject({ origem: "retomada", retomaTurnoId: daAda.id, agenteId: m.ada.agenteId, estado: "pendente" });

      const [linha, ...outras] = await m.linhas(bia.conversaId, "pedido_respondido");
      expect(outras).toHaveLength(0);
      // Chat limpo (PR 3): a linha leva o texto entregue e o turno do pedido (a raiz da troca agrupada), com a confiança da
      // fala entregue — a frente de um pedido de colega conta como de fora (frentesDoLote, `origem = 'colega'`).
      expect(linha).toMatchObject({ kind: "sistema", texto: "Respondi ao pedido de Ada", confianca: "nao_confiavel", payload: { loteId, agenteId: m.ada.agenteId, nome: "Ada", resposta: resposta!.texto, turnoRaizId: triagem.id } });
      expect(await m.linhas(bia.conversaId, "frentes_terminadas")).toHaveLength(0);
      expect(await m.repos.frentes.buscarLote(loteId)).toMatchObject({ retornoTurnoId: null, devolvidoEm: expect.any(Number) });
    });
  });
  it("lote aberto pela rede (I8): o turno promovido virou da frente, e o retorno nasce na conversa do dono, com a sessão dela", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      for (const trabalhoDoLote of ["nulo", "a frente"] as const) {
        // O formato da I8: o turno da conversa é promovido, abre o lote e passa a pertencer à frente.
        const promovido = await m.turnoDaConversa({ texto: "migre os relatórios" });
        const lote = (await m.repos.frentes.criarLote({ agenteId: m.ada.agenteId, abertoPorTurnoId: promovido.id }))!;
        const { trabalho: frente } = await criarTrabalho(m.deps, { agenteId: m.ada.agenteId, conversaId: m.ada.conversaId, titulo: "Migrar relatórios", origem: "rede", forma: "frente", loteId: lote.id });
        await trx`update turnos set trabalho_id = ${frente.id} where id = ${promovido.id}`;
        if (trabalhoDoLote === "a frente") await trx`update lotes_de_frentes set trabalho_id = ${frente.id} where id = ${lote.id}`;
        await trx`update trabalhos set sessao_cli = 'sessao-da-frente', sessao_executor = 'local', sessao_harness = 'claude-cli' where id = ${frente.id}`;
        await trx`update conversas set sessao_cli = 'sessao-da-conversa', sessao_executor = 'local', sessao_harness = 'claude-cli' where id = ${m.ada.conversaId}`;
        await m.repos.turnos.assentar(promovido.id, { estado: "concluido" });
        await sincronizarTrabalho(m.deps, frente.id);

        const [retorno, ...mais] = await m.retomadasDe((await m.repos.turnos.buscar(promovido.id))!);
        expect(mais, trabalhoDoLote).toHaveLength(0);
        expect(retorno, trabalhoDoLote).toMatchObject({ conversaId: m.ada.conversaId, trabalhoId: null, origem: "retomada" });
        const agora = () => Date.now();
        const l5 = depsL5(m.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
        const pronto = { estado: "pronto", versao: "teste", em: Date.now() } as const;
        const plano = (await emitirPlanoTurno(l5, { turnoId: retorno!.id, machineId: randomUUID(), executor: "local", harnesses: { "claude-cli": pronto } })).data;
        expect(plano.entrada.sessaoCli, trabalhoDoLote).toBe("sessao-da-conversa");
        await m.repos.turnos.assentar(retorno!.id, { estado: "concluido" });
      }
    });
  });
});
