import type { Inventario } from "../../src/contracts/inventario.ts";
import type { Estado } from "../estado/reducer.ts";
import { avatarAgente, botao, esc, hora } from "../lib/render.ts";
import { haQuanto } from "../lib/relogio.ts";
import { renderNegacoes } from "./negacao.ts";

/** Inventário ESCRITO (ADR-019/029): estado, versão, motivo e relógio — nunca só um ícone. */
export function textoInventario(inv: Inventario | null, agora: number): string {
  if (!inv) return "inventário ainda não sondado";
  if (inv.estado === "pronto") return `${inv.versao === "catcher" ? "catcher (sem custo)" : `claude ${inv.versao}`} pronto desde ${hora(inv.em)}`;
  if (inv.estado === "nao_autenticado") return `claude${inv.versao ? ` ${inv.versao}` : ""} não autenticado (${inv.motivo}) desde ${hora(inv.em)} · ${haQuanto(agora - inv.em)}`;
  return `claude ausente (${inv.motivo}) desde ${hora(inv.em)} · ${haQuanto(agora - inv.em)}`;
}

export function renderInventario(estado: Estado): string {
  const inv = estado.inventario;
  const classe = inv?.estado === "pronto" ? "ok" : "falha";
  return `<div class="inventario inv-${classe}" role="status">${esc(textoInventario(inv, estado.agora))} ${botao("sondar-inventario", "sondar de novo", { classe: "sm", titulo: "custa um turno real quando o executor é o claude-cli" })}</div>`;
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
        ${avatarAgente(a, "lg")}
        <span class="ca-txt"><b>${esc(a.nome)}${a.fixado ? " 📌" : ""}</b><span>${esc(a.titulo || a.descricao || "sem perfil confirmado")}</span><small>${esc(a.descricaoEstado)}${a.confirmado ? "" : " · perfil não confirmado"}</small></span>
        ${trabalhando}
      </button>`;
    })
    .join("");
  const vazio = agentes.length === 0 ? `<p class="mudo">Nenhum agente ainda. Crie o primeiro: ele nasce sem nome, sem acessos e sem rotina — você diz o que ele faz na conversa.</p>` : "";
  return `<section class="tela tela-frota">
    <header class="tela-cab"><h1>Frota</h1><span class="chip">a primeira tela do seu dia</span></header>
    ${renderInventario(estado)}
    <form class="criar" data-form="criar-agente">
      <input name="nome" placeholder="Nome do novo bot (opcional — o modelo propõe)" maxlength="60" />
      <button class="bt pri" type="submit" data-act="criar-agente">Criar bot</button>
    </form>
    <div class="cartoes">${cartoes}${vazio}</div>
    ${renderNegacoes([...(frota?.negacoes ?? []), ...estado.negacoes.filter((n) => n.classe !== "conector_indisponivel")], estado.agora)}
  </section>`;
}
