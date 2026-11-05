import { contextBridge, ipcRenderer } from "electron";
import { CANAIS_DESKTOP, type IaDesktop, type NodDesktop } from "../../src/contracts/desktop.ts";

/**
 * ADA-229 (5/11/2026): a ponte da JANELA WEB do Windows, a menor possível. A web só confere `window.nodDesktop.iaEntrar`
 * / `iaInstalar` (os cartões de IA do onboarding e a ligação sem IA); o resto da ponte do Mac (avisos, contas, mídia,
 * teste das IAs) continua opcional no contrato e a web confere antes de chamar. O processo principal valida o remetente
 * e o argumento de novo (login-ia-windows.ts `daJanelaWeb`, ia-mac.ts `lerIaDesktop`).
 */
const ponte: Pick<NodDesktop, "iaEntrar" | "iaInstalar"> = {
  iaEntrar: (ia: IaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.iaEntrar, ia),
  iaInstalar: (ia: IaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.iaInstalar, ia),
};
contextBridge.exposeInMainWorld("nodDesktop", ponte);
