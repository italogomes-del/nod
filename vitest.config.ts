import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      contracts: path.resolve("contracts"),
      core: path.resolve("core"),
    },
  },
  test: {
    include: ["**/*.test.ts"],
    exclude: ["node_modules", "dist", "prototypes"],
    fileParallelism: true,
  },
});
