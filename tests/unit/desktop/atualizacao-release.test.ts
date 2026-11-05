import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    expect(script).toContain('LINHA="arm64=$HASH_arm64,x64=$HASH_x64"');
    expect(script).toContain('LINHA="$LINHA,win-x64=$HASH_win"');
    expect(script).toContain("NOD_APP_ATUALIZACAO_SHA256=$LINHA");
    expect(script.lastIndexOf("gcloud storage cp")).toBeLessThan(script.indexOf('LINHA="arm64='));
    expect(script).not.toContain("declare -A"); // o bash do Mac é 3.2
    // As duas arquiteturas são conferidas antes de qualquer upload (nada de objeto órfão de uma só).
    expect(script.lastIndexOf("não confere")).toBeLessThan(script.indexOf("gcloud storage objects describe"));
    // Depois do cp, confere o que ficou no bucket antes de imprimir o hash.
    expect(script.slice(script.indexOf("gcloud storage cp"))).toContain("ficou diferente no bucket");
  });
});

/**
 * Revisão do PR #678: o SHA256-win-x64.txt saía sem quebra de linha no fim, e o `cat SHA256-*.txt` colava a linha do
 * Windows na primeira do SHA256-x64.txt. O hash do .exe sumia e a publicação inteira parava (a do Mac junto).
 * Roda o script de verdade, com gh e gcloud falsos numa pasta bin só de symlinks (sem /usr/bin: o gcloud real mora lá).
 */
describe("publicar-atualizacao.sh com a release do Windows (ADA-229)", () => {
  const wf = readFileSync(".github/workflows/desktop-release.yml", "utf8");
  const sha = (b: Buffer | string) => createHash("sha256").update(b).digest("hex");
  const UTEIS = ["bash", "env", "cat", "awk", "head", "mktemp", "rm", "sha256sum", "cp", "mkdir", "dirname"];

  function montar(winComQuebra: boolean) {
    const raiz = mkdtempSync(join(tmpdir(), "nod-publicar-"));
    const bin = join(raiz, "bin"), rel = join(raiz, "release"), bucket = join(raiz, "bucket");
    for (const d of [bin, rel, bucket]) mkdirSync(d);
    for (const u of UTEIS) symlinkSync(execFileSync("/usr/bin/bash", ["-c", `command -v ${u}`], { encoding: "utf8" }).trim(), join(bin, u));
    writeFileSync(join(bin, "gh"), `#!/usr/bin/env bash\nwhile [ $# -gt 0 ]; do [ "$1" = -D ] && D=$2; shift; done\ncp "$REL"/* "$D"/\n`, { mode: 0o755 });
    writeFileSync(join(bin, "gcloud"), [
      "#!/usr/bin/env bash",
      'local_de() { case "$1" in gs://*) p=${1#gs://}; echo "$BUCKET_DIR/${p#*/}" ;; *) echo "$1" ;; esac; }',
      'case "$2" in',
      '  hash) f=$(local_de "$3"); [ -f "$f" ] || exit 1; sha256sum "$f" | awk \'{print $1}\' ;;',
      '  objects) [ -f "$(local_de "$4")" ] ;;',
      '  cp) d=$(local_de "$5"); mkdir -p "$(dirname "$d")"; cp "$4" "$d" ;;',
      "esac",
    ].join("\n"), { mode: 0o755 });
    const v = "1.2.3";
    const conteudo: Record<string, string> = {};
    for (const a of ["arm64", "x64"]) {
      for (const ext of ["dmg", "zip"]) { conteudo[`nod-${v}-mac-${a}.${ext}`] = `${a}-${ext}`; writeFileSync(join(rel, `nod-${v}-mac-${a}.${ext}`), `${a}-${ext}`); }
      // Como o `shasum` do workflow escreve: caminho com release/ e quebra de linha no fim.
      writeFileSync(join(rel, `SHA256-${a}.txt`), ["dmg", "zip"].map((ext) => `${sha(`${a}-${ext}`)}  release/nod-${v}-mac-${a}.${ext}\n`).join(""));
    }
    writeFileSync(join(rel, `nod-${v}-win-x64.exe`), "exe");
    writeFileSync(join(rel, "SHA256-win-x64.txt"), `${sha("exe")}  nod-${v}-win-x64.exe${winComQuebra ? "\r\n" : ""}`);
    const env = { PATH: bin, HOME: raiz, REL: rel, BUCKET_DIR: bucket, NOD_APP_ATUALIZACAO_BUCKET: "nod-teste" };
    expect(execFileSync(join(bin, "bash"), ["-c", "command -v gcloud"], { env, encoding: "utf8" }).trim()).toBe(join(bin, "gcloud"));
    return { raiz, env, bucket, v };
  }

  for (const winComQuebra of [false, true]) {
    it(`publica o .exe e os ZIPs do Mac (SHA256-win-x64.txt ${winComQuebra ? "com" : "sem"} quebra de linha no fim)`, () => {
      const { raiz, env, bucket, v } = montar(winComQuebra);
      try {
        const saida = execFileSync(join(raiz, "bin", "bash"), ["scripts/desktop/publicar-atualizacao.sh", `v${v}`], { env, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
        expect(saida).toContain(`NOD_APP_ATUALIZACAO_SHA256=arm64=${sha("arm64-zip")},x64=${sha("x64-zip")},win-x64=${sha("exe")}`);
        expect(readFileSync(join(bucket, v, `nod-${v}-win-x64.exe`), "utf8")).toBe("exe");
      } finally { rmSync(raiz, { recursive: true, force: true }); }
    });
  }

  it("o workflow escreve o SHA256-win-x64.txt com quebra de linha no fim, como o shasum do Mac", () => {
    const linha = wf.split("\n").find((l) => l.includes("SHA256-win-x64.txt") && l.includes("Set-Content"));
    expect(linha).toBeDefined();
    expect(linha).not.toContain("-NoNewline");
  });
});
