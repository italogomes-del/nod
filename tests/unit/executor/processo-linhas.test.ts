import { describe, expect, it } from "vitest";
import { criarDivisorDeLinhas } from "../../../src/adapters/executor/processo.ts";

/**
 * O divisor de linhas do stdout do CLI (src/adapters/executor/processo.ts): o "\n" é procurado só no pedaço que chegou,
 * então uma linha grande partida em muitos pedaços custa proporcional ao tamanho dela, não ao quadrado.
 */
function dividir(pedacos: readonly string[]): string[] {
  const linhas: string[] = [];
  const divisor = criarDivisorDeLinhas((l) => linhas.push(l));
  for (const p of pedacos) divisor.empurrar(p);
  divisor.fechar();
  return linhas;
}

describe("criarDivisorDeLinhas", () => {
  it("linha partida em qualquer ponto, várias num pedaço, linha vazia e o resto sem \\n só no fechar", () => {
    expect(dividir(['{"a":1}\n{"b"', ':2}\n\n{"c":3', '}\n{"d":4}'])).toEqual(['{"a":1}', '{"b":2}', "", '{"c":3}', '{"d":4}']);
    expect(dividir(["abc", "", "def\n", "\n"])).toEqual(["abcdef", ""]);
    // Resto só de espaço não vira linha, como antes da troca.
    expect(dividir(["   ", "\t"])).toEqual([]);
  });

  it("uma linha de 8 MB em pedaços de 512 bytes sai inteira e uma vez só, sem o custo quadrático", () => {
    const linha = `{"type":"user","texto":"${"x".repeat(8_000_000)}"}`;
    const pedacos: string[] = [];
    for (let i = 0; i < linha.length; i += 512) pedacos.push(linha.slice(i, i + 512));
    pedacos[pedacos.length - 1] += "\n";
    const inicio = performance.now();
    const linhas = dividir([...pedacos, '{"type":"result"}\n']);
    const ms = performance.now() - inicio;
    expect(linhas).toHaveLength(2);
    expect(linhas[0]).toBe(linha);
    expect(linhas[1]).toBe('{"type":"result"}');
    // Com `resto += pedaco; resto.indexOf("\n")` cada um dos ~15,6 mil pedaços relia a linha acumulada (até 8 MB):
    // dezenas de bilhões de caracteres. Linear, são milissegundos; 2 s é folga para máquina carregada sem deixar a
    // regressão passar.
    expect(ms).toBeLessThan(2_000);
  });
});
