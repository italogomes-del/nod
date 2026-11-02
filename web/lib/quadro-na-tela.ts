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
import { comColunas, fraseDoErroDeColuna, nomeRepetido, passoDeMover, pedeConfirmacao, porqueNaoRecebeCard, porqueNaoRemove, reciboDeMover, saidaComErroDesiste, seletorDoFocoDaColuna, soltarEm, type EdicaoDeColuna, type Lado } from "./colunas.ts";
import { ErroApi } from "./erro-api.ts";
import { anunciarEm } from "./posicao-da-lista.ts";
import type { EntradaHistoricoDto, GrupoColuna, QuadroDaPessoaDto, QuadroDto, TarefaDto } from "../../src/contracts/quadro.ts";
import type { ConversaDto, RespostaMutacao } from "../../src/contracts/api.ts";
import type { MutacaoQuadro } from "./api.ts";
import { RESP_VOCE, acesos, fraseDoErroDoMover, reciboDaNovaTarefa, codigoNaUrl, destinosDaTarefa, historicoDaFaixa, respostaDoBot, tarefaNoQuadro, type Faixa } from "./quadro-dados.ts";
import { quadroVazio, type Filtro, type Html } from "../telas/quadro.ts";
import { faixaDoQuadro, pilulaDoQuadro, quadroCarregando, quadroComErro, quadroDaMeta, semQuadro, tarefaAberta, type AgenteDoQuadro, type TrocaDaFaixa } from "../telas/quadro-real.ts";
import { criarComentariosNaTela, type ApiDosComentarios } from "./comentarios-na-tela.ts";
import { criarTrabalhosDaTarefa, type ApiDosTrabalhos } from "./trabalhos-da-tarefa.ts";

/** O pedaço da API que o quadro usa (NOD-442); null = sem sessão ainda. */
export interface ApiDoQuadro extends ApiDosComentarios, ApiDosTrabalhos {
  quadro(agenteId: string): Promise<{ quadro: QuadroDto | null }>;
  conversa(conversaId: string): Promise<Pick<ConversaDto, "mensagens">>;
  enviar(conversaId: string, texto: string, anexos?: readonly string[], idEnvio?: string): Promise<RespostaMutacao>;
  responderTarefa(agenteId: string, tarefaId: string, resposta: string): Promise<MutacaoQuadro>;
  desfazerLoteQuadro(agenteId: string, loteId: string): Promise<MutacaoQuadro>;
  /** NOD-415 (ADR-141): criar o quadro e mudar a meta e o prazo pela tela (meta null tira). */
  criarQuadro(agenteId: string, campos: { meta?: string | null; prazo?: string | null }): Promise<MutacaoQuadro>;
  editarQuadro(agenteId: string, campos: { meta?: string | null; prazo?: string | null }): Promise<MutacaoQuadro>;
  /** Voltar a agente comum: apaga o quadro (sem Desfazer); a conversa e a memória ficam. */
  removerQuadro(agenteId: string): Promise<MutacaoQuadro>;
  /** NOD-448: as colunas (cada uma um lote com Desfazer). Opcionais: sem elas, o quadro não edita colunas. */
  criarColuna?(agenteId: string, c: { nome: string; grupo: GrupoColuna; depois_de?: string }): Promise<MutacaoQuadro>;
  renomearColuna?(agenteId: string, coluna: string, nome: string): Promise<MutacaoQuadro>;
  moverColuna?(agenteId: string, coluna: string, onde: { antes_de?: string; depois_de?: string }): Promise<MutacaoQuadro>;
  removerColuna?(agenteId: string, coluna: string, destino?: string): Promise<MutacaoQuadro>;
  /** ADR-142: a passagem da coluna e o card arrastado (o mesmo mudar_tarefa; `sem_iniciar` = "Não iniciar ainda"). */
  definirPassagem?(agenteId: string, coluna: string, p: { agente: string | null; instrucoes: string | null }): Promise<MutacaoQuadro>;
  /** NOD-416 (ADR-144): criar (cai no Backlog), mudar status e responsável, mudar de quadro, o histórico e os quadros. */
  criarTarefa?(agenteId: string, campos: { titulo: string }): Promise<MutacaoQuadro>;
  mudarTarefa?(agenteId: string, tarefaId: string, campos: { status?: string; agente?: string | null; sem_iniciar?: boolean }): Promise<MutacaoQuadro>;
  moverTarefa?(agenteId: string, tarefaId: string, quadro: string): Promise<MutacaoQuadro & { movida?: { codigo: string; codigoAntigo: string } }>;
  historicoTarefa?(agenteId: string, tarefaId: string): Promise<{ historico: EntradaHistoricoDto[] }>;
  quadros?(): Promise<{ quadros: QuadroDaPessoaDto[] }>;
}

/** NOD-442: o que o quadro de verdade precisa do main. Sem isto (os testes da NOD-429), a vista é o quadro vazio. */
export interface DadosDoQuadro {
  api: () => ApiDoQuadro | null;
  agente: AgenteDoQuadro;
  /**
   * Os bots da pessoa: os que podem receber a passagem de uma coluna (ADR-142; sem isto, o cabeçalho não mostra a passagem)
   * e os que podem ser o Responsável da tarefa aberta (NOD-416; sem isto, ele fica só leitura).
   */
  agentes?: () => readonly { id: string; nome: string }[];
  hora: (em: number) => string;
  /** Quanto a faixa fica à vista depois da resposta (ms). */
  recolherEm?: number;
  /** A janela que junta frames em rajada numa releitura só (ms). */
  juntarEm?: number;
  /** NOD-415: a confirmação antes de remover o quadro (padrão: window.confirm). */
  confirmar?: (texto: string) => boolean;
  /** NOD-416: o código da tarefa aberta vai para a URL (`?tarefa=ZE-12`); null = voltou ao quadro. */
  naUrl?: (codigo: string | null) => void;
  /**
   * QA do PR #623 (D4): depois de mover, leva à conversa do bot destino e abre a tarefa lá (o mesmo caminho do link).
   * false = o bot não está à mão (fica no quadro de origem, com o aviso).
   */
  irParaTarefa?: (agenteId: string, tarefaId: string) => boolean;
}

/** Os pedaços do palco que são "a conversa": saem juntos quando o Quadro entra. */
export const LADO_DA_CONVERSA = ["timeline", "pilula-novas", "faixa-trabalhos", "composer"] as const;


export interface QuadroNaTela {
  /**
   * Depois de cada desenho: `chave` é a conversa à vista com o quadro liberado, ou null (outra tela, flag desligada).
   * `agenteId` com `chave` null: a conversa desse bot está na tela, mas ele não tem quadro.
   */
  sincronizar(o: { chave: string | null; nome: string; agenteId?: string | null }): void;
  /** NOD-442: cada frame do SSE. `quadro.mudou` relê o quadro (os cards que mudaram acendem); a fala do bot sobe na faixa. */
  aoFrame(frame: { tipo: string; dados: Record<string, unknown> }): void;
  trocar(para: ModoDaConversa, o?: { foco?: boolean }): void;
  /** A conexão voltou sem o replay: relê o quadro (e a conversa, com um pedido esperando). */
  reler(): void;
  /** NOD-430: o código da tarefa num chat — abre a tarefa no quadro de `agenteId` quando a conversa dele estiver na tela. */
  abrirTarefaDe(agenteId: string, tarefaId: string): void;
  modo(): ModoDaConversa;
  /**
   * NOD-416: o link `?tarefa=`: abre a tarefa deste bot (a conversa dele já à vista) assim que o quadro chegar; o modo vira
   * Quadro. Antes de o quadro ser liberado (as preferências ainda não chegaram), o pedido espera o próximo `sincronizar`.
   */
  abrirTarefa(agenteId: string, tarefaId: string): void;
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
  /** NOD-415: a meta no topo virou campo (Enter salva, Esc desiste). */
  let editandoMeta = false;
  /** NOD-448: o pedaço da edição das colunas que está aberto (menu, renomear, remover, coluna nova, a folha do celular). */
  let edicao: EdicaoDeColuna | null = null;
  /** NOD-416: o histórico da tarefa aberta (null = carregando), os quadros do "Mover para…" e o link que espera o quadro. */
  let histTarefa: EntradaHistoricoDto[] | null = null;
  let quadros: QuadroDaPessoaDto[] | null = null;
  let leituraHist = 0;
  let pendente: { agenteId: string; tarefaId: string } | null = null;
  /** QA do PR #623 (D4): o aviso do mover, dito no quadro destino quando a tarefa movida abre lá. */
  let avisoDoMover: string | null = null;
  /** Revisão 7 do PR #623: a coluna com responsável escolhida no Status da tarefa aberta, esperando "Confirmar · Não iniciar ainda". */
  let soltarNaAberta: { tarefa: string; coluna: string } | null = null;
  /** O quadro escolhido no "Mover para…" da tarefa aberta: um redesenho (o histórico, os comentários) não o apaga. */
  let moverPara: string | null = null;
  /** NOD-430: a tarefa pedida pelo código num chat (`nod-tarefa:`): abre quando a conversa do dono dela estiver na tela. */
  let pedidoDoChat: { agenteId: string; tarefaId: string } | null = null;
  /** NOD-417: os comentários da tarefa aberta. */
  const coms = criarComentariosNaTela({ api: () => dd?.api() ?? null, redesenhar: () => { if (aberta) desenharVista(); } });
  /** NOD-418: o trabalho da tarefa aberta (o atual ao vivo, os anteriores, Repetir, Cancelar e o recado). */
  const trabs = criarTrabalhosDaTarefa({
    api: () => dd?.api() ?? null,
    redesenhar: () => { if (aberta) desenharVista(); },
    log: () => vista()?.querySelector<HTMLElement>(".qd-trab-log") ?? null,
    // Revisão 5 do PR #625: a região de status fica fora da .qd-conteudo (que o desenho recria): o mesmo nó, só o texto muda.
    anuncio: () => vista()?.querySelector<HTMLElement>(":scope > #qd-trab-anuncio") ?? null,
    aplicarQuadro: (novo) => aplicarQuadro(novo, aberta ? [aberta] : []),
    ...(dd?.juntarEm !== undefined ? { juntarEm: dd.juntarEm } : {}),
  });

  function zerarDados(): void {
    if (aberta) dd?.naUrl?.(null);
    histTarefa = null; quadros = null; leituraHist++;
    agenteId = null; q = null; carga = "nada"; aberta = null; acesas = new Set(); faixa = { tipo: "nada" }; loteAntes = null;
    historico = []; histAberto = false; leitura++; leituraConversa++; dica = []; editandoMeta = false; edicao = null; soltarNaAberta = null; coms.fechar(); trabs.fechar();
    if (timerReler) clearTimeout(timerReler);
    if (timerRecolher) clearTimeout(timerRecolher);
    timerReler = timerRecolher = null;
  }

  function conteudoHtml(): Html | string {
    if (!dd) return quadroVazio({ nome, filtro, alternadas });
    if (carga === "nada" || carga === "carregando") return quadroCarregando();
    if (carga === "erro") return quadroComErro();
    if (!q) return semQuadro(nome, Date.now());
    const t = tarefaNoQuadro(q, aberta);
    if (t) {
      const trabalhos = trabs.html(t.id, { bloqueada: t.status === "bloqueado" || (t.status === "voce" && t.voltarPara !== null && t.voltarPara !== t.status), agenteId: t.agenteId, conversaAtual: chave, hora: dd.hora });
      const resp = dd.agentes?.();
      const soltar = soltarNaAberta?.tarefa === t.id ? { soltar: soltarNaAberta.coluna } : {};
      return tarefaAberta({ t, q, agente: dd.agente, comentarios: coms.html(t.id, dd.agente, dd.hora), historico: dd.api()?.historicoTarefa ? histTarefa : undefined, ...(resp ? { responsaveis: resp } : {}), ...(quadros ? { destinos: destinosDaTarefa(quadros, q.id), moverPara } : {}), ...soltar, ...(trabalhos !== undefined ? { trabalhos } : {}) });
    }
    const agentes = dd.agentes && dd.api()?.definirPassagem ? dd.agentes() : undefined;
    return quadroDaMeta({ q, nome, agente: dd.agente, filtro, alternadas, acesas, edicao, agora: Date.now(), editandoMeta, ...(agentes ? { agentes } : {}) });
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
      // Merge da main (#623): a região do quadro (rodapé) vem primeiro; a do trabalho (NOD-418) depois, as duas fora da .qd-conteudo.
      v.innerHTML = `<div class="qd-conteudo"></div><footer class="qc-wrap">${pilulaDoQuadro({ meta: q?.meta ?? null, nome })}<p class="qd-sr qd-anuncio" role="status" aria-live="polite"></p></footer><p class="qd-sr" id="qd-trab-anuncio" role="status" aria-atomic="true"></p>`;
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
    const rot = q?.meta ? `Conversar com o quadro ${q.meta}` : `Conversar com ${nome} sobre o quadro`;
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
    if (aberta && !tarefaNoQuadro(q, aberta)) { aberta = null; dd?.naUrl?.(null); }
    // NOD-416: o link `?tarefa=` esperava este quadro.
    let linkSemTarefa = false;
    let avisoSemTarefa: string | null = null;
    if (pendente && pendente.agenteId === agenteId) {
      const id = pendente.tarefaId;
      pendente = null;
      const aviso = avisoDoMover;
      avisoDoMover = null;
      if (tarefaNoQuadro(q, id)) {
        abrirTarefa(id);
        if (aviso) { mudarFaixa({ tipo: "resposta", texto: aviso, loteId: null, mensagemId: "" }); anunciar(aviso); }
        return;
      }
      linkSemTarefa = true;
      avisoSemTarefa = aviso;
    }
    if (aberta && novas.has(aberta)) void lerHistorico();
    desenharVista();
    // Revisão 7 do PR #623: a tarefa do link saiu deste quadro entre a busca do código e a leitura (mudou, foi apagada).
    // O quadro abre e o leitor de tela ouve por que a tarefa não abriu, em vez de silêncio.
    // Revisão 8 do PR #623: se foi um mover que trouxe a pessoa até aqui (e a tarefa já saiu de novo, numa corrida), o
    // aviso do mover também é dito e fica na faixa: ela sabe que o mover deu certo e por que a tarefa não abriu.
    if (avisoSemTarefa) mudarFaixa({ tipo: "resposta", texto: avisoSemTarefa, loteId: null, mensagemId: "" });
    if (linkSemTarefa) anunciar(avisoSemTarefa ? `${avisoSemTarefa}. Tarefa não encontrada neste quadro.` : "Tarefa não encontrada neste quadro.");
  }

  /** NOD-416: o histórico da tarefa aberta (relido quando ela muda). Leitura velha (outra tarefa) é descartada. */
  async function lerHistorico(): Promise<void> {
    const a = dd?.api();
    if (!a?.historicoTarefa || !agenteId || !aberta) return;
    const minha = ++leituraHist;
    const de = agenteId;
    const id = aberta;
    try {
      const r = await a.historicoTarefa(de, id);
      if (minha !== leituraHist || de !== agenteId || id !== aberta) return;
      histTarefa = r.historico;
    } catch {
      if (minha !== leituraHist) return;
      histTarefa = [];
    }
    desenharVista();
  }

  /** Os quadros da pessoa, uma vez por conversa (o "Mover para…" só aparece com outro quadro). */
  async function lerQuadros(): Promise<void> {
    const a = dd?.api();
    if (!a?.quadros || quadros) return;
    const c = chave;
    try {
      const r = await a.quadros();
      if (c !== chave) return;
      quadros = r.quadros;
      if (aberta) desenharVista();
    } catch { /* sem a lista, o campo não aparece */ }
  }

  /** NOD-416: uma mudança na tarefa (criar, status, responsável): o lote volta com Desfazer, na faixa. */
  async function mudarTarefa(fazer: (a: ApiDoQuadro, de: string) => Promise<MutacaoQuadro> | undefined, recibo: string | ((r: MutacaoQuadro) => string)): Promise<boolean> {
    const a = dd?.api();
    // Revisão 5 do PR #623: a mudança descartada (outra no ar) redesenha a tarefa, para o select não mostrar o que não valeu.
    if (!a || !agenteId || mexendo) { desenharVista(); return false; }
    const c = chave;
    const de = agenteId;
    mexendo = true;
    try {
      const p = fazer(a, de);
      if (!p) { desenharVista(); return false; }
      const r = await p;
      if (c !== chave || de !== agenteId) return false;
      aplicarQuadro(r.quadro);
      mudarFaixa({ tipo: "resposta", texto: typeof recibo === "string" ? recibo : recibo(r), loteId: r.lote && !r.lote.desfeitoEm ? r.lote.id : null, mensagemId: "" });
      return true;
    } catch (e) {
      if (c !== chave) return false;
      const semRede = e instanceof ErroApi && (e.codigo === "servidor_indisponivel" || e.codigo === "sem_internet");
      mudarFaixa({ tipo: "erro", texto: semRede ? "Sem conexão com o servidor agora. Tente de novo em instantes." : "Não deu para mudar a tarefa: o quadro mudou. Relendo." });
      if (!semRede) void lerQuadro();
      else desenharVista();
      return false;
    } finally {
      mexendo = false;
    }
  }

  /**
   * Revisão do PR #623: o ponto ÚNICO por onde o Status e o Responsável da tarefa aberta mudam. Pôr A fazer, ou escolher
   * um responsável numa tarefa em A fazer, faz o bot começar: aí o recibo diz "<Agente> começou", com o Desfazer do lote
   * (que para o turno). Nos outros casos, o recibo de sempre. Revisão 7 do PR #623 (o merge com o PR #622, NOD-417): o
   * Status numa coluna com responsável que aciona (`pedeConfirmacao`) mostra antes o "Confirmar · Não iniciar ainda" do
   * card solto; `semIniciar` (o "Não iniciar ainda") muda e passa sem acionar, como no quadro.
   */
  function mudarNaTarefaAberta(t: TarefaDto, campos: { status: string } | { agente: string | null }, confirmado: { semIniciar: boolean } | null = null): void {
    const ehStatus = "status" in campos;
    const col = ehStatus ? colunaDe(campos.status) : undefined;
    if (ehStatus && col && pedeConfirmacao(col) && !confirmado) {
      soltarNaAberta = { tarefa: t.id, coluna: col.id };
      desenharVista();
      doc.querySelector<HTMLElement>('#quadro .qd-t-soltar [data-act="col-soltar"]')?.focus();
      return;
    }
    soltarNaAberta = null;
    const semIniciar = confirmado?.semIniciar === true;
    const recibo = ehStatus
      ? (col?.responsavel ? reciboDeMover(t.titulo, col, semIniciar) : `${t.titulo}: ${col?.nome ?? campos.status}`)
      : `${t.titulo}: com ${campos.agente ? (dd?.agente(campos.agente)?.nome ?? "outro bot") : "ninguém"}`;
    const comecou = (r: MutacaoQuadro): string => {
      const nomes = [...new Set((r.comecaram ?? []).map((c) => c.agenteNome))];
      return nomes.length ? `${nomes.join(" e ")} ${nomes.length === 1 ? "começou" : "começaram"}` : recibo;
    };
    const foco = ehStatus ? "qd-t-status" : "qd-t-resp";
    const envio = semIniciar ? { ...campos, sem_iniciar: true } : campos;
    void mudarTarefa((a, de) => a.mudarTarefa?.(de, t.id, envio), comecou).then((ok) => { if (ok) doc.getElementById(foco)?.focus(); });
  }

  /** Revisão 7 do PR #623: desiste da confirmação do Status (Esc, clique fora): o select volta à coluna de agora. */
  function desistirDoSoltarNaAberta(): void {
    soltarNaAberta = null;
    desenharVista();
    doc.getElementById("qd-t-status")?.focus();
  }

  /**
   * Status e Responsável (revisão do PR #623, WCAG 3.2.2): o que o teclado escolhe fica pendente e só vale no Enter ou ao
   * sair do campo; a escolha com o mouse (o popup do select) vale na hora.
   */
  function aplicarCampoDaTarefa(el: HTMLSelectElement): void {
    delete el.dataset["teclado"];
    const t = tarefaNoQuadro(q, el.dataset["id"] ?? "");
    if (!t) return;
    if (el.dataset["campo"] === "status") {
      if (el.value !== t.status) mudarNaTarefaAberta(t, { status: el.value });
    } else {
      if (el.value === RESP_VOCE) return; // "Você" (Precisa de você) não é bot: nada a mudar.
      const novo = el.value || null;
      if (novo !== t.agenteId) mudarNaTarefaAberta(t, { agente: novo });
    }
  }
  const ehCampoDaTarefa = (el: unknown): el is HTMLSelectElement =>
    el instanceof HTMLSelectElement && !!el.closest("#quadro .qd-conteudo") && (el.dataset["campo"] === "status" || el.dataset["campo"] === "agente");

  /**
   * NOD-416: a tarefa vai para o quadro de outro bot. Não tem lote nem Desfazer e ninguém começa. A pessoa escolhe o
   * quadro e confirma no botão Mover (revisão do PR #623). Este quadro é relido (a tarefa sai dele) e a faixa diz o
   * código novo.
   */
  async function moverDeQuadro(tarefaId: string, destino: string): Promise<void> {
    const a = dd?.api();
    const t = tarefaNoQuadro(q, tarefaId);
    const alvo = quadros?.find((x) => x.id === destino);
    if (!a?.moverTarefa || !agenteId || !t || !alvo || mexendo) return;
    const c = chave;
    const de = agenteId;
    mexendo = true;
    try {
      const r = await a.moverTarefa(de, tarefaId, destino);
      if (c !== chave || de !== agenteId) return;
      aberta = null;
      dd?.naUrl?.(null);
      const texto = `${t.titulo} foi para o quadro de ${alvo.agenteNome}${r.movida ? ` como ${r.movida.codigo} (${r.movida.codigoAntigo} continua abrindo)` : ""}`;
      // QA do PR #623 (D4): a pessoa vai junto com a tarefa, aberta no quadro destino; o aviso é dito lá.
      avisoDoMover = texto;
      if (dd?.irParaTarefa?.(alvo.agenteId, tarefaId)) return;
      avisoDoMover = null;
      mudarFaixa({ tipo: "resposta", texto, loteId: null, mensagemId: "" });
      await lerQuadro();
      if (c !== chave || de !== agenteId || aberta) return;
      // Revisão 5 do PR #623 (a11y): o select que tinha o foco sumiu com a tarefa. O foco vai para o quadro (o primeiro
      // card à vista, ou o quadro inteiro, vazio) e o leitor de tela ouve para onde ela foi.
      focarNoQuadro();
      anunciar(texto);
    } catch (e) {
      if (c !== chave) return;
      // Revisão 2 do PR #623: no 4xx, o porquê do servidor (o motivo da lista branca ou a frase dele), não um genérico.
      const f = fraseDoErroDoMover(e instanceof ErroApi ? e : null);
      mudarFaixa({ tipo: "erro", texto: f.texto });
      if (f.reler) void lerQuadro();
    } finally {
      mexendo = false;
    }
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

  /**
   * NOD-415 (ADR-141): criar o quadro e mudar a meta ou o prazo pela tela. A resposta sobe na faixa com o Desfazer do lote
   * (o mesmo lote do gerir_quadro). Trocar de bot no meio: a resposta de um não entra na tela do outro.
   */
  async function mexerNoQuadro(tipo: "criar" | "editar", campos: { meta?: string | null; prazo?: string | null }): Promise<void> {
    const a = dd?.api();
    if (!a || !agenteId) return;
    const c = chave;
    const de = agenteId;
    try {
      const r = tipo === "criar" ? await a.criarQuadro(de, campos) : await a.editarQuadro(de, campos);
      if (c !== chave || de !== agenteId) return;
      const ok = (r as { ok?: boolean }).ok !== false;
      if (!ok) throw new Error("recusado");
      editandoMeta = false;
      aplicarQuadro(r.quadro);
      const texto = tipo === "criar" ? "Quadro criado." : campos.meta !== undefined ? (campos.meta ? "Meta trocada." : "Meta tirada: fluxo contínuo.") : campos.prazo ? "Prazo trocado." : "Prazo tirado.";
      mudarFaixa({ tipo: "resposta", texto, loteId: r.lote?.id ?? null, mensagemId: "" });
      if (tipo === "editar" && campos.meta !== undefined) vista()?.querySelector<HTMLElement>('.qd-conteudo [data-act="editar-meta"]')?.focus();
    } catch {
      if (c !== chave) return;
      mudarFaixa({ tipo: "erro", texto: tipo === "criar" ? "Não consegui criar o quadro." : "Não consegui mudar o quadro." });
    }
  }

  /** NOD-415 (ADR-141): voltar a agente comum. Confirma antes (não tem Desfazer); depois, a vista mostra o "criar quadro". */
  async function removerQuadro(): Promise<void> {
    const a = dd?.api();
    if (!a || !agenteId || !q) return;
    const confirmar = dd?.confirmar ?? ((t: string) => doc.defaultView?.confirm(t) ?? false);
    if (!confirmar(`Remover o quadro de ${nome}? As tarefas e o histórico do quadro somem e não dá para desfazer. A conversa e a memória de ${nome} ficam.`)) return;
    const c = chave;
    const de = agenteId;
    try {
      const r = await a.removerQuadro(de);
      if (c !== chave || de !== agenteId) return;
      if ((r as { ok?: boolean }).ok === false) throw new Error("recusado");
      editandoMeta = false;
      aplicarQuadro(null);
      mudarFaixa({ tipo: "resposta", texto: `Quadro removido: ${nome} voltou a ser um bot comum.`, loteId: null, mensagemId: "" });
    } catch {
      if (c !== chave) return;
      mudarFaixa({ tipo: "erro", texto: "Não consegui remover o quadro." });
    }
  }

  function editarMeta(sim: boolean): void {
    editandoMeta = sim;
    desenharVista();
    const alvo = vista()?.querySelector<HTMLElement>(sim ? "#qd-meta-in" : '.qd-conteudo [data-act="editar-meta"]');
    alvo?.focus();
    if (sim && alvo instanceof HTMLInputElement) alvo.select();
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
    if (foco) { visivel(v, foco)?.focus(); return; }
    const alvo = ed?.tipo === "renomear" ? "#qd-col-in" : ed?.tipo === "nova" ? ".qd-col-nova-f input[name=nome]" : ed?.tipo === "remover" ? "#qd-col-destino"
      : ed?.tipo === "menu" || ed?.tipo === "mover" ? '#qd-menu [role="menuitem"]:not([aria-disabled])' : ed?.tipo === "ordem" ? ".qd-folha-tit"
      : ed?.tipo === "passagem" ? ".qd-pop-passa input[name=modo]:checked" : ed?.tipo === "soltar" ? '.qd-soltar [data-act="col-soltar"]' : null;
    const el = alvo ? visivel(v, alvo) : null;
    if (ed?.tipo === "ordem" && el) el.tabIndex = -1;
    el?.focus();
    if (el instanceof HTMLInputElement && ed?.tipo === "renomear") el.select();
  }

  /**
   * O primeiro que está na tela: a grade e a lista do celular são desenhadas juntas (uma some pelo CSS), e a confirmação
   * do card solto e o "Mover para…" existem nas duas.
   */
  const visivel = (v: ParentNode, sel: string): HTMLElement | null => {
    const els = [...v.querySelectorAll<HTMLElement>(sel)];
    return els.find((x) => x.getClientRects().length > 0) ?? els[0] ?? null;
  };

  /** Fecha o que está aberto; dentro da folha do celular, volta para a folha. O card que se movia leva o foco de volta. */
  const fechar = (): void => {
    if (edicao?.tipo === "soltar" || edicao?.tipo === "mover") {
      const t = CSS.escape(edicao.tarefa);
      editar(null, `[data-act="tarefa-mover"][data-tarefa="${t}"]`);
      return;
    }
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
    } else if (qual === "col-passagem") {
      const id = form.dataset["coluna"] ?? "";
      const c = colunaDe(id);
      if (!c) { editar(null); return; }
      const modo = form.querySelector<HTMLInputElement>("input[name=modo]:checked")?.value;
      const escolhido = form.querySelector<HTMLSelectElement>("select[name=agente]")?.value ?? "";
      const instrucoes = (form.querySelector<HTMLTextAreaElement>("textarea[name=instrucoes]")?.value ?? "").trim() || null;
      const agente = modo === "agente" ? escolhido || null : null;
      if (modo === "agente" && !agente) { form.querySelector<HTMLSelectElement>("select[name=agente]")?.focus(); return; }
      if (agente === (c.responsavel ?? null) && instrucoes === (c.instrucoes ?? null)) { fechar(); return; }
      const quem = agente ? dd?.agentes?.().find((x) => x.id === agente)?.nome ?? "o agente" : null;
      const recibo = quem ? `${c.nome} passa para ${quem}` : agente === (c.responsavel ?? null) ? `${c.nome}: etapa descrita` : `${c.nome} sem passagem`;
      void mexer((a, de) => a.definirPassagem?.(de, id, { agente, instrucoes }), recibo, `.qd-so-largo [data-act="col-passagem"][data-coluna="${CSS.escape(id)}"]`);
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
      if (aberta && (!ids.length || ids.includes(aberta))) void coms.reler();
      if (aberta) trabs.aoFrame(frame);
      pedirReleitura();
      return;
    }
    if (aberta && frame.tipo.startsWith("turno.")) trabs.aoFrame(frame);
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

  /** NOD-430: abre a tarefa do quadro de `agente`; se a conversa dele ainda não está na tela, espera o sincronizar. */
  function abrirTarefaDe(agente: string, tarefaId: string): void {
    pedidoDoChat = { agenteId: agente, tarefaId };
    abrirPendente();
  }

  function abrirPendente(): void {
    if (!pedidoDoChat || chave === null || agenteId !== pedidoDoChat.agenteId) return;
    const { tarefaId } = pedidoDoChat;
    pedidoDoChat = null;
    marcarAberta(tarefaId);
    if (modo === "quadro") { desenharVista(); void lerQuadro(); } else trocar("quadro");
  }

  /** A tarefa aberta passa a ser `id` (o histórico, a lista do "Mover para…" e os comentários dela são lidos). */
  function marcarAberta(id: string): void {
    aberta = id;
    soltarNaAberta = null;
    moverPara = null;
    histAberto = false;
    histTarefa = null;
    const t = tarefaNoQuadro(q, id);
    if (t) dd?.naUrl?.(codigoNaUrl(t));
    void lerHistorico();
    void lerQuadros();
    if (agenteId) { coms.abrir(agenteId, id); trabs.abrir(agenteId, id); }
  }

  function abrirTarefa(id: string): void {
    marcarAberta(id);
    desenharVista();
    doc.getElementById("qd-t-tit")?.focus();
    vista()?.scrollTo?.({ top: 0 });
  }

  /** O foco no quadro: o primeiro card à vista; sem card (quadro vazio, aviso), o conteúdo inteiro. */
  function focarNoQuadro(): void {
    const conteudo = vista()?.querySelector<HTMLElement>(":scope > .qd-conteudo");
    if (!conteudo) return;
    const card = [...conteudo.querySelectorAll<HTMLElement>('[data-act="abrir-tarefa"]')].find((e) => e.getClientRects().length > 0);
    if (card) { card.focus(); return; }
    conteudo.tabIndex = -1;
    conteudo.focus();
  }

  /**
   * O anúncio só para o leitor de tela (`.qd-sr`, polite). A região viva nasce vazia no rodapé com o quadro (que a
   * regravação do conteúdo não troca): uma região criada já com o texto não é lida por todo leitor de tela. Revisão 6 do
   * PR #623: esvazia e põe o texto no próximo quadro de animação (o mesmo texto de antes também é lido de novo).
   */
  function anunciar(texto: string): void {
    const el = vista()?.querySelector<HTMLElement>(":scope > .qc-wrap > .qd-anuncio") ?? null;
    const raf = doc.defaultView?.requestAnimationFrame?.bind(doc.defaultView);
    anunciarEm(el, texto, (fn) => (raf ? raf(fn) : setTimeout(fn, 0)));
  }

  function voltarAoQuadro(): void {
    const id = aberta;
    aberta = null;
    soltarNaAberta = null;
    leituraHist++;
    dd?.naUrl?.(null);
    coms.fechar();
    trabs.fechar();
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
    // NOD-430 (revisão 1 do PR #627): a conversa do dono da tarefa pedida chegou sem quadro (excluído): o pedido cai aqui,
    // senão a tarefa velha abriria sozinha quando ele ganhasse um quadro novo.
    if (pedidoDoChat && s.chave === null && s.agenteId === pedidoDoChat.agenteId) pedidoDoChat = null;
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
    // O link que chegou antes do quadro liberado: abre agora, na conversa do bot dele; em outra conversa, é esquecido.
    if (pendente && chave !== null) {
      if (pendente.agenteId !== agenteId) { pendente = null; avisoDoMover = null; }
      else if (modo !== "quadro") trocar("quadro");
    }
    abrirPendente();
  }

  // As ações do segmento e do quadro vazio moram aqui, não no mapa de ações do main: são só da tela.
  doc.addEventListener("click", (ev) => {
    const alvo = ev.target as Element | null;
    // Clicar no quadro recolhe o histórico da faixa (passo 9).
    if (histAberto && alvo?.closest?.("#quadro .qd-conteudo")) { histAberto = false; desenharFaixa(); }
    if (engolirClique) { engolirClique = false; ev.preventDefault(); ev.stopPropagation(); return; }
    // NOD-448: clicar fora do menu ou do popover fecha (a coluna nova e a folha fecham pelo Cancelar, Pronto ou Esc).
    const solta = edicao?.tipo === "menu" || edicao?.tipo === "passagem" || edicao?.tipo === "soltar" || edicao?.tipo === "mover" || (edicao?.tipo === "remover" && !edicao.naFolha);
    if (solta && alvo?.closest?.("#quadro") && !alvo.closest(".qd-menu, .qd-pop, .qd-col-mais, .qd-col-passa, .qd-soltar, .qd-card-mover")) { edicao = null; desenharVista(); }
    if (soltarNaAberta && alvo?.closest?.("#quadro") && !alvo.closest(".qd-t-soltar, #qd-t-status")) desistirDoSoltarNaAberta();
    const el = alvo?.closest?.<HTMLElement>("[data-act]");
    if (!el) return;
    const act = el.dataset["act"];
    if (dd && el.closest("#quadro")) {
      const id = el.dataset["id"] ?? "";
      if (act === "abrir-tarefa" && id) { abrirTarefa(id); return; }
      if (act === "tarefa-mover" || act === "tarefa-mover-para") { aoMoverCard(el, act); return; }
      if (act === "voltar-ao-quadro") { voltarAoQuadro(); return; }
      if (act?.startsWith("trab-") && trabs.aoClicar(act)) return;
      if (act === "mover-quadro" && id) {
        const destino = el.closest(".qd-mover")?.querySelector<HTMLSelectElement>('[data-campo="mover"]')?.value ?? "";
        if (destino) void moverDeQuadro(id, destino);
        return;
      }
      if (act === "qd-reler") { carga = "nada"; void lerQuadro(); return; }
      if (act === "editar-meta") { editarMeta(true); return; }
      if (act === "remover-quadro") { void removerQuadro(); return; }
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

  /** ADR-142: o "Mover para…" do card. Coluna com responsável que aciona pede a mesma confirmação do card solto; as outras movem direto. */
  function aoMoverCard(el: HTMLElement, act: string): void {
    const tarefa = el.dataset["tarefa"] ?? "";
    if (act === "tarefa-mover") {
      const aberto = edicao?.tipo === "mover" && edicao.tarefa === tarefa;
      editar(aberto ? null : { tipo: "mover", tarefa, ...(el.closest(".qd-so-estreito") ? { estreito: true } : {}) }, aberto ? `[data-act="tarefa-mover"][data-tarefa="${CSS.escape(tarefa)}"]` : undefined);
      return;
    }
    if (el.getAttribute("aria-disabled") === "true") { const porque = el.getAttribute("title"); if (porque) mudarFaixa({ tipo: "erro", texto: porque }); return; }
    const c = colunaDe(el.dataset["coluna"]);
    if (!c) return;
    if (pedeConfirmacao(c)) { editar({ tipo: "soltar", coluna: c.id, tarefa }); return; }
    moverTarefa(tarefa, c.id, false);
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
    if (act === "col-passagem") { editar(edicao?.tipo === "passagem" && edicao.coluna === id ? null : { tipo: "passagem", coluna: id }); return; }
    if (act === "col-soltar" || act === "col-soltar-sem") {
      const t = soltarNaAberta && el.closest(".qd-t-soltar") ? tarefaNoQuadro(q, soltarNaAberta.tarefa) : null;
      if (t) { mudarNaTarefaAberta(t, { status: id }, { semIniciar: act === "col-soltar-sem" }); return; }
      moverTarefa(el.dataset["tarefa"] ?? "", id, act === "col-soltar-sem");
      return;
    }
    if (act === "col-fechar") { fechar(); return; }
    if (act === "col-folha") { editar({ tipo: "ordem" }); return; }
    if (act === "col-fechar-folha") { editar(null, '.qd-so-estreito [data-act="col-folha"]'); return; }
  }

  // NOD-442: a pílula e a resposta do bloqueio. Enter envia na pílula (Shift+Enter quebra a linha); Esc na tarefa volta.
  doc.addEventListener("submit", (ev) => {
    const form = ev.target instanceof HTMLFormElement ? ev.target : null;
    if (!dd || !form?.closest("#quadro")) return;
    const qual = form.dataset["form"];
    if (qual === "col-renomear" || qual === "col-nova" || qual === "col-remover" || qual === "col-passagem") { ev.preventDefault(); enviarColuna(form); return; }
    if (qual === "recado-trabalho") { ev.preventDefault(); trabs.enviarRecado(form); return; }
    if (qual === "comentar-tarefa") {
      ev.preventDefault();
      const de = agenteId;
      void coms.enviar(form).then((r) => {
        if (!r) mudarFaixa({ tipo: "erro", texto: "Não consegui mandar o comentário. Ele continua no campo." });
        else if (de === agenteId) aplicarQuadro(r.quadro, aberta ? [aberta] : []);
      });
      return;
    }
    if (qual === "nova-tarefa") {
      ev.preventDefault();
      const campo = form.querySelector<HTMLInputElement>('[name="titulo"]');
      const titulo = campo?.value.trim() ?? "";
      if (!titulo) return;
      void mudarTarefa((a, de) => a.criarTarefa?.(de, { titulo }), (r) => reciboDaNovaTarefa(titulo, r)).then((ok) => {
        const c = doc.getElementById("qd-nova-tit");
        if (ok && c instanceof HTMLInputElement) { c.value = ""; c.focus(); }
      });
      return;
    }
    if (qual !== "conversa-no-quadro" && qual !== "responder-tarefa" && qual !== "criar-quadro" && qual !== "editar-meta") return;
    ev.preventDefault();
    if (qual === "conversa-no-quadro") void enviarPedido(form);
    else if (qual === "responder-tarefa") void responder(form);
    else if (qual === "criar-quadro") {
      const meta = form.querySelector<HTMLInputElement>('[name="meta"]')?.value.trim() ?? "";
      const prazo = prazoDoForm(form);
      const botao = form.querySelector<HTMLButtonElement>('button[type="submit"]');
      if (botao) botao.disabled = true;
      void mexerNoQuadro("criar", { meta: meta || null, prazo }).finally(() => { if (botao) botao.disabled = false; });
    } else {
      const meta = form.querySelector<HTMLInputElement>('[name="meta"]')?.value.trim() ?? "";
      if (meta === (q?.meta ?? "")) { editarMeta(false); return; }
      void mexerNoQuadro("editar", { meta: meta || null });
    }
  });

  /** O prazo escolhido no menu (ou no campo de "Outra data…"); "" = sem prazo. */
  function prazoDoForm(lugar: ParentNode): string | null {
    const sel = lugar.querySelector<HTMLSelectElement>('[data-campo="prazo"]');
    const data = lugar.querySelector<HTMLInputElement>('[data-campo="prazo-data"]');
    const v = sel?.value === "outra" ? data?.value ?? "" : sel?.value ?? "";
    return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
  }

  // NOD-415: o menu de prazo. "Outra data…" abre o campo de data; no topo, a troca grava na hora (no criar, só no envio).
  doc.addEventListener("change", (ev) => {
    const el = ev.target as Element | null;
    if (!dd || !el?.closest?.("#quadro .qd-conteudo")) return;
    const campo = (el as HTMLElement).dataset?.["campo"];
    // NOD-416: Status e Responsável da tarefa aberta (pelo teclado, a escolha espera o Enter ou a saída do campo).
    if (ehCampoDaTarefa(el)) { if (!el.dataset["teclado"]) aplicarCampoDaTarefa(el); return; }
    // "Mover para…": escolher só liga o botão Mover (revisão do PR #623).
    if (campo === "mover") {
      moverPara = (el as HTMLSelectElement).value || null;
      const bt = el.closest(".qd-mover")?.querySelector<HTMLButtonElement>('[data-act="mover-quadro"]');
      if (bt) bt.disabled = !(el as HTMLSelectElement).value;
      // QA do PR #623: o nome pode não caber no select; o title acompanha a escolha.
      const sel = el as HTMLSelectElement;
      sel.title = sel.selectedOptions[0]?.textContent ?? "";
      return;
    }
    if (campo !== "prazo" && campo !== "prazo-data") return;
    const caixa = el.closest<HTMLElement>(".qd-prazo");
    const data = caixa?.querySelector<HTMLInputElement>('[data-campo="prazo-data"]');
    if (campo === "prazo" && (el as HTMLSelectElement).value === "outra") {
      if (data) { data.hidden = false; data.focus(); try { data.showPicker?.(); } catch { /* sem gesto: o campo fica à vista */ } }
      return;
    }
    if (el.closest('[data-form="criar-quadro"]') || !q || !caixa) return;
    const prazo = prazoDoForm(caixa);
    if (campo === "prazo-data" && !prazo) return;
    if (prazo === q.prazo) return;
    void mexerNoQuadro("editar", { prazo });
  });
  // QA do PR #617: sair do campo sem Enter nem Esc desiste (como o Esc), e "Outra data…" sem data volta ao prazo de
  // antes. Sem redesenhar agora: o clique que tirou o foco ainda vai chegar ao alvo dele.
  doc.addEventListener("focusout", (ev) => {
    // Trocar de janela ou de aba também tira o foco: aí o campo fica como está (revisão 4).
    if (!dd || !doc.hasFocus()) return;
    const el = ev.target as Element | null;
    if (editandoMeta && el instanceof HTMLInputElement && el.id === "qd-meta-in") {
      editandoMeta = false;
      setTimeout(() => { if (!editandoMeta && doc.activeElement?.id !== "qd-meta-in" && vista()?.querySelector("#qd-meta-in")) desenharVista(); }, 200);
    } else if (el instanceof HTMLInputElement && el.dataset["campo"] === "prazo-data" && !el.value) {
      const sel = el.closest(".qd-prazo")?.querySelector<HTMLSelectElement>('[data-campo="prazo"]');
      if (sel?.value === "outra") { sel.value = el.closest('[data-form="criar-quadro"]') ? "" : q?.prazo ?? ""; el.hidden = true; }
    }
  });
  // Revisão do PR #623: no select fechado, as setas, Home/End, PageUp/PageDown e a busca por letra trocam o valor (e o
  // Chrome dispara o change a cada uma). Marca o campo; o Enter aplica. O clique do mouse tira a marca.
  doc.addEventListener("keydown", (ev) => {
    const el = ev.target;
    if (!dd || !ehCampoDaTarefa(el) || ev.isComposing) return;
    if (ev.key === "Enter") { ev.preventDefault(); aplicarCampoDaTarefa(el); return; }
    if (/^(Arrow|Page)/.test(ev.key) || ev.key === "Home" || ev.key === "End" || (ev.key.length === 1 && ev.key !== " " && !ev.ctrlKey && !ev.metaKey)) el.dataset["teclado"] = "1";
  });
  doc.addEventListener("pointerdown", (ev) => { if (ehCampoDaTarefa(ev.target)) delete ev.target.dataset["teclado"]; });
  doc.addEventListener("focusout", (ev) => { if (dd && ehCampoDaTarefa(ev.target) && ev.target.dataset["teclado"]) aplicarCampoDaTarefa(ev.target); });
  doc.addEventListener("keydown", (ev) => {
    if (!dd) return;
    const el = ev.target as Element | null;
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing && el instanceof HTMLTextAreaElement && (el.id === "qc-txt" || el.classList.contains("qd-com-in"))) {
      ev.preventDefault();
      el.form?.requestSubmit();
    } else if (ev.key === "Escape" && editandoMeta && el instanceof HTMLInputElement && el.id === "qd-meta-in") {
      ev.preventDefault();
      editarMeta(false);
    } else if (ev.key === "Escape" && edicao && el?.closest?.("#quadro .qd-conteudo")) {
      ev.preventDefault();
      if (edicao.tipo === "ordem") editar(null, '.qd-so-estreito [data-act="col-folha"]');
      else fechar();
    } else if (ev.key === "Escape" && soltarNaAberta && aberta && el?.closest?.("#quadro .qd-conteudo")) {
      ev.preventDefault();
      desistirDoSoltarNaAberta();
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

  /**
   * ADR-142: o card arrastado muda de coluna pelo mesmo mudar_tarefa da pessoa e do agente (as travas e o histórico pegam).
   * Numa coluna com responsável, a confirmação vem antes; "Não iniciar ainda" move e passa sem acionar.
   */
  function moverTarefa(tarefa: string, coluna: string, semIniciar: boolean): void {
    const t = q?.tarefas.find((x) => x.id === tarefa);
    const c = colunaDe(coluna);
    if (!t || !c || t.status === coluna) { editar(null); return; }
    const recibo = reciboDeMover(t.titulo, c, semIniciar);
    void mexer((a, de) => a.mudarTarefa?.(de, tarefa, { status: coluna, ...(semIniciar ? { sem_iniciar: true } : {}) }), recibo);
  }
  let cardArrastado: string | null = null;
  const colunaSob = (alvo: EventTarget | null): HTMLElement | null => (alvo as Element | null)?.closest?.<HTMLElement>("#quadro section.qd-col[data-coluna]") ?? null;
  doc.addEventListener("dragstart", (ev) => {
    const li = (ev.target as Element | null)?.closest?.<HTMLElement>("#quadro li.qd-card[draggable][data-tarefa]");
    if (!li || !q) return;
    cardArrastado = li.dataset["tarefa"] ?? null;
    ev.dataTransfer?.setData("text/plain", cardArrastado ?? "");
    if (ev.dataTransfer) ev.dataTransfer.effectAllowed = "move";
    li.classList.add("qd-arrastando");
  });
  doc.addEventListener("dragover", (ev) => {
    const sec = cardArrastado ? colunaSob(ev.target) : null;
    if (!sec) return;
    ev.preventDefault();
    vista()?.querySelectorAll(".qd-alvo").forEach((x) => { if (x !== sec) x.classList.remove("qd-alvo"); });
    sec.classList.add("qd-alvo");
  });
  doc.addEventListener("dragend", () => {
    cardArrastado = null;
    vista()?.querySelectorAll(".qd-alvo, .qd-arrastando").forEach((x) => x.classList.remove("qd-alvo", "qd-arrastando"));
  });
  doc.addEventListener("drop", (ev) => {
    const sec = cardArrastado ? colunaSob(ev.target) : null;
    const tarefa = cardArrastado;
    if (!sec || !tarefa) return;
    ev.preventDefault();
    cardArrastado = null;
    const c = colunaDe(sec.dataset["coluna"]);
    if (!c || q?.tarefas.find((x) => x.id === tarefa)?.status === c.id) { desenharVista(); return; }
    const recusa = porqueNaoRecebeCard(c, nome);
    if (recusa) { desenharVista(); mudarFaixa({ tipo: "erro", texto: recusa }); return; }
    if (pedeConfirmacao(c)) { editar({ tipo: "soltar", coluna: c.id, tarefa }); return; }
    moverTarefa(tarefa, c.id, false);
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

  /**
   * NOD-416: o link da tarefa. Com o quadro já lido, abre; senão espera a leitura (aplicarQuadro). Sem o quadro liberado
   * ainda (chave nula: as preferências chegam depois da frota no boot), guarda o pedido; o próximo `sincronizar` com a
   * conversa deste bot o consome, e o de outra conversa o esquece (revisão 5 do PR #623).
   */
  function abrirPeloLink(de: string, tarefaId: string): void {
    if (!dd) return;
    if (chave === null) { pendente = { agenteId: de, tarefaId }; return; }
    if (agenteId !== de) return;
    if (carga === "ok" && tarefaNoQuadro(q, tarefaId)) {
      if (modo !== "quadro") trocar("quadro");
      abrirTarefa(tarefaId);
      return;
    }
    pendente = { agenteId: de, tarefaId };
    if (modo !== "quadro") trocar("quadro");
    else void lerQuadro();
  }

  return { sincronizar, trocar, aoFrame, reler, abrirTarefaDe, modo: () => modo, abrirTarefa: abrirPeloLink };
}
