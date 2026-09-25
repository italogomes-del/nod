import type { FrotaDto } from "../../src/contracts/api.ts";
import type { PayloadPropostaPasta, Proposta } from "../../src/contracts/conversa.ts";
import type { PayloadMensagem } from "../../src/contracts/mensagem.ts";
import type { Estado } from "../estado/reducer.ts";
import { botao, esc } from "../lib/render.ts";
import { mudouQuando } from "../lib/relogio.ts";

/**
 * definido em 2026-09-25 (card de pasta simplificado, mockup "Pasta do projeto" no canvas do nod): o
 * card listava todos os caminhos absolutos, cada um com o seu "Permitir", e a pessoa lia um por um para
 * decidir. Agora o produto sugere a mais provável e pergunta "é essa?", com um botão só; as outras ficam
 * atrás de "Não é essa", primeiro as {@link CURTA} mais prováveis.
 */
export const CURTA = 3;

type Agente = FrotaDto["agentes"][number];
type Candidata = PayloadPropostaPasta["candidatas"][number];
type PastaAberta = Extract<PayloadMensagem, { kind: "pasta_aberta" }>;

const PASTA = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.3l2 2.2h8.7A1.5 1.5 0 0 1 21 9.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/></svg>';
const PASTA_BUSCA = '<svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4.3l2 2.2h8.7A1.5 1.5 0 0 1 21 9.7v8.8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5z"/><circle cx="11.5" cy="13.5" r="2.3"/><path d="M13.2 15.2l1.8 1.8"/></svg>';
const RAMO = '<svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" aria-hidden="true"><circle cx="4.5" cy="3.5" r="1.6"/><circle cx="4.5" cy="12.5" r="1.6"/><circle cx="11.5" cy="6" r="1.6"/><path d="M4.5 5.1v5.8"/><path d="M11.5 7.6c0 2.2-2 2.9-7 3.3"/></svg>';
const CADEADO = '<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><rect x="3.5" y="7" width="9" height="6.5" rx="1.5"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/></svg>';
const CHECK = '<svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 8.5l3 3 7-7"/></svg>';

/**
 * "code › leapy › main-repos": a pasta-mãe, relativa à pasta pessoal. Propostas gravadas antes de
 * 2026-09-25 não têm `onde`: tira o prefixo da pasta pessoal do próprio caminho.
 */
export function ondeLegivel(c: { caminho: string; onde?: string }): string {
  const relativo = c.onde ?? c.caminho.replace(/^\/(?:Users|home)\/[^/]+\/?/, "").split("/").slice(0, -1).join("/");
  const partes = relativo.split("/").filter(Boolean);
  return partes.length === 0 ? "pasta pessoal" : partes.join(" › ");
}

function quando(c: Candidata, agora: number): string {
  return typeof c.modificadoEm === "number" && agora > 0 ? mudouQuando(c.modificadoEm, agora) : "";
}

function cabeca(icone: string, titulo: string, sub: string, mudo = false): string {
  return `<div class="cp-cabeca"><span class="cp-icone${mudo ? " mudo" : ""}">${icone}</span><div><b class="cp-titulo">${titulo}</b>${sub ? `<p class="cp-sub">${sub}</p>` : ""}</div></div>`;
}

function acesso(agente: Agente | undefined): string {
  return `<p class="cp-acesso">${CADEADO}${esc(agente?.nome ?? "O agente")} só mexe nas pastas que você abrir.</p>`;
}

/** O card da proposta de pasta: a sugerida, a lista (depois de "Não é essa") ou o "não achei". */
export function renderCardPasta(p: Proposta, c: PayloadPropostaPasta, estado: Estado, agente: Agente | undefined): string {
  const recusar = botao("recusar-proposta", "Agora não", { classe: "link cp-agora-nao", id: p.id });
  const procurar = (rotulo: string, classe: string) => botao("abrir-workspace", rotulo, { classe, id: p.agenteId });
  const sugerida = c.candidatas[0];
  if (!sugerida) {
    return `<section class="card-pasta" data-proposta="${esc(p.id)}"><div class="cp-corpo">${cabeca(PASTA_BUSCA, `Não achei o ${esc(c.buscaTermo)} no seu computador`, "Procurei nas pastas onde projetos costumam ficar.", true)}${acesso(agente)}</div>
      <div class="cp-rodape">${procurar("Escolher pasta…", "pri")}${recusar}</div></section>`;
  }
  const algumGit = c.candidatas.some((x) => x.git);
  const semGit = (x: Candidata) => (algumGit && !x.git ? " · sem Git" : "");
  const lista = c.candidatas.length > 1 ? estado.listaDePasta[p.id] : undefined;
  if (!lista) {
    const q = quando(sugerida, estado.agora);
    const outra = c.candidatas.length > 1
      ? botao("lista-de-pasta", "Não é essa", { id: p.id, dados: { lista: "curta" } })
      : procurar("Não é essa", "");
    return `<section class="card-pasta" data-proposta="${esc(p.id)}"><div class="cp-corpo">${cabeca(PASTA, `Abrir o projeto ${esc(sugerida.nome)}?`, esc(c.motivo))}
      <div class="cp-pasta" title="${esc(sugerida.caminho)}">${sugerida.git ? RAMO : PASTA}<span class="cp-nome"><b>${esc(sugerida.nome)}</b><small>${esc(ondeLegivel(sugerida))}${semGit(sugerida)}</small></span>${q ? `<span class="cp-quando">${esc(q)}</span>` : ""}</div>
      ${acesso(agente)}</div>
      <div class="cp-rodape">${botao("permitir-pasta", "Usar esta pasta", { classe: "pri", id: p.id, dados: { pasta: sugerida.caminho } })}${outra}${recusar}</div></section>`;
  }
  const mesmoNome = c.candidatas.every((x) => x.nome.toLowerCase() === sugerida.nome.toLowerCase());
  const visiveis = lista === "todas" ? c.candidatas : c.candidatas.slice(0, CURTA);
  const opcoes = visiveis.map((x, i) => {
    const q = quando(x, estado.agora);
    return `<label class="cp-opcao" title="${esc(x.caminho)}"><input type="radio" name="pasta-${esc(p.id)}" value="${esc(x.caminho)}" data-pasta-de="${esc(p.id)}"${i === 0 ? " checked" : ""}><span class="cp-nome"><b>${esc(x.nome)}</b><small>${esc(ondeLegivel(x))}${semGit(x)}</small></span>${q ? `<span class="cp-quando">${esc(q)}</span>` : ""}</label>`;
  }).join("");
  const resto = c.candidatas.length - CURTA;
  const mais = resto > 0
    ? botao("lista-de-pasta", lista === "todas" ? "Mostrar menos" : `Mostrar mais ${resto}`, { classe: "link", id: p.id, dados: { lista: lista === "todas" ? "curta" : "todas" } })
    : "";
  const titulo = mesmoNome ? `Qual é o ${esc(sugerida.nome)} certo?` : "Qual destas pastas?";
  const sub = `Achei ${c.candidatas.length} pastas${mesmoNome ? " com esse nome" : " parecidas"}. A mais provável já está marcada.`;
  return `<section class="card-pasta" data-proposta="${esc(p.id)}"><div class="cp-corpo">${cabeca(PASTA, titulo, sub)}
    <fieldset class="cp-lista" aria-label="Pastas encontradas">${opcoes}</fieldset>
    <div class="cp-links">${mais}${procurar("Procurar em outro lugar…", "link")}</div>
    ${acesso(agente)}</div>
    <div class="cp-rodape">${botao("permitir-pasta", "Usar esta pasta", { classe: "pri", id: p.id })}${recusar}</div></section>`;
}

/** O registro que fica depois de permitir: "leapy aberta para Dev 1 · code › leapy · Trocar". */
export function renderPastaAberta(p: PastaAberta, estado: Estado, agente: Agente | undefined): string {
  const dono = agente !== undefined && agente.ownerId === estado.sessao?.pessoaId;
  const onde = ondeLegivel({ caminho: p.pasta, ...(p.onde !== undefined ? { onde: p.onde } : {}) });
  return `<div class="pasta-aberta" title="${esc(p.pasta)}"><span class="pa-ok">${CHECK}</span><span><b>${esc(p.nome)}</b> aberta para ${esc(agente?.nome ?? "o agente")}</span><small>${esc(onde)}</small>${dono ? botao("abrir-workspace", "Trocar", { classe: "link", id: p.agenteId }) : ""}</div>`;
}
