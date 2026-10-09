import { describe, expect, it } from "vitest";
import { ehArquivoDeCompose, ignoradoRegeneravel, LIMPAR_APOS_MS, motivoDaRecusa, pastaDeTask, protegidoPorMontagem, quandoLimpar, RETOMADA_POSSIVEL_MS, type FatosLimpeza } from "../../../src/domain/limpeza-das-tasks.ts";

const AGORA = Date.UTC(2026, 9, 9, 12);
const DIA = 24 * 3_600_000;
const base = (f: Partial<FatosLimpeza> = {}): FatosLimpeza => ({ estado: "terminado", terminadoEm: AGORA - 4 * DIA, pasta: "~/nod/Dev 1/fix-filtros-abc123", turnosVivos: 0, decisaoPendente: false, pastaDividida: false, ...f });

describe("quem pode ser limpo (ADR-088)", () => {
  it("terminada ou falha há mais de 3 dias: encerrada", () => {
    expect(quandoLimpar(base(), AGORA)).toBe("encerrada");
    expect(quandoLimpar(base({ estado: "falhou" }), AGORA)).toBe("encerrada");
    expect(quandoLimpar(base({ terminadoEm: AGORA - LIMPAR_APOS_MS }), AGORA)).toBe("encerrada");
  });

  it("task ativa nunca é limpa (qualquer estado aberto), nem a parada pela pessoa", () => {
    for (const estado of ["na_fila", "rodando", "precisa_de_voce", "fechado_ocioso", "parado"] as const) expect(quandoLimpar(base({ estado, terminadoEm: estado === "parado" ? AGORA - 10 * DIA : null }), AGORA), estado).toBeNull();
  });

  it("task com retomada marcada (turno pendente ou volta com acordar_em) ou decisão pendente não é limpa", () => {
    expect(quandoLimpar(base({ turnosVivos: 1 }), AGORA)).toBeNull();
    expect(quandoLimpar(base({ decisaoPendente: true }), AGORA)).toBeNull();
    expect(quandoLimpar(base({ pastaDividida: true }), AGORA)).toBeNull();
  });

  it("nas 2 h depois de encerrar nada sai (retomada automática, ADR-084); entre 2 h e 3 dias, só com PR mergeado", () => {
    expect(quandoLimpar(base({ terminadoEm: AGORA - RETOMADA_POSSIVEL_MS + 1 }), AGORA)).toBeNull();
    expect(quandoLimpar(base({ terminadoEm: AGORA - RETOMADA_POSSIVEL_MS }), AGORA)).toBe("so_com_pr_mergeado");
    expect(quandoLimpar(base({ terminadoEm: AGORA - LIMPAR_APOS_MS + 1 }), AGORA)).toBe("so_com_pr_mergeado");
  });

  it("só pasta de task (~/nod/<bot>/<slug>): a raiz do bot, caminho fora de ~/nod e com .. ficam de fora", () => {
    expect(pastaDeTask("~/nod/Dev 1/fix-filtros-abc123")).toBe("Dev 1/fix-filtros-abc123");
    for (const p of [null, "~/nod/Dev 1", "~/nod/Dev 1/a/b", "/Users/m/nod/Dev 1/x", "~/nod/Dev 1/..", "~/nod/../code/x", "~/nod/Dev 1/.escondida", "~/nod//x"]) expect(pastaDeTask(p), String(p)).toBeNull();
    expect(quandoLimpar(base({ pasta: "~/nod/Dev 1" }), AGORA)).toBeNull();
  });
});

describe("proteções do disco (ADR-088)", () => {
  it("montagem dentro da worktree (ou nela) protege; montagem que a contém não", () => {
    const wt = "/Users/m/nod/Eng 1/nod-169";
    expect(protegidoPorMontagem(wt, ["/Users/m/nod/Eng 1/nod-169/infra/postgres/init"])).toBe(true);
    expect(protegidoPorMontagem(wt, [wt])).toBe(true);
    expect(protegidoPorMontagem(wt, ["/Users/m/nod"])).toBe(false);
    expect(protegidoPorMontagem(wt, ["/Users/m/nod/Eng 1/nod-1690/init"])).toBe(false);
    expect(protegidoPorMontagem("relativo/x", [])).toBe(true);
  });

  it("revisão #225: a comparação das montagens é NFC e sem caixa (APFS)", () => {
    const nfc = "/Users/m/nod/Cecília/task-abc123/nod";
    const nfd = "/users/m/NOD/Cecília".normalize("NFD") + "/task-abc123/nod/infra/init";
    expect(protegidoPorMontagem(nfc, [nfd])).toBe(true);
    expect(protegidoPorMontagem(nfc.normalize("NFD").toUpperCase(), [`${nfc}/init`])).toBe(true);
  });

  it("revisão #225: só o ignorado que se refaz pode sair junto com a worktree", () => {
    for (const c of ["node_modules/", "packages/web/node_modules/", "dist/", "apps/x/.next/", "coverage/", ".turbo/", "npm-debug.log", ".DS_Store", "tsconfig.tsbuildinfo", "a/__pycache__/"]) expect(ignoradoRegeneravel(c), c).toBe(true);
    for (const c of [".env", ".env.local", "backups/", "backups/local/nod.dump", ".claude/", "dados.sqlite", ""]) expect(ignoradoRegeneravel(c), c).toBe(false);
  });

  it("arquivos de compose reconhecidos", () => {
    for (const n of ["docker-compose.yml", "docker-compose.yaml", "compose.yml", "compose.yaml", "docker-compose.efemero.yml"]) expect(ehArquivoDeCompose(n), n).toBe(true);
    for (const n of ["package.json", "compose.ts", "docker-compose.yml.bak"]) expect(ehArquivoDeCompose(n), n).toBe(false);
  });

  it("a recusa do git vira motivo", () => {
    expect(motivoDaRecusa("fatal: '/x' contains modified or untracked files, use --force to delete it")).toBe("suja");
    expect(motivoDaRecusa("fatal: cannot remove a locked working tree, lock reason: x\nuse 'remove -f -f' to override or unlock first")).toBe("travada");
    expect(motivoDaRecusa("fatal: '/x' is not a working tree")).toBe("erro");
  });
});
