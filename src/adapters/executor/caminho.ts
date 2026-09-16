import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir, userInfo } from "node:os";
import { delimiter, isAbsolute, join } from "node:path";

/**
 * Resolução do caminho do binário (ADR-014 invertido): app aberto pelo Finder herda PATH pelado
 * (/usr/bin:/bin:/usr/sbin:/sbin) e o `claude` da pessoa mora em ~/.local/bin ou no Homebrew.
 * Nada aqui instala nem pina versão: só encontra o que já está na máquina.
 */

/** definido em 2026-09-16: onde o instalador oficial (~/.local/bin) e o Homebrew (arm64 e intel) deixam o binário. */
export const DIRETORIOS_EXTRAS = ["~/.local/bin", "/opt/homebrew/bin", "/usr/local/bin"] as const;

/**
 * A casa da PESSOA (passwd via os.userInfo), não `$HOME`. definido em 2026-09-16: `~` na configuração
 * do nod (NOD_CLAUDE_BIN, NOD_HOME, ~/.local/bin no PATH) aponta para onde o binário está instalado e
 * isso não muda quando `$HOME` é sobrescrito; `$HOME` é só o ambiente que o CLI herda (credenciais em
 * ~/.claude). Assim `HOME=$(mktemp -d) node scripts/sonda.ts` acha o CLI e responde nao_autenticado.
 * Sem entrada no passwd (contêiner mínimo) cai em `$HOME` e depois em os.homedir().
 */
export function homeDaPessoa(env: Readonly<Record<string, string | undefined>>): string {
  try {
    const h = userInfo().homedir;
    if (h && h.trim() !== "") return h;
  } catch {
    // sem entrada no passwd
  }
  return env.HOME ?? homedir();
}

export function expandirTil(caminho: string, home: string): string {
  if (caminho === "~") return home;
  if (caminho.startsWith("~/")) return join(home, caminho.slice(2));
  return caminho;
}

/** PATH atual + diretórios extras + (opcional) o PATH do shell de login, sem repetição e na ordem. */
export function caminhoAumentado(pathAtual: string | undefined, home: string, pathDoShellDeLogin: string | null = null): string {
  const vistos = new Set<string>();
  const saida: string[] = [];
  const acrescentar = (lista: string | undefined) => {
    for (const bruto of (lista ?? "").split(delimiter)) {
      const dir = expandirTil(bruto.trim(), home);
      if (dir === "" || vistos.has(dir)) continue;
      vistos.add(dir);
      saida.push(dir);
    }
  };
  acrescentar(pathAtual);
  acrescentar(DIRETORIOS_EXTRAS.join(delimiter));
  acrescentar(pathDoShellDeLogin ?? undefined);
  return saida.join(delimiter);
}

/**
 * Captura o PATH exportado pelo shell de login (.zprofile/.zshrc), como o app da Leapy faz em
 * background (ADR-014). Melhor esforço: qualquer falha ou demora devolve null e o chamador segue
 * só com os diretórios extras. definido em 2026-09-16: 3 s de teto — um shell com nvm/mise carrega em menos.
 */
export function caminhoDoShellDeLogin(shell: string | undefined, timeoutMs = 3_000): Promise<string | null> {
  if (!shell || !isAbsolute(shell)) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(shell, ["-l", "-c", 'printf "%s" "$PATH"'], { timeout: timeoutMs, encoding: "utf8" }, (erro, stdout) => {
      if (erro || typeof stdout !== "string" || stdout.trim() === "") resolve(null);
      else resolve(stdout.trim());
    });
  });
}

async function executavel(caminho: string): Promise<boolean> {
  try {
    await access(caminho, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Caminho absoluto do binário: `bin` explícito (NOD_CLAUDE_BIN, com ~) tem que existir e ser
 * executável; ausente → primeiro `claude` no PATH aumentado. null = ausente (Inventario 'ausente').
 */
export async function resolverBinario(bin: string | undefined, path: string, home: string, nome = "claude"): Promise<string | null> {
  if (bin && bin.trim() !== "") {
    const caminho = expandirTil(bin.trim(), home);
    if (isAbsolute(caminho)) return (await executavel(caminho)) ? caminho : null;
    return null;
  }
  for (const dir of path.split(delimiter)) {
    if (dir === "") continue;
    const candidato = join(dir, nome);
    if (await executavel(candidato)) return candidato;
  }
  return null;
}
