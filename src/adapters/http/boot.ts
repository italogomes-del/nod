import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Inventario } from "../../contracts/inventario.ts";
import { criarDb } from "../../db/client.ts";
import { log } from "../../obs/log.ts";
import { listarTodas } from "../../repositories/pessoas.repo.ts";
import type { Db } from "../../shared/types.ts";
import { criarCatcherDriver } from "../executor/drivers/catcher.ts";
import { criarClaudeCliDriver } from "../executor/drivers/claude-cli.ts";
import { configDosDrivers, criarRegistryDetalhado, executorPadrao, nodHome, registrarDriver } from "../executor/registry.ts";
import { homeDaPessoa } from "../executor/caminho.ts";
import type { Driver, Registry } from "../executor/spi.ts";
import { iniciarDespachanteOutbox, type DespachanteOutbox } from "../fundo/despachar-outbox.ts";
import { iniciarOrquestrador, type Orquestrador } from "../fundo/orquestrador-turnos.ts";
import { garantirParticoes } from "../fundo/particoes.ts";
import { iniciarScheduler } from "../fundo/scheduler-rotina.ts";
import { iniciarVarredorExpiracao } from "../fundo/varredor-expiracao.ts";
import { iniciarVarredorLease } from "../fundo/varredor-lease.ts";
import { comporApp, type App, type AtivarDriver, type EnvApp } from "./compor.ts";
import { listen } from "./servidor.ts";

/**
 * Boot do servidor (ADR-006/012, EMENDA 3): partições → compor → listen → registry (claude-cli só é
 * padrão se a sonda disser 'pronto'; catcher sempre pronto) → inventário persistido por pessoa →
 * orquestrador com o laço da L4 injetado → scheduler 30 s → varredor de lease 15 s → varredor de
 * expiração 30 s → despachante do outbox. `fechar()` desfaz na ordem inversa e fecha conectores
 * vivos, SSE e pools. A ordem "listen antes do registry" existe porque o driver catcher chama as
 * rotas internas pela URL do próprio servidor (porta 0 nos testes, EMENDA 34).
 */
export type OpcoesBoot = {
  env?: EnvApp;
  db?: Db;
  dbDono?: Db;
  porta?: number;
  host?: string;
  /** Intervalos dos laços (testes encurtam). */
  intervalos?: { orquestradorMs?: number; schedulerMs?: number; leaseMs?: number; expiracaoMs?: number; outboxMs?: number };
  listarPessoas?: () => Promise<{ tenantId: string; id: string }[]>;
  /** Drivers do registry; default: catcher (+ claude-cli quando NOD_EXECUTOR=claude-cli). */
  drivers?: (p: { urlNod: string; app: App }) => Driver[];
  segredoSessao?: string;
  staticDir?: string;
};

export type ServidorNod = {
  app: App;
  registry: Registry;
  url: string;
  port: number;
  machineId: string;
  inventario: Inventario;
  fechar(): Promise<void>;
};

export const CAMINHO_PROXY = fileURLToPath(new URL("../mcp-proxy/proxy.ts", import.meta.url));

/** machine-id estável em NOD_HOME/machine-id (EMENDA 11: NOD_HOME guarda SÓ isto). */
export async function machineIdEstavel(env: EnvApp): Promise<string> {
  const dir = nodHome(env, homeDaPessoa(env));
  const arquivo = join(dir, "machine-id");
  try {
    const lido = (await readFile(arquivo, "utf8")).trim();
    if (/^[0-9a-f-]{36}$/i.test(lido)) return lido;
  } catch {
    // primeira vez nesta máquina
  }
  const novo = randomUUID();
  await mkdir(dir, { recursive: true });
  await writeFile(arquivo, `${novo}\n`, { mode: 0o600 });
  return novo;
}

export async function boot(o: OpcoesBoot = {}): Promise<ServidorNod> {
  const env: EnvApp = o.env ?? process.env;
  const urlApp = env.DATABASE_URL;
  const urlDono = env.DATABASE_URL_DONO;
  const db = o.db ?? (urlApp ? criarDb(urlApp) : null);
  const dbDono = o.dbDono ?? (urlDono ? criarDb(urlDono, { max: 1 }) : null);
  if (!db || !dbDono) throw new Error("boot: DATABASE_URL e DATABASE_URL_DONO são obrigatórios");
  const donoEmprestado = o.dbDono !== undefined;
  const dbEmprestado = o.db !== undefined;
  const agora = () => Date.now();
  const machineId = env.NOD_MACHINE_ID ?? (await machineIdEstavel(env));

  // 1. partições do mês corrente até 12 à frente, como nod_dono (ADR-006).
  await garantirParticoes(dbDono, agora());
  if (!donoEmprestado) await dbDono.end({ timeout: 2 });

  // 2. composição + 3. listen (a URL do servidor é insumo do driver catcher e do claude-cli).
  const app = comporApp({ db, env: { ...env, NOD_MACHINE_ID: machineId }, relogio: agora, listarPessoas: o.listarPessoas });
  const srv = await listen(o.porta ?? Number(env.NOD_API_PORT ?? 8888), o.host ?? env.NOD_HOST ?? "127.0.0.1", {
    rotas: app.rotas,
    segredoSessao: o.segredoSessao ?? env.NOD_SESSAO_SEGREDO,
    staticDir: o.staticDir ?? env.NOD_STATIC_DIR,
    autorizarTokenTurno: app.tokens.autorizar,
  });
  const url = `http://127.0.0.1:${srv.port}`;

  // 4. registry: catcher sempre; claude-cli SÓ quando pedido (a sonda dele custa um turno real, EMENDA 35). Os outros
  //    candidatos ficam à espera do interruptor (definido em 2026-09-16): trocar pela interface liga o driver na hora.
  const candidatos = o.drivers ? o.drivers({ urlNod: url, app }) : [criarCatcherDriver({ urlNod: url }), criarClaudeCliDriver({ urlNod: url, proxyPath: CAMINHO_PROXY, modeloSonda: env.NOD_MODELO })];
  const noBoot = candidatos.filter((d) => d.meta.id === "catcher" || env.NOD_EXECUTOR === "claude-cli");
  const cfgDrivers = await configDosDrivers(env);
  const { registry, inventarios } = await criarRegistryDetalhado(env, noBoot, { cfg: cfgDrivers });
  const padrao = executorPadrao(env, registry);
  const inventario: Inventario = inventarios[app.idDriver] ?? { estado: "ausente", motivo: padrao.id ? "sem sonda" : padrao.motivo, em: agora() };
  const ativar: AtivarDriver = async (id) => {
    const driver = candidatos.find((d) => d.meta.id === id);
    if (!driver) return { estado: "ausente", motivo: `driver ${id} não disponível neste servidor`, em: agora() };
    const inv = await registrarDriver(registry, cfgDrivers, driver);
    if (inv) return inv;
    const registro = registry[id];
    return { estado: "ausente", motivo: registro.estado === "sombra" ? registro.motivo : "sem sonda", em: agora() };
  };
  app.ligarRegistry(registry, inventarios, ativar);
  log("info", "registry_pronto", { executor_pedido: app.idDriver, executor_padrao: padrao.id, motivo: padrao.id ? null : padrao.motivo, inventario: inventario.estado });

  // 5. inventário persistido por pessoa (ADR-019): é o que enviarMensagem/despacharTurno leem no gate pré-spawn.
  const listar = o.listarPessoas ?? (() => listarTodas(db));
  for (const p of await listar()) await app.inventario.obter(p.id);

  // 6. laços de fundo, todos por paraCadaPessoa (EMENDA 3).
  const iv = o.intervalos ?? {};
  const orquestrador: Orquestrador = await iniciarOrquestrador({
    db,
    registry,
    machineId,
    ponte: app.ponte,
    iniciarLaco: app.iniciarLaco,
    executor: app.idDriver,
    relogio: agora,
    intervaloMs: iv.orquestradorMs,
    listarPessoas: o.listarPessoas,
  });
  const scheduler = iniciarScheduler(
    db,
    {
      machineId,
      // valor VIVO: rotina disparada depois de uma troca pelo interruptor nasce com o executor novo.
      get executor() {
        return app.executor;
      },
      services: app.services,
      useCases: app.useCases,
      agora,
      intervaloMs: iv.schedulerMs,
    },
    { listarPessoas: o.listarPessoas },
  );
  const varredorLease = iniciarVarredorLease({ db, relogio: agora, intervaloMs: iv.leaseMs, opcoes: { listarPessoas: o.listarPessoas, prazoDecisaoMs: Number(env.NOD_PRAZO_DECISAO_MS) || undefined } });
  const varredorExpiracao = iniciarVarredorExpiracao(db, { services: app.services, useCases: app.useCases, agora, intervaloMs: iv.expiracaoMs }, { listarPessoas: o.listarPessoas });
  const despachante: DespachanteOutbox = iniciarDespachanteOutbox(db, app.barramento, { intervaloMs: iv.outboxMs, listarPessoas: o.listarPessoas });

  log("info", "nod_no_ar", { url, machine_id: machineId, executor: app.idDriver, inventario: inventario.estado });

  let fechado = false;
  return {
    app,
    registry,
    url,
    port: srv.port,
    machineId,
    inventario,
    async fechar() {
      if (fechado) return;
      fechado = true;
      scheduler.parar();
      varredorLease.parar();
      varredorExpiracao.parar();
      await despachante.parar();
      await orquestrador.parar();
      await app.fechar();
      for (const r of Object.values(registry)) if (r.estado === "pronto") await r.instance.dispose();
      await srv.close();
      if (!dbEmprestado) await db.end({ timeout: 2 });
      log("info", "nod_encerrado", { machine_id: machineId });
    },
  };
}
