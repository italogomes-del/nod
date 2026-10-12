import { describe, expect, it } from "vitest";
import { decidirFecho, destinoDoLote, entradaDoRetorno, INSTRUCAO_DO_RETORNO, motivoDaFrente, respostaAoColega, textoFrentesTerminadas, textoPedidoRespondido, type FrenteNoFecho } from "../../../src/domain/retorno-do-lote.ts";

const frente = (id: string, extra: Partial<FrenteNoFecho> = {}): FrenteNoFecho => ({ id, titulo: `Frente ${id}`, estado: "terminado", resumo: { feito: `fiz ${id}` }, deFora: false, motivo: null, ...extra });

describe("retorno do lote (ADR-099, I3): a quem devolve", () => {
  it("pedido de colega (delegacao, ou o peer legado) é de colega; o resto é do dono", () => {
    expect(destinoDoLote({ origem: "delegacao" })).toBe("colega");
    expect(destinoDoLote({ origem: "peer" })).toBe("colega");
    for (const origem of ["conversa", "rotina", "retomada", "sala", "ligacao"] as const) expect(destinoDoLote({ origem })).toBe("dono");
    expect(destinoDoLote(null)).toBe("dono");
  });
});

describe("retorno do lote (ADR-099, I3): a decisão do fecho", () => {
  const base = { destino: "dono" as const, avisarACadaUma: false, devolvido: false, donoParado: false };

  it("lote do dono: espera a última; quando ela acaba, um retorno com todas e o lote fecha", () => {
    const tres = [frente("a"), frente("b", { estado: "rodando" }), frente("c", { estado: "na_fila" })];
    expect(decidirFecho({ ...base, frentes: tres, fechou: "a" })).toEqual({ acao: "nada" });
    const prontas = [frente("a"), frente("b", { estado: "falhou" }), frente("c", { estado: "parado" })];
    expect(decidirFecho({ ...base, frentes: prontas, fechou: "c" })).toEqual({ acao: "dono", frentes: prontas, fechaLote: true, cuidado: false, faltam: 0 });
  });

  it("lote do dono com avisar_a_cada_uma: um retorno por frente; só o último fecha o lote", () => {
    const tres = [frente("a"), frente("b", { estado: "rodando" }), frente("c", { estado: "rodando" })];
    expect(decidirFecho({ ...base, avisarACadaUma: true, frentes: tres, fechou: "a" })).toEqual({ acao: "dono", frentes: [tres[0]], fechaLote: false, cuidado: false, faltam: 2 });
    const ultima = [frente("a"), frente("b"), frente("c", { estado: "falhou", deFora: true })];
    expect(decidirFecho({ ...base, avisarACadaUma: true, frentes: ultima, fechou: "c" })).toEqual({ acao: "dono", frentes: [ultima[2]], fechaLote: true, cuidado: true, faltam: 0 });
  });

  it("a marca de fora: uma frente que leu de fora marca o retorno inteiro", () => {
    const prontas = [frente("a"), frente("b", { deFora: true })];
    expect(decidirFecho({ ...base, frentes: prontas, fechou: "a" })).toMatchObject({ acao: "dono", cuidado: true });
    expect(decidirFecho({ ...base, frentes: [frente("a"), frente("b")], fechou: "a" })).toMatchObject({ acao: "dono", cuidado: false });
  });

  it("lote de colega: só quando todas acabaram, e avisar_a_cada_uma não vale (a entrega é uma por pedido)", () => {
    const meio = [frente("a"), frente("b", { estado: "rodando" })];
    expect(decidirFecho({ ...base, destino: "colega", frentes: meio, fechou: "a" })).toEqual({ acao: "nada" });
    expect(decidirFecho({ ...base, destino: "colega", avisarACadaUma: true, frentes: meio, fechou: "a" })).toEqual({ acao: "nada" });
    const prontas = [frente("a"), frente("b", { deFora: true })];
    expect(decidirFecho({ ...base, destino: "colega", frentes: prontas, fechou: "b" })).toEqual({ acao: "colega", frentes: prontas });
  });

  it("lote já devolvido, frente que não acabou ou fora do lote: nada", () => {
    const prontas = [frente("a"), frente("b")];
    expect(decidirFecho({ ...base, devolvido: true, frentes: prontas, fechou: "a" })).toEqual({ acao: "nada" });
    expect(decidirFecho({ ...base, frentes: [frente("a", { estado: "rodando" })], fechou: "a" })).toEqual({ acao: "nada" });
    expect(decidirFecho({ ...base, frentes: prontas, fechou: "z" })).toEqual({ acao: "nada" });
  });

  it("o dono parado pela pessoa (Parar do chat): o lote fecha com uma linha, quando a última para, sem acordar", () => {
    const meio = [frente("a", { estado: "parado" }), frente("b", { estado: "rodando" })];
    expect(decidirFecho({ ...base, avisarACadaUma: true, donoParado: true, frentes: meio, fechou: "a" })).toEqual({ acao: "nada" });
    const paradas = [frente("a", { estado: "parado" }), frente("b", { estado: "parado" })];
    expect(decidirFecho({ ...base, donoParado: true, frentes: paradas, fechou: "b" })).toEqual({ acao: "so_linha", frentes: paradas });
  });
});

describe("retorno do lote (ADR-099, I3): os textos", () => {
  it("a entrada do retorno: a instrução de responder numa mensagem só e o JSON com estado, motivo e cuidado", () => {
    const frentes = [frente("a", { resumo: { feito: "Corrigi o login", pr: 301, sha: "3f8bd4d", branch: "frente/login" } }), frente("b", { estado: "falhou", motivo: "erro_execucao", resumo: { feito: "Falhou", falta: "rever" }, deFora: true })];
    const e = entradaDoRetorno({ frentes, faltam: 0, total: 2 });
    expect(e).toContain("As 2 frentes que você abriu para este pedido terminaram.");
    expect(e).toContain(INSTRUCAO_DO_RETORNO);
    expect(e).toContain("As marcadas com cuidado leram conteúdo de fora");
    const json = JSON.parse(e.split("\n")[1]!) as Record<string, unknown>[];
    expect(json[0]).toEqual({ titulo: "Frente a", estado: "terminado", feito: "Corrigi o login", pr: 301, sha: "3f8bd4d", branch: "frente/login" });
    expect(json[1]).toMatchObject({ titulo: "Frente b", estado: "falhou", feito: "Falhou", falta: "rever", cuidado: true });
    expect(typeof json[1]!.motivo).toBe("string");
    // Sem frente de fora, nada de cuidado.
    expect(entradaDoRetorno({ frentes: [frente("a")], faltam: 0, total: 1 })).not.toContain("cuidado");
    expect(entradaDoRetorno({ frentes: [frente("a")], faltam: 0, total: 1 })).toContain("A frente que você abriu para este pedido terminou.");
    expect(entradaDoRetorno({ frentes: [frente("a")], faltam: 2, total: 3 })).toContain('A frente "Frente a" deste pedido terminou; faltam 2.');
    expect(entradaDoRetorno({ frentes: [frente("a")], faltam: 0, total: 3 })).toContain("era a última");
  });

  it("o motivo legível: parada pela pessoa, a falha traduzida, nada para a que terminou", () => {
    expect(motivoDaFrente({ estado: "parado", motivo: "parado_pela_pessoa" })).toBe("parada pela pessoa");
    expect(motivoDaFrente({ estado: "falhou", motivo: null })).toBe("a frente falhou");
    expect(motivoDaFrente({ estado: "falhou", motivo: "maquina_sem_contato" })).not.toBe("maquina_sem_contato");
    expect(motivoDaFrente({ estado: "terminado", motivo: null })).toBeNull();
  });

  it("as linhas e a resposta ao colega", () => {
    expect(textoFrentesTerminadas([frente("a"), frente("b"), frente("c")])).toBe("3 frentes terminaram");
    expect(textoFrentesTerminadas([frente("a")])).toBe("A frente Frente a terminou");
    expect(textoFrentesTerminadas([frente("a", { estado: "parado" })])).toBe("A frente Frente a parou");
    expect(textoFrentesTerminadas([frente("a", { estado: "falhou" })])).toBe("A frente Frente a falhou");
    expect(textoPedidoRespondido("Ada")).toBe("Respondi ao pedido de Ada");
    expect(respostaAoColega([frente("a", { resumo: { feito: "Fiz.", pr: 7, branch: "frente/a", sha: "abcdef12345", falta: "deploy" } })])).toBe("Fiz. PR #7. Branch frente/a (abcdef1). Falta: deploy");
    expect(respostaAoColega([frente("a"), frente("b", { estado: "parado" })])).toBe("- Frente a: fiz a\n- Frente b: (não concluída: parada pela pessoa) fiz b");
  });
});
