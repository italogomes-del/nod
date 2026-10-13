import { describe, expect, it } from "vitest";
import {
  contaDoTurno,
  decidirAnuncio,
  decidirLimiteDaConta,
  fraseDoLimiteDaConta,
  ordemIasDaLista,
  textoDaImpressaoDaConta,
  type ContaDaPessoa,
} from "../../../src/domain/contas-da-pessoa.ts";

const AGORA = 1_760_000_000_000;
const HORA = 3_600_000;
const conta = (id: string, ia: ContaDaPessoa["ia"], posicao: number, extra: Partial<ContaDaPessoa> = {}): ContaDaPessoa => ({
  id, ia, apelido: id, plano: "Max", corporativa: false, posicao, entraNaTrocaAutomatica: false, noLimiteAte: null, removidaEm: null, ...extra,
});
/** O exemplo do Marlon (13/10): Claude · Pessoal, ChatGPT · Pessoal, Claude · Leapy (Team), Claude · Pessoal Leapy. */
const lista = (extra: Record<string, Partial<ContaDaPessoa>> = {}): ContaDaPessoa[] => [
  conta("c-pessoal", "claude-cli", 1, extra["c-pessoal"]),
  conta("g-pessoal", "codex-cli", 2, extra["g-pessoal"]),
  conta("c-leapy", "claude-cli", 3, { corporativa: true, plano: "Team", ...extra["c-leapy"] }),
  conta("c-pessoal-leapy", "claude-cli", 4, extra["c-pessoal-leapy"]),
];
const todas = new Set(["c-pessoal", "g-pessoal", "c-leapy", "c-pessoal-leapy"]);
const turno = (contas: ContaDaPessoa[], extra: Partial<Parameters<typeof contaDoTurno>[0]> = {}) =>
  contaDoTurno({ contas, naMaquina: todas, modo: "perguntar", escolhidas: {}, ordemDoBot: null, agora: AGORA, ...extra });

describe("textoDaImpressaoDaConta", () => {
  it("a mesma conta dá o mesmo texto com e-mail em outra caixa; outra pessoa ou outra organização mudam o texto", () => {
    const base = { pessoaId: "p1", ia: "claude-cli" as const, email: "Marlon@Leapy.com.br ", orgId: "org-1" };
    expect(textoDaImpressaoDaConta(base)).toBe(textoDaImpressaoDaConta({ ...base, email: "marlon@leapy.com.br" }));
    expect(textoDaImpressaoDaConta(base)).not.toBe(textoDaImpressaoDaConta({ ...base, pessoaId: "p2" }));
    expect(textoDaImpressaoDaConta(base)).not.toBe(textoDaImpressaoDaConta({ ...base, orgId: "org-2" }));
    expect(textoDaImpressaoDaConta(base)).not.toBe(textoDaImpressaoDaConta({ ...base, ia: "codex-cli" }));
  });
});

describe("contaDoTurno", () => {
  it("máquina sem conta anunciada: null (segue como hoje)", () => {
    expect(turno(lista(), { naMaquina: new Set() })).toBeNull();
  });

  it("a lista intercalada decide: a 1ª conta responde e a ordem das IAs segue a posição da conta em uso", () => {
    const r = turno(lista())!;
    expect(r.porIa["claude-cli"]?.id).toBe("c-pessoal");
    expect(r.porIa["codex-cli"]?.id).toBe("g-pessoal");
    expect(r.ordemIas).toEqual(["claude-cli", "codex-cli"]);
    expect(r.iasSemConta).toEqual([]);
  });

  it("a 1ª do Claude no limite com 'Perguntar antes': o Claude fica sem conta e o ChatGPT assume (troca de provedor é automática)", () => {
    const r = turno(lista({ "c-pessoal": { noLimiteAte: AGORA + HORA } }))!;
    expect(r.porIa["claude-cli"]).toBeNull();
    expect(r.ordemIas).toEqual(["codex-cli"]);
    expect(r.iasSemConta).toEqual(["claude-cli"]);
  });

  it("a escolhida pela pessoa vale enquanto a 1ª da IA está no limite, e a 1ª volta sozinha quando renova", () => {
    const noLimite = lista({ "c-pessoal": { noLimiteAte: AGORA + HORA } });
    expect(turno(noLimite, { escolhidas: { "claude-cli": "c-pessoal-leapy" } })!.porIa["claude-cli"]?.id).toBe("c-pessoal-leapy");
    expect(turno(lista({ "c-pessoal": { noLimiteAte: AGORA - 1 } }), { escolhidas: { "claude-cli": "c-pessoal-leapy" } })!.porIa["claude-cli"]?.id).toBe("c-pessoal");
  });

  it("'Trocar sozinho' pula a corporativa não marcada e usa a próxima pessoal; marcada, usa a corporativa", () => {
    const noLimite = lista({ "c-pessoal": { noLimiteAte: AGORA + HORA } });
    expect(turno(noLimite, { modo: "automatico" })!.porIa["claude-cli"]?.id).toBe("c-pessoal-leapy");
    const marcada = lista({ "c-pessoal": { noLimiteAte: AGORA + HORA }, "c-leapy": { entraNaTrocaAutomatica: true } });
    expect(turno(marcada, { modo: "automatico" })!.porIa["claude-cli"]?.id).toBe("c-leapy");
  });

  it("só as contas logadas na máquina contam: a 1ª do Claude NESTA máquina é a preferida dela", () => {
    const r = turno(lista(), { naMaquina: new Set(["g-pessoal", "c-leapy"]) })!;
    expect(r.porIa["claude-cli"]?.id).toBe("c-leapy");
    expect(r.ordemIas).toEqual(["codex-cli", "claude-cli"]);
  });

  it("a ordem própria do bot manda entre as IAs; conta removida não entra", () => {
    expect(turno(lista(), { ordemDoBot: ["codex-cli", "claude-cli"] })!.ordemIas).toEqual(["codex-cli", "claude-cli"]);
    const semPessoal = lista({ "c-pessoal": { removidaEm: AGORA - HORA } });
    expect(turno(semPessoal)!.porIa["claude-cli"]?.id).toBe("c-leapy");
  });
});

describe("decidirLimiteDaConta", () => {
  const base = { naMaquina: todas, noutraMaquina: new Map(), modo: "perguntar" as const, escolhidas: {}, ordemDoBot: null, agora: AGORA };

  it("com outra IA em uso na máquina, troca de provedor sozinha (como o Automático de hoje)", () => {
    const r = decidirLimiteDaConta({ ...base, contas: lista(), contaId: "c-pessoal", ate: AGORA + 2 * HORA });
    expect(r.decisao).toMatchObject({ tipo: "outra_ia", para: { id: "g-pessoal" } });
    expect(r.contas.find((c) => c.id === "c-pessoal")?.noLimiteAte).toBe(AGORA + 2 * HORA);
  });

  it("'Trocar sozinho' troca para a próxima conta elegível do MESMO provedor antes de mudar de IA", () => {
    const r = decidirLimiteDaConta({ ...base, modo: "automatico", contas: lista(), contaId: "c-pessoal", ate: AGORA + HORA });
    expect(r.decisao).toMatchObject({ tipo: "trocou", para: { id: "c-pessoal-leapy" } });
  });

  it("sem outra IA e com 'Perguntar antes': pergunta com as livres, dizendo onde cada uma está", () => {
    const contas = lista({ "g-pessoal": { noLimiteAte: AGORA + HORA } });
    const r = decidirLimiteDaConta({ ...base, contas, naMaquina: new Set(["c-pessoal", "g-pessoal", "c-leapy"]), noutraMaquina: new Map([["c-pessoal-leapy", { id: "m-mac", nome: "MacBook" }]]), contaId: "c-pessoal", ate: AGORA + HORA });
    expect(r.decisao).toEqual({
      tipo: "perguntar",
      livres: [
        { id: "c-leapy", apelido: "c-leapy", ia: "claude-cli", naMaquina: true, outraMaquina: null },
        { id: "c-pessoal-leapy", apelido: "c-pessoal-leapy", ia: "claude-cli", naMaquina: false, outraMaquina: { id: "m-mac", nome: "MacBook" } },
      ],
    });
  });

  it("todas no limite: a volta mais cedo; sem horário do fornecedor, a conta fica 1 h", () => {
    const contas = lista({ "g-pessoal": { noLimiteAte: AGORA + 3 * HORA }, "c-leapy": { noLimiteAte: AGORA + 2 * HORA }, "c-pessoal-leapy": { noLimiteAte: AGORA + 5 * HORA } });
    const r = decidirLimiteDaConta({ ...base, contas, contaId: "c-pessoal", ate: null });
    expect(r.decisao).toEqual({ tipo: "todas_no_limite", voltaEm: AGORA + HORA });
  });

  it("a escolha antiga da IA não sobrevive ao limite: pergunta de novo", () => {
    const contas = lista({ "c-pessoal": { noLimiteAte: AGORA + HORA }, "g-pessoal": { noLimiteAte: AGORA + HORA } });
    const r = decidirLimiteDaConta({ ...base, contas, escolhidas: { "claude-cli": "c-pessoal-leapy" }, contaId: "c-pessoal-leapy", ate: AGORA + HORA });
    expect(r.decisao.tipo).toBe("perguntar");
  });
});

describe("ordemIasDaLista e decidirAnuncio", () => {
  it("a ordem das IAs é a da primeira aparição na lista, depois as que faltam", () => {
    const l = [conta("g", "codex-cli", 1), conta("c", "claude-cli", 2)];
    expect(ordemIasDaLista(l, ["claude-cli", "codex-cli", "cursor-cli"])).toEqual(["codex-cli", "claude-cli", "cursor-cli"]);
    expect(ordemIasDaLista([], ["claude-cli", "codex-cli"])).toEqual(["claude-cli", "codex-cli"]);
  });

  it("conta removida só volta com um login mais novo que a remoção (R4); senão a máquina sai dela", () => {
    expect(decidirAnuncio(null, AGORA)).toBe("criar");
    expect(decidirAnuncio({ removidaEm: null }, AGORA)).toBe("atualizar");
    expect(decidirAnuncio({ removidaEm: AGORA }, AGORA - HORA)).toBe("sair");
    expect(decidirAnuncio({ removidaEm: AGORA - HORA }, AGORA)).toBe("voltar");
  });
});

describe("fraseDoLimiteDaConta", () => {
  const p = { maquina: "vm-bots", quando: () => "14:00", quandoVolta: () => "às 14:00", voltaEm: AGORA + HORA };
  const de = { ia: "claude-cli" as const, apelido: "Pessoal" };
  it("cita a conta pelo apelido e a máquina", () => {
    expect(fraseDoLimiteDaConta(de, { tipo: "outra_ia", para: conta("Pessoal", "codex-cli", 2) }, p)).toBe("Claude · Pessoal no limite na vm-bots até 14:00. Seguindo com ChatGPT · Pessoal.");
    expect(fraseDoLimiteDaConta(de, { tipo: "perguntar", livres: [{ id: "x", apelido: "Leapy", ia: "claude-cli", naMaquina: true, outraMaquina: null }] }, p)).toBe("Claude · Pessoal no limite na vm-bots até 14:00. Seguir com Claude · Leapy?");
    expect(fraseDoLimiteDaConta(de, { tipo: "perguntar", livres: [{ id: "x", apelido: "Freela", ia: "claude-cli", naMaquina: false, outraMaquina: null }] }, p)).toBe("Claude · Pessoal no limite na vm-bots até 14:00. Claude · Freela está livre, mas não está na vm-bots.");
    expect(fraseDoLimiteDaConta(de, { tipo: "todas_no_limite", voltaEm: AGORA + HORA }, p)).toBe("Todas as suas contas estão no limite. A primeira volta às 14:00.");
  });
});
