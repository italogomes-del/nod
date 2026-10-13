import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * O que o motor sem janela guarda (ADR-090): o endereço do servidor e a chave da máquina (ADR-031). No Mac isso fica
 * cifrado pelo Keychain (`safeStorage`); aqui fica num arquivo só do usuário `nod`, com permissão 0600, numa máquina que a
 * pessoa usa só para o Nod. A chave crua nunca vai para log.
 */
export type ConexaoMotor = { url: string; chave: string };

/** `NOD_MOTOR_HOME` ou `~/.config/nod-motor`: a conexão, os vereditos das IAs e o `NOD_HOME` do executor. */
export function pastaDoMotor(env: Readonly<Record<string, string | undefined>>): string {
  return env.NOD_MOTOR_HOME?.trim() || join(env.HOME?.trim() || homedir(), ".config", "nod-motor");
}

export const arquivoDaConexao = (pasta: string) => join(pasta, "conexao.json");

/**
 * Onde o executor guarda sessões e turnos do CLI (NOD_HOME): fora da pasta da chave, para nenhum turno ficar a um `../` do
 * conexao.json (revisão do PR). Com NOD_MOTOR_HOME (testes, instalação fora do padrão), dentro dela.
 */
export function pastaDoExecutor(env: Readonly<Record<string, string | undefined>>): string {
  if (env.NOD_MOTOR_HOME?.trim()) return join(env.NOD_MOTOR_HOME.trim(), "executor");
  return join(env.HOME?.trim() || homedir(), ".local", "share", "nod-motor", "executor");
}

export function lerConexao(texto: string): ConexaoMotor | null {
  try {
    const v = JSON.parse(texto) as Partial<ConexaoMotor>;
    return typeof v.url === "string" && typeof v.chave === "string" && v.url && v.chave ? { url: v.url, chave: v.chave } : null;
  } catch {
    return null;
  }
}

export async function carregarConexao(pasta: string): Promise<ConexaoMotor | null> {
  try {
    return lerConexao(await readFile(arquivoDaConexao(pasta), "utf8"));
  } catch {
    return null;
  }
}

/** Grava atômica e 0600: um motor que cai no meio da gravação não deixa uma chave pela metade. */
export async function guardarConexao(pasta: string, c: ConexaoMotor): Promise<void> {
  const destino = arquivoDaConexao(pasta);
  await mkdir(dirname(destino), { recursive: true, mode: 0o700 });
  const tmp = `${destino}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(c)}\n`, { mode: 0o600 });
  await rename(tmp, destino);
}

export type ComandoMotor =
  | { tipo: "rodar" }
  | { tipo: "parear"; servidor: string; nome: string | null; convite: string | null }
  | { tipo: "entrar"; ia: "claude" | "codex" | "github" }
  | { tipo: "estado" }
  | { tipo: "versao" }
  | { tipo: "ajuda"; erro: string | null };

/** `nod-motor [rodar] | parear <servidor> [--nome N] [--convite C] | entrar claude|codex|github | estado | versao`. */
export function lerComando(args: readonly string[]): ComandoMotor {
  const [cmd, ...resto] = args;
  // Sem argumento mostra a ajuda: quem digita "nod-motor" não quer subir um segundo motor ao lado do serviço.
  if (cmd === undefined) return { tipo: "ajuda", erro: null };
  if (cmd === "rodar") return { tipo: "rodar" };
  if (cmd === "estado") return { tipo: "estado" };
  if (cmd === "versao" || cmd === "--version") return { tipo: "versao" };
  if (cmd === "parear") {
    const servidor = resto.find((a, i) => !a.startsWith("--") && resto[i - 1] !== "--nome" && resto[i - 1] !== "--convite");
    const valor = (flag: string) => { const i = resto.indexOf(flag); return i >= 0 ? resto[i + 1] ?? null : null; };
    if (!servidor) return { tipo: "ajuda", erro: "Diga o endereço do seu Nod: nod-motor parear https://seu-nod" };
    // ADR-102: o convite do comando de instalação (só o formato dele; outro valor é ignorado e vale o código).
    const convite = valor("--convite");
    return { tipo: "parear", servidor, nome: valor("--nome"), convite: convite && /^[A-Za-z0-9_-]{32}$/.test(convite) ? convite : null };
  }
  if (cmd === "entrar") {
    const ia = resto[0];
    if (ia === "claude" || ia === "codex" || ia === "github") return { tipo: "entrar", ia };
    return { tipo: "ajuda", erro: "Diga em qual IA entrar: nod-motor entrar claude | codex | github" };
  }
  return { tipo: "ajuda", erro: cmd === "ajuda" || cmd === "--help" || cmd === "-h" ? null : `Comando desconhecido: ${cmd}` };
}

export const AJUDA = `nod-motor — o motor do Nod nesta máquina (ADR-090)

  nod-motor parear <https://seu-nod> [--nome vm-sp]   conecta esta máquina à sua conta (mostra um código)
  nod-motor entrar claude | codex | github            entra numa conta da IA (uma conta nova a cada vez) ou no GitHub
                                                      — o jeito fácil é pela tela: Seu espaço › Provedores de IA
  nod-motor estado                                    o servidor conectado e as IAs prontas
  nod-motor rodar                                     roda o motor (o serviço nod-motor faz isso sozinho)
`;

/** Os logins headless: o Claude Code imprime um link e pede o código; o Codex e o gh usam o fluxo de dispositivo. */
export function comandoDeEntrar(ia: "claude" | "codex" | "github"): { nome: string; args: string[] } {
  if (ia === "claude") return { nome: "claude", args: ["auth", "login"] };
  if (ia === "codex") return { nome: "codex", args: ["login", "--device-auth"] };
  return { nome: "gh", args: ["auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web"] };
}
