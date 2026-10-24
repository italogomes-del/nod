import type { SubagenteVivo, TarefaDoBot } from "../../src/contracts/turno.ts";

/**
 * Turno vivo como cartão de atividade (definido em 2026-09-24): o balão é o que o agente DIZ, o cartão
 * é o que ele está FAZENDO. O texto em streaming vai para `atual`; cada ferramenta (turno.atividade)
 * fecha `atual` numa etapa. Sem nenhuma ferramenta o turno continua um balão (resposta simples); a
 * resposta final vira mensagem normal por REST quando o turno encerra. Tudo puro e testável.
 */
export type Etapa = { texto: string; ferramentas: number };

/**
 * O vigia do turno (definido em 2026-10-05, NOD-73): só aviso, nunca corte. `mudoDesde` é quando o silêncio começou
 * (null = sem aviso de silêncio), para a tela contar os minutos sozinha; `aberta` é o nome curto da ferramenta sem
 * resultado ("Terminal"); `repeticao` é o maior limiar já atingido (5, 10, 20), numa linha que se atualiza.
 */
export type VigiaDaAtividade = { mudoDesde: number | null; aberta: string | null; emFundo: number; repeticao: { rotulo: string; vezes: number } | null };

/**
 * NOD-350: um subagente (ou comando) em segundo plano como a tela o guarda. `recebidoEm` é quando a duração chegou (o
 * tempo anda a partir dela entre um frame e outro); `fimEm` é quando a tela o viu terminar (a hora à direita da linha).
 */
export type SubagenteNaTela = SubagenteVivo & { recebidoEm: number; fimEm: number | null };

/** NOD-350: os subagentes do turno e a linha pronta do servidor ("2 subagentes trabalhando · 1 não terminou"). */
export type SubagentesDoTurno = { lista: SubagenteNaTela[]; resumo: string | null };

export type AtividadeTurno = {
  /** Texto desde a última ferramenta (ou desde o início, se ainda não houve nenhuma). */
  atual: string;
  /** Últimas etapas fechadas; `totalEtapas` conta também as descartadas pelo teto. */
  etapas: Etapa[];
  totalEtapas: number;
  ferramentas: number;
  ultimaFerramenta: string | null;
  /** A lista de tarefas do bot (turno.tarefas), inteira, a mais nova que chegou. */
  tarefas: TarefaDoBot[];
  /** O último aviso do vigia do turno (turno.vigia); null enquanto não houve nenhum. */
  vigia: VigiaDaAtividade | null;
  /** NOD-348: a ferramenta que o bot usa agora (do NOME do frame), até o próximo texto; null = nenhuma desde o texto. */
  emUso: FerramentaEmUso | null;
  /** NOD-348 (QA 2 do #508): os blocos de narração já fechados por ferramentas desde a última fala (para `textoDaFala`). */
  antes?: string[];
  /** NOD-350: sobrevive à fala do bot (os subagentes seguem depois do `result` do turno principal). */
  subagentes: SubagentesDoTurno | null;
};

/** NOD-348: o que a fala viva diz da ferramenta (o servidor manda pronto no frame, `ferramentaEmUso` do domínio). */
export type FerramentaEmUso = { texto: string; frentes: boolean };
export const SEM_NOME_DA_FERRAMENTA: FerramentaEmUso = { texto: "Usando uma ferramenta", frentes: false };

export const ETAPAS_GUARDADAS = 200;

export const ATIVIDADE_VAZIA: AtividadeTurno = { atual: "", etapas: [], totalEtapas: 0, ferramentas: 0, ultimaFerramenta: null, tarefas: [], vigia: null, emUso: null, subagentes: null };

export function comTarefas(a: AtividadeTurno | undefined, tarefas: TarefaDoBot[]): AtividadeTurno {
  return { ...(a ?? ATIVIDADE_VAZIA), tarefas };
}

/** O frame `turno.subagentes` substitui a lista; quem já tinha terminado guarda a hora em que a tela viu o fim. */
export function comSubagentes(a: AtividadeTurno | undefined, lista: readonly SubagenteVivo[], resumo: string | null, agora: number): AtividadeTurno {
  const base = a ?? ATIVIDADE_VAZIA;
  const antes = new Map((base.subagentes?.lista ?? []).map((s) => [s.id, s]));
  const nova = lista.map((s): SubagenteNaTela => ({ ...s, recebidoEm: agora, fimEm: s.estado === "trabalhando" ? null : (antes.get(s.id)?.fimEm ?? agora) }));
  return { ...base, subagentes: nova.length ? { lista: nova, resumo } : null };
}

/**
 * Parar (ou o turno que acabou com algum ainda trabalhando): quem trabalhava vira parado na hora, e a linha de cima é
 * refeita aqui (só este caso; enquanto rodam, a linha vem pronta do servidor, src/domain/subagentes.ts).
 */
export function subagentesParados(s: SubagentesDoTurno | null, agora: number): SubagentesDoTurno | null {
  if (!s || !s.lista.some((x) => x.estado === "trabalhando")) return s;
  const lista = s.lista.map((x): SubagenteNaTela => (x.estado === "trabalhando" ? { ...x, estado: "parado", passo: null, duracaoMs: x.duracaoMs + Math.max(0, agora - x.recebidoEm), recebidoEm: agora, fimEm: agora } : x));
  const agentes = lista.filter((x) => x.natureza === "agente");
  const parados = agentes.filter((x) => x.estado === "parado").length;
  const naoTerminou = parados + agentes.filter((x) => x.estado === "falhou").length;
  const resumo = agentes.length === 0
    ? null
    : parados === agentes.length
      ? (parados === 1 ? "1 subagente parado" : `${parados} subagentes parados`)
      : `${agentes.length === 1 ? "O subagente voltou" : `Os ${agentes.length} subagentes voltaram`} · ${naoTerminou === 1 ? "1 não terminou" : `${naoTerminou} não terminaram`}`;
  return { lista, resumo };
}

/** Algum subagente ou comando ainda trabalha: o cabeçalho do bloco pulsa (depois da fala) e a contagem vale como "agora". */
export function subagenteTrabalhando(a: AtividadeTurno | undefined): boolean {
  return !!a?.subagentes?.lista.some((s) => s.estado === "trabalhando");
}

/**
 * ADR-067: a fala do bot apaga o cartão ao vivo para a próxima volta — menos os subagentes, que seguem trabalhando depois
 * dela (é o que deixava "Rodou um comando…" pulsando sozinho na task). null = não sobra nada a guardar.
 */
export function soSubagentes(a: AtividadeTurno | undefined): AtividadeTurno | null {
  if (!a?.subagentes) return null;
  // Critério 2: a última ferramenta do bot fica como ✓ ("Rodou um comando" deixa de pulsar), sem a narração, que já
  // virou a mensagem da fala.
  const ultimo = a.ultimaFerramenta ?? a.etapas[a.etapas.length - 1]?.texto ?? null;
  return { ...ATIVIDADE_VAZIA, etapas: ultimo ? [{ texto: ultimo, ferramentas: 0 }] : [], totalEtapas: ultimo ? 1 : 0, subagentes: a.subagentes };
}

/**
 * A volta do bot acabou (`result`), com ou sem fala: nada dele fica no "agora". A ferramenta já está numa etapa
 * (comFerramenta) e deixa de ser o "agora"; o texto em streaming também sai — no Mac, os últimos deltas da volta viajam na
 * mesma renovação da fala e chegam DEPOIS do `turno.fala`, recriando uma bolha com cursor que já está na conversa.
 */
export function semFerramentaAberta(a: AtividadeTurno): AtividadeTurno {
  return a.ferramentas === 0 && a.ultimaFerramenta === null && a.atual === "" ? a : { ...a, atual: "", ferramentas: 0, ultimaFerramenta: null };
}

export function comVigia(a: AtividadeTurno | undefined, vigia: VigiaDaAtividade): AtividadeTurno {
  return { ...(a ?? ATIVIDADE_VAZIA), vigia };
}

export function comTexto(a: AtividadeTurno | undefined, trecho: string): AtividadeTurno {
  const base = a ?? ATIVIDADE_VAZIA;
  // NOD-348: texto de verdade chegando é "Escrevendo"; espaço solto entre ferramentas não troca o estado.
  return { ...base, atual: base.atual + trecho, emUso: trecho.trim() ? null : base.emUso };
}

/**
 * Narração antes da ferramenta vira etapa com 1 ferramenta; ferramentas seguidas sem narração somam na
 * última etapa; ferramenta sem etapa nenhuma antes abre uma etapa com o próprio rótulo.
 */
export function comFerramenta(a: AtividadeTurno | undefined, rotulo: string, emUso: FerramentaEmUso = SEM_NOME_DA_FERRAMENTA): AtividadeTurno {
  const base = a ?? ATIVIDADE_VAZIA;
  const narracao = base.atual.trim();
  const ultima = base.etapas[base.etapas.length - 1];
  let etapas: Etapa[];
  let totalEtapas = base.totalEtapas;
  if (narracao) {
    etapas = [...base.etapas, { texto: narracao, ferramentas: 1 }];
    totalEtapas += 1;
  } else if (ultima) {
    etapas = [...base.etapas.slice(0, -1), { ...ultima, ferramentas: ultima.ferramentas + 1 }];
  } else {
    etapas = [{ texto: rotulo, ferramentas: 1 }];
    totalEtapas += 1;
  }
  return { atual: "", etapas: etapas.slice(-ETAPAS_GUARDADAS), totalEtapas, ferramentas: base.ferramentas + 1, ultimaFerramenta: rotulo, tarefas: base.tarefas, vigia: base.vigia, emUso, subagentes: base.subagentes, antes: narracao ? [...(base.antes ?? []), base.atual].slice(-ETAPAS_GUARDADAS) : base.antes };
}

/**
 * A regra do `comporFala` (src/domain/stream-json.ts) na web, que não importa do domínio (ADR-018, ADR-020): os blocos
 * de antes da última ferramenta com mais de 280 caracteres que o final não contém, mais o final. Revisão 4 do #508: a
 * fala parada mostra o que a fala gravada vai mostrar. Um teste trava a paridade com a do domínio.
 */
export const NARRACAO_MAX_CHARS_WEB = 280;
const normalizarFala = (s: string) => s.replace(/\s+/g, " ").trim();

export function comporFalaWeb(antes: readonly string[], final: string): string {
  const alvo = normalizarFala(final);
  const relatorios: string[] = [];
  for (const bloco of antes) {
    const t = bloco.trim();
    if (t.length <= NARRACAO_MAX_CHARS_WEB) continue;
    const n = normalizarFala(t);
    if (alvo.includes(n) || relatorios.some((r) => normalizarFala(r).includes(n))) continue;
    relatorios.push(t);
  }
  if (relatorios.length === 0) return final;
  return [...relatorios, final].map((p) => p.trim()).filter((p) => p !== "").join("\n\n");
}

/**
 * NOD-348 (QA 2 e revisões 4 a 6 do #508): o texto do balão, viva e parada, pela mesma regra da fala gravada
 * (`comporFala`: os relatórios longos antes da última ferramenta + o texto final), para o fim do turno e a troca pela
 * gravada não mudarem a altura. Sem texto depois da última ferramenta, o último bloco faz de final: a ferramenta não
 * esvazia o balão. O texto que volta substitui a narração curta, que fica em "ver etapas" (de uma linha para outra).
 */
export function textoDaFala(a: AtividadeTurno | undefined): string {
  if (!a) return "";
  const blocos = a.antes ?? [];
  if (a.atual.trim()) return comporFalaWeb(blocos, a.atual);
  const ultimo = blocos.length - 1;
  return ultimo < 0 ? "" : comporFalaWeb(blocos.slice(0, ultimo), blocos[ultimo]!);
}

/**
 * Primeira frase da narração, numa linha, sem marcação: é o que cabe numa linha do cartão. Só o começo do texto
 * decide o resumo: com o começo já limpo bem maior que `max`, o corte do prefixo não chega à frase (a frase termina
 * antes dele, ou passa de `max` e é cortada nos mesmos caracteres). definido em 2026-09-30: o cartão é redesenhado a
 * cada atualização do turno, e limpar o texto inteiro somava ~455 ms num turno de 30 mil caracteres em 1.250 pedaços
 * (medido em 2026-09-30, bancada em Node); o prefixo leva isso a ~26 ms.
 */
export function resumoEtapa(texto: string, max = 140): string {
  if (texto.length > PREFIXO_DO_RESUMO) {
    const limpo = limparNarracao(texto.slice(0, PREFIXO_DO_RESUMO));
    if (limpo.length > max + 20) return primeiraFrase(limpo, max);
  }
  return primeiraFrase(limparNarracao(texto), max);
}

const PREFIXO_DO_RESUMO = 2_000;

function limparNarracao(texto: string): string {
  return texto.replace(/[*_`#>]+/g, "").replace(/^\s*[-•]\s+/gm, "").replace(/\s+/g, " ").trim();
}

function primeiraFrase(limpo: string, max: number): string {
  const frase = /^(.+?[.!?…])(?:\s|$)/.exec(limpo)?.[1] ?? limpo;
  return frase.length > max ? `${frase.slice(0, max - 1).trimEnd()}…` : frase;
}

/** A linha "o que está fazendo agora": a narração corrente; sem ela, a última ferramenta. */
export function linhaAtual(a: AtividadeTurno): string {
  const narracao = resumoEtapa(a.atual);
  if (narracao) return narracao.replace(/[.:]$/, "…");
  if (a.ultimaFerramenta) return `${a.ultimaFerramenta}…`;
  // NOD-350 (critério 3): depois da fala, o "agora" é a linha dos subagentes ("2 subagentes trabalhando", ou "Os 2
  // subagentes voltaram" até o bot recomeçar a volta), não "Começando…".
  return a.subagentes?.resumo ?? "Começando…";
}

/**
 * NOD-348 (definido em 2026-10-23; protótipo v2 e decisões da Ada): o estado da fala viva, no presente. Texto chegando
 * é "Escrevendo"; ferramenta em uso, o nome dela ("Usando Linear") ou "Abrindo frentes"; antes de tudo, "Pensando".
 * Mascote: Pensando e Escrevendo ficam atentos (idle + attentif, não `thinking`); ferramenta e frentes, `orbit`.
 */
export type ChaveDaFala = "pensando" | "escrevendo" | "ferramenta" | "frentes";
export type EstadoDaFala = { chave: ChaveDaFala; texto: string; mascote: { state: "idle" | "orbit"; expression: "attentif" | null } };

const ATENTO = { state: "idle", expression: "attentif" } as const;
const FAZENDO = { state: "orbit", expression: null } as const;

export function estadoDaFala(a: AtividadeTurno | undefined): EstadoDaFala {
  if (a?.atual.trim()) return { chave: "escrevendo", texto: "Escrevendo", mascote: ATENTO };
  if (a?.emUso) return { chave: a.emUso.frentes ? "frentes" : "ferramenta", texto: a.emUso.texto, mascote: FAZENDO };
  return { chave: "pensando", texto: "Pensando", mascote: ATENTO };
}
