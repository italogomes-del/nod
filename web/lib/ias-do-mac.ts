import type { IaDesktop, NodDesktop, TesteDeIa } from "../../src/contracts/desktop.ts";
import type { EstadoIa } from "../../src/contracts/estado-ia.ts";
import { PROVEDOR, type UiIas } from "../telas/cartao-ia.ts";

/**
 * O que os cartões de IA fazem quando a pessoa clica (definido em 2026-10-10, plano das IAs, PR 3). Antes, "Entrar" e
 * "Conectar" no chat chamavam o app do Mac e engoliam o erro (`.catch(() => undefined)`): o Breno clicava e nada
 * acontecia. Agora todo clique termina num estado do cartão ou numa nota escrita embaixo dele.
 *
 * Dentro do app do Mac (rc.7 em diante) tudo passa por `nodDesktop.ias` (src/contracts/desktop.ts, PonteIas): instalar
 * na pasta do nod, abrir o login, mostrar o código, colar o código do Claude, cancelar e verificar. O app manda cada
 * mudança por `aoMudar`. Num app antigo, `iaEntrar`/`iaInstalar` (abrem o navegador). No navegador e no celular, a
 * nota diz para abrir o app do Mac.
 *
 * Sem DOM: as dependências entram por parâmetro (tests/unit/web/ias-do-mac.test.ts).
 */
export type DepsIasDoMac = {
  mac: () => Pick<NodDesktop, "ias" | "iaEntrar" | "iaInstalar" | "iaTestar"> | undefined;
  ui: () => UiIas;
  mudar: (m: Partial<UiIas>) => void;
  /** O teste de uma frase no fim do fluxo é desta tela? false durante o onboarding, que tem o teste dele. */
  testeAqui: () => boolean;
  /** Algo mudou no Mac: a tela relê o que o servidor sabe (o inventário e as IAs). */
  aoMudarNoMac: () => void;
  /** No navegador: o "verificar" relê o inventário do servidor. */
  verificarNoServidor: () => Promise<void>;
  copiar: (texto: string) => Promise<void>;
  agendar: (fn: () => void, ms: number) => void;
};

export const NOTA_FORA_DO_APP = { entrar: "Para entrar, abra o app do nod no seu Mac.", instalar: "Para instalar, abra o app do nod no seu Mac." } as const;

/** A frase do resultado de colar o código do Claude, quando ele não foi aceito. */
export const NOTA_DO_CODIGO: Record<"codigo_invalido" | "sem_login_aberto" | "ja_enviado" | "nao_pede_codigo", string> = {
  codigo_invalido: "Esse código não parece o da página da Anthropic. Copie de novo e cole aqui.",
  sem_login_aberto: "O login fechou antes do código chegar. Comece de novo em Entrar.",
  ja_enviado: "O código já foi enviado. Espere a conferência.",
  nao_pede_codigo: "Este login não pede código: termine na página da Anthropic.",
};

export function criarIasDoMac(d: DepsIasDoMac) {
  const comNota = (ia: IaDesktop, nota: string | null): Partial<UiIas> => {
    const resto = { ...d.ui().nota };
    delete resto[ia];
    return { nota: nota ? { ...resto, [ia]: nota } : resto };
  };
  const semFluxo = (ia: IaDesktop): Partial<UiIas> => {
    const fluxo = { ...d.ui().fluxo };
    delete fluxo[ia];
    return { fluxo };
  };
  const semTeste = (ia: IaDesktop): Partial<UiIas> => {
    const teste = { ...d.ui().teste };
    delete teste[ia];
    return { teste };
  };
  const guardarEstado = (e: EstadoIa) => d.mudar({ estados: { ...d.ui().estados, [e.ia]: e } });

  /** Liga a ponte: lê o estado de cada IA e passa a ouvir as mudanças. Sem a ponte (navegador, app antigo), nada. */
  async function iniciar(): Promise<void> {
    const ias = d.mac()?.ias;
    if (!ias) return;
    d.mudar({ noApp: true });
    ias.aoMudar((e) => aoMudar(e));
    const estados = await ias.estados().catch(() => [] as EstadoIa[]);
    d.mudar({ estados: Object.fromEntries(estados.map((e) => [e.ia, e])) });
  }

  /**
   * Cada mudança que o app manda. No fim do fluxo (a IA ficou pronta depois de instalar ou entrar), o teste de uma frase
   * mostra que a conta responde — o terceiro passo; o onboarding tem o dele.
   */
  function aoMudar(e: EstadoIa): void {
    const antes = d.ui().estados[e.ia];
    guardarEstado(e);
    const ui = d.ui();
    if (e.login?.fase === "cancelado" && ui.fluxo[e.ia] && e.estado !== "instalando") d.mudar(semFluxo(e.ia));
    if (ui.fluxo[e.ia] && e.estado === "pronta" && !ui.teste[e.ia] && d.testeAqui() && d.mac()?.iaTestar) void testar(e.ia);
    if (antes?.estado !== e.estado) d.aoMudarNoMac();
  }

  /** "Instalar e entrar" (e "Atualizar"): instala na pasta do nod e, se terminou bem, abre o login na sequência. */
  async function instalar(ia: IaDesktop): Promise<void> {
    const mac = d.mac();
    const { cli } = PROVEDOR[ia];
    if (mac?.ias) {
      d.mudar({ ...comNota(ia, null), ...semTeste(ia), fluxo: { ...d.ui().fluxo, [ia]: { instalar: true } } });
      try {
        const e = await mac.ias.instalar(ia);
        guardarEstado(e);
        if (e.estado === "falta_entrar" && e.instalacao?.fase === "sucesso") await entrar(ia, true);
        else if (e.estado === "pronta" && d.testeAqui() && mac.iaTestar) await testar(ia);
      } catch {
        d.mudar(comNota(ia, `Não deu para instalar o ${cli} agora. Tente de novo.`));
      }
      return;
    }
    if (mac?.iaInstalar) {
      const r = await mac.iaInstalar(ia).catch(() => ({ ok: false as const, motivo: "falhou" as const }));
      d.mudar(comNota(ia, r.ok ? `Abrimos a página do ${cli}. Instale e volte: o nod percebe sozinho quando ele aparecer neste Mac.` : `Não deu para abrir a página do ${cli}. Atualize o app do nod para instalar por aqui.`));
      return;
    }
    d.mudar(comNota(ia, NOTA_FORA_DO_APP.instalar));
  }

  /** "Entrar" (e "Entrar com outra conta"): abre o login do CLI no app; o link e o código chegam por `aoMudar`. */
  async function entrar(ia: IaDesktop, depoisDeInstalar = false): Promise<void> {
    const mac = d.mac();
    const { nome, cli } = PROVEDOR[ia];
    if (mac?.ias) {
      const fluxo = d.ui().fluxo[ia];
      d.mudar({ ...comNota(ia, null), ...semTeste(ia), fluxo: { ...d.ui().fluxo, [ia]: { instalar: depoisDeInstalar || (fluxo?.instalar ?? false) } } });
      try {
        guardarEstado(await mac.ias.entrar(ia));
      } catch {
        d.mudar(comNota(ia, `Não deu para abrir o login do ${nome}. Tente de novo.`));
      }
      return;
    }
    if (mac?.iaEntrar) {
      const r = await mac.iaEntrar(ia).catch(() => ({ ok: false as const, motivo: "falhou" as const }));
      d.mudar(comNota(ia, r.ok ? `Abrimos o navegador. Entre no ${nome} e volte: o nod percebe sozinho.` : r.motivo === "nao_instalado" ? `O ${cli} não está neste Mac. Atualize o app do nod para instalar por aqui.` : `Não deu para abrir o login do ${nome}. Tente de novo.`));
      return;
    }
    d.mudar(comNota(ia, NOTA_FORA_DO_APP.entrar));
  }

  async function cancelar(ia: IaDesktop): Promise<void> {
    const ias = d.mac()?.ias;
    d.mudar({ ...semFluxo(ia), ...comNota(ia, null) });
    if (!ias) return;
    try {
      guardarEstado(await ias.cancelar(ia));
    } catch {
      d.mudar(comNota(ia, "Não deu para cancelar. Tente de novo."));
    }
  }

  async function verificar(ia: IaDesktop): Promise<void> {
    if (d.ui().verificando) return;
    d.mudar({ verificando: ia, ...comNota(ia, null) });
    try {
      const ias = d.mac()?.ias;
      if (ias) guardarEstado(await ias.verificar(ia));
      else await d.verificarNoServidor();
    } catch {
      d.mudar(comNota(ia, "Não deu para verificar agora. Tente de novo."));
    } finally {
      d.mudar({ verificando: null });
    }
  }

  /** Abre no navegador o link oficial do login em curso (o app confere o endereço; a página nunca passa um). */
  async function abrirLink(ia: IaDesktop): Promise<void> {
    const ok = await d.mac()?.ias?.abrirLink(ia).catch(() => false);
    d.mudar(comNota(ia, ok ? null : "O link do login ainda não está pronto. Espere um instante e tente de novo."));
  }

  async function colarCodigo(ia: IaDesktop, codigo: string): Promise<void> {
    const ias = d.mac()?.ias;
    if (!ias) return;
    const r = await ias.colarCodigo(ia, codigo.trim()).catch(() => ({ ok: false as const, motivo: "sem_login_aberto" as const }));
    const codigos = { ...d.ui().codigo };
    if (r.ok) delete codigos[ia];
    d.mudar({ codigo: codigos, ...comNota(ia, r.ok ? null : NOTA_DO_CODIGO[r.motivo]) });
  }

  async function copiarCodigo(ia: IaDesktop, codigo: string): Promise<void> {
    try {
      await d.copiar(codigo);
      d.mudar({ copiado: ia });
      d.agendar(() => { if (d.ui().copiado === ia) d.mudar({ copiado: null }); }, 1_500);
    } catch {
      d.mudar(comNota(ia, "Não deu para copiar. Digite o código na página."));
    }
  }

  /** O teste de uma frase (pago pela assinatura da pessoa): só quando ela pede ou no fim do fluxo que ela abriu. */
  async function testar(ia: IaDesktop): Promise<void> {
    const iaTestar = d.mac()?.iaTestar;
    if (!iaTestar) { d.mudar(comNota(ia, "O teste roda no app do nod, no seu Mac.")); return; }
    d.mudar({ teste: { ...d.ui().teste, [ia]: { estado: "testando" } }, ...comNota(ia, null) });
    const lidos: TesteDeIa[] = await iaTestar({ ia }).catch(() => []);
    const v = lidos.find((t) => t.ia === ia);
    if (v?.estado === "pronto") { d.mudar({ teste: { ...d.ui().teste, [ia]: { estado: "pronto", resposta: v.resposta ?? null } }, ...semFluxo(ia) }); return; }
    if (v?.causa === "conta_sem_acesso" || v?.causa === "teste_falhou") { d.mudar({ teste: { ...d.ui().teste, [ia]: { estado: "reprovada", causa: v.causa } } }); return; }
    d.mudar({ ...semTeste(ia), ...comNota(ia, `O ${PROVEDOR[ia].nome} não respondeu ao teste agora. Tente de novo em instantes.`) });
  }

  const alternarAjuda = (chave: string) => d.mudar({ ajuda: d.ui().ajuda === chave ? null : chave });
  const alternarDetalhe = (ia: IaDesktop) => d.mudar({ detalhe: d.ui().detalhe === ia ? null : ia });

  return { iniciar, aoMudar, instalar, entrar, cancelar, verificar, abrirLink, colarCodigo, copiarCodigo, testar, alternarAjuda, alternarDetalhe };
}
