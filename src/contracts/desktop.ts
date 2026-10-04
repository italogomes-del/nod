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

/** Tema escolhido em Preferências (definido em 2026-10-04, ADR-070); "sistema" segue o macOS. */
export type TemaDesktop = "sistema" | "claro" | "escuro";

/** As preferências do app (userData/preferencias.json) e o que o macOS deixou mostrar. */
export type PreferenciasDesktop = {
  avisos: boolean;
  /** O tema da janela: o processo principal o aplica em nativeTheme, que é o que o prefers-color-scheme da página lê. */
  tema: TemaDesktop;
  /** O último aviso falhou ao aparecer: as notificações do nod estão desligadas nos Ajustes do Sistema. */
  bloqueados: boolean;
};

/**
 * O acesso do macOS ao microfone (definido em 2026-10-04, ADR-071): "concedido" pode pedir o microfone; "negado" a
 * pessoa desligou nos Ajustes do Sistema; "restrito" um perfil de gestão do Mac proíbe.
 */
export type EstadoMicrofone = "concedido" | "negado" | "restrito";

export type NodDesktop = {
  /** Mostra o aviso só se a janela do nod não estiver na frente; devolve se mostrou. */
  avisar(aviso: AvisoDesktop): Promise<boolean>;
  /** O número no ícone do Dock: pedidos abertos (0 apaga). */
  contador(n: number): Promise<void>;
  preferencias(): Promise<PreferenciasDesktop>;
  definirAvisos(ligado: boolean): Promise<PreferenciasDesktop>;
  /**
   * Grava o tema fora da página: o localStorage da janela web é apagado a cada conexão. Opcional porque o app
   * instalado antes de 2026-10-04 não tem: a web confere antes de chamar.
   */
  definirTema?(tema: TemaDesktop): Promise<PreferenciasDesktop>;
  /**
   * Modo ligação (definido em 2026-10-04, ADR-071): confere e, se o macOS ainda não perguntou, pede o acesso ao
   * microfone. Opcional porque o app instalado antes desta versão não tem: a web confere antes de chamar.
   */
  microfone?(): Promise<EstadoMicrofone>;
  /**
   * A página avisa que abriu (ou fechou) uma ligação: o processo principal impede a suspensão do app, desliga o
   * throttling da janela e passa a perguntar "Encerrar a ligação?" antes de fechar. Opcional pelo mesmo motivo.
   */
  emLigacao?(ativa: boolean): Promise<void>;
  /** Chamado quando a pessoa clica num aviso: a web abre o alvo. */
  aoAbrir(fn: (alvo: AlvoAviso) => void): void;
};

/** Canais de IPC da janela web; nenhum outro chega ao processo principal por ela. */
export const CANAIS_DESKTOP = {
  avisar: "nod:avisar",
  contador: "nod:contador",
  preferencias: "nod:preferencias",
  definirAvisos: "nod:definir-avisos",
  definirTema: "nod:definir-tema",
  abrir: "nod:abrir",
  microfone: "nod:microfone",
  emLigacao: "nod:em-ligacao",
} as const;

/** Tetos do que a página pode mandar ao macOS (o corpo que a web redige tem até 140). */
export const LIMITES_AVISO = { titulo: 120, corpo: 300, id: 64, contador: 9_999 } as const;
