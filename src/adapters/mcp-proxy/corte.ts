/**
 * Corte do resultado ao orçamento ANTES de entrar no contexto (ADR-013, quarta responsabilidade).
 * O corte é visível: a marca diz quantos caracteres ficaram de fora, para o modelo não inventar o
 * resto. Nunca corta entre os dois code units de um par substituto (surrogate): recua um.
 *
 * definido em 2026-09-24: a marca também diz o que fazer. A Nina chamou GMAIL_FETCH_EMAILS com o
 * corpo HTML completo; 10 e-mails deram 956.210 bytes e os 8.000 caracteres que sobraram mal cobriam
 * o <head> do primeiro. Sem a dica, o modelo trabalha com o pedaço em vez de refazer pedindo menos.
 */
export type ResultadoCorte = { texto: string; cortado: boolean; original: number };

export function cortar(texto: string, orcamentoChars: number): ResultadoCorte {
  const original = texto.length;
  const orcamento = Math.max(0, Math.floor(orcamentoChars));
  if (original <= orcamento) return { texto, cortado: false, original };
  let fim = orcamento;
  const c = fim > 0 ? texto.charCodeAt(fim - 1) : 0;
  if (fim > 0 && c >= 0xd800 && c <= 0xdbff) fim -= 1;
  const cabeca = texto.slice(0, fim);
  return {
    texto: `${cabeca}\n[cortado pelo nod: ${original - fim} de ${original} caracteres ficaram de fora; orçamento do turno = ${orcamento}. Se precisa do resto, refaça a chamada pedindo menos itens ou só metadados]`,
    cortado: true,
    original,
  };
}
