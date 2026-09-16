import { defineConfig } from "vitest/config";

// Lê .env quando existe (Node 24 nativo, sem dependência). Sob CI as variáveis vêm do workflow.
try {
  process.loadEnvFile(".env");
} catch {
  // sem .env: ambiente já configurado (CI) ou testes de integração vão pular fora do CI
}

// Quatro modos de teste (ADR-011 refinado): unit sem banco, integration sob withRollback,
// conformidade lendo pg_catalog, concurrency com DUAS conexões e limpeza própria.
// fileParallelism fica ligado nos três primeiros porque o withRollback isola cada arquivo;
// concurrency roda serial porque disputa linhas de verdade.
// medido em 2026-09-16: `fileParallelism: false` DENTRO de um projeto não é honrado pelo vitest 3.2.7
// (dois arquivos de concurrency rodaram juntos e um reivindicou os turnos do outro); o que serializa
// os arquivos do projeto é pool 'forks' com singleFork. O fileParallelism fica como documentação.
const raiz = { exclude: ["node_modules", "dist", "prototypes"] };

export default defineConfig({
  test: {
    projects: [
      { test: { ...raiz, name: "unit", include: ["tests/unit/**/*.test.ts"] } },
      { test: { ...raiz, name: "integration", include: ["tests/integration/**/*.test.ts"] } },
      { test: { ...raiz, name: "conformidade", include: ["tests/conformidade/**/*.test.ts"] } },
      {
        test: {
          ...raiz,
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
