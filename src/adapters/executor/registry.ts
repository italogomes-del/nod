import { join } from "node:path";
import type { Inventario } from "../../contracts/inventario.ts";
import { montarAmbiente } from "../../domain/ambiente-executor.ts";
import { caminhoAumentado, caminhoDoShellDeLogin, expandirTil, homeDaPessoa } from "./caminho.ts";
import type { ConfigDriver, Driver, IdDriver, Registry } from "./spi.ts";

/**
 * Registry (ADR-012): create() que falha vira sombra com motivo escrito, nunca derruba o servidor.
 * claude-cli só fica 'pronto' quando a SONDA diz pronto (ADR-019: gate pré-spawn); catcher é sempre
 * pronto. NOD_EXECUTOR escolhe o padrão; fora de produção o padrão é catcher (Leapy §11).
 */
export type EnvRegistry = Readonly<Record<string, string | undefined>>;

export type OpcoesRegistry = {
  /** Consultar o PATH do shell de login (ADR-014). default true; os testes desligam. */
  shellDeLogin?: boolean;
  /** Casa da pessoa para expandir `~` da configuração; default homeDaPessoa(env) (passwd, não $HOME). */
  home?: string;
};

export type RegistryDetalhado = {
  registry: Registry;
  /** Snapshot da sonda por driver (o de claude-cli é o que o inventário publica). */
  inventarios: Partial<Record<IdDriver, Inventario>>;
};

export const NOD_HOME_PADRAO = "~/.nod";

export function nodHome(env: EnvRegistry, home: string): string {
  return expandirTil(env.NOD_HOME ?? NOD_HOME_PADRAO, home);
}

/** Config comum aos drivers a partir do env do processo: ambiente limpo + PATH aumentado + cwdBase. */
export async function configDosDrivers(env: EnvRegistry, o: OpcoesRegistry = {}): Promise<ConfigDriver> {
  const home = o.home ?? homeDaPessoa(env);
  const pathLogin = o.shellDeLogin === false ? null : await caminhoDoShellDeLogin(env.SHELL);
  const limpo = montarAmbiente("local", env);
  return {
    bin: env.NOD_CLAUDE_BIN ? expandirTil(env.NOD_CLAUDE_BIN, home) : undefined,
    env: { ...limpo, PATH: caminhoAumentado(env.PATH, home, pathLogin), HOME: limpo.HOME ?? home },
    cwdBase: join(nodHome(env, home), "turnos"),
  };
}

function motivoDe(erro: unknown): string {
  if (erro instanceof Error) return erro.message;
  return String(erro);
}

export async function criarRegistryDetalhado(env: EnvRegistry, drivers: readonly Driver[], o: OpcoesRegistry = {}): Promise<RegistryDetalhado> {
  const cfg = await configDosDrivers(env, o);
  const registry: Registry = {
    "claude-cli": { estado: "sombra", motivo: "driver não registrado" },
    catcher: { estado: "sombra", motivo: "driver não registrado" },
  };
  const inventarios: Partial<Record<IdDriver, Inventario>> = {};
  for (const driver of drivers) {
    const id = driver.meta.id;
    try {
      const instance = await driver.create(cfg);
      const inv = await instance.sondar();
      inventarios[id] = inv;
      if (inv.estado === "pronto") registry[id] = { estado: "pronto", driver, instance };
      else {
        await instance.dispose();
        registry[id] = { estado: "sombra", motivo: `${inv.estado}: ${inv.motivo}` };
      }
    } catch (erro) {
      registry[id] = { estado: "sombra", motivo: `create_falhou: ${motivoDe(erro)}` };
    }
  }
  return { registry, inventarios };
}

/** Forma do plano: `criarRegistry(env, drivers)` → Registry. */
export async function criarRegistry(env: EnvRegistry, drivers: readonly Driver[], o: OpcoesRegistry = {}): Promise<Registry> {
  return (await criarRegistryDetalhado(env, drivers, o)).registry;
}

export type ExecutorPadrao = { id: IdDriver } | { id: null; motivo: string };

/**
 * NOD_EXECUTOR escolhe; sem variável, catcher fora de produção e claude-cli em produção
 * (NODE_ENV=production). Só devolve um driver PRONTO; caso contrário diz por quê.
 */
export function executorPadrao(env: EnvRegistry, registry: Registry): ExecutorPadrao {
  const pedido = env.NOD_EXECUTOR;
  const escolhido: IdDriver = pedido === "claude-cli" || pedido === "catcher" ? pedido : env.NODE_ENV === "production" ? "claude-cli" : "catcher";
  const registro = registry[escolhido];
  if (registro.estado === "pronto") return { id: escolhido };
  return { id: null, motivo: `${escolhido} em sombra: ${registro.motivo}` };
}
