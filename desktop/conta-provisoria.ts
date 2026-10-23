import { createHash, randomBytes } from "node:crypto";

/**
 * NOD-345 (ADR-124): o app chega à primeira mensagem sem cadastro e troca de espaço quando a pessoa entra numa conta.
 *
 *  - Primeira abertura, sem chave guardada: se o servidor anuncia `contas.bootstrap` em /api/sessao/modo, o app pede
 *    `POST /api/conta/provisorio` (forma "app") com o verificador desta instalação e recebe a chave de máquina do espaço
 *    provisório. O verificador é aleatório, fica cifrado no safeStorage e nunca muda: reabrir (ou perder a chave) devolve
 *    o MESMO espaço.
 *  - A pessoa entrou numa conta pela janela web: a página recebe um código de troca de uso único e o passa ao processo
 *    principal (`nodDesktop.trocarConta`), que o troca pela chave do espaço novo em `POST /api/conta/troca-app`. A chamada
 *    sai do processo principal, sem Origin — o servidor recusa a troca vinda de uma página.
 * Tudo aqui é puro sobre `fetch`; o main.ts só liga as pontas (safeStorage, conectar).
 */
export const verificadorNovo = (): string => randomBytes(32).toString("base64url");

/**
 * O segredo da troca (estilo PKCE): nasce no processo principal a cada abertura e nunca vai à página. A página manda só
 * o desafio (SHA-256) no login; a troca do código pela chave exige o segredo.
 */
export function segredoDeTroca(): { prova: string; desafio: string } {
  const prova = randomBytes(32).toString("base64url");
  return { prova, desafio: createHash("sha256").update(prova).digest("base64url") };
}

const VERIFICADOR = /^[A-Za-z0-9_-]{32,128}$/;
export const verificadorValido = (v: unknown): v is string => typeof v === "string" && VERIFICADOR.test(v);

const chaveDe = async (r: Response): Promise<string | null> => {
  if (!r.ok) return null;
  const { chave } = (await r.json().catch(() => ({}))) as { chave?: unknown };
  return typeof chave === "string" && chave.length > 0 && chave.length <= 1024 ? chave : null;
};

/** O servidor oferece o espaço provisório? Fora do ar ou sem a flag: não (o app mostra a tela de conexão de antes). */
export async function servidorOfereceProvisorio(servidor: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const r = await fetchImpl(new URL("/api/sessao/modo", servidor), { redirect: "error", signal: AbortSignal.timeout(10_000) });
    if (!r.ok) return false;
    const m = (await r.json()) as { contas?: { bootstrap?: unknown } };
    return m.contas?.bootstrap === true;
  } catch {
    return false;
  }
}

/** A chave do espaço provisório desta instalação (o mesmo a cada pedido com o mesmo verificador); null = não deu. */
export async function pedirProvisorio(o: { servidor: string; verificador: string; nome: string; versao: string; fetchImpl?: typeof fetch }): Promise<string | null> {
  if (!verificadorValido(o.verificador)) return null;
  try {
    const r = await (o.fetchImpl ?? fetch)(new URL("/api/conta/provisorio", o.servidor), {
      method: "POST",
      redirect: "error",
      // O rótulo do aparelho (a chave em Máquinas, a sessão em Sessões) vem do user-agent: "macOS · app do nod".
      headers: { "content-type": "application/json", "user-agent": `nod/${o.versao} (${process.platform === "darwin" ? "Macintosh" : process.platform})` },
      // `nome` é o da pessoa (o usuário do sistema), só para o espaço não nascer "Você"; ela troca depois.
      body: JSON.stringify({ verificador: o.verificador, forma: "app", nome: o.nome.slice(0, 80) }),
      signal: AbortSignal.timeout(15_000),
    });
    return await chaveDe(r);
  } catch {
    return null;
  }
}

/** Código de troca (vindo da página) → chave do espaço em que a pessoa entrou. null = código inválido, usado ou vencido. */
export async function trocarChaveDoApp(o: { servidor: string; codigo: unknown; prova: string; fetchImpl?: typeof fetch }): Promise<string | null> {
  if (typeof o.codigo !== "string" || o.codigo.length < 20 || o.codigo.length > 100) return null;
  try {
    const r = await (o.fetchImpl ?? fetch)(new URL("/api/conta/troca-app", o.servidor), {
      method: "POST",
      redirect: "error",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ codigo: o.codigo, prova: o.prova }),
      signal: AbortSignal.timeout(15_000),
    });
    return await chaveDe(r);
  } catch {
    return null;
  }
}
