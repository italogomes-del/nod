import { describe, expect, it } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import { templateDoMenu } from "../../../desktop/menu.ts";

/** NOD-174: o menu do Mac em pt-BR. Todo item com `role` ganha `label` explícito; o rótulo nativo do Electron é em inglês. */
const nada = { conexao: () => undefined, definirAvisos: () => undefined };

function itens(template: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return template.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? itens(i.submenu) : [])]);
}
const rotulos = (empacotado: boolean) => itens(templateDoMenu({ avisos: true, empacotado }, nada)).filter((i) => i.type !== "separator").map((i) => i.label);

describe("templateDoMenu", () => {
  it("nenhum item visível fica sem rótulo, nem item com role", () => {
    for (const empacotado of [true, false]) {
      for (const item of itens(templateDoMenu({ avisos: false, empacotado }, nada))) {
        if (item.type === "separator") continue;
        expect(item.label, JSON.stringify(item)).toBeTruthy();
      }
    }
  });

  it("os rótulos são os da spec, em pt-BR", () => {
    expect(rotulos(true)).toEqual([
      "nod", "Conexão / verificar conta de IA", "Avisos no Mac", "Sair do nod",
      "Editar", "Desfazer", "Refazer", "Recortar", "Copiar", "Colar", "Selecionar tudo",
      "Visualizar", "Recarregar", "Tamanho real", "Aumentar", "Diminuir", "Tela cheia",
    ]);
  });

  it("nenhum rótulo em inglês", () => {
    const ingles = /\b(Quit|Edit|View|Undo|Redo|Cut|Copy|Paste|Select|Reload|Zoom|Toggle|Developer|Tools|Actual|Size|Full ?Screen)\b/i;
    for (const r of rotulos(false)) expect(r).not.toMatch(ingles);
  });

  it("Ferramentas de desenvolvedor só fora do app empacotado", () => {
    const devtools = (empacotado: boolean) => itens(templateDoMenu({ avisos: true, empacotado }, nada)).filter((i) => i.role === "toggleDevTools");
    expect(devtools(true)).toEqual([]);
    expect(devtools(false).map((i) => i.label)).toEqual(["Ferramentas de desenvolvedor"]);
  });

  it("o checkbox Avisos segue a preferência e chama a ação", () => {
    const chamadas: boolean[] = [];
    for (const avisos of [true, false]) {
      const item = itens(templateDoMenu({ avisos, empacotado: true }, { ...nada, definirAvisos: (l) => chamadas.push(l) })).find((i) => i.label === "Avisos no Mac");
      expect(item?.checked).toBe(avisos);
      item?.click?.({ checked: !avisos } as never, undefined, {} as never);
    }
    expect(chamadas).toEqual([false, true]);
  });

  it("os itens nativos mantêm o role (Copiar e Colar seguem funcionando)", () => {
    const porRotulo = new Map(itens(templateDoMenu({ avisos: true, empacotado: true }, nada)).map((i) => [i.label, i.role]));
    expect(porRotulo.get("Copiar")).toBe("copy");
    expect(porRotulo.get("Colar")).toBe("paste");
    expect(porRotulo.get("Sair do nod")).toBe("quit");
  });
});
