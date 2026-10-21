import { describe, expect, it } from "vitest";
import type { Agente } from "../../../src/contracts/agente.ts";
import type { Concessao } from "../../../src/contracts/concessao.ts";
import type { Conector } from "../../../src/contracts/conector.ts";
import type { Turno } from "../../../src/contracts/turno.ts";
import { ErroDeDominio } from "../../../src/domain/erro.ts";
import { NATIVAS_DO_TERMINAL } from "../../../src/domain/nativas.ts";
import { FERRAMENTAS_NOD_POR_MODO, montarPlano, PLANO_SEM_VALIDADE, type EntradaPlano } from "../../../src/domain/plano-turno.ts";

const agora = 1_000_000;
const agente: Agente = { tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Vera", titulo: "", descricao: "revisa PRs", dono: "pessoa", forma: "shape-square", cor: "c-red", fixado: false, oculto: false, confirmado: true, modelo: "claude-haiku-4-5-20251001", duplicadoDe: null, criadoEm: 0 };
const turno: Turno = { executor: "catcher", tenantId: "t", id: "t1", conversaId: "c1", agenteId: "a1", ownerId: "p", origem: "conversa", estado: "despachando", sinais: { attempted: true, rejected: false, promptSubmitted: false, producedOutput: false }, machineId: null, leaseAte: null, prazoEm: agora + 86_400_000, motivoInterrupcao: null, motivoFalha: null, semNovidadeMotivo: null, retomaTurnoId: null, profundidade: 0, reenvios: 0, pararSolicitadoEm: null, entradaTexto: "oi", entradaAnexos: [], entradaConfianca: "confiavel", custoUsd: null, modelo: "claude-haiku-4-5-20251001", criadoEm: agora, mensagemOrigemId: "m0" };
const conector: Conector = { tenantId: "t", id: "k1", ownerId: "p", visibility: "privado", nome: "Exemplo", slug: "exemplo", transporte: "stdio", comando: "node", args: [], url: null, env: {}, declaracao: "nao-toca", habilitado: true, catalogo: [
  { nome: "listar_contatos", descricao: "lista", schema: { type: "object" }, readOnlyHint: true },
  { nome: "enviar_email", descricao: "envia", schema: { type: "object" }, readOnlyHint: false },
], sondadoEm: agora, ultimaFalha: null, criadoEm: 0 };
const concessoes: Concessao[] = [
  { tenantId: "t", id: "g1", ownerId: "p", agenteId: "a1", conectorId: "k1", capacidade: "listar_contatos", mensagemId: "m", criadoEm: 0 },
  { tenantId: "t", id: "g2", ownerId: "p", agenteId: "a1", conectorId: "k1", capacidade: "enviar_email", mensagemId: "m", criadoEm: 0 },
];
const base: EntradaPlano = { turno, agente, memorias: [], concessoes, conectores: [conector], modo: "conversa", confianca: "confiavel", profundidade: 0, inventario: { estado: "pronto", versao: "2.1.272", em: agora }, executor: "local", sessaoCli: null, pessoaNome: "Marlon", agora };
const nomes = (p: ReturnType<typeof montarPlano>) => p.catalogo.ferramentas.map((f) => f.nome);

describe("montarPlano", () => {
  it("conversa: ferramentas nod do modo + conector ∩ concessão como slug__tool com nomeMcp exato", () => {
    const p = montarPlano(base);
    for (const n of FERRAMENTAS_NOD_POR_MODO.conversa) expect(nomes(p)).toContain(n);
    expect(nomes(p)).toContain("exemplo__listar_contatos");
    expect(nomes(p)).toContain("exemplo__enviar_email");
    expect(p.catalogo.ferramentas.find((f) => f.nome === "exemplo__enviar_email")?.nomeMcp).toBe("mcp__nod__exemplo__enviar_email");
    expect(p.catalogo.servidores).toEqual([{ conectorId: "k1", nome: "exemplo", trust: "untrusted", transporte: "stdio" }]);
    expect(p.superficie).toBe("maquina_da_pessoa");
    expect(p.localidade).toBe("local");
    expect(p.autoria).toMatchObject({ autor_tipo: "agente", autor_id: "a1", conta_de_execucao: "p", locality_reason: "tudo_local_nesta_rodada", decidido_por: "regra:localidade" });
    expect(p.decididoPor).toBe("regra:montagem-ferramentas");
    expect(p.promptSistema).toContain("mcp__nod__exemplo__enviar_email");
  });

  it("sem concessão a ferramenta do conector não entra; conector desabilitado some inteiro", () => {
    const so = montarPlano({ ...base, concessoes: [concessoes[0]!] });
    expect(nomes(so)).toContain("exemplo__listar_contatos");
    expect(nomes(so)).not.toContain("exemplo__enviar_email");
    const off = montarPlano({ ...base, conectores: [{ ...conector, habilitado: false }] });
    expect(nomes(off).some((n) => n.startsWith("exemplo__"))).toBe(false);
    expect(off.catalogo.servidores).toEqual([]);
  });

  it("no limite (profundidade 3) corta o salto — sem pedir_a_bot nem encaminhar (E12.4) — e mantém o modo (ADR-058/062)", () => {
    const p = montarPlano({ ...base, modo: "sala", profundidade: 3 });
    expect(nomes(p)).not.toContain("pedir_a_bot");
    expect(nomes(p)).not.toContain("encaminhar");
    expect(nomes(p)).toContain("passar");
    expect(p.profundidade).toBe(3);
    expect(p.promptSistema).toContain("Modo de sala");
    expect(p.promptSistema).toContain("Limite da corrente:");
  });

  it("em profundidade 1 e 2 o salto fica (ADR-063): a continuação de quem pediu ainda pede a outro colega", () => {
    for (const profundidade of [1, 2] as const) {
      const p = montarPlano({ ...base, modo: "sala", profundidade });
      expect(nomes(p)).toEqual(expect.arrayContaining(["pedir_a_bot", "encaminhar", "passar"]));
      expect(p.profundidade).toBe(profundidade);
      expect(p.promptSistema).not.toContain("Limite da corrente:");
    }
  });

  it("ADR-066: entrada nao_confiavel não encolhe o catálogo — leitura E escrita do conector ficam, decididoPor é a regra de montagem; só a regra 'Sempre permitir' sai", () => {
    const p = montarPlano({ ...base, confianca: "nao_confiavel", semprePermitir: ["exemplo__enviar_email"] });
    expect(nomes(p)).toContain("exemplo__listar_contatos");
    expect(nomes(p)).toContain("exemplo__enviar_email");
    expect(nomes(p)).toContain("pedir_aprovacao");
    expect(nomes(p).sort()).toEqual(nomes(montarPlano(base)).sort());
    expect(p.confiancaEntrada).toBe("nao_confiavel");
    expect(p.decididoPor).toBe("regra:montagem-ferramentas");
    // O conteúdo de fora só pesa no manual, na hora de cada ação (aprovacao-permanente.ts): a regra da pessoa não vem.
    expect(p.semprePermitir).toEqual([]);
    expect(montarPlano({ ...base, semprePermitir: ["exemplo__enviar_email"] }).semprePermitir).toEqual(["exemplo__enviar_email"]);
  });

  it("modos: criacao é o kit da conversa mais atualizar_perfil; rotina permite ver e pedir a colega (ver_colegas desde a ADR-066), pedir acesso e silêncio; sala tem passar/encaminhar", () => {
    // ADR-050: bot novo é bot completo — perfil vazio não tira ferramenta nenhuma da conversa.
    const criacao = nomes(montarPlano({ ...base, modo: "criacao" })).filter((n) => !n.includes("__"));
    expect(criacao.filter((n) => n !== "atualizar_perfil").sort()).toEqual(nomes(montarPlano(base)).filter((n) => !n.includes("__")).sort());
    expect(criacao).toContain("atualizar_perfil");
    for (const n of ["ver_colegas", "pedir_a_bot", "pedir_a_pessoa"]) expect(criacao).toContain(n);
    expect(nomes(montarPlano(base))).not.toContain("atualizar_perfil");
    // ADR-044: pedir_acesso só propõe (a pessoa decide num botão); sem ele a rotina pedia acesso em texto a cada disparo.
    expect(nomes(montarPlano({ ...base, modo: "rotina" })).filter((n) => !n.includes("__") && n !== "ler_mais")).toEqual(["lembrar", "pedir_aprovacao", "pedir_acesso", "ver_colegas", "pedir_a_pessoa", "pedir_a_bot", "sem_novidade", "publicar_artefato", "ler_artefato", "abrir_frentes", "mandar_para_frente", "me_chame_as"]);
    // ADR-051: a rotina também publica e lê o artefato (a checklist do meio-dia atualiza a da manhã).
    // definido em 2026-09-28: com ferramenta de fora (conector) vem ler_mais, atendida pelo proxy; sem nenhuma, não.
    expect(nomes(montarPlano({ ...base, modo: "rotina" }))).toContain("ler_mais");
    expect(nomes(montarPlano({ ...base, modo: "rotina", conectores: [], concessoes: [] }))).not.toContain("ler_mais");
    const sala = nomes(montarPlano({ ...base, modo: "sala" }));
    expect(sala).toContain("passar");
    expect(sala).toContain("encaminhar");
    expect(sala).toContain("pedir_a_pessoa");
    // sem_novidade é só de rotina: em sala/conversa alguém está esperando resposta.
    expect(sala).not.toContain("sem_novidade");
  });

  it("ADR-051: artefato em conversa, criação, rotina e delegação (ADR-066: roda na conversa própria de quem recebe); fora de sala e peer; ler_artefato só lê", () => {
    // A criação tem o kit da conversa desde a ADR-050 (bot novo é bot completo), artefato incluído.
    for (const modo of ["conversa", "criacao", "rotina", "delegacao"] as const) {
      expect(nomes(montarPlano({ ...base, modo })), modo).toEqual(expect.arrayContaining(["publicar_artefato", "ler_artefato"]));
    }
    expect(nomes(montarPlano({ ...base, modo: "sala" }))).not.toContain("publicar_artefato");
    expect(nomes(montarPlano({ ...base, modo: "peer", profundidade: 1 }))).not.toContain("publicar_artefato");
    const plano = montarPlano({ ...base, modo: "conversa" });
    const ler = plano.catalogo.ferramentas.find((f) => f.nome === "ler_artefato");
    const publicar = plano.catalogo.ferramentas.find((f) => f.nome === "publicar_artefato");
    expect(ler).toMatchObject({ origem: "nod", readOnlyHint: true });
    expect(publicar).toMatchObject({ origem: "nod", readOnlyHint: false });
    // Turno não confiável: o catálogo não encolhe (ADR-066) — publicar continua.
    const deFora = montarPlano({ ...base, modo: "conversa", confianca: "nao_confiavel" });
    expect(nomes(deFora)).toEqual(expect.arrayContaining(["publicar_artefato", "ler_artefato"]));
    expect(plano.promptSistema).toContain("publicar_artefato");
    expect(plano.promptSistema).toContain("window.nod.salvar");
    expect(montarPlano({ ...base, modo: "sala" }).promptSistema).not.toContain("window.nod.salvar");
  });

  it("NOD-317: o \"A fazer\" saiu — nenhum modo tem ferramenta de pendência, nem o prompt fala dela", () => {
    for (const modo of Object.keys(FERRAMENTAS_NOD_POR_MODO) as (keyof typeof FERRAMENTAS_NOD_POR_MODO)[]) {
      expect(FERRAMENTAS_NOD_POR_MODO[modo].filter((n) => n.includes("pendencia")), modo).toEqual([]);
    }
    for (const modo of ["conversa", "criacao", "rotina", "sala", "delegacao", "ligacao"] as const) {
      const plano = montarPlano({ ...base, modo });
      expect(nomes(plano).filter((n) => n.includes("pendencia")), modo).toEqual([]);
      expect(plano.promptSistema, modo).not.toContain("anotar_pendencia");
      expect(plano.promptSistema, modo).not.toContain("Suas pendências abertas");
    }
  });

  it("NOD-183 (ADR-080): o plano leva as duas partes do prompt; juntadas com \"\\n\" dão o promptSistema, sem marcador", () => {
    for (const entrada of [base, { ...base, modo: "delegacao" as const, profundidade: 1 as const }]) {
      const p = montarPlano(entrada);
      const partes = p.promptSistemaPartes!;
      expect([partes.estavel, partes.volatil].filter((s) => s !== "").join("\n")).toBe(p.promptSistema);
      expect(p.promptSistema).not.toContain("__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__");
    }
  });

  it("agente acordado por rotina pede a colega com o catálogo inteiro, mesmo não confiável; quem recebe (delegacao) tem o catálogo dele e repassa até o limite (ADR-058/062/066)", () => {
    const rotina = montarPlano({ ...base, modo: "rotina", turno: { ...turno, origem: "rotina" }, confianca: "nao_confiavel" });
    expect(nomes(rotina)).toContain("pedir_a_bot");
    // ADR-066: em 30/09 a Clarice não mandava Slack na rotina porque a escrita sumia calada do catálogo.
    expect(nomes(rotina)).toEqual(expect.arrayContaining(["exemplo__listar_contatos", "exemplo__enviar_email"]));
    expect(Object.keys(rotina.politicaExecucao).sort()).toEqual(["orcamentoResultadoChars", "prazoMs"]);
    const colega = montarPlano({ ...base, modo: "delegacao", turno: { ...turno, origem: "delegacao", profundidade: 1 }, profundidade: 1, confianca: "confiavel" });
    // O Chico, pedido pela Clarice a acionar os Devs, não tinha como (2026-09-30): agora quem recebe também pede.
    expect(nomes(colega)).toContain("pedir_a_bot");
    expect(nomes(colega)).toEqual(expect.arrayContaining(["exemplo__listar_contatos", "exemplo__enviar_email"]));
    // ADR-066: sem trava herdada da rotina de quem pediu — quem decide a escrita é o modo de quem recebe.
    expect(Object.keys(colega.politicaExecucao).sort()).toEqual(["orcamentoResultadoChars", "prazoMs"]);
    const noLimite = montarPlano({ ...base, modo: "delegacao", turno: { ...turno, origem: "delegacao", profundidade: 3 }, profundidade: 3, confianca: "confiavel" });
    expect(nomes(noLimite)).not.toContain("pedir_a_bot");
    expect(nomes(noLimite)).toContain("exemplo__enviar_email");
  });

  it("ADR-066: a rotina não tem gate — política só de prazo e orçamento, como a conversa, e o catálogo inteiro, com escrita e terminal", () => {
    const rot = montarPlano({ ...base, turno: { ...turno, origem: "rotina" }, modo: "rotina", terminal: true });
    expect(rot.politicaExecucao).toEqual({ prazoMs: 86_400_000, orcamentoResultadoChars: expect.any(Number) });
    expect(rot.politicaExecucao).toEqual(montarPlano(base).politicaExecucao);
    expect(nomes(rot)).toContain("exemplo__enviar_email");
    expect(rot.nativas).toEqual(NATIVAS_DO_TERMINAL);
    expect(rot.promptSistema).not.toContain("Terminal: este turno não tem terminal");
    // O mesmo vale para a conversa e para a rotina não confiável: a origem não muda o catálogo.
    expect(montarPlano({ ...base, terminal: true }).nativas).toEqual(NATIVAS_DO_TERMINAL);
    expect(montarPlano({ ...base, turno: { ...turno, origem: "rotina" }, modo: "rotina", confianca: "nao_confiavel", terminal: true }).nativas).toEqual(NATIVAS_DO_TERMINAL);
  });

  it("ADR-066: a retomada de uma rotina, mesmo não confiável, segue no modo rotina sem gate e com a escrita; o ciclo de vida de rotina continua fora", () => {
    const retomada = montarPlano({ ...base, turno: { ...turno, origem: "retomada", retomaTurnoId: "t0" }, modo: "rotina", confianca: "nao_confiavel" });
    expect(Object.keys(retomada.politicaExecucao).sort()).toEqual(["orcamentoResultadoChars", "prazoMs"]);
    expect(nomes(retomada)).toContain("exemplo__enviar_email");
    expect(nomes(retomada)).not.toContain("pausar_rotina");
    expect(retomada.promptSistema).toContain("Você foi acordado por um agendamento");
    // Retomada de conversa: a mesma política.
    expect(montarPlano({ ...base, turno: { ...turno, origem: "retomada" } }).politicaExecucao).toEqual(retomada.politicaExecucao);
  });

  it("inventário não pronto → executor_indisponivel (nunca promove em silêncio)", () => {
    expect(() => montarPlano({ ...base, inventario: { estado: "ausente", motivo: "claude ausente", em: agora } })).toThrow(ErroDeDominio);
    try {
      montarPlano({ ...base, inventario: { estado: "nao_autenticado", motivo: "sem login", em: agora } });
    } catch (e) {
      expect((e as ErroDeDominio).codigo).toBe("executor_indisponivel");
    }
  });

  it("entrada e prazo vêm do turno/relógio; o plano vale enquanto o turno vive (ADR-067); sessaoCli passa para --resume; sem cwd (EMENDA 11)", () => {
    const p = montarPlano({ ...base, sessaoCli: "sess-1" });
    expect(p.entrada).toEqual({ texto: "oi", sessaoCli: "sess-1", modelo: "claude-haiku-4-5-20251001" });
    expect(p.politicaExecucao.prazoMs).toBe(86_400_000);
    expect(p.expiraEm).toBe(PLANO_SEM_VALIDADE);
    expect("cwd" in p.politicaExecucao).toBe(false);
  });
});

describe("catálogo de workspace conforme haja projeto autorizado", () => {
  // definido em 2026-09-18: ver ferramentas que ainda não pode usar levava o agente a tentar,
  // falhar e virar tutorial de menu. Sem projeto, só consultar e propor.
  it("sem projeto autorizado oferece apenas consultar e propor", () => {
    const p = montarPlano({ ...base, workspace: true, workspaceVinculado: false });
    const doWorkspace = p.catalogo.ferramentas.filter((f) => f.origem === "workspace").map((f) => f.nome);
    expect(doWorkspace.sort()).toEqual(["workspace_consultar", "workspace_propor_pasta"]);
    expect(doWorkspace).not.toContain("workspace_gravar_texto");
    expect(doWorkspace).not.toContain("workspace_terminal");
  });
  it("com projeto autorizado oferece o catálogo completo", () => {
    const p = montarPlano({ ...base, workspace: true, workspaceVinculado: true });
    const doWorkspace = p.catalogo.ferramentas.filter((f) => f.origem === "workspace").map((f) => f.nome);
    expect(doWorkspace).toContain("workspace_gravar_texto");
    expect(doWorkspace).toContain("workspace_terminal");
    expect(doWorkspace).toContain("workspace_trocar_projeto");
  });
  it("sem o serviço de workspace não oferece nenhuma", () => {
    expect(montarPlano({ ...base, workspace: false, workspaceVinculado: true }).catalogo.ferramentas.filter((f) => f.origem === "workspace")).toHaveLength(0);
  });
  it("ADR-066: em todo modo menos o peer legado — sala, rotina e pedido de colega também trabalham na pasta", () => {
    for (const modo of ["sala", "rotina", "delegacao"] as const) {
      const p = montarPlano({ ...base, modo, workspace: true, workspaceVinculado: true });
      expect(p.catalogo.ferramentas.some((f) => f.nome === "workspace_terminal"), modo).toBe(true);
      // Sem projeto autorizado, a mesma regra de sempre: só consultar e propor.
      expect(montarPlano({ ...base, modo, workspace: true, workspaceVinculado: false }).catalogo.ferramentas.filter((f) => f.origem === "workspace").map((f) => f.nome).sort(), modo).toEqual(["workspace_consultar", "workspace_propor_pasta"]);
    }
    expect(montarPlano({ ...base, modo: "peer", profundidade: 1, workspace: true, workspaceVinculado: true }).catalogo.ferramentas.filter((f) => f.origem === "workspace")).toHaveLength(0);
  });
  it("a criação é conversa própria: bot novo também trabalha na pasta (ADR-050)", () => {
    expect(montarPlano({ ...base, modo: "criacao", workspace: true, workspaceVinculado: true }).catalogo.ferramentas.some((f) => f.nome === "workspace_terminal")).toBe(true);
  });
});

describe("montarPlano: o modo de aprovação (ADR-059)", () => {
  it("leva o modo do agente e diz ao modelo que ele aprova as próprias ações", () => {
    expect(montarPlano(base).modoAprovacao).toBe("manual");
    expect(montarPlano(base).promptSistema).not.toContain("Aprovações:");
    const auto = montarPlano({ ...base, agente: { ...agente, modoAprovacao: "automatico" } });
    expect(auto.modoAprovacao).toBe("automatico");
    expect(auto.promptSistema).toContain("Aprovações: este bot está em Aprovar automaticamente");
    const total = montarPlano({ ...base, agente: { ...agente, modoAprovacao: "total" } });
    expect(total.promptSistema).toContain("Aprovações: este bot está em Ignorar todas as aprovações");
  });

  it("ADR-066: nem trava herdada nem gate da própria rotina — em todo modo a política é só prazo e orçamento, e quem decide é o modo do agente, que vai no plano", () => {
    for (const modo of ["conversa", "criacao", "sala", "rotina", "delegacao"] as const) {
      const p = montarPlano({ ...base, modo, profundidade: modo === "delegacao" ? 1 : 0, agente: { ...agente, modoAprovacao: "automatico" }, delegacao: modo === "delegacao" ? { pessoaNome: "Marlon", remetenteNome: "Clarice" } : null });
      expect(Object.keys(p.politicaExecucao).sort(), modo).toEqual(["orcamentoResultadoChars", "prazoMs"]);
      expect(p.modoAprovacao, modo).toBe("automatico");
      expect(p.modoTurno, modo).toBe(modo);
    }
    // O automático não para mais depois de conteúdo de fora, e o prompt diz isso.
    const deFora = montarPlano({ ...base, confianca: "nao_confiavel", agente: { ...agente, modoAprovacao: "automatico" } });
    expect(deFora.promptSistema).toContain("Ler a web, um e-mail ou um PR não muda isso.");
  });
});

describe("montarPlano: o onboarding por ligação (ADR-077)", () => {
  it("as três ferramentas do onboarding só entram na ligação com `onboarding`; nunca em outro modo", () => {
    const ligacao = nomes(montarPlano({ ...base, modo: "ligacao" }));
    for (const n of ["anotar_entrevista", "concluir_entrevista", "propor_bot"]) expect(ligacao).not.toContain(n);
    const onboarding = nomes(montarPlano({ ...base, modo: "ligacao", onboarding: true }));
    for (const n of ["anotar_entrevista", "concluir_entrevista", "propor_bot", "pedir_acesso", "criar_rotina", "desligar"]) expect(onboarding).toContain(n);
    const conversa = nomes(montarPlano({ ...base, modo: "conversa", onboarding: true }));
    for (const n of ["anotar_entrevista", "concluir_entrevista", "propor_bot"]) expect(conversa).not.toContain(n);
  });

  it("ADR-086: me_chame_as entra onde o bot trabalha com tempo (não na sala nem na ligação), com a linha do prompt contra o laço de sleep", () => {
    const conversa = montarPlano(base);
    expect(nomes(conversa)).toContain("me_chame_as");
    expect(conversa.promptSistema).toContain("não fique num laço com sleep");
    for (const modo of ["criacao", "rotina", "delegacao"] as const) expect(nomes(montarPlano({ ...base, modo }))).toContain("me_chame_as");
    for (const modo of ["sala", "ligacao", "peer"] as const) {
      const p = montarPlano({ ...base, modo });
      expect(nomes(p)).not.toContain("me_chame_as");
      expect(p.promptSistema).not.toContain("me_chame_as");
    }
  });

  it("ADR-099 (parte 2): esperar_comando entra só com terminal, nos modos do me_chame_as; o prompt deixa me_chame_as para hora marcada", () => {
    const semTerminal = montarPlano(base);
    expect(nomes(semTerminal)).not.toContain("esperar_comando");
    expect(semTerminal.promptSistema).not.toContain("esperar_comando");
    const conversa = montarPlano({ ...base, terminal: true });
    expect(nomes(conversa)).toContain("esperar_comando");
    expect(conversa.promptSistema).toContain("Chame esperar_comando com um comando que só termina quando a espera acabar");
    expect(conversa.promptSistema).toContain("me_chame_as é só para hora marcada");
    expect(conversa.promptSistema).not.toContain("testes, build, CI, QA");
    for (const modo of ["criacao", "rotina", "delegacao"] as const) expect(nomes(montarPlano({ ...base, modo, terminal: true }))).toContain("esperar_comando");
    for (const modo of ["sala", "ligacao", "peer"] as const) expect(nomes(montarPlano({ ...base, modo, terminal: true }))).not.toContain("esperar_comando");
  });
});
