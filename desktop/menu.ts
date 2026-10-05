/**
 * Menu do app em pt-BR (definido em 2026-10-05, NOD-174). Os `role` do Electron trazem rótulos em inglês ("Quit nod",
 * "Edit", "Toggle Developer Tools"); aqui todo item com `role` ganha `label` explícito e mantém o `role` para o
 * comportamento nativo (Copiar e Colar seguem funcionando). Sem Electron em tempo de execução: só o tipo, testável no
 * vitest (tests/unit/desktop/menu.test.ts). Ferramentas de desenvolvedor só fora do app empacotado.
 */
import type { MenuItemConstructorOptions } from "electron";

export type AcoesDoMenu = { conexao: () => void; definirAvisos: (ligado: boolean) => void };
export type OpcoesDoMenu = { avisos: boolean; empacotado: boolean };

/** O idioma que o Chromium usa no menu de contexto, nos diálogos nativos e na validação da página. */
export const IDIOMA_DO_APP = "pt-BR";

export function templateDoMenu(opcoes: OpcoesDoMenu, acoes: AcoesDoMenu): MenuItemConstructorOptions[] {
  const visualizar: MenuItemConstructorOptions[] = [
    { label: "Recarregar", role: "reload" },
    ...(opcoes.empacotado ? [] : [{ label: "Ferramentas de desenvolvedor", role: "toggleDevTools" } satisfies MenuItemConstructorOptions]),
    { type: "separator" },
    { label: "Tamanho real", role: "resetZoom" },
    { label: "Aumentar", role: "zoomIn" },
    { label: "Diminuir", role: "zoomOut" },
    { type: "separator" },
    { label: "Tela cheia", role: "togglefullscreen" },
  ];
  return [
    {
      label: "nod",
      submenu: [
        { label: "Conexão / verificar conta de IA", click: () => acoes.conexao() },
        { type: "separator" },
        { label: "Avisos no Mac", type: "checkbox", checked: opcoes.avisos, click: (item) => acoes.definirAvisos(item.checked) },
        { type: "separator" },
        { label: "Sair do nod", role: "quit" },
      ],
    },
    {
      label: "Editar",
      submenu: [
        { label: "Desfazer", role: "undo" },
        { label: "Refazer", role: "redo" },
        { type: "separator" },
        { label: "Recortar", role: "cut" },
        { label: "Copiar", role: "copy" },
        { label: "Colar", role: "paste" },
        { label: "Selecionar tudo", role: "selectAll" },
      ],
    },
    { label: "Visualizar", submenu: visualizar },
  ];
}
