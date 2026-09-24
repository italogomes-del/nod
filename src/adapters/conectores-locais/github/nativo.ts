import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ENV_COMPOSIO_CHAVE, ENV_COMPOSIO_URL, ENV_TOKEN_GITHUB, type JeitoGithub, type OndeRodaConector } from "../../../contracts/github.ts";
import { montarAmbienteConectorNativo } from "../../../domain/ambiente-executor.ts";
import { escolherJeitoGithub } from "../../../domain/github.ts";
import { caminhoAumentado, homeDaPessoa } from "../../executor/caminho.ts";

/** O servidor stdio do conector nativo; rodado pelo Node deste processo, como o proxy (boot.ts). */
export const CAMINHO_SERVIDOR_GITHUB = fileURLToPath(new URL("./servidor.ts", import.meta.url));


type Ambiente = Readonly<Record<string, string | undefined>>;

/** O ambiente em que o `gh` roda: allowlist de conector nativo + PATH aumentado (app aberto pelo Finder tem PATH pelado). */
export function ambienteDoGh(ambiente: Ambiente): Record<string, string> {
  const env = montarAmbienteConectorNativo(ambiente);
  env.PATH = caminhoAumentado(ambiente.PATH, homeDaPessoa(ambiente));
  return env;
}

export type DetectorGh = { logado(): Promise<boolean> };

/**
 * `gh auth status` nesta máquina (ADR-047): a sonda local do jeito 1. Só roda quando o conector roda
 * na máquina da pessoa; no servidor compartilhado a composição nem cria o detector. Cache curto:
 * logado por 60 s, deslogado por 10 s — quem acabou de rodar `gh auth login` não espera um minuto.
 * definido em 2026-09-24: teto de 5 s; o `gh auth status` confere o token na rede.
 */
export function criarDetectorGh(o: { ambiente: Ambiente; bin?: string; agora?: () => number }): DetectorGh {
  const agora = o.agora ?? (() => Date.now());
  let posto: { em: number; ok: boolean } | null = null;
  return {
    async logado() {
      if (posto && agora() - posto.em < (posto.ok ? 60_000 : 10_000)) return posto.ok;
      const ok = await new Promise<boolean>((resolver) => {
        execFile(o.bin ?? "gh", ["auth", "status"], { env: ambienteDoGh(o.ambiente), timeout: 5_000, shell: false, windowsHide: true }, (e) => resolver(!e));
      });
      posto = { em: agora(), ok };
      return ok;
    },
  };
}

export type ConfigGithubNativo = {
  comando: string;
  args: string[];
  env: Record<string, string>;
  jeito: JeitoGithub;
  /** Token de instalação do App vence: depois disto o cliente vivo é respawnado com um novo. */
  expiraEm?: number;
};

/**
 * Monta o processo do conector nativo a partir do env DECIFRADO do conector e do que está pronto
 * agora. A escolha é do domínio (escolherJeitoGithub); aqui só se traduz em ambiente. Devolve a
 * frase quando nenhum jeito serve, para a tela dizer o que fazer.
 */
export function configGithubNativo(p: {
  onde: OndeRodaConector;
  envConector: Readonly<Record<string, string>>;
  ghLogado: boolean;
  app: { token: string; expiraEm: number } | null;
  ambiente: Ambiente;
  /** Só teste: base da API REST. */
  apiBase?: string;
}): { ok: true; cfg: ConfigGithubNativo } | { ok: false; frase: string } {
  const token = p.envConector[ENV_TOKEN_GITHUB];
  const composio = p.envConector[ENV_COMPOSIO_URL] && p.envConector[ENV_COMPOSIO_CHAVE];
  const escolha = escolherJeitoGithub(p.onde, { gh: p.onde === "maquina_da_pessoa" && p.ghLogado, token: !!token, composio: !!composio, app: !!p.app });
  if (!escolha.ok) return escolha;
  const base = { comando: process.execPath, args: [CAMINHO_SERVIDOR_GITHUB], jeito: escolha.jeito };
  const api: Record<string, string> = p.apiBase ? { NOD_GITHUB_API: p.apiBase } : {};
  switch (escolha.jeito) {
    case "gh":
      return { ok: true, cfg: { ...base, env: { ...ambienteDoGh(p.ambiente), NOD_GITHUB_JEITO: "gh" } } };
    case "token":
      return { ok: true, cfg: { ...base, env: { ...montarAmbienteConectorNativo(p.ambiente), NOD_GITHUB_JEITO: "token", NOD_GITHUB_TOKEN: token ?? "", ...api } } };
    case "app":
      return { ok: true, cfg: { ...base, env: { ...montarAmbienteConectorNativo(p.ambiente), NOD_GITHUB_JEITO: "app", NOD_GITHUB_TOKEN: p.app?.token ?? "", ...api }, expiraEm: p.app?.expiraEm } };
    case "composio":
      return { ok: true, cfg: { ...base, env: { ...montarAmbienteConectorNativo(p.ambiente), NOD_GITHUB_JEITO: "composio", NOD_COMPOSIO_URL: p.envConector[ENV_COMPOSIO_URL] ?? "", NOD_COMPOSIO_CHAVE: p.envConector[ENV_COMPOSIO_CHAVE] ?? "" } } };
  }
}
