import { describe, expect, it } from "vitest";
import type { PayloadPropostaPasta, Proposta } from "../../../src/contracts/conversa.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { mudouQuando } from "../../../web/lib/relogio.ts";
import { ondeLegivel } from "../../../web/telas/card-pasta.ts";
import { renderMensagem, renderTimeline } from "../../../web/telas/conversa.ts";

/**
 * Card de pasta simplificado (definido em 2026-09-25, mockup "Pasta do projeto" no canvas do nod). Antes:
 * oito caminhos absolutos, cada um com o seu "Permitir", e "Escolher outraAgora não" colados. Agora: a
 * sugerida com um botão só, a lista atrás de "Não é essa" e um registro que fica depois de permitir.
 */
const AGORA = Date.parse("2026-09-25T15:00:00Z");
const DIA = 86_400_000;
const HOME = "/Users/marlon";

const candidatas: PayloadPropostaPasta["candidatas"] = [
  { caminho: `${HOME}/code/leapy/main-repos/leapy`, nome: "leapy", git: true, onde: "code/leapy/main-repos", modificadoEm: AGORA - 2 * 3_600_000 },
  { caminho: `${HOME}/Inhouse/leapy`, nome: "leapy", git: true, onde: "Inhouse", modificadoEm: AGORA - 2 * DIA },
  { caminho: `${HOME}/conductor/workspaces/leapy`, nome: "leapy", git: true, onde: "conductor/workspaces", modificadoEm: AGORA - 21 * DIA },
  { caminho: `${HOME}/code/leapy`, nome: "leapy", git: false, onde: "code", modificadoEm: AGORA - 40 * DIA },
  { caminho: `${HOME}/conductor/archived-contexts/leapy`, nome: "leapy", git: true, onde: "conductor/archived-contexts", modificadoEm: AGORA - 130 * DIA },
];

function proposta(c: PayloadPropostaPasta["candidatas"], id = "pp"): Proposta {
  return { tenantId: "t", id, conversaId: "c", agenteId: "a", kind: "pasta", estado: "pendente", criadoEm: AGORA, payload: { kind: "pasta", turnoId: "t1", candidatas: c, motivo: "Para montar a árvore de arquivos do PR #466", buscaTermo: "leapy" } } as Proposta;
}
function conversa(p: Proposta[], mensagens: Mensagem[] = []): ConversaEstado {
  return { conversa: { tenantId: "t", id: "c", ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 0 }, mensagens, propostas: p, turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], fios: [], atividades: {}, carregadaEm: 0 };
}
const estado: Estado = { ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" }, frota: { agentes: [{ id: "a", nome: "Dev 1", ownerId: "p", conversaId: "c" }] } as never };
const quantas = (html: string, trecho: string) => html.split(trecho).length - 1;

describe("card de pasta", () => {
  it("sugere uma pasta só, pelo nome e pelo local, com um botão de permitir", () => {
    const html = renderTimeline(conversa([proposta(candidatas)]), estado);
    expect(html).toContain("Abrir o projeto leapy?");
    expect(html).toContain("Para montar a árvore de arquivos do PR #466");
    expect(html).toContain("code › leapy › main-repos");
    expect(html).toContain("mudou hoje");
    expect(quantas(html, 'data-act="permitir-pasta"')).toBe(1);
    expect(html).toContain(`data-pasta="${HOME}/code/leapy/main-repos/leapy"`);
    expect(html).toContain('data-act="lista-de-pasta"');
    expect(html).toContain("Dev 1 só mexe nas pastas que você abrir.");
    // Nenhuma das outras aparece antes de a pessoa dizer que não é essa.
    expect(html).not.toContain("Inhouse");
    expect(html).not.toContain("Permitir<");
  });

  it("\"Não é essa\" abre as mais prováveis, com a sugerida marcada, e o resto sob demanda", () => {
    const curta = reduzir(estado, { tipo: "lista-de-pasta", propostaId: "pp", lista: "curta" });
    const html = renderTimeline(conversa([proposta(candidatas)]), curta);
    expect(html).toContain("Qual é o leapy certo?");
    expect(html).toContain("Achei 5 pastas com esse nome.");
    expect(quantas(html, 'type="radio"')).toBe(3);
    expect(quantas(html, " checked")).toBe(1);
    expect(html).toContain(`value="${HOME}/code/leapy/main-repos/leapy" data-pasta-de="pp" checked`);
    expect(html).toContain("Mostrar mais 2");
    expect(html).toContain("Procurar em outro lugar…");
    // Com a lista aberta, o botão lê a opção marcada: não carrega pasta fixa.
    expect(html).not.toContain("data-pasta=");
    const todas = renderTimeline(conversa([proposta(candidatas)]), reduzir(curta, { tipo: "lista-de-pasta", propostaId: "pp", lista: "todas" }));
    expect(quantas(todas, 'type="radio"')).toBe(5);
    expect(todas).toContain("Mostrar menos");
    expect(todas).toContain("code · sem Git");
    expect(todas).toContain("há 4 meses");
  });

  it("com uma candidata só, \"Não é essa\" já abre a escolha no computador", () => {
    const html = renderTimeline(conversa([proposta(candidatas.slice(0, 1))]), estado);
    expect(html).toContain("Abrir o projeto leapy?");
    expect(html).not.toContain('data-act="lista-de-pasta"');
    expect(html).toContain('data-act="abrir-workspace"');
  });

  it("sem candidata, diz que não achou e oferece escolher a pasta", () => {
    const html = renderTimeline(conversa([proposta([])]), estado);
    expect(html).toContain("Não achei o leapy no seu computador");
    expect(html).toContain("Escolher pasta…");
    expect(html).not.toContain('data-act="permitir-pasta"');
  });

  it("proposta gravada antes, sem local nem data, mostra o local tirado do caminho", () => {
    const antiga = [{ caminho: `${HOME}/code/nod`, nome: "nod", git: true }];
    const html = renderTimeline(conversa([proposta(antiga)]), estado);
    expect(html).toContain("<small>code</small>");
    expect(html).not.toContain("mudou");
  });

  it("escapa nome e motivo vindos da busca e do modelo", () => {
    const p = proposta([{ ...candidatas[0]!, nome: "<img src=x>" }]);
    const html = renderTimeline(conversa([{ ...p, payload: { ...(p.payload as PayloadPropostaPasta), motivo: "<script>x</script>" } }]), estado);
    expect(html).not.toContain("<img src=x>");
    expect(html).not.toContain("<script>");
  });
});

describe("registro da pasta aberta", () => {
  const autoria = { autor_tipo: "pessoa", autor_id: "p", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "pessoa", regra_versao: 1 } as const;
  const registro: Mensagem = { tenantId: "t", id: "m1", conversaId: "c", turnoId: null, autoria, kind: "sistema", texto: `Pasta leapy aberta: ${HOME}/code/leapy/main-repos/leapy`, payload: { kind: "pasta_aberta", propostaId: "pp", agenteId: "a", pasta: `${HOME}/code/leapy/main-repos/leapy`, nome: "leapy", onde: "code/leapy/main-repos" }, confianca: "confiavel", parcial: false, criadoEm: AGORA };

  it("fica na conversa como uma linha, com o local e o Trocar para quem é dona", () => {
    const html = renderMensagem(registro, estado);
    expect(html).toContain("<b>leapy</b> aberta para Dev 1");
    expect(html).toContain("code › leapy › main-repos");
    expect(html).toContain('data-act="abrir-workspace"');
    expect(html).not.toContain("msg-sistema");
  });

  it("quem não é dona do bot não vê o Trocar", () => {
    expect(renderMensagem(registro, { ...estado, sessao: { tenantId: "t", pessoaId: "outra" } })).not.toContain('data-act="abrir-workspace"');
  });
});

describe("textos de apoio", () => {
  it("o local legível tira a pasta pessoal e o próprio nome", () => {
    expect(ondeLegivel({ caminho: `${HOME}/code/leapy/main-repos/leapy` })).toBe("code › leapy › main-repos");
    expect(ondeLegivel({ caminho: `${HOME}/leapy` })).toBe("pasta pessoal");
    expect(ondeLegivel({ caminho: "/x", onde: "" })).toBe("pasta pessoal");
  });

  it("o último uso sai em dias de calendário", () => {
    const fuso = "America/Sao_Paulo";
    const agora = Date.parse("2026-09-25T15:00:00Z");
    expect(mudouQuando(Date.parse("2026-09-25T04:00:00Z"), agora, fuso)).toBe("mudou hoje");
    expect(mudouQuando(Date.parse("2026-09-25T02:00:00Z"), agora, fuso)).toBe("mudou ontem");
    expect(mudouQuando(agora - 5 * DIA, agora, fuso)).toBe("há 5 dias");
    expect(mudouQuando(agora - 21 * DIA, agora, fuso)).toBe("há 3 semanas");
    expect(mudouQuando(agora - 130 * DIA, agora, fuso)).toBe("há 4 meses");
    expect(mudouQuando(agora - 400 * DIA, agora, fuso)).toBe("há mais de um ano");
  });
});
