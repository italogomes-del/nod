import js from "@eslint/js";
import tseslint from "typescript-eslint";

const fronteira = (from, blocked) => ({
  files: [from],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: blocked.map((p) => ({
          group: [p],
          message: `Fronteira de módulo: ${from} não importa ${p} (ADR-018).`,
        })),
      },
    ],
  },
});

export default tseslint.config(
  { ignores: ["dist/**", "node_modules/**", "prototypes/**", "docs/**", "data/**", "scripts/**"] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  fronteira("core/**/*.ts", ["node:*", "fs", "http", "db/*", "http/*", "agent/*", "drivers/*", "web/*"]),
  fronteira("db/**/*.ts", ["http/*", "agent/*", "web/*"]),
  fronteira("web/**/*.ts", ["db/*", "http/*", "agent/*", "drivers/*", "node:*"]),
);
