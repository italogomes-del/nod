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
export function seletoresDoFoco(dados: { act?: string; id?: string; emoji?: string }): string[] {
  if (!dados.act) return [];
  const exato = atributo("act", dados.act) + (dados.id ? atributo("id", dados.id) : "") + (dados.emoji ? atributo("emoji", dados.emoji) : "");
  return dados.id ? [exato, `button${atributo("id", dados.id)}`] : [exato];
}
