import type { Agente } from "../contracts/agente.ts";
import type { Conversa } from "../contracts/conversa.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { proximaCor, proximaForma } from "../domain/proposta-agente.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * Duplicate (Grok Bot): copia nome + ' (cópia)', título, descrição, dono e modelo; forma/cor NOVAS;
 * conversa própria nova. NÃO copia memória nem mensagens — a cópia nasce sem histórico e sem acessos.
 */
export const duplicarAgente: CasoDeUso<{ agenteId: string }, { agente: Agente; conversa: Conversa }> = async (deps, input) => {
  const original = await deps.repos.agentes.buscar(input.agenteId);
  if (!original) throw new ErroDeDominio("nao_encontrado");

  const existentes = await deps.repos.agentes.listar({ incluirOcultos: true });
  const agente = await deps.repos.agentes.criar({
    nome: `${original.nome} (cópia)`,
    titulo: original.titulo,
    descricao: original.descricao,
    dono: original.dono,
    forma: proximaForma(existentes.map((a) => a.forma)),
    cor: proximaCor(existentes.map((a) => a.cor)),
    modelo: original.modelo,
    duplicadoDe: original.id,
    confirmado: original.confirmado,
  });
  if (!agente) throw new ErroDeDominio("estado_invalido", { cause: "cópia não criada" });
  const conversa = await deps.repos.conversas.criar({ tipo: "propria", agenteId: agente.id, visibility: agente.visibility });
  if (!conversa) throw new ErroDeDominio("estado_invalido", { cause: "conversa não criada" });

  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  return {
    data: { agente, conversa },
    events: [evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, conversaId: conversa.id, dados: { agente_id: agente.id, acao: "duplicado", duplicado_de: original.id } })],
  };
};
