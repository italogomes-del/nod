import { afterAll, beforeAll, expect, it } from "vitest";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import { criarRotasOnboarding } from "../../src/adapters/http/rotas/onboarding.ts";
import type { EstadoOnboarding } from "../../src/contracts/onboarding.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import type { ContextoLigacao, SaidaLigar } from "../../src/use-cases/ligacoes.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { gerirAgente } from "../../src/use-cases/gerir-agente.ts";
import { depsSobreTrx, executar, MARLON, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * Onboarding por ligação (definido em 2026-10-04, ADR-077): a migração 0049 com o backfill de quem já usa o nod e as
 * rotas do onboarding sobre o servidor-de-teste (cada `it` sob rollback, como as rotas da L6).
 */
const CONTEXTO_LIBERADO: ContextoLigacao = {
  permitido: true, habilitada: true, maquinaComLigacao: true, iaPronta: true, codexSemVoz: false, drenando: false, vozDisponivel: true,
  vivasNoServidor: 0, maxSimultaneas: 20, limiteDiarioMs: 0, inicioDoDia: 0, provedorStt: "falso", provedorTts: "falso",
};

describeIntegracao("0049: CHECKs do onboarding (o backfill é testado em tests/concurrency/onboarding-backfill.test.ts)", () => {
  it("os CHECKs da 0049 recusam etapa, tamanho e apelido fora do contrato", async () => {
    await withRollback(MARLON, async (trx) => {
      const insere = (campos: string) => trx.savepoint((sp) => sp.unsafe(`insert into preferencias (tenant_id, owner_id, ${campos.split("=")[0]}) values ('${MARLON.tenantId}', '${MARLON.pessoaId}', ${campos.split("=")[1]}) on conflict (tenant_id, owner_id) do update set ${campos}`));
      await expect(insere("onboarding_etapa='voando'")).rejects.toThrow(/preferencias_onboarding_etapa/);
      await expect(insere("tamanho_time='mil'")).rejects.toThrow(/preferencias_tamanho_time/);
      await expect(insere(`apelido='${"x".repeat(61)}'`)).rejects.toThrow(/preferencias_apelido/);
      await insere("tamanho_time='2_10'");
    });
  });
});

describeIntegracao("rotas do onboarding com servidor-de-teste", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;
  let contexto: ContextoLigacao = CONTEXTO_LIBERADO;
  const registradas: SaidaLigar[] = [];
  const liberadas: string[] = [];
  const encerradas: string[] = [];

  beforeAll(async () => {
    const deps: DepsRotas = {
      abrirTx:
        (escopo: Escopo) =>
        async <T,>(fn: (t: Tx) => Promise<T>): Promise<T> => {
          const trx = trxAtual;
          if (!trx) throw new Error("teste sem transação aberta");
          const caixa: { valor?: T } = {};
          await trx.savepoint(async (sp) => {
            await vincularEscopo(sp, escopo);
            caixa.valor = await fn(sp);
          });
          return caixa.valor as T;
        },
      services: servicosDeTeste((t) => criarRepos(t, MARLON), MARLON),
      useCases: useCasesDeTeste(),
      prazoDecisaoMs: 60_000,
      executor: "catcher",
    };
    servidor = await servidorDeTeste(criarRotasOnboarding({
      ...deps,
      executorDoMac: () => ({ pronto: false, ias: [{ id: "claude-cli", estado: "nao_autenticado" }, { id: "codex-cli", estado: "ausente" }] }),
      contexto: async () => contexto,
      registrar: (_e, l) => registradas.push(l),
      liberar: (id) => liberadas.push(id),
      encerrarViva: async (id) => { encerradas.push(id); },
      fusoPadrao: "America/Sao_Paulo",
    }));
  });
  afterAll(() => servidor.close());

  it("sem voz: olá → executor → chamando recusada → configurando sem voz → bot e rotina pelo clique → concluir; concluído não reabre sem o olá", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      contexto = { ...CONTEXTO_LIBERADO, permitido: false };
      const marlon = await servidor.entrar("marlon");
      const get = async () => (await (await servidor.chamar(marlon, "GET", "onboarding")).json()) as EstadoOnboarding;
      const post = async (caminho: string, corpo: unknown) => servidor.chamar(marlon, "POST", caminho, corpo);

      const inicio = await get();
      expect(inicio).toMatchObject({ etapa: null, mostrar: true, passo: "bot", executor: { pronto: false } });
      expect(inicio.executor.ias.map((i) => i.estado)).toEqual(["nao_autenticado", "ausente"]);
      expect((await post("onboarding/etapa", { etapa: "voando" })).status).toBe(400);
      expect(((await (await post("onboarding/etapa", { etapa: "executor" })).json()) as EstadoOnboarding).etapa).toBe("executor");

      // ADR-081: o primeiro GET já criou o Nod, e ele é a guia. Sem permissão para ligar, a recusa volta tipada.
      expect(inicio.guia?.nome).toBe("Nod");
      const chamando = (await (await post("onboarding/etapa", { etapa: "chamando" })).json()) as EstadoOnboarding;
      expect(chamando).toMatchObject({ etapa: "chamando", ligacao: null, recusa: { motivo: "sem_permissao" } });
      expect(chamando.guia).toMatchObject({ id: inicio.guia?.id, nome: "Nod", cor: "c-black" });
      expect(registradas).toHaveLength(0);

      expect(((await (await post("onboarding/etapa", { etapa: "configurando", semVoz: true })).json()) as EstadoOnboarding).etapa).toBe("configurando");
      const comBot = await post("onboarding/bot", { nome: "Atendente", descricao: "Lê os e-mails de clientes e escreve rascunhos." });
      expect(comBot.status).toBe(201);
      const e1 = (await comBot.json()) as EstadoOnboarding;
      expect(e1.bot).toMatchObject({ nome: "Atendente", forma: "shape-triangle", cor: "c-amber" });
      expect(e1.passo).toBe("app");
      expect((await post("onboarding/bot", { nome: "Outro", descricao: "x" })).status).toBe(409);
      expect((await post("onboarding/rotina", { indice: 9 })).status).toBe(400);
      const comRotina = (await (await post("onboarding/rotina", { indice: 0 })).json()) as EstadoOnboarding;
      expect(comRotina.rotinaCriada?.resumo).toContain("pede resposta hoje");

      const fim = (await (await post("onboarding/concluir", {})).json()) as EstadoOnboarding;
      expect(fim).toMatchObject({ etapa: "concluido", mostrar: false });
      expect((await post("onboarding/etapa", { etapa: "configurando" })).status).toBe(409);
      const deNovo = (await (await post("onboarding/etapa", { etapa: "ola" })).json()) as EstadoOnboarding;
      expect(deNovo).toMatchObject({ etapa: "ola", mostrar: true, concluidoEm: null });
      expect(deNovo.guia?.id).toBe(chamando.guia?.id);
      trxAtual = null;
    });
  });

  it("com voz: chamando cria a ligação do produto sem consentimento; o Atender exige o consentimento e libera a mídia; sem voz encerra a ligação", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      contexto = CONTEXTO_LIBERADO;
      registradas.length = 0;
      const marlon = await servidor.entrar("marlon");
      const post = async (caminho: string, corpo: unknown) => servidor.chamar(marlon, "POST", caminho, corpo);

      const chamando = (await (await post("onboarding/etapa", { etapa: "chamando" })).json()) as EstadoOnboarding;
      expect(chamando.ligacao).toMatchObject({ estado: "chamando", iniciadaPor: "produto", agenteId: chamando.guia?.id });
      expect(registradas.map((r) => r.ligacao.id)).toEqual([chamando.ligacao?.id]);
      // ADR-081: a guia é o Nod, com voz masculina (a concordância do prompt de voz: "Eu sou o Nod").
      expect(registradas[0]).toMatchObject({ voz: "bento", genero: "masculina" });

      const d = depsSobreTrx(trx, MARLON);
      const consentimento = (await d.repos.ligacoes.consentimento()).versao ?? 0;
      if (consentimento < 1) expect((await post("onboarding/etapa", { etapa: "entrevista" })).status).toBe(409);
      await d.repos.ligacoes.consentir(1, Date.now());
      const atendida = (await (await post("onboarding/etapa", { etapa: "entrevista" })).json()) as EstadoOnboarding;
      expect(atendida.etapa).toBe("entrevista");
      expect(liberadas).toContain(chamando.ligacao?.id);

      const semVoz = (await (await post("onboarding/etapa", { etapa: "configurando", semVoz: true })).json()) as EstadoOnboarding;
      expect(semVoz.ligacao).toBeNull();
      expect(encerradas).toContain(chamando.ligacao?.id);
      const l = await d.repos.ligacoes.buscar(chamando.ligacao?.id ?? "");
      expect(l).toMatchObject({ estado: "nao_atendida" });
      trxAtual = null;
    });
  });

  it("o Nod (a guia) não se exclui no meio da configuração; 'Ver de novo' liga o mesmo Nod (ADR-081)", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      contexto = { ...CONTEXTO_LIBERADO, permitido: false };
      const marlon = await servidor.entrar("marlon");
      const post = async (caminho: string, corpo: unknown) => (await (await servidor.chamar(marlon, "POST", caminho, corpo)).json()) as EstadoOnboarding;
      await post("onboarding/etapa", { etapa: "chamando" });
      const configurando = await post("onboarding/etapa", { etapa: "configurando", semVoz: true });
      expect(configurando).toMatchObject({ etapa: "configurando", mostrar: true });
      const guiaId = configurando.guia?.id ?? "";
      await expect(executar(depsSobreTrx(trx, MARLON), gerirAgente, { agenteId: guiaId, acao: "excluir" })).rejects.toMatchObject({ codigo: "nod_protegido" });
      const depois = (await (await servidor.chamar(marlon, "GET", "onboarding")).json()) as EstadoOnboarding;
      expect(depois).toMatchObject({ etapa: "configurando", mostrar: true, guia: { id: guiaId } });
      const deNovo = await post("onboarding/etapa", { etapa: "ola" });
      expect(deNovo.mostrar).toBe(true);
      const outra = await post("onboarding/etapa", { etapa: "chamando" });
      expect(outra.guia?.id).toBe(guiaId);
      trxAtual = null;
    });
  });

  it("quem já tem um bot confirmado e nunca começou o onboarding não o vê", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      await executar(depsSobreTrx(trx, MARLON), criarAgente, { dono: "pessoa", nome: "Vera", descricao: "Cuida da agenda." });
      const marlon = await servidor.entrar("marlon");
      const e = (await (await servidor.chamar(marlon, "GET", "onboarding")).json()) as EstadoOnboarding;
      expect(e).toMatchObject({ etapa: null, mostrar: false });
      trxAtual = null;
    });
  });
});
