import { hostname } from "node:os";
import type { Inventario } from "../../contracts/inventario.ts";
import type { PonteInterna } from "../../contracts/ponte.ts";
import { log } from "../../obs/log.ts";
import type { Db, Relogio } from "../../shared/types.ts";
import type { IdDriver, Registry } from "../executor/spi.ts";
import { paraCadaPessoa, type OpcoesLaco } from "./escopos-de-fundo.ts";

/** definido em 2026-09-16: 2 s entre varreduras de pessoas — pessoa nova (seed/cadastro) ganha laço em até 2 s sem reiniciar. */
export const INTERVALO_ORQUESTRADOR_MS = 2_000;

/**
 * Validade do inventário anunciado à ponte (definido em 2026-09-21). O anúncio é o que decide o gate
 * pré-spawn em despachar-turno; antes disto ele era escrito UMA vez no boot e só mudava numa troca de
 * executor, então o gate mentia nas duas direções até alguém mexer no interruptor: driver que caiu
 * (deslogou, credencial expirou) seguia 'pronto' e o turno falhava adiante como executor_indisponivel;
 * driver anunciado em sombra seguia 'ausente' e recusava TODO turno mesmo depois de ficar pronto.
 * 60 s alinha com o TTL de 5 min da sonda compartilhada sem ressondar a cada tick de 2 s — a sonda do
 * boot é `claude auth status` (sem turno, sem custo de token), mas é processo filho.
 */
export const VALIDADE_ANUNCIO_MS = 60_000;

/** Assinatura do laço da L4 (src/adapters/executor/laco.ts): injetada aqui, nunca importada — a L9 liga. */
export type LacoAtivo = { parar(): Promise<void> | void };
export type IniciarLaco = (p: { ponte: PonteInterna; registry: Registry; pessoaId: string; machineId: string; relogio: Relogio }) => LacoAtivo;

export type OpcoesOrquestrador = {
  db: Db;
  registry: Registry;
  machineId: string;
  ponte: PonteInterna;
  iniciarLaco: IniciarLaco;
  /**
   * Driver anunciado à ponte (inventário vem da sonda dele); default catcher fora de produção.
   * Quem liga passa GETTER, nunca cópia: o anúncio é renovado no tick e tem que ver a troca do
   * interruptor (AGENTS.md §Composição).
   */
  executor?: IdDriver;
  relogio?: Relogio;
  intervaloMs?: number;
  /** Validade do anúncio; default VALIDADE_ANUNCIO_MS (testes encurtam). */
  validadeAnuncioMs?: number;
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
  const nome = o.nomeMaquina ?? hostname();
  const lacos = new Map<string, LacoAtivo>();
  // `o.executor` é lido A CADA anúncio, nunca copiado (AGENTS.md §Composição): depois de uma troca
  // pelo interruptor o re-anúncio tem que sondar o driver NOVO.
  const anunciar = async (): Promise<Inventario> => {
    const executor = o.executor ?? "catcher";
    const inventario = await inventarioDoRegistry(o.registry, executor, relogio());
    await o.ponte.conectar({ machineId: o.machineId, nome, inventario, versaoContrato: 1, ligacao: true });
    anunciadoEm = relogio();
    return inventario;
  };
  let anunciadoEm = 0;
  const inventario = await anunciar();
  log("info", "orquestrador_iniciado", { machine_id: o.machineId, executor: o.executor ?? "catcher", inventario: inventario.estado });

  let varrendo = false;
  const tick = async () => {
    if (varrendo) return;
    varrendo = true;
    try {
      // Anúncio vencido: ressonda antes de abrir laço, senão o gate pré-spawn decide por um estado velho.
      if (relogio() - anunciadoEm >= (o.validadeAnuncioMs ?? VALIDADE_ANUNCIO_MS)) {
        try {
          await anunciar();
        } catch (e) {
          // ADR-029: falha de sonda é dita, nunca engolida — o anúncio anterior segue valendo até a próxima.
          log("aviso", "anuncio_nao_renovado", { machine_id: o.machineId, erro: e instanceof Error ? e.name : "desconhecido" });
        }
      }
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
