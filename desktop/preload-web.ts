import { contextBridge, ipcRenderer } from "electron";
import { CANAIS_DESKTOP, type AlvoAviso, type AvisoDesktop, type NodDesktop } from "../src/contracts/desktop.ts";

/**
 * Preload da JANELA WEB (definido em 2026-09-24, "aviso no Mac"): a página é remota, então a ponte é a
 * menor possível — cinco funções em `window.nodDesktop`, nenhum `ipcRenderer`, nenhum canal genérico.
 * A ponte da tela de conexão (preload.ts, `window.nod`) entrega `conectar` e a chave da máquina e nunca
 * chega aqui; a web usa `window.nod` para outra coisa. O processo principal valida remetente e argumentos.
 */
const ponte: NodDesktop = {
  avisar: (aviso: AvisoDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.avisar, aviso),
  contador: (n: number) => ipcRenderer.invoke(CANAIS_DESKTOP.contador, n),
  preferencias: () => ipcRenderer.invoke(CANAIS_DESKTOP.preferencias),
  definirAvisos: (ligado: boolean) => ipcRenderer.invoke(CANAIS_DESKTOP.definirAvisos, ligado),
  aoAbrir: (fn: (alvo: AlvoAviso) => void) => {
    // Um ouvinte só (a página registra uma vez; recarregar recria o preload). O evento do IPC não vai à página.
    ipcRenderer.removeAllListeners(CANAIS_DESKTOP.abrir);
    ipcRenderer.on(CANAIS_DESKTOP.abrir, (_evento, alvo: AlvoAviso) => fn(alvo));
  },
};
contextBridge.exposeInMainWorld("nodDesktop", ponte);
