import type { SuaVezDto } from "../../src/contracts/api.ts";
import { contarAbertas, novasAbertas, redigirAviso, type Aviso, type PedidoNovo } from "./avisos.ts";

/**
 * Quando avisar (definido em 2026-09-24, "aviso no Mac"): as regras de silêncio sobre o que avisos.ts
 * diz que é novo. Relógio, foco e saída são injetados — o teste roda com relógio falso, sem DOM.
 *
 *  - só com o nod FORA da frente (`document.hasFocus()` falso na hora de mostrar): na frente, o pedido
 *    já está na tela e o aviso seria ruído;
 *  - espera 2 s para juntar o que chega junto (uma rotina que pede três acessos vira um aviso);
 *  - no máximo um aviso por 60 s: o que chega no meio entra no próximo;
 *  - nunca o mesmo pedido duas vezes;
 *  - nada nos 5 s depois de um gesto da pessoa (agir() em web/main.ts): o que nasce do próprio clique
 *    ela já sabe — o aviso espera, e só sai se ela não estiver mais na frente;
 *  - trocou a sessão, esquece tudo: a próxima leitura volta a ser só a linha de base.
 */
export const AGRUPAR_MS = 2_000;
export const INTERVALO_MS = 60_000;
export const SILENCIO_APOS_ACAO_MS = 5_000;

export type RelogioAvisador = {
  agora(): number;
  /** Agenda `fn` para daqui a `ms`; devolve o cancelamento. */
  esperar(ms: number, fn: () => void): () => void;
};

export type DepsAvisador = {
  relogio: RelogioAvisador;
  temFoco(): boolean;
  /** A pessoa ligou os avisos (e o navegador ou o macOS deixa). */
  ligado(): boolean;
  pessoaId(): string | null;
  mostrar(aviso: Aviso): void;
};

export type Avisador = {
  /** Depois de cada leitura de "Sua vez": guarda o que é novo e devolve o número do selo. */
  atualizar(suaVez: SuaVezDto): number;
  /** A pessoa agiu: nada de aviso nos próximos 5 s. */
  acaoPropria(): void;
  /** A sessão trocou. */
  reiniciar(): void;
};

export function criarAvisador(deps: DepsAvisador): Avisador {
  let conhecidas: Set<string> | null = null;
  /** Ids das decisões abertas na última leitura: pedido resolvido antes da hora não vira aviso. */
  let abertas = new Set<string>();
  const avisados = new Set<string>();
  let pendentes: PedidoNovo[] = [];
  let primeiroEm = 0;
  let ultimoAviso = Number.NEGATIVE_INFINITY;
  let ultimaAcao = Number.NEGATIVE_INFINITY;
  let cancelar: (() => void) | null = null;
  let marcadoPara = Number.NaN;

  function reagendar(): void {
    if (pendentes.length === 0) return;
    const quando = Math.max(primeiroEm + AGRUPAR_MS, ultimoAviso + INTERVALO_MS, ultimaAcao + SILENCIO_APOS_ACAO_MS);
    if (cancelar && quando === marcadoPara) return;
    cancelar?.();
    marcadoPara = quando;
    cancelar = deps.relogio.esperar(Math.max(0, quando - deps.relogio.agora()), disparar);
  }

  function disparar(): void {
    cancelar = null;
    const lote = pendentes.filter((p) => p.ids.some((id) => abertas.has(id)) && !p.ids.some((id) => avisados.has(id)));
    pendentes = [];
    // Na frente (ou desligado), o lote se perde de propósito: ela está vendo a faixa do topo.
    if (lote.length === 0 || deps.temFoco() || !deps.ligado()) return;
    const aviso = redigirAviso(lote, deps.pessoaId());
    if (!aviso) return;
    for (const p of lote) for (const id of p.ids) avisados.add(id);
    ultimoAviso = deps.relogio.agora();
    deps.mostrar(aviso);
  }

  return {
    atualizar(suaVez) {
      const r = novasAbertas(conhecidas, suaVez);
      conhecidas = r.conhecidas;
      abertas = new Set(suaVez.itens.filter((i) => i.estadoColuna !== "vencido").flatMap((i) => [i.decisao.id, ...i.gemeas]));
      const novas = r.novas.filter((n) => !n.ids.some((id) => avisados.has(id)));
      if (novas.length > 0) {
        if (pendentes.length === 0) primeiroEm = deps.relogio.agora();
        pendentes = [...pendentes, ...novas];
        reagendar();
      }
      return contarAbertas(suaVez);
    },
    acaoPropria() {
      ultimaAcao = deps.relogio.agora();
      reagendar();
    },
    reiniciar() {
      cancelar?.();
      cancelar = null;
      marcadoPara = Number.NaN;
      conhecidas = null;
      abertas = new Set();
      avisados.clear();
      pendentes = [];
      ultimoAviso = Number.NEGATIVE_INFINITY;
      ultimaAcao = Number.NEGATIVE_INFINITY;
    },
  };
}
