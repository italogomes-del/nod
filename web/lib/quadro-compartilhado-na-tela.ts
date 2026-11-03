import type { FrameSse } from "../../src/contracts/frame.ts";
import type { LinhaMuralDto, QuadroDto, TarefaDto } from "../../src/contracts/quadro.ts";
import type { MutacaoQuadro } from "./api.ts";
import { ErroApi } from "./erro-api.ts";
import { deveRecarregar, donoDaTarefa, ehMinha, estadoDoErro, podeEditar, podeMudarStatus, textoDaRecusa } from "./quadro-compartilhado.ts";
import { quadroCompartilhado, type CargaDoCompartilhado, type VistaDoCompartilhado } from "../telas/quadro-compartilhado.ts";
import type { AgenteDoQuadro } from "../telas/quadro-real.ts";

/**
 * NOD-455 (ADR-143): o quadro da dona na tela de quem participa. Lê só pelas rotas `/quadros/:qid…` (nunca as
 * `/agentes/:id/…` da dona), desenha no `#qcp` (o casco que o main põe em #timeline e não regrava) e trata as ações
 * `qcp-*` ali dentro. A mudança é otimista: o card muda na hora e volta, com a frase, se o servidor recusar (403,
 * nao_permitido: a tarefa mudou de dona, o modo mudou). Um `quadro.mudou` deste quadro relê sem piscar; o 404 na
 * releitura (a pessoa saiu do quadro) vira "sem acesso" e a linha sai da barra.
 */

export type ApiDoCompartilhado = {
  quadroPorId(qid: string): Promise<{ quadro: QuadroDto }>;
  atividadeDoQuadro(qid: string): Promise<{ linhas: LinhaMuralDto[] }>;
  criarTarefaNoQuadro(qid: string, campos: { titulo: string; descricao?: string }): Promise<MutacaoQuadro>;
  mudarTarefaNoQuadro(qid: string, tarefaId: string, campos: { status?: string; titulo?: string; descricao?: string; excluir?: true }): Promise<MutacaoQuadro>;
  responderNoQuadro(qid: string, tarefaId: string, resposta: string): Promise<MutacaoQuadro>;
  desfazerNoQuadro(qid: string, loteId: string): Promise<MutacaoQuadro>;
  comentarNoQuadro(qid: string, c: { texto: string; tarefa?: string }): Promise<MutacaoQuadro>;
};

export type DepsDoCompartilhado = {
  api: () => ApiDoCompartilhado;
  agente: AgenteDoQuadro;
  hora: (em: number) => string;
  /** O agrupador das releituras ao vivo (padrão: 250 ms, como a tela da dona). */
  agendar?: (f: () => void) => void;
  /** "Voltar para o início". */
  aoSair: () => void;
  /** O acesso mudou (saiu do quadro): a barra relê a lista de compartilhados. */
  aoPerderAcesso: (qid: string) => void;
};

export type QuadroCompartilhadoNaTela = {
  /** Abre (ou reabre) o quadro: esqueleto, depois o quadro, o erro ou o "sem acesso". */
  abrir(qid: string): void;
  fechar(): void;
  /** O quadro aberto (null = a tela é outra). */
  atual(): string | null;
  /** Desenha no `#qcp` quando o casco acabou de entrar (o main chama depois de cada render). */
  montar(): void;
  aoFrame(frame: FrameSse): void;
  /** O SSE reconectou: relê o quadro aberto (os frames do intervalo se perderam). */
  reler(): void;
};

type Acao = "excluir" | "editar" | "status" | "responder" | "desfazer" | "pedir" | "comentar";

export function criarQuadroCompartilhadoNaTela(doc: Document, deps: DepsDoCompartilhado): QuadroCompartilhadoNaTela {
  let qid: string | null = null;
  let vista: VistaDoCompartilhado = vazia({ tipo: "carregando" });
  /** Cada leitura leva um número: a resposta velha (outro quadro, ou ultrapassada por uma mais nova) é descartada. */
  let leitura = 0;
  /** Cada abertura (e cada fechar) ganha um número: a resposta de uma ação de antes não cai na vista de agora. */
  let abertura = 0;
  /** Um frame chegou com uma ação em voo: relê quando ela acabar (não descarta). */
  let releituraPendente = false;
  let agendada = false;
  const agendar = deps.agendar ?? ((f: () => void) => { setTimeout(f, 250); });

  function vazia(carga: CargaDoCompartilhado): VistaDoCompartilhado {
    return { carga, aberta: null, editando: null, recusa: null, alternadas: new Set(), ocupado: false };
  }
  const caixa = (): HTMLElement | null => doc.getElementById("qcp");
  const quadroAtual = (): QuadroDto | null => (vista.carga.tipo === "pronto" ? vista.carga.q : null);

  /** Redesenha guardando o que a pessoa digita e o foco (a releitura ao vivo não apaga o campo). */
  function desenhar(): void {
    const el = caixa();
    if (!el) return;
    const campos = [...el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input[id], textarea[id]")].map((c) => ({ id: c.id, valor: c.value, inicial: c.defaultValue }));
    const ativo = doc.activeElement instanceof HTMLElement && el.contains(doc.activeElement) ? doc.activeElement : null;
    const foco = ativo?.id || null;
    const sel = ativo instanceof HTMLInputElement || ativo instanceof HTMLTextAreaElement ? [ativo.selectionStart, ativo.selectionEnd] as const : null;
    el.innerHTML = quadroCompartilhado(vista, { agente: deps.agente, hora: deps.hora });
    el.dataset["qid"] = qid ?? "";
    for (const c of campos) {
      const novo = doc.getElementById(c.id);
      if ((novo instanceof HTMLInputElement || novo instanceof HTMLTextAreaElement) && el.contains(novo) && c.valor !== c.inicial) novo.value = c.valor;
    }
    if (foco) {
      const novo = doc.getElementById(foco);
      if (novo && el.contains(novo)) {
        novo.focus();
        if (sel && (novo instanceof HTMLInputElement || novo instanceof HTMLTextAreaElement)) { try { novo.setSelectionRange(sel[0], sel[1]); } catch { /* o tipo não tem seleção */ } }
      }
    }
  }

  function mudar(p: Partial<VistaDoCompartilhado>): void {
    vista = { ...vista, ...p };
    desenhar();
  }

  async function ler(o: { esqueleto: boolean }): Promise<void> {
    const alvo = qid;
    if (!alvo) return;
    const n = ++leitura;
    if (o.esqueleto) mudar({ carga: { tipo: "carregando" } });
    try {
      const { quadro } = await deps.api().quadroPorId(alvo);
      if (n !== leitura || alvo !== qid) return;
      const mural = vista.carga.tipo === "pronto" ? vista.carga.mural : null;
      // A tarefa aberta que sumiu (excluída, desfeita) fecha o detalhe.
      const aberta = vista.aberta && quadro.tarefas.some((t) => t.id === vista.aberta) ? vista.aberta : null;
      mudar({ carga: { tipo: "pronto", q: quadro, mural }, aberta, editando: aberta ? vista.editando : null });
      void lerMural(alvo, n);
    } catch (e) {
      if (n !== leitura || alvo !== qid) return;
      const estado = estadoDoErro(e);
      // Na releitura (já estava na tela), só o "sem acesso" troca a tela; um erro de rede mantém o que se via.
      if (!o.esqueleto && estado === "erro" && vista.carga.tipo === "pronto") return;
      mudar({ carga: { tipo: estado }, aberta: null, editando: null, recusa: null });
      if (estado === "fora") deps.aoPerderAcesso(alvo);
    }
  }

  async function lerMural(alvo: string, n: number): Promise<void> {
    try {
      const { linhas } = await deps.api().atividadeDoQuadro(alvo);
      if (n !== leitura || alvo !== qid || vista.carga.tipo !== "pronto") return;
      mudar({ carga: { ...vista.carga, mural: linhas } });
    } catch {
      if (n !== leitura || alvo !== qid || vista.carga.tipo !== "pronto") return;
      mudar({ carga: { ...vista.carga, mural: [] } });
    }
  }

  /** O quadro com uma tarefa trocada (ou tirada): o otimista. */
  function comTarefa(q: QuadroDto, id: string, f: (t: TarefaDto) => TarefaDto | null): QuadroDto {
    const tarefas = q.tarefas.flatMap((t) => (t.id === id ? (f(t) ?? []) : [t]));
    return { ...q, tarefas, total: tarefas.length };
  }

  /**
   * Manda a mudança. `otimista` é o quadro já mudado (ou null, sem otimista). Na recusa, volta ao de antes, diz por quê
   * (com o dono novo, quando a tarefa mudou de mãos) e relê.
   */
  async function enviar(acao: Acao, tarefaId: string | null, otimista: QuadroDto | null, chamar: (api: ApiDoCompartilhado, qid: string) => Promise<MutacaoQuadro>, depois?: () => void): Promise<boolean> {
    const alvo = qid;
    // A abertura em que a ação saiu: trocar de sessão (fechar) ou reabrir o mesmo quadro a invalida.
    const minha = abertura;
    const valendo = () => minha === abertura && alvo === qid;
    const antes = quadroAtual();
    // Ocupado: a ação não sai, e a tela volta ao que vale (o select não fica num status que não foi enviado).
    if (!alvo || !antes || vista.ocupado) { desenhar(); return false; }
    // A mudança invalida a leitura em voo (ela traria o quadro de antes por cima do otimista).
    leitura++;
    mudar({ ocupado: true, recusa: null, ...(otimista && vista.carga.tipo === "pronto" ? { carga: { ...vista.carga, q: otimista } } : {}) });
    try {
      const r = await chamar(deps.api(), alvo);
      if (!valendo()) return false;
      depois?.();
      if (r.quadro && vista.carga.tipo === "pronto") mudar({ carga: { ...vista.carga, q: r.quadro }, ocupado: false });
      else mudar({ ocupado: false });
      void ler({ esqueleto: false });
      return true;
    } catch (e) {
      if (!valendo()) return false;
      if (vista.carga.tipo === "pronto") vista = { ...vista, carga: { ...vista.carga, q: antes } };
      if (e instanceof ErroApi && (e.status === 404 || e.codigo === "nao_encontrado")) {
        // A tarefa sumiu (ou ela saiu do quadro: a releitura vira "sem acesso"). Revisão 4 (B2) e 5 (B3): não fica muda, com
        // tarefa ou sem (o desfazer que outra aba já fez, o recado).
        mudar({ ocupado: false, recusa: { tarefaId: null, texto: tarefaId ? "Essa tarefa não existe mais" : textoDaRecusa(acao, null) } });
        void ler({ esqueleto: false });
        return false;
      }
      const recusado = e instanceof ErroApi && (e.status === 403 || e.status === 409 || e.status === 400 || e.codigo === "nao_permitido");
      const dono = recusado ? await donoNovo(alvo, tarefaId, valendo) : null;
      // A releitura da recusa disse "sem acesso": a tela já virou, nada de frase por cima.
      if (!valendo() || vista.carga.tipo !== "pronto") return false;
      const texto = recusado ? textoDaRecusa(acao, dono)
        : e instanceof ErroApi ? "Não deu agora. Tente de novo em instantes." : "Sem conexão com o servidor agora. Tente de novo em instantes.";
      mudar({ ocupado: false, recusa: { tarefaId: tarefaId && vista.aberta === tarefaId ? tarefaId : null, texto } });
      return false;
    } finally {
      if (releituraPendente && valendo()) { releituraPendente = false; relerAoVivo(); }
    }
  }

  /** A releitura ao vivo, agrupada: uma rajada de frames vira uma leitura. */
  function relerAoVivo(): void {
    if (!qid) return;
    if (vista.ocupado) { releituraPendente = true; return; }
    if (agendada) return;
    agendada = true;
    agendar(() => {
      agendada = false;
      if (!qid) return;
      if (vista.ocupado) { releituraPendente = true; return; }
      void ler({ esqueleto: false });
    });
  }

  /** Relê o quadro e diz de quem a tarefa é agora (null = continua dela, ou sumiu). */
  async function donoNovo(alvo: string, tarefaId: string | null, valendo: () => boolean): Promise<string | null> {
    if (!tarefaId) { void ler({ esqueleto: false }); return null; }
    try {
      const n = ++leitura;
      const { quadro } = await deps.api().quadroPorId(alvo);
      if (n === leitura && valendo() && vista.carga.tipo === "pronto") vista = { ...vista, carga: { ...vista.carga, q: quadro } };
      const t = quadro.tarefas.find((x) => x.id === tarefaId);
      return t && !ehMinha(quadro, t) ? donoDaTarefa(quadro, t) : null;
    } catch (e) {
      // Tirada do quadro no meio: a mutação foi recusada e a releitura diz que não há mais acesso.
      // Revisão 4 (B3): só na abertura em que a ação saiu (a sessão nova do mesmo quadro não vira "sem acesso" por ela).
      if (estadoDoErro(e) === "fora" && valendo()) {
        mudar({ carga: { tipo: "fora" }, aberta: null, editando: null, recusa: null, ocupado: false });
        deps.aoPerderAcesso(alvo);
      }
      return null;
    }
  }

  function tarefa(id: string): TarefaDto | null {
    return quadroAtual()?.tarefas.find((t) => t.id === id) ?? null;
  }

  function mudarStatus(id: string, status: string): void {
    const q = quadroAtual();
    const t = tarefa(id);
    if (!q || !t || t.status === status || !podeMudarStatus(q, t)) return;
    void enviar("status", id, comTarefa(q, id, (x) => ({ ...x, status })), (api, alvo) => api.mudarTarefaNoQuadro(alvo, id, { status }));
  }

  function excluir(id: string): void {
    const q = quadroAtual();
    const t = tarefa(id);
    if (!q || !t || !podeEditar(q, t)) return;
    // Otimista: a tarefa sai e o detalhe fecha; na recusa, ela volta aberta, com a frase.
    vista = { ...vista, aberta: null, editando: null };
    void enviar("excluir", id, comTarefa(q, id, () => null), (api, alvo) => api.mudarTarefaNoQuadro(alvo, id, { excluir: true })).then((ok) => {
      if (!ok && tarefa(id)) mudar({ aberta: id, recusa: vista.recusa ? { ...vista.recusa, tarefaId: id } : null });
    });
  }

  function editar(form: HTMLFormElement): void {
    const id = form.dataset["id"] ?? "";
    const q = quadroAtual();
    const t = tarefa(id);
    if (!q || !t || !podeEditar(q, t)) return;
    const titulo = (form.elements.namedItem("titulo") as HTMLInputElement | null)?.value.trim() ?? "";
    const descricao = (form.elements.namedItem("descricao") as HTMLTextAreaElement | null)?.value ?? "";
    if (!titulo) return;
    vista = { ...vista, editando: null, rascunho: null };
    // Na recusa (ou sem rede), o formulário reabre com o que ela digitou: o revert é do card, não do texto dela.
    void enviar("editar", id, comTarefa(q, id, (x) => ({ ...x, titulo, descricao })), (api, alvo) => api.mudarTarefaNoQuadro(alvo, id, { titulo, descricao })).then((ok) => {
      if (!ok && tarefa(id) && vista.carga.tipo === "pronto") mudar({ editando: id, rascunho: { titulo, descricao } });
    });
  }

  function textoDo(form: HTMLFormElement, nome: string): string {
    return (form.elements.namedItem(nome) as HTMLInputElement | HTMLTextAreaElement | null)?.value.trim() ?? "";
  }
  function limpar(form: HTMLFormElement, nome: string): () => void {
    const id = (form.elements.namedItem(nome) as HTMLElement | null)?.id;
    return () => { const c = id ? doc.getElementById(id) : null; if (c instanceof HTMLInputElement || c instanceof HTMLTextAreaElement) c.value = ""; };
  }

  doc.addEventListener("click", (ev) => {
    const el = (ev.target as Element | null)?.closest?.<HTMLElement>("[data-act]");
    if (!el || !qid || !el.closest("#qcp")) return;
    const act = el.dataset["act"];
    const id = el.dataset["id"] ?? "";
    if (act === "qcp-reler") { void ler({ esqueleto: true }); return; }
    if (act === "qcp-inicio") { deps.aoSair(); return; }
    if (act === "abrir-tarefa" && id) { mudar({ aberta: id, editando: null, recusa: null }); doc.getElementById("qcp-t-tit")?.focus(); return; }
    if (act === "qcp-voltar") { const de = vista.aberta; mudar({ aberta: null, editando: null, recusa: null }); if (de) doc.querySelector<HTMLElement>(`#qcp [data-act="abrir-tarefa"][data-id="${CSS.escape(de)}"]`)?.focus(); return; }
    if (act === "abrir-coluna") {
      const st = el.dataset["status"] ?? "";
      const alt = new Set(vista.alternadas);
      if (alt.has(st)) alt.delete(st); else alt.add(st);
      mudar({ alternadas: alt });
      return;
    }
    if (act === "qcp-editar" && id) { mudar({ editando: id, rascunho: null, recusa: null }); doc.getElementById("qcp-ed-tit")?.focus(); return; }
    if (act === "qcp-cancelar-edicao") { mudar({ editando: null }); return; }
    if (act === "qcp-excluir" && id) { excluir(id); return; }
    if (act === "qcp-desfazer" && id) { void enviar("desfazer", null, null, (api, alvo) => api.desfazerNoQuadro(alvo, id)); return; }
  });

  doc.addEventListener("change", (ev) => {
    const el = ev.target;
    if (!(el instanceof HTMLSelectElement) || !qid || !el.closest("#qcp") || el.dataset["campo"] !== "qcp-status") return;
    mudarStatus(el.dataset["id"] ?? "", el.value);
  });

  doc.addEventListener("submit", (ev) => {
    const form = ev.target instanceof HTMLFormElement ? ev.target : null;
    if (!form || !qid || !form.closest("#qcp")) return;
    const qual = form.dataset["form"];
    if (!qual?.startsWith("qcp-")) return;
    ev.preventDefault();
    ev.stopPropagation();
    const id = form.dataset["id"] ?? "";
    if (qual === "qcp-editar") { editar(form); return; }
    if (qual === "qcp-responder") {
      const resposta = textoDo(form, "resposta");
      if (resposta) void enviar("responder", id, null, (api, alvo) => api.responderNoQuadro(alvo, id, resposta), limpar(form, "resposta"));
      return;
    }
    if (qual === "qcp-comentar") {
      const texto = textoDo(form, "texto");
      if (texto) void enviar("comentar", id, null, (api, alvo) => api.comentarNoQuadro(alvo, { texto, tarefa: id }), limpar(form, "texto"));
      return;
    }
    if (qual === "qcp-recado") {
      const texto = textoDo(form, "texto");
      if (texto) void enviar("comentar", null, null, (api, alvo) => api.comentarNoQuadro(alvo, { texto }), limpar(form, "texto"));
      return;
    }
    if (qual === "qcp-pedir") {
      const titulo = textoDo(form, "texto");
      if (titulo) void enviar("pedir", null, null, (api, alvo) => api.criarTarefaNoQuadro(alvo, { titulo }), limpar(form, "texto"));
    }
  }, true);

  return {
    abrir(novo) {
      if (novo === qid && vista.carga.tipo === "pronto") { mudar({ aberta: null, editando: null, recusa: null }); return; }
      qid = novo;
      abertura++;
      vista = vazia({ tipo: "carregando" });
      desenhar();
      void ler({ esqueleto: true });
    },
    fechar() { qid = null; leitura++; abertura++; releituraPendente = false; vista = vazia({ tipo: "carregando" }); },
    atual: () => qid,
    montar() {
      const el = caixa();
      if (el && qid && el.dataset["qid"] !== qid) desenhar();
    },
    aoFrame(frame) {
      if (qid && deveRecarregar(frame, qid)) relerAoVivo();
    },
    reler() { relerAoVivo(); },
  };
}
