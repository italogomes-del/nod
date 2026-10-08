import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { CAPACIDADES_HARNESS, type IdHarness } from "../../src/contracts/harness.ts";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { abrirTask, absorverNoTrabalho, fazerAqui, fazerDepois, mandarParaTask, mensagemParaTrabalho, promoverNaRede } from "../../src/use-cases/coordenar-trabalhos.ts";
import { emitirPlanoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { lerConversa } from "../../src/use-cases/enviar-mensagem.ts";
import { criarTrabalho, fecharPorMemoria, sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const pronto = { estado: "pronto", versao: "teste", em: Date.now() } as const;
const harnesses: Partial<Record<IdHarness, typeof pronto>> = { "claude-cli": pronto };
const CLAUDE_ORIGINAL = { ...CAPACIDADES_HARNESS["claude-cli"] };
afterEach(() => {
  Object.assign(CAPACIDADES_HARNESS["claude-cli"], CLAUDE_ORIGINAL);
});

type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
async function montar(trx: Trx, agora = () => Date.now()) {
  const base = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  await base.repos.agentes.atualizarPerfil(base.agenteId, { confirmado: true });
  const deps = depsSobre(base.repos, MARLON, { services: servicosDeTeste({ agora, tokens: criarTokenTurno({ agora }) }), agora, trx });
  const turno = (extra: { trabalhoId?: string | null; origem?: "conversa" | "rotina" } = {}) =>
    base.repos.turnos.enfileirar({ conversaId: base.conversaId, agenteId: base.agenteId, origem: extra.origem ?? "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "monte o dashboard de churn", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli", trabalhoId: extra.trabalhoId ?? null });
  const ctx = (turnoId: string) => ({ turnoId, agenteId: base.agenteId, conversaId: base.conversaId });
  const plano = async (turnoId: string) => (await emitirPlanoTurno(deps, { turnoId, machineId: randomUUID(), executor: "local", harnesses })).data;
  return { ...base, deps, turno, ctx, plano };
}

describeIntegracao("a conversa coordena (#193, ADR-081 §7)", () => {
  it("abrir_task: cria a task da pessoa, a linha \"Abriu a task\" e o turno dela; a conversa recebe a seção Trabalhos em andamento", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const conversa = await m.turno();
      const r = await abrirTask(m.deps, { ...m.ctx(conversa!.id), titulo: "Dashboard de churn", pedido: "Monte o dashboard de churn com os dados de setembro." });
      if (!r.data.ok) throw new Error("deveria abrir");
      const t = await m.repos.trabalhos.buscar(r.data.trabalho_id);
      expect(t).toMatchObject({ origem: "pessoa", titulo: "Dashboard de churn", estado: "na_fila", conversaId: m.conversaId });
      const daTask = (await m.repos.turnos.doTrabalho(t!.id))[0];
      expect(daTask).toMatchObject({ origem: "conversa", estado: "pendente", trabalhoId: t!.id });
      expect(daTask?.entradaTexto).toContain("Monte o dashboard de churn com os dados de setembro.");
      const linha = (await m.repos.mensagens.listarDaConversa(m.conversaId)).find((x) => x.payload?.kind === "trabalho_aberto");
      expect(linha).toMatchObject({ kind: "sistema", texto: "Abriu a task Dashboard de churn", payload: { trabalhoId: t!.id, titulo: "Dashboard de churn", origem: "pessoa" } });
      expect((r.events ?? []).map((e) => e.kind)).toEqual(["trabalho_mudou", "mensagem_criada", "turno_criado"]);

      // O próximo turno da conversa vê a task e tem as duas ferramentas; o turno da task não tem nenhuma das duas.
      const pConversa = await m.plano((await m.turno())!.id);
      expect(pConversa.catalogo.ferramentas.map((f) => f.nome)).toEqual(expect.arrayContaining(["abrir_task", "mandar_para_task"]));
      expect(pConversa.promptSistemaPartes?.volatil).toContain(`"id":"${t!.id}"`);
      const pTask = await m.plano(daTask!.id);
      expect(pTask.catalogo.ferramentas.map((f) => f.nome)).not.toContain("abrir_task");
      expect(pTask.catalogo.ferramentas.map((f) => f.nome)).not.toContain("mandar_para_task");
      expect(pTask.promptSistema).toContain('Task atual: você está na task "Dashboard de churn"');

      // A task não abre outra (2ª camada, além do catálogo).
      const recusa = await abrirTask(m.deps, { ...m.ctx(daTask!.id), titulo: "Outra", pedido: "x" });
      expect(recusa.data).toMatchObject({ ok: false, erro: "nao_abre_task" });
    });
  });

  it("depois_de espera; \"Fazer depois\" grava, recusa ciclo; a task de rotina abre filhas (profundidade 1) e a filha não abre", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const t1 = await m.turno();
      const a = await abrirTask(m.deps, { ...m.ctx(t1!.id), titulo: "Primeira", pedido: "primeira" });
      if (!a.data.ok) throw new Error("abrir");
      const b = await abrirTask(m.deps, { ...m.ctx(t1!.id), titulo: "Segunda", pedido: "segunda", depois_de: a.data.trabalho_id });
      if (!b.data.ok) throw new Error("abrir 2");
      expect((await m.repos.trabalhos.buscar(b.data.trabalho_id))?.depoisDeTrabalhoId).toBe(a.data.trabalho_id);
      expect((await abrirTask(m.deps, { ...m.ctx(t1!.id), titulo: "X", pedido: "x", depois_de: randomUUID() })).data).toMatchObject({ ok: false, erro: "depois_de_invalido" });
      await expect(fazerDepois(m.deps, { trabalhoId: a.data.trabalho_id, depoisDe: b.data.trabalho_id })).rejects.toMatchObject({ codigo: "entrada_invalida" });
      const tirado = await fazerDepois(m.deps, { trabalhoId: b.data.trabalho_id, depoisDe: null });
      expect(tirado.data.trabalho.depoisDeTrabalhoId).toBeNull();

      const rotina = await criarTrabalho(m.deps, { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "Triagem", origem: "rotina", pasta: null });
      const turnoRotina = await m.turno({ trabalhoId: rotina.trabalho.id, origem: "rotina" });
      expect((await m.plano(turnoRotina!.id)).catalogo.ferramentas.map((f) => f.nome)).toContain("abrir_task");
      const filha = await abrirTask(m.deps, { ...m.ctx(turnoRotina!.id), titulo: "Responder chamado", pedido: "responda o chamado 42" });
      if (!filha.data.ok) throw new Error("filha");
      expect(await m.repos.trabalhos.buscar(filha.data.trabalho_id)).toMatchObject({ origem: "rotina", trabalhoMaeId: rotina.trabalho.id });
      const turnoFilha = (await m.repos.turnos.doTrabalho(filha.data.trabalho_id))[0];
      expect(turnoFilha?.origem).toBe("rotina");
      const pFilha = await m.plano(turnoFilha!.id);
      expect(pFilha.catalogo.ferramentas.map((f) => f.nome)).not.toContain("abrir_task");
      expect(pFilha.promptSistema).toContain("Uma task não abre outras");
    });
  });

  it("\"Fazer depois\" com a task já rodando: o turno vivo para, o mesmo pedido volta à fila e a task espera a outra (achado do e2e, 2026-10-08)", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const conversa = await m.turno();
      await m.repos.turnos.assentar(conversa!.id, { estado: "concluido" });
      const a = await abrirTask(m.deps, { ...m.ctx(conversa!.id), titulo: "Migrar relatórios", pedido: "migre os relatórios" });
      const b = await abrirTask(m.deps, { ...m.ctx(conversa!.id), titulo: "Dashboard de churn", pedido: "monte o dashboard de churn" });
      if (!a.data.ok || !b.data.ok) throw new Error("abrir");
      const [idA, idB] = [a.data.trabalho_id, b.data.trabalho_id];
      for (let i = 0; i < 2; i++) await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      await sincronizarTrabalho(m.deps, idA);
      await sincronizarTrabalho(m.deps, idB);
      const [vivoB] = await m.repos.turnos.doTrabalho(idB);
      expect(vivoB).toMatchObject({ estado: "despachando" });
      expect(await m.repos.trabalhos.buscar(idB)).toMatchObject({ estado: "rodando" });

      const r = await fazerDepois(m.deps, { trabalhoId: idB, depoisDe: idA });
      expect(r.data.trabalho).toMatchObject({ depoisDeTrabalhoId: idA, estado: "na_fila" });
      const turnosB = await m.repos.turnos.doTrabalho(idB);
      expect(turnosB.map((t) => [t.estado, t.pararSolicitadoEm !== null])).toEqual([["despachando", true], ["pendente", false]]);
      expect(turnosB[1]).toMatchObject({ origem: vivoB!.origem, entradaTexto: vivoB!.entradaTexto, trabalhoId: idB });
      expect((r.events ?? []).map((e) => e.kind)).toContain("turno_criado");

      // O turno parado assenta; a task continua na fila, e o pedido não roda enquanto a outra não acabar.
      await m.repos.turnos.assentar(vivoB!.id, { estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
      await sincronizarTrabalho(m.deps, idB);
      expect((await m.repos.trabalhos.buscar(idB))?.estado).toBe("na_fila");
      expect(await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() })).toBeNull();
      const [vivoA] = await m.repos.turnos.doTrabalho(idA);
      await m.repos.turnos.assentar(vivoA!.id, { estado: "concluido" });
      await sincronizarTrabalho(m.deps, idA);
      expect((await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() }))?.id).toBe(turnosB[1]!.id);

      // Sem a outra aberta (ou numa task de rotina), "Fazer depois" só grava: nada para.
      const c = await abrirTask(m.deps, { ...m.ctx(conversa!.id), titulo: "Outra", pedido: "outra" });
      if (!c.data.ok) throw new Error("abrir 3");
      await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      await fazerDepois(m.deps, { trabalhoId: c.data.trabalho_id, depoisDe: idA });
      expect((await m.repos.turnos.doTrabalho(c.data.trabalho_id)).map((t) => [t.estado, t.pararSolicitadoEm])).toEqual([["despachando", null]]);
    });
  });

  it("mandar_para_task chega à task certa (mensagem + turno na faixa dela) e entra no turno vivo dela, nunca no da conversa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const conversa = await m.turno();
      const a = (await criarTrabalho(m.deps, { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "A", origem: "pessoa" })).trabalho;
      const b = (await criarTrabalho(m.deps, { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "B", origem: "pessoa" })).trabalho;
      const vivoA = await m.turno({ trabalhoId: a.id });
      await m.turno({ trabalhoId: b.id });
      await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      expect((await m.repos.turnos.buscar(vivoA!.id))?.estado).toBe("despachando");

      const r = await mandarParaTask(m.deps, { ...m.ctx(conversa!.id), trabalho_id: a.id, texto: "Use o mês passado também" });
      expect(r.data).toMatchObject({ ok: true, entrou: "no_meio" });
      const recado = (await m.repos.turnos.doTrabalho(a.id)).find((t) => t.estado === "pendente");
      expect(recado).toMatchObject({ origem: "retomada", retomaTurnoId: vivoA!.id, trabalhoId: a.id });
      expect((await m.repos.turnos.doTrabalho(b.id)).filter((t) => t.estado === "pendente")).toHaveLength(0);

      // A renovação do turno vivo da task A absorve o recado; a da conversa não pega nada dela.
      expect((await absorverNoTrabalho(m.deps, { turnoId: conversa!.id })).data.textos).toEqual([]);
      const absorvido = await absorverNoTrabalho(m.deps, { turnoId: vivoA!.id });
      expect(absorvido.data.textos).toEqual(["[nod] Recado da conversa com a pessoa, repassado por você: Use o mês passado também"]);
      expect((await m.repos.turnos.buscar(recado!.id))).toMatchObject({ estado: "interrompido", motivoInterrupcao: "absorvido", absorvidoPor: vivoA!.id });

      // A leitura da conversa marca a fala do recado com o trabalho (a web a tira do chat e a põe na task).
      const lida = await lerConversa(m.deps, { conversaId: m.conversaId });
      const fala = lida.data.mensagens.find((x) => x.texto === "Use o mês passado também");
      expect(fala).toMatchObject({ trabalhoId: a.id, origemTurno: null });

      // Do turno de uma task, não repassa; id de outro bot, não acha.
      expect((await mandarParaTask(m.deps, { ...m.ctx(vivoA!.id), trabalho_id: b.id, texto: "x" })).data).toMatchObject({ ok: false, erro: "nao_repassa" });
      expect((await mandarParaTask(m.deps, { ...m.ctx(conversa!.id), trabalho_id: randomUUID(), texto: "x" })).data).toMatchObject({ ok: false, erro: "task_nao_encontrada" });
    });
  });

  it("a pessoa escreve na task parada: vira o próximo passo dela; \"Fazer aqui\" desfaz a task e manda o pedido para a conversa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const conversa = await m.turno();
      const aberta = await abrirTask(m.deps, { ...m.ctx(conversa!.id), titulo: "Login do app", pedido: "Conserte o login do app." });
      if (!aberta.data.ok) throw new Error("abrir");
      const id = aberta.data.trabalho_id;
      const msg = await mensagemParaTrabalho(m.deps, { trabalhoId: id, texto: "Comece pelo Safari" });
      expect((await m.repos.turnos.buscar(msg.data.mensagemTurnoId))).toMatchObject({ trabalhoId: id, estado: "pendente" });
      await expect(mensagemParaTrabalho(m.deps, { trabalhoId: id, texto: "  " })).rejects.toMatchObject({ codigo: "texto_vazio" });

      const aqui = await fazerAqui(m.deps, { trabalhoId: id });
      expect(aqui.data.trabalho.estado).toBe("parado");
      expect((await m.repos.turnos.doTrabalho(id)).every((t) => t.estado === "interrompido")).toBe(true);
      const daConversa = await m.repos.turnos.buscar(aqui.data.turnoId);
      expect(daConversa).toMatchObject({ trabalhoId: null, origem: "conversa", estado: "pendente" });
      expect(daConversa?.entradaTexto).toContain("Conserte o login do app.");
      await expect(fazerAqui(m.deps, { trabalhoId: id })).rejects.toMatchObject({ codigo: "estado_invalido" });
    });
  });

  it("rede de 2 min: o turno de conversa com ferramenta vira task `rede` e a próxima mensagem sai com bifurcar; sem bifurcaSessao, não promove", async () => {
    await withRollback(MARLON, async (trx) => {
      let relogio = Date.now();
      const m = await montar(trx, () => relogio);
      const s = randomUUID();
      await m.repos.conversas.atualizarSessaoCli(m.conversaId, s, "local", "claude-cli");
      const vivo = await m.turno();
      await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: relogio });
      const despachadoEm = relogio;
      relogio += 119_000;
      expect((await promoverNaRede(m.deps, { turnoId: vivo!.id, despachadoEm, fezFerramenta: true, harness: "claude-cli", sessaoCli: s, maquinaBifurca: true })).data.trabalho).toBeNull();
      relogio += 1_000;
      expect((await promoverNaRede(m.deps, { turnoId: vivo!.id, despachadoEm, fezFerramenta: false, harness: "claude-cli", sessaoCli: s, maquinaBifurca: true })).data.trabalho).toBeNull();
      expect((await promoverNaRede(m.deps, { turnoId: vivo!.id, despachadoEm, fezFerramenta: true, harness: "codex-cli", sessaoCli: s, maquinaBifurca: true })).data.trabalho).toBeNull();
      // Revisão do épico (S15): sem a máquina anunciar que bifurca, não promove (app antigo).
      expect((await promoverNaRede(m.deps, { turnoId: vivo!.id, despachadoEm, fezFerramenta: true, harness: "claude-cli", sessaoCli: s })).data.trabalho).toBeNull();
      const r = await promoverNaRede(m.deps, { turnoId: vivo!.id, despachadoEm, fezFerramenta: true, harness: "claude-cli", sessaoCli: s, maquinaBifurca: true });
      // Revisão do épico (S13): a task da rede ganha pasta própria (os turnos seguintes rodam nela).
      expect(r.data.trabalho).toMatchObject({ origem: "rede", estado: "rodando", sessaoCli: s, pasta: expect.stringMatching(/^~\/nod\/Ada\//) });
      expect((await m.repos.turnos.buscar(vivo!.id))?.trabalhoId).toBe(r.data.trabalho?.id);
      expect((r.events ?? []).map((e) => e.kind)).toEqual(["trabalho_mudou", "mensagem_criada"]);

      // A conversa ficou livre: a próxima mensagem é despachada já, e numa cópia da sessão.
      const proxima = await m.turno();
      expect((await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: relogio }))?.id).toBe(proxima!.id);
      expect((await m.plano(proxima!.id)).entrada).toMatchObject({ sessaoCli: s, bifurcar: true });
    });
  });

  it("#194: sob pressão, a task esperando a pessoa fecha (fechado_ocioso) com uma linha na conversa e segue fechada até a resposta", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx);
      const w = (await criarTrabalho(m.deps, { agenteId: m.agenteId, conversaId: m.conversaId, titulo: "Esperando", origem: "pessoa" })).trabalho;
      const t = await m.turno({ trabalhoId: w.id });
      await m.repos.turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      await m.repos.decisoes.criar({ tipo: "aprovacao", agenteId: m.agenteId, conversaId: m.conversaId, turnoId: t!.id, prazoDecisaoEm: Date.now() + 60_000, frase: "Posso publicar?" });
      await sincronizarTrabalho(m.deps, w.id);
      expect((await m.repos.trabalhos.buscar(w.id))?.estado).toBe("precisa_de_voce");
      const r = await fecharPorMemoria(m.deps, t!.id);
      expect(r.fechou).toBe(true);
      expect((await m.repos.trabalhos.buscar(w.id))?.estado).toBe("fechado_ocioso");
      expect((await m.repos.mensagens.listarDaConversa(m.conversaId)).at(-1)?.texto).toContain("para liberar memória");
      // A renovação seguinte (turno ainda acabando) e o assentar mantêm a task fechada enquanto a decisão espera.
      await sincronizarTrabalho(m.deps, w.id);
      await m.repos.turnos.assentar(t!.id, { estado: "concluido" });
      await sincronizarTrabalho(m.deps, w.id);
      expect((await m.repos.trabalhos.buscar(w.id))?.estado).toBe("fechado_ocioso");
      // Turno sem trabalho nunca é fechado por memória.
      const conversa = await m.turno();
      expect((await fecharPorMemoria(m.deps, conversa!.id)).fechou).toBe(false);
    });
  });
});
