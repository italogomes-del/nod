import type { ContaDoPlano, ContasNoLimite, IaComConta } from "../contracts/contas-ia.ts";
import type { Autoria, RuntimeEvent } from "../contracts/evento.ts";
import type { IdHarness } from "../contracts/harness.ts";
import type { Turno } from "../contracts/turno.ts";
import { contaDoTurno, decidirLimiteDaConta, fraseDoLimiteDaConta, type ContaDaPessoa, type ContaDoTurno, type DecisaoDoLimiteDaConta, type VinculoDaConta } from "../domain/contas-da-pessoa.ts";
import { horaDaFrase, quandoDaFrase } from "../domain/erro-fornecedor.ts";
import type { ContaGuardadaNoServidor } from "../repositories/contas-ia.repo.ts";
import { evento } from "./autoria-evento.ts";
import type { Deps } from "./tipos.ts";

/**
 * A conta do turno (definido em 2026-10-13, ADR-102 item 5): o servidor escolhe, pela lista da pessoa e pelo que a
 * máquina do turno tem logado; o plano leva a conta e a máquina usa a pasta dela. Sem conta anunciada na máquina (motor
 * ou app antigo), nada muda: o plano sai sem `conta` e a máquina usa a pasta padrão.
 */

export type ContasDaMaquina = {
  contas: ContaGuardadaNoServidor[];
  vinculos: VinculoDaConta[];
  escolhidas: Partial<Record<IaComConta, string>>;
  /** As contas `pronta` na máquina do turno, sem saída pedida. */
  naMaquina: Set<string>;
  /** As contas `pronta` noutra máquina viva da pessoa (para "Rodar no <nome> desta vez"). */
  noutraMaquina: Map<string, { id: string; nome: string }>;
  /** Nome da máquina do turno (null = sem chave: o Mac do modo local). */
  nomeDaMaquina: string | null;
};

/**
 * Red team do PR #306: "noutra máquina" só vale para máquina com contato recente (a chave é usada a cada puxada); uma VM
 * desligada sem "Desconectar" não é oferecida em "Rodar no <máquina> desta vez".
 */
export const CONTATO_RECENTE_MS = 2 * 60_000;

export async function lerContasDaMaquina(deps: Pick<Deps, "repos" | "agora">, machineId: string): Promise<ContasDaMaquina> {
  // ADR-108: o "Perguntar antes"/"Trocar sozinho" (preferencias.contas_modo) não decide mais nada; só a escolhida vale.
  const [{ contas, vinculos }, { escolhidas }, chaves] = await Promise.all([deps.repos.contasIa.listar(), deps.repos.contasIa.modo(), deps.repos.maquinaTokens.listar()]);
  const agora = deps.agora();
  const nomes = new Map(chaves.filter((c) => c.revogadaEm === null).map((c) => [c.id, c.nome]));
  const vivas = new Map(chaves.filter((c) => c.revogadaEm === null && c.ultimoUsoEm !== null && agora - c.ultimoUsoEm < CONTATO_RECENTE_MS).map((c) => [c.id, c.nome]));
  const prontas = vinculos.filter((v) => v.estado === "pronta" && v.sairPedidoEm === null);
  const naMaquina = new Set(prontas.filter((v) => v.maquinaId === machineId).map((v) => v.contaId));
  const noutraMaquina = new Map<string, { id: string; nome: string }>();
  for (const v of prontas) if (v.maquinaId !== machineId && vivas.has(v.maquinaId) && !noutraMaquina.has(v.contaId)) noutraMaquina.set(v.contaId, { id: v.maquinaId, nome: vivas.get(v.maquinaId)! });
  return { contas, vinculos, escolhidas, naMaquina, noutraMaquina, nomeDaMaquina: nomes.get(machineId) ?? null };
}

export function escolherContaDoTurno(c: ContasDaMaquina, ordemDoBot: readonly IdHarness[] | null, agora: number): ContaDoTurno<ContaGuardadaNoServidor> | null {
  return contaDoTurno({ contas: c.contas, naMaquina: c.naMaquina, escolhidas: c.escolhidas, ordemDoBot, agora });
}

export const contaDoPlano = (c: Pick<ContaGuardadaNoServidor, "id" | "impressao" | "apelido">): ContaDoPlano => ({ id: c.id, impressao: c.impressao, apelido: c.apelido });

/**
 * O turno não tem conta para usar nesta máquina sem a pessoa decidir? `iasDoTurno` são as IAs que podem pegá-lo (a fixa,
 * ou as prontas na máquina no Automático); IA sem conta anunciada aqui segue o caminho de antes (não segura o turno).
 * Devolve a conta "de" (a primeira da lista nesta máquina, a que parou) e a decisão para a nota; null = segue.
 * ADR-108 (R2): com `iaFixa`, a decisão só olha as contas dela (nunca oferece conta de outra IA).
 */
export function semContaParaOTurno(c: ContasDaMaquina, r: ContaDoTurno<ContaGuardadaNoServidor> | null, iasDoTurno: readonly string[], agora: number, iaFixa: IaComConta | null = null): { de: ContaDaPessoa; decisao: DecisaoDoLimiteDaConta; voltaEm: number | null } | null {
  if (!r) return null;
  const governadas = iasDoTurno.filter((ia): ia is IaComConta => ia in r.porIa);
  const livresSemConta = iasDoTurno.filter((ia) => !(ia in r.porIa));
  if (governadas.length === 0 || livresSemConta.length > 0 || governadas.some((ia) => r.porIa[ia])) return null;
  const naOrdem = c.contas.filter((x) => x.removidaEm === null && c.naMaquina.has(x.id) && governadas.includes(x.ia)).sort((a, b) => a.posicao - b.posicao);
  const de = naOrdem.find((x) => x.noLimiteAte !== null && x.noLimiteAte > agora) ?? naOrdem[0];
  if (!de) return null;
  const { decisao } = decidirLimiteDaConta({ contas: c.contas, naMaquina: c.naMaquina, noutraMaquina: c.noutraMaquina, escolhidas: {}, ordemDoBot: null, iaFixa, contaId: de.id, ate: de.noLimiteAte, agora });
  return { de, decisao, voltaEm: de.noLimiteAte };
}

/** O payload `contas` da nota de limite (a tela desenha os botões). */
export function contasDaNota(de: ContaDaPessoa, d: DecisaoDoLimiteDaConta, maquina: { id: string; nome: string } | null, voltaEm: number | null): ContasNoLimite {
  return { de: { id: de.id, apelido: de.apelido, ia: de.ia }, livres: d.tipo === "perguntar" ? d.livres : [], maquina, voltaEm };
}

/** A nota da conversa quando nenhuma conta serve (no despacho ou no assentamento): a frase pelo apelido e os botões. */
export async function criarNotaDeContas(deps: Pick<Deps, "repos" | "escopo">, p: {
  turno: Turno;
  autoria: Autoria;
  agora: number;
  de: ContaDaPessoa;
  decisao: DecisaoDoLimiteDaConta;
  maquina: { id: string; nome: string } | null;
  voltaEm: number | null;
}): Promise<RuntimeEvent[]> {
  const voltaEm = p.decisao.tipo === "todas_no_limite" ? p.decisao.voltaEm : p.voltaEm;
  const texto = fraseDoLimiteDaConta(p.de, p.decisao, { maquina: p.maquina?.nome ?? null, quando: (t) => horaDaFrase(t, p.agora), quandoVolta: (t) => quandoDaFrase(t, p.agora), voltaEm });
  const aviso = await deps.repos.mensagens.criar({
    conversaId: p.turno.conversaId,
    turnoId: p.turno.id,
    autoria: p.autoria,
    kind: "sistema",
    texto,
    payload: { kind: "limite_do_plano", harness: p.de.ia, voltaEm: voltaEm !== null && voltaEm > p.agora ? voltaEm : null, contas: contasDaNota(p.de, p.decisao, p.maquina, voltaEm) },
    confianca: "confiavel",
  });
  return aviso ? [evento(deps.escopo, { kind: "mensagem_criada", autoria: p.autoria, agora: p.agora, conversaId: p.turno.conversaId, turnoId: p.turno.id, dados: { mensagem_id: aviso.id, kind: "sistema" } })] : [];
}
