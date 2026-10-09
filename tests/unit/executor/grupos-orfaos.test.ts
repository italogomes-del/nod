import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it, vi } from "vitest";
import {
  ambientesDosProcessos,
  arquivoDeGruposDoServidor,
  candidatosDoRegistro,
  encerrarGruposOrfaos,
  gravarArquivoDeGrupos,
  lerArquivoDeGrupos,
  lerSaidaDoPs,
  temAMarca,
  type GrupoRegistrado,
  type ProcessoDoSistema,
} from "../../../src/adapters/executor/grupos-orfaos.ts";

/**
 * ADR-089 (#217): os grupos dos turnos que sobreviveram ao nod (SIGKILL, queda) morrem no boot seguinte — só os provados
 * nossos pela marca NOD_GRUPO num processo vivo do grupo. medido em 2026-10-08 (processo-grupo.test.ts): filho e neto de
 * verdade custam 0,8–1,9 s por caso com o Mac carregado; as esperas vão a 20 s, abaixo dos 300 s de vida do neto.
 */
const ESPERA_MS = 20_000;
vi.setConfig({ testTimeout: 6 * ESPERA_MS });

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
const matarGrupo = (pgid: number) => {
  try {
    process.kill(-pgid, "SIGKILL");
  } catch {
    // já saiu
  }
};

const T0 = new Date(2026, 9, 9, 2, 34, 24).getTime();
const BOOT = T0 - 86_400_000;
const grupo = (pid: number, extra: Partial<GrupoRegistrado> = {}): GrupoRegistrado => ({ pid, desdeMs: T0 + 300, ateMs: T0 + 900, programa: "claude", marca: "ab12cd34-0011aa", ...extra });
const proc = (pid: number, pgid: number, inicioMs: number, comando: string): ProcessoDoSistema => ({ pid, pgid, inicioMs, comando });

describe("quais grupos anotados são candidatos (puro)", () => {
  it("lê o ps com LC_ALL=C", () => {
    const saida = "  501   501 Fri Oct  9 02:34:24 2026     /Users/m/.local/bin/claude -p --output-format stream-json\n  77  1 Thu Oct  8 21:40:01 2026 sleep 30\nlixo\n";
    expect(lerSaidaDoPs(saida)).toEqual([
      { pid: 501, pgid: 501, inicioMs: T0, comando: "/Users/m/.local/bin/claude -p --output-format stream-json" },
      { pid: 77, pgid: 1, inicioMs: new Date(2026, 9, 8, 21, 40, 1).getTime(), comando: "sleep 30" },
    ]);
  });

  it("a marca é a palavra exata NOD_GRUPO=<marca> no ambiente", () => {
    expect(temAMarca("node x PATH=/bin NOD_GRUPO=ab12cd34-0011aa HOME=/h", "ab12cd34-0011aa")).toBe(true);
    expect(temAMarca("node x NOD_GRUPO=ab12cd34-0011aabb", "ab12cd34-0011aa")).toBe(false);
    expect(temAMarca(undefined, "ab12cd34-0011aa")).toBe(false);
    expect(temAMarca("NOD_GRUPO=", "")).toBe(false);
  });

  it("líder vivo que bate com o spawn anotado: candidato, com o líder a conferir", () => {
    const ps = [proc(501, 501, T0, "node /Users/m/.local/bin/claude -p"), proc(502, 501, T0 + 2_000, "/bin/bash -c while :; do gh run list; sleep 30; done")];
    expect(candidatosDoRegistro([grupo(501)], ps, BOOT)).toEqual([{ pgid: 501, programa: "claude", marca: "ab12cd34-0011aa", membros: 2, lider: true, desdeMs: T0 + 300, verificar: [501] }]);
  });

  it("pid reaproveitado não é candidato: início fora do spawn, outro programa, ou não é mais líder do grupo", () => {
    expect(candidatosDoRegistro([grupo(501)], [proc(501, 501, T0 + 3_600_000, "node /Users/m/.local/bin/claude -p")], BOOT)).toEqual([]);
    expect(candidatosDoRegistro([grupo(501)], [proc(501, 501, T0, "/Applications/Safari.app/Contents/MacOS/Safari")], BOOT)).toEqual([]);
    expect(candidatosDoRegistro([grupo(501)], [proc(501, 77, T0, "claude -p")], BOOT)).toEqual([]);
    expect(candidatosDoRegistro([grupo(501)], [proc(501, 501, T0 + 60_000, "claude")], BOOT)).toEqual([]);
  });

  it("revisão do #223: anotação de antes do boot da máquina, ou sem marca, é descartada", () => {
    const ps = [proc(501, 501, T0, "claude -p")];
    expect(candidatosDoRegistro([grupo(501)], ps, T0 + 1_000)).toEqual([]);
    expect(candidatosDoRegistro([grupo(501, { marca: "" })], ps, BOOT)).toEqual([]);
  });

  it("líder morto: candidato só com o boot conhecido e todos os membros nascidos depois do spawn", () => {
    const resto = [proc(502, 501, T0 + 2_000, "/bin/bash -c while :; do sleep 30; done"), proc(503, 501, T0 + 2_500, "node mcp-proxy")];
    expect(candidatosDoRegistro([grupo(501)], resto, BOOT)).toEqual([{ pgid: 501, programa: "claude", marca: "ab12cd34-0011aa", membros: 2, lider: false, desdeMs: T0 + 300, verificar: [502, 503] }]);
    expect(candidatosDoRegistro([grupo(501)], resto, null)).toEqual([]);
    expect(candidatosDoRegistro([grupo(501)], [proc(502, 501, T0 - 60_000, "bash")], BOOT)).toEqual([]);
    expect(candidatosDoRegistro([grupo(501)], [], BOOT)).toEqual([]);
  });

  it("revisão do #223: um grupo alheio com líder morto e sem a marca nunca é morto", async () => {
    const arquivo = join(dir, "alheio.json");
    gravarArquivoDeGrupos(arquivo, { dono: null, grupos: [grupo(501)] });
    const mortos: number[] = [];
    const r = await encerrarGruposOrfaos({
      arquivo,
      matar: (g) => mortos.push(g),
      boot: async () => BOOT,
      listar: async () => [proc(502, 501, T0 + 2_000, "/usr/bin/some-daemon"), proc(503, 501, T0 + 2_500, "node outro")],
      // um legível sem a marca, o outro ilegível (binário da Apple)
      ambientes: async () => new Map([[503, "node outro PATH=/bin"]]),
    });
    expect(r).toEqual({ assumiu: true, encerrados: [] });
    expect(mortos).toEqual([]);
  });

  it("com a marca num membro vivo, o grupo do líder morto é morto inteiro", async () => {
    const arquivo = join(dir, "resto.json");
    gravarArquivoDeGrupos(arquivo, { dono: null, grupos: [grupo(501)] });
    const mortos: number[] = [];
    const r = await encerrarGruposOrfaos({
      arquivo,
      matar: (g) => mortos.push(g),
      boot: async () => BOOT,
      listar: async () => [proc(502, 501, T0 + 2_000, "/bin/zsh -c while :; do sleep 30; done"), proc(503, 501, T0 + 2_500, "node mcp-proxy")],
      ambientes: async () => new Map([[503, "node mcp-proxy NOD_GRUPO=ab12cd34-0011aa"]]),
    });
    expect(r.encerrados.map((s) => [s.pgid, s.lider])).toEqual([[501, false]]);
    expect(mortos).toEqual([501]);
  });

  it("o dono anotado ainda vivo (até 60 s de diferença no início): nada é morto e o arquivo fica com ele", async () => {
    const arquivo = join(dir, "dono-vivo.json");
    gravarArquivoDeGrupos(arquivo, { dono: { pid: 900, inicioMs: T0 }, grupos: [grupo(501)] });
    const mortos: number[] = [];
    const r = await encerrarGruposOrfaos({ arquivo, pidAtual: 1_000, boot: async () => BOOT, ambientes: async () => new Map([[501, "NOD_GRUPO=ab12cd34-0011aa"]]), matar: (g) => mortos.push(g), listar: async () => [proc(900, 900, T0 + 5_000, "node server.ts"), proc(501, 501, T0, "claude -p")] });
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

/** Sobe o "servidor" da fixture, espera o bot e o neto, e o mata com SIGKILL (o `exit` não roda). */
async function servidorMortoPorSigkill(arquivo: string): Promise<{ bot: number; neto: number }> {
  const script = fileURLToPath(new URL("../../fixtures/servidor-com-grupos.ts", import.meta.url));
  const servidor: ChildProcess = spawn(process.execPath, [script, arquivo], { stdio: ["ignore", "pipe", "pipe"] });
  let saida = "";
  servidor.stdout!.setEncoding("utf8");
  servidor.stdout!.on("data", (d: string) => (saida += d));
  expect(await esperarAte(() => /bot \d+ neto \d+/.test(saida))).toBe(true);
  const [, bot, neto] = /bot (\d+) neto (\d+)/.exec(saida)!;
  const saiu = new Promise((r) => servidor.on("exit", r));
  servidor.kill("SIGKILL");
  await saiu;
  return { bot: Number(bot), neto: Number(neto) };
}

describe("religar o servidor por SIGKILL (de verdade)", () => {
  it("o boot seguinte mata o grupo registrado (marca lida no líder), e um processo de outro programa não é tocado", async () => {
    const arquivo = join(dir, "servidor.json");
    const { bot, neto } = await servidorMortoPorSigkill(arquivo);
    expect(vivo(bot)).toBe(true);
    expect(vivo(neto)).toBe(true);
    expect(lerArquivoDeGrupos(arquivo).grupos.map((g) => g.pid)).toEqual([bot]);

    // Um programa qualquer, vivo e líder do próprio grupo, anotado com início e programa que BATEM (o pior caso de pid
    // reaproveitado): sem a marca no ambiente, não morre.
    const desdeMs = Date.now();
    const alheio = spawn(process.execPath, ["-e", "setTimeout(() => {}, 300000)"], { stdio: "ignore", detached: true });
    const alheioPid = alheio.pid!;
    try {
      const anotado = lerArquivoDeGrupos(arquivo);
      gravarArquivoDeGrupos(arquivo, { ...anotado, grupos: [...anotado.grupos, { pid: alheioPid, desdeMs, ateMs: Date.now(), programa: "node", marca: "ab12cd34-ffffff" }] });

      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const r = await encerrarGruposOrfaos({ arquivo });
      const linhas = log.mock.calls.map((c) => String(c[0]));
      log.mockRestore();

      expect(r.assumiu).toBe(true);
      expect(r.encerrados).toEqual([expect.objectContaining({ pgid: bot, lider: true, membros: 2, programa: "node" })]);
      expect(linhas.some((l) => l.includes('"evento":"orfao_encerrado"') && l.includes(`"pgid":${bot}`))).toBe(true);
      expect(linhas.some((l) => l.includes('"evento":"orfao_sem_prova"') && l.includes(`"pgid":${alheioPid}`))).toBe(true);
      expect(await esperarAte(() => !vivo(bot) && !vivo(neto))).toBe(true);
      expect(vivo(alheioPid)).toBe(true);
    } finally {
      matarGrupo(alheioPid);
      matarGrupo(bot);
    }
  });

  it("líder morto depois do SIGKILL: o neto que ficou carrega a marca, e o grupo morre", async () => {
    const arquivo = join(dir, "servidor-resto.json");
    const { bot, neto } = await servidorMortoPorSigkill(arquivo);
    try {
      process.kill(bot, "SIGKILL");
      expect(await esperarAte(() => !vivo(bot))).toBe(true);
      expect(vivo(neto)).toBe(true);
      const ambiente = (await ambientesDosProcessos([neto])).get(neto);
      expect(ambiente).toContain("NOD_GRUPO=");

      const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
      const r = await encerrarGruposOrfaos({ arquivo });
      log.mockRestore();
      expect(r.encerrados).toEqual([expect.objectContaining({ pgid: bot, lider: false, membros: 1 })]);
      expect(await esperarAte(() => !vivo(neto))).toBe(true);
    } finally {
      matarGrupo(bot);
    }
  });
});
