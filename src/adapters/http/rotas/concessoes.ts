import { ErroDeDominio } from "../../../domain/erro.ts";
import { capacidadesDoNivel, doNivel, type NivelDeAcesso } from "../../../domain/grupos-de-acesso.ts";
import { conceder, concederLote } from "../../../use-cases/conceder.ts";
import { revogar, revogarLote } from "../../../use-cases/revogar.ts";
import type { Rota } from "../roteador.ts";
import { executar, textoDoCorpo, type DentroDeTx } from "./dentro-de-tx.ts";

export type DepsRotasConcessoes = { dentro: DentroDeTx };

/**
 * Concessões por agente e capacidade (E6, ADR-013): a rota é sempre de PESSOA (sessão); agente não
 * concede a agente (E12.5) — não há rota interna para isto. A mensagem de consentimento nasce na
 * mesma transação (caso de uso conceder).
 */
export function rotasConcessoes(deps: DepsRotasConcessoes): Rota[] {
  return [
    {
      metodo: "GET",
      padrao: /^\/agentes\/(?<id>[^/]+)\/concessoes$/,
      async handler(ctx) {
        const concessoes = await deps.dentro(ctx.escopo, (d) => d.repos.concessoes.doAgente(ctx.params.id ?? ""));
        ctx.json(200, { concessoes });
      },
    },
    {
      metodo: "POST",
      padrao: /^\/agentes\/(?<id>[^/]+)\/concessoes$/,
      async handler(ctx) {
        const corpo = await ctx.corpo();
        const conectorId = textoDoCorpo(corpo, "conectorId");
        const capacidade = textoDoCorpo(corpo, "capacidade");
        if (!conectorId || !capacidade) throw new ErroDeDominio("entrada_invalida", { cause: "conectorId e capacidade" });
        const r = await deps.dentro(ctx.escopo, (d) => executar(d, conceder, { agenteId: ctx.params.id ?? "", conectorId, capacidade, autorTipo: "pessoa" }));
        ctx.json(201, { ok: true, ids: { concessao: r.concessaoId, mensagem: r.mensagemId }, naoInclui: r.naoInclui });
      },
    },
    {
      /**
       * definido em 2026-09-25: "Quem pode usar o X?" do marketplace e "+ Dar acesso" do painel do bot —
       * a pessoa escolhe Nenhum / Ler / Ler e alterar e o conjunto concedido do bot NAQUELE app passa a ser
       * exatamente o do nível (capacidadesDoNivel): o que falta é concedido num lote (uma mensagem de
       * consentimento) e o que sobra é revogado num registro. Rota de pessoa, como o conceder ao lado.
       */
      metodo: "POST",
      padrao: /^\/agentes\/(?<id>[^/]+)\/acessos$/,
      async handler(ctx) {
        const corpo = await ctx.corpo();
        const conectorId = textoDoCorpo(corpo, "conectorId");
        const nivel = textoDoCorpo(corpo, "nivel");
        if (!conectorId || (nivel !== "nenhum" && nivel !== "leitura" && nivel !== "escrita")) throw new ErroDeDominio("entrada_invalida", { cause: "conectorId e nivel" });
        const agenteId = ctx.params.id ?? "";
        const r = await deps.dentro(ctx.escopo, async (d) => {
          // definido em 2026-09-25 (revisão do PR #68): o nível é da DONA do bot E do app. A leitura por RLS
          // abre bots e conectores 'equipe'; sem isto qualquer pessoa do tenant ligaria o bot de outra a um
          // app, ou o próprio bot às credenciais de um conector de colega. Os dois viram 404, em todo nível.
          const agente = await d.repos.agentes.buscar(agenteId);
          const conector = await d.repos.conectores.buscar(conectorId);
          if (!agente || agente.ownerId !== ctx.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado", { cause: "agente" });
          if (!conector || conector.ownerId !== ctx.escopo.pessoaId) throw new ErroDeDominio("nao_encontrado", { cause: "conector" });
          if (nivel !== "nenhum" && !conector.habilitado) throw new ErroDeDominio("estado_invalido", { cause: "conecte o app antes de dar acesso" });
          await d.repos.concessoes.travar(agenteId, conector.id);
          const desejadas = new Set(capacidadesDoNivel(conector.catalogo, nivel as NivelDeAcesso));
          if (nivel !== "nenhum" && desejadas.size === 0) throw new ErroDeDominio("estado_invalido", { cause: "o app não tem ferramenta para esse nível" });
          const atuais = (await d.repos.concessoes.doAgente(agenteId)).filter((c) => c.conectorId === conector.id);
          // revisto em 2026-09-25 (revisão do PR #68): Ler / Ler e alterar só mexem no que é deles (ler, criar,
          // editar, comentar). Apagar e "outras", dadas ação por ação ou pela rotina, ficam como estavam.
          // "Nenhum" é sem acesso nenhum: tira tudo, as dadas uma a uma inclusive.
          const sobram = atuais.filter((c) => !desejadas.has(c.capacidade) && (nivel === "nenhum" || doNivel(conector.catalogo, c.capacidade))).map((c) => c.id);
          const faltam = [...desejadas].filter((cap) => !atuais.some((c) => c.capacidade === cap));
          if (sobram.length > 0) await executar(d, revogarLote, { agenteId, concessaoIds: sobram });
          if (faltam.length > 0) await executar(d, concederLote, { agenteId, conectorId: conector.id, capacidades: faltam, autorTipo: "pessoa" });
          return { concedidas: faltam.length, revogadas: sobram.length };
        });
        ctx.json(200, { ok: true, ids: { concedidas: String(r.concedidas), revogadas: String(r.revogadas) } });
      },
    },
    {
      // definido em 2026-09-24 (ADR-044): revoga o grupo (app · nível) do painel com UM registro escrito.
      metodo: "POST",
      padrao: /^\/agentes\/(?<id>[^/]+)\/concessoes\/revogar$/,
      async handler(ctx) {
        const corpo = await ctx.corpo();
        const ids = typeof corpo === "object" && corpo !== null ? (corpo as { ids?: unknown }).ids : undefined;
        if (!Array.isArray(ids) || !ids.every((id): id is string => typeof id === "string")) throw new ErroDeDominio("entrada_invalida", { cause: "ids" });
        const r = await deps.dentro(ctx.escopo, (d) => executar(d, revogarLote, { agenteId: ctx.params.id ?? "", concessaoIds: ids }));
        ctx.json(200, { ok: true, ids: { revogadas: String(r.revogadas), ...(r.mensagemId ? { mensagem: r.mensagemId } : {}) } });
      },
    },
    {
      metodo: "DELETE",
      padrao: /^\/concessoes\/(?<id>[^/]+)$/,
      async handler(ctx) {
        const r = await deps.dentro(ctx.escopo, (d) => executar(d, revogar, { concessaoId: ctx.params.id ?? "" }));
        ctx.json(200, { ok: true, ids: r.mensagemId ? { mensagem: r.mensagemId } : {} });
      },
    },
  ];
}
