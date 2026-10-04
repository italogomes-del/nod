/** Versão do build, injetada pelo `define` do Vite (ADR-042). Rótulo de build, nunca identificador. */
declare const __NOD_VERSAO__: string;

interface Window {
  /**
   * Só no app desktop (definido em 2026-09-24, "aviso no Mac"): a ponte mínima do preload da janela web
   * (desktop/preload-web.ts). Num navegador comum não existe — web/lib/canal-avisos.ts cai na Notification API.
   */
  nodDesktop?: import("../src/contracts/desktop.ts").NodDesktop;
}

/**
 * Os worklets da ligação (web/lib/ligacao.ts) entram pelo sufixo `?worker&url` do Vite: o arquivo é compilado como
 * bundle próprio e o import devolve a URL do .js. O tsconfig da web não carrega vite/client, então o tipo mora aqui.
 */
declare module "*?worker&url" {
  const url: string;
  export default url;
}
