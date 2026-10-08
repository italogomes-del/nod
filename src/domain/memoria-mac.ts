import type { LeituraMemoria, NivelPressao } from "../contracts/trabalho.ts";

/**
 * Memória do Mac (definido em 2026-10-07, ADR-081 §4, #194): o mapa do nível de pressão do macOS e a soma da memória
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
export function leituraDoTurno(p: { nivel: NivelPressao; rssPorGrupo: ReadonlyMap<number, number>; gruposVivos: readonly number[]; turnoId: string; grupo: number | null }): LeituraMemoria {
  const totalKib = [...new Set(p.gruposVivos)].reduce((t, g) => t + (p.rssPorGrupo.get(g) ?? 0), 0);
  const doTurno = p.grupo !== null ? p.rssPorGrupo.get(p.grupo) : undefined;
  return { nivel: p.nivel, totalMb: kibParaMb(totalKib), porTurno: doTurno !== undefined ? [{ turnoId: p.turnoId, mb: kibParaMb(doTurno) }] : [] };
}
