import { describe, expect, it } from "vitest";
import { criarAgente } from "../../../src/use-cases/criar-agente.ts";
import { duplicarAgente } from "../../../src/use-cases/duplicar-agente.ts";
import { editarPerfil } from "../../../src/use-cases/editar-perfil.ts";
import { enviarMensagem } from "../../../src/use-cases/enviar-mensagem.ts";
import { registrarMemoria } from "../../../src/use-cases/lembrar.ts";
import { depsEmMemoria, esperarErro, executar } from "../../helpers/deps-l6.ts";

describe("duplicarAgente (Grok Bot: Duplicate copia perfil, nunca memória nem histórico)", () => {
  it("cópia leva nome ' (cópia)', título, descrição, dono e modelo; forma/cor novas; sem memórias nem mensagens", async () => {
    const { deps } = depsEmMemoria();
    const { data: criado } = await executar(deps, criarAgente, { dono: "empresa", nome: "Vera" });
    await executar(deps, editarPerfil, { agenteId: criado.agente.id, titulo: "Revisora", descricao: "Revisa PRs" });
    await executar(deps, registrarMemoria, { agenteId: criado.agente.id, conversaId: criado.conversa.id, turnoId: null, tipo: "preferencia", texto: "resumos em tópicos", origem: "pessoa" });
    await executar(deps, enviarMensagem, { conversaId: criado.conversa.id, texto: "oi", inventario: { estado: "pronto", versao: "t", em: 0 } });

    const { data, events } = await executar(deps, duplicarAgente, { agenteId: criado.agente.id });
    expect(data.agente).toMatchObject({ nome: "Vera (cópia)", titulo: "Revisora", descricao: "Revisa PRs", dono: "empresa", visibility: "equipe", modelo: criado.agente.modelo, duplicadoDe: criado.agente.id });
    expect(data.agente.forma).not.toBe(criado.agente.forma);
    expect(data.agente.cor).not.toBe(criado.agente.cor);
    expect(data.conversa).toMatchObject({ tipo: "propria", agenteId: data.agente.id });
    expect(data.conversa.id).not.toBe(criado.conversa.id);
    expect(await deps.repos.memorias.listarDoAgente(data.agente.id)).toEqual([]);
    expect(await deps.repos.mensagens.listarDaConversa(data.conversa.id)).toEqual([]);
    expect(await deps.repos.memorias.listarDoAgente(criado.agente.id)).toHaveLength(1);
    expect(events.map((e) => e.kind)).toEqual(["agente_atualizado"]);
  });

  it("agente inexistente → nao_encontrado", async () => {
    const { deps } = depsEmMemoria();
    await esperarErro(() => duplicarAgente(deps, { agenteId: "nao-existe" }), "nao_encontrado");
  });
});
