import type { MaquinaDto } from "../../src/contracts/maquina.ts";
import type { Agente } from "../../src/contracts/agente.ts";
import type { ConectarMaquina, Estado } from "../estado/reducer.ts";
import { ICONE } from "../lib/icones.ts";
import { botao, esc, hora, iconeAgente } from "../lib/render.ts";
import { maquinasDe, memoriaLegivel, seguradoPeloMac } from "../lib/trabalhos.ts";
import { discoLegivel, NOME_FILA, NOME_MEMORIA, NOME_PROCESSADOR, tempoAteAcabar } from "./este-mac.ts";

/**
 * Seu espaço › Máquinas (ADR-090; protótipo "Nod — Motor na VM", pranchas 1 e 2): as máquinas da pessoa (o Mac e as VMs
 * em que o motor roda), o que cada uma anunciou, onde cada bot trabalha e o "Conectar uma máquina" por código. A janela
 * continua no Mac ou no navegador; a máquina escolhida roda o Claude Code ou o Codex do bot.
 */

const NOME_IA: Record<string, string> = { "claude-cli": "Claude Code", "codex-cli": "Codex" };

function nomePlataforma(m: MaquinaDto): string {
  if (!m.conectada) return "não conectada agora";
  return m.plataforma === "linux" ? "Linux" : "Mac";
}

/**
 * A máquina de um bot: a dele, senão o padrão da pessoa; null = qualquer uma (com o servidor no Mac, ADR-092: este Mac).
 * Só conta chave que ainda existe.
 */
export function maquinaDoBot(estado: Estado, bot: Pick<Agente, "maquinaId">): MaquinaDto | null {
  const lista = estado.maquinas?.maquinas ?? [];
  return lista.find((m) => m.id === bot.maquinaId) ?? lista.find((m) => m.id === estado.maquinas?.padraoId) ?? null;
}

/** Os bots da pessoa (só a dona escolhe onde o bot trabalha), sem os excluídos. */
export function botsDaPessoa(estado: Estado): Agente[] {
  return (estado.frota?.agentes ?? []).filter((a) => a.ownerId === estado.sessao?.pessoaId && !a.excluidoEm);
}

function chipsDasIas(m: MaquinaDto): string {
  const ias = Object.entries(m.ias).map(([id, est]) => `<span class="maq-ia${est === "pronto" ? "" : " nao"}"><i aria-hidden="true"></i>${esc(NOME_IA[id] ?? id)} ${est === "pronto" ? "pronto" : est === "nao_autenticado" ? "sem login" : "ausente"}</span>`);
  if (m.gh) ias.push(`<span class="maq-ia"><i aria-hidden="true"></i>GitHub</span>`);
  return ias.length ? `<div class="maq-ias">${ias.join("")}</div>` : "";
}

/**
 * A leitura da máquina no cartão (definido em 2026-10-09, a tela fala por máquina): o status curto à vista — se ela
 * segura trabalho novo agora e quantos esperam — e os números atrás do clique (memória `marlon-design-limpo-info-escondida`).
 * Sem leitura dela (motor anterior, ou sem contato), nada.
 */
export function leituraNoCartao(estado: Pick<Estado, "trabalhos">, id: string): string {
  const l = maquinasDe(estado.trabalhos)?.find((x) => x.id === id);
  if (!l) return "";
  const esperam = (estado.trabalhos?.trabalhos ?? []).filter((t) => seguradoPeloMac(t, false) && t.maquina?.id === id).length;
  const oQue = l.motivoEspera === "disco" ? "espaço no disco" : l.motivoEspera === "memoria" ? "ela liberar memória" : "ela aliviar";
  // ADR-095 §6: o disco que acaba em menos de 24 h aparece antes de os bots pararem.
  const acaba = typeof l.disco?.acabaEmMs === "number" ? l.disco.acabaEmMs : null;
  const curto = l.motivoEspera === null ? (acaba !== null ? `Disco acaba em ${tempoAteAcabar(acaba)} no ritmo atual` : "Trabalho novo começa na hora")
    : `${l.motivoEspera === "disco" ? "Pouco espaço no disco" : l.motivoEspera === "memoria" ? "Pouca memória" : "Ocupada"} · ${esperam > 0 ? `${esperam} ${esperam === 1 ? "trabalho espera" : "trabalhos esperam"}` : "trabalho novo espera"} ${oQue}`;
  const nivel = l.motivoEspera === null ? (acaba !== null ? "amarela" : "verde") : l.seguraTudoNovo || l.pressao === "vermelha" ? "vermelha" : "amarela";
  const numeros = [
    `Memória ${NOME_MEMORIA[l.pressao]}`,
    l.processador ? `processador ${NOME_PROCESSADOR[l.processador]}${l.usoProcessador !== null ? ` (${Math.round(l.usoProcessador * 100)}% do tempo ocupado)` : ""}` : "processador sem leitura",
    l.fila && l.fila !== "verde" && l.cargaProcessador !== null ? `fila ${NOME_FILA[l.fila]} (${l.cargaProcessador.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} processos por núcleo)` : "",
    l.disco ? `disco com ${discoLegivel(l.disco.livreMb)} livres de ${discoLegivel(l.disco.totalMb)}${acaba !== null ? ` (no ritmo atual, acaba em ${tempoAteAcabar(acaba)}; o Nod limpa o que dá)` : ""}` : "disco sem leitura",
    l.memoriaBotsMb > 0 ? `os bots usam ${memoriaLegivel(l.memoriaBotsMb)}` : "",
  ].filter(Boolean).join(" · ");
  const porque = l.motivoEspera === null ? ""
    : l.seguraTudoNovo ? " Com o disco quase sem espaço, nenhuma task nova começa nela; as que já rodam continuam."
      : " Rotinas e pedidos entre bots que ainda não começaram esperam; o que você pede começa.";
  return `<details class="maq-leitura" data-disclosure="maq-leitura-${esc(id)}"><summary><span class="maq-nivel nivel-${nivel}" aria-hidden="true"></span><span>${esc(curto)}</span></summary><p class="mac-det-txt">${esc(numeros)}.${esc(porque)} O quanto os bots podem usar (Este Mac) vale para todas as máquinas.</p></details>`;
}

function cartao(estado: Estado, m: MaquinaDto): string {
  const aqui = botsDaPessoa(estado).filter((b) => maquinaDoBot(estado, b)?.id === m.id);
  const quem = aqui.length === 0 ? "Nenhum bot trabalha só aqui" : aqui.length === 1 ? `${aqui[0]!.nome} trabalha aqui` : `${aqui.length} bots trabalham aqui: ${aqui.map((b) => b.nome).join(", ")}`;
  const estadoTxt = m.conectada
    ? `<span class="maq-estado"><span class="maq-ponto" aria-hidden="true"></span>conectada</span>`
    : `<span class="maq-estado fora"><span class="maq-ponto fora" aria-hidden="true"></span>sem contato${m.ultimoUsoEm ? ` desde ${esc(hora(m.ultimoUsoEm))}` : ""}</span>`;
  return `<div class="espaco-cartao maq-cartao">
    <div class="maq-cab">
      <span class="maq-ic" aria-hidden="true">${m.plataforma === "darwin" ? ICONE.laptop : ICONE.servidor}</span>
      <span class="maq-id"><b>${esc(m.nome)}</b><small>${esc(nomePlataforma(m))} · chave …${esc(m.prefixo)}</small></span>
      ${estadoTxt}
    </div>
    ${chipsDasIas(m)}
    ${m.conectada ? leituraNoCartao(estado, m.id) : ""}
    <div class="maq-quem"><span class="maq-avatares">${aqui.slice(0, 6).map((b) => iconeAgente(b, "sm")).join("")}</span><span>${esc(quem)}</span></div>
  </div>`;
}

function seletor(rotulo: string, act: string, dados: Record<string, string>, atual: string | null, maquinas: MaquinaDto[], noMac: boolean): string {
  // ADR-092: com o servidor no Mac, a opção sem máquina é o próprio Mac — a VM só pega os bots escolhidos para ela.
  const opcoes = [{ id: "", nome: noMac ? "Este Mac" : "Qualquer uma" }, ...maquinas.map((m) => ({ id: m.id, nome: m.nome }))];
  return `<div class="segmentado maq" role="group" aria-label="${esc(rotulo)}">${opcoes.map((o) => {
    const ativo = (atual ?? "") === o.id;
    return `<button type="button" class="seg${ativo ? " ativo" : ""}" aria-pressed="${ativo}" data-act="${esc(act)}" data-maquina="${esc(o.id)}"${Object.entries(dados).map(([k, v]) => ` data-${k}="${esc(v)}"`).join("")}>${esc(o.nome)}</button>`;
  }).join("")}</div>`;
}

export function renderMaquinas(estado: Estado): string {
  const dados = estado.maquinas;
  const maquinas = dados?.maquinas ?? [];
  const bots = botsDaPessoa(estado);
  const noMac = !!dados?.servidorNoMac;
  const conectar = estado.conectarMaquina ? renderConectar(estado, estado.conectarMaquina) : "";
  const lista = !dados ? `<p class="intro">Carregando…</p>`
    : maquinas.length === 0 ? `<div class="espaco-cartao maq-vazio"><p>${noMac ? "Nenhuma máquina conectada ainda. Os bots rodam neste Mac; conecte uma VM Linux para mandar bots para ela." : "Nenhuma máquina conectada ainda. Conecte o app do Mac ou uma VM Linux para os bots trabalharem nela."}</p></div>`
    : maquinas.map((m) => cartao(estado, m)).join("");
  const linhasBots = bots.map((b) => `<div class="bot-maq">${iconeAgente(b, "sm")}<span class="bot-maq-txt"><b>${esc(b.nome)}</b><span>${esc(b.titulo)}</span></span>${seletor(`Onde ${b.nome} trabalha`, "maquina-do-bot", { id: b.id }, b.maquinaId ?? null, maquinas, noMac)}</div>`).join("");
  return `<section class="espaco-secao maquinas">
    <h2>Máquinas</h2>
    <div class="maq-topo"><p class="intro">Onde seus bots trabalham. A janela do Nod continua no Mac ou no navegador; cada bot roda o Claude Code ou o Codex na máquina escolhida para ele.</p>${estado.conectarMaquina ? "" : botao("conectar-maquina", `${ICONE.mais}Conectar uma máquina`, { classe: "pri" })}</div>
    ${conectar}
    <div class="maq-lista">${lista}</div>
    ${maquinas.length > 0 && bots.length > 0 ? `<h3 class="espaco-subtitulo">Onde cada bot trabalha</h3><div class="espaco-cartao bots-cartao">${linhasBots}</div>
    <h3 class="espaco-subtitulo">Bot sem escolha (e bot novo) trabalha em</h3>${seletor("Onde trabalha o bot sem escolha", "maquina-padrao", {}, dados?.padraoId ?? null, maquinas, noMac)}` : ""}
    <ul class="regras-maq">
      ${noMac ? `<li>"Este Mac": o bot roda aqui, onde o Nod está aberto. Uma VM só pega o trabalho dos bots escolhidos para ela.</li>
      <li>Se a máquina de um bot ficar sem contato, a conversa espera por ela. Para o bot voltar a rodar aqui, escolha "Este Mac" para ele.</li>`
    : `<li>"Qualquer uma": o primeiro computador conectado que estiver livre pega o trabalho.</li>
      <li>Se a máquina de um bot ficar sem contato, a conversa espera por ela; na mensagem você pode rodar em outra máquina só daquela vez.</li>`}
      <li>Rotinas não mudam de máquina sozinhas. Os arquivos de cada bot ficam na máquina onde ele trabalha.</li>
    </ul>
  </section>`;
}

function haQuantoPediu(s: number): string {
  if (s < 60) return "agora há pouco";
  const min = Math.round(s / 60);
  return min === 1 ? "há 1 minuto" : `há ${min} minutos`;
}

/** A máquina que apareceu depois do "Conectar" (a chave nova), quando o motor já trocou o código pela chave. */
export function maquinaNova(estado: Estado, c: ConectarMaquina): MaquinaDto | null {
  return (estado.maquinas?.maquinas ?? []).find((m) => !c.chavesAntes.includes(m.id)) ?? null;
}

function renderConectar(estado: Estado, c: ConectarMaquina): string {
  const passos = [
    ["comando", "Instalar"],
    ["codigo", "Digitar o código"],
    ["confirmar", "Confirmar"],
    ["ias", "Entrar nas IAs"],
    ["bots", "Escolher os bots"],
  ] as const;
  const indice = passos.findIndex(([id]) => id === c.passo);
  const trilha = `<ol class="cx-trilha">${passos.map(([id, nome], i) => `<li class="${i < indice ? "feito" : i === indice ? "agora" : ""}"${id === c.passo ? ' aria-current="step"' : ""}><span>${i < indice ? "✓" : i + 1}</span>${esc(nome)}</li>`).join("")}</ol>`;
  const erro = c.erro ? `<p class="cx-erro" role="alert">${esc(c.erro)}</p>` : "";
  const fechar = botao("fechar-conectar-maquina", "Fechar", { classe: "link" });
  const nova = maquinaNova(estado, c);
  let corpo = "";
  if (c.passo === "comando") {
    // O endereço deste Nod (a página é servida por ele); os testes de render rodam sem DOM.
    const origem = (globalThis as { location?: { origin?: string } }).location?.origin ?? "";
    // ADR-092: com o servidor no Mac, a VM chega à API deste Mac por um túnel SSH aberto daqui (nada fica exposto na
    // internet); o motor guarda o endereço da API, então o túnel e o comando usam a porta dela, não a desta página.
    const noMac = estado.maquinas?.servidorNoMac ?? null;
    const cmd = noMac ? `curl -fsSL ${noMac.api}/api/motor/instalar | sh` : `curl -fsSL ${origem}/motor | sh`;
    const porta = noMac ? (/:(\d+)$/.exec(noMac.api)?.[1] ?? "8888") : "";
    const tunel = `ssh -N -R ${porta}:127.0.0.1:${porta} voce@sua-vm`;
    corpo = `<h3>Rode este comando na sua máquina Linux</h3>
      <p>Debian ou Ubuntu, em qualquer provedor. Para começar, 2 vCPU e 4 GB; com vários bots rodando testes e builds, 4 vCPU e 8 GB. Ela não precisa de porta aberta: é a máquina que procura trabalho no Nod. Use a máquina só para o Nod.</p>
      ${noMac ? `<p>Este Nod roda no seu Mac. Antes, abra no Mac um túnel SSH para a VM e deixe-o aberto: com ele a VM enxerga o Nod em ${esc(noMac.api)}, só ela e sem porta aberta na internet.</p>
      <div class="cx-cmd"><code>${esc(tunel)}</code>${botao("copiar-texto", "Copiar", { classe: "sm", dados: { texto: tunel } })}</div>
      <p>Depois, no terminal da VM:</p>` : ""}
      <div class="cx-cmd"><code>${esc(cmd)}</code>${botao("copiar-texto", "Copiar", { classe: "sm", dados: { texto: cmd } })}</div>
      <p class="cx-nota">Ele instala o motor, cria o usuário nod e, no fim, mostra um código.</p>
      <div class="cx-rodape">${fechar}${botao("passo-conectar-maquina", "Apareceu um código", { classe: "pri", dados: { passo: "codigo" } })}</div>`;
  } else if (c.passo === "codigo") {
    corpo = `<h3>Digite o código da máquina</h3>
      <p>Ele aparece no fim da instalação e vale por alguns minutos.</p>
      <label class="cx-codigo" for="codigo-maquina"><span>Código</span><input id="codigo-maquina" type="text" value="${esc(c.codigo)}" autocomplete="off" spellcheck="false" maxlength="12" placeholder="K7QM-4F2X"></label>
      ${erro}
      <div class="cx-rodape">${botao("passo-conectar-maquina", "Voltar", { classe: "link", dados: { passo: "comando" } })}${botao("ver-codigo-maquina", "Continuar", { classe: "pri" })}</div>`;
  } else if (c.passo === "confirmar" && c.pedido) {
    corpo = `<h3>Conectar ${esc(c.pedido.nome)}?</h3>
      <div class="cx-confirma"><span class="maq-ic" aria-hidden="true">${ICONE.servidor}</span><div><b>${esc(c.pedido.nome)}</b><small>${c.pedido.plataforma === "linux" ? "Linux" : "Mac"} · código ${esc(c.codigo.toUpperCase())} · pediu ${esc(haQuantoPediu(c.pedido.pedidoHaS))}</small></div></div>
      <p class="cx-nota">Conecte só se foi você quem rodou o comando nessa máquina agora e o código é o que apareceu nela. Quem conecta uma máquina passa a receber o trabalho dos bots que você mover para ela.</p>
      ${erro}
      <div class="cx-rodape">${botao("passo-conectar-maquina", "Voltar", { classe: "link", dados: { passo: "codigo" } })}${botao("aprovar-maquina", `Conectar ${esc(c.pedido.nome)}`, { classe: "pri" })}</div>`;
  } else if (c.passo === "ias") {
    const nome = nova?.nome ?? c.pedido?.nome ?? "a máquina";
    const claude = nova?.ias["claude-cli"];
    const estadoClaude = !nova ? "esperando a máquina terminar de conectar…" : claude === "pronto" ? "pronto" : "aguardando o login";
    corpo = `<h3>Entre nas suas IAs na ${esc(nome)}</h3>
      <p>Rode cada comando no terminal da máquina. O login é seu, direto com a Anthropic, a OpenAI e o GitHub: o Nod não vê sua senha nem sua chave. Esta tela percebe sozinha quando ficar pronto.</p>
      <div class="espaco-cartao">
        <div class="cx-ia"><span class="cx-ia-txt"><b>Claude Code</b><code>nod-motor entrar claude</code></span><span class="cx-st${claude === "pronto" ? " ok" : ""}"><i aria-hidden="true"></i>${esc(estadoClaude)}</span></div>
        <div class="cx-ia"><span class="cx-ia-txt"><b>Codex</b><code>nod-motor entrar codex</code></span><span class="cx-st">opcional (instale com NOD_COM_CODEX=1)</span></div>
        <div class="cx-ia"><span class="cx-ia-txt"><b>GitHub</b><code>nod-motor entrar github</code></span><span class="cx-st">opcional</span></div>
      </div>
      <div class="cx-rodape">${fechar}${botao("passo-conectar-maquina", "Continuar", { classe: "pri", dados: { passo: "bots" }, desabilitado: !nova })}</div>`;
  } else if (c.passo === "bots") {
    const bots = botsDaPessoa(estado);
    const n = c.marcados.length;
    const linhas = bots.map((b) => {
      const marcado = c.marcados.includes(b.id);
      return `<button type="button" class="cx-bot" role="checkbox" aria-checked="${marcado}" data-act="marcar-bot-maquina" data-id="${esc(b.id)}"><span class="cx-check" aria-hidden="true">${marcado ? "✓" : ""}</span>${iconeAgente(b, "sm")}<span>${esc(b.nome)}</span><small>${esc(b.titulo)}</small></button>`;
    }).join("");
    corpo = `<h3>Quem passa a trabalhar na ${esc(nova?.nome ?? "máquina")}?</h3>
      <p>Eles saem do seu Mac a partir do próximo trabalho. O que está rodando agora termina onde começou.${estado.maquinas?.servidorNoMac ? " Os outros, e bot novo, continuam neste Mac." : " Bot novo também passa a trabalhar nela."}</p>
      <div class="espaco-cartao cx-bots"><div class="cx-bots-cab"><span>${n} de ${bots.length} bots</span>${botao("marcar-bots-maquina", "Marcar todos", { classe: "link", dados: { todos: "1" }, desabilitado: n === bots.length })}${botao("marcar-bots-maquina", "Nenhum", { classe: "link", dados: { todos: "0" }, desabilitado: n === 0 })}</div>${linhas}</div>
      ${erro}
      <div class="cx-rodape">${botao("fechar-conectar-maquina", "Agora não", { classe: "link" })}${botao("mover-bots-maquina", n === 0 ? "Concluir" : n === 1 ? "Mover 1 bot" : `Mover ${n} bots`, { classe: "pri" })}</div>`;
  }
  return `<div class="espaco-cartao cx-painel" aria-label="Conectar uma máquina">${trilha}<div class="cx-corpo">${corpo}</div></div>`;
}
