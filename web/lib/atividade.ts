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
  /** NOD-353: cada chamada do turno inteiro, na ordem (o resumo das ações); sobrevive às falas do meio. */
  acoes: AcaoNaTela[];
};

/**
 * NOD-353: uma ação do turno na tela. `id` é o do tool_use (null no app antigo, que não o manda); `emUso` é a linha no
 * presente enquanto ela roda ("Usando Gmail"). Fecha pelo frame `turno.acao_fim` (pelo id), pelo texto que volta, pelo
 * fim do turno, e, sem id, pela próxima ferramenta. Falhou só vem do frame (tool_result.isError), nunca inventado.
 */
export type EstadoDaAcao = "rodando" | "feita" | "falhou";
export type AcaoNaTela = { id: string | null; rotulo: string; estado: EstadoDaAcao; emUso: string | null; frentes?: true };
/** Teto das chamadas guardadas por turno; o resumo mostra as primeiras `ACOES_DO_RESUMO_MAX` linhas (a regra da gravada). */
export const ACOES_GUARDADAS = 2_000;
export const ACOES_DO_RESUMO_MAX = 200;

/** NOD-348: o que a fala viva diz da ferramenta (o servidor manda pronto no frame, `ferramentaEmUso` do domínio). */
export type FerramentaEmUso = { texto: string; frentes: boolean };
export const SEM_NOME_DA_FERRAMENTA: FerramentaEmUso = { texto: "Usando uma ferramenta", frentes: false };

export const ETAPAS_GUARDADAS = 200;

export const ATIVIDADE_VAZIA: AtividadeTurno = { atual: "", etapas: [], totalEtapas: 0, ferramentas: 0, ultimaFerramenta: null, tarefas: [], vigia: null, emUso: null, subagentes: null, acoes: [] };

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
  // NOD-353: o resumo das ações é do turno inteiro — atravessa a fala do meio (a do bot já não roda: vira feita).
  return { ...ATIVIDADE_VAZIA, etapas: ultimo ? [{ texto: ultimo, ferramentas: 0 }] : [], totalEtapas: ultimo ? 1 : 0, subagentes: a.subagentes, acoes: acoesFechadas(a.acoes) };
}

/**
 * A volta do bot acabou (`result`), com ou sem fala: nada dele fica no "agora". A ferramenta já está numa etapa
 * (comFerramenta) e deixa de ser o "agora"; o texto em streaming também sai — no Mac, os últimos deltas da volta viajam na
 * mesma renovação da fala e chegam DEPOIS do `turno.fala`, recriando uma bolha com cursor que já está na conversa.
 */
export function semFerramentaAberta(a: AtividadeTurno): AtividadeTurno {
  const acoes = acoesFechadas(a.acoes);
  return a.ferramentas === 0 && a.ultimaFerramenta === null && a.atual === "" && acoes === a.acoes ? a : { ...a, atual: "", ferramentas: 0, ultimaFerramenta: null, acoes };
}

export function comVigia(a: AtividadeTurno | undefined, vigia: VigiaDaAtividade): AtividadeTurno {
  return { ...(a ?? ATIVIDADE_VAZIA), vigia };
}

export function comTexto(a: AtividadeTurno | undefined, trecho: string): AtividadeTurno {
  const base = a ?? ATIVIDADE_VAZIA;
  // NOD-348: texto de verdade chegando é "Escrevendo"; espaço solto entre ferramentas não troca o estado.
  // NOD-353: o texto que volta quer dizer que as ferramentas responderam: as que rodavam viram feitas.
  return { ...base, atual: base.atual + trecho, emUso: trecho.trim() ? null : base.emUso, acoes: trecho.trim() ? acoesFechadas(base.acoes) : base.acoes };
}

/**
 * Narração antes da ferramenta vira etapa com 1 ferramenta; ferramentas seguidas sem narração somam na
 * última etapa; ferramenta sem etapa nenhuma antes abre uma etapa com o próprio rótulo.
 */
export function comFerramenta(a: AtividadeTurno | undefined, rotulo: string, emUso: FerramentaEmUso = SEM_NOME_DA_FERRAMENTA, id: string | null = null): AtividadeTurno {
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
  return { atual: "", etapas: etapas.slice(-ETAPAS_GUARDADAS), totalEtapas, ferramentas: base.ferramentas + 1, ultimaFerramenta: rotulo, tarefas: base.tarefas, vigia: base.vigia, emUso, subagentes: base.subagentes, antes: narracao ? [...(base.antes ?? []), base.atual].slice(-ETAPAS_GUARDADAS) : base.antes, acoes: comAcao(narracao ? acoesFechadas(base.acoes) : base.acoes, rotulo, emUso, id) };
}

/** As que rodavam viram feitas (o texto voltou, a volta acabou, o turno acabou); devolve a mesma lista se nada mudou. */
export function acoesFechadas(acoes: readonly AcaoNaTela[]): AcaoNaTela[] {
  if (!acoes.some((x) => x.estado === "rodando")) return acoes as AcaoNaTela[];
  return acoes.map((x) => (x.estado === "rodando" ? { ...x, estado: "feita", emUso: null } : x));
}

function comAcao(acoes: readonly AcaoNaTela[], rotulo: string, emUso: FerramentaEmUso, id: string | null): AcaoNaTela[] {
  // App antigo (sem id): não há fim por chamada; a ferramenta seguinte fecha as que estavam sem id.
  const base = id === null ? acoes.map((x) => (x.estado === "rodando" && x.id === null ? { ...x, estado: "feita" as const, emUso: null } : x)) : [...acoes];
  if (base.length >= ACOES_GUARDADAS) return base;
  return [...base, { id, rotulo, estado: "rodando", emUso: emUso.texto, ...(emUso.frentes ? { frentes: true as const } : {}) }];
}

/**
 * NOD-353: o frame `turno.acao_fim`. Fecha a chamada `id` como feita ou Falhou; um fim que chega depois do texto (a ação
 * já virou feita) ainda acerta o Falhou. Id desconhecido não muda nada.
 */
export function comFimDaAcao(a: AtividadeTurno | undefined, id: string, falhou: boolean): AtividadeTurno | undefined {
  if (!a) return a;
  // Revisão 3 do #523: com id repetido no turno, o fim é da chamada mais recente (lib ES2022: sem findLastIndex).
  let i = -1;
  for (let j = a.acoes.length - 1; j >= 0 && i < 0; j--) if (a.acoes[j]!.id === id) i = j;
  const atual = a.acoes[i];
  if (!atual) return a;
  const estado: EstadoDaAcao = falhou ? "falhou" : atual.estado === "falhou" ? "falhou" : "feita";
  if (estado === atual.estado && atual.emUso === null) return a;
  const acoes = [...a.acoes];
  acoes[i] = { ...atual, estado, emUso: null };
  // Revisão do #523: com paralelas, a linha viva passa a dizer a última que ainda roda (não a que acabou). Sem nenhuma
  // rodando, fica a última até o próximo texto ou ferramenta, como antes (sem piscar "Pensando" entre ferramentas).
  const rodando = [...acoes].reverse().find((x) => x.estado === "rodando" && x.emUso !== null);
  const emUso: FerramentaEmUso | null = rodando?.emUso ? { texto: rodando.emUso, frentes: rodando.frentes === true } : a.emUso;
  return { ...a, acoes, emUso };
}

/** Uma linha do resumo (a forma da gravada, `AcaoDoTurno` do contrato), mais a em uso enquanto roda. */
export type LinhaDoResumo = { rotulo: string; estado: EstadoDaAcao; emUso: string | null; vezes?: number };

/**
 * NOD-353: as linhas do resumo pela regra da fala gravada (`acoesDoTurno`, src/domain/acoes-do-turno.ts): a mesma ação
 * seguida com o mesmo desfecho numa linha só, as primeiras `ACOES_DO_RESUMO_MAX`. A que roda não se junta a nada.
 * `parado` (turno acabado): a que rodava conta como feita, como a gravada conta.
 */
export function linhasDoResumo(acoes: readonly AcaoNaTela[], parado = false): LinhaDoResumo[] {
  const linhas: LinhaDoResumo[] = [];
  for (const x of acoes) {
    const estado: EstadoDaAcao = parado && x.estado === "rodando" ? "feita" : x.estado;
    const ultima = linhas[linhas.length - 1];
    if (estado !== "rodando" && ultima && ultima.estado === estado && ultima.rotulo === x.rotulo) { ultima.vezes = (ultima.vezes ?? 1) + 1; continue; }
    if (linhas.length >= ACOES_DO_RESUMO_MAX) break;
    linhas.push({ rotulo: x.rotulo, estado, emUso: estado === "rodando" ? x.emUso : null });
  }
  return linhas;
}

/**
 * NOD-353: a frase do resumo recolhido, só com as ações que terminaram (feitas ou Falhou), cada uma uma vez, na ordem do
 * primeiro uso. O rótulo é "Verbo objeto" (rotuloFerramenta); verbos seguidos com o mesmo objeto se juntam, e o objeto
 * "um/uma X" vai para o plural quando junta verbos ou a ação se repetiu: "Leu, escreveu e editou arquivos e rodou um
 * comando". Nada terminado ainda: "" (o resumo não aparece).
 */
export function fraseDasAcoes(linhas: readonly { rotulo: string; estado: EstadoDaAcao; vezes?: number }[]): string {
  const vezes = new Map<string, number>();
  for (const l of linhas) if (l.estado !== "rodando") vezes.set(l.rotulo, (vezes.get(l.rotulo) ?? 0) + (l.vezes ?? 1));
  const grupos: { verbos: string[]; objeto: string; repetiu: boolean }[] = [];
  for (const [rotulo, n] of vezes) {
    const espaco = rotulo.indexOf(" ");
    const verbo = espaco < 0 ? rotulo : rotulo.slice(0, espaco);
    const objeto = espaco < 0 ? "" : rotulo.slice(espaco + 1);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && objeto && ultimo.objeto === objeto) { ultimo.verbos.push(verbo); ultimo.repetiu ||= n > 1; continue; }
    grupos.push({ verbos: [verbo], objeto, repetiu: n > 1 });
  }
  const partes = grupos.map((g, i) => {
    const verbos = g.verbos.map((v, j) => (i === 0 && j === 0 ? v : minuscula(v)));
    const objeto = g.verbos.length > 1 || g.repetiu ? noPlural(g.objeto) : g.objeto;
    return [juntar(verbos), objeto].filter(Boolean).join(" ");
  });
  return juntar(partes);
}

const minuscula = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const juntar = (xs: readonly string[]) => (xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} e ${xs[xs.length - 1]}`);

/** "um arquivo" → "arquivos", "uma página" → "páginas"; o resto (um nome, "na web") fica como é. */
function noPlural(objeto: string): string {
  const m = /^(?:um|uma) (\S+)(.*)$/.exec(objeto);
  if (!m) return objeto;
  const nome = m[1]!;
  const plural = /ão$/.test(nome) ? nome.replace(/ão$/, "ões") : /[rzs]$/.test(nome) ? `${nome}es` : /m$/.test(nome) ? nome.replace(/m$/, "ns") : /l$/.test(nome) ? nome.replace(/l$/, "is") : `${nome}s`;
  return `${plural}${m[2]}`;
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
 * esvazia o balão. O texto que volta substitui a narração curta, que a gravada também deixa de fora (de uma linha para outra).
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
