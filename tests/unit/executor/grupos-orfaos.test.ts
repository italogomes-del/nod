import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  arquivoDeGruposDoServidor,
  encerrarGruposOrfaos,
  gravarArquivoDeGrupos,
  lerArquivoDeGrupos,
  lerSaidaDoPs,
  sobrasDoRegistro,
  type GrupoRegistrado,
  type ProcessoDoSistema,
} from "../../../src/adapters/executor/grupos-orfaos.ts";

/**
 * ADR-089 (#217): os grupos dos turnos que sobreviveram ao nod (SIGKILL, queda) morrem no boot seguinte — só os que ainda
 * são os processos anotados. medido em 2026-10-08 (processo-grupo.test.ts): filho e neto de verdade custam 0,8–1,9 s por
 * caso com o Mac carregado; as esperas vão a 20 s, abaixo dos 300 s do `sleep` do neto.
 */
const ESPERA_MS = 20_000;
vi.setConfig({ testTimeout: 4 * ESPERA_MS });

const dir = mkdtempSync(join(tmpdir(), "nod-grupos-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const vivo = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const esperarAte = async (cond: () => boolean, ms = ESPERA_MS) => {
  const fim = Date.now() + ms;
  while (!cond() && Date.now() < fim) await new Promise((r) => setTimeout(r, 20));
  return cond();
};

const T0 = new Date(2026, 9, 9, 2, 34, 24).getTime();
const grupo = (pid: number, programa = "claude"): GrupoRegistrado => ({ pid, desdeMs: T0 + 300, ateMs: T0 + 900, programa });
const proc = (pid: number, pgid: number, inicioMs: number, comando: string): ProcessoDoSistema => ({ pid, pgid, inicioMs, comando });

describe("quais grupos anotados são sobras (puro)", () => {
  it("lê o ps com LC_ALL=C", () => {
    const saida = "  501   501 Fri Oct  9 02:34:24 2026     /Users/m/.local/bin/claude -p --output-format stream-json\n  77  1 Thu Oct  8 21:40:01 2026 sleep 30\nlixo\n";
    expect(lerSaidaDoPs(saida)).toEqual([
      { pid: 501, pgid: 501, inicioMs: T0, comando: "/Users/m/.local/bin/claude -p --output-format stream-json" },
      { pid: 77, pgid: 1, inicioMs: new Date(2026, 9, 8, 21, 40, 1).getTime(), comando: "sleep 30" },
    ]);
  });

  it("líder vivo que é o processo anotado: o grupo inteiro é sobra", () => {
    const ps = [proc(501, 501, T0, "node /Users/m/.local/bin/claude -p"), proc(502, 501, T0 + 2_000, "/bin/bash -c while :; do gh run list; sleep 30; done"), proc(503, 501, T0 + 9_000, "sleep 30")];
    expect(sobrasDoRegistro([grupo(501)], ps)).toEqual([{ pgid: 501, programa: "claude", membros: 3, lider: true, desdeMs: T0 + 300 }]);
  });

  it("pid reaproveitado não é tocado: início fora do spawn, outro programa, ou não é mais líder do grupo", () => {
    expect(sobrasDoRegistro([grupo(501)], [proc(501, 501, T0 + 3_600_000, "node /Users/m/.local/bin/claude -p")])).toEqual([]);
    expect(sobrasDoRegistro([grupo(501)], [proc(501, 501, T0, "/Applications/Safari.app/Contents/MacOS/Safari")])).toEqual([]);
    expect(sobrasDoRegistro([grupo(501)], [proc(501, 77, T0, "claude -p")])).toEqual([]);
    // o próprio Claude Code da pessoa, nascido depois, com o mesmo pid
    expect(sobrasDoRegistro([grupo(501)], [proc(501, 501, T0 + 60_000, "claude")])).toEqual([]);
  });

  it("líder morto com o `while … sleep` ainda no grupo: os membros são sobra; membro mais velho que o grupo, não", () => {
    expect(sobrasDoRegistro([grupo(501)], [proc(502, 501, T0 + 2_000, "/bin/bash -c while :; do sleep 30; done")])).toEqual([{ pgid: 501, programa: "claude", membros: 1, lider: false, desdeMs: T0 + 300 }]);
    expect(sobrasDoRegistro([grupo(501)], [proc(502, 501, T0 - 60_000, "bash")])).toEqual([]);
    expect(sobrasDoRegistro([grupo(501)], [])).toEqual([]);
  });

  it("o dono anotado ainda vivo (outra cópia da mesma instância): nada é morto e o arquivo fica com ele", async () => {
    const arquivo = join(dir, "dono-vivo.json");
    gravarArquivoDeGrupos(arquivo, { dono: { pid: 900, inicioMs: T0 }, grupos: [grupo(501)] });
    const mortos: number[] = [];
    const r = await encerrarGruposOrfaos({ arquivo, pidAtual: 1_000, matar: (g) => mortos.push(g), listar: async () => [proc(900, 900, T0 + 400, "node server.ts"), proc(501, 501, T0, "claude -p")] });
    expect(r).toEqual({ assumiu: false, encerrados: [] });
    expect(mortos).toEqual([]);
  });

  it("sem ps, nada é morto", async () => {
    const arquivo = join(dir, "sem-ps.json");
    gravarArquivoDeGrupos(arquivo, { dono: null, grupos: [grupo(501)] });
    const mortos: number[] = [];
    expect(await encerrarGruposOrfaos({ arquivo, matar: (g) => mortos.push(g), listar: async () => null })).toEqual({ assumiu: true, encerrados: [] });
    expect(mortos).toEqual([]);
  });

  it("um arquivo por instância: banco ou porta diferentes, arquivos diferentes; a senha não aparece no nome", () => {
    const diario = arquivoDeGruposDoServidor("/h/.nod", { DATABASE_URL: "postgres://nod_app:segredo@127.0.0.1:5434/nod", NOD_API_PORT: "8888" });
    const temporaria = arquivoDeGruposDoServidor("/h/.nod", { DATABASE_URL: "postgres://nod_app:segredo@127.0.0.1:5435/nod", NOD_API_PORT: "8889" });
    const outraPorta = arquivoDeGruposDoServidor("/h/.nod", { DATABASE_URL: "postgres://nod_app:segredo@127.0.0.1:5434/nod", NOD_API_PORT: "8897" });
    expect(new Set([diario, temporaria, outraPorta]).size).toBe(3);
    expect(diario).toMatch(/^\/h\/\.nod\/grupos-vivos\/servidor-[0-9a-f]{16}\.json$/);
    expect(diario).not.toContain("segredo");
  });
});

describe("religar o servidor por SIGKILL (de verdade)", () => {
  it("o boot seguinte mata o grupo registrado, e um pid de outro programa não é tocado", async () => {
    const arquivo = join(dir, "servidor.json");
    const script = fileURLToPath(new URL("../../fixtures/servidor-com-grupos.ts", import.meta.url));
    const servidor = spawn(process.execPath, [script, arquivo], { stdio: ["ignore", "pipe", "pipe"] });
    let saida = "";
    servidor.stdout.setEncoding("utf8");
    servidor.stdout.on("data", (d: string) => (saida += d));
    expect(await esperarAte(() => /bot \d+ neto \d+/.test(saida))).toBe(true);
    const [, botTexto, netoTexto] = /bot (\d+) neto (\d+)/.exec(saida)!;
    const bot = Number(botTexto);
    const neto = Number(netoTexto);

    // SIGKILL: o `exit` não roda e o bot fica órfão, com o neto — o caso medido em 09/10.
    const saiu = new Promise((r) => servidor.on("exit", r));
    servidor.kill("SIGKILL");
    await saiu;
    expect(vivo(bot)).toBe(true);
    expect(vivo(neto)).toBe(true);
    expect(lerArquivoDeGrupos(arquivo).grupos.map((g) => g.pid)).toEqual([bot]);

    // Um programa qualquer, vivo e líder do próprio grupo, anotado como se fosse um grupo antigo do nod (o pid que o
    // sistema reaproveitou): o início não bate com o spawn anotado.
    const alheio = spawn("sleep", ["300"], { stdio: "ignore", detached: true });
    const alheioPid = alheio.pid!;
    try {
      const anotado = lerArquivoDeGrupos(arquivo);
      gravarArquivoDeGrupos(arquivo, { ...anotado, grupos: [...anotado.grupos, { pid: alheioPid, desdeMs: Date.now() - 3_600_000, ateMs: Date.now() - 3_599_000, programa: "sleep" }] });

      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const r = await encerrarGruposOrfaos({ arquivo });
      const linhas = log.mock.calls.map((c) => String(c[0]));
      log.mockRestore();

      expect(r.assumiu).toBe(true);
      expect(r.encerrados).toEqual([expect.objectContaining({ pgid: bot, lider: true, membros: 2, programa: "node" })]);
      expect(linhas.some((l) => l.includes('"evento":"orfao_encerrado"') && l.includes(`"pgid":${bot}`))).toBe(true);
      expect(await esperarAte(() => !vivo(bot) && !vivo(neto))).toBe(true);
      expect(vivo(alheioPid)).toBe(true);
    } finally {
      try {
        process.kill(-alheioPid, "SIGKILL");
      } catch {
        // já saiu
      }
      try {
        process.kill(-bot, "SIGKILL");
      } catch {
        // já saiu
      }
    }
  });
});
