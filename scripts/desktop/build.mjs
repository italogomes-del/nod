import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
await mkdir("dist/desktop", { recursive: true });
const compilado = await build({ metafile: true, entryPoints: ["desktop/main.ts", "desktop/proxy.ts"], outdir: "dist/desktop", outExtension: { ".js": ".mjs" }, bundle: true, platform: "node", target: "node24", format: "esm", external: ["electron"], logLevel: "warning" });
for (const arquivo of Object.keys(compilado.metafile.inputs)) {
  if (/src\/(db|repositories|use-cases)\/|src\/adapters\/(http|fundo)\//.test(arquivo)) throw new Error(`Servidor não pode entrar no app desktop: ${arquivo}`);
}
await build({ entryPoints: ["desktop/preload.ts"], outfile: "dist/desktop/preload.cjs", bundle: true, platform: "node", format: "cjs", external: ["electron"], logLevel: "warning" });
for (const nome of ["setup.html", "setup.css", "setup.js"]) await copyFile(`desktop/${nome}`, `dist/desktop/${nome}`);
