import type { Agente } from "../contracts/agente.ts";
import type { Memoria } from "../contracts/memoria.ts";
import type { FerramentaPlano, ModoTurno } from "../contracts/plano-turno.ts";
import { redigir } from "./redacao.ts";

/** definido em 2026-09-16: memória limitada e ordenada para o --append-system-prompt ser ESTÁVEL por agente (cache ephemeral_1h, mapa-cli). */
export const MEMORIAS_NO_PROMPT = 40;

const INSTRUCAO_MODO: Record<ModoTurno, string> = {
  criacao:
    "Modo de criação: você acabou de nascer sem nome definitivo. Entenda o que a pessoa quer e chame atualizar_perfil com nome, título e descrição propostos; se ela descrever uma recorrência, chame criar_rotina; se pedir acesso a um app, chame pedir_acesso. Nada vale antes de a pessoa confirmar.",
  conversa: "Modo de conversa: responda à pessoa. Efeito externo só por item aprovado via pedir_aprovacao.",
  sala: "Modo de sala: você fala com outros bots e com a pessoa. Se não tem nada a dizer, chame passar; se outro bot é o certo, chame encaminhar.",
  rotina: "Modo de rotina: execute a instrução agendada. Se não houver dado, diga que não houve. Efeito externo só por item aprovado via pedir_aprovacao.",
  peer: "Modo de resposta a outro bot: responda em texto, curto e verificável. Você não pode delegar nem encaminhar neste turno.",
};

/**
 * Prompt de sistema ESTÁVEL e determinístico (ordem fixa; memória ordenada por criação e limitada).
 * Fixa o idioma (a sonda de 2026-09-16 viu haiku responder em inglês sem isso) e lista as únicas
 * ferramentas, porque o prompt padrão do CLI cita Read/Edit/Write mesmo com --tools "".
 */
export function montarPromptSistema(entrada: {
  agente: Pick<Agente, "nome" | "titulo" | "descricao">;
  memorias: readonly Memoria[];
  ferramentas: readonly FerramentaPlano[];
  pessoaNome: string;
  modo: ModoTurno;
}): string {
  const linhas: string[] = [];
  linhas.push(`Você é ${entrada.agente.nome}${entrada.agente.titulo ? `, ${entrada.agente.titulo}` : ""}, um agente do nod a serviço de ${entrada.pessoaNome}.`);
  linhas.push("Responda sempre em português do Brasil.");
  if (entrada.agente.descricao.trim() !== "") linhas.push(`O que você faz: ${entrada.agente.descricao.trim()}`);
  linhas.push(INSTRUCAO_MODO[entrada.modo]);
  const nomes = [...entrada.ferramentas].map((f) => f.nomeMcp).sort();
  linhas.push(nomes.length === 0 ? "As únicas ferramentas disponíveis são: nenhuma. Não há Read, Edit, Write, Glob nem Grep." : `As únicas ferramentas disponíveis são: ${nomes.join(", ")}. Não há Read, Edit, Write, Glob nem Grep.`);
  const memorias = [...entrada.memorias].sort((a, b) => a.criadoEm - b.criadoEm || a.id.localeCompare(b.id)).slice(0, MEMORIAS_NO_PROMPT);
  if (memorias.length > 0) {
    linhas.push(`Memória (${redigir("memoria-nao-e-fonte", 0)}):`);
    for (const m of memorias) linhas.push(`- [${m.tipo}] ${m.texto}`);
  }
  return linhas.join("\n");
}
