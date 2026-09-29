import { describe, expect, it } from "vitest";
import { comandoDoHook, montarArgs, settingsDoTerminal, TETO_HOOK_S } from "../../../src/adapters/executor/drivers/claude-cli.ts";
import { AINDA_ESPERANDO, confirmarNoServidor, decidirHook, type Confirmar } from "../../../src/adapters/executor/hook-nativas.ts";
import { NATIVAS_DO_TERMINAL } from "../../../src/domain/nativas.ts";
import { ESPERA_APROVACAO_NO_TURNO_MS } from "../../../src/shared/constantes.ts";
import { planoDeTeste } from "../../helpers/l5.ts";

const evento = (tool_name: string, tool_input: Record<string, unknown>) => ({ tool_name, tool_input, cwd: "/Users/m/nod/Ada" });

describe("hook do nod (ADR-052, revisto pela ADR-055)", () => {
  const pedidos: Parameters<Confirmar>[0][] = [];
  const confirmar: Confirmar = async (p) => {
    pedidos.push(p);
    return { permitir: true };
  };

  it("arquivo em qualquer lugar do Mac passa e é confirmado no servidor", async () => {
    const r = await decidirHook(evento("Write", { file_path: "/Users/m/Inhouse/leapy/src/x.ts" }), confirmar);
    expect(r.hookSpecificOutput.permissionDecision).toBe("allow");
    expect(pedidos.at(-1)).toEqual({ ferramenta: "Write", contamina: false });
  });

  it("Bash leva o comando ao servidor, e a negação dele volta ao modelo com o motivo", async () => {
    await decidirHook(evento("Bash", { command: "git push" }), confirmar);
    expect(pedidos.at(-1)).toEqual({ ferramenta: "Bash", contamina: false, comando: "git push" });
    const r = await decidirHook(evento("Bash", { command: "git push" }), async () => ({ permitir: false, motivo: "a pessoa não aprovou este comando" }));
    expect(r.hookSpecificOutput).toMatchObject({ permissionDecision: "deny", permissionDecisionReason: "nod: a pessoa não aprovou este comando" });
  });

  it("web é confirmada como contaminante; ferramenta MCP passa sem ir ao servidor; evento malformado nega", async () => {
    await decidirHook(evento("WebFetch", { url: "https://example.com" }), confirmar);
    expect(pedidos.at(-1)).toEqual({ ferramenta: "WebFetch", contamina: true });
    const antes = pedidos.length;
    expect((await decidirHook(evento("mcp__nod__publicar_artefato", { titulo: "x" }), confirmar)).hookSpecificOutput.permissionDecision).toBe("allow");
    expect(pedidos).toHaveLength(antes);
    expect((await decidirHook(null, confirmar)).hookSpecificOutput.permissionDecision).toBe("deny");
  });
});

/** Servidor falso: responde às rotas que o hook chama, em ordem, e guarda o que foi pedido. */
function servidor(respostas: Record<string, (unknown | ((corpo: unknown) => unknown))[]>) {
  const chamadas: { rota: string; corpo: unknown }[] = [];
  const f: typeof fetch = async (url, init) => {
    const rota = String(url).replace("http://nod", "");
    const corpo = init?.body ? (JSON.parse(String(init.body)) as unknown) : null;
    chamadas.push({ rota, corpo });
    const fila = respostas[rota] ?? [];
    const proxima = fila.length > 1 ? fila.shift() : fila[0];
    const valor = typeof proxima === "function" ? (proxima as (c: unknown) => unknown)(corpo) : proxima;
    const status = typeof valor === "object" && valor !== null && "status" in valor ? Number((valor as { status: number }).status) : 200;
    return new Response(JSON.stringify(valor), { status });
  };
  return { f, chamadas };
}

describe("a espera pela aprovação no próprio turno (ADR-055)", () => {
  const cfg = { url: "http://nod/", token: "tok" };
  const AGUARDAR = "/api/interno/decisoes/d1/aguardar";

  it("leitura: uma chamada, liberada", async () => {
    const s = servidor({ "/api/interno/nativas": [{ ok: true }] });
    expect(await confirmarNoServidor(cfg, { fetch: s.f })({ ferramenta: "Bash", contamina: false, comando: "git status" })).toEqual({ permitir: true });
    expect(s.chamadas).toEqual([{ rota: "/api/interno/nativas", corpo: { ferramenta: "Bash", contamina: false, comando: "git status" } }]);
  });

  it("card aprovado: espera em fatias, confirma de novo e libera", async () => {
    const s = servidor({ "/api/interno/nativas": [{ aguardar: "d1" }, { ok: true }], [AGUARDAR]: [{ estado: "pendente" }, { estado: "decidida", itens: [{ desfecho: "executado" }] }] });
    expect(await confirmarNoServidor(cfg, { fetch: s.f })({ ferramenta: "Bash", contamina: false, comando: "git push" })).toEqual({ permitir: true });
    expect(s.chamadas.map((c) => c.rota)).toEqual(["/api/interno/nativas", AGUARDAR, AGUARDAR, "/api/interno/nativas"]);
  });

  it("card recusado: nega com o motivo", async () => {
    const s = servidor({ "/api/interno/nativas": [{ aguardar: "d1" }], [AGUARDAR]: [{ estado: "decidida", itens: [{ desfecho: "retirado_pela_pessoa" }] }] });
    expect(await confirmarNoServidor(cfg, { fetch: s.f })({ ferramenta: "Bash", contamina: false, comando: "rm -rf x" })).toEqual({ permitir: false, motivo: "a pessoa não aprovou este comando" });
  });

  it("a espera acaba sem resposta: nega dizendo que o pedido continua na conversa", async () => {
    let agora = 0;
    const s = servidor({ "/api/interno/nativas": [{ aguardar: "d1" }], [AGUARDAR]: [() => { agora += 60_000; return { estado: "pendente" }; }] });
    expect(await confirmarNoServidor(cfg, { fetch: s.f, agora: () => agora })({ ferramenta: "Bash", contamina: false, comando: "npm install" })).toEqual({ permitir: false, motivo: AINDA_ESPERANDO });
    expect(s.chamadas.filter((c) => c.rota === AGUARDAR).length).toBe(Math.ceil(ESPERA_APROVACAO_NO_TURNO_MS / 60_000));
  });

  it("o servidor recusa: a mensagem dele vai ao modelo", async () => {
    const s = servidor({ "/api/interno/nativas": [{ status: 403, codigo: "nao_permitido", mensagem: "ferramenta nativa fora do plano deste turno" }] });
    expect(await confirmarNoServidor(cfg, { fetch: s.f })({ ferramenta: "Bash", contamina: false, comando: "ls" })).toEqual({ permitir: false, motivo: "ferramenta nativa fora do plano deste turno" });
  });
});

describe("args do turno com o kit do terminal (ADR-052, revisto pela ADR-055)", () => {
  const settings = settingsDoTerminal({ comandoHook: comandoDoHook({ nodePath: "/usr/bin/node", hookPath: "/app/Application Support/hook.mjs", config: "/tmp/t/hook.json" }) });
  const { args } = montarArgs({ plano: { ...planoDeTeste(), nativas: NATIVAS_DO_TERMINAL, pastaDoBot: "Ada" }, mcpJson: "/tmp/mcp.json", terminal: { settings, dirsExtras: ["/Users/m", "/Users/m/code/nod"] } });

  it("sem --restricted (ele tira Bash e WebFetch); --tools com a lista exata; o Mac da pessoa em --add-dir", () => {
    expect(args).not.toContain("--restricted");
    expect(args[args.indexOf("--setting-sources") + 1]).toBe("project");
    expect(args[args.indexOf("--tools") + 1]!.split(",")).toEqual([...NATIVAS_DO_TERMINAL, "ToolSearch"]);
    expect(args[args.indexOf("--allowedTools") + 1]!.split(",")).toEqual(expect.arrayContaining(["Bash", "WebFetch", "Write"]));
    expect(args.filter((a, i) => args[i - 1] === "--add-dir")).toEqual(["/Users/m", "/Users/m/code/nod"]);
  });

  it("--settings leva o hook do nod para cada nativa, SEM sandbox, com tempo para esperar a aprovação", () => {
    const s = JSON.parse(args[args.indexOf("--settings") + 1]!) as { hooks: { PreToolUse: { matcher: string; hooks: { command: string; timeout: number }[] }[] }; sandbox?: unknown };
    // Só as nativas: MCP passa pelo proxy (com "*", o hook negava publicar_artefato — medido ao vivo).
    expect(s.hooks.PreToolUse[0]?.matcher).toBe("Read|Edit|Write|Glob|Grep|NotebookEdit|Bash|WebFetch|WebSearch|Skill|Agent|TaskCreate|TaskGet|TaskList|TaskUpdate");
    expect(s.hooks.PreToolUse[0]?.hooks[0]?.command).toBe("'/usr/bin/node' '/app/Application Support/hook.mjs' '/tmp/t/hook.json'");
    expect(s.sandbox).toBeUndefined();
    expect(s.hooks.PreToolUse[0]?.hooks[0]?.timeout).toBe(TETO_HOOK_S);
    expect(TETO_HOOK_S * 1000).toBeGreaterThan(ESPERA_APROVACAO_NO_TURNO_MS);
  });

  it("aspas simples no caminho não quebram o comando do hook", () => {
    expect(comandoDoHook({ nodePath: "/n", hookPath: "/a/it's/h.mjs", config: "/c", electronComoNode: true })).toBe("ELECTRON_RUN_AS_NODE=1 '/n' '/a/it'\\''s/h.mjs' '/c'");
  });
});
