import { describe, expect, it } from "vitest";
import type { FrotaDto } from "../../../src/contracts/api.ts";
import type { ComputadorDto, RegistroComputador } from "../../../src/contracts/computador.ts";
import type { Mensagem } from "../../../src/contracts/mensagem.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { computadorPadrao } from "../../../src/domain/computador.ts";
import { agruparAtividade, estadoEmPalavras, foraDoAr, mensagemDoLimite, rotuloDaAtividade, tituloDaFalha } from "../../../web/lib/computador.ts";
import { renderCabecalhoConversa, renderMensagem } from "../../../web/telas/conversa.ts";
import { renderDetalhes } from "../../../web/telas/detalhes.ts";

const H = 3_600_000;
const T0 = Date.parse("2026-09-22T18:01:00-03:00");
const registro = (extra: Partial<RegistroComputador>): RegistroComputador => ({ id: "r", computadorId: "c", turnoId: null, autor: "bot", tipo: "observar", estado: "falhou", motivo: "navegador_nao_abriu", em: T0, ...extra });
type AgenteFrota = FrotaDto["agentes"][number];
const nina = (fora: AgenteFrota["computadorForaDoAr"]): AgenteFrota => ({ tenantId: "t", id: "a1", ownerId: "p", visibility: "privado", nome: "Nina", titulo: "Assistente de e-mail", descricao: "", dono: "pessoa", forma: "shape-square", cor: "c-purple", fixado: false, oculto: false, confirmado: true, modelo: "m", duplicadoDe: null, criadoEm: 0, conversaId: "c1", descricaoEstado: "", computadorForaDoAr: fora, ultimaMensagem: null });
const comFrota = (a: AgenteFrota): Estado => ({ ...estadoInicial, sessao: { tenantId: "t", pessoaId: "p" }, frota: { agentes: [a], inventario: { estado: "pronto", versao: "catcher", em: 0 }, negacoes: [] }, tela: { tipo: "conversa", conversaId: "c1", agenteId: "a1" } } as Estado);
const FORA = { desde: T0, motivo: "navegador_nao_abriu" as const };

describe("computador do bot: erro real e aviso único na web (emenda da ADR-037)", () => {
  it("atividade: vizinhos iguais viram UMA linha ×N com o intervalo; o que muda quebra o grupo", () => {
    const linhas = agruparAtividade([
      registro({ em: T0 + 40 * H }), registro({ em: T0 + 20 * H }), registro({ em: T0 }),
      registro({ tipo: "gravar_arquivo", estado: "concluida", motivo: null, em: T0 - H }),
      registro({ em: T0 - 2 * H }),
    ]);
    expect(linhas.map((l) => [l.tipo, l.estado, l.n])).toEqual([["observar", "falhou", 3], ["gravar_arquivo", "concluida", 1], ["observar", "falhou", 1]]);
    expect(linhas[0]).toMatchObject({ de: T0, ate: T0 + 40 * H, motivo: "navegador_nao_abriu" });
    expect(rotuloDaAtividade("observar")).toBe("Observar a tela");
    expect(rotuloDaAtividade("comando_novo")).toBe("comando novo");
    expect(tituloDaFalha("navegador_nao_abriu")).toBe("O navegador do computador não abriu");
  });

  it("estado em palavras: fora do ar manda, mesmo com o container de pé", () => {
    const dto = (c: Partial<ComputadorDto["computador"]>, extra: Partial<ComputadorDto> = {}): ComputadorDto => ({ computador: { id: "c", agenteId: "a1", habilitado: true, controle: "bot", politica: "supervisionado", ajuda: null, ajudaDecisaoId: null, ocupadoAte: null, operacaoId: null, criadoEm: 0, falhasSeguidas: 0, falhaMotivo: null, indisponivelDesde: null, ...c }, disponivel: true, ativo: true, motivo: null, atividade: [], ...extra });
    expect(estadoEmPalavras(dto({ falhasSeguidas: 3, falhaMotivo: "navegador_nao_abriu", indisponivelDesde: T0 }), T0, null)).toBe("Fora do ar");
    expect(estadoEmPalavras(dto({ falhasSeguidas: 3, falhaMotivo: "navegador_nao_abriu", indisponivelDesde: T0 }), T0, "iniciar")).toBe("Tentando de novo…");
    expect(estadoEmPalavras(dto({}), T0, null)).toBe("Pronto para o bot");
    expect(estadoEmPalavras(dto({}, { ativo: false }), T0, null)).toBe("Desligado");
  });

  it("NOD-192: o painel de um bot sem computador (id nulo) mostra o mesmo de um recém-criado: Desligado, sem cartões", () => {
    const sem: ComputadorDto = { computador: computadorPadrao("a1"), disponivel: true, ativo: false, motivo: null, atividade: [] };
    expect(sem.computador.id).toBeNull();
    expect(foraDoAr(sem)).toBe(false);
    expect(estadoEmPalavras(sem, T0, null)).toBe("Desligado");
    expect(estadoEmPalavras(sem, T0, "iniciar")).toBe(estadoEmPalavras({ ...sem, computador: { ...sem.computador, id: "c", criadoEm: T0 } }, T0, "iniciar"));
    expect(mensagemDoLimite(sem)).toBeNull();
    expect(agruparAtividade(sem.atividade)).toEqual([]);
    expect(estadoEmPalavras({ ...sem, disponivel: false, motivo: "Configure NOD_COMPUTADORES=docker no servidor." }, T0, null)).toBe("Ambiente indisponível");
  });

  it("NOD-170: o cartão do teto mostra os números só enquanto a última tentativa bateu no limite e a máquina segue desligada", () => {
    const limite = { maximo: 3, ociosoMin: 15 };
    const bateu = registro({ tipo: "iniciar", autor: "pessoa", motivo: "limite_de_computadores", em: T0 });
    expect(mensagemDoLimite({ ativo: false, atividade: [bateu], limite })).toBe("Este Mac já tem 3 computadores ligados, o limite. Nada foi executado. Os computadores sem uso há 15 min desligam sozinhos.");
    expect(mensagemDoLimite({ ativo: false, atividade: [bateu] })).toBe("Este Mac já tem o máximo de computadores ligados. Nada foi executado.");
    // Ligou depois (ou outra ação veio por cima), ou a falha foi outra: sem cartão do limite.
    expect(mensagemDoLimite({ ativo: true, atividade: [bateu], limite })).toBeNull();
    expect(mensagemDoLimite({ ativo: false, atividade: [registro({ tipo: "iniciar", estado: "concluida", motivo: null, em: T0 + H }), bateu], limite })).toBeNull();
    expect(mensagemDoLimite({ ativo: false, atividade: [registro({ em: T0 })], limite })).toBeNull();
    expect(mensagemDoLimite({ ativo: false, atividade: [], limite })).toBeNull();
    expect(tituloDaFalha("limite_de_computadores")).toBe("Este Mac já tem o máximo de computadores ligados");
  });

  it("painel: o botão Computador do bot (em Ambiente) ganha o chip 'fora do ar'; respondendo, não — e o cabeçalho fica limpo", () => {
    expect(renderDetalhes(comFrota(nina(FORA)))).toMatch(/data-act="abrir-computador"[^>]*>(?:<svg[\s\S]*?<\/svg>)?<span class="gv-linha-txt">Computador do bot<\/span><span class="tag tag-vermelha">fora do ar<\/span>/);
    expect(renderDetalhes(comFrota(nina(null)))).not.toContain("fora do ar");
    expect(renderCabecalhoConversa(comFrota(nina(FORA)), "a1")).not.toContain("abrir-computador");
  });

  it("painel: a seção Computador do bot aparece só fora do ar, com 'Tentar de novo' e 'Abrir computador'", () => {
    const html = renderDetalhes(comFrota(nina(FORA)));
    expect(html).toContain("<h3>Computador do bot</h3>");
    expect(html).toContain("o navegador do computador não abriu");
    expect(html).toContain('data-act="religar-computador"');
    expect(html).toContain('data-act="abrir-computador"');
    expect(renderDetalhes(comFrota(nina(null)))).not.toContain("<h3>Computador do bot</h3>");
  });

  it("conversa: a mensagem única é um cartão de estado; depois que o computador volta, fica sem botões", () => {
    const m: Mensagem = { tenantId: "t", id: "m1", conversaId: "c1", turnoId: null, autoria: { autor_tipo: "agente", autor_id: "a1", sob_procuracao_de: null, conta_de_execucao: "p", executor: "catcher", locality: "local", locality_reason: "tudo_local_nesta_rodada", machine_id: null, decidido_por: "regra:saude_computador", regra_versao: 1 }, kind: "sistema", texto: "O computador de Nina não responde: o navegador do computador não abriu. Tirei o computador das próximas execuções até você religá-lo.", payload: { kind: "computador_fora_do_ar", agenteId: "a1", desde: T0, motivo: "navegador_nao_abriu" }, confianca: "confiavel", parcial: false, criadoEm: T0 };
    const fora = renderMensagem(m, comFrota(nina(FORA)));
    expect(fora).toContain("Computador do bot fora do ar");
    expect(fora).toContain('data-act="religar-computador"');
    const voltou = renderMensagem(m, comFrota(nina(null)));
    expect(voltou).toContain("O computador voltou a responder.");
    expect(voltou).not.toContain('data-act="religar-computador"');
  });

  it("SSE: só a mudança de SAÚDE relê a frota; as ações comuns do computador não", () => {
    const frame = (dados: Record<string, unknown>) => ({ tipo: "frame", frame: { streamId: "s", seq: 1, pessoaId: "p", tipo: "computador.mudou", dados }, agora: T0 }) as const;
    expect(reduzir(estadoInicial, frame({ agenteId: "a1", saude: true })).invalidacoes).toContain("frota");
    expect(reduzir(estadoInicial, frame({ agenteId: "a1" })).invalidacoes).not.toContain("frota");
  });
});
