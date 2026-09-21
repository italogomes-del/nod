import { describe, expect, it } from "vitest";
import { registrarDriver, registryVazio } from "../../../src/adapters/executor/registry.ts";
import type { ConfigDriver, Driver } from "../../../src/adapters/executor/spi.ts";
import { iniciarOrquestrador, type IniciarLaco } from "../../../src/adapters/fundo/orquestrador-turnos.ts";
import type { AnuncioMaquina, Entrega, PedidoRenovar, PonteInterna } from "../../../src/contracts/ponte.ts";
import type { Inventario } from "../../../src/contracts/inventario.ts";
import type { PlanoTurno } from "../../../src/contracts/plano-turno.ts";
import type { Db } from "../../../src/shared/types.ts";
import { driverFalso } from "../../helpers/driver-falso.ts";

/**
 * O inventário ANUNCIADO é o que decide o gate pré-spawn (despachar-turno). Antes de 2026-09-21 ele
 * era escrito uma vez no boot e só mudava numa troca de executor: driver que ficava pronto depois do
 * boot seguia 'ausente' e recusava TODO turno até alguém mexer no interruptor. O tick renova.
 */
const cfg: ConfigDriver = { env: {}, cwdBase: "/tmp/nao-usado" };

/** claude-cli falso cuja sonda o teste controla (o mesmo padrão de interruptor-executor.test.ts). */
function cliFalso(sonda: { inventario: Inventario }): Driver {
  const base = driverFalso();
  return {
    meta: { id: "claude-cli", locality: "local" },
    async create(c) {
      return { ...(await base.create(c)), sondar: async () => sonda.inventario };
    },
  };
}

function ponteEspia(anunciados: Inventario[]): PonteInterna {
  return {
    async conectar(m: AnuncioMaquina) {
      anunciados.push(m.inventario);
    },
    async puxar(): Promise<PlanoTurno | null> {
      return null;
    },
    async renovar(_p: PedidoRenovar) {
      return { ativo: true, versaoMinimaApp: "0" };
    },
    async entregar(_e: Entrega) {
      return undefined;
    },
    async desconectar() {
      return undefined;
    },
  };
}

const semPessoas = async () => [];
const lacoInerte: IniciarLaco = () => ({ parar: () => undefined });
// Sem pessoas na lista, paraCadaPessoa não varre o banco: `db` nunca é desreferenciado.
const db = {} as Db;

describe("orquestrador: o inventário anunciado é renovado, não congelado no boot", () => {
  it("driver PRONTO que cai depois do boot (deslogou) é re-anunciado no tick: o gate deixa de mentir 'pronto'", async () => {
    const sonda = { inventario: { estado: "pronto", versao: "2.1.278", em: 1 } as Inventario };
    const registry = registryVazio();
    await registrarDriver(registry, cfg, cliFalso(sonda));
    const anunciados: Inventario[] = [];
    let agora = 0;

    const orq = await iniciarOrquestrador({
      db,
      registry,
      machineId: "m1",
      ponte: ponteEspia(anunciados),
      iniciarLaco: lacoInerte,
      executor: "claude-cli",
      relogio: () => agora,
      intervaloMs: 1,
      validadeAnuncioMs: 50,
      listarPessoas: semPessoas,
    });

    expect(anunciados).toHaveLength(1);
    expect(anunciados[0]?.estado).toBe("pronto");

    // A conta expira/desloga no meio do dia; nada no nod é trocado.
    sonda.inventario = { estado: "nao_autenticado", motivo: "faça login", em: 2 };
    agora = 100; // anúncio vencido (validade 50)
    await new Promise((r) => setTimeout(r, 30));
    await orq.parar();

    // Antes: o anúncio seguia 'pronto' e o turno entrava para falhar adiante como executor_indisponivel.
    expect(anunciados.at(-1)).toMatchObject({ estado: "nao_autenticado", motivo: "faça login" });
  });

  it("anúncio dentro da validade não ressonda: um tick não vira um processo filho por 2 s", async () => {
    const sonda = { inventario: { estado: "pronto", versao: "2.1.278", em: 1 } as Inventario };
    const registry = registryVazio();
    await registrarDriver(registry, cfg, cliFalso(sonda));
    const anunciados: Inventario[] = [];

    const orq = await iniciarOrquestrador({
      db,
      registry,
      machineId: "m1",
      ponte: ponteEspia(anunciados),
      iniciarLaco: lacoInerte,
      executor: "claude-cli",
      relogio: () => 500, // relógio parado: nunca vence
      intervaloMs: 1,
      validadeAnuncioMs: 60_000,
      listarPessoas: semPessoas,
    });
    await new Promise((r) => setTimeout(r, 30));
    await orq.parar();

    expect(anunciados).toHaveLength(1);
  });
});
