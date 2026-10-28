import type { Computadores } from "../../fundo/computadores.ts";
import type { Rota } from "../roteador.ts";
import { ErroDeDominio } from "../../../domain/erro.ts";
import { ehFalhaComputador } from "../../../domain/computador.ts";
import { OPERACOES_DA_PESSOA, type OperacaoDaPessoa } from "../../../contracts/computador-motor.ts";
import { ORIGENS_CONTROLE, type OrigemControle } from "../../../contracts/computador.ts";

/** NOD-365: a recusa da troca com a origem sem contato; a tela troca "A máquina de agora" pelo nome que vem em `maquina`. */
export const MENSAGEM_ORIGEM_SEM_CONTATO = "A máquina de agora está sem contato. Ligue-a para levar os logins.";

export function rotasComputadores(computadores: Computadores): Rota[] {
  return [
    // NOD-96 PR 5: o computador da pessoa (NOD_COMPUTADORES=motor); com a flag desligada, 404.
    { metodo: "GET", padrao: /^\/computador$/, async handler(ctx) { ctx.json(200, await computadores.consultarDaPessoa(ctx.escopo)); } },
    { metodo: "POST", acao: "computador.operar", padrao: /^\/computador$/, async handler(ctx) {
      const corpo = await ctx.corpo() as { operacao?: unknown } | null;
      if (!corpo || typeof corpo.operacao !== "string" || !(OPERACOES_DA_PESSOA as readonly string[]).includes(corpo.operacao)) throw new ErroDeDominio("entrada_invalida");
      // Atualizar, Redefinir e Sair de todos seguem em segundo plano; o progresso vem pelo GET.
      await computadores.operarDaPessoa(ctx.escopo, corpo.operacao as OperacaoDaPessoa);
      ctx.json(200, { ok: true });
    } },
    // NOD-365: onde o computador mora. `semLogins` troca sem levar os logins (a origem sem contato); a troca segue em
    // segundo plano e o progresso vem pelo GET /computador.
    { metodo: "POST", acao: "computador.trocar_lugar", padrao: /^\/computador\/lugar$/, async handler(ctx) {
      const corpo = await ctx.corpo() as { maquinaId?: unknown; semLogins?: unknown } | null;
      if (!corpo || typeof corpo.maquinaId !== "string" || !/^[0-9a-f-]{36}$/i.test(corpo.maquinaId) || (corpo.semLogins !== undefined && typeof corpo.semLogins !== "boolean")) throw new ErroDeDominio("entrada_invalida");
      try {
        await computadores.trocarLugarDaPessoa(ctx.escopo, { maquinaId: corpo.maquinaId, semLogins: corpo.semLogins === true });
      } catch (e) {
        if (!ehFalhaComputador(e) || e.motivo !== "maquina_sem_contato") throw e;
        // AGENTS.md: a frase sai de uma tabela fixa; o nome da máquina (dado da pessoa) vai num campo à parte.
        ctx.json(409, { codigo: "origem_sem_contato", mensagem: MENSAGEM_ORIGEM_SEM_CONTATO, maquina: e.maquina ?? null });
        return;
      }
      ctx.json(200, { ok: true });
    } },
    { metodo: "GET", padrao: /^\/agentes\/(?<id>[^/]+)\/computador$/, async handler(ctx) { ctx.json(200, await computadores.consultar(ctx.escopo, ctx.params.id!)); } },
    { metodo: "POST", acao: "computador.operar_do_bot", padrao: /^\/agentes\/(?<id>[^/]+)\/computador$/, async handler(ctx) {
      const corpo = await ctx.corpo() as { operacao?: unknown; origem?: unknown } | null;
      if (!corpo || typeof corpo.operacao !== "string") throw new ErroDeDominio("entrada_invalida");
      // NOD-97: `origem` é opcional (sem ela, "botao"); fora do enum é entrada inválida.
      if (corpo.origem !== undefined && !ORIGENS_CONTROLE.includes(corpo.origem as OrigemControle)) throw new ErroDeDominio("entrada_invalida");
      await computadores.configurar(ctx.escopo, ctx.params.id!, corpo.operacao, corpo.origem as OrigemControle | undefined);
      ctx.json(200, { ok: true });
    } },
    { metodo: "POST", acao: "computador.usar_tela", padrao: /^\/agentes\/(?<id>[^/]+)\/computador\/acoes$/, async handler(ctx) { ctx.json(200, await computadores.humano(ctx.escopo, ctx.params.id!, await ctx.corpo())); } },
  ];
}
