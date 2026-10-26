/**
 * Para onde volta o foco quando o bloco da timeline que o tinha é refeito (web/lib/regioes.ts `regiaoPorBlocos`). Puro,
 * sem DOM, para o teste rodar sem navegador (definido em 2026-10-18, revisão do PR 392: depois de reagir pelo teclado o
 * bloco da fala era refeito e o foco caía no <body>).
 */
const atributo = (nome: string, valor: string): string => `[data-${nome}="${valor.replace(/["\\]/g, "\\$&")}"]`;

/**
 * Onde devolver o foco quando o botão focado some num bloco refeito, do mais exato ao mais largo: o mesmo `data-act` da
 * mesma fala (e do mesmo emoji, no chip) e, se ele não existe mais (o chip da última reação tirada), o primeiro botão da
 * mesma fala (a barra de ações). Sem `data-act`, nada: o foco não é devolvido.
 */
export function seletoresDoFoco(dados: { act?: string; id?: string; emoji?: string; disclosure?: string }): string[] {
  // NOD-353 (revisão 2 do #523): o summary de um <details data-disclosure> (o resumo das ações, refeito a cada ação que
  // começa ou termina) volta ao summary do mesmo disclosure no bloco novo.
  if (dados.disclosure) return [`details${atributo("disclosure", dados.disclosure)} > summary`];
  if (!dados.act) return [];
  const exato = atributo("act", dados.act) + (dados.id ? atributo("id", dados.id) : "") + (dados.emoji ? atributo("emoji", dados.emoji) : "");
  return dados.id ? [exato, `button${atributo("id", dados.id)}`] : [exato];
}

/**
 * O primeiro alvo dos seletores, procurado na região refeita e, para o resumo das ações, também na tela inteira: no fim
 * do turno a fala viva sai de `#timeline-ao-vivo` e a gravada já entrou em `#timeline-historico`, outra região (QA do
 * #523: o foco caía no <body>). Os outros botões continuam presos à própria região.
 */
export function alvoDoFoco<T>(dados: { disclosure?: string; act?: string; id?: string; emoji?: string }, regiao: { querySelector(s: string): T | null }, tela: { querySelector(s: string): T | null }): T | null {
  for (const seletor of seletoresDoFoco(dados)) {
    const alvo = regiao.querySelector(seletor) ?? (dados.disclosure ? tela.querySelector(seletor) : null);
    if (alvo) return alvo;
  }
  return null;
}
