import type { UsoDoMac } from "../contracts/raio-x.ts";
import type { LeituraDisco, LeituraMemoria, LeituraProcessador, MotivoEsperaMac, NivelPressao, Trabalho } from "../contracts/trabalho.ts";

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

/**
 * definido em 2026-10-09 (ADR-090): o nível de memória de uma máquina Linux (o motor numa VM), pelo `/proc/meminfo`. O
 * Linux não tem o nível de pressão do macOS; a fração `MemAvailable / MemTotal` faz o papel: amarela abaixo de 20%
 * livres, vermelha abaixo de 10%. Leitura sem os dois campos = verde, nunca um aviso que ninguém mediu.
 */
export function nivelDaMemoriaLinux(meminfo: string): NivelPressao {
  const campo = (nome: string) => Number(new RegExp(`^${nome}:\\s+(\\d+)`, "m").exec(meminfo)?.[1]);
  const total = campo("MemTotal");
  const livre = campo("MemAvailable");
  if (!Number.isFinite(total) || !Number.isFinite(livre) || total <= 0) return "verde";
  const fracao = livre / total;
  if (fracao < 0.1) return "vermelha";
  if (fracao < 0.2) return "amarela";
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
 * ADR-085: `turnoId` null é a leitura da máquina (a do `puxar`), sem linha de turno; o processador vai junto.
 */
export function leituraDoTurno(p: { nivel: NivelPressao; rssPorGrupo: ReadonlyMap<number, number>; gruposVivos: readonly number[]; turnoId: string | null; grupo: number | null; processador?: LeituraProcessador | null; disco?: LeituraDisco | null }): LeituraMemoria {
  const totalKib = [...new Set(p.gruposVivos)].reduce((t, g) => t + (p.rssPorGrupo.get(g) ?? 0), 0);
  const doTurno = p.grupo !== null ? p.rssPorGrupo.get(p.grupo) : undefined;
  return {
    nivel: p.nivel,
    totalMb: kibParaMb(totalKib),
    porTurno: doTurno !== undefined && p.turnoId !== null ? [{ turnoId: p.turnoId, mb: kibParaMb(doTurno) }] : [],
    ...(p.processador ? { processador: p.processador } : {}),
    // Revisão do #224: `null` vai junto (o app mede e não conseguiu); `undefined` (fora do macOS) não.
    ...(p.disco !== undefined ? { disco: p.disco } : {}),
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

/**
 * definido em 2026-10-08 (ADR-085, revisão do #209): o Mac apertado segura trabalho por no máximo 1 h. Depois ele roda
 * mesmo assim, um por vez (ESPACO_FUNDO_MS): rotina que nunca roda e pedido de colega que nunca volta são piores que
 * um Mac lento por alguns minutos. O log `fundo_comecou` traz a espera de cada um.
 */
export const ESPERA_MAXIMA_FUNDO_MS = 60 * 60_000;

/**
 * definido em 2026-10-08 (ADR-085, revisão do #209): entre dois trabalhos novos em segundo plano no mesmo Mac, 30 s — a
 * batida do amostrador. A leitura é de até 30 s atrás e a carga é a média do último minuto: sem o espaço, quando o Mac
 * alivia, tudo o que esperava começa na mesma leitura verde (o pico de 06/10 de novo).
 */
export const ESPACO_FUNDO_MS = 30_000;

/**
 * O Mac apertado seguraria este trabalho? Em segundo plano (rotina ou pedido de colega), ainda não começou, ninguém
 * esperando por ele (`pessoaEsperando`) e dentro da espera máxima. É a mesma regra do `reivindicar` (turnos.repo.ts).
 */
export function seguravelPeloMac(t: Pick<Trabalho, "origem" | "iniciadoEm" | "criadoEm" | "pessoaEsperando">, agora: number): boolean {
  return (t.origem === "rotina" || t.origem === "colega") && t.iniciadoEm === null && t.pessoaEsperando !== true && agora - t.criadoEm < ESPERA_MAXIMA_FUNDO_MS;
}

/** O pior de dois níveis (null = sem leitura). */
export function piorNivel(a: NivelPressao | null, b: NivelPressao | null): NivelPressao | null {
  if (a === null) return b;
  if (b === null) return a;
  return GRAVIDADE[b] > GRAVIDADE[a] ? b : a;
}

/**
 * Disco (definido em 2026-10-09, #219, emenda à ADR-085; revisto no mesmo dia pelo coordenador do épico #221, na
 * ausência do Marlon): dois limites absolutos de espaço livre, num lugar só. Abaixo de 10 GB é ALERTA — trabalho novo em
 * segundo plano espera, como a memória em alerta; abaixo de 3 GB é CRÍTICO — nada novo começa, em qualquer uso (trava de
 * segurança: commit, npm e Postgres falham no meio sem espaço). Sem regra percentual: 5% de 466 GB (23 GB) seguraria um
 * disco grande com folga de sobra. Em 09/10 o Mac do Marlon tinha 17 GB livres de 466 GB: nenhum dos dois.
 */
export const DISCO_ALERTA_MB = 10 * 1024;
export const DISCO_CRITICO_MB = 3 * 1024;
/**
 * Histerese (revisão do #224, definido em 2026-10-09): para sair de um nível o disco precisa passar um pouco do limite —
 * do crítico só acima de 3,5 GB, do alerta só acima de 11 GB. Sem ela, um disco parado perto do limite trocaria de nível a
 * cada leitura de 30 s, e a pílula e o frame `memoria.mudou` piscariam junto.
 */
export const DISCO_SAI_CRITICO_MB = 3.5 * 1024;
export const DISCO_SAI_ALERTA_MB = 11 * 1024;

/**
 * O nível do disco pelo espaço livre: amarela abaixo de 10 GB, vermelha abaixo de 3 GB; com o nível `anterior` (o da
 * leitura passada do mesmo Mac), a histerese acima. Sem leitura válida, null.
 */
export function nivelDoDisco(d: LeituraDisco | null | undefined, anterior: NivelPressao | null = null): NivelPressao | null {
  if (!d || !(d.totalMb > 0) || !(d.livreMb >= 0)) return null;
  if (d.livreMb < DISCO_CRITICO_MB || (anterior === "vermelha" && d.livreMb <= DISCO_SAI_CRITICO_MB)) return "vermelha";
  if (d.livreMb < DISCO_ALERTA_MB || ((anterior === "vermelha" || anterior === "amarela") && d.livreMb <= DISCO_SAI_ALERTA_MB)) return "amarela";
  return "verde";
}

/**
 * `NOD_SIMULAR_DISCO` força a leitura do disco (testes e UAT), em GB: "8" = 8 GB livres de 500; "17/466" = 17 livres de
 * 466. Outro valor ou ausente = ler do sistema.
 */
export function discoSimulado(valor: string | undefined): LeituraDisco | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:\/\s*(\d+(?:\.\d+)?))?\s*$/.exec(valor ?? "");
  if (!m) return null;
  const livre = Number(m[1]);
  const total = m[2] === undefined ? 500 : Number(m[2]);
  return total > 0 && livre <= total ? { livreMb: Math.round(livre * 1024), totalMb: Math.round(total * 1024) } : null;
}

/** `statfs` → MB: o livre é `bavail` (o que um processo sem privilégio pode gravar), não `bfree`. */
export function discoDoStatfs(s: { bsize: number | bigint; blocks: number | bigint; bavail: number | bigint }): LeituraDisco | null {
  const bsize = Number(s.bsize);
  const total = Number(s.blocks) * bsize;
  const livre = Number(s.bavail) * bsize;
  if (!Number.isFinite(total) || !Number.isFinite(livre) || total <= 0 || livre < 0) return null;
  return { livreMb: Math.floor(livre / 1048576), totalMb: Math.floor(total / 1048576) };
}

/**
 * O portão do Mac no `reivindicar` (definido em 2026-10-09, #219, emenda à ADR-085; revisto no mesmo dia pelo
 * coordenador do épico #221), pela leitura de UM Mac:
 * - `tudoNovo`: disco crítico (< 3 GB) — nada novo começa, nem a task da pessoa, nem o "Executar agora"; vale em
 *   qualquer uso, até em "O quanto precisar".
 * - `fundo`: só trabalho novo em segundo plano espera (rotina, pedido de colega, a volta marcada); o que a pessoa pediu
 *   passa. Por memória crítica, disco em alerta, memória em alerta ou processador (`deveSegurar`), nunca em "livre".
 * - `semPrazo`: memória crítica — o segundo plano espera mesmo depois da espera máxima de 1 h.
 * A volta marcada de uma task já começada (ADR-086) só espera pelo disco crítico (revisão do #224: é o próximo passo de
 * algo que já começou).
 * O motivo vai para a linha da task, pela gravidade: disco crítico, memória crítica, disco em alerta, memória em alerta,
 * processador. Sem leitura, nada espera.
 */
export type PortaoDoMac = { fundo: MotivoEsperaMac | null; tudoNovo: MotivoEsperaMac | null; semPrazo: boolean };

const PORTAO_ABERTO: PortaoDoMac = { fundo: null, tudoNovo: null, semPrazo: false };

export function portaoDoMac(uso: UsoDoMac, l: { memoria: NivelPressao | null; processador: NivelPressao | null; discoNivel?: NivelPressao | null } | null): PortaoDoMac {
  if (!l) return PORTAO_ABERTO;
  // O nível já vem com a histerese (trabalhos-vivos.ts guarda o anterior de cada Mac).
  const disco = l.discoNivel ?? null;
  if (disco === "vermelha") return { fundo: "disco", tudoNovo: "disco", semPrazo: false };
  if (uso === "livre") return PORTAO_ABERTO;
  if (l.memoria === "vermelha") return { fundo: "memoria", tudoNovo: null, semPrazo: true };
  if (disco === "amarela") return { fundo: "disco", tudoNovo: null, semPrazo: false };
  if (!deveSegurar(uso, l.memoria, l.processador)) return PORTAO_ABERTO;
  return { fundo: peloMenos(l.memoria, "amarela") ? "memoria" : "processador", tudoNovo: null, semPrazo: false };
}

/**
 * Por que o Mac segura este trabalho agora (null = não segura). É a regra do `reivindicar` (turnos.repo.ts): com
 * `tudoNovo`, todo trabalho que ainda não começou; com `fundo`, só o que `seguravelPeloMac` aceita (com `semPrazo`,
 * também o que passou da espera máxima). Revisão do #224: a volta marcada vencida ("me chame às 16:00", ADR-086) de task
 * sem turno vivo também, pelo disco crítico (o único que a segura), para a linha dizer "esperando…" em vez de "volta às
 * 16:00" já passado.
 */
export function esperaDoMac(t: Pick<Trabalho, "estado" | "origem" | "iniciadoEm" | "criadoEm" | "pessoaEsperando"> & { acordaEm?: number | null; turnoVivoId?: string | null }, portao: PortaoDoMac, agora: number): MotivoEsperaMac | null {
  if (t.acordaEm != null && t.acordaEm <= agora && !t.turnoVivoId && (t.estado === "rodando" || t.estado === "na_fila")) return portao.tudoNovo;
  if (t.estado !== "na_fila") return null;
  if (portao.tudoNovo && t.iniciadoEm === null) return portao.tudoNovo;
  if (portao.fundo && seguravelPeloMac(portao.semPrazo ? { ...t, criadoEm: agora } : t, agora)) return portao.fundo;
  return null;
}
