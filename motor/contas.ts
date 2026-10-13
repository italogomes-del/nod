import { createHash } from "node:crypto";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import type { CodigoCifrado, LoginPendente, ProgressoDoLogin, PuxadaDeContas } from "../src/contracts/contas-ia.ts";
import type { IaDesktop } from "../src/contracts/desktop.ts";
import type { LoginDaIa } from "../src/contracts/estado-ia.ts";
import { emailDaConta, organizacaoDaConta, planoLegivel } from "../src/domain/estado-ia.ts";
import { log } from "../src/obs/log.ts";
import { decifrarCodigo, gerarParDoLogin, type ParDoLogin } from "../src/shared/cifra-do-codigo.ts";
import { executarColetando, iniciarProcesso } from "../src/adapters/executor/processo.ts";
import { contaDoCodex } from "../desktop/conta-codex.ts";
import type { ContaLocal, ContasLocais, IdentidadeDaConta } from "../desktop/contas-locais.ts";
import { ambienteDoLogin, comandoDeEstadoDoLogin, comandoDeLoginNoApp, comandoDeLogout, logadoPeloStatus, textoDaImpressao } from "../desktop/ia-mac.ts";
import { criarLoginDasIas, type ProcessoDeLogin, type StatusDoLogin } from "../desktop/login-ia.ts";

/**
 * As contas de IA no motor da VM (definido em 2026-10-13, ADR-102): a puxada do que a tela pediu (logins, saídas,
 * desconexão) e o login de cada conta pela tela. O login roda o CLI na pasta da conta (CLAUDE_CONFIG_DIR/CODEX_HOME) com a
 * mesma máquina de estados do app do Mac (desktop/login-ia.ts); o link e o código do aparelho sobem ao servidor, e o
 * código que a página da Anthropic devolve chega cifrado com a chave pública que o motor gerou para este login
 * (src/shared/cifra-do-codigo.ts). Nada de credencial sai da máquina.
 */

/** definido em 2026-10-13: a puxada de contas (3 s; 1 s com login aberto, para o link e o código chegarem rápido à tela). */
export const INTERVALO_CONTAS_MS = 3_000;
export const INTERVALO_CONTAS_LOGIN_MS = 1_000;

export type PonteDeContas = {
  puxar(): Promise<PuxadaDeContas | null | "sem_rota">;
  progresso(p: ProgressoDoLogin): Promise<boolean>;
  saiu(impressoes: string[], desconectada: boolean): Promise<boolean>;
};

/** O que o motor sabe rodar com o CLI de uma IA, num ambiente (o da conta). */
export type ClisDoMotor = {
  bin(ia: IaDesktop): Promise<string | null>;
  envBase(): Record<string, string>;
  home: string;
  versao: string;
};

/** O CLI diz quem está logado (para a impressão): o e-mail e a organização nunca saem daqui. */
export async function lerIdentidadeNoCli(c: ClisDoMotor, ia: IaDesktop, envConta: Record<string, string>): Promise<IdentidadeDaConta | undefined> {
  const bin = await c.bin(ia);
  if (!bin) return { logado: false, email: null, orgId: null, plano: null };
  const env = { ...ambienteDoLogin(c.envBase()), ...envConta };
  const cwd = c.home || tmpdir();
  if (ia === "claude-cli") {
    const r = await executarColetando({ bin, args: comandoDeEstadoDoLogin(ia).args, env, cwd, timeoutMs: 10_000 }).catch(() => null);
    if (!r || r.estourouTempo) return undefined;
    try {
      const o = JSON.parse(r.stdout) as Record<string, unknown>;
      const email = o.loggedIn === true ? emailDaConta(o.email) : null;
      return { logado: email !== null, email, orgId: typeof o.orgId === "string" ? o.orgId : null, plano: planoLegivel(o.subscriptionType), organizacao: organizacaoDaConta(o.orgName) };
    } catch {
      return { logado: false, email: null, orgId: null, plano: null };
    }
  }
  const conta = await contaDoCodex({ bin, env, cwd, versao: c.versao });
  if (conta === undefined) return undefined;
  return conta ? { logado: true, email: conta.email, orgId: null, plano: conta.plano, organizacao: conta.organizacao } : { logado: false, email: null, orgId: null, plano: null };
}

export async function logoutNoCli(c: ClisDoMotor, ia: IaDesktop, envConta: Record<string, string>): Promise<boolean> {
  const bin = await c.bin(ia);
  if (!bin) return false;
  const r = await executarColetando({ bin, args: comandoDeLogout(ia).args, env: { ...ambienteDoLogin(c.envBase()), ...envConta }, cwd: c.home || tmpdir(), timeoutMs: 15_000 }).catch(() => null);
  return r?.exitCode === 0;
}

/** O processo do login no ambiente da conta (como o app do Mac, desktop/main.ts iniciarLogin). */
async function iniciarLoginNoCli(c: ClisDoMotor, ia: IaDesktop, envConta: Record<string, string>): Promise<ProcessoDeLogin | null> {
  const bin = await c.bin(ia);
  if (!bin) return null;
  const pendentes: string[] = [];
  let ouvinte: ((t: string) => void) | null = null;
  const entregar = (t: string) => { if (ouvinte) ouvinte(t); else pendentes.push(t); };
  const p = iniciarProcesso({ bin, args: comandoDeLoginNoApp(ia).args, env: { ...ambienteDoLogin(c.envBase()), ...envConta }, cwd: c.home || tmpdir(), stdin: ia === "claude-cli" ? "pipe" : "ignore", aoLinha: (l) => entregar(`${l}\n`), aoStderr: entregar });
  return {
    aoSair: (fn) => { ouvinte = fn; for (const t of pendentes.splice(0)) fn(t); },
    escrever: (t) => p.escrever(t),
    fim: p.fim.then((r) => ({ codigo: r.exitCode, stderr: "" })),
    matar: () => p.interromper(),
  };
}

async function statusNoCli(c: ClisDoMotor, ia: IaDesktop, envConta: Record<string, string>): Promise<StatusDoLogin> {
  const bin = await c.bin(ia);
  if (!bin) return { logado: false, impressao: null };
  const r = await executarColetando({ bin, args: comandoDeEstadoDoLogin(ia).args, env: { ...ambienteDoLogin(c.envBase()), ...envConta }, cwd: c.home || tmpdir(), timeoutMs: 10_000 });
  const logado = !r.estourouTempo && logadoPeloStatus(ia, r.exitCode, r.stdout, r.stderr);
  return { logado, impressao: logado ? createHash("sha256").update(textoDaImpressao(ia, r.stdout, r.stderr)).digest("hex") : null };
}

export type DepsContasDoMotor = {
  ponte: PonteDeContas;
  contas: ContasLocais;
  clis: ClisDoMotor;
  /** O arquivo das contas locais: o `nod-motor entrar` no terminal o muda, e o serviço relê. */
  arquivo: string;
  /** As contas mudaram (login, logout, terminal): reanunciar ao servidor. */
  reanunciar(): Promise<void>;
  /** A pessoa desconectou a máquina pedindo para sair das contas: depois de sair, o motor apaga a conexão e para. */
  desconectar(): Promise<void>;
  /** Uma conta saiu desta máquina: o driver guardado dela é descartado. */
  aoSairDaConta?(conta: ContaLocal): Promise<void>;
  agora(): number;
  agendar(fn: () => void, ms: number): { cancelar(): void };
};

type LoginEmCurso = { pedido: LoginPendente; conta: ContaLocal; par: ParDoLogin | null; login: ReturnType<typeof criarLoginDasIas>; relatado: string; fim: boolean; nova: boolean };

export function iniciarContasDoMotor(d: DepsContasDoMotor): { parar(): void; emCurso(): number } {
  const logins = new Map<string, LoginEmCurso>();
  let parado = false;
  let timer: { cancelar(): void } | null = null;
  let mtime = 0;

  async function relatar(l: LoginEmCurso, p: Omit<ProgressoDoLogin, "loginId">): Promise<void> {
    const chave = JSON.stringify(p);
    if (chave === l.relatado) return;
    l.relatado = chave;
    await d.ponte.progresso({ loginId: l.pedido.id, ...p });
  }

  async function terminar(l: LoginEmCurso, p: Omit<ProgressoDoLogin, "loginId"> | null): Promise<void> {
    if (l.fim) return;
    l.fim = true;
    logins.delete(l.pedido.id);
    if (p) await relatar(l, p);
    await l.login.parar().catch(() => undefined);
  }

  async function aoMudar(l: LoginEmCurso, estado: LoginDaIa): Promise<void> {
    if (l.fim) return;
    if (estado.fase === "aguardando") {
      const url = l.login.link(l.conta.ia);
      if (!url) return;
      await relatar(l, {
        fase: estado.codigoEnviado ? "conferindo" : "aguardando_pessoa",
        url,
        ...(estado.codigoDoDispositivo ? { codigoDispositivo: estado.codigoDoDispositivo } : {}),
        pedeCodigo: estado.pedeCodigo,
        ...(l.par ? { chavePublica: l.par.publica } : {}),
      });
      return;
    }
    if (estado.fase === "sucesso") return; // aoSucesso relata, com a impressão
    if (estado.fase === "cancelado") { if (l.nova) await d.contas.descartar(l.conta); await terminar(l, null); return; }
    if (l.nova) await d.contas.descartar(l.conta);
    await terminar(l, { fase: "falhou", erro: estado.fase === "expirou" ? "tempo_esgotado" : estado.causa ?? "falhou" });
  }

  async function aoSucesso(l: LoginEmCurso): Promise<void> {
    if (l.fim) return;
    await d.contas.ler({ forcar: true, id: l.conta.id });
    const conta = d.contas.porId(l.conta.id, l.conta.ia);
    // A pessoa entrou numa conta que já estava noutra pasta desta máquina: a pasta repetida sai (sem logout).
    const impressao = conta?.impressao ?? undefined;
    await d.contas.descartarRepetidas().catch(() => 0);
    await d.reanunciar().catch(() => undefined);
    log("info", "motor_login_pronto", { login_id: l.pedido.id, ia: l.conta.ia });
    await terminar(l, impressao ? { fase: "pronto", impressao, plano: conta?.plano ?? null } : { fase: "falhou", erro: "nao_confirmou" });
  }

  async function comecar(p: LoginPendente): Promise<void> {
    const existente = p.impressao ? d.contas.porImpressao(p.impressao) : null;
    const conta = existente ?? (await d.contas.pastaParaLogin(p.ia, p.apelido));
    if (!conta) { await d.ponte.progresso({ loginId: p.id, fase: "falhou", erro: "contas_demais" }); return; }
    const env = d.contas.ambiente(conta);
    const l: LoginEmCurso = {
      pedido: p, conta, par: p.ia === "claude-cli" ? gerarParDoLogin() : null, relatado: "", fim: false, nova: !existente && conta.impressao === null,
      login: undefined as unknown as LoginEmCurso["login"],
    };
    l.login = criarLoginDasIas({
      iniciar: () => iniciarLoginNoCli(d.clis, p.ia, env),
      status: () => statusNoCli(d.clis, p.ia, env),
      agora: d.agora,
      agendar: d.agendar,
      aoMudar: (_ia, estado) => { void aoMudar(l, estado).catch(() => undefined); },
      aoSucesso: () => { void aoSucesso(l).catch(() => undefined); },
      registrar: (evento, campos) => log("info", evento, { ...campos, login_id: p.id }),
    });
    logins.set(p.id, l);
    await relatar(l, { fase: "abrindo" });
    const inicial = await l.login.entrar(p.ia);
    if (inicial.fase === "falhou") await aoMudar(l, inicial);
  }

  async function colar(l: LoginEmCurso, cifrado: CodigoCifrado): Promise<void> {
    const codigo = l.par ? decifrarCodigo(l.par.privada, cifrado) : null;
    if (codigo === null) { await terminar(l, { fase: "falhou", erro: "codigo_ilegivel" }); return; }
    const r = l.login.colarCodigo(l.conta.ia, codigo);
    if (!r.ok) await terminar(l, { fase: "falhou", erro: r.motivo });
  }

  async function sairDe(impressoes: readonly string[]): Promise<string[]> {
    const feitas: string[] = [];
    for (const imp of impressoes) {
      const conta = d.contas.porImpressao(imp);
      if (conta) await d.aoSairDaConta?.(conta).catch(() => undefined);
      await d.contas.sair(imp).catch(() => false);
      feitas.push(imp);
    }
    return feitas;
  }

  /** O `nod-motor entrar` no terminal mudou o arquivo: relê e reanuncia. */
  async function arquivoMudou(): Promise<boolean> {
    const m = await stat(d.arquivo).then((s) => s.mtimeMs, () => 0);
    if (m === mtime) return false;
    const primeira = mtime === 0;
    mtime = m;
    if (primeira) return false;
    await d.contas.carregar();
    await d.contas.ler({ forcar: true });
    await d.contas.descartarRepetidas().catch(() => 0);
    return true;
  }

  /** O que o próprio serviço gravou nesta volta não conta como mudança de fora. */
  const marcarArquivo = async () => { mtime = await stat(d.arquivo).then((s) => s.mtimeMs, () => mtime); };

  async function volta(): Promise<"seguir" | "parar"> {
    try {
      return await voltaDeVerdade();
    } finally {
      await marcarArquivo();
    }
  }

  async function voltaDeVerdade(): Promise<"seguir" | "parar"> {
    if (await arquivoMudou()) await d.reanunciar().catch(() => undefined);
    if (await d.contas.ler()) await d.reanunciar().catch(() => undefined);
    const r = await d.ponte.puxar();
    if (r === "sem_rota") { log("info", "motor_contas_sem_rota", {}); return "parar"; }
    if (!r) return "seguir";
    if (r.desconectar) {
      const todas = d.contas.listar().filter((c) => c.impressao !== null).map((c) => c.impressao!);
      const feitas = await sairDe(todas);
      await d.ponte.saiu(feitas, true);
      log("info", "motor_desconectado_pela_pessoa", { contas: feitas.length });
      await d.desconectar();
      return "parar";
    }
    if (r.sair.length > 0) {
      const feitas = await sairDe(r.sair);
      if (await d.ponte.saiu(feitas, false)) await d.reanunciar().catch(() => undefined);
      log("info", "motor_saiu_das_contas", { contas: feitas.length });
    }
    for (const p of r.logins) {
      const l = logins.get(p.id);
      if (p.cancelado) { if (l) await l.login.cancelar(l.conta.ia).catch(() => undefined); continue; }
      if (!l) { await comecar(p).catch((e) => log("aviso", "motor_login_falhou_ao_comecar", { login_id: p.id, erro: e instanceof Error ? e.name : "desconhecido" })); continue; }
      if (p.codigo) await colar(l, p.codigo);
    }
    return "seguir";
  }

  function agendar(): void {
    if (parado) return;
    timer = d.agendar(() => {
      void volta().then((r) => { if (r === "seguir") agendar(); }, () => agendar());
    }, logins.size > 0 ? INTERVALO_CONTAS_LOGIN_MS : INTERVALO_CONTAS_MS);
  }
  void stat(d.arquivo).then((s) => { mtime = s.mtimeMs; }, () => { mtime = 1; }).finally(agendar);

  return {
    parar() {
      parado = true;
      timer?.cancelar();
      for (const l of logins.values()) void l.login.parar().catch(() => undefined);
      logins.clear();
    },
    emCurso: () => logins.size,
  };
}
