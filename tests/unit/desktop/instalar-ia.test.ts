import { execFileSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { InstalacaoDaIa } from "../../../src/contracts/estado-ia.ts";
import { ambienteDoNpm, argsNpm, classificarFalhaNpm, criarInstaladorDeIas, ESPERAS_ENTRE_TENTATIVAS_MS, linhaDoProgresso, PACOTE_DA_IA, scriptNodeDoNod, TENTATIVAS_INSTALACAO, type DepsInstalador, type ProcessoNpm } from "../../../desktop/instalar-ia.ts";
import { PISO_CLI } from "../../../src/adapters/executor/flag-floors.ts";

describe("instalar a IA com um clique (2026-10-09): as partes puras", () => {
  it("o npm instala o pacote oficial na pasta do nod, global por prefixo, com cache próprio e sem ruído", () => {
    expect(PACOTE_DA_IA["codex-cli"].pacote).toBe("@openai/codex");
    expect(PACOTE_DA_IA["claude-cli"].pacote).toBe("@anthropic-ai/claude-code");
    const codex = argsNpm("codex-cli", "/u/ferramentas", "/u/ferramentas/cache-npm");
    expect(codex).toEqual(["install", "--global", "--prefix", "/u/ferramentas", "--cache", "/u/ferramentas/cache-npm", "--no-fund", "--no-audit", "--no-update-notifier", "--loglevel=http", "@openai/codex@latest"]);
    // Só o Claude Code tem script de instalação (põe o binário nativo no lugar), e ele é permitido pelo nome.
    expect(argsNpm("claude-cli", "/p", "/c")).toContain("--allow-scripts=@anthropic-ai/claude-code");
    expect(argsNpm("claude-cli", "/p", "/c").at(-1)).toBe("@anthropic-ai/claude-code@latest");
    expect(codex.some((a) => a.includes("sudo"))).toBe(false);
  });

  it("o ambiente do npm: sem npm_config_* herdado nem NODE_OPTIONS, com o Electron como node e o PATH dado", () => {
    const env = ambienteDoNpm({ HOME: "/h", npm_config_prefix: "/outro/projeto", NPM_CONFIG_GLOBAL: "false", NODE_OPTIONS: "--require x", PATH: "/velho" }, "/novo:/usr/bin");
    expect(env).toEqual({ HOME: "/h", PATH: "/novo:/usr/bin", ELECTRON_RUN_AS_NODE: "1", npm_config_update_notifier: "false" });
  });

  it("o node do nod é um script de shell que chama o Electron como node, com o caminho entre aspas (espaços e aspas simples)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "nod-node-do-nod-"));
    try {
      // Um "Electron" de mentira que prova os argumentos e a variável que recebeu.
      const falso = join(dir, "App d'O nod", "nod");
      await mkdir(join(dir, "App d'O nod"));
      await writeFile(falso, "#!/bin/sh\necho \"RUN_AS_NODE=$ELECTRON_RUN_AS_NODE args=$*\"\n");
      await chmod(falso, 0o755);
      const shim = join(dir, "node");
      await writeFile(shim, scriptNodeDoNod(falso), { mode: 0o755 });
      expect(execFileSync(shim, ["script.js", "--version"], { encoding: "utf8" }).trim()).toBe("RUN_AS_NODE=1 args=script.js --version");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("a linha de progresso é a última linha não vazia, sem cor e cortada em 160", () => {
    expect(linhaDoProgresso("npm http fetch GET 200 https://registry.npmjs.org/@openai%2fcodex 545ms\n\n")).toBe("npm http fetch GET 200 https://registry.npmjs.org/@openai%2fcodex 545ms");
    expect(linhaDoProgresso("\u001b[32madded 2 packages in 9s\u001b[0m\r\n")).toBe("added 2 packages in 9s");
    expect(linhaDoProgresso("\n  \n")).toBeNull();
    expect(linhaDoProgresso("x".repeat(300))!.length).toBe(160);
  });

  it("a causa vem do código de erro do npm; só falha de rede (e 5xx do registro) é passageira", () => {
    expect(classificarFalhaNpm("npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org failed")).toEqual({ causa: "sem_internet", passageira: true });
    expect(classificarFalhaNpm("npm error code ETIMEDOUT")).toEqual({ causa: "sem_internet", passageira: true });
    expect(classificarFalhaNpm("npm error code ECONNRESET")).toEqual({ causa: "sem_internet", passageira: true });
    expect(classificarFalhaNpm("npm error code E503\n503 Service Unavailable")).toEqual({ causa: "falhou", passageira: true });
    expect(classificarFalhaNpm("npm error code ENOSPC\nno space left on device")).toEqual({ causa: "sem_espaco", passageira: false });
    expect(classificarFalhaNpm("npm error code EACCES\npermission denied, mkdir '/x'")).toEqual({ causa: "sem_permissao", passageira: false });
    expect(classificarFalhaNpm("npm error code E404\n404 Not Found - GET https://registry.npmjs.org/@openai%2fcodexx")).toEqual({ causa: "pacote_indisponivel", passageira: false });
    expect(classificarFalhaNpm("npm error code ETARGET\nNo matching version found")).toEqual({ causa: "pacote_indisponivel", passageira: false });
    expect(classificarFalhaNpm("env: node: No such file or directory")).toEqual({ causa: "sem_npm", passageira: false });
    expect(classificarFalhaNpm("algo estranho")).toEqual({ causa: "falhou", passageira: false });
  });
});

/** Um npm de mentira por roteiro: cada tentativa diz o que imprime e com que código sai. */
type Tentativa = { saida: string[]; codigo: number | null; segura?: true };
function instalador(o: { roteiro: Tentativa[]; versao?: { codigo: number | null; saida: string }; semNpm?: true }) {
  const m = {
    rodadas: 0,
    args: [] as string[][],
    mudancas: [] as InstalacaoDaIa[],
    registro: "",
    fechado: false,
    instaladas: [] as string[],
    esperas: [] as number[],
    eventos: [] as string[],
    versoes: [] as string[],
    mortos: 0,
    soltar: null as (() => void) | null,
  };
  const deps: DepsInstalador = {
    rodarNpm: async (args) => {
      if (o.semNpm) return null;
      m.args.push(args);
      const t = o.roteiro[Math.min(m.rodadas, o.roteiro.length - 1)]!;
      m.rodadas++;
      let ouvinte: ((s: string) => void) | null = null;
      let sair!: (r: { codigo: number | null }) => void;
      const fim = new Promise<{ codigo: number | null }>((r) => { sair = r; });
      const p: ProcessoNpm = {
        aoSair: (fn) => {
          ouvinte = fn;
          for (const s of t.saida) ouvinte(s);
          if (t.segura) m.soltar = () => sair({ codigo: null });
          else sair({ codigo: t.codigo });
        },
        fim,
        matar: async () => { m.mortos++; m.soltar?.(); },
      };
      return p;
    },
    versao: async (binario) => { m.versoes.push(binario); return o.versao ?? { codigo: 0, saida: `codex-cli ${PISO_CLI["codex-cli"]}\n` }; },
    prefixo: "/u/ferramentas",
    cache: "/u/ferramentas/cache-npm",
    abrirRegistro: async (ia) => ({ nome: `instalar-${ia}-x.log`, escrever: (t) => { m.registro += t; }, fechar: async () => { m.fechado = true; } }),
    aoMudar: (_ia, i) => { m.mudancas.push(i); },
    aoInstalar: (ia) => { m.instaladas.push(ia); },
    esperar: async (ms) => { m.esperas.push(ms); },
    agora: () => 1_800_000_000_000,
    registrar: (ev) => { m.eventos.push(ev); },
  };
  return { m, inst: criarInstaladorDeIas(deps) };
}

describe("instalar a IA com um clique: o fluxo", () => {
  it("sucesso: a linha de progresso chega ao vivo, o binário responde com versão no piso e a vigia é avisada", async () => {
    const { m, inst } = instalador({ roteiro: [{ saida: ["npm http fetch GET 200 https://registry.npmjs.org/@openai%2fcodex 545ms\n", "added 2 packages in 9s\n"], codigo: 0 }] });
    const r = await inst.instalar("codex-cli");
    expect(r).toMatchObject({ fase: "sucesso", versao: PISO_CLI["codex-cli"], tentativa: 1, registro: "instalar-codex-cli-x.log" });
    expect(m.mudancas.map((x) => [x.fase, x.linha])).toEqual([
      ["instalando", null],
      ["instalando", "npm http fetch GET 200 https://registry.npmjs.org/@openai%2fcodex 545ms"],
      ["instalando", "added 2 packages in 9s"],
      ["sucesso", null],
    ]);
    expect(m.versoes).toEqual(["/u/ferramentas/bin/codex"]);
    expect(m.instaladas).toEqual(["codex-cli"]);
    expect(m.registro).toContain("added 2 packages");
    expect(m.registro).toContain("# --version:");
    expect(m.fechado).toBe(true);
    expect(inst.estado("codex-cli")?.fase).toBe("sucesso");
  });

  it("falha passageira de rede: tenta de novo (até 3 vezes, esperando 2 s e 5 s) e para no primeiro sucesso", async () => {
    const rede: Tentativa = { saida: ["npm error code ECONNRESET\n"], codigo: 1 };
    const { m, inst } = instalador({ roteiro: [rede, rede, { saida: ["added 2 packages\n"], codigo: 0 }] });
    expect((await inst.instalar("codex-cli")).fase).toBe("sucesso");
    expect(m.rodadas).toBe(3);
    expect(m.esperas).toEqual([...ESPERAS_ENTRE_TENTATIVAS_MS]);
    expect(m.mudancas.filter((x) => x.fase === "instalando" && x.linha === null).map((x) => x.tentativa)).toEqual([1, 2, 3]);
  });

  it("sem internet de vez: desiste depois de 3 tentativas com a causa legível; o texto cru fica só no registro", async () => {
    const { m, inst } = instalador({ roteiro: [{ saida: ["npm error code ENOTFOUND\nnpm error getaddrinfo ENOTFOUND registry.npmjs.org\n"], codigo: 1 }] });
    const r = await inst.instalar("codex-cli");
    expect(r).toMatchObject({ fase: "falhou", causa: "sem_internet", tentativa: TENTATIVAS_INSTALACAO });
    expect(r.mensagem).toBe("Não foi possível baixar o Codex. Confira a internet e tente de novo.");
    expect(r.mensagem).not.toContain("ENOTFOUND");
    expect(m.registro).toContain("getaddrinfo ENOTFOUND");
    expect(m.instaladas).toEqual([]);
  });

  it("falha que não é de rede (sem espaço, sem permissão) não tenta de novo", async () => {
    const a = instalador({ roteiro: [{ saida: ["npm error code ENOSPC\n"], codigo: 1 }] });
    expect(await a.inst.instalar("claude-cli")).toMatchObject({ fase: "falhou", causa: "sem_espaco", tentativa: 1 });
    expect(a.m.rodadas).toBe(1);
    const b = instalador({ roteiro: [{ saida: ["npm error code EACCES\n"], codigo: 243 }] });
    expect(await b.inst.instalar("claude-cli")).toMatchObject({ fase: "falhou", causa: "sem_permissao" });
  });

  it("o npm saiu com 0, mas o binário não responde (ou ficou abaixo do piso): falhou, nunca 'instalado'", async () => {
    const a = instalador({ roteiro: [{ saida: [], codigo: 0 }], versao: { codigo: 127, saida: "env: node: No such file or directory" } });
    expect(await a.inst.instalar("codex-cli")).toMatchObject({ fase: "falhou", causa: "verificacao_falhou" });
    expect(a.m.instaladas).toEqual([]);
    const b = instalador({ roteiro: [{ saida: [], codigo: 0 }], versao: { codigo: 0, saida: "codex-cli 0.1.0" } });
    expect(await b.inst.instalar("codex-cli")).toMatchObject({ fase: "falhou", causa: "verificacao_falhou" });
  });

  it("sem npm (nem o do app nem o do Mac): falhou com sem_npm, sem rodar nada", async () => {
    const { inst } = instalador({ roteiro: [], semNpm: true });
    expect(await inst.instalar("codex-cli")).toMatchObject({ fase: "falhou", causa: "sem_npm" });
  });

  it("clicar duas vezes não instala duas vezes: a segunda chamada recebe a mesma instalação", async () => {
    const { m, inst } = instalador({ roteiro: [{ saida: ["added\n"], codigo: 0, segura: true }] });
    const a = inst.instalar("codex-cli");
    const b = inst.instalar("codex-cli");
    expect(b).toBe(a);
    await new Promise((r) => setTimeout(r, 0));
    m.soltar!();
    await a;
    expect(m.rodadas).toBe(1);
  });

  it("cancelar mata o npm e termina como cancelado, sem tentar de novo", async () => {
    const { m, inst } = instalador({ roteiro: [{ saida: ["npm http fetch GET 200 x\n"], codigo: null, segura: true }] });
    const p = inst.instalar("codex-cli");
    await new Promise((r) => setTimeout(r, 0));
    expect(await inst.cancelar("codex-cli")).toBe(true);
    expect(await p).toMatchObject({ fase: "cancelado" });
    expect(m.mortos).toBe(1);
    expect(m.rodadas).toBe(1);
    expect(await inst.cancelar("codex-cli")).toBe(false);
  });
});
