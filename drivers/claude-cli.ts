import type { Adapter, Driver, DriverConfig, Instance } from "./spi.ts";

const adapter: Adapter = {
  async sendTurn(texto: string) {
    return {
      texto: `eco: ${texto}`,
      sinais: { attempted: true, rejected: false, promptSubmitted: true, producedOutput: true },
    };
  },
  async interruptTurn() {},
};

export const claudeCli: Driver = {
  id: "claude-cli",
  decodeConfig: (raw) => (raw ?? {}) as DriverConfig,
  defaultConfig: () => ({}),
  async create(): Promise<Instance> {
    return { adapter, async dispose() {} };
  },
};
