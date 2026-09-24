import type { Decisao, TipoDecisao } from "../contracts/decisao.ts";
import type { Executor, RuntimeEvent } from "../contracts/evento.ts";
import type { Mensagem } from "../contracts/mensagem.ts";
import type { Turno } from "../contracts/turno.ts";
import { ErroDeDominio } from "../domain/erro.ts";
import { rotinaDoTurno } from "./apoio-l7.ts";
import { autoriaPessoa, evento, PRAZO_DECISAO_PADRAO_MS } from "./autoria-evento.ts";
import type { CasoDeUso } from "./tipos.ts";

/**
 * Os três tipos de pedir_a_pessoa (EMENDA 16): a resposta é TEXTO da pessoa, nunca um botão.
 * Dispensar (× / "Dispensar", #46 e ADR-045) NÃO é responder: fecha sem texto e sem retomar (dispensar-decisao.ts).
 */
export const TIPOS_RESPONDIVEIS: ReadonlySet<TipoDecisao> = new Set<TipoDecisao>(["pergunta", "falta_de_dado", "permissao"]);

/**
 * FASE 1 — pela DECISORA (pode ser outra pessoa que a dona: policy nod_decisora, 0003): fecha a
 * decisão com o texto registrado como quem destravou. Devolve a decisão para a fase 2 achar a dona.
 */
export const fecharComResposta: CasoDeUso<{ decisaoId: string; texto: string }, { decisao: Decisao }> = async (deps, input) => {
  const texto = typeof input.texto === "string" ? input.texto.trim() : "";
  if (texto === "") throw new ErroDeDominio("texto_vazio");
  const atual = await deps.repos.decisoes.buscar(input.decisaoId);
  if (!atual) throw new ErroDeDominio("nao_encontrado", { cause: "decisão" });
  if (!TIPOS_RESPONDIVEIS.has(atual.tipo)) throw new ErroDeDominio("estado_invalido", { cause: `decisão ${atual.tipo} não se responde com texto; use decidir` });
  if (atual.estado !== "pendente" && atual.estado !== "reaberta") throw new ErroDeDominio("estado_invalido", { cause: `decisão ${atual.estado}` });
  const agora = deps.agora();
  const decisao = await deps.repos.decisoes.decidir(atual.id, { por: deps.escopo.pessoaId, agora });
  if (!decisao) throw new ErroDeDominio("nao_permitido", { cause: "nem dona nem decisora" });
  const autoria = autoriaPessoa(deps.escopo);
  return {
    data: { decisao },
    events: [evento(deps.escopo, { kind: "decisao_decidida", autoria, agora, conversaId: decisao.conversaId, turnoId: decisao.turnoId, dados: { decisao_id: decisao.id, tipo: decisao.tipo, respondida: true } })],
  };
};

export type EntradaRetomarComResposta = { decisao: Decisao; texto: string; respondidaPor: { id: string; nome: string }; prazoMs?: number; executor?: Executor };
export type SaidaRetomarComResposta = { mensagem: Mensagem; turno: Turno | null };

/**
 * FASE 2 — pela DONA (o outbox e o turno exigem owner = pessoa da sessão): a resposta vira mensagem
 * de texto na conversa e um turno de RETOMADA (origem 'retomada', retoma_turno_id = o turno que
 * parou, --resume pela sessão da conversa) com a resposta como entrada. O turno original de
 * pedir_a_pessoa ENCERROU normalmente (E5.2), por isso não passa por retomarTurno (que exige
 * 'interrompido'). Sem turno original (decisão de sala esfriada) só a mensagem entra.
 */
export const retomarComResposta: CasoDeUso<EntradaRetomarComResposta, SaidaRetomarComResposta> = async (deps, input) => {
  const agora = deps.agora();
  const d = input.decisao;
  const autoria: ReturnType<typeof autoriaPessoa> = { ...autoriaPessoa(deps.escopo, input.executor ?? "catcher"), autor_id: input.respondidaPor.id };
  const mensagem = await deps.repos.mensagens.criar({ conversaId: d.conversaId, turnoId: d.turnoId, autoria, kind: "texto", texto: input.texto, confianca: "confiavel" });
  if (!mensagem) throw new ErroDeDominio("nao_permitido");
  const events: RuntimeEvent[] = [evento(deps.escopo, { kind: "mensagem_criada", autoria, agora, conversaId: d.conversaId, turnoId: d.turnoId, dados: { mensagem_id: mensagem.id, kind: "texto", decisao_id: d.id, destravou: true } })];
  let turno: Turno | null = null;
  if (d.turnoId) {
    const original = await deps.repos.turnos.buscar(d.turnoId);
    if (original) {
      await deps.repos.paradas.encerrarAbertas({ conversaId: d.conversaId, agora });
      // definido em 2026-09-24 (ADR-044): a retomada de uma rotina roda como rotina, em sessão nova
      // (emitir-plano-turno.ts), então precisa da entrada ORIGINAL da rotina para saber o que fazer.
      const daRotina = await rotinaDoTurno(deps.repos, original.id);
      turno = await deps.repos.turnos.enfileirar({
        conversaId: d.conversaId,
        agenteId: d.agenteId,
        origem: "retomada",
        prazoEm: agora + (input.prazoMs ?? PRAZO_DECISAO_PADRAO_MS),
        profundidade: original.profundidade,
        entradaTexto: [
          `Resposta de ${input.respondidaPor.nome} ao seu pedido (${d.tipo}: "${d.frase}"): ${input.texto}`,
          "Continue a partir daqui; nada foi reenviado.",
          ...(daRotina ? ["Entrada original da rotina:", daRotina.turnoDisparado.entradaTexto] : []),
        ].join("\n"),
        // definido em 2026-09-24 (ADR-044): a confiança é a do turno que PAROU, nunca "confiavel" fixo. A
        // rotina que leu e-mail nasce nao_confiavel; responder por ela não limpa o que já está no contexto.
        entradaConfianca: original.entradaConfianca,
        modelo: original.modelo,
        harness: original.harness,
        retomaTurnoId: original.id,
        reenvios: original.reenvios + 1,
        executor: input.executor ?? "catcher",
      });
      if (turno) events.push(evento(deps.escopo, { kind: "turno_criado", autoria, agora, conversaId: d.conversaId, turnoId: turno.id, dados: { origem: "retomada", retoma_turno_id: original.id, decisao_id: d.id } }));
    }
  }
  return { data: { mensagem, turno }, events };
};
