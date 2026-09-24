import type { AcessoPedido, ResultadoPedirAcesso } from "../contracts/acesso.ts";
import type { Conector } from "../contracts/conector.ts";
import type { PayloadPropostaAcesso, Proposta } from "../contracts/conversa.ts";
import type { Decisao } from "../contracts/decisao.ts";
import type { Autoria, RuntimeEvent } from "../contracts/evento.ts";
import type { Rotina } from "../contracts/rotina.ts";
import type { CasoNod, ContextoFerramenta } from "../contracts/servicos.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { fraseDoPedidoDeAcesso, normalizarPedidoAcesso } from "../domain/pedido-acesso.ts";
import { rotinaDoTurno } from "./apoio-l7.ts";
import { evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import type { Deps } from "./tipos.ts";

function aguardandoPessoa(propostaId: string): ResultadoPedirAcesso {
  return { proposta_id: propostaId, estado: "aguardando_pessoa", instrucao: "o acesso ainda NÃO foi concedido: diga que pediu e encerre o turno" };
}

/**
 * Proposta + decisão 'acesso' com o MESMO id (definido em 2026-09-24, ADR-044; a ligação de propor()
 * em rotinas-do-agente.ts): o card da conversa e "Sua vez" decidem pelo MESMO botão, num clique.
 * Antes a pessoa confirmava a proposta e só então nascia a decisão de conceder — e a pessoa e o
 * agente entendiam que o primeiro clique já tinha dado o acesso. A frase é do domínio, nunca do modelo.
 */
export async function abrirPedidoDeAcesso(
  deps: Deps,
  p: { conversaId: string; agenteId: string; turnoId: string | null; payload: PayloadPropostaAcesso; conector: Pick<Conector, "slug" | "nome" | "catalogo">; rotina: Pick<Rotina, "instrucao"> | null; autoria: Autoria },
): Promise<{ proposta: Proposta; decisao: Decisao; events: RuntimeEvent[] }> {
  const agora = deps.agora();
  const agente = await deps.repos.agentes.buscar(p.agenteId);
  const proposta = await deps.repos.propostas.criar({ conversaId: p.conversaId, agenteId: p.agenteId, payload: p.payload });
  if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
  const decisao = await deps.repos.decisoes.criar({
    id: proposta.id,
    tipo: "acesso",
    agenteId: p.agenteId,
    conversaId: p.conversaId,
    turnoId: p.turnoId,
    prazoDecisaoEm: agora + PRAZO_DECISAO_PADRAO_MS,
    frase: fraseDoPedidoDeAcesso({ agente: agente?.nome ?? "O agente", slug: p.conector.slug, nomeConector: p.conector.nome, capacidades: p.payload.capacidades, catalogo: p.conector.catalogo, rotina: p.rotina?.instrucao ?? null }),
  });
  if (!decisao) throw new ErroDeDominio("nao_permitido");
  const ref = { autoria: p.autoria, agora, conversaId: p.conversaId, turnoId: p.turnoId };
  return {
    proposta,
    decisao,
    events: [
      evento(deps.escopo, { kind: "proposta_criada", ...ref, dados: { proposta_id: proposta.id, kind: "acesso", conector: p.payload.conector, capacidades: p.payload.capacidades.length, nivel: p.payload.nivel } }),
      evento(deps.escopo, { kind: "decisao_criada", ...ref, dados: { decisao_id: decisao.id, tipo: "acesso", proposta_id: proposta.id } }),
    ],
  };
}

/**
 * O pedido PENDENTE que este repete, se houver. Conversa (definido em 2026-09-21): mesmo turno,
 * conector e capacidades — a Cecília chamou pedir_acesso três vezes em 3 s e cada chamada virou um
 * card. Rotina (definido em 2026-09-24, ADR-044): mesmo agente, conector e rotina, sem olhar turno nem
 * capacidades — a rotina das 8h, 13h e 18h pediria de novo a cada disparo. Pedido cuja decisão já
 * venceu não conta: devolvê-lo deixaria o agente apontando para um card que saiu da tela.
 */
async function pedidoRepetido(deps: Deps, ctx: ContextoFerramenta, pedido: AcessoPedido, rotinaId: string | null): Promise<Proposta | null> {
  const mesmas = [...pedido.capacidades].sort().join(",");
  for (const p of await deps.repos.propostas.pendentesDaConversa(ctx.conversaId)) {
    if (p.payload.kind !== "acesso" || p.agenteId !== ctx.agenteId || p.payload.conector !== pedido.conector) continue;
    const repete = rotinaId !== null ? p.payload.rotinaId === rotinaId : p.payload.turnoId === ctx.turnoId && [...new Set(p.payload.capacidades)].sort().join(",") === mesmas;
    if (!repete) continue;
    const decisao = await deps.repos.decisoes.buscar(p.id);
    if (decisao && decisao.estado !== "pendente" && decisao.estado !== "reaberta") continue;
    return p;
  }
  return null;
}

/**
 * Pedido de acesso em português com escopo nomeado (E6.2). A validação é do domínio
 * (normalizarPedidoAcesso); aqui mora a ligação com o turno. App ainda não conectado vira só o card
 * de conexão; app pronto vira proposta + decisão de mesmo id, que a pessoa decide com um clique
 * (decidir-acesso.ts concede). Turno de rotina só pede leitura e o pedido carrega a rotina: permitir
 * roda a rotina de novo, recusar a pausa. Nada é concedido aqui.
 */
export const pedirAcesso: CasoNod<Deps, "pedir_acesso"> = async (deps, input) => {
  const ligacao = await rotinaDoTurno(deps.repos, input.turnoId);
  const conector = await deps.repos.conectores.buscarPorSlug(input.conector);
  const pedido = normalizarPedidoAcesso({ pedido: input, conector, emRotina: ligacao !== null });
  const rotina = ligacao?.rotina ?? null;
  const repetido = await pedidoRepetido(deps, input, pedido, rotina?.id ?? null);
  if (repetido) return { data: aguardandoPessoa(repetido.id), events: [] };

  const payload: PayloadPropostaAcesso = {
    kind: "acesso",
    turnoId: input.turnoId,
    ...(pedido.conectar ? { conectar: true as const } : {}),
    conector: pedido.conector,
    capacidades: pedido.capacidades,
    nivel: pedido.nivel,
    naoPedido: pedido.naoPedido,
    ...(rotina ? { rotinaId: rotina.id } : {}),
  };
  const autoria = autoriaDoAgente(deps.escopo, input.agenteId);
  if (pedido.conectar || !conector) {
    // O app ainda não está pronto: só o card de conexão. A concessão vem depois (confirmar-proposta.ts).
    const proposta = await deps.repos.propostas.criar({ conversaId: input.conversaId, agenteId: input.agenteId, payload });
    if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
    const criada = evento(deps.escopo, { kind: "proposta_criada", autoria, agora: deps.agora(), conversaId: input.conversaId, turnoId: input.turnoId, dados: { proposta_id: proposta.id, kind: "acesso", conector: pedido.conector, capacidades: 0, nivel: pedido.nivel } });
    return { data: aguardandoPessoa(proposta.id), events: [criada] };
  }
  const aberto = await abrirPedidoDeAcesso(deps, { conversaId: input.conversaId, agenteId: input.agenteId, turnoId: input.turnoId, payload, conector, rotina, autoria });
  return { data: aguardandoPessoa(aberto.proposta.id), events: aberto.events };
};
