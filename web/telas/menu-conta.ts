import type { Experimentos } from "../../src/contracts/raio-x.ts";
import type { SecaoEspaco } from "../estado/reducer.ts";
import { ICONE } from "../lib/icones.ts";
import { esc } from "../lib/render.ts";
import { pilhaDeAvatares } from "./cartao-ia.ts";

/**
 * Menu da conta (definido em 2026-09-30, canvas "Menu, sidebar e gaveta"): o avatar do rodapé abre este menu no lugar de
 * levar direto a Seu espaço, como no Grok. Cada item com › abre Seu espaço naquela seção; Modo dev liga ali mesmo. A faixa
 * do topo só existe quando algo precisa da pessoa — a IA desconectada ou um conector fora do ar (ADR-029: escrito).
 */
export type DadosMenuConta = {
  faixa: { texto: string; botao: string } | null;
  conexao: string;
  avisos: string;
  modoDev: boolean;
  /** ADR-111: as chaves de experimento, logo abaixo do Modo dev (ADR-112: e o Modo WhatsApp). Ausente = todas desligadas. */
  experimentos?: Experimentos;
  banco: { texto: string; regime: string } | null;
  /** ADR-085: o que o item Este Mac diz à direita ("Equilibrado", ou "Ocupado" quando segura trabalho novo). */
  esteMac?: string;
};

/** "Gmail e ClickUp fora do ar"; com mais de três, os dois primeiros e quantos faltam. */
export function faixaDeConectores(nomes: readonly string[]): string {
  const lista = nomes.length > 3 ? [...nomes.slice(0, 2), `mais ${nomes.length - 2}`] : [...nomes];
  return `${new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" }).format(lista)} fora do ar`;
}

/**
 * definido em 2026-10-16 (ADR-111): as chaves de experimento, como a do Modo dev — ligam ali mesmo e valem para os turnos
 * seguintes de todos os bots da pessoa. O porquê fica no title (hover), não no menu; o Raio-X de cada turno diz o que valeu.
 */
const EXPERIMENTOS: readonly { chave: keyof Experimentos; icone: string; nome: string; dica: string }[] = [
  { chave: "calibracao", icone: ICONE.escudo, nome: "Calibração", dica: "Experimento: o bot diz que não achou em vez de afirmar que algo não existe." },
  { chave: "memoriaLonga", icone: ICONE.livro, nome: "Memória longa", dica: "Experimento: sem sessão retomada, o bot recebe as falas recentes inteiras (até 8 mil caracteres) e os anexos de antes." },
  // definido em 2026-10-17 (ADR-112): a terceira chave, logo abaixo das duas da ADR-111.
  { chave: "whatsapp", icone: ICONE.balao, nome: "Modo WhatsApp", dica: "Experimento: respostas curtas, como no WhatsApp — uma a três frases, sem títulos nem listas." },
];

export function htmlMenuConta(d: DadosMenuConta): string {
  const item = (secao: SecaoEspaco, icone: string, nome: string, meta = "") => `<button type="button" role="menuitem" data-secao="${secao}">${icone}<span class="mc-nome">${esc(nome)}</span>${meta ? `<span class="mc-meta">${esc(meta)}</span>` : ""}${ICONE.seta}</button>`;
  const faixa = d.faixa ? `<div class="mc-faixa" role="status"><span>${esc(d.faixa.texto)}</span><button type="button" role="menuitem" data-secao="conexao">${esc(d.faixa.botao)}</button></div>` : "";
  const banco = d.banco ? `<p class="mc-banco banco-${esc(d.banco.regime)}"><span aria-hidden="true"></span>${esc(d.banco.texto)}</p>` : "";
  return `<div role="menu" aria-label="Menu da conta">${faixa}
    ${item("conexao", pilhaDeAvatares(true), "Provedores de IA", d.conexao)}
    ${item("avisos", ICONE.sino, "Avisos", d.avisos)}
    <button type="button" role="menuitemcheckbox" aria-checked="${d.modoDev}" data-modo-dev>${ICONE.codigo}<span class="mc-nome">Modo dev</span><kbd>⌘⇧D</kbd><span class="mc-chave" aria-hidden="true"><span></span></span></button>
    ${EXPERIMENTOS.map((e) => `<button type="button" role="menuitemcheckbox" aria-checked="${d.experimentos?.[e.chave] ?? false}" data-experimento="${e.chave}" title="${esc(e.dica)}">${e.icone}<span class="mc-nome">${esc(e.nome)}</span><span class="mc-chave" aria-hidden="true"><span></span></span></button>`).join("")}
    ${item("este-mac", ICONE.medidor, "Este Mac", d.esteMac ?? "")}
    ${item("computadores", ICONE.monitor, "Computadores")}
    <hr>
    ${item("agentes", ICONE.agentes, "Gerenciar agentes")}
    ${item("relatos", ICONE.bandeira, "Relatos")}
    <button type="button" role="menuitem" data-onboarding>${ICONE.brilho}<span class="mc-nome">Ver o onboarding de novo</span></button>
    ${banco ? `<hr>${banco}` : ""}
  </div>`;
}
