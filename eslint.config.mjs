// Fronteiras de camada por glob de DIRETÓRIO (herdado da Leapy, docs/inherited-from-leapy.md §3).
// O tsconfig.domain.json guarda a PUREZA (sem Node, sem DOM); este arquivo guarda a DIREÇÃO
// entre camadas. Cada mensagem ensina o caminho certo, não só proíbe.
// Mover um diretório sem atualizar este arquivo desliga a fronteira em silêncio (risco aceito, ADR-018).
import js from "@eslint/js";
import tseslint from "typescript-eslint";

/** Bloco de fronteira: `files` proíbe `padroes` com uma mensagem que ensina. */
const fronteira = (files, padroes, mensagem, opcoes = {}) => ({
  files,
  rules: {
    "@typescript-eslint/no-restricted-imports": [
      "error",
      {
        patterns: [{ group: padroes, message: mensagem, ...opcoes }],
      },
    ],
  },
});

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "prototypes/**", "docs/**", "web/public/**", ".claude/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.mjs"],
    languageOptions: { globals: { process: "readonly", console: "readonly" } },
  },
  {
    files: ["**/*.ts", "**/*.mjs"],
    rules: {
      // Sem `allow`: o único lugar com console é src/obs/log.ts (um eslint-disable, datado).
      "no-console": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },

  fronteira(
    ["src/domain/**/*.ts"],
    ["node:*", "postgres", "**/db/**", "**/repositories/**", "**/services/**", "**/use-cases/**", "**/adapters/**", "**/obs/**", "**/shared/types*"],
    "domínio é puro: receba dados e `agora: number` por parâmetro; só src/contracts e outros arquivos de src/domain entram aqui (ADR-018).",
  ),
  fronteira(
    ["src/contracts/**/*.ts"],
    ["node:*", "postgres", "**/db/**", "**/domain/**", "**/repositories/**", "**/services/**", "**/use-cases/**", "**/adapters/**", "**/obs/**"],
    "contratos são só tipos e `as const`: nada de fora de src/contracts entra aqui (EMENDA 26).",
  ),
  fronteira(
    ["src/use-cases/**/*.ts"],
    ["**/db/client*", "postgres", "**/adapters/**", "**/repositories/**"],
    "caso de uso recebe repos, services e tx pelo parâmetro deps; nunca abre conexão nem fala com HTTP/executor (ADR-018).",
    { allowTypeImports: true },
  ),
  fronteira(
    ["src/repositories/**/*.ts"],
    ["**/use-cases/**", "**/adapters/**", "**/services/**"],
    "repositório só conhece Conn e escopo: quem orquestra é o caso de uso (Leapy §1).",
  ),
  fronteira(
    ["src/services/**/*.ts"],
    ["**/db/**", "postgres", "**/repositories/**", "**/adapters/http/**"],
    "src/services é SEM BANCO (EMENDA 3): laço de fundo que abre transação mora em src/adapters/fundo; persistência entra por callback injetado.",
  ),
  fronteira(
    ["src/adapters/fundo/**/*.ts"],
    ["**/adapters/http/**"],
    "laço de fundo não conhece HTTP: publica eventos e abre transações por pessoa (EMENDA 3).",
  ),
  fronteira(
    ["src/adapters/executor/**/*.ts", "src/adapters/mcp-proxy/**/*.ts"],
    ["**/db/**", "**/repositories/**", "**/use-cases/**", "postgres"],
    "executor e proxy recebem plano e sinks; quem grava é o servidor (ADR-018, ADR-024).",
    { allowTypeImports: true },
  ),
  fronteira(
    ["web/**/*.ts"],
    ["**/src/**", "node:*", "postgres"],
    "a web só faz `import type` de src/contracts e src/shared/types.ts; dado chega pela API (ADR-018, ADR-020).",
    { allowTypeImports: true },
  ),

  {
    files: ["tests/**/*.ts"],
    ignores: ["tests/concurrency/**/*.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "TemplateElement[value.raw=/\\b(DELETE\\s+FROM|TRUNCATE)\\b/i]",
          message: "teste de integração usa withRollback, nunca limpa tabela; só tests/concurrency tem limpeza própria (Leapy §O que não trazer).",
        },
        {
          selector: "Literal[value=/\\b(DELETE\\s+FROM|TRUNCATE)\\b/i]",
          message: "teste de integração usa withRollback, nunca limpa tabela; só tests/concurrency tem limpeza própria (Leapy §O que não trazer).",
        },
      ],
    },
  },
);
