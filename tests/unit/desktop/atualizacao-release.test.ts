import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { objetoDoZip } from "../../../src/domain/atualizacao-app.ts";

/** NOD-132 (ADR-149): o release gera, verifica e publica o ZIP que o Squirrel.Mac instala. */
describe("release do ZIP da atualização (NOD-132)", () => {
  const yml = readFileSync("electron-builder.yml", "utf8");
  const wf = readFileSync(".github/workflows/desktop-release.yml", "utf8");
  const script = readFileSync("scripts/desktop/publicar-atualizacao.sh", "utf8");

  it("o electron-builder gera ZIP nas duas arquiteturas, com o nome que o feed assina", () => {
    expect(yml).toMatch(/- target: zip\n\s+arch: \[arm64, x64\]/);
    expect(yml).toContain("artifactName: nod-${version}-${os}-${arch}.${ext}");
    // O artifactName com os=mac e ext=zip é exatamente o objeto que o servidor assina.
    expect(objetoDoZip("1.2.3", "arm64")).toBe("1.2.3/nod-1.2.3-mac-arm64.zip");
  });

  it("o workflow empacota o ZIP, verifica o .app de dentro e o publica no rascunho com o hash", () => {
    expect(wf).toContain('npx electron-builder --mac dmg zip --"$ARCH"');
    const passo = wf.slice(wf.indexOf("Verificar o .app do ZIP da atualização"), wf.indexOf("Diagnóstico do pacote"));
    expect(passo).toContain('codesign --verify --deep --strict');
    expect(passo).toContain('xcrun stapler validate "$DIR/nod.app"');
    expect(passo).toContain('spctl -a -vv -t exec "$DIR/nod.app"');
    expect(wf).toMatch(/shasum -a 256 release\/nod-\*-mac-"\$ARCH"\.dmg release\/nod-\*-mac-"\$ARCH"\.zip/);
    expect(wf).toContain("release/nod-*-mac-*.zip");
    expect(wf).toMatch(/arquivos=\(release\/\*\.dmg release\/nod-\*-mac-\*\.zip/);
  });

  it("o script de publicação confere o hash, não sobrescreve e não liga o anúncio sozinho", () => {
    expect(script).toContain("set -euo pipefail");
    expect(script).toContain("SHA-256 de $ZIP não confere");
    expect(script).toContain("gcloud storage cp --no-clobber");
    expect(script).not.toMatch(/gcloud storage rm|config\.env\s*<<|>>\s*infra\/gcp\/config\.env/);
    expect(script).toContain('DESTINO="gs://$BUCKET/$VERSAO/$ZIP"');
    // Valida o bucket antes de qualquer gcloud e imprime o hash dos dois ZIPs (só depois do upload).
    expect(script.indexOf("bucket inválido")).toBeGreaterThan(-1);
    expect(script.indexOf("bucket inválido")).toBeLessThan(script.indexOf("gcloud storage"));
    expect(script).toContain("NOD_APP_ATUALIZACAO_SHA256=arm64=$HASH_arm64,x64=$HASH_x64");
    expect(script.lastIndexOf("gcloud storage cp")).toBeLessThan(script.indexOf("NOD_APP_ATUALIZACAO_SHA256=arm64="));
    expect(script).not.toContain("declare -A"); // o bash do Mac é 3.2
    // As duas arquiteturas são conferidas antes de qualquer upload (nada de objeto órfão de uma só).
    expect(script.lastIndexOf("não confere")).toBeLessThan(script.indexOf("gcloud storage objects describe"));
    // Depois do cp, confere o que ficou no bucket antes de imprimir o hash.
    expect(script.slice(script.indexOf("gcloud storage cp"))).toContain("ficou diferente no bucket");
  });
});
