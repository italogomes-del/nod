import type { RespostaMutacao } from "../../../contracts/api.ts";
import { erroPerfilMudou } from "../../../use-cases/confirmar-perfil.ts";
import { confirmarProposta } from "../../../use-cases/confirmar-proposta.ts";
import { recusarProposta } from "../../../use-cases/recusar-proposta.ts";
import type { Rota } from "../roteador.ts";
import { criarExecutor, type DepsRotas } from "./executar-caso.ts";

const ID = "(?<id>[^/]+)";

/** Propostas (E1.1): confirmar aplica (perfil/rotina/acesso); recusar deixa de lado. Nada antes daqui. */
export function criarRotasPropostas(d: DepsRotas): Rota[] {
  const executar = criarExecutor(d);
  return [
    {
      metodo: "POST",
      padrao: new RegExp(`^/propostas/${ID}/confirmar$`),
      async handler(ctx) {
        const r = await executar(ctx.escopo, confirmarProposta, { propostaId: ctx.params.id ?? "", prazoMs: d.prazoDecisaoMs });
        // NOD-190: o perfil mudou depois do card — o caso recusou e avisou sem lançar, e a tx já commitou; o erro sai agora.
        if (r.obsoleta) throw erroPerfilMudou();
        const ids: Record<string, string> = { proposta: r.proposta.id };
        if (r.agente) ids.agente = r.agente.id;
        if (r.rotina) ids.rotina = r.rotina.id;
        if (r.decisao) ids.decisao = r.decisao.id;
        const resposta: RespostaMutacao = { ok: true, ids };
        ctx.json(200, resposta);
      },
    },
    {
      metodo: "POST",
      padrao: new RegExp(`^/propostas/${ID}/recusar$`),
      async handler(ctx) {
        const r = await executar(ctx.escopo, recusarProposta, { propostaId: ctx.params.id ?? "" });
        const resposta: RespostaMutacao = { ok: true, ids: { proposta: r.proposta.id } };
        ctx.json(200, resposta);
      },
    },
  ];
}
