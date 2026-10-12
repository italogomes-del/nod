import { createHash } from "node:crypto";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as esperar } from "node:timers/promises";
import { ARQUIVOS_DO_MOTOR, ATUALIZACAO_PARADA, motorDiferente, proximoPasso, type EstadoDaAtualizacao } from "../src/domain/atualizacao-do-motor.ts";
import { log } from "../src/obs/log.ts";

/**
 * O motor que se atualiza sozinho (ADR-100), do lado do usuário `nod`. Ele NÃO troca os próprios arquivos (são do root,
 * e um bot roda como `nod`): só decide QUANDO e grava o pedido. O resto é do root:
 *
 *   motor (nod): manifesto ≠ arquivos daqui ──► espera um momento sem turno (ou drena) ──► grava ~/.config/nod-motor/atualizar
 *   systemd (root): nod-motor-atualizar.path vê o pedido ──► nod-motor-atualizar baixa do servidor da instalação, confere o
 *                   sha256 de cada arquivo, troca /opt/nod-motor/app e reinicia o serviço
 *
 * Só liga com `/etc/nod-motor/atualizar-sozinho` (a instalação o cria; `NOD_ATUALIZAR_SOZINHO=0` não): sem o atualizador,
 * o pedido nunca viraria reinício e o motor drenaria à toa.
 */

/** De quanto em quanto tempo o motor pergunta ao servidor e reavalia. */
export const INTERVALO_DA_ATUALIZACAO_MS = 5 * 60_000;
/** O puxar espera trabalho no servidor por até 20 s (ponte.ts, longpollMs): o dobro com folga. */
export const ESPERA_DO_PUXAR_EM_VOO_MS = 30_000;
export const MARCA_DA_ATUALIZACAO = "/etc/nod-motor/atualizar-sozinho";
export const arquivoDoPedido = (pastaDoMotor: string) => join(pastaDoMotor, "atualizar");

export async function shaDosArquivos(dir: string): Promise<Record<string, string | null>> {
  const r: Record<string, string | null> = {};
  for (const nome of ARQUIVOS_DO_MOTOR) r[nome] = await readFile(join(dir, nome)).then((b) => createHash("sha256").update(b).digest("hex"), () => null);
  return r;
}

/** O servidor de onde o root baixa (gravado na instalação). */
export const SERVIDOR_DA_INSTALACAO = "/etc/nod-motor/servidor";

/**
 * Ligada = a instalação criou a marca. Com `url`, também exige que o root baixe do MESMO servidor a que o motor está
 * conectado: a máquina pareada de novo com outro servidor (`nod-motor parear`) compararia com um e baixaria do outro,
 * drenando à toa a cada hora. Reinstalar pelo servidor novo acerta os dois.
 */
export async function atualizacaoLigada(o: { url?: string; marca?: string; servidor?: string } = {}): Promise<boolean> {
  if (!(await access(o.marca ?? MARCA_DA_ATUALIZACAO).then(() => true, () => false))) return false;
  if (o.url === undefined) return true;
  const doRoot = await readFile(o.servidor ?? SERVIDOR_DA_INSTALACAO, "utf8").then((t) => t.split("\n")[0]?.trim() ?? "", () => "");
  return doRoot === o.url;
}

export type Atualizador = { parar(): void; agora(): Promise<void> };

export function iniciarAtualizacao(o: {
  url: string;
  /** A pasta dos arquivos do motor em execução (/opt/nod-motor/app). */
  dir: string;
  pastaDoMotor: string;
  turnosRodando: () => number;
  drenar: (sim: boolean) => void;
  relogio?: () => number;
  buscar?: typeof fetch;
  intervaloMs?: number;
  esperaDoPuxarMs?: number;
}): Atualizador {
  const relogio = o.relogio ?? Date.now;
  const buscar = o.buscar ?? fetch;
  let estado: EstadoDaAtualizacao = ATUALIZACAO_PARADA;
  let locais: Record<string, string | null> | null = null;
  let emCurso: Promise<void> | null = null;
  let ultimoMotivo = "";

  /** Um passo por vez: quem chama durante um passo espera o mesmo, não começa outro. */
  function passo(): Promise<void> {
    emCurso ??= executar().finally(() => { emCurso = null; });
    return emCurso;
  }

  async function executar(): Promise<void> {
    try {
      locais ??= await shaDosArquivos(o.dir);
      const r = await buscar(`${o.url}/api/motor/manifesto`, { redirect: "error", signal: AbortSignal.timeout(15_000) }).catch(() => null);
      // Servidor fora ou antigo (sem a rota): fica como está, sem drenar.
      if (!r?.ok) return;
      const manifesto = (await r.json()) as { versao?: string; arquivos?: Record<string, string> };
      if (!manifesto.arquivos) return;
      const diferente = motorDiferente(locais, manifesto.arquivos);
      const p = proximoPasso(estado, { agora: relogio(), diferente, turnosRodando: o.turnosRodando() });
      if (p.estado.drenando !== estado.drenando) o.drenar(p.estado.drenando);
      estado = p.estado;
      if (p.motivo !== ultimoMotivo) {
        log(p.motivo === "pedido_falhou" ? "aviso" : "info", "motor_atualizacao", { motivo: p.motivo, versao_servidor: manifesto.versao ?? null, turnos: o.turnosRodando() });
        ultimoMotivo = p.motivo;
      }
      if (!p.pedir) return;
      // Um puxar em voo (a espera longa do servidor, até 20 s) ainda pode trazer um turno depois do drenar: espera ele
      // voltar e confere de novo, senão o reinício interromperia esse turno.
      await esperar(o.esperaDoPuxarMs ?? ESPERA_DO_PUXAR_EM_VOO_MS);
      if (o.turnosRodando() > 0) { estado = { ...estado, pedidoEm: null }; return; }
      await writeFile(arquivoDoPedido(o.pastaDoMotor), `${JSON.stringify({ versao: manifesto.versao ?? null, em: relogio() })}\n`, { mode: 0o600 });
    } catch (e) {
      log("aviso", "motor_atualizacao_falhou", { erro: e instanceof Error ? e.name : "desconhecido" });
    }
  }

  const t = setInterval(() => void passo(), o.intervaloMs ?? INTERVALO_DA_ATUALIZACAO_MS);
  t.unref();
  void passo();
  return {
    parar() { clearInterval(t); if (estado.drenando) o.drenar(false); },
    agora: passo,
  };
}
