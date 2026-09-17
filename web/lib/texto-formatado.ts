import { esc } from "./escape.ts";

/** definido em 2026-09-17: apenas ênfase e código; HTML e links do modelo continuam texto. */
export function textoFormatado(texto: string): string {
  return texto.split(/(```[\s\S]*?```|`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g).map((trecho, i) => {
    if (i % 2 === 0) return esc(trecho).replaceAll("\n", "<br>");
    if (trecho.startsWith("```")) return `<pre><code>${esc(trecho.slice(3, -3).replace(/^\w*\n/, ""))}</code></pre>`;
    if (trecho.startsWith("`") && trecho.endsWith("`")) return `<code>${esc(trecho.slice(1, -1))}</code>`;
    if (trecho.startsWith("**") && trecho.endsWith("**")) return `<strong>${esc(trecho.slice(2, -2))}</strong>`;
    if (trecho.startsWith("*") && trecho.endsWith("*")) return `<em>${esc(trecho.slice(1, -1))}</em>`;
    return esc(trecho).replaceAll("\n", "<br>");
  }).join("");
}
