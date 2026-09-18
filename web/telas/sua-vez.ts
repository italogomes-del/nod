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
  pergunta: "pergunta",
  falta_de_dado: "falta um dado",
  permissao: "pedido de permissão",
};

/**
 * Item de aprovação em LISTA tipada (E4.1/E4.2): checkboxes com contador ao vivo, item de origem
 * sensível nasce DESMARCADO com a justificativa em primeira pessoa, texto editável por item (E4.3).
 * Marcar um sensível exige a pessoa — é ela quem está clicando (CHECK marcado_por no banco).
 */
function renderAprovacao(item: Item, aberta: boolean): string {
  const itens = item.itensAprovacao;
  const marcados = itens.filter((i) => i.selecionado).length;
  const linhas = itens
    .map(
      (i) => `<li class="ap-item${i.origemSensivel ? " sensivel" : ""}">
        <label><input type="checkbox" data-item="${esc(i.id)}" ${i.selecionado ? "checked" : ""} ${aberta ? "" : "disabled"} /> <b>${i.idx + 1}.</b> <code>${esc(i.destino.conector)}.${esc(i.destino.ferramenta)}</code></label>
        <input class="texto-final" data-item-texto="${esc(i.id)}" value="${esc(i.textoFinal)}" ${aberta ? "" : "disabled"} ${i.destino.conector === "computador" ? 'readonly title="Ação vinculada à tela observada; para mudar, recuse e peça uma nova ação."' : ""} />
        ${i.origemSensivel ? `<div class="justificativa">${esc(i.justificativa ?? "veio de um conector que toca dado de aprendiz: desmarquei; só você marca.")}</div>` : ""}
        ${i.desfecho ? `<span class="tag tag-cinza">${esc(i.desfecho.replaceAll("_", " "))}</span>` : ""}
      </li>`,
    )
    .join("");
  return `<ul class="ap-lista">${linhas}</ul>
    ${aberta ? `<div class="acoes">${botao("decidir-aprovacao", `Aprovar <span data-contador>${marcados}</span> de ${itens.length}`, { classe: "pri", id: item.decisao.id })}${botao("decidir-aprovacao-nenhum", "Não aprovar nada", { id: item.decisao.id })}</div>` : ""}`;
}

function renderAcoes(item: Item, aberta: boolean): string {
  const d = item.decisao;
  if (!aberta) return d.estado === "vencida" ? `<div class="acoes">${botao("reabrir", "Reabrir", { id: d.id })}</div>` : "";
  switch (d.tipo) {
    case "aprovacao":
    case "gate_rotina":
      return renderAprovacao(item, true);
    case "retomar_turno":
      return `<div class="acoes"><input class="resposta" data-resposta="${esc(d.id)}" placeholder="o que mudou (opcional)" />${botao("retomar", "Retomar com turno novo", { classe: "pri", id: d.id })}</div>`;
    case "acesso":
      return `<div class="acoes">${botao("decidir-proposta", "Permitir acesso", { classe: "pri", id: d.id })}${botao("recusar-decisao", "Não permitir", { id: d.id })}</div>`;
    case "perfil":
    case "rotina":
      return `<div class="acoes">${botao("decidir-proposta", "Confirmar", { classe: "pri", id: d.id })}${botao("recusar-decisao", "Recusar", { id: d.id })}</div>`;
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
    ${d.tipo === "aprovacao" && !aberta ? renderAprovacao(item, false) : ""}
    ${renderAcoes(item, aberta)}
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

export function renderDecisoesDaConversa(estado: Estado, conversaId: string, propostas: ReadonlySet<string>): string {
  const itens = estado.suaVez?.itens.filter((item) => item.decisao.conversaId === conversaId && !propostas.has(item.decisao.id)) ?? [];
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
