import { contextBridge, ipcRenderer } from "electron";
contextBridge.exposeInMainWorld("nod", {
  estado: () => ipcRenderer.invoke("nod:estado"),
  abrirLogin: (url: string) => ipcRenderer.invoke("nod:login", url),
  parear: (url: string) => ipcRenderer.invoke("nod:parear", url),
  conectar: (dados: { url: string; chave: string }) => ipcRenderer.invoke("nod:conectar", dados),
});
