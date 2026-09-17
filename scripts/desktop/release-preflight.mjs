import { readFile } from "node:fs/promises";
const pacote = JSON.parse(await readFile("package.json", "utf8"));
const ref = process.env.GITHUB_REF ?? "";
if (ref.startsWith("refs/tags/") && ref !== `refs/tags/v${pacote.version}`) throw new Error("A tag deve corresponder à versão do package.json");
for (const nome of ["CSC_LINK", "CSC_KEY_PASSWORD", "APPLE_ID", "APPLE_APP_SPECIFIC_PASSWORD", "APPLE_TEAM_ID"]) {
  if (!process.env[nome]) throw new Error(`Configure o secret de release correspondente a ${nome}`);
}
