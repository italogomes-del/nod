import type { ModoAprovacao } from "../../src/contracts/agente.ts";
import { esc } from "../lib/render.ts";

/**
 * O modo de aprovação do bot no campo (ADR-059; canvas "Nod — tela do agente", página "Aprovações"): o chip ao lado
 * do clipe, o menu com os três modos e o aviso acima do campo. A web só pede (POST agentes/:id/modo-aprovacao) e
 * mostra; quem decide cada ação é o servidor. Os nomes espelham ROTULO_MODO do domínio: a web não importa valores
 * de src (ADR-018).
 */
type Rotulos = { curto: string; titulo: string; descricao: string };

export const MODOS: Readonly<Record<ModoAprovacao, Rotulos>> = {
  manual: { curto: "Manual", titulo: "Aprovar manualmente", descricao: "Pede você para o que muda algo: commit, push, mensagem, tarefa" },
  automatico: { curto: "Auto", titulo: "Aprovar automaticamente", descricao: "Aprova as próprias ações e para no que for arriscado ou vier depois de ler a web ou um e-mail" },
  total: { curto: "Sem aprovações", titulo: "Ignorar todas as aprovações", descricao: "Aprova tudo, até depois de ler a web ou um e-mail. Só credenciais do Mac pedem você" },
};

const ORDEM: readonly ModoAprovacao[] = ["manual", "automatico", "total"];

const svg = (corpo: string, tamanho = 16) => `<svg width="${tamanho}" height="${tamanho}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;

const ICONE: Readonly<Record<ModoAprovacao, string>> = {
  manual: '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  automatico: '<path d="M13 19l9-7-9-7z"/><path d="M2 19l9-7-9-7z"/>',
  total: '<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
};
const SETA = '<path d="m6 9 6 6 6-6"/>';
const CHECK = '<path d="M20 6 9 17l-5-5"/>';
const FECHAR = '<path d="M18 6 6 18M6 6l12 12"/>';

/** O botão do campo, criado uma vez com o composer; o conteúdo é trocado por `renderChipModo` a cada render. */
export const HTML_CHIP_MODO = '<button type="button" class="modo-chip" id="composer-modo" data-act="modo-aprovacao" aria-haspopup="menu" aria-expanded="false"></button>';

/** O miolo do chip. Quem não é a dona vê o modo e não muda (o servidor recusa do mesmo jeito). */
export function renderChipModo(modo: ModoAprovacao, dona: boolean): { html: string; titulo: string } {
  const r = MODOS[modo];
  return {
    html: `${svg(ICONE[modo])}<span>${esc(r.curto)}</span>${dona ? svg(SETA, 14) : ""}`,
    titulo: dona ? `${r.titulo} · clique para mudar` : `${r.titulo} · só a dona do bot muda`,
  };
}

/** O aviso acima do campo, como o do Claude: só nos modos que aprovam sozinhos, e some ao fechar. */
export function renderAvisoModo(nome: string, modo: ModoAprovacao): string {
  if (modo === "manual") return "";
  const texto = modo === "automatico"
    ? `<b>A aprovação automática está ligada.</b> ${esc(nome)} aprova as próprias ações e para quando algo é arriscado, toca uma credencial do Mac ou vem depois de ler a web ou um e-mail nesta tarefa.`
    : `<b>${esc(nome)} está sem aprovações.</b> Tudo o que o bot fizer sai sem pedir você, até depois de ler a web ou um e-mail — e um texto de fora pode induzi-lo a agir. Só credenciais do Mac ainda pedem você.`;
  return `<div class="aviso-modo aviso-${modo}" role="status"><span class="aviso-modo-ic">${svg(ICONE[modo])}</span><span class="aviso-modo-txt">${texto}</span><button type="button" class="aviso-modo-fechar" data-act="fechar-aviso-modo" aria-label="Fechar aviso">${svg(FECHAR, 14)}</button></div>`;
}

/** O menu dos três modos (itens `menuitemradio`, o atual marcado). Puro, para o teste ler o HTML. */
export function renderMenuModo(nome: string, atual: ModoAprovacao): string {
  const item = (m: ModoAprovacao) => `<button type="button" role="menuitemradio" aria-checked="${m === atual}" data-modo="${m}" class="modo-item modo-${m}">
    <span class="modo-ic">${svg(ICONE[m], 20)}</span><span class="modo-txt"><b>${esc(MODOS[m].titulo)}</b><small>${esc(MODOS[m].descricao)}</small></span>${m === atual ? `<span class="modo-check">${svg(CHECK, 18)}</span>` : ""}</button>`;
  return `<div role="menu" aria-label="Como ${esc(nome)} aprova as próprias ações"><p class="menu-nome">Como ${esc(nome)} aprova as próprias ações?</p>${ORDEM.map(item).join("")}<p class="modo-rodape">Vale para as próximas ações de ${esc(nome)}, em todas as conversas e rotinas. Só você muda.</p></div>`;
}
