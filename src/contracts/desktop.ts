import type { CausaInventario, CausaSemIa } from "./inventario.ts";

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
  /**
   * O aviso toca o som padrão do macOS (definido em 2026-10-07, NOD-196); desligado, ele aparece em silêncio. Local a
   * cada Mac, como o tema; o Foco e os Ajustes do Sistema continuam mandando (o nod nunca força o som).
   */
  som: boolean;
  /** O último aviso falhou ao aparecer: as notificações do nod estão desligadas nos Ajustes do Sistema. */
  bloqueados: boolean;
};

/**
 * O acesso do macOS ao microfone (definido em 2026-10-04, ADR-071): "concedido" pode pedir o microfone; "negado" a
 * pessoa desligou nos Ajustes do Sistema; "restrito" um perfil de gestão do Mac proíbe.
 */
export type EstadoMicrofone = "concedido" | "negado" | "restrito";

/** As IAs que o Mac sabe entrar ou instalar (ADR-077): o id do harness (src/contracts/harness.ts). */
export const IAS_DESKTOP = ["claude-cli", "codex-cli"] as const;
export type IaDesktop = (typeof IAS_DESKTOP)[number];
/** "iniciado": o login (ou a página) abriu no navegador; o app sonda de novo a cada 3 s e reanuncia quando ficar pronto. */
export type ResultadoIaDesktop = { ok: true } | { ok: false; motivo: "nao_instalado" | "falhou" };

/**
 * O teste de verdade de uma IA do Mac (definido em 2026-10-05, emenda da ADR-019/077): um turno de uma frase, pago pela
 * assinatura da pessoa. `resposta` é o que a IA disse (até RESPOSTA_TESTE_IA_MAX caracteres), só quando ficou pronta;
 * `causa` só quando a IA está logada e mesmo assim não serviu. O Mac reanuncia o inventário ao servidor com o veredito.
 */
/** `causa: "sonda_lenta"` (NOD-178): o CLI só demorou; não é veredito da conta, e a tela testa de novo. */
export type TesteDeIa = { ia: IaDesktop; estado: "pronto" | "nao_autenticado" | "ausente"; causa?: CausaSemIa | CausaInventario; resposta?: string };
export const RESPOSTA_TESTE_IA_MAX = 200;
/** O nome que entra na pergunta do teste ("Diga oi para {nome}…"): só letras, espaço, ponto e hífen, até este tamanho. */
export const NOME_TESTE_IA_MAX = 40;

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
   * Liga ou desliga o som dos avisos (NOD-196); com os avisos desligados, a escolha continua guardada. Opcional porque o
   * app instalado antes de 2026-10-07 não tem: a web confere antes de chamar.
   */
  definirSom?(ligado: boolean): Promise<PreferenciasDesktop>;
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
  /**
   * Onboarding (definido em 2026-10-04, ADR-077): sem IA pronta no Mac, a web mostra os cards de IA e o clique chega
   * aqui. "entrar" roda o login do próprio CLI (`claude auth login` / `codex login`), que abre o navegador: o nod nunca
   * vê token. "instalar" abre a página oficial no navegador. Opcionais pelo mesmo motivo dos de cima.
   */
  iaEntrar?(ia: IaDesktop): Promise<ResultadoIaDesktop>;
  iaInstalar?(ia: IaDesktop): Promise<ResultadoIaDesktop>;
  /**
   * Testa de verdade as IAs do Mac que têm login (ou só `ia`, quando dada) e devolve o veredito de cada uma das duas.
   * `nome` personaliza a pergunta. Chamadas simultâneas esperam o mesmo teste. Opcional: o app instalado antes de
   * 2026-10-05 não tem, e a web segue então com o que a sonda de login disse.
   */
  iaTestar?(pedido?: { nome?: string; ia?: IaDesktop }): Promise<TesteDeIa[]>;
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
  definirSom: "nod:definir-som",
  abrir: "nod:abrir",
  microfone: "nod:microfone",
  emLigacao: "nod:em-ligacao",
  iaEntrar: "nod:ia-entrar",
  iaInstalar: "nod:ia-instalar",
  iaTestar: "nod:ia-testar",
} as const;

/** Tetos do que a página pode mandar ao macOS (o corpo que a web redige tem até 140). */
export const LIMITES_AVISO = { titulo: 120, corpo: 300, id: 64, contador: 9_999 } as const;
