// ADA-226: o instalador .exe do Windows. O .exe de verdade roda no job windows da CI (scripts/windows/testar-exe.ps1);
// aqui ficam o ícone, a versão do VIProductVersion e as travas do .nsi e dos .ps1 que não podem voltar.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error: módulo .mjs sem tipos (script de build)
import { icoDePng, lerPngRgba, gravarPng, reduzir, TAMANHOS_DO_ICONE } from "../../../scripts/windows/icone-ico.mjs";
// @ts-expect-error: módulo .mjs sem tipos (script de build)
import { NOME_DO_EXE, versaoNumerica } from "../../../scripts/windows/gerar-exe.mjs";

const ler = (f: string) => readFileSync(new URL(`../../../scripts/windows/${f}`, import.meta.url), "utf8");
const nsi = ler("instalador.nsi");
const instalar = ler("instalar-pelo-exe.ps1");
const desinstalar = ler("desinstalar-pelo-exe.ps1");
const testar = ler("testar-exe.ps1");
const workflow = readFileSync(new URL("../../../.github/workflows/desktop-release.yml", import.meta.url), "utf8");

describe("ADA-226: versão do .exe", () => {
  it("leva a versão do package.json para os quatro números do NSIS", () => {
    expect(versaoNumerica("1.0.0-rc.3")).toBe("1.0.0.3");
    expect(versaoNumerica("2.10.4")).toBe("2.10.4.0");
    expect(versaoNumerica("1.2.3-beta")).toBe("1.2.3.0");
    expect(NOME_DO_EXE).toBe("nod-windows-x64.exe");
  });
  it("recusa versão que o makensis não aceitaria (e que poderia injetar define)", () => {
    for (const v of ["1.0", "1.0.0 -DX=1", "v1.0.0", "1.0.0-rc.3\n", ""]) expect(() => versaoNumerica(v)).toThrow(/versão inválida/);
  });
});

describe("ADA-226: ícone do .exe", () => {
  const png = readFileSync(new URL("../../../desktop/resources/icon.png", import.meta.url));
  const ico: Buffer = icoDePng(png);

  it("grava um .ico com uma imagem PNG por tamanho, nos deslocamentos certos", () => {
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBe(TAMANHOS_DO_ICONE.length);
    TAMANHOS_DO_ICONE.forEach((t: number, i: number) => {
      const e = 6 + 16 * i;
      expect(ico[e]).toBe(t >= 256 ? 0 : t);
      expect(ico.readUInt16LE(e + 6)).toBe(32);
      const tamanho = ico.readUInt32LE(e + 8);
      const inicio = ico.readUInt32LE(e + 12);
      expect(inicio + tamanho).toBeLessThanOrEqual(ico.length);
      const img = lerPngRgba(ico.subarray(inicio, inicio + tamanho));
      expect([img.largura, img.altura]).toEqual([t, t]);
    });
  });

  it("o PNG gravado volta igual pelo decodificador e a redução mantém o pixel opaco", () => {
    const img = { largura: 2, altura: 2, px: Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 20, 30, 0]) };
    expect(lerPngRgba(gravarPng(img)).px.equals(img.px)).toBe(true);
    // Média ponderada pelo alfa: o pixel transparente não escurece a cor.
    const um = reduzir({ largura: 2, altura: 1, px: Buffer.from([200, 100, 50, 255, 0, 0, 0, 0]) }, 1);
    expect([...um.px]).toEqual([200, 100, 50, 128]);
  });

  it("recusa o que não é PNG RGBA de 8 bits", () => {
    expect(() => lerPngRgba(Buffer.from("nao e png"))).toThrow(/não é PNG/);
    const rgb = Buffer.from(gravarPng({ largura: 1, altura: 1, px: Buffer.from([1, 2, 3, 4]) }));
    rgb[8 + 8 + 9] = 2; // tipo de cor 2 (RGB) no IHDR
    expect(() => lerPngRgba(rgb)).toThrow(/RGBA/);
  });
});

describe("ADA-226: travas do instalador.nsi", () => {
  it("instala por usuário, sem pedir admin, na pasta da ADA-32", () => {
    expect(nsi).toMatch(/^RequestExecutionLevel user$/m);
    expect(nsi).toMatch(/^InstallDir "\$LOCALAPPDATA\\nod"$/m);
    expect(nsi).toContain('WriteRegStr HKCU "${CHAVE_DESINSTALAR}"');
    expect(nsi).not.toMatch(/HKLM/);
  });
  it("roda o PowerShell de 64 bits pelo caminho absoluto, com o servidor só no ambiente (nunca na linha de comando)", () => {
    expect(nsi).toContain('"$WINDIR\\Sysnative\\WindowsPowerShell\\v1.0\\powershell.exe"');
    // Por registrador e não "$Servidor" no texto: um " no endereço quebraria o System::Call, o .ps1 validaria o
    // NOD_EXE_SERVIDOR herdado e o atalho e o "Abrir o Nod" usariam outro endereço, sem validação.
    expect(nsi).toContain("StrCpy $1 $Servidor");
    expect(nsi).toContain("SetEnvironmentVariable(t \"NOD_EXE_SERVIDOR\", t r1)");
    expect(nsi).not.toMatch(/System::Call[^\n]*\$Servidor/);
    const execs = nsi.split("\n").filter((l) => l.includes("nsExec::"));
    expect(execs.length).toBe(2);
    for (const l of execs) {
      expect(l).not.toContain("$Servidor");
      expect(l).toContain("-NoProfile -NonInteractive -ExecutionPolicy Bypass -File");
    }
  });
  it("falha com o código do .ps1 (1, 2 ou 3; o resto vira 4) e não cria atalho nem chave quando falha", () => {
    const secao = nsi.slice(nsi.indexOf('Section "Nod"'), nsi.indexOf("SectionEnd"));
    const aborta = secao.indexOf("Abort");
    expect(aborta).toBeGreaterThan(0);
    expect(secao.indexOf("WriteRegStr")).toBeGreaterThan(aborta);
    expect(secao.indexOf("CopyFiles")).toBeGreaterThan(aborta);
    expect(secao).toContain("SetErrorLevel 4");
    expect(secao).toContain("/SD IDOK");
  });
  it("a pasta é sempre a da ADA-32: /D= e um desinstalador copiado não mudam o que o RMDir /r apaga", () => {
    for (const funcao of ["Function .onInit", "Function un.onInit"]) {
      const corpo = nsi.slice(nsi.indexOf(funcao), nsi.indexOf("FunctionEnd", nsi.indexOf(funcao)));
      expect(nsi).toContain(funcao);
      expect(corpo).toContain('StrCpy $INSTDIR "$LOCALAPPDATA\\nod"');
    }
  });
  it("um instalador (ou desinstalador) do Nod por vez: o segundo sai com 5 sem rodar a ADA-32", () => {
    expect(nsi).toContain('System::Call \'Kernel32::CreateMutex(p 0, i 0, t "Local\\nod-instalador") p .r8 ?e\'');
    for (const funcao of ["Function .onInit", "Function un.onInit"]) {
      const corpo = nsi.slice(nsi.indexOf(funcao), nsi.indexOf("FunctionEnd", nsi.indexOf(funcao)));
      expect(corpo).toContain("!insertmacro UmInstaladorPorVez");
    }
    const macro = nsi.slice(nsi.indexOf("!macro UmInstaladorPorVez"), nsi.indexOf("!macroend", nsi.indexOf("!macro UmInstaladorPorVez")));
    expect(macro).toMatch(/\$\{If\} \$7 == 183[\s\S]*SetErrorLevel 5[\s\S]*Abort/);
    // O teste espera o desinstalador soltar a trava antes de abrir a janela (senão a instalação pela janela sai com 5).
    expect(testar).toContain("[Threading.Mutex]::TryOpenExisting('Local\\nod-instalador', [ref]$trava)");
  });
  it("só apaga a pasta na desinstalação se o desinstalador mora nela", () => {
    const un = nsi.slice(nsi.indexOf('Section "Uninstall"'));
    expect(un).toMatch(/\$\{If\} \$\{FileExists\} "\$INSTDIR\\\$\{DESINSTALADOR\}"\s+RMDir \/r "\$INSTDIR"/);
  });
});

describe("ADA-226: o .ps1 que o .exe roda", () => {
  const padrao = /\$servidor -cnotmatch '([^']+)'/.exec(instalar)?.[1] ?? "";
  // O -cnotmatch do PowerShell é o Regex do .NET, em que "$" casa antes de um \n final ("https://a.com\n" passaria):
  // o padrão termina em \z, que no JS (sem a flag m) é o "$".
  const aceita = (s: string) => new RegExp(padrao.replace(/\\z$/, "$")).test(s);

  it("ancora o fim em \\z (o $ do .NET aceita um \\n no fim)", () => {
    expect(padrao.endsWith("\\z")).toBe(true);
    expect(padrao).not.toMatch(/\$/);
  });

  it("só aceita https com host simples ou o loopback da CI", () => {
    expect(padrao).not.toBe("");
    for (const ok of ["https://app.nodbot.ai", "https://34-39-164-139.sslip.io", "https://nod.exemplo.com:8443", "http://127.0.0.1:8765"]) expect(aceita(ok)).toBe(true);
    for (const ruim of [
      "http://app.nodbot.ai",
      "https://app.nodbot.ai/",
      "https://app.nodbot.ai/x",
      "https://user@evil.com",
      "https://a.com;calc",
      "https://a.com'+(calc)+'",
      "https://a.com\nhttps://b.com",
      "https://a.com\n",
      "http://127.0.0.1",
      "file://c:/x",
      "",
    ])
      expect(aceita(ruim)).toBe(false);
  });
  it("sai com 2 (endereço), 3 (servidor) e 1 (instalação), e só 0 com o resultado ok da ADA-32", () => {
    expect(instalar).toMatch(/exit 2/);
    expect(instalar.match(/exit 3/g)?.length).toBe(2);
    expect(instalar).toContain("if ($env:NOD_INSTALACAO_RESULTADO -ne 'ok') { exit 1 }");
    expect(instalar).toContain("Contains('NOD_INSTALACAO_RESULTADO')");
    expect(instalar).toContain("$env:NOD_INSTALACAO_RESULTADO = ''");
  });
  it("a desinstalação só para o node da pasta do Nod e guarda a conexão", () => {
    expect(desinstalar).toContain("$_.ExecutablePath.StartsWith($prefixo, [StringComparison]::OrdinalIgnoreCase)");
    expect(desinstalar).not.toMatch(/nod-motor\\conexao|Remove-Item\s/);
    expect(desinstalar).toContain("[Microsoft.Win32.RegistryValueKind]::ExpandString");
  });
  it("a desinstalação para a árvore do motor (filhos por ParentProcessId), dos filhos para o pai", () => {
    expect(desinstalar).toContain("$f.ParentProcessId -eq $id");
    expect(desinstalar).toMatch(/for \(\$i = \$arvore\.Count - 1; \$i -ge 0; \$i--\) \{ Stop-Process -Id \$arvore\[\$i\]/);
    expect(desinstalar).not.toMatch(/foreach \(\$p in \$processos\) \{ Stop-Process/);
  });
});

// Regression: ISSUE-001 e ISSUE-002, achados pelo /qa em 2026-11-05 (PR #669).
// Regression: ISSUE-003 — /SERVIDOR=http://… chegava ao .ps1 como "http:" (o job windows saiu com 2).
describe("ADA-226: /SERVIDOR= do .exe", () => {
  it("não usa o ${GetOptions}, que corta o valor no primeiro '/', e lê até o primeiro espaço", () => {
    expect(nsi).not.toMatch(/\$\{GetOptions\}/);
    const corpo = nsi.slice(nsi.indexOf("Function LerServidor"), nsi.indexOf("FunctionEnd", nsi.indexOf("Function LerServidor")));
    expect(corpo).toContain('${If} $4 == "/SERVIDOR="');
    expect(corpo).toContain('${OrIf} $4 == " "');
    expect(corpo).toContain("StrCpy $Servidor $1 $5");
    const init = nsi.slice(nsi.indexOf("Function .onInit"), nsi.indexOf("FunctionEnd", nsi.indexOf("Function .onInit")));
    expect(init).toMatch(/\$\{GetParameters\} \$0\s+Call LerServidor/);
  });
});

describe("ADA-226: o que o desinstalador limpa (critério 4)", () => {
  it("tira a tarefa, a chave Run, as duas pastas do Path e a marca NOD_INSTALADO_EM", () => {
    // A chave Run só existe quando a política recusa a tarefa: a CI nunca a cria, então só este teste a guarda.
    expect(desinstalar).toContain("Remove-ItemProperty -Path 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Run' -Name $nome");
    expect(desinstalar).toContain("Unregister-ScheduledTask -TaskName $nome -TaskPath '\\'");
    expect(desinstalar).toContain("$tirar = @((Join-Path $pasta 'bin'), (Join-Path $pasta 'node'))");
    expect(desinstalar).toContain("[Environment]::SetEnvironmentVariable('NOD_INSTALADO_EM', $null, 'User')");
    expect(desinstalar).toContain("$nome = 'nod-motor-' + [Security.Principal.WindowsIdentity]::GetCurrent().User.Value");
    // E a CI planta a chave Run antes de desinstalar e confere que ela sumiu.
    const passo3 = testar.slice(testar.indexOf("== 3. desinstalacao silenciosa"), testar.indexOf("== 4. instalacao pela janela"));
    expect(passo3).toMatch(/New-ItemProperty -Path \$chaveRun -Name \$nomeDaTarefa[\s\S]*desinstalar-nod\.exe[\s\S]*Get-ItemProperty -Path \$chaveRun -Name \$nomeDaTarefa/);
  });
  it("a ADA-32 que o .exe roda instala sempre em %LOCALAPPDATA%\\nod: um NOD_PASTA herdado não desvia a pasta", () => {
    // O NSIS grava o desinstalador e o RMDir /r em %LOCALAPPDATA%\nod; com NOD_PASTA no ambiente a ADA-32 instalaria em
    // outro lugar e o desinstalador deixaria aquela pasta no Path e o motor de pé.
    const limpa = instalar.indexOf("Remove-Item -Path Env:NOD_PASTA");
    expect(limpa).toBeGreaterThan(0);
    expect(limpa).toBeLessThan(instalar.indexOf("Invoke-Expression $script"));
  });
});

describe("ADA-226: makensis fixado", () => {
  // ADA-229: a release passou a levar o app desktop (electron-builder, que traz o próprio NSIS); o .exe da ADA-226 segue
  // testado só na CI.
  it("a CI instala e confere o NSIS 3.13 (sem usar o que vier no runner)", () => {
    const ci = readFileSync(new URL("../../../.github/workflows/ci.yml", import.meta.url), "utf8");
    for (const wf of [ci]) {
      expect(wf).toContain("choco install nsis --version=3.13.0 -y --force --no-progress");
      expect(wf).toContain("if ((& $mk /VERSION) -ne 'v3.13') { throw");
      expect(wf).not.toMatch(/choco install nsis -y/);
    }
  });
});

describe("ADA-226: release", () => {
  it("o rascunho leva o .exe e o .sha256 e espera o job windows", () => {
    expect(workflow).toMatch(/^ {2}windows:\n {4}needs: verify\n {4}runs-on: windows-latest/m);
    expect(workflow).toContain("needs: [mac, windows, vm-local]");
    expect(workflow).toContain("needs.windows.result == 'success'");
    expect(workflow).toContain("release/nod-windows-x64.exe release/nod-windows-x64.exe.sha256");
  });
});

describe("ADA-226: codificação dos .ps1 do .exe", () => {
  // O .exe roda os .ps1 no Windows PowerShell 5.1: sem BOM ele lê como ANSI e os acentos saem quebrados
  // (e o PSScriptAnalyzer da CI barra com PSUseBOMForUnicodeEncodedFile).
  it.each(["instalar-pelo-exe.ps1", "desinstalar-pelo-exe.ps1", "testar-exe.ps1", "conferir-instalacao.ps1"])(
    "%s é ASCII puro ou começa com o BOM UTF-8",
    (f) => {
      const bytes = readFileSync(new URL(`../../../scripts/windows/${f}`, import.meta.url));
      const temBom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
      const ascii = bytes.every((b) => b < 0x80);
      expect(temBom || ascii).toBe(true);
    },
  );
});
