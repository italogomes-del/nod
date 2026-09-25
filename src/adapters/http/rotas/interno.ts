import type { Computadores } from "../../fundo/computadores.ts";
import type { Workspaces } from "../../fundo/workspaces.ts";
import type { ClasseNegacao } from "../../../contracts/negacao.ts";
import { MOTIVOS_NEGACAO, type MotivoNegacao } from "../../../contracts/motivos.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import type { TokenTurno } from "../../../services/token-turno.ts";
import { LONGPOLL_APROVACAO_MS } from "../../../shared/constantes.ts";
import type { Relogio } from "../../../shared/types.ts";
import { chamarFerramenta, registrarExecucaoLocal } from "../../../use-cases/chamar-ferramenta.ts";
import { registrarNegacao } from "../../../use-cases/registrar-negacao.ts";
import type { Rota } from "../roteador.ts";
import { bytes } from "../util.ts";
import { executar, type DentroDeTx } from "./dentro-de-tx.ts";

export type DepsRotasInternas = {
  workspaces?: Workspaces;
  computadores?: Computadores;
  dentro: DentroDeTx;
  tokens: Pick<TokenTurno, "planoDe">;
  agora: Relogio;
  /** definido em 2026-09-16: teto do long-poll (LONGPOLL_APROVACAO_MS); a consulta é curta e a conexão do banco é liberada entre as fatias. */
  longpollMs?: number;
  /** Intervalo entre consultas (1 s + jitter até 250 ms, definido em 2026-09-16); injetável no teste. */
  intervaloMs?: number;
  dormir?: (ms: number) => Promise<void>;
};

const CLASSES: readonly ClasseNegacao[] = ["ferramenta_negada", "conector_indisponivel", "plano_ausente"];

const dormirPadrao = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Rotas INTERNAS (/api/interno/…), autenticadas pelo token de turno no roteador da L1: a
 * identidade (turnoId, agenteId, tenant, pessoa) chega em ctx.params/ctx.escopo, nunca do corpo
 * (ADR-024). GET plano devolve o plano guardado junto do token; POST ferramentas/:nome é o
 * tools/call despachado; GET decisoes/:id/aguardar é long-poll de consultas CURTAS (nunca segura
 * conexão do banco); POST negacoes registra uma negação decidida localmente pelo proxy.
 */
export function rotasInternas(deps: DepsRotasInternas): Rota[] {
  const dormir = deps.dormir ?? dormirPadrao;
  const teto = deps.longpollMs ?? LONGPOLL_APROVACAO_MS;
  const intervalo = deps.intervaloMs ?? 1_000;
  return [
    {
      metodo: "GET",
      padrao: /^\/plano$/,
      interno: true,
      async handler(ctx) {
        const plano = deps.tokens.planoDe(ctx.params.turnoId ?? "");
        if (!plano) {
          ctx.json(404, { codigo: "nao_encontrado", mensagem: "plano de turno ausente" });
          return;
        }
        ctx.json(200, plano);
      },
    },
    {
      // ADR-046: o driver baixa os bytes de um anexo DESTE turno. O plano em memória do token diz quais
      // ids o turno pode ler; qualquer outro é 404, mesmo sendo da mesma pessoa.
      metodo: "GET",
      padrao: /^\/anexos\/(?<aid>[^/]+)$/,
      interno: true,
      async handler(ctx) {
        const plano = deps.tokens.planoDe(ctx.params.turnoId ?? "");
        const aid = ctx.params.aid ?? "";
        if (!plano?.entrada.anexos?.some((a) => a.id === aid)) {
          ctx.json(404, { codigo: "nao_encontrado", mensagem: "anexo fora do turno" });
          return;
        }
        const r = await deps.dentro(ctx.escopo, (d) => d.repos.anexos.conteudo(aid));
        if (!r) {
          ctx.json(404, { codigo: "nao_encontrado", mensagem: "anexo ausente" });
          return;
        }
        bytes(ctx.res, r.meta.mime, r.meta.nome, r.bytes);
      },
    },
    {
      metodo: "POST",
      padrao: /^\/ferramentas\/(?<nome>[^/]+)$/,
      interno: true,
      async handler(ctx) {
        const corpo = (await ctx.corpo()) as { argumentos?: unknown };
        const turnoId = ctx.params.turnoId ?? "";
        const plano = deps.tokens.planoDe(turnoId);
        if (ctx.params.nome?.startsWith("workspace_") && plano && deps.workspaces) {
          ctx.json(200, await deps.workspaces.chamar(ctx.escopo, plano, ctx.params.nome, corpo?.argumentos ?? {}));
          return;
        }
        if (ctx.params.nome?.startsWith("computador_") && plano && deps.computadores) {
          ctx.json(200, await deps.computadores.chamar(ctx.escopo, plano, ctx.params.nome, corpo?.argumentos ?? {}));
          return;
        }
        const resultado = await deps.dentro(ctx.escopo, (d) =>
          executar(d, chamarFerramenta, {
            turnoId,
            agenteId: ctx.params.agenteId ?? "",
            nome: ctx.params.nome ?? "",
            argumentos: typeof corpo === "object" && corpo !== null ? (corpo.argumentos ?? {}) : {},
            plano: deps.tokens.planoDe(turnoId),
          }),
        );
        ctx.json(200, resultado);
      },
    },
    {
      metodo: "GET",
      padrao: /^\/decisoes\/(?<id>[^/]+)\/aguardar$/,
      interno: true,
      async handler(ctx) {
        const decisaoId = ctx.params.id ?? "";
        const turnoId = ctx.params.turnoId ?? "";
        const inicio = deps.agora();
        for (;;) {
          const olhada = await deps.dentro(ctx.escopo, async (d) => {
            const decisao = await d.repos.decisoes.buscar(decisaoId);
            if (!decisao || decisao.turnoId !== turnoId) return { estado: "inexistente" as const };
            if (decisao.estado === "decidida" || decisao.estado === "vencida") {
              const itens = await d.repos.itensAprovacao.listar(decisaoId);
              // ADR-048: item aprovado que roda no Mac ainda sem desfecho = a execução não acabou.
              if (decisao.estado === "decidida" && itens.some((i) => i.selecionado && i.desfecho === null && i.destino.execucao === "maquina")) return { estado: "pendente" as const };
              return { estado: "decidida" as const, itens: itens.map((i) => ({ idx: i.idx, desfecho: i.desfecho })) };
            }
            return { estado: "pendente" as const };
          });
          if (olhada.estado === "inexistente") {
            ctx.json(404, { codigo: "nao_encontrado", mensagem: "decisão não pertence a este turno" });
            return;
          }
          if (olhada.estado === "decidida") {
            ctx.json(200, olhada);
            return;
          }
          if (deps.agora() - inicio + intervalo > teto) {
            ctx.json(200, { estado: "pendente" });
            return;
          }
          await dormir(intervalo + Math.floor(Math.random() * 250));
        }
      },
    },
    {
      // ADR-048: o proxy relata o desfecho de uma ferramenta que rodou no gh do Mac (código fechado).
      metodo: "POST",
      padrao: /^\/execucoes-locais$/,
      interno: true,
      async handler(ctx) {
        const c = (await ctx.corpo()) as { nome?: unknown; codigo?: unknown } | null;
        if (typeof c?.nome !== "string" || typeof c.codigo !== "string") throw new ErroDeDominio("entrada_invalida");
        const turnoId = ctx.params.turnoId ?? "";
        const ok = await deps.dentro(ctx.escopo, (d) => registrarExecucaoLocal(d, { turnoId, agenteId: ctx.params.agenteId ?? "", plano: deps.tokens.planoDe(turnoId), nome: c.nome as string, codigo: c.codigo as string }));
        if (!ok) throw new ErroDeDominio("nao_permitido");
        ctx.json(200, { ok: true });
      },
    },
    {
      metodo: "POST",
      padrao: /^\/negacoes$/,
      interno: true,
      async handler(ctx) {
        const c = (await ctx.corpo()) as { nome?: unknown; motivo?: unknown; classe?: unknown; conectorId?: unknown };
        const motivo = MOTIVOS_NEGACAO.find((m) => m === c.motivo);
        const classe = CLASSES.find((k) => k === c.classe);
        if (!motivo || !classe || typeof c.nome !== "string") throw new ErroDeDominio("entrada_invalida", { cause: "negação malformada" });
        const turnoId = ctx.params.turnoId ?? "";
        const plano = deps.tokens.planoDe(turnoId);
        const negacao = await deps.dentro(ctx.escopo, (d) =>
          executar(d, registrarNegacao, {
            turnoId,
            agenteId: ctx.params.agenteId ?? "",
            conversaId: plano?.conversaId ?? null,
            nome: c.nome as string,
            motivo: motivo as MotivoNegacao,
            classe,
            conectorId: typeof c.conectorId === "string" ? c.conectorId : null,
            autoria: plano?.autoria,
          }),
        );
        ctx.json(200, { ok: true, negacao });
      },
    },
  ];
}
