import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  ambienteDocker,
  ambienteLima,
  binariosVmLocal,
  caminhosVmLocal,
  criarRuntimeVmLocal,
  FalhaVmLocal,
  gerarLimaYaml,
  lerStatus,
  macosSuportado,
  socketsCabem,
  vmLocalLigada,
  type Executar,
} from "../../../desktop/vm-local/runtime.ts";

/** NOD-93 (PR 2, ADR-123): o spike da VM local. O Lima de verdade só roda no Mac (UAT); aqui, um limactl falso. */
const RAIZ = join(import.meta.dirname, "../../..");
const MODELO = readFileSync(join(RAIZ, "desktop/vm-local/lima.yaml"), "utf8");
const tmp = mkdtempSync(join(tmpdir(), "vm-local-rt-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const APP = "/Users/ana/Library/Application Support/nod";
const campos = { imagem: `${APP}/vm/cache/nod-vm-1.0.0-arm64.img.zst`, arch: "arm64" as const, memoriaGiB: 3, cpus: 4, socket: `${APP}/vm/docker.sock` };

describe("desktop/vm-local/lima.yaml (NOD-93)", () => {
  const yaml = gerarLimaYaml(MODELO, campos);

  it("vz, sem Rosetta, sem mounts do Mac e sem portas: o único canal é o socket do docker do nod", () => {
    expect(yaml).toMatch(/^vmType: vz$/m);
    expect(yaml).toMatch(/^mounts: \[\]$/m);
    expect(yaml).toMatch(/rosetta:\n\s+enabled: false\n\s+binfmt: false/);
    expect(yaml).not.toMatch(/^\s*hostPort:/m);
    expect(yaml).not.toMatch(/^\s*(location|mountPoint): "?~/m);
    // Duas regras ignore cobrindo todas as portas, nos dois endereços do convidado.
    expect(yaml.match(/guestPortRange: \[1, 65535\]\n\s+proto: any\n\s+ignore: true/g)).toHaveLength(2);
    expect(yaml).toContain(`guestSocket: /var/run/docker.sock\n    hostSocket: "${campos.socket}"`);
    expect(yaml).not.toContain("/var/run/docker.sock\"");
  });

  it("nada da pessoa: sem chave ssh, agente, X11, containerd ou tela", () => {
    // A chave do Lima 2.x é no plural; no singular ele ignora o campo.
    expect(yaml).toMatch(/^\s+loadDotSSHPubKeys: false$/m);
    expect(yaml).toContain("forwardAgent: false");
    expect(yaml).toContain("forwardX11: false");
    expect(yaml).toMatch(/containerd:\n\s+system: false\n\s+user: false/);
    expect(yaml).toMatch(/video:\n\s+display: none/);
  });

  it("o socket do dockerd é do usuário do Lima já no 1º boot (override para os próximos, chown para o atual)", () => {
    expect(yaml).toContain('expression: .Socket.SocketUser="{{.User}}"');
    const sistema = yaml.indexOf("- mode: system");
    expect(sistema).toBeGreaterThan(yaml.indexOf("- mode: yq"));
    expect(yaml.slice(sistema, yaml.indexOf("probes:"))).toMatch(/systemctl daemon-reload\n\s+if \[ -S \/var\/run\/docker\.sock \]; then chown "\{\{\.User\}\}" \/var\/run\/docker\.sock; fi/);
  });

  it("troca todos os campos; o disco de dados nod-dados é o adicional", () => {
    expect(yaml).not.toContain("@@");
    expect(yaml).toMatch(/^arch: aarch64$/m);
    expect(yaml).toContain(`location: "${campos.imagem}"`);
    expect(yaml).toMatch(/^cpus: 4$/m);
    expect(yaml).toMatch(/^memory: "3GiB"$/m);
    expect(yaml).toMatch(/^disk: "12GiB"$/m);
    expect(yaml).toMatch(/additionalDisks:\n(\s+#.*\n)?\s+- name: nod-dados/);
    expect(gerarLimaYaml(MODELO, { ...campos, arch: "x64" })).toMatch(/^arch: x86_64$/m);
  });

  it("valor estranho ou campo desconhecido é erro, nunca um yaml torto", () => {
    expect(() => gerarLimaYaml(MODELO, { ...campos, imagem: "relativo.img" })).toThrow(/imagem/);
    expect(() => gerarLimaYaml(MODELO, { ...campos, socket: '/a"b' })).toThrow(/socket/);
    expect(() => gerarLimaYaml(MODELO, { ...campos, socket: "/a/{{.Home}}/docker.sock" })).toThrow(/socket/);
    expect(() => gerarLimaYaml(MODELO, { ...campos, imagem: "/a/{x}.img" })).toThrow(/imagem/);
    expect(() => gerarLimaYaml(MODELO, { ...campos, memoriaGiB: 2.5 })).toThrow(/memória/);
    expect(() => gerarLimaYaml(MODELO, { ...campos, cpus: 0 })).toThrow(/cpus/);
    expect(() => gerarLimaYaml(`${MODELO}\nx: @@OUTRO@@`, campos)).toThrow(/@@OUTRO@@/);
    // QA (Tarsila): cada caractere proibido sozinho, e controle/separador de linha que o yaml não aceita entre aspas.
    for (const ruim of ["/a\\b", "/a\nb: x", "/a\rb", "/a}b", "/a{b", "/a\tb", "/a\u0000b", "/a\u0085b", "/a\u2028b", "/a\u007fb"]) {
      expect(() => gerarLimaYaml(MODELO, { ...campos, socket: ruim }), JSON.stringify(ruim)).toThrow(/socket/);
    }
    expect(() => gerarLimaYaml(MODELO, { ...campos, discoGiB: 0 })).toThrow(/disco/);
    expect(gerarLimaYaml(MODELO, { ...campos, discoGiB: 20 })).toMatch(/^disk: "20GiB"$/m);
  });
});

describe("assinatura e empacotamento (NOD-93)", () => {
  it("o plist dá ao app (e ao limactl, via entitlementsInherit) o com.apple.security.virtualization", () => {
    const plist = readFileSync(join(RAIZ, "desktop/entitlements.mac.plist"), "utf8");
    expect(plist).toContain("<key>com.apple.security.virtualization</key><true/>");
    const builder = readFileSync(join(RAIZ, "electron-builder.yml"), "utf8");
    expect(builder).toContain("entitlementsInherit: desktop/entitlements.mac.plist");
    expect(builder).toMatch(/- from: dist\/vm-local\/\$\{arch\}\n\s+to: vm-local/);
  });

  it("o release monta os binários só com NOD_VM_LOCAL=1, antes do electron-builder", () => {
    const wf = readFileSync(join(RAIZ, ".github/workflows/desktop-release.yml"), "utf8");
    const passo = wf.indexOf("node scripts/desktop/vm-local-binarios.ts --arch \"$ARCH\"");
    expect(passo).toBeGreaterThan(0);
    expect(wf.slice(wf.lastIndexOf("- name:", passo), passo)).toContain("if: vars.NOD_VM_LOCAL == '1'");
    expect(passo).toBeLessThan(wf.indexOf("npx electron-builder --mac"));
  });
});

describe("desktop/vm-local/runtime.ts (NOD-93)", () => {
  it("a flag liga só com NOD_VM_LOCAL=1", () => {
    expect(vmLocalLigada({ NOD_VM_LOCAL: "1" })).toBe(true);
    expect(vmLocalLigada({ NOD_VM_LOCAL: "true" })).toBe(false);
    expect(vmLocalLigada({})).toBe(false);
  });

  it("tudo mora em <userData>/vm, com LIMA_HOME próprio", () => {
    const c = caminhosVmLocal(APP);
    expect(c).toMatchObject({ limaHome: `${APP}/vm/lima`, socket: `${APP}/vm/docker.sock`, dockerConfig: `${APP}/vm/docker-config`, cache: `${APP}/vm/cache`, discoDados: `${APP}/vm/lima/_disks/nod-dados` });
    expect(binariosVmLocal("/A/nod.app/Contents/Resources")).toEqual({
      limactl: "/A/nod.app/Contents/Resources/vm-local/lima/bin/limactl",
      docker: "/A/nod.app/Contents/Resources/vm-local/docker",
      modelo: "/A/nod.app/Contents/Resources/vm-local/lima.yaml",
    });
  });

  it("o docker do nod nunca fala com o docker da pessoa: socket, config e PATH próprios", () => {
    const c = caminhosVmLocal(APP);
    const pessoa = { HOME: "/Users/ana", PATH: "/opt/homebrew/bin:/usr/bin", DOCKER_HOST: "tcp://1.2.3.4:2375", DOCKER_CONTEXT: "colima", DOCKER_CONFIG: "/Users/ana/.docker", LIMA_HOME: "/Users/ana/.lima", LIMA_INSTANCE: "default", http_proxy: "http://p" };
    const d = ambienteDocker(c, pessoa);
    expect(d).toEqual({ HOME: "/Users/ana", PATH: "/usr/bin:/bin:/usr/sbin:/sbin", DOCKER_HOST: `unix://${APP}/vm/docker.sock`, DOCKER_CONFIG: `${APP}/vm/docker-config`, DOCKER_CLI_HINTS: "false" });
    expect(JSON.stringify(d)).not.toMatch(/\.docker|colima|\/var\/run\/docker\.sock/);
    expect(ambienteLima(c, pessoa)).toEqual({ HOME: "/Users/ana", PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LIMA_HOME: `${APP}/vm/lima` });
  });

  it("macOS 13 ou mais; 12 (e versão ilegível) fica de fora", () => {
    expect(macosSuportado("13.0")).toBe(true);
    expect(macosSuportado("15.6.1")).toBe(true);
    expect(macosSuportado("26.1")).toBe(true);
    expect(macosSuportado("12.7.6")).toBe(false);
    expect(macosSuportado("")).toBe(false);
  });

  it("os sockets do Lima cabem nos 104 bytes do macOS; um nome de usuário enorme não", () => {
    expect(socketsCabem(caminhosVmLocal(APP))).toBe(true);
    expect(socketsCabem(caminhosVmLocal(`/Users/${"x".repeat(60)}/Library/Application Support/nod`))).toBe(false);
    // QA: o sun_path tem 104 bytes com o NUL; o maior socket é <app>/vm/lima/nod/ssh.sock (+21). 103 cabe, 104 não.
    expect(socketsCabem(caminhosVmLocal(`/${"x".repeat(81)}`))).toBe(true);
    expect(socketsCabem(caminhosVmLocal(`/${"x".repeat(82)}`))).toBe(false);
  });

  it("lê o status da instância nod no `limactl list --format json` e ignora as outras", () => {
    const linha = (name: string, status: string) => JSON.stringify({ name, status });
    expect(lerStatus(`${linha("default", "Running")}\n${linha("nod", "Stopped")}\n`)).toBe("parada");
    expect(lerStatus(linha("nod", "Running"))).toBe("ligada");
    expect(lerStatus(linha("nod", "Broken"))).toBe("quebrada");
    expect(lerStatus(`lixo\n${linha("default", "Running")}`)).toBe("ausente");
  });

  describe("ciclo com um limactl falso", () => {
    let n = 0;
    function cenario() {
      const dadosApp = join(tmp, `app-${n++}`);
      const recursos = join(dadosApp, "Resources");
      mkdirSync(join(recursos, "vm-local"), { recursive: true });
      writeFileSync(join(recursos, "vm-local/lima.yaml"), MODELO);
      const c = caminhosVmLocal(dadosApp);
      let status: "Running" | "Stopped" | "Broken" = "Stopped";
      let versaoDocker = "29.0.0\n";
      const chamadas: string[] = [];
      const envs: Array<Record<string, string>> = [];
      const executar: Executar = async (bin, args, env) => {
        envs.push(env);
        const cmd = args.join(" ");
        if (!cmd.startsWith("list")) chamadas.push(`${bin.endsWith("limactl") ? "limactl" : "docker"} ${cmd}`);
        if (args[0] === "list") return { codigo: 0, saida: `${JSON.stringify({ name: "nod", status })}\n`, erro: "" };
        if (args[0] === "create") mkdirSync(c.instancia, { recursive: true });
        if (args[0] === "delete") rmSync(c.instancia, { recursive: true, force: true });
        if (args[0] === "disk") mkdirSync(c.discoDados, { recursive: true });
        if (args[0] === "start") status = "Running";
        if (args[0] === "stop") status = "Stopped";
        if (args[0] === "version") return { codigo: status === "Running" ? 0 : 1, saida: status === "Running" ? versaoDocker : "", erro: "" };
        return { codigo: 0, saida: "", erro: "" };
      };
      const rt = criarRuntimeVmLocal({ dadosApp, recursos, ambiente: { HOME: "/h", DOCKER_HOST: "tcp://x" }, executar });
      return { rt, c, chamadas, envs, quebrar: () => { status = "Broken"; }, semVersao: () => { versaoDocker = ""; }, setFalha: (f: Executar) => criarRuntimeVmLocal({ dadosApp, recursos, ambiente: {}, executar: f }) };
    }
    const pedido = { imagem: "/cache/nod-vm-1.0.0-arm64.img.zst", versao: "1.0.0", arch: "arm64" as const, memoriaGiB: 3, cpus: 4 };

    it("1ª vez: cria o disco de dados, grava o yaml, cria e liga; o limactl só vê o LIMA_HOME do nod", async () => {
      const { rt, c, chamadas, envs } = cenario();
      await rt.ligar(pedido);
      expect(chamadas).toEqual([
        "limactl disk create nod-dados --size 64GiB --format raw",
        `limactl create --name=nod --tty=false ${c.yaml}`,
        "limactl start --tty=false nod",
      ]);
      expect(readFileSync(c.yaml, "utf8")).toContain(`hostSocket: "${c.socket}"`);
      for (const env of envs) expect(env).toEqual({ HOME: "/h", PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LIMA_HOME: c.limaHome });
      expect(await rt.status()).toBe("ligada");
      expect(await rt.dockerResponde()).toBe(true);
    });

    it("já ligada e na versão: não faz nada; parar desliga e mantém tudo", async () => {
      const { rt, chamadas } = cenario();
      await rt.ligar(pedido);
      chamadas.length = 0;
      await rt.ligar(pedido);
      expect(chamadas).toEqual([]);
      await rt.parar();
      expect(chamadas).toEqual(["limactl stop nod"]);
      await rt.parar();
      expect(chamadas).toEqual(["limactl stop nod"]);
    });

    it("versão nova do disco: recria a instância e mantém o nod-dados", async () => {
      const { rt, chamadas, c } = cenario();
      await rt.ligar(pedido);
      chamadas.length = 0;
      await rt.ligar({ ...pedido, versao: "1.1.0", imagem: "/cache/nod-vm-1.1.0-arm64.img.zst" });
      expect(chamadas).toEqual(["limactl stop nod", "limactl delete --force nod", `limactl create --name=nod --tty=false ${c.yaml}`, "limactl start --tty=false nod"]);
      expect(readFileSync(c.yaml, "utf8")).toContain("nod-vm-1.1.0-arm64.img.zst");
    });

    it("só a memória mudou: para, ajusta e liga, sem recriar", async () => {
      const { rt, chamadas } = cenario();
      await rt.ligar(pedido);
      chamadas.length = 0;
      await rt.ligar({ ...pedido, memoriaGiB: 2 });
      expect(chamadas).toEqual(["limactl stop nod", "limactl edit --tty=false --memory=2 --cpus=4 nod", "limactl start --tty=false nod"]);
    });

    it("instância quebrada na mesma versão: apaga e recria, sem stop (QA)", async () => {
      const { rt, chamadas, c, quebrar } = cenario();
      await rt.ligar(pedido);
      quebrar();
      chamadas.length = 0;
      await rt.ligar(pedido);
      expect(chamadas).toEqual(["limactl delete --force nod", `limactl create --name=nod --tty=false ${c.yaml}`, "limactl start --tty=false nod"]);
    });

    it("arquitetura mudou na mesma versão: recria (QA)", async () => {
      const { rt, chamadas, c } = cenario();
      await rt.ligar(pedido);
      chamadas.length = 0;
      await rt.ligar({ ...pedido, arch: "x64" });
      expect(chamadas).toEqual(["limactl stop nod", "limactl delete --force nod", `limactl create --name=nod --tty=false ${c.yaml}`, "limactl start --tty=false nod"]);
      expect(readFileSync(c.yaml, "utf8")).toMatch(/^arch: x86_64$/m);
    });

    it("só as cpus mudaram: para, ajusta e liga (QA)", async () => {
      const { rt, chamadas } = cenario();
      await rt.ligar(pedido);
      chamadas.length = 0;
      await rt.ligar({ ...pedido, cpus: 2 });
      expect(chamadas).toEqual(["limactl stop nod", "limactl edit --tty=false --memory=3 --cpus=2 nod", "limactl start --tty=false nod"]);
    });

    it("docker que sai 0 sem versão do servidor não conta como respondendo (QA)", async () => {
      const { rt, semVersao } = cenario();
      await rt.ligar(pedido);
      semVersao();
      expect(await rt.dockerResponde()).toBe(false);
    });

    it("pasta longa demais para os sockets: erro de caminho antes de chamar o limactl (QA)", async () => {
      const chamadas: string[] = [];
      const rt = criarRuntimeVmLocal({ dadosApp: `/${"x".repeat(90)}`, recursos: "/r", ambiente: {}, executar: async (_b, args) => { chamadas.push(args.join(" ")); return { codigo: 0, saida: "", erro: "" }; } });
      await expect(rt.ligar(pedido)).rejects.toMatchObject({ etapa: "caminho" });
      expect(chamadas).toEqual([]);
    });

    it("limactl falhou: erro com a etapa e o fim do stderr", async () => {
      const { setFalha } = cenario();
      const rt = setFalha(async () => ({ codigo: 1, saida: "", erro: "a\nb\nc\nvz: não suportado\n" }));
      const erro = await rt.ligar(pedido).catch((e: unknown) => e);
      expect(erro).toBeInstanceOf(FalhaVmLocal);
      expect(erro).toMatchObject({ etapa: "criar o disco de dados", detalhe: "b | c | vz: não suportado" });
    });
  });
});
