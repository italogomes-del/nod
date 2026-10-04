import type { SuaVezDto } from "../../src/contracts/api.ts";
import type { Ligacao, LigacaoCriada } from "../../src/contracts/ligacao.ts";
import type { IdVozNod, VelocidadeVoz } from "../../src/contracts/vozes.ts";
import { ErroApi, type Api } from "../lib/api.ts";
import type { EventoMotor, MotorLigacao, OpcoesMotor } from "../lib/ligacao.ts";
import type { EstadoLocalLigacao, MotivoAvaliacaoLigacao } from "../lib/ligacao-protocolo.ts";
import { esquecerRegiao, regiao, regiaoMudaria } from "../lib/regioes.ts";
import { esc } from "../lib/render.ts";
import { duracaoRelogio } from "../lib/relogio.ts";
import { dialogo } from "./gestao-agentes.ts";
import {
  avisoDoEstadoLocal, comLegenda, partesDaLigacao, renderAvaliacao, renderRecusa, renderTranscricao, textoFim,
  TEXTO_CONSENTIMENTO, TEXTO_SEM_MAC, VELOCIDADES, VOZES,
  type AgenteDaLigacao, type AvaliacaoLigacao, type CardJanela, type EstadoTelaLigacao,
} from "./ligacao.ts";

/**
 * O controlador da tela da ligação (definido em 2026-10-04, ADR-071): liga o motor (web/lib/ligacao.ts, injetado pelo
 * main.ts) aos eventos, às rotas REST e à região `#ligacao`. O desenho é de web/telas/ligacao.ts.
 */
const TEXTO_RECUSA_PADRAO = "Não dá para ligar agora. Tente de novo em instantes.";

/** O texto de um erro ao criar a ligação (os limites usam o `limite_atingido` existente). */
export function textoErroAoLigar(e: unknown): string {
  if (e instanceof ErroApi && e.codigo === "limite_atingido") return "Você chegou ao limite de ligações por agora. Tente mais tarde.";
  if (e instanceof ErroApi && e.status === 404) return "Ligar ainda não está disponível neste nod.";
  return TEXTO_RECUSA_PADRAO;
}

// ---- controlador ------------------------------------------------------------------------------------------------------
export type DepsTelaLigacao = {
  api: () => Api | null;
  tenantId: () => string | null;
  iniciarMotor: (o: OpcoesMotor) => MotorLigacao;
  agente: (id: string) => AgenteDaLigacao | undefined;
  suaVez: () => SuaVezDto | null;
  /** O que mudou fora da região (a `.app` inerte, a barra lateral, o cabeçalho): o main redesenha. */
  aoMudar: () => void;
  /** Decide pelo clique, com o fluxo normal de decisão da web. */
  decidirPeloClique: (decisaoId: string, aprovar: boolean) => Promise<void>;
  /** A ligação acabou: o main relê a conversa (a linha "Chat de voz") e a disponibilidade do bot. */
  aoEncerrar: (ligacao: Ligacao) => void;
};

export type TelaLigacao = ReturnType<typeof criarTelaLigacao>;

export function criarTelaLigacao(deps: DepsTelaLigacao) {
  let t: EstadoTelaLigacao | null = null;
  let motor: MotorLigacao | null = null;
  let tique: number | null = null;
  let avaliacao: AvaliacaoLigacao | null = null;
  let recusa: { texto: string } | null = null;
  let iniciando = false;
  let falaPessoaAte = 0;
  let textosEnviados = 0;
  const noApp = typeof window !== "undefined" && !!window.nodDesktop;

  function mudar(fn: (e: EstadoTelaLigacao) => EstadoTelaLigacao, foraDaRegiao = false): void {
    if (!t) return;
    t = fn(t);
    render();
    if (foraDaRegiao) deps.aoMudar();
  }

  function cardAtual(): CardJanela | null {
    if (!t?.janela) return null;
    const janela = t.janela;
    const item = deps.suaVez()?.itens.find((i) => i.decisao.id === janela.decisaoId);
    return { decisao: item?.decisao ?? null, restanteS: Math.max(0, Math.ceil((janela.ate - t.agora) / 1000)) };
  }

  function subRegiao(id: string, html: string, filhos: readonly string[] = []): void {
    if (!regiaoMudaria(id, html)) return;
    regiao(id, html);
    for (const f of filhos) esquecerRegiao(f);
  }

  const SUBS = ["ligacao-mascote", "ligacao-info", "ligacao-aviso", "ligacao-legenda", "ligacao-card", "ligacao-teclado", "ligacao-controles", "ligacao-contagem"];

  function render(): void {
    const raiz = document.getElementById("ligacao");
    if (!raiz) return;
    if (!t) {
      const html = avaliacao ? renderAvaliacao(avaliacao) : recusa ? renderRecusa(recusa.texto) : "";
      subRegiao("ligacao", html, SUBS);
      raiz.toggleAttribute("hidden", html === "");
      return;
    }
    raiz.removeAttribute("hidden");
    const partes = partesDaLigacao(t, cardAtual());
    subRegiao("ligacao", partes.esqueleto, SUBS);
    subRegiao("ligacao-mascote", partes.mascote);
    subRegiao("ligacao-info", partes.info);
    subRegiao("ligacao-aviso", partes.aviso);
    subRegiao("ligacao-legenda", partes.legenda);
    subRegiao("ligacao-card", partes.card, ["ligacao-contagem"]);
    const abriuTeclado = regiaoMudaria("ligacao-teclado", partes.teclado) && partes.teclado !== "";
    subRegiao("ligacao-teclado", partes.teclado);
    if (abriuTeclado) document.getElementById("ligacao-texto")?.focus();
    subRegiao("ligacao-controles", partes.controles);
  }

  /** A cada segundo só o cronômetro e a contagem da janela mudam: troca o texto deles, sem regravar a região. */
  function aCadaSegundo(): void {
    if (!t) return;
    const agora = Date.now();
    // Sem o "fim" do detector em 15 s (mudo no meio da fala, troca de aparelho): o indicador volta ao silêncio.
    const calou = t.quemFala === "pessoa" && agora > falaPessoaAte;
    t = { ...t, agora };
    if (calou) mudar((e) => ({ ...e, quemFala: null }));
    for (const el of document.querySelectorAll<HTMLElement>("[data-ligacao-relogio]")) el.textContent = duracaoRelogio(agora - t.desde);
    const contagem = document.getElementById("ligacao-contagem");
    if (t.janela && agora >= t.janela.ate) mudar((e) => ({ ...e, janela: null }));
    else if (contagem && t.janela) contagem.textContent = `${Math.max(0, Math.ceil((t.janela.ate - agora) / 1000))}s`;
  }

  function aoEvento(ev: EventoMotor): void {
    if (!t) return;
    switch (ev.t) {
      case "pronto":
        return;
      case "estado":
        mudar((e) => ({ ...e, fase: ev.fase, rotulo: ev.rotulo ?? null, desde: e.ligacao.atendidaEm ?? (e.fase === "chamando" && ev.fase !== "chamando" ? Date.now() : e.desde) }));
        return;
      case "legenda":
        mudar((e) => ({ ...e, legendas: comLegenda(e.legendas, { chave: `p:${ev.id}`, autor: "pessoa", texto: ev.texto, final: ev.final, espera: false }) }));
        return;
      case "bot-fala":
        mudar((e) => ({ ...e, legendas: comLegenda(e.legendas, { chave: `b:${ev.utt}`, autor: "bot", texto: ev.texto, final: true, espera: ev.tipo === "espera" }) }));
        return;
      case "janela":
        mudar((e) => ({ ...e, janela: { decisaoId: ev.decisaoId, ate: ev.ate } }));
        return;
      case "janela-fechada":
        mudar((e) => (e.janela?.decisaoId === ev.decisaoId ? { ...e, janela: null } : e));
        return;
      case "cerebro":
        mudar((e) => ({ ...e, aviso: ev.online ? (e.aviso?.texto === TEXTO_SEM_MAC ? null : e.aviso) : { tom: "alerta", texto: TEXTO_SEM_MAC } }));
        return;
      case "aviso":
        mudar((e) => ({ ...e, aviso: { tom: "info", texto: ev.texto } }));
        return;
      case "fim":
        terminar(textoFim(ev.motivo, t.agente.nome), ev.motivo !== "nao_atendida" && ev.motivo !== "recusada");
        return;
      case "voz-local":
        if (ev.quem === "pessoa" && ev.ativo) falaPessoaAte = Date.now() + 15_000;
        mudar((e) => ({ ...e, quemFala: ev.ativo ? ev.quem : e.quemFala === ev.quem ? null : e.quemFala }));
        return;
      case "local":
        aoEstadoLocal(ev.estado);
        return;
      case "subir":
      case "interromper":
      case "comando":
      case "pong":
        return;
    }
  }

  function aoEstadoLocal(estado: EstadoLocalLigacao): void {
    if (!t) return;
    if (estado === "reconectando") { mudar((e) => ({ ...e, fase: "reconectando" })); return; }
    if (estado === "conectado") { mudar((e) => ({ ...e, fase: e.fase === "reconectando" ? "ouvindo" : e.fase })); return; }
    if (estado === "audio-suspenso") { mudar((e) => ({ ...e, audioSuspenso: true })); return; }
    const aviso = avisoDoEstadoLocal(estado, noApp);
    if (estado === "caiu" || estado === "encerrada-pelo-servidor" || estado === "voz-fora" || estado === "ja-em-ligacao" || estado === "sessao-expirada") {
      terminar(aviso?.texto ?? null, estado === "caiu" || estado === "encerrada-pelo-servidor");
      return;
    }
    if (aviso) mudar((e) => ({ ...e, aviso }));
  }

  /** A ligação acabou (desligada aqui, pelo servidor ou caída): fecha o motor e oferece "Como foi a ligação?". */
  function terminar(motivo: string | null, avaliar: boolean): void {
    if (!t) return;
    const fim = t;
    motor?.fechar();
    motor = null;
    if (tique !== null) window.clearInterval(tique);
    tique = null;
    t = null;
    const duracaoMs = Math.max(0, Date.now() - fim.desde);
    if (avaliar) avaliacao = { ligacaoId: fim.ligacao.id, agenteNome: fim.agente.nome, duracaoMs, motivoFim: motivo, passo: "nota" };
    else if (motivo) mostrarRecusa(motivo);
    render();
    deps.aoMudar();
    deps.aoEncerrar(fim.ligacao);
  }

  function abrirTela(ligacao: Ligacao, modo: "cheia" | "pilula", retomar: boolean): void {
    const agente = deps.agente(ligacao.agenteId);
    const tenantId = deps.tenantId();
    if (!agente || !tenantId) return;
    motor?.fechar();
    avaliacao = null;
    recusa = null;
    const agora = Date.now();
    t = {
      ligacao, agente, modo,
      fase: ligacao.estado === "em_curso" ? "ouvindo" : "chamando",
      rotulo: null,
      desde: ligacao.atendidaEm ?? (ligacao.estado === "em_curso" ? ligacao.iniciadaEm : agora),
      agora, legendas: [], janela: null, mudo: false, teclado: false,
      voz: VOZES.find((v) => v.id === ligacao.voz)?.id ?? "clara", velocidade: 1,
      aviso: null, quemFala: null, audioSuspenso: false, sugestoes: [],
    };
    motor = deps.iniciarMotor({ tenantId, ligacaoId: ligacao.id, retomar, aoEvento });
    if (tique !== null) window.clearInterval(tique);
    tique = window.setInterval(aCadaSegundo, 1_000);
    render();
    deps.aoMudar();
    if (modo === "cheia") document.querySelector<HTMLElement>('#ligacao [data-act="ligacao-encolher"]')?.focus();
  }

  /** O clique em "Ligar": disponibilidade → consentimento (se preciso) → POST ligacoes → tela cheia e motor. */
  async function ligar(agenteId: string): Promise<void> {
    const api = deps.api();
    if (!api || iniciando || t) return;
    iniciando = true;
    try {
      const d = await api.disponibilidadeLigacao(agenteId);
      if (!d.disponivel) { mostrarRecusa(d.texto); return; }
      if (d.consentimentoNecessario && !(await pedirConsentimento())) return;
      if (d.consentimentoNecessario) await api.consentirVoz(d.versaoConsentimento);
      const criada: LigacaoCriada = await api.criarLigacao(agenteId);
      abrirTela(criada.ligacao, "cheia", false);
    } catch (e) {
      mostrarRecusa(textoErroAoLigar(e));
    } finally {
      iniciando = false;
    }
  }

  /** O porquê de não ligar (ou de a ligação não ter acontecido), num aviso do design system que some em 8 s. */
  function mostrarRecusa(texto: string): void {
    const esta = { texto };
    recusa = esta;
    window.setTimeout(() => { if (recusa === esta) { recusa = null; render(); } }, 8_000);
    render();
  }

  function pedirConsentimento(): Promise<boolean> {
    return new Promise((resolver) => {
      let decidido = false;
      const d = dialogo(`<div class="ligacao-consentimento"><h2>Antes da primeira ligação</h2><p>${esc(TEXTO_CONSENTIMENTO)}</p><div class="acoes"><button class="bt" type="button" data-nao>Agora não</button><button class="bt pri" type="button" data-sim>Concordo e ligar</button></div></div>`);
      const fim = (v: boolean) => { if (decidido) return; decidido = true; resolver(v); d.close(); };
      d.querySelector("[data-nao]")?.addEventListener("click", () => fim(false));
      d.querySelector("[data-sim]")?.addEventListener("click", () => fim(true));
      d.addEventListener("close", () => { if (!decidido) { decidido = true; resolver(false); } });
      d.querySelector<HTMLButtonElement>("[data-sim]")?.focus();
    });
  }

  function abrirAjustes(ancora: HTMLElement): void {
    if (!t) return;
    const atual = t;
    const opcoesVoz = VOZES.map((v) => `<option value="${v.id}"${v.id === atual.voz ? " selected" : ""}>${esc(v.nome)}</option>`).join("");
    const opcoesVel = VELOCIDADES.map((v) => `<option value="${v}"${v === atual.velocidade ? " selected" : ""}>${String(v).replace(".", ",")}x</option>`).join("");
    const d = dialogo(`<div class="ligacao-ajustes" aria-label="Ajustes da voz"><label>Voz<select data-ajuste="voz">${opcoesVoz}</select></label><label>Velocidade<select data-ajuste="velocidade">${opcoesVel}</select></label><div class="la-linha"><span>Idioma</span><span>Português (Brasil)</span></div><p class="la-nota-ajuste" role="status"></p></div>`, true);
    d.classList.add("ligacao-ajustes-menu");
    const r = ancora.getBoundingClientRect();
    d.style.left = `${Math.max(12, Math.min(window.innerWidth - d.offsetWidth - 12, r.left))}px`;
    d.style.top = `${r.top - d.offsetHeight - 10 > 12 ? r.top - d.offsetHeight - 10 : r.bottom + 10}px`;
    d.addEventListener("change", (e) => {
      const sel = e.target as HTMLSelectElement;
      const nota = d.querySelector(".la-nota-ajuste");
      const voz = VOZES.find((v) => v.id === sel.value)?.id;
      const velocidade = VELOCIDADES.find((v) => String(v) === sel.value);
      if (sel.dataset.ajuste === "voz" && voz) void ajustar({ voz }, nota);
      else if (sel.dataset.ajuste === "velocidade" && velocidade !== undefined) void ajustar({ vozVelocidade: velocidade }, nota);
    });
    d.querySelector<HTMLSelectElement>("select")?.focus();
  }

  async function ajustar(a: { voz?: IdVozNod; vozVelocidade?: VelocidadeVoz }, nota: Element | null): Promise<void> {
    const api = deps.api();
    if (!api || !t) return;
    try {
      await api.ajustarVoz(t.agente.id, a);
      mudar((e) => ({ ...e, voz: a.voz ?? e.voz, velocidade: a.vozVelocidade ?? e.velocidade }));
      if (nota) nota.textContent = "Vale a partir da próxima frase.";
    } catch {
      if (nota) nota.textContent = "Não foi possível mudar agora.";
    }
  }

  async function verTranscricao(ligacaoId: string, nomeBot: string): Promise<void> {
    const api = deps.api();
    if (!api) return;
    const d = dialogo(`<div class="ligacao-transcricao"><h2>Transcrição da ligação</h2><div class="tr-corpo"><p class="tr-vazia">Carregando…</p></div><div class="acoes"><button class="bt" type="button" data-fechar>Fechar</button></div></div>`);
    d.querySelector("[data-fechar]")?.addEventListener("click", () => d.close());
    try {
      const { falas } = await api.falasLigacao(ligacaoId);
      const corpo = d.querySelector(".tr-corpo");
      if (corpo) corpo.innerHTML = renderTranscricao(falas, nomeBot);
    } catch {
      const corpo = d.querySelector(".tr-corpo");
      if (corpo) corpo.innerHTML = '<p class="tr-vazia">Não foi possível abrir a transcrição agora.</p>';
    }
  }

  return {
    /** A ligação aberta nesta página (a barra lateral marca o bot "Em ligação" e o cabeçalho troca o botão). */
    ativa: (): { ligacaoId: string; agenteId: string; conversaId: string; modo: "cheia" | "pilula" } | null => (t ? { ligacaoId: t.ligacao.id, agenteId: t.agente.id, conversaId: t.ligacao.conversaId, modo: t.modo } : null),
    cheia: (): boolean => t?.modo === "cheia",
    render,
    ligar,
    /** Ao recarregar a página com a ligação viva: volta como pílula e o motor reconecta com `retomar`. */
    retomar(ligacao: Ligacao): void {
      if (t || (ligacao.estado !== "chamando" && ligacao.estado !== "em_curso")) return;
      abrirTela(ligacao, "pilula", true);
    },
    encolher(): void {
      mudar((e) => ({ ...e, modo: "pilula", teclado: false }), true);
      document.querySelector<HTMLElement>('#ligacao [data-act="ligacao-expandir"]')?.focus();
    },
    expandir(): void {
      mudar((e) => ({ ...e, modo: "cheia" }), true);
      document.querySelector<HTMLElement>('#ligacao [data-act="ligacao-encolher"]')?.focus();
    },
    alternarMudo(): void {
      if (!t) return;
      const ativo = !t.mudo;
      motor?.mudo(ativo);
      mudar((e) => ({ ...e, mudo: ativo }));
    },
    alternarTeclado(): void {
      mudar((e) => ({ ...e, teclado: !e.teclado }));
    },
    abrirAjustes,
    enviarTexto(texto: string): boolean {
      if (!t || !motor) return false;
      const limpo = texto.trim();
      if (!limpo || !motor.enviarTexto(limpo)) return false;
      textosEnviados += 1;
      mudar((e) => ({ ...e, legendas: comLegenda(e.legendas, { chave: `t:${textosEnviados}`, autor: "pessoa", texto: limpo, final: true, espera: false }) }));
      return true;
    },
    async desligar(): Promise<void> {
      if (!t) return;
      const id = t.ligacao.id;
      motor?.desligar();
      motor = null;
      terminar(null, true);
      await deps.api()?.encerrarLigacao(id).catch(() => undefined);
    },
    async decidir(decisaoId: string, aprovar: boolean): Promise<void> {
      await deps.decidirPeloClique(decisaoId, aprovar);
      mudar((e) => (e.janela?.decisaoId === decisaoId ? { ...e, janela: null } : e));
    },
    async retomarAudio(): Promise<void> {
      await motor?.retomarAudio();
      mudar((e) => ({ ...e, audioSuspenso: false }));
    },
    async avaliar(nota: "boa" | "ruim"): Promise<void> {
      if (!avaliacao) return;
      const a = avaliacao;
      if (nota === "ruim") { avaliacao = { ...a, passo: "motivo" }; render(); return; }
      avaliacao = { ...a, passo: "obrigado" };
      render();
      await deps.api()?.avaliarLigacao(a.ligacaoId, "boa").catch(() => undefined);
      window.setTimeout(() => { if (avaliacao?.ligacaoId === a.ligacaoId) { avaliacao = null; render(); } }, 2_500);
    },
    async motivo(motivo: MotivoAvaliacaoLigacao): Promise<void> {
      if (!avaliacao) return;
      const a = avaliacao;
      avaliacao = { ...a, passo: "obrigado" };
      render();
      await deps.api()?.avaliarLigacao(a.ligacaoId, "ruim", motivo).catch(() => undefined);
      window.setTimeout(() => { if (avaliacao?.ligacaoId === a.ligacaoId) { avaliacao = null; render(); } }, 2_500);
    },
    fecharAvaliacao(): void {
      avaliacao = null;
      render();
    },
    fecharRecusa(): void {
      recusa = null;
      render();
    },
    verTranscricao,
    /** "Apagar transcrição": o resumo fica na conversa; a dona apaga só as falas. */
    async apagarTranscricao(ligacaoId: string): Promise<void> {
      await deps.api()?.apagarFalasLigacao(ligacaoId);
    },
    /** A página está saindo (sessão trocada): fecha sem tchau; o servidor encerra se ela não voltar em 10 s. */
    descartar(): void {
      motor?.fechar();
      motor = null;
      if (tique !== null) window.clearInterval(tique);
      tique = null;
      t = null;
      avaliacao = null;
      recusa = null;
      render();
    },
  };
}

