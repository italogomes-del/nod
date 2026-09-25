import type { SuaVezDto } from "../../src/contracts/api.ts";
import type { Proposta } from "../../src/contracts/conversa.ts";
import type { TIPOS_DISPENSAVEIS_ABERTOS, TipoDecisao } from "../../src/contracts/decisao.ts";
import type { Estado } from "../estado/reducer.ts";
import { pedidosAbertos } from "../lib/avisos.ts";
import { desdeDaParada, linhaNaoRodaram } from "../lib/execucao.ts";
import { chaveDoItem, contarFios, ehPergunta } from "../lib/perguntas.ts";
import { botao, esc, hora } from "../lib/render.ts";
import { emQuanto, foraDoArDesde, haQuanto, nadaEsperando } from "../lib/relogio.ts";
import { acoesComAcesso, linhasPrecisa } from "./rotina-precisa.ts";

type Item = SuaVezDto["itens"][number];

const TIPO_HUMANO: Record<TipoDecisao, string> = {
  aprovacao: "aprovação em lista",
  acesso: "pedido de acesso",
  retomar_turno: "turno interrompido",
  gate_rotina: "gate de rotina",
  perfil: "perfil proposto",
  rotina: "rotina proposta",
  rotina_atualizacao: "mudança de rotina",
  rotina_exclusao: "exclusão de rotina",
  pergunta: "pergunta",
  falta_de_dado: "falta um dado",
  permissao: "pedido de permissão",
};

const recusaAutomatica = (em: string): string => `recusa automática ${em}`;
const nadaMudaSemVoce = (em: string): string => `vence ${em} · nada muda sem você`;
const vence = (em: string): string => `vence ${em}`;

/** O pedido de acesso veio de uma rotina (payload.rotinaId): permitir a roda, e vencer a pausa. */
export function pedidoDeRotina(proposta: Proposta | null | undefined): boolean {
  return proposta?.payload.kind === "acesso" && proposta.payload.rotinaId !== undefined;
}

/**
 * definido em 2026-09-24: o relógio do card diz o que ACONTECE quando o prazo passa — antes era
 * "recusa automática" para todo tipo, inclusive onde nada é recusado. Aprovação (nada é executado) e
 * acesso (nada é concedido) recusam; o gate da rotina passa em branco; proposta vence e nada muda; o
 * resto só vence. Record exaustivo: um tipo novo não compila sem dizer o seu. Desde 2026-09-24 (emenda
 * da ADR-044) cada entrada recebe também o item: o acesso pedido por uma ROTINA não é só recusado —
 * vencido, ele pausa a rotina (varredor-expiracao.ts), e o relógio diz isso.
 */
const PRAZO_POR_TIPO: Record<TipoDecisao, (em: string, item: Item) => string> = {
  aprovacao: recusaAutomatica,
  acesso: (em, item) => (pedidoDeRotina(item.proposta) ? `a rotina pausa sozinha ${em}` : recusaAutomatica(em)),
  gate_rotina: (em) => `passa em branco ${em}`,
  perfil: nadaMudaSemVoce,
  rotina: nadaMudaSemVoce,
  rotina_atualizacao: nadaMudaSemVoce,
  rotina_exclusao: nadaMudaSemVoce,
  retomar_turno: vence,
  pergunta: vence,
  falta_de_dado: vence,
  permissao: vence,
};

/** Regras que fecham decisão sem pessoa (ADR-042), em frase curta; regra sem tradução cai no genérico. */
const REGRA_HUMANA: Readonly<Record<string, string>> = {
  "regra:rotina_nao_retoma": "fechado: a rotina não retoma",
  "regra:gemea_resolvida": "resolvido junto do pedido igual",
  "regra:retomada_substituida": "fechado: uma retomada mais nova tomou o lugar",
  "regra:aprovacao_permanente": "aprovado pela regra que você criou",
  // definido em 2026-09-24 (emenda da ADR-044, migração 0026): a sobra de um pedido de rotina repetido.
  "regra:pedido_de_acesso_unico": "fechado: o mesmo acesso já estava pedido",
};

/**
 * definido em 2026-09-24: o desfecho do card vencido em palavras — antes saía o enum com espaços
 * ("venceu expirou com alguem ciente"). Mesmas frases da mensagem do varredor
 * (src/adapters/fundo/varredor-expiracao.ts). Switch exaustivo: desfecho novo não compila sem rótulo.
 */
/**
 * definido em 2026-09-24 (ADR-048): aprovado e marcado, sem desfecho, rodando no gh do Mac = "aguardando
 * seu Mac" — o item sai quando o app nod da pessoa estiver aberto, ou vence como as decisões vencem.
 */
function tagDesfecho(i: { selecionado: boolean; desfecho: string | null; destino: { execucao?: "maquina" } }, aberta: boolean): string {
  if (i.desfecho) return `<span class="tag tag-cinza">${esc(i.desfecho.replaceAll("_", " "))}</span>`;
  if (!aberta && i.selecionado && i.destino.execucao === "maquina") return '<span class="tag tag-ambar" title="Abra o app nod no seu Mac com o gh logado">aguardando seu Mac</span>';
  return "";
}

export function rotuloVencido(d: Item["decisao"], agora: number): string {
  const venceu = `venceu ${haQuanto(Math.max(0, agora - Date.parse(d.prazoDecisaoEm)))}`;
  const desfecho = d.desfecho;
  if (!desfecho) return venceu;
  switch (desfecho.tipo) {
    case "expirou_sem_ninguem_ver":
      return `${venceu} · ninguém chegou a ver`;
    case "expirou_com_alguem_ciente":
      return `${venceu} · alguém viu, mas ninguém respondeu`;
    case "dispensada":
      return "dispensado por você";
    case "decidida_por_regra":
      return REGRA_HUMANA[desfecho.regra] ?? "fechado automaticamente";
    case "decidida":
      return "decidido";
  }
}

/**
 * definido em 2026-09-24: pedidos abertos iguais chegam dobrados num item só (montarFila,
 * src/domain/fila-frota.ts). O "×N" diz quantos são e que decidir aqui resolve todos — quem decide,
 * recusa ou dispensa este item fecha os outros (src/use-cases/fechar-gemeas.ts).
 */
export function marcaGemeas(item: Pick<Item, "gemeas"> | undefined): string {
  const n = (item?.gemeas.length ?? 0) + 1;
  if (n < 2) return "";
  const dica = `${n} pedidos iguais; decidir aqui resolve todos`;
  return `<span class="tag tag-ambar dec-gemeas" title="${esc(dica)}" aria-label="${esc(dica)}">×${n}</span>`;
}

/** Ids dobrados num "×N": o card de proposta de cada um não aparece sozinho na conversa. */
export function idsGemeas(estado: Estado): ReadonlySet<string> {
  return new Set((estado.suaVez?.itens ?? []).flatMap((i) => i.gemeas));
}

const JUSTIFICATIVA_PADRAO = "Veio de um lugar que guarda dado de aprendiz. Deixei desmarcado — só você pode marcar.";

/**
 * definido em 2026-09-24 (ADR-044): um clique concede E continua, e o botão diz isso. Pedido que veio
 * de uma rotina a roda de novo na hora; recusar pausa a rotina, porque sem o acesso ela pediria de
 * novo a cada disparo. Mesmos rótulos no card da conversa e em "Sua vez".
 */
export function rotulosAcesso(proposta: Proposta | null | undefined): { permitir: string; recusar: string } {
  return proposta?.payload.kind === "acesso" && proposta.payload.rotinaId
    ? { permitir: "Permitir e rodar agora", recusar: "Pausar rotina" }
    : { permitir: "Permitir e continuar", recusar: "Não permitir" };
}

/**
 * definido em 2026-09-24 (emenda da ADR-044): o card do acesso que uma rotina pediu diz que ela está
 * PARADA, desde quando, e — na linha de baixo (linhaNaoRodaram) — quais janelas não rodaram sem gastar
 * crédito. Mesmo cabeçalho no card da conversa e em "Sua vez".
 */
export function marcaRotinaParada(proposta: Proposta | null | undefined, parada: Item["rotinaParada"] | undefined, agora: number): string {
  if (!pedidoDeRotina(proposta)) return "";
  const desde = parada ? `<span class="mudo">${esc(desdeDaParada(parada, agora))}</span>` : "";
  return `<span class="tag tag-ambar dec-rotina-parada" title="a rotina não roda até você decidir; nenhuma janela parada gastou crédito">rotina parada</span>${desde}`;
}

/** Os nomes técnicos do pedido existem, mas atrás do disclosure: a frase é o que a pessoa lê. */
export function detalheAcesso(proposta: Proposta | null | undefined): string {
  if (proposta?.payload.kind !== "acesso" || proposta.payload.capacidades.length === 0) return "";
  const c = proposta.payload;
  const n = c.capacidades.length;
  return `<details class="ap-detalhe" data-disclosure="acesso-${esc(proposta.id)}"><summary>${n === 1 ? "Ver a ação pedida" : `Ver as ${n} ações pedidas`}</summary>
    <ul class="acesso-acoes">${c.capacidades.map((cap) => `<li><code>${esc(c.conector)}.${esc(cap)}</code></li>`).join("")}</ul>${c.naoPedido.length ? `<p class="mudo">Não pedido: ${esc(c.naoPedido.join(", "))}</p>` : ""}
  </details>`;
}

/**
 * "no Slack" a partir do slug do destino: `Conector.nome` é o rótulo que a PESSOA deu no registro e
 * já está no estado da web, então a tradução é do cliente e não exige campo novo no DTO. Sem
 * conector casado (slug some do registro, ou destino "computador"), cai no próprio slug — nunca
 * inventa nome.
 */
function ondeAcontece(conectores: Estado["conectores"], slug: string): string {
  if (slug === "computador") return "no computador do bot";
  return `no ${conectores.find((c) => c.slug === slug)?.nome ?? slug}`;
}

/** `slack.send_message` + os argumentos como vieram: o jargão fica atrás do disclosure, não some. */
function detalheTecnico(i: Item["itensAprovacao"][number]): string {
  const args = Object.entries(i.destino.argumentos ?? {});
  return `<details class="ap-detalhe"><summary>Ver detalhes</summary>
    <dl><dt>ferramenta</dt><dd>${esc(i.destino.conector)}.${esc(i.destino.ferramenta)}</dd>
    ${args.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(typeof v === "string" ? v : JSON.stringify(v))}</dd>`).join("")}</dl>
    <input class="texto-final" data-item-texto="${esc(i.id)}" value="${esc(i.textoFinal)}" aria-label="Editar o texto antes de enviar" ${i.destino.conector === "computador" ? 'readonly title="Ação vinculada à tela observada; para mudar, recuse e peça uma nova ação."' : ""} />
  </details>`;
}

/**
 * "Sempre permitir" (ADR-042): aprova agora e grava a regra para as próximas vezes. NUNCA some do
 * card — quando algo impede, aparece desabilitado com o motivo, porque botão ausente é
 * indistinguível de bug (ADR-029). Item sensível e destino 'computador' não entram na regra: o
 * primeiro porque o CHECK do banco recusaria honrá-la, o segundo porque a aprovação é vinculada à
 * ação cifrada (ADR-037). A regra vale para a FERRAMENTA inteira, qualquer destino — o título diz.
 */
function botaoSempre(item: Item, conectores: Estado["conectores"]): string {
  const elegiveis = item.itensAprovacao.filter((i) => !i.origemSensivel && i.destino.conector !== "computador");
  const nomes = [...new Set(elegiveis.map((i) => `${i.destino.conector}.${i.destino.ferramenta}`))];
  if (nomes.length === 0) {
    const motivo = item.itensAprovacao.some((i) => i.destino.conector === "computador")
      ? "Ação no computador é aprovada uma a uma: ela está presa à tela que o bot observou."
      : "Dado de aprendiz sempre passa por você — não dá para permitir de uma vez.";
    return botao("decidir-aprovacao-sempre", "Sempre permitir", { id: item.decisao.id, desabilitado: true, titulo: motivo });
  }
  const comNome = nomes.map((n) => {
    const [slug = "", ferramenta = ""] = n.split(".");
    const conector = conectores.find((c) => c.slug === slug)?.nome ?? slug;
    return `${ferramenta} no ${conector}`;
  });
  const rotulo = nomes.length === 1 ? `Sempre permitir ${esc(nomes[0] ?? "")}` : `Sempre permitir estas ${nomes.length} ferramentas`;
  return botao("decidir-aprovacao-sempre", rotulo, {
    id: item.decisao.id,
    titulo: `Vale para ${comNome.join(" e ")}, em qualquer destino, a partir do próximo turno. Você pode revogar quando quiser.`,
  });
}

/**
 * Aprovação em LISTA tipada (E4.1/E4.2) em DUAS densidades pelo número de itens: um item pergunta em
 * uma frase e dispensa a lista (é o caso mais comum); vários mantêm uma linha marcável cada, que é a
 * razão de a aprovação ser em lista. O nome técnico e os argumentos vão para um <details> — o que
 * acrescenta contexto, já que `destino.argumentos` nunca apareceu na tela.
 *
 * A exceção é o item de origem sensível: ele SAI do modo enxuto, nasce DESMARCADO com a
 * justificativa visível, e traz o contador de volta ao botão ("Pode fazer 1 de 2") — só aparece
 * contagem quando ela carrega informação. Marcar um sensível exige a pessoa (CHECK marcado_por).
 */
function renderAprovacao(item: Item, aberta: boolean, conectores: Estado["conectores"]): string {
  const itens = item.itensAprovacao;
  const marcados = itens.filter((i) => i.selecionado).length;
  const temSensivel = itens.some((i) => i.origemSensivel);
  const linha = (i: Item["itensAprovacao"][number]): string => `<li class="ap-item${i.origemSensivel ? " sensivel" : ""}">
    <label class="ap-marca"><input type="checkbox" data-item="${esc(i.id)}" ${i.selecionado ? "checked" : ""} ${aberta ? "" : "disabled"} /><span class="sr-only">Incluir: ${esc(i.textoFinal)}</span></label>
    <div class="ap-corpo">
      <div class="ap-oque">${esc(i.textoFinal)}</div>
      <div class="ap-onde">${esc(ondeAcontece(conectores, i.destino.conector))}</div>
      ${i.origemSensivel ? `<p class="justificativa">${esc(i.justificativa ?? JUSTIFICATIVA_PADRAO)}</p>` : ""}
      ${aberta ? detalheTecnico(i) : ""}
      ${tagDesfecho(i, aberta)}
    </div>
  </li>`;
  // Contagem só quando ela informa: com item sensível desmarcado, "1 de 2" é a própria explicação.
  const rotulo = temSensivel || marcados !== itens.length ? `Pode fazer <span data-contador>${marcados}</span> de ${itens.length}` : "Pode fazer";
  const acoes = aberta
    ? `<div class="acoes">${botao("decidir-aprovacao", rotulo, { classe: "pri", id: item.decisao.id })}${botao("decidir-aprovacao-nenhum", "Agora não", { id: item.decisao.id })}${botaoSempre(item, conectores)}</div>`
    : "";
  const unico = itens[0];
  // Um item e nada sensível: a pergunta já está na frase da decisão; a lista seria uma linha só.
  if (itens.length === 1 && unico && !unico.origemSensivel) {
    // definido em 2026-09-24: no computador a frase é genérica ("Ação no computador do bot") e quatro
    // pedidos seguidos pareciam o mesmo; a ação concreta ("Abrir no navegador: …") sai do "Ver
    // detalhes". Só no computador: lá o texto é somente leitura, então o que aparece é o que será feito.
    const acao = unico.destino.conector === "computador" && unico.textoFinal.trim() !== item.decisao.frase.trim() ? `<div class="ap-oque">${esc(unico.textoFinal)}</div>` : "";
    return `<div class="ap-unico">
      ${acao}<div class="ap-onde">${esc(ondeAcontece(conectores, unico.destino.conector))}</div>
      ${aberta ? detalheTecnico(unico) : ""}
      ${tagDesfecho(unico, aberta)}
    </div>
    ${aberta ? `<div class="acoes">${botao("decidir-aprovacao", "Pode fazer", { classe: "pri", id: item.decisao.id })}${botao("decidir-aprovacao-nenhum", "Agora não", { id: item.decisao.id })}${botaoSempre(item, conectores)}</div>` : ""}`;
  }
  return `<ul class="ap-lista">${itens.map(linha).join("")}</ul>${acoes}`;
}

function renderAcoes(item: Item, aberta: boolean, estado: Pick<Estado, "conectores" | "marketplace">, daMinhaConversa: boolean): string {
  const d = item.decisao;
  const conectores = estado.conectores;
  if (!aberta) return d.estado === "vencida" ? `<div class="acoes">${botao("reabrir", "Reabrir", { id: d.id })}</div>` : "";
  switch (d.tipo) {
    case "aprovacao":
    case "gate_rotina":
      return renderAprovacao(item, true, conectores);
    // definido em 2026-09-24 (ADR-045): quem não quer retomar dispensa — antes o card só saía vencendo.
    case "retomar_turno":
      return `<div class="acoes"><input class="resposta" data-resposta="${esc(d.id)}" placeholder="o que mudou (opcional)" />${botao("retomar", "Retomar com turno novo", { classe: "pri", id: d.id })}${botao("dispensar", "Dispensar", { id: d.id, titulo: "Tirar da tela sem retomar" })}</div>`;
    case "acesso": {
      const r = rotulosAcesso(item.proposta);
      return `<div class="acoes">${botao("decidir-proposta", r.permitir, { classe: "pri", id: d.id })}${botao("recusar-decisao", r.recusar, { id: d.id })}</div>`;
    }
    // definido em 2026-09-24 (emenda da ADR-044, "rotina nasce com o acesso"): a rotina que declara acessos
    // diz no botão que confirmar também libera; app por conectar vem primeiro (web/telas/rotina-precisa.ts).
    case "rotina": {
      const comAcesso = acoesComAcesso(item.proposta, estado, { confirmar: "decidir-proposta", recusar: "recusar-decisao", rotuloRecusar: "Deixar de lado" });
      if (comAcesso) return `<div class="acoes">${comAcesso.botoes}</div>${comAcesso.ajuda}`;
      return `<div class="acoes">${botao("decidir-proposta", "Confirmar", { classe: "pri", id: d.id })}${botao("recusar-decisao", "Recusar", { id: d.id })}</div>`;
    }
    case "perfil":
      return `<div class="acoes">${botao("decidir-proposta", "Confirmar", { classe: "pri", id: d.id })}${botao("recusar-decisao", "Recusar", { id: d.id })}</div>`;
    case "rotina_atualizacao": {
      const comAcesso = acoesComAcesso(item.proposta, estado, { confirmar: "decidir-proposta", recusar: "recusar-decisao", rotuloRecusar: "Manter como está" });
      if (comAcesso) return `<div class="acoes">${comAcesso.botoes}</div>${comAcesso.ajuda}`;
      return `<div class="acoes">${botao("decidir-proposta", "Aplicar mudança", { classe: "pri", id: d.id })}${botao("recusar-decisao", "Manter como está", { id: d.id })}</div>`;
    }
    // Verbo próprio: "Confirmar" não diz que o que se confirma é uma exclusão.
    case "rotina_exclusao":
      return `<div class="acoes">${botao("decidir-proposta", "Excluir rotina", { classe: "pri", id: d.id })}${botao("recusar-decisao", "Manter rotina", { id: d.id })}</div>`;
    // definido em 2026-09-24 (emenda da ADR-045): a pergunta se responde NA CONVERSA, no campo de sempre —
    // sem uma segunda caixa de texto aqui. O botão abre a conversa com o campo já respondendo a ela.
    // Exceção: a decisora designada (quem_destrava, EMENDA 1) não lê a conversa de outra pessoa (RLS
    // de conversas e mensagens), então para ela a resposta, em texto, continua aqui.
    case "pergunta":
    case "falta_de_dado":
    case "permissao":
      if (!daMinhaConversa) return `<div class="acoes"><input class="resposta" data-resposta="${esc(d.id)}" placeholder="${esc(`Responda à ${item.agenteNome}…`)}" aria-label="Sua resposta" />${botao("responder", "Responder", { classe: "pri", id: d.id })}</div>`;
      return `<div class="acoes">${botao("responder-na-conversa", "Responder na conversa", { classe: "pri", id: d.id, dados: { conversa: d.conversaId, agente: d.agenteId } })}</div>`;
  }
}

/**
 * Espelho EXATO de `podeDispensar` (src/use-cases/dispensar-decisao.ts) — a web só importa tipos de
 * src/. Vencida sai sempre; aberta, só TIPOS_DISPENSAVEIS_ABERTOS (as outras têm recusar próprio). Lê
 * o ESTADO, não a coluna: com o prazo estourado e o varredor ainda por passar (até 30 s) a coluna já
 * diz "vencido", mas o servidor recusaria (409) uma aprovação aberta — e "Limpar vencidos" pararia no
 * meio. As chaves do Record são exatamente as do contrato: faltar ou sobrar um tipo não compila.
 */
const DISPENSAVEIS_ABERTOS: Record<(typeof TIPOS_DISPENSAVEIS_ABERTOS)[number], true> = { pergunta: true, falta_de_dado: true, permissao: true, retomar_turno: true };

function dispensavel(item: Item): boolean {
  const d = item.decisao;
  return d.estado === "vencida" || ((d.estado === "pendente" || d.estado === "reaberta") && d.tipo in DISPENSAVEIS_ABERTOS);
}

function renderItem(item: Item, estado: Estado, naConversa = false): string {
  const d = item.decisao;
  const aberta = item.estadoColuna !== "vencido";
  const relogio = aberta ? `aguardando ${haQuanto(item.aguardandoHaMs)} · ${PRAZO_POR_TIPO[d.tipo](emQuanto(item.recusaAutomaticaEmMs), item)}` : rotuloVencido(d, estado.agora);
  const parada = d.tipo === "acesso" && aberta ? { marca: marcaRotinaParada(item.proposta, item.rotinaParada, estado.agora), linha: linhaNaoRodaram(item.rotinaParada, estado.agora) } : { marca: "", linha: "" };
  // O "Retomar" aberto já tem "Dispensar" nas ações: o × repetiria o mesmo gesto no mesmo card.
  const pergunta = aberta && ehPergunta(d.tipo);
  const daMinhaConversa = d.ownerId === estado.sessao?.pessoaId;
  const fechar = dispensavel(item) && !(aberta && d.tipo === "retomar_turno")
    ? botao("dispensar", "×", pergunta ? { classe: "dec-fechar", id: d.id, titulo: "Deixar pra lá: fecha sem responder", aria: "Deixar esta pergunta pra lá" } : { classe: "dec-fechar", id: d.id, titulo: "Tirar da tela", aria: "Dispensar este pedido" })
    : "";
  // A pergunta aberta já abre a conversa pelo "Responder na conversa": "abrir conversa" repetiria o gesto.
  const conversa = pergunta && daMinhaConversa ? undefined : estado.frota?.agentes.find((a) => a.id === d.agenteId);
  return `<li class="decisao dec-${esc(item.estadoColuna)} tipo-${esc(d.tipo)}" data-decisao="${esc(d.id)}">
    <div class="dec-cab"><span class="tag ${aberta ? "tag-ambar" : "tag-cinza"}">${esc(TIPO_HUMANO[d.tipo])}</span>${parada.marca}${marcaGemeas(item)}<b>${esc(item.agenteNome)}</b><span class="mudo">${esc(relogio)}</span>${item.estadoColuna === "reaberto" ? '<span class="tag tag-ambar">reaberta</span>' : ""}${fechar}</div>
    <div class="dec-frase">${esc(d.frase)}</div>${parada.linha}
    ${d.tipo === "acesso" && aberta ? detalheAcesso(item.proposta) : ""}
    ${(d.tipo === "rotina" || d.tipo === "rotina_atualizacao") && aberta ? linhasPrecisa(item.proposta, estado) : ""}
    ${d.tipo === "aprovacao" && !aberta ? renderAprovacao(item, false, estado.conectores) : ""}
    ${renderAcoes(item, aberta, estado, daMinhaConversa)}
    ${!naConversa && conversa ? `<div class="dec-rodape">${botao("abrir-conversa", "abrir conversa", { classe: "sm", dados: { conversa: d.conversaId, agente: d.agenteId } })}</div>` : ""}
  </li>`;
}

/**
 * Decisões abertas por agente (definido em 2026-09-18): o sinal que substitui a entrada "Sua vez" no
 * rail. A fila global deixou de ser porta de entrada — quem decide é a conversa
 * (`renderDecisoesDaConversa`), então o que falta é LEMBRAR onde há decisão parada. Vencida não conta:
 * ela não pede ação, e um badge que nunca zera deixa de ser sinal. Conta GRUPOS (definido em
 * 2026-09-24): o servidor já dobra os pedidos iguais num item "×N" (montarFila), e aviso de queda
 * (`incidentes`) não é decisão. Pergunta também não entra aqui (emenda da ADR-045): ela tem o selo
 * próprio, `perguntasPorAgente`.
 */
export function abertasPorAgente(estado: Estado): Map<string, number> {
  return contarAbertas(estado, (tipo) => !ehPergunta(tipo));
}

/**
 * Perguntas abertas por agente (definido em 2026-09-24, emenda da ADR-045): o ponto azul do mascote na
 * barra lateral e o subtítulo "esperando sua resposta" — separados do ponto âmbar das decisões, porque
 * pergunta se responde conversando e decisão se decide num botão.
 */
export function perguntasPorAgente(estado: Estado): Map<string, number> {
  return contarAbertas(estado, ehPergunta);
}

/** definido em 2026-09-24 (fio da pergunta): conta FIOS — as rodadas de uma pergunta são uma espera só. */
function contarAbertas(estado: Estado, conta: (tipo: TipoDecisao) => boolean): Map<string, number> {
  const fios = new Map<string, Set<string>>();
  for (const item of estado.suaVez?.itens ?? []) {
    if (item.estadoColuna === "vencido" || !conta(item.decisao.tipo)) continue;
    fios.set(item.decisao.agenteId, (fios.get(item.decisao.agenteId) ?? new Set<string>()).add(chaveDoItem(item)));
  }
  return new Map([...fios].map(([agenteId, chaves]) => [agenteId, chaves.size]));
}

/** O subtítulo do agente que perguntou, no lugar do título (definido em 2026-09-24, emenda da ADR-045). */
export const SUBTITULO_ESPERANDO = '<span class="sub-esperando">esperando sua resposta</span>';

/**
 * definido em 2026-09-24 (emenda da ADR-044): o agente com uma rotina parada por falta de acesso — um
 * pedido de acesso ABERTO que veio de rotina — diz "rotina parada" em âmbar no lugar do título. Vencido
 * não conta: o vencimento já pausou a rotina, e a lista de rotinas diz "pausada".
 */
export function rotinasParadasPorAgente(estado: Estado): ReadonlySet<string> {
  return new Set((estado.suaVez?.itens ?? []).filter((i) => i.estadoColuna !== "vencido" && pedidoDeRotina(i.proposta)).map((i) => i.decisao.agenteId));
}

export const SUBTITULO_ROTINA_PARADA = '<span class="sub-rotina-parada">rotina parada</span>';

const SINO = '<svg width="17" height="17" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11V7a4 4 0 0 1 8 0v4l1 1.5H3z"/><path d="M6.5 14a1.6 1.6 0 0 0 3 0"/></svg>';

/**
 * Sino ao lado do título da sidebar: some quando não há nada aberto. definido em 2026-09-24 (revisão da
 * interface): substituiu a faixa âmbar, que ocupava o topo da lista inteira; o ponto do mascote na
 * linha do agente continua dizendo QUEM espera. Um pedido: o sino leva à conversa dele (`itens` já vem ordenado
 * pelo servidor, ADR-007). Vários: leva à fila completa e mostra a contagem. Conta "pedidos" —
 * decisões e perguntas —, porque as duas esperam pela pessoa (emenda da ADR-045).
 */
export function renderChamada(estado: Estado): string {
  // definido em 2026-09-24 ("aviso no Mac"): a mesma lista que o número do Dock conta (web/lib/avisos.ts).
  const abertos = pedidosAbertos(estado.suaVez);
  const primeiro = abertos[0];
  if (!primeiro) return "";
  const d = primeiro.decisao;
  if (abertos.length === 1) {
    const texto = `${primeiro.agenteNome} precisa de você`;
    return `<button type="button" class="sino" data-act="abrir-conversa" data-conversa="${esc(d.conversaId)}" data-agente="${esc(d.agenteId)}" aria-label="${esc(texto)}" title="${esc(texto)}">${SINO}<span class="sino-ponto" aria-hidden="true"></span></button>`;
  }
  const texto = `${abertos.length} pedidos esperando por você`;
  return `<button type="button" class="sino" data-act="navegar" data-tela="sua-vez" aria-label="${esc(texto)}" title="${esc(texto)}">${SINO}<span class="sino-cont" aria-hidden="true">${abertos.length}</span></button>`;
}

const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

/**
 * A frase do aviso de queda (ADR-045). Não é decisão: diz o que aconteceu, o que NÃO foi feito e o que
 * segue sozinho. Rotina interrompida não se retoma (a próxima janela roda); conversa tem o seu Retomar.
 */
export function fraseDoIncidente(i: SuaVezDto["incidentes"][number]): string {
  const quando = i.voltouEm === null ? `Seu Mac está sem contato desde ${hora(i.comecouEm)}.` : `Seu Mac ficou sem contato entre ${hora(i.comecouEm)} e ${hora(i.voltouEm)}.`;
  const partes = [i.rotinas > 0 ? plural(i.rotinas, "execução de rotina", "execuções de rotina") : "", i.conversas > 0 ? plural(i.conversas, "resposta em conversa", "respostas em conversa") : ""].filter(Boolean);
  if (partes.length === 0) return quando;
  const verbo = i.rotinas + i.conversas === 1 ? "não concluiu" : "não concluíram";
  const quem = i.agentes.length ? ` (${i.agentes.join(", ")})` : "";
  const segue = i.rotinas === 0 ? " e dá para retomar pela conversa" : i.conversas === 0 ? " e as próximas seguem agendadas" : ": as rotinas seguem agendadas e a conversa pode ser retomada";
  return `${quando} ${partes.join(" e ")} ${verbo}${quem}; nada foi reenviado${segue}.`;
}

/**
 * definido em 2026-09-24 (ADR-045): incidente não é decisão. Um aviso por queda, sob a faixa de
 * decisões e em estilo neutro de STATUS (não o âmbar de "precisa de você"), com "Entendi".
 */
export function renderIncidentes(estado: Estado): string {
  return (estado.suaVez?.incidentes ?? [])
    .map((i) => `<div class="aviso-sistema" role="status" data-incidente="${esc(i.id)}"><span class="av-ic" aria-hidden="true">◑</span><span class="av-txt">${esc(fraseDoIncidente(i))}</span>${botao("dispensar-incidente", "Entendi", { classe: "link sm", id: i.id })}</div>`)
    .join("");
}

/**
 * definido em 2026-09-24: vencidos recolhidos num <details> só, depois dos abertos. medido em
 * 2026-09-24 (tela do dono): uma conversa tinha 15 cards cinza de "turno interrompido" vencidos em
 * volta de 5 abertos. ADR-007 continua valendo: nenhum some — todos ficam lá dentro com o seu
 * Reabrir. "Limpar vencidos" (a partir de dois, #46) fica ao lado do resumo e FORA do <summary>,
 * senão o clique também abriria e fecharia a lista.
 */
function renderVencidos(vencidos: readonly Item[], estado: Estado, naConversa: boolean, chave: string): string {
  const n = vencidos.length;
  if (n === 0) return "";
  const ids = vencidos.filter(dispensavel).map((i) => i.decisao.id);
  const limpar = ids.length > 1 ? botao("limpar-vencidos", `Limpar vencidos (${ids.length})`, { classe: "sm dec-limpar", dados: { ids: ids.join(",") } }) : "";
  return `<div class="dec-vencidos"><details class="dec-vencidos-lista" data-disclosure="vencidos-${esc(chave)}"><summary>${n === 1 ? "1 pedido vencido" : `${n} pedidos vencidos`} · ver</summary><ul class="lista">${vencidos.map((i) => renderItem(i, estado, naConversa)).join("")}</ul></details>${limpar}</div>`;
}

/**
 * Pedidos desta conversa, onde a pessoa decide sem sair do chat. Os pedidos iguais já vêm dobrados pelo
 * servidor num item "×N" (definido em 2026-09-24; antes a web só escondia as gêmeas de acesso e o ⚑
 * continuava contando cada uma); os vencidos ficam recolhidos no fim. Pergunta não vira card aqui
 * (emenda da ADR-045): ela É a fala do agente na conversa, e o balão mostra onde está — aberta,
 * respondida ou vencida com o seu Reabrir (web/telas/pergunta.ts).
 */
export function renderDecisoesDaConversa(estado: Estado, conversaId: string, propostas: ReadonlySet<string>): string {
  const itens = estado.suaVez?.itens.filter((item) => item.decisao.conversaId === conversaId && !propostas.has(item.decisao.id) && !ehPergunta(item.decisao.tipo)) ?? [];
  if (!itens.length) return "";
  const abertos = itens.filter((item) => item.estadoColuna !== "vencido");
  const pedindo = abertos.length ? `<h2>Preciso da sua decisão para continuar</h2><p>Você pode resolver aqui, sem sair da conversa.</p><ul class="lista">${abertos.map((item) => renderItem(item, estado, true)).join("")}</ul>` : "";
  return `<section class="decisoes-chat" aria-label="Decisões nesta conversa">${pedindo}${renderVencidos(itens.filter((item) => item.estadoColuna === "vencido"), estado, true, conversaId)}</section>`;
}

/**
 * "Sua vez" por pessoa (ADR-007): mais antiga no topo, reaberta volta ao topo, vencida em cinza com
 * reabrir e nunca suprimida — recolhida no fim desde 2026-09-24; "Nada esperando por você · última
 * decisão …" quando vazia; motor fora do ar entra como item ESCRITO (E3.3).
 */
export function renderSuaVez(estado: Estado): string {
  const sv = estado.suaVez;
  if (!sv) return `<section class="tela"><header class="tela-cab"><h1>Sua vez</h1></header><p class="mudo">carregando…</p></section>`;
  const fora = sv.foraDoAr.map((f) => `<li class="decisao dec-fora"><span class="tag tag-cinza">fora do ar</span> ${esc(foraDoArDesde(f.nome, f.desde))}</li>`).join("");
  const abertos = sv.itens.filter((i) => i.estadoColuna !== "vencido");
  // O número do título conta fios (definido em 2026-09-24): as rodadas de uma pergunta são uma espera só.
  const esperando = contarFios(abertos);
  return `<section class="tela tela-sua-vez">
    <header class="tela-cab"><h1>Sua vez${esperando ? ` · ${esperando}` : ""}</h1><span class="chip">mais antiga no topo · vencidas recolhidas no fim</span></header>
    ${sv.vazio && sv.foraDoAr.length === 0 ? `<p class="vazio">${esc(nadaEsperando(sv.ultimaDecisaoEm, estado.agora))}</p>` : ""}
    <ul class="lista">${fora}${abertos.map((i) => renderItem(i, estado)).join("")}</ul>
    ${renderVencidos(sv.itens.filter((i) => i.estadoColuna === "vencido"), estado, false, "sua-vez")}
  </section>`;
}
