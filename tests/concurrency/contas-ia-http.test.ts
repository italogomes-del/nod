import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorCompleto, type ServidorCompleto } from "../helpers/servidor-completo.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { ContasIaDto, LoginNaMaquina, PuxadaDeContas } from "../../src/contracts/contas-ia.ts";

/**
 * ADR-102 de ponta a ponta pelo app composto (revisão do PR #306): as rotas da pessoa (/contas-ia, logins numa máquina,
 * desconectar, convites) e as da máquina (anúncio no `conectar`, `contas`, `contas/progresso`, `contas/saiu`). Commita:
 * a chave da máquina é validada na transação dela. Limpa as contas e as chaves da pessoa ao fim.
 */
describeIntegracao("contas de IA pela ponte e pela tela (ADR-102, HTTP real)", () => {
  let srv: ServidorCompleto;
  let chave = "", machineId = "";
  const IMP_A = "a".repeat(64);
  const IMP_B = "b".repeat(64);
  const inventario = { estado: "pronto", versao: "fake-sem-custo", em: 0 };
  const pedir = (nome: string, body: unknown = {}, token = chave) => fetch(`${srv.url}/api/maquina/${nome}`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "x-nod-versao": "0.1.0" }, body: JSON.stringify(body),
  });
  const conta = (impressao: string, o: Record<string, unknown> = {}) => ({ impressao, ia: "claude-cli", estado: "pronta", plano: "Max", corporativa: false, logadaEm: Date.now() - 1_000, ...o });
  const outraPessoa = () => srv.sessaoDe({ tenantId: TENANT_PADRAO, pessoaId: randomUUID() });

  beforeAll(async () => {
    srv = await servidorCompleto({ env: { NOD_MODO: "compartilhado", NOD_LONGPOLL_MS: "20" } });
    const a = await srv.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "vm-bots" });
    chave = a.chave; machineId = a.dados.id;
  });
  afterAll(async () => {
    if (!srv) return;
    await srv.fechar();
    await srv.db.begin(async (tx) => {
      await vincularEscopo(tx, srv.pessoa);
      await tx`delete from contas_ia where owner_id = ${srv.pessoa.pessoaId}`;
      await tx`delete from maquina_tokens where owner_id = ${srv.pessoa.pessoaId}`;
    });
    await srv.desligar();
  });

  it("o anúncio do conectar entra na lista só pela impressão; o que vem fora do formato some", async () => {
    const r = await pedir("conectar", { nome: "vm-bots", plataforma: "linux", versaoContrato: 1, inventario, contas: [conta(IMP_A, { apelidoSugerido: "Pessoal" }), conta("nao-hex"), conta(IMP_B, { ia: "codex-cli", plano: "x@y.com" })] });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ contasIa: true });
    const lista = await srv.json<ContasIaDto>("GET", "contas-ia");
    expect(lista.disponivel).toBe(true);
    expect(lista.contas.map((c) => [c.ia, c.apelido, c.plano])).toEqual([["claude-cli", "Pessoal", "Max"], ["codex-cli", "Conta 2", null]]);
    expect(lista.contas[0]!.maquinas).toEqual([expect.objectContaining({ maquinaId: machineId, estado: "pronta" })]);
    expect(JSON.stringify(lista)).not.toContain("@");
  });

  it("as rotas da lista validam a entrada e não deixam outra pessoa mexer", async () => {
    const { contas } = await srv.json<ContasIaDto>("GET", "contas-ia");
    const [a, b] = contas;
    expect((await srv.chamar("PUT", "contas-ia/ordem", { ids: ["x"] })).status).toBe(400);
    expect((await srv.chamar("PUT", "contas-ia/modo", { modo: "sempre" })).status).toBe(400);
    expect((await srv.chamar("PATCH", `contas-ia/${a!.id}`, { apelido: "x".repeat(41) })).status).toBe(400);
    expect((await srv.chamar("PATCH", `contas-ia/${a!.id}`, { entraNaTrocaAutomatica: "sim" })).status).toBe(400);
    expect((await srv.chamar("PATCH", `contas-ia/${a!.id}`, { apelido: "Leapy" }, outraPessoa())).status).toBe(404);
    expect((await srv.chamar("PUT", "contas-ia/ordem", { ids: [b!.id, a!.id] })).status).toBe(204);
    expect((await srv.chamar("PATCH", `contas-ia/${a!.id}`, { apelido: "Leapy" })).status).toBe(204);
    const depois = await srv.json<ContasIaDto>("GET", "contas-ia");
    expect(depois.contas.map((c) => c.apelido)).toEqual(["Conta 2", "Leapy"]);
  });

  it("login pela tela: a máquina recebe o pedido, só o link oficial passa, o código cifrado vai uma vez; outra pessoa não vê", async () => {
    const r = await srv.chamar("POST", `maquinas/${machineId}/logins`, { ia: "claude-cli", apelido: "Freela" });
    expect(r.status).toBe(201);
    const login = (await r.json()) as LoginNaMaquina;
    const puxada = (await (await pedir("contas")).json()) as PuxadaDeContas;
    expect(puxada.logins).toEqual([expect.objectContaining({ id: login.id, ia: "claude-cli", apelido: "Freela" })]);
    expect((await pedir("contas/progresso", { loginId: login.id, fase: "aguardando_pessoa", url: "https://evil.example/oauth" })).status).toBe(409);
    expect((await pedir("contas/progresso", { loginId: login.id, fase: "aguardando_pessoa", url: "https://claude.com/cai/oauth/authorize?code=true", pedeCodigo: true, chavePublica: "QUJDRA==" })).status).toBe(200);
    expect((await srv.chamar("GET", `maquinas/${machineId}/logins/${login.id}`, undefined, outraPessoa())).status).toBe(404);
    expect((await srv.chamar("GET", `maquinas/${randomUUID()}/logins/${login.id}`)).status).toBe(404);
    const visto = await srv.json<LoginNaMaquina>("GET", `maquinas/${machineId}/logins/${login.id}`);
    expect(visto).toMatchObject({ fase: "aguardando_pessoa", pedeCodigo: true, chavePublica: "QUJDRA==" });
    const cifrado = { chave: "QUJD", iv: "QUJD", dados: "QUJD" };
    expect((await srv.chamar("POST", `maquinas/${machineId}/logins/${login.id}/codigo`, { cifrado })).status).toBe(202);
    expect((await srv.chamar("POST", `maquinas/${machineId}/logins/${login.id}/codigo`, { cifrado })).status).toBe(409);
    const comCodigo = (await (await pedir("contas")).json()) as PuxadaDeContas;
    expect(comCodigo.logins[0]?.codigo).toEqual(cifrado);
    const semCodigo = (await (await pedir("contas")).json()) as PuxadaDeContas;
    expect(semCodigo.logins[0]?.codigo).toBeUndefined();
    expect((await pedir("contas/progresso", { loginId: login.id, fase: "falhou", erro: "codigo_invalido" })).status).toBe(200);
  });

  it("desconectar com 'sair das contas': a máquina recebe o pedido, a chave vence mesmo sem confirmação e cai na confirmação", async () => {
    const r = await srv.json<{ aguardandoMaquina: boolean; contas: number }>("POST", `maquinas/${machineId}/desconectar`, { sairDasContas: true });
    expect(r).toMatchObject({ aguardandoMaquina: true });
    const vence = await srv.db.begin(async (tx) => {
      await vincularEscopo(tx, srv.pessoa);
      return (await tx<{ expira_em: Date | null }[]>`select expira_em from maquina_tokens where id = ${machineId}`)[0]?.expira_em ?? null;
    });
    expect(vence).not.toBeNull();
    expect(vence!.getTime() - Date.now()).toBeLessThanOrEqual(2 * 60_000);
    const puxada = (await (await pedir("contas")).json()) as PuxadaDeContas;
    expect(puxada.desconectar).toBe(true);
    expect((await pedir("contas/saiu", { impressoes: [IMP_A, IMP_B], desconectada: true })).status).toBe(200);
    expect([401, 403]).toContain((await pedir("contas")).status);
  });

  it("desconectar sem 'sair das contas' revoga na hora; convite pendente e inventado", async () => {
    const b = await srv.json<{ chave: string; dados: { id: string } }>("POST", "maquinas/chaves", { nome: "vm-2" });
    expect((await pedir("conectar", { nome: "vm-2", plataforma: "linux", versaoContrato: 1, inventario }, b.chave)).status).toBe(200);
    expect((await srv.chamar("POST", `maquinas/${b.dados.id}/desconectar`, { sairDasContas: false })).status).toBe(202);
    expect([401, 403]).toContain((await pedir("contas", {}, b.chave)).status);
    const { convite } = await srv.json<{ convite: string }>("POST", "maquinas/convites");
    expect(await srv.json("GET", `maquinas/convites/${convite}`)).toEqual({ estado: "pendente" });
    expect((await srv.chamar("GET", `maquinas/convites/${"x".repeat(32)}`)).status).toBe(404);
    expect((await srv.chamar("GET", `maquinas/convites/${convite}`, undefined, outraPessoa())).status).toBe(404);
  });
});
