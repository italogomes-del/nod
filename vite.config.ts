import { defineConfig } from "vite";
import path from "node:path";

export default defineConfig({
  root: "web",
  publicDir: "public",
  resolve: {
    alias: {
      contracts: path.resolve("contracts"),
      core: path.resolve("core"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8787",
    },
  },
  build: {
    outDir: path.resolve("dist/web"),
    emptyOutDir: true,
  },
});
