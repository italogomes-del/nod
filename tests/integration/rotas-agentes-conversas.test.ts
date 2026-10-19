import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { criarRotasAgentes } from "../../src/adapters/http/rotas/agentes.ts";
import { criarRotasConversas } from "../../src/adapters/http/rotas/conversas.ts";
import type { DepsRotas } from "../../src/adapters/http/rotas/executar-caso.ts";
import { criarRotasFrota } from "../../src/adapters/http/rotas/frota.ts";
import { criarRotasPropostas } from "../../src/adapters/http/rotas/propostas.ts";
import { criarRotasTurnos } from "../../src/adapters/http/rotas/turnos.ts";
import type { ConversaDto, FrotaDto, RespostaMutacao } from "../../src/contracts/api.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { FaixaParada } from "../../src/contracts/turno.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { criarRepos } from "../../src/repositories/index.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { atualizarPerfil } from "../../src/use-cases/atualizar-perfil.ts";
import { idDaProposta } from "../helpers/perfil.ts";
import { depsSobreTrx, executar, MARLON, servicosDeTeste, useCasesDeTeste } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/**
 * Rotas da L6 sobre o servidor-de-teste (EMENDA 7/34, porta 0). O pool não entra: `abrirTx` da rota é
 * um SAVEPOINT dentro da transação do withRollback do teste em curso (`trxAtual`), re-vinculando o
 * escopo da SESSÃO a cada requisição — o servidor vive o arquivo inteiro e cada `it` roda sob rollback.
 */
describeIntegracao("rotas agentes/conversas/propostas/turnos/frota (L6) com servidor-de-teste", () => {
  let servidor: ServidorDeTeste;
  let trxAtual: Tx | null = null;

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
    servidor = await servidorDeTeste([...criarRotasFrota(deps), ...criarRotasAgentes(deps), ...criarRotasConversas(deps), ...criarRotasPropostas(deps), ...criarRotasTurnos(deps)]);
  });
  afterAll(() => servidor.close());

  it("sessão ausente → 401; tenant da URL ≠ sessão → 404; criar bot → 201 'Novo agente' e frota 'sem acessos · nunca executou'", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const marlon = await servidor.entrar("marlon");
      expect((await fetch(`${servidor.url}/api/t/${marlon.tenantId}/frota`)).status).toBe(401);
      expect((await servidor.chamar({ ...marlon, tenantId: randomUUID() }, "GET", "frota")).status).toBe(404);

      const criado = await servidor.chamar(marlon, "POST", "agentes", { dono: "pessoa" });
      expect(criado.status).toBe(201);
      const { agente, conversa } = (await criado.json()) as { agente: Agente; conversa: Conversa };
      expect(agente.nome).toBe("Novo agente");
      const frota = (await (await servidor.chamar(marlon, "GET", "frota")).json()) as FrotaDto;
      expect(frota.agentes.find((a) => a.id === agente.id)).toMatchObject({ conversaId: conversa.id, descricaoEstado: "sem acessos · nunca executou" });

      const dono = await servidor.chamar(marlon, "PATCH", `agentes/${agente.id}`, { dono: "empresa" });
      expect(dono.status).toBe(403);
      expect(await dono.json()).toEqual({ codigo: "dono_imutavel", mensagem: "O dono do agente não pode ser trocado." });
      const vazio = await servidor.chamar(marlon, "POST", `agentes/${agente.id}/memoria`, { tipo: "fato", texto: "" });
      expect(vazio.status).toBe(400);
      expect(await vazio.json()).toEqual({ codigo: "texto_vazio", mensagem: "Escreva algo antes de enviar." });
      trxAtual = null;
    });
  });

  it("ana → 404 em recurso de marlon (privado); agente de empresa aparece na frota de ana", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const marlon = await servidor.entrar("marlon");
      const ana = await servidor.entrar("ana");
      const privado = (await (await servidor.chamar(marlon, "POST", "agentes", { dono: "pessoa" })).json()) as { agente: Agente; conversa: Conversa };
      const empresa = (await (await servidor.chamar(marlon, "POST", "agentes", { dono: "empresa", nome: "Tuca" })).json()) as { agente: Agente; conversa: Conversa };

      expect((await servidor.chamar(ana, "GET", `conversas/${privado.conversa.id}/mensagens`)).status).toBe(404);
      expect((await servidor.chamar(ana, "PATCH", `agentes/${privado.agente.id}`, { nome: "x" })).status).toBe(404);
      expect((await servidor.chamar(ana, "POST", `conversas/${privado.conversa.id}/mensagens`, { texto: "oi" })).status).toBe(404);
      expect((await servidor.chamar(ana, "POST", `agentes/${privado.agente.id}/memoria`, { tipo: "fato", texto: "x" })).status).toBe(404);
      const frotaAna = (await (await servidor.chamar(ana, "GET", "frota")).json()) as FrotaDto;
      expect(frotaAna.agentes.map((a) => a.id)).toContain(empresa.agente.id);
      expect(frotaAna.agentes.map((a) => a.id)).not.toContain(privado.agente.id);
      expect((await servidor.chamar(ana, "PATCH", `agentes/${empresa.agente.id}`, { nome: "x" })).status).toBe(403);
      trxAtual = null;
    });
  });

  it("mensagem → 201 com ids; GET mensagens devolve ConversaDto com turnosPendentes; parar devolve a faixa; retomar por turno", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const marlon = await servidor.entrar("marlon");
      const { agente, conversa } = (await (await servidor.chamar(marlon, "POST", "agentes", { dono: "pessoa" })).json()) as { agente: Agente; conversa: Conversa };
      await criarRepos(trx, MARLON).inventario.registrar("catcher", { estado: "pronto", versao: "teste", em: Date.now() });

      const enviado = await servidor.chamar(marlon, "POST", `conversas/${conversa.id}/mensagens`, { texto: "oi Vera" });
      expect(enviado.status).toBe(201);
      const ids = ((await enviado.json()) as RespostaMutacao).ids;
      expect(ids).toEqual({ mensagem: expect.any(String), turno: expect.any(String) });
      const segundo = ((await (await servidor.chamar(marlon, "POST", `conversas/${conversa.id}/mensagens`, { texto: "e aí?" })).json()) as RespostaMutacao).ids;
      expect((await servidor.chamar(marlon, "POST", `conversas/${conversa.id}/mensagens`, { texto: " " })).status).toBe(400);

      await criarRepos(trx, MARLON).turnos.reivindicar({ machineId: randomUUID(), agora: Date.now() });
      const lida = (await (await servidor.chamar(marlon, "GET", `conversas/${conversa.id}/mensagens`)).json()) as ConversaDto;
      expect(lida.conversa.id).toBe(conversa.id);
      expect(lida.mensagens.map((m) => m.kind)).toEqual(["sistema", "texto", "texto"]);
      expect(lida.turnosPendentes).toEqual([{ id: segundo.turno, motivo: "agente_ocupado_em", conversaId: conversa.id }]);

      const parada = await servidor.chamar(marlon, "POST", `conversas/${conversa.id}/parar`);
      expect(parada.status).toBe(200);
      const faixa = (await parada.json()) as FaixaParada;
      expect(faixa).toMatchObject({ interrompidas: 1, nadaRodando: false });
      expect(faixa.naoInterrompidas).toEqual([{ turnoId: ids.turno, motivo: "sem_processo_neste_servidor_aguarda_renovacao_do_lease" }]);
      const global = (await (await servidor.chamar(marlon, "POST", "parar")).json()) as FaixaParada;
      expect(global.nadaRodando).toBe(false);

      const turno = (await (await servidor.chamar(marlon, "GET", `turnos/${segundo.turno}`)).json()) as { turno: { estado: string; motivoInterrupcao: string } };
      expect(turno.turno).toMatchObject({ estado: "interrompido", motivoInterrupcao: "parado_pela_pessoa" });
      const retomado = await servidor.chamar(marlon, "POST", `turnos/${segundo.turno}/retomar`, { texto: "continue" });
      expect(retomado.status).toBe(201);
      expect(((await retomado.json()) as RespostaMutacao).ids.retomaTurno).toBe(segundo.turno);
      expect((await servidor.chamar(marlon, "POST", `turnos/${ids.turno}/retomar`, { texto: "x" })).status).toBe(409);
      expect(agente.id).toBe(conversa.agenteId);
      trxAtual = null;
    });
  });

  it("NOD-156: idEnvio que não é UUID → 400 entrada_invalida; o mesmo idEnvio duas vezes → 201 com os mesmos ids", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const marlon = await servidor.entrar("marlon");
      const { conversa } = (await (await servidor.chamar(marlon, "POST", "agentes", { dono: "pessoa" })).json()) as { conversa: Conversa };
      await criarRepos(trx, MARLON).inventario.registrar("catcher", { estado: "pronto", versao: "teste", em: Date.now() });

      for (const idEnvio of ["nao-e-uuid", 42, "", `${randomUUID()}x`]) {
        const r = await servidor.chamar(marlon, "POST", `conversas/${conversa.id}/mensagens`, { texto: "oi", idEnvio });
        expect(r.status).toBe(400);
        expect(((await r.json()) as { codigo: string }).codigo).toBe("entrada_invalida");
      }
      const idEnvio = randomUUID();
      const primeiro = await servidor.chamar(marlon, "POST", `conversas/${conversa.id}/mensagens`, { texto: "oi", idEnvio });
      const segundo = await servidor.chamar(marlon, "POST", `conversas/${conversa.id}/mensagens`, { texto: "oi", idEnvio });
      expect([primeiro.status, segundo.status]).toEqual([201, 201]);
      expect(((await segundo.json()) as RespostaMutacao).ids).toEqual(((await primeiro.json()) as RespostaMutacao).ids);
      const reusado = await servidor.chamar(marlon, "POST", `conversas/${conversa.id}/mensagens`, { texto: "outra", idEnvio });
      expect(reusado.status).toBe(409);
      expect(((await reusado.json()) as { codigo: string }).codigo).toBe("estado_invalido");
      trxAtual = null;
    });
  });

  it("propostas: confirmar aplica e devolve ids; recusar; memória CRUD; fixar/ocultar/duplicar", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const marlon = await servidor.entrar("marlon");
      const { agente, conversa } = (await (await servidor.chamar(marlon, "POST", "agentes", { dono: "pessoa" })).json()) as { agente: Agente; conversa: Conversa };
      const deps = depsSobreTrx(trx, MARLON);
      const p1 = (await executar(deps, atualizarPerfil, { turnoId: randomUUID(), agenteId: agente.id, conversaId: conversa.id, nome: "Vera", titulo: "Revisora" })).data;
      const p2 = (await executar(deps, atualizarPerfil, { turnoId: randomUUID(), agenteId: agente.id, conversaId: conversa.id, nome: "Outra" })).data;
      const p3 = (await executar(deps, atualizarPerfil, { turnoId: randomUUID(), agenteId: agente.id, conversaId: conversa.id, nome: "Terceira" })).data;

      const confirmada = await servidor.chamar(marlon, "POST", `propostas/${idDaProposta(p1)}/confirmar`);
      expect(confirmada.status).toBe(200);
      expect(((await confirmada.json()) as RespostaMutacao).ids).toEqual({ proposta: idDaProposta(p1), agente: agente.id });
      // NOD-190: o mesmo card de novo é idempotente; um card montado sobre o perfil anterior responde 409 (perfil_mudou).
      expect((await servidor.chamar(marlon, "POST", `propostas/${idDaProposta(p1)}/confirmar`)).status).toBe(200);
      const obsoleta = await servidor.chamar(marlon, "POST", `propostas/${idDaProposta(p3)}/confirmar`);
      expect(obsoleta.status).toBe(409);
      expect(((await obsoleta.json()) as { codigo: string }).codigo).toBe("estado_invalido");
      expect((await deps.repos.propostas.buscar(idDaProposta(p3)))?.estado).toBe("recusada");
      expect((await servidor.chamar(marlon, "POST", `propostas/${idDaProposta(p2)}/recusar`)).status).toBe(200);
      expect((await servidor.chamar(marlon, "POST", `propostas/${randomUUID()}/recusar`)).status).toBe(404);
      expect(await deps.repos.agentes.buscar(agente.id)).toMatchObject({ nome: "Vera", titulo: "Revisora", confirmado: true });

      const mem = await servidor.chamar(marlon, "POST", `agentes/${agente.id}/memoria`, { tipo: "preferencia", texto: "tópicos", conversaId: conversa.id });
      expect(mem.status).toBe(201);
      const { memoria } = (await mem.json()) as { memoria: { id: string } };
      expect((await servidor.chamar(marlon, "PATCH", `agentes/${agente.id}/memoria/${memoria.id}`, { texto: "tópicos curtos" })).status).toBe(200);
      const lista = (await (await servidor.chamar(marlon, "GET", `agentes/${agente.id}/memoria`)).json()) as { memorias: { texto: string }[] };
      expect(lista.memorias.map((m) => m.texto)).toEqual(["tópicos curtos"]);
      expect((await servidor.chamar(marlon, "DELETE", `agentes/${agente.id}/memoria/${memoria.id}`)).status).toBe(200);
      expect(((await (await servidor.chamar(marlon, "GET", `agentes/${agente.id}/memoria`)).json()) as { memorias: unknown[] }).memorias).toEqual([]);

      expect(((await (await servidor.chamar(marlon, "POST", `agentes/${agente.id}/fixar`)).json()) as { agente: Agente }).agente.fixado).toBe(true);
      expect(((await (await servidor.chamar(marlon, "POST", `agentes/${agente.id}/ocultar`, { oculto: true })).json()) as { agente: Agente }).agente.oculto).toBe(true);
      const dup = await servidor.chamar(marlon, "POST", `agentes/${agente.id}/duplicar`);
      expect(dup.status).toBe(201);
      expect(((await dup.json()) as { agente: Agente }).agente).toMatchObject({ nome: "Vera (cópia)", duplicadoDe: agente.id });
      trxAtual = null;
    });
  });

  it("emenda de 2026-10-18 da ADR-059: POST modo-aprovacao exige confirmado: true para o total; manual e automático não pedem", async () => {
    await withRollback(MARLON, async (trx) => {
      trxAtual = trx;
      const marlon = await servidor.entrar("marlon");
      const { agente } = (await (await servidor.chamar(marlon, "POST", "agentes", { dono: "pessoa" })).json()) as { agente: Agente };
      const modo = (corpo: Record<string, unknown>) => servidor.chamar(marlon, "POST", `agentes/${agente.id}/modo-aprovacao`, corpo);
      for (const corpo of [{ modo: "total" }, { modo: "total", confirmado: false }, { modo: "total", confirmado: "true" }]) {
        const r = await modo(corpo);
        expect(r.status).toBe(400);
        expect(((await r.json()) as { codigo: string }).codigo).toBe("entrada_invalida");
      }
      expect((await criarRepos(trx, MARLON).agentes.buscar(agente.id))?.modoAprovacao).toBe("manual");
      const auto = await modo({ modo: "automatico" });
      expect(auto.status).toBe(200);
      expect(((await auto.json()) as { agente: Agente; mudou: boolean })).toMatchObject({ mudou: true, agente: { modoAprovacao: "automatico" } });
      const total = await modo({ modo: "total", confirmado: true });
      expect(total.status).toBe(200);
      expect(((await total.json()) as { agente: Agente }).agente.modoAprovacao).toBe("total");
      expect((await modo({ modo: "manual" })).status).toBe(200);
      trxAtual = null;
    });
  });
});
