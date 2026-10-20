import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** NOD-297: toda desktop-v* sai sem assinatura Apple, então o script sempre publica como pré-release. */
const script = readFileSync(new URL("../../../scripts/desktop/release-mac.sh", import.meta.url), "utf8");

describe("release-mac.sh (NOD-297)", () => {
  it("marca --prerelease sem depender de -rc na versão", () => {
    expect(script).toMatch(/^PRE=\(--prerelease\)$/m);
    expect(script).not.toMatch(/\*-\*.*--prerelease/);
  });

  it("usa a marca no gh release create e no gh release edit", () => {
    const usa = (cmd: string) => script.split("\n").some((l) => l.startsWith(cmd) && l.includes('${PRE[@]+"${PRE[@]}"}'));
    expect(usa("gh release create")).toBe(true);
    expect(usa("gh release edit")).toBe(true);
  });
});
