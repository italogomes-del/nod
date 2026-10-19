import type { Api } from "../lib/api.ts";
import { foraDoAr } from "../lib/computador.ts";

/**
 * Miniatura da tela do bot no painel (definido em 2026-10-16). A imagem não entra no HTML da gaveta:
 * cada quadro regravaria o painel inteiro. O laço só observa com o painel à vista e o computador
 * livre; o diálogo do desktop, quando aberto, é quem lê a tela e devolve o quadro por `lembrarTela`.
 */
let alvo: { api: Api; agenteId: string } | null = null;
let timer = 0;
let imagem = "";
let emCurso = false;

export function definirTelaDoBot(api: Api | null, agenteId: string | null): void {
  if (!api || !agenteId) {
    alvo = null;
    imagem = "";
    if (timer) { window.clearInterval(timer); timer = 0; }
    return;
  }
  if (alvo?.agenteId !== agenteId) imagem = "";
  alvo = { api, agenteId };
  aplicar();
  if (timer) return;
  void pulso();
  timer = window.setInterval(() => void pulso(), 3000);
}

/** O diálogo acabou de ver este quadro: a miniatura fica igual ao fechar. */
export function lembrarTela(agenteId: string, pngBase64: string): void {
  if (alvo?.agenteId !== agenteId) return;
  imagem = pngBase64;
  aplicar();
}

function preview(): HTMLButtonElement | null {
  if (!alvo) return null;
  return document.querySelector<HTMLButtonElement>(`[data-tela-bot="${CSS.escape(alvo.agenteId)}"]`);
}

function painelAVista(): boolean {
  const app = document.querySelector(".app");
  if (!app?.classList.contains("com-detalhes") || document.hidden) return false;
  if (window.matchMedia("(max-width: 1099px)").matches) return app.classList.contains("detalhes-abertos");
  return !app.classList.contains("detalhes-ocultos");
}

function aplicar(): void {
  const el = preview();
  const img = el?.querySelector("img");
  if (!el || !img) return;
  if (!imagem) {
    img.removeAttribute("src");
    img.hidden = true;
    el.classList.remove("com-imagem");
    return;
  }
  const src = `data:image/png;base64,${imagem}`;
  if (img.getAttribute("src") !== src) img.src = src;
  img.hidden = false;
  el.classList.add("com-imagem");
}

async function pulso(): Promise<void> {
  if (!alvo || emCurso || !painelAVista() || document.querySelector(".computador-dialog")) return;
  const el = preview();
  if (!el) return;
  const { api, agenteId } = alvo;
  emCurso = true;
  try {
    const dto = await api.computador(agenteId);
    if (alvo?.agenteId !== agenteId) return;
    const fora = foraDoAr(dto);
    el.classList.toggle("tela-fora", fora);
    const rotulo = el.querySelector(".tela-pilula span");
    if (rotulo) rotulo.textContent = fora ? "Tentar de novo" : "Abrir";
    if (!dto.ativo || fora || (dto.computador.ocupadoAte ?? 0) > Date.now()) {
      if (!dto.ativo || fora) { imagem = ""; aplicar(); }
      return;
    }
    const r = await api.acaoComputador(agenteId, { tipo: "observar" });
    if (alvo?.agenteId !== agenteId || !r.tela) return;
    imagem = r.tela.imagem;
    aplicar();
  } catch {
    // A miniatura fica no último quadro. Abrir continua no botão.
  } finally {
    emCurso = false;
  }
}
