import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import type { AcaoComputador, DriverComputador, ResultadoComputador } from "../../contracts/computador.ts";
import { ErroDeDominio } from "../../domain/erro.ts";

function docker(args: string[], entrada?: string, timeout = 70_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn("docker", args, { stdio: ["pipe", "pipe", "pipe"] });
    let saida = "";
    const timer = setTimeout(() => { p.kill("SIGKILL"); reject(new ErroDeDominio("estado_invalido")); }, timeout);
    p.stdout.on("data", (b: Buffer) => { saida += b.toString(); if (saida.length > 12_000_000) p.kill("SIGKILL"); });
    p.stderr.resume();
    p.stdin.on("error", () => undefined);
    p.on("error", () => { clearTimeout(timer); reject(new ErroDeDominio("estado_invalido")); });
    p.on("close", (code) => { clearTimeout(timer); if (code === 0) resolve(saida); else reject(new ErroDeDominio("estado_invalido")); });
    p.stdin.end(entrada ?? "");
  });
}
const pausa = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
export function criarDriverDocker(env: Readonly<Record<string, string | undefined>>): DriverComputador {
  const imagem = env.NOD_COMPUTADOR_IMAGEM || "nod-computador:1";
  const habilitado = env.NOD_COMPUTADORES === "docker";
  const chave = env.NOD_CREDENTIAL_KEY ?? "";
  const cofreConfigurado = /^[a-f0-9]{64}$/i.test(chave);
  const nomes = (id: string) => {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new ErroDeDominio("entrada_invalida");
    return { maquina: `nod-computador-${id}`, proxy: `nod-egress-${id}`, rede: `nod-rede-${id}` };
  };
  const rodando = async (nome: string) => (await docker(["inspect", "--format", "{{.State.Running}}", nome], undefined, 5000).catch(() => "")).trim() === "true";
  async function iniciar(id: string) {
    if (!habilitado || !cofreConfigurado) throw new ErroDeDominio("nao_permitido");
    const prazo = Date.now() + 120_000;
    const comPrazo = (args: string[], entrada?: string, timeout = 70_000) => {
      const restante = prazo - Date.now();
      if (restante <= 0) return Promise.reject(new ErroDeDominio("estado_invalido"));
      return docker(args, entrada, Math.min(timeout, restante));
    };
    const n = nomes(id);
    if (await rodando(n.maquina)) {
      const pronto = await comPrazo(["exec", "-i", n.maquina, "node", "/opt/nod/client.mjs"], '{"tipo":"ping"}', 3000).then(s => s.includes('"pronto":true'), () => false);
      if (pronto) return;
    }
    await comPrazo(["image", "inspect", imagem], undefined, 5000);
    await comPrazo(["network", "inspect", n.rede], undefined, 5000).catch(() => comPrazo(["network", "create", "--internal", "--label", "nod.computador=true", n.rede]));
    const existeProxy = await comPrazo(["inspect", n.proxy], undefined, 5000).then(() => true, () => false);
    if (!existeProxy) {
      await comPrazo(["create", "--name", n.proxy, "--label", "nod.computador=true", "--restart", "unless-stopped", "--network", "bridge", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only", "--memory", "128m", "--pids-limit", "64", imagem, "node", "egress.mjs"]);
      await comPrazo(["network", "connect", "--alias", "egress", n.rede, n.proxy]);
    }
    if (!await rodando(n.proxy)) await comPrazo(["start", n.proxy]);
    const existe = await comPrazo(["inspect", n.maquina], undefined, 5000).then(() => true, () => false);
    if (!existe) await comPrazo(["create", "--name", n.maquina, "--label", "nod.computador=true", "--restart", "unless-stopped", "--network", n.rede,
      "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--read-only", "--memory", "2g", "--cpus", "2", "--pids-limit", "512", "--shm-size", "512m",
      "--tmpfs", "/tmp:rw,nosuid,size=512m", "--tmpfs", "/run:rw,nosuid,size=64m,uid=1000,gid=1000",
      "--mount", `type=volume,source=${n.maquina}-home,target=/home/node`, "--mount", `type=volume,source=${n.maquina}-workspace,target=/workspace`,
      ...(env.NOD_COMPUTADOR_RUNTIME ? ["--runtime", env.NOD_COMPUTADOR_RUNTIME] : []), imagem]);
    await comPrazo(["start", n.maquina]);
    for (let i = 0; i < 25; i++) {
      await comPrazo(["exec", "-i", n.maquina, "node", "/opt/nod/unlock.mjs"], createHmac("sha256", Buffer.from(chave, "hex")).update(`nod-computador:${id}`).digest("hex"), 10000).catch(() => undefined);
      const pronto = await comPrazo(["exec", "-i", n.maquina, "node", "/opt/nod/client.mjs"], '{"tipo":"ping"}', 3000).then(s => s.includes('"pronto":true'), () => false);
      if (pronto) return;
      await pausa(500);
    }
    throw new ErroDeDominio("estado_invalido");
  }
  return {
    async estado(id) {
      if (!habilitado) return { disponivel: false, ativo: false, motivo: "Configure NOD_COMPUTADORES=docker no servidor." };
      if (!cofreConfigurado) return { disponivel: false, ativo: false, motivo: "Configure a chave de credenciais do servidor para proteger os logins." };
      const ok = await docker(["image", "inspect", imagem], undefined, 5000).then(() => true, () => false);
      const ativo = ok && await rodando(nomes(id).maquina);
      return { disponivel: ok, ativo, motivo: ok ? null : "Prepare o ambiente com npm run computador:build e Docker em execução." };
    },
    iniciar,
    async parar(id) { const n = nomes(id); for (const nome of [n.maquina, n.proxy]) if (await rodando(nome)) await docker(["stop", "--time", "20", nome], undefined, 30000); },
    async executar(id: string, acao: AcaoComputador): Promise<ResultadoComputador> {
      // definido em 2026-09-18: só iniciar explícito cria ou religa ambiente; parar nunca é desfeito por uma ação atrasada.
      if (!habilitado || !await rodando(nomes(id).maquina)) throw new ErroDeDominio("estado_invalido");
      const r = JSON.parse(await docker(["exec", "-i", nomes(id).maquina, "node", "/opt/nod/client.mjs"], JSON.stringify(acao))) as { erro?: string; resultado?: ResultadoComputador };
      if (r.erro || !r.resultado) throw new ErroDeDominio("estado_invalido");
      return r.resultado;
    },
  };
}
