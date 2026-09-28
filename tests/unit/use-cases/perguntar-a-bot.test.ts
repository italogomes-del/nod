import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { montarPlano } from "../../../src/domain/plano-turno.ts";
import { entregarRespostaPeer } from "../../../src/use-cases/entregar-resposta-peer.ts";
import { CLASSE_PERGUNTAR_A_BOT, perguntarABot } from "../../../src/use-cases/perguntar-a-bot.ts";
import { contexto, depsMemoria } from "../../helpers/deps-l7.ts";
import { PESSOA_ANA, PESSOA_MARLON, TENANT_LEAPY } from "../../helpers/ids.ts";

const AGORA = 1_700_000_000_000;

async function bot(d: ReturnType<typeof depsMemoria>, nome: string, deps = d.deps) {
  const a = await deps.repos.agentes.criar({ nome, dono: "pessoa", forma: "shape-hex", cor: "c-purple", modelo: "claude-haiku-4-5-20251001" });
  const c = await deps.repos.conversas.criar({ tipo: "propria", agenteId: a?.id ?? "" });
  return { id: a?.id ?? "", conversaId: c?.id ?? "", agente: a };
}

describe("perguntarABot (1 salto) e entregarRespostaPeer", () => {
  it("pedido iniciado numa sala retorna à mesma sala, com o contexto original e o fio visível", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const vera = await bot(d, "Vera");
    await bot(d, "Tuca");
    const sala = await d.deps.repos.conversas.criar({ tipo: "sala", salaId: randomUUID() });
    const original = await d.deps.repos.turnos.enfileirar({ conversaId: sala!.id, agenteId: vera.id, origem: "sala", prazoEm: AGORA + 1000, profundidade: 0, entradaTexto: "Prepare o lançamento", entradaConfianca: "confiavel", modelo: "haiku" });
    const pedido = await perguntarABot(d.deps, { ...contexto(vera.id, sala!.id), turnoId: original!.id, agente: "Tuca", pergunta: "Quais clientes avisar?" });
    expect(d.banco.mensagens.find((m) => m.kind === "handoff")).toMatchObject({ conversaId: sala!.id, payload: { tarefaId: pedido.data.tarefa_id } });
    const resposta = await entregarRespostaPeer(d.deps, { tarefaId: pedido.data.tarefa_id, texto: "Clientes do piloto." });
    if (!("continuacao" in resposta.data)) throw new Error("resposta ausente");
    expect(resposta.data.continuacao.conversaId).toBe(sala!.id);
    expect(resposta.data.mensagem.payload).toMatchObject({ turnoOrigemId: original!.id });
    expect(resposta.data.mensagem.conversaId).toBe(sala!.id);
  });
  it("mesmo dono: turno no alvo origem 'peer' profundidade 1, entrada moldurada nao_confiavel, pergunta gravada na conversa do alvo; devolve tarefa_id", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const vera = await bot(d, "Vera");
    const tuca = await bot(d, "Tuca");
    const r = await perguntarABot(d.deps, { ...contexto(vera.id, vera.conversaId), agente: "Tuca", pergunta: "qual o status do PR 42?" });
    const tarefa = d.banco.turnos.find((t) => t.id === r.data.tarefa_id);
    expect(tarefa).toMatchObject({ agenteId: tuca.id, conversaId: tuca.conversaId, origem: "peer", profundidade: 1, entradaConfianca: "nao_confiavel", estado: "pendente" });
    expect(tarefa?.entradaTexto).toContain("Pergunta de Vera (outro bot do nod");
    expect(tarefa?.entradaTexto).toContain("qual o status do PR 42?");
    expect(tarefa?.entradaTexto).toContain("Responda em texto, completo e verificável: tudo o que Vera precisa para responder à pessoa.");
    const pergunta = d.banco.mensagens.find((m) => m.conversaId === tuca.conversaId);
    expect(pergunta).toMatchObject({ turnoId: r.data.tarefa_id, kind: "texto", confianca: "nao_confiavel", autoria: { autor_tipo: "agente", autor_id: vera.id } });
    expect(r.events?.map((e) => e.kind)).toEqual(["mensagem_criada", "turno_criado"]);
  });

  it("outro dono sem procuração → nao_permitido; com procuração da classe → tarefa criada", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const vera = await bot(d, "Vera");
    const comoAna = d.comEscopo({ tenantId: TENANT_LEAPY, pessoaId: PESSOA_ANA });
    const tuca = await bot(d, "Tuca", comoAna);
    await expect(perguntarABot(d.deps, { ...contexto(vera.id, vera.conversaId), agente: "Tuca", pergunta: "oi" })).rejects.toMatchObject({ codigo: "nao_permitido" });
    expect(d.banco.turnos).toHaveLength(0);
    await comoAna.repos.procuracoes.criar({ agenteConcedenteId: tuca.id, agenteBeneficiarioId: vera.id, classesPermitidas: ["outra"], tetoDiario: 5 });
    await expect(perguntarABot(d.deps, { ...contexto(vera.id, vera.conversaId), agente: "Tuca", pergunta: "oi" })).rejects.toMatchObject({ codigo: "nao_permitido" });
    await comoAna.repos.procuracoes.criar({ agenteConcedenteId: tuca.id, agenteBeneficiarioId: vera.id, classesPermitidas: [CLASSE_PERGUNTAR_A_BOT], tetoDiario: 5 });
    const r = await perguntarABot(d.deps, { ...contexto(vera.id, vera.conversaId), agente: "Tuca", pergunta: "oi" });
    expect(d.banco.turnos.find((t) => t.id === r.data.tarefa_id)?.agenteId).toBe(tuca.id);
  });

  it("bot desconhecido → nao_encontrado; a si mesmo → entrada_invalida; pergunta vazia → texto_vazio", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const vera = await bot(d, "Vera");
    await bot(d, "Tuca");
    await expect(perguntarABot(d.deps, { ...contexto(vera.id, vera.conversaId), agente: "Zé", pergunta: "oi" })).rejects.toMatchObject({ codigo: "nao_encontrado" });
    await expect(perguntarABot(d.deps, { ...contexto(vera.id, vera.conversaId), agente: "Vera", pergunta: "oi" })).rejects.toMatchObject({ codigo: "entrada_invalida" });
    await expect(perguntarABot(d.deps, { ...contexto(vera.id, vera.conversaId), agente: "Tuca", pergunta: " " })).rejects.toMatchObject({ codigo: "texto_vazio" });
  });

  it("entregarRespostaPeer: mensagem peer_ask nao_confiavel {agenteId, nome, naoSupervisionado, tarefaId} na conversa do remetente + continuação profundidade 1 SEM perguntar_a_bot no plano", async () => {
    const d = depsMemoria({ agora: () => AGORA });
    const vera = await bot(d, "Vera");
    const tuca = await bot(d, "Tuca");
    const r = await perguntarABot(d.deps, { ...contexto(vera.id, vera.conversaId), agente: "Tuca", pergunta: "status?" });
    const entrega = await entregarRespostaPeer(d.deps, { tarefaId: r.data.tarefa_id, texto: "PR 42 aprovado, falta o merge." });
    if (!("mensagem" in entrega.data)) throw new Error("deveria entregar");
    expect(entrega.data.mensagem).toMatchObject({
      conversaId: vera.conversaId,
      kind: "peer_ask",
      confianca: "nao_confiavel",
      texto: "PR 42 aprovado, falta o merge.",
      payload: { kind: "peer_ask", agenteId: tuca.id, nome: "Tuca", naoSupervisionado: true, tarefaId: r.data.tarefa_id },
      autoria: { autor_tipo: "agente", autor_id: tuca.id, sob_procuracao_de: vera.id },
    });
    expect(entrega.data.continuacao).toMatchObject({ conversaId: vera.conversaId, agenteId: vera.id, origem: "peer", profundidade: 1, entradaConfianca: "nao_confiavel" });
    expect(entrega.data.continuacao.entradaTexto).toContain("NÃO confiável");
    expect(entrega.events?.map((e) => e.kind)).toEqual(["mensagem_criada", "turno_criado"]);

    // Profundidade 1 corta estruturalmente: o plano da continuação não tem perguntar_a_bot nem encaminhar.
    const plano = montarPlano({
      turno: entrega.data.continuacao,
      agente: vera.agente!,
      memorias: [],
      concessoes: [],
      conectores: [],
      modo: "conversa",
      confianca: "nao_confiavel",
      profundidade: 1,
      inventario: { estado: "pronto", versao: "x", em: AGORA },
      executor: "catcher",
      sessaoCli: null,
      pessoaNome: "Marlon",
      agora: AGORA,
    });
    const nomes = plano.catalogo.ferramentas.map((f) => f.nome);
    expect(nomes).not.toContain("perguntar_a_bot");
    expect(nomes).not.toContain("encaminhar");
    expect(nomes).toEqual(["lembrar"]);

    // A continuação NÃO é uma tarefa: entregar de novo sobre ela é ignorado.
    expect((await entregarRespostaPeer(d.deps, { tarefaId: entrega.data.continuacao.id, texto: "x" })).data).toEqual({ ignorado: "nao_e_tarefa_peer" });
    expect(d.banco.mensagens.filter((m) => m.kind === "peer_ask")).toHaveLength(1);
    expect(d.banco.turnos.filter((t) => t.conversaId === vera.conversaId && t.ownerId === PESSOA_MARLON)).toHaveLength(1);
  });
});
