import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { rotasMotor } from "../../../src/adapters/http/rotas/motor.ts";
import { servidorDeTeste, type ServidorDeTeste } from "../../helpers/servidor-de-teste.ts";

/** ADR-088: o servidor serve o script de instalação e os três arquivos do motor; `/motor` é o endereço curto. */
describe("rotas do motor (ADR-088)", () => {
  let srv: ServidorDeTeste;
  let comPublica: ServidorDeTeste;
  beforeAll(async () => {
    const pasta = await mkdtemp(join(tmpdir(), "nod-dist-motor-"));
    await writeFile(join(pasta, "nod-motor.mjs"), "console.log('motor')\n");
    srv = await servidorDeTeste(rotasMotor({ pasta, versao: "0.5.0-rc.1" }));
    comPublica = await servidorDeTeste(rotasMotor({ pasta, versao: "0.5.0-rc.1", urlPublica: "https://nod.exemplo.com" }));
  });
  afterAll(async () => { await srv?.close(); await comPublica?.close(); });

  it("o arquivo do motor sai pelo nome; o que não foi empacotado dá 404", async () => {
    const r = await fetch(`${srv.url}/api/motor/arquivos/nod-motor.mjs`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/javascript");
    expect(await r.text()).toContain("motor");
    expect((await fetch(`${srv.url}/api/motor/arquivos/proxy.mjs`)).status).toBe(404);
  });

  it("o script usa o endereço do pedido (loopback http), o HTTPS do proxy ou o endereço público configurado", async () => {
    expect(await (await fetch(`${srv.url}/api/motor/instalar`)).text()).toContain(`NOD_SERVIDOR="${srv.url}"`);
    expect(await (await fetch(`${srv.url}/api/motor/instalar`, { headers: { "x-forwarded-proto": "https", "x-forwarded-host": "nod.exemplo.com" } })).text()).toContain('NOD_SERVIDOR="https://nod.exemplo.com"');
    expect((await fetch(`${srv.url}/api/motor/instalar`, { headers: { "x-forwarded-proto": "http", "x-forwarded-host": "nod.exemplo.com" } })).status).toBe(400);
    expect(await (await fetch(`${comPublica.url}/api/motor/instalar`)).text()).toContain('NOD_SERVIDOR="https://nod.exemplo.com"');
  });

  it("/motor redireciona para o script (o curl -L segue)", async () => {
    const r = await fetch(`${srv.url}/motor`, { redirect: "manual" });
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/api/motor/instalar");
  });
});
