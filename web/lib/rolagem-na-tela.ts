import { depoisDeRolar, distanciaDoFim, permanenciaDaLinha, pilulaDaPergunta, pilulaDasNovas, type LinhaNaJanela, type Medida, type Permanencia, type PerguntaNaJanela } from "./rolagem.ts";

/**
 * A rolagem da conversa na tela (definido em 2026-10-05): o estado "colada no fim" e a pílula da base, ligados à caixa
 * que rola. As decisões moram em web/lib/rolagem.ts, sem DOM, onde os testes as alcançam.
 */
export type Rolagem = {
  /**
   * Depois de regravar a timeline: a conversa que mudou abre colada; colada, desce até o fim. `null` = a tela não é
   * chat. `historicoMudou` = o histórico (onde moram a linha "Novas" e as sugestões da conversa vazia) foi mexido.
   */
  depoisDeDesenhar(conversaId: string | null, historicoMudou: boolean): void;
  /** Volta a acompanhar o fim (a pessoa mandou mensagem). */
  colar(): void;
  /** Para de acompanhar ANTES de levar a outro ponto (pergunta, aprovação): senão o próximo crescimento puxa de volta. */
  soltar(): void;
  /** A pílula das novas: leva a linha "Novas" para o alto da janela. */
  irParaNovas(): void;
  /** A pessoa já viu a linha "Novas" que entrou acima desta mensagem? */
  jaViu(mensagemId: string): boolean;
};

/** `caixa` é a região que rola (#timeline); `lugarDaPilula`, logo acima do campo. */
export function criarRolagem(caixa: HTMLElement, lugarDaPilula: HTMLElement, suave: () => boolean): Rolagem {
  let conversa: string | null = null;
  let estado = { colada: true, topoAntes: 0 };
  /** A linha "Novas" (o data-novas dela) que já ficou na janela o bastante nesta visita. */
  let linhaVista: string | null = null;
  let permanencia: Permanencia = null;
  let observado: Element | null = null;
  let pilulaHtml = "";
  // A linha "Novas" e as sugestões moram no histórico: são procuradas quando ele muda, não a cada evento. Procurar na
  // timeline inteira (dezenas de milhares de nós numa conversa longa) a cada quadro de streaming é o que a ADR-061 tirou.
  let linha: HTMLElement | null = null;
  let cartao: HTMLElement | null = null;
  let vazia = false;

  const medida = (): Medida => ({ topo: caixa.scrollTop, altura: caixa.scrollHeight, janela: caixa.clientHeight });

  function irAoFim(): void {
    caixa.scrollTop = caixa.scrollHeight;
    estado = { colada: true, topoAntes: caixa.scrollTop };
  }

  function linhaNaJanela(): LinhaNaJanela | null {
    if (!linha?.isConnected) return null;
    const r = linha.getBoundingClientRect();
    const c = caixa.getBoundingClientRect();
    const chave = linha.dataset.novas ?? "";
    const p = permanenciaDaLinha(permanencia, chave, r.bottom > c.top && r.top < c.bottom, performance.now());
    permanencia = p.permanencia;
    if (p.vista) linhaVista = chave;
    return { acima: r.bottom <= c.top, vista: linhaVista === chave, total: Number(linha.dataset.total) || 0, desde: Number(linha.dataset.desde) || 0 };
  }

  /** O cartão aberto mais recente (plano "pergunta com botões", 2026-10-18), procurado como a linha "Novas". */
  function perguntaNaJanela(): PerguntaNaJanela | null {
    if (!cartao?.isConnected || !cartao.classList.contains("aberta")) return null;
    const r = cartao.getBoundingClientRect();
    const c = caixa.getBoundingClientRect();
    const posicao = r.top >= c.bottom ? "abaixo" : r.bottom <= c.top ? "acima" : "visivel";
    return { decisaoId: cartao.dataset.cartaoPergunta ?? "", nome: cartao.dataset.nome ?? "O bot", posicao };
  }

  function atualizarPilula(): void {
    // A linha "Novas" é medida sempre (é a medida que a dá por vista); a pílula da pergunta ganha da das novas.
    const novas = conversa ? pilulaDasNovas(linhaNaJanela()) : "";
    const html = conversa ? pilulaDaPergunta(perguntaNaJanela()) || novas : "";
    if (html === pilulaHtml) return;
    pilulaHtml = html;
    lugarDaPilula.innerHTML = html;
  }

  // Colada, qualquer mudança de tamanho desce: o conteúdo crescendo (imagem, artefato, <details>) ou a caixa
  // encolhendo (o campo ganhando linhas, a faixa da pergunta). O callback roda depois do layout e antes da pintura.
  const observador = new ResizeObserver(() => {
    if (!conversa) return;
    if (estado.colada) irAoFim();
    atualizarPilula();
  });
  observador.observe(caixa);

  caixa.addEventListener("scroll", () => {
    if (!conversa) return;
    estado = depoisDeRolar(estado, medida());
    atualizarPilula();
  }, { passive: true });

  return {
    depoisDeDesenhar(conversaId, historicoMudou) {
      const outra = conversaId !== conversa;
      if (outra) {
        conversa = conversaId;
        estado = { colada: true, topoAntes: 0 };
        linhaVista = null;
        permanencia = null;
      }
      if (outra || historicoMudou) {
        linha = caixa.querySelector<HTMLElement>(".linha-novas");
        cartao = [...caixa.querySelectorAll<HTMLElement>(".cartao-pergunta.aberta")].at(-1) ?? null;
        const eraVazia = !outra && vazia;
        vazia = caixa.querySelector(".welcome-options") !== null;
        // A conversa vazia abre nas sugestões, no alto, e não acompanha o fim: quem rola até a opção D e começa a
        // digitar não volta ao topo quando o campo cresce. A primeira mensagem volta a acompanhar.
        if (vazia && !eraVazia) {
          caixa.scrollTop = 0;
          estado = { colada: false, topoAntes: 0 };
        } else if (!vazia && eraVazia) estado = { ...estado, colada: true };
      }
      // A casca da timeline é trocada quando a tela muda: o observador segue o conteúdo da vez.
      const conteudo = caixa.firstElementChild;
      if (conteudo !== observado) {
        if (observado) observador.unobserve(observado);
        if (conteudo) observador.observe(conteudo);
        observado = conteudo;
      }
      if (conversa && estado.colada) irAoFim();
      atualizarPilula();
    },
    colar() {
      irAoFim();
      atualizarPilula();
    },
    soltar() {
      estado = { ...estado, colada: false };
      // Com o card já no fim e a caixa no fim, não há para onde rolar e nenhum evento chega para colar de novo: a
      // conversa ficaria solta no fim, sem acompanhar a resposta. Confere depois que a rolagem suave teria começado.
      window.setTimeout(() => {
        if (conversa && !estado.colada && distanciaDoFim(medida()) <= 2) estado = { colada: true, topoAntes: caixa.scrollTop };
      }, 300);
    },
    irParaNovas() {
      if (!linha?.isConnected) return;
      // A primeira nova pode estar num fio de pergunta já resolvido, que fica recolhido: abre antes de medir.
      for (let d = linha.closest<HTMLDetailsElement>("details:not([open])"); d; d = linha.closest<HTMLDetailsElement>("details:not([open])")) d.open = true;
      estado = { ...estado, colada: false };
      linhaVista = linha.dataset.novas ?? "";
      const alvo = caixa.scrollTop + linha.getBoundingClientRect().top - caixa.getBoundingClientRect().top - 12;
      caixa.scrollTo({ top: Math.max(0, alvo), behavior: suave() ? "smooth" : "auto" });
      atualizarPilula();
    },
    jaViu(mensagemId) {
      return linhaVista === mensagemId;
    },
  };
}
