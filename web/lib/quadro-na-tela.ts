/**
 * NOD-429 (definido em 2026-10-30): a troca Conversa ↔ Quadro na pílula, nos nós vivos do palco.
 *
 * - O HTML do segmento não diz o modo (web/telas/quadro.ts, `segmento`); `sincronizar` marca `data-atual`,
 *   `aria-selected` e `tabindex` depois de cada desenho, e o indicador desliza por transição de CSS (web/quadro.css).
 * - A conversa (timeline, campo, faixas) nunca é regravada nem tirada do DOM: no modo Quadro ela fica por baixo, invisível
 *   e `inert`; a vista `#quadro` cobre o palco. Rolagem, rascunho e foco da conversa sobrevivem à ida e volta.
 * - Comentário final do Marlon na j7-1: o conteúdo desliza de lado nos dois sentidos (Web Animations, `movimentoDaTroca`);
 *   com "Reduzir movimento", fade curto sem deslocamento. Trocar de volta no meio inverte a animação em curso, do ponto
 *   onde ela está (sem salto).
 * - O modo é por conversa e só em memória: trocar de conversa (ou sair dela) volta para Conversa, sem animação.
 */
import { STATUS, direcaoDaTroca, ehModo, modoPelaTecla, movimentoDaTroca, type ModoDaConversa, type Status } from "./quadro.ts";
import type { QuadroDto } from "../../src/contracts/quadro.ts";
import type { ConversaDto, RespostaMutacao } from "../../src/contracts/api.ts";
import type { MutacaoQuadro } from "./api.ts";
import { acesos, historicoDaFaixa, respostaDoBot, tarefaNoQuadro, type Faixa } from "./quadro-dados.ts";
import { quadroVazio, type Filtro, type Html } from "../telas/quadro.ts";
import { faixaDoQuadro, pilulaDoQuadro, quadroCarregando, quadroComErro, quadroDaMeta, semQuadro, tarefaAberta, type AgenteDoQuadro, type TrocaDaFaixa } from "../telas/quadro-real.ts";

/** O pedaço da API que o quadro usa (NOD-442); null = sem sessão ainda. */
export interface ApiDoQuadro {
  quadro(agenteId: string): Promise<{ quadro: QuadroDto | null }>;
  conversa(conversaId: string): Promise<Pick<ConversaDto, "mensagens">>;
  enviar(conversaId: string, texto: string, anexos?: readonly string[], idEnvio?: string): Promise<RespostaMutacao>;
  responderTarefa(agenteId: string, tarefaId: string, resposta: string): Promise<MutacaoQuadro>;
  desfazerLoteQuadro(agenteId: string, loteId: string): Promise<MutacaoQuadro>;
}

/** NOD-442: o que o quadro de verdade precisa do main. Sem isto (os testes da NOD-429), a vista é o quadro vazio. */
export interface DadosDoQuadro {
  api: () => ApiDoQuadro | null;
  agente: AgenteDoQuadro;
  hora: (em: number) => string;
  /** Quanto a faixa fica à vista depois da resposta (ms). */
  recolherEm?: number;
  /** A janela que junta frames em rajada numa releitura só (ms). */
  juntarEm?: number;
}

/** Os pedaços do palco que são "a conversa": saem juntos quando o Quadro entra. */
export const LADO_DA_CONVERSA = ["timeline", "pilula-novas", "faixa-trabalhos", "composer"] as const;

const ehStatus = (v: unknown): v is Status => (STATUS as readonly unknown[]).includes(v);

export interface QuadroNaTela {
  /** Depois de cada desenho: `chave` é a conversa à vista com o quadro liberado, ou null (outra tela, flag desligada). */
  sincronizar(o: { chave: string | null; nome: string; agenteId?: string | null }): void;
  /** NOD-442: cada frame do SSE. `quadro.mudou` relê o quadro (os cards que mudaram acendem); a fala do bot sobe na faixa. */
  aoFrame(frame: { tipo: string; dados: Record<string, unknown> }): void;
  trocar(para: ModoDaConversa, o?: { foco?: boolean }): void;
  /** A conexão voltou sem o replay: relê o quadro (e a conversa, com um pedido esperando). */
  reler(): void;
  modo(): ModoDaConversa;
}

export function criarQuadroNaTela(doc: Document, o: { reduzido?: () => boolean; aoTrocar?: (m: ModoDaConversa) => void; dados?: DadosDoQuadro } = {}): QuadroNaTela {
  const reduzido = o.reduzido ?? (() => doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  let chave: string | null = null;
  let nome = "";
  let modo: ModoDaConversa = "conversa";
  let filtro: Filtro = "todos";
  /** As colunas que a pessoa abriu ou recolheu, ao contrário do padrão. */
  let alternadas = new Set<Status>();
  let animacoes: Animation[] = [];
  /** Quem está saindo na animação em curso (fica `inert`); na inversão, troca com quem entra. */
  let saindo: HTMLElement[] = [];
  let entrando: HTMLElement[] = [];
  let vez = 0;
  /**
   * A aba que tem o foco: se o render regravar o cabeçalho, o nó dela sai do DOM e o foco cai no body; aí ele vai para a aba
   * nova do mesmo modo. Zera quando a pessoa leva o foco para outro lugar (clique, toque, Tab), para não puxá-lo de volta.
   */
  let abaFocada: { el: HTMLElement; modo: ModoDaConversa } | null = null;

  const vista = (): HTMLElement | null => doc.getElementById("quadro");
  const conversa = (): HTMLElement[] => LADO_DA_CONVERSA.map((id) => doc.getElementById(id)).filter((e): e is HTMLElement => !!e);

  /* ---------- NOD-442: o quadro de verdade ---------- */
  const dd = o.dados;
  let agenteId: string | null = null;
  let q: QuadroDto | null = null;
  let carga: "nada" | "carregando" | "ok" | "erro" = "nada";
  let aberta: string | null = null;
  let acesas = new Set<string>();
  let faixa: Faixa = { tipo: "nada" };
  /** O último lote antes do pedido na pílula: o Desfazer da faixa é o lote que nasceu depois dele. */
  let loteAntes: string | null = null;
  let historico: TrocaDaFaixa[] = [];
  let histAberto = false;
  let leitura = 0;
  let leituraConversa = 0;
  let timerReler: ReturnType<typeof setTimeout> | null = null;
  let timerRecolher: ReturnType<typeof setTimeout> | null = null;
  let dica: string[] = [];

  function zerarDados(): void {
    agenteId = null; q = null; carga = "nada"; aberta = null; acesas = new Set(); faixa = { tipo: "nada" }; loteAntes = null;
    historico = []; histAberto = false; leitura++; leituraConversa++; dica = [];
    if (timerReler) clearTimeout(timerReler);
    if (timerRecolher) clearTimeout(timerRecolher);
    timerReler = timerRecolher = null;
  }

  function conteudoHtml(): Html | string {
    if (!dd) return quadroVazio({ nome, filtro, alternadas });
    if (carga === "nada" || carga === "carregando") return quadroCarregando();
    if (carga === "erro") return quadroComErro();
    if (!q) return semQuadro(nome);
    const t = tarefaNoQuadro(q, aberta);
    if (t) return tarefaAberta({ t, q, agente: dd.agente });
    return quadroDaMeta({ q, nome, agente: dd.agente, filtro, alternadas, acesas });
  }

  /**
   * Regrava só o conteúdo (o quadro ou a tarefa). A pílula fica: o rascunho e o foco nela sobrevivem a cada frame. O que a
   * pessoa digitava numa resposta também volta (o campo é o mesmo id), e o foco com ele.
   */
  function desenharVista(): void {
    const v = vista();
    if (!v) return;
    if (!dd) { v.innerHTML = quadroVazio({ nome, filtro, alternadas }); return; }
    let conteudo = v.querySelector<HTMLElement>(":scope > .qd-conteudo");
    if (!conteudo) {
      v.innerHTML = `<div class="qd-conteudo"></div><footer class="qc-wrap">${pilulaDoQuadro({ meta: q?.meta ?? null, nome })}</footer>`;
      conteudo = v.querySelector<HTMLElement>(":scope > .qd-conteudo");
    }
    if (!conteudo) return;
    const rascunhos = new Map<string, string>();
    for (const c of conteudo.querySelectorAll<HTMLTextAreaElement>("textarea[id]")) if (c.value) rascunhos.set(c.id, c.value);
    const ativo = doc.activeElement;
    const focoId = ativo instanceof HTMLElement && conteudo.contains(ativo) && ativo.id ? ativo.id : null;
    conteudo.innerHTML = conteudoHtml();
    for (const [id, valor] of rascunhos) { const c = doc.getElementById(id); if (c instanceof HTMLTextAreaElement) c.value = valor; }
    if (focoId) doc.getElementById(focoId)?.focus();
    const form = v.querySelector<HTMLElement>('[data-form="conversa-no-quadro"]');
    const rot = q ? `Conversar com o quadro ${q.meta}` : `Conversar com ${nome} sobre o quadro`;
    if (form && form.getAttribute("aria-label") !== rot) form.setAttribute("aria-label", rot);
    const txt = v.querySelector<HTMLTextAreaElement>("#qc-txt");
    const t = tarefaNoQuadro(q, aberta);
    if (txt) txt.placeholder = t ? `Recado sobre ${t.linearId ?? t.titulo}` : "Nova tarefa ou mensagem";
    desenharFaixa();
  }

  function desenharFaixa(): void {
    const lugar = doc.getElementById("qc-faixa");
    if (!lugar || !dd) return;
    const bot = agenteId ? dd.agente(agenteId) : null;
    lugar.innerHTML = faixaDoQuadro({ faixa, avatarBot: bot?.avatar ?? null, historico, aberto: histAberto, hora: dd.hora });
  }

  function mudarFaixa(f: Faixa): void {
    faixa = f;
    if (timerRecolher) { clearTimeout(timerRecolher); timerRecolher = null; }
    // A resposta fica alguns segundos e recolhe sozinha (passo 9); com o histórico aberto, fica até a pessoa fechar.
    if (f.tipo === "resposta") {
      timerRecolher = setTimeout(() => { timerRecolher = null; if (!histAberto && faixa === f) { faixa = { tipo: "nada" }; desenharFaixa(); } }, dd?.recolherEm ?? 12000);
    }
    desenharFaixa();
  }

  /** Lê o quadro do bot anfitrião; o que mudou desde a leitura anterior acende. Leitura velha (outra conversa) é descartada. */
  async function lerQuadro(): Promise<void> {
    const a = dd?.api();
    if (!a || !agenteId) return;
    const minha = ++leitura;
    const de = agenteId;
    if (carga === "nada") { carga = "carregando"; desenharVista(); }
    try {
      const r = await a.quadro(de);
      if (minha !== leitura || de !== agenteId) return;
      aplicarQuadro(r.quadro);
    } catch {
      if (minha !== leitura || de !== agenteId) return;
      if (carga !== "ok") { carga = "erro"; desenharVista(); }
    }
  }

  function aplicarQuadro(novo: QuadroDto | null, extra: readonly string[] = []): void {
    const novas = acesos(q, novo, [...dica, ...extra]);
    // Uma releitura sem mudança (a do frame e a da resposta chegam juntas) não apaga o brilho que a anterior acendeu.
    if (novas.size || !q || !novo || q.id !== novo.id) acesas = novas;
    dica = [];
    q = novo;
    carga = "ok";
    if (aberta && !tarefaNoQuadro(q, aberta)) aberta = null;
    desenharVista();
  }

  function pedirReleitura(): void {
    if (timerReler) return;
    timerReler = setTimeout(() => { timerReler = null; void lerQuadro(); }, dd?.juntarEm ?? 250);
  }

  /** Relê a conversa do anfitrião: o histórico da faixa e, se há um pedido esperando, a resposta dele. */
  async function lerConversa(): Promise<void> {
    const a = dd?.api();
    if (!a || !chave || !agenteId) return;
    const minha = ++leituraConversa;
    const c = chave;
    const de = agenteId;
    try {
      const r = await a.conversa(c);
      if (minha !== leituraConversa || c !== chave) return;
      historico = historicoDaFaixa(r.mensagens, de);
      // Segue o pedido até o fim do turno: uma fala nova do bot depois da primeira troca o texto e o Desfazer (codex rodada 5).
      const pedidoId = faixa.tipo === "aguardando" ? faixa.pedidoId : faixa.tipo === "resposta" ? faixa.pedidoId : null;
      if (pedidoId) {
        const resp = respostaDoBot(r.mensagens, de, pedidoId);
        if (resp && !(faixa.tipo === "resposta" && faixa.mensagemId === resp.id)) {
          // A resposta chega depois do lote: relê o quadro antes, para o Desfazer apontar o lote deste pedido.
          await lerQuadro();
          if (c !== chave) return;
          const lote = q?.ultimoLote ?? null;
          // Só o lote que o anfitrião gravou depois do pedido: o de outro bot ou de outro aparelho não ganha o Desfazer
          // aqui (revisão do PR #612; o servidor ainda recusa o que não for o último).
          const doAnfitriao = lote?.autor.tipo === "agente" && lote.autor.agenteId === de;
          const loteId = lote && doAnfitriao && lote.id !== loteAntes && !lote.desfeitoEm ? lote.id : null;
          mudarFaixa({ tipo: "resposta", texto: resp.texto, loteId, mensagemId: resp.id, pedidoId });
          return;
        }
      }
      desenharFaixa();
    } catch {
      /* A faixa fica como está; o próximo frame tenta de novo. */
    }
  }

  async function enviarPedido(form: HTMLFormElement): Promise<void> {
    const a = dd?.api();
    const txt = form.querySelector<HTMLTextAreaElement>("#qc-txt");
    if (!a || !chave || !txt) return;
    const bruto = txt.value.trim();
    if (!bruto) return;
    const t = tarefaNoQuadro(q, aberta);
    // Com uma tarefa aberta o recado vai sobre ela: só o id, que o bot lê pelo gerir_quadro. O título e o id do Linear
    // podem ter vindo de fora e não entram na fala confiável da pessoa (revisão do PR #612).
    const texto = t ? `Sobre a tarefa ${t.id} do quadro: ${bruto}` : bruto;
    loteAntes = q?.ultimoLote?.id ?? null;
    histAberto = false;
    mudarFaixa({ tipo: "aguardando", pedidoId: null });
    const c = chave;
    try {
      const r = await a.enviar(c, texto, [], globalThis.crypto?.randomUUID?.());
      if (c !== chave) return;
      // Só limpa se a pessoa não começou outro recado enquanto este ia (codex, rodada 3).
      if (txt.value.trim() === bruto) txt.value = "";
      const pedidoId = r.ids["mensagem"] ?? null;
      mudarFaixa({ tipo: "aguardando", pedidoId });
      void lerConversa();
    } catch {
      if (c !== chave) return;
      mudarFaixa({ tipo: "erro", texto: "Não consegui mandar. O texto continua na pílula." });
    }
  }

  async function responder(form: HTMLFormElement): Promise<void> {
    const a = dd?.api();
    const id = form.dataset["id"];
    const campo = form.querySelector<HTMLTextAreaElement>("textarea");
    const resposta = campo?.value.trim() ?? "";
    if (!a || !agenteId || !id || !campo || !resposta) return;
    const botao = form.querySelector<HTMLButtonElement>('button[type="submit"]');
    if (botao) botao.disabled = true;
    // A pessoa pode trocar de bot antes da resposta voltar: o quadro de um não entra na tela do outro.
    const c = chave;
    const de = agenteId;
    try {
      const r = await a.responderTarefa(de, id, resposta);
      if (c !== chave || de !== agenteId) return;
      campo.value = "";
      aplicarQuadro(r.quadro, [id]);
    } catch {
      if (c !== chave) return;
      if (botao) botao.disabled = false;
      mudarFaixa({ tipo: "erro", texto: "Não consegui mandar a resposta. Ela continua no campo." });
    }
  }

  async function desfazer(loteId: string): Promise<void> {
    const a = dd?.api();
    if (!a || !agenteId) return;
    const c = chave;
    const de = agenteId;
    try {
      const r = await a.desfazerLoteQuadro(de, loteId);
      if (c !== chave || de !== agenteId) return;
      aplicarQuadro(r.quadro, q?.ultimoLote?.tarefaIds ?? []);
      mudarFaixa({ tipo: "resposta", texto: "Desfeito.", loteId: null, mensagemId: "" });
    } catch {
      if (c !== chave) return;
      mudarFaixa({ tipo: "erro", texto: "Não deu para desfazer: o quadro mudou depois deste pedido." });
    }
  }

  function aoFrame(frame: { tipo: string; dados: Record<string, unknown> }): void {
    if (!dd || chave === null || !agenteId) return;
    const d = frame.dados;
    if (frame.tipo === "quadro.mudou") {
      if (d["agenteId"] !== agenteId && (!q || d["quadroId"] !== q.id)) return;
      const ids = typeof d["tarefas"] === "string" ? d["tarefas"].split(",").filter(Boolean) : [];
      dica = [...dica, ...ids];
      pedirReleitura();
      return;
    }
    // A execução dos cards (rodando, na fila, falhou) vem dos turnos: com o quadro à vista e com tarefas, relê.
    if (frame.tipo.startsWith("turno.") && q && q.tarefas.length && modo === "quadro") pedirReleitura();
    const daConversa = d["conversaId"] === chave;
    if (daConversa && (frame.tipo === "mensagem.nova" || frame.tipo === "turno.encerrado" || frame.tipo === "turno.interrompido") && (faixa.tipo === "aguardando" || (faixa.tipo === "resposta" && !!faixa.pedidoId) || histAberto)) {
      // Com a resposta na faixa e o pedido ainda acompanhado, as falas seguintes do mesmo turno também sobem (a final traz o Desfazer).
      void lerConversa();
    }
    if (daConversa && frame.tipo === "turno.interrompido" && faixa.tipo === "aguardando") {
      mudarFaixa({ tipo: "erro", texto: "O pedido parou no meio. Veja na Conversa." });
    }
  }

  function abrirTarefa(id: string): void {
    aberta = id;
    histAberto = false;
    desenharVista();
    doc.getElementById("qd-t-tit")?.focus();
    vista()?.scrollTo?.({ top: 0 });
  }

  function voltarAoQuadro(): void {
    const id = aberta;
    aberta = null;
    desenharVista();
    if (id) vista()?.querySelector<HTMLElement>(`.qd-conteudo [data-act="abrir-tarefa"][data-id="${CSS.escape(id)}"]`)?.focus();
  }

  function mostrar(els: HTMLElement[]): void {
    for (const e of els) {
      e.classList.remove("qd-saiu");
      e.inert = false;
      if (e.id === "quadro") e.hidden = false;
    }
  }
  function esconder(els: HTMLElement[]): void {
    for (const e of els) {
      if (e.id === "quadro") { e.hidden = true; continue; }
      e.classList.add("qd-saiu");
      e.inert = true;
    }
  }

  function marcar(): void {
    const seg = doc.querySelector<HTMLElement>("#cabecalho .qd-seg");
    if (seg) {
      // Segmento recém-desenhado (cabeçalho regravado): nó novo não tem estilo anterior, então o indicador nasce no lugar.
      seg.dataset["atual"] = modo;
      for (const b of seg.querySelectorAll<HTMLElement>('[role="tab"]')) {
        const s = b.dataset["modo"] === modo;
        b.setAttribute("aria-selected", String(s));
        b.tabIndex = s ? 0 : -1;
      }
    }
    doc.querySelector(".stage")?.classList.toggle("qd-no-quadro", modo === "quadro");
    const ativo = doc.activeElement;
    if (abaFocada && !abaFocada.el.isConnected && (!ativo || ativo === doc.body)) focarAba(abaFocada.modo);
  }

  function cancelar(): void {
    vez++;
    for (const a of animacoes) a.cancel();
    animacoes = [];
    saindo = [];
    entrando = [];
  }

  /** Sem animação: o estado final do modo atual. */
  function assentar(): void {
    const v = vista();
    if (modo === "quadro") { mostrar(v ? [v] : []); esconder(conversa()); }
    else { mostrar(conversa()); esconder(v ? [v] : []); }
    marcar();
  }

  function trocar(para: ModoDaConversa, op: { foco?: boolean } = {}): void {
    const direcao = chave === null ? null : direcaoDaTroca(modo, para);
    if (!direcao) { if (op.foco) focarAba(para); return; }
    if (animacoes.length) {
      // Volta no meio: a mesma animação anda para trás, do ponto onde está; quem saía passa a entrar.
      modo = para;
      marcar();
      o.aoTrocar?.(para);
      [saindo, entrando] = [entrando, saindo];
      for (const e of saindo) e.inert = true;
      for (const e of entrando) e.inert = false;
      for (const a of animacoes) a.reverse();
      if (op.foco) focarAba(para);
      return;
    }
    cancelar();
    const v = vista();
    if (!v) return;
    if (para === "quadro" && !v.firstElementChild) desenharVista();
    if (para === "quadro" && dd) void lerQuadro();
    modo = para;
    marcar();
    // Depois de `modo = para`: quem ouve (o main, que marca a conversa como lida na volta) já vê o modo novo.
    o.aoTrocar?.(para);
    const sai = para === "quadro" ? conversa() : [v];
    const entra = para === "quadro" ? [v] : conversa();
    saindo = sai;
    entrando = entra;
    mostrar([...sai, ...entra]);
    for (const e of sai) e.inert = true;
    const mv = movimentoDaTroca(direcao, reduzido());
    const pode = typeof v.animate === "function";
    if (!pode) { assentar(); if (op.foco) focarAba(para); return; }
    const opcoes: KeyframeAnimationOptions = { duration: mv.ms, easing: mv.curva };
    animacoes = [...sai.map((e) => e.animate(mv.sai, opcoes)), ...entra.map((e) => e.animate(mv.entra, opcoes))];
    const minha = vez;
    const fim = (): void => {
      if (minha !== vez) return;
      animacoes = [];
      saindo = [];
      entrando = [];
      assentar();
    };
    void Promise.all(animacoes.map((a) => a.finished)).then(fim, fim);
    if (op.foco) focarAba(para);
  }

  function focarAba(m: ModoDaConversa): void {
    doc.querySelector<HTMLElement>(`#cabecalho .qd-seg [role="tab"][data-modo="${m}"]`)?.focus();
  }

  function sincronizar(s: { chave: string | null; nome: string; agenteId?: string | null }): void {
    // Fora de uma conversa com quadro, e já sem quadro: nada a mexer (o palco é de outra tela).
    if (s.chave === null && chave === null) return;
    if (s.chave !== chave) {
      cancelar();
      zerarDados();
      agenteId = s.chave === null ? null : (s.agenteId ?? null);
      chave = s.chave;
      modo = "conversa";
      filtro = "todos";
      alternadas = new Set();
      const v = vista();
      if (v) v.innerHTML = "";
    }
    if (s.nome !== nome) { nome = s.nome; if (vista()?.firstElementChild) desenharVista(); }
    // No meio de uma animação o estado é dela; só o segmento (o cabeçalho pode ter sido regravado) é remarcado.
    if (animacoes.length) marcar();
    else assentar();
  }

  // As ações do segmento e do quadro vazio moram aqui, não no mapa de ações do main: são só da tela.
  doc.addEventListener("click", (ev) => {
    const alvo = ev.target as Element | null;
    // Clicar no quadro recolhe o histórico da faixa (passo 9).
    if (histAberto && alvo?.closest?.("#quadro .qd-conteudo")) { histAberto = false; desenharFaixa(); }
    const el = alvo?.closest?.<HTMLElement>("[data-act]");
    if (!el) return;
    const act = el.dataset["act"];
    if (dd && el.closest("#quadro")) {
      const id = el.dataset["id"] ?? "";
      if (act === "abrir-tarefa" && id) { abrirTarefa(id); return; }
      if (act === "voltar-ao-quadro") { voltarAoQuadro(); return; }
      if (act === "qd-reler") { carga = "nada"; void lerQuadro(); return; }
      if (act === "qc-desfazer" && id) { void desfazer(id); return; }
      if (act === "qc-historico") {
        histAberto = !histAberto;
        if (timerRecolher && histAberto) { clearTimeout(timerRecolher); timerRecolher = null; }
        desenharFaixa();
        doc.querySelector<HTMLElement>('#qc-faixa [data-act="qc-historico"]')?.focus();
        if (histAberto) void lerConversa();
        return;
      }
      if (act === "qc-abrir-conversa") { histAberto = false; desenharFaixa(); trocar("conversa", { foco: true }); return; }
    }
    if (act === "modo-da-conversa" && el.closest("#cabecalho")) {
      const m = el.dataset["modo"];
      if (ehModo(m)) trocar(m);
    } else if (el.closest("#quadro") && (act === "abrir-coluna" || act === "filtro-do-quadro")) {
      if (act === "filtro-do-quadro") {
        const f = el.dataset["filtro"];
        if (f === "todos" || f === "pessoas" || f === "agentes") filtro = f;
      } else {
        const st = el.dataset["status"];
        if (ehStatus(st)) { if (alternadas.has(st)) alternadas.delete(st); else alternadas.add(st); }
      }
      const sel = act === "abrir-coluna" ? `[data-act="abrir-coluna"][data-status="${CSS.escape(el.dataset["status"] ?? "")}"]` : `[data-act="filtro-do-quadro"][data-filtro="${filtro}"]`;
      const lugar = act === "filtro-do-quadro" ? ".qd-barra-q" : el.closest(".qd-so-estreito") ? ".qd-so-estreito" : ".qd-so-largo";
      desenharVista();
      vista()?.querySelector<HTMLElement>(`${lugar} ${sel}`)?.focus();
    }
  });

  // NOD-442: a pílula e a resposta do bloqueio. Enter envia na pílula (Shift+Enter quebra a linha); Esc na tarefa volta.
  doc.addEventListener("submit", (ev) => {
    const form = ev.target instanceof HTMLFormElement ? ev.target : null;
    if (!dd || !form?.closest("#quadro")) return;
    const qual = form.dataset["form"];
    if (qual !== "conversa-no-quadro" && qual !== "responder-tarefa") return;
    ev.preventDefault();
    if (qual === "conversa-no-quadro") void enviarPedido(form);
    else void responder(form);
  });
  doc.addEventListener("keydown", (ev) => {
    if (!dd) return;
    const el = ev.target as Element | null;
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing && el instanceof HTMLTextAreaElement && el.id === "qc-txt") {
      ev.preventDefault();
      el.form?.requestSubmit();
    } else if (ev.key === "Escape" && aberta && el?.closest?.("#quadro .qd-conteudo")) {
      ev.preventDefault();
      voltarAoQuadro();
    }
  });

  // O teclado do tablist (APG, ativação automática): ← → Home End trocam e levam o foco.
  doc.addEventListener("keydown", (ev) => {
    const el = (ev.target as Element | null)?.closest?.<HTMLElement>('#cabecalho .qd-seg [role="tab"]');
    if (!el || ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    const prox = modoPelaTecla(modo, ev.key);
    if (!prox) return;
    ev.preventDefault();
    trocar(prox, { foco: true });
  });

  const abaDe = (alvo: EventTarget | null): HTMLElement | null => (alvo as Element | null)?.closest?.<HTMLElement>('#cabecalho .qd-seg [role="tab"]') ?? null;
  doc.addEventListener("focusin", (ev) => {
    const el = abaDe(ev.target);
    const m = el?.dataset["modo"];
    abaFocada = el && ehModo(m) ? { el, modo: m } : null;
  });
  // A pessoa tirou o foco da aba com um clique ou toque fora dela (no vazio o foco cai no body, sem focusin): esquece.
  // Não dá para usar o focusout: o Chrome também o dispara quando a regravação tira o nó, e aí o foco tem de voltar.
  doc.addEventListener("pointerdown", (ev) => { if (!abaDe(ev.target)) abaFocada = null; }, true);

  /** A conexão voltou sem o replay (SSE resumed:false): relê o quadro e, com um pedido esperando, a conversa. */
  function reler(): void {
    if (!dd || chave === null || !agenteId) return;
    pedirReleitura();
    if (faixa.tipo === "aguardando" || histAberto) void lerConversa();
  }

  return { sincronizar, trocar, aoFrame, reler, modo: () => modo };
}
