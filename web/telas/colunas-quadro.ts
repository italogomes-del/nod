/**
 * NOD-448 (definido em 2026-11-01, ADR-140; protótipo aprovado gamefik.github.io/nod-prototipos/nod-448): a edição das
 * colunas na tela, sem DOM. Quem abre e fecha cada pedaço é web/lib/quadro-na-tela.ts (o estado `EdicaoDeColuna`).
 *
 * - Computador: o ⋯ do cabeçalho (só no hover ou no foco, decisão 6) abre o menu com o grupo no topo; renomear vira um
 *   campo no próprio cabeçalho; "Remover" de coluna com tarefas pede o destino num popover; o "+" no fim abre a coluna nova
 *   com a escolha do grupo (obrigatória).
 * - Celular: a folha "Colunas" com as alças ≡ (decisão 7), onde também se renomeia, cria e remove.
 * Todo nome é dado e passa por `esc`.
 */
import type { ColunaDto, GrupoColuna, TarefaDto } from "../../src/contracts/quadro.ts";
import { esc } from "../lib/escape.ts";
import { aceitaPassagem, acionaNaColuna, LIMITE_COLUNAS, LIMITE_INSTRUCOES, LIMITE_NOME_COLUNA, destinosAoRemover, FRASE_DO_GRUPO, fraseDaColuna, GRUPOS, iconeDaColuna, NOME_DO_GRUPO, passoDeMover, porqueNaoRecebeCard, porqueNaoRemove, type EdicaoDeColuna } from "../lib/colunas.ts";
import { confiar, ICONE, ICONE_DO_STATUS, type Html } from "./quadro.ts";

const ICONE_DO_GRUPO: Readonly<Record<GrupoColuna, Html>> = {
  nao_iniciado: ICONE_DO_STATUS.afazer, iniciado: ICONE_DO_STATUS.fazendo, feito: ICONE_DO_STATUS.feito, fechado: ICONE_DO_STATUS.cancelado,
};

const icone = (c: ColunaDto): Html => {
  const ic = ICONE_DO_STATUS[iconeDaColuna(c)];
  return c.daPessoa ? confiar(ic.replace('class="qd-ic qd-st ', 'class="qd-ic qd-st qd-st-pessoa ')) : ic;
};

const tarefas = (n: number): string => (n === 1 ? "1 tarefa" : `${n} tarefas`);

function item(o: { act: string; coluna: string; rotulo: string; tecla?: string; porque?: string | null; perigo?: boolean; grupo?: GrupoColuna }): string {
  const des = o.porque ? ` aria-disabled="true" title="${esc(o.porque)}"` : "";
  const extra = o.grupo ? ` data-grupo="${o.grupo}"` : "";
  return `<button type="button" role="menuitem" class="qd-menu-it${o.perigo ? " qd-menu-perigo" : ""}" data-act="${o.act}" data-coluna="${esc(o.coluna)}"${extra}${des}>` +
    `<span>${esc(o.rotulo)}</span>${o.tecla ? `<kbd>${esc(o.tecla)}</kbd>` : ""}${o.porque ? `<small class="qd-menu-porque">${esc(o.porque)}</small>` : ""}</button>`;
}

/** O menu de uma coluna: o grupo dela no topo e as ações (as que não valem aparecem desabilitadas com o porquê). */
export function menuDaColuna(cs: readonly ColunaDto[], c: ColunaDto, nomeDoBot: string): Html {
  const esq = passoDeMover(cs, c.id, "esquerda");
  const dir = passoDeMover(cs, c.id, "direita");
  const naoSai = porqueNaoRemove(cs, c.id, nomeDoBot);
  const cheio = cs.length >= LIMITE_COLUNAS ? `O quadro já tem ${LIMITE_COLUNAS} colunas.` : null;
  return confiar(`<div class="qd-menu" role="menu" id="qd-menu" aria-label="${esc(`Coluna ${c.nome}`)}">` +
    `<p class="qd-menu-grupo">${ICONE_DO_GRUPO[c.grupo]}<span>${esc(NOME_DO_GRUPO[c.grupo])}</span><small>${esc(fraseDaColuna(c))}</small></p>` +
    item({ act: "col-renomear", coluna: c.id, rotulo: "Renomear", tecla: "F2" }) +
    item({ act: "col-esquerda", coluna: c.id, rotulo: "Mover para a esquerda", tecla: "Alt ←", porque: esq.ok ? null : esq.porque }) +
    item({ act: "col-direita", coluna: c.id, rotulo: "Mover para a direita", tecla: "Alt →", porque: dir.ok ? null : dir.porque }) +
    item({ act: "col-nova", coluna: c.id, grupo: c.grupo, rotulo: "Adicionar coluna à direita", porque: cheio }) +
    `<hr class="qd-menu-sep">` +
    item({ act: "col-remover", coluna: c.id, rotulo: "Remover coluna", porque: naoSai, perigo: true }) +
    `</div>`);
}

/** Remover coluna com tarefas: para onde elas vão. Mudar de coluna aqui não aciona ninguém (decisão 4). */
export function popoverDeRemover(cs: readonly ColunaDto[], c: ColunaDto, n: number): Html {
  const { opcoes, padrao } = destinosAoRemover(cs, c.id);
  const ops = opcoes.map((x) => `<option value="${esc(x.id)}"${x.id === padrao ? " selected" : ""}>${esc(x.nome)}</option>`).join("");
  return confiar(`<div class="qd-pop" role="dialog" aria-labelledby="qd-pop-tit">` +
    `<form data-form="col-remover" data-coluna="${esc(c.id)}"><p class="qd-pop-tit" id="qd-pop-tit"><b>${esc(c.nome)}</b> tem ${esc(tarefas(n))}. Para onde elas vão?</p>` +
    `<label class="qd-sr" for="qd-col-destino">Destino das tarefas</label><select id="qd-col-destino" class="qd-sel" name="destino">${ops}</select>` +
    `<div class="qd-pop-bts"><button type="button" class="qd-bt" data-act="col-fechar">Cancelar</button><button type="submit" class="qd-bt qd-bt-perigo">Remover</button></div>` +
    `<p class="qd-dica">Mudar de coluna não aciona ninguém.</p></form></div>`);
}

/** Um agente que pode receber a passagem (ADR-142). */
export type AgenteDaPassagem = { id: string; nome: string };

/**
 * ADR-142: quem começa quando a tarefa entra na coluna. Com responsável, o nome curto (sempre à vista); sem, o
 * "Passar para…" discreto (como o ⋯, só no hover ou no foco). Só nas colunas que aceitam passagem.
 */
export function passagemDoCabecalho(c: ColunaDto, aberta: boolean): Html {
  if (!aceitaPassagem(c)) return confiar("");
  const nome = c.responsavel ? c.responsavelNome ?? "um agente" : null;
  const rotulo = nome ? `${c.nome} passa para ${nome}. Mudar a passagem` : `Passar ${c.nome} para um agente`;
  return confiar(`<button type="button" class="qd-col-passa${nome ? " qd-col-passa-com" : ""}" data-act="col-passagem" data-coluna="${esc(c.id)}" aria-label="${esc(rotulo)}" aria-haspopup="dialog" aria-expanded="${aberta}">` +
    `${nome ? `<span aria-hidden="true">→</span> ${esc(nome)}` : "Passar para…"}</button>`);
}

/** O popover da passagem: sem passagem ou um agente (começa na hora só onde aciona; revisão 3 do PR #622), e o que a etapa faz. */
export function popoverDePassagem(c: ColunaDto, agentes: readonly AgenteDaPassagem[]): Html {
  const com = !!c.responsavel;
  const ops = [`<option value="">Escolha o agente</option>`, ...agentes.map((a) => `<option value="${esc(a.id)}"${a.id === c.responsavel ? " selected" : ""}>${esc(a.nome)}</option>`)].join("");
  const radio = (v: string, marcado: boolean, rotulo: string, dica: string) =>
    `<label class="qd-pas-op"><input type="radio" name="modo" value="${v}"${marcado ? " checked" : ""}><span>${esc(rotulo)}<small>${esc(dica)}</small></span></label>`;
  return confiar(`<div class="qd-pop qd-pop-passa" role="dialog" aria-labelledby="qd-pas-tit">` +
    `<form data-form="col-passagem" data-coluna="${esc(c.id)}"><p class="qd-pop-tit" id="qd-pas-tit">Quando a tarefa entra em <b>${esc(c.nome)}</b></p>` +
    `<fieldset class="qd-pas-modos"><legend class="qd-sr">Passagem</legend>` +
    radio("sem", !com, "Sem passagem", "o responsável continua") + radio("agente", com, "Passar para um agente", acionaNaColuna(c) ? "começa na hora" : "passa para ele, sem acionar") + `</fieldset>` +
    `<label class="qd-sr" for="qd-pas-agente">Agente</label><select id="qd-pas-agente" class="qd-sel" name="agente">${ops}</select>` +
    `<label class="qd-rotulo" for="qd-pas-inst">O que essa etapa faz</label>` +
    `<textarea id="qd-pas-inst" class="qd-pas-inst" name="instrucoes" rows="3" maxlength="${LIMITE_INSTRUCOES}" placeholder="Ex.: revise o PR e aponte o que falta">${esc(c.instrucoes ?? "")}</textarea>` +
    `<div class="qd-pop-bts"><button type="button" class="qd-bt" data-act="col-fechar">Cancelar</button><button type="submit" class="qd-bt qd-bt-pri">Salvar</button></div></form></div>`);
}

/**
 * O card solto numa coluna com responsável (revisão do PR #622, decisão da PM): uma linha discreta no topo da lista da
 * coluna de destino, no lugar onde o card cai. Não é diálogo nem popover: um grupo com o nome, e os dois links. Confirmar
 * (o padrão, com o foco) começa; "Não iniciar ainda" só move; Esc desiste.
 */
export function confirmacaoDeSoltar(c: ColunaDto, tarefa: string, titulo = "A tarefa"): Html {
  const nome = c.responsavelNome ?? "o responsável";
  return confiar(`<li class="qd-soltar" role="group" aria-label="${esc(`Mover ${titulo} para ${c.nome}`)}">` +
    `<p class="qd-soltar-tit"><b>${esc(titulo)}</b> · ${esc(nome)} começa agora.</p>` +
    `<p class="qd-pas-bts"><button type="button" class="qd-link qd-link-pri" data-act="col-soltar" data-coluna="${esc(c.id)}" data-tarefa="${esc(tarefa)}">Confirmar</button>` +
    `<span aria-hidden="true">·</span><button type="button" class="qd-link" data-act="col-soltar-sem" data-coluna="${esc(c.id)}" data-tarefa="${esc(tarefa)}">Não iniciar ainda</button></p></li>`);
}

/**
 * O menu do "Mover para…" do card: as outras colunas. Escolher a de responsável que aciona (`acionaNaColuna`) abre a
 * mesma confirmação do card solto; as outras movem direto (como soltar). Precisa de você aparece desabilitada com o
 * porquê (o servidor recusa sem a pergunta, revisão 2 do PR #622).
 */
export function menuDeMover(cs: readonly ColunaDto[], t: Pick<TarefaDto, "id" | "titulo" | "status">, nomeDoBot = "o bot"): Html {
  const itens = cs.filter((c) => c.id !== t.status).map((c) => {
    const porque = porqueNaoRecebeCard(c, nomeDoBot);
    const nota = porque ?? (!c.responsavel ? null
      : acionaNaColuna(c) ? `${c.responsavelNome ?? "O responsável"} começa` : `Passa para ${c.responsavelNome ?? "o responsável"}`);
    const des = porque ? ` aria-disabled="true" title="${esc(porque)}"` : "";
    return `<button type="button" role="menuitem" class="qd-menu-it" data-act="tarefa-mover-para" data-coluna="${esc(c.id)}" data-tarefa="${esc(t.id)}"${des}>` +
      `${icone(c)}<span>${esc(c.nome)}</span>${nota ? `<small class="qd-menu-porque">${esc(nota)}</small>` : ""}</button>`;
  }).join("");
  return confiar(`<div class="qd-menu qd-menu-mover" role="menu" id="qd-menu" aria-label="${esc(`Mover ${t.titulo} para`)}">${itens}</div>`);
}

/**
 * O que vem depois do nome no cabeçalho: a passagem (com `agentes`, ADR-142), o ⋯ e, se aberto, o menu, o popover de
 * remover ou o da passagem (a confirmação do card solto fica na lista: `confirmacaoDeSoltar`).
 */
export function aposDoCabecalho(cs: readonly ColunaDto[], c: ColunaDto, ed: EdicaoDeColuna | null, n: number, nomeDoBot: string, agentes?: readonly AgenteDaPassagem[]): Html {
  const menuAberto = ed?.tipo === "menu" && ed.coluna === c.id;
  const passaAberta = ed?.tipo === "passagem" && ed.coluna === c.id;
  const bt = `<button type="button" class="qd-col-mais" data-act="col-menu" data-coluna="${esc(c.id)}" aria-label="${esc(`Opções de ${c.nome}`)}" aria-haspopup="menu" aria-expanded="${menuAberto}"${menuAberto ? ' aria-controls="qd-menu"' : ""}>${ICONE.mais}</button>`;
  const passa = agentes ? passagemDoCabecalho(c, passaAberta) : "";
  const dentro = menuAberto ? menuDaColuna(cs, c, nomeDoBot)
    : ed?.tipo === "remover" && ed.coluna === c.id && !naFolha(ed) ? popoverDeRemover(cs, c, n)
      : passaAberta && agentes ? popoverDePassagem(c, agentes) : "";
  return confiar(passa + bt + dentro);
}

/** O campo de renomear no lugar do nome: Enter grava, Esc desiste. */
export function campoDeRenomear(c: ColunaDto, erro?: string): Html {
  return confiar(`<form class="qd-col-ren" data-form="col-renomear" data-coluna="${esc(c.id)}">${icone(c)}` +
    `<label class="qd-sr" for="qd-col-in">${esc(`Novo nome de ${c.nome}`)}</label>` +
    `<input id="qd-col-in" class="qd-col-in" name="nome" value="${esc(c.nome)}" maxlength="${LIMITE_NOME_COLUNA}" autocomplete="off" required${erro ? ' aria-invalid="true" aria-describedby="qd-col-erro"' : ""}>` +
    `${erro ? `<span class="qd-col-erro" id="qd-col-erro" role="alert">${esc(erro)}</span>` : ""}</form>`);
}

/** A coluna nova: o nome e o grupo (obrigatório; decisão 5: no fim do grupo, ou à direita da coluna do menu). */
export function colunaNova(ed: Extract<EdicaoDeColuna, { tipo: "nova" }>): Html {
  const chips = GRUPOS.map((g) => `<label class="qd-chip-g"><input type="radio" name="grupo" value="${g}"${ed.grupo === g ? " checked" : ""} required>` +
    `${ICONE_DO_GRUPO[g]}<span>${esc(NOME_DO_GRUPO[g])}</span></label>`).join("");
  const id = naFolha(ed) ? "qd-col-nova-in-f" : "qd-col-nova-in";
  return confiar(`<form class="qd-col-nova-f" data-form="col-nova"${ed.depoisDe ? ` data-depois="${esc(ed.depoisDe)}"` : ""}>` +
    `<label class="qd-sr" for="${id}">Nome da coluna nova</label>` +
    `<input id="${id}" class="qd-col-in" name="nome" placeholder="Nome da coluna" maxlength="${LIMITE_NOME_COLUNA}" autocomplete="off" required${ed.erro ? ' aria-invalid="true"' : ""}>` +
    `<fieldset class="qd-chips-g"><legend class="qd-rotulo">Grupo</legend>${chips}</fieldset>` +
    `${ed.erro ? `<p class="qd-col-erro" role="alert">${esc(ed.erro)}</p>` : `<p class="qd-dica">${ed.grupo ? esc(FRASE_DO_GRUPO[ed.grupo]) : "Escolha o grupo"} · Enter cria · Esc cancela</p>`}` +
    `<div class="qd-pop-bts"><button type="button" class="qd-bt" data-act="col-fechar">Cancelar</button><button type="submit" class="qd-bt qd-bt-pri">Criar</button></div></form>`);
}

/** O "+" no fim do quadro (preso à direita com as tiras de Feito e Fechado). */
export function botaoDeNova(cheio: boolean): Html {
  const des = cheio ? ` aria-disabled="true" title="O quadro já tem ${LIMITE_COLUNAS} colunas."` : ' title="Nova coluna"';
  return confiar(`<div class="qd-col-novo qd-fixa" style="right: 0"><button type="button" class="qd-col-novo-bt" data-act="col-nova" aria-label="Nova coluna"${des}>${ICONE.novo}</button></div>`);
}

export const naFolha = (ed: EdicaoDeColuna | null): boolean => !!ed && (ed.tipo === "ordem" || ("naFolha" in ed && !!ed.naFolha));

/**
 * A folha do celular: as colunas por grupo, cada uma com a alça ≡ (arrastar dentro do grupo), subir e descer (os mesmos
 * passos do Alt ← →), o nome que renomeia ao tocar e o remover. No fim, a coluna nova.
 */
export function folhaDasColunas(cs: readonly ColunaDto[], ed: EdicaoDeColuna | null, contagem: Readonly<Record<string, number>>, nomeDoBot: string): Html {
  const grupos = GRUPOS.map((g) => {
    const linhas = cs.filter((c) => c.grupo === g).map((c) => {
      if (ed?.tipo === "renomear" && ed.coluna === c.id) return `<li class="qd-fo-l qd-fo-edit" data-coluna="${esc(c.id)}">${campoDeRenomear(c, ed.erro)}</li>`;
      if (ed?.tipo === "remover" && ed.coluna === c.id) return `<li class="qd-fo-l qd-fo-edit" data-coluna="${esc(c.id)}">${popoverDeRemover(cs, c, contagem[c.id] ?? 0)}</li>`;
      const sobe = passoDeMover(cs, c.id, "esquerda");
      const desce = passoDeMover(cs, c.id, "direita");
      const naoSai = porqueNaoRemove(cs, c.id, nomeDoBot);
      const bt = (act: string, ic: Html, rot: string, porque: string | null) =>
        `<button type="button" class="qd-fo-bt" data-act="${act}" data-coluna="${esc(c.id)}" aria-label="${esc(rot)}"${porque ? ` aria-disabled="true" title="${esc(porque)}"` : ""}>${ic}</button>`;
      const alca = c.fixa ? `<span class="qd-alca qd-alca-fixa" aria-hidden="true"></span>` : `<span class="qd-alca" data-arrasta data-coluna="${esc(c.id)}" aria-hidden="true">${ICONE.alca}</span>`;
      return `<li class="qd-fo-l" data-coluna="${esc(c.id)}" data-grupo="${g}">${alca}${icone(c)}` +
        `<button type="button" class="qd-fo-nome" data-act="col-renomear" data-coluna="${esc(c.id)}" aria-label="${esc(`Renomear ${c.nome}`)}">${esc(c.nome)}</button>` +
        `<span class="qd-n">${contagem[c.id] ?? 0}</span>` +
        bt("col-esquerda", ICONE.subir, `Subir ${c.nome}`, sobe.ok ? null : sobe.porque) +
        bt("col-direita", ICONE.descer, `Descer ${c.nome}`, desce.ok ? null : desce.porque) +
        bt("col-remover", ICONE.tirar, `Remover ${c.nome}`, naoSai) + `</li>`;
    }).join("");
    return `<section class="qd-fo-g" aria-label="${esc(NOME_DO_GRUPO[g])}"><h3 class="qd-rotulo">${esc(NOME_DO_GRUPO[g])}</h3><ul class="qd-fo-lista">${linhas}</ul></section>`;
  }).join("");
  const nova = ed?.tipo === "nova" ? colunaNova(ed) : `<button type="button" class="qd-bt qd-fo-nova" data-act="col-nova">${ICONE.novo}<span>Nova coluna</span></button>`;
  return confiar(`<div class="qd-folha-fundo" data-act="col-fechar-folha"></div><div class="qd-folha" role="dialog" aria-modal="true" aria-labelledby="qd-folha-tit">` +
    `<div class="qd-folha-cab"><h2 class="qd-folha-tit" id="qd-folha-tit" tabindex="-1">Ordem das colunas</h2><button type="button" class="qd-link" data-act="col-fechar-folha">Pronto</button></div>` +
    `<p class="qd-dica">Arraste pela alça, dentro do grupo.</p>` +
    `${grupos}${nova}</div>`);
}
