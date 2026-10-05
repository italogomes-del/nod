import { defineConfig } from "vitest/config";
import { apontarParaBancoDaWorktree } from "./tests/setup/banco-por-worktree.ts";

// Lê .env quando existe (Node 24 nativo, sem dependência). Sob CI as variáveis vêm do workflow.
try {
  process.loadEnvFile(".env");
} catch {
  // sem .env: ambiente já configurado (CI) ou testes de integração vão pular fora do CI
}

// definido em 2026-10-05: fora do CI cada worktree usa o próprio banco de teste (nod_test_<hash>), para
// bots rodando a suíte ao mesmo tempo não se contaminarem; o globalSetup cria e migra sob demanda.
apontarParaBancoDaWorktree();

// Quatro modos de teste (ADR-011 refinado): unit sem banco, integration sob withRollback,
// conformidade lendo pg_catalog, concurrency com DUAS conexões e limpeza própria.
// fileParallelism fica ligado nos três primeiros porque o withRollback isola cada arquivo;
// concurrency roda serial porque disputa linhas de verdade.
// medido em 2026-09-16: `fileParallelism: false` DENTRO de um projeto não é honrado pelo vitest 3.2.7
// (dois arquivos de concurrency rodaram juntos e um reivindicou os turnos do outro); o que serializa
// os arquivos do projeto é pool 'forks' com singleFork. O fileParallelism fica como documentação.
const raiz = { exclude: ["node_modules", "dist", "prototypes", ".claude"] };

/**
 * testTimeout dos projetos que tocam o banco (EMENDA-L9 §11, opção b): `npx vitest run` roda os quatro
 * projetos ao MESMO tempo e integration/conformidade/concurrency disputam o mesmo Postgres; sob disputa um
 * teste de ~600 ms encostava nos 5 s do default e a suíte piscava. medido em 2026-09-16 (árvore merjada,
 * antes da L9): 2 de 3 rodadas de `npx vitest run` falhavam só por "Test timed out in 5000ms", com
 * arquivos diferentes a cada rodada; rodando um projeto por vez, os quatro passavam. 20 s dá ~30x o
 * teste típico; `npm run check` continua serializando os projetos (opção a), então o número só vale
 * para quem roda tudo junto.
 */
const BANCO = {
  testTimeout: 20_000,
  hookTimeout: 30_000,
  globalSetup: ["tests/setup/banco-por-worktree.ts"],
};

export default defineConfig({
  test: {
    projects: [
      { test: { ...raiz, name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      { test: { ...raiz, ...BANCO, name: "integration", include: ["tests/integration/**/*.test.ts"] } },
      { test: { ...raiz, ...BANCO, name: "conformidade", include: ["tests/conformidade/**/*.test.ts"] } },
      {
        test: {
          ...raiz,
          ...BANCO,
          name: "concurrency",
          include: ["tests/concurrency/**/*.test.ts"],
          fileParallelism: false,
          pool: "forks",
          poolOptions: { forks: { singleFork: true } },
        },
      },
    ],
  },
});
