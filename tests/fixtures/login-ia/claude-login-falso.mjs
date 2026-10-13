#!/usr/bin/env node
// Um `claude` falso para o login pela tela (ADR-102): `auth login` imprime o link oficial e espera o código no stdin;
// com o código certo (CODIGO_CERTO), grava a conta na pasta da conta (CLAUDE_CONFIG_DIR) e sai com 0. `auth status`
// devolve o JSON do Claude Code 2.1.296 com a conta da pasta; `auth logout` apaga a conta. O e-mail vem de EMAIL_FALSO.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const pasta = process.env.CLAUDE_CONFIG_DIR || join(process.env.HOME || "/tmp", ".claude");
const arquivo = join(pasta, "conta-falsa.json");
const [a, b] = process.argv.slice(2);
if (a === "--version") { console.log("2.1.296 (Claude Code)"); process.exit(0); }
if (a === "auth" && b === "status") {
  if (!existsSync(arquivo)) { console.log(JSON.stringify({ loggedIn: false })); process.exit(1); }
  const c = JSON.parse(readFileSync(arquivo, "utf8"));
  console.log(JSON.stringify({ loggedIn: true, authMethod: "claude.ai", apiProvider: "firstParty", email: c.email, orgId: c.orgId, orgName: "Empresa", subscriptionType: "max" }));
  process.exit(0);
}
if (a === "auth" && b === "logout") { rmSync(arquivo, { force: true }); console.log("Logged out"); process.exit(0); }
if (a === "auth" && b === "login") {
  console.log("Browser didn't open? Use the url below to sign in (c to copy)");
  console.log("https://claude.com/cai/oauth/authorize?code=true&client_id=falso&state=xyz");
  console.log("Paste code here if prompted >");
  const rl = createInterface({ input: process.stdin });
  rl.on("line", (linha) => {
    if (linha.trim() !== (process.env.CODIGO_CERTO || "codigo-certo-123")) { console.error("OAuth error: Invalid code"); process.exit(1); }
    mkdirSync(pasta, { recursive: true });
    writeFileSync(arquivo, JSON.stringify({ email: process.env.EMAIL_FALSO || "pessoa@exemplo.com", orgId: process.env.ORG_FALSA || "org-1" }));
    console.log("Login successful.");
    process.exit(0);
  });
} else {
  process.exit(2);
}
