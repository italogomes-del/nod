import type { Mensagem } from "../contracts/mensagem.ts";
import { JANELA_RELATO_MS, type EntradaRelato, type Relato } from "../contracts/relato.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { redigirSegredos } from "../domain/segredos.ts";
import { autoriaPessoa, evento } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";

export type SaidaRegistrarRelato = { relato: Relato };

/** Um bot não tem nome aqui: o trecho guarda o TIPO do autor, que é o que a investigação usa. */
function autorDe(m: Mensagem): string {
  return m.autoria.autor_tipo === "pessoa" ? "pessoa" : "agente";
}

/** O trecho que o relato anexa (o do botão e o contado ao Nod): o tipo do autor e o texto redigido (NOD-158). */
export function trechoDoRelato(mensagens: readonly Mensagem[]): { mensagens: { id: string; autor: string; kind: string; texto: string; em: number }[] } {
  return { mensagens: mensagens.map((m) => ({ id: m.id, autor: autorDe(m), kind: m.kind, texto: redigirSegredos(m.texto), em: m.criadoEm })) };
}

/**
 * A pessoa aponta uma mensagem e diz que o comportamento não foi o desejado (ADR-041).
 *
 * O que ela informa é curto — qual mensagem, que categoria, se anexa a janela, e um texto opcional.
 * O que o time recebe é o estado técnico inteiro do momento, copiado daquilo que JÁ estava tipado e
 * persistido: sinais write-ahead do turno (ADR-009), motivo da falha, modelo, harness, custo, e o
 * diagnóstico que a ponte gravou quando a execução não concluiu.
 *
 * A prosa (texto da pessoa + trecho da conversa) vai para `relato_prosa`, apagável por nod_poda: o
 * trecho pode carregar dado pessoal (ADR-002) e conteúdo não confiável (ADR-026), e precisa sair
 * inteiro num pedido de exclusão sem levar o registro junto.
 */
export const registrarRelato: CasoDeUso<EntradaRelato, SaidaRegistrarRelato> = async (deps, input) => {
  const mensagem = await deps.repos.mensagens.buscar(input.mensagemId);
  if (!mensagem) throw new ErroDeDominio("nao_encontrado");

  const agora = deps.agora();
  // Mensagem de sistema/negação pode não ter turno; o relato continua válido, só sem metadado de execução.
  const turno = mensagem.turnoId ? await deps.repos.turnos.buscar(mensagem.turnoId) : null;
  const diagnostico = mensagem.turnoId ? await deps.repos.relatos.diagnosticoDoTurno(mensagem.turnoId) : null;

  // A janela é resolvida AQUI, ancorada na mensagem apontada: o cliente manda o alcance, nunca o
  // intervalo. Ler sob RLS já filtra o que esta pessoa pode ver.
  const anexadas =
    input.alcance === "janela"
      ? await deps.repos.mensagens.janelaAte(mensagem.conversaId, mensagem.id, mensagem.criadoEm - JANELA_RELATO_MS)
      : [mensagem];

  const relato = await deps.repos.relatos.criar({
    mensagemId: mensagem.id,
    conversaId: mensagem.conversaId,
    turnoId: mensagem.turnoId,
    categoria: input.categoria,
    alcance: input.alcance,
    mensagensAnexadas: anexadas.length,
    estadoTurno: turno?.estado ?? null,
    origemTurno: turno?.origem ?? null,
    sinais: turno?.sinais ?? null,
    motivoFalha: turno?.motivoFalha ?? null,
    motivoInterrupcao: turno?.motivoInterrupcao ?? null,
    modelo: turno?.modelo ?? null,
    harness: turno?.harness ?? null,
    executor: mensagem.autoria.executor,
    machineId: turno?.machineId ?? mensagem.autoria.machine_id,
    custoUsd: turno?.custoUsd ?? null,
    reenvios: turno?.reenvios ?? null,
    confiancaMensagem: mensagem.confianca,
    mensagemParcial: mensagem.parcial,
    versaoApp: input.versaoApp ?? null,
    correlationId: input.correlationId ?? null,
  });
  if (!relato) throw new ErroDeDominio("nao_permitido");

  // Aparado aqui também, não só no validador da borda: quem chamar o caso de uso por outro caminho
  // não grava espaço em branco como se fosse complemento da pessoa.
  // NOD-158: a prosa é uma cópia que sai do contexto vivo, então vai redigida; a mensagem gravada não muda.
  const textoPessoa = input.texto?.trim() ?? "";
  await deps.repos.relatos.gravarProsa({
    relatoId: relato.id,
    textoPessoa: textoPessoa === "" ? null : redigirSegredos(textoPessoa),
    trecho: trechoDoRelato(anexadas),
  });

  // Só escalares no evento (DadosEvento): o texto do relato NUNCA sai daqui (ADR-004).
  const events = [
    evento(deps.escopo, {
      kind: "relato_criado",
      autoria: autoriaPessoa(deps.escopo, mensagem.autoria.executor),
      agora,
      conversaId: mensagem.conversaId,
      turnoId: mensagem.turnoId,
      dados: {
        relato_id: relato.id,
        categoria: relato.categoria,
        alcance: relato.alcance,
        mensagens_anexadas: relato.mensagensAnexadas,
        com_diagnostico: diagnostico !== null,
      },
    }),
  ];

  return { data: { relato: { ...relato, diagnostico } }, events };
};

export const listarRelatos: CasoDeUso<{ limite?: number }, { relatos: Relato[] }> = async (deps, input) => {
  return { data: { relatos: await deps.repos.relatos.listar(input.limite) } };
};
