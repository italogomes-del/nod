import { IAS_DESKTOP, type IaDesktop } from "../src/contracts/desktop.ts";
import { chaveNegada } from "../src/domain/ambiente-executor.ts";

/**
 * A IA dos bots no Mac, para o onboarding (definido em 2026-10-04, ADR-077): sem Claude Code nem Codex prontos, a web
 * mostra os cards de IA e o clique chega ao processo principal. Aqui ficam as partes puras (validação, URLs, comando do
 * login e ambiente do filho), testadas sem Electron em tests/unit/desktop/ia-mac.test.ts.
 */

/** definido em 2026-10-04: de quanto em quanto tempo o app sonda de novo a IA até alguma ficar pronta. */
export const INTERVALO_SONDA_IA_MS = 3_000;

/** definido em 2026-10-04: as páginas oficiais de instalação (nunca um download direto escolhido pela página). */
export const URL_INSTALAR_IA: Record<IaDesktop, string> = {
  "claude-cli": "https://docs.anthropic.com/en/docs/claude-code/setup",
  "codex-cli": "https://developers.openai.com/codex/cli",
};

/** O argumento vem de uma página remota: só os ids conhecidos passam. */
export function lerIaDesktop(v: unknown): IaDesktop | null {
  return typeof v === "string" && (IAS_DESKTOP as readonly string[]).includes(v) ? (v as IaDesktop) : null;
}

/**
 * O login do próprio CLI (ele abre o navegador e guarda a credencial no Keychain dele): o nod nunca vê o token.
 * `nome` é o binário procurado no PATH aumentado quando não há caminho configurado (NOD_CLAUDE_BIN/NOD_CODEX_BIN).
 */
export function comandoDeLogin(ia: IaDesktop): { nome: "claude" | "codex"; args: string[] } {
  return ia === "claude-cli" ? { nome: "claude", args: ["auth", "login"] } : { nome: "codex", args: ["login"] };
}

/**
 * O comando que diz QUAL conta está logada (definido em 2026-10-05): o app faz um hash da saída e o guarda com o
 * veredito do teste da IA (vigia-ias.ts); a saída em si nunca é guardada nem enviada. Medido em 2026-10-05: o
 * `claude auth status` devolve um JSON com a conta e a organização, então o hash muda quando a pessoa troca de conta;
 * o `codex login status` só diz "Logged in using ChatGPT", e o hash dele não muda (a IA é testada de novo pelo prazo).
 */
export function comandoDeEstadoDoLogin(ia: IaDesktop): { nome: "claude" | "codex"; args: string[] } {
  return ia === "claude-cli" ? { nome: "claude", args: ["auth", "status"] } : { nome: "codex", args: ["login", "status"] };
}

/**
 * O ambiente do processo de login: o mesmo regime local dos drivers (sem CLAUDE_CODE_*, ANTHROPIC_*, NOD_*) e também
 * sem OPENAI_* — com uma chave herdada, o login viraria cobrança por API sem a pessoa saber.
 */
export function ambienteDoLogin(env: Readonly<Record<string, string | undefined>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined || chaveNegada(k) || k.startsWith("OPENAI_") || k === "CODEX_API_KEY") continue;
    out[k] = v;
  }
  return out;
}
