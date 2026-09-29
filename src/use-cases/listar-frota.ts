import type { FrotaDto } from "../contracts/api.ts";
import type { Inventario } from "../contracts/inventario.ts";
import type { Negacao } from "../contracts/negacao.ts";
import { descricaoEstado, previaDaMensagem } from "../domain/descricao-agente.ts";
import { inventarioAusente } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";

/** definido em 2026-09-16: janela de turnos lida por agente para contar execuções na frota (o repositório não tem count por agente). */
const TURNOS_CONTADOS = 1_000;

/**
 * Frota (E1.1): cada agente visível com a conversa própria e a linha 'sem acessos · nunca executou'
 * (contagens, nunca texto), o inventário do motor (claude-cli tem precedência sobre o catcher) e as
 * negações vivas de conectores com última falha (ADR-029: fail-closed renderizado).
 */
export const listarFrota: CasoDeUso<{ agora?: number; gerenciar?: boolean }, FrotaDto> = async (deps, input) => {
  const agora = deps.agora();
  const agentes = await deps.repos.agentes.listar(input.gerenciar ? { incluirOcultos: true, incluirExcluidos: true } : {});
  // definido em 2026-09-24 (emenda da ADR-037): uma consulta para a frota inteira, não uma por agente.
  const foraDoAr = await deps.repos.computadores.foraDoAr();
  // definido em 2026-09-29 (0039): "não lido" sai do "lido até" da conversa, não da coluna agentes.nao_lido.
  const comNovas = new Set((await deps.repos.leituras.resumo()).map((r) => r.conversaId));
  const linhas: FrotaDto["agentes"] = [];
  for (const agente of agentes) {
    const conversa = await deps.repos.conversas.buscarPropriaDoAgente(agente.id);
    const concessoes = await deps.repos.concessoes.doAgente(agente.id);
    const turnos = conversa ? await deps.repos.turnos.listarDaConversa(conversa.id, TURNOS_CONTADOS) : [];
    const execucoes = turnos.filter((t) => t.estado === "concluido").length;
    const ultima = conversa ? await deps.repos.mensagens.ultimaDaConversa(conversa.id) : null;
    // definido em 2026-09-28 (ADR-051): o texto do artefato leva o id para o modelo; a prévia mostra só o título.
    const previa = ultima ? previaDaMensagem(ultima.payload?.kind === "artefato" ? `▣ ${ultima.payload.titulo}` : ultima.texto) : null;
    linhas.push({
      ...agente,
      naoLido: conversa ? comNovas.has(conversa.id) : false,
      conversaId: conversa?.id ?? "",
      descricaoEstado: descricaoEstado(agente, { concessoes: concessoes.length, execucoes }),
      computadorForaDoAr: foraDoAr.get(agente.id) ?? null,
      ultimaMensagem: ultima && previa ? { previa, em: ultima.criadoEm } : null,
    });
  }

  const motores = await deps.repos.inventario.listar();
  const inventario: Inventario = motores.find((m) => m.motor === "claude-cli")?.inventario ?? motores.find((m) => m.motor === "catcher")?.inventario ?? inventarioAusente(agora);

  const negacoes: Negacao[] = (await deps.repos.conectores.listar())
    .filter((c) => c.ultimaFalha !== null)
    .map((c) => ({ classe: "conector_indisponivel", nome: c.slug, motivo: c.ultimaFalha?.motivo ?? "conector_indisponivel", desde: c.ultimaFalha?.em ?? agora, terminal: false }));

  return { data: { agentes: linhas, inventario, negacoes } };
};
