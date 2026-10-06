import { describe, expect, it } from "vitest";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { duplicarAgente } from "../../../src/use-cases/duplicar-agente.ts";
import { editarPerfil } from "../../../src/use-cases/editar-perfil.ts";
import { gerirAgente } from "../../../src/use-cases/gerir-agente.ts";
import { enviarMensagem } from "../../../src/use-cases/enviar-mensagem.ts";
import { registrarMemoria } from "../../../src/use-cases/lembrar.ts";
import { depsEmMemoria, esperarErro, executar } from "../../helpers/deps-l6.ts";

describe("duplicarAgente (Grok Bot: Duplicate; a dona leva o bot inteiro, nunca o histórico)", () => {
  it("cópia leva nome ' (cópia)', título, descrição, dono, modelo, avatar e memória; sem mensagens", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "empresa", nome: "Vera" });
    await executar(deps, editarPerfil, { agenteId: criado.agente.id, titulo: "Revisora", descricao: "Revisa PRs" });
    await executar(deps, registrarMemoria, { agenteId: criado.agente.id, conversaId: criado.conversa.id, turnoId: null, tipo: "preferencia", texto: "resumos em tópicos", origem: "pessoa" });
    await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: { estado: "pronto", versao: "t", em: 0 } });

    const { data, events } = await executar(deps, duplicarAgente, { agenteId: criado.agente.id });
    expect(data.agente).toMatchObject({ nome: "Vera (cópia)", titulo: "Revisora", descricao: "Revisa PRs", dono: "empresa", visibility: "equipe", modelo: criado.agente.modelo, duplicadoDe: criado.agente.id });
    expect(data.agente.forma).toBe(criado.agente.forma);
    expect(data.agente.cor).toBe(criado.agente.cor);
    expect(data.conversa).toMatchObject({ tipo: "propria", agenteId: data.agente.id });
    expect(data.conversa.id).not.toBe(criado.conversa.id);
    expect(await deps.repos.memorias.listarDoAgente(data.agente.id)).toMatchObject([{ tipo: "preferencia", texto: "resumos em tópicos", origem: "pessoa" }]);
    expect(await deps.repos.mensagens.listarDaConversa(data.conversa.id)).toEqual([]);
    expect(await deps.repos.memorias.listarDoAgente(criado.agente.id)).toHaveLength(1);
    expect(events.map((e) => e.kind)).toEqual(["agente_atualizado"]);
  });

  it("a cópia nasce logo abaixo do original, na mesma seção da barra", async () => {
    const { deps } = depsEmMemoria();
    const ids: string[] = [];
    for (const nome of ["Dev 1", "Dev 2", "Dev 3"]) ids.push((await executar(deps, criarAgente, { dono: "pessoa", nome })).data.agente.id);
    await executar(deps, criarAgente, { dono: "pessoa", nome: "Solto" });
    for (const id of ids) await executar(deps, gerirAgente, { agenteId: id, acao: "organizar", secao: "Devs" });
    await executar(deps, gerirAgente, { agenteId: ids[0]!, acao: "organizar", ordem: ids });

    const { data } = await executar(deps, duplicarAgente, { agenteId: ids[1]! });

    expect(data.agente).toMatchObject({ secao: "Devs", fixado: false });
    const devs = (await deps.repos.agentes.listar()).filter((a) => a.secao === "Devs").map((a) => a.nome);
    expect(devs).toEqual(["Dev 1", "Dev 2", "Dev 2 (cópia)", "Dev 3"]);
  });

  it("original fixado e nunca arrastado: a cópia fica fixada, logo depois dele", async () => {
    const { deps } = depsEmMemoria();
    const a = (await executar(deps, criarAgente, { dono: "pessoa", nome: "Clarice" })).data.agente;
    const b = (await executar(deps, criarAgente, { dono: "pessoa", nome: "Milton" })).data.agente;
    await executar(deps, gerirAgente, { agenteId: a.id, acao: "organizar", fixado: true });
    await executar(deps, gerirAgente, { agenteId: b.id, acao: "organizar", fixado: true });

    const { data } = await executar(deps, duplicarAgente, { agenteId: a.id });

    expect(data.agente.fixado).toBe(true);
    expect((await deps.repos.agentes.listar()).filter((x) => x.fixado).map((x) => x.nome)).toEqual(["Clarice", "Clarice (cópia)", "Milton"]);
  });

  it("agente inexistente → nao_encontrado", async () => {
    const { deps } = depsEmMemoria();
    await esperarErro(() => duplicarAgente(deps, { agenteId: "nao-existe" }), "nao_encontrado");
  });
});
