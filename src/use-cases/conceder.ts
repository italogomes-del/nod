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

export type EntradaConcederLote = Omit<EntradaConceder, "capacidade"> & {
  capacidades: readonly string[];
  /**
   * ADR-059 (emenda de 2026-09-30): a concessão saiu pelo modo do bot, que a pessoa escolheu — não por um clique
   * neste pedido. O consentimento continua sendo da pessoa (a escolha do modo é dela), com a regra em
   * `decidido_por` e dito no texto, para a trilha não confundir com um clique.
   */
  porRegra?: { regra: `regra:${string}`; regraVersao: number };
};

/**
 * `concessoes`: uma por capacidade pedida, na ordem do pedido, cada uma com a mensagem de
 * consentimento que a cita (a nova ou, se já estava concedida, a ORIGINAL). `mensagemId` é o
 * consentimento novo deste lote; null quando tudo já estava concedido.
 */
export type SaidaConcederLote = { concessoes: { capacidade: string; concessaoId: string; mensagemId: string }[]; mensagemId: string | null; naoInclui: string[] };

/** 'AAAA-MM-DD HH:MM UTC' — determinístico; a web interpola no fuso da pessoa (ADR-007). */
export function quandoUtc(agora: number): string {
  return `${new Date(agora).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * Concessão por agente e por capacidade (E6.3, ADR-013), em LOTE desde 2026-09-24 (ADR-044): um clique
 * em "Permitir" nas 28 ferramentas de leitura do Gmail escrevia 28 mensagens de consentimento. Agora
 * nasce UMA mensagem imutável ("Concedido por <nome> em <data hora>: <slug>.<cap>, …; não inclui: …")
 * na MESMA tx, na conversa própria do agente, e cada concessão aponta para ela (FK; a unicidade do
 * banco é por capacidade, não por mensagem). O "não inclui" é o complemento do catálogo (E2.4/E6.6)
 * calculado no domínio, nunca texto do modelo.
 */
export const concederLote: CasoDeUso<EntradaConcederLote, SaidaConcederLote> = async (deps, input) => {
  if (input.autorTipo === "agente") throw new ErroDeDominio("nao_permitido", { cause: "agente não concede capacidade a agente (E12.5)" });
  const capacidades = [...new Set(input.capacidades)];
  if (capacidades.length === 0) throw new ErroDeDominio("entrada_invalida", { cause: "nenhuma capacidade para conceder" });
  const agora = deps.agora();
  const agente = await deps.repos.agentes.buscar(input.agenteId);
  if (!agente) throw new ErroDeDominio("nao_encontrado", { cause: "agente" });
  const conector = await deps.repos.conectores.buscar(input.conectorId);
  if (!conector) throw new ErroDeDominio("nao_encontrado", { cause: "conector" });
  if (capacidades.some((cap) => !conector.catalogo.some((c) => c.nome === cap))) throw new ErroDeDominio("entrada_invalida", { cause: "capacidade fora do catálogo do conector" });
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(agente.id);
  if (!conversa) throw new ErroDeDominio("estado_invalido", { cause: "agente sem conversa própria" });
  const doConector = (await deps.repos.concessoes.doAgente(agente.id)).filter((c) => c.conectorId === conector.id);
  const naoInclui = complementoCapacidades(conector, [...doConector.map((c) => c.capacidade), ...capacidades]);
  // definido em 2026-09-21: conceder o que JÁ está concedido é sucesso, não erro. O repositório sempre
  // foi idempotente por contrato escrito ("null quando a mesma (agente, conector, capacidade) já
  // existe: conceder duas vezes não duplica", on conflict do nothing) e era este caso de uso que
  // traduzia esse "nada a fazer" como estado_invalido — o 409 travava para sempre o card de uma
  // decisão de acesso duplicada: a pessoa já havia consentido, não havia o que decidir nem desfazer.
  // A que já existe fica FORA da mensagem nova: a original é a imutável e citável (ADR-013), repetir
  // seria ruído na conversa própria do agente. A invariante segue sendo UMA concessão por capacidade.
  const novas = capacidades.filter((cap) => !doConector.some((c) => c.capacidade === cap));
  const saida: SaidaConcederLote["concessoes"] = [];
  const events: RuntimeEvent[] = [];
  let mensagemId: string | null = null;
  if (novas.length > 0) {
    const pessoa = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
    const autoria = input.porRegra ? { ...autoriaDaPessoa(deps.escopo), decidido_por: input.porRegra.regra, regra_versao: input.porRegra.regraVersao } : autoriaDaPessoa(deps.escopo);
    const mensagem = await deps.repos.mensagens.criar({
      conversaId: conversa.id,
      autoria,
      kind: "consentimento",
      texto: redigir("consentimento", agora, {
        pessoa: pessoa?.nome ?? "a pessoa",
        quando: quandoUtc(agora),
        escopo: novas.map((cap) => `${conector.slug}.${cap}`).join(", "),
        naoInclui: naoInclui.length === 0 ? "nada mais deste conector" : naoInclui.join("; "),
      }) + (input.porRegra ? " Pela aprovação automática deste bot, sem clique neste pedido." : ""),
      payload: { kind: "consentimento", conectorId: conector.id, slug: conector.slug, capacidades: novas, naoInclui },
      confianca: "confiavel",
    });
    if (!mensagem) throw new Error("mensagem de consentimento não criada");
    mensagemId = mensagem.id;
    for (const capacidade of novas) {
      const concessao = await deps.repos.concessoes.conceder({ agenteId: agente.id, conectorId: conector.id, capacidade, mensagemId: mensagem.id });
      if (!concessao) throw new ErroDeDominio("estado_invalido", { cause: "capacidade já concedida a este agente" });
      events.push({
        tenantId: deps.escopo.tenantId,
        id: randomUUID(),
        createdAt: agora,
        kind: "concessao_criada",
        autoria,
        pessoaDestinoId: deps.escopo.pessoaId,
        conversaId: conversa.id,
        dados: { concessao_id: concessao.id, mensagem_id: mensagem.id, agente_id: agente.id, conector_id: conector.id, slug: conector.slug, capacidade },
      });
      doConector.push(concessao);
    }
  }
  for (const capacidade of capacidades) {
    const c = doConector.find((x) => x.capacidade === capacidade);
    if (c) saida.push({ capacidade, concessaoId: c.id, mensagemId: c.mensagemId });
  }
  return { data: { concessoes: saida, mensagemId, naoInclui }, events };
};

/** Uma capacidade: o lote de um. Quem decide acesso por botão chama `concederLote` (decidir-acesso.ts). */
export const conceder: CasoDeUso<EntradaConceder, SaidaConceder> = async (deps, input) => {
  const r = await concederLote(deps, { agenteId: input.agenteId, conectorId: input.conectorId, capacidades: [input.capacidade], autorTipo: input.autorTipo });
  const [c] = r.data.concessoes;
  if (!c) throw new ErroDeDominio("estado_invalido", { cause: "concessão não gravada" });
  return { data: { concessaoId: c.concessaoId, mensagemId: c.mensagemId, naoInclui: r.data.naoInclui }, events: r.events };
};
