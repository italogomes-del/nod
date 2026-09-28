import { mkdirSync, mkdtempSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { comandoDoHook, montarArgs, settingsDoTerminal } from "../../../src/adapters/executor/drivers/claude-cli.ts";
import { decidirHook, resolverCaminho } from "../../../src/adapters/executor/hook-nativas.ts";
import { NATIVAS_DO_TERMINAL } from "../../../src/domain/nativas.ts";
import { planoDeTeste } from "../../helpers/l5.ts";

/** ADR-052, sobre o sistema de arquivos REAL: link simbólico, "..", arquivo ainda por criar. */
describe("hook do nod (ADR-052)", () => {
  const raiz = realpathSync(mkdtempSync(join(tmpdir(), "nod-hook-")));
  const pasta = join(raiz, "nod", "Ada");
  mkdirSync(pasta, { recursive: true });
  mkdirSync(join(raiz, "segredos"));
  symlinkSync(join(raiz, "segredos"), join(pasta, "atalho"));
  const cfg = { url: "http://127.0.0.1:1", token: "t", permitidas: [pasta] };
  const evento = (tool_name: string, tool_input: Record<string, unknown>) => ({ tool_name, tool_input, cwd: pasta });
  const confirmadas: [string, boolean][] = [];
  const confirmar = async (f: string, c: boolean) => {
    confirmadas.push([f, c]);
    return true;
  };

  it("arquivo novo dentro da pasta do bot passa e é confirmado no servidor", async () => {
    const r = await decidirHook(evento("Write", { file_path: join(pasta, "sub", "novo.html") }), cfg, confirmar);
    expect(r.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(confirmadas.at(-1)).toEqual(["Write", false]);
  });

  it("link simbólico e '..' que saem da pasta são negados pelo caminho real", async () => {
    expect((await decidirHook(evento("Read", { file_path: join(pasta, "atalho", "chave") }), cfg, confirmar)).hookSpecificOutput.permissionDecision).toBe("deny");
    expect((await decidirHook(evento("Write", { file_path: join(pasta, "..", "..", "segredos", "x") }), cfg, confirmar)).hookSpecificOutput.permissionDecision).toBe("deny");
    expect(resolverCaminho(join(pasta, "atalho", "chave"))).toBe(join(raiz, "segredos", "chave"));
  });

  it("web é confirmada como contaminante; sem confirmação do servidor, nada roda", async () => {
    await decidirHook(evento("WebFetch", { url: "https://example.com" }), cfg, confirmar);
    expect(confirmadas.at(-1)).toEqual(["WebFetch", true]);
    const r = await decidirHook(evento("Bash", { command: "ls" }), cfg, async () => false);
    expect(r.hookSpecificOutput).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: "nod: o servidor do nod não confirmou esta chamada" });
  });

  it("ferramenta MCP do nod passa sem ir ao servidor: quem decide é o proxy", async () => {
    const antes = confirmadas.length;
    const r = await decidirHook(evento("mcp__nod__publicar_artefato", { titulo: "x", html: "<p>x</p>" }), cfg, confirmar);
    expect(r.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(confirmadas).toHaveLength(antes);
  });

  it("evento malformado nega", async () => {
    expect((await decidirHook(null, cfg, confirmar)).hookSpecificOutput.permissionDecision).toBe("deny");
  });
});

describe("args do turno com o kit do terminal (ADR-052)", () => {
  const settings = settingsDoTerminal({ comandoHook: comandoDoHook({ nodePath: "/usr/bin/node", hookPath: "/app/Application Support/hook.mjs", config: "/tmp/t/hook.json" }), permitidas: ["/Users/m/nod/Ada", "/Users/m/code/nod"] });
  const { args } = montarArgs({ plano: { ...planoDeTeste(), nativas: NATIVAS_DO_TERMINAL, pastaDoBot: "Ada" }, mcpJson: "/tmp/mcp.json", terminal: { settings, dirsExtras: ["/Users/m/code/nod"] } });

  it("sem --restricted (ele tira Bash e WebFetch); --tools com a lista exata; pastas extras em --add-dir", () => {
    expect(args).not.toContain("--restricted");
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("project");
    expect(args[args.indexOf("--tools") + 1]!.split(",")).toEqual([...NATIVAS_DO_TERMINAL, "ToolSearch"]);
    expect(args[args.indexOf("--allowedTools") + 1]!.split(",")).toEqual(expect.arrayContaining(["Bash", "WebFetch", "Write"]));
    expect(args.filter((a, i) => args[i - 1] === "--add-dir")).toEqual(["/Users/m/code/nod"]);
  });

  it("--settings leva o hook do nod para cada nativa e o sandbox sem rede e sem escape", () => {
    const s = JSON.parse(args[args.indexOf("--settings") + 1]!) as { hooks: { PreToolUse: { matcher: string; hooks: { command: string }[] }[] }; sandbox: Record<string, unknown> };
    // Só as nativas: MCP passa pelo proxy (com "*", o hook negava publicar_artefato — medido ao vivo).
    expect(s.hooks.PreToolUse[0]?.matcher).toBe("Read|Edit|Write|Glob|Grep|NotebookEdit|Bash|WebFetch|WebSearch");
    expect(s.hooks.PreToolUse[0]?.hooks[0]?.command).toBe("'/usr/bin/node' '/app/Application Support/hook.mjs' '/tmp/t/hook.json'");
    expect(s.sandbox).toMatchObject({ enabled: true, allowUnsandboxedCommands: false, filesystem: { allowWrite: ["/Users/m/nod/Ada", "/Users/m/code/nod"] }, network: { allowedDomains: [] } });
  });

  it("aspas simples no caminho não quebram o comando do hook", () => {
    expect(comandoDoHook({ nodePath: "/n", hookPath: "/a/it's/h.mjs", config: "/c", electronComoNode: true })).toBe("ELECTRON_RUN_AS_NODE=1 '/n' '/a/it'\\''s/h.mjs' '/c'");
  });
});
