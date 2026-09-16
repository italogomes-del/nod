import { agenteAtual, estadoInicial, mensagensDo, reduzir, type Estado, type Snapshot } from "./estado/reducer.ts";
import { api } from "./lib/api.ts";
import type { Agente, Mensagem } from "../contracts/agente.ts";
import type { Rotina } from "../contracts/rotina.ts";
import type { Concessao } from "../contracts/conector.ts";

let estado: Estado = estadoInicial;
const app = document.getElementById("app")!;
const toastEl = document.getElementById("toast")!;

function dispatch(acao: Parameters<typeof reduzir>[1]): void {
  estado = reduzir(estado, acao);
  render();
}

let toastTimer = 0;
function toast(text: string): void {
  toastEl.textContent = text;
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 2400);
}

function esc(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function initials(name: string): string {
  return name
    .split(" ")
    .map((p) => p[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function icon(agente: Agente): string {
  return `<span class="icon ${agente.cor} ${agente.forma}">${esc(initials(agente.nome))}</span>`;
}

async function hidratar(s: Snapshot): Promise<void> {
  dispatch({ tipo: "hidratar", snapshot: s });
}

async function boot(): Promise<void> {
  try {
    await hidratar(await api.frota());
  } catch (e) {
    dispatch({ tipo: "erro", texto: (e as Error).message });
  }
}

async function criar(): Promise<void> {
  dispatch({ tipo: "enviando", valor: true });
  const s = await api.criarAgente();
  const novo = s.agentes[0];
  await hidratar(s);
  if (novo) dispatch({ tipo: "selecionar", id: novo.id });
  toast("Novo Bot criado. Diga o que ele faz.");
}

async function enviar(texto: string): Promise<void> {
  const a = agenteAtual(estado);
  if (!a || !texto.trim()) return;
  dispatch({ tipo: "enviando", valor: true });
  try {
    await hidratar(await api.enviar(a.id, texto.trim()));
  } catch (e) {
    dispatch({ tipo: "erro", texto: (e as Error).message });
  }
}

function renderRail(): string {
  return `<aside class="rail" aria-label="Contextos">
    <button class="r-btn active" data-act="home" aria-label="Meus agentes">MW</button>
    <span class="r-cap">FROTA</span>
    <span class="r-sep"></span>
    <button class="r-btn" data-act="emp" aria-label="Leapy" title="Área de empresa é opcional">LE</button>
  </aside>`;
}

function renderSidebar(e: Estado): string {
  const agentes = e.snapshot?.agentes ?? [];
  const rows = agentes
    .map((a) => {
      const active = a.id === e.agenteAtualId ? " active" : "";
      const last = e.snapshot?.mensagens.filter((m) => m.agenteId === a.id).at(-1);
      return `<button class="row${active}" data-act="open" data-id="${esc(a.id)}">
        ${icon(a)}
        <span class="txt"><b>${esc(a.nome)}</b><span>${esc(a.instrucoes || last?.texto || "Acabamos de nos conhecer.")}</span></span>
        <span class="meta">${a.confirmado ? "" : '<span class="dot"></span>'}</span>
      </button>`;
    })
    .join("");
  return `<aside class="sidebar" data-context="private">
    <div id="privateSidebar">
      <div class="search-wrap">
        <div class="search-row">
          <label class="search"><span>⌕</span><input value="Buscar" readonly /></label>
          <button class="create-trigger" data-act="palette" aria-label="Criar ou buscar bots">+</button>
        </div>
        <div class="favorites">
          <div class="favorites-head"><span>Favoritos</span><b>${agentes.filter((a) => a.favorito).length} fixados</b></div>
          <div class="fav-grid">${agentes
            .filter((a) => a.favorito)
            .map(
              (a) =>
                `<button class="fav" data-act="open" data-id="${esc(a.id)}">${icon(a)}<b>${esc(a.nome)}</b></button>`,
            )
            .join("")}</div>
          <div class="favorites-note">Seus agentes pessoais — fora das empresas.</div>
        </div>
      </div>
      <div class="list">
        <section class="section"><h3>Meus agentes</h3>${rows || '<p class="favorites-note">Nenhum ainda. Clique em + para criar.</p>'}</section>
      </div>
      <div class="me"><span class="av">${esc(e.snapshot?.pessoa.iniciais ?? "MW")}</span> ${esc(e.snapshot?.pessoa.nome ?? "")}</div>
    </div>
  </aside>`;
}

function renderStarter(m: Mensagem): string {
  const opts = (m.payload?.["options"] as string[][] | undefined) ?? [];
  return `<div class="starter">
    <div class="intro">${esc(m.texto)}</div>
    <div class="q">
      <h4>${esc(String(m.payload?.["title"] ?? ""))}</h4>
      <p>${esc(String(m.payload?.["subtitle"] ?? ""))}</p>
      <div class="choices">
        ${opts
          .map(
            (o) =>
              `<button class="choice" data-act="seed" data-seed="${esc(o[1] ?? "")}"><span class="badge">${esc(o[0] ?? "")}</span><span><b>${esc(o[1] ?? "")}</b><span>${esc(o[2] ?? "")}</span></span></button>`,
          )
          .join("")}
      </div>
      <div class="free">Ou escreva do seu jeito no campo abaixo.</div>
    </div>
  </div>`;
}

function renderPapel(m: Mensagem, agenteId: string): string {
  const p = m.payload ?? {};
  const acessos = (p["acessosPedidos"] as { nome: string }[] | undefined) ?? [];
  const nao = (p["naoDeveFazer"] as string[] | undefined) ?? [];
  const pendente = p["estado"] === "pendente";
  return `<div class="card-prop">
    <div class="hd">Proposta — nada concedido ainda</div>
    <div class="ttl">${esc(String(p["nome"] ?? "Novo Bot"))}</div>
    <div class="it"><b>O que faz</b>${esc(String(p["instrucoes"] ?? ""))}</div>
    <div class="it"><b>Acesso que precisa</b>${acessos.length ? acessos.map((a) => esc(a.nome)).join(", ") : "Nenhum app ainda."}</div>
    <div class="it"><b>O que não deve fazer</b>${nao.map((l) => `• ${esc(l)}`).join("<br>")}</div>
    ${p["rotinaResumo"] ? `<div class="it"><b>Rotina entendida (não agendada)</b>${esc(String(p["rotinaResumo"]))}</div>` : ""}
    ${
      pendente
        ? `<div class="ft">
      <button class="btn pri" data-act="confirmar" data-agente="${esc(agenteId)}" data-id="${esc(m.id)}">Confirmar</button>
      <button class="btn" data-act="recusar" data-agente="${esc(agenteId)}" data-id="${esc(m.id)}">Agora não</button>
    </div>`
        : `<div class="ft"><span style="font-size:12px;color:#7b8393">Confirmado</span></div>`
    }
  </div>`;
}

function renderRotina(m: Mensagem, agenteId: string): string {
  const p = m.payload ?? {};
  const pendente = p["estado"] === "pendente";
  return `<div class="card-prop">
    <div class="hd">Rotina proposta — nada agendado ainda</div>
    <div class="ttl">${esc(String(p["cron"] ?? ""))} · ${esc(String(p["fusoIana"] ?? ""))}</div>
    <div class="it">${esc(String(p["resumo"] ?? m.texto))}</div>
    <div class="it"><b>Próximo disparo</b>${esc(String(p["proximo"] ?? "—"))}</div>
    <div class="it"><b>Gate de aprovação</b>Ligado por padrão. Nada sai sem você.</div>
    ${
      pendente
        ? `<div class="ft">
      <button class="btn pri" data-act="confirmar" data-agente="${esc(agenteId)}" data-id="${esc(m.id)}">Confirmar rotina</button>
      <button class="btn" data-act="recusar" data-agente="${esc(agenteId)}" data-id="${esc(m.id)}">Agora não</button>
    </div>`
        : ""
    }
  </div>`;
}

function renderConcessao(m: Mensagem, agenteId: string): string {
  const p = m.payload ?? {};
  const caps = (p["capacidades"] as { id: string; rotulo: string }[] | undefined) ?? [];
  const pendente = p["estado"] === "pendente";
  return `<div class="card-prop" data-card="concessao" data-id="${esc(m.id)}">
    <div class="hd">Conectar ${esc(String(p["nome"] ?? ""))}</div>
    <div class="ttl">${esc(String(p["resumo"] ?? ""))}</div>
    <div class="it">
      <b>Este conector toca dado de aprendiz?</b>
      <div class="sens">
        <label><input type="radio" name="sens-${esc(m.id)}" value="toca" /> Sim, toca</label>
        <label><input type="radio" name="sens-${esc(m.id)}" value="nao-toca" /> Não toca</label>
      </div>
      <p class="warn">Se você não declarar, o default é TOCA — fechado por origem, nunca por texto.</p>
    </div>
    <div class="it">
      <b>Capacidades (todas começam desligadas)</b>
      <div class="caps">
        ${caps
          .map(
            (c) =>
              `<label><input type="checkbox" data-cap="${esc(c.id)}" /> ${esc(c.rotulo)}</label>`,
          )
          .join("")}
      </div>
    </div>
    ${
      pendente
        ? `<div class="ft">
      <button class="btn pri" data-act="confirmar-app" data-agente="${esc(agenteId)}" data-id="${esc(m.id)}">Conectar</button>
      <button class="btn" data-act="recusar" data-agente="${esc(agenteId)}" data-id="${esc(m.id)}">Agora não</button>
    </div>`
        : ""
    }
  </div>`;
}

function renderMsg(m: Mensagem, agenteId: string): string {
  if (m.kind === "starter") return renderStarter(m);
  if (m.kind === "proposta-papel") return renderPapel(m, agenteId);
  if (m.kind === "proposta-rotina") return renderRotina(m, agenteId);
  if (m.kind === "proposta-concessao") return renderConcessao(m, agenteId);
  const who = m.autoria.tipo === "pessoa" ? "you" : "bot";
  return `<div class="message ${who}"><div class="bubble">${esc(m.texto)}</div></div>`;
}

function renderDetalhes(e: Estado): string {
  if (!e.detalhesAbertos) return "";
  const a = agenteAtual(e);
  if (!a || !e.snapshot) return "";
  const rotinas = e.snapshot.rotinas.filter((r: Rotina) => r.agenteId === a.id);
  const apps = e.snapshot.concessoes.filter((c: Concessao) => c.agenteId === a.id);
  return `<aside class="details">
    <div class="dh">Detalhes da conversa <button class="btn" data-act="fecha-detalhes">×</button></div>
    <div class="db">
      <h3>O que faz</h3>
      <p>${esc(a.instrucoes || "Ainda não definido — escreva na conversa.")}</p>
      <h3>Rotinas</h3>
      ${
        rotinas.length
          ? rotinas
              .map(
                (r) =>
                  `<div class="pill-app"><span>${esc(r.cron)} · ${esc(r.fusoIana)}<br><small>${esc(r.estado)} · gate ${r.exigeAprovacao ? "ligado" : "off"}</small></span></div>`,
              )
              .join("")
          : "<p>Nenhuma. Diga na conversa, por exemplo: «toda segunda às 7h».</p>"
      }
      <h3>Apps</h3>
      ${
        apps.length
          ? apps
              .map(
                (c) =>
                  `<div class="pill-app"><b>${esc(c.conectorId)}</b><span>${esc(c.estado)} · ${c.capacidadesLigadas.length} ligadas · ${esc(c.declaracao)}</span></div>`,
              )
              .join("")
          : "<p>Nenhum. Diga «conecta com o Slack» ou Notion.</p>"
      }
    </div>
  </aside>`;
}

function renderChat(e: Estado): string {
  const a = agenteAtual(e);
  if (!a) {
    return `<main class="main">
      <header class="head"><div class="left"><span class="name">Meus agentes</span><span class="tag">privado</span></div></header>
      <section class="chat"><div class="scroll"><div class="empty">
        <h2>Crie seu primeiro agente</h2>
        <p>Um campo só. Sem formulário de permissões. Você diz o que ele faz, cria a rotina falando, e conecta Slack, Notion e o resto na conversa.</p>
        <button class="btn pri" data-act="criar">Criar novo Bot</button>
      </div></div></section>
    </main>`;
  }
  const msgs = mensagensDo(e);
  return `<main class="main" data-context="private">
    <header class="head">
      <div class="left">${icon(a)}<span class="name">${esc(a.nome)}</span><span class="tag">privado</span></div>
      <div class="actions">
        <button class="btn" data-act="detalhes" aria-label="Detalhes da conversa">Detalhes</button>
      </div>
    </header>
    <section class="chat">
      <div class="scroll" id="chatScroll"><div class="timeline">${msgs.map((m) => renderMsg(m, a.id)).join("")}</div></div>
      <div class="composer"><div class="box">
        <textarea id="composer" rows="1" placeholder="Mensagem para o Bot"></textarea>
        <button class="send" data-act="enviar" aria-label="Enviar">↑</button>
      </div></div>
    </section>
    ${
      e.paletteAberta
        ? `<div class="palette" id="palette">
      <div class="ph"><span>Para: Buscar ou criar Bots</span><button data-act="fecha-palette">×</button></div>
      <button class="opt main" data-act="criar"><span class="mini">+</span>Criar novo Bot</button>
      ${(e.snapshot?.agentes ?? [])
        .map((b) => `<button class="opt" data-act="open" data-id="${esc(b.id)}">${icon(b)}${esc(b.nome)}</button>`)
        .join("")}
    </div>`
        : ""
    }
    ${renderDetalhes(e)}
  </main>`;
}

function render(): void {
  if (estado.erro && !estado.snapshot) {
    app.innerHTML = `<div class="empty"><h2>Não subi o servidor</h2><p>${esc(estado.erro)}</p></div>`;
    return;
  }
  app.innerHTML = `${renderRail()}${renderSidebar(estado)}${renderChat(estado)}`;
  const scroll = document.getElementById("chatScroll");
  if (scroll) scroll.scrollTop = scroll.scrollHeight;
  const ta = document.getElementById("composer") as HTMLTextAreaElement | null;
  ta?.addEventListener("input", () => {
    ta.style.height = "auto";
    ta.style.height = `${Math.min(ta.scrollHeight, 170)}px`;
  });
  ta?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      void enviar(ta.value);
    }
  });
}

app.addEventListener("click", (ev) => {
  const t = (ev.target as HTMLElement).closest("[data-act]") as HTMLElement | null;
  if (!t) return;
  const act = t.getAttribute("data-act");
  if (act === "palette") dispatch({ tipo: "palette", aberta: !estado.paletteAberta });
  if (act === "fecha-palette") dispatch({ tipo: "palette", aberta: false });
  if (act === "criar") void criar();
  if (act === "open") dispatch({ tipo: "selecionar", id: t.getAttribute("data-id") ?? "" });
  if (act === "detalhes") dispatch({ tipo: "detalhes", abertos: !estado.detalhesAbertos });
  if (act === "fecha-detalhes") dispatch({ tipo: "detalhes", abertos: false });
  if (act === "enviar") {
    const ta = document.getElementById("composer") as HTMLTextAreaElement | null;
    if (ta) void enviar(ta.value);
  }
  if (act === "seed") {
    const ta = document.getElementById("composer") as HTMLTextAreaElement | null;
    if (ta) {
      ta.value = t.getAttribute("data-seed") ?? "";
      ta.focus();
    }
  }
  if (act === "confirmar") {
    const agenteId = t.getAttribute("data-agente") ?? "";
    const id = t.getAttribute("data-id") ?? "";
    void api.confirmar(agenteId, id).then(hidratar);
  }
  if (act === "recusar") {
    const agenteId = t.getAttribute("data-agente") ?? "";
    const id = t.getAttribute("data-id") ?? "";
    void api.recusar(agenteId, id).then(hidratar);
  }
  if (act === "confirmar-app") {
    const agenteId = t.getAttribute("data-agente") ?? "";
    const id = t.getAttribute("data-id") ?? "";
    const card = t.closest("[data-card='concessao']");
    const declaracao =
      (card?.querySelector("input[type=radio]:checked") as HTMLInputElement | null)?.value ?? "nao-declarou";
    const capacidadesLigadas = [...(card?.querySelectorAll("input[data-cap]:checked") ?? [])].map(
      (el) => (el as HTMLInputElement).getAttribute("data-cap") ?? "",
    );
    void api.confirmar(agenteId, id, { declaracao, capacidadesLigadas }).then(hidratar);
  }
  if (act === "emp") toast("A área de empresa é opcional. Esta versão é Meus agentes.");
  if (act === "home") dispatch({ tipo: "palette", aberta: false });
});

void boot();
