import type { ChamadaRaioX, CompactacaoRaioX, ExecucaoRaioX, GrupoDeFerramentas, RaioXTurno, SecaoDoPrompt } from "../../src/contracts/raio-x.ts";
import type { Api } from "../lib/api.ts";
import { ErroApi } from "../lib/api.ts";
import { esc } from "../lib/render.ts";
import { ALERTA_JANELA, mil, modeloCurto, usd } from "./modo-dev.ts";

/**
 * A gaveta do Raio-X (modo dev, 0036). Separada de modo-dev.ts porque mexe no DOM, e conversa.ts — que os
 * testes do servidor importam sem DOM — só pode puxar strings. Só main.ts a importa, como reportar-bug.ts.
 */
const SECOES: Record<SecaoDoPrompt, string> = {
  identidade: "Identidade e “o que você faz”",
  modo: "Modo do turno",
  computador: "Computador e pastas",
  colegas: "Colaboração e diretório de colegas",
  rotinas: "Rotinas",
  apps: "Apps e conexões",
  ferramentas: "Ferramentas, capacidades e forma de trabalho",
  memoria: "Memória",
  contexto: "Contexto recente da conversa",
};

const GRUPOS_FIXOS: Record<Exclude<GrupoDeFerramentas["origem"], "conector">, string> = {
  nod: "nod",
  computador: "Computador do bot",
  workspace: "Pastas do Mac",
};

/** Estimativa de tokens a partir de caracteres, marcada como estimada onde aparece. */
const CARACTERES_POR_TOKEN = 4;

function relogio(instante: number): string {
  return new Date(instante).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ---------------------------------------------------------------------------------------------
// Raio-X do turno: uma gaveta (dialog) com duas abas. Busca o turno ao abrir; nada fica no estado do app.

function barra(valor: number, janela: number | null, classe = ""): string {
  const pct = janela ? Math.min(100, Math.round((valor / janela) * 100)) : 0;
  return janela ? `<span class="rx-barra ${classe}${valor >= janela * ALERTA_JANELA ? " rx-alerta" : ""}"><span style="width:${pct}%"></span></span>` : "";
}

function linhaChamada(c: ChamadaRaioX, inicio: number, janela: number | null): string {
  const ferramentas = c.ferramentas.map((f) => `<li>${esc(f.nome.replace(/^mcp__nod__/, ""))}${f.resultadoChars !== null ? ` → ${esc(mil(f.resultadoChars))} caract.` : ""}${f.erro ? ' <span class="tag tag-vermelha">erro</span>' : ""}</li>`).join("");
  return `<li class="rx-chamada${c.subagente ? " rx-sub" : ""}"><time>${esc(relogio(inicio + c.em))}</time><span class="rx-ctx">${esc(mil(c.contexto))}${c.subagente ? " · subagente" : ""}</span>${barra(c.contexto, janela)}
    <small class="mudo">${esc(mil(c.cacheLido))} do cache · ${esc(mil(c.entrada + c.cacheNovo))} novos · ${esc(mil(c.saida))} de saída${c.pensamento ? ` (${esc(mil(c.pensamento))} pensando)` : ""}</small>${ferramentas ? `<ul class="rx-ferramentas">${ferramentas}</ul>` : ""}</li>`;
}

function linhaCompactacao(c: CompactacaoRaioX, inicio: number): string {
  const de = c.antes !== null ? mil(c.antes) : "?";
  return `<li class="rx-compactacao"><time>${esc(relogio(inicio + c.em))}</time>⟳ compactou${c.gatilho === "auto" ? "" : ` (${esc(c.gatilho)})`}: ${esc(de)}${c.depois !== null ? ` → ${esc(mil(c.depois))}` : ""}</li>`;
}

function abaCusto(r: RaioXTurno): string {
  const x = r.execucao;
  if (!x) {
    return `<p class="mudo">Este turno não tem o registro das chamadas: rodou antes do modo dev existir, no Codex ou na simulação, ou caiu antes de chegar ao Claude Code. ${r.custoUsd !== null ? `Custo registrado: ${esc(usd(r.custoUsd))}.` : ""}</p>`;
  }
  const principais = x.chamadas.filter((c) => !c.subagente);
  const pico = Math.max(0, ...(principais.length ? principais : x.chamadas).map((c) => c.contexto));
  const soma = (k: "cacheLido" | "saida") => x.chamadas.reduce((s, c) => s + c[k], 0);
  const novos = x.chamadas.reduce((s, c) => s + c.entrada + c.cacheNovo, 0);
  const primeira = principais[0] ?? x.chamadas[0];
  const cartoes = `<div class="rx-cartoes">
      <div><small>Custo do turno</small><b>${esc(usd(r.custoUsd))}</b>${x.custoSessaoUsd !== null ? `<small class="mudo">sessão: ${esc(usd(x.custoSessaoUsd))} acumulado</small>` : ""}</div>
      <div><small>Chamadas</small><b>${x.chamadas.length + x.chamadasOmitidas}</b>${x.compactacoes.length ? `<small class="mudo">+ ${x.compactacoes.length} ${x.compactacoes.length === 1 ? "compactação" : "compactações"}</small>` : ""}</div>
      <div><small>Pico do contexto</small><b>${esc(mil(pico))}</b>${x.janela ? `<small class="mudo">de ${esc(mil(x.janela))}</small>` : ""}</div>
      <div><small>Tokens</small><b>${esc(mil(soma("cacheLido")))}</b><small class="mudo">cache · ${esc(mil(novos))} novos · ${esc(mil(soma("saida")))} saída</small></div>
    </div>`;
  const fixa = primeira && r.composicao
    ? `<section class="rx-bloco"><h3>Primeira chamada · ${esc(mil(primeira.contexto))}${x.janela ? ` de ${esc(mil(x.janela))}` : ""}</h3>${barra(primeira.contexto, x.janela)}
      <p class="mudo">${r.composicao.sessaoRetomada ? "Sessão retomada: além do prompt e das ferramentas, entra o histórico que a sessão do Claude Code guarda." : "Sessão nova: o que vai em toda chamada antes da conversa."}</p>
      <ul class="rx-partes">${partesFixas(r, x).join("")}</ul></section>`
    : "";
  const eventos = [
    ...x.chamadas.map((c) => ({ em: c.em, html: linhaChamada(c, r.criadoEm, x.janela) })),
    ...x.compactacoes.map((c) => ({ em: c.em, html: linhaCompactacao(c, r.criadoEm) })),
  ].sort((a, b) => a.em - b.em);
  const omitidas = x.chamadasOmitidas ? `<li class="mudo">… ${x.chamadasOmitidas} chamadas do meio não guardadas</li>` : "";
  const fim = r.estado === "interrompido" ? `<li class="rx-fim">✕ turno interrompido</li>` : "";
  return `${cartoes}${fixa}<section class="rx-bloco"><h3>Chamadas à API</h3><ol class="rx-linha">${eventos.map((e) => e.html).join("")}${omitidas}${fim}</ol></section>`;
}

/** O que a primeira chamada leva, parte por parte: caracteres exatos do nod, tokens estimados, e o resto é do Claude Code. */
function partesFixas(r: RaioXTurno, x: ExecucaoRaioX): string[] {
  const c = r.composicao!;
  const apps = c.ferramentas.filter((g) => g.origem === "conector");
  const doNod = c.ferramentas.filter((g) => g.origem !== "conector");
  const tokens = (chars: number) => Math.round(chars / CARACTERES_POR_TOKEN);
  const charsApps = apps.reduce((s, g) => s + g.chars, 0);
  const charsNod = doNod.reduce((s, g) => s + g.chars, 0);
  const linhas = [
    `<li><span>Prompt do nod</span><b>~${esc(mil(tokens(c.promptChars)))}</b><small class="mudo">${esc(mil(c.promptChars))} caract.</small></li>`,
    `<li><span>Ferramentas do nod${doNod.some((g) => g.origem === "computador") ? " e do computador" : ""}</span><b>~${esc(mil(tokens(charsNod)))}</b><small class="mudo">${esc(mil(charsNod))} caract.</small></li>`,
  ];
  if (apps.length) {
    linhas.push(x.buscaDeFerramentas
      ? `<li><span>Ferramentas de apps (${apps.reduce((s, g) => s + g.quantidade, 0)})</span><b>sob demanda</b><small class="mudo">busca de ferramentas ligada: só entram as que o modelo buscar</small></li>`
      : `<li><span>Ferramentas de apps (${apps.reduce((s, g) => s + g.quantidade, 0)})</span><b>~${esc(mil(tokens(charsApps)))}</b><small class="mudo">${esc(mil(charsApps))} caract., todas carregadas</small></li>`);
  }
  linhas.push(`<li><span>Claude Code: prompt base, nativas${c.sessaoRetomada ? " e histórico da sessão" : ""}</span><b>o resto</b><small class="mudo">tokens estimados (4 caracteres ≈ 1 token)</small></li>`);
  return linhas;
}

function abaEnviado(r: RaioXTurno): string {
  const c = r.composicao;
  if (!c) return `<p class="mudo">Este turno não tem a composição: rodou antes do modo dev existir.</p>`;
  const semTexto = c.comTexto ? "" : `<p class="rx-aviso">O modo dev estava desligado quando este turno saiu: ficaram os tamanhos, não os textos.</p>`;
  const prompt = c.prompt.map((p) => p.texto !== undefined
    ? `<details data-disclosure="rx-${esc(p.secao)}"><summary><span>${esc(SECOES[p.secao])}</span><small>${esc(mil(p.chars))} caract.</small></summary><pre>${esc(p.texto)}</pre></details>`
    : `<div class="rx-item"><span>${esc(SECOES[p.secao])}</span><small>${esc(mil(p.chars))} caract.</small></div>`).join("");
  const grupos = c.ferramentas.map((g) => `<div class="rx-item"><span>${esc(g.origem === "conector" ? g.grupo : GRUPOS_FIXOS[g.origem])} · ${g.quantidade} ${g.quantidade === 1 ? "ferramenta" : "ferramentas"}</span><small>${esc(mil(g.chars))} caract.</small></div>`).join("");
  const busca = r.execucao
    ? r.execucao.buscaDeFerramentas
      ? "Busca de ferramentas do Claude Code: ligada — as definições dos apps só entram quando o modelo as busca."
      : "Busca de ferramentas do Claude Code: desligada neste turno — todas as definições foram carregadas de uma vez."
    : "";
  const compactacoes = r.execucao?.compactacoes ?? [];
  const historico = c.sessaoRetomada
    ? `Fica na sessão do Claude Code no Mac, não no nod.${compactacoes.length ? ` Depois de cada compactação, o que sobrou: ${compactacoes.map((k) => (k.depois !== null ? mil(k.depois) : "?")).join(" → ")} tokens.` : ""}`
    : "Sessão nova: as últimas falas vão dentro do prompt, na seção “Contexto recente da conversa”.";
  return `${semTexto}
    <section class="rx-bloco"><h3>1 · Prompt de sistema do nod <small>${esc(mil(c.promptChars))} caract.</small></h3>${prompt}</section>
    <section class="rx-bloco"><h3>2 · Definições de ferramentas</h3>${grupos}${c.nativas.length ? `<div class="rx-item"><span>Nativas do Claude Code: ${esc(c.nativas.join(", "))}</span></div>` : ""}${busca ? `<p class="mudo">${esc(busca)}</p>` : ""}</section>
    <section class="rx-bloco"><h3>3 · Histórico da conversa <small>${c.sessaoRetomada ? "sessão retomada" : "sessão nova"}</small></h3><p class="mudo">${esc(historico)}</p></section>
    <section class="rx-bloco"><h3>4 · Entrada do turno <small>${esc(mil(c.entrada.chars))} caract.${c.entrada.anexos ? ` · ${c.entrada.anexos} ${c.entrada.anexos === 1 ? "anexo" : "anexos"}` : ""}</small></h3>${c.entrada.texto !== undefined ? `<pre>${esc(c.entrada.texto)}</pre>` : ""}</section>`;
}

function cabecalho(r: RaioXTurno, nome: string): string {
  const x = r.execucao;
  const fim = x ? ` → ${new Date(r.criadoEm + x.duracaoMs).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}` : "";
  const quando = `${new Date(r.criadoEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}${fim}`;
  const partes = [nome, quando, modeloCurto(x?.modelo ?? r.composicao?.modelo ?? null), x?.versaoCli ? `Claude Code ${x.versaoCli}` : "", r.composicao ? (r.composicao.sessaoRetomada ? "sessão retomada" : "sessão nova") : ""].filter(Boolean);
  return `<header class="rx-cab"><div><h2 id="rx-titulo">Raio-X do turno</h2><p class="mudo">${partes.map(esc).join(" · ")}</p></div><button type="button" class="bt sm" data-rx="fechar" aria-label="Fechar">×</button></header>`;
}

export async function abrirRaioX(api: Api, turnoId: string, nome: string): Promise<void> {
  const dialog = document.createElement("dialog");
  dialog.className = "raio-x";
  dialog.setAttribute("aria-labelledby", "rx-titulo");
  dialog.innerHTML = `<p class="mudo">Carregando o Raio-X…</p>`;
  document.body.append(dialog);
  dialog.addEventListener("close", () => dialog.remove());
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); });
  dialog.showModal();
  let r: RaioXTurno;
  try {
    r = await api.raioXDoTurno(turnoId);
  } catch (e) {
    dialog.innerHTML = `<p class="erro" role="alert">${e instanceof ErroApi && e.status === 404 ? "Turno não encontrado." : "Não foi possível carregar o Raio-X."}</p><button type="button" class="bt" data-rx="fechar">Fechar</button>`;
    dialog.querySelector('[data-rx="fechar"]')?.addEventListener("click", () => dialog.close());
    return;
  }
  dialog.innerHTML = `${cabecalho(r, nome)}
    <div class="rx-abas" role="tablist">
      <button type="button" role="tab" aria-selected="true" data-aba="custo">Custo e contexto</button>
      <button type="button" role="tab" aria-selected="false" data-aba="enviado">O que foi enviado</button>
    </div>
    <div class="rx-corpo" data-painel="custo">${abaCusto(r)}</div>
    <div class="rx-corpo" data-painel="enviado" hidden>${abaEnviado(r)}</div>
    <footer class="rx-rodape"><button type="button" class="bt" data-rx="copiar"><span>Copiar o turno em JSON</span></button></footer>`;
  dialog.addEventListener("click", (e) => {
    const alvo = (e.target as HTMLElement).closest<HTMLElement>("[data-aba],[data-rx]");
    if (!alvo) return;
    if (alvo.dataset.rx === "fechar") dialog.close();
    if (alvo.dataset.rx === "copiar") {
      const rotulo = alvo.querySelector("span");
      navigator.clipboard.writeText(JSON.stringify(r, null, 2)).then(
        () => { if (rotulo) rotulo.textContent = "Copiado"; },
        () => { if (rotulo) rotulo.textContent = "Não copiou"; },
      );
    }
    if (alvo.dataset.aba) {
      for (const b of dialog.querySelectorAll<HTMLElement>("[data-aba]")) b.setAttribute("aria-selected", String(b === alvo));
      for (const p of dialog.querySelectorAll<HTMLElement>("[data-painel]")) p.hidden = p.dataset.painel !== alvo.dataset.aba;
    }
  });
}
