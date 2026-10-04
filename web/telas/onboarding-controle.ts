import type { IaDesktop } from "../../src/contracts/desktop.ts";
import type { Ligacao } from "../../src/contracts/ligacao.ts";
import type { CamposEntrevista, EstadoOnboarding, EtapaOnboarding } from "../../src/contracts/onboarding.ts";
import type { Api } from "../lib/api.ts";
import { esc } from "../lib/render.ts";
import { dialogo } from "./gestao-agentes.ts";
import { TEXTO_CONSENTIMENTO } from "./ligacao.ts";
import { htmlCamada, htmlGuia, notaForaDoApp, type EstadoTelaOnboarding, type FaseTela } from "./onboarding.ts";

/**
 * O controlador do onboarding por ligação (definido em 2026-10-04, ADR-077): a abertura, a sondagem da IA do Mac, o
 * Atender (consentimento + mídia), o "Configurar sem voz", a passagem da entrevista para a pílula e os cliques dos cards
 * guiados. O estado que vem do servidor mora no reducer (`estado.onboarding`); aqui fica só o que é da tela (timers,
 * o card de IA clicado, o botão ocupado). O desenho é de web/telas/onboarding.ts.
 */

/** definido em 2026-10-04 (protótipo HiFiMac): o "olá" dura 3,3 s; a busca da IA gira 2 s; a sonda do Mac é a cada 3 s. */
export const OLA_MS = 3_300;
export const PROCURANDO_MS = 2_000;
export const SONDA_MS = 3_000;
const PRONTO_ATE_TOCAR_MS = 1_600;
const VERSAO_CONSENTIMENTO = 1;

export type DepsOnboarding = {
  api: () => Api | null;
  dados: () => EstadoOnboarding | null | undefined;
  aberto: () => boolean;
  hidratar: (o: EstadoOnboarding) => void;
  abrir: (aberto: boolean) => void;
  ligacao: {
    ativa: () => { ligacaoId: string; modo: "cheia" | "pilula" } | null;
    cheia: () => boolean;
    atenderOnboarding: (l: Ligacao) => boolean;
  };
  /** Relê a frota até o bot aparecer (a Nina nasce no servidor quando a etapa vira 'chamando'). */
  garantirAgente: (agenteId: string) => Promise<boolean>;
  irParaConversa: (conversaId: string, agenteId: string) => void;
  /** O login do app pelo fluxo do marketplace (chamado DENTRO do clique). */
  iniciarConexao: (slug: string, depois: () => Promise<void>) => void;
  conectando: (slug: string) => boolean;
  /** O conector já habilitado do app (o login já aconteceu antes): null = ainda não. */
  conectorHabilitado: (slug: string) => Promise<string | null>;
  /** O que mudou além da região (frota, rotinas, conversa): o main invalida. */
  invalidar: () => void;
  erro: (e: unknown) => void;
  aoMudar: () => void;
};

export type TelaOnboarding = ReturnType<typeof criarTelaOnboarding>;

export function criarTelaOnboarding(deps: DepsOnboarding) {
  let olaPassou = false;
  let timerOla: number | null = null;
  let procurandoAte = 0;
  let timerProcura: number | null = null;
  let sonda: number | null = null;
  let iaEntrando: IaDesktop | null = null;
  let notaIa: string | null = null;
  let atendendo = false;
  let ocupado = false;
  let concluindo = false;
  /** Concluiu nesta página: "Tudo montado" continua na conversa até a pessoa sair dela. */
  let acabouDeConcluir = false;
  let releitura: number | null = null;
  let avancando = false;

  const api = (): Api => {
    const a = deps.api();
    if (!a) throw new Error("sem_sessao");
    return a;
  };

  function hidratar(o: EstadoOnboarding): void {
    deps.hidratar(o);
    deps.aoMudar();
  }

  /** A fase que a tela mostra, das etapas do servidor e do que é local (o "olá", a ligação aberta aqui). */
  function fase(d: EstadoOnboarding): FaseTela | null {
    if (!deps.aberto()) return null;
    if (d.etapa === "concluido") return acabouDeConcluir ? "fim" : null;
    // O servidor tirou o onboarding da frente (a guia foi excluída no meio): a camada fecha na próxima leitura.
    if (!d.mostrar) return null;
    if (!olaPassou && (d.etapa === null || d.etapa === "ola" || d.etapa === "executor")) return "ola";
    if (d.etapa === null || d.etapa === "ola" || d.etapa === "executor") return d.executor.pronto ? "chamando" : "executor";
    if (d.etapa === "chamando") return "chamando";
    if (d.etapa === "entrevista" && deps.ligacao.ativa()) return "entrevista";
    return d.passo === "fim" ? "fim" : "configurando";
  }

  function estadoTela(): EstadoTelaOnboarding | null {
    const d = deps.dados();
    if (!d) return null;
    const f = fase(d);
    if (!f) return null;
    return {
      dados: d,
      fase: f,
      procurando: Date.now() < procurandoAte,
      iaEntrando,
      notaIa,
      atendendo,
      emLigacao: deps.ligacao.ativa() !== null,
      appConectando: deps.conectando(d.modelo.app.slug),
      ocupado,
    };
  }

  /** A camada da região `#onboarding` (vazia fora das fases de tela cheia e da entrevista). */
  function camada(): string {
    const e = estadoTela();
    if (!e) return "";
    agendarPelaFase(e);
    // Sem guia, a configuração é uma camada por cima do app: precisa de uma saída.
    if (e.fase === "configurando" && !e.dados.guia) return `<div class="ob-guia-solta">${htmlGuia(e)}<button type="button" class="ob-link ob-depois" data-act="onboarding-depois">Fazer depois</button></div>`;
    return htmlCamada(e, deps.ligacao.cheia());
  }

  /** Os efeitos de cada fase (timer do olá, sonda do Mac, conclusão) — idempotentes, chamados a cada desenho. */
  function agendarPelaFase(e: EstadoTelaOnboarding): void {
    if (e.fase === "ola" && timerOla === null) timerOla = window.setTimeout(() => { timerOla = null; void passarOla(); }, OLA_MS);
    if (e.fase === "executor" && sonda === null) sonda = window.setInterval(() => void sondar(), SONDA_MS);
    if (e.fase !== "executor" && sonda !== null) { window.clearInterval(sonda); sonda = null; }
    if (e.fase === "fim" && e.dados.etapa !== "concluido" && !e.emLigacao) void concluir();
  }

  async function passarOla(): Promise<void> {
    if (olaPassou) return;
    olaPassou = true;
    if (timerOla !== null) { window.clearTimeout(timerOla); timerOla = null; }
    const d = deps.dados();
    if (!d) return;
    if (!d.executor.pronto) {
      procurandoAte = Date.now() + PROCURANDO_MS;
      if (timerProcura !== null) window.clearTimeout(timerProcura);
      timerProcura = window.setTimeout(() => { timerProcura = null; deps.aoMudar(); }, PROCURANDO_MS + 20);
      deps.aoMudar();
      if (d.etapa !== "executor") await mudarEtapa("executor").catch(() => undefined);
      return;
    }
    await chamar();
  }

  async function mudarEtapa(etapa: Exclude<EtapaOnboarding, "concluido">, semVoz = false): Promise<EstadoOnboarding> {
    const o = await api().etapaOnboarding(semVoz ? { etapa, semVoz } : { etapa });
    hidratar(o);
    return o;
  }

  /** Etapa 'chamando': o servidor garante a Nina e cria a ligação; com recusa (sem voz aqui), segue para os cards. */
  async function chamar(): Promise<void> {
    if (avancando) return;
    avancando = true;
    try {
      const o = await mudarEtapa("chamando");
      if (o.guia) await deps.garantirAgente(o.guia.id);
      if (!o.ligacao || o.recusa) await semVoz();
      deps.aoMudar();
    } catch (e) {
      deps.erro(e);
    } finally {
      avancando = false;
    }
  }

  async function sondar(): Promise<void> {
    const a = deps.api();
    if (!a) return;
    const o = await a.onboarding().catch(() => null);
    if (!o) return;
    hidratar(o);
    if (o.executor.pronto && !avancando) {
      const nome = iaEntrando === "codex-cli" ? "ChatGPT" : "Claude";
      notaIa = `${nome} conectado.`;
      iaEntrando = null;
      deps.aoMudar();
      window.setTimeout(() => void chamar(), PRONTO_ATE_TOCAR_MS);
      if (sonda !== null) { window.clearInterval(sonda); sonda = null; }
    }
  }

  async function iaNoMac(ia: IaDesktop, acao: "entrar" | "instalar"): Promise<void> {
    const ponte = window.nodDesktop;
    const fn = acao === "entrar" ? ponte?.iaEntrar : ponte?.iaInstalar;
    if (!ponte || !fn) { notaIa = notaForaDoApp(ia, acao); deps.aoMudar(); return; }
    const nome = ia === "codex-cli" ? "ChatGPT" : "Claude";
    try {
      const r = await fn.call(ponte, ia);
      if (r.ok) { iaEntrando = ia; notaIa = `Abrimos o navegador. Entre no ${nome} e volte; o nod percebe sozinho.`; }
      else notaIa = r.motivo === "nao_instalado" ? notaForaDoApp(ia, "instalar") : `Não deu para abrir o login do ${nome}. ${notaForaDoApp(ia, "entrar")}`;
    } catch {
      notaIa = notaForaDoApp(ia, acao);
    }
    deps.aoMudar();
  }

  /** O Atender: o clique é o consentimento de voz e o gesto que libera áudio e microfone. */
  async function atender(): Promise<void> {
    const d = deps.dados();
    if (atendendo || !d) return;
    atendendo = true;
    deps.aoMudar();
    try {
      await api().consentirVoz(VERSAO_CONSENTIMENTO);
      const o = await mudarEtapa("entrevista");
      const lig = o.ligacao ?? d.ligacao;
      if (!lig || (lig.estado !== "chamando" && lig.estado !== "em_curso")) { await semVoz(); return; }
      if (o.guia) deps.irParaConversa(o.guia.conversaId, o.guia.id);
      if (!(await deps.garantirAgente(lig.agenteId)) || !deps.ligacao.atenderOnboarding(lig)) await semVoz();
    } catch (e) {
      deps.erro(e);
    } finally {
      atendendo = false;
      deps.aoMudar();
    }
  }

  /** "Configurar sem voz" (ou a voz não deu): encerra a ligação e abre os cards com o objetivo padrão. */
  async function semVoz(): Promise<void> {
    const o = await mudarEtapa("configurando", true);
    if (o.guia) {
      await deps.garantirAgente(o.guia.id);
      deps.irParaConversa(o.guia.conversaId, o.guia.id);
    }
  }

  async function concluir(): Promise<void> {
    if (concluindo) return;
    concluindo = true;
    try {
      acabouDeConcluir = true;
      hidratar(await api().concluirOnboarding());
    } catch (e) {
      acabouDeConcluir = false;
      deps.erro(e);
    } finally {
      concluindo = false;
    }
  }

  async function reler(): Promise<void> {
    const a = deps.api();
    if (!a) return;
    const o = await a.onboarding().catch(() => null);
    if (o) hidratar(o);
  }

  /** Um clique de card: botão ocupado, a ação, a releitura do estado e do que mais mudou. */
  async function agir(fn: (a: Api) => Promise<EstadoOnboarding | unknown>): Promise<void> {
    if (ocupado) return;
    ocupado = true;
    deps.aoMudar();
    try {
      const r = await fn(api());
      if (r && typeof r === "object" && "etapa" in r && "campos" in r) hidratar(r as EstadoOnboarding);
      else await reler();
      deps.invalidar();
    } catch (e) {
      deps.erro(e);
    } finally {
      ocupado = false;
      deps.aoMudar();
    }
  }

  function saberMais(): void {
    const d = dialogo(`<div class="ligacao-consentimento"><h2>Sua voz na ligação</h2><p>${esc(TEXTO_CONSENTIMENTO)}</p><div class="acoes"><button class="bt pri" type="button" data-fechar>Entendi</button></div></div>`);
    d.querySelector("[data-fechar]")?.addEventListener("click", () => d.close());
    d.querySelector<HTMLButtonElement>("[data-fechar]")?.focus();
  }

  async function conectarApp(slug: string): Promise<void> {
    const d = deps.dados();
    const bot = d?.bot;
    if (!d || !bot) return;
    const conceder = async (): Promise<void> => {
      const id = await deps.conectorHabilitado(slug);
      if (id) await api().definirNivel(bot.id, id, "leitura");
      await reler();
      deps.invalidar();
    };
    // O app já conectado antes: só o acesso de leitura para o bot novo.
    const ja = await deps.conectorHabilitado(slug);
    if (ja) { await agir(async () => { await api().definirNivel(bot.id, ja, "leitura"); return null; }); return; }
    deps.iniciarConexao(slug, conceder);
    deps.aoMudar();
  }

  const acoes: Record<string, (el: HTMLElement) => Promise<void> | void> = {
    "onboarding-pular-ola": () => passarOla(),
    "onboarding-depois": () => fazerDepois(),
    "onboarding-ia-entrar": (el) => iaNoMac(el.dataset.ia === "codex-cli" ? "codex-cli" : "claude-cli", "entrar"),
    "onboarding-ia-instalar": (el) => iaNoMac(el.dataset.ia === "codex-cli" ? "codex-cli" : "claude-cli", "instalar"),
    "onboarding-atender": () => atender(),
    "onboarding-sem-voz": async () => {
      if (atendendo) return;
      atendendo = true;
      deps.aoMudar();
      try { await semVoz(); } catch (e) { deps.erro(e); } finally { atendendo = false; deps.aoMudar(); }
    },
    "onboarding-saber-mais": () => saberMais(),
    "onboarding-recusar-bot": (el) => agir((a) => a.decidirBot(el.dataset.id ?? "", { recusar: true })),
    "onboarding-conectar-app": (el) => conectarApp(el.dataset.slug ?? ""),
    "onboarding-permitir-app": (el) => agir((a) => a.decidir(el.dataset.id ?? "", {})),
    "onboarding-escolher-rotina": (el) => agir((a) => a.rotinaDoOnboarding(Number(el.dataset.indice ?? "0"))),
    "onboarding-criar-rotina-proposta": (el) => agir((a) => a.decidir(el.dataset.id ?? "", {})),
    "onboarding-de-novo": () => deNovo(),
  };

  const forms: Record<string, (form: HTMLFormElement) => Promise<void> | void> = {
    "onboarding-bot": (form) => {
      const dados = new FormData(form);
      const nome = String(dados.get("nome") ?? "").trim();
      const descricao = String(dados.get("descricao") ?? "").trim();
      if (!nome) return;
      const decisao = form.dataset.decisaoBot;
      return agir((a) => (decisao ? a.decidirBot(decisao, { nome, descricao }) : a.botDoOnboarding(nome, descricao)));
    },
  };

  /** "Fazer depois" na configuração sem guia: conclui sem o "Tudo montado" e devolve o app (o menu da conta reabre). */
  async function fazerDepois(): Promise<void> {
    if (concluindo) return;
    concluindo = true;
    try {
      acabouDeConcluir = false;
      hidratar(await api().concluirOnboarding());
      deps.aoMudar();
    } catch (e) {
      deps.erro(e);
    } finally {
      concluindo = false;
    }
  }

  /** "Ver o onboarding de novo" (menu da conta e o fim da configuração): volta ao "olá". */
  async function deNovo(): Promise<void> {
    try {
      olaPassou = false;
      acabouDeConcluir = false;
      notaIa = null;
      iaEntrando = null;
      hidratar(await api().etapaOnboarding({ etapa: "ola" }));
      deps.abrir(true);
      deps.aoMudar();
    } catch (e) {
      deps.erro(e);
    }
  }

  return {
    camada,
    /** A camada cobre o app (olá, IA, "está te ligando"): o main deixa a `.app` inerte. */
    cobre: (): boolean => {
      const e = estadoTela();
      return !!e && (e.fase === "ola" || e.fase === "executor" || e.fase === "chamando");
    },
    /** O bloco dos cards guiados na conversa da guia (vazio fora da configuração ou em outra conversa). */
    blocoNaConversa(conversaId: string): string {
      const e = estadoTela();
      if (!e || (e.fase !== "configurando" && e.fase !== "fim") || e.dados.guia?.conversaId !== conversaId) return "";
      return htmlGuia(e);
    },
    acoes,
    forms,
    deNovo,
    /** A mídia da ligação: um campo anotado (o painel ao lado) ou o fim da entrevista (a pílula e os cards). */
    aoOnboarding(etapa: EtapaOnboarding, campos: CamposEntrevista): void {
      const d = deps.dados();
      if (!d) return;
      hidratar({ ...d, etapa, campos });
      if (etapa === "configurando") {
        if (d.guia) deps.irParaConversa(d.guia.conversaId, d.guia.id);
        void reler();
      }
    },
    /** Um frame qualquer durante a configuração: relê o estado (cards, app, rotina) sem martelar o servidor. */
    aoFrame(): void {
      const d = deps.dados();
      if (!deps.aberto() || !d || (d.etapa !== "configurando" && d.etapa !== "entrevista")) return;
      if (releitura !== null) window.clearTimeout(releitura);
      releitura = window.setTimeout(() => { releitura = null; void reler(); }, 400);
    },
    /** A ligação acabou: na entrevista, segue sem voz; com tudo montado, conclui. */
    async aoLigacaoEncerrada(): Promise<void> {
      const d = deps.dados();
      if (!d || !deps.aberto()) return;
      await reler();
      const atual = deps.dados();
      if (!atual) return;
      if (atual.etapa === "chamando" || atual.etapa === "entrevista") await mudarEtapa("configurando").catch(() => undefined);
      else if (atual.passo === "fim" && atual.etapa !== "concluido") await concluir();
    },
    /** Outra sessão: zera o que é da tela. */
    descartar(): void {
      for (const t of [timerOla, timerProcura, releitura]) if (t !== null) window.clearTimeout(t);
      if (sonda !== null) window.clearInterval(sonda);
      timerOla = timerProcura = releitura = sonda = null;
      olaPassou = false;
      acabouDeConcluir = false;
      iaEntrando = null;
      notaIa = null;
    },
  };
}
