import { hostname } from "node:os";
import type { Inventario } from "../../contracts/inventario.ts";
import type { PonteInterna } from "../../contracts/ponte.ts";
import { log } from "../../obs/log.ts";
import type { Db, Relogio } from "../../shared/types.ts";
import type { IdDriver, Registry } from "../executor/spi.ts";
import { paraCadaPessoa, type OpcoesLaco } from "./escopos-de-fundo.ts";

/** definido em 2026-09-16: 2 s entre varreduras de pessoas — pessoa nova (seed/cadastro) ganha laço em até 2 s sem reiniciar. */
export const INTERVALO_ORQUESTRADOR_MS = 2_000;

/** Assinatura do laço da L4 (src/adapters/executor/laco.ts): injetada aqui, nunca importada — a L9 liga. */
export type LacoAtivo = { parar(): Promise<void> | void };
export type IniciarLaco = (p: { ponte: PonteInterna; registry: Registry; pessoaId: string; machineId: string; relogio: Relogio }) => LacoAtivo;

export type OpcoesOrquestrador = {
  db: Db;
  registry: Registry;
  machineId: string;
  ponte: PonteInterna;
  iniciarLaco: IniciarLaco;
  /** Driver anunciado à ponte (inventário vem da sonda dele); default catcher fora de produção. */
  executor?: IdDriver;
  relogio?: Relogio;
  intervaloMs?: number;
  nomeMaquina?: string;
  listarPessoas?: OpcoesLaco["listarPessoas"];
};

export type Orquestrador = { parar(): Promise<void>; lacos(): string[] };

async function inventarioDoRegistry(registry: Registry, executor: IdDriver, agora: number): Promise<Inventario> {
  const registro = registry[executor];
  if (!registro || registro.estado === "sombra") return { estado: "ausente", motivo: registro?.motivo ?? `driver ${executor} não registrado`, em: agora };
  return registro.instance.sondar();
}

/**
 * Orquestrador local (ADR-021 in-process, EMENDA 3): anuncia a máquina à ponte com o inventário da
 * sonda e, a cada 2 s, passa por paraCadaPessoa garantindo UM laço por pessoa (o laço da L4 faz
 * puxar → rodar → entregar). Pessoa que some da lista mantém o laço até parar(); nada aqui abre
 * transação — o laço e a ponte é que abrem, por pessoa.
 */
export async function iniciarOrquestrador(o: OpcoesOrquestrador): Promise<Orquestrador> {
  const relogio = o.relogio ?? (() => Date.now());
  const executor = o.executor ?? "catcher";
  const lacos = new Map<string, LacoAtivo>();
  const inventario = await inventarioDoRegistry(o.registry, executor, relogio());
  await o.ponte.conectar({ machineId: o.machineId, nome: o.nomeMaquina ?? hostname(), inventario, versaoContrato: 1 });
  log("info", "orquestrador_iniciado", { machine_id: o.machineId, executor, inventario: inventario.estado });

  let varrendo = false;
  const tick = async () => {
    if (varrendo) return;
    varrendo = true;
    try {
      await paraCadaPessoa(
        o.db,
        async (escopo) => {
          if (lacos.has(escopo.pessoaId)) return;
          lacos.set(escopo.pessoaId, o.iniciarLaco({ ponte: o.ponte, registry: o.registry, pessoaId: escopo.pessoaId, machineId: o.machineId, relogio }));
        },
        { listarPessoas: o.listarPessoas },
      );
    } finally {
      varrendo = false;
    }
  };
  await tick();
  const timer = setInterval(() => void tick(), o.intervaloMs ?? INTERVALO_ORQUESTRADOR_MS);

  return {
    async parar() {
      clearInterval(timer);
      for (const [pessoaId, laco] of lacos) {
        try {
          await laco.parar();
        } catch (e) {
          log("erro", "laco_nao_parou", { pessoa_id: pessoaId, erro: e instanceof Error ? e.name : "desconhecido" });
        }
      }
      lacos.clear();
      await o.ponte.desconectar(o.machineId);
    },
    lacos: () => [...lacos.keys()],
  };
}
