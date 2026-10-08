import type { CategoriaRelato, Relato, TipoRelato } from "../../src/contracts/relato.ts";
import type { Estado } from "../estado/reducer.ts";
import { dataHora, esc } from "../lib/render.ts";

const ROTULOS: Record<CategoriaRelato, string> = {
  resposta_errada: "Respondeu errado",
  nao_fez_o_pedido: "Não fez o que pedi",
  travou_ou_parou: "Travou ou parou no meio",
  lento: "Demorou demais",
  interface: "Problema na tela",
  outro: "Outra coisa",
};

/** definido em 2026-10-07 (0062, a caixa do Nod): o que o relato é. */
const TIPO_HUMANO: Record<TipoRelato, string> = { bug: "Bug", melhoria: "Melhoria", duvida: "Dúvida" };
const FILTROS: readonly { id: "todos" | TipoRelato; nome: string }[] = [
  { id: "todos", nome: "Todos" },
  { id: "bug", nome: "Bugs" },
  { id: "melhoria", nome: "Melhorias" },
  { id: "duvida", nome: "Dúvidas" },
];

/** Um par rótulo/valor só aparece quando há valor: linha vazia não ajuda a investigar. */
function campo(rotulo: string, valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === "") return "";
  return `<div class="it"><b>${esc(rotulo)}</b>${esc(String(valor))}</div>`;
}

/**
 * Os quatro sinais write-ahead do ADR-009 dizem até onde o protocolo chegou — é o metadado que
 * separa "nem tentou" de "tentou e o modelo não respondeu". Mostrados como a sequência que são.
 */
function sinais(r: Relato): string {
  const s = r.metadados.sinais;
  if (!s) return "";
  const marcas = [
    ["tentou", s.attempted],
    ["recusado", s.rejected],
    ["prompt enviado", s.promptSubmitted],
    ["produziu saída", s.producedOutput],
  ] as const;
  const tags = marcas
    .map(([nome, ligado]) => `<span class="tag ${ligado ? "tag-ok" : "tag-cinza"}">${esc(nome)}</span>`)
    .join("");
  return `<div class="it"><b>sinais</b><span class="meta-tags">${tags}</span></div>`;
}

function renderRelato(r: Relato): string {
  const m = r.metadados;
  const falha = m.motivoFalha ?? m.motivoInterrupcao;
  const anexo = r.alcance === "janela" ? `${r.mensagensAnexadas} ${r.mensagensAnexadas === 1 ? "mensagem" : "mensagens"}` : "só a mensagem";
  const diag = r.diagnostico;
  // 0062: o contado ao Nod tem título (só a dona vê) e não tem categoria de falha; o do botão segue como era.
  const doNod = r.origem === "nod";
  const titulo = doNod ? r.titulo ?? TIPO_HUMANO[r.tipo] : ROTULOS[r.categoria];
  return `<details class="card-prop" data-disclosure="relato-${esc(r.id)}" data-tipo="${esc(r.tipo)}">
    <summary>
      <span class="tag tag-cinza">${esc(TIPO_HUMANO[r.tipo])}</span>
      <b>${esc(titulo)}</b>
      <span class="tag tag-cinza">${esc(doNod ? "conversa com o Nod" : anexo)}</span>
      ${falha ? `<span class="tag tag-ambar">${esc(falha.replaceAll("_", " "))}</span>` : ""}
      <time>${esc(dataHora(r.criadoEm))}</time>
    </summary>
    ${doNod && r.resumo ? `<div class="it"><b>o que você contou</b>${esc(r.resumo)}${r.resumo.length >= 160 ? "…" : ""}</div>` : ""}
    ${doNod && r.categoria !== "outro" ? campo("categoria", ROTULOS[r.categoria]) : ""}
    ${campo("estado do turno", m.estadoTurno)}
    ${campo("origem", m.origemTurno)}
    ${sinais(r)}
    ${campo("modelo", m.modelo)}
    ${campo("harness", m.harness)}
    ${campo("executor", m.executor)}
    ${campo("custo (US$)", m.custoUsd)}
    ${campo("reenvios", m.reenvios)}
    ${campo("confiança da mensagem", m.confiancaMensagem)}
    ${m.mensagemParcial ? '<div class="it"><b>fala</b>parcial (turno interrompido no meio)</div>' : ""}
    ${campo("versão do app", m.versaoApp)}
    ${campo("correlation id", m.correlationId)}
    ${campo("máquina", m.machineId)}
    ${diag?.erroCru ? `<div class="it"><b>erro do fornecedor</b><code>${esc(diag.erroCru)}</code></div>` : ""}
    ${diag && diag.ferramentas.length ? campo("ferramentas chamadas", diag.ferramentas.join(", ")) : ""}
    ${diag && diag.negacoes.length ? campo("negações de permissão", diag.negacoes.join(", ")) : ""}
    ${campo("turno", r.turnoId)}
    <div class="it"><b>conversa</b>${esc(r.conversaId)}</div>
  </details>`;
}

/**
 * Triagem dos relatos (ADR-041). Lista o que as pessoas relataram com o estado técnico de cada um.
 * O texto que a pessoa escreveu e o trecho da conversa NÃO vêm aqui: moram na tabela apagável e só
 * são lidos ao abrir um relato específico (ADR-002/004).
 */
export function renderRelatos(estado: Pick<Estado, "relatos">): string {
  const relatos = estado.relatos;
  if (relatos === null) return `<div class="mudo">carregando relatos…</div>`;
  if (relatos.length === 0) {
    return `<section class="tela"><h1>Relatos</h1><p class="mudo">Nenhum relato ainda. Eles chegam pelo ícone de inseto que aparece ao passar o mouse numa mensagem, ou contando ao Nod um bug, uma ideia ou uma dúvida.</p></section>`;
  }
  // definido em 2026-10-07 (0062): o filtro por tipo é atributo na seção + CSS (filtrar-relatos em main.ts) — redesenhar a
  // lista a cada clique trocaria os <details> abertos.
  const conta = (id: (typeof FILTROS)[number]["id"]) => (id === "todos" ? relatos.length : relatos.filter((r) => r.tipo === id).length);
  const filtros = FILTROS.filter((f) => f.id === "todos" || conta(f.id) > 0)
    .map((f) => `<button type="button" class="filtro-relato" data-act="filtrar-relatos" data-filtro-tipo="${f.id}" aria-pressed="${f.id === "todos"}">${esc(f.nome)} · ${conta(f.id)}</button>`).join("");
  return `<section class="tela relatos" data-filtro="todos">
    <h1>Relatos</h1>
    <p class="mudo">${relatos.length} ${relatos.length === 1 ? "relato" : "relatos"} · o mais recente primeiro. Bugs, melhorias e dúvidas, pelo botão de uma mensagem ou conversando com o Nod. Cada um traz o estado técnico do instante em que foi enviado.</p>
    <div class="filtros-relato" role="group" aria-label="Filtrar por tipo">${filtros}</div>
    ${relatos.map((r) => renderRelato(r)).join("")}
  </section>`;
}
