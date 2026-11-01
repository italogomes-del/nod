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
import { direcaoDaTroca, ehModo, modoPelaTecla, movimentoDaTroca, type ModoDaConversa } from "./quadro.ts";
import { comColunas, fraseDoErroDeColuna, nomeRepetido, passoDeMover, porqueNaoRemove, saidaComErroDesiste, seletorDoFocoDaColuna, soltarEm, type EdicaoDeColuna, type Lado } from "./colunas.ts";
import { ErroApi } from "./erro-api.ts";
import type { GrupoColuna, QuadroDto } from "../../src/contracts/quadro.ts";
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
  /** NOD-448: as colunas (cada uma um lote com Desfazer). Opcionais: sem elas, o quadro não edita colunas. */
  criarColuna?(agenteId: string, c: { nome: string; grupo: GrupoColuna; depois_de?: string }): Promise<MutacaoQuadro>;
  renomearColuna?(agenteId: string, coluna: string, nome: string): Promise<MutacaoQuadro>;
  moverColuna?(agenteId: string, coluna: string, onde: { antes_de?: string; depois_de?: string }): Promise<MutacaoQuadro>;
  removerColuna?(agenteId: string, coluna: string, destino?: string): Promise<MutacaoQuadro>;
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
  let alternadas = new Set<string>();
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
  /** NOD-448: o pedaço da edição das colunas que está aberto (menu, renomear, remover, coluna nova, a folha do celular). */
  let edicao: EdicaoDeColuna | null = null;

  function zerarDados(): void {
    agenteId = null; q = null; carga = "nada"; aberta = null; acesas = new Set(); faixa = { tipo: "nada" }; loteAntes = null;
    historico = []; histAberto = false; leitura++; leituraConversa++; dica = []; edicao = null;
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
    return quadroDaMeta({ q, nome, agente: dd.agente, filtro, alternadas, acesas, edicao });
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
    // NOD-448: o nome que a pessoa digita numa coluna (renomear, nova) sobrevive ao frame que regrava o quadro.
    for (const c of conteudo.querySelectorAll<HTMLTextAreaElement | HTMLInputElement>("textarea[id], input.qd-col-in[id]")) if (c.value) rascunhos.set(c.id, c.value);
    const ativo = doc.activeElement;
    const focoId = ativo instanceof HTMLElement && conteudo.contains(ativo) && ativo.id ? ativo.id : null;
    const focoColuna = ativo instanceof HTMLElement && conteudo.contains(ativo) && !ativo.id ? seletorDoFocoDaColuna(ativo) : null;
    conteudo.innerHTML = conteudoHtml();
    if (focoColuna) conteudo.querySelector<HTMLElement>(focoColuna)?.focus();
    for (const [id, valor] of rascunhos) { const c = doc.getElementById(id); if (c instanceof HTMLTextAreaElement || c instanceof HTMLInputElement) c.value = valor; }
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
    if (novo) novo = comColunas(novo);
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

  /* ---------- NOD-448: as colunas pela tela ---------- */

  const colunaDe = (id: string | undefined) => (id ? q?.colunas.find((c) => c.id === id) ?? null : null);
  const tarefasNa = (id: string): number => q?.tarefas.filter((t) => t.status === id).length ?? 0;

  /** Abre (ou fecha) um pedaço da edição e leva o foco a ele. */
  function editar(ed: EdicaoDeColuna | null, foco?: string): void {
    edicao = ed;
    desenharVista();
    const v = vista();
    if (!v) return;
    if (foco) { v.querySelector<HTMLElement>(foco)?.focus(); return; }
    const alvo = ed?.tipo === "renomear" ? "#qd-col-in" : ed?.tipo === "nova" ? ".qd-col-nova-f input[name=nome]" : ed?.tipo === "remover" ? "#qd-col-destino"
      : ed?.tipo === "menu" ? '#qd-menu [role="menuitem"]:not([aria-disabled])' : ed?.tipo === "ordem" ? ".qd-folha-tit" : null;
    const el = alvo ? v.querySelector<HTMLElement>(alvo) : null;
    if (ed?.tipo === "ordem" && el) el.tabIndex = -1;
    el?.focus();
    if (el instanceof HTMLInputElement && ed?.tipo === "renomear") el.select();
  }

  /** Fecha o que está aberto; dentro da folha do celular, volta para a folha. */
  const fechar = (): void => {
    const volta = edicao && "naFolha" in edicao && edicao.naFolha ? ({ tipo: "ordem" } as const) : null;
    const col = edicao && "coluna" in edicao ? edicao.coluna : null;
    editar(volta, col && !volta ? `.qd-so-largo .qd-col-bt[data-coluna="${CSS.escape(col)}"]` : undefined);
  };

  /** Uma mudança de coluna: aplica o quadro que volta e diz o que mudou na faixa, com o Desfazer do lote. */
  async function mexer(fazer: (a: ApiDoQuadro, de: string) => Promise<MutacaoQuadro> | undefined, recibo: string, foco?: string, depois: EdicaoDeColuna | null = null, texto?: string): Promise<void> {
    const a = dd?.api();
    // Uma de cada vez: o Enter e a saída do campo não mandam o mesmo renomear duas vezes.
    if (!a || !agenteId || mexendo) return;
    const c = chave;
    const de = agenteId;
    mexendo = true;
    try {
      const p = fazer(a, de);
      if (!p) return;
      const r = await p;
      if (c !== chave || de !== agenteId) return;
      edicao = depois;
      aplicarQuadro(r.quadro);
      mudarFaixa({ tipo: "resposta", texto: recibo, loteId: r.lote && !r.lote.desfeitoEm ? r.lote.id : null, mensagemId: "" });
      if (foco) vista()?.querySelector<HTMLElement>(foco)?.focus();
    } catch (e) {
      if (c !== chave) return;
      const f = fraseDoErroDeColuna(e instanceof ErroApi ? e.codigo : null);
      // Recusado pelo dado (ou sem conexão): o campo fica aberto com o que foi digitado, e o porquê nele.
      const aberta = edicao;
      if (f.manter && texto !== undefined && aberta && (aberta.tipo === "renomear" || aberta.tipo === "nova")) {
        editar({ ...aberta, erro: f.texto });
        restaurar(texto);
        return;
      }
      edicao = depois;
      mudarFaixa({ tipo: "erro", texto: f.texto });
      if (!f.manter) void lerQuadro();
    } finally {
      mexendo = false;
    }
  }

  function moverColuna(id: string, lado: Lado, foco?: string): void {
    if (!q) return;
    const passo = passoDeMover(q.colunas, id, lado);
    const c = colunaDe(id);
    if (!c) return;
    if (!passo.ok) { mudarFaixa({ tipo: "erro", texto: passo.porque }); return; }
    const { ok: _ok, ...onde } = passo;
    void mexer((a, de) => a.moverColuna?.(de, id, onde), `${c.nome} mudou de lugar`, foco, naFolha() ? { tipo: "ordem" } : null);
  }

  function soltar(id: string, alvo: string): void {
    if (!q) return;
    const onde = soltarEm(q.colunas, id, alvo);
    const c = colunaDe(id);
    if (!onde || !c) return;
    void mexer((a, de) => a.moverColuna?.(de, id, onde), `${c.nome} mudou de lugar`, undefined, naFolha() ? { tipo: "ordem" } : null);
  }

  const naFolha = (): boolean => !!edicao && (edicao.tipo === "ordem" || ("naFolha" in edicao && !!edicao.naFolha));

  function pedirRemover(id: string, el: HTMLElement): void {
    const c = colunaDe(id);
    if (!c || !q) return;
    const porque = porqueNaoRemove(q.colunas, id, nome);
    if (porque) { mudarFaixa({ tipo: "erro", texto: porque }); return; }
    const folha = !!el.closest(".qd-folha");
    // Decisão 9 do Gil: a vazia sai na hora (com Desfazer); com tarefas, pergunta para onde elas vão.
    if (tarefasNa(id) === 0) { void mexer((a, de) => a.removerColuna?.(de, id), `${c.nome} removida`, undefined, folha ? { tipo: "ordem" } : null); return; }
    editar({ tipo: "remover", coluna: id, ...(folha ? { naFolha: true } : {}) });
  }

  function enviarColuna(form: HTMLFormElement): void {
    if (!q) return;
    const qual = form.dataset["form"];
    const folha = !!form.closest(".qd-folha");
    const depois: EdicaoDeColuna | null = folha ? { tipo: "ordem" } : null;
    const campo = form.querySelector<HTMLInputElement>("input[name=nome]");
    const texto = (campo?.value ?? "").trim().replace(/\s+/g, " ");
    if (qual === "col-renomear") {
      const id = form.dataset["coluna"] ?? "";
      const c = colunaDe(id);
      if (!c) { editar(depois); return; }
      if (!texto || texto === c.nome) { fechar(); return; }
      const outra = nomeRepetido(q.colunas, texto, id);
      if (outra) { editar({ tipo: "renomear", coluna: id, erro: `Já existe uma coluna ${outra.nome}`, ...(folha ? { naFolha: true } : {}) }); restaurar(texto); return; }
      void mexer((a, de) => a.renomearColuna?.(de, id, texto), `${c.nome} agora é ${texto}`, folha ? undefined : `.qd-so-largo .qd-col-bt[data-coluna="${CSS.escape(id)}"]`, depois, texto);
    } else if (qual === "col-nova") {
      const grupo = form.querySelector<HTMLInputElement>("input[name=grupo]:checked")?.value as GrupoColuna | undefined;
      const depoisDe = form.dataset["depois"];
      const base = { tipo: "nova" as const, ...(depoisDe ? { depoisDe } : {}), ...(grupo ? { grupo } : {}), ...(folha ? { naFolha: true } : {}) };
      if (!texto) return;
      if (!grupo) { editar({ ...base, erro: "Escolha o grupo da coluna" }); restaurar(texto); return; }
      const outra = nomeRepetido(q.colunas, texto);
      if (outra) { editar({ ...base, erro: `Já existe uma coluna ${outra.nome}` }); restaurar(texto); return; }
      const junto = depoisDe ? colunaDe(depoisDe) : null;
      const recibo = junto && junto.grupo === grupo && !junto.fixa ? `${texto} criada, junto de ${junto.nome}` : `${texto} criada`;
      void mexer((a, de) => a.criarColuna?.(de, { nome: texto, grupo, ...(junto && junto.grupo === grupo && !junto.fixa ? { depois_de: junto.id } : {}) }), recibo, undefined, depois, texto);
    } else if (qual === "col-remover") {
      const id = form.dataset["coluna"] ?? "";
      const c = colunaDe(id);
      const destino = form.querySelector<HTMLSelectElement>("select[name=destino]")?.value ?? "";
      const para = colunaDe(destino);
      if (!c || !para) return;
      const n = tarefasNa(id);
      void mexer((a, de) => a.removerColuna?.(de, id, destino), `${c.nome} removida · ${n === 1 ? "1 tarefa" : `${n} tarefas`} em ${para.nome}`, undefined, depois);
    }
  }

  /** Depois de regravar com o erro, o que a pessoa digitou volta ao campo. */
  function restaurar(texto: string): void {
    const c = vista()?.querySelector<HTMLInputElement>("#qd-col-in, .qd-col-nova-f input[name=nome]");
    if (c) { c.value = texto; c.focus(); }
  }

  /** O clique simples recolhe; o duplo renomeia (decisão 6). O simples espera um pouco para o duplo não recolher antes. */
  let timerClique: ReturnType<typeof setTimeout> | null = null;
  /** O arrasto de uma coluna (o cabeçalho no computador, a alça ≡ na folha): só dentro do grupo. */
  let arrasto: { id: string; x: number; y: number; ativo: boolean; alvo: HTMLElement | null; origem: HTMLElement | null } | null = null;
  let engolirClique = false;
  let mexendo = false;

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
      edicao = null;
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
    if (engolirClique) { engolirClique = false; ev.preventDefault(); ev.stopPropagation(); return; }
    // NOD-448: clicar fora do menu ou do popover fecha (a coluna nova e a folha fecham pelo Cancelar, Pronto ou Esc).
    if ((edicao?.tipo === "menu" || (edicao?.tipo === "remover" && !edicao.naFolha)) && alvo?.closest?.("#quadro") && !alvo.closest(".qd-menu, .qd-pop, .qd-col-mais")) { edicao = null; desenharVista(); }
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
      if (act?.startsWith("col-")) { aoClicarColuna(el, act); return; }
      // Clique simples no nome de uma coluna que edita: espera o duplo (que renomeia) antes de recolher.
      if (act === "abrir-coluna" && el.matches(".qd-col-bt[aria-keyshortcuts]") && ev.detail >= 1) {
        if (timerClique) clearTimeout(timerClique);
        if (ev.detail >= 2) { timerClique = null; editar({ tipo: "renomear", coluna: el.dataset["coluna"] ?? "" }); return; }
        timerClique = setTimeout(() => { timerClique = null; if (el.isConnected) alternarColuna(el); }, 260);
        return;
      }
    }
    if (act === "modo-da-conversa" && el.closest("#cabecalho")) {
      const m = el.dataset["modo"];
      if (ehModo(m)) trocar(m);
    } else if (el.closest("#quadro") && (act === "abrir-coluna" || act === "filtro-do-quadro")) {
      if (act === "filtro-do-quadro") {
        const f = el.dataset["filtro"];
        if (f === "todos" || f === "pessoas" || f === "agentes") filtro = f;
        desenharVista();
        vista()?.querySelector<HTMLElement>(`.qd-barra-q [data-act="filtro-do-quadro"][data-filtro="${filtro}"]`)?.focus();
      } else alternarColuna(el);
    }
  });

  function alternarColuna(el: HTMLElement): void {
    const st = el.dataset["status"];
    if (st) { if (alternadas.has(st)) alternadas.delete(st); else alternadas.add(st); }
    const lugar = el.closest(".qd-so-estreito") ? ".qd-so-estreito" : ".qd-so-largo";
    if (edicao?.tipo === "menu") edicao = null;
    desenharVista();
    vista()?.querySelector<HTMLElement>(`${lugar} [data-act="abrir-coluna"][data-status="${CSS.escape(st ?? "")}"]`)?.focus();
  }

  function aoClicarColuna(el: HTMLElement, act: string): void {
    const id = el.dataset["coluna"] ?? "";
    const folha = !!el.closest(".qd-folha");
    const desabilitado = el.getAttribute("aria-disabled") === "true";
    if (desabilitado) { const porque = el.getAttribute("title"); if (porque) mudarFaixa({ tipo: "erro", texto: porque }); return; }
    if (act === "col-menu") { editar(edicao?.tipo === "menu" && edicao.coluna === id ? null : { tipo: "menu", coluna: id }); return; }
    if (act === "col-renomear") { editar({ tipo: "renomear", coluna: id, ...(folha ? { naFolha: true } : {}) }); return; }
    if (act === "col-esquerda" || act === "col-direita") {
      const foco = folha ? `.qd-folha [data-act="${act}"][data-coluna="${CSS.escape(id)}"]` : `.qd-so-largo .qd-col-bt[data-coluna="${CSS.escape(id)}"]`;
      moverColuna(id, act === "col-esquerda" ? "esquerda" : "direita", foco);
      return;
    }
    if (act === "col-nova") {
      const c = colunaDe(id);
      editar({ tipo: "nova", ...(c && !c.fixa ? { depoisDe: c.id } : {}), ...(c ? { grupo: c.grupo } : {}), ...(folha ? { naFolha: true } : {}) });
      return;
    }
    if (act === "col-remover") { pedirRemover(id, el); return; }
    if (act === "col-fechar") { fechar(); return; }
    if (act === "col-folha") { editar({ tipo: "ordem" }); return; }
    if (act === "col-fechar-folha") { editar(null, '.qd-so-estreito [data-act="col-folha"]'); return; }
  }

  // NOD-442: a pílula e a resposta do bloqueio. Enter envia na pílula (Shift+Enter quebra a linha); Esc na tarefa volta.
  doc.addEventListener("submit", (ev) => {
    const form = ev.target instanceof HTMLFormElement ? ev.target : null;
    if (!dd || !form?.closest("#quadro")) return;
    const qual = form.dataset["form"];
    if (qual === "col-renomear" || qual === "col-nova" || qual === "col-remover") { ev.preventDefault(); enviarColuna(form); return; }
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
    } else if (ev.key === "Escape" && edicao && el?.closest?.("#quadro .qd-conteudo")) {
      ev.preventDefault();
      if (edicao.tipo === "ordem") editar(null, '.qd-so-estreito [data-act="col-folha"]');
      else fechar();
    } else if (ev.key === "Escape" && aberta && el?.closest?.("#quadro .qd-conteudo")) {
      ev.preventDefault();
      voltarAoQuadro();
    } else if (el instanceof HTMLElement && el.matches("#quadro .qd-so-largo .qd-col-bt[aria-keyshortcuts]")) {
      // Decisão 6: F2 renomeia; Alt ← → move dentro do grupo.
      const id = el.dataset["coluna"] ?? "";
      if (ev.key === "F2") { ev.preventDefault(); editar({ tipo: "renomear", coluna: id }); }
      else if (ev.altKey && (ev.key === "ArrowLeft" || ev.key === "ArrowRight")) {
        ev.preventDefault();
        moverColuna(id, ev.key === "ArrowLeft" ? "esquerda" : "direita", `.qd-so-largo .qd-col-bt[data-coluna="${CSS.escape(id)}"]`);
      }
    } else if (el instanceof HTMLElement && el.matches('#qd-menu [role="menuitem"]') && (ev.key === "ArrowDown" || ev.key === "ArrowUp" || ev.key === "Home" || ev.key === "End")) {
      ev.preventDefault();
      const itens = [...(el.parentElement?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
      const i = itens.indexOf(el);
      const j = ev.key === "Home" ? 0 : ev.key === "End" ? itens.length - 1 : (i + (ev.key === "ArrowDown" ? 1 : -1) + itens.length) % itens.length;
      itens[j]?.focus();
    }
  });

  // NOD-448: renomear grava ao sair do campo (Esc desiste antes: a edição já fechou quando o campo sai).
  doc.addEventListener("focusout", (ev) => {
    const el = ev.target;
    if (!(el instanceof HTMLInputElement) || el.id !== "qd-col-in" || edicao?.tipo !== "renomear") return;
    const form = el.form;
    if (!form?.isConnected) return;
    // O foco foi para outro lugar do próprio formulário (nada além do campo): deixa.
    if (ev.relatedTarget instanceof Node && form.contains(ev.relatedTarget)) return;
    // Com o erro na tela, sair do campo sem corrigir desiste (não prende a pessoa nele); corrigido, grava (revisão do PR #615).
    if (edicao.erro && saidaComErroDesiste(q?.colunas ?? [], edicao.coluna, el.value)) { fechar(); return; }
    enviarColuna(form);
  });

  // NOD-448: arrastar a coluna (o cabeçalho, ou a alça ≡ na folha do celular), só dentro do grupo.
  doc.addEventListener("pointerdown", (ev) => {
    const el = (ev.target as Element | null)?.closest?.<HTMLElement>("#quadro [data-arrasta][data-coluna]");
    if (!el || ev.button !== 0 || !q) return;
    arrasto = { id: el.dataset["coluna"] ?? "", x: ev.clientX, y: ev.clientY, ativo: false, alvo: null, origem: el.closest<HTMLElement>("section[data-coluna], li[data-coluna]") };
    if (el.classList.contains("qd-alca")) { ev.preventDefault(); el.setPointerCapture?.(ev.pointerId); }
  });
  doc.addEventListener("pointermove", (ev) => {
    if (!arrasto || !q) return;
    if (!arrasto.ativo && Math.hypot(ev.clientX - arrasto.x, ev.clientY - arrasto.y) < 6) return;
    arrasto.ativo = true;
    arrasto.origem?.classList.add("qd-arrastando");
    const sob = doc.elementFromPoint?.(ev.clientX, ev.clientY)?.closest?.<HTMLElement>("#quadro section[data-coluna], #quadro li[data-coluna][data-grupo]") ?? null;
    const valido = sob && soltarEm(q.colunas, arrasto.id, sob.dataset["coluna"] ?? "") ? sob : null;
    if (valido !== arrasto.alvo) { arrasto.alvo?.classList.remove("qd-alvo"); valido?.classList.add("qd-alvo"); arrasto.alvo = valido; }
  });
  const fimDoArrasto = (soltou: boolean): void => {
    const a = arrasto;
    arrasto = null;
    if (!a?.ativo) return;
    a.origem?.classList.remove("qd-arrastando");
    a.alvo?.classList.remove("qd-alvo");
    // O pointerup vira um click no cabeçalho: ele não recolhe a coluna que acabou de ser arrastada.
    engolirClique = true;
    setTimeout(() => { engolirClique = false; }, 0);
    if (soltou && a.alvo) soltar(a.id, a.alvo.dataset["coluna"] ?? "");
  };
  doc.addEventListener("pointerup", () => fimDoArrasto(true));
  doc.addEventListener("pointercancel", () => fimDoArrasto(false));

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
