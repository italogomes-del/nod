import { contextBridge, ipcRenderer } from "electron";
import { CANAIS_DESKTOP, type AlvoAviso, type AvisoDesktop, type ContasNaTela, type IaDesktop, type NodDesktop, type PonteContas, type PonteIas, type TemaDesktop } from "../src/contracts/desktop.ts";
import type { EstadoIa } from "../src/contracts/estado-ia.ts";
import { CANAIS_MIDIA, type PonteMidia } from "../src/contracts/midia-desktop.ts";

/**
 * Preload da JANELA WEB (definido em 2026-09-24, "aviso no Mac"): a página é remota, então a ponte é a
 * menor possível — funções nomeadas em `window.nodDesktop`, nenhum `ipcRenderer`, nenhum canal genérico.
 * A ponte da tela de conexão (preload.ts, `window.nod`) entrega `conectar` e a chave da máquina e nunca
 * chega aqui; a web usa `window.nod` para outra coisa. O processo principal valida remetente e argumentos.
 */
/** definido em 2026-10-09: as IAs dentro do app (PonteIas); cada argumento é validado de novo no processo principal. */
const ias: PonteIas = {
  estados: () => ipcRenderer.invoke(CANAIS_DESKTOP.iaEstados),
  instalar: (ia: IaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.iaInstalarNoApp, ia),
  entrar: (ia: IaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.iaEntrarNoApp, ia),
  abrirLink: (ia: IaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.iaAbrirLink, ia),
  colarCodigo: (ia: IaDesktop, codigo: string) => ipcRenderer.invoke(CANAIS_DESKTOP.iaColarCodigo, ia, codigo),
  cancelar: (ia: IaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.iaCancelar, ia),
  verificar: (ia: IaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.iaVerificar, ia),
  // NOD-9: o "Atualizar" (só a IA e se é agora; o comando é do processo principal).
  atualizar: (ia: IaDesktop, opcoes?: { agora?: boolean }) => ipcRenderer.invoke(CANAIS_DESKTOP.iaAtualizar, ia, { agora: opcoes?.agora === true }),
  aoMudar: (fn: (estado: EstadoIa) => void) => {
    ipcRenderer.removeAllListeners(CANAIS_DESKTOP.iaMudou);
    ipcRenderer.on(CANAIS_DESKTOP.iaMudou, (_evento, estado: EstadoIa) => fn(estado));
  },
};
/** definido em 2026-10-12 (ADR-101): as várias contas; o processo principal valida cada argumento. */
const contas: PonteContas = {
  listar: () => ipcRenderer.invoke(CANAIS_DESKTOP.contasListar),
  usar: (ia: IaDesktop, posicao: number) => ipcRenderer.invoke(CANAIS_DESKTOP.contasUsar, ia, posicao),
  adicionar: (ia: IaDesktop, apelido: string) => ipcRenderer.invoke(CANAIS_DESKTOP.contasAdicionar, ia, apelido),
  remover: (ia: IaDesktop, posicao: number) => ipcRenderer.invoke(CANAIS_DESKTOP.contasRemover, ia, posicao),
  fecharFalha: (ia: IaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.contasFecharFalha, ia),
  mover: (ia: IaDesktop, de: number, para: number) => ipcRenderer.invoke(CANAIS_DESKTOP.contasMover, ia, de, para),
  renomear: (ia: IaDesktop, posicao: number, apelido: string) => ipcRenderer.invoke(CANAIS_DESKTOP.contasRenomear, ia, posicao, apelido),
  definirModo: (ia: IaDesktop, modo: "perguntar" | "automatico") => ipcRenderer.invoke(CANAIS_DESKTOP.contasDefinirModo, ia, modo),
  definirTrocaAutomatica: (ia: IaDesktop, posicao: number, ligado: boolean) => ipcRenderer.invoke(CANAIS_DESKTOP.contasDefinirTroca, ia, posicao, ligado),
  detalhes: () => ipcRenderer.invoke(CANAIS_DESKTOP.contasDetalhes),
  aoMudar: (fn: (lista: ContasNaTela[]) => void) => {
    ipcRenderer.removeAllListeners(CANAIS_DESKTOP.contasMudaram);
    ipcRenderer.on(CANAIS_DESKTOP.contasMudaram, (_evento, lista: ContasNaTela[]) => fn(lista));
  },
};
/** NOD-323 (J5): a mídia do bot que ficou neste Mac; o processo principal confere o caminho de novo. */
const midia: PonteMidia = {
  maquina: () => ipcRenderer.invoke(CANAIS_MIDIA.maquina),
  existe: (caminhoRelativo: string) => ipcRenderer.invoke(CANAIS_MIDIA.existe, caminhoRelativo),
  mostrarNoFinder: (caminhoRelativo: string) => ipcRenderer.invoke(CANAIS_MIDIA.mostrarNoFinder, caminhoRelativo),
};
const ponte: NodDesktop = {
  avisar: (aviso: AvisoDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.avisar, aviso),
  contador: (n: number) => ipcRenderer.invoke(CANAIS_DESKTOP.contador, n),
  preferencias: () => ipcRenderer.invoke(CANAIS_DESKTOP.preferencias),
  definirAvisos: (ligado: boolean) => ipcRenderer.invoke(CANAIS_DESKTOP.definirAvisos, ligado),
  definirTema: (tema: TemaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.definirTema, tema),
  // NOD-196: o som dos avisos; o processo principal valida o booleano.
  definirSom: (ligado: boolean) => ipcRenderer.invoke(CANAIS_DESKTOP.definirSom, ligado),
  // Modo ligação (definido em 2026-10-04, ADR-071): o acesso do macOS ao microfone e o aviso de ligação aberta.
  microfone: () => ipcRenderer.invoke(CANAIS_DESKTOP.microfone),
  emLigacao: (ativa: boolean) => ipcRenderer.invoke(CANAIS_DESKTOP.emLigacao, ativa),
  // Onboarding (definido em 2026-10-04, ADR-077): os cards de IA — login do CLI e página oficial de instalação.
  iaEntrar: (ia: IaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.iaEntrar, ia),
  iaInstalar: (ia: IaDesktop) => ipcRenderer.invoke(CANAIS_DESKTOP.iaInstalar, ia),
  // definido em 2026-10-05: o teste de verdade das IAs (um turno de uma frase); o processo principal valida o pedido.
  iaTestar: (pedido?: { nome?: string; ia?: IaDesktop }) => ipcRenderer.invoke(CANAIS_DESKTOP.iaTestar, pedido),
  ias,
  contas,
  midia,
  // NOD-345: o código de troca vai ao processo principal, que fala com o servidor sem Origin.
  trocarConta: (codigo: string) => ipcRenderer.invoke(CANAIS_DESKTOP.trocarConta, codigo),
  desafioConta: () => ipcRenderer.invoke(CANAIS_DESKTOP.desafioConta),
  aoAbrir: (fn: (alvo: AlvoAviso) => void) => {
    // Um ouvinte só (a página registra uma vez; recarregar recria o preload). O evento do IPC não vai à página.
    ipcRenderer.removeAllListeners(CANAIS_DESKTOP.abrir);
    ipcRenderer.on(CANAIS_DESKTOP.abrir, (_evento, alvo: AlvoAviso) => fn(alvo));
  },
};
contextBridge.exposeInMainWorld("nodDesktop", ponte);
