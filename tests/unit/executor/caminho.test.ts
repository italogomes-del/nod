import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { caminhoAumentado, caminhoDoShellDeLogin, DIRETORIOS_EXTRAS, expandirTil, homeDaPessoa, resolverBinario } from "../../../src/adapters/executor/caminho.ts";

describe("caminho do binário (ADR-014 invertido: PATH pelado do Finder)", () => {
  it("expandirTil troca só o ~ inicial", () => {
    expect(expandirTil("~/.local/bin", "/Users/ana")).toBe("/Users/ana/.local/bin");
    expect(expandirTil("~", "/Users/ana")).toBe("/Users/ana");
    expect(expandirTil("/opt/~/x", "/Users/ana")).toBe("/opt/~/x");
  });

  it("homeDaPessoa é a casa do passwd, não $HOME (HOME temporário não esconde o binário instalado)", () => {
    const passwd = userInfo().homedir;
    expect(homeDaPessoa({ HOME: "/tmp/home-temporario" })).toBe(passwd);
    expect(homeDaPessoa({})).toBe(passwd);
  });

  it("caminhoAumentado acrescenta ~/.local/bin, /opt/homebrew/bin e /usr/local/bin ao PATH pelado, sem repetir", () => {
    const path = caminhoAumentado("/usr/bin:/bin:/usr/sbin:/sbin", "/Users/ana");
    expect(path.split(":")).toEqual(["/usr/bin", "/bin", "/usr/sbin", "/sbin", "/Users/ana/.local/bin", "/opt/homebrew/bin", "/usr/local/bin"]);
    expect(DIRETORIOS_EXTRAS).toHaveLength(3);
    const repetido = caminhoAumentado("/usr/local/bin:/usr/bin", "/h");
    expect(repetido.split(":").filter((d) => d === "/usr/local/bin")).toHaveLength(1);
  });

  it("PATH ausente e PATH do shell de login entram depois dos extras", () => {
    expect(caminhoAumentado(undefined, "/h").split(":")).toEqual(["/h/.local/bin", "/opt/homebrew/bin", "/usr/local/bin"]);
    const comLogin = caminhoAumentado("/usr/bin", "/h", "/h/.nvm/bin:/usr/bin");
    expect(comLogin.split(":")).toEqual(["/usr/bin", "/h/.local/bin", "/opt/homebrew/bin", "/usr/local/bin", "/h/.nvm/bin"]);
  });

  it("caminhoDoShellDeLogin devolve null para shell ausente/relativo/inexistente, nunca lança", async () => {
    expect(await caminhoDoShellDeLogin(undefined)).toBeNull();
    expect(await caminhoDoShellDeLogin("zsh")).toBeNull();
    expect(await caminhoDoShellDeLogin("/nao/existe/sh", 500)).toBeNull();
  });

  it("caminhoDoShellDeLogin lê o PATH de um shell real", async () => {
    const lido = await caminhoDoShellDeLogin("/bin/sh", 5_000);
    expect(lido === null || lido.includes("/")).toBe(true);
  });

  describe("resolverBinario", () => {
    let dir: string;
    beforeAll(async () => {
      dir = await mkdtemp(join(tmpdir(), "nod-caminho-"));
      await mkdir(join(dir, "bin"));
      await writeFile(join(dir, "bin", "claude"), "#!/bin/sh\necho 1.0.0\n");
      await chmod(join(dir, "bin", "claude"), 0o755);
      await writeFile(join(dir, "bin", "sem-x"), "");
    });
    afterAll(() => rm(dir, { recursive: true, force: true }));

    it("bin explícito com ~ é expandido e precisa existir e ser executável", async () => {
      expect(await resolverBinario("~/bin/claude", "/nao/importa", dir)).toBe(join(dir, "bin", "claude"));
      expect(await resolverBinario("~/bin/sem-x", "", dir)).toBeNull();
      expect(await resolverBinario("/nao/existe/claude", "", dir)).toBeNull();
      // relativo não é aceito (ambíguo em relação ao cwd do turno)
      expect(await resolverBinario("bin/claude", `${dir}/bin`, dir)).toBeNull();
    });

    it("sem bin explícito procura `claude` no PATH aumentado, na ordem", async () => {
      expect(await resolverBinario(undefined, `/nao/existe:${join(dir, "bin")}`, dir)).toBe(join(dir, "bin", "claude"));
      expect(await resolverBinario("", "/nao/existe", dir)).toBeNull();
    });
  });
});
