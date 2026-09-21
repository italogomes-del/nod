import { randomUUID } from "node:crypto";
import type { RespostaMutacao } from "../../../contracts/api.ts";
import type { Decisao } from "../../../contracts/decisao.ts";
import type { Executor, RuntimeEvent } from "../../../contracts/evento.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import type { Escopo } from "../../../shared/types.ts";
import { aplicarAtualizacaoRotina, aplicarExclusaoRotina } from "../../../use-cases/aplicar-proposta-rotina.ts";
import { retomarAposAcesso } from "../../../use-cases/retomar-apos-acesso.ts";
import { conceder } from "../../../use-cases/conceder.ts";
import { confirmarProposta } from "../../../use-cases/confirmar-proposta.ts";
import { assentarAprovacao, executarItens, marcarEDecidir, retomarPorDecisao, type DesfechoExecutado, type MarcacaoItem } from "../../../use-cases/decidir.ts";
import { permitirSempre } from "../../../use-cases/permitir-sempre.ts";
import { recusarProposta } from "../../../use-cases/recusar-proposta.ts";
import { autoriaDaPessoa } from "../../../use-cases/registrar-negacao.ts";
import { fecharComResposta, retomarComResposta } from "../../../use-cases/responder-decisao.ts";
import { retomarTurno } from "../../../use-cases/retomar-turno.ts";
import type { Deps, Services } from "../../../use-cases/tipos.ts";
import type { Rota } from "../roteador.ts";
import { executar, textoDoCorpo, type DentroDeTx } from "./dentro-de-tx.ts";

export type DepsRotasDecisoes = {
  dentro: DentroDeTx;
  services: Pick<Services, "conectores" | "rotinas" | "computadores">;
  prazoDecisaoMs?: number;
  executor?: Executor;
};

const ID = "(?<id>[^/]+)";

function marcacoes(corpo: unknown): MarcacaoItem[] | undefined {
  const itens = typeof corpo === "object" && corpo !== null ? (corpo as { itens?: unknown }).itens : undefined;
  if (itens === undefined) return undefined;
  if (!Array.isArray(itens)) throw new ErroDeDominio("entrada_invalida", { cause: "itens" });
  return itens.map((i: unknown) => {
    const o = typeof i === "object" && i !== null ? (i as Record<string, unknown>) : {};
    if (typeof o.id !== "string" || typeof o.selecionado !== "boolean") throw new ErroDeDominio("entrada_invalida", { cause: "item" });
    return { id: o.id, selecionado: o.selecionado, ...(typeof o.textoFinal === "string" ? { textoFinal: o.textoFinal } : {}) };
  });
}

/** `sempre: true` no corpo = a pessoa clicou no terceiro botão junto com aprovar (ADR-042). */
function sempre(corpo: unknown): boolean {
  return typeof corpo === "object" && corpo !== null && (corpo as { sempre?: unknown }).sempre === true;
}

function recusada(corpo: unknown): boolean {
  return typeof corpo === "object" && corpo !== null && (corpo as { recusar?: unknown }).recusar === true;
}

/** Decisão de proposta (perfil/rotina/acesso) fechada pela dona: o evento vai para ela. */
function eventoDecidida(deps: Deps, d: Decisao, extra: Record<string, string | number | boolean | null> = {}): RuntimeEvent {
  return {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: deps.agora(),
    kind: "decisao_decidida",
    autoria: autoriaDaPessoa(deps.escopo),
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: d.conversaId,
    turnoId: d.turnoId,
    dados: { decisao_id: d.id, tipo: d.tipo, ...extra },
  };
}

/**
 * Rotas de decisão (EMENDA 4, EMENDA-L9 §4): `decidir` cobre os sete tipos que se decidem por
 * botão — aprovacao/gate_rotina (lista tipada, L5), retomar_turno (L6), acesso (conceder, L5),
 * perfil (confirmarProposta, L6), rotina (services.rotinas.ativar, L7; decisao.id === propostaId) —
 * e recusa os três de pedir_a_pessoa, que se RESPONDEM com texto em `responder`. `retomar` é a
 * retomada por frase da pessoa de um turno interrompido.
 *
 * Decisora ≠ dona (EMENDA 1, PENDÊNCIA L5 §4/L3 §3): a fase que a decisora pode assinar (marcar
 * itens, fechar a decisão) roda na tx DELA (policy nod_decisora); o que exige owner_id = pessoa
 * (mensagem, turno de retomada, concessão) roda numa tx da DONA — a decisão diz quem é.
 */
export function criarRotasDecisoes(d: DepsRotasDecisoes): Rota[] {
  const comoDona = <T>(escopo: Escopo, decisao: Decisao, fn: (deps: Deps) => Promise<T>): Promise<T> =>
    d.dentro(decisao.ownerId === escopo.pessoaId ? escopo : { tenantId: escopo.tenantId, pessoaId: decisao.ownerId }, fn);

  return [
    {
      metodo: "POST",
      padrao: new RegExp(`^/decisoes/${ID}/decidir$`),
      async handler(ctx) {
        const decisaoId = ctx.params.id ?? "";
        const corpo = await ctx.corpo();
        const atual = await d.dentro(ctx.escopo, (deps) => deps.repos.decisoes.buscar(decisaoId));
        if (!atual) throw new ErroDeDominio("nao_encontrado", { cause: "decisão" });
        const ids: Record<string, string> = { decisao: atual.id };

        if (atual.tipo === "aprovacao" || atual.tipo === "gate_rotina" || atual.tipo === "retomar_turno") {
          // FASE 1 (decisora): marcar e fechar. FASE 2 (dona): efeito externo assentado / turno de retomada.
          const fase1 = await d.dentro(ctx.escopo, (deps) => executar(deps, marcarEDecidir, { decisaoId, itens: marcacoes(corpo) }));
          if (atual.tipo === "retomar_turno") {
            const r = await comoDona(ctx.escopo, atual, (deps) => executar(deps, retomarPorDecisao, { decisao: fase1.decisao }));
            if (r.turnoRetomadaId) ids.turnoRetomada = r.turnoRetomadaId;
          } else {
            // A chamada ao conector roda FORA de qualquer transação (não segura conexão do banco).
            const desfechos: DesfechoExecutado[] = await executarItens(d.services, fase1.aExecutar);
            const fase2 = await comoDona(ctx.escopo, atual, (deps) => executar(deps, assentarAprovacao, { decisaoId, desfechos }));
            if (fase2.mensagemId) ids.mensagem = fase2.mensagemId;
            if (fase2.turnoRetomadaId) ids.turnoRetomada = fase2.turnoRetomadaId;
            // ADR-042: o mesmo clique aprova AGORA e grava a regra para as próximas vezes. Só os
            // itens que a pessoa manteve marcados; sensível e computador ficam de fora no caso de uso.
            if (sempre(corpo)) {
              const marcados = fase2.itens.filter((i) => i.selecionado).map((i) => i.id);
              const regras = await comoDona(ctx.escopo, atual, (deps) => executar(deps, permitirSempre, { decisaoId, itemIds: marcados }));
              if (regras.criadas.length > 0) ids.regras = String(regras.criadas.length);
              if (regras.mensagemId) ids.consentimento = regras.mensagemId;
            }
          }
          const resposta: RespostaMutacao = { ok: true, ids };
          ctx.json(200, resposta);
          return;
        }

        if (atual.tipo === "acesso" || atual.tipo === "perfil" || atual.tipo === "rotina" || atual.tipo === "rotina_atualizacao" || atual.tipo === "rotina_exclusao") {
          // Proposta confirmada por botão em "Sua vez": decisao.id === proposta.id (criar-rotina.ts, confirmar-proposta.ts).
          await comoDona(ctx.escopo, atual, async (deps) => {
            const proposta = await deps.repos.propostas.buscar(atual.id);
            const decidida = await deps.repos.decisoes.decidir(atual.id, { por: ctx.escopo.pessoaId, agora: deps.agora() });
            if (!decidida) throw new ErroDeDominio("estado_invalido", { cause: `decisão ${atual.estado}` });
            const events: RuntimeEvent[] = [eventoDecidida(deps, decidida, { recusada: recusada(corpo) })];
            if (recusada(corpo)) {
              if (proposta && proposta.estado === "pendente") await executar(deps, recusarProposta, { propostaId: proposta.id });
            } else if (atual.tipo === "acesso") {
              if (!proposta || proposta.payload.kind !== "acesso") throw new ErroDeDominio("estado_invalido", { cause: "decisão de acesso sem proposta" });
              const conector = await deps.repos.conectores.buscarPorSlug(proposta.payload.conector);
              if (!conector) throw new ErroDeDominio("nao_encontrado", { cause: "conector" });
              for (const capacidade of proposta.payload.capacidades) {
                const r = await executar(deps, conceder, { agenteId: proposta.agenteId, conectorId: conector.id, capacidade, autorTipo: "pessoa" });
                ids[`concessao_${capacidade}`] = r.concessaoId;
              }
              const retomada = await executar(deps, retomarAposAcesso, { decisao: decidida, proposta });
              if (retomada.turnoId) ids.turnoRetomada = retomada.turnoId;
            } else if (atual.tipo === "rotina") {
              const rotina = await deps.tx((trx) => d.services.rotinas.ativar(trx, atual.id));
              ids.rotina = rotina.id;
            } else if (atual.tipo === "rotina_atualizacao" || atual.tipo === "rotina_exclusao") {
              // A rotina já existe e tem id próprio: a ligação é payload.rotinaId, não a igualdade
              // de ids que 'rotina' (nascimento) usa. O caso aplica o payload JÁ normalizado (E7.1).
              const caso = atual.tipo === "rotina_atualizacao" ? aplicarAtualizacaoRotina : aplicarExclusaoRotina;
              const r = await executar(deps, caso, { propostaId: atual.id });
              ids.rotina = r.rotina.id;
            } else if (proposta && proposta.estado === "pendente") {
              const r = await executar(deps, confirmarProposta, { propostaId: proposta.id, prazoMs: d.prazoDecisaoMs });
              if (r.agente) ids.agente = r.agente.id;
            }
            await deps.repos.events.gravarComOutbox(events);
          });
          const resposta: RespostaMutacao = { ok: true, ids };
          ctx.json(200, resposta);
          return;
        }

        // pergunta | falta_de_dado | permissao: a resposta é texto (EMENDA 16), nunca um botão.
        throw new ErroDeDominio("estado_invalido", { cause: `decisão ${atual.tipo} se responde em POST decisoes/:id/responder` });
      },
    },
    {
      metodo: "POST",
      padrao: new RegExp(`^/decisoes/${ID}/responder$`),
      async handler(ctx) {
        const decisaoId = ctx.params.id ?? "";
        const texto = textoDoCorpo(await ctx.corpo(), "texto") ?? "";
        // FASE 1 (decisora, pode ser outra pessoa): fecha a decisão. FASE 2 (dona): mensagem + turno de retomada.
        const { decisao } = await d.dentro(ctx.escopo, (deps) => executar(deps, fecharComResposta, { decisaoId, texto }));
        const r = await comoDona(ctx.escopo, decisao, async (deps) => {
          const pessoa = await deps.repos.pessoas.buscar(ctx.escopo.pessoaId);
          return executar(deps, retomarComResposta, { decisao, texto, respondidaPor: { id: ctx.escopo.pessoaId, nome: pessoa?.nome ?? "a pessoa" }, prazoMs: d.prazoDecisaoMs, executor: d.executor });
        });
        const ids: Record<string, string> = { decisao: decisao.id, mensagem: r.mensagem.id };
        if (r.turno) ids.turnoRetomada = r.turno.id;
        const resposta: RespostaMutacao = { ok: true, ids };
        ctx.json(200, resposta);
      },
    },
    {
      metodo: "POST",
      padrao: new RegExp(`^/decisoes/${ID}/retomar$`),
      async handler(ctx) {
        const decisaoId = ctx.params.id ?? "";
        const texto = textoDoCorpo(await ctx.corpo(), "texto") ?? "retomar de onde parou";
        const atual = await d.dentro(ctx.escopo, (deps) => deps.repos.decisoes.buscar(decisaoId));
        if (!atual) throw new ErroDeDominio("nao_encontrado", { cause: "decisão" });
        const r = await comoDona(ctx.escopo, atual, (deps) => executar(deps, retomarTurno, { decisaoId, texto, prazoMs: d.prazoDecisaoMs, executor: d.executor }));
        const resposta: RespostaMutacao = { ok: true, ids: { decisao: atual.id, turno: r.turno.id, retomaTurno: r.original.id, mensagem: r.mensagem.id } };
        ctx.json(201, resposta);
      },
    },
  ];
}
