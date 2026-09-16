import { describe, expect, it } from "vitest";
import { chaveDe } from "../db/cifra.ts";
import { TENANT_LOCAL, type Snapshot } from "../db/store.ts";
import { criarAgenteNovo, tratarMensagem, confirmarProposta } from "./conversa.ts";

function snap(): Snapshot {
  return {
    tenantId: TENANT_LOCAL,
    pessoa: { tenantId: TENANT_LOCAL, id: "p", nome: "Marlon", iniciais: "MW" },
    agentes: [],
    mensagens: [],
    rotinas: [],
    concessoes: [],
    janelas: [],
    credenciaisCifradas: {},
  };
}

const chave = chaveDe("0".repeat(64));
const agora = Date.parse("2026-09-16T12:00:00-03:00");

describe("conversa — jornada Meus agentes", () => {
  it("criar → dizer o que faz → rotina via texto → conectar Slack", () => {
    const s = snap();
    const agente = criarAgenteNovo(s, agora);
    expect(agente.instrucoes).toBe("");
    expect(s.mensagens.some((m) => m.kind === "starter")).toBe(true);

    tratarMensagem(
      s,
      agente,
      "Quero que me ajude a responder formulários da LGPD e organizar tarefas do ClickUp.",
      chave,
      agora + 1,
    );
    const papel = s.mensagens.find((m) => m.kind === "proposta-papel");
    expect(papel).toBeTruthy();
    expect(agente.confirmado).toBe(false);

    confirmarProposta(s, agente, papel!.id, chave, agora + 2);
    expect(agente.confirmado).toBe(true);
    expect(agente.nome).toBe("LGPD");
    expect(agente.instrucoes).toMatch(/LGPD/);

    tratarMensagem(
      s,
      agente,
      "faz esse fechamento toda segunda às 7h e me manda antes de qualquer coisa sair",
      chave,
      agora + 3,
    );
    const rotinaMsg = s.mensagens.find((m) => m.kind === "proposta-rotina");
    expect(rotinaMsg).toBeTruthy();
    expect(s.rotinas[0]?.estado).toBe("proposta");
    expect(s.rotinas[0]?.exigeAprovacao).toBe(true);
    expect(s.rotinas[0]?.cron).toBe("0 7 * * 1");

    confirmarProposta(s, agente, rotinaMsg!.id, chave, agora + 4);
    expect(s.rotinas[0]?.estado).toBe("ativa");

    tratarMensagem(s, agente, "conecta com o Slack", chave, agora + 5);
    const slack = [...s.mensagens].reverse().find((m) => m.kind === "proposta-concessao" && m.payload?.["conectorId"] === "slack");
    expect(slack?.payload?.["conectorId"]).toBe("slack");
    expect((slack?.payload?.["capacidadesLigadas"] as string[]) ?? []).toEqual([]);

    confirmarProposta(s, agente, slack!.id, chave, agora + 6, {
      declaracao: "toca",
      capacidadesLigadas: ["ler-canais"],
    });
    const conc = s.concessoes.find((c) => c.conectorId === "slack");
    expect(conc?.estado).toBe("conectada");
    expect(conc?.declaracao).toBe("toca");
    expect(conc?.capacidadesLigadas).toEqual(["ler-canais"]);
    expect(s.credenciaisCifradas[conc!.id]).toMatch(/^v1:/);
  });
});
