import { describe, expect, it } from "vitest";
import type { PedidoDeInstalacao, ProgressoDeInstalacao } from "../../../src/contracts/instalacoes-ssh.ts";
import { ambienteDoSsh, iniciarInstalacoesNoServidor } from "../../../desktop/instalacoes-no-servidor.ts";
import { gerarParDoLogin } from "../../../src/shared/cifra-do-codigo.ts";
import { instalarPorSsh, type Execucao, type Sistema } from "../../../src/shared/instalador-ssh.ts";

const pedido: PedidoDeInstalacao = { id: "p1", host: "minha-vm", porta: 22, usuario: "", metodo: "apelido", impressaoConhecida: null, convite: "c".repeat(32), servidor: "https://nod" };
const ate = () => new Promise((r) => setTimeout(r, 10));

describe("instalações no Mac", () => {
  it("ambienteDoSsh: o PATH do login com o do sistema no fim; sem PATH, o do sistema", () => {
    expect(ambienteDoSsh({ PATH: "/opt/homebrew/bin", HOME: "/Users/m" })).toEqual({ PATH: "/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin", HOME: "/Users/m" });
    expect(ambienteDoSsh({}).PATH).toBe("/usr/bin:/bin:/usr/sbin:/sbin");
  });

  it("modo apelido: o ssh roda com o ambiente do login (o agente do Mac), BatchMode e o apelido depois de --, sem credencial", async () => {
    const chamadas: { programa: string; args: string[]; env: Record<string, string> }[] = [];
    const sistema: Sistema = {
      ambiente: { PATH: "/usr/bin", HOME: "/Users/m", SSH_AUTH_SOCK: "/tmp/agente.sock" },
      executar: async (programa, args, o): Promise<Execucao> => { chamadas.push({ programa, args, env: o.env }); return { codigo: 255, saida: "", erro: "ssh: Could not resolve hostname minha-vm" }; },
      pastaPrivada: async () => "/tmp/nod-ssh-teste",
      escrever: async () => undefined,
      ler: async () => "",
      apagar: async () => undefined,
      cano: async () => () => undefined,
      baixar: async () => "",
    };
    const relatos: ProgressoDeInstalacao[] = [];
    let puxadas = 0;
    const inst = iniciarInstalacoesNoServidor({
      ponte: { puxar: async () => (puxadas++ === 0 ? [pedido] : []), progresso: async (p) => { relatos.push(p); return true; } },
      env: {}, agendar: () => ({ cancelar: () => undefined }), sistema, instalar: instalarPorSsh, par: gerarParDoLogin(),
    });
    await ate();
    inst.parar();
    const ssh = chamadas.find((c) => c.programa === "ssh")!;
    expect(ssh.env.SSH_AUTH_SOCK).toBe("/tmp/agente.sock");
    expect(ssh.env.HOME).toBe("/Users/m");
    expect(ssh.args).toContain("BatchMode=yes");
    expect(ssh.args.slice(ssh.args.indexOf("--"), ssh.args.indexOf("--") + 2)).toEqual(["--", "minha-vm"]);
    expect(ssh.args).not.toContain("-F");
    expect(chamadas.some((c) => c.programa === "ssh-agent")).toBe(false);
    expect(relatos).toEqual([{ id: "p1", erro: "ssh_sem_rota", linhas: ["ssh: Could not resolve hostname minha-vm"] }]);
  });
});
