import type { Estado } from "../estado/reducer.ts";
import { avatarAgente, botao, dataHora, esc } from "../lib/render.ts";
import { motivoDaExecucao } from "../lib/execucao.ts";
import { interpolar } from "../lib/relogio.ts";

/**
 * Rotinas (E7): cada uma com a PRÓXIMA execução no fuso nomeado (o servidor calcula, ADR-011), o
 * gate de aprovação, pausar/ativar e as últimas 20 execuções com desfecho tipado — passou_em_branco ≠
 * falhou (E7.5). Rotinas nascem por texto na conversa (criar_rotina → proposta → decisão em Sua vez).
 */
export function renderRotinas(estado: Estado): string {
  const linhas = estado.rotinas
    .map(({ rotina: r, proximaExecucao }) => {
      const a = estado.frota?.agentes.find((x) => x.id === r.agenteId);
      const exec = estado.execucoes[r.id];
      const execucoes = exec
        ? exec.length
          ? `<ul class="execucoes">${exec.map((e) => `<li class="exec exec-${esc(e.desfecho)}"><b>${esc(e.desfecho.replaceAll("_", " "))}</b> · agendada ${esc(dataHora(e.instanteAgendado, r.fusoIana))} · registrada ${esc(dataHora(e.em, r.fusoIana))}${e.motivo ? ` · ${esc(motivoDaExecucao(e) ?? e.motivo)}` : ""}</li>`).join("")}</ul>`
          : '<p class="mudo">nunca executou</p>'
        : "";
      return `<li class="rotina rotina-${esc(r.estado)}" data-rotina="${esc(r.id)}">
        <div class="rt-cab">${a ? avatarAgente(a, "sm") : ""}<b>${esc(a?.nome ?? "agente")}</b> · <code>${esc(r.cron)}</code> (${esc(r.fusoIana)}) <span class="tag ${r.estado === "ativa" ? "tag-ok" : "tag-cinza"}">${esc(r.estado)}</span>${r.exigeAprovacao ? '<span class="tag tag-ambar" title="efeito externo só por item aprovado (E7.3)">gate de aprovação ligado</span>' : ""}</div>
        <div class="rt-linha"><b>próxima execução:</b> ${esc(dataHora(proximaExecucao, r.fusoIana))} (${esc(r.fusoIana)}) · ${esc(interpolar(proximaExecucao, estado.agora))}</div>
        <div class="rt-linha"><b>instrução:</b> ${esc(r.instrucao)}</div>
        <div class="rt-linha mudo">fonte: ${esc(r.fonte)} · entregável: ${esc(r.entregavel)} · limites: ${esc(r.limitesAprovacao)} · sem dado: ${esc(r.politicaSemDado)}</div>
        <div class="acoes">
          ${r.estado === "ativa" ? botao("pausar-rotina", "Pausar", { id: r.id }) : botao("ativar-rotina", "Ativar", { classe: "pri", id: r.id })}
          ${botao("executar-rotina", "Testar agora", { id: r.id, dados: { agente: r.agenteId }, desabilitado: estado.ocupado })}
          ${botao("ver-execucoes", exec ? "atualizar execuções" : "últimas 20 execuções", { id: r.id })}
          ${botao("abrir-conversa", "conversa", { dados: { conversa: r.conversaId, agente: r.agenteId } })}
        </div>
        ${execucoes}
      </li>`;
    })
    .join("");
  return `<section class="tela tela-rotinas">
    <header class="tela-cab"><h1>Rotinas</h1><span class="chip">${estado.rotinas.length} rotinas</span>${botao("navegar", "+ Nova rotina", { classe: "pri", dados: { tela: "nova-rotina" } })}</header>
    <p class="intro">Seu bot cuida do que se repete. O nod precisa estar aberto para executar os agendamentos.</p>
    ${estado.rotinas.length ? `<ul class="lista">${linhas}</ul>` : '<p class="mudo">Nenhuma rotina. Diga na conversa do bot, por exemplo: «todo dia útil às 8:00 de São Paulo poste aqui um resumo dos PRs abertos». O bot propõe; você confirma em Sua vez.</p>'}
  </section>`;
}
