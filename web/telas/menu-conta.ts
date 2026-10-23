import type { ContaIa } from "../../src/contracts/contas-ia.ts";
import type { Experimentos } from "../../src/contracts/raio-x.ts";
import type { SecaoEspaco } from "../estado/reducer.ts";
import { ICONE } from "../lib/icones.ts";
import { esc } from "../lib/render.ts";
import { pilhaDeAvatares, PROVEDOR } from "./cartao-ia.ts";
import { contaEmUso } from "./contas-lista.ts";
import { ALERTA_USO, maiorUso, pctUsado, proximaDaFila, quandoNaTela } from "./uso-da-conta.ts";

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
  /**
   * NOD-345 (ADR-124): ausente = servidor sem contas (o menu de antes). `email: null` = espaço provisório: a linha fixa
   * "Criar conta ou entrar · Seu espaço está só neste computador" (o lembrete permanente, opção 2 do Gil).
   */
  conta?: { email: string | null; senha: boolean; legado?: boolean };
};

/** NOD-345: o topo do menu com contas — sem conta, o convite; com conta, o e-mail e o que se faz com ela. */
export function htmlSecaoConta(c: NonNullable<DadosMenuConta["conta"]>): string {
  const item = (qual: string, nome: string, meta = "") => `<button type="button" role="menuitem" data-conta="${qual}">${ICONE.pessoa}<span class="mc-nome">${esc(nome)}</span>${meta ? `<span class="mc-meta">${esc(meta)}</span>` : ""}</button>`;
  if (c.email === null) return `${item("inicio", "Criar conta ou entrar", "Seu espaço está só neste computador")}<hr>`;
  // Pessoa de antes das contas (entrou pelo Google da lista): gerencia e encerra as sessões, sem senha nem pareamento.
  if (c.legado) return `<p class="mc-conta">${esc(c.email)}</p>${item("sessoes", "Sessões")}${item("sair", "Sair")}<hr>`;
  return `<p class="mc-conta">${esc(c.email)}</p>${c.senha ? item("senha", "Trocar senha") : ""}${item("sessoes", "Sessões")}${item("parear-gerar", "Conectar outro computador")}${item("sair", "Sair")}<hr>`;
}

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

/** O uso do plano que segura as rotinas: o texto da faixa do menu e o resumo que entra no nome acessível do avatar. */
export type AvisoDoUso = { texto: string; resumo: string };

type IaTravada = { nome: string; apelido: string; limite: boolean; ate: number | null; pct: number; janela: "5 h" | "semana" };

/**
 * NOD-12 (definido em 2026-10-22, protótipo do Gil no PR #414): a faixa do menu da conta pelo uso do plano. Só aparece
 * quando as rotinas vão esperar: a conta em uso de alguma IA está a partir de 90% (ou no limite) e não há outra conta
 * dela pronta na fila. Com conta seguinte, nada aqui (a linha da conta já diz para onde vai). A conversa nunca é
 * segurada (ADR-099 §7), e o texto diz isso no limite.
 */
export function faixaDoUso(contas: readonly ContaIa[], agora: number): AvisoDoUso | null {
  const travadas: IaTravada[] = [];
  for (const ia of ["claude-cli", "codex-cli"] as const) {
    const nome = PROVEDOR[ia].nome;
    const logadas = contas.filter((c) => c.ia === ia && c.maquinas.some((v) => v.estado === "pronta"));
    if (logadas.length === 0) continue;
    const emUso = contaEmUso(contas, agora, { ia });
    if (!emUso) {
      // Nenhuma pronta fora do limite: a IA está no limite até a primeira voltar.
      const voltas = logadas.map((c) => c.noLimiteAte).filter((t): t is number => t !== null && t > agora);
      if (voltas.length) travadas.push({ nome, apelido: logadas[0]!.apelido, limite: true, ate: Math.min(...voltas), pct: 100, janela: "5 h" });
      continue;
    }
    const q = emUso.cota;
    const maior = maiorUso(q);
    if (!q || maior === null || maior < ALERTA_USO || proximaDaFila(emUso, contas, agora)) continue;
    const j = q.cincoHoras && q.cincoHoras.utilizacao === maior ? { j: q.cincoHoras, nome: "5 h" as const } : { j: q.semana!, nome: "semana" as const };
    travadas.push({ nome, apelido: emUso.apelido, limite: maior >= 1, ate: j.j.renovaEm, pct: pctUsado(maior), janela: j.nome });
  }
  if (travadas.length === 0) return null;
  const nomes = new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" }).format(travadas.map((t) => t.nome));
  if (travadas.length > 1) {
    const todas = travadas.every((t) => t.limite);
    return todas
      ? { texto: `${nomes} no limite. As rotinas esperam até renovar; a conversa com você segue.`, resumo: `${nomes} no limite` }
      : { texto: `${nomes} perto do limite. Sem outra conta na fila, as rotinas esperam.`, resumo: `${nomes} perto do limite` };
  }
  const t = travadas[0]!;
  if (t.limite) {
    const ate = t.ate !== null ? ` até ${quandoNaTela(t.ate, agora)}` : "";
    return { texto: `${t.nome} no limite${ate}. As rotinas esperam até ${ate ? "lá" : "renovar"}; a conversa com você segue.`, resumo: `${t.nome} no limite${ate}` };
  }
  const renova = t.ate !== null ? `, renova ${quandoNaTela(t.ate, agora).includes(" às ") ? "em " : "às "}${quandoNaTela(t.ate, agora)}` : "";
  const janela = t.janela === "5 h" ? "da janela de 5 h" : "da semana";
  return {
    texto: `${t.nome} · ${t.apelido} em ${t.pct}% ${janela}${renova}. Sem outra conta na fila, as rotinas esperam até ${renova ? "lá" : "renovar"}.`,
    resumo: `${t.nome} perto do limite`,
  };
}

export function htmlMenuConta(d: DadosMenuConta): string {
  const item = (secao: SecaoEspaco, icone: string, nome: string, meta = "") => `<button type="button" role="menuitem" data-secao="${secao}">${icone}<span class="mc-nome">${esc(nome)}</span>${meta ? `<span class="mc-meta">${esc(meta)}</span>` : ""}${ICONE.seta}</button>`;
  const faixa = d.faixa ? `<div class="mc-faixa" role="status"><span>${esc(d.faixa.texto)}</span><button type="button" role="menuitem" data-secao="conexao">${esc(d.faixa.botao)}</button></div>` : "";
  const banco = d.banco ? `<p class="mc-banco banco-${esc(d.banco.regime)}"><span aria-hidden="true"></span>${esc(d.banco.texto)}</p>` : "";
  return `<div role="menu" aria-label="Menu da conta">${faixa}${d.conta ? htmlSecaoConta(d.conta) : ""}
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
