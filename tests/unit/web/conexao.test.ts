import { describe, expect, it } from "vitest";
import type { ConexaoApp } from "../../../web/estado/reducer.ts";
import { criarConexoes, FALHA_JANELA_FECHADA, FALHA_PRAZO, INTERVALO_MS, PRAZO_MS, type DepsConexao, type JanelaLogin } from "../../../web/lib/conexao.ts";

/** Relógio falso: `esperar` avança o tempo na hora, sem timer de verdade. */
function montar(p: { verificacoes: boolean[]; url?: string; conectadoDireto?: boolean; janela?: JanelaLogin | null }) {
  let agora = 0;
  const mudancas: [string, ConexaoApp | null][] = [];
  const conectados: string[] = [];
  let verificou = 0;
  const janela: JanelaLogin | null = p.janela === undefined ? { closed: false, location: { href: "" }, close() { (this as { closed: boolean }).closed = true; } } : p.janela;
  const deps: DepsConexao = {
    conectar: async () => (p.conectadoDireto ? { conectado: true } : { url: p.url ?? "https://login.exemplo/x" }),
    verificar: async () => ({ conectado: p.verificacoes[verificou++] ?? false }),
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
});
