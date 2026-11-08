import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { lerComando } from "../../../motor/conexao.ts";

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

// ADA-245 (jornada D): o desinstalador do app também remove o motor, pelo `nod-motor desinstalar`.
describe("ADA-245: desinstalar o app do Windows", () => {
  const cfg = ler("electron-builder-windows.yml");
  const nsh = ler("scripts/windows/app-desinstalar.nsh");
  const macro = nsh.slice(nsh.indexOf("!macro customUnInstall"), nsh.indexOf("!macroend", nsh.indexOf("!macro customUnInstall")));
  it("o NSIS do electron-builder inclui o app-desinstalar.nsh, que define o customUnInstall", () => {
    expect(cfg).toMatch(/^nsis:\n(?: {2}.*\n)*? {2}include: scripts\/windows\/app-desinstalar\.nsh$/m);
    expect(macro).not.toBe("");
  });
  it("não roda na atualização (--updated) nem quando o motor já saiu", () => {
    expect(macro).toMatch(/\$\{IfNot\} \$\{isUpdated\}\n\s+\$\{AndIf\} \$\{FileExists\} "\$LOCALAPPDATA\\nod\\node\\node\.exe"\n\s+\$\{AndIf\} \$\{FileExists\} "\$LOCALAPPDATA\\nod\\motor\\app\\nod-motor\.mjs"/);
  });
  it("roda o nod-motor desinstalar com as opções que o motor aceita", () => {
    expect(macro).toContain(`nsExec::ExecToLog '"$LOCALAPPDATA\\nod\\node\\node.exe" "$LOCALAPPDATA\\nod\\motor\\app\\nod-motor.mjs" desinstalar$NodOpcoes'`);
    const opcoes = [...macro.matchAll(/StrCpy \$NodOpcoes "\$NodOpcoes (--[a-z-]+)"/g)].map((m) => m[1]!);
    expect(new Set(opcoes)).toEqual(new Set(["--manter-ias", "--manter-conexao"]));
    expect(lerComando(["desinstalar", ...new Set(opcoes)])).toEqual({ tipo: "desinstalar", manterIas: true, manterConexao: true, json: false });
  });
  it("/MANTERIAS e /MANTERCONEXAO (e o /S) respondem sem perguntar; a pergunta sem resposta guarda", () => {
    expect(macro).toContain('!insertmacro NodTemOpcao "/MANTERIAS"');
    expect(macro).toContain('!insertmacro NodTemOpcao "/MANTERCONEXAO"');
    expect(macro).toMatch(/!insertmacro NodTemOpcao "\/S"\n\s+StrCpy \$R7 \$R2/);
    // Sem /SD: o desinstalador de 1 clique fica silencioso; o salto só acontece com a resposta que tira algo.
    expect(macro).toMatch(/Tirar também o Claude e o ChatGPT[^\n]*" IDYES \+2\n\s+StrCpy \$NodOpcoes "\$NodOpcoes --manter-ias"/);
    expect(macro).toMatch(/Continuar ligado à sua conta\?[^\n]*" IDNO \+2\n\s+StrCpy \$NodOpcoes "\$NodOpcoes --manter-conexao"/);
    expect(macro).not.toContain("/SD");
  });
  it("revisão do PR #694: motor de antes da ADA-245 (sem `desinstalar`) ou falha: roda a limpeza em PowerShell que vai dentro do desinstalador", () => {
    const depois = macro.slice(macro.indexOf("Pop $R8"));
    expect(depois).toMatch(/\$\{If\} \$R8 != "0"/);
    expect(depois).toContain('File "/oname=$PLUGINSDIR\\desinstalar.ps1" "${PROJECT_DIR}\\scripts\\windows\\desinstalar.ps1"');
    expect(depois).toContain(`nsExec::ExecToLog '"$SYSDIR\\WindowsPowerShell\\v1.0\\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\\desinstalar.ps1"$R9'`);
    // As mesmas escolhas, no vocabulário do desinstalar.ps1 (param -ManterIas / -ManterConexao).
    expect(depois).toMatch(/!insertmacro NodTemOpcao "--manter-ias"\n\s+\$\{If\} \$R2 == "1"\n\s+StrCpy \$R9 "\$R9 -ManterIas"/);
    expect(depois).toMatch(/!insertmacro NodTemOpcao "--manter-conexao"\n\s+\$\{If\} \$R2 == "1"\n\s+StrCpy \$R9 "\$R9 -ManterConexao"/);
    const ps1 = ler("scripts/windows/desinstalar.ps1");
    expect(ps1).toMatch(/\[switch\]\$ManterConexao/);
    expect(ps1).toMatch(/\[switch\]\$ManterIas/);
  });
});
