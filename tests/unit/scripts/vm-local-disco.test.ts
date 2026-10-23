import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ROTULO_VERSAO } from "../../../scripts/computador/build.ts";

/**
 * NOD-93 (PR 1): o disco da VM local só é construído de verdade no release (root, libguestfs, runner da arquitetura).
 * O que dá para provar aqui: o plano do `--simular`, as recusas antes de qualquer comando, os arquivos que vão para o
 * convidado e o carregador da imagem com um docker falso.
 */
const RAIZ = join(import.meta.dirname, "../../..");
const DIR = join(RAIZ, "infra/vm-local");
const SCRIPT = join(DIR, "construir-disco.sh");
const tmp = mkdtempSync(join(tmpdir(), "vm-local-93-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function rodar(args: string[], env: Record<string, string> = {}) {
  const r = spawnSync("bash", [SCRIPT, ...args], { encoding: "utf8", env: { ...process.env, ...env }, timeout: 20_000 });
  return { status: r.status, saida: r.stdout + r.stderr };
}

describe("infra/vm-local/construir-disco.sh (NOD-93)", () => {
  it("--simular: baixa a base datada, confere o sha512, instala docker+chrony, leva a imagem e publica img.zst + sha256", () => {
    const { status, saida } = rodar(["--simular", "arm64", "1.0.0-rc.1", "/nao/existe.tar", join(tmp, "saida")]);
    expect(status, saida).toBe(0);
    const base = readFileSync(join(DIR, "base.env"), "utf8");
    const sha = /DEBIAN_SHA512_ARM64=([0-9a-f]{128})/.exec(base)![1]!;
    const linhas = saida.split("\n").filter((l) => l.startsWith("[simular]"));
    const ordem = ["curl", `conferir sha512 ${sha}`, "qemu-img create", "virt-resize --expand /dev/sda1", "zstd", "virt-customize", "virt-sparsify", "zstd", "sha256"];
    expect(linhas.map((l) => ordem.find((o) => l.startsWith(`[simular] ${o}`)))).toEqual(ordem);
    expect(linhas[0]).toContain("/bookworm/20261021-2638/debian-12-genericcloud-arm64-20261021-2638.qcow2");
    const customize = linhas.find((l) => l.includes("virt-customize"))!;
    expect(customize).toContain("--install docker.io,chrony,zstd");
    expect(customize).toContain("systemctl enable docker.service nod-imagem.service chrony.service");
    // O machine-id sai vazio no disco: cada VM gera o seu no 1º boot.
    expect(customize).toMatch(/ \/etc\/machine-id$/);
    expect(saida.trim().split("\n").at(-1)).toBe(join(tmp, "saida", "nod-vm-1.0.0-rc.1-arm64.img.zst"));
  });

  it("recusa arquitetura e versão inválidas antes de qualquer comando", () => {
    for (const args of [["--simular", "x86_64", "1.0.0", "/i", tmp], ["--simular", "amd64", "../1", "/i", tmp], ["--simular", "amd64"]]) {
      const r = rodar(args);
      expect(r.status, r.saida).toBe(2);
      expect(r.saida).not.toContain("[simular]");
    }
  });

  it("os dois hashes da base são sha512 e a URL é datada (nunca latest)", () => {
    const base = readFileSync(join(DIR, "base.env"), "utf8");
    expect(base).toMatch(/^DEBIAN_SHA512_ARM64=[0-9a-f]{128}$/m);
    expect(base).toMatch(/^DEBIAN_SHA512_AMD64=[0-9a-f]{128}$/m);
    expect(base).toMatch(/^DEBIAN_URL_BASE=.*\/[0-9]{8}-[0-9]+$/m);
  });

  it("o docker do convidado guarda tudo no disco de dados e não sobe sem ele montado", () => {
    const daemon = JSON.parse(readFileSync(join(DIR, "arquivos/etc/docker/daemon.json"), "utf8")) as Record<string, string>;
    expect(daemon["data-root"]).toBe("/mnt/lima-nod-dados/docker");
    const dropin = readFileSync(join(DIR, "arquivos/etc/systemd/system/docker.service.d/nod-dados.conf"), "utf8");
    expect(dropin).toContain("ExecStartPre=/usr/local/lib/nod/esperar-dados.sh");
    const montagem = join(tmp, "nao-montado");
    mkdirSync(montagem, { recursive: true });
    const r = spawnSync("sh", [join(DIR, "arquivos/usr/local/lib/nod/esperar-dados.sh")], { encoding: "utf8", env: { ...process.env, NOD_DADOS_MONTAGEM: montagem, NOD_DADOS_PRAZO_S: "0" }, timeout: 10_000 });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("não montou");
  });

  describe("carregar-imagem.sh", () => {
    const CARREGAR = join(DIR, "arquivos/usr/local/lib/nod/carregar-imagem.sh");
    function cenario(nome: string, rotuloAntes: string, rotuloDepois: string) {
      const d = join(tmp, nome);
      const bin = join(d, "bin");
      mkdirSync(bin, { recursive: true });
      writeFileSync(join(d, "imagem.tag"), "nod-computador:1\n");
      writeFileSync(join(d, "imagem.versao"), "2.0.0\n");
      writeFileSync(join(d, "imagem.tar.zst"), "");
      writeFileSync(join(d, "estado"), rotuloAntes);
      // docker falso: `image prune` só anota; `image inspect` responde o rótulo do estado; `load` grava o rótulo de depois e anota.
      writeFileSync(join(bin, "docker"), `#!/bin/sh\nif [ "$1 $2" = "image prune" ]; then echo "prune $*" >> "${d}/chamadas"; exit 0; fi\nif [ "$1" = image ]; then cat "${d}/estado"; echo; exit 0; fi\nif [ "$1" = load ]; then cat >/dev/null; printf '%s' '${rotuloDepois}' > "${d}/estado"; echo load >> "${d}/chamadas"; fi\n`);
      writeFileSync(join(bin, "zstd"), "#!/bin/sh\nexit 0\n");
      chmodSync(join(bin, "docker"), 0o755);
      chmodSync(join(bin, "zstd"), 0o755);
      const r = spawnSync("sh", [CARREGAR], { encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, NOD_IMAGEM_DIR: d }, timeout: 10_000 });
      let chamadas = "";
      try { chamadas = readFileSync(join(d, "chamadas"), "utf8"); } catch { /* nenhuma */ }
      return { status: r.status, saida: r.stdout + r.stderr, chamadas };
    }

    it("com a imagem da versão já no docker, não carrega nada", () => {
      const r = cenario("ja-tem", "2.0.0", "x");
      expect(r.status, r.saida).toBe(0);
      expect(r.chamadas).toBe("");
    });

    it("com outra versão (app atualizado), carrega a do disco e apaga a antiga, só as sem tag do nod", () => {
      const r = cenario("velha", "1.0.0", "2.0.0");
      expect(r.status, r.saida).toBe(0);
      expect(r.chamadas).toBe(`load\nprune image prune -f --filter label=${ROTULO_VERSAO}\n`);
    });

    it("se depois do load o rótulo não é o esperado, falha (o tar não é o desta versão)", () => {
      const r = cenario("errada", "", "1.9.9");
      expect(r.status).toBe(1);
      expect(r.saida).toContain("esperava 2.0.0");
    });

    it("lê o mesmo rótulo que o build grava", () => {
      expect(readFileSync(CARREGAR, "utf8")).toContain(`"${ROTULO_VERSAO}"`);
    });
  });

  it("o release gera o disco por arquitetura em runner nativo, atrás de NOD_VM_LOCAL, e o publica no rascunho", () => {
    const wf = readFileSync(join(RAIZ, ".github/workflows/desktop-release.yml"), "utf8");
    expect(wf).toContain("vm-local:");
    expect(wf).toContain("if: vars.NOD_VM_LOCAL == '1'");
    expect(wf).toMatch(/arch: arm64\n\s+runner: ubuntu-24.04-arm/);
    expect(wf).toMatch(/arch: amd64\n\s+runner: ubuntu-24.04\n/);
    expect(wf).toContain("infra/vm-local/construir-disco.sh");
    expect(wf).toContain("needs: [mac, vm-local]");
    expect(wf).toContain("release/nod-vm-*.img.zst.sha256");
  });
});
