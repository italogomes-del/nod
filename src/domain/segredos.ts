/**
 * Redator único de segredos (NOD-158). Puro: só texto.
 *
 * O que sai do contexto vivo da pessoa (log, `turno_diagnosticos`, relato e as exportações da NOD-138
 * e da NOD-44) guarda a FORMA e perde o VALOR: `ANTHROPIC_API_KEY=«redigido: 51 caracteres»`. Ainda
 * dá para depurar "o proxy não recebeu token", sem o token estar lá. A conversa, o que o modelo
 * recebe e os argumentos de aprovação ficam crus (fora daqui).
 *
 * Contrato para quem exporta (NOD-138, NOD-44): use `redigirECortar` ANTES de qualquer corte. Cortar
 * primeiro parte o segredo e o pedaço que sobra não é mais reconhecido.
 *
 * Padrões portados de OpenMausBot/shared/redact.ts (definido em 2026-10-05), mudando só o marcador.
 * Alta precisão de propósito: uma heurística de "string longa" reescreveria código, UUID e sha. Por
 * isso só casa o que é inequivocamente credencial.
 *
 * Toda repetição ANTES de um literal tem teto ({0,64}, {0,31}, {8,256}): sem ele a regex recomeça em
 * cada fronteira de palavra e varre o resto do texto, O(n²). Medido: 8000 caracteres de `a-`, `a.` ou
 * `eyJ-` levavam 250–360 ms; com o teto, menos de 10 ms. O cabeçalho de um JWT e a 1ª parte da chave
 * de máquina (~116) cabem com folga em 256.
 */

/** A redação é estável byte a byte: remascarar o próprio marcador mudaria o tamanho que ele relata. */
const MARCADOR = /^«redigido: \d+ caracteres»$/;
const INICIO_DO_MARCADOR = "«redigido: ";

export const mascarar = (valor: string): string => (MARCADOR.test(valor) ? valor : `«redigido: ${valor.length} caracteres»`);

const PREFIXOS: RegExp[] = [
  /\bom[dg]_[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g, // credenciais do desktop OpenMausBot
  /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}/g, // anthropic / openai / stripe
  /\bxai-[A-Za-z0-9_-]{20,}/g, // xai
  /\bgsk_[A-Za-z0-9]{40,}/g, // groq
  /\bhf_[A-Za-z0-9]{30,}/g, // hugging face
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g, // github clássico
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g, // github fine-grained
  /\bxox[abposr]-[A-Za-z0-9-]{20,}/g, // slack
  /\bxapp-\d-[A-Za-z0-9-]{20,}/g, // slack, token de app (socket mode)
  /\bAKIA[0-9A-Z]{16}\b/g, // aws access key id
  /\bAIza[0-9A-Za-z_-]{30,}/g, // google api key
  /\bya29\.[A-Za-z0-9_-]{20,}/g, // google, access token OAuth (ADC/gcloud)
  /\bGOCSPX-[A-Za-z0-9_-]{20,}/g, // google, client secret OAuth
  /\bnpm_[A-Za-z0-9]{20,}/g, // npm
  /\beyJ[A-Za-z0-9_-]{8,256}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, // jwt
  // Chave de máquina do nod (services/token-maquina.ts): base64url(JSON) "." base64url(32 bytes). Duas
  // partes, não as três do JWT; roda depois dele para nunca morder as duas primeiras partes de um JWT.
  /\beyJ[A-Za-z0-9_-]{8,256}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g,
  // Composio: `ak_` é o prefixo da chave de projeto (docs.composio.dev/reference/authentication e o
  // `startsWith("ak_")` do OpenMausBot/electron/main.mjs). O piso de 20 é suposição: a doc não fixa o
  // tamanho, e uma chave curta ainda cai em `COMPOSIO_API_KEY=` ou `x-api-key:`.
  /\bak_[A-Za-z0-9_-]{20,}/g,
];
const BEARER = /(\bBearer\s+)([A-Za-z0-9._~+/=-]{12,})/g;
/** `Authorization: Basic <base64 de usuario:senha>`. Só depois do cabeçalho: "Basic" solto é prosa. */
const BASIC = /(\bAuthorization\s*:\s*Basic\s+)([A-Za-z0-9+/]{8,}={0,2})/gi;
const BLOCO_PEM = /(-----BEGIN [A-Z ]*PRIVATE KEY-----)([\s\S]*?)(-----END [A-Z ]*PRIVATE KEY-----)/g;
/** chave=valor / chave: valor / chave="valor" com nome de segredo. O valor é um token só: prosa depois
 * dos dois pontos ("password: deixe em branco") tem espaço e não casa. A aspa pode vir escapada (`\"`):
 * JSON dentro de uma string de JSON (`{\"token\":\"…\"}`) vazava cru no diagnóstico (NOD-138, QA). */
const CHAVE_VALOR =
  /\b((?:[A-Za-z0-9_-]{0,64}_)?(?:api[_-]?key|apikey|secret|token|password|passwd|senha|segredo|cookie|authorization|auth[_-]?token|access[_-]?key|private[_-]?key)s?)((?:\\?["'])?\s*[=:]\s*)((?:\\?["'])?)([A-Za-z0-9._~+/=-]{8,})\3/gi;
/** Senha não tem piso nem alfabeto: `senha=hunter2` e `DB_PASSWORD=p@ss!w0rd` vazavam no `CHAVE_VALOR`
 * (8+ caracteres sem símbolo), e o `resumirDetalhe` antigo pegava os dois. Só com `=` colado ou com o
 * valor entre aspas: `password: deixe em branco` é prosa e fica. Roda antes do `CHAVE_VALOR` para não
 * sobrar o pedaço depois do 1º símbolo. */
const SENHA =
  /\b((?:[A-Za-z0-9_-]{0,64}[_-])?(?:password|passwd|senha|segredo|secret)s?)(?:(=)(?![="'\\])([^\s"'&;,«»]+)|((?:\\?["'])?\s*[=:]\s*)(\\?["'])([^"'\n«»]{1,256})\5)/gi;
/** `X_KEY=valor`: atribuição a um nome que TERMINA em key é credencial, sem piso de tamanho. O
 * separador antes de `key` é o que deixa `hotkey=` e `keyboard=` de fora. */
const SUFIXO_KEY = /\b([A-Za-z][A-Za-z0-9_-]{0,64}[_-]key)s?(=)(["']?)([A-Za-z0-9._~+/=-]+)\3/gi;
/** `--token abc`, `--password=abc`: a flag nomeia o segredo; o valor nunca é outra flag. */
const FLAG_DE_SEGREDO = /(--(?:token|password|passwd|api-key|apikey|secret|access-key|auth-token)(?:=|\s+))(["']?)(?!-)([A-Za-z0-9._~+/=-]+)\2/gi;
/** `esquema://usuario:senha@host`: a senha na userinfo da URL. */
const URL_COM_SENHA = /(\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s/:@'"]+:)([^\s/@'"«»]+)(@)/gi;

export function redigirSegredos(texto: string): string {
  if (!texto || texto.length < 8) return texto;
  let out = texto;
  out = out.replace(BLOCO_PEM, (_m, abre: string, corpo: string, fecha: string) => `${abre}\n${mascarar(corpo.trim())}\n${fecha}`);
  for (const re of PREFIXOS) out = out.replace(re, (m) => mascarar(m));
  out = out.replace(BEARER, (_m, lead: string, tok: string) => `${lead}${mascarar(tok)}`);
  out = out.replace(BASIC, (_m, lead: string, cred: string) => `${lead}${mascarar(cred)}`);
  out = out.replace(SENHA, (_m, k: string, igual?: string, v1?: string, sep?: string, q?: string, v2?: string) =>
    igual ? `${k}${igual}${mascarar(v1!)}` : `${k}${sep}${q}${mascarar(v2!)}${q}`,
  );
  out = out.replace(CHAVE_VALOR, (_m, k: string, sep: string, q: string, v: string) => `${k}${sep}${q}${mascarar(v)}${q}`);
  out = out.replace(SUFIXO_KEY, (_m, k: string, sep: string, q: string, v: string) => `${k}${sep}${q}${mascarar(v)}${q}`);
  out = out.replace(FLAG_DE_SEGREDO, (_m, flag: string, q: string, v: string) => `${flag}${q}${mascarar(v)}${q}`);
  out = out.replace(URL_COM_SENHA, (_m, lead: string, senha: string, arroba: string) => `${lead}${mascarar(senha)}${arroba}`);
  return out;
}

/**
 * Redige e SÓ DEPOIS corta em `max`. Um corte que cairia dentro de um marcador recua para antes dele:
 * o texto fica menor que `max`, mas nunca com meio marcador. Vazio (ou ausente) vira null.
 */
export function redigirECortar(texto: string | null | undefined, max: number): string | null {
  if (!texto) return null;
  const r = redigirSegredos(texto);
  if (r.length <= max) return r;
  let corte = r.slice(0, max);
  const abre = corte.lastIndexOf("«");
  if (abre !== -1 && !corte.includes("»", abre) && r.startsWith(INICIO_DO_MARCADOR, abre)) corte = corte.slice(0, abre);
  return corte === "" ? null : corte;
}

/** Os valores string de um objeto raso, redigidos; o resto passa igual. */
export function redigirCampos<T extends Record<string, unknown>>(campos: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(campos)) out[k] = typeof v === "string" ? redigirSegredos(v) : v;
  return out as T;
}
