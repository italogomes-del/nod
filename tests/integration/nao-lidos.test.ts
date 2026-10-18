import { expect, it } from "vitest";
import { vincularEscopo } from "../../src/db/tx.ts";
import type { Escopo } from "../../src/shared/types.ts";
import { criarAgente } from "../../src/use-cases/criar-agente.ts";
import { criarSala } from "../../src/use-cases/criar-sala.ts";
import { fixarAgente, ocultarAgente } from "../../src/use-cases/fixar-ocultar-agente.ts";
import { gerirAgente } from "../../src/use-cases/gerir-agente.ts";
import { listarFrota } from "../../src/use-cases/listar-frota.ts";
import { listarNaoLidos, marcarConversaLida, marcarConversaNaoLida, marcarTudoLido } from "../../src/use-cases/nao-lidos.ts";
import { autoriaPessoa } from "../../src/use-cases/autoria-evento.ts";
import { autoriaDoAgente } from "../../src/use-cases/registrar-negacao.ts";
import type { Deps } from "../../src/use-cases/tipos.ts";
import { ANA, MARLON, depsSobreTrx, esperarErro } from "../helpers/deps-l6.ts";
import { describeIntegracao } from "../helpers/integracao.ts";
import { withRollback } from "../helpers/with-rollback.ts";

/** Fala do bot na conversa (texto), como o assentar do turno grava. */
async function falaDoBot(d: Deps, escopo: Escopo, conversaId: string, agenteId: string, texto: string) {
  const m = await d.repos.mensagens.criar({ conversaId, autoria: autoriaDoAgente(escopo, agenteId), kind: "texto", texto, confianca: "confiavel" });
  if (!m) throw new Error("mensagem não criada");
  return m;
}

/** definido em 2026-09-29 (0039): "não lido" é o "lido até" por pessoa e conversa. */
describeIntegracao("não lidos: o que chegou depois do lido até", () => {
  it("conta a fala do bot, não a da pessoa nem o aviso do sistema; ler zera e a próxima fala volta a contar", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "pessoa", nome: "Leitor" });
      const c = b.conversa.id;
      await d.repos.mensagens.criar({ conversaId: c, autoria: autoriaPessoa(MARLON), kind: "texto", texto: "revisa o PR", confianca: "confiavel" });
      await d.repos.mensagens.criar({ conversaId: c, autoria: autoriaDoAgente(MARLON, b.agente.id), kind: "sistema", assunto: "memoria.anotada", texto: "Lembrei disso.", confianca: "confiavel" });
      const primeira = await falaDoBot(d, MARLON, c, b.agente.id, "Começando.");
      const segunda = await falaDoBot(d, MARLON, c, b.agente.id, "Pronto: o PR pode entrar.");

      const antes = (await listarNaoLidos(d, {})).data.conversas.find((x) => x.conversaId === c);
      expect(antes).toMatchObject({ tipo: "propria", agenteId: b.agente.id, total: 2, primeiraId: primeira.id, daRotina: false });
      expect(antes?.mensagens.map((m) => m.id)).toEqual([primeira.id, segunda.id]);
      expect((await listarFrota(d, {})).data.agentes.find((a) => a.id === b.agente.id)?.naoLido).toBe(true);

      await marcarConversaLida(d, { conversaId: c });
      // O lido_ate sai do banco com os microssegundos: a última fala não fica contando como nova.
      expect((await listarNaoLidos(d, {})).data.conversas.some((x) => x.conversaId === c)).toBe(false);
      expect((await listarFrota(d, {})).data.agentes.find((a) => a.id === b.agente.id)?.naoLido).toBe(false);

      const terceira = await falaDoBot(d, MARLON, c, b.agente.id, "Mais uma coisa.");
      expect((await listarNaoLidos(d, {})).data.conversas.find((x) => x.conversaId === c)).toMatchObject({ total: 1, primeiraId: terceira.id });
    });
  });

  it("mostra a primeira não lida e só as três últimas; o total conta todas", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "pessoa", nome: "Falante" });
      const falas = [];
      for (const t of ["um", "dois", "três", "quatro", "cinco"]) falas.push(await falaDoBot(d, MARLON, b.conversa.id, b.agente.id, t));
      const n = (await listarNaoLidos(d, {})).data.conversas.find((x) => x.conversaId === b.conversa.id);
      expect(n?.total).toBe(5);
      expect(n?.primeiraId).toBe(falas[0]!.id);
      expect(n?.mensagens.map((m) => m.texto)).toEqual(["três", "quatro", "cinco"]);
    });
  });

  it("marcar como não lido devolve a última fala do bot; sem fala não há o que marcar; o menu do bot usa o mesmo lido até", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "pessoa", nome: "Quieto" });
      expect((await marcarConversaNaoLida(d, { conversaId: b.conversa.id })).data.marcada).toBe(false);

      await falaDoBot(d, MARLON, b.conversa.id, b.agente.id, "antiga");
      const ultima = await falaDoBot(d, MARLON, b.conversa.id, b.agente.id, "última");
      await marcarConversaLida(d, { conversaId: b.conversa.id });
      expect((await marcarConversaNaoLida(d, { conversaId: b.conversa.id })).data.marcada).toBe(true);
      expect((await listarNaoLidos(d, {})).data.conversas.find((x) => x.conversaId === b.conversa.id)).toMatchObject({ total: 1, primeiraId: ultima.id });

      await gerirAgente(d, { agenteId: b.agente.id, acao: "organizar", naoLido: false });
      expect((await listarNaoLidos(d, {})).data.conversas.some((x) => x.conversaId === b.conversa.id)).toBe(false);
      await gerirAgente(d, { agenteId: b.agente.id, acao: "organizar", naoLido: true });
      expect((await listarNaoLidos(d, {})).data.conversas.find((x) => x.conversaId === b.conversa.id)?.primeiraId).toBe(ultima.id);
    });
  });

  it("bot oculto sai da lista (não está na barra), mas a frota de gestão ainda diz que ele tem novidade", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "pessoa", nome: "Escondido" });
      await falaDoBot(d, MARLON, b.conversa.id, b.agente.id, "oi");
      await fixarAgente(d, { agenteId: b.agente.id, fixado: false });
      await ocultarAgente(d, { agenteId: b.agente.id, oculto: true });
      expect((await listarNaoLidos(d, {})).data.conversas.some((x) => x.conversaId === b.conversa.id)).toBe(false);
      expect((await listarFrota(d, { gerenciar: true })).data.agentes.find((a) => a.id === b.agente.id)?.naoLido).toBe(true);
    });
  });

  it("a sala entra com a fala de qualquer bot dela; marcar tudo lê bots e salas de uma vez", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: x } = await criarAgente(d, { dono: "pessoa", nome: "Bot X" });
      const { data: y } = await criarAgente(d, { dono: "pessoa", nome: "Bot Y" });
      const { data: s } = await criarSala(d, { nome: "revisão", agenteIds: [x.agente.id, y.agente.id] });
      await marcarConversaLida(d, { conversaId: s.conversa.id });
      await falaDoBot(d, MARLON, s.conversa.id, y.agente.id, "Subi a revisão.");
      await falaDoBot(d, MARLON, x.conversa.id, x.agente.id, "Terminei.");

      const lista = (await listarNaoLidos(d, {})).data.conversas;
      expect(lista.find((c) => c.conversaId === s.conversa.id)).toMatchObject({ tipo: "sala", salaId: s.sala.id, total: 1 });
      // A mais recente em cima.
      expect(lista.findIndex((c) => c.conversaId === x.conversa.id)).toBeLessThan(lista.findIndex((c) => c.conversaId === s.conversa.id));

      await marcarTudoLido(d, {});
      expect((await listarNaoLidos(d, {})).data.conversas.filter((c) => [s.conversa.id, x.conversa.id].includes(c.conversaId))).toEqual([]);
    });
  });

  it("o lido é de cada pessoa: a Ana não vê as conversas do Marlon nem marca por ele", async () => {
    await withRollback(MARLON, async (tx) => {
      const d = depsSobreTrx(tx, MARLON);
      const { data: b } = await criarAgente(d, { dono: "pessoa", nome: "Privado" });
      await falaDoBot(d, MARLON, b.conversa.id, b.agente.id, "só para o Marlon");

      await vincularEscopo(tx, ANA);
      const a = depsSobreTrx(tx, ANA);
      expect((await listarNaoLidos(a, {})).data.conversas.some((x) => x.conversaId === b.conversa.id)).toBe(false);
      await esperarErro(() => marcarConversaLida(a, { conversaId: b.conversa.id }), "nao_encontrado");

      await vincularEscopo(tx, MARLON);
      expect((await listarNaoLidos(d, {})).data.conversas.find((x) => x.conversaId === b.conversa.id)?.total).toBe(1);
    });
  });
});
