import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import { FERRAMENTAS_NOD } from "../../../src/contracts/ferramentas-nod.ts";
import type { Turno } from "../../../src/contracts/turno.ts";
import { CORTE_DA_ULTIMA_FALA, ehFrente, entradaDaFrente, instrucaoDoResumoInvalido, molduraDaFrente, resumoSemChamada, textoFrentesAbertas } from "../../../src/domain/frente.ts";
import { montarPlano, type EntradaPlano } from "../../../src/domain/plano-turno.ts";
import { partesDoPromptSistema, secaoDaLinha } from "../../../src/domain/prompt-sistema.ts";
import { validarResumo, type ErroResumo } from "../../../src/domain/resumo-da-frente.ts";

const agora = 1_000_000;
const agente: Agente = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Vera", titulo: "", descricao: "revisa PRs", dono: "pessoa", forma: "shape-square", cor: "c-red", fixado: false, oculto: false, confirmado: true, modelo: "claude-haiku-4-5-20251001", duplicadoDe: null, criadoEm: 0 };
const turno: Turno = { executor: "catcher", tenantId: "t", id: "t1", conversaId: "c1", agenteId: "a1", ownerId: "p", origem: "conversa", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: agora + 86_400_000, motivoInterrupcao: null, motivoFalha: null, semNovidadeMotivo: null, retomaTurnoId: null, profundidade: 0, reenvios: 0, pararSolicitadoEm: null, entradaTexto: "oi", entradaAnexos: [], entradaConfianca: "confiavel", custoUsd: null, modelo: "claude-haiku-4-5-20251001", criadoEm: agora, mensagemOrigemId: "m0" };
const base: EntradaPlano = { turno, agente, memorias: [], concessoes: [], conectores: [], modo: "conversa", confianca: "confiavel", profundidade: 0, inventario: { estado: "pronto", versao: "2.1.272", em: agora }, executor: "local", sessaoCli: null, pessoaNome: "Marlon", agora, aFazer: true };
const nomes = (p: ReturnType<typeof montarPlano>) => p.catalogo.ferramentas.map((f) => f.nome);

describe("catálogo por forma (ADR-099, I2)", () => {
  it("o dono (conversa sem trabalho) tem abrir_frentes e mandar_para_frente; não tem devolver_resumo nem os sinônimos", () => {
    const n = nomes(montarPlano(base));
    expect(n).toEqual(expect.arrayContaining(["abrir_frentes", "mandar_para_frente", "me_chame_as"]));
    for (const fora of ["devolver_resumo", "abrir_task", "mandar_para_task"]) expect(n).not.toContain(fora);
  });

  it("a frente ganha devolver_resumo e perde me_chame_as, esperar_comando, abrir_frentes e mandar_para_frente", () => {
    const n = nomes(montarPlano({ ...base, trabalho: { titulo: "Login", origem: "pessoa", trabalhoMaeId: null, forma: "frente" } }));
    expect(n).toContain("devolver_resumo");
    for (const fora of ["me_chame_as", "esperar_comando", "abrir_frentes", "mandar_para_frente", "abrir_task"]) expect(n).not.toContain(fora);
    // A frente ainda pergunta à pessoa na hora (decisão 6).
    expect(n).toContain("pedir_a_pessoa");
  });

  it("a task de antes (forma task) segue como era: sem devolver_resumo, com me_chame_as; a rotina-mãe abre frentes", () => {
    const task = nomes(montarPlano({ ...base, trabalho: { titulo: "Login", origem: "pessoa", trabalhoMaeId: null, forma: "task" } }));
    expect(task).toContain("me_chame_as");
    expect(task).not.toContain("devolver_resumo");
    expect(task).not.toContain("abrir_frentes");
    const mae = nomes(montarPlano({ ...base, modo: "rotina", trabalho: { titulo: "Triagem", origem: "rotina", trabalhoMaeId: null, forma: "task" } }));
    expect(mae).toContain("abrir_frentes");
    expect(mae).not.toContain("mandar_para_frente");
    const filha = nomes(montarPlano({ ...base, modo: "rotina", trabalho: { titulo: "Chamado", origem: "rotina", trabalhoMaeId: "mae", forma: "frente" } }));
    expect(filha).toContain("devolver_resumo");
    expect(filha).not.toContain("abrir_frentes");
    expect(filha).not.toContain("me_chame_as");
  });

  it("o prompt da frente diz o que ela é, que devolve fatos com devolver_resumo e que não espera nada de fora", () => {
    const plano = montarPlano({ ...base, trabalho: { titulo: "Login no Safari", origem: "pessoa", trabalhoMaeId: null, forma: "frente" } });
    const { estavel, volatil } = plano.promptSistemaPartes!;
    expect(estavel).toContain("Frente: você é uma frente do dono");
    expect(estavel).toContain("devolver_resumo");
    expect(estavel).toContain("Não espere nada de fora");
    expect(estavel).not.toContain("me_chame_as com em quantos minutos");
    expect(volatil).toContain('Frente atual: você está na frente "Login no Safari"');
    expect(volatil).not.toContain("Task atual:");
    expect(secaoDaLinha("Frente: x")).toBe("ferramentas");
    expect(secaoDaLinha("Frentes: x")).toBe("ferramentas");
    expect(secaoDaLinha("Frente atual: x")).toBe("contexto");
  });

  it("o schema das ferramentas: um lote pede ao menos uma frente; o resumo pede só `feito`", () => {
    expect(FERRAMENTAS_NOD.abrir_frentes.required).toEqual(["frentes"]);
    expect(FERRAMENTAS_NOD.abrir_frentes.properties.frentes.minItems).toBe(1);
    expect(FERRAMENTAS_NOD.devolver_resumo.required).toEqual(["feito"]);
    expect(FERRAMENTAS_NOD.mandar_para_frente.required).toEqual(["trabalho_id", "texto"]);
    // A parte estável do prompt do dono cita as ferramentas novas, não as antigas.
    const { estavel } = partesDoPromptSistema({ agente, ferramentas: montarPlano(base).catalogo.ferramentas, pessoaNome: "Marlon", modo: "conversa", memorias: [] });
    expect(estavel.join("\n")).toContain("abrir_frentes uma vez por pedido");
    expect(estavel.join("\n")).not.toContain("abrir_task");
  });
});

describe("regras puras das frentes (ADR-099, I2)", () => {
  it("ehFrente só para forma frente", () => {
    expect(ehFrente({ forma: "frente" })).toBe(true);
    expect(ehFrente({ forma: "task" })).toBe(false);
    expect(ehFrente({})).toBe(false);
    expect(ehFrente(null)).toBe(false);
  });

  it("a linha do lote: uma frente pelo nome, várias pela contagem e a lista", () => {
    expect(textoFrentesAbertas(["Login"])).toBe("Começou a frente Login");
    expect(textoFrentesAbertas(["Login", "CI"])).toBe("Começou 2 frentes: Login e CI");
    expect(textoFrentesAbertas(["A", "B", "C"])).toBe("Começou 3 frentes: A, B e C");
  });

  it("a entrada da frente: a moldura, o pedido e, se houver, o repositório e o branch de partida", () => {
    expect(entradaDaFrente({ titulo: "Login", pedido: " Conserte o login. ", deRotina: false })).toBe(`${molduraDaFrente("Login", false)}Conserte o login.`);
    expect(entradaDaFrente({ titulo: "Login", pedido: "x", deRotina: false, repo: "gamefik/nod" })).toContain("Repositório: gamefik/nod. Parta de origin/main.");
    expect(entradaDaFrente({ titulo: "Login", pedido: "x", deRotina: false, repo: "gamefik/nod", branchBase: "feat/a" })).toContain("Parta de feat/a.");
    expect(entradaDaFrente({ titulo: "Login", pedido: "x", deRotina: true, branchBase: "feat/a" })).toBe(`${molduraDaFrente("Login", true)}x\n\nParta do branch feat/a.`);
    expect(molduraDaFrente("Login", false)).toContain("devolver_resumo");
  });

  it("o resumo sem chamada passa na validação, corta a última fala e diz o estado", () => {
    const longa = "palavra ".repeat(400);
    for (const estado of ["terminado", "falhou", "parado"] as const) {
      for (const ultimaFala of [null, "", "Corrigi o login.", longa]) {
        const r = resumoSemChamada({ estado, ultimaFala });
        expect(validarResumo(r)).toEqual({ ok: true, resumo: r });
      }
    }
    expect(resumoSemChamada({ estado: "terminado", ultimaFala: "Corrigi o login." })).toEqual({ feito: "Corrigi o login." });
    expect(resumoSemChamada({ estado: "terminado", ultimaFala: null }).feito).toBe("A frente terminou sem dizer o que fez.");
    expect(resumoSemChamada({ estado: "falhou", ultimaFala: "Rodando os testes" })).toMatchObject({ feito: "A frente falhou antes de devolver o resumo. Última fala: Rodando os testes", falta: expect.any(String) });
    expect(resumoSemChamada({ estado: "parado", ultimaFala: null }).feito).toBe("A pessoa parou a frente antes do fim.");
    expect(resumoSemChamada({ estado: "terminado", ultimaFala: longa }).feito.length).toBe(CORTE_DA_ULTIMA_FALA);
  });

  it("toda recusa do resumo vira instrução com o campo", () => {
    const erros: ErroResumo[] = ["nao_e_objeto", "campo_desconhecido", "feito_vazio", "texto_invalido", "texto_longo", "pr_invalido", "sha_invalido", "resumo_grande"];
    for (const e of erros) expect(instrucaoDoResumoInvalido(e, "sha")).toMatch(/^O resumo não foi guardado \(sha\): .+ Chame devolver_resumo de novo\.$/);
  });
});
