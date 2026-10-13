import type { ContaLivre, EstadoContaNaMaquina, IaComConta, ModoDasContas } from "../contracts/contas-ia.ts";
import { IAS_COM_CONTA } from "../contracts/contas-ia.ts";
import type { IdHarness } from "../contracts/harness.ts";
import type { EpochMs } from "../contracts/ids.ts";
import { PRAZO_SEM_HORARIO_MS } from "./contas-da-ia.ts";

/**
 * As contas de IA da pessoa em todas as máquinas (definido em 2026-10-13, ADR-102). Puro: `agora` por parâmetro, o
 * sha256 da impressão é feito por quem chama (ADR-018).
 *
 * As regras da ADR-101 continuam, agora com uma lista só (Claude e ChatGPT intercalados):
 *  1. Por IA, a conta em uso é a primeira da IA (na ordem da pessoa) logada na máquina do turno, se livre; senão a
 *     escolhida pela pessoa ("Seguir com"), se livre; senão, com "Trocar sozinho", a próxima livre que entra na troca
 *     (conta corporativa só marcada); senão nenhuma — a pessoa decide ("Perguntar antes", o padrão).
 *  2. Entre IAs, vale a posição da conta em uso de cada uma: a lista intercalada decide quem responde. Passar de um
 *     provedor para o outro continua automático (o Automático de hoje); só a troca entre contas do MESMO provedor pede
 *     licença (ADR-101 §4: é a cláusula dos termos).
 *  3. O limite é da conta, não da máquina.
 */

export type ContaDaPessoa = {
  id: string;
  ia: IaComConta;
  apelido: string;
  plano: string | null;
  corporativa: boolean;
  posicao: number;
  entraNaTrocaAutomatica: boolean;
  noLimiteAte: EpochMs | null;
  removidaEm: EpochMs | null;
};

export type VinculoDaConta = { contaId: string; maquinaId: string; estado: EstadoContaNaMaquina; sairPedidoEm: EpochMs | null };

/** O texto que vira a impressão (sha256 hex): a mesma conta na mesma pessoa dá o mesmo hash em qualquer máquina. */
export function textoDaImpressaoDaConta(p: { pessoaId: string; ia: IaComConta; email: string; orgId: string | null }): string {
  return `nod-conta-v1\n${p.pessoaId}\n${p.ia}\n${p.email.trim().toLowerCase()}\n${(p.orgId ?? "").trim().toLowerCase()}`;
}

export const IMPRESSAO = /^[0-9a-f]{64}$/;

const livre = (c: Pick<ContaDaPessoa, "noLimiteAte">, agora: EpochMs) => c.noLimiteAte === null || c.noLimiteAte <= agora;
const entraNaTroca = (c: ContaDaPessoa) => !c.corporativa || c.entraNaTrocaAutomatica;
const emOrdem = (contas: readonly ContaDaPessoa[]) => contas.filter((c) => c.removidaEm === null).sort((a, b) => a.posicao - b.posicao);

/** A conta em uso de uma IA entre as logadas na máquina (já em ordem). null = nenhuma utilizável sem a pessoa decidir. */
function contaEmUsoDaIa(daIa: readonly ContaDaPessoa[], p: { modo: ModoDasContas; escolhida: string | null; agora: EpochMs }): ContaDaPessoa | null {
  const [preferida] = daIa;
  if (!preferida) return null;
  if (livre(preferida, p.agora)) return preferida;
  const escolhida = daIa.find((c) => c.id === p.escolhida);
  if (escolhida && livre(escolhida, p.agora)) return escolhida;
  if (p.modo === "automatico") return daIa.find((c) => c !== preferida && livre(c, p.agora) && entraNaTroca(c)) ?? null;
  return null;
}

export type ContaDoTurno = {
  /** A conta de cada IA que tem conta logada na máquina (null = nenhuma utilizável agora). */
  porIa: Partial<Record<IaComConta, ContaDaPessoa | null>>;
  /** A ordem das IAs para o escolherHarness: as com conta em uso, pela posição dela (ou pela ordem do bot). */
  ordemIas: IdHarness[];
  /** IAs com conta nesta máquina mas nenhuma utilizável agora: entram no `noLimite` do escolherHarness. */
  iasSemConta: IaComConta[];
};

/**
 * A conta do próximo turno numa máquina. null = a máquina não anunciou conta nenhuma (motor ou app antigo, ou ainda sem
 * login): o turno segue como hoje, sem `plano.conta`.
 */
export function contaDoTurno(p: {
  contas: readonly ContaDaPessoa[];
  /** Os ids das contas `pronta` na máquina do turno, sem saída pedida. */
  naMaquina: ReadonlySet<string>;
  modo: ModoDasContas;
  escolhidas: Partial<Record<IaComConta, string>>;
  /** A ordem própria do bot (2B), quando ele tem uma. */
  ordemDoBot: readonly IdHarness[] | null;
  agora: EpochMs;
}): ContaDoTurno | null {
  const lista = emOrdem(p.contas).filter((c) => p.naMaquina.has(c.id));
  if (lista.length === 0) return null;
  const porIa: Partial<Record<IaComConta, ContaDaPessoa | null>> = {};
  for (const ia of IAS_COM_CONTA) {
    const daIa = lista.filter((c) => c.ia === ia);
    if (daIa.length > 0) porIa[ia] = contaEmUsoDaIa(daIa, { modo: p.modo, escolhida: p.escolhidas[ia] ?? null, agora: p.agora });
  }
  const comConta = IAS_COM_CONTA.filter((ia) => porIa[ia]);
  const naOrdem = p.ordemDoBot
    ? [...comConta].sort((a, b) => indice(p.ordemDoBot!, a) - indice(p.ordemDoBot!, b))
    : [...comConta].sort((a, b) => porIa[a]!.posicao - porIa[b]!.posicao);
  const iasSemConta = IAS_COM_CONTA.filter((ia) => porIa[ia] === null);
  return { porIa, ordemIas: naOrdem, iasSemConta };
}

const indice = (ordem: readonly IdHarness[], ia: IdHarness) => {
  const i = ordem.indexOf(ia);
  return i < 0 ? ordem.length : i;
};

export type DecisaoDoLimiteDaConta =
  | { tipo: "trocou"; para: ContaDaPessoa }
  | { tipo: "outra_ia"; para: ContaDaPessoa }
  | { tipo: "perguntar"; livres: ContaLivre[] }
  | { tipo: "todas_no_limite"; voltaEm: EpochMs | null };

/**
 * A conta `contaId` bateu no limite até `ate` (o horário do fornecedor; sem ele, 1 h). Com "Trocar sozinho" e outra
 * conta elegível da MESMA IA na máquina: troca. Senão, se outra IA tem conta em uso na máquina: troca de IA (automático,
 * como hoje). Senão pergunta com as contas livres (na máquina, noutra máquina ou em nenhuma: "Entrar com ela aqui").
 * Nenhuma livre: todas no limite, com a volta mais cedo.
 */
export function decidirLimiteDaConta(p: {
  contas: readonly ContaDaPessoa[];
  naMaquina: ReadonlySet<string>;
  /** As contas `pronta` noutra máquina da pessoa (id → a máquina), para "Rodar no <nome> desta vez". */
  noutraMaquina: ReadonlyMap<string, { id: string; nome: string }>;
  modo: ModoDasContas;
  escolhidas: Partial<Record<IaComConta, string>>;
  ordemDoBot: readonly IdHarness[] | null;
  contaId: string;
  ate: EpochMs | null;
  agora: EpochMs;
}): { contas: ContaDaPessoa[]; decisao: DecisaoDoLimiteDaConta } {
  const ate = p.ate ?? p.agora + PRAZO_SEM_HORARIO_MS;
  const contas = p.contas.map((c) => (c.id === p.contaId ? { ...c, noLimiteAte: ate } : c));
  const conta = contas.find((c) => c.id === p.contaId);
  if (!conta) return { contas, decisao: { tipo: "todas_no_limite", voltaEm: ate } };
  // A escolha antiga da IA não vale mais (QA do NOD-211: ao perguntar, nada fica escolhido).
  const escolhidas = { ...p.escolhidas };
  delete escolhidas[conta.ia];
  const proximo = contaDoTurno({ contas, naMaquina: p.naMaquina, modo: p.modo, escolhidas, ordemDoBot: p.ordemDoBot, agora: p.agora });
  const mesmaIa = proximo?.porIa[conta.ia];
  if (mesmaIa && mesmaIa.id !== conta.id) return { contas, decisao: { tipo: "trocou", para: mesmaIa } };
  const outraIa = proximo?.ordemIas.map((ia) => proximo.porIa[ia as IaComConta]).find((c): c is ContaDaPessoa => !!c && c.ia !== conta.ia);
  if (outraIa) return { contas, decisao: { tipo: "outra_ia", para: outraIa } };
  const livres: ContaLivre[] = emOrdem(contas)
    .filter((c) => c.id !== conta.id && livre(c, p.agora))
    .map((c) => ({ id: c.id, apelido: c.apelido, ia: c.ia, naMaquina: p.naMaquina.has(c.id), outraMaquina: p.noutraMaquina.get(c.id) ?? null }));
  if (livres.length > 0) return { contas, decisao: { tipo: "perguntar", livres } };
  const voltas = emOrdem(contas).map((c) => c.noLimiteAte).filter((t): t is number => t !== null && t > p.agora);
  return { contas, decisao: { tipo: "todas_no_limite", voltaEm: voltas.length > 0 ? Math.min(...voltas) : null } };
}

/** A ordem das IAs da pessoa derivada da lista (suposição 3 da ADR-102): a primeira aparição de cada IA, depois as outras. */
export function ordemIasDaLista(contas: readonly ContaDaPessoa[], padrao: readonly IdHarness[]): IdHarness[] {
  const vistas: IdHarness[] = [];
  for (const c of emOrdem(contas)) if (!vistas.includes(c.ia)) vistas.push(c.ia);
  return [...vistas, ...padrao.filter((ia) => !vistas.includes(ia))];
}

/**
 * O que fazer com uma conta anunciada por uma máquina (R4 da revisão): conta nova → criar; existente → atualizar o
 * vínculo; removida e logada ANTES da remoção → pedir saída (a máquina não tinha recebido o pedido); removida e logada
 * depois → voltar à lista (um login novo é intenção da pessoa).
 */
export function decidirAnuncio(existente: Pick<ContaDaPessoa, "removidaEm"> | null, logadaEm: EpochMs): "criar" | "atualizar" | "voltar" | "sair" {
  if (!existente) return "criar";
  if (existente.removidaEm === null) return "atualizar";
  return logadaEm > existente.removidaEm ? "voltar" : "sair";
}

/** O apelido de uma conta nova sem sugestão: "Conta N", N = a posição dela na lista. */
export const apelidoPadrao = (posicao: number): string => `Conta ${posicao}`;

/** "Claude · Leapy" — como a conversa e a tela chamam a conta. */
export const nomeDaConta = (c: { ia: IaComConta; apelido: string }): string => `${c.ia === "claude-cli" ? "Claude" : "ChatGPT"} · ${c.apelido}`;

/**
 * A frase da conversa (ADR-102 suposição 2: a conta pelo apelido). `quando` dá a hora ("14:00") e `quandoVolta` a hora
 * com a preposição ("às 14:00").
 */
export function fraseDoLimiteDaConta(
  de: { ia: IaComConta; apelido: string },
  d: DecisaoDoLimiteDaConta,
  p: { maquina: string | null; quando: (t: EpochMs) => string; quandoVolta: (t: EpochMs) => string; voltaEm: EpochMs | null },
): string {
  const onde = p.maquina ? ` na ${p.maquina}` : "";
  const noLimite = `${nomeDaConta(de)} no limite${onde}${p.voltaEm !== null ? ` até ${p.quando(p.voltaEm)}` : ""}.`;
  if (d.tipo === "trocou" || d.tipo === "outra_ia") return `${noLimite} Seguindo com ${nomeDaConta(d.para)}.`;
  if (d.tipo === "perguntar") {
    const aqui = d.livres.filter((c) => c.naMaquina);
    if (aqui.length > 0) return `${noLimite} Seguir com ${aqui.length === 1 ? nomeDaConta(aqui[0]!) : "outra conta"}?`;
    const [primeira] = d.livres;
    return `${noLimite} ${nomeDaConta(primeira!)} está livre, mas ${p.maquina ? `não está na ${p.maquina}` : "não está nesta máquina"}.`;
  }
  return `Todas as suas contas estão no limite${d.voltaEm !== null ? `. A primeira volta ${p.quandoVolta(d.voltaEm)}` : ""}.`;
}
