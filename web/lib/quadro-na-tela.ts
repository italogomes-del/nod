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
import { direcaoDaTroca, ehModo, movimentoDaTroca, type ModoDaConversa } from "./quadro.ts";
import { comColunas, FAIXA_DO_PRAZO, fraseDoErroDeColuna, nomeRepetido, passoDeMover, pedeConfirmacao, porqueNaoRecebeCard, porqueNaoRemove, prazoEmMin, prazoLegivelMin, reciboDaResposta, reciboDeMover, saidaComErroDesiste, seletorDoFocoDaColuna, soltarEm, type EdicaoDeColuna, type Lado, type UnidadeDePrazo } from "./colunas.ts";
import { ErroApi } from "./erro-api.ts";
import { anunciarEm } from "./posicao-da-lista.ts";
import type { EntradaHistoricoDto, GrupoColuna, LinhaMuralDto, ModoConversa, QuadroDaPessoaDto, QuadroDto, TarefaDto } from "../../src/contracts/quadro.ts";
import type { ConversaDto, RespostaMutacao } from "../../src/contracts/api.ts";
import type { MutacaoQuadro } from "./api.ts";
import { RESP_VOCE, acesos, fraseDoErroDoMover, reciboDaNovaTarefa, codigoNaUrl, destinosDaTarefa, historicoDaFaixa, respostaDoBot, tarefaNoQuadro, type Faixa } from "./quadro-dados.ts";
import { quadroVazio, type Aviso, type Filtro, type Html } from "../telas/quadro.ts";
import { decidirSoltura, fraseDaTrava, RECUSA_MS, relogioDaRecusa, type RelogioDaRecusa } from "./freios.ts";
import { faixaDoQuadro, pilulaDoQuadro, quadroCarregando, quadroComErro, quadroDaMeta, rotuloDoModo, semQuadro, tarefaAberta, type AgenteDoQuadro, type PainelDoQuadro, type TrocaDaFaixa } from "../telas/quadro-real.ts";
import { anuncioDaOrdem, anuncioDaPagina, CONVERSA, ehForma, indicePeloId, moverNaOrdem, paginaPelaTecla, passoDaTeclaDeMover, presa, TAREFAS, type FormaDasTarefas, type Pagina } from "./paginas.ts";
import { guardarOrdem, ordemDoAgente, paginasDtoDe } from "./ordem-das-paginas.ts";
import { formaDasTarefas, menuDaPagina, paginaDoApp } from "../telas/paginas.ts";
import { ligarGestosDaPilula } from "./paginas-na-tela.ts";
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
  prazoDaColuna?(agenteId: string, coluna: string, prazoMin: number | null): Promise<MutacaoQuadro>;
  moverColuna?(agenteId: string, coluna: string, onde: { antes_de?: string; depois_de?: string }): Promise<MutacaoQuadro>;
  removerColuna?(agenteId: string, coluna: string, destino?: string): Promise<MutacaoQuadro>;
  /** ADR-142: a passagem da coluna e o card arrastado (o mesmo mudar_tarefa; `sem_iniciar` = "Não iniciar ainda"). */
  definirPassagem?(agenteId: string, coluna: string, p: { agente: string | null; instrucoes: string | null }): Promise<MutacaoQuadro>;
  /** NOD-416 (ADR-144): criar (cai no Backlog), mudar status e responsável, mudar de quadro, o histórico e os quadros. */
  criarTarefa?(agenteId: string, campos: { titulo: string }): Promise<MutacaoQuadro>;
  mudarTarefa?(agenteId: string, tarefaId: string, campos: { status?: string; agente?: string | null; sem_iniciar?: boolean }): Promise<MutacaoQuadro>;
  /** NOD-419: a trava da coluna e o Desfazer de um movimento (o eco do agente e o histórico da tarefa). */
  travarColuna?(agenteId: string, coluna: string, t: { sai_para?: string[] | null; so_pessoa?: boolean }): Promise<MutacaoQuadro>;
  desfazerMovimento?(agenteId: string, tarefaId: string, movimentoId: string): Promise<MutacaoQuadro>;
  moverTarefa?(agenteId: string, tarefaId: string, quadro: string): Promise<MutacaoQuadro & { movida?: { codigo: string; codigoAntigo: string } }>;
  historicoTarefa?(agenteId: string, tarefaId: string): Promise<{ historico: EntradaHistoricoDto[] }>;
  quadros?(): Promise<{ quadros: QuadroDaPessoaDto[] }>;
  /** NOD-443 (ADR-143): as pessoas, o modo e o mural. Opcionais: sem elas, o quadro não mostra "Pessoas" nem "Atividade". */
  adicionarPessoa?(agenteId: string, pessoa: string, modo?: ModoConversa): Promise<MutacaoQuadro>;
  tirarPessoa?(agenteId: string, pessoaId: string): Promise<MutacaoQuadro>;
  mudarModo?(agenteId: string, modo: ModoConversa): Promise<MutacaoQuadro>;
  atividadeQuadro?(agenteId: string): Promise<{ linhas: LinhaMuralDto[] }>;
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
  sincronizar(o: { chave: string | null; nome: string; agenteId?: string | null; paginas?: readonly Pagina[] }): void;
  /** NOD-445: ir a uma página da pílula (índice de dentro: 0 = Conversa, depois Tarefas, se houver, e os apps). */
  irPara(i: number, o?: { foco?: boolean }): void;
  /** ⌘[ ⌘]: a página anterior/seguinte na ordem da pílula. */
  andar(passo: -1 | 1): boolean;
  totalDePaginas(): number;
  /** Abre a página pelo id ("tarefas", "app:<id>"): o app que acabou de chegar. */
  abrirPagina(id: string): void;
  /** O app que acabou de chegar: o ícone e o pontinho entram com uma animação curta. */
  marcarChegada(id: string): void;
  pagina(): number;
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

/** NOD-445: o que a pílula de páginas pede ao main (a conversa, a API dos apps). */
export interface AcoesDasPaginas {
  /** "+ pedir um app": a caixa da conversa com a frase começada. */
  pedirApp(): void;
  /** O menu do ícone: "Editar pela conversa". */
  editarApp(p: Pagina): void;
  /** O menu do ícone: "Remover da pílula" (o main mostra o Desfazer). */
  removerApp(p: Pagina): void;
  /** O erro de fonte: "Pedir acesso de novo". */
  reconectar(p: Pagina): void;
  /** O GET das páginas do bot está no ar: um app ainda vazio mostra o esqueleto, não o "Nada aqui ainda". */
  lendo?(agenteId: string): boolean;
}

export function criarQuadroNaTela(doc: Document, o: { reduzido?: () => boolean; aoTrocar?: (m: ModoDaConversa) => void; aoMudarOrdem?: () => void; aoTarefasPedirem?: (pedem: boolean) => void; dados?: DadosDoQuadro; paginas?: AcoesDasPaginas } = {}): QuadroNaTela {
  const reduzido = o.reduzido ?? (() => doc.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  let chave: string | null = null;
  let nome = "";
  let modo: ModoDaConversa = "conversa";
  /**
   * NOD-445: as páginas da pílula. A 0 é a conversa e as outras moram na vista `#quadro`, então `modo` continua valendo
   * para o resto do main: "conversa" na página 0, "quadro" em qualquer outra.
   */
  let paginas: readonly Pagina[] = [CONVERSA, TAREFAS];
  let pagina = 0;
  /** A última página da vista (Tarefas ou um app): o `trocar("quadro")` de fora volta a ela. */
  let ultimaDaVista = 1;
  let forma: FormaDasTarefas = "quadro";
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
  let abaFocada: { el: HTMLElement; pagina: number } | null = null;

  const vista = (): HTMLElement | null => doc.getElementById("quadro");
  const conversa = (): HTMLElement[] => LADO_DA_CONVERSA.map((id) => doc.getElementById(id)).filter((e): e is HTMLElement => !!e);

  /* ---------- NOD-442: o quadro de verdade ---------- */
  const dd = o.dados;
  let agenteId: string | null = null;
  /**
   * NOD-445 (revisão 2, achado 1): a casa (1ª posição da pílula) ainda não foi decidida porque as páginas do servidor não
   * tinham chegado quando a conversa abriu (a primeira visita ao bot na sessão). Liga na troca de conversa sem o DTO e é
   * consumida no primeiro `sincronizar` com o DTO, se a pessoa não trocou de página no meio (`trocar`/`irPara` desligam).
   */
  let homePendente = false;
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
  let tarefasPedem = false;
  /**
   * NOD-419: a recusa da trava no card que a pessoa soltou. Some sozinha (sem a pessoa no card), no Esc ou no próximo
   * gesto; ao sumir com o foco nela, o foco volta ao card.
   */
  let recusa: { tarefa: string; destino: string; aviso: Aviso } | null = null;
  let relogio: RelogioDaRecusa | null = null;
  /** NOD-416: o histórico da tarefa aberta (null = carregando), os quadros do "Mover para…" e o link que espera o quadro. */
  let histTarefa: EntradaHistoricoDto[] | null = null;
  let quadros: QuadroDaPessoaDto[] | null = null;
  let leituraHist = 0;
  /** NOD-430: a tarefa pedida pelo código num chat (`nod-tarefa:`): abre quando a conversa do dono dela estiver na tela. */
  let pendente: { agenteId: string; tarefaId: string } | null = null;
  /** NOD-443: o painel aberto abaixo do topo (Pessoas ou Atividade), o mural (null = carregando) e o porquê de uma recusa. */
  let painel: PainelDoQuadro = null;
  let mural: LinhaMuralDto[] | null = null;
  let erroPessoas: string | null = null;
  let leituraMural = 0;
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
    painel = null; mural = null; erroPessoas = null; leituraMural++;
    historico = []; histAberto = false; tarefasPedem = false; leitura++; leituraConversa++; dica = []; editandoMeta = false; edicao = null; soltarNaAberta = null; coms.fechar(); trabs.fechar();
    if (timerReler) clearTimeout(timerReler);
    if (timerRecolher) clearTimeout(timerRecolher);
    timerReler = timerRecolher = null;
  }

  function conteudoHtml(): Html | string {
    const p = paginas[pagina];
    if (p?.app) return paginaDoApp(p, nome, { lendo: agenteId !== null && (o.paginas?.lendo?.(agenteId) ?? false) });
    if (!dd) return quadroVazio({ nome, filtro, alternadas });
    if (carga === "nada" || carga === "carregando") return quadroCarregando();
    if (carga === "erro") return quadroComErro();
    if (!q) return semQuadro(nome, Date.now());
    const t = tarefaNoQuadro(q, aberta);
    if (t) {
      const trabalhos = trabs.html(t.id, { bloqueada: t.status === "bloqueado" || (t.status === "voce" && t.voltarPara !== null && t.voltarPara !== t.status), agenteId: t.agenteId, conversaAtual: chave, hora: dd.hora });
      const resp = dd.agentes?.();
      const soltar = soltarNaAberta?.tarefa === t.id ? { soltar: soltarNaAberta.coluna } : {};
      return tarefaAberta({ t, q, agente: dd.agente, comentarios: coms.html(t.id, dd.agente, dd.hora), hora: dd.hora, historico: dd.api()?.historicoTarefa ? histTarefa : undefined, ...(resp ? { responsaveis: resp } : {}), ...(quadros ? { destinos: destinosDaTarefa(quadros, q.id), moverPara } : {}), ...soltar, ...(trabalhos !== undefined ? { trabalhos } : {}) });
    }
    const comPessoas = !!dd.api()?.adicionarPessoa;
    const agentes = dd.agentes && dd.api()?.definirPassagem ? dd.agentes() : undefined;
    return quadroDaMeta({ q, nome, agente: dd.agente, filtro, alternadas, acesas, edicao, agora: Date.now(), editandoMeta, ...(comPessoas ? { pessoas: { painel, mural, hora: dd.hora, erro: erroPessoas } } : {}), ...(agentes ? { agentes } : {}) , ...(recusa ? { avisos: new Map([[recusa.tarefa, recusa.aviso]]) } : {}) });
  }

  /**
   * Regrava só o conteúdo (o quadro ou a tarefa). A pílula fica: o rascunho e o foco nela sobrevivem a cada frame. O que a
   * pessoa digitava numa resposta também volta (o campo é o mesmo id), e o foco com ele.
   */
  function desenharVista(): void {
    const v = vista();
    if (!v) return;
    v.dataset["forma"] = forma;
    v.dataset["pagina"] = paginas[pagina]?.id ?? "";
    if (!dd) { v.innerHTML = conteudoHtml(); return; }
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
    // NOD-445: Lista | Quadro em Tarefas, na barra dos filtros (só com o quadro de verdade e nenhuma tarefa aberta).
    conteudo.querySelector(".qd-barra-q .qd-barra-dir")?.insertAdjacentHTML("afterbegin", formaDasTarefas(forma));
    if (focoColuna) conteudo.querySelector<HTMLElement>(focoColuna)?.focus();
    for (const [id, valor] of rascunhos) { const c = doc.getElementById(id); if (c instanceof HTMLTextAreaElement || c instanceof HTMLInputElement) c.value = valor; }
    if (focoId) doc.getElementById(focoId)?.focus();
    const form = v.querySelector<HTMLElement>('[data-form="conversa-no-quadro"]');
    const rot = q?.meta ? `Conversar com o quadro ${q.meta}` : `Conversar com ${nome} sobre o quadro`;
    if (form && form.getAttribute("aria-label") !== rot) form.setAttribute("aria-label", rot);
    const txt = v.querySelector<HTMLTextAreaElement>("#qc-txt");
    const t = tarefaNoQuadro(q, aberta);
    if (txt) txt.placeholder = t ? `Recado sobre ${t.linearId ?? t.titulo}` : "Nova tarefa ou mensagem";
    // NOD-443 (D2): o rótulo diz quem vê esta conversa, com gente no quadro.
    const modo = v.querySelector<HTMLElement>("#qc-modo");
    if (modo) { const m = q ? rotuloDoModo(q) : null; modo.hidden = !m; modo.textContent = m ?? ""; }
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
    // NOD-445: Tarefas acende o laranja na pílula quando alguma tarefa está em "Precisa de você".
    const pedem = !!novo?.tarefas.some((t) => t.status === "voce");
    if (pedem !== tarefasPedem) { tarefasPedem = pedem; o.aoTarefasPedirem?.(pedem); }
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
    // NOD-443: o mural aberto acompanha o quadro (cada pedido de qualquer pessoa entra nele).
    if (painel === "atividade" && novas.size) void lerMural();
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
    // Enquanto envia, nem o botão nem o Enter mandam de novo (NOD-420).
    if (form.dataset["enviando"] === "1") return;
    form.dataset["enviando"] = "1";
    if (botao) botao.disabled = true;
    campo.readOnly = true;
    // A pessoa pode trocar de bot antes da resposta voltar: o quadro de um não entra na tela do outro.
    const c = chave;
    const de = agenteId;
    try {
      const r = await a.responderTarefa(de, id, resposta);
      if (c !== chave || de !== agenteId) return;
      campo.value = "";
      aplicarQuadro(r.quadro, [id]);
      // NOD-420: o recibo diz para onde voltou e quem segue; sem Desfazer (a resposta já acionou o responsável).
      mudarFaixa({ tipo: "resposta", texto: reciboDaResposta(r.quadro, id), loteId: null, mensagemId: "" });
    } catch {
      if (c !== chave) return;
      mudarFaixa({ tipo: "erro", texto: "Não consegui mandar a resposta. Ela continua no campo." });
    } finally {
      delete form.dataset["enviando"];
      if (botao) botao.disabled = false;
      campo.readOnly = false;
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

  /* ---------- NOD-443: as pessoas, o modo e o mural ---------- */

  async function lerMural(): Promise<void> {
    const a = dd?.api();
    if (!a?.atividadeQuadro || !agenteId) return;
    const n = ++leituraMural;
    const de = agenteId;
    try {
      const r = await a.atividadeQuadro(de);
      if (n !== leituraMural || de !== agenteId) return;
      mural = r.linhas;
    } catch {
      if (n !== leituraMural) return;
      mural = [];
      erroPessoas = "Não consegui ler a Atividade agora.";
    }
    if (painel === "atividade") desenharVista();
  }

  function abrirPainel(qual: Exclude<PainelDoQuadro, null>): void {
    painel = painel === qual ? null : qual;
    erroPessoas = null;
    if (painel === "atividade") { mural = null; void lerMural(); }
    desenharVista();
    vista()?.querySelector<HTMLElement>(`.qd-conteudo [data-act="painel-${qual}"]`)?.focus();
  }

  /** Uma mudança nas pessoas ou no modo: um lote com Desfazer na faixa; a recusa do servidor fica no painel. */
  async function mexerNasPessoas(fazer: (a: ApiDoQuadro, de: string) => Promise<MutacaoQuadro> | undefined, recibo: string, foco?: string): Promise<boolean> {
    const a = dd?.api();
    if (!a || !agenteId || mexendo) return false;
    const c = chave;
    const de = agenteId;
    mexendo = true;
    try {
      const p = fazer(a, de);
      if (!p) return false;
      const r = await p;
      if (c !== chave || de !== agenteId) return false;
      erroPessoas = null;
      aplicarQuadro(r.quadro);
      mudarFaixa({ tipo: "resposta", texto: recibo, loteId: r.lote && !r.lote.desfeitoEm ? r.lote.id : null, mensagemId: "" });
      desenharFaixa();
      if (foco) vista()?.querySelector<HTMLElement>(foco)?.focus();
      return true;
    } catch (e) {
      if (c !== chave) return false;
      erroPessoas = e instanceof ErroApi && e.message ? e.message : "Não deu para mudar as pessoas do quadro agora.";
      desenharVista();
      return false;
    } finally {
      mexendo = false;
    }
  }

  async function adicionarPessoa(form: HTMLFormElement): Promise<void> {
    const campo = form.querySelector<HTMLInputElement>('[name="pessoa"]');
    const pessoa = campo?.value.trim() ?? "";
    if (!pessoa) return;
    // D3: o modo escolhido junto com a primeira pessoa (o padrão já é "cada um na sua conversa") vai no MESMO lote
    // (revisão 1, achado 11): se a pessoa não entra, o modo não muda, e um Desfazer volta os dois.
    const escolhido = form.querySelector<HTMLInputElement>('[name="modo"]:checked')?.value as ModoConversa | undefined;
    const modo = !(q?.membros?.length) && escolhido && escolhido !== q?.modoConversa ? escolhido : undefined;
    const recibo = modo === "so_dono" ? `${pessoa} entrou no quadro; só você conversa com ele` : `${pessoa} entrou no quadro`;
    const ok = await mexerNasPessoas((a, de) => a.adicionarPessoa?.(de, pessoa, modo), recibo, "#qd-pessoa-in");
    if (!ok) return;
    const c = doc.getElementById("qd-pessoa-in");
    if (c instanceof HTMLInputElement) c.value = "";
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
      : ed?.tipo === "passagem" ? ".qd-pop-passa input[name=modo]:checked" : ed?.tipo === "trava" ? ".qd-pop-trava input[name=sai_para]" : ed?.tipo === "soltar" ? '.qd-soltar [data-act="col-soltar"]'
      : ed?.tipo === "prazo" ? "#qd-prz-valor" : null;
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

  /** Onde o foco volta depois do prazo: o ⋯ da coluna, ou o botão do prazo na folha do celular. */
  const focoDoPrazo = (id: string, folha: boolean): string =>
    folha ? `.qd-folha [data-act="col-prazo"][data-coluna="${CSS.escape(id)}"]` : `.qd-so-largo [data-act="col-menu"][data-coluna="${CSS.escape(id)}"]`;

  /** Fecha o que está aberto; dentro da folha do celular, volta para a folha. O card que se movia leva o foco de volta. */
  const fechar = (): void => {
    if (edicao?.tipo === "soltar" || edicao?.tipo === "mover") {
      const t = CSS.escape(edicao.tarefa);
      editar(null, `[data-act="tarefa-mover"][data-tarefa="${t}"]`);
      return;
    }
    // NOD-420 (revisão 3 do PR #624): o prazo abre pelo ⋯ da coluna; fechar devolve o foco a ele. Na folha do celular
    // (revisão 4), volta para a folha, no botão do prazo.
    if (edicao?.tipo === "prazo") {
      if (edicao.naFolha) editar({ tipo: "ordem" }, focoDoPrazo(edicao.coluna, true));
      else editar(null, focoDoPrazo(edicao.coluna, false));
      return;
    }
    const volta = edicao && "naFolha" in edicao && edicao.naFolha ? ({ tipo: "ordem" } as const) : null;
    const col = edicao && "coluna" in edicao ? edicao.coluna : null;
    editar(volta, col && !volta ? `.qd-so-largo .qd-col-bt[data-coluna="${CSS.escape(col)}"]` : undefined);
  };

  /** Uma mudança de coluna: aplica o quadro que volta e diz o que mudou na faixa, com o Desfazer do lote. */
  async function mexer(fazer: (a: ApiDoQuadro, de: string) => Promise<MutacaoQuadro> | undefined, recibo: string, foco?: string, depois: EdicaoDeColuna | null = null, texto?: string, restaurarPrazoDigitado?: () => void): Promise<void> {
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
      const aberta = edicao;
      const f = fraseDoErroDeColuna(e instanceof ErroApi ? e.codigo : null, aberta?.tipo === "prazo" ? "prazo" : undefined);
      // Recusado pelo dado (ou sem conexão): o campo fica aberto com o que foi digitado, e o porquê nele.
      if (f.manter && aberta?.tipo === "prazo" && restaurarPrazoDigitado) {
        editar({ ...aberta, erro: f.texto });
        restaurarPrazoDigitado();
        return;
      }
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
    } else if (qual === "col-trava") {
      const id = form.dataset["coluna"] ?? "";
      const c = colunaDe(id);
      if (!c) { editar(null); return; }
      const sai = [...form.querySelectorAll<HTMLInputElement>("input[name=sai_para]:checked")].map((x) => x.value);
      const antes = c.trava?.saiPara ?? [];
      if (sai.length === antes.length && sai.every((x) => antes.includes(x))) { fechar(); return; }
      const frase = fraseDaTrava(q.colunas, sai.length ? { saiPara: sai } : undefined);
      void mexer((a, de) => a.travarColuna?.(de, id, { sai_para: sai.length ? sai : null }), frase ? `De ${c.nome} ${frase}` : `${c.nome} sem trava de destino`, `.qd-so-largo [data-act="col-menu"][data-coluna="${CSS.escape(id)}"]`);
    } else if (qual === "col-prazo") {
      const id = form.dataset["coluna"] ?? "";
      const c = colunaDe(id);
      if (!c) { editar(null); return; }
      const valor = form.querySelector<HTMLInputElement>("input[name=valor]")?.value ?? "";
      const unidade = (form.querySelector<HTMLSelectElement>("select[name=unidade]")?.value ?? "h") as UnidadeDePrazo;
      const min = prazoEmMin(valor, unidade);
      if (min === null) { editar({ tipo: "prazo", coluna: id, erro: `Use um número ${FAIXA_DO_PRAZO}`, ...(folha ? { naFolha: true } : {}) }); restaurarPrazo(valor, unidade); return; }
      if (min === (c.prazoMin ?? null)) { fechar(); return; }
      void mexer((a, de) => a.prazoDaColuna?.(de, id, min), `${c.nome}: prazo de ${prazoLegivelMin(min)}`, focoDoPrazo(id, folha), depois, undefined, () => restaurarPrazo(valor, unidade));
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

  /** NOD-420: o prazo recusado volta ao popover com o que foi digitado. */
  function restaurarPrazo(valor: string, unidade: string): void {
    const v = vista()?.querySelector<HTMLInputElement>("#qd-prz-valor");
    const u = vista()?.querySelector<HTMLSelectElement>("#qd-prz-unidade");
    if (u) u.value = unidade;
    if (v) { v.value = valor; v.focus(); }
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
    // NOD-445 (merge com o #627): a tarefa abre na página Tarefas da pílula, não na última página da vista (um app).
    const t = paginaDasTarefas();
    if (modo !== "quadro") { marcarAberta(tarefaId); trocar("quadro", { pagina: t }); return; }
    // O irPara entre páginas da vista fecha a tarefa aberta: a pedida é marcada depois.
    if (pagina !== t) irPara(t);
    marcarAberta(tarefaId);
    desenharVista();
    void lerQuadro();
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
    if (pagina > 0) ultimaDaVista = pagina;
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
    // NOD-445: a doca e os pontinhos (nós novos a cada desenho do cabeçalho; marcar de novo não anima nada).
    const pil = doc.querySelector<HTMLElement>("#cabecalho .qd-pil");
    if (pil) pil.dataset["pagina"] = String(pagina);
    for (const b of doc.querySelectorAll<HTMLElement>("#cabecalho .pg-ic")) {
      const s = Number(b.dataset["pagina"]) === pagina;
      if (b.getAttribute("aria-selected") !== String(s)) b.setAttribute("aria-selected", String(s));
      b.tabIndex = s ? 0 : -1;
    }
    for (const p of doc.querySelectorAll<HTMLElement>("#cabecalho .pg-pt")) p.classList.toggle("pg-pt-atual", Number(p.dataset["pagina"]) === pagina);
    if (chegou && Date.now() > chegou.ate) chegou = null;
    for (const e of doc.querySelectorAll<HTMLElement>("#cabecalho .pg-ic, #cabecalho .pg-pt")) e.classList.toggle("pg-chegou", !!chegou && e.dataset["pgId"] === chegou.id);
    doc.querySelector(".stage")?.classList.toggle("qd-no-quadro", modo === "quadro");
    const ativo = doc.activeElement;
    if (abaFocada && !abaFocada.el.isConnected && (!ativo || ativo === doc.body)) focarPagina(abaFocada.pagina);
  }

  /** O leitor de tela ouve a troca de página ("página 2 de 3, Tarefas"); a região mora no body, fora do cabeçalho regravado. */
  function anunciarPagina(texto?: string): void {
    if (paginas.length < 2) return;
    let r = doc.getElementById("pg-anuncio");
    if (!r) {
      r = doc.createElement("div");
      r.id = "pg-anuncio";
      r.className = "sr-only";
      r.setAttribute("aria-live", "polite");
      doc.body.append(r);
    }
    r.textContent = texto ?? anuncioDaPagina(posDe(pagina), paginas.length, paginas[pagina]?.nome ?? "");
  }

  /** A página de dentro é Tarefas (o quadro de verdade)? Sem Tarefas, a vista é só dos apps. */
  const ehTarefas = (i: number): boolean => { const p = paginas[i]; return !p || p.id === TAREFAS.id; };

  /* A ordem da pílula (por agente): a pílula mostra e anda nela; a 1ª posição é a casa, onde o agente abre. */
  const ordem = (): number[] => ordemDoAgente(agenteId, paginas);
  const posDe = (i: number): number => Math.max(0, ordem().indexOf(i));
  const naPos = (pos: number): number => ordem()[presa(pos, paginas.length)] ?? 0;
  /** Leva a página da posição `de` para `para` e guarda; a doca é redesenhada pelo main (`aoMudarOrdem`). */
  function moverPagina(de: number, para: number, op: { foco?: boolean } = {}): void {
    if (!agenteId || chave === null || paginas.length < 2) return;
    const atual = ordem();
    const i = atual[de];
    if (i === undefined) return;
    const nova = moverNaOrdem(atual, de, para);
    if (nova.join() === atual.join()) return;
    guardarOrdem(agenteId, paginas, nova);
    o.aoMudarOrdem?.();
    marcar();
    anunciarPagina(anuncioDaOrdem(paginas[i]?.nome ?? "", nova.indexOf(i), nova.length));
    if (op.foco) focarPagina(i);
  }

  /**
   * NOD-445: ir a uma página. Entre a conversa e uma página da vista é a troca de sempre (`trocar`); entre duas páginas da
   * vista, só o conteúdo desliza (a pílula de baixo e a faixa ficam).
   */
  function irPara(i: number, op: { foco?: boolean } = {}): void {
    if (chave === null || paginas.length < 2) return;
    homePendente = false;
    const alvo = presa(i, paginas.length);
    if (alvo === pagina) { if (op.foco) focarPagina(alvo); return; }
    const de = pagina;
    if (alvo === 0 || de === 0 || animacoes.length) {
      trocar(alvo === 0 ? "conversa" : "quadro", { ...op, pagina: alvo });
      return;
    }
    pagina = alvo;
    aberta = null;
    edicao = null;
    desenharVista();
    if (ehTarefas(alvo) && dd) void lerQuadro();
    marcar();
    anunciarPagina();
    const c = vista()?.querySelector<HTMLElement>(":scope > .qd-conteudo") ?? vista()?.firstElementChild;
    if (c instanceof HTMLElement && typeof c.animate === "function") {
      const mv = movimentoDaTroca(alvo > de ? "ida" : "volta", reduzido());
      c.animate(mv.entra, { duration: mv.ms, easing: mv.curva });
    }
    vista()?.scrollTo?.({ top: 0 });
    if (op.foco) focarPagina(alvo);
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

  function trocar(para: ModoDaConversa, op: { foco?: boolean; pagina?: number } = {}): void {
    homePendente = false;
    const direcao = chave === null ? null : direcaoDaTroca(modo, para);
    // A página que vai ficar: a pedida, ou (pelo `trocar("quadro")` de fora) a última da vista, Tarefas na primeira vez.
    const alvo = para === "conversa" ? 0 : presa(op.pagina ?? (pagina || ultimaDaVista), Math.max(2, paginas.length));
    const focar = (): void => { if (op.foco) focarPagina(pagina); };
    if (!direcao) {
      if (para === "quadro" && alvo !== pagina && chave !== null) { irPara(alvo, op); return; }
      if (op.foco) focarPagina(pagina);
      return;
    }
    if (animacoes.length) {
      // Volta no meio: a mesma animação anda para trás, do ponto onde está; quem saía passa a entrar.
      modo = para;
      const outra = alvo !== pagina && para === "quadro";
      pagina = alvo;
      if (outra) desenharVista();
      marcar();
      anunciarPagina();
      o.aoTrocar?.(para);
      [saindo, entrando] = [entrando, saindo];
      for (const e of saindo) e.inert = true;
      for (const e of entrando) e.inert = false;
      for (const a of animacoes) a.reverse();
      focar();
      return;
    }
    cancelar();
    const v = vista();
    if (!v) return;
    const outraPagina = para === "quadro" && alvo !== pagina;
    pagina = alvo;
    if (para === "quadro" && (!v.firstElementChild || outraPagina || v.dataset["pagina"] !== paginas[pagina]?.id)) desenharVista();
    if (para === "quadro" && dd && ehTarefas(pagina)) void lerQuadro();
    modo = para;
    marcar();
    anunciarPagina();
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
    if (!pode) { assentar(); if (op.foco) focarPagina(pagina); return; }
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
    if (op.foco) focarPagina(pagina);
  }

  /** O app que acabou de chegar acende por um instante (o cabeçalho é regravado: a marca vai de novo a cada desenho). */
  let chegou: { id: string; ate: number } | null = null;

  function focarPagina(i: number): void {
    doc.querySelector<HTMLElement>(`#cabecalho .pg-ic[data-pagina="${i}"]`)?.focus();
  }

  /** Abre a casa do agente sem animação (só chamada com a conversa à vista e nada animando). */
  function irParaCasa(): void {
    const v = vista();
    const casa = chave === null ? 0 : (ordem()[0] ?? 0);
    if (casa > 0 && v) {
      pagina = casa;
      ultimaDaVista = casa;
      modo = "quadro";
      desenharVista();
      if (ehTarefas(casa) && dd) void lerQuadro();
    }
  }

  function sincronizar(s: { chave: string | null; nome: string; agenteId?: string | null; paginas?: readonly Pagina[] }): void {
    // NOD-430 (revisão 1 do PR #627): a conversa do dono da tarefa pedida chegou sem quadro (excluído): o pedido cai aqui,
    // senão a tarefa velha abriria sozinha quando ele ganhasse um quadro novo.
    if (pedidoDoChat && s.chave === null && s.agenteId === pedidoDoChat.agenteId) pedidoDoChat = null;
    // Fora de uma conversa com quadro, e já sem quadro: nada a mexer (o palco é de outra tela).
    if (s.chave === null && chave === null) return;
    const assinatura = (ps: readonly Pagina[]): string => ps.map((p) => `${p.id}${p.pedeVoce ? "!" : ""}${p.apagado ? "~" : ""}${p.app ? `@${p.app.atualizadoEm}` : ""}`).join();
    if (s.paginas && assinatura(s.paginas) !== assinatura(paginas)) {
      const idAtual = paginas[pagina]?.id;
      const idUltima = paginas[ultimaDaVista]?.id;
      paginas = s.paginas.length ? s.paginas : [CONVERSA];
      if (chave === s.chave) {
        // A página à vista segue pelo id; se ela sumiu (app removido), volta para a conversa.
        const i = indicePeloId(paginas, idAtual);
        if (i < 0) {
          // O app à vista saiu (removido em outro aparelho): volta à conversa e avisa quem ouve, como numa troca.
          const estava = modo;
          cancelar();
          pagina = 0;
          modo = "conversa";
          // Fora do desenho em curso (o main desenha de novo ao ouvir a volta): numa microtarefa, se nada mudou no meio.
          const c = chave;
          if (estava !== "conversa") queueMicrotask(() => { if (c === chave && modo === "conversa") o.aoTrocar?.("conversa"); });
        } else pagina = i;
        const u = indicePeloId(paginas, idUltima);
        ultimaDaVista = u > 0 ? u : 1;
        // O retrato do app à vista mudou: redesenha.
        if (modo === "quadro" && paginas[pagina]?.app && vista()?.firstElementChild) desenharVista();
      }
    }
    // O esqueleto é só da leitura em curso: acabou (com ou sem novidade), o app vazio volta à frase e ao exemplo.
    if (s.chave === chave && modo === "quadro" && paginas[pagina]?.app && vista()?.querySelector('.pg-app[aria-busy="true"]') && !(agenteId !== null && o.paginas?.lendo?.(agenteId))) desenharVista();
    if (s.chave !== chave) {
      cancelar();
      zerarDados();
      agenteId = s.chave === null ? null : (s.agenteId ?? null);
      chave = s.chave;
      modo = "conversa";
      pagina = 0;
      ultimaDaVista = 1;
      filtro = "todos";
      alternadas = new Set();
      edicao = null;
      const v = vista();
      if (v) v.innerHTML = "";
      // A casa do agente (1ª posição da pílula) não é a conversa: ele abre direto nela, sem animação.
      homePendente = chave !== null && !paginasDtoDe(agenteId);
      if (!homePendente) irParaCasa();
    } else if (homePendente && paginasDtoDe(agenteId)) {
      // As páginas chegaram depois de a conversa abrir e a pessoa ficou onde estava: a casa vale agora.
      homePendente = false;
      if (modo === "conversa" && pagina === 0 && !animacoes.length) irParaCasa();
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
    const solta = edicao?.tipo === "menu" || edicao?.tipo === "passagem" || edicao?.tipo === "trava" || edicao?.tipo === "soltar" || edicao?.tipo === "mover" || (edicao?.tipo === "remover" && !edicao.naFolha);
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
      if (act === "painel-pessoas") { abrirPainel("pessoas"); return; }
      if (act === "painel-atividade") { abrirPainel("atividade"); return; }
      if (act === "tirar-pessoa" && id) {
        const quem = q?.membros?.find((m) => m.pessoaId === id)?.nome ?? "A pessoa";
        void mexerNasPessoas((a, de) => a.tirarPessoa?.(de, id), `${quem} saiu do quadro`, '.qd-conteudo [data-act="painel-pessoas"]');
        return;
      }
      if (act === "tarefa-desfazer-movimento" && id) { desfazerMovimento(id); return; }
      if (act === "tarefa-mandar" && id) { const r = recusa; tirarRecusa(); const c = r?.tarefa === id ? colunaDe(r.destino) : null; if (c) pessoaSolta(id, c); return; }
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
    if (act === "pagina" && el.closest("#cabecalho")) {
      irPara(Number(el.dataset["pagina"]));
    } else if (act === "forma-das-tarefas" && el.closest("#quadro")) {
      const f = el.dataset["forma"];
      if (ehForma(f) && f !== forma) { forma = f; desenharVista(); vista()?.querySelector<HTMLElement>(`[data-act="forma-das-tarefas"][data-forma="${f}"]`)?.focus(); }
    } else if (act === "modo-da-conversa" && el.closest("#cabecalho")) {
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
    pessoaSolta(tarefa, c);
  }

  /**
   * A pessoa solta a tarefa numa coluna (o arrasto ou o "Mover para…"). A trava recusa no próprio card, com o "Mandar
   * para…"; coluna com responsável pede a confirmação discreta da 417; as outras movem direto.
   */
  function pessoaSolta(tarefa: string, c: NonNullable<ReturnType<typeof colunaDe>>): void {
    const t = q?.tarefas.find((x) => x.id === tarefa);
    const r = decidirSoltura(q?.colunas ?? [], t, c);
    if (r.tipo === "recusa") {
      tirarRecusa();
      recusa = { tarefa, destino: r.destino.id, aviso: { texto: r.texto, acao: `Mandar para ${r.destino.nome}`, recusa: true, act: "tarefa-mandar", id: tarefa } };
      relogio = relogioDaRecusa(RECUSA_MS, () => { relogio = null; sairDaRecusa(); }, () => naRecusa(doc.activeElement) || !!cardDaRecusa()?.matches(":hover"));
      edicao = null;
      desenharVista();
      visivel(vista() ?? doc, `[data-act="tarefa-mandar"][data-id="${CSS.escape(tarefa)}"]`)?.focus();
      return;
    }
    tirarRecusa();
    if (r.tipo === "confirmar") { editar({ tipo: "soltar", coluna: c.id, tarefa }); return; }
    moverTarefa(tarefa, c.id, false);
  }

  function tirarRecusa(): void {
    relogio?.parar();
    relogio = null;
    recusa = null;
  }

  /** O card que tem a recusa, se o elemento está nele. */
  const naRecusa = (alvo: EventTarget | null): boolean =>
    !!recusa && !!(alvo as Element | null)?.closest?.(`#quadro li[data-tarefa="${CSS.escape(recusa.tarefa)}"].qd-com-aviso`);
  const cardDaRecusa = (): Element | null =>
    recusa ? visivel(vista() ?? doc, `li[data-tarefa="${CSS.escape(recusa.tarefa)}"].qd-com-aviso`) : null;

  /** A recusa sai (o tempo ou o Esc). Se o foco estava nela (ou caiu no vazio), volta ao card, não ao começo da página. */
  function sairDaRecusa(): void {
    const tarefa = recusa?.tarefa;
    const ativo = doc.activeElement;
    const tinhaFoco = naRecusa(ativo) || !ativo || ativo === doc.body;
    tirarRecusa();
    desenharVista();
    if (tarefa && tinhaFoco) visivel(vista() ?? doc, `[data-act="abrir-tarefa"][data-id="${CSS.escape(tarefa)}"]`)?.focus();
  }

  /** O Desfazer de um movimento (o eco do agente no card, ou o último do histórico da tarefa aberta). */
  function desfazerMovimento(movimento: string): void {
    const t = q?.tarefas.find((x) => x.movimentos?.some((m) => m.id === movimento));
    const m = t?.movimentos?.find((x) => x.id === movimento);
    if (!t || !m) return;
    void mexer((a, de) => a.desfazerMovimento?.(de, t.id, movimento), `${t.titulo} voltou para ${colunaDe(m.de)?.nome ?? m.de}`);
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
    if (act === "col-trava") { editar(edicao?.tipo === "trava" && edicao.coluna === id ? null : { tipo: "trava", coluna: id }); return; }
    if (act === "col-trava-pessoa") {
      const c = colunaDe(id);
      if (!c) return;
      const so = c.trava?.soPessoa !== true;
      void mexer((a, de) => a.travarColuna?.(de, id, { so_pessoa: so }), so ? `De ${c.nome} só você tira a tarefa` : `${c.nome}: o agente também tira a tarefa`);
      return;
    }
    if (act === "col-prazo") { editar({ tipo: "prazo", coluna: id, ...(folha ? { naFolha: true } : {}) }); return; }
    if (act === "col-prazo-tirar") {
      const c = colunaDe(id);
      if (c) void mexer((a, de) => a.prazoDaColuna?.(de, id, null), `${c.nome} sem prazo`, focoDoPrazo(id, folha), folha ? { tipo: "ordem" } : null);
      return;
    }
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
    if (qual === "col-renomear" || qual === "col-nova" || qual === "col-remover" || qual === "col-passagem" || qual === "col-trava" || qual === "col-prazo") { ev.preventDefault(); enviarColuna(form); return; }
    if (qual === "adicionar-pessoa") { ev.preventDefault(); void adicionarPessoa(form); return; }
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
    if (campo === "modo-conversa") {
      const modo = (el as HTMLSelectElement).value as ModoConversa;
      if (modo === q?.modoConversa) return;
      void mexerNasPessoas((a, de) => a.mudarModo?.(de, modo), modo === "so_dono" ? "Agora só você conversa com o quadro" : "Agora cada um conversa pela própria conversa", "#qd-modo-sel");
      return;
    }
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
    // NOD-420: a resposta também (no card e na tarefa aberta); a composição do IME (keyCode 229) não envia.
    if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing && ev.keyCode !== 229 && el instanceof HTMLTextAreaElement && (el.id === "qc-txt" || el.classList.contains("qd-com-in") || el.classList.contains("qd-resp-in"))) {
      ev.preventDefault();
      // Responder vazio não envia (revisão do PR #624): o Enter só não pula linha.
      if (el.classList.contains("qd-resp-in") && !el.value.trim()) return;
      el.form?.requestSubmit();
    } else if (ev.key === "Escape" && naRecusa(el)) {
      ev.preventDefault();
      sairDaRecusa();
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
  // NOD-420 (revisão do PR #624): o campo Responder mora dentro do card arrastável. Medido em 2026-11-02 no Chrome (teste
  // quadro-jornada-chrome): selecionar sobre o texto já funcionava, mas apertar na borda de dentro do campo (o padding,
  // que ainda é o textarea) e arrastar pegava o card. Desligar no pointerdown chega tarde (o Chrome decide no apertar):
  // o card deixa de arrastar quando o ponteiro entra no campo ou o foco chega nele, e volta quando os dois saem.
  const cardDoCampo = (alvo: EventTarget | null): HTMLElement | null =>
    alvo instanceof HTMLTextAreaElement || alvo instanceof HTMLInputElement ? alvo.closest<HTMLElement>("#quadro li.qd-card[data-tarefa]") : null;
  const segurarCard = (ev: Event) => {
    const li = cardDoCampo(ev.target);
    if (li?.getAttribute("draggable") === "true") { li.setAttribute("draggable", "false"); li.dataset["arrastavel"] = "1"; }
  };
  const soltarCard = (ev: Event) => {
    const campo = ev.target as HTMLElement;
    const li = cardDoCampo(campo);
    if (li?.dataset["arrastavel"] !== "1") return;
    // Saiu o ponteiro mas o foco segue no campo (ou o contrário): continua sem arrastar.
    if (ev.type === "pointerout" ? doc.activeElement === campo : campo.matches(":hover")) return;
    li.setAttribute("draggable", "true");
    delete li.dataset["arrastavel"];
  };
  doc.addEventListener("pointerover", segurarCard);
  doc.addEventListener("focusin", segurarCard);
  doc.addEventListener("pointerout", soltarCard);
  doc.addEventListener("focusout", soltarCard);
  doc.addEventListener("dragstart", (ev) => {
    const li = (ev.target as Element | null)?.closest?.<HTMLElement>("#quadro li.qd-card[draggable='true'][data-tarefa]");
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
    const naoRecebe = porqueNaoRecebeCard(c, nome);
    if (naoRecebe) { desenharVista(); mudarFaixa({ tipo: "erro", texto: naoRecebe }); return; }
    pessoaSolta(tarefa, c);
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

  // O teclado do tablist (APG, ativação automática): ← → Home End trocam de página e levam o foco. No nome do bot (a
  // pílula), só as setas: Home e End ficam para quem lê.
  doc.addEventListener("keydown", (ev) => {
    const alvo = ev.target as Element | null;
    const aba = alvo?.closest?.<HTMLElement>("#cabecalho .pg-ic");
    const noNome = !aba && !!alvo?.closest?.("#cabecalho .qd-pil > .pilula-bot") && (ev.key === "ArrowLeft" || ev.key === "ArrowRight");
    // Alt+← → no ícone focado move a página na ordem (a alternativa ao arrasto).
    const mover = aba && ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey ? passoDaTeclaDeMover(ev.key) : null;
    if (mover && aba) {
      ev.preventDefault();
      const de = posDe(Number(aba.dataset["pagina"]));
      moverPagina(de, de + mover, { foco: true });
      return;
    }
    if ((!aba && !noNome) || ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey) return;
    const prox = paginaPelaTecla(posDe(pagina), paginas.length, ev.key);
    if (prox === null) return;
    ev.preventDefault();
    irPara(naPos(prox), { foco: !!aba });
  });

  const abaDe = (alvo: EventTarget | null): HTMLElement | null => (alvo as Element | null)?.closest?.<HTMLElement>("#cabecalho .pg-ic") ?? null;
  doc.addEventListener("focusin", (ev) => {
    const el = abaDe(ev.target);
    abaFocada = el ? { el, pagina: Number(el.dataset["pagina"]) } : null;
  });
  // A recusa da trava não some com a pessoa no card: o foco ou o ponteiro seguram a conta (revisão 2 do PR #629).
  doc.addEventListener("focusin", (ev) => { if (naRecusa(ev.target)) relogio?.segurar("foco"); else relogio?.soltar("foco"); });
  doc.addEventListener("focusout", (ev) => { if (!naRecusa(ev.relatedTarget)) relogio?.soltar("foco"); });
  doc.addEventListener("pointerover", (ev) => { if (naRecusa(ev.target)) relogio?.segurar("ponteiro"); else relogio?.soltar("ponteiro"); });
  // A pessoa tirou o foco da aba com um clique ou toque fora dela (no vazio o foco cai no body, sem focusin): esquece.
  // Não dá para usar o focusout: o Chrome também o dispara quando a regravação tira o nó, e aí o foco tem de voltar.
  doc.addEventListener("pointerdown", (ev) => { if (!abaDe(ev.target)) abaFocada = null; }, true);

  /** A conexão voltou sem o replay (SSE resumed:false): relê o quadro e, com um pedido esperando, a conversa. */
  function reler(): void {
    if (!dd || chave === null || !agenteId) return;
    pedirReleitura();
    if (faixa.tipo === "aguardando" || histAberto) void lerConversa();
  }

  /* ---------- NOD-445: o menu do ícone (segurar, botão direito, Shift+F10 ou a tecla de menu) ---------- */
  let menu: { id: string; volta: string } | null = null;
  function fecharMenu(foco = false): void {
    const m = doc.getElementById("pg-menu");
    if (m) m.remove();
    const volta = menu?.volta;
    menu = null;
    if (foco && volta) doc.querySelector<HTMLElement>(`#cabecalho .pg-ic[data-pg-id="${volta}"]`)?.focus();
  }
  function abrirMenu(i: number, ancora: HTMLElement | null): void {
    const p = paginas[i];
    if (!p || chave === null || paginas.length < 2) return;
    fecharMenu();
    const r = ancora?.getBoundingClientRect();
    doc.body.insertAdjacentHTML("beforeend", menuDaPagina({ p, pos: posDe(i), total: paginas.length }));
    const m = doc.getElementById("pg-menu");
    if (!m) return;
    if (r) { m.style.top = `${Math.round(r.bottom + 6)}px`; m.style.left = `${Math.round(Math.max(8, r.left))}px`; }
    menu = { id: p.id, volta: p.id };
    m.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled])')?.focus();
  }
  function noMenu(act: string): void {
    const i = indicePeloId(paginas, menu?.id);
    const p = paginas[i];
    if (!p) { fecharMenu(); return; }
    if (act === "pagina-antes" || act === "pagina-depois") {
      fecharMenu();
      const de = posDe(i);
      moverPagina(de, de + (act === "pagina-antes" ? -1 : 1), { foco: true });
      return;
    }
    fecharMenu();
    if (act === "app-editar") o.paginas?.editarApp(p);
    else if (act === "app-remover") o.paginas?.removerApp(p);
  }
  doc.addEventListener("click", (ev) => {
    const alvo = ev.target as Element | null;
    const m = alvo?.closest?.<HTMLElement>("#pg-menu");
    if (m) {
      const it = alvo?.closest?.<HTMLElement>('[role="menuitem"]');
      if (it && it.getAttribute("aria-disabled") !== "true") noMenu(it.dataset["act"] ?? "");
      return;
    }
    if (menu) fecharMenu();
    const el = alvo?.closest?.<HTMLElement>("[data-act]");
    const act = el?.dataset["act"];
    if (act === "pedir-app" && el?.closest("#cabecalho")) {
      if (el.getAttribute("aria-disabled") === "true") anunciarPagina(el.getAttribute("aria-label") ?? "");
      else o.paginas?.pedirApp();
    } else if (act === "app-reconectar" && el?.closest("#quadro")) {
      const p = paginas.find((x) => x.app?.id === el.dataset["app"]);
      if (p) o.paginas?.reconectar(p);
    }
  });
  doc.addEventListener("contextmenu", (ev) => {
    const ic = (ev.target as Element | null)?.closest?.<HTMLElement>("#cabecalho .pg-ic");
    if (!ic) return;
    ev.preventDefault();
    abrirMenu(Number(ic.dataset["pagina"]), ic);
  });
  doc.addEventListener("keydown", (ev) => {
    const alvo = ev.target as Element | null;
    const m = alvo?.closest?.<HTMLElement>("#pg-menu");
    if (m) {
      const itens = [...m.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled])')];
      const at = itens.indexOf(alvo as HTMLElement);
      if (ev.key === "Escape" || ev.key === "Tab") { ev.preventDefault(); fecharMenu(true); return; }
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") { ev.preventDefault(); itens[(at + (ev.key === "ArrowDown" ? 1 : itens.length - 1)) % itens.length]?.focus(); return; }
      return;
    }
    const ic = alvo?.closest?.<HTMLElement>("#cabecalho .pg-ic");
    if (ic && (ev.key === "ContextMenu" || (ev.shiftKey && ev.key === "F10"))) { ev.preventDefault(); abrirMenu(Number(ic.dataset["pagina"]), ic); }
  });

  /** false = não andou (sem pílula, uma página só ou já na ponta). */
  function andar(passo: -1 | 1): boolean {
    if (chave === null || paginas.length < 2) return false;
    const pos = posDe(pagina) + passo;
    if (pos < 0 || pos >= paginas.length) return false;
    irPara(naPos(pos));
    return true;
  }
  /** Quantas páginas a pílula mostra agora (0 = sem pílula: experimento desligado ou outra tela). */
  const totalDePaginas = (): number => (chave === null ? 0 : paginas.length);
  function abrirPagina(id: string): void {
    const i = indicePeloId(paginas, id);
    if (i >= 0) irPara(i);
  }
  function marcarChegada(id: string): void {
    chegou = { id, ate: Date.now() + 1200 };
    marcar();
  }

  ligarGestosDaPilula(doc, {
    irPara: (pos) => irPara(naPos(pos)), atual: () => posDe(pagina), total: totalDePaginas, reduzido,
    mover: (de, para) => moverPagina(de, para), menu: (pos, el) => abrirMenu(naPos(pos), el),
  });

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
      if (modo !== "quadro") trocar("quadro", { pagina: paginaDasTarefas() });
      else if (pagina !== paginaDasTarefas()) irPara(paginaDasTarefas());
      abrirTarefa(tarefaId);
      return;
    }
    pendente = { agenteId: de, tarefaId };
    if (modo !== "quadro") trocar("quadro", { pagina: paginaDasTarefas() });
    else if (pagina !== paginaDasTarefas()) irPara(paginaDasTarefas());
    else void lerQuadro();
  }

  /** NOD-445: a página Tarefas da pílula (a 1 sem pílula). */
  function paginaDasTarefas(): number {
    return Math.max(1, indicePeloId(paginas, TAREFAS.id));
  }

  return { sincronizar, trocar, irPara, andar, totalDePaginas, abrirPagina, marcarChegada, aoFrame, reler, abrirTarefaDe, modo: () => modo, pagina: () => pagina, abrirTarefa: abrirPeloLink };
}
