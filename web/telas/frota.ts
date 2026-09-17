import type { IdExecutor } from "../../src/contracts/executor.ts";
import type { Inventario } from "../../src/contracts/inventario.ts";
import type { Estado } from "../estado/reducer.ts";
import { botao, esc, hora, iconeAgente } from "../lib/render.ts";
import { haQuanto } from "../lib/relogio.ts";
import { renderNegacoes } from "./negacao.ts";

/** Inventário ESCRITO (ADR-019/029): estado, versão, motivo e relógio — nunca só um ícone. */
export function textoInventario(inv: Inventario | null, agora: number): string {
  if (!inv) return "inventário ainda não sondado";
  if (inv.estado === "pronto") return `${inv.versao === "catcher" ? "catcher (sem custo)" : `claude ${inv.versao}`} pronto desde ${hora(inv.em)}`;
  if (inv.estado === "nao_autenticado") return `claude${inv.versao ? ` ${inv.versao}` : ""} não autenticado (${inv.motivo}) desde ${hora(inv.em)} · ${haQuanto(agora - inv.em)}`;
  return `claude ausente (${inv.motivo}) desde ${hora(inv.em)} · ${haQuanto(agora - inv.em)}`;
}

export function rotuloExecutor(id: IdExecutor): string {
  return id === "catcher" ? "catcher (sem custo)" : "Claude (real)";
}

/** Uma linha por opção do interruptor: o que a sonda disse, escrito (ADR-029) — "pronto" ou o motivo de não estar. */
function estadoDaOpcao(inv: Inventario): string {
  if (inv.estado === "pronto") return `pronto${inv.versao === "catcher" ? "" : ` (${inv.versao})`}`;
  return `${inv.estado === "nao_autenticado" ? "não autenticado" : "ausente"} — ${inv.motivo}`;
}

/**
 * Interruptor de executor (definido em 2026-09-16): a máquina roda OU o catcher (sem CLI, sem custo) OU o
 * Claude real (assinatura da pessoa). Um botão por opção que não está em uso; a troca para o Claude sonda o
 * CLI na hora e só acontece se a sonda disser 'pronto' — a recusa vem escrita, nunca um botão que "não faz nada".
 */
export function renderExecutor(estado: Estado): string {
  const ex = estado.executor;
  if (!ex) return `<div class="ex-linha"><b>Executor:</b> ainda não consultado</div>`;
  const botoes = ex.opcoes
    .filter((o) => o.id !== ex.atual)
    .map((o) => botao("trocar-executor", `usar ${esc(rotuloExecutor(o.id))}`, { classe: "sm", dados: { id: o.id }, desabilitado: estado.ocupado, titulo: o.custo === "real" ? "sonda o CLI agora: custa um turno real" : "sem custo" }))
    .join(" ");
  const linhas = ex.opcoes.map((o) => `<span>${esc(rotuloExecutor(o.id))}: ${esc(estadoDaOpcao(o.inventario))}</span>`).join(" · ");
  return `<div class="ex-linha"><b>Executor em uso:</b> ${esc(rotuloExecutor(ex.atual))} ${botoes}</div>
    <div class="ex-mudo">${linhas}</div>
    ${ex.recusa ? `<div class="ex-recusa">não troquei: ${esc(ex.recusa)}</div>` : ""}`;
}

/** A sonda do executor EM USO: o inventário da frota prefere o claude-cli mesmo com o catcher ligado, e mentiria na tela. */
export function inventarioEmUso(estado: Estado): Inventario | null {
  return estado.executor?.opcoes.find((o) => o.id === estado.executor?.atual)?.inventario ?? estado.inventario;
}

export function renderInventario(estado: Estado): string {
  const inv = inventarioEmUso(estado);
  const classe = inv?.estado === "pronto" ? "ok" : "falha";
  return `<div class="inventario inv-${classe}" role="status">
    <div class="inv-linha">${esc(textoInventario(inv, estado.agora))} ${botao("sondar-inventario", "sondar de novo", { classe: "sm", titulo: "custa um turno real quando o executor é o claude-cli" })}</div>
    ${renderExecutor(estado)}
  </div>`;
}

/**
 * Frota (E1.1, tela inicial): cada agente com a linha 'sem acessos · nunca executou' (contagens), o
 * inventário do motor e as negações vivas por classe com relógio. Criação com UM campo (nome opcional):
 * nasce 'Novo agente' e o modelo propõe o perfil na conversa (EMENDA 17).
 */
export function renderFrota(estado: Estado): string {
  const frota = estado.frota;
  const agentes = frota?.agentes ?? [];
  const cartoes = agentes
    .map((a) => {
      const vivos = Object.values(estado.turnosVivos).filter((t) => t.conversaId === a.conversaId);
      const trabalhando = vivos.some((t) => t.estado === "rodando") ? `<span class="tag tag-cinza">trabalhando</span>` : vivos.length ? `<span class="tag tag-cinza">na fila</span>` : "";
      return `<button class="cartao-agente" data-act="abrir-conversa" data-conversa="${esc(a.conversaId)}" data-agente="${esc(a.id)}">
        ${iconeAgente(a, "lg")}
        <span class="ca-txt"><b>${esc(a.nome)}${a.fixado ? " 📌" : ""}</b><span>${esc(a.titulo || a.descricao || "sem perfil confirmado")}</span><small>${esc(a.descricaoEstado)}${a.confirmado ? "" : " · perfil não confirmado"}</small></span>
        ${trabalhando}
      </button>`;
    })
    .join("");
  const vazio = agentes.length === 0 ? `<p class="mudo">Nenhum agente ainda. Crie o primeiro: ele já chega com um nome e uma mensagem de boas-vindas — você diz o que ele faz na conversa.</p>` : "";
  return `<section class="tela tela-frota">
    <header class="tela-cab"><h1>Meus agentes</h1><span class="chip">${agentes.length} bots no seu espaço</span></header>
    ${renderInventario(estado)}
    <div class="boas-vindas"><div><div class="eyebrow">SEU ESPAÇO DE TRABALHO</div><h2>Uma equipe de bots.<br>Um lugar para fazer acontecer.</h2><p class="intro">Converse, reúna especialistas e transforme tarefas em rotinas.</p></div>${botao("criar-rapido", "+ Criar bot", { classe: "pri" })}</div>
        <div class="cartoes">${cartoes}${vazio}</div>
    ${renderNegacoes([...(frota?.negacoes ?? []), ...estado.negacoes.filter((n) => n.classe !== "conector_indisponivel")], estado.agora)}
  </section>`;
}
