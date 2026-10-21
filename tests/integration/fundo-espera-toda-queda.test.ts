import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import type { ResultadoTurno, Turno } from "../../src/contracts/turno.ts";
import { varrerPessoa as varrerLeases } from "../../src/adapters/fundo/varredor-lease.ts";
import { ENTRADA_DA_NOVA_TENTATIVA, ENTRADA_DA_RETOMADA_DA_QUEDA, RETORNO_DO_LOTE } from "../../src/domain/cota-da-ia.ts";
import { ESPERAS_TRANSITORIAS_NO_FUNDO_MS, LEASE_MS, TENTATIVAS_TRANSITORIAS_MAX } from "../../src/shared/constantes.ts";
import { assentarTurno } from "../../src/use-cases/assentar-turno.ts";
import { dispararRotina } from "../../src/use-cases/disparar-rotina.ts";
import { abrirFrentes, devolverResumo } from "../../src/use-cases/frentes.ts";
import { sincronizarTrabalho } from "../../src/use-cases/trabalhos.ts";
import { contexto, depsSobre } from "../helpers/deps-l7.ts";
import { agenteComConversa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre as depsL5, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * NOD-309 (PR 2): o trabalho de FUNDO que cai num erro TRANSITÓRIO do provedor (sobrecarga, 5xx, rede) tenta de novo
 * sozinho — backoff de ~1, 5 e 15 min, até 3 por cadeia — em vez de virar "falhou". Matriz causa × tipo: rotina, pedido de
 * colega, frente (task) e retorno do lote. A conversa com a pessoa fica como está (aviso de sempre).
 */
const MARLON = { tenantId: TENANT_PADRAO, pessoaId: PESSOA_MARLON };
const SINAIS = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: false };
const falha = (erroCru: string): ResultadoTurno => ({
  desfecho: "falha", motivoFalha: "erro_execucao", erroCru, texto: "", sessaoCli: null, custoUsd: 0, sinais: SINAIS,
  tokens: { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 }, ferramentasChamadas: [], negacoesPermissao: [],
});
const SOBRECARGA = falha('API Error: 529 {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}');
type Trx = Parameters<Parameters<typeof withRollback>[1]>[0];
type Tipo = "rotina" | "pedido" | "frente" | "lote";

async function montar(trx: Trx, tipo: Tipo, o: { proximaJanelaEm?: number } = {}) {
  const ada = await agenteComConversa(trx, MARLON, { nome: "Ada" });
  await trx`update agentes set harness = 'claude-cli', modelo = 'sonnet' where id = ${ada.agenteId}`;
  const { deps, repos } = depsSobre(trx, MARLON);
  const l5 = depsL5(repos, MARLON, { services: servicosDeTeste({}), trx });
  const conversa = (): Promise<Turno | null> => repos.turnos.enfileirar({ executor: "catcher", conversaId: ada.conversaId, agenteId: ada.agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "conserte o login", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" });
  let alvo: Turno;
  let rotinaId: string | null = null;
  if (tipo === "rotina") {
    const agora = Date.now();
    const rotina = await repos.rotinas.criar({ agenteId: ada.agenteId, conversaId: ada.conversaId, cron: "0 8 * * *", fusoIana: "America/Sao_Paulo", instrucao: "Resumo do dia", fonte: "planilha", entregavel: "resumo", limitesAprovacao: "nada sai sem aprovação", politicaSemDado: "silêncio", proximaExecucao: agora });
    const disparo = await dispararRotina(deps, { rotina: rotina!, instanteAgendado: agora, machineId: randomUUID(), executor: "catcher" });
    if (!("turno" in disparo.data)) throw new Error("rotina não disparou");
    alvo = disparo.data.turno;
    rotinaId = rotina!.id;
    // A próxima janela fica onde o teste quer (o disparo já a avançou).
    await trx`update rotinas set proxima_execucao = ${new Date(o.proximaJanelaEm ?? agora + 24 * 3_600_000)} where id = ${rotinaId}`;
  } else if (tipo === "pedido") {
    alvo = (await repos.turnos.enfileirar({ executor: "catcher", conversaId: ada.conversaId, agenteId: ada.agenteId, origem: "peer", prazoEm: Date.now() + 600_000, profundidade: 1, entradaTexto: "Levante os PRs abertos", entradaConfianca: "confiavel", modelo: "sonnet", harness: "claude-cli" }))!;
  } else {
    const dono = (await conversa())!;
    const r = await abrirFrentes(deps, { ...contexto(dono.agenteId, dono.conversaId, dono.id), frentes: [{ titulo: "Login no Safari", pedido: "Conserte o login no Safari." }], avisar_a_cada_uma: false });
    if (!r.data.ok) throw new Error(r.data.instrucao);
    await repos.turnos.assentar(dono.id, { estado: "concluido" });
    const frente = (await repos.turnos.doTrabalho(r.data.frentes[0]!.trabalho_id))[0]!;
    if (tipo === "frente") alvo = frente;
    else {
      await devolverResumo(deps, { ...contexto(frente.agenteId, frente.conversaId, frente.id), feito: "Corrigi o login no Safari" });
      await repos.turnos.assentar(frente.id, { estado: "concluido" });
      await sincronizarTrabalho(deps, r.data.frentes[0]!.trabalho_id);
      const [retorno] = (await repos.turnos.listarDaConversa(ada.conversaId, 500)).filter((x) => x.origem === "retomada" && x.retomaTurnoId === dono.id);
      if (!retorno) throw new Error("sem retorno do lote");
      alvo = retorno;
    }
  }
  /** O turno roda nesta máquina e cai no erro (o caminho do assentamento de verdade). */
  const cair = async (turno: Turno, resultado: ResultadoTurno = SOBRECARGA) => {
    const machineId = randomUUID();
    const pego = await repos.turnos.reivindicar({ machineId, agora: Math.max(Date.now(), (turno.acordarEm ?? 0) + 1) });
    expect(pego?.id).toBe(turno.id);
    return assentarTurno(l5, { turnoId: turno.id, machineId, seqLocal: 1, fala: { tipo: "texto", texto: "" }, resultado, executor: "local", harness: "claude-cli", prontosDaPessoa: ["claude-cli"] });
  };
  /** A volta que a queda de `turno` deixou na fila (pendente, com hora). */
  const voltaDe = async (turno: Turno) => (await repos.turnos.listarDaConversa(ada.conversaId, 500)).find((x) => x.origem === "retomada" && x.estado === "pendente" && x.acordarEm !== null && x.criadoEm >= turno.criadoEm && x.id !== turno.id) ?? null;
  const linhas = async () => (await repos.mensagens.listarDaConversa(ada.conversaId, 500)).filter((m) => m.kind === "sistema" && /está instável\. .* tenta de novo/.test(m.texto ?? ""));
  const interrompidos = async () => (await repos.mensagens.listarDaConversa(ada.conversaId, 500)).filter((m) => m.kind === "sistema" && /Turno interrompido/.test(m.texto ?? ""));
  return { ada, deps, repos, l5, alvo, rotinaId, cair, voltaDe, linhas, interrompidos, conversa };
}

const TIPOS: readonly Tipo[] = ["rotina", "pedido", "frente", "lote"];

describeIntegracao("NOD-309 (PR 2): erro transitório no fundo → nova tentativa com backoff, nunca 'falhou' antes do teto", () => {
  for (const tipo of TIPOS) {
    it(`${tipo}: a 529 vira volta com ~1 min, o marcador da nova tentativa e o contador; uma linha por cadeia`, async () => {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx, tipo);
        const antes = Date.now();
        const r = await m.cair(m.alvo);
        expect(r.data.esperaDaCota).toBe("espera");
        const ev = (r.events ?? []).find((e) => e.kind === "turno_interrompido" && e.turnoId === m.alvo.id);
        expect(ev?.dados).toMatchObject({ espera_no_fundo: "erro_transitorio", tentativa: 1 });
        expect((await m.repos.turnos.buscar(m.alvo.id))?.estado).toBe("interrompido");
        const volta = await m.voltaDe(m.alvo);
        expect(volta).toMatchObject({ estado: "pendente", origem: "retomada", tentativasTransitorias: 1, trabalhoId: m.alvo.trabalhoId ?? null });
        expect(volta!.entradaTexto.startsWith(ENTRADA_DA_NOVA_TENTATIVA)).toBe(true);
        // ~1 min com ±25%.
        const primeira = ESPERAS_TRANSITORIAS_NO_FUNDO_MS[0]!;
        expect(volta!.acordarEm!).toBeGreaterThanOrEqual(antes + primeira * 0.75 - 1_000);
        expect(volta!.acordarEm!).toBeLessThanOrEqual(Date.now() + primeira * 1.25 + 1_000);
        if (tipo === "lote") {
          expect(volta).toMatchObject({ decididoPor: RETORNO_DO_LOTE });
          expect(volta!.entradaTexto).toContain("Corrigi o login no Safari");
        }
        if (tipo === "rotina") expect((await m.repos.rotinaExecucoes.listar(m.rotinaId!)).map((e) => e.desfecho)).not.toContain("falhou");
        // A cota liberada ("Seguir com", conta nova) não acorda o backoff: ele não é cota.
        expect(await m.repos.turnos.anteciparEsperasDaCota(null)).not.toContain(volta!.id);
        expect(await m.repos.turnos.anteciparEsperasDaCota("claude-cli")).not.toContain(volta!.id);
        expect(await m.linhas()).toHaveLength(1);
        expect(await m.interrompidos()).toHaveLength(0);

        // Segunda queda na volta: outra volta, contador 2, e (fora a task) nenhuma linha nova.
        const r2 = await m.cair(volta!);
        expect(r2.data.esperaDaCota).toBe("espera");
        const volta2 = await m.voltaDe(volta!);
        expect(volta2).toMatchObject({ tentativasTransitorias: 2 });
        expect(await m.linhas()).toHaveLength(tipo === "frente" ? 2 : 1);
      });
    });

    it(`${tipo}: passou de ${TENTATIVAS_TRANSITORIAS_MAX} tentativas → desiste com o aviso de sempre, sem nova volta`, async () => {
      await withRollback(MARLON, async (trx) => {
        const m = await montar(trx, tipo);
        let atual = m.alvo;
        for (let i = 0; i < TENTATIVAS_TRANSITORIAS_MAX; i++) {
          const r = await m.cair(atual);
          expect(r.data.esperaDaCota).toBe("espera");
          atual = (await m.voltaDe(atual))!;
        }
        expect(atual.tentativasTransitorias).toBe(TENTATIVAS_TRANSITORIAS_MAX);
        const r = await m.cair(atual);
        expect(r.data.esperaDaCota).toBeUndefined();
        expect(await m.voltaDe(atual)).toBeNull();
        expect(await m.interrompidos()).toHaveLength(1);
      });
    });
  }

  it("rotina: a nova tentativa passaria da próxima janela → 'nao_rodou · erro_do_provedor' com a hora, sem volta", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "rotina", { proximaJanelaEm: Date.now() + 10_000 });
      const r = await m.cair(m.alvo);
      expect(r.data.esperaDaCota).toBe("nao_rodou");
      expect(await m.voltaDe(m.alvo)).toBeNull();
      const [execucao] = await m.repos.rotinaExecucoes.listar(m.rotinaId!);
      expect(execucao).toMatchObject({ desfecho: "nao_rodou", motivo: "erro_do_provedor" });
      expect(execucao!.voltaEm).not.toBeNull();
    });
  });

  it("borda: a conversa com a pessoa, o contexto cheio e o Parar não viram nova tentativa", async () => {
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "pedido");
      // A conversa (não é fundo) fica com o aviso de sempre.
      const fala = (await m.conversa())!;
      const r = await m.cair(fala);
      expect(r.data.esperaDaCota).toBeUndefined();
      expect(await m.voltaDe(fala)).toBeNull();
      // O contexto cheio não passa sozinho: repetir dá o mesmo.
      const r2 = await m.cair(m.alvo, falha("Prompt is too long: 210000 tokens > 200000 maximum"));
      expect(r2.data.esperaDaCota).toBeUndefined();
      expect(await m.voltaDe(m.alvo)).toBeNull();
    });
    await withRollback(MARLON, async (trx) => {
      const m = await montar(trx, "frente");
      await trx`update turnos set parar_solicitado_em = now() where id = ${m.alvo.id}`;
      const r = await m.cair(m.alvo);
      expect(r.data.esperaDaCota).toBeUndefined();
      expect(await m.voltaDe(m.alvo)).toBeNull();
    });
  });
});

/**
 * NOD-309 (PR 3): a queda no meio do turno de fundo — a máquina sem contato ou o reinício do servidor — põe a retomada
 * na fila na hora, sem card "Retomar" e sem fechar a execução da rotina. Só a máquina sem contato ganha UMA linha
 * ("fica na fila e retoma quando … voltar"); o reinício volta calado (ADR-045). A segunda varredura não duplica.
 */
describeIntegracao("NOD-309 (PR 3): queda no meio do turno de fundo → retomada na fila, sem card", () => {
  for (const tipo of TIPOS) {
    for (const motivo of ["maquina_sem_contato", "reinicio_servidor"] as const) {
      it(`${tipo} × ${motivo}: retomada pendente com a entrada da queda; ${motivo === "maquina_sem_contato" ? "UMA linha" : "nenhuma linha"}; nenhum card`, async () => {
        await withRollback(MARLON, async (trx) => {
          const m = await montar(trx, tipo);
          const sinalEm = Date.now();
          await trx`update turnos set estado = 'despachando', machine_id = ${randomUUID()}, lease_ate = ${new Date(sinalEm + LEASE_MS)} where id = ${m.alvo.id}`;
          const opcoes = motivo === "reinicio_servidor" ? { inicioDoProcesso: sinalEm + 1 } : {};
          const v = await varrerLeases(m.deps.tx, MARLON, sinalEm + LEASE_MS + 10, opcoes);
          expect(v.interrompidos).toContain(m.alvo.id);
          expect(await m.repos.turnos.buscar(m.alvo.id)).toMatchObject({ estado: "interrompido", motivoInterrupcao: motivo });
          const voltas = (await m.repos.turnos.listarDaConversa(m.ada.conversaId, 500)).filter((x) => x.origem === "retomada" && x.estado === "pendente" && x.entradaTexto.startsWith(ENTRADA_DA_RETOMADA_DA_QUEDA));
          expect(voltas).toHaveLength(1);
          const volta = voltas[0]!;
          expect(volta).toMatchObject({ trabalhoId: m.alvo.trabalhoId ?? null, retomaTurnoId: m.alvo.retomaTurnoId ?? m.alvo.id });
          expect(volta.entradaTexto).toContain("Não repita efeito externo");
          if (tipo === "lote") {
            expect(volta.decididoPor).toBe(RETORNO_DO_LOTE);
            const [lote] = await trx<{ retorno_turno_id: string; retorno_concluido_em: Date | null }[]>`select retorno_turno_id, retorno_concluido_em from lotes_de_frentes where retorno_turno_id = ${volta.id}`;
            expect(lote?.retorno_concluido_em ?? null).toBeNull();
          }
          if (tipo === "rotina") expect(await m.repos.rotinaExecucoes.listar(m.rotinaId!)).toEqual([]);
          expect((await m.repos.decisoes.doTurno(m.alvo.id)).filter((d) => d.tipo === "retomar_turno")).toEqual([]);
          const linhas = (await m.repos.mensagens.listarDaConversa(m.ada.conversaId, 500)).filter((x) => x.kind === "sistema" && /fica na fila e retoma quando/.test(x.texto ?? ""));
          expect(linhas).toHaveLength(motivo === "maquina_sem_contato" ? 1 : 0);
          expect(await m.interrompidos()).toHaveLength(0);

          // A varredura seguinte não acha nada para derrubar e não cria outra retomada.
          await varrerLeases(m.deps.tx, MARLON, sinalEm + LEASE_MS + 20, opcoes);
          const depois = (await m.repos.turnos.listarDaConversa(m.ada.conversaId, 500)).filter((x) => x.origem === "retomada" && x.entradaTexto.startsWith(ENTRADA_DA_RETOMADA_DA_QUEDA));
          expect(depois.map((x) => x.id)).toEqual([volta.id]);
        });
      });
    }
  }
});

/**
 * NOD-309 (PR 4), ponta a ponta: a rotina cai por reinício do servidor depois que a janela seguinte já chegou. A janela
 * não empilha nem fica calada: 'nao_rodou · reinicio_servidor', UMA linha "Não rodou · …" na conversa da rotina (a
 * varredura seguinte não repete), nenhum card nem retomada — e a próxima execução dispara normal, sem ficar presa.
 */
describeIntegracao("NOD-309 (PR 4): a rotina cai por reinício e a próxima execução mostra \"Não rodou · …\"", () => {
  it("reinício depois da próxima janela → nao_rodou com a linha, uma vez; a janela seguinte dispara", async () => {
    await withRollback(MARLON, async (trx) => {
      const sinalEm = Date.now();
      const m = await montar(trx, "rotina", { proximaJanelaEm: sinalEm + 1_000 });
      await trx`update turnos set estado = 'despachando', machine_id = ${randomUUID()}, lease_ate = ${new Date(sinalEm + LEASE_MS)} where id = ${m.alvo.id}`;
      const opcoes = { inicioDoProcesso: sinalEm + 1 };
      const v = await varrerLeases(m.deps.tx, MARLON, sinalEm + LEASE_MS + 10, opcoes);
      expect(v.interrompidos).toContain(m.alvo.id);
      const [execucao] = await m.repos.rotinaExecucoes.listar(m.rotinaId!);
      expect(execucao).toMatchObject({ desfecho: "nao_rodou", motivo: "reinicio_servidor" });
      const naoRodou = async () => (await m.repos.mensagens.listarDaConversa(m.ada.conversaId, 500)).filter((x) => x.kind === "rotina_execucao" && (x.texto ?? "").startsWith("Não rodou · "));
      expect((await naoRodou()).map((x) => x.texto)).toEqual([expect.stringMatching(/^Não rodou · o servidor reiniciou, volta (às|em \d\d\/\d\d às) \d\d:\d\d\. A rotina segue a agenda\./)]);
      expect((await m.repos.turnos.listarDaConversa(m.ada.conversaId, 500)).filter((x) => x.origem === "retomada")).toEqual([]);
      expect((await m.repos.decisoes.doTurno(m.alvo.id)).filter((d) => d.tipo === "retomar_turno")).toEqual([]);
      expect(await m.interrompidos()).toHaveLength(0);

      await varrerLeases(m.deps.tx, MARLON, sinalEm + LEASE_MS + 20, opcoes);
      expect(await naoRodou()).toHaveLength(1);

      // A janela seguinte não fica segura pela que caiu: dispara um turno novo.
      const rotina = await m.repos.rotinas.buscar(m.rotinaId!);
      const seguinte = await dispararRotina(m.deps, { rotina: rotina!, instanteAgendado: sinalEm + 1_000, machineId: randomUUID(), executor: "catcher" });
      expect("turno" in seguinte.data).toBe(true);
    });
  });
});
