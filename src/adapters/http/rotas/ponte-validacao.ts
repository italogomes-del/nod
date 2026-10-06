import { CAUSAS_SEM_IA, MOTIVO_DA_CAUSA, type CausaSemIa, type Inventario } from "../../../contracts/inventario.ts";
import { motivoSondaLenta } from "../../../domain/sonda-lenta.ts";
import { MOTIVOS_FALHA, MOTIVOS_INTERRUPCAO, MOTIVOS_PASSE } from "../../../contracts/motivos.ts";
import type { Entrega, FalaIntermediaria, TrechoVivo } from "../../../contracts/ponte.ts";
import { TETO_COMANDOS, TETO_DESCRICAO_COMANDO, TETO_SO_DO_TERMINAL, type CatalogoDeComandos, type ComandoDoMac } from "../../../contracts/comandos.ts";
import {
  TETO_CHAMADAS_RAIO_X,
  TETO_COMPACTACOES_RAIO_X,
  TETO_FERRAMENTAS_POR_CHAMADA,
  TETO_FERRAMENTAS_RAIO_X,
  type ChamadaRaioX,
  type CompactacaoRaioX,
  type ExecucaoRaioX,
  type FerramentaNaChamada,
} from "../../../contracts/raio-x.ts";
import { ESTADOS_DA_TAREFA, type SinaisTurno, type TarefaDoBot } from "../../../contracts/turno.ts";
import { TETO_TAREFAS, TETO_TITULO_TAREFA } from "../../../domain/tarefas-do-bot.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { TEXTO_ENTREGA_MAX_CHARS } from "../../../shared/constantes.ts";
import { UUID } from "../roteador.ts";

export function exigir(condicao: unknown): asserts condicao {
  if (!condicao) throw new ErroDeDominio("entrada_invalida");
}
export function objeto(v: unknown): Record<string, unknown> {
  exigir(v && typeof v === "object" && !Array.isArray(v));
  return v as Record<string, unknown>;
}
export function texto(v: unknown, max = TEXTO_ENTREGA_MAX_CHARS): v is string { return typeof v === "string" && v.length <= max; }
/**
 * Trechos do turno vivo. São efêmeros: um item fora do formato é descartado sozinho e uma lista acima
 * dos tetos vira vazia, sem nunca derrubar a renovação (que é o lease do turno).
 */
export function trechos(v: unknown): TrechoVivo[] {
  if (!Array.isArray(v) || v.length > 2_000) return [];
  const saida: TrechoVivo[] = [];
  let total = 0;
  for (const t of v) {
    if (!t || typeof t !== "object" || Array.isArray(t)) continue;
    const o = t as Record<string, unknown>;
    if (Object.keys(o).length !== 1) continue;
    if (texto(o.texto, 16_000)) { total += o.texto.length; saida.push({ texto: o.texto }); }
    else if (texto(o.ferramenta, 200) && /^[A-Za-z0-9_.-]+$/.test(o.ferramenta)) saida.push({ ferramenta: o.ferramenta });
    else if (Array.isArray(o.tarefas)) { const t = tarefasDoTrecho(o.tarefas); if (t) saida.push({ tarefas: t }); }
  }
  return total > 16_000 ? [] : saida;
}
/** definido em 2026-10-01 (ADR-067): falas ainda não confirmadas que cabem numa renovação; acima disso o executor reenvia. */
const TETO_FALAS_POR_RENOVACAO = 50;
/**
 * Falas da sessão viva (ADR-067). Diferente dos trechos, cada fala vira mensagem gravada: fora do formato a
 * renovação inteira é recusada (entrada_invalida), e o executor as reenvia na próxima.
 */
export function falas(v: unknown): FalaIntermediaria[] {
  if (v === undefined) return [];
  exigir(Array.isArray(v) && v.length <= TETO_FALAS_POR_RENOVACAO);
  return v.map((f) => {
    const o = objeto(f);
    exigir(typeof o.seq === "number" && Number.isSafeInteger(o.seq) && o.seq >= 1 && texto(o.texto));
    return { seq: o.seq, texto: o.texto };
  });
}
/** A lista de tarefas do bot num trecho vivo: fora do formato ou acima dos tetos, o trecho some sozinho. */
function tarefasDoTrecho(v: unknown[]): TarefaDoBot[] | null {
  if (v.length > TETO_TAREFAS) return null;
  const saida: TarefaDoBot[] = [];
  for (const bruta of v) {
    const t = (bruta && typeof bruta === "object" ? bruta : {}) as Record<string, unknown>;
    if (!texto(t.id, 40) || !texto(t.titulo, TETO_TITULO_TAREFA) || !ESTADOS_DA_TAREFA.some((e) => e === t.estado)) return null;
    saida.push({ id: t.id, titulo: t.titulo, estado: t.estado as TarefaDoBot["estado"] });
  }
  return saida;
}
export function uuid(v: unknown): string { exigir(typeof v === "string" && UUID.test(v)); return v; }
export function sinais(v: unknown): SinaisTurno {
  const s = objeto(v);
  exigir(["attempted", "rejected", "promptSubmitted", "producedOutput"].every((k) => typeof s[k] === "boolean"));
  return { attempted: s.attempted as boolean, rejected: s.rejected as boolean, promptSubmitted: s.promptSubmitted as boolean, producedOutput: s.producedOutput as boolean };
}
/** `nome`: o harness anunciado (ex.: "Codex"), para a frase de lentidão dizer quem demorou. */
export function inventario(v: unknown, agora: number, nome = "harness"): Inventario {
  const i = objeto(v);
  if (i.estado === "pronto") { exigir(texto(i.versao, 100)); return { estado: "pronto", versao: i.versao, em: agora }; }
  exigir(i.estado === "ausente" || i.estado === "nao_autenticado");
  // NOD-178: a causa atravessa (só o valor conhecido), e o motivo continua reescrito aqui, nunca o texto do Mac.
  if (i.causa === "sonda_lenta") return { estado: i.estado, motivo: motivoSondaLenta(nome), causa: "sonda_lenta", em: agora };
  if (i.estado === "ausente") return { estado: "ausente", motivo: "Harness não encontrado neste computador", em: agora };
  // definido em 2026-10-05: a causa é código fechado e a frase é do servidor — texto do Mac nunca vira motivo.
  const causa = causaSemIa(i.causa);
  return { estado: "nao_autenticado", motivo: causa ? MOTIVO_DA_CAUSA[causa] : "Entre na conta do harness neste computador", ...(causa ? { causa } : {}), em: agora };
}
/** Só os códigos conhecidos passam; app antigo (sem o campo) ou valor estranho = sem causa. */
export function causaSemIa(v: unknown): CausaSemIa | undefined {
  return CAUSAS_SEM_IA.find((c) => c === v);
}
/** definido em 2026-10-05: o motivo cru do executor remoto é diagnóstico da pessoa; cabe em 8 KiB ou não entra. */
const ERRO_CRU_MAX_CHARS = 8_000;
const inteiro = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const inteiroOuNull = (v: unknown): v is number | null => v === null || inteiro(v);

/**
 * Raio-X da execução (modo dev, 0036). É telemetria: fora do formato ou acima dos tetos vira `undefined` e a
 * entrega segue — um turno nunca é recusado pelo Raio-X. Só os campos do contrato atravessam, reconstruídos aqui.
 */
export function execucao(v: unknown): ExecucaoRaioX | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const x = v as Record<string, unknown>;
  if (!Array.isArray(x.chamadas) || x.chamadas.length > TETO_CHAMADAS_RAIO_X || !Array.isArray(x.compactacoes) || x.compactacoes.length > TETO_COMPACTACOES_RAIO_X) return undefined;
  const chamadas: ChamadaRaioX[] = [];
  for (const bruta of x.chamadas as unknown[]) {
    if (!bruta || typeof bruta !== "object") return undefined;
    const c = bruta as Record<string, unknown>;
    const numeros = [c.em, c.contexto, c.entrada, c.cacheLido, c.cacheNovo, c.saida, c.pensamento];
    if (!numeros.every(inteiro) || typeof c.subagente !== "boolean" || !Array.isArray(c.ferramentas) || c.ferramentas.length > TETO_FERRAMENTAS_POR_CHAMADA) return undefined;
    const ferramentas: FerramentaNaChamada[] = [];
    for (const fb of c.ferramentas as unknown[]) {
      const f = (fb && typeof fb === "object" ? fb : {}) as Record<string, unknown>;
      if (!texto(f.nome, 200) || !inteiroOuNull(f.resultadoChars) || typeof f.erro !== "boolean") return undefined;
      ferramentas.push({ nome: f.nome, resultadoChars: f.resultadoChars, erro: f.erro });
    }
    chamadas.push({ em: c.em as number, contexto: c.contexto as number, entrada: c.entrada as number, cacheLido: c.cacheLido as number, cacheNovo: c.cacheNovo as number, saida: c.saida as number, pensamento: c.pensamento as number, subagente: c.subagente, ferramentas });
  }
  if (chamadas.reduce((n, c) => n + c.ferramentas.length, 0) > TETO_FERRAMENTAS_RAIO_X) return undefined;
  const compactacoes: CompactacaoRaioX[] = [];
  for (const bruta of x.compactacoes as unknown[]) {
    const c = (bruta && typeof bruta === "object" ? bruta : {}) as Record<string, unknown>;
    if (!inteiro(c.em) || !inteiroOuNull(c.antes) || !inteiroOuNull(c.depois) || !texto(c.gatilho, 40)) return undefined;
    compactacoes.push({ em: c.em, antes: c.antes, depois: c.depois, gatilho: c.gatilho });
  }
  const custo = x.custoSessaoUsd;
  if (!inteiro(x.chamadasOmitidas) || !inteiroOuNull(x.janela) || !inteiro(x.ferramentasNoInit) || !inteiro(x.duracaoMs) || typeof x.buscaDeFerramentas !== "boolean") return undefined;
  if (!(x.modelo === null || texto(x.modelo, 100)) || !(x.versaoCli === null || texto(x.versaoCli, 100))) return undefined;
  if (!(custo === null || (typeof custo === "number" && Number.isFinite(custo) && custo >= 0))) return undefined;
  return {
    chamadas, chamadasOmitidas: x.chamadasOmitidas, compactacoes, janela: x.janela, modelo: x.modelo, versaoCli: x.versaoCli,
    custoSessaoUsd: custo, ferramentasNoInit: x.ferramentasNoInit, buscaDeFerramentas: x.buscaDeFerramentas, duracaoMs: x.duracaoMs,
  };
}

/** O catálogo do "/" (0038). Como o Raio-X, é extra: fora do formato vira undefined e a entrega segue. */
export function comandos(v: unknown): CatalogoDeComandos | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const c = v as Record<string, unknown>;
  if (!Array.isArray(c.comandos) || c.comandos.length > TETO_COMANDOS || !Array.isArray(c.soDoTerminal) || c.soDoTerminal.length > TETO_SO_DO_TERMINAL) return undefined;
  const nome = (x: unknown): x is string => texto(x, 160) && /^[\w.:-]+$/.test(x);
  const lista: ComandoDoMac[] = [];
  for (const bruto of c.comandos as unknown[]) {
    const k = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
    if (!nome(k.nome) || !texto(k.descricao, TETO_DESCRICAO_COMANDO) || !texto(k.origem, 60) || !(k.argumento === undefined || texto(k.argumento, 120))) return undefined;
    lista.push({ nome: k.nome, descricao: k.descricao, origem: k.origem, ...(k.argumento !== undefined ? { argumento: k.argumento as string } : {}) });
  }
  if (!(c.soDoTerminal as unknown[]).every(nome) || !(c.versaoCli === null || texto(c.versaoCli, 60))) return undefined;
  return { comandos: lista, soDoTerminal: c.soDoTerminal as string[], versaoCli: c.versaoCli as string | null };
}

export function entrega(v: unknown, machineId: string): Entrega {
  const e = objeto(v), r = objeto(e.resultado), f = objeto(e.fala), t = objeto(r.tokens);
  exigir(Number.isSafeInteger(e.seqLocal) && Number(e.seqLocal) > 0);
  exigir(f.tipo === "texto" ? texto(f.texto) : f.tipo === "passe" && MOTIVOS_PASSE.some((m) => m === f.motivo));
  exigir(["sucesso", "falha", "interrompido"].includes(String(r.desfecho)) && texto(r.texto));
  exigir(r.sessaoCli === null || (typeof r.sessaoCli === "string" && UUID.test(r.sessaoCli)));
  exigir(r.custoUsd === null || (typeof r.custoUsd === "number" && Number.isFinite(r.custoUsd) && r.custoUsd >= 0));
  exigir(["entrada", "saida", "cacheLeitura", "cacheCriacao"].every((k) => Number.isSafeInteger(t[k]) && Number(t[k]) >= 0));
  exigir([r.ferramentasChamadas, r.negacoesPermissao].every((a) => Array.isArray(a) && a.length <= 1000 && a.every((x) => texto(x, 200))));
  exigir(r.motivoFalha === undefined || MOTIVOS_FALHA.some((m) => m === r.motivoFalha));
  exigir(r.motivoInterrupcao === undefined || MOTIVOS_INTERRUPCAO.some((m) => m === r.motivoInterrupcao));
  const validados = sinais(r.sinais);
  const raioX = execucao(r.execucao);
  const catalogo = comandos(r.comandos);
  const causa = causaSemIa(r.causaSemIa);
  // definido em 2026-09-17: erroCru remoto não entra no log; só os campos do contrato validado atravessam HTTP.
  // revisto em 2026-10-05: ele passa a ATRAVESSAR, com teto, só para o diagnóstico gravado da pessoa (ADR-041) — em
  // produção o diagnóstico de todo turno falho vinha vazio, porque o campo morria aqui. Continua fora do log
  // (ponte-interna, `erroCruNoLog: false` na ponte das máquinas).
  const erroCru = typeof r.erroCru === "string" && r.erroCru.length <= ERRO_CRU_MAX_CHARS ? r.erroCru : null;
  return { turnoId: uuid(e.turnoId), machineId, seqLocal: Number(e.seqLocal), fala: f as Entrega["fala"], resultado: {
    desfecho: r.desfecho as Entrega["resultado"]["desfecho"], texto: r.texto, sessaoCli: r.sessaoCli as string | null,
    custoUsd: r.custoUsd as number | null, sinais: validados, tokens: t as Entrega["resultado"]["tokens"],
    ferramentasChamadas: r.ferramentasChamadas as string[], negacoesPermissao: r.negacoesPermissao as string[],
    motivoFalha: r.motivoFalha as Entrega["resultado"]["motivoFalha"], motivoInterrupcao: r.motivoInterrupcao as Entrega["resultado"]["motivoInterrupcao"],
    ...(raioX ? { execucao: raioX } : {}),
    ...(catalogo ? { comandos: catalogo } : {}),
    ...(erroCru ? { erroCru } : {}),
    ...(causa ? { causaSemIa: causa } : {}),
  } };
}
