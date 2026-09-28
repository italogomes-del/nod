import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
await mkdir("dist/desktop", { recursive: true });
const compilado = await build({ metafile: true, entryPoints: ["desktop/main.ts", "desktop/proxy.ts", "desktop/hook-nativas.ts"], outdir: "dist/desktop", outExtension: { ".js": ".mjs" }, bundle: true, platform: "node", target: "node24", format: "esm", external: ["electron"], logLevel: "warning" });
for (const arquivo of Object.keys(compilado.metafile.inputs)) {
  if (/src\/(db|repositories|use-cases)\/|src\/adapters\/(http|fundo)\//.test(arquivo)) throw new Error(`Servidor não pode entrar no app desktop: ${arquivo}`);
}
await build({ entryPoints: ["desktop/preload.ts"], outfile: "dist/desktop/preload.cjs", bundle: true, platform: "node", format: "cjs", external: ["electron"], logLevel: "warning" });
// definido em 2026-09-24 ("aviso no Mac"): o preload da janela web (só `nodDesktop`), separado do da tela de conexão.
const web = await build({ metafile: true, entryPoints: ["desktop/preload-web.ts"], outfile: "dist/desktop/preload-web.cjs", bundle: true, platform: "node", format: "cjs", external: ["electron"], logLevel: "warning" });
for (const arquivo of Object.keys(web.metafile.inputs)) {
  if (!/^(desktop\/preload-web\.ts|src\/contracts\/[a-z-]+\.ts)$/.test(arquivo)) throw new Error(`O preload da janela web só leva contratos: ${arquivo}`);
}
for (const nome of ["setup.html", "setup.css", "setup.js"]) await copyFile(`desktop/${nome}`, `dist/desktop/${nome}`);
