import { describe, expect, it } from "vitest";
import type { ConversaDto } from "../../../src/contracts/api.ts";
import { estadoInicial, reduzir, type ConversaEstado, type Estado } from "../../../web/estado/reducer.ts";
import { ATIVIDADE_VAZIA, comFerramenta, comTexto, comVigia, type VigiaDaAtividade } from "../../../web/lib/atividade.ts";
import { blocosAoVivo, renderCabecalhoConversa } from "../../../web/telas/conversa.ts";

/** NOD-73: o aviso do vigia na tela (protótipo do Gil) — só aviso, com o Parar que já existe. */
const C = "c1";
const AGORA = Date.parse("2026-10-05T14:00:00Z");
const MIN = 60_000;

function cenario(vigia: VigiaDaAtividade | null, comCartao = true): { e: Estado; c: ConversaEstado } {
  const conversa: ConversaDto = {
    conversa: { tenantId: "t", id: C, ownerId: "p", visibility: "privado", tipo: "propria", agenteId: "a", salaId: null, sessaoCli: null, criadoEm: 1 } as never,
    mensagens: [], turnosPendentes: [], turnosEmCurso: [], turnosCancelados: [], propostas: [], fios: [],
  };
  const base = reduzir(estadoInicial, { tipo: "hidratar-conversa", conversa, agora: AGORA });
  const atividade = comCartao ? comFerramenta(comTexto(ATIVIDADE_VAZIA, "Rodando os testes."), "Rodou um comando") : ATIVIDADE_VAZIA;
  const e: Estado = {
    ...base, agora: AGORA, sessao: { pessoaId: "p", tenantId: "t" } as never,
    frota: { agentes: [{ id: "a", nome: "Ada", conversaId: C, cor: "blue", forma: "square" }] } as never,
    turnosVivos: { t1: { turnoId: "t1", conversaId: C, estado: "rodando", executor: null, machineId: null, desde: AGORA - 30 * MIN } },
    atividades: { [C]: { t1: vigia ? comVigia(atividade, vigia) : atividade } },
  };
  return { e, c: e.conversas[C]! };
}

const corpo = (e: Estado, c: ConversaEstado) => blocosAoVivo(c, e).find((b) => b.chave === "vivo:t1")!.html;

describe("vigia do turno na tela (NOD-73)", () => {
  it("sem aviso, o cartão segue como era: ponto pulsando, sem bloco âmbar", () => {
    const { e, c } = cenario(null);
    expect(corpo(e, c)).not.toContain("atividade-vigia");
    expect(corpo(e, c)).not.toContain("parado");
    expect(renderCabecalhoConversa(e, "a")).not.toContain("sem novidade");
  });

  it("silêncio com ferramenta aberta: 'Sem novidade há N min', o que espera, o Parar; o ponto para; o cabeçalho conta", () => {
    const { e, c } = cenario({ mudoDesde: AGORA - 12 * MIN, aberta: "Terminal", emFundo: 0, repeticao: null });
    const html = corpo(e, c);
    expect(html).toContain("Sem novidade há 12 min");
    expect(html).toContain("Esperando <b>Terminal</b> terminar.");
    expect(html).toContain("Se parecer travado, use Parar.");
    expect(html.match(/data-act="parar-conversa"/g)).toHaveLength(1);
    // O Parar do aviso é âmbar (--warning), nunca o vermelho de perigo.
    expect(html).toContain('class="bt aviso" data-act="parar-conversa"');
    expect(html).not.toContain("perigo");
    expect(html.match(/class="vigia-ic"/g)).toHaveLength(1);
    // NOD-348: a linha viva para de brilhar no silêncio; o vigia fica à vista, fora do "ver etapas".
    expect(html).toMatch(/class="fala-viva-linha (autor|rodape) parado"/);
    expect(html.indexOf("</details>")).toBeLessThan(html.indexOf('class="atividade-vigia"'));
    expect(renderCabecalhoConversa(e, "a")).toContain("sem novidade há 12 min");
    // O relógio da tela anda sem frame novo.
    expect(corpo({ ...e, agora: AGORA + 5 * MIN }, c)).toContain("Sem novidade há 17 min");
  });

  it("segundo plano e nada aberto mudam a frase do que espera", () => {
    const fundo = cenario({ mudoDesde: AGORA - 10 * MIN, aberta: null, emFundo: 2, repeticao: null });
    expect(corpo(fundo.e, fundo.c)).toContain("Esperando 2 comandos em segundo plano.");
    const nada = cenario({ mudoDesde: AGORA - 10 * MIN, aberta: null, emFundo: 0, repeticao: null });
    expect(corpo(nada.e, nada.c)).toContain("O bot não responde.");
  });

  it("repetição: só o maior limiar, no mesmo bloco do silêncio e com um Parar só", () => {
    const { e, c } = cenario({ mudoDesde: AGORA - 10 * MIN, aberta: null, emFundo: 0, repeticao: { rotulo: "Terminal", vezes: 10 } });
    const html = corpo(e, c);
    expect(html).toContain("Repetiu a mesma ação 10 vezes");
    expect(html).toContain("Em <b>Terminal</b>. Pode estar andando em círculo.");
    expect(html).not.toContain("5 vezes");
    expect(html.match(/class="atividade-vigia"/g)).toHaveLength(1);
    expect(html.match(/class="vigia-ic"/g)).toHaveLength(2);
    expect(html.match(/data-act="parar-conversa"/g)).toHaveLength(1);
    // Repetição sem silêncio: o ponto segue pulsando.
    const so = cenario({ mudoDesde: null, aberta: null, emFundo: 0, repeticao: { rotulo: "Gmail", vezes: 5 } });
    expect(corpo(so.e, so.c)).toContain("Repetiu a mesma ação 5 vezes");
    expect(corpo(so.e, so.c)).not.toContain(" parado");
  });

  it("NOD-348: sem ferramenta, o mesmo aviso âmbar dentro da fala viva, embaixo da linha viva, com o Parar", () => {
    const { e, c } = cenario({ mudoDesde: AGORA - 20 * MIN, aberta: null, emFundo: 0, repeticao: null }, false);
    const html = corpo(e, c);
    expect(html.indexOf('data-parte="viva"')).toBeLessThan(html.indexOf('data-parte="vigia"'));
    expect(html).toContain("Sem novidade há 20 min");
    expect(html).toContain("O bot não responde.");
    expect(html).toContain('class="bt aviso" data-act="parar-conversa"');
    expect(html).not.toContain("trabalhando ·");
  });
});
