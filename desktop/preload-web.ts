import { contextBridge, ipcRenderer } from "electron";
import { CANAIS_DESKTOP, type AlvoAviso, type AvisoDesktop, type IaDesktop, type NodDesktop, type TemaDesktop } from "../src/contracts/desktop.ts";

/**
 * Preload da JANELA WEB (definido em 2026-09-24, "aviso no Mac"): a página é remota, então a ponte é a
 * menor possível — dez funções em `window.nodDesktop`, nenhum `ipcRenderer`, nenhum canal genérico.
 * A ponte da tela de conexão (preload.ts, `window.nod`) entrega `conectar` e a chave da máquina e nunca
 * chega aqui; a web usa `window.nod` para outra coisa. O processo principal valida remetente e argumentos.
 */
const ponte: NodDesktop = {
  avisar: (aviso: AvisoDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.avisar, aviso),
  contador: (n: number) => ipcRenderer.invoke(CANAIS_DESKTOP.contador, n),
  preferencias: () => ipcRenderer.invoke(CANAIS_DESKTOP.preferencias),
  definirAvisos: (ligado: boolean) => ipcRenderer.invoke(CANAIS_DESKTOP.definirAvisos, ligado),
  definirTema: (tema: TemaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.definirTema, tema),
  // Modo ligação (definido em 2026-10-04, ADR-071): o acesso do macOS ao microfone e o aviso de ligação aberta.
  microfone: () => ipcRenderer.invoke(CANAIS_DESKTOP.microfone),
  emLigacao: (ativa: boolean) => ipcRenderer.invoke(CANAIS_DESKTOP.emLigacao, ativa),
  // Onboarding (definido em 2026-10-04, ADR-077): os cards de IA — login do CLI e página oficial de instalação.
  iaEntrar: (ia: IaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.iaEntrar, ia),
  iaInstalar: (ia: IaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.iaInstalar, ia),
  aoAbrir: (fn: (alvo: AlvoAviso) => void) => {
    // Um ouvinte só (a página registra uma vez; recarregar recria o preload). O evento do IPC não vai à página.
    ipcRenderer.removeAllListeners(CANAIS_DESKTOP.abrir);
    ipcRenderer.on(CANAIS_DESKTOP.abrir, (_evento, alvo: AlvoAviso) => fn(alvo));
  },
};
contextBridge.exposeInMainWorld("nodDesktop", ponte);
