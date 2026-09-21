import type { SuaVezDto } from "../../src/contracts/api.ts";
import type { Estado } from "../estado/reducer.ts";
import { botao, esc } from "../lib/render.ts";
import { emQuanto, foraDoArDesde, haQuanto, nadaEsperando } from "../lib/relogio.ts";

type Item = SuaVezDto["itens"][number];

const TIPO_HUMANO: Record<Item["decisao"]["tipo"], string> = {
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

const JUSTIFICATIVA_PADRAO = "Veio de um lugar que guarda dado de aprendiz. Deixei desmarcado — só você pode marcar.";

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
      ${i.desfecho ? `<span class="tag tag-cinza">${esc(i.desfecho.replaceAll("_", " "))}</span>` : ""}
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
    return `<div class="ap-unico">
      <div class="ap-onde">${esc(ondeAcontece(conectores, unico.destino.conector))}</div>
      ${aberta ? detalheTecnico(unico) : ""}
      ${unico.desfecho ? `<span class="tag tag-cinza">${esc(unico.desfecho.replaceAll("_", " "))}</span>` : ""}
    </div>
    ${aberta ? `<div class="acoes">${botao("decidir-aprovacao", "Pode fazer", { classe: "pri", id: item.decisao.id })}${botao("decidir-aprovacao-nenhum", "Agora não", { id: item.decisao.id })}${botaoSempre(item, conectores)}</div>` : ""}`;
  }
  return `<ul class="ap-lista">${itens.map(linha).join("")}</ul>${acoes}`;
}

function renderAcoes(item: Item, aberta: boolean, conectores: Estado["conectores"]): string {
  const d = item.decisao;
  if (!aberta) return d.estado === "vencida" ? `<div class="acoes">${botao("reabrir", "Reabrir", { id: d.id })}</div>` : "";
  switch (d.tipo) {
    case "aprovacao":
    case "gate_rotina":
      return renderAprovacao(item, true, conectores);
    case "retomar_turno":
      return `<div class="acoes"><input class="resposta" data-resposta="${esc(d.id)}" placeholder="o que mudou (opcional)" />${botao("retomar", "Retomar com turno novo", { classe: "pri", id: d.id })}</div>`;
    case "acesso":
      return `<div class="acoes">${botao("decidir-proposta", "Permitir acesso", { classe: "pri", id: d.id })}${botao("recusar-decisao", "Não permitir", { id: d.id })}</div>`;
    case "perfil":
    case "rotina":
      return `<div class="acoes">${botao("decidir-proposta", "Confirmar", { classe: "pri", id: d.id })}${botao("recusar-decisao", "Recusar", { id: d.id })}</div>`;
    case "rotina_atualizacao":
      return `<div class="acoes">${botao("decidir-proposta", "Aplicar mudança", { classe: "pri", id: d.id })}${botao("recusar-decisao", "Manter como está", { id: d.id })}</div>`;
    // Verbo próprio: "Confirmar" não diz que o que se confirma é uma exclusão.
    case "rotina_exclusao":
      return `<div class="acoes">${botao("decidir-proposta", "Excluir rotina", { classe: "pri", id: d.id })}${botao("recusar-decisao", "Manter rotina", { id: d.id })}</div>`;
    case "pergunta":
    case "falta_de_dado":
    case "permissao":
      return `<div class="acoes"><input class="resposta" data-resposta="${esc(d.id)}" placeholder="${esc(d.tipo === "falta_de_dado" ? "o dado que faltava" : "sua resposta em texto")}" />${botao("responder", "Responder e retomar", { classe: "pri", id: d.id })}</div>`;
  }
}

function renderItem(item: Item, estado: Estado, naConversa = false): string {
  const d = item.decisao;
  const aberta = item.estadoColuna !== "vencido";
  const relogio = aberta ? `aguardando ${haQuanto(item.aguardandoHaMs)} · recusa automática ${emQuanto(item.recusaAutomaticaEmMs)}` : `venceu ${d.desfecho ? esc(d.desfecho.tipo.replaceAll("_", " ")) : ""}`;
  const conversa = estado.frota?.agentes.find((a) => a.id === d.agenteId);
  return `<li class="decisao dec-${esc(item.estadoColuna)} tipo-${esc(d.tipo)}" data-decisao="${esc(d.id)}">
    <div class="dec-cab"><span class="tag ${aberta ? "tag-ambar" : "tag-cinza"}">${esc(TIPO_HUMANO[d.tipo])}</span><b>${esc(item.agenteNome)}</b><span class="mudo">${relogio}</span>${item.estadoColuna === "reaberto" ? '<span class="tag tag-ambar">reaberta</span>' : ""}</div>
    <div class="dec-frase">${esc(d.frase)}</div>
    ${d.tipo === "aprovacao" && !aberta ? renderAprovacao(item, false, estado.conectores) : ""}
    ${renderAcoes(item, aberta, estado.conectores)}
    ${!naConversa && conversa ? `<div class="dec-rodape">${botao("abrir-conversa", "abrir conversa", { classe: "sm", dados: { conversa: d.conversaId, agente: d.agenteId } })}</div>` : ""}
  </li>`;
}

/**
 * Decisões abertas por agente (definido em 2026-09-18): o sinal que substitui a entrada "Sua vez" no
 * rail. A fila global deixou de ser porta de entrada — quem decide é a conversa
 * (`renderDecisoesDaConversa`), então o que falta é LEMBRAR onde há decisão parada. Vencida não conta:
 * ela não pede ação, e um badge que nunca zera deixa de ser sinal.
 */
export function abertasPorAgente(estado: Estado): Map<string, number> {
  const por = new Map<string, number>();
  for (const item of estado.suaVez?.itens ?? []) {
    if (item.estadoColuna === "vencido") continue;
    por.set(item.decisao.agenteId, (por.get(item.decisao.agenteId) ?? 0) + 1);
  }
  return por;
}

/**
 * Faixa de chamada no topo da sidebar: some quando não há nada aberto, nomeia UM agente quando é um
 * só (o nome é o que faz voltar para a conversa) e conta quando são vários. Clicar leva à conversa do
 * mais antigo — `itens` já vem ordenado pelo servidor (ADR-007), então o primeiro aberto é ele.
 */
export function renderChamada(estado: Estado): string {
  const abertos = (estado.suaVez?.itens ?? []).filter((i) => i.estadoColuna !== "vencido");
  const primeiro = abertos[0];
  if (!primeiro) return "";
  const d = primeiro.decisao;
  const texto =
    abertos.length === 1
      ? `<b>${esc(primeiro.agenteNome)}</b> precisa de você`
      : `<b>${abertos.length} decisões</b> esperando por você`;
  return `<button class="chamada" data-act="abrir-conversa" data-conversa="${esc(d.conversaId)}" data-agente="${esc(d.agenteId)}" aria-label="Abrir a decisão mais antiga, com ${esc(primeiro.agenteNome)}">
    <span class="ch-ic" aria-hidden="true">⚑</span><span class="ch-txt">${texto}</span><span class="ch-seta" aria-hidden="true">→</span>
  </button>${abertos.length > 1 ? `<button class="chamada-todas" data-act="navegar" data-tela="sua-vez">ver todas</button>` : ""}`;
}

/**
 * definido em 2026-09-21: pedido de acesso repetido aparecia uma vez POR decisão, todas com a mesma
 * frase e nada distinguindo qual estava viva — a pessoa resolvia uma e as gêmeas continuavam na tela.
 * Colapsa por tipo+frase e mostra a mais antiga (a que vence primeiro, ADR-007); só 'acesso', porque
 * aprovação e pedir_a_pessoa repetem a frase legitimamente com itens/respostas diferentes.
 */
function semGemeas(itens: Item[]): Item[] {
  const vistas = new Set<string>();
  return itens.filter((item) => {
    if (item.decisao.tipo !== "acesso") return true;
    const chave = `${item.decisao.tipo}\u0000${item.decisao.frase}`;
    if (vistas.has(chave)) return false;
    vistas.add(chave);
    return true;
  });
}

export function renderDecisoesDaConversa(estado: Estado, conversaId: string, propostas: ReadonlySet<string>): string {
  const itens = semGemeas(estado.suaVez?.itens.filter((item) => item.decisao.conversaId === conversaId && !propostas.has(item.decisao.id)) ?? []);
  if (!itens.length) return "";
  const pendentes = itens.some((item) => item.estadoColuna !== "vencido");
  return `<section class="decisoes-chat" aria-label="Decisões nesta conversa"><h2>${pendentes ? "Preciso da sua decisão para continuar" : "Pedidos vencidos"}</h2><p>Você pode resolver aqui, sem sair da conversa.</p><ul class="lista">${itens.map((item) => renderItem(item, estado, true)).join("")}</ul></section>`;
}

/**
 * "Sua vez" por pessoa (ADR-007): mais antiga no topo, reaberta volta ao topo, vencida em cinza com
 * reabrir e nunca suprimida; "Nada esperando por você · última decisão …" quando vazia; motor fora do
 * ar entra como item ESCRITO (E3.3).
 */
export function renderSuaVez(estado: Estado): string {
  const sv = estado.suaVez;
  if (!sv) return `<section class="tela"><header class="tela-cab"><h1>Sua vez</h1></header><p class="mudo">carregando…</p></section>`;
  const fora = sv.foraDoAr.map((f) => `<li class="decisao dec-fora"><span class="tag tag-cinza">fora do ar</span> ${esc(foraDoArDesde(f.nome, f.desde))}</li>`).join("");
  const abertos = sv.itens.filter((i) => i.estadoColuna !== "vencido").length;
  return `<section class="tela tela-sua-vez">
    <header class="tela-cab"><h1>Sua vez${abertos ? ` · ${abertos}` : ""}</h1><span class="chip">mais antiga no topo · vencida fica em cinza</span></header>
    ${sv.vazio && sv.foraDoAr.length === 0 ? `<p class="vazio">${esc(nadaEsperando(sv.ultimaDecisaoEm, estado.agora))}</p>` : ""}
    <ul class="lista">${fora}${sv.itens.map((i) => renderItem(i, estado)).join("")}</ul>
  </section>`;
}
