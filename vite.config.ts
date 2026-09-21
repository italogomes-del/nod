import { defineConfig } from "vite";
import path from "node:path";
import { createRequire } from "node:module";

// definido em 2026-09-21 (ADR-041): a versão do build vai no bundle para o relato dizer em qual
// app o comportamento aconteceu. Sem isto o front não tem como saber a própria versão.
const { version } = createRequire(import.meta.url)("./package.json") as { version: string };

// Portas: 5274 (web) e 8888 (api). 5173 e 5432 pertencem a outros projetos desta máquina.
const api = `http://127.0.0.1:${process.env.NOD_API_PORT ?? "8888"}`;

export default defineConfig({
  root: "web",
  define: { __NOD_VERSAO__: JSON.stringify(version) },
  publicDir: "public",
  server: {
    host: "127.0.0.1",
    port: Number(process.env.NOD_WEB_PORT ?? "5274"),
    proxy: {
      // SSE (ADR-016): sem buffer e sem timeout no proxy do Vite.
      "^/api/t/[^/]+/eventos": {
        target: api,
        changeOrigin: false,
        ws: false,
        timeout: 0,
        proxyTimeout: 0,
        configure(proxy) {
          proxy.on("proxyRes", (proxyRes) => {
            proxyRes.headers["x-accel-buffering"] = "no";
            proxyRes.headers["cache-control"] = "no-cache";
          });
        },
      },
      "/api": api,
    },
  },
  build: {
    outDir: path.resolve("dist/web"),
    emptyOutDir: true,
  },
});
