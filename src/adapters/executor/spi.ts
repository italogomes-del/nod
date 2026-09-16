export type DriverConfig = Record<string, unknown>;

export type SinaisTurno = {
  attempted: boolean;
  rejected: boolean;
  promptSubmitted: boolean;
  producedOutput: boolean;
};

export type Adapter = {
  sendTurn: (texto: string) => Promise<{ texto: string; sinais: SinaisTurno }>;
  interruptTurn: () => Promise<void>;
};

export type Instance = {
  adapter: Adapter;
  dispose: () => Promise<void>;
};

export type Driver = {
  id: string;
  decodeConfig: (raw: unknown) => DriverConfig;
  defaultConfig: () => DriverConfig;
  create: (config: DriverConfig) => Promise<Instance>;
};
