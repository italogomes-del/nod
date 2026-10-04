import type { AlvoAviso, AvisoDesktop, NodDesktop, PreferenciasDesktop } from "../../src/contracts/desktop.ts";
import type { EstadoAvisos } from "./avisos.ts";

/**
 * Por onde o aviso sai (definido em 2026-09-24, "aviso no Mac"). No app desktop, pela ponte
 * `window.nodDesktop` (desktop/preload-web.ts): notificação do macOS e número no Dock, com a preferência
 * guardada pelo app — o localStorage da janela é apagado a cada conexão (desktop/main.ts, clearStorageData).
 * Num navegador comum, pela Notification API com `tag` fixa (um aviso substitui o anterior) e o número
 * no título da aba.
 */
export type CanalAvisos = {
  estado(): EstadoAvisos;
  /** O avisador pode mostrar? */
  ligado(): boolean;
  /** Relê a preferência (o menu "Avisos no Mac" muda sem passar pela página). */
  reler(): Promise<void>;
  /** O interruptor de "Seu espaço". No navegador, pede a permissão no próprio clique. */
  alternar(): Promise<void>;
  mostrar(aviso: AvisoDesktop): void;
  contador(n: number): void;
};

/** `tag` das notificações do navegador: a nova substitui a anterior em vez de empilhar. */
export const TAG_AVISO = "nod-sua-vez";
const CHAVE_PREFERENCIA = "nod:avisos";

export function criarCanalAvisos(aoAbrir: (alvo: AlvoAviso) => void, aoMudar: () => void): CanalAvisos {
  const mac = window.nodDesktop;
  return mac ? canalMac(mac, aoAbrir, aoMudar) : canalNavegador(aoAbrir, aoMudar);
}

function canalMac(mac: NodDesktop, aoAbrir: (alvo: AlvoAviso) => void, aoMudar: () => void): CanalAvisos {
  let prefs: PreferenciasDesktop = { avisos: true, tema: "sistema", bloqueados: false };
  const aplicar = (p: PreferenciasDesktop): void => {
    const mudou = p.avisos !== prefs.avisos || p.bloqueados !== prefs.bloqueados;
    prefs = p;
    if (mudou) aoMudar();
  };
  const reler = (): Promise<void> => mac.preferencias().then(aplicar, () => undefined);
  mac.aoAbrir(aoAbrir);
  void reler();
  return {
    estado: () => ({ onde: "mac", situacao: !prefs.avisos ? "desligados" : prefs.bloqueados ? "bloqueados" : "ligados" }),
    // Bloqueado continua tentando: se a pessoa liberar nos Ajustes, o próximo aviso aparece e o estado volta.
    ligado: () => prefs.avisos,
    reler,
    alternar: () => mac.definirAvisos(!prefs.avisos).then(aplicar, () => undefined),
    mostrar: (aviso) => void mac.avisar(aviso).then(reler, () => undefined),
    contador: (n) => void mac.contador(n).catch(() => undefined),
  };
}

function canalNavegador(aoAbrir: (alvo: AlvoAviso) => void, aoMudar: () => void): CanalAvisos {
  const suportado = typeof Notification !== "undefined";
  const permissao = (): NotificationPermission => (suportado ? Notification.permission : "denied");
  // Conveniência por navegador (nunca estado que precise sobreviver): sem armazenamento, vale até recarregar.
  let preferencia = false;
  try {
    preferencia = localStorage.getItem(CHAVE_PREFERENCIA) === "1";
  } catch {
    preferencia = false;
  }
  const guardar = (valor: boolean): void => {
    preferencia = valor;
    try {
      localStorage.setItem(CHAVE_PREFERENCIA, valor ? "1" : "0");
    } catch {
      // sem armazenamento: a escolha vale até recarregar a página
    }
  };
  const estado = (): EstadoAvisos => ({
    onde: "navegador",
    situacao: !suportado ? "indisponiveis" : permissao() === "denied" ? "bloqueados" : preferencia && permissao() === "granted" ? "ligados" : "desligados",
  });
  return {
    estado,
    ligado: () => estado().situacao === "ligados",
    reler: async () => aoMudar(),
    async alternar() {
      const antes = estado().situacao;
      if (antes === "ligados") guardar(false);
      else if (antes === "desligados") {
        // Chamado direto do clique: o navegador só mostra o pedido de permissão com gesto da pessoa.
        const p = permissao() === "default" ? await Notification.requestPermission() : permissao();
        if (p === "granted") guardar(true);
      }
      aoMudar();
    },
    mostrar(aviso) {
      let n: Notification;
      try {
        n = new Notification(aviso.titulo, { body: aviso.corpo, tag: TAG_AVISO });
      } catch {
        // permissão revogada no meio da sessão: "Seu espaço" passa a dizer "Bloqueados" na próxima leitura
        aoMudar();
        return;
      }
      n.onclick = () => {
        window.focus();
        aoAbrir(aviso.alvo);
        n.close();
      };
    },
    contador(n) {
      document.title = n > 0 ? `(${n}) nod` : "nod";
    },
  };
}
