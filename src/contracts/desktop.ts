/**
 * Ponte da JANELA WEB do app desktop (definido em 2026-09-24, "aviso no Mac"): o que o preload dela
 * (desktop/preload-web.ts) expõe como `window.nodDesktop`. Só tipos e `as const` (EMENDA 26): a web
 * importa com `import type`; o processo principal valida cada argumento (desktop/avisos-mac.ts), porque
 * quem chama é uma página remota.
 *
 * Separada da ponte da tela de conexão (`window.nod`, desktop/preload.ts): aquela entrega `conectar` e
 * a chave da máquina, e a web já usa `window.nod` para inspeção no console.
 */

/** Para onde o clique no aviso leva: a conversa do pedido (um só) ou "Sua vez" (vários). */
export type AlvoAviso = { tipo: "conversa"; conversaId: string; agenteId: string } | { tipo: "sua-vez" };

/** Um aviso já redigido pela web (web/lib/avisos.ts): o Mac só mostra. */
export type AvisoDesktop = { titulo: string; corpo: string; alvo: AlvoAviso };

/** A preferência "Avisos no Mac" (userData/preferencias.json) e o que o macOS deixou mostrar. */
export type PreferenciasDesktop = {
  avisos: boolean;
  /** O último aviso falhou ao aparecer: as notificações do nod estão desligadas nos Ajustes do Sistema. */
  bloqueados: boolean;
};

export type NodDesktop = {
  /** Mostra o aviso só se a janela do nod não estiver na frente; devolve se mostrou. */
  avisar(aviso: AvisoDesktop): Promise<boolean>;
  /** O número no ícone do Dock: pedidos abertos (0 apaga). */
  contador(n: number): Promise<void>;
  preferencias(): Promise<PreferenciasDesktop>;
  definirAvisos(ligado: boolean): Promise<PreferenciasDesktop>;
  /** Chamado quando a pessoa clica num aviso: a web abre o alvo. */
  aoAbrir(fn: (alvo: AlvoAviso) => void): void;
};

/** Canais de IPC da janela web; nenhum outro chega ao processo principal por ela. */
export const CANAIS_DESKTOP = {
  avisar: "nod:avisar",
  contador: "nod:contador",
  preferencias: "nod:preferencias",
  definirAvisos: "nod:definir-avisos",
  abrir: "nod:abrir",
} as const;

/** Tetos do que a página pode mandar ao macOS (o corpo que a web redige tem até 140). */
export const LIMITES_AVISO = { titulo: 120, corpo: 300, id: 64, contador: 9_999 } as const;
