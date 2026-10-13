import { VERSAO_CONSENTIMENTO_VOZ } from "../../src/contracts/ligacao.ts";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import WebSocket from "ws";
import { criarPonteHttp } from "../../src/adapters/executor/ponte-http.ts";
import { varrerPessoa } from "../../src/adapters/fundo/varredor-lease.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { ConversaDto, RespostaMutacao } from "../../src/contracts/api.ts";
import type { Conversa } from "../../src/contracts/conversa.ts";
import type { Ligacao } from "../../src/contracts/ligacao.ts";
import type { PlanoTurno } from "../../src/contracts/plano-turno.ts";
import type { Entrega } from "../../src/contracts/ponte.ts";
import { criarDb } from "../../src/db/client.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import { LEASE_MS } from "../../src/shared/constantes.ts";
import type { Escopo, Tx } from "../../src/shared/types.ts";
import { urlDonoDeTeste } from "../helpers/db-dono.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { limparPessoaE2E } from "./limpeza-e2e.ts";

/**
 * NOD-175: deploy sem perder turnos. O SIGTERM chama `drenar()` e depois `fechar()` (server.ts); aqui `drenar` é chamado
 * direto sobre o servidor completo, com a ponte de máquina HTTP do modo compartilhado e uma máquina falsa por fetch.
 * Cada bloco sobe o próprio servidor: a drenagem não se desfaz.
 */
const sinais = { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true };
const tokensZero = { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 };
const entregaDe = (plano: PlanoTurno, machineId: string, seqLocal: number): Entrega => ({
  turnoId: plano.turnoId, machineId, seqLocal, fala: { tipo: "texto", texto: "Feito" },
  resultado: { desfecho: "sucesso", texto: "Feito", sessaoCli: null, sinais, custoUsd: 0, tokens: tokensZero, ferramentasChamadas: [], negacoesPermissao: [] },
});

/** Servidor compartilhado + uma máquina conectada pela ponte HTTP, e o que a limpeza precisa apagar. */
async function compartilhadoComMaquina(env: Record<string, string> = {}) {
  const srv = await servidorCompleto({ env: { NOD_MODO: "compartilhado", ...env } });
  const criados = { agentes: [] as string[], conversas: [] as string[] };
  const { chave, dados } = await srv.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "Mac" });
  const pedir = (nome: string, body: unknown = {}) => fetch(`${srv.url}/api/maquina/${nome}`, {
    method: "POST", headers: { authorization: `Bearer ${chave}`, "content-type": "application/json", "x-nod-versao": "0.1.0" }, body: JSON.stringify(body),
  });
  expect((await pedir("conectar", { nome: "Mac", versaoContrato: 1, inventario: { estado: "pronto", versao: "fake-sem-custo", em: 0 } })).status).toBe(200);
  const bot = async (nome: string) => {
    const r = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome });
    criados.agentes.push(r.agente.id);
    criados.conversas.push(r.conversa.id);
    return r.conversa.id;
  };
  const limpar = async () => {
    await srv.fechar();
    await srv.db.begin(async (tx) => { await vincularEscopo(tx, srv.pessoa); await tx`delete from maquina_tokens where owner_id = ${srv.pessoa.pessoaId}`; });
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, criados);
    await srv.desligar();
  };
  return { srv, machineId: dados.id, chave, pedir, bot, limpar };
}

/** O long-poll dos testes que medem "voltou na hora"; o puxar vazio na drenagem tem que voltar bem antes dele. */
const LONGPOLL_MS = 5_000;

describeIntegracao("NOD-175: drenagem com turno em execução", () => {
  let m: Awaited<ReturnType<typeof compartilhadoComMaquina>>;
  beforeAll(async () => {
    m = await compartilhadoComMaquina({ NOD_LONGPOLL_MS: String(LONGPOLL_MS) });
  });
  afterAll(async () => {
    await m?.limpar();
  });

  it("token vivo segura a drenagem; o puxar volta vazio na hora e o turno novo fica pendente; a entrega libera", async () => {
    const { srv, pedir, bot, machineId } = m;
    const conversaA = await bot("Bot A");
    const enviadaA = await srv.json<RespostaMutacao>("POST", `conversas/${conversaA}/mensagens`, { texto: "Trabalho longo" });
    const { plano } = (await (await pedir("puxar")).json()) as { plano: PlanoTurno };
    expect(plano.turnoId).toBe(enviadaA.ids.turno);
    expect(srv.app.tokens.ativos()).toBe(1);

    let resultado: Awaited<ReturnType<typeof srv.drenar>> | null = null;
    const drenagem = srv.drenar({ prazoMs: 30_000, intervaloMs: 50 }).then((r) => (resultado = r));
    await new Promise((r) => setTimeout(r, 300));
    expect(resultado).toBeNull();

    // Turno novo durante a drenagem: o puxar não o entrega (volta vazio bem antes do long-poll de 5 s) e ele segue pendente.
    const conversaB = await bot("Bot B");
    const enviadaB = await srv.json<RespostaMutacao>("POST", `conversas/${conversaB}/mensagens`, { texto: "Chegou no deploy" });
    const inicio = Date.now();
    const vazio = await pedir("puxar");
    expect(Date.now() - inicio).toBeLessThan(LONGPOLL_MS / 2); // NOD-194: contra o próprio long-poll, não um número mágico
    expect(await vazio.json()).toEqual({ plano: null });
    expect((await srv.json<{ turno: { estado: string } }>("GET", `turnos/${enviadaB.ids.turno}`)).turno.estado).toBe("pendente");

    // renovar segue aceito na drenagem; a entrega solta o token e a drenagem termina sem vencer o prazo.
    expect(((await (await pedir("renovar", { turnoId: plano.turnoId, sinais, eventos: [] })).json()) as { ativo: boolean }).ativo).toBe(true);
    expect(resultado).toBeNull();
    expect((await pedir("entregar", entregaDe(plano, machineId, 1))).status).toBe(200);
    expect(await drenagem).toMatchObject({ vivas: 0, turnos: 0, prazo_vencido: false });
    expect((await srv.json<{ turno: { estado: string } }>("GET", `turnos/${plano.turnoId}`)).turno.estado).toBe("concluido");
    expect((await srv.json<{ turno: { estado: string } }>("GET", `turnos/${enviadaB.ids.turno}`)).turno.estado).toBe("pendente");
    // /api/saude segue 200 durante a drenagem.
    expect((await fetch(`${srv.url}/api/saude`)).status).toBe(200);
  });
});

describeIntegracao("NOD-214 (PR 1): o cliente da máquina atravessa o servidor fora do ar", () => {
  let m: Awaited<ReturnType<typeof compartilhadoComMaquina>>;
  beforeAll(async () => {
    m = await compartilhadoComMaquina({ NOD_LONGPOLL_MS: "20" });
  });
  afterAll(async () => {
    await m?.limpar();
  });

  it("a renovação sem resposta vira `indefinido` (o CLI segue) e a entrega insiste até o servidor voltar e concluir o turno", async () => {
    const { srv, bot, machineId, chave } = m;
    // O cliente de verdade do app; `fora` simula o servidor reiniciando (a conexão nem abre).
    let fora = false;
    const fetchImpl: typeof fetch = async (url, init) => {
      if (fora) throw new TypeError("fetch failed");
      return fetch(url, init);
    };
    const { ponte } = criarPonteHttp({ url: srv.url, chave, versao: "0.1.0", fetchImpl });
    await ponte.conectar({ machineId, nome: "Mac", versaoContrato: 1, inventario: { estado: "pronto", versao: "fake-sem-custo", em: 0 } });
    const conversa = await bot("Bot do deploy");
    await srv.json<RespostaMutacao>("POST", `conversas/${conversa}/mensagens`, { texto: "Trabalho no deploy" });
    const plano = await ponte.puxar("ignorado");
    expect(plano).not.toBeNull();

    fora = true;
    // Antes: `{ativo:false}` na primeira renovação perdida, e o laço matava o CLI no meio do deploy.
    expect((await ponte.renovar({ turnoId: plano!.turnoId, machineId, sinais, eventos: [] })).ativo).toBe("indefinido");

    // O servidor volta ~3,5 s depois (o deploy leva ~10 s); antes, a entrega desistia em ~2 s (3 tentativas) e o turno se perdia.
    const volta = setTimeout(() => { fora = false; }, 3_500);
    try {
      await ponte.entregar(entregaDe(plano!, machineId, 1));
    } finally { clearTimeout(volta); }
    expect(fora).toBe(false);
    expect((await srv.json<{ turno: { estado: string } }>("GET", `turnos/${plano!.turnoId}`)).turno.estado).toBe("concluido");
  }, 30_000);
});

describeIntegracao("NOD-175: drenagem com o prazo vencido", () => {
  let m: Awaited<ReturnType<typeof compartilhadoComMaquina>>;
  beforeAll(async () => {
    m = await compartilhadoComMaquina({ NOD_LONGPOLL_MS: "20" });
  });
  afterAll(async () => {
    await m?.limpar();
  });

  it("prazo vencido: drenar resolve com prazo_vencido; o turno fica despachando e o próximo boot o assenta como reinicio_servidor", async () => {
    const { srv, pedir, bot } = m;
    const conversa = await bot("Bot lento");
    await srv.json<RespostaMutacao>("POST", `conversas/${conversa}/mensagens`, { texto: "Nunca termina" });
    const { plano } = (await (await pedir("puxar")).json()) as { plano: PlanoTurno };
    expect(plano).not.toBeNull();

    const inicio = Date.now();
    expect(await srv.drenar({ prazoMs: 300, intervaloMs: 50 })).toMatchObject({ turnos: 1, prazo_vencido: true });
    expect(Date.now() - inicio).toBeLessThan(2_000);
    await srv.fechar();

    const escopo: Escopo = srv.pessoa;
    const escopado = <T>(fn: (trx: Tx) => Promise<T>): Promise<T> => srv.db.begin(async (trx) => {
      await vincularEscopo(trx, escopo);
      return fn(trx);
    }) as Promise<T>;
    const estado = async () => (await escopado((trx) => trx<{ estado: string; motivo_interrupcao: string | null }[]>`select estado, motivo_interrupcao from turnos where id = ${plano.turnoId}`))[0];
    expect(await estado()).toMatchObject({ estado: "despachando" });

    // O processo novo subiu depois do último sinal do turno: o varredor de lease dele assenta reinicio_servidor (ADR-045).
    const novoBoot = Date.now() + 1;
    const r = await varrerPessoa(escopado, escopo, novoBoot + LEASE_MS + 1, { inicioDoProcesso: novoBoot, ultimoContato: () => null });
    expect(r.interrompidos).toEqual([plano.turnoId]);
    expect(await estado()).toEqual({ estado: "interrompido", motivo_interrupcao: "reinicio_servidor" });
  });
});

describeIntegracao("NOD-176: drenagem com uma reserva em voo", () => {
  let m: Awaited<ReturnType<typeof compartilhadoComMaquina>>;
  beforeAll(async () => {
    m = await compartilhadoComMaquina({ NOD_LONGPOLL_MS: String(LONGPOLL_MS) });
  });
  afterAll(async () => {
    await m?.limpar();
  });

  it("puxar em voo segura a drenagem antes de o token existir; a reserva é entregue e a entrega libera", async () => {
    const { srv, pedir, bot, machineId } = m;
    const conversa = await bot("Bot em voo");
    const enviada = await srv.json<RespostaMutacao>("POST", `conversas/${conversa}/mensagens`, { texto: "Reservado no deploy" });

    // O puxar lento: uma tx do teste trava `turnos` em EXCLUSIVE (leitura passa, o UPDATE ... FOR UPDATE SKIP LOCKED da
    // reivindicação espera). O puxar fica parado ANTES de cunhar o token — só `reservasEmVoo()` conta o turno.
    const trava = criarDb(urlDonoDeTeste(), { max: 1 });
    let soltar: () => void = () => undefined;
    let travou: () => void = () => undefined;
    const travada = new Promise<void>((r) => { travou = r; });
    const segurando = trava.begin(async (tx) => {
      await tx`lock table turnos in exclusive mode`;
      travou();
      await new Promise<void>((r) => { soltar = r; });
    });
    try {
      await travada;
      const puxando = pedir("puxar");
      await srv.esperar(async () => srv.app.reservasEmVoo() === 1, { nome: "reserva em voo", intervaloMs: 10 });
      expect(srv.app.tokens.ativos()).toBe(0);
      // Nenhuma ligação viva: só a reserva pode segurar a drenagem.
      expect(srv.app.voz.vivas()).toBe(0);

      let resultado: Awaited<ReturnType<typeof srv.drenar>> | null = null;
      const drenagem = srv.drenar({ prazoMs: 5_000, intervaloMs: 20 }).then((r) => (resultado = r));
      expect(await Promise.race([drenagem.then(() => "resolveu"), new Promise((r) => setTimeout(() => r("pendente"), 200))])).toBe("pendente");

      // A reserva que começou antes da drenagem é ENTREGUE: o token nasce e passa a segurar a drenagem no lugar dela.
      soltar();
      await segurando;
      const { plano } = (await (await puxando).json()) as { plano: PlanoTurno };
      expect(plano.turnoId).toBe(enviada.ids.turno);
      expect(srv.app.reservasEmVoo()).toBe(0);
      expect(srv.app.tokens.ativos()).toBe(1);
      expect(resultado).toBeNull();

      expect((await pedir("entregar", entregaDe(plano, machineId, 1))).status).toBe(200);
      expect(await drenagem).toMatchObject({ vivas: 0, turnos: 0, prazo_vencido: false });
      expect(srv.app.tokens.ativos()).toBe(0);
    } finally {
      soltar();
      await segurando.catch(() => undefined);
      await trava.end({ timeout: 2 });
    }
  });
});

describeIntegracao("NOD-175: modo local", () => {
  let srv: ServidorCompleto;
  const criados = { agentes: [] as string[], conversas: [] as string[] };
  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_LIGACAO: "todas" } });
  });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, criados);
    await srv.desligar();
  });

  it("ligação viva segura a drenagem, ouve o aviso e libera ao desligar; o modo local não espera token", async () => {
    const { agente, conversa } = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Nina" });
    criados.agentes.push(agente.id);
    criados.conversas.push(conversa.id);
    await srv.json("POST", "voz/consentimento", { versao: VERSAO_CONSENTIMENTO_VOZ });
    const { ligacao } = await srv.json<{ ligacao: Ligacao }>("POST", "ligacoes", { agenteId: agente.id });

    const host = new URL(srv.url).host;
    const ws = new WebSocket(`${srv.url.replace("http", "ws")}/api/t/${srv.pessoa.tenantId}/voz/v1/midia`, { headers: { cookie: srv.pessoa.cookie, origin: `http://${host}` } });
    const textos: string[] = [];
    ws.on("message", (dados, binario) => {
      if (binario) {
        ws.send(JSON.stringify({ t: "tocou-fim", utt: (dados as Buffer).readUInt16LE(5) }));
        return;
      }
      textos.push(String(dados));
    });
    await new Promise<void>((r, j) => {
      ws.once("open", () => r());
      ws.once("error", j);
    });
    ws.send(JSON.stringify({ t: "ola", v: 1, ligacaoId: ligacao.id, entrada: "pcm16", saida: "pcm16" }));
    await srv.esperar(async () => textos.some((t) => t.includes('"pronto"')), { nome: "pronto" });
    await srv.esperar(async () => srv.app.voz.vivas() === 1, { nome: "ligação viva" });

    let resultado: Awaited<ReturnType<typeof srv.drenar>> | null = null;
    const drenagem = srv.drenar({ prazoMs: 30_000, intervaloMs: 50 }).then((r) => (resultado = r));
    await srv.esperar(async () => textos.some((t) => t.includes("preciso reiniciar")), { nome: "aviso da drenagem" });
    expect(resultado).toBeNull();

    ws.send(JSON.stringify({ t: "tchau" }));
    expect(await drenagem).toMatchObject({ vivas: 0, turnos: 0, prazo_vencido: false });
    ws.close();
  });
});

describeIntegracao("NOD-168: ligação que passa do prazo da drenagem", () => {
  let srv: ServidorCompleto;
  const criados = { agentes: [] as string[], conversas: [] as string[] };
  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_LIGACAO: "todas" } });
  });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, criados);
    await srv.desligar();
  });

  it("prazo vencido com a ligação viva: o fechar encerra com reinicio_servidor e deixa UMA linha na conversa", async () => {
    const { agente, conversa } = await srv.json<{ agente: Agente; conversa: Conversa }>("POST", "agentes", { dono: "pessoa", nome: "Nina" });
    criados.agentes.push(agente.id);
    criados.conversas.push(conversa.id);
    await srv.json("POST", "voz/consentimento", { versao: VERSAO_CONSENTIMENTO_VOZ });
    const { ligacao } = await srv.json<{ ligacao: Ligacao }>("POST", "ligacoes", { agenteId: agente.id });

    const host = new URL(srv.url).host;
    const ws = new WebSocket(`${srv.url.replace("http", "ws")}/api/t/${srv.pessoa.tenantId}/voz/v1/midia`, { headers: { cookie: srv.pessoa.cookie, origin: `http://${host}` } });
    const textos: string[] = [];
    ws.on("message", (dados, binario) => {
      if (binario) {
        ws.send(JSON.stringify({ t: "tocou-fim", utt: (dados as Buffer).readUInt16LE(5) }));
        return;
      }
      textos.push(String(dados));
    });
    await new Promise<void>((r, j) => {
      ws.once("open", () => r());
      ws.once("error", j);
    });
    ws.send(JSON.stringify({ t: "ola", v: 1, ligacaoId: ligacao.id, entrada: "pcm16", saida: "pcm16" }));
    await srv.esperar(async () => srv.app.voz.vivas() === 1, { nome: "ligação viva" });

    // A pessoa não desliga: a drenagem vence o prazo com a ligação viva, e o SIGTERM segue para o fechar (server.ts).
    expect(await srv.drenar({ prazoMs: 300, intervaloMs: 50 })).toMatchObject({ vivas: 1, prazo_vencido: true });
    await srv.app.voz.fechar();
    await srv.esperar(async () => textos.some((t) => t.includes('"reinicio_servidor"')), { nome: "fim na mídia" });

    const linhas = async () => (await srv.json<ConversaDto>("GET", `conversas/${conversa.id}/mensagens`)).mensagens.filter((m) => m.kind === "sistema" && m.texto.startsWith("A ligação"));
    await srv.esperar(async () => (await linhas()).length > 0, { nome: "linha do fim" });
    expect((await linhas()).map((m) => m.texto)).toEqual(["A ligação caiu porque o nod foi atualizado. Ligue de novo."]);
    // Fechar de novo (o fechar do servidor no afterAll) não duplica: o repo só encerra uma vez.
    await srv.app.voz.fechar();
    expect(await linhas()).toHaveLength(1);
    ws.close();
  });
});

describeIntegracao("NOD-176: modo local com token vivo", () => {
  let srv: ServidorCompleto;
  beforeAll(async () => {
    srv = await servidorCompleto();
  });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await limparPessoaE2E(srv.db, srv.dbDono, srv.pessoa, { agentes: [], conversas: [] });
    await srv.desligar();
  });

  it("token vivo sem ligação: drenar resolve na primeira verificação com turnos 0", async () => {
    // O modo local não tem a ponte HTTP de máquina: o token nasce pelo serviço, como o despacho local o cunharia.
    const turnoId = randomUUID();
    srv.app.tokens.cunhar(turnoId, { tenantId: srv.pessoa.tenantId, pessoaId: srv.pessoa.pessoaId, agenteId: randomUUID() });
    try {
      expect(srv.app.tokens.ativos()).toBe(1);
      expect(srv.app.voz.vivas()).toBe(0);
      const r = await srv.drenar({ prazoMs: 5_000, intervaloMs: 1_000 });
      expect(r).toMatchObject({ vivas: 0, turnos: 0, prazo_vencido: false });
      // Abaixo de um intervalo: resolveu na primeira verificação, sem dormir esperando o token.
      expect(r.duracao_ms).toBeLessThan(1_000);
      expect(srv.app.tokens.ativos()).toBe(1);
    } finally {
      srv.app.tokens.revogar(turnoId);
    }
  });
});
