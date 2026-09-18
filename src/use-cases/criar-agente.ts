import type { PreferenciaHarness } from "../contracts/harness.ts";
import { validarInteligencia } from "../domain/harness.ts";
import type { Agente, DonoAgente } from "../contracts/agente.ts";
import type { Conversa } from "../contracts/conversa.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { nomeDeBoasVindas, proximaCor, proximaForma } from "../domain/proposta-agente.ts";
import { autoriaDoAgente } from "./registrar-negacao.ts";
import { redigir } from "../domain/redacao.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";

/** EMENDA 17: nome opcional; ausente → 'Novo agente' e o modelo propõe pelo atualizar_perfil. */
export const NOME_INICIAL = "Novo agente";

export type EntradaCriarAgente = { dono: DonoAgente; interativo?: boolean; nome?: string; modelo?: string; harness?: PreferenciaHarness; titulo?: string; descricao?: string };
export type SaidaCriarAgente = { agente: Agente; conversa: Conversa; mensagem: Mensagem };

/**
 * Criação conversacional (E1.1/E1.2/E1.3): nasce 'Novo agente' com forma/cor por round-robin,
 * visibilidade 'equipe' quando o dono é a empresa (repositório), conversa própria e a mensagem
 * de sistema 'agente-nasceu'. Sem acessos, sem rotina, sem memória — nada é concedido aqui.
 */
export const criarAgente: CasoDeUso<EntradaCriarAgente, SaidaCriarAgente> = async (deps, input) => {
  if (input.dono !== "pessoa" && input.dono !== "empresa") throw new ErroDeDominio("entrada_invalida", { cause: "dono" });
  if (input.nome !== undefined && typeof input.nome !== "string") throw new ErroDeDominio("entrada_invalida", { cause: "nome" });
  validarInteligencia(input.harness ?? "auto", input.modelo ?? "auto");
  const existentes = await deps.repos.agentes.listar({ incluirOcultos: true });
  const nome = (input.nome ?? "").trim() || (input.interativo ? nomeDeBoasVindas(existentes.map((a) => a.nome)) : NOME_INICIAL);
  if (nome.length > 60 || (input.titulo !== undefined && typeof input.titulo !== "string") || (input.descricao !== undefined && typeof input.descricao !== "string")) throw new ErroDeDominio("entrada_invalida");
  const titulo = input.titulo?.trim() ?? "";
  const descricao = input.descricao?.trim() ?? "";
  if (titulo.length > 120 || descricao.length > 8000) throw new ErroDeDominio("entrada_invalida");
  const confirmado = nome !== NOME_INICIAL && descricao !== "";
  const agora = deps.agora();

  const forma = proximaForma(existentes.map((a) => a.forma));
  const cor = proximaCor(existentes.map((a) => a.cor));

  const agente = await deps.repos.agentes.criar({ nome, titulo, descricao, confirmado, dono: input.dono, forma, cor, modelo: input.modelo ?? "auto", harness: input.harness ?? "auto" });
  if (!agente) throw new ErroDeDominio("estado_invalido", { cause: "agente não criado" });
  const conversa = await deps.repos.conversas.criar({ tipo: "propria", agenteId: agente.id, visibility: agente.visibility });
  if (!conversa) throw new ErroDeDominio("estado_invalido", { cause: "conversa não criada" });

  const autoria = autoriaPessoa(deps.escopo);
  const mensagem = await deps.repos.mensagens.criar({
    conversaId: conversa.id,
    autoria: input.interativo ? autoriaDoAgente(deps.escopo, agente.id, { decididoPor: "regra:boas_vindas" }) : autoria,
    kind: input.interativo ? "texto" : "sistema",
    payload: input.interativo ? { kind: "boas_vindas" } : null,
    texto: input.interativo ? `Oi! Eu sou ${nome}. Acabamos de nos conhecer. Para que você quer minha ajuda? Pode escolher uma opção ou me contar do seu jeito.` : confirmado ? `${nome} está pronto. O perfil que você definiu já está salvo; envie a primeira tarefa.` : redigir("agente-nasceu", agora),
    confianca: "confiavel",
  });
  if (!mensagem) throw new ErroDeDominio("estado_invalido", { cause: "mensagem não criada" });

  return {
    data: { agente, conversa, mensagem },
    events: [
      evento(deps.escopo, { kind: "agente_atualizado", autoria, agora, conversaId: conversa.id, dados: { agente_id: agente.id, acao: "criado", nome: agente.nome, dono: agente.dono } }),
      evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: conversa.id, dados: { mensagem_id: mensagem.id, kind: mensagem.kind } }),
    ],
  };
};
