import { describe, expect, it } from "vitest";
import { resumoSemChamada, TEXTO_PERGUNTA_VENCIDA } from "../../../src/domain/frente.ts";
import { motivoDaFrente, respostaAoColega } from "../../../src/domain/retorno-do-lote.ts";
import { causaDaEntrega, classificarResultado, fimDoStderr, LINHAS_DO_STDERR } from "../../../src/domain/stream-json.ts";
import { estadoDoTrabalho, MOTIVO_PERGUNTA_VENCIDA, type FatosTrabalho } from "../../../src/domain/trabalho.ts";

/** NOD-264 (C20 e C21): a causa do `trabalho_incompleto` e a pergunta que venceu sem resposta. */

describe("C20: a causa do turno que acabou sem result", () => {
  it("o driver interrompeu, o sinal ou o exit viram a causa; exit 0 sem result não tem causa", () => {
    expect(classificarResultado({ eventos: [], exitCode: 143, signal: null, stderr: "", interrompidoPeloDriver: true }).causa).toBe("interrompido_pelo_driver");
    const sigterm = classificarResultado({ eventos: [], exitCode: null, signal: "SIGTERM", stderr: "boom" });
    expect(sigterm).toMatchObject({ desfecho: "interrompido", causa: "sinal:SIGTERM" });
    expect(classificarResultado({ eventos: [], exitCode: 137, signal: null, stderr: "" }).causa).toBe("exit:137");
    expect(classificarResultado({ eventos: [], exitCode: 0, signal: null, stderr: "" }).causa).toBeUndefined();
  });

  it("a entrega só aceita a causa com forma de código, curta", () => {
    expect(causaDaEntrega("renovacao_negada:sem_plano")).toBe("renovacao_negada:sem_plano");
    expect(causaDaEntrega("sinal:SIGTERM")).toBe("sinal:SIGTERM");
    expect(causaDaEntrega("reinicio_do_motor")).toBe("reinicio_do_motor");
    expect(causaDaEntrega("exit:-1")).toBe("exit:-1");
    expect(causaDaEntrega("Erro: token sk-abc vazou")).toBeNull();
    expect(causaDaEntrega("a:b:c")).toBeNull();
    expect(causaDaEntrega(`x:${"a".repeat(40)}`)).toBeNull();
    expect(causaDaEntrega(42)).toBeNull();
    expect(causaDaEntrega(undefined)).toBeNull();
  });

  it("o fim do stderr: as últimas 20 linhas não vazias, com os segredos redigidos antes do corte", () => {
    const linhas = Array.from({ length: 30 }, (_, i) => `linha ${i}`);
    const fim = fimDoStderr([...linhas, "", "Authorization: Bearer sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789"].join("\n"));
    expect(fim).not.toBeNull();
    const saida = fim!.split("\n");
    expect(saida).toHaveLength(LINHAS_DO_STDERR);
    expect(saida[0]).toBe("linha 11");
    expect(fim).not.toContain("sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789");
    expect(fimDoStderr("")).toBeNull();
    expect(fimDoStderr("\n  \n")).toBeNull();
  });
});

describe("C21: a pergunta à pessoa que venceu sem resposta", () => {
  const base: FatosTrabalho = { estadoAtual: "rodando", iniciado: true, parando: 0, despachando: 0, pendentes: 0, esperandoOutro: false, decisaoPendente: false, aguardandoColega: false, ultimo: { estado: "concluido", motivo: null } };

  it("o trabalho fica `falhou` (antes ficava `terminado` e o resumo era a pergunta)", () => {
    expect(estadoDoTrabalho({ ...base, perguntaVencida: true })).toBe("falhou");
    expect(estadoDoTrabalho({ ...base, perguntaVencida: true, aguardandoColega: true })).toBe("falhou");
    expect(estadoDoTrabalho(base)).toBe("terminado");
    // Uma pergunta nova aberta vence a vencida; o Parar vence as duas.
    expect(estadoDoTrabalho({ ...base, perguntaVencida: true, decisaoPendente: true })).toBe("precisa_de_voce");
    expect(estadoDoTrabalho({ ...base, estadoAtual: "parado", perguntaVencida: true })).toBe("parado");
    // Um turno novo rodando também vence.
    expect(estadoDoTrabalho({ ...base, perguntaVencida: true, despachando: 1 })).toBe("rodando");
  });

  it("o resumo e o retorno do lote levam o motivo, nunca a pergunta", () => {
    const pergunta = "Posso apagar a tabela de clientes?";
    const r = resumoSemChamada({ estado: "falhou", ultimaFala: pergunta, perguntaVencida: true });
    expect(r.feito).toContain(TEXTO_PERGUNTA_VENCIDA);
    expect(JSON.stringify(r)).not.toContain(pergunta);
    expect(resumoSemChamada({ estado: "falhou", ultimaFala: pergunta }).feito).toContain(pergunta);
    const frente = { id: "a", titulo: "Frente a", estado: "falhou" as const, motivo: MOTIVO_PERGUNTA_VENCIDA, quedas: 0, resumo: null };
    expect(motivoDaFrente(frente)).toBe(TEXTO_PERGUNTA_VENCIDA);
    expect(TEXTO_PERGUNTA_VENCIDA).toBe("a pergunta à pessoa venceu sem resposta");
    expect(respostaAoColega([frente as never])).toContain(TEXTO_PERGUNTA_VENCIDA);
  });
});
