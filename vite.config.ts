import { defineConfig } from "vite";
import path from "node:path";

// Portas: 5274 (web) e 8888 (api). 5173 e 5432 pertencem a outros projetos desta máquina.
const api = `http://127.0.0.1:${process.env.NOD_API_PORT ?? "8888"}`;

export default defineConfig({
  root: "web",
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
