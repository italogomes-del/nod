import type { Estado } from "../estado/reducer.ts";
import { botao, esc, hora } from "../lib/render.ts";
import { haQuanto } from "../lib/relogio.ts";
import { ordemDasIas, pilhaDeAvatares, renderCartaoIa, UI_IAS_INICIAL, vistaDaIa, type ContextoCartao } from "./cartao-ia.ts";
import { renderContasDaIa } from "./contas-ia.ts";
import { nomeCurto, renderListaDeContas } from "./contas-lista.ts";
import { botsDaPessoa, maquinaDoBot } from "./maquinas.ts";
import { renderExecutor } from "./frota.ts";
import { logoApp } from "./marketplace.ts";
import { renderNegacoes, textoMotivo } from "./negacao.ts";

/**
 * Seu espaço › Provedores de IA (definido em 2026-10-10, protótipo Main aprovado; antes "Conexão"). As IAs que os bots
 * usam, uma por linha, NA ORDEM do Automático da pessoa: a primeira pronta responde e, se ela parar ou chegar ao limite,
 * a próxima assume. A linha se arrasta pela alça (mouse, dedo ou setas do teclado) e a ordem vai a `PUT preferencias
 * {ordemIas}`; cada bot pode ter a dele (tela 2B). Cada linha é o cartão de web/telas/cartao-ia.ts: estado curto, um
 * botão e o ícone de verificar que aparece no hover, com a versão e a hora no balão.
 *
 * Embaixo, quando há: os conectores fora do ar (um por linha, com "Tentar de novo"), as negações da frota e, só no modo
 * local (o servidor diz `trocavel`), o interruptor de simulação, atrás de "Configurar conexão".
 */
export function renderProvedores(estado: Estado): string {
  // ADR-102 (2026-10-13): no modo compartilhado, a lista única de contas; no modo local e no app do Mac antigo, a de antes.
  if (estado.contasIa?.disponivel && !estado.contasUi.appAntigo) return renderProvedoresContas(estado);
  const ui = estado.iasMac ?? UI_IAS_INICIAL;
  const servidor = estado.ias?.ias ?? null;
  const c: ContextoCartao = { servidor, ui, agora: estado.agora, onde: "provedores" };
  const linhas = ordemDasIas(servidor).map((ia, i) => {
    const v = vistaDaIa(ia, c);
    // ADR-101 (NOD-211): as várias contas da IA, embaixo do cartão, só no app do Mac.
    const contas = renderContasDaIa(ia, ui, estado.agora, Boolean(ui.estados[ia]?.conta));
    return `<div class="prov-linha" data-ordem-item="${ia}">${renderCartaoIa(v, ui, { arrastar: { pos: i + 1 } })}${contas}</div>`;
  }).join("");
  const executor = estado.executor && estado.executor.trocavel !== false ? `<div class="espaco-cartao prov-avancado">${renderExecutor(estado)}</div>` : "";
  return `<section class="espaco-secao provedores">
      <h2 class="prov-titulo">${pilhaDeAvatares()}Provedores de IA</h2>
      ${estado.contasIa?.disponivel ? '<p class="cl-faixa" role="status">Atualize o app do nod para ver e gerenciar as contas de todas as máquinas numa lista só.</p>' : ""}
      <p class="intro">As IAs que seus bots usam${ui.noApp ? " neste Mac" : ""}. No automático, eles seguem esta ordem: a primeira pronta responde e, se ela parar ou chegar ao limite, a próxima assume.</p>
      <div class="prov-ordem"><span>Ordem dos seus bots</span><span>arraste para mudar · cada bot pode ter a dele</span></div>
      <div class="espaco-cartao prov-lista" data-ordem-lista="pessoa">${linhas}</div>
      <p class="ia-nota">Recomendado: o Claude com <b>Opus</b> e o ChatGPT com <b>Sol</b>. Para outro modelo ou outra ordem num bot, abra a Inteligência dele.</p>
      ${executor}
      ${foraDoAr(estado)}
    </section>`;
}

/** A lista única de contas (web/telas/contas-lista.ts), com o filtro por máquina vindo de Máquinas. */
function renderProvedoresContas(estado: Estado): string {
  const ui = estado.iasMac ?? UI_IAS_INICIAL;
  const contexto: ContextoCartao = { servidor: estado.ias?.ias ?? null, ui, agora: estado.agora, onde: "provedores" };
  const maquinas = estado.maquinas?.maquinas ?? [];
  const filtro = estado.contasUi.filtro ? maquinas.find((m) => m.id === estado.contasUi.filtro) ?? null : null;
  const lista = renderListaDeContas({
    contas: estado.contasIa!,
    maquinas,
    detalhes: estado.detalhesContas,
    ui: estado.contasUi,
    agora: estado.agora,
    noApp: ui.noApp && estado.detalhesContas !== null,
    botsNaMaquina: (id) => botsDaPessoa(estado).filter((b) => maquinaDoBot(estado, b)?.id === id).map((b) => b.nome),
    cartaoDoMac: (ia) => renderCartaoIa(vistaDaIa(ia, contexto), ui),
  });
  const executor = estado.executor && estado.executor.trocavel !== false ? `<div class="espaco-cartao prov-avancado">${renderExecutor(estado)}</div>` : "";
  const intro = filtro
    ? `Mostrando as contas d${filtro.plataforma === "darwin" ? "o" : "a"} ${esc(nomeCurto(filtro, maquinas))}. A ordem é a mesma em todas as máquinas: os bots dela pulam as que não estão logadas lá.`
    : "Suas contas de IA, numa lista só. Os bots usam a primeira livre, de cima para baixo, na máquina onde trabalham. Arraste para mudar a ordem; cada bot pode ter a dele.";
  return `<section class="espaco-secao provedores prov-contas">
      <h2 class="prov-titulo">${pilhaDeAvatares()}Provedores de IA</h2>
      <p class="intro">${intro}</p>
      ${lista}
      ${executor}
      ${foraDoAr(estado)}
    </section>`;
}

/** Os conectores fora do ar e as negações da frota (o que era o rodapé da antiga seção Conexão). */
function foraDoAr(estado: Estado): string {
  const negacoes = [...(estado.frota?.negacoes ?? []), ...estado.negacoes.filter((n) => n.classe !== "conector_indisponivel")];
  const fora = negacoes.filter((n) => n.classe === "conector_indisponivel");
  const outras = negacoes.filter((n) => n.classe !== "conector_indisponivel");
  const linhaFora = (n: (typeof fora)[number]) => {
    const c = estado.conectores.find((x) => x.slug === n.nome || x.nome === n.nome);
    const nome = c?.nome ?? n.nome;
    const tentar = c ? botao("sondar-conector", "Tentar de novo", { classe: "sm", id: c.id }) : "";
    const motivo = textoMotivo(n.motivo);
    return `<div class="espaco-fora" role="status">${logoApp(estado, c?.slug ?? n.nome, nome)}<div><b>${esc(nome)}</b>${motivo ? ` <span>· ${esc(motivo)}</span>` : ""}<small>desde ${esc(hora(n.desde))} (${esc(haQuanto(estado.agora - n.desde))})</small></div>${tentar}</div>`;
  };
  return `${fora.length ? `<h3 class="espaco-subtitulo">Fora do ar</h3>${fora.map(linhaFora).join("")}` : ""}${renderNegacoes(outras, estado.agora)}`;
}
