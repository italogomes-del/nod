import type { EventoRevisao, JeitoGithub, NomeCapacidadeGithub, OndeRodaConector } from "../contracts/github.ts";
import { CAPACIDADES_GITHUB } from "../contracts/github.ts";

/**
 * definido em 2026-09-24 (ADR-047): a ordem de preferência depende de ONDE o conector roda.
 * Na máquina da pessoa o que já está pronto ganha (gh logado → token colado → Composio). No
 * servidor o gh nunca entra — o gh logado é o do Mac da pessoa, não o do servidor — e a conta da
 * organização (App) vem antes das contas pessoais.
 */
export const ORDEM_DOS_JEITOS: Readonly<Record<OndeRodaConector, readonly JeitoGithub[]>> = {
  maquina_da_pessoa: ["gh", "token", "composio"],
  servidor: ["app", "composio", "token"],
};

export type JeitosProntos = Readonly<Partial<Record<JeitoGithub, boolean>>>;

export type EscolhaJeitoGithub = { ok: true; jeito: JeitoGithub } | { ok: false; frase: string };

/** A frase quando nenhum jeito serve: diz o que a PESSOA faz, nunca o nome de uma variável. */
export function fraseSemJeito(onde: OndeRodaConector): string {
  return onde === "servidor"
    ? "Nenhum jeito de conectar o GitHub serve no servidor: para rotinas noturnas, conecte o GitHub da organização (GitHub App) ou entre pelo Composio."
    : "Nenhum jeito de conectar o GitHub está pronto: rode `gh auth login` nesta máquina, cole um token pessoal no campo avançado ou entre pelo Composio.";
}

export function escolherJeitoGithub(onde: OndeRodaConector, prontos: JeitosProntos): EscolhaJeitoGithub {
  for (const jeito of ORDEM_DOS_JEITOS[onde]) if (prontos[jeito] === true) return { ok: true, jeito };
  return { ok: false, frase: fraseSemJeito(onde) };
}

export type AlvoGithub = { dono: string; repo: string };

export type ArgsGithub =
  | { capacidade: "pr_ver" | "pr_diff" | "pr_arquivos" | "pr_comentarios" | "pr_checks" | "issue_ver"; alvo: AlvoGithub; numero: number }
  | { capacidade: "arquivo_ler"; alvo: AlvoGithub; caminho: string; ref: string | null }
  | { capacidade: "pr_comentar"; alvo: AlvoGithub; numero: number; texto: string }
  | { capacidade: "pr_revisar"; alvo: AlvoGithub; numero: number; evento: EventoRevisao; texto: string | null };

/** Erro de entrada: vira resultado de ferramenta com isError, nunca chega a `gh` nem à rede. */
export class ArgumentoGithubInvalido extends Error {
  readonly campo: string;
  constructor(campo: string) {
    super(`argumento inválido: ${campo}`);
    this.name = "ArgumentoGithubInvalido";
    this.campo = campo;
  }
}

/**
 * definido em 2026-09-24: regras do próprio GitHub, apertadas. Dono: letras, dígitos e hífen, sem
 * hífen no começo, até 39. Repositório: letras, dígitos, `.`, `_`, `-`, sem começar por `-` nem ser
 * `.`/`..`. Nada disso deixa passar espaço, `;`, `=` ou `--repo=x`: o valor nunca vira opção de `gh`.
 */
const DONO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;
const REPO = /^[A-Za-z0-9_.][A-Za-z0-9_.-]{0,99}$/;
const REF = /^[A-Za-z0-9_.][A-Za-z0-9_./-]{0,199}$/;
const SEGMENTO = /^[A-Za-z0-9_.@+-][A-Za-z0-9_.@+ -]{0,254}$/;
/** definido em 2026-09-24: 65.536 é o teto de corpo de comentário do GitHub. */
export const TETO_TEXTO_GITHUB = 65_536;

export function validarRepositorio(v: unknown): AlvoGithub {
  if (typeof v !== "string") throw new ArgumentoGithubInvalido("repositorio");
  const partes = v.trim().split("/");
  const [dono, repo] = partes;
  if (partes.length !== 2 || !dono || !repo || !DONO.test(dono) || !REPO.test(repo) || repo === "." || repo === "..") throw new ArgumentoGithubInvalido("repositorio");
  return { dono, repo: repo.endsWith(".git") ? repo.slice(0, -4) : repo };
}

export function validarNumero(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 999_999_999) throw new ArgumentoGithubInvalido("numero");
  return v;
}

function validarCaminho(v: unknown): string {
  if (typeof v !== "string") throw new ArgumentoGithubInvalido("caminho");
  const segmentos = v.replace(/^\/+/, "").split("/");
  if (segmentos.length === 0 || segmentos.length > 64 || segmentos.some((s) => !SEGMENTO.test(s) || s === "." || s === "..")) throw new ArgumentoGithubInvalido("caminho");
  return segmentos.join("/");
}

function validarRef(v: unknown): string | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v !== "string" || !REF.test(v) || v.includes("..") || v.endsWith("/") || v.endsWith(".lock")) throw new ArgumentoGithubInvalido("ref");
  return v;
}

function validarTexto(v: unknown, campo: string): string {
  if (typeof v !== "string" || v.trim() === "" || v.length > TETO_TEXTO_GITHUB) throw new ArgumentoGithubInvalido(campo);
  return v;
}

const NOMES = new Set<string>(CAPACIDADES_GITHUB.map((c) => c.nome));

export function ehCapacidadeGithub(nome: string): nome is NomeCapacidadeGithub {
  return NOMES.has(nome);
}

/** Valida os argumentos de uma capacidade ANTES de qualquer processo ou requisição existir. */
export function validarArgsGithub(capacidade: NomeCapacidadeGithub, bruto: Readonly<Record<string, unknown>>): ArgsGithub {
  const alvo = validarRepositorio(bruto.repositorio);
  switch (capacidade) {
    case "arquivo_ler":
      return { capacidade, alvo, caminho: validarCaminho(bruto.caminho), ref: validarRef(bruto.ref) };
    case "pr_comentar":
      return { capacidade, alvo, numero: validarNumero(bruto.numero), texto: validarTexto(bruto.texto, "texto") };
    case "pr_revisar": {
      const evento = bruto.evento;
      if (evento !== "comment" && evento !== "approve" && evento !== "request_changes") throw new ArgumentoGithubInvalido("evento");
      // O GitHub recusa comment e request_changes sem corpo; approve aceita vazio.
      const texto = evento === "approve" && (bruto.texto === undefined || bruto.texto === "") ? null : validarTexto(bruto.texto, "texto");
      return { capacidade, alvo, numero: validarNumero(bruto.numero), evento, texto };
    }
    default:
      return { capacidade, alvo, numero: validarNumero(bruto.numero) };
  }
}
