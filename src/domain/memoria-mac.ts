import type { UsoDoMac } from "../contracts/raio-x.ts";
import type { LeituraMemoria, LeituraProcessador, NivelPressao } from "../contracts/trabalho.ts";

/**
 * Memória do Mac (definido em 2026-10-07, ADR-083 §4, #194): o mapa do nível de pressão do macOS e a soma da memória
 * por grupo de processos. Puro: quem lê `sysctl` e `ps` é o adapter (src/adapters/executor/amostrador-memoria.ts).
 */

/**
 * `kern.memorystatus_vm_pressure_level`: 1 = normal (verde), 2 = aviso (amarela), 4 = crítica (vermelha). Qualquer
 * outra coisa (sysctl falhou, fora do macOS, saída estranha) é verde: o aviso nunca nasce de uma leitura que falhou.
 */
export function nivelDaPressao(bruto: string | number | null | undefined): NivelPressao {
  const n = typeof bruto === "number" ? bruto : Number(String(bruto ?? "").trim());
  if (n === 2) return "amarela";
  if (n === 4) return "vermelha";
  return "verde";
}

/** `NOD_SIMULAR_PRESSAO=1|2|4` força o nível (testes e UAT); outro valor ou ausente = ler do sistema. */
export function pressaoSimulada(valor: string | undefined): NivelPressao | null {
  const v = valor?.trim();
  return v === "1" || v === "2" || v === "4" ? nivelDaPressao(v) : null;
}

/**
 * `ps -A -o pgid=,rss=` → RSS somado por grupo, em KiB. O `ps -g` do macOS não filtra por grupo de forma confiável,
 * então a soma é feita aqui. Linha que não tem os dois números é ignorada.
 */
export function somarPorGrupo(saidaPs: string): Map<number, number> {
  const soma = new Map<number, number>();
  for (const linha of saidaPs.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s*$/.exec(linha);
    if (!m) continue;
    const grupo = Number(m[1]);
    soma.set(grupo, (soma.get(grupo) ?? 0) + Number(m[2]));
  }
  return soma;
}

const kibParaMb = (kib: number) => Math.round(kib / 1024);

/**
 * A leitura de um turno: o nível, o total dos grupos dos turnos vivos desta máquina e a linha do turno que renova
 * (só se ele tem grupo medido). Turno sem grupo (harness sem `processoProprio`) leva só o nível e o total.
 */
export function leituraDoTurno(p: { nivel: NivelPressao; rssPorGrupo: ReadonlyMap<number, number>; gruposVivos: readonly number[]; turnoId: string | null; grupo: number | null; processador?: LeituraProcessador | null }): LeituraMemoria {
  const totalKib = [...new Set(p.gruposVivos)].reduce((t, g) => t + (p.rssPorGrupo.get(g) ?? 0), 0);
  const doTurno = p.grupo !== null ? p.rssPorGrupo.get(p.grupo) : undefined;
  return {
    nivel: p.nivel,
    totalMb: kibParaMb(totalKib),
    porTurno: doTurno !== undefined && p.turnoId !== null ? [{ turnoId: p.turnoId, mb: kibParaMb(doTurno) }] : [],
    ...(p.processador ? { processador: p.processador } : {}),
  };
}

/**
 * Processador (definido em 2026-10-08, ADR-085). `vm.loadavg` do macOS sai como "{ 2.43 2.12 1.98 }": a primeira é a
 * carga média do último minuto. Saída estranha = null (sem leitura, nunca um aviso que a máquina não deu).
 */
export function cargaDoLoadavg(bruto: string): number | null {
  const n = Number(/[\d.]+/.exec(bruto)?.[0]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * A carga por núcleo vira nível. definido em 2026-10-08: amarela a partir de 0,7 (o Mac já disputa processador com o
 * que a pessoa está fazendo) e vermelha a partir de 1,0 (fila de processos esperando núcleo: tudo fica lento). Em 06/10
 * o diário chegou a 265 em 12 núcleos (22 por núcleo) com 8 bots ao mesmo tempo.
 */
export const CARGA_AMARELA = 0.7;
export const CARGA_VERMELHA = 1.0;

export function nivelDoProcessador(carga: number, nucleos: number): LeituraProcessador {
  const porNucleo = nucleos > 0 ? carga / nucleos : 0;
  const arredondada = Math.round(porNucleo * 100) / 100;
  return { nivel: porNucleo >= CARGA_VERMELHA ? "vermelha" : porNucleo >= CARGA_AMARELA ? "amarela" : "verde", carga: arredondada };
}

const GRAVIDADE: Record<NivelPressao, number> = { verde: 0, amarela: 1, vermelha: 2 };
const peloMenos = (n: NivelPressao | null | undefined, minimo: NivelPressao): boolean => n !== null && n !== undefined && GRAVIDADE[n] >= GRAVIDADE[minimo];

/**
 * Trabalho novo em segundo plano espera? (definido em 2026-10-08, ADR-085). Conversa com a pessoa e ligação nunca
 * passam por aqui (o `reivindicar` só segura trabalho que ainda não começou). Sem leitura de um lado, ele não segura.
 * - pouco: a memória em alerta ou o processador começando a apertar (amarela);
 * - equilibrado: a memória em alerta ou o processador cheio (vermelha);
 * - livre: nunca — só o aviso da ADR-083.
 */
export function deveSegurar(uso: UsoDoMac, memoria: NivelPressao | null, processador: NivelPressao | null): boolean {
  if (uso === "livre") return false;
  if (peloMenos(memoria, "amarela")) return true;
  return peloMenos(processador, uso === "pouco" ? "amarela" : "vermelha");
}

/** O pior de dois níveis (null = sem leitura). */
export function piorNivel(a: NivelPressao | null, b: NivelPressao | null): NivelPressao | null {
  if (a === null) return b;
  if (b === null) return a;
  return GRAVIDADE[b] > GRAVIDADE[a] ? b : a;
}
