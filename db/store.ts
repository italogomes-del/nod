import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Agente, Mensagem } from "../contracts/agente.ts";
import type { Concessao } from "../contracts/conector.ts";
import type { Rotina, JanelaRotina } from "../contracts/rotina.ts";

export const TENANT_LOCAL = "018d5b79-9f43-7000-8000-a6c64d51a593";
export const PESSOA_LOCAL = "018d5b79-9f43-7000-8000-a6c64d51a594";

export type Pessoa = {
  tenantId: string;
  id: string;
  nome: string;
  iniciais: string;
};

export type Snapshot = {
  tenantId: string;
  pessoa: Pessoa;
  agentes: Agente[];
  mensagens: Mensagem[];
  rotinas: Rotina[];
  concessoes: Concessao[];
  janelas: JanelaRotina[];
  credenciaisCifradas: Record<string, string>;
};

function vazio(): Snapshot {
  return {
    tenantId: TENANT_LOCAL,
    pessoa: {
      tenantId: TENANT_LOCAL,
      id: PESSOA_LOCAL,
      nome: "Marlon Wanderlich",
      iniciais: "MW",
    },
    agentes: [],
    mensagens: [],
    rotinas: [],
    concessoes: [],
    janelas: [],
    credenciaisCifradas: {},
  };
}

export class Store {
  constructor(private readonly file: string) {}

  async load(): Promise<Snapshot> {
    try {
      const raw = await readFile(this.file, "utf8");
      return JSON.parse(raw) as Snapshot;
    } catch {
      return vazio();
    }
  }

  async save(s: Snapshot): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${randomUUID()}.tmp`;
    await writeFile(tmp, JSON.stringify(s, null, 2), "utf8");
    await rename(tmp, this.file);
  }

  async tx<T>(fn: (s: Snapshot) => T | Promise<T>): Promise<T> {
    const s = await this.load();
    const out = await fn(s);
    await this.save(s);
    return out;
  }
}

export function novoId(): string {
  return randomUUID();
}

export function caminhoPadrao(dir: string): string {
  return join(dir, "frota.json");
}
