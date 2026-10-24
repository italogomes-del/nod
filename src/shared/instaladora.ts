import type { PedidoDeInstalacao, ProgressoDeInstalacao } from "../contracts/instalacoes-ssh.ts";
import { log } from "../obs/log.ts";
import { decifrarCodigo, gerarParDoLogin, type ParDoLogin } from "./cifra-do-codigo.ts";
import { instalarPorSsh, lerCredencial, type ProgressoSsh, type ResultadoSsh, type Sistema } from "./instalador-ssh.ts";

/**
 * NOD-94 (emenda 11 da ADR-090): a instaladora — o motor Linux ou o app do Mac — puxa os pedidos de instalação por SSH
 * (a máquina puxa, o servidor nunca disca: ADR-021), decifra a credencial com o par que ela gerou ao subir (o par vive
 * só na memória; reiniciou = par novo e o pedido antigo cai em `nao_pareou`), roda `instalarPorSsh` e relata o
 * progresso. A credencial decifrada vive só durante a instalação e nunca vai a log.
 */

/** definido em 2026-10-22 (plano da NOD-94): a puxada (3 s, como a das contas); servidor sem a rota: tenta de novo em 5 min. */
export const INTERVALO_INSTALACOES_MS = 3_000;
export const INTERVALO_SEM_ROTA_MS = 5 * 60_000;
/** O servidor aceita 3 pedidos abertos por pessoa; aqui, no máximo 3 instalações ao mesmo tempo. */
export const MAX_INSTALANDO = 3;
/** O relato final (erro ou fim) é tentado de novo algumas vezes: perdê-lo deixa a tela esperando até o prazo. */
const TENTATIVAS_DO_RELATO = 5;

export type PonteDeInstalacoes = {
  /** null = sem resposta (rede); "sem_rota" = servidor sem instalações por SSH (modo local ou antigo). */
  puxar(chavePublica: string): Promise<PedidoDeInstalacao[] | null | "sem_rota">;
  progresso(p: ProgressoDeInstalacao): Promise<boolean>;
};

export type DepsInstaladora = {
  ponte: PonteDeInstalacoes;
  sistema: Sistema;
  agendar(fn: () => void, ms: number): { cancelar(): void };
  esperar?(ms: number): Promise<void>;
  /** Injetáveis nos testes. */
  instalar?: typeof instalarPorSsh;
  par?: ParDoLogin;
};

export type Instaladora = { parar(): void; emAndamento(): string[] };

export function iniciarInstaladora(d: DepsInstaladora): Instaladora {
  const par = d.par ?? gerarParDoLogin();
  const instalar = d.instalar ?? instalarPorSsh;
  const esperar = d.esperar ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const rodando = new Map<string, AbortController>();
  let parado = false;
  let proxima: { cancelar(): void } | null = null;

  /** Os relatos de um pedido saem em ordem (etapa depois de etapa, o erro por último). */
  const filas = new Map<string, Promise<void>>();
  const relatar = (p: ProgressoDeInstalacao, final = false): Promise<void> => {
    const anterior = filas.get(p.id) ?? Promise.resolve();
    const atual = anterior.then(async () => {
      for (let i = 0; i < (final ? TENTATIVAS_DO_RELATO : 1); i++) {
        if (await d.ponte.progresso(p).catch(() => false)) return;
        if (final && !parado) await esperar(1_000 * (i + 1));
      }
    });
    filas.set(p.id, atual);
    void atual.finally(() => { if (filas.get(p.id) === atual) filas.delete(p.id); });
    return atual;
  };

  const executar = async (pedido: PedidoDeInstalacao) => {
    const ctrl = new AbortController();
    rodando.set(pedido.id, ctrl);
    log("info", "instalacao_ssh_comecou", { instalacao_id: pedido.id, metodo: pedido.metodo, reinstalacao: pedido.impressaoConhecida !== null });
    try {
      let texto = "";
      if (pedido.metodo !== "apelido") {
        const decifrado = pedido.cifrado ? decifrarCodigo(par.privada, pedido.cifrado) : null;
        // Cifrado para outro par (a instaladora reiniciou) ou corrompido: a tela pede de novo.
        if (decifrado === null) { await relatar({ id: pedido.id, erro: "nao_pareou" }, true); return; }
        texto = decifrado;
      }
      const credencial = lerCredencial(texto, pedido.metodo);
      texto = "";
      if (!credencial) { await relatar({ id: pedido.id, erro: "ssh_recusou_login" }, true); return; }
      const r: ResultadoSsh = await instalar(pedido, credencial, d.sistema, (p: ProgressoSsh) => { void relatar({ id: pedido.id, ...p }); }, ctrl.signal);
      if (ctrl.signal.aborted) { log("info", "instalacao_ssh_cancelada", { instalacao_id: pedido.id }); return; }
      log("info", "instalacao_ssh_terminou", { instalacao_id: pedido.id, ok: r.ok, ...(r.ok ? { avisos: r.avisos.join(",") } : { motivo: r.motivo }) });
      if (r.ok) await relatar({ id: pedido.id, etapa: "pronta" }, true);
      else await relatar({ id: pedido.id, erro: r.motivo, ...(r.impressao ? { impressao: r.impressao } : {}), ...(r.linhas.length ? { linhas: r.linhas } : {}) }, true);
    } catch (e) {
      log("aviso", "instalacao_ssh_falhou", { instalacao_id: pedido.id, causa: e instanceof Error ? e.name : "desconhecida" });
      if (!ctrl.signal.aborted) await relatar({ id: pedido.id, erro: "instalacao_falhou" }, true);
    } finally {
      rodando.delete(pedido.id);
    }
  };

  const passada = async (): Promise<number> => {
    const r = await d.ponte.puxar(par.publica).catch(() => null);
    if (r === "sem_rota") { log("info", "instaladora_sem_rota", {}); return INTERVALO_SEM_ROTA_MS; }
    for (const pedido of r ?? []) {
      if (pedido.cancelado) { rodando.get(pedido.id)?.abort(); continue; }
      if (rodando.has(pedido.id)) continue;
      // Acima do limite (não deveria: o servidor limita a 3): o pedido já saiu do servidor, então falha visível.
      if (rodando.size >= MAX_INSTALANDO) { void relatar({ id: pedido.id, erro: "tempo_esgotado" }, true); continue; }
      void executar(pedido);
    }
    return INTERVALO_INSTALACOES_MS;
  };

  const ciclo = () => {
    if (parado) return;
    void passada().catch(() => INTERVALO_INSTALACOES_MS).then((ms) => { if (!parado) proxima = d.agendar(ciclo, ms); });
  };
  ciclo();

  return {
    parar() {
      parado = true;
      proxima?.cancelar();
      for (const c of rodando.values()) c.abort();
    },
    emAndamento: () => [...rodando.keys()],
  };
}
