import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { homedir, hostname, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as esperar } from "node:timers/promises";
import { criarAcompanhanteDeTarefas } from "../src/adapters/executor/acompanhar-tarefas.ts";
import { criarAmostradorMemoria } from "../src/adapters/executor/amostrador-memoria.ts";
import { resolverBinario } from "../src/adapters/executor/caminho.ts";
import { criarClaudeCliDriver } from "../src/adapters/executor/drivers/claude-cli.ts";
import { criarCodexCliDriver } from "../src/adapters/executor/drivers/codex-cli.ts";
import { driverDoPlano, iniciarLaco } from "../src/adapters/executor/laco.ts";
import { iniciarPoolDeLacos, type PoolDeLacos } from "../src/adapters/executor/pool-lacos.ts";
import { criarPonteHttp, FalhaPonte, urlServidor } from "../src/adapters/executor/ponte-http.ts";
import { encerrarGruposVivos, executarColetando, registrarGruposEm } from "../src/adapters/executor/processo.ts";
import { encerrarGruposOrfaos } from "../src/adapters/executor/grupos-orfaos.ts";
import { encerrarFugitivosDaInstancia } from "../src/adapters/executor/fugitivos.ts";
import { criarExecutarComando, iniciarLimpezaDasTasks, modoDaLimpeza, type LimpezaDasTasks } from "../src/adapters/executor/limpeza-das-tasks.ts";
import { iniciarEsperas, type Esperas } from "../src/adapters/executor/esperas.ts";
import type { PlanoTurno } from "../src/contracts/plano-turno.ts";
import { configDosDrivers, criarRegistryDetalhado } from "../src/adapters/executor/registry.ts";
import { prazoSondaDoEnv } from "../src/adapters/executor/sonda.ts";
import type { ConfigDriver, Driver, Registry } from "../src/adapters/executor/spi.ts";
import { criarDetectorGh, executarGithubNaMaquina } from "../src/adapters/conectores-locais/github/maquina.ts";
import type { IaDesktop } from "../src/contracts/desktop.ts";
import { versaoAceita } from "../src/domain/versao-app.ts";
import { log } from "../src/obs/log.ts";
import { ambienteDoLogin, comandoDeEstadoDoLogin, lerIaDesktop, textoDaImpressao } from "../desktop/ia-mac.ts";
import { criarVigiaDasIas, type Veredito, type VigiaDasIas } from "../desktop/vigia-ias.ts";
import { arquivoDoPedido, atualizacaoLigada, iniciarAtualizacao, MARCA_DA_ATUALIZACAO, type Atualizador } from "./atualizacao.ts";
import { AJUDA, carregarConexao, comandoDeEntrar, guardarConexao, lerComando, pastaDoExecutor, pastaDoMotor, type ConexaoMotor } from "./conexao.ts";

/**
 * O motor do Nod sem janela (ADR-090): o mesmo laço do app do Mac (`desktop/main.ts`, `conectar()`) numa máquina Linux
 * da pessoa, como serviço do systemd sob o usuário `nod`. O que muda em relação ao Electron:
 *   - a chave fica num arquivo 0600 (conexao.ts), não no Keychain;
 *   - o proxy MCP e o hook rodam com o node desta máquina (`electronComoNode: false`), dos bundles ao lado deste arquivo;
 *   - não há janela, aviso nem microfone: a pessoa usa o Nod pelo navegador ou pelo app do Mac;
 *   - a plataforma vai no anúncio (`linux`), e o prompt deixa de dizer Mac.
 *
 *   systemd ──► nod-motor rodar ──► POST /api/maquina/sessao (machineId = id da chave)
 *                                  ├─ vigia das IAs (sonda a cada 3 s até uma ficar pronta) ──► conectar (anúncio)
 *                                  ├─ pool de laços: puxar → claude/codex atrás do proxy MCP → renovar → entregar
 *                                  ├─ itens do gh aprovados (ADR-048), de 5 em 5 s
 *                                  └─ esperas de comando (ADR-099), de 5 em 5 s
 *
 * A costura repete a do app do Mac de propósito: mexer no `desktop/main.ts` exigiria uma release do app para testar.
 */
declare const __NOD_VERSAO__: string | undefined;
const dir = dirname(fileURLToPath(import.meta.url));

/** A versão que vai no `x-nod-versao`: a do build (o servidor que serviu o motor), ou a do package.json em dev. */
async function versaoDoMotor(): Promise<string> {
  if (typeof __NOD_VERSAO__ === "string" && __NOD_VERSAO__) return __NOD_VERSAO__;
  const pkg = JSON.parse(await readFile(join(dir, "..", "package.json"), "utf8")) as { version: string };
  return pkg.version;
}

/** Bundles (dist/motor) ficam lado a lado; em dev (`node motor/main.ts`) usa os fontes do desktop. */
function caminhoAoLado(bundle: string, fonte: string): string {
  return import.meta.url.endsWith(".mjs") ? join(dir, bundle) : join(dir, "..", "desktop", fonte);
}

const INTERVALO_ITENS_GITHUB_MS = 5_000;
/** Depois de uma queda (servidor fora, deploy), o motor tenta de novo: 5 s, 10 s, ... até 1 min. */
const ESPERAS_RECONEXAO_MS = [5_000, 10_000, 20_000, 40_000, 60_000];
/** Chave recusada (401/403): três vezes seguidas, a 1 min uma da outra, antes de desistir com o código 2. */
const RECUSAS_PARA_DESISTIR = 3;
const ESPERA_RECUSA_MS = 60_000;
/** O 409 do puxar (o servidor reiniciou e esqueceu a máquina) reanuncia, no máximo a cada 10 s (como no Mac). */
const ESPERA_REANUNCIO_MS = 10_000;

async function impressaoDoLogin(ia: IaDesktop, cfg: ConfigDriver): Promise<string | null> {
  const home = cfg.env.HOME ?? "";
  const { nome, args } = comandoDeEstadoDoLogin(ia);
  const bin = await resolverBinario(ia === "claude-cli" ? cfg.bin : cfg.bins?.["codex-cli"], cfg.env.PATH ?? "", home, nome);
  if (!bin) return null;
  const r = await executarColetando({ bin, args, env: ambienteDoLogin(cfg.env), cwd: home || tmpdir(), timeoutMs: 10_000 });
  return r.exitCode === 0 ? createHash("sha256").update(textoDaImpressao(ia, r.stdout, r.stderr)).digest("hex") : null;
}

type Sessao = { parar(): Promise<void>; terminou: Promise<FalhaPonte["codigo"] | "parado"> };

/** Uma conexão inteira: sessão, vigia das IAs, laços e gh. Termina quando a chave não vale ou o app precisa atualizar. */
async function conectar(c: ConexaoMotor, executor: string, pasta: string, versao: string): Promise<Sessao> {
  const r = await fetch(`${c.url}/api/maquina/sessao`, { method: "POST", redirect: "error", headers: { authorization: `Bearer ${c.chave}`, "x-nod-versao": versao, "content-type": "application/json" }, body: "{}", signal: AbortSignal.timeout(15_000) });
  const minima = r.headers.get("x-nod-versao-minima");
  if (r.status === 426 || (minima && !versaoAceita(versao, minima))) throw new FalhaPonte("atualize_app");
  if (r.status === 401 || r.status === 403) throw new FalhaPonte("chave_invalida");
  if (!r.ok) throw new FalhaPonte("servidor_fora");
  const dados = (await r.json()) as { escopo: { pessoaId: string }; machineId: string };
  if (!dados.escopo?.pessoaId || !dados.machineId) throw new FalhaPonte("resposta_invalida");

  let fim: (motivo: FalhaPonte["codigo"] | "parado") => void = () => undefined;
  const terminou = new Promise<FalhaPonte["codigo"] | "parado">((resolver) => { fim = resolver; });
  let laco: PoolDeLacos | null = null;
  let vigia: VigiaDasIas | null = null;
  let itens: ReturnType<typeof setInterval> | null = null;
  /** ADR-088 (limpeza das tasks, #225): as pastas de task encerradas nesta máquina; os turnos rodando nunca são mexidos. */
  let limpeza: LimpezaDasTasks | null = null;
  let esperas: Esperas | null = null;
  const planosAqui = new Map<string, PlanoTurno>();
  let ultimoReanuncio = 0;
  let encerrado = false;
  /** ADR-100: o pedido de atualização ao root, quando o motor ficar diferente do servidor (só com a instalação nova). */
  let atualizador: Atualizador | null = null;

  const lig = { urlNod: c.url, proxyPath: caminhoAoLado("proxy.mjs", "proxy.ts"), hookPath: caminhoAoLado("hook-nativas.mjs", "hook-nativas.ts"), nodePath: process.execPath, electronComoNode: false, sondaSemTurno: true, prazoSondaMs: prazoSondaDoEnv(process.env), filaDoForno: process.env.NOD_FILA_DO_FORNO !== "0" };
  // A pasta do executor (sessões e turnos do CLI) fica fora da pasta da chave (pastaDoExecutor): um turno não está a um `../` dela.
  const envExecutor = { ...process.env, NOD_HOME: executor };
  const drivers: Driver[] = [criarClaudeCliDriver(lig), criarCodexCliDriver(lig)];
  const cfg = await configDosDrivers(envExecutor);
  const criado = await criarRegistryDetalhado(envExecutor, drivers, { cfg });
  const registryDoLaco: Registry = criado.registry;
  const memoria = criarAmostradorMemoria({ env: process.env, lerNoLinux: true });

  const aoFalhar = (codigo: FalhaPonte["codigo"]) => {
    if (codigo === "reconectar" && vigia && Date.now() - ultimoReanuncio >= ESPERA_REANUNCIO_MS) {
      ultimoReanuncio = Date.now();
      log("info", "motor_reanuncio", { motivo: "servidor_esqueceu_a_maquina" });
      void vigia.reanunciar().catch(() => undefined);
    }
    if (codigo === "chave_invalida" || codigo === "atualize_app") void parar().then(() => fim(codigo));
  };
  const ponteHttp = criarPonteHttp({ url: c.url, chave: c.chave, versao, aoFalhar });
  const gh = await criarDetectorGh({ ambiente: process.env }).logado();
  const anuncio = { machineId: dados.machineId, nome: hostname(), versaoContrato: 1, github: { gh }, ligacao: true, plataforma: "linux" } as const;

  if (gh) {
    const relatos = new Map<string, "executado" | "falhou_na_execucao">();
    const relatar = async (itemId: string, desfecho: "executado" | "falhou_na_execucao") => {
      relatos.set(itemId, desfecho);
      await ponteHttp.resultadoItemLocal(itemId, desfecho).then(() => relatos.delete(itemId), () => undefined);
    };
    let ocupado = false;
    itens = setInterval(() => {
      if (ocupado) return;
      ocupado = true;
      void (async () => {
        for (const [itemId, desfecho] of [...relatos]) await relatar(itemId, desfecho);
        for (const item of await ponteHttp.itensLocais()) {
          const jaRodou = relatos.get(item.itemId);
          if (jaRodou) { await relatar(item.itemId, jaRodou); continue; }
          const r = await executarGithubNaMaquina({ capacidade: item.capacidade, argumentos: item.argumentos, ambiente: process.env });
          await relatar(item.itemId, r.isError ? "falhou_na_execucao" : "executado");
        }
      })().catch(() => undefined).finally(() => { ocupado = false; });
    }, INTERVALO_ITENS_GITHUB_MS);
  }

  {
    const casa = cfg.env.HOME ?? homedir();
    const modo = modoDaLimpeza(process.env);
    log("info", "limpeza_modo", { modo, onde: "motor" });
    limpeza = modo === "desligada" ? null : iniciarLimpezaDasTasks({ ponte: ponteHttp.ponte, pessoaId: dados.escopo.pessoaId, home: casa, executar: criarExecutarComando(cfg.env, casa), simular: modo === "simular", emUso: (pasta) => [...planosAqui.values()].some((p) => p.pastaDoBot === pasta || p.pastaDoBot?.startsWith(`${pasta}/`) === true) });
  }

  // ADR-099 (parte 2): as esperas de comando desta máquina (o puxar, a cada 5 s). O comando roda fora do CLI, com o
  // ambiente dos drivers; a reconexão não o derruba (o estado mora no módulo, esperas.ts).
  esperas = iniciarEsperas({ ponte: ponteHttp.ponte, pessoaId: dados.escopo.pessoaId, machineId: dados.machineId, home: cfg.env.HOME ?? homedir(), env: cfg.env });

  const subirLaco = (reg: Registry) => {
    const tarefasVivas = criarAcompanhanteDeTarefas((turnoId, tarefas) => ponteHttp.tarefas(turnoId, tarefas));
    laco = iniciarPoolDeLacos((ponte) => iniciarLaco({ ponte, registry: reg, pessoaId: dados.escopo.pessoaId, machineId: dados.machineId, relogio: () => Date.now(), renovacaoMs: 1_000, esperaVaziaMs: 1000, memoria,
      aoDelta: (p, t) => ponteHttp.delta(p.turnoId, t),
      aoEvento: (p, ev) => { if (ev.tipo === "tool_use") ponteHttp.ferramenta(p.turnoId, ev.nome); tarefasVivas.evento(p.turnoId, ev); },
      aoIniciarTurno: (p) => { planosAqui.set(p.turnoId, p); },
      aoTerminarTurno: (p) => { tarefasVivas.esquecer(p.turnoId); planosAqui.delete(p.turnoId); },
      aoVigia: (p, aviso) => ponteHttp.vigia(p.turnoId, aviso),
      aoResultado: (p, r) => { const ia = lerIaDesktop(driverDoPlano(p)); if (ia && r.causaSemIa) void vigiaAtual.reprovar(ia, r.causaSemIa).catch(() => undefined); } }), ponteHttp.ponte);
    log("info", "motor_laco_no_ar", { machine_id: dados.machineId });
    if (import.meta.url.endsWith(".mjs")) {
      void atualizacaoLigada({ url: c.url }).then((ligada) => {
        if (!ligada || encerrado || atualizador) return;
        atualizador = iniciarAtualizacao({ url: c.url, dir, pastaDoMotor: pasta, turnosRodando: () => laco?.turnosAtuais().length ?? 0, drenar: (sim) => laco?.drenar(sim) });
      });
    }
  };

  let lacoNoAr = false;
  const arquivoVereditos = join(pasta, "ias-testadas.json");
  const vigiaAtual = criarVigiaDasIas({
    sondar: () => criarRegistryDetalhado(envExecutor, drivers, { cfg }),
    impressao: (ia) => impressaoDoLogin(ia, cfg),
    anunciar: async (inventarios, principal, semLacoDeVoz, capacidades) => {
      if (encerrado) return;
      // NOD-199: como no app do Mac, o reanúncio vai pela rota só de inventário — o `conectar` recusaria (409) ou, depois
      // de 90 s, limparia os planos do turno que roda. O primeiro anúncio e o que segue um 409 caem no `conectar` no cliente.
      await ponteHttp.ponte.anunciarInventario({ ...anuncio, inventario: principal, harnesses: inventarios, semLacoDeVoz, capacidades });
      log("info", "motor_anunciou", { ias: Object.entries(inventarios).map(([h, i]) => `${h}:${i?.estado ?? "?"}`).join(",") });
    },
    aoRegistry: (novo, algumaPronta) => {
      if (encerrado) return;
      Object.assign(registryDoLaco, novo);
      if (algumaPronta && !lacoNoAr) { lacoNoAr = true; subirLaco(registryDoLaco); }
    },
    ler: async () => JSON.parse(await readFile(arquivoVereditos, "utf8")) as unknown,
    gravar: (vereditos: Veredito[]) => writeFile(arquivoVereditos, `${JSON.stringify(vereditos)}\n`, { mode: 0o600 }),
    agora: Date.now,
    agendar: (fn, ms) => { const t = setTimeout(fn, ms); return { cancelar: () => clearTimeout(t) }; },
  });
  vigia = vigiaAtual;
  // A primeira passada anuncia ao servidor; se ela falha (servidor caiu no meio), desliga o que já subiu antes de o laço
  // de reconexão tentar de novo — senão cada tentativa deixaria um timer de gh e um amostrador vivos.
  try {
    await vigiaAtual.iniciar(criado);
  } catch (e) {
    await parar();
    throw e;
  }
  log("info", "motor_conectado", { servidor: c.url, machine_id: dados.machineId, nome: anuncio.nome });

  async function parar() {
    if (encerrado) return;
    encerrado = true;
    atualizador?.parar();
    if (itens) clearInterval(itens);
    limpeza?.parar();
    esperas?.parar();
    vigia?.parar();
    ponteHttp.cancelar();
    const anterior = laco; laco = null;
    if (anterior) await anterior.parar().catch(() => undefined);
    for (const reg of Object.values(registryDoLaco)) if (reg?.estado === "pronto") await reg.instance.dispose();
    memoria.parar();
    await ponteHttp.ponte.desconectar("").catch(() => undefined);
  }
  return { parar: async () => { await parar(); fim("parado"); }, terminou };
}

/** O serviço: conecta, e se a conexão cai por rede ou deploy, tenta de novo. Chave inválida ou versão velha param. */
/** Chave inválida ou motor desatualizado: um log e uma mensagem só, e o código 2 (o systemd não reinicia, RestartPreventExitStatus). */
function sairPor(codigo: "chave_invalida" | "atualize_app", url: string): number {
  log("erro", `motor_${codigo}`, {});
  process.stderr.write(codigo === "chave_invalida" ? "A chave desta máquina não vale mais (cancelada?). Rode: nod-motor parear <servidor>\n" : `O servidor pede um motor mais novo. Rode de novo: curl -fsSL ${url}/motor | sh\n`);
  return 2;
}

/**
 * ADR-100: o servidor pede um motor mais novo (426). Com a atualização automática, o motor grava o pedido e sai com o
 * código 2: o systemd não o reinicia sozinho, mas o atualizador troca os arquivos e o reinicia. Nenhum turno roda aqui:
 * a sessão já foi recusada.
 */
async function sairPorVersao(url: string, pasta: string): Promise<number> {
  if (!import.meta.url.endsWith(".mjs") || !(await atualizacaoLigada({ url }))) return sairPor("atualize_app", url);
  await writeFile(arquivoDoPedido(pasta), `${JSON.stringify({ versao: null, em: Date.now(), motivo: "atualize_app" })}\n`, { mode: 0o600 }).catch(() => undefined);
  log("info", "motor_atualizacao", { motivo: "atualize_app" });
  process.stderr.write("O servidor pede um motor mais novo: a atualização automática foi pedida.\n");
  return 2;
}

async function rodar(): Promise<number> {
  const pasta = pastaDoMotor(process.env);
  const c = await carregarConexao(pasta);
  if (!c) { process.stderr.write("Esta máquina ainda não está conectada. Rode: nod-motor parear https://seu-nod\n"); return 2; }
  const versao = await versaoDoMotor();
  // ADR-089 (#217): os grupos de turno que a vida anterior do motor deixou (queda, SIGKILL do systemd) morrem antes do
  // primeiro turno desta; os novos ficam anotados, e saem junto com o processo.
  const arquivoGrupos = join(pastaDoExecutor(process.env), "grupos-vivos.json");
  const orfaos = await encerrarGruposOrfaos({ arquivo: arquivoGrupos }).catch(() => ({ assumiu: true }));
  if (orfaos.assumiu) {
    // ADR-097: o que saiu dos grupos com a marca do motor (os Postgres de teste das tasks) e ficou de outra vida.
    await encerrarFugitivosDaInstancia(arquivoGrupos);
    registrarGruposEm(arquivoGrupos);
  }
  process.once("exit", () => encerrarGruposVivos());
  let sessao: Sessao | null = null;
  // O SIGTERM pode chegar no meio do conectar ou da espera entre tentativas: a espera é abortável e, se a sessão nascer
  // depois do sinal, ela é parada na hora (revisão do PR: antes o sinal se perdia e o systemd matava só aos 30 s).
  const saida = new AbortController();
  const sair = () => { saida.abort(); void sessao?.parar(); };
  process.once("SIGTERM", sair);
  process.once("SIGINT", sair);
  let tentativa = 0;
  let recusas = 0;
  while (!saida.signal.aborted) {
    try {
      sessao = await conectar(c, pastaDoExecutor(process.env), pasta, versao);
      if (saida.signal.aborted) { await sessao.parar(); return 0; }
      tentativa = 0;
      recusas = 0;
      const motivo = await sessao.terminou;
      if (motivo === "atualize_app") return sairPorVersao(c.url, pasta);
      // Um 401/403 de passagem (proxy, deploy) não desliga a máquina de vez: só a terceira recusa seguida sai com o código 2.
      if (motivo === "chave_invalida" && ++recusas >= RECUSAS_PARA_DESISTIR) return sairPor(motivo, c.url);
      if (motivo === "chave_invalida") { await esperar(ESPERA_RECUSA_MS, undefined, { signal: saida.signal }).catch(() => undefined); continue; }
      if (motivo === "parado") return 0;
    } catch (e) {
      const codigo = e instanceof FalhaPonte ? e.codigo : "servidor_fora";
      if (codigo === "atualize_app") return sairPorVersao(c.url, pasta);
      if (codigo === "chave_invalida" && ++recusas >= RECUSAS_PARA_DESISTIR) return sairPor(codigo, c.url);
      if (saida.signal.aborted) return 0;
      const ms = ESPERAS_RECONEXAO_MS[Math.min(tentativa, ESPERAS_RECONEXAO_MS.length - 1)]!;
      tentativa += 1;
      log("aviso", "motor_sem_servidor", { codigo, nova_tentativa_ms: ms, erro: e instanceof Error ? e.name : "desconhecido" });
      await esperar(ms, undefined, { signal: saida.signal }).catch(() => undefined);
    }
  }
  return 0;
}

/** Pareamento por código (ADR-090): pede o código, mostra, e pergunta ao servidor até a pessoa aprovar. */
async function parear(servidorBruto: string, nomeBruto: string | null): Promise<number> {
  let url: string;
  // http só em loopback (o próprio servidor nesta máquina, testes); qualquer outro endereço precisa de HTTPS.
  try { url = urlServidor(servidorBruto, true); } catch { process.stderr.write("Use o endereço HTTPS do seu Nod, por exemplo https://nod.seudominio.com\n"); return 1; }
  const nome = (nomeBruto ?? hostname()).trim().slice(0, 60) || "maquina";
  const pedido = await fetch(`${url}/api/pareamento/dispositivo`, { method: "POST", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify({ nome, plataforma: "linux" }), signal: AbortSignal.timeout(15_000) });
  if (!pedido.ok) { process.stderr.write(`O servidor recusou o pareamento (HTTP ${pedido.status}). Confira o endereço.\n`); return 1; }
  const p = (await pedido.json()) as { codigoDispositivo: string; codigoPessoa: string; intervaloS: number; prazoS: number };
  process.stdout.write(`\nPara conectar esta máquina (${nome}) ao seu Nod, abra Seu espaço › Máquinas › Conectar e digite o código:\n\n        ${p.codigoPessoa}\n\nOu abra: ${url}/?parear-maquina=${encodeURIComponent(p.codigoPessoa)}  (vale por ${Math.round(p.prazoS / 60)} min)\n\nAguardando a confirmação…\n`);
  const ate = Date.now() + p.prazoS * 1000;
  while (Date.now() < ate) {
    await esperar(p.intervaloS * 1000);
    const r = await fetch(`${url}/api/pareamento/dispositivo/trocar`, { method: "POST", redirect: "error", headers: { "content-type": "application/json" }, body: JSON.stringify({ codigoDispositivo: p.codigoDispositivo }), signal: AbortSignal.timeout(15_000) }).catch(() => null);
    // Só o 400 (código vencido ou já usado) encerra: um 5xx ou 429 de passagem (deploy) não derruba o pareamento.
    if (!r || r.status !== 201 && r.status !== 400) continue;
    if (r.status === 201) {
      const { chave } = (await r.json()) as { chave: string };
      await guardarConexao(pastaDoMotor(process.env), { url, chave });
      process.stdout.write(`\n✓ Conectada como ${nome}.\n\nAgora entre nas suas IAs, nesta máquina:\n  nod-motor entrar claude\n  nod-motor entrar codex     (opcional)\n  nod-motor entrar github    (opcional)\n\n`);
      return 0;
    }
    process.stderr.write("O código venceu ou não vale mais. Rode o pareamento de novo.\n");
    return 1;
  }
  process.stderr.write(`O código venceu (${Math.round(p.prazoS / 60)} min). Rode o pareamento de novo.\n`);
  return 1;
}

/** O login é da pessoa, direto com o fornecedor, neste terminal: o Nod não vê a senha nem a chave (ADR-015/019). */
async function entrar(ia: "claude" | "codex" | "github"): Promise<number> {
  const { nome, args } = comandoDeEntrar(ia);
  const cfg = await configDosDrivers({ ...process.env, NOD_HOME: pastaDoExecutor(process.env) });
  const home = cfg.env.HOME ?? "";
  const bin = nome === "gh" ? await resolverBinario(undefined, cfg.env.PATH ?? "", home, "gh") : await resolverBinario(nome === "claude" ? cfg.bin : cfg.bins?.["codex-cli"], cfg.env.PATH ?? "", home, nome as "claude" | "codex");
  if (!bin) { process.stderr.write(`${nome} não está instalado nesta máquina. Rode a instalação de novo com a opção dele.\n`); return 1; }
  return new Promise((resolver) => {
    const filho = spawn(bin, args, { stdio: "inherit", env: { ...ambienteDoLogin(cfg.env), PATH: cfg.env.PATH ?? process.env.PATH ?? "" }, cwd: home || undefined });
    filho.once("exit", (codigo) => resolver(codigo ?? 1));
    filho.once("error", () => resolver(1));
  });
}

async function estado(): Promise<number> {
  const pasta = pastaDoMotor(process.env);
  const c = await carregarConexao(pasta);
  process.stdout.write(`Motor ${await versaoDoMotor()} · ${hostname()}\n`);
  process.stdout.write(c ? `Conectado a ${c.url}\n` : "Ainda não conectado: nod-motor parear https://seu-nod\n");
  const marca = await atualizacaoLigada();
  const mesmoServidor = !c || await atualizacaoLigada({ url: c.url });
  process.stdout.write(!marca ? `Atualização automática: desligada (sem ${MARCA_DA_ATUALIZACAO})\n`
    : !mesmoServidor ? `Atualização automática: parada (a instalação é de outro servidor; rode de novo: curl -fsSL ${c?.url}/motor | sh)\n`
      : "Atualização automática: ligada (espera um momento sem turno)\n");
  const lig = { urlNod: c?.url ?? "https://127.0.0.1", proxyPath: caminhoAoLado("proxy.mjs", "proxy.ts"), sondaSemTurno: true, electronComoNode: false };
  const envExecutor = { ...process.env, NOD_HOME: pastaDoExecutor(process.env) };
  const cfg = await configDosDrivers(envExecutor);
  const criado = await criarRegistryDetalhado(envExecutor, [criarClaudeCliDriver(lig), criarCodexCliDriver(lig)], { cfg });
  for (const [id, inv] of Object.entries(criado.inventarios)) process.stdout.write(`  ${id === "claude-cli" ? "Claude Code" : id === "codex-cli" ? "Codex" : id}: ${inv?.estado ?? "?"}${inv && "motivo" in inv && inv.motivo ? ` (${inv.motivo})` : ""}\n`);
  for (const reg of Object.values(criado.registry)) if (reg?.estado === "pronto") await reg.instance.dispose();
  return 0;
}

const comando = lerComando(process.argv.slice(2));
const saida =
  comando.tipo === "rodar" ? rodar()
  : comando.tipo === "parear" ? parear(comando.servidor, comando.nome)
  : comando.tipo === "entrar" ? entrar(comando.ia)
  : comando.tipo === "estado" ? estado()
  : comando.tipo === "versao" ? versaoDoMotor().then((v) => { process.stdout.write(`${v}\n`); return 0; })
  : Promise.resolve((process.stdout.write(`${comando.erro ? `${comando.erro}\n\n` : ""}${AJUDA}`), comando.erro ? 1 : 0));
saida.then((codigo) => process.exit(codigo), (e: unknown) => { process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`); process.exit(1); });
