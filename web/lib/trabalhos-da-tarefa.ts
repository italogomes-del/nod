/**
 * NOD-418 (definido em 2026-11-02): o trabalho da tarefa aberta no quadro: o estado, a leitura, os frames ao vivo e as
 * ações (Repetir, Cancelar, recado). Fora do quadro-na-tela.ts para ele não crescer: o quadro só liga (abrir, fechar,
 * frames, cliques, o envio do recado). Uma leitura velha (outra tarefa, outro bot) é descartada.
 *
 * O log ao vivo junta os frames do turno que roda agora na cadeia do trabalho (`turnoAtual`: depois de uma queda é a
 * retomada) com as mesmas funções da conversa (comTexto, comFerramenta, comFimDaAcao); vale desde que a tarefa abriu.
 */
import type { QuadroDto } from "../../src/contracts/quadro.ts";
import type { ExecucoesDaTarefa } from "../../src/contracts/quadro-execucoes.ts";
import { anuncioDoTrabalho, logDoTrabalho, secaoDoTrabalho, vivo } from "../telas/trabalhos-da-tarefa.ts";
import { ErroApi } from "./erro-api.ts";
import { GESTO_MS } from "./quadro.ts";
import { comFerramenta, comFimDaAcao, comTexto, SEM_NOME_DA_FERRAMENTA, type AtividadeTurno, type FerramentaEmUso } from "./atividade.ts";

export type SaidaDoTrabalho = { ok?: boolean; quadro?: QuadroDto | null; trabalho?: { entregue?: "agora" | "quando_comecar" | "novo" }; trabalhos?: ExecucoesDaTarefa; detalhe?: string };

/** O pedaço da API dos trabalhos (opcional na ApiDoQuadro: sem ele, a seção não aparece). */
export interface ApiDosTrabalhos {
  trabalhosDaTarefa?(agenteId: string, tarefaId: string): Promise<ExecucoesDaTarefa>;
  repetirTrabalho?(agenteId: string, tarefaId: string): Promise<SaidaDoTrabalho>;
  cancelarTrabalho?(agenteId: string, tarefaId: string): Promise<SaidaDoTrabalho>;
  recadoTrabalho?(agenteId: string, tarefaId: string, texto: string): Promise<SaidaDoTrabalho>;
}

export type FrameDoTrabalho = { tipo: string; dados: Record<string, unknown> };
/** O pedaço do DOM que se usa (estrutural: o typecheck do servidor, que lê os testes, não tem a lib do DOM). */
type LugarDoLog = { dataset: Record<string, string | undefined>; innerHTML: string };
type Campo = { value: string };
/** A região role=status persistente (fora do bloco redesenhado): só o texto muda. */
type RegiaoDeAnuncio = { textContent: string | null };
const ehCampo = (c: unknown): c is Campo => typeof c === "object" && c !== null && typeof (c as { value?: unknown }).value === "string";

const texto = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const idDaAcao = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v) ? v : null);
function emUso(v: unknown): FerramentaEmUso {
  if (!v || typeof v !== "object") return SEM_NOME_DA_FERRAMENTA;
  const t = (v as Record<string, unknown>)["texto"];
  return typeof t === "string" && t.trim() ? { texto: t.trim().slice(0, 80), frentes: (v as Record<string, unknown>)["frentes"] === true } : SEM_NOME_DA_FERRAMENTA;
}

/** Puro: a atividade do turno depois de um frame dele (texto, ferramenta, fim de ferramenta); outro frame não muda nada. */
export function atividadeComFrame(a: AtividadeTurno | undefined, f: FrameDoTrabalho): AtividadeTurno | undefined {
  if (f.tipo === "turno.delta") return comTexto(a, typeof f.dados["texto"] === "string" ? f.dados["texto"] : "");
  if (f.tipo === "turno.atividade") return comFerramenta(a, texto(f.dados["rotulo"]) ?? "Usou uma ferramenta", emUso(f.dados["emUso"]), idDaAcao(f.dados["id"]));
  if (f.tipo === "turno.acao_fim") { const id = idDaAcao(f.dados["id"]); return id ? comFimDaAcao(a, id, f.dados["falhou"] === true) : a; }
  return a;
}

/** O turno que se escuta: o atual da cadeia do trabalho que roda (a retomada, depois de uma queda). */
export const turnoEscutado = (d: ExecucoesDaTarefa | null): string | null => {
  const e = d?.execucoes[0];
  return e && vivo(e) ? e.turnoAtual : null;
};

const AVISO_DO_RECADO = { agora: "Recado mandado: entra no próximo passo.", quando_comecar: "Recado guardado: entra quando o trabalho começar.", novo: "Recado mandado: virou um trabalho novo." } as const;

export function criarTrabalhosDaTarefa(o: {
  api: () => ApiDosTrabalhos | null;
  redesenhar: () => void;
  /** ADA-7: o redesenho depois de uma leitura que a pessoa não pediu (o frame); sem ele, o redesenhar. */
  redesenharLido?: () => void;
  log: () => LugarDoLog | null;
  /** O quadro novo depois de uma ação (o card muda de coluna, no Repetir da Bloqueada). */
  aplicarQuadro?: (q: QuadroDto | null) => void;
  /**
   * Revisão 5 do PR #625: a região role=status do quadro, criada vazia na montagem e fora do bloco que o innerHTML
   * recria (a região recriada a cada desenho não é lida). Só o textContent dela muda, e só quando o estado muda.
   */
  anuncio?: () => RegiaoDeAnuncio | null;
  juntarEm?: number;
  /**
   * ADA-7 (revisão 8): o gesto da pessoa segura a escrita do log desde `desde` (o quadro-na-tela decide o teto). Sem
   * ela, o log regrava na hora. O delta que chega na espera só atualiza o estado: escreve uma vez, com o último.
   */
  segura?: (desde: number) => boolean;
}) {
  let alvo: { agenteId: string; tarefaId: string } | null = null;
  let dados: ExecucoesDaTarefa | null = null;
  let erro = false;
  let passos = false;
  let anteriores = false;
  let aviso: string | null = null;
  // Revisão 4 do PR #625: o estado do trabalho atual da última leitura; mudou = um anúncio na região persistente.
  let chave: string | null = null;
  let ocupado = false;
  let leitura = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let logAdiado: ReturnType<typeof setTimeout> | null = null;
  const escreverLog = (desde: number): void => {
    logAdiado = null;
    if (o.segura?.(desde)) { logAdiado = setTimeout(() => escreverLog(desde), GESTO_MS); return; }
    // O estado da hora da escrita (o delta adiado pode ter ficado velho: outra execução, outro turno).
    const e = dados?.execucoes[0];
    const atividade = e ? atividades.get(e.turnoAtual) : undefined;
    const lugar = o.log();
    if (e && atividade && lugar && lugar.dataset["trabalho"] === e.id) lugar.innerHTML = logDoTrabalho(e, atividade, passos);
  };
  const atividades = new Map<string, AtividadeTurno>();

  function falar(texto: string): void {
    const r = o.anuncio?.();
    if (r && r.textContent !== texto) r.textContent = texto;
  }

  /** A frase da mudança de estado (null = a primeira leitura ou a mesma chave: nada a anunciar). */
  function guardar(r: ExecucoesDaTarefa): string | null {
    dados = r;
    erro = false;
    const e = r.execucoes[0];
    const nova = e ? `${e.numero}:${e.estado}:${e.esperando}` : "";
    const dito = chave !== null && nova !== chave && e ? anuncioDoTrabalho(e) : null;
    chave = nova;
    return dito;
  }

  const api = () => {
    const a = o.api();
    return a?.trabalhosDaTarefa ? a : null;
  };

  async function ler(): Promise<void> {
    const a = api();
    const de = alvo;
    if (!a?.trabalhosDaTarefa || !de) return;
    const n = ++leitura;
    // ADA-7 (revisão 3): a releitura que traz o mesmo trabalho não regrava a tarefa aberta (cada turno.iniciado de
    // qualquer bot relê).
    const antes = JSON.stringify([dados, erro]);
    try {
      const r = await a.trabalhosDaTarefa(de.agenteId, de.tarefaId);
      if (n !== leitura || de !== alvo) return;
      const dito = guardar(r);
      if (dito) falar(dito);
    } catch {
      if (n !== leitura || de !== alvo) return;
      erro = true;
    }
    if (JSON.stringify([dados, erro]) !== antes) (o.redesenharLido ?? o.redesenhar)();
  }

  function relerLogo(): void {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void ler(); }, o.juntarEm ?? 400);
  }

  async function agir(fazer: (agenteId: string, tarefaId: string) => Promise<SaidaDoTrabalho> | undefined, aoDar?: () => void): Promise<void> {
    const de = alvo;
    if (!de || ocupado) return;
    const p = fazer(de.agenteId, de.tarefaId);
    if (!p) return;
    ocupado = true;
    aviso = null;
    o.redesenhar();
    try {
      const r = await p;
      if (de !== alvo) return;
      if (r.ok === false) { aviso = r.detalhe ?? "Não consegui. Tente de novo."; falar(aviso); return; }
      leitura++;
      const dito = r.trabalhos ? guardar(r.trabalhos) : (void ler(), null);
      const entregue = r.trabalho?.entregue;
      if (entregue) aviso = AVISO_DO_RECADO[entregue];
      const fala = [dito, entregue ? aviso : null].filter(Boolean).join(". ");
      if (fala) falar(fala);
      aoDar?.();
      if (r.quadro !== undefined) o.aplicarQuadro?.(r.quadro);
    } catch (e) {
      // O 409 não abriu nada: o trabalho roda (o duplo clique, outra aba) ou a tarefa está fora do andamento (Feito,
      // Cancelado, Backlog: revisão 2 do PR #625).
      if (de === alvo) aviso = e instanceof ErroApi && e.codigo === "estado_invalido" ? (turnoEscutado(dados) ? "Já está rodando: cancele antes." : "A tarefa não está em andamento: mova-a antes.") : "Não consegui. Tente de novo.";
      if (de === alvo && aviso) falar(aviso);
    } finally {
      if (de === alvo) { ocupado = false; o.redesenhar(); }
    }
  }

  return {
    /** Com a API sem os trabalhos (os testes antigos), a tarefa aberta fica como era. */
    ligados: () => !!api(),
    abrir(agenteId: string, tarefaId: string): void {
      if (alvo?.agenteId === agenteId && alvo.tarefaId === tarefaId) { void ler(); return; }
      alvo = { agenteId, tarefaId };
      dados = null; erro = false; passos = false; anteriores = false; aviso = null; ocupado = false; chave = null; atividades.clear(); if (logAdiado) { clearTimeout(logAdiado); logAdiado = null; }
      void ler();
    },
    fechar(): void {
      alvo = null; dados = null; aviso = null; chave = null; leitura++; atividades.clear(); if (logAdiado) { clearTimeout(logAdiado); logAdiado = null; }
      if (timer) { clearTimeout(timer); timer = null; }
    },
    reler: ler,
    /** A seção; undefined = a API não tem os trabalhos (ou outra tarefa). */
    html(tarefaId: string, h: { bloqueada: boolean; agenteId: string | null; conversaAtual: string | null; hora: (em: number) => string }): string | undefined {
      if (!api() || alvo?.tarefaId !== tarefaId) return undefined;
      const atual = dados?.execucoes[0];
      return secaoDoTrabalho({
        tarefaId, dados, erro, bloqueada: h.bloqueada, agenteId: h.agenteId, conversaAtual: h.conversaAtual,
        atividade: atual ? atividades.get(atual.turnoAtual) : undefined, passosAbertos: passos, anterioresAbertos: anteriores, aviso, ocupado,
      }, h.hora);
    },
    aoFrame(f: FrameDoTrabalho): void {
      if (!alvo) return;
      const d = f.dados;
      if (f.tipo === "quadro.mudou") {
        if (typeof d["tarefas"] !== "string" || !d["tarefas"] || d["tarefas"].split(",").includes(alvo.tarefaId)) relerLogo();
        return;
      }
      const turno = texto(d["turnoId"]);
      if (f.tipo === "turno.iniciado" || f.tipo === "turno.encerrado" || f.tipo === "turno.interrompido" || f.tipo === "turno.falhou") {
        // O começo, o fim e a retomada de um turno da cadeia mudam o estado; um turno de outro lugar não.
        if (!dados || !turno || dados.execucoes.some((e) => e.turnoAtual === turno || e.turnoId === turno) || f.tipo === "turno.iniciado") relerLogo();
        return;
      }
      if (!turno || turno !== turnoEscutado(dados)) return;
      const antes = atividades.get(turno);
      const nova = atividadeComFrame(antes, f);
      if (!nova || nova === antes) return;
      atividades.set(turno, nova);
      // Só o log muda: o resto da tarefa (e o recado que a pessoa digita) fica. No gesto, espera o dedo (ADA-7).
      if (logAdiado === null) escreverLog(Date.now());
    },
    /** true = o clique era do trabalho. */
    aoClicar(act: string): boolean {
      const a = api();
      if (act === "trab-passos") { passos = !passos; o.redesenhar(); return true; }
      if (act === "trab-anteriores") { anteriores = !anteriores; o.redesenhar(); return true; }
      if (act === "trab-reler") { dados = null; erro = false; o.redesenhar(); void ler(); return true; }
      if (act === "trab-repetir") { void agir((ag, t) => a?.repetirTrabalho?.(ag, t)); return true; }
      if (act === "trab-cancelar") { void agir((ag, t) => a?.cancelarTrabalho?.(ag, t)); return true; }
      return false;
    },
    /** O envio do recado (o form `recado-trabalho`). O texto fica no campo se falhar. */
    enviarRecado(form: { dataset: Record<string, string | undefined>; querySelector(s: string): unknown; ownerDocument: { getElementById(id: string): unknown } }): void {
      const campo = form.querySelector("textarea");
      const t = ehCampo(campo) ? campo.value.trim() : "";
      if (!t || form.dataset["id"] !== alvo?.tarefaId) return;
      const a = api();
      const doc = form.ownerDocument;
      // O redesenho no meio troca o campo: limpa o que estiver na tela quando der certo.
      void agir((ag, tid) => a?.recadoTrabalho?.(ag, tid, t), () => { const c = doc.getElementById("qd-trab-recado"); if (ehCampo(c)) c.value = ""; });
    },
  };
}
