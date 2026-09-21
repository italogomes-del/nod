import { randomUUID } from "node:crypto";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { complementoCapacidades } from "../domain/catalogo-conectores.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { redigir } from "../domain/redacao.ts";
import { autoriaDaPessoa } from "./registrar-negacao.ts";
import type { CasoDeUso } from "./tipos.ts";

export type EntradaConceder = {
  agenteId: string;
  conectorId: string;
  capacidade: string;
  /** Quem concede. 'agente' é recusado: agente não concede capacidade a agente (E12.5). */
  autorTipo?: "pessoa" | "agente";
};

export type SaidaConceder = { concessaoId: string; mensagemId: string; naoInclui: string[] };

/** 'AAAA-MM-DD HH:MM UTC' — determinístico; a web interpola no fuso da pessoa (ADR-007). */
export function quandoUtc(agora: number): string {
  return `${new Date(agora).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Concessão por agente e por capacidade (E6.3, ADR-013): a mensagem de consentimento imutável
 * ("Concedido por <nome> em <data hora>: <slug>.<capacidade>; não inclui: …") nasce na MESMA tx
 * que a concessão, na conversa própria do agente, e a concessão aponta para ela (FK). O "não inclui"
 * é o complemento do catálogo (E2.4/E6.6) calculado no domínio, nunca texto do modelo.
 */
export const conceder: CasoDeUso<EntradaConceder, SaidaConceder> = async (deps, input) => {
  if (input.autorTipo === "agente") throw new ErroDeDominio("nao_permitido", { cause: "agente não concede capacidade a agente (E12.5)" });
  const agora = deps.agora();
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (!agente) throw new ErroDeDominio("nao_encontrado", { cause: "agente" });
  const conector = await deps.repos.conectores.buscar(input.conectorId);
  if (!conector) throw new ErroDeDominio("nao_encontrado", { cause: "conector" });
  if (!conector.catalogo.some((c) => c.nome === input.capacidade)) throw new ErroDeDominio("entrada_invalida", { cause: "capacidade fora do catálogo do conector" });
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(agente.id);
  if (!conversa) throw new ErroDeDominio("estado_invalido", { cause: "agente sem conversa própria" });
  const pessoa = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
  const doConector = (await deps.repos.concessoes.doAgente(agente.id)).filter((c) => c.conectorId === conector.id);
  const naoInclui = complementoCapacidades(conector, [...doConector.map((c) => c.capacidade), input.capacidade]);
  // definido em 2026-09-21: conceder o que JÁ está concedido é sucesso, não erro. O repositório sempre
  // foi idempotente por contrato escrito ("null quando a mesma (agente, conector, capacidade) já
  // existe: conceder duas vezes não duplica", on conflict do nothing) e era este caso de uso que
  // traduzia esse "nada a fazer" como estado_invalido — o 409 travava para sempre o card de uma
  // decisão de acesso duplicada: a pessoa já havia consentido, não havia o que decidir nem desfazer.
  // Sai ANTES da mensagem de consentimento: a original é a imutável e citável (ADR-013), uma segunda
  // seria ruído na conversa própria do agente. A invariante segue sendo UMA concessão por capacidade.
  const existente = doConector.find((c) => c.capacidade === input.capacidade);
  if (existente) return { data: { concessaoId: existente.id, mensagemId: existente.mensagemId, naoInclui }, events: [] };
  const texto = redigir("consentimento", agora, {
    pessoa: pessoa?.nome ?? "a pessoa",
    quando: quandoUtc(agora),
    slug: conector.slug,
    capacidade: input.capacidade,
    naoInclui: naoInclui.length === 0 ? "nada mais deste conector" : naoInclui.join("; "),
  });
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: conversa.id,
    autoria: autoriaDaPessoa(deps.escopo),
    kind: "consentimento",
    texto,
    payload: { kind: "consentimento", conectorId: conector.id, slug: conector.slug, capacidade: input.capacidade, naoInclui },
    confianca: "confiavel",
  });
  if (!mensagem) throw new Error("mensagem de consentimento não criada");
  const concessao = await deps.repos.concessoes.conceder({ agenteId: agente.id, conectorId: conector.id, capacidade: input.capacidade, mensagemId: mensagem.id });
  if (!concessao) throw new ErroDeDominio("estado_invalido", { cause: "capacidade já concedida a este agente" });
  const evento: RuntimeEvent = {
    tenantId: deps.escopo.tenantId,
    id: randomUUID(),
    createdAt: agora,
    kind: "concessao_criada",
    autoria: autoriaDaPessoa(deps.escopo),
    pessoaDestinoId: deps.escopo.pessoaId,
    conversaId: conversa.id,
    dados: { concessao_id: concessao.id, mensagem_id: mensagem.id, agente_id: agente.id, conector_id: conector.id, slug: conector.slug, capacidade: input.capacidade },
  };
  return { data: { concessaoId: concessao.id, mensagemId: mensagem.id, naoInclui }, events: [evento] };
};
