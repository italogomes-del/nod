// NOD-485 (ADR-161): o deploy de produção passou para o marlonwlv/nod. Com vars.DEPLOY_PELO_PUBLICO == '1' o deploy
// daqui não roda (nem por workflow_run, nem à mão): dois repos deployando a mesma VM com códigos diferentes alternariam
// a produção. O passo Deploy também pega o flock da VM antes de instalar os arquivos.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const yml = readFileSync(new URL("../../../.github/workflows/deploy.yml", import.meta.url), "utf8");
const semComentarios = yml.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");

describe("deploy.yml do gamefik/nod depois do corte (NOD-485)", () => {
  it("o job exige DEPLOY_PELO_PUBLICO != '1' em E com todos os gatilhos (dispatch incluso)", () => {
    const cond = /^ {4}if: (.+)$/m.exec(semComentarios)?.[1] ?? "";
    expect(cond).toMatch(/^vars\.DEPLOY_PELO_PUBLICO != '1' && \(/);
    expect(cond).toContain("github.event_name == 'workflow_dispatch'");
  });

  it("o passo Deploy instala os arquivos e roda o deploy.sh sob o flock da VM, no estágio só deste repo", () => {
    expect(semComentarios).toContain("sudo flock -w 1800 -E 75 /opt/nod/deploy.lock sh -c 'install");
    expect(semComentarios).toContain("_ ~/nod-deploy '$SHA'");
    expect(semComentarios).not.toContain("nod-deploy-publico");
  });
});
