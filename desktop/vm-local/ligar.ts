import { cpus, freemem, totalmem } from "node:os";
import { type CanalDoMotor, iniciarComputador, type LacoComputador } from "../../src/adapters/executor/computador.ts";
import type { AnuncioComputador } from "../../src/contracts/computador-motor.ts";
import type { LeituraMemoria } from "../../src/contracts/trabalho.ts";
import type { VmLocalAnunciada } from "../../src/contracts/vm-local.ts";
import type { UsoDoMac } from "../../src/contracts/raio-x.ts";
import { deveSegurar } from "../../src/domain/memoria-mac.ts";
import { criarComputadorDaVm } from "./computador.ts";
import { nomeDoDisco } from "./download.ts";
import { origemDoDisco } from "./origem.ts";
import { criarPreparador, type Preparador } from "./preparador.ts";
import { type ArchMac, criarRuntimeVmLocal, vmLocalLigada } from "./runtime.ts";

/**
 * definido em 2026-10-24 (NOD-93, passo 9): a VM local montada no app do Mac. Só existe com `NOD_VM_LOCAL=1` num Mac
 * (desligada por padrão: sem ela o app não anuncia nada e o servidor nunca escolhe o Mac). Junta o runtime (Lima), o
 * preparador (download e fase, anunciada como `vmLocal`) e o fio (`iniciarComputador` com os ganchos da VM).
 *
 * O disco vem de `NOD_VM_DISCO_URL` (só https; padrão: o release do repo) e é conferido pelo sha256 embutido no app
 * (desktop/vm-local/origem.ts). Lacuna registrada no PR: o repo é privado, então o padrão só baixa quando o release for
 * público ou houver um espelho (decisão do Marlon); a URL fica configurável até lá.
 *
 * O uso do Mac (pouco/equilibrado/livre) chega em cada comando (`ComandoComputador.uso`): o fio segura pela régua da
 * ADR-085 nesse uso (Livre liga mesmo apertado) e liga a VM com `memoriaDaVm(uso, ram)`. O uso que muda vai também ao
 * preparo (`preparador.usar`: memória e régua do `esperando_memoria`); antes do primeiro comando, `equilibrado`.
 */

const USO_INICIAL: UsoDoMac = "equilibrado";

export type VmLocalDoApp = {
  preparador: Preparador;
  /** O que entra no anúncio da máquina (l. 494/578 do main.ts). */
  anuncio(): { computador: AnuncioComputador; vmLocal: VmLocalAnunciada };
  /** Sobe o fio do computador neste canal (um por conexão). */
  conectar(canal: CanalDoMotor): void;
  /** NOD-93 passo 10: a memória da VM ligada (MB), o bloco que sai do disponível do Mac no amostrador; 0 desligada. */
  memoriaMb(): number;
  /** powerMonitor `resume`. */
  aoAcordarDoMac(): Promise<void>;
  /** A conexão caiu: para o fio (a VM segue; o ocioso a desliga). */
  desconectar(): void;
  /** O app vai fechar: para o fio, o preparador e a VM. */
  parar(): Promise<void>;
};

export function anuncioDaVm(v: VmLocalAnunciada): { computador: AnuncioComputador; vmLocal: VmLocalAnunciada } {
  return { computador: { estado: v.estado === "macos_antigo" ? "sem_suporte" : "pronto" }, vmLocal: v };
}

export function montarVmLocal(o: {
  ambiente: Record<string, string | undefined>;
  plataforma: NodeJS.Platform;
  arch: string;
  versaoApp: string;
  macos: string;
  dadosApp: string;
  recursos: string;
  leitura: () => LeituraMemoria | undefined;
  aoMudar: (v: VmLocalAnunciada) => void;
}): VmLocalDoApp | null {
  if (!vmLocalLigada(o.ambiente) || o.plataforma !== "darwin") return null;
  const arch: ArchMac = o.arch === "x64" ? "x64" : "arm64";
  const base = criarRuntimeVmLocal({ dadosApp: o.dadosApp, recursos: o.recursos, ambiente: o.ambiente });
  // A memória que a VM pediu ao ligar (GiB); 0 = parada. Entra como bloco no amostrador (memoriaMb).
  let ligadaGiB = 0;
  let uso: UsoDoMac = USO_INICIAL;
  const usar = (u: UsoDoMac) => { if (u !== uso) { uso = u; preparador.usar(u); } };
  const runtime = {
    ...base,
    ligar: async (p: Parameters<typeof base.ligar>[0]) => { await base.ligar(p); ligadaGiB = p.memoriaGiB; },
    parar: async () => { await base.parar(); ligadaGiB = 0; },
    status: async () => { const s = await base.status(); if (s !== "ligada") ligadaGiB = 0; return s; },
  };
  const preparador = criarPreparador({
    versao: o.versaoApp,
    arch,
    macos: o.macos,
    cache: runtime.caminhos.cache,
    origem: origemDoDisco({ ambiente: o.ambiente, versao: o.versaoApp, recursos: o.recursos, nome: nomeDoDisco(o.versaoApp, arch === "x64" ? "amd64" : "arm64") }),
    modo: () => uso,
    ramBytes: totalmem(),
    livreBytes: freemem,
    cpus: Math.max(1, Math.min(4, Math.floor(cpus().length / 2))),
    parar: () => runtime.parar(),
    aoMudar: o.aoMudar,
    agora: Date.now,
  });
  const fio = criarComputadorDaVm({
    runtime,
    preparo: () => preparador.fase(),
    pedido: (u) => preparador.pedido(u),
    deveSegurar: (u) => { usar(u); const l = o.leitura(); return deveSegurar(u, l?.nivel ?? null, l?.processador?.nivel ?? null); },
    agora: Date.now,
  });
  let laco: LacoComputador | null = null;
  void preparador.iniciar();
  return {
    preparador,
    anuncio: () => anuncioDaVm(preparador.anuncio()),
    conectar(canal) {
      laco?.parar();
      laco = iniciarComputador({ canal, socket: runtime.caminhos.socket, antesDeRepassar: fio.antesDeRepassar, aoRelato: fio.aoRelato });
    },
    memoriaMb: () => ligadaGiB * 1024,
    aoAcordarDoMac: () => fio.aoAcordarDoMac(),
    desconectar() { laco?.parar(); laco = null; },
    async parar() {
      laco?.parar(); laco = null;
      preparador.parar();
      await runtime.parar().catch(() => undefined);
    },
  };
}
