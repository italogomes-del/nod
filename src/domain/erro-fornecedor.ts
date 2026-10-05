import { HARNESSES, type IdHarness } from "../contracts/harness.ts";

/**
 * O erro do Claude Code ou do Codex em classe FECHADA (NOD-174, emenda da ADR-009). Molde: MOTIVO_FALHA_EM_PORTUGUES em
 * computador.ts. O texto do fornecedor chegava à conversa em inglês ("Credit balance is too low", "API Error: 529
 * overloaded") como se fosse fala do bot; agora ele só ESCOLHE a frase em pt-BR, e o cru fica no diagnóstico (ADR-041).
 *
 * O estado e o motivo gravados continuam vindo do protocolo (ADR-009): a classe muda só a frase do aviso. Os padrões
 * mudam sem aviso; o que não casa fica `desconhecido`, e o pior caso é a frase de antes. Sem classe para crédito e rede:
 * sem fixture confiável (fora de escopo na NOD-174; o limite do plano é a NOD-171).
 */
export const CLASSES_ERRO_FORNECEDOR = ["login_expirado", "contexto_cheio", "sobrecarga", "desconhecido"] as const;
export type ClasseErroFornecedor = (typeof CLASSES_ERRO_FORNECEDOR)[number];

/**
 * Ordem fixa login > contexto > sobrecarga: um texto que bate em duas classes fica com a que a pessoa resolve. Amostras
 * do Claude Code ("Invalid API key · Please run /login", "OAuth token has expired", "Prompt is too long", "API Error:
 * 529 … overloaded_error") e do Codex (`turn.failed.error.message`, evento `error`: "401 Unauthorized", "Your access
 * token could not be refreshed", "context_length_exceeded", "exceeds the context window").
 */
const PADROES: readonly (readonly [Exclude<ClasseErroFornecedor, "desconhecido">, readonly RegExp[]])[] = [
  ["login_expirado", [
    /invalid api key/i,
    /oauth token (?:has )?expired/i,
    /not logged in/i,
    /please run \/login/i,
    /authentication_error/i,
    /\b401\b/,
    /\bunauthorized\b/i,
    /access token could not be refreshed/i,
    /refresh token (?:has )?(?:expired|been (?:revoked|used))/i,
  ]],
  ["contexto_cheio", [
    /prompt is too long/i,
    /context[_ ]length[_ ]exceeded/i,
    /exceeds? the (?:model'?s? )?context (?:window|length)/i,
    /maximum context length/i,
  ]],
  ["sobrecarga", [
    /overloaded/i,
    /\b529\b/,
    /\b503\b.{0,40}service unavailable/i,
  ]],
];

/** `erroCru` já redigido (stream-json, codex-stream). Nulo ou vazio é `desconhecido`: sem pista, sem frase nova. */
export function classificarErroFornecedor(erroCru: string | null | undefined): ClasseErroFornecedor {
  if (!erroCru || erroCru.trim() === "") return "desconhecido";
  for (const [classe, padroes] of PADROES) if (padroes.some((r) => r.test(erroCru))) return classe;
  return "desconhecido";
}

/**
 * A frase de cada classe, com a ação que resolve. Entra no `{motivo}` de "Turno interrompido: {motivo}." — por isso
 * começa em minúscula e não fecha com ponto. `{do}`/`{o}` levam o artigo junto do nome que a pessoa lê ("do Claude
 * Code", "o Codex"; sem harness, "da sua IA"). `desconhecido` não tem frase: quem chama fica com o motivo de sempre.
 */
export const FRASE_ERRO_FORNECEDOR: Readonly<Record<Exclude<ClasseErroFornecedor, "desconhecido">, string>> = {
  login_expirado: "sua conta {do} saiu deste Mac; use Conectar IA para entrar de novo",
  contexto_cheio: "a conversa ficou longa demais para {o}; use /compactar e peça de novo",
  sobrecarga: "o serviço {do} está sobrecarregado; tente de novo em alguns minutos",
};

/** A frase pronta, ou null quando a classe é `desconhecido`. Nunca o id cru ("claude-cli"). */
export function fraseDoErroFornecedor(harness: IdHarness | null | undefined, erroCru: string | null | undefined): string | null {
  const classe = classificarErroFornecedor(erroCru);
  if (classe === "desconhecido") return null;
  const nome = HARNESSES.find((h) => h.id === harness)?.nome;
  return FRASE_ERRO_FORNECEDOR[classe].replace("{do}", nome ? `do ${nome}` : "da sua IA").replace("{o}", nome ? `o ${nome}` : "a sua IA");
}
