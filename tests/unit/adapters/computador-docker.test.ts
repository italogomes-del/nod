import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * NOD-170: o driver Docker sem Docker. `spawn` é trocado por um falso que responde pela tabela `responder` e
 * guarda cada `docker ...` chamado — o teste lê a sequência para provar o que NÃO foi chamado (create, start, rm -v).
 */
type Resposta = { codigo?: number; saida?: string; erro?: string };
const chamadas: string[][] = [];
let responder: (args: string[]) => Resposta = () => ({});

vi.mock("node:child_process", () => ({
  spawn: (_cmd: string, args: string[]) => {
    chamadas.push(args);
    const p = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: Object.assign(new EventEmitter(), { end: () => undefined }),
      kill: () => true,
    });
    const r = responder(args);
    setImmediate(() => {
      if (r.saida) p.stdout.emit("data", Buffer.from(r.saida));
      if (r.erro) p.stderr.emit("data", Buffer.from(r.erro));
      p.emit("close", r.codigo ?? 0);
    });
    return p;
  },
}));

const { criarDriverDocker } = await import("../../../src/adapters/computador/docker.ts");
const { FalhaComputador } = await import("../../../src/domain/computador.ts");

const ID = "11111111-2222-4333-8444-555555555555";
const OUTROS = ["aaaaaaaa-0000-4000-8000-000000000001", "aaaaaaaa-0000-4000-8000-000000000002", "aaaaaaaa-0000-4000-8000-000000000003"];
const ENV = { NOD_COMPUTADORES: "docker", NOD_CREDENTIAL_KEY: "0".repeat(63) + "2", NOD_COMPUTADOR_IMAGEM: "nod-computador:1" };
const PRONTO = JSON.stringify({ resultado: { pronto: true } });

/** Um host com `ligados` de pé e a máquina deste teste parada (ou rodando), com a imagem `imagemDoContainer`. */
function host(o: { ligados: string[]; proxies?: string[]; rodando?: boolean; existe?: boolean; imagemDoContainer?: string; imagemDaTag?: string }) {
  let rodando = o.rodando ?? false;
  let existe = o.existe ?? true;
  let proxy = o.existe ?? true;
  responder = (args) => {
    const [cmd, ...resto] = args;
    const alvo = resto.at(-1);
    if (cmd === "ps") {
      // O docker real aplica o filtro de nome; o falso devolve tudo — a conferência do driver tem de bastar.
      return { saida: [...o.ligados.map((id) => `nod-computador-${id}`), ...(o.proxies ?? []).map((id) => `nod-egress-${id}`)].join("\n") + "\n" };
    }
    if (cmd === "inspect" && alvo === `nod-computador-${ID}`) {
      if (!existe) return { codigo: 1, erro: "No such object" };
      if (resto.includes("{{.Image}}")) return { saida: `${o.imagemDoContainer ?? "sha256:igual"}\n` };
      if (resto.includes("{{.State.Running}} {{.RestartCount}}")) return { saida: `${rodando} 0\n` };
      return { saida: "[]" };
    }
    if (cmd === "inspect" && alvo === `nod-egress-${ID}` && !proxy) return { codigo: 1, erro: "No such object" };
    if (cmd === "inspect") return { saida: rodando ? "true 0\n" : "[]" };
    if (cmd === "image" && resto.includes("{{.Id}}")) return { saida: `${o.imagemDaTag ?? "sha256:igual"}\n` };
    if (cmd === "rm") { if (alvo === `nod-egress-${ID}`) proxy = false; else existe = false; return {}; }
    if (cmd === "create") { if (resto[1] === `nod-egress-${ID}`) proxy = true; else existe = true; return {}; }
    if (cmd === "start" && alvo === `nod-computador-${ID}`) { rodando = true; return {}; }
    if (cmd === "exec") return { saida: rodando ? PRONTO : "" };
    return {};
  };
}
const comandos = () => chamadas.map((a) => a.join(" "));

beforeEach(() => {
  chamadas.length = 0;
});

describe("driver Docker: teto de computadores ligados (NOD-170)", () => {
  it("ligados() lê UMA vez, com o filtro de rótulo e nome, e só devolve máquinas (proxies e lixo não contam)", async () => {
    host({ ligados: OUTROS.slice(0, 2), proxies: OUTROS });
    responder = ((anterior) => (args: string[]) => args[0] === "ps" ? { saida: `${anterior(args).saida}nod-computador-nao-e-uuid\n/nod-computador-${OUTROS[2]}\n` } : anterior(args))(responder);
    const ligados = await criarDriverDocker(ENV).ligados();
    expect([...ligados].sort()).toEqual(OUTROS.slice(0, 2));
    expect(chamadas).toEqual([["ps", "--filter", "label=nod.computador=true", "--filter", "name=^nod-computador-", "--format", "{{.Names}}"]]);
  });

  it("no teto, recusa com limite_de_computadores ANTES de qualquer network, create ou start", async () => {
    host({ ligados: OUTROS, proxies: OUTROS });
    const erro = await criarDriverDocker(ENV).iniciar(ID).catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(FalhaComputador);
    expect(erro).toMatchObject({ motivo: "limite_de_computadores", limite: { maximo: 3, ociosoMin: 15 } });
    expect(comandos().some((c) => /^(network|create|start|rm)\b/.test(c))).toBe(false);
  });

  it("os proxies não contam e o teto vem do ambiente: 2 máquinas + 3 proxies com máximo 3 liga", async () => {
    host({ ligados: OUTROS.slice(0, 2), proxies: OUTROS });
    await criarDriverDocker(ENV).iniciar(ID);
    expect(comandos()).toContain(`start nod-computador-${ID}`);
    chamadas.length = 0;
    host({ ligados: OUTROS.slice(0, 2) });
    await expect(criarDriverDocker({ ...ENV, NOD_COMPUTADORES_MAX: "2" }).iniciar(ID)).rejects.toMatchObject({ motivo: "limite_de_computadores", limite: { maximo: 2 } });
  });

  it("a máquina já ligada não conta contra si mesma: rodando e pronta, o teto nem é consultado", async () => {
    host({ ligados: [...OUTROS, ID], rodando: true });
    await criarDriverDocker(ENV).iniciar(ID);
    expect(comandos().some((c) => c.startsWith("ps "))).toBe(false);
  });

  it("inspect que diz 'parada' com a própria máquina em ligados(): ela não conta contra si mesma no teto", async () => {
    host({ ligados: [...OUTROS.slice(0, 2), ID], rodando: false });
    await criarDriverDocker(ENV).iniciar(ID);
    expect(comandos()).toContain(`start nod-computador-${ID}`);
  });

  it("estado() devolve o teto e a ociosidade do ambiente, para o cartão", async () => {
    host({ ligados: [] });
    expect((await criarDriverDocker({ ...ENV, NOD_COMPUTADOR_OCIOSO_MIN: "0" }).estado(ID)).limite).toEqual({ maximo: 3, ociosoMin: 0 });
  });
});

describe("driver Docker: imagem nova chega à máquina parada (NOD-170)", () => {
  it("imagem diferente com a máquina PARADA: rm da máquina e do proxy sem -v, e o fluxo recria", async () => {
    host({ ligados: [], imagemDoContainer: "sha256:velha", imagemDaTag: "sha256:nova" });
    await criarDriverDocker(ENV).iniciar(ID);
    const c = comandos();
    const rms = c.filter((x) => x.startsWith("rm "));
    expect(rms).toEqual([`rm nod-computador-${ID}`, `rm --force nod-egress-${ID}`]);
    expect(rms.some((x) => /(^|\s)(-v|--volumes)(\s|$)/.test(x))).toBe(false);
    expect(c.some((x) => x.startsWith("volume "))).toBe(false);
    // Recriada com os MESMOS volumes nomeados (o login e o workspace ficam).
    const create = c.findIndex((x) => x.startsWith("create --name nod-computador-"));
    expect(create).toBeGreaterThan(c.indexOf(`rm nod-computador-${ID}`));
    expect(c[create]).toContain(`source=nod-computador-${ID}-home`);
    expect(c[create]).toContain(`source=nod-computador-${ID}-workspace`);
    expect(c).toContain(`create --name nod-egress-${ID} --label nod.computador=true --restart unless-stopped --network bridge --cap-drop ALL --security-opt no-new-privileges --read-only --memory 128m --pids-limit 64 nod-computador:1 node egress.mjs`);
  });

  it("mesma imagem, máquina parada: liga sem rm nem create", async () => {
    host({ ligados: [] });
    await criarDriverDocker(ENV).iniciar(ID);
    const c = comandos();
    expect(c.some((x) => x.startsWith("rm ") || x.startsWith("create --name nod-computador-"))).toBe(false);
    expect(c).toContain(`start nod-computador-${ID}`);
  });

  it("imagem diferente com a máquina LIGADA: não faz nada (a troca espera ela parar)", async () => {
    host({ ligados: [ID], rodando: true, imagemDoContainer: "sha256:velha", imagemDaTag: "sha256:nova" });
    await criarDriverDocker(ENV).iniciar(ID);
    const c = comandos();
    expect(c.some((x) => x.startsWith("rm ") || x.startsWith("create ") || x.includes("{{.Image}}"))).toBe(false);
  });

  it("máquina que nunca existiu: nada a comparar, cria do zero", async () => {
    host({ ligados: [], existe: false });
    await criarDriverDocker(ENV).iniciar(ID);
    const c = comandos();
    expect(c.some((x) => x.startsWith("rm "))).toBe(false);
    expect(c.some((x) => x.startsWith("create --name nod-computador-"))).toBe(true);
  });
});
