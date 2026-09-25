import { describe, expect, it } from "vitest";
import type { ConexaoApp } from "../../../web/estado/reducer.ts";
import { criarConexoes, ERROS_SEGUIDOS_MAX, FALHA_APP, FALHA_JANELA_FECHADA, FALHA_PRAZO, FALHA_SERVIDOR, INTERVALO_MS, PRAZO_MS, type DepsConexao, type JanelaLogin } from "../../../web/lib/conexao.ts";

/** Relógio falso: `esperar` avança o tempo na hora, sem timer de verdade. */
function montar(p: { verificacoes: (boolean | "falhou" | "erro")[]; url?: string; conectadoDireto?: boolean; janela?: JanelaLogin | null; conectarFalha?: boolean }) {
  let agora = 0;
  const mudancas: [string, ConexaoApp | null][] = [];
  const conectados: string[] = [];
  let verificou = 0;
  const janela: JanelaLogin | null = p.janela === undefined ? { closed: false, location: { href: "" }, close() { (this as { closed: boolean }).closed = true; } } : p.janela;
  const deps: DepsConexao = {
    conectar: async () => {
      if (p.conectarFalha) throw new Error("servidor");
      return p.conectadoDireto ? { conectado: true } : { url: p.url ?? "https://login.exemplo/x" };
    },
    verificar: async () => {
      const v = p.verificacoes[verificou++] ?? false;
      if (v === "erro") throw new Error("rede");
      return v === "falhou" ? { conectado: false, falhou: true } : { conectado: v };
    },
    mudou: (slug, valor) => void mudancas.push([slug, valor]),
    conectado: (slug) => void conectados.push(slug),
    abrirJanela: () => janela,
    esperar: async (ms) => void (agora += ms),
    agora: () => agora,
  };
  return { conexoes: criarConexoes(deps), mudancas, conectados, janela, verificou: () => verificou };
}

describe("login de app sem 'Verificar conexão' (definido em 2026-09-25)", () => {
  it("abre a janela no clique, põe a URL do provedor nela e pergunta sozinho até conectar", async () => {
    const m = montar({ verificacoes: [false, false, true] });
    await m.conexoes.iniciar("clickup");
    expect(m.janela?.location.href).toBe("https://login.exemplo/x");
    expect(m.verificou()).toBe(3);
    expect(m.conectados).toEqual(["clickup"]);
    expect(m.mudancas).toEqual([["clickup", { url: null, falhou: null }], ["clickup", { url: "https://login.exemplo/x", falhou: null }], ["clickup", null]]);
  });

  it("GitHub com o gh desta máquina: conecta sem login e fecha a janela vazia", async () => {
    const m = montar({ verificacoes: [], conectadoDireto: true });
    await m.conexoes.iniciar("github");
    expect(m.janela?.closed).toBe(true);
    expect(m.conectados).toEqual(["github"]);
    expect(m.verificou()).toBe(0);
  });

  it("janela fechada sem conectar: desiste depois de duas perguntas e diz por quê", async () => {
    const m = montar({ verificacoes: [], janela: { closed: true, close() {}, location: { href: "" } } });
    await m.conexoes.iniciar("clickup");
    expect(m.conectados).toEqual([]);
    expect(m.mudancas.at(-1)).toEqual(["clickup", { url: "https://login.exemplo/x", falhou: FALHA_JANELA_FECHADA }]);
  });

  it("sem janela (desktop abre fora): segue perguntando até o prazo e então falha com a frase do prazo", async () => {
    const m = montar({ verificacoes: [], janela: null });
    await m.conexoes.iniciar("clickup");
    expect(m.verificou()).toBe(Math.floor(PRAZO_MS / INTERVALO_MS) + 1);
    expect(m.mudancas.at(-1)).toEqual(["clickup", { url: "https://login.exemplo/x", falhou: FALHA_PRAZO }]);
  });

  it("Cancelar para a espera na hora: nenhuma pergunta a mais e o card volta ao que era", async () => {
    const m = montar({ verificacoes: [] });
    const espera = m.conexoes.iniciar("clickup");
    m.conexoes.cancelar("clickup");
    await espera;
    expect(m.verificou()).toBe(0);
    expect(m.mudancas.at(-1)).toEqual(["clickup", null]);
    expect(m.conexoes.esperando("clickup")).toBe(false);
  });

  // revisão do PR #68: o `depois` (criar a rotina que esperava o app) vive na tentativa — cancelar ou falhar o descarta.
  it("o 'depois' roda quando ESTA tentativa conecta; cancelada ou falhada, some e a próxima conexão não o executa", async () => {
    const ok = montar({ verificacoes: [true] });
    const rodou: string[] = [];
    await ok.conexoes.iniciar("slack", () => void rodou.push("rotina"));
    expect(rodou).toEqual(["rotina"]);

    const m = montar({ verificacoes: [true] });
    const cancelada = m.conexoes.iniciar("slack", () => void rodou.push("velha"));
    m.conexoes.cancelar("slack");
    await cancelada;
    await m.conexoes.iniciar("slack");
    expect(rodou).toEqual(["rotina"]);
  });

  it("conta ativa mas o app não respondeu: para de perguntar na hora, com a frase certa", async () => {
    const m = montar({ verificacoes: ["falhou", true] });
    await m.conexoes.iniciar("clickup", () => { throw new Error("não devia rodar"); });
    expect(m.verificou()).toBe(1);
    expect(m.mudancas.at(-1)).toEqual(["clickup", { url: "https://login.exemplo/x", falhou: FALHA_APP }]);
    expect(m.janela?.closed).toBe(true);
  });

  it("erros seguidos do servidor: desiste depois do teto; erro no conectar fecha a janela e limpa o estado", async () => {
    const m = montar({ verificacoes: Array.from({ length: 10 }, () => "erro" as const) });
    await m.conexoes.iniciar("clickup");
    expect(m.verificou()).toBe(ERROS_SEGUIDOS_MAX);
    expect(m.mudancas.at(-1)).toEqual(["clickup", { url: "https://login.exemplo/x", falhou: FALHA_SERVIDOR }]);
    const f = montar({ verificacoes: [], conectarFalha: true });
    await expect(f.conexoes.iniciar("clickup")).rejects.toThrow("servidor");
    expect(f.janela?.closed).toBe(true);
    expect(f.mudancas.at(-1)).toEqual(["clickup", null]);
    expect(f.conexoes.esperando("clickup")).toBe(false);
  });
});
