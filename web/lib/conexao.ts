import type { ConexaoApp } from "../estado/reducer.ts";

/**
 * O login de um app sem "Verificar conexão" (definido em 2026-09-25, jornadas de conexão). O clique em
 * "Conectar" abre a janela de login NA HORA — a janela nasce vazia dentro do clique, senão o navegador a
 * bloqueia, e recebe a URL do provedor quando o servidor devolve — e a web pergunta ao servidor, sozinha,
 * se o login terminou. Terminou: o servidor já sondou o app e virou os cards "Conecte o X" em cards de
 * permitir (ao-conectar-app.ts); quem chamou decide o passo seguinte (`aoConectar`).
 *
 * Sem janela (o app desktop abre links fora; bloqueador de pop-up), a URL fica no estado e o card mostra
 * "Abrir o login" como link comum: a espera continua igual.
 */

/** O que a espera usa da janela de login (Window cumpre; o tipo é pequeno para rodar fora do navegador). */
export type JanelaLogin = { readonly closed: boolean; close(): void; location: { href: string } };

export type RespostaConectar = { url?: string; conectado?: boolean; frase?: string };

export type DepsConexao = {
  conectar(slug: string): Promise<RespostaConectar>;
  /** `falhou`: a conta entrou, mas o app não respondeu à sonda — esperar mais não resolve. */
  verificar(slug: string): Promise<{ conectado: boolean; falhou?: boolean }>;
  /** O estado do login mudou (null = acabou: conectou ou foi cancelado). */
  mudou(slug: string, valor: ConexaoApp | null): void;
  /** Conectou. Chamado uma vez, depois de `mudou(slug, null)`. */
  conectado(slug: string): void | Promise<void>;
  abrirJanela(nome: string): JanelaLogin | null;
  esperar(ms: number): Promise<void>;
  agora(): number;
};

/** definido em 2026-09-25: a cada 2,5 s por até 10 min; o login do Composio leva de 10 s a 1 min na prática. */
export const INTERVALO_MS = 2_500;
export const PRAZO_MS = 10 * 60_000;
/** Janela fechada sem conectar: mais duas perguntas (o redirect final pode chegar logo depois) e desiste. */
const TENTATIVAS_APOS_FECHAR = 2;
/** definido em 2026-09-25: cinco erros seguidos do servidor (~12 s) e a espera desiste com a frase. */
export const ERROS_SEGUIDOS_MAX = 5;

export const FALHA_JANELA_FECHADA = "A janela de login foi fechada antes de terminar.";
export const FALHA_PRAZO = "O login não terminou a tempo.";
export const FALHA_SERVIDOR = "Não consegui falar com o app agora.";
export const FALHA_APP = "O login deu certo, mas o app não respondeu. Tente de novo em instantes.";

/** O que acontece quando ESTA tentativa conecta (criar a rotina que esperava o app, por exemplo). Morre com ela. */
export type Depois = () => void | Promise<void>;

export function criarConexoes(deps: DepsConexao) {
  // definido em 2026-09-25 (revisão do PR #68): o `depois` vive na tentativa, não num mapa por app — cancelar
  // ou falhar o descarta. Guardado por app, ele sobrevivia ao Cancelar e criava a rotina (concedendo o acesso
  // dela) na próxima vez que o app conectasse por qualquer caminho, sem o clique que dizia isso.
  const vivas = new Map<string, { id: number; janela: JanelaLogin | null; depois: Depois | null }>();
  let proximoId = 0;

  async function esperarLogin(slug: string, id: number, url: string | null): Promise<void> {
    const inicio = deps.agora();
    let aposFechar = 0;
    let erros = 0;
    while (vivas.get(slug)?.id === id) {
      await deps.esperar(INTERVALO_MS);
      if (vivas.get(slug)?.id !== id) return;
      try {
        const r = await deps.verificar(slug);
        erros = 0;
        if (vivas.get(slug)?.id !== id) return;
        if (r.conectado) return concluir(slug, id);
        if (r.falhou) return falhar(slug, id, url, FALHA_APP);
      } catch {
        // estado_invalido enquanto a sessão do provedor ainda não existe, ou rede: continua, com teto.
        erros += 1;
        if (erros >= ERROS_SEGUIDOS_MAX) return falhar(slug, id, url, FALHA_SERVIDOR);
      }
      const janela = vivas.get(slug)?.janela ?? null;
      if (janela?.closed) {
        aposFechar += 1;
        if (aposFechar > TENTATIVAS_APOS_FECHAR) return falhar(slug, id, url, FALHA_JANELA_FECHADA);
      }
      if (deps.agora() - inicio > PRAZO_MS) return falhar(slug, id, url, FALHA_PRAZO);
    }
  }

  async function concluir(slug: string, id: number): Promise<void> {
    const viva = vivas.get(slug);
    if (viva?.id !== id) return;
    vivas.delete(slug);
    deps.mudou(slug, null);
    await deps.conectado(slug);
    await viva.depois?.();
  }

  function falhar(slug: string, id: number, url: string | null, frase: string): void {
    const viva = vivas.get(slug);
    if (viva?.id !== id) return;
    // Janela aberta depois de desistir: terminar o login ali não viraria card nenhum (revisão do PR #68).
    try { viva.janela?.close(); } catch { /* já fechada */ }
    vivas.delete(slug);
    deps.mudou(slug, { url, falhou: frase });
  }

  return {
    /** Chamar DENTRO do clique: a janela só abre sem bloqueio quando nasce no gesto da pessoa. */
    async iniciar(slug: string, depois: Depois | null = null): Promise<void> {
      const id = ++proximoId;
      const janela = deps.abrirJanela(`nod-login-${slug}`);
      vivas.set(slug, { id, janela, depois });
      deps.mudou(slug, { url: null, falhou: null });
      let r: RespostaConectar;
      try {
        r = await deps.conectar(slug);
      } catch (e) {
        janela?.close();
        vivas.delete(slug);
        deps.mudou(slug, null);
        throw e;
      }
      if (vivas.get(slug)?.id !== id) { janela?.close(); return; }
      if (r.conectado) {
        // GitHub pelo gh desta máquina: conectado sem login nenhum (ADR-048).
        janela?.close();
        await concluir(slug, id);
        return;
      }
      if (!r.url) {
        janela?.close();
        vivas.delete(slug);
        deps.mudou(slug, { url: null, falhou: r.frase ?? "Não foi possível conectar agora." });
        return;
      }
      try {
        if (janela && !janela.closed) janela.location.href = r.url;
      } catch {
        // janela de outra origem: segue pelo link do card
      }
      deps.mudou(slug, { url: r.url, falhou: null });
      await esperarLogin(slug, id, r.url);
    },
    cancelar(slug: string): void {
      const viva = vivas.get(slug);
      vivas.delete(slug);
      try { viva?.janela?.close(); } catch { /* já fechada */ }
      deps.mudou(slug, null);
    },
    /** Sessão trocada ou encerrada: nenhuma espera continua perguntando em nome de outra pessoa. */
    cancelarTodas(): void {
      for (const slug of [...vivas.keys()]) this.cancelar(slug);
    },
    esperando(slug: string): boolean {
      return vivas.has(slug);
    },
  };
}

export type Conexoes = ReturnType<typeof criarConexoes>;
