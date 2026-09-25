import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configGithubNativo, criarDetectorGh } from "../../../src/adapters/conectores-locais/github/nativo.ts";

/**
 * A escolha do jeito já traduzida em processo (ADR-047): o que a composição spawna para cada
 * combinação de onde roda × o que está pronto. O domínio escolhe; aqui se confere que a escolha
 * vira o ambiente certo — e que o ambiente de um jeito não carrega a credencial de outro.
 */
const AMBIENTE = { PATH: "/usr/bin:/bin", HOME: "/Users/m", USER: "m", NOD_CREDENTIAL_KEY: "chave-do-servidor", DATABASE_URL: "postgres://x" };
const COMPOSIO = { COMPOSIO_URL: "https://backend.composio.dev/tool_router/v3/trs/mcp", COMPOSIO_API_KEY: "ak_x" };
const APP = { token: "ghs_instalacao", expiraEm: 1_000 };

/**
 * medido em 2026-09-24: sob a suíte inteira com outra suíte rodando na mesma máquina, spawnar o
 * servidor stdio + o gh falso passou dos 5 s padrão do projeto unit (4 de 779 testes, uma rodada em
 * três). O teto por teste sobe só aqui, onde há processo de verdade.
 */
const PROCESSO = { timeout: 20_000 };

describe("configGithubNativo: onde roda × jeitos prontos", () => {
  it("máquina com gh: gh, sem token no ambiente mesmo com token guardado, e com PATH aumentado para o Homebrew", () => {
    const r = configGithubNativo({ onde: "maquina_da_pessoa", envConector: { GITHUB_TOKEN: "ghp_x", ...COMPOSIO }, ghLogado: true, app: APP, ambiente: AMBIENTE });
    if (!r.ok) throw new Error("jeito");
    expect(r.cfg.jeito).toBe("gh");
    expect(r.cfg.env).toMatchObject({ NOD_GITHUB_JEITO: "gh", HOME: "/Users/m", USER: "m" });
    expect(r.cfg.env.PATH).toContain("/opt/homebrew/bin");
    expect(Object.values(r.cfg.env).join(" ")).not.toMatch(/ghp_x|ak_x|ghs_|chave-do-servidor|postgres/);
  });

  it("máquina sem gh: token, depois Composio; o App nunca", () => {
    const token = configGithubNativo({ onde: "maquina_da_pessoa", envConector: { GITHUB_TOKEN: "ghp_x", ...COMPOSIO }, ghLogado: false, app: APP, ambiente: AMBIENTE });
    expect(token.ok && token.cfg.env).toMatchObject({ NOD_GITHUB_JEITO: "token", NOD_GITHUB_TOKEN: "ghp_x" });
    const composio = configGithubNativo({ onde: "maquina_da_pessoa", envConector: COMPOSIO, ghLogado: false, app: APP, ambiente: AMBIENTE });
    expect(composio.ok && composio.cfg.env).toMatchObject({ NOD_GITHUB_JEITO: "composio", NOD_COMPOSIO_CHAVE: "ak_x" });
    expect(configGithubNativo({ onde: "maquina_da_pessoa", envConector: {}, ghLogado: false, app: APP, ambiente: AMBIENTE }).ok).toBe(false);
  });

  it("servidor: App (com validade), depois Composio, depois token — e NUNCA gh, mesmo com o gh do servidor logado", () => {
    const app = configGithubNativo({ onde: "servidor", envConector: { GITHUB_TOKEN: "ghp_x", ...COMPOSIO }, ghLogado: true, app: APP, ambiente: AMBIENTE });
    expect(app.ok && app.cfg).toMatchObject({ jeito: "app", expiraEm: 1_000, env: { NOD_GITHUB_JEITO: "app", NOD_GITHUB_TOKEN: "ghs_instalacao" } });
    const composio = configGithubNativo({ onde: "servidor", envConector: { GITHUB_TOKEN: "ghp_x", ...COMPOSIO }, ghLogado: true, app: null, ambiente: AMBIENTE });
    expect(composio.ok && composio.cfg.jeito).toBe("composio");
    const token = configGithubNativo({ onde: "servidor", envConector: { GITHUB_TOKEN: "ghp_x" }, ghLogado: true, app: null, ambiente: AMBIENTE });
    expect(token.ok && token.cfg.jeito).toBe("token");
    const nada = configGithubNativo({ onde: "servidor", envConector: {}, ghLogado: true, app: null, ambiente: AMBIENTE });
    expect(nada).toEqual({ ok: false, frase: expect.stringContaining("para rotinas noturnas, conecte o GitHub da organização") });
  });
});

describe("detector do gh desta máquina", PROCESSO, () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = null;
  });

  it("`gh auth status` com saída 0 = logado; o resultado fica em cache curto e o deslogado expira antes", async () => {
    dir = mkdtempSync(join(tmpdir(), "nod-ghdet-"));
    const gh = join(dir, "gh");
    writeFileSync(gh, `#!/bin/sh\necho "$@" >> "${dir}/chamadas"\n[ "$1 $2" = "auth status" ] && exit $(cat "${dir}/saida")\nexit 9\n`);
    chmodSync(gh, 0o755);
    writeFileSync(join(dir, "saida"), "1");
    let agora = 0;
    const d = criarDetectorGh({ ambiente: { PATH: "/usr/bin:/bin", HOME: dir }, bin: gh, agora: () => agora });
    expect(await d.logado()).toBe(false);
    writeFileSync(join(dir, "saida"), "0");
    agora = 5_000;
    expect(await d.logado()).toBe(false);
    agora = 11_000;
    expect(await d.logado()).toBe(true);
    agora = 60_000;
    expect(await d.logado()).toBe(true);
  });
});
