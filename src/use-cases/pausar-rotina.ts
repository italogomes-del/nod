import type { EstadoRotina, Rotina } from "../contracts/rotina.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { proximaJanela } from "../domain/rotina-janela.ts";
import { autoriaPessoa, exigir, textoRotinaAtiva } from "./apoio-l7.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * POST rotinas/:id/pausar e /ativar. Pausada não entra no tick do scheduler (índice parcial
 * `estado = 'ativa'`). Reativar recalcula a próxima execução a partir de `agora`: janelas perdidas
 * durante a pausa não são repostas (definido em 2026-09-16: mesma regra do disparo — o Grok Bot
 * também não repõe). Só a dona muda estado: o repositório devolve null para quem não é.
 */
export const pausarRotina: CasoDeUso<{ rotinaId: string; estado: EstadoRotina }, { rotina: Rotina }> = async (deps, input) => {
  const atual = exigir(await deps.repos.rotinas.buscar(input.rotinaId), "nao_encontrado", "rotina");
  if (atual.estado === input.estado) return { data: { rotina: atual } };
  const agora = deps.agora();
  if (input.estado === "ativa") {
    const proxima = proximaJanela({ cron: atual.cron, fusoIana: atual.fusoIana, agora });
    exigir(await deps.repos.rotinas.reagendar(atual.id, proxima), "nao_encontrado", "rotina (não é a dona)");
  }
  const rotina = await deps.repos.rotinas.atualizarEstado(atual.id, input.estado);
  if (!rotina) throw new ErroDeDominio("nao_permitido", { cause: "só a dona pausa/ativa" });
  await deps.repos.mensagens.criar({
    conversaId: rotina.conversaId,
    autoria: autoriaPessoa(deps.escopo.pessoaId),
    kind: "sistema",
    texto: rotina.estado === "ativa" ? textoRotinaAtiva(rotina, agora) : "Rotina pausada: nada será disparado até você reativar.",
    confianca: "confiavel",
  });
  return { data: { rotina } };
};
