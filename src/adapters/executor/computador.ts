import { createConnection, type Socket } from "node:net";
import type { ComandoComputador, EstadoComputadorRelatado, MensagemAoSupervisor, RelatoComputador, ResultadoComandoComputador } from "../../contracts/computador-motor.ts";
import { BATIMENTO_ESTADO_MS } from "../../domain/computador-canal.ts";
import { log } from "../../obs/log.ts";

/**
 * O laço do computador no motor (definido em 2026-10-22, NOD-96 PR 3, ADR-122). O motor é só o fio entre o servidor e
 * o supervisor desta máquina (`nod-computador`, PR 2): PUXA os comandos pela ponte (long-poll, o servidor nunca disca,
 * ADR-021), repassa cada um ao supervisor pelo socket como veio (assinado; o motor não abre o selo nem reassina) e posta
 * de volta o que o supervisor relata — a resposta de cada comando e a foto do computador. A cada 15 s pede a foto: o
 * servidor só sabe que o computador está vivo por ela.
 *
 * Protocolo do socket (`MensagemAoSupervisor`/`RelatoComputador`): uma mensagem JSON por linha, nos dois sentidos.
 *
 * Supervisor fora do ar (socket ausente ou recusou): o comando volta na hora como `falhou` com `nao_iniciou` — quem
 * espera no servidor não fica parado até o teto. O relato que a ponte não aceitou (servidor fora) fica guardado e vai na
 * volta seguinte; o servidor ignora a repetição (idempotente pelo id).
 *
 * Ganchos (NOD-93, ADR-127 §3): o app do Mac usa o mesmo fio com o supervisor na VM local. `antesDeRepassar` decide
 * antes de cada comando se ele segue ao socket (null) ou volta na hora com a resposta que o gancho der (VM baixando,
 * macOS antigo, memória apertada); `aoRelato` vê cada foto do supervisor (para dormir a VM ociosa). Sem os ganchos, o
 * motor do Linux fica como antes.
 */

export const SOCKET_SUPERVISOR = "/run/nod-computador/ctl.sock";
/** Servidor sem o computador no motor (404): tenta de novo só bem depois — a flag não liga sozinha a cada segundo. */
const ESPERA_SEM_ROTA_MS = 10 * 60_000;
const ESPERA_SEM_RESPOSTA_MS = 5_000;
/** Relatos guardados à espera do servidor: além disso, os mais antigos saem (o servidor já cancelou quem esperava). */
const RELATOS_GUARDADOS = 64;
/** Uma linha do supervisor maior que isto é descartada (uma captura de tela em base64 cabe com folga). */
const LINHA_MAX = 32 * 1024 * 1024;

/** O que o laço usa da ponte HTTP (`criarPonteHttp(...).computador`). */
export type CanalDoMotor = {
  puxar(): Promise<ComandoComputador[] | null | "sem_rota">;
  resultado(r: ResultadoComandoComputador): Promise<boolean>;
  estado(e: EstadoComputadorRelatado): Promise<boolean>;
};

/** A resposta que o gancho dá no lugar do supervisor; o id é o do comando. */
export type RespostaDoGancho = Omit<ResultadoComandoComputador, "id">;

export type GanchosDoComputador = {
  /** null = segue ao supervisor; senão, o comando volta na hora com esta resposta. Erro conta como `nao_iniciou`. */
  antesDeRepassar?: (c: ComandoComputador) => Promise<RespostaDoGancho | null>;
  aoRelato?: (e: EstadoComputadorRelatado) => void;
};

export type LacoComputador = { parar(): void; /** Só testes: uma volta do pedido de estado e do reenvio. */ batimento(): Promise<void> };

export function iniciarComputador(o: { canal: CanalDoMotor; socket?: string; batimentoMs?: number; dormir?: (ms: number) => Promise<void> } & GanchosDoComputador): LacoComputador {
  const caminho = o.socket ?? SOCKET_SUPERVISOR;
  const dormir = o.dormir ?? ((ms: number) => new Promise<void>((r) => { const t = setTimeout(r, ms); t.unref?.(); }));
  let parado = false;
  let sock: Socket | null = null;
  let abrindo: Promise<Socket | null> | null = null;
  const pendentes: RelatoComputador[] = [];

  function guardar(r: RelatoComputador) {
    pendentes.push(r);
    while (pendentes.length > RELATOS_GUARDADOS) pendentes.shift();
  }
  async function postar(r: RelatoComputador): Promise<boolean> {
    if (r.tipo === "resultado") { const { tipo: _t, ...resto } = r; return o.canal.resultado(resto); }
    const { tipo: _t, ...foto } = r; return o.canal.estado(foto);
  }
  async function relatar(r: RelatoComputador) {
    if (!(await postar(r).catch(() => false))) guardar(r);
  }
  async function reenviar() {
    const fila = pendentes.splice(0);
    for (const r of fila) await relatar(r);
  }

  function lerLinha(linha: string) {
    if (linha.trim() === "") return;
    let r: RelatoComputador;
    try { r = JSON.parse(linha) as RelatoComputador; } catch { log("aviso", "computador_linha_invalida", {}); return; }
    if (r?.tipo !== "resultado" && r?.tipo !== "estado") { log("aviso", "computador_linha_invalida", {}); return; }
    if (r.tipo === "estado" && o.aoRelato) {
      const { tipo: _t, ...foto } = r;
      try { o.aoRelato(foto); } catch (e) { log("aviso", "computador_gancho_falhou", { gancho: "aoRelato", erro: String(e) }); }
    }
    void relatar(r);
  }

  /** A conexão com o supervisor: uma só, reaberta sob demanda. null = o supervisor não está no ar. */
  function conectar(): Promise<Socket | null> {
    if (sock && !sock.destroyed) return Promise.resolve(sock);
    abrindo ??= new Promise<Socket | null>((resolver) => {
      const s = createConnection(caminho);
      let resto = "";
      s.setEncoding("utf8");
      s.once("connect", () => { sock = s; resolver(s); });
      s.on("data", (pedaco: string) => {
        resto += pedaco;
        if (resto.length > LINHA_MAX) { log("aviso", "computador_linha_grande", {}); resto = ""; return; }
        let i: number;
        while ((i = resto.indexOf("\n")) >= 0) { lerLinha(resto.slice(0, i)); resto = resto.slice(i + 1); }
      });
      s.on("error", () => resolver(null));
      s.on("close", () => { if (sock === s) sock = null; resolver(null); });
    }).finally(() => { abrindo = null; });
    return abrindo;
  }

  async function mandar(m: MensagemAoSupervisor): Promise<boolean> {
    const s = await conectar();
    if (!s) return false;
    return new Promise<boolean>((resolver) => s.write(`${JSON.stringify(m)}\n`, (e) => resolver(!e)));
  }

  async function repassar(c: ComandoComputador) {
    if (o.antesDeRepassar) {
      const resposta = await o.antesDeRepassar(c).catch((e: unknown): RespostaDoGancho => {
        log("aviso", "computador_gancho_falhou", { gancho: "antesDeRepassar", comando_id: c.id, erro: String(e) });
        return { desfecho: "falhou", motivo: "nao_iniciou" };
      });
      if (resposta) { await relatar({ tipo: "resultado", ...resposta, id: c.id }); return; }
    }
    if (await mandar({ tipo: "comando", comando: c })) return;
    log("aviso", "computador_supervisor_fora", { comando_id: c.id, tipo: c.tipo });
    await relatar({ tipo: "resultado", id: c.id, desfecho: "falhou", motivo: "nao_iniciou" });
  }

  async function batimento() {
    await reenviar();
    await mandar({ tipo: "pedir_estado" });
  }

  void (async () => {
    while (!parado) {
      const r = await o.canal.puxar().catch(() => null);
      if (parado) break;
      if (r === "sem_rota") { await dormir(ESPERA_SEM_ROTA_MS); continue; }
      if (r === null) { await dormir(ESPERA_SEM_RESPOSTA_MS); continue; }
      for (const c of r) await repassar(c);
    }
  })();
  const pulso = setInterval(() => void batimento(), o.batimentoMs ?? BATIMENTO_ESTADO_MS);
  pulso.unref?.();
  void batimento();

  return {
    parar() {
      parado = true;
      clearInterval(pulso);
      sock?.destroy();
      sock = null;
    },
    batimento,
  };
}
