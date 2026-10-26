import type { Experimentos } from "../../src/contracts/raio-x.ts";
import type { ConfigUi } from "../estado/reducer.ts";
import type { EstadoAvisos } from "../lib/avisos.ts";
import { grupoConfig, linhaConfig, listaAninhada, type TomStatus } from "../lib/linha-config.ts";
import { esc } from "../lib/render.ts";
import { ESCOLHAS_TEMA, type EscolhaTema } from "../lib/tema.ts";

/**
 * NOD-367 (protótipo v2 do Gil, aprovado em 2026-10-26): Configurações › Geral junta o que eram Preferências e Avisos, em
 * quatro blocos — Aparência (tema), Avisos (os dois switches), Ajuda (onboarding e atalhos; o menu "Ajuda" abre aqui e
 * foca `#ajuda`) e Avançado, recolhido: Modo dev, as chaves de experimento (ADR-111/112) e o status do banco, que saiu do
 * rodapé de todas as telas.
 */

/** As chaves de experimento (ADR-111; ADR-112 soma o Modo WhatsApp), com a dica que antes ficava no title do menu. */
export const EXPERIMENTOS: readonly { chave: keyof Experimentos; nome: string; dica: string }[] = [
  { chave: "calibracao", nome: "Calibração", dica: "O bot diz que não achou em vez de afirmar que algo não existe." },
  { chave: "memoriaLonga", nome: "Memória longa", dica: "Sem sessão retomada, o bot recebe as falas recentes inteiras (até 8 mil caracteres) e os anexos de antes." },
  { chave: "whatsapp", nome: "Modo WhatsApp", dica: "Respostas curtas, como no WhatsApp: uma a três frases, sem títulos nem listas." },
];

const SITUACAO: Record<EstadoAvisos["onde"], Record<EstadoAvisos["situacao"], string>> = {
  mac: {
    ligados: "Ligados",
    desligados: "Desligados",
    bloqueados: "Bloqueados pelo macOS: libere em Ajustes do Sistema → Notificações → nod",
    indisponiveis: "Este Mac não mostra avisos do nod.",
  },
  navegador: {
    ligados: "Ligados",
    desligados: "Desligados",
    bloqueados: "Bloqueados pelo navegador: libere as notificações deste site nos ajustes do navegador.",
    indisponiveis: "Este navegador não mostra avisos.",
  },
};

/** O estado dos avisos em uma palavra. */
export function situacaoCurtaAvisos(a: EstadoAvisos): string {
  return a.situacao === "ligados" ? "Ligados" : a.situacao === "desligados" ? "Desligados" : a.situacao === "bloqueados" ? "Bloqueados" : "Indisponíveis";
}

const TOM_AVISOS: Record<EstadoAvisos["situacao"], TomStatus> = { ligados: "ok", desligados: "neutro", bloqueados: "atencao", indisponiveis: "neutro" };

/** NOD-115: desligado, o aviso sai em silêncio; com os avisos desligados, o som trava na posição guardada. */
export const AJUDA_SOM = "Desligado, o aviso aparece em silêncio: o banner e o número no Dock continuam.";
export const AJUDA_SOM_TRAVADO = "Ligue os avisos para escolher. Sua escolha fica guardada.";

/**
 * definido em 2026-09-24 ("aviso no Mac"): o switch dos avisos e as regras dele em palavras. No app, liga "Avisos no Mac";
 * no navegador, pede a permissão no clique. Bloqueado no navegador, o clique não resolve: o switch trava e o detalhe diz
 * onde liberar.
 */
export function renderAvisos(a: EstadoAvisos): string {
  const ligado = a.situacao === "ligados" || (a.onde === "mac" && a.situacao === "bloqueados");
  const travado = a.situacao === "indisponiveis" || (a.onde === "navegador" && a.situacao === "bloqueados");
  const detalhe = a.situacao === "bloqueados" || a.situacao === "indisponiveis"
    ? SITUACAO[a.onde][a.situacao]
    : a.onde === "mac" ? "Banner e número no Dock quando um bot pede você" : "Notificação do navegador quando um bot pede você";
  const linhas = [
    linhaConfig({
      titulo: "Avisar quando algo precisar de você",
      detalhe,
      status: { texto: situacaoCurtaAvisos(a), tom: TOM_AVISOS[a.situacao] },
      controle: { tipo: "switch", ligado, acao: "alternar-avisos", desabilitado: travado },
    }),
  ];
  if (a.som !== undefined) {
    linhas.push(linhaConfig({
      titulo: "Tocar som",
      detalheHtml: `<span id="avisos-som-ajuda">${esc(ligado ? AJUDA_SOM : AJUDA_SOM_TRAVADO)}</span>`,
      controle: { tipo: "switch", ligado: a.som, acao: "alternar-som", desabilitado: !ligado, descritoPor: "avisos-som-ajuda" },
    }));
  }
  const numero = a.onde === "mac" ? "O número no ícone do Dock mostra quantos pedidos estão abertos." : "O título da aba mostra quantos pedidos estão abertos.";
  return grupoConfig("Avisos", linhas, {
    nota: `Só quando o nod não está na frente: com ele aberto, o pedido já aparece na tela. No máximo um aviso por minuto; pedidos que chegam juntos viram um aviso só. Nunca para quedas que se resolvem sozinhas, como o Mac sem contato, nem para pedidos vencidos. ${numero}`,
  });
}

const kbd = (teclas: readonly string[]) => `<span class="cfg-kbd" aria-hidden="true">${teclas.map((t) => `<kbd>${esc(t)}</kbd>`).join("")}</span>`;

export type DadosGeral = {
  tema: EscolhaTema;
  avisos: EstadoAvisos;
  modoDev: boolean;
  experimentos: Experimentos;
  /** "Banco persistente · porta 5432"; null = o servidor não disse. */
  banco: { texto: string; regime: string } | null;
};

export function renderGeral(d: DadosGeral, ui: ConfigUi): string {
  const tema = grupoConfig("Aparência", [linhaConfig({
    titulo: "Tema",
    detalhe: "Sistema acompanha o modo claro ou escuro do macOS. Vale para este computador.",
    controle: { tipo: "seletor", acao: "escolher-tema", rotulo: "Tema", opcoes: ESCOLHAS_TEMA.map((t) => ({ valor: t.id, rotulo: t.nome, selecionado: t.id === d.tema })) },
  })]);
  const atalho = (titulo: string, teclas: readonly string[], falado: string) => linhaConfig({ titulo, controle: { tipo: "html", html: `${kbd(teclas)}<span class="sr-only">${esc(falado)}</span>` } });
  const ajuda = grupoConfig("Ajuda", [
    linhaConfig({ titulo: "Ver o onboarding de novo", detalhe: "A apresentação do nod, do começo", controle: { tipo: "link", acao: "ver-onboarding" } }),
    atalho("Modo dev", ["⌘", "⇧", "D"], "Command Shift D"),
    atalho("Buscar agentes", ["⌘", "K"], "Command K"),
    atalho("Fechar e voltar", ["esc"], "Esc"),
  ], { id: "ajuda" });
  const aberto = ui.abertos.includes("avancado");
  const tomBanco: TomStatus = d.banco?.regime === "persistente" ? "ok" : d.banco?.regime === "efemero" ? "atencao" : "neutro";
  const avancado = listaAninhada([
    linhaConfig({
      titulo: "Modo dev",
      detalhe: "Mostra, em cada resposta, o custo, os tokens e o que foi enviado ao modelo. Só você vê. O texto enviado fica guardado a partir dos turnos que rodarem com ele ligado.",
      controle: { tipo: "switch", ligado: d.modoDev, acao: "alternar-modo-dev" },
    }),
    ...EXPERIMENTOS.map((e) => linhaConfig({
      titulo: e.nome,
      detalhe: e.dica,
      controle: { tipo: "switch", ligado: d.experimentos[e.chave] ?? false, acao: "alternar-experimento", dados: { experimento: e.chave } },
    })),
    ...(d.banco ? [linhaConfig({ titulo: "Banco", detalhe: "Onde o servidor deste nod guarda os dados", status: { texto: d.banco.texto, tom: tomBanco } })] : []),
  ]);
  const blocoAvancado = grupoConfig(null, [linhaConfig({
    titulo: "Avançado",
    detalhe: "Modo dev e experimentos",
    controle: { tipo: "recolhe", id: "avancado", acao: "config-recolhe", aberto, conteudo: avancado },
  })]);
  return `<section class="espaco-secao cfg-secao cfg-geral">
      <h2>Geral</h2>
      ${tema}
      ${renderAvisos(d.avisos)}
      ${ajuda}
      ${blocoAvancado}
    </section>`;
}
