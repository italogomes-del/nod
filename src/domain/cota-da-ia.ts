import type { CotaDaIa, CotaDto, SituacaoDaCota } from "../contracts/cota.ts";
import type { IdHarness } from "../contracts/harness.ts";
import type { EpochMs } from "../contracts/ids.ts";
import type { LimitesIa } from "../contracts/inteligencia.ts";
import type { OrigemTurno } from "../contracts/turno.ts";
import type { JanelaDoPlano, UsoDoPlano } from "../contracts/uso-do-plano.ts";
import { harnessFixado } from "./harness.ts";
import { PRAZO_LIMITE_SEM_HORARIO_MS } from "./inteligencia.ts";

/**
 * A cota da IA como portão do trabalho de fundo (definido em 2026-10-12, ADR-099 §7; decisão do Marlon em 12/10). Puro:
 * `agora` por parâmetro. A leitura é a que o próprio CLI manda a cada turno (`rate_limit_event` do Claude Code, gravado em
 * `uso_do_plano`, NOD-179) e o limite que o turno devolveu (`preferencias.ias_no_limite`, 0068). O `reivindicar`
 * (turnos.repo.ts) repete esta regra em SQL; tests/integration/cota-da-ia.test.ts confere as duas.
 */

/** definido em 2026-10-12 (decisão do Marlon): 1% da cota fica para a conversa com a pessoa. */
export const COTA_RESERVADA_PARA_A_CONVERSA = 0.01;
/** A partir daqui (99%), trabalho novo de fundo para de nascer. */
export const LIMIAR_DA_RESERVA = 1 - COTA_RESERVADA_PARA_A_CONVERSA;
/**
 * Uma janela sem horário de renovação (o CLI não disse) vale 1 h desde a leitura, o mesmo prazo do limite sem horário
 * (PRAZO_LIMITE_SEM_HORARIO_MS): depois disso a IA volta a ser tentada e o próximo turno traz a leitura nova.
 */
export const LEITURA_SEM_HORARIO_VALE_MS = PRAZO_LIMITE_SEM_HORARIO_MS;

/** Até quando a janela vale: a renovação que o CLI disse, ou 1 h depois da leitura. Já passou = a janela renovou. */
function vigenteAte(j: JanelaDoPlano, medidoEm: EpochMs): EpochMs {
  return j.renovaEm ?? medidoEm + LEITURA_SEM_HORARIO_VALE_MS;
}

const PESO: Record<SituacaoDaCota, number> = { livre: 0, reserva: 1, limite: 2 };

/**
 * As IAs da pessoa que seguram trabalho de fundo agora. `limite` vem do limite gravado (o sinal do fornecedor no turno),
 * de uma janela em 100% ou da última leitura "esgotado"; `reserva`, de uma janela em 99% ou mais. Janela renovada
 * (o horário passou) não conta: a leitura velha não segura nada. `voltaEm` é a última renovação entre o que segura —
 * o trabalho de fundo novo só volta quando a IA sai do limite E da reserva; janela sem horário conta 1 h desde a leitura.
 */
export function cotaDasIas(p: { usos: readonly UsoDoPlano[]; limites: LimitesIa | null | undefined; agora: EpochMs }): CotaDaIa[] {
  const porIa = new Map<IdHarness, { situacao: SituacaoDaCota; voltaEm: EpochMs }>();
  const marcar = (ia: IdHarness, situacao: SituacaoDaCota, voltaEm: EpochMs) => {
    const atual = porIa.get(ia) ?? { situacao: "livre" as SituacaoDaCota, voltaEm };
    porIa.set(ia, { situacao: PESO[situacao] > PESO[atual.situacao] ? situacao : atual.situacao, voltaEm: Math.max(atual.voltaEm, voltaEm) });
  };
  for (const [ia, l] of Object.entries(p.limites ?? {}) as [IdHarness, { renovaEm: number } | undefined][]) {
    if (l && l.renovaEm > p.agora) marcar(ia, "limite", l.renovaEm);
  }
  for (const u of p.usos) {
    const janelas = [u.cincoHoras, u.semana].filter((j): j is JanelaDoPlano => j !== null);
    const vigentes = janelas.filter((j) => vigenteAte(j, u.medidoEm) > p.agora);
    for (const j of vigentes) {
      if (j.utilizacao >= 1) marcar(u.harness, "limite", vigenteAte(j, u.medidoEm));
      else if (j.utilizacao >= LIMIAR_DA_RESERVA) marcar(u.harness, "reserva", vigenteAte(j, u.medidoEm));
    }
    // "esgotado" (status `rejected`) sem janela em 100%: vale 1 h desde a leitura, ou até a janela mais longa que ainda
    // não renovou. Depois, o próximo turno diz (e o limite que ele devolver traz o horário do fornecedor).
    if (u.situacao === "esgotado" && u.medidoEm + LEITURA_SEM_HORARIO_VALE_MS > p.agora && !vigentes.some((j) => j.utilizacao >= 1)) {
      marcar(u.harness, "limite", Math.max(u.medidoEm + LEITURA_SEM_HORARIO_VALE_MS, ...vigentes.map((j) => vigenteAte(j, u.medidoEm))));
    }
  }
  return [...porIa.entries()]
    .filter(([, c]) => c.situacao !== "livre")
    .map(([ia, c]) => ({ ia, situacao: c.situacao as CotaDaIa["situacao"], voltaEm: c.voltaEm }))
    .sort((a, b) => a.ia.localeCompare(b.ia));
}

/** A situação de UMA IA (livre quando não segura nada). */
export function situacaoDaIa(cota: readonly CotaDaIa[], ia: string): SituacaoDaCota {
  return cota.find((c) => c.ia === ia)?.situacao ?? "livre";
}

/**
 * O que o turno é para a cota:
 * - `conversa`: a conversa com a pessoa — a fala dela (conversa, sala), a retomada que ela pediu e a ligação. Nunca segura;
 * - `fundo_novo`: trabalho de fundo que ainda não começou — uma task (frente) que nunca rodou, de qualquer origem, e o
 *   turno de rotina ou de pedido de colega sem task;
 * - `fundo_seguindo`: o próximo turno de um trabalho de fundo que já começou, e a volta marcada (`me_chame_as`).
 */
export type TipoParaCota = "conversa" | "fundo_novo" | "fundo_seguindo";

export function tipoParaCota(t: { origem: OrigemTurno; trabalhoId?: string | null; acordarEm?: number | null }, trabalho: { iniciadoEm: number | null } | null): TipoParaCota {
  if (t.origem === "ligacao") return "conversa";
  if (t.trabalhoId) return trabalho && trabalho.iniciadoEm === null ? "fundo_novo" : "fundo_seguindo";
  if (t.origem === "rotina" || t.origem === "delegacao" || t.origem === "peer") return "fundo_novo";
  return t.acordarEm != null ? "fundo_seguindo" : "conversa";
}

/** A regra: no limite, todo o fundo espera; na reserva, só o fundo novo. A conversa com a pessoa sempre passa. */
export function cotaSegura(tipo: TipoParaCota, situacao: SituacaoDaCota): boolean {
  if (tipo === "conversa" || situacao === "livre") return false;
  return situacao === "limite" || tipo === "fundo_novo";
}

/**
 * A situação da cota para o turno pela IA dele: fixado numa IA, a dela; no Automático, a MENOS segurada entre as IAs que
 * podem pegá-lo (`iasDoAutomatico`) — o plano escolhe essa (emitir-plano-turno.ts põe as que seguram no `noLimite` do
 * trabalho de fundo). Sem nenhuma, livre: o despacho recusa por outro motivo.
 */
export function situacaoDoTurno(t: { harness: string; modelo: string }, cota: readonly CotaDaIa[], iasDoAutomatico: readonly string[]): SituacaoDaCota {
  const fixo = harnessFixado(t.harness, t.modelo);
  if (fixo) return situacaoDaIa(cota, fixo);
  if (iasDoAutomatico.length === 0) return "livre";
  return iasDoAutomatico.map((ia) => situacaoDaIa(cota, ia)).reduce((a, b) => (PESO[b] < PESO[a] ? b : a));
}

/**
 * O que o `reivindicar` recebe: as IAs que seguram o fundo novo (reserva ou limite), as que seguram todo o fundo (limite) e
 * o mesmo para o turno do Automático, pelas IAs que podem pegá-lo nesta máquina. null = nada segura (o SQL fica igual).
 */
export type PortaoDaCota = { reserva: string[]; limite: string[]; autoReserva: boolean; autoLimite: boolean };

export function portaoDaCota(cota: readonly CotaDaIa[], iasDoAutomatico: readonly string[]): PortaoDaCota | null {
  if (cota.length === 0) return null;
  const auto = situacaoDoTurno({ harness: "auto", modelo: "auto" }, cota, iasDoAutomatico);
  return {
    reserva: cota.map((c) => c.ia),
    limite: cota.filter((c) => c.situacao === "limite").map((c) => c.ia),
    autoReserva: auto !== "livre",
    autoLimite: auto === "limite",
  };
}

/**
 * Para a tela (`GET trabalhos`): a pior situação, as IAs que seguram e quando o fundo volta (a última renovação).
 * null = nada segura.
 */
export function cotaParaTela(cota: readonly CotaDaIa[]): CotaDto | null {
  if (cota.length === 0) return null;
  return {
    situacao: cota.some((c) => c.situacao === "limite") ? "limite" : "reserva",
    ias: cota.map((c) => c.ia),
    voltaEm: Math.max(...cota.map((c) => c.voltaEm)),
  };
}

/**
 * Para a linha da task (`GET trabalhos`): a task aberta, sem turno vivo, que a cota da IA do bot segura agora. Na reserva,
 * só a que nunca começou (o fundo novo); no limite, também a que já começou e espera o próximo turno ou a volta marcada.
 * Quem espera a pessoa (decisão aberta) ou um colega não espera pela cota.
 */
export function esperaDaCotaNaTela(t: { estado: string; iniciadoEm: number | null; turnoVivoId: string | null; esperandoColega?: unknown }, situacao: SituacaoDaCota): boolean {
  if (situacao === "livre" || t.turnoVivoId || t.esperandoColega) return false;
  if (t.estado === "na_fila") return situacao === "limite" || t.iniciadoEm === null;
  return t.estado === "rodando" && situacao === "limite";
}

/**
 * As IAs que a pessoa já usou (têm leitura ou limite gravado): no Automático, a tela considera a task segurada só se todas
 * elas seguram — com uma livre, o plano iria por ela. Aproximação da regra do `reivindicar`, que olha as IAs prontas da
 * máquina (a lista não as conhece).
 */
export function iasConhecidas(usos: readonly Pick<UsoDoPlano, "harness">[], limites: LimitesIa | null | undefined): IdHarness[] {
  return [...new Set([...usos.map((u) => u.harness), ...(Object.keys(limites ?? {}) as IdHarness[])])];
}


/**
 * definido em 2026-10-12 (ADR-099 §7, na integração com a parte 1): o começo da entrada da volta que a cota no limite marca
 * (assentar-turno, aposLimiteNoFundo). É o que separa essa volta das que o bot marcou (me_chame_as, esperar_comando): o
 * `turnos.ultimasVoltas` o lê para que ela não conte como "volta sem novidade" (voltas-sem-novidade.ts).
 */
export const ENTRADA_DA_VOLTA_DA_COTA = "[nod] A cota do ";

export function entradaDaVoltaDaCota(nomeDaIa: string): string {
  return `${ENTRADA_DA_VOLTA_DA_COTA}${nomeDaIa} chegou ao limite no meio deste trabalho e o nod esperou ela renovar. Siga de onde parou; o que já saiu antes do limite continua valendo.`;
}

/**
 * definido em 2026-10-12 (ADR-101, QA do NOD-211): a entrada da volta da task cuja conta parou e o Mac já seguiu com outra
 * conta da mesma IA ("Trocar sozinho"). Começa com ENTRADA_DA_VOLTA_DA_COTA, para contar como a volta da cota (e não como
 * volta sem novidade). Só posições (ADR-019): o apelido mora no Mac.
 */
export function entradaDaTrocaDeConta(nomeDaIa: string, de: number, para: number): string {
  return `${ENTRADA_DA_VOLTA_DA_COTA}${nomeDaIa} chegou ao limite na conta ${de} no meio deste trabalho e o nod seguiu com a conta ${para}. Siga de onde parou; o que já saiu antes do limite continua valendo.`;
}

/**
 * definido em 2026-10-16 (ADR-108 R4/R5): a entrada da volta da task que o nod LEVOU para outra IA (a pessoa escolheu
 * "Levar as tasks", o prazo da recomendação venceu ou o bot fixo seguiu noutra IA até a volta). Substitui a da espera
 * (que dizia "o nod esperou ela renovar", o que deixaria de ser verdade). Começa com ENTRADA_DA_VOLTA_DA_COTA, para
 * contar como a volta da cota (e não como volta sem novidade). A sessão do CLI ficou na outra IA: a task recomeça do
 * histórico dela, então o texto pede para conferir o estado antes de seguir.
 */
export function entradaDaTrocaDeIa(nomeDe: string, nomePara: string): string {
  return `${ENTRADA_DA_VOLTA_DA_COTA}${nomeDe} chegou ao limite no meio deste trabalho e o nod passou este trabalho para o ${nomePara}. A sessão anterior ficou no ${nomeDe}: confira o estado (arquivos, branch, o que já saiu) e siga de onde parou.`;
}
