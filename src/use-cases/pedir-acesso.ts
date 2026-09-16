import { randomUUID } from "node:crypto";
import type { RuntimeEvent } from "../contracts/evento.ts";
import type { CasoNod } from "../contracts/servicos.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import type { Deps } from "./tipos.ts";

/**
 * Pedido de acesso em português com escopo nomeado (E6.2): recurso concreto (slug registrado),
 * nível leitura|escrita e o que NÃO está sendo pedido. Capacidade fora do catálogo conhecido é
 * recusada antes de chegar à conversa — o agente nunca inventa escopo. Vira Proposta kind 'acesso';
 * nada é concedido aqui (confirmar-proposta, L6, chama `conceder`).
 */
export const pedirAcesso: CasoNod<Deps, "pedir_acesso"> = async (deps, input) => {
  const agora = deps.agora();
  const conector = await deps.repos.conectores.buscarPorSlug(input.conector);
  if (!conector) throw new ErroDeDominio("entrada_invalida", { cause: `conector ${input.conector} não registrado` });
  const conhecidas = new Set(conector.catalogo.map((c) => c.nome));
  const desconhecidas = input.capacidades.filter((c) => !conhecidas.has(c));
  if (input.capacidades.length === 0 || desconhecidas.length > 0) {
    throw new ErroDeDominio("entrada_invalida", { cause: `capacidades fora do catálogo: ${desconhecidas.join(", ")}` });
  }
  const proposta = await deps.repos.propostas.criar({
    conversaId: input.conversaId,
    agenteId: input.agenteId,
    payload: { kind: "acesso", conector: conector.slug, capacidades: [...new Set(input.capacidades)], nivel: input.nivel, naoPedido: [...input.nao_pedido] },
  });
  if (!proposta) throw new Error("proposta não criada");
  const evento: RuntimeEvent = {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: agora,
    kind: "proposta_criada",
    autoria: autoriaDoAgente(deps.escopo, input.agenteId),
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: input.conversaId,
    turnoId: input.turnoId,
    dados: { proposta_id: proposta.id, kind: "acesso", conector: conector.slug, capacidades: input.capacidades.length, nivel: input.nivel },
  };
  return { data: { proposta_id: proposta.id }, events: [evento] };
};
