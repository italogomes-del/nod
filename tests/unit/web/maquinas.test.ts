import { describe, expect, it } from "vitest";
import type { MaquinaDto } from "../../../src/contracts/maquina.ts";
import { estadoInicial, type ConectarMaquina, type Estado } from "../../../web/estado/reducer.ts";
import { maquinaDoBot, maquinaNova, renderMaquinas } from "../../../web/telas/maquinas.ts";

/** ADR-088: Seu espaço › Máquinas e o "Conectar uma máquina" (protótipo "Nod — Motor na VM"). */
const maquina = (id: string, nome: string, o: Partial<MaquinaDto> = {}): MaquinaDto => ({ id, nome, prefixo: "abcd1234", criadaEm: 1, ultimoUsoEm: null, conectada: true, plataforma: "linux", ias: { "claude-cli": "pronto" }, gh: false, ...o });
const bot = (id: string, nome: string, maquinaId: string | null = null) => ({ id, nome, titulo: "Dev", ownerId: "p", cor: "c-red", forma: "shape-square", conversaId: `c-${id}`, maquinaId, excluidoEm: null });
const conectar = (o: Partial<ConectarMaquina> = {}): ConectarMaquina => ({ passo: "comando", codigo: "", pedido: null, erro: null, chavesAntes: [], marcados: [], ...o });

function com(maquinas: MaquinaDto[], o: { padraoId?: string | null; conectar?: ConectarMaquina | null; bots?: ReturnType<typeof bot>[] } = {}): Estado {
  return { ...estadoInicial, sessao: { tenantId: "t", pessoaId: "p" }, maquinas: { maquinas, padraoId: o.padraoId ?? null }, conectarMaquina: o.conectar ?? null, frota: { agentes: o.bots ?? [bot("a", "Ze 1", "vm"), bot("b", "Clarice")] } as never };
}

describe("Seu espaço › Máquinas (ADR-088)", () => {
  it("lista as máquinas com o estado, as IAs e quem trabalha em cada uma; cada bot tem o seletor", () => {
    const html = renderMaquinas(com([maquina("vm", "vm-sp"), maquina("mac", "MacBook", { plataforma: "darwin" }), maquina("velha", "vm-velha", { conectada: false, plataforma: null, ultimoUsoEm: Date.UTC(2026, 9, 9, 14, 32) })]));
    expect(html).toContain("vm-sp");
    expect(html).toContain("Ze 1 trabalha aqui");
    expect(html).toMatch(/sem contato desde \d\d:\d\d/);
    expect(html).toContain("Claude Code pronto");
    expect(html).toContain('data-act="maquina-do-bot"');
    expect(html).toContain('data-act="maquina-padrao"');
    expect(html).toMatch(/aria-pressed="true" data-act="maquina-do-bot" data-maquina="vm"/);
  });

  it("sem máquinas, o vazio explica; carregando, diz que carrega", () => {
    expect(renderMaquinas(com([]))).toContain("Nenhuma máquina conectada ainda");
    expect(renderMaquinas({ ...com([]), maquinas: null })).toContain("Carregando");
  });

  it("a máquina do bot é a dele, senão o padrão da pessoa, senão nenhuma", () => {
    const e = com([maquina("vm", "vm-sp"), maquina("mac", "MacBook")], { padraoId: "mac" });
    expect(maquinaDoBot(e, { maquinaId: "vm" })?.id).toBe("vm");
    expect(maquinaDoBot(e, { maquinaId: null })?.id).toBe("mac");
    expect(maquinaDoBot(com([maquina("vm", "vm-sp")]), { maquinaId: "sumiu" })).toBeNull();
  });

  it("conectar: o comando com o endereço do Nod, o código, a confirmação com o código e a idade do pedido", () => {
    expect(renderMaquinas(com([], { conectar: conectar() }))).toContain("/motor | sh");
    expect(renderMaquinas(com([], { conectar: conectar({ passo: "codigo", erro: "Esse código não existe" }) }))).toContain('role="alert"');
    const confirmar = renderMaquinas(com([], { conectar: conectar({ passo: "confirmar", codigo: "k7qm-4f2x", pedido: { nome: "vm-sp", plataforma: "linux", pedidoHaS: 300 } }) }));
    expect(confirmar).toContain("código K7QM-4F2X");
    expect(confirmar).toContain("há 5 minutos");
    expect(confirmar).toContain('data-act="aprovar-maquina"');
  });

  it("depois de aprovar, o Continuar espera a máquina nova aparecer; a escolha dos bots conta os marcados", () => {
    const esperando = renderMaquinas(com([maquina("mac", "MacBook")], { conectar: conectar({ passo: "ias", chavesAntes: ["mac"] }) }));
    expect(esperando).toContain("esperando a máquina terminar de conectar");
    expect(esperando).toMatch(/data-act="passo-conectar-maquina" data-passo="bots" disabled/);
    const estado = com([maquina("mac", "MacBook"), maquina("vm", "vm-sp")], { conectar: conectar({ passo: "bots", chavesAntes: ["mac"], marcados: ["a"] }) });
    expect(maquinaNova(estado, estado.conectarMaquina!)?.id).toBe("vm");
    const bots = renderMaquinas(estado);
    expect(bots).toContain("1 de 2 bots");
    expect(bots).toContain("Mover 1 bot");
    expect(bots).toContain('aria-checked="true" data-act="marcar-bot-maquina" data-id="a"');
  });
});
