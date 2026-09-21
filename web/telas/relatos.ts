import type { CategoriaRelato, Relato } from "../../src/contracts/relato.ts";
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
  return `<details class="card-prop" data-disclosure="relato-${esc(r.id)}">
    <summary>
      <b>${esc(ROTULOS[r.categoria])}</b>
      <span class="tag tag-cinza">${esc(anexo)}</span>
      ${falha ? `<span class="tag tag-ambar">${esc(falha.replaceAll("_", " "))}</span>` : ""}
      <time>${esc(dataHora(r.criadoEm))}</time>
    </summary>
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
export function renderRelatos(estado: Estado): string {
  const relatos = estado.relatos;
  if (relatos === null) return `<div class="mudo">carregando relatos…</div>`;
  if (relatos.length === 0) {
    return `<section class="tela"><h1>Relatos</h1><p class="mudo">Nenhum relato ainda. Eles chegam pelo ícone de inseto que aparece ao passar o mouse numa mensagem.</p></section>`;
  }
  return `<section class="tela">
    <h1>Relatos</h1>
    <p class="mudo">${relatos.length} ${relatos.length === 1 ? "relato" : "relatos"} · o mais recente primeiro. Cada um traz o estado técnico do instante em que foi enviado.</p>
    ${relatos.map((r) => renderRelato(r)).join("")}
  </section>`;
}
