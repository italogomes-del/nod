import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, expect, it } from "vitest";
import { autorizarChaveMaquina } from "../../src/adapters/http/autorizar-chave-maquina.ts";
import { comporApp, type App } from "../../src/adapters/http/compor.ts";
import { cunharCookie } from "../../src/adapters/http/sessao.ts";
import type { MaquinasDto } from "../../src/contracts/maquina.ts";
import { abrirTxEscopada } from "../../src/db/tx.ts";
import { db } from "../helpers/db.ts";
import { TENANT_PADRAO } from "../helpers/ids.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../helpers/servidor-de-teste.ts";

/**
 * ADR-088: o pareamento por código de ponta a ponta, pelo app composto em porta 0. A máquina pede o código (rota pública,
 * sem navegador), a pessoa logada vê e aprova, e a máquina troca pela chave — que nasce no escopo de quem aprovou e
 * valida na ponte. Mora em tests/concurrency porque COMMITA a chave; ao fim, apaga a própria linha.
 */
describeIntegracao("pareamento por código (HTTP real, commita)", () => {
  let app: App;
  let srv: ServidorDeTeste;
  const SEGREDO = "segredo-de-teste";
  const dona = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
  const outra = { tenantId: TENANT_PADRAO, pessoaId: randomUUID() };
  const sessao = (e: typeof dona) => ({ cookie: `nod_sessao=${cunharCookie(e, SEGREDO)}`, tenantId: e.tenantId });
  const criadas: string[] = [];
  const publica = (caminho: string, corpo: unknown, cabecalhos: Record<string, string> = {}) =>
    fetch(`${srv.url}/api/${caminho}`, { method: "POST", headers: { "content-type": "application/json", ...cabecalhos }, body: JSON.stringify(corpo) });

  beforeAll(async () => {
    app = comporApp({ db, env: { NOD_EXECUTOR: "catcher", NOD_CREDENTIAL_KEY: "0".repeat(63) + "5" }, listarPessoas: async () => [] });
    srv = await servidorDeTeste(app.rotas, { segredoSessao: SEGREDO });
  });

  afterAll(async () => {
    for (const id of criadas) await abrirTxEscopada(db, dona)((trx) => trx`delete from maquina_tokens where id = ${id}`);
    await srv?.close();
    await app?.fechar();
  });

  it("pede → a pessoa vê e aprova → a máquina troca pela chave, no escopo de quem aprovou", async () => {
    const pedido = await publica("pareamento/dispositivo", { nome: "vm-sp", plataforma: "linux" });
    expect(pedido.status).toBe(201);
    const p = (await pedido.json()) as { codigoDispositivo: string; codigoPessoa: string; intervaloS: number };
    expect(p.intervaloS).toBe(5);

    expect((await publica("pareamento/dispositivo/trocar", { codigoDispositivo: p.codigoDispositivo })).status).toBe(202);

    const visto = await srv.chamar(sessao(dona), "GET", `maquinas/dispositivos/${encodeURIComponent(p.codigoPessoa)}`);
    expect(visto.status).toBe(200);
    expect(await visto.json()).toEqual({ nome: "vm-sp", plataforma: "linux" });
    expect((await srv.chamar(sessao(dona), "POST", `maquinas/dispositivos/${encodeURIComponent(p.codigoPessoa)}/aprovar`)).status).toBe(200);
    // Aprovado, o código não vale para mais ninguém.
    expect((await srv.chamar(sessao(outra), "GET", `maquinas/dispositivos/${encodeURIComponent(p.codigoPessoa)}`)).status).toBe(404);

    const troca = await publica("pareamento/dispositivo/trocar", { codigoDispositivo: p.codigoDispositivo });
    expect(troca.status).toBe(201);
    const { chave, machineId } = (await troca.json()) as { chave: string; machineId: string };
    criadas.push(machineId);
    expect(await autorizarChaveMaquina(db, chave, Date.now())).toEqual({ ...dona, chaveId: machineId });
    // Uso único.
    expect((await publica("pareamento/dispositivo/trocar", { codigoDispositivo: p.codigoDispositivo })).status).toBe(400);

    // A máquina aparece em Máquinas (sem conexão viva no modo local: não conectada), e pode virar o padrão.
    const lista = (await (await srv.chamar(sessao(dona), "GET", "maquinas")).json()) as MaquinasDto;
    expect(lista.maquinas.find((m) => m.id === machineId)).toMatchObject({ nome: "vm-sp", conectada: false, plataforma: null });
    const padrao = await srv.chamar(sessao(dona), "PUT", "maquinas/padrao", { maquinaId: machineId });
    expect(await padrao.json()).toEqual({ padraoId: machineId });
    expect(((await (await srv.chamar(sessao(dona), "GET", "maquinas")).json()) as MaquinasDto).padraoId).toBe(machineId);
    // A chave de outra pessoa não serve de padrão.
    expect((await srv.chamar(sessao(outra), "PUT", "maquinas/padrao", { maquinaId: machineId })).status).toBe(404);
    await srv.chamar(sessao(dona), "PUT", "maquinas/padrao", { maquinaId: null });
  });

  it("navegador não pede nem troca (Origin → 403); plataforma desconhecida é recusada", async () => {
    expect((await publica("pareamento/dispositivo", { nome: "x", plataforma: "linux" }, { origin: "https://site.qualquer" })).status).toBe(403);
    expect((await publica("pareamento/dispositivo/trocar", { codigoDispositivo: "x" }, { origin: "https://site.qualquer" })).status).toBe(403);
    expect((await publica("pareamento/dispositivo", { nome: "x", plataforma: "windows" })).status).toBe(400);
    expect((await publica("pareamento/dispositivo", { nome: "", plataforma: "linux" })).status).toBe(400);
  });

  it("o script de instalação sai com o endereço deste servidor e os arquivos do motor só pelo nome", async () => {
    const script = await fetch(`${srv.url}/api/motor/instalar`);
    expect(script.status).toBe(200);
    expect(await script.text()).toContain(`NOD_SERVIDOR="${srv.url}"`);
    expect((await fetch(`${srv.url}/api/motor/arquivos/..%2Fpackage.json`)).status).toBe(404);
    expect((await fetch(`${srv.url}/api/motor/arquivos/outro.mjs`)).status).toBe(404);
  });
});
