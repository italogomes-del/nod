import type { Decisao, TipoDecisao } from "../contracts/decisao.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { DepsSuaVez } from "./listar-sua-vez.ts";
import type { CasoDeUso } from "./tipos.ts";

/** Os tipos que se respondem com texto (responder-decisao.ts): abertos, só eles saem pelo ×. */
const DISPENSAVEIS_ABERTAS: ReadonlySet<TipoDecisao> = new Set<TipoDecisao>(["pergunta", "falta_de_dado", "permissao"]);

export function podeDispensar(d: Pick<Decisao, "estado" | "tipo">): boolean {
  if (d.estado === "vencida") return true;
  return (d.estado === "pendente" || d.estado === "reaberta") && DISPENSAVEIS_ABERTAS.has(d.tipo);
}

/**
 * × no card (definido em 2026-09-24): a conversa da Nina acumulou cartões "falta um dado" vencidos
 * de rotinas que rodaram sem Gmail, e o único botão era "Reabrir" — a pessoa não tinha como tirar
 * da tela o que já não importava. Dispensar fecha como 'decidida' com desfecho 'dispensada', sem
 * retomar turno nem escrever na conversa. Se a decisão nasceu com uma proposta de mesmo id (acesso,
 * mudança de rotina) e ela ainda está pendente, a proposta é recusada junto: senão o card da
 * proposta voltaria à conversa com botões que dariam estado_invalido.
 */
export async function dispensarDecisao(deps: DepsSuaVez, input: { decisaoId: string }): Promise<{ data: { decisao: Decisao }; events: RuntimeEvent[] }> {
  const atual = await deps.repos.decisoes.buscar(input.decisaoId);
  if (!atual) throw new ErroDeDominio("nao_encontrado", { cause: "decisão" });
  if (!podeDispensar(atual)) throw new ErroDeDominio("estado_invalido", { cause: `decisão ${atual.tipo} ${atual.estado} não se dispensa` });
  const agora = deps.agora();
  const decisao = await deps.repos.decisoes.dispensar(atual.id, { por: deps.escopo.pessoaId, agora, antes: atual.estado });
  if (!decisao) throw new ErroDeDominio("nao_permitido", { cause: "nem dona nem decisora" });
  const proposta = await deps.repos.propostas.buscar(atual.id);
  if (proposta && proposta.estado === "pendente") await deps.repos.propostas.decidir(proposta.id, "recusada");
  return {
    data: { decisao },
    events: [evento(deps.escopo, { kind: "decisao_decidida", autoria: autoriaPessoa(deps.escopo), agora, conversaId: decisao.conversaId, turnoId: decisao.turnoId, dados: { decisao_id: decisao.id, tipo: decisao.tipo, dispensada: true } })],
  };
}

export const dispensarDecisaoComoCaso: CasoDeUso<{ decisaoId: string }, { decisao: Decisao }> = dispensarDecisao;
