/**
 * Flag floors (ADR-014 invertido): o CLI é o da pessoa, em 19 versões diferentes, e uma flag
 * desconhecida faz TODO turno falhar com erro de argumento. A tabela é conferida contra a versão
 * que a sonda leu (`claude --version`) ANTES de montar os args; abaixo do piso o driver recusa com
 * ErroDeDominio('executor_indisponivel', cause 'cli_antigo') em vez de gastar um turno.
 *
 * definido em 2026-09-16: o piso de TODAS as flags é 2.1.272 — a única versão sondada (mapa-cli).
 * Baixar um piso exige sondar a versão mais antiga; ninguém sondou. Como segunda prova, quando o
 * `--help` está disponível, uma flag listada nele passa mesmo abaixo do piso (o help é a própria
 * CLI dizendo o que aceita). `--max-turns` é a exceção: medido em 2026-09-16, não aparece no
 * `--help` de 2.1.272 e mesmo assim foi aceita (sonda s3) — só o piso a confere.
 */
export const FLAG_FLOORS = {
  "--strict-mcp-config": { piso: "2.1.272", ocultaNoHelp: false },
  "--setting-sources": { piso: "2.1.272", ocultaNoHelp: false },
  "--mcp-config": { piso: "2.1.272", ocultaNoHelp: false },
  "--tools": { piso: "2.1.272", ocultaNoHelp: false },
  "--allowedTools": { piso: "2.1.272", ocultaNoHelp: false },
  "--include-partial-messages": { piso: "2.1.272", ocultaNoHelp: false },
  "--session-id": { piso: "2.1.272", ocultaNoHelp: false },
  "--resume": { piso: "2.1.272", ocultaNoHelp: false },
  "--permission-mode": { piso: "2.1.272", ocultaNoHelp: false },
  "--append-system-prompt": { piso: "2.1.272", ocultaNoHelp: false },
  "--output-format": { piso: "2.1.272", ocultaNoHelp: false },
  "--verbose": { piso: "2.1.272", ocultaNoHelp: false },
  "--model": { piso: "2.1.272", ocultaNoHelp: false },
  // definido em 2026-09-18: continua na tabela mesmo tendo saído de FLAGS_DO_TURNO — sonda.ts ainda
  // usa --max-turns 1, onde o teto de passos é o desejado (turno de prova barato).
  "--max-turns": { piso: "2.1.272", ocultaNoHelp: true },
  // definido em 2026-09-18: sondadas na 2.1.276, onde o confinamento foi medido de fato — leitura
  // fora das pastas permitidas negada pelo CLI e CLAUDE.md do projeto ignorado. Piso na versão
  // sondada, não antes: o driver só aponta o cwd para a pasta da pessoa se o help trouxer a flag.
  "--restricted": { piso: "2.1.276", ocultaNoHelp: false },
  "--add-dir": { piso: "2.1.276", ocultaNoHelp: false },
  /**
   * definido em 2026-09-18: compacta o contexto em vez de deixar a tarefa longa bater no limite,
   * agora que o turno não é mais cortado por contagem de passos. Piso na versão sondada AQUI
   * (2.1.276, `--help` conferido); o openmausbot registra 2.1.122 como primeira aparição, mas essa
   * versão não foi sondada nesta máquina. Flag CONDICIONAL: fica fora de FLAGS_DO_TURNO e o gate
   * real é o `--help` lido no turno.
   */
  "--autocompact": { piso: "2.1.276", ocultaNoHelp: false },
  /** definido em 2026-09-28 (0037): o esforço do bot. Condicional como --autocompact; piso na versão sondada aqui. */
  "--effort": { piso: "2.1.284", ocultaNoHelp: false },
} as const satisfies Record<string, { piso: string; ocultaNoHelp: boolean }>;

export type FlagComPiso = keyof typeof FLAG_FLOORS;

export type ConferenciaFloors = { ok: true } | { ok: false; motivo: "cli_antigo"; abaixo: FlagComPiso[] };

/** "2.1.272 (Claude Code)" → "2.1.272"; null quando não há x.y.z. */
export function extrairVersao(saidaVersion: string): string | null {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(saidaVersion);
  return m ? `${m[1]}.${m[2]}.${m[3]}` : null;
}

/** Compara x.y.z numericamente (não como string): "2.1.272" > "2.1.9". */
export function compararVersoes(a: string, b: string): -1 | 0 | 1 {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return -1;
    if (x > y) return 1;
  }
  return 0;
}

/** Toda opção longa que o `--help` lista (`--allowedTools, --allowed-tools <tools...>` → as duas). */
export function flagsListadasNoHelp(help: string): string[] {
  const achadas = new Set<string>();
  for (const m of help.matchAll(/(?:^|[\s,])(--[a-zA-Z][a-zA-Z0-9-]*)/g)) {
    if (m[1]) achadas.add(m[1]);
  }
  return [...achadas];
}

export function conferirFloors(entrada: { versao: string; flags: readonly FlagComPiso[]; flagsNoHelp?: readonly string[] | null }): ConferenciaFloors {
  const abaixo: FlagComPiso[] = [];
  for (const flag of entrada.flags) {
    const regra = FLAG_FLOORS[flag];
    if (compararVersoes(entrada.versao, regra.piso) >= 0) continue;
    if (!regra.ocultaNoHelp && entrada.flagsNoHelp?.includes(flag)) continue;
    abaixo.push(flag);
  }
  return abaixo.length === 0 ? { ok: true } : { ok: false, motivo: "cli_antigo", abaixo };
}
