import { contaNoLimiteValida } from "../../../domain/contas-da-ia.ts";
import type { RelatoEspera } from "../../../contracts/espera.ts";
import { SAIDA_ESPERA_MAX } from "../../../domain/espera-comando.ts";
import { CAUSAS_DO_MAC, CAUSAS_SEM_IA, MOTIVO_DA_CAUSA, MOTIVO_DA_CAUSA_DO_MAC, type CausaSemIa, type Inventario } from "../../../contracts/inventario.ts";
import type { LeituraDisco, LeituraMemoria, NivelPressao } from "../../../contracts/trabalho.ts";
import { motivoCliAntigo } from "../../../domain/cli-antigo.ts";
import { motivoSondaLenta } from "../../../domain/sonda-lenta.ts";
import { MOTIVOS_FALHA, MOTIVOS_INTERRUPCAO, MOTIVOS_PASSE } from "../../../contracts/motivos.ts";
import type { Entrega, FalaIntermediaria, TrechoVivo, VigiaVivo } from "../../../contracts/ponte.ts";
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
import { LIMIARES_REPETICAO } from "../../../domain/vigia-turno.ts";
import { usoDoPlanoValido } from "../../../domain/uso-do-plano.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { TEXTO_ENTREGA_MAX_CHARS } from "../../../shared/constantes.ts";
import { UUID } from "../roteador.ts";
import type { TipoAnexo } from "../../../contracts/anexo.ts";
import { HARNESSES, SEM_CAPACIDADES, type CapacidadesHarness, type IdHarness } from "../../../contracts/harness.ts";

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
    else if (o.vigia !== undefined) { const v = vigiaDoTrecho(o.vigia); if (v) saida.push({ vigia: v }); }
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
/** definido em 2026-10-07 (ADR-083, #194): no máximo um RSS por turno vivo; 64 cobre o pico de 25 turnos do diário. */
const TETO_TURNOS_MEMORIA = 64;
const TETO_MB = 1_048_576;
/**
 * A memória do Mac na renovação (#194), estrita: o nível do macOS, o total e o RSS por turno, só números e ids. Ausente =
 * app antigo. Qualquer coisa fora do contrato derruba a renovação (400), como o resto da validação da ponte.
 */
export function memoria(v: unknown): LeituraMemoria | undefined {
  if (v === undefined) return undefined;
  const o = objeto(v);
  exigir((o.nivel === "verde" || o.nivel === "amarela" || o.nivel === "vermelha") && typeof o.totalMb === "number" && Number.isFinite(o.totalMb) && o.totalMb >= 0 && o.totalMb <= TETO_MB);
  exigir(Array.isArray(o.porTurno) && o.porTurno.length <= TETO_TURNOS_MEMORIA);
  const porTurno = (o.porTurno as unknown[]).map((x) => {
    const t = objeto(x);
    exigir(typeof t.turnoId === "string" && UUID.test(t.turnoId) && typeof t.mb === "number" && Number.isFinite(t.mb) && t.mb >= 0 && t.mb <= TETO_MB);
    return { turnoId: t.turnoId, mb: t.mb };
  });
  // ADR-085: o processador é opcional (app anterior à 0.4.0-rc.6 não manda); a carga por núcleo vai até 1000 (um Mac
  // travado passa de 20 — medido em 06/10: 265 em 12 núcleos). Revisão do #209: fora disso o processador é ignorado, e
  // não a leitura toda — um campo novo com defeito não pode derrubar a renovação do turno.
  const p = o.processador !== null && typeof o.processador === "object" && !Array.isArray(o.processador) ? (o.processador as Record<string, unknown>) : null;
  const valido = p !== null && (p.nivel === "verde" || p.nivel === "amarela" || p.nivel === "vermelha") && typeof p.carga === "number" && Number.isFinite(p.carga) && p.carga >= 0 && p.carga <= 1000;
  // ADR-091: o uso da CPU (0 a 1) é opcional como o resto; fora disso some só ele, e a leitura vale como a de um app anterior.
  const uso = valido && typeof p.uso === "number" && Number.isFinite(p.uso) && p.uso >= 0 && p.uso <= 1 ? p.uso : undefined;
  // Revisão do #224: `null` é "o app mede, mas não conseguiu" (a tela diz "sem leitura"); fora do formato, como app anterior.
  const disco = o.disco === null ? null : discoValido(o.disco);
  return { nivel: o.nivel, totalMb: o.totalMb, porTurno, ...(valido ? { processador: { nivel: p.nivel as NivelPressao, carga: p.carga as number, ...(uso !== undefined ? { uso } : {}) } } : {}), ...(disco !== undefined ? { disco } : {}) };
}
/** definido em 2026-10-09 (#219): 1 EB em MB, folga para qualquer volume; acima disso é defeito. */
const TETO_DISCO_MB = 1_099_511_627_776;
/**
 * O disco do Mac (#219, emenda à ADR-085), opcional como o processador: fora do formato (números inteiros, livre até o
 * total) é ignorado sozinho — "sem leitura", nada espera —, nunca derruba a leitura nem a renovação.
 */
function discoValido(v: unknown): LeituraDisco | undefined {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return undefined;
  const d = v as Record<string, unknown>;
  const mb = (x: unknown): x is number => typeof x === "number" && Number.isSafeInteger(x) && x >= 0 && x <= TETO_DISCO_MB;
  return mb(d.livreMb) && mb(d.totalMb) && d.totalMb > 0 && d.livreMb <= d.totalMb ? { livreMb: d.livreMb, totalMb: d.totalMb } : undefined;
}
const NOME_FERRAMENTA = /^[A-Za-z0-9_.-]+$/;
const nomeDeFerramenta = (v: unknown): v is string => texto(v, 200) && NOME_FERRAMENTA.test(v);
const inteiroAte = (v: unknown, max: number): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
/**
 * O vigia do turno (NOD-73), estrito: só as chaves do contrato, nome no padrão de ferramenta, números inteiros e a
 * repetição num dos limiares. Qualquer coisa a mais (um `input`, um comando) descarta o trecho inteiro.
 */
function vigiaDoTrecho(v: unknown): VigiaVivo | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).some((k) => !["mudoMs", "aberta", "emFundo", "repeticao"].includes(k))) return null;
  if (!inteiroAte(o.mudoMs, 366 * 86_400_000) || !inteiroAte(o.emFundo, 1_000)) return null;
  if (o.aberta !== undefined && !nomeDeFerramenta(o.aberta)) return null;
  let repeticao: VigiaVivo["repeticao"];
  if (o.repeticao !== undefined) {
    const r = o.repeticao;
    if (!r || typeof r !== "object" || Array.isArray(r)) return null;
    const ro = r as Record<string, unknown>;
    if (Object.keys(ro).length !== 2 || !nomeDeFerramenta(ro.nome) || !(LIMIARES_REPETICAO as readonly unknown[]).includes(ro.vezes)) return null;
    repeticao = { nome: ro.nome, vezes: ro.vezes as number };
  }
  return { mudoMs: o.mudoMs, ...(o.aberta !== undefined ? { aberta: o.aberta } : {}), emFundo: o.emFundo, ...(repeticao ? { repeticao } : {}) };
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
/**
 * NOD-214: a sessão do CLI que a renovação traz (app ≥ PR 1 da NOD-214). Fora do formato vira ausente — nunca derruba a
 * renovação, que é o lease do turno.
 */
export function sessaoDaRenovacao(v: unknown): string | undefined { return typeof v === "string" && UUID.test(v) ? v : undefined; }
const TIPOS_ANEXO: readonly TipoAnexo[] = ["imagem", "pdf", "texto"];
/**
 * #189 (definido em 2026-10-07): os ids das mensagens que o app escreveu (ou não conseguiu escrever) na sessão. Ausente
 * = app antigo (undefined, e a absorção segue como antes); fora do formato, a renovação é recusada e o app reenvia.
 */
/**
 * definido em 2026-10-08 (revisão do épico, S15): as capacidades que a máquina anuncia por harness no conectar. Só ids
 * integrados e só as chaves de CapacidadesHarness, cada uma `true` só se veio `true` (`anexos`: só os tipos conhecidos);
 * o resto é ignorado (o anúncio é extra: app antigo não manda, e nada que dependa dele acontece). Nunca recusa o conectar.
 */
export function capacidadesAnunciadas(v: unknown): Partial<Record<IdHarness, CapacidadesHarness>> | undefined {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return undefined;
  const anunciadas = v as Record<string, unknown>;
  const saida: Partial<Record<IdHarness, CapacidadesHarness>> = {};
  for (const h of HARNESSES) {
    const c = anunciadas[h.id];
    if (!h.integrado || typeof c !== "object" || c === null || Array.isArray(c)) continue;
    const bruto = c as Record<string, unknown>;
    // NOD-207: `anexos` é uma lista; fica só o que é tipo de anexo conhecido.
    const anexos = Array.isArray(bruto.anexos) ? TIPOS_ANEXO.filter((t) => (bruto.anexos as unknown[]).includes(t)) : [];
    saida[h.id] = { ...SEM_CAPACIDADES, ...Object.fromEntries(Object.entries(SEM_CAPACIDADES).filter(([, v]) => typeof v === "boolean").map(([k]) => [k, bruto[k] === true])), anexos };
  }
  return Object.keys(saida).length > 0 ? saida : undefined;
}

export function idsDeMensagens(v: unknown): string[] | undefined {
  if (v === undefined) return undefined;
  exigir(Array.isArray(v) && v.length <= TETO_FALAS_POR_RENOVACAO);
  return (v as unknown[]).map(uuid);
}
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
  // NOD-171: o CLI abaixo do piso atravessa com as duas versões (só no formato x.y.z[-pre]); a frase continua do servidor.
  if (i.estado === "ausente" && i.causa === "cli_antigo" && versaoSemver(i.versao) && versaoSemver(i.minima)) {
    return { estado: "ausente", motivo: motivoCliAntigo(nome, i.versao, i.minima), causa: "cli_antigo", versao: i.versao, minima: i.minima, em: agora };
  }
  // revisto em 2026-10-10 (PR 2 do plano das IAs): as causas do app novo (sem Node, configuração quebrada) atravessam, com
  // a frase do servidor; antes viravam "não encontrado" e a tela pedia "Instalar".
  const doMac = CAUSAS_DO_MAC.find((c) => c === i.causa);
  if (i.estado === "ausente" && doMac) return { estado: "ausente", motivo: MOTIVO_DA_CAUSA_DO_MAC[doMac].replace("{nome}", nome), causa: doMac, em: agora };
  if (i.estado === "ausente") return { estado: "ausente", motivo: "Harness não encontrado neste computador", em: agora };
  // definido em 2026-10-05: a causa é código fechado e a frase é do servidor — texto do Mac nunca vira motivo.
  const causa = causaSemIa(i.causa);
  return { estado: "nao_autenticado", motivo: causa ? MOTIVO_DA_CAUSA[causa] : "Entre na conta do harness neste computador", ...(causa ? { causa } : {}), em: agora };
}
const SEMVER = /^\d{1,6}\.\d{1,6}\.\d{1,6}(?:-[0-9A-Za-z.-]{1,40})?$/;
const versaoSemver = (v: unknown): v is string => typeof v === "string" && SEMVER.test(v);
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

/**
 * definido em 2026-10-11: o motivo de cada negação do hook do nod. Extra como o uso do plano: fora do formato, some e a
 * pílula fica com o texto de antes; nunca recusa a entrega.
 */
function negacoesDoNod(v: unknown): { nome: string; motivo: string }[] | undefined {
  if (!Array.isArray(v) || v.length === 0 || v.length > 1000) return undefined;
  const ok = v.every((x) => {
    const o = typeof x === "object" && x !== null ? (x as Record<string, unknown>) : null;
    return o !== null && typeof o.nome === "string" && o.nome.length <= 200 && typeof o.motivo === "string" && o.motivo.length <= 1000;
  });
  return ok ? (v as { nome: string; motivo: string }[]).map(({ nome, motivo }) => ({ nome, motivo })) : undefined;
}

export function entrega(v: unknown, machineId: string, agora: number = Date.now()): Entrega {
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
  const doNod = negacoesDoNod(r.negacoesDoNod);
  // NOD-179: o uso do plano também é extra; fora do formato ou com número absurdo, some e a entrega segue.
  const uso = r.usoDoPlano === undefined ? undefined : usoDoPlanoValido(r.usoDoPlano, agora);
  // definido em 2026-09-17: erroCru remoto não entra no log; só os campos do contrato validado atravessam HTTP.
  // revisto em 2026-10-05: ele passa a ATRAVESSAR, com teto, só para o diagnóstico gravado da pessoa (ADR-041) — em
  // produção o diagnóstico de todo turno falho vinha vazio, porque o campo morria aqui. Continua fora do log
  // (ponte-interna, `erroCruNoLog: false` na ponte das máquinas).
  const erroCru = typeof r.erroCru === "string" && r.erroCru.length <= ERRO_CRU_MAX_CHARS ? r.erroCru : null;
  // NOD-171: extra como o uso do plano. Só com o limite e até 31 dias à frente; fora disso some (a frase fica sem hora).
  const voltaEm = r.motivoFalha === "limite_do_plano" && Number.isSafeInteger(r.limiteVoltaEm) && Number(r.limiteVoltaEm) > 0 && Number(r.limiteVoltaEm) <= agora + 31 * 86_400_000 ? Number(r.limiteVoltaEm) : null;
  // ADR-101 (2026-10-12): a decisão do Mac sobre as contas no limite, só num turno falho; fora do formato some. Não só
  // com `limite_do_plano`: o limite do Codex chega como `erro_execucao` com o texto do fornecedor, e o servidor só a usa
  // quando ele mesmo classifica o turno como limite (assentar-turno).
  const contaNoLimite = typeof r.motivoFalha === "string" ? contaNoLimiteValida(r.contaNoLimite, agora) : undefined;
  // Revisão do épico (S19, 2026-10-08): o que o CLI recebeu e não foi confirmado numa renovação.
  const entregues = idsDeMensagens(e.mensagensEntregues);
  return { turnoId: uuid(e.turnoId), machineId, seqLocal: Number(e.seqLocal), fala: f as Entrega["fala"], ...(entregues?.length ? { mensagensEntregues: entregues } : {}), resultado: {
    desfecho: r.desfecho as Entrega["resultado"]["desfecho"], texto: r.texto, sessaoCli: r.sessaoCli as string | null,
    custoUsd: r.custoUsd as number | null, sinais: validados, tokens: t as Entrega["resultado"]["tokens"],
    ferramentasChamadas: r.ferramentasChamadas as string[], negacoesPermissao: r.negacoesPermissao as string[],
    motivoFalha: r.motivoFalha as Entrega["resultado"]["motivoFalha"], motivoInterrupcao: r.motivoInterrupcao as Entrega["resultado"]["motivoInterrupcao"],
    ...(raioX ? { execucao: raioX } : {}),
    ...(catalogo ? { comandos: catalogo } : {}),
    ...(erroCru ? { erroCru } : {}),
    ...(causa ? { causaSemIa: causa } : {}),
    ...(doNod ? { negacoesDoNod: doNod } : {}),
    ...(uso ? { usoDoPlano: uso } : {}),
    ...(voltaEm !== null ? { limiteVoltaEm: voltaEm } : {}),
    ...(contaNoLimite ? { contaNoLimite } : {}),
  } };
}

/**
 * ADR-099 (parte 2, definido em 2026-10-12): o relato de uma espera. A saída vem cortada pelo app (as últimas linhas); o
 * teto aqui é 4× o que se guarda, só para recusar o absurdo — o servidor corta de novo (ultimasLinhas).
 */
export function relatoEspera(v: unknown): RelatoEspera {
  const r = objeto(v);
  const id = uuid(r.id);
  if (r.tipo === "iniciou") return { id, tipo: "iniciou" };
  if (r.tipo === "caiu") {
    exigir(r.motivo === "pasta_ausente" || r.motivo === "nao_iniciou");
    return { id, tipo: "caiu", motivo: r.motivo };
  }
  exigir(r.tipo === "terminou");
  exigir(r.codigo === null || (typeof r.codigo === "number" && Number.isInteger(r.codigo) && r.codigo >= -1 && r.codigo <= 255));
  exigir(texto(r.saida, 4 * SAIDA_ESPERA_MAX));
  return { id, tipo: "terminou", codigo: r.codigo as number | null, saida: r.saida };
}
