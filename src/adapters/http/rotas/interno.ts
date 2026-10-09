import type { Computadores } from "../../fundo/computadores.ts";
import type { Workspaces } from "../../fundo/workspaces.ts";
import type { ClasseNegacao } from "../../../contracts/negacao.ts";
import { MOTIVOS_NEGACAO, type MotivoNegacao } from "../../../contracts/motivos.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { esperaEmLaco, motivoDaEsperaNegada } from "../../../domain/espera-em-laco.ts";
import { REGRA_MODO_AUTOMATICO, REGRA_MODO_TOTAL, VERSAO_MODO_AUTOMATICO, VERSAO_MODO_TOTAL } from "../../../domain/modo-aprovacao.ts";
import { NATIVAS_QUE_CONTAMINAM } from "../../../domain/nativas.ts";
import { log } from "../../../obs/log.ts";
import type { TokenTurno } from "../../../services/token-turno.ts";
import { LONGPOLL_APROVACAO_MS } from "../../../shared/constantes.ts";
import type { Relogio } from "../../../shared/types.ts";
import type { NivelPressao } from "../../../contracts/trabalho.ts";
import { soltarPorMemoria } from "../../../domain/trabalho.ts";
import { fecharPorMemoria } from "../../../use-cases/trabalhos.ts";
import { autorizarComando } from "../../../use-cases/autorizar-comando.ts";
import { chamarFerramenta, REGRA_CHAMADA, registrarExecucaoLocal, VERSAO_REGRA_CHAMADA } from "../../../use-cases/chamar-ferramenta.ts";
import { nomeParaTrilha, registrarNegacao } from "../../../use-cases/registrar-negacao.ts";
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
  /** ADR-083 (#194): a pressão de memória dos Macs da pessoa; amarela ou pior solta a espera longa de uma task. */
  pressao?: (pessoaId: string) => NivelPressao | null;
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
        // definido em 2026-09-24 (revisão da ADR-047): computador e pasta também deixam a chamada na trilha —
        // o que eles devolvem é conteúdo de fora, e a trilha é o registro do que o turno tocou (E8.4).
        if (plano && ((ctx.params.nome?.startsWith("workspace_") && deps.workspaces) || (ctx.params.nome?.startsWith("computador_") && deps.computadores))) {
          await deps.dentro(ctx.escopo, (d) => d.repos.trilha.registrar({ agenteId: plano.agenteId, turnoId, ferramenta: nomeParaTrilha(ctx.params.nome ?? ""), kind: "tool_call", regra: REGRA_CHAMADA, regraVersao: VERSAO_REGRA_CHAMADA }));
        }
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
              // definido em 2026-09-28: vale para TODO item aprovado — a fase 1 fecha a decisão antes de
              // executar, e o computador voltava "decidida" com desfecho nulo enquanto ainda rodava.
              if (decisao.estado === "decidida" && itens.some((i) => i.selecionado && i.desfecho === null)) return { estado: "pendente" as const };
              // 0032: este turno é quem continua a decisão. Se uma retomada já ficou com ela, o turno encerra
              // (a retomada continua) — nunca os dois.
              if (decisao.estado === "decidida" && (await d.repos.decisoes.reivindicarContinuacao(decisaoId, "turno", deps.agora())) === "retomada") return { estado: "da_retomada" as const };
              return { estado: "decidida" as const, itens: itens.map((i) => ({ idx: i.idx, desfecho: i.desfecho, acaoId: i.destino.conector === "computador" && typeof i.destino.argumentos?.acaoId === "string" ? i.destino.argumentos.acaoId : null })) };
            }
            return { estado: "pendente" as const, desde: Date.parse(decisao.criadoEm) };
          });
          // ADR-083 (#194): sob pressão, a task que espera a pessoa há mais de 5 min solta a espera — o turno encerra, o
          // processo fecha e a decisão vira retomada (--resume) quando ela responder.
          if (olhada.estado === "pendente" && deps.pressao && soltarPorMemoria({ nivel: deps.pressao(ctx.escopo.pessoaId), esperandoDesde: olhada.desde ?? deps.agora(), agora: deps.agora() })) {
            const fechou = await deps.dentro(ctx.escopo, async (d) => {
              const r = await fecharPorMemoria(d, turnoId);
              if (r.events.length) await d.repos.events.gravarComOutbox(r.events);
              return r.fechou;
            });
            if (fechou) {
              ctx.json(200, { estado: "pendente", soltar: true });
              return;
            }
          }
          // revisto em 2026-10-09 (ADR-089, revisão do #223): antes a rota devolvia "pendente" e o hook seguia vivo até
          // 420 s junto com a retomada — duas cópias na mesma task. Agora solta na hora: o turno encerra.
          if (olhada.estado === "da_retomada") {
            ctx.json(200, { estado: "pendente", soltar: true });
            return;
          }
          if (olhada.estado === "inexistente") {
            ctx.json(404, { codigo: "nao_encontrado", mensagem: "decisão não pertence a este turno" });
            return;
          }
          if (olhada.estado === "decidida") {
            // 0032: o resultado da ação aprovada no computador volta junto (cifrado até aqui, entregue uma vez).
            const itens = await Promise.all(olhada.itens.map(async ({ acaoId, ...i }) => {
              const resultado = acaoId && deps.computadores ? await deps.computadores.resultadoDaAcao(ctx.escopo, acaoId) : null;
              return resultado ? { ...i, resultado } : i;
            }));
            ctx.json(200, { estado: "decidida", itens });
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
      // ADR-052: o hook do nod confirma cada chamada NATIVA antes de ela rodar. A nativa tem de estar no plano do
      // turno; a trilha registra sempre (é o registro do que entrou de fora); a web marca
      // o turno (0033). Quem decide se contamina é o SERVIDOR, pela ferramenta — nunca o que o hook manda.
      metodo: "POST",
      padrao: /^\/nativas$/,
      interno: true,
      // revisto em 2026-09-28 (ADR-055): o Bash vem com o comando, e quem decide é autorizarComando — o que só lê
      // roda; o resto abre um card e a resposta diz ao hook qual decisão esperar. Trilha só do que roda.
      async handler(ctx) {
        const c = (await ctx.corpo()) as { ferramenta?: unknown; comando?: unknown; arquivo?: unknown } | null;
        const ferramenta = typeof c?.ferramenta === "string" ? c.ferramenta : "";
        const turnoId = ctx.params.turnoId ?? "";
        const plano = deps.tokens.planoDe(turnoId);
        if (!plano || !(plano.nativas ?? []).includes(ferramenta)) {
          ctx.json(403, { codigo: "nao_permitido", mensagem: "ferramenta nativa fora do plano deste turno" });
          return;
        }
        // ADR-067: o Monitor roda um comando como o Bash, e passa pela mesma decisão.
        const rodaComando = ferramenta === "Bash" || ferramenta === "Monitor";
        if (rodaComando && typeof c?.comando !== "string") throw new ErroDeDominio("entrada_invalida", { cause: `${ferramenta} sem comando` });
        // ADR-089 (#217): o laço de espera com sleep (e o sleep longo) segura o processo do bot no Mac sem trabalho. Nega
        // antes de qualquer card ou trilha, em qualquer modo — nem o modo total aprova esperar assim. A saída é a volta
        // marcada (me_chame_as, ADR-086) quando ela está no catálogo deste turno; senão, encerrar dizendo o que falta.
        const espera = rodaComando ? esperaEmLaco(String(c?.comando)) : null;
        if (espera) {
          const comMeChameAs = plano.catalogo.ferramentas.some((f) => f.nome === "me_chame_as" && f.origem === "nod");
          log("aviso", "espera_em_laco_negada", { turno_id: turnoId, ferramenta, tipo: espera.tipo, segundos: Number.isFinite(espera.segundos) ? espera.segundos : null, me_chame_as: comMeChameAs });
          ctx.json(403, { codigo: "nao_permitido", mensagem: motivoDaEsperaNegada(espera, comMeChameAs) });
          return;
        }
        const aguardar = await deps.dentro(ctx.escopo, async (d) => {
          // ADR-059: o comando que o MODO aprovou leva a regra do modo na trilha. Sem isso ele fica igual a uma
          // leitura, e o gatilho da ADR-055 ("nativa__Bash sem decisão correspondente") dispararia à toa.
          let regra: { regra: `regra:${string}`; regraVersao: number } = { regra: REGRA_CHAMADA, regraVersao: VERSAO_REGRA_CHAMADA };
          // ADR-066: a gravação fora de ~/nod/<bot> (o hook manda `arquivo`) passa pela mesma decisão do comando.
          const arquivo = ["Write", "Edit", "NotebookEdit"].includes(ferramenta) && typeof c?.arquivo === "string" ? c.arquivo : null;
          if (rodaComando || arquivo !== null) {
            const r = await executar(d, autorizarComando, arquivo !== null ? { plano, arquivo } : { plano, comando: String(c?.comando) });
            if ("aguardar" in r) return r.aguardar;
            if (r.porque === "modo_automatico") regra = { regra: REGRA_MODO_AUTOMATICO, regraVersao: VERSAO_MODO_AUTOMATICO };
            if (r.porque === "modo_total") regra = { regra: REGRA_MODO_TOTAL, regraVersao: VERSAO_MODO_TOTAL };
          }
          await d.repos.trilha.registrar({ agenteId: plano.agenteId, turnoId, ferramenta: nomeParaTrilha(`nativa__${ferramenta}`), kind: "tool_call", ...regra });
          if (NATIVAS_QUE_CONTAMINAM.includes(ferramenta)) await d.repos.turnos.contaminar(turnoId, deps.agora());
          return null;
        });
        ctx.json(200, aguardar ? { aguardar } : { ok: true });
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
