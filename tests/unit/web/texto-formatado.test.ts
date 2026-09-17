import { describe, expect, it } from "vitest";
import { textoFormatado } from "../../../web/lib/texto-formatado.ts";

describe("texto do modelo na conversa", () => {
  it("mostra ênfase e quebras sem transformar HTML ou URLs em elementos ativos", () => {
    expect(textoFormatado('**Dica:** use *clareza*\n<script>alert(1)</script> [abrir](javascript:alert(1))')).toBe('<strong>Dica:</strong> use <em>clareza</em><br>&lt;script&gt;alert(1)&lt;/script&gt; [abrir](javascript:alert(1))');
  });
  it("preserva código e escapa conteúdo em blocos e trechos inline", () => {
    expect(textoFormatado('```html\n<img onerror="alert(1)">\n```\n`**literal**`')).toBe('<pre><code>&lt;img onerror=&quot;alert(1)&quot;&gt;\n</code></pre><br><code>**literal**</code>');
  });
});
