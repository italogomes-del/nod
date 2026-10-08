import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TrabalhoDto, TrabalhosDto } from "../../../src/contracts/trabalho.ts";
import { estadoInicial, reduzir, type Estado } from "../../../web/estado/reducer.ts";
import { pilulaMac, seguradoPeloMac, situacaoDe } from "../../../web/lib/trabalhos.ts";
import { SECOES_ESPACO } from "../../../web/telas/espaco.ts";
import { renderEsteMac, USOS } from "../../../web/telas/este-mac.ts";
import { htmlMenuConta } from "../../../web/telas/menu-conta.ts";
import { renderTodosOsTrabalhos } from "../../../web/telas/trabalhos.ts";

/** ADR-085 (definido em 2026-10-08): Seu espaço › Este Mac, a pílula do Mac ocupado e "esperando o Mac aliviar". */

const AGORA = new Date(2026, 9, 8, 15, 0).getTime();
const trabalho = (id: string, extra: Partial<TrabalhoDto> = {}): TrabalhoDto => ({
  id, agenteId: "cec", conversaId: "c-cec", titulo: id, origem: "rotina", pedidoPorAgenteId: null, rotinaId: null, trabalhoMaeId: null, depoisDeTrabalhoId: null, estado: "rodando",
  pasta: null, memoriaMb: null, custoUsd: null, criadoEm: AGORA - 600_000, iniciadoEm: AGORA - 600_000, terminadoEm: null, pedidoPorNome: null, rotinaNome: null, ultimoPasso: null, turnoVivoId: null, esperandoComputadorDe: null, ...extra,
});

function estadoCom(trabalhos: TrabalhoDto[], extra: Partial<TrabalhosDto> = {}, resto: Partial<Estado> = {}): Estado {
  return {
    ...estadoInicial, agora: AGORA, sessao: { tenantId: "t", pessoaId: "p" },
    frota: { agentes: [{ id: "cec", nome: "Cecília", conversaId: "c-cec", cor: "c-amber", forma: "shape-capsule", ownerId: "p", titulo: "PM", descricao: "", confirmado: true }] } as never,
    trabalhos: { trabalhos, pressao: "verde", memoriaTotalMb: 1700, processador: "verde", cargaProcessador: 0.4, segurando: false, ...extra },
    ...resto,
  };
}

const rodando = trabalho("Orquestrar a etapa de engenharia", { turnoVivoId: "turno-1", memoriaMb: 420 });
// `seguravel` vem do servidor (seguravelPeloMac, tests/unit/domain/memoria-mac.test.ts).
const rotinaNova = trabalho("Verificar o Slack", { estado: "na_fila", iniciadoEm: null, seguravel: true });
const daPessoaNova = trabalho("Liberar espaço", { estado: "na_fila", iniciadoEm: null, origem: "pessoa", seguravel: false });

describe("quem espera o Mac aliviar", () => {
  it("o que o servidor marca como seguravel, na fila, e só com o Mac segurando", () => {
    expect(seguradoPeloMac(rotinaNova, true)).toBe(true);
    expect(seguradoPeloMac(daPessoaNova, true)).toBe(false);
    expect(seguradoPeloMac(trabalho("sem a marca (servidor antigo)", { estado: "na_fila", iniciadoEm: null }), true)).toBe(false);
    expect(seguradoPeloMac({ ...rotinaNova, estado: "rodando" }, true)).toBe(false);
    expect(seguradoPeloMac(rotinaNova, false)).toBe(false);
  });

  it("a linha diz o porquê: 'esperando o Mac aliviar' em vez de 'na fila'", () => {
    expect(situacaoDe(rotinaNova, [], true)).toBe("esperando o Mac aliviar");
    expect(situacaoDe(rotinaNova, [], false)).toBe("na fila");
    expect(situacaoDe(daPessoaNova, [], true)).toBe("na fila");
  });

  it("a pílula: nada sem segurar; com o Ver levando a Este Mac; a de memória, quando existe, fica sozinha", () => {
    expect(pilulaMac(false, 2)).toBe("");
    const p = pilulaMac(true, 2);
    expect(p).toContain("Seu Mac está ocupado");
    expect(p).toContain("2 trabalhos esperam o Mac aliviar");
    expect(p).toContain('data-act="secao-espaco" data-secao="este-mac"');
    expect(pilulaMac(true, 0, false)).toContain("trabalho novo espera o Mac aliviar");
    const todos = renderTodosOsTrabalhos(estadoCom([rodando, rotinaNova], { segurando: true }));
    expect(todos).toContain("Seu Mac está ocupado");
    expect(todos).toContain("esperando o Mac aliviar");
    expect(renderTodosOsTrabalhos(estadoCom([rodando, rotinaNova], { segurando: true, pressao: "amarela" }, { pressao: "amarela" }), "todos")).not.toContain("Seu Mac está ocupado");
  });
});

describe("Seu espaço › Este Mac", () => {
  it("a seção existe no Seu espaço e no menu da conta, com o que o item diz à direita", () => {
    expect(SECOES_ESPACO.map((s) => s.id)).toContain("este-mac");
    const menu = htmlMenuConta({ faixa: null, conexao: "Conectada", avisos: "Ligados", modoDev: false, banco: null, esteMac: "Equilibrado" });
    expect(menu).toContain('data-secao="este-mac"');
    expect(menu).toMatch(/Este Mac<\/span><span class="mc-meta">Equilibrado<\/span>/);
  });

  it("o resumo, a memória e o processador, quem trabalha (com a memória) e o uso escolhido", () => {
    const html = renderEsteMac(estadoCom([rodando, rotinaNova]));
    expect(html).toContain("1 trabalhando");
    expect(html).toContain("usa 1,7 GB do seu Mac");
    expect(html).toContain("Nada esperando");
    expect(html).toMatch(/<b>Memória<\/b>.*folgada/);
    expect(html).toMatch(/<b>Processador<\/b><span class="mac-barra nivel-verde" aria-hidden="true"><i style="width: 40%"><\/i><\/span><span>folgado<\/span>/);
    expect(html).toContain("Cecília");
    expect(html).toContain("420 MB");
    expect(html).toContain('class="seg ativo" data-act="uso-do-mac" data-uso="equilibrado" aria-pressed="true"');
    expect(html).toContain(USOS[1]!.explicacao);
  });

  it("com o Mac segurando: quem espera aparece, com a pílula; sem leitura do Mac, o texto diz isso", () => {
    const segurando = renderEsteMac(estadoCom([rodando, rotinaNova], { segurando: true, processador: "vermelha", cargaProcessador: 1.3 }));
    expect(segurando).toContain("1 esperando o Mac aliviar");
    expect(segurando).toContain("Esperando o Mac aliviar · 1");
    expect(segurando).toContain("Seu Mac está ocupado");
    expect(segurando).toContain('mac-barra nivel-vermelha" aria-hidden="true"><i style="width: 100%">');
    const semLeitura = renderEsteMac(estadoCom([], { pressao: null, processador: null, cargaProcessador: null, memoriaTotalMb: null }));
    expect(semLeitura).toContain("O Mac ainda não mandou leitura");
    const nadaAinda = renderEsteMac(estadoCom([rodando], { segurando: true, processador: "vermelha" }));
    expect(nadaAinda).toContain("Nada esperando ainda");
    expect(nadaAinda).not.toContain("0 esperando");
    const doisSemMemoria = renderEsteMac(estadoCom([rodando, { ...rodando, id: "outro", turnoVivoId: "turno-2" }], { memoriaTotalMb: null }));
    expect(doisSemMemoria).toContain("2 trabalhando");
    expect(doisSemMemoria).toContain("sem leitura de memória");
  });

  it("o uso escolhido muda pela ação do reducer; o padrão é equilibrado", () => {
    expect(estadoInicial.usoDoMac).toBe("equilibrado");
    const e = reduzir(estadoCom([]), { tipo: "uso-do-mac", uso: "pouco" });
    expect(e.usoDoMac).toBe("pouco");
    expect(renderEsteMac(e)).toContain('data-uso="pouco" aria-pressed="true"');
  });

  it("o CSS da seção existe e usa só tokens", () => {
    const css = readFileSync(new URL("../../../web/navegacao.css", import.meta.url), "utf8");
    const bloco = css.slice(css.indexOf("Seu espaço › Este Mac"), css.indexOf("@media (max-width: 760px)", css.indexOf("Seu espaço › Este Mac")));
    expect(bloco).toContain(".mac-barra.nivel-vermelha i { background: var(--danger); }");
    expect(bloco).not.toMatch(/#[0-9a-f]{3,6}\b/i);
  });
});
