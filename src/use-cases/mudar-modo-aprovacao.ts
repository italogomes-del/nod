import type { Agente } from "../contracts/agente.ts";
import type { RuntimeEvent } from "../contracts/evento.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { ehModoAprovacao, ROTULO_MODO } from "../domain/modo-aprovacao.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";

/** O que cada modo passa a fazer, dito na linha da conversa (a mesma frase do menu, sem o nome do bot). */
const EFEITO: Readonly<Record<string, string>> = {
  manual: "o que muda algo volta a pedir você.",
  automatico: "aprova as próprias ações e só para no que for arriscado, tocar uma credencial do Mac ou vier depois de ler a web ou um e-mail.",
  total: "aprova tudo, até depois de ler a web ou um e-mail; só credencial do Mac pede você.",
};

/**
 * A dona troca o modo de aprovação do bot (ADR-059), pelo chip do campo. Só a dona: o repositório filtra por
 * owner_id e devolve null para bot de equipe de outra pessoa. A troca vira linha na conversa do bot — é a
 * autoridade sob a qual as próximas ações vão sair sem clique, e a trilha precisa dizer desde quando.
 * Vale na próxima ação: quem decide lê o modo atual do agente; o que já espera a pessoa continua esperando.
 */
export const mudarModoAprovacao: CasoDeUso<{ agenteId: string; modo: unknown }, { agente: Agente; mudou: boolean }> = async (deps, input) => {
  if (!ehModoAprovacao(input.modo)) throw new ErroDeDominio("entrada_invalida", { cause: "modo" });
  const existente = await deps.repos.agentes.buscar(input.agenteId);
  if (!existente) throw new ErroDeDominio("nao_encontrado");
  if (existente.ownerId !== deps.escopo.pessoaId) throw new ErroDeDominio("nao_permitido");
  if ((existente.modoAprovacao ?? "manual") === input.modo) return { data: { agente: existente, mudou: false } };
  const agente = await deps.repos.agentes.definirModoAprovacao(input.agenteId, input.modo);
  if (!agente) throw new ErroDeDominio("nao_permitido");

  const agora = deps.agora();
  const autoria = autoriaPessoa(deps.escopo);
  const events: RuntimeEvent[] = [evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, dados: { agente_id: agente.id, acao: "modo_aprovacao", modo: input.modo, nome: agente.nome } })];
  const conversa = await deps.repos.conversas.buscarPropriaDoAgente(agente.id);
  if (conversa) {
    const pessoa = await deps.repos.pessoas.buscar(deps.escopo.pessoaId);
    const linha = await deps.repos.mensagens.criar({
      conversaId: conversa.id,
      turnoId: null,
      autoria,
      kind: "sistema",
      assunto: "aprovacao.modo",
      texto: `${pessoa?.nome ?? "A pessoa"} mudou as aprovações de ${agente.nome} para ${ROTULO_MODO[input.modo]}: ${EFEITO[input.modo]}`,
      confianca: "confiavel",
    });
    if (linha) events.push(evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: conversa.id, dados: { mensagem_id: linha.id, kind: "sistema" } }));
  }
  return { data: { agente, mudou: true }, events };
};
