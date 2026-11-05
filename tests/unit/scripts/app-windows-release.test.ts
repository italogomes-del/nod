import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ler = (c: string) => readFileSync(new URL(`../../../${c}`, import.meta.url), "utf8");

// ADA-229 (ADR-152, itens 8 e 9): o app desktop do Windows no electron-builder, na release e na CI.
describe("ADA-229: electron-builder do Windows", () => {
  const cfg = ler("electron-builder-windows.yml");
  const chave = (y: string, k: string) => y.match(new RegExp(`^\\s*${k}: (.+)$`, "m"))?.[1]?.trim();
  it("NSIS de 1 clique, por usuário, com os dois atalhos e abrindo no fim", () => {
    expect([chave(cfg, "oneClick"), chave(cfg, "perMachine"), chave(cfg, "createDesktopShortcut"), chave(cfg, "createStartMenuShortcut"), chave(cfg, "runAfterFinish")]).toEqual(["true", "false", "always", "true", "true"]);
    expect(cfg).toMatch(/^win:\n(?: {2}.*\n)*? {2}target:\n {4}- target: nsis\n {6}arch: \[x64\]$/m);
  });
  it("o nome do .exe é o do feed (nod-<v>-win-x64.exe) e não leva nada do Mac", () => {
    expect(chave(cfg, "artifactName")).toBe("nod-${version}-win-x64.${ext}");
    expect(cfg).not.toMatch(/^(extraResources|mac|dmg):/m);
    expect(chave(cfg, "appId")).toBe(chave(ler("electron-builder.yml"), "appId"));
  });
  it("o script npm monta o main do Windows e empacota com essa config", () => {
    const s = JSON.parse(ler("package.json")).scripts["desktop:windows"] as string;
    expect(s).toContain("desktop:build -- --windows");
    expect(s).toContain("--config electron-builder-windows.yml");
    expect(s).toContain("--publish never");
  });
});

describe("ADA-229: release e CI", () => {
  const release = ler(".github/workflows/desktop-release.yml");
  const job = release.slice(release.indexOf("\n  windows:\n"), release.indexOf("\n  draft:\n"));
  it("a assinatura só entra com NOD_WINDOWS_ASSINAR == '1' (NOD-471)", () => {
    expect(job).toContain("WIN_CSC_LINK: ${{ vars.NOD_WINDOWS_ASSINAR == '1' && secrets.WIN_CSC_LINK || '' }}");
    expect(job).toContain('CSC_IDENTITY_AUTO_DISCOVERY: "false"');
  });
  it("codex #5: com a flag ligada e sem o certificado, o build falha em vez de sair sem assinar", () => {
    expect(job).toMatch(/NOD_WINDOWS_ASSINAR == '1'[\s\S]*-not \$env:WIN_CSC_LINK[\s\S]*throw/);
    expect(job).toMatch(/forceCodeSigning=true/);
  });
  it("monta o app, testa instalar e desinstalar e sobe o nome estável, o do feed e o SHA256-win-x64.txt", () => {
    expect(job).toContain("npm run desktop:windows");
    expect(job).toContain("testar-app.ps1 -Exe release\\nod-windows-x64.exe");
    expect(job).toContain("SHA256-win-x64.txt");
    expect(release).toContain("release/nod-windows-x64.exe release/nod-windows-x64.exe.sha256 release/nod-*-win-x64.exe)");
  });
  it("a CI roda o job windows quando o app muda e passa o testar-app.ps1 no PSScriptAnalyzer", () => {
    const ci = ler(".github/workflows/ci.yml");
    expect(ci).toContain("|desktop/windows/|desktop/atualizacao\\.ts$|scripts/desktop/build\\.mjs$|electron-builder-windows\\.yml$|");
    expect(ci).toContain("'scripts\\windows\\testar-app.ps1') | ForEach-Object { Invoke-ScriptAnalyzer");
    expect(ci).toContain("npm run desktop:windows");
  });
  it("o testar-app.ps1 é ASCII (o Windows PowerShell 5.1 lê sem BOM como ANSI)", () => {
    expect([...ler("scripts/windows/testar-app.ps1")].every((c) => c.charCodeAt(0) < 128)).toBe(true);
  });
});
