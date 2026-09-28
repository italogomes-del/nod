import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { criarTokenTurno } from "../../src/services/token-turno.ts";
import { emitirPlanoTurno, modoDoTurno } from "../../src/use-cases/emitir-plano-turno.ts";
import { agenteComConversa, autoriaPessoa } from "../helpers/fabricas.ts";
import { PESSOA_MARLON, TENANT_LEAPY } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { depsSobre, servicosDeTeste } from "../helpers/l5.ts";
import { withRollback } from "../helpers/with-rollback.ts";

const MARLON = { tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON };

const CATALOGO = [
  { nome: "listar_contatos", descricao: "lista", schema: { type: "object" as const }, readOnlyHint: true },
  { nome: "enviar_email", descricao: "envia", schema: { type: "object" as const }, readOnlyHint: false },
];

describeIntegracao("emitirPlanoTurno (ADR-024): interseção, profundidade e token", () => {
  it("diretório só anuncia colegas confirmados e visíveis da mesma dona", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Origem" });
      await repos.agentes.atualizarPerfil(agenteId, { confirmado: true });
      const colega = await agenteComConversa(trx, MARLON, { nome: "EspecialistaVisivel" });
      await repos.agentes.atualizarPerfil(colega.agenteId, { confirmado: true, descricao: "Revisa lançamentos" });
      const oculto = await agenteComConversa(trx, MARLON, { nome: "ColegaOculto" });
      await repos.agentes.atualizarPerfil(oculto.agenteId, { confirmado: true });
      await repos.agentes.ocultar(oculto.agenteId, true);
      await agenteComConversa(trx, MARLON, { nome: "RascunhoSemPerfil" });
      const agora = () => Date.now();
      const turno = await repos.turnos.enfileirar({ conversaId, agenteId, origem: "conversa", prazoEm: agora() + 60_000, profundidade: 0, entradaTexto: "Quem pode ajudar?", entradaConfianca: "confiavel", modelo: "haiku" });
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ agora }), agora, trx });
      const { data } = await emitirPlanoTurno(deps, { turnoId: turno!.id, machineId: randomUUID() });
      expect(data.promptSistema).toContain("EspecialistaVisivel");
      expect(data.promptSistema).toContain("Revisa lançamentos");
      expect(data.promptSistema).not.toContain("ColegaOculto");
      expect(data.promptSistema).not.toContain("RascunhoSemPerfil");
    });
  });
  it("catálogo = nod do modo + (conector habilitado ∩ concessão do agente); token autoriza uma vez e falha após revogar; plano guardado junto do token; evento turno_despachado", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON, { nome: "Vera" });
      const conector = await repos.conectores.criar({ nome: "Exemplo", slug: "exemplo", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
      await repos.conectores.registrarSonda(conector?.id ?? "", { ok: true, catalogo: CATALOGO, agora: Date.now() });
      const outro = await repos.conectores.criar({ nome: "Desligado", slug: "desligado", transporte: "stdio", comando: "node", declaracao: "nao-toca" });
      const consentimento = await repos.mensagens.criar({ conversaId, autoria: autoriaPessoa(PESSOA_MARLON), kind: "consentimento", texto: "ok", confianca: "confiavel" });
      await repos.concessoes.conceder({ agenteId, conectorId: conector?.id ?? "", capacidade: "listar_contatos", mensagemId: consentimento?.id ?? "" });
      await repos.concessoes.conceder({ agenteId, conectorId: outro?.id ?? "", capacidade: "qualquer", mensagemId: consentimento?.id ?? "" });
      await repos.agentes.atualizarPerfil(agenteId, { confirmado: true, descricao: "revisa PRs" });
      const turno = await repos.turnos.enfileirar({ conversaId, agenteId, origem: "conversa", prazoEm: Date.now() + 600_000, profundidade: 0, entradaTexto: "oi", entradaConfianca: "confiavel", modelo: "claude-haiku-4-5-20251001" });

      const agora = () => Date.now();
      const tokens = criarTokenTurno({ agora });
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ agora, tokens }), agora, trx });
      const maquina = randomUUID();
      const r = await emitirPlanoTurno(deps, { turnoId: turno?.id ?? "", machineId: maquina });
      const nomes = r.data.catalogo.ferramentas.map((f) => f.nome);
      expect(nomes).toContain("exemplo__listar_contatos");
      expect(nomes).not.toContain("exemplo__enviar_email");
      expect(nomes.some((n) => n.startsWith("desligado__"))).toBe(false);
      expect(nomes).toContain("perguntar_a_bot");
      expect(nomes).toContain("pedir_aprovacao");
      expect(r.data.catalogo.servidores).toEqual([{ conectorId: conector?.id, nome: "exemplo", trust: "untrusted", transporte: "stdio" }]);
      expect(r.data).toMatchObject({ turnoId: turno?.id, agenteId, conversaId, machineId: maquina, executor: "catcher", superficie: "maquina_da_pessoa", localidade: "local" });
      expect(r.data.autoria.machine_id).toBe(maquina);
      expect(r.data.promptSistema).toContain("revisa PRs");
      expect(r.data.politicaExecucao.efeitoExternoSoPorAprovacao).toBe(false);
      expect(r.data.expiraEm).toBeGreaterThan(agora());

      // Token: autoriza com a identidade do turno; o plano vive junto dele; revogar derruba os dois.
      expect(tokens.autorizar(r.data.tokenDeTurno)).toEqual({ turnoId: turno?.id, tenantId: TENANT_LEAPY, pessoaId: PESSOA_MARLON, agenteId });
      expect(tokens.planoDe(turno?.id ?? "")).toEqual(r.data);
      tokens.revogar(turno?.id ?? "");
      expect(tokens.autorizar(r.data.tokenDeTurno)).toBeNull();
      expect(tokens.planoDe(turno?.id ?? "")).toBeNull();

      expect(r.events?.map((e) => e.kind)).toEqual(["turno_despachado"]);
      expect(r.events?.[0]?.autoria.decidido_por).toBe("regra:montagem-ferramentas");
      const gravado = await repos.events.gravarComOutbox(r.events ?? []);
      expect(gravado.ids).toHaveLength(1);
    });
  });

  it("rotina e colega recebem sessão nova; conversa mantém sua sessão interativa", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = () => Date.now();
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ agora }), agora, trx });
      const sessao = randomUUID();
      await repos.conversas.atualizarSessaoCli(conversaId, sessao, "catcher");
      for (const origem of ["conversa", "rotina", "peer"] as const) {
        const turno = await repos.turnos.enfileirar({ conversaId, agenteId, origem, prazoEm: agora() + 600_000, profundidade: origem === "peer" ? 1 : 0, entradaTexto: "verificar", entradaConfianca: "confiavel", modelo: "m" });
        const plano = (await emitirPlanoTurno(deps, { turnoId: turno?.id ?? "", machineId: "m", executor: "catcher" })).data;
        expect(plano.entrada.sessaoCli).toBe(origem === "conversa" ? sessao : null);
      }
    });
  });

  it("profundidade 1 vira modo peer: sem perguntar_a_bot nem encaminhar (E12.4); rotina sem gate identificável liga efeitoExternoSoPorAprovacao (fail-closed)", async () => {
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = () => Date.now();
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ agora }), agora, trx });
      const peer = await repos.turnos.enfileirar({ conversaId, agenteId, origem: "peer", prazoEm: agora() + 600_000, profundidade: 1, entradaTexto: "pergunta", entradaConfianca: "nao_confiavel", modelo: "m" });
      const planoPeer = (await emitirPlanoTurno(deps, { turnoId: peer?.id ?? "", machineId: "m" })).data;
      const nomesPeer = planoPeer.catalogo.ferramentas.map((f) => f.nome);
      expect(nomesPeer).not.toContain("perguntar_a_bot");
      expect(nomesPeer).not.toContain("encaminhar");
      expect(nomesPeer).toContain("lembrar");
      expect(planoPeer.profundidade).toBe(1);
      expect(planoPeer.confiancaEntrada).toBe("nao_confiavel");

      const rotina = await repos.turnos.enfileirar({ conversaId, agenteId, origem: "rotina", prazoEm: agora() + 600_000, profundidade: 0, entradaTexto: "rotina", entradaConfianca: "confiavel", modelo: "m" });
      const planoRotina = (await emitirPlanoTurno(deps, { turnoId: rotina?.id ?? "", machineId: "m" })).data;
      expect(planoRotina.politicaExecucao.efeitoExternoSoPorAprovacao).toBe(true);
      // ADR-044: pedir_acesso entra na rotina (só propõe; a pessoa decide num botão). ADR-051: publicar/ler artefato também.
      expect(planoRotina.catalogo.ferramentas.map((f) => f.nome).filter((n) => !n.includes("__"))).toEqual(["lembrar", "pedir_aprovacao", "pedir_acesso", "pedir_a_pessoa", "perguntar_a_bot", "sem_novidade", "publicar_artefato", "ler_artefato"]);

      // A ligação turno → rotina é a JANELA reivindicada (rotinaJanelas.buscarPorTurno, 0004): sem janela o gate fica ligado.
      const r = await repos.rotinas.criar({ agenteId, conversaId, cron: "0 8 * * 1-5", fusoIana: "America/Sao_Paulo", instrucao: "i", fonte: "f", entregavel: "e", limitesAprovacao: "l", politicaSemDado: "p", exigeAprovacao: false, proximaExecucao: agora() + 1000 });
      const instante = agora();
      await repos.rotinaJanelas.reivindicar({ rotinaId: r?.id ?? "", instanteAgendado: instante, machineId: randomUUID(), executor: "catcher" });
      await repos.rotinaJanelas.vincularTurno({ rotinaId: r?.id ?? "", instanteAgendado: instante, turnoId: rotina?.id ?? "" });
      const semGate = (await emitirPlanoTurno(deps, { turnoId: rotina?.id ?? "", machineId: "m" })).data;
      expect(semGate.politicaExecucao.efeitoExternoSoPorAprovacao).toBe(false);

      await expect(emitirPlanoTurno(deps, { turnoId: "00000000-0000-4000-8000-000000000000", machineId: "m" })).rejects.toMatchObject({ codigo: "nao_encontrado" });
    });
  });

  it("modoDoTurno: criação enquanto o agente não foi confirmado; sala pela conversa; executor local recusado sem inventário pronto", async () => {
    // ADR-044: retomada ligada a uma rotina continua rotina; sem ligação, é conversa.
    expect(modoDoTurno({ origem: "retomada", profundidade: 0 }, { tipo: "propria" }, { confirmado: true }, true)).toBe("rotina");
    expect(modoDoTurno({ origem: "retomada", profundidade: 0 }, { tipo: "propria" }, { confirmado: true })).toBe("conversa");
    expect(modoDoTurno({ origem: "conversa", profundidade: 0 }, { tipo: "propria" }, { confirmado: false })).toBe("criacao");
    expect(modoDoTurno({ origem: "conversa", profundidade: 0 }, { tipo: "propria" }, { confirmado: true })).toBe("conversa");
    expect(modoDoTurno({ origem: "sala", profundidade: 0 }, { tipo: "sala" }, { confirmado: true })).toBe("sala");
    expect(modoDoTurno({ origem: "conversa", profundidade: 1 }, null, { confirmado: true })).toBe("peer");
    await withRollback(MARLON, async (trx) => {
      const { repos, agenteId, conversaId } = await agenteComConversa(trx, MARLON);
      const agora = () => Date.now();
      const deps = depsSobre(repos, MARLON, { services: servicosDeTeste({ agora }), agora, trx });
      const turno = await repos.turnos.enfileirar({ conversaId, agenteId, origem: "conversa", prazoEm: agora() + 600_000, profundidade: 0, entradaTexto: "x", entradaConfianca: "confiavel", modelo: "m" });
      await expect(emitirPlanoTurno(deps, { turnoId: turno?.id ?? "", machineId: "m", executor: "local" })).rejects.toMatchObject({ codigo: "executor_indisponivel" });
      await repos.inventario.registrar("claude-cli", { estado: "pronto", versao: "2.1.272", em: agora() });
      const local = (await emitirPlanoTurno(deps, { turnoId: turno?.id ?? "", machineId: "m" })).data;
      expect(local.executor).toBe("local");
    });
  });
});
