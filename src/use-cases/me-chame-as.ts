import type { CasoNod } from "../contracts/servicos.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { horaDaFrase } from "../domain/erro-fornecedor.ts";
import { autoriaAgente, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import type { Deps } from "./tipos.ts";
import { sincronizarTrabalho } from "./trabalhos.ts";

/** definido em 2026-10-08 (ADR-086): de 1 min a 24 h — mais que um dia de espera é rotina, não "me chame às". */
export const ACORDAR_MIN_MINUTOS = 1;
export const ACORDAR_MAX_MINUTOS = 24 * 60;

/** A entrada da retomada: o que o bot disse que ia conferir, com a hora, como se fosse um lembrete dele mesmo. */
export function entradaDoDespertar(hora: string, motivo: string): string {
  return `[nod] São ${hora}: você pediu para voltar agora — ${motivo}. Confira e siga de onde parou. Se ainda não estiver pronto, chame me_chame_as de novo e encerre o turno.`;
}

/**
 * Ferramenta `me_chame_as` (ADR-086): o bot vai esperar algo demorado que não depende dele. Em vez de um laço com `sleep`
 * segurando processo e memória no Mac, ele enfileira a RETOMADA do próprio turno com `acordar_em` e encerra o turno. A
 * fila só a entrega a partir da hora (`reivindicar`), na mesma sessão, no mesmo trabalho (ou na conversa) e com a mesma
 * confiança e procuração. Até lá o trabalho fica `rodando` (há turno pendente), sem processo no Mac.
 */
export const meChameAs: CasoNod<Deps, "me_chame_as"> = async (deps, input) => {
  const turno = await deps.repos.turnos.buscar(input.turnoId);
  if (!turno || turno.agenteId !== input.agenteId) throw new ErroDeDominio("nao_permitido", { cause: "turno de outro bot" });
  const minutos = Math.round(input.em_minutos);
  if (!Number.isFinite(minutos) || minutos < ACORDAR_MIN_MINUTOS || minutos > ACORDAR_MAX_MINUTOS) throw new ErroDeDominio("entrada_invalida", { cause: "em_minutos fora de 1–1440" });
  const motivo = input.motivo.trim().slice(0, 300);
  if (motivo === "") throw new ErroDeDominio("texto_vazio");
  const agora = deps.agora();
  const acordarEm = agora + minutos * 60_000;
  const hora = horaDaFrase(acordarEm, agora);
  const agente = await deps.repos.agentes.buscar(turno.agenteId);
  const novo = await deps.repos.turnos.enfileirar({
    conversaId: turno.conversaId,
    agenteId: turno.agenteId,
    origem: "retomada",
    retomaTurnoId: turno.id,
    prazoEm: acordarEm + PRAZO_DECISAO_PADRAO_MS,
    profundidade: turno.profundidade,
    entradaTexto: entradaDoDespertar(hora, motivo),
    entradaConfianca: turno.entradaConfianca,
    sobProcuracaoDe: turno.sobProcuracaoDe ?? null,
    modelo: agente?.modelo ?? turno.modelo,
    harness: agente?.harness ?? turno.harness,
    acordarEm,
  });
  if (!novo) throw new ErroDeDominio("estado_invalido", { cause: "retomada do despertar não criada" });
  // A marca de quem leu algo de fora (ADR-062) atravessa para a volta, como em toda retomada.
  if (await deps.repos.turnos.contaminado(turno.id)) await deps.repos.turnos.contaminar(novo.id, agora);
  const autoria = autoriaAgente({ agenteId: turno.agenteId, contaDeExecucao: deps.escopo.pessoaId, executor: "catcher" });
  const events = [
    evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: turno.conversaId, turnoId: novo.id, dados: { origem: novo.origem, agente_id: turno.agenteId, trabalhoId: novo.trabalhoId ?? null, acordarEm } }),
    ...(await sincronizarTrabalho(deps, novo.trabalhoId ?? null)),
  ];
  return {
    data: { ok: true, volta_as: hora, acordar_em: new Date(acordarEm).toISOString(), instrucao: `Combinado: você volta sozinho às ${hora}, nesta mesma sessão. Diga em uma frase o que vai esperar e encerre o turno agora — não fique esperando.` },
    events,
  };
};
