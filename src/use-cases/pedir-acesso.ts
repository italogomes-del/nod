import type { AcessoPedido, ResultadoPedirAcesso } from "../contracts/acesso.ts";
import type { Conector } from "../contracts/conector.ts";
import type { PayloadPropostaAcesso, Proposta } from "../contracts/conversa.ts";
import type { Decisao } from "../contracts/decisao.ts";
import type { Autoria, RuntimeEvent } from "../contracts/evento.ts";
import type { CasoNod, ContextoFerramenta } from "../contracts/servicos.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { SLUG_GITHUB } from "../contracts/github.ts";
import { capacidadesDoNivel } from "../domain/grupos-de-acesso.ts";
import { normalizarPedidoAcesso } from "../domain/pedido-acesso.ts";
import { rotinaDoTurno } from "./apoio-l7.ts";
import { evento } from "./autoria-evento.ts";
import { garantirGithubSemConfiguracao } from "./conectar-github.ts";
import { abrirDecisaoDeAcesso, eventosDoPedido, garantirPedidoDeAcesso } from "./garantir-pedido-de-acesso.ts";
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
 * Só o pedido da CONVERSA desde 2026-09-24 (emenda da ADR-044): o de rotina nasce por
 * garantirPedidoDeAcesso, que passa pelo índice único da 0026 — um INSERT daqui com `rotinaId` daria 23505.
 */
export async function abrirPedidoDeAcesso(
  deps: Deps,
  p: { conversaId: string; agenteId: string; turnoId: string | null; payload: PayloadPropostaAcesso; conector: Pick<Conector, "slug" | "nome" | "catalogo">; autoria: Autoria },
): Promise<{ proposta: Proposta; decisao: Decisao; events: RuntimeEvent[] }> {
  const proposta = await deps.repos.propostas.criar({ conversaId: p.conversaId, agenteId: p.agenteId, payload: p.payload });
  if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
  const decisao = await abrirDecisaoDeAcesso(deps, { proposta, payload: p.payload, conector: p.conector, instrucaoDaRotina: null, turnoId: p.turnoId });
  return { proposta, decisao, events: eventosDoPedido(deps, { proposta, payload: p.payload, decisao, autoria: p.autoria, turnoId: p.turnoId }) };
}

/**
 * O pedido PENDENTE da CONVERSA que este repete, se houver (definido em 2026-09-21): mesmo turno,
 * conector e capacidades — a Cecília chamou pedir_acesso três vezes em 3 s e cada chamada virou um
 * card. Pedido cuja decisão já venceu não conta: devolvê-lo deixaria o agente apontando para um card
 * que saiu da tela. O de ROTINA não passa aqui desde 2026-09-24 (emenda da ADR-044): é um por (agente,
 * app), de qualquer rotina, e quem garante é garantirPedidoDeAcesso, pelo índice único da 0026.
 */
async function pedidoRepetido(deps: Deps, ctx: ContextoFerramenta, pedido: AcessoPedido): Promise<Proposta | null> {
  const mesmas = [...pedido.capacidades].sort().join(",");
  for (const p of await deps.repos.propostas.pendentesDaConversa(ctx.conversaId)) {
    if (p.payload.kind !== "acesso" || p.agenteId !== ctx.agenteId || p.payload.conector !== pedido.conector || p.payload.rotinaId) continue;
    // revisto em 2026-09-25: o nível também — com [] as capacidades são iguais e um pedido de escrita virava o card de leitura.
    const repete = p.payload.turnoId === ctx.turnoId && p.payload.nivel === pedido.nivel && [...new Set(p.payload.capacidades)].sort().join(",") === mesmas;
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
 * (decidir-acesso.ts concede). Turno de rotina só pede leitura — ou a escrita que a rotina declarou — e
 * o pedido carrega a rotina: permitir roda a rotina de novo, recusar a pausa — e, desde 2026-09-24
 * (emenda da ADR-044), é UM por (agente, app) com o pré-voo (garantirPedidoDeAcesso). Nada é concedido aqui.
 */
export const pedirAcesso: CasoNod<Deps, "pedir_acesso"> = async (deps, input) => {
  const ligacao = await rotinaDoTurno(deps.repos, input.turnoId);
  let conector = await deps.repos.conectores.buscarPorSlug(input.conector);
  let entrada = input;
  if (input.conector === SLUG_GITHUB && !conector?.habilitado) {
    // definido em 2026-09-24 (ADR-048): com o gh desta máquina logado (ou o App da organização no
    // servidor), o GitHub nasce aqui mesmo e o
    // card já sai com o botão de permitir — nada de card de conexão nem passo de configuração. Sem
    // capacidades nomeadas, o nível decide: leitura = as de leitura, escrita = o catálogo inteiro.
    const r = await garantirGithubSemConfiguracao(deps, { pelaPessoa: false });
    if (r.ok) {
      conector = r.conector;
      // revisto em 2026-09-25 (ADR-049): o mesmo nível de todo app — escrita sem o grupo apagar.
      if (input.capacidades.length === 0) entrada = { ...input, capacidades: capacidadesDoNivel(r.conector.catalogo, input.nivel) };
    }
  }
  // definido em 2026-09-24 (emenda da ADR-044, "rotina nasce com o acesso"): a escrita que a rotina
  // DECLAROU para este app — a pessoa a viu no card da rotina — pode ser pedida pelo turno; fora dela, não.
  const declaradas = ligacao?.rotina.acessos?.filter((a) => a.conector === input.conector).flatMap((a) => a.capacidades) ?? [];
  const pedido = normalizarPedidoAcesso({ pedido: entrada, conector, emRotina: ligacao !== null, declaradas });
  const rotina = ligacao?.rotina ?? null;
  const autoria = autoriaDoAgente(deps.escopo, input.agenteId);
  if (rotina) {
    // definido em 2026-09-24 (emenda da ADR-044): o card da rotina é UM por (agente, app) — o pré-voo pode
    // já tê-lo aberto, e o INSERT direto bateria no índice único (23505) no meio da ferramenta.
    const g = await garantirPedidoDeAcesso(deps, {
      agenteId: input.agenteId,
      conversaId: input.conversaId,
      rotinaId: rotina.id,
      instrucaoDaRotina: rotina.instrucao,
      slug: pedido.conector,
      conector,
      conectar: pedido.conectar === true,
      capacidades: pedido.conectar ? null : pedido.capacidades,
      naoPedido: pedido.naoPedido,
      turnoId: input.turnoId,
      autoria,
    });
    return { data: aguardandoPessoa(g.proposta.id), events: g.events };
  }
  const repetido = await pedidoRepetido(deps, entrada, pedido);
  if (repetido) return { data: aguardandoPessoa(repetido.id), events: [] };

  const payload: PayloadPropostaAcesso = {
    kind: "acesso",
    turnoId: input.turnoId,
    ...(pedido.conectar ? { conectar: true as const } : {}),
    conector: pedido.conector,
    capacidades: pedido.capacidades,
    nivel: pedido.nivel,
    naoPedido: pedido.naoPedido,
    ...(pedido.para ? { para: pedido.para } : {}),
  };
  if (pedido.conectar || !conector) {
    // O app ainda não está pronto: só o card de conexão. A concessão vem depois (confirmar-proposta.ts).
    const proposta = await deps.repos.propostas.criar({ conversaId: input.conversaId, agenteId: input.agenteId, payload });
    if (!proposta) throw new ErroDeDominio("estado_invalido", { cause: "proposta não criada" });
    const criada = evento(deps.escopo, { kind: "proposta_criada", autoria, agora: deps.agora(), conversaId: input.conversaId, turnoId: input.turnoId, dados: { proposta_id: proposta.id, kind: "acesso", conector: pedido.conector, capacidades: 0, nivel: pedido.nivel } });
    return { data: aguardandoPessoa(proposta.id), events: [criada] };
  }
  const aberto = await abrirPedidoDeAcesso(deps, { conversaId: input.conversaId, agenteId: input.agenteId, turnoId: input.turnoId, payload, conector, autoria });
  return { data: aguardandoPessoa(aberto.proposta.id), events: aberto.events };
};
