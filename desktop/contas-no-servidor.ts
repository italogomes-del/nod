import type { PuxadaDeContas } from "../src/contracts/contas-ia.ts";

/**
 * O que a tela pede ao app do Mac sobre as contas (definido em 2026-10-13, ADR-102): "Sair do Mac" de uma conta e
 * "Desconectar o Mac" com "sair das contas". O login pela tela é só da VM (no Mac a pessoa entra pela ponte do app, com o
 * navegador daqui), então os `logins` da puxada são ignorados. Sem Electron: o main.ts injeta a ponte e as ações.
 */
export const INTERVALO_CONTAS_NO_MAC_MS = 3_000;

export type DepsContasNoServidor = {
  ponte: {
    puxar(): Promise<PuxadaDeContas | null | "sem_rota">;
    saiu(impressoes: string[], desconectada: boolean): Promise<boolean>;
  };
  /** Sai da conta neste Mac (logout com a variável dela e, fora a de sempre, a pasta sai). false = não estava aqui. */
  sair(impressao: string): Promise<boolean>;
  /** As impressões de todas as contas logadas aqui (o "sair das contas" do desconectar). */
  todas(): string[];
  /** O Mac foi desconectado pela tela: a conexão para e a tela de conectar volta. */
  desconectar(): Promise<void>;
  agendar(fn: () => void, ms: number): { cancelar(): void };
  registrar?(evento: string, campos: Record<string, string>): void;
};

export function iniciarContasNoServidor(d: DepsContasNoServidor): { parar(): void } {
  let parado = false;
  let timer: { cancelar(): void } | null = null;

  async function sairDe(impressoes: readonly string[]): Promise<string[]> {
    const feitas: string[] = [];
    for (const i of impressoes) {
      // Mesmo sem a conta aqui, a saída é confirmada: o servidor só apaga o vínculo.
      await d.sair(i).catch((e: unknown) => { d.registrar?.("conta_sair_falhou", { erro: e instanceof Error ? e.name : "desconhecido" }); return false; });
      feitas.push(i);
    }
    return feitas;
  }

  async function volta(): Promise<void> {
    if (parado) return;
    const r = await d.ponte.puxar().catch(() => null);
    if (parado) return;
    if (r === "sem_rota") return; // servidor sem contas (modo local ou antigo): nada a puxar
    if (r) {
      if (r.desconectar) {
        const feitas = await sairDe(d.todas());
        await d.ponte.saiu(feitas, true);
        parado = true;
        await d.desconectar();
        return;
      }
      if (r.sair.length > 0) await d.ponte.saiu(await sairDe(r.sair), false);
    }
    if (!parado) timer = d.agendar(() => void volta(), INTERVALO_CONTAS_NO_MAC_MS);
  }

  timer = d.agendar(() => void volta(), 0);
  return {
    parar() {
      parado = true;
      timer?.cancelar();
    },
  };
}
