import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Regression: ISSUE-002 — NOD_MODELO_LIGACAO_CLAUDE com opções e sem aspas no config.env perdia as opções em silêncio
// Found by /qa on 2026-10-05
// Report: .gstack/qa-reports/qa-report-nod-164-2026-10-05.md
//
// NOD-164: o deploy.sh faz `source ./config.env`; `NOD_MODELO_LIGACAO_CLAUDE=claude-sonnet-5-5 esforco=low` sem aspas são
// DUAS atribuições no bash, e o servidor subia com o modelo sem o esforço, sem erro nenhum. O deploy.sh roda numa pasta
// temporária (o `cd /opt/nod` é desviado por uma função exportada) com um `gcloud` falso: nada sai da máquina.

const DEPLOY = fileURLToPath(new URL("../../infra/gcp/vm/deploy.sh", import.meta.url));
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "nod-deploy-"));
  await writeFile(join(dir, "gcloud"), "#!/bin/sh\nexit 1\n");
  await chmod(join(dir, "gcloud"), 0o755);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function deploy(): string {
  return spawnSync("bash", [DEPLOY, "tag-teste"], {
    cwd: dir,
    env: { PATH: `${dir}:${process.env.PATH ?? ""}`, HOME: dir, "BASH_FUNC_cd%%": `() { builtin cd ${JSON.stringify(dir)}; }` },
    input: "",
    encoding: "utf8",
  }).stderr;
}

async function configCom(linha: string): Promise<void> {
  await writeFile(join(dir, "config.env"), `PROJETO=projeto-teste\nREGISTRO=registro-teste\nSQL_IP=10.0.0.1\nNOD_DOMINIO=teste.local\n${linha}\n`);
}

describe("deploy.sh e o modelo da ligação no config.env (NOD-164)", () => {
  it.each(["NOD_MODELO_LIGACAO_CLAUDE=claude-sonnet-5-5 esforco=low", "NOD_MODELO_LIGACAO_CODEX=gpt-6-luna esforco=low"])("sem aspas e com opções: recusa antes de qualquer efeito (%s)", async (linha) => {
    await configCom(linha);
    expect(deploy()).toMatch(/NOD_MODELO_LIGACAO_\* com opções precisa estar entre aspas/);
  });

  it.each([
    'NOD_MODELO_LIGACAO_CLAUDE="claude-sonnet-5-5 esforco=low"',
    "NOD_MODELO_LIGACAO_CLAUDE='claude-sonnet-5-5 esforco=low pensamento=desligado'",
    "NOD_MODELO_LIGACAO_CLAUDE=claude-sonnet-4-6",
    "NOD_MODELO_LIGACAO_CLAUDE=claude-sonnet-4-6 # comentário",
    "NOD_MODELO_LIGACAO_CLAUDE=",
  ])("formato aceito passa da checagem (%s)", async (linha) => {
    await configCom(linha);
    const err = deploy();
    expect(err).not.toMatch(/precisa estar entre aspas/);
    // Passou da checagem e do source: parou adiante, nos segredos do gcloud falso.
    expect(err).toMatch(/faltam os segredos/);
  });
});

describe("ligação Codex desligada em produção (NOD-167)", () => {
  it("o config.env traz NOD_LIGACAO_CODEX=0 e o deploy.sh repassa ao nod.env com padrão 0", async () => {
    const { readFile } = await import("node:fs/promises");
    const config = await readFile(fileURLToPath(new URL("../../infra/gcp/config.env", import.meta.url)), "utf8");
    expect(config).toMatch(/^NOD_LIGACAO_CODEX=0$/m);
    expect(await readFile(DEPLOY, "utf8")).toMatch(/^NOD_LIGACAO_CODEX=\$\{NOD_LIGACAO_CODEX:-0\}$/m);
  });
});
