import type { Estado } from "../estado/reducer.ts";
import { botao, dataHora, esc, iconeAgente } from "../lib/render.ts";
import { MOTIVO_FALHA_TEXTO } from "../lib/computador.ts";
import { botaoDaParada, desdeDaParada, rotuloExecucao, tagDaParada } from "../lib/execucao.ts";
import { interpolar } from "../lib/relogio.ts";
import { nomeInteligencia } from "./inteligencia.ts";
import { blocoEsperando, conectorDoApp, nivelDoBot, ROTULO_NIVEL, situacaoDoApp, type Nivel } from "./app-acesso.ts";
import { logoApp } from "./marketplace.ts";

/**
 * "+ Dar acesso" do painel do bot (definido em 2026-09-25, jornadas de conexão): em cima, os apps que a
 * pessoa já conectou, com o nível deste bot (Nenhum / Ler / Ler e alterar); embaixo, os que faltam
 * conectar, com "Conectar" ali mesmo. Conectou, o app sobe para a lista de cima e a pessoa escolhe o nível.
 */
function popoverDarAcesso(estado: Estado, agenteId: string, nomeBot: string): string {
  const seg = (conectorId: string, atual: Nivel) => `<div class="segmentado sm" role="group" aria-label="${esc(`Acesso de ${nomeBot}`)}">${(["nenhum", "leitura", "escrita"] as const).map((n) => `<button type="button" class="seg${n === atual ? " ativo" : ""}" data-act="nivel-bot" data-id="${esc(agenteId)}" data-conector="${esc(conectorId)}" data-nivel="${n}" aria-pressed="${n === atual}">${esc(ROTULO_NIVEL[n])}</button>`).join("")}</div>`;
  const conectados = estado.marketplace.flatMap((app) => {
    const c = conectorDoApp(estado, app.slug);
    return c?.habilitado ? [`<div class="da-linha">${logoApp(app.slug, app.nome, !!app.logo)}<div class="da-nome"><b>${esc(app.nome)}</b>${seg(c.id, nivelDoBot(estado, agenteId, c))}</div></div>`] : [];
  });
  const faltam = estado.marketplace.filter((app) => situacaoDoApp(estado, app.slug) !== "conectado").slice(0, 6).map((app) => {
    const login = estado.conectando[app.slug];
    const acao = login && !login.falhou ? blocoEsperando(app.nome, login.url, true) : botao("conectar-app", login?.falhou ? "Tentar de novo" : "Conectar", { classe: "sm", id: app.slug });
    return `<div class="da-linha">${logoApp(app.slug, app.nome, !!app.logo)}<div class="da-nome"><b>${esc(app.nome)}</b></div>${acao}</div>`;
  });
  return `<div class="dar-acesso" role="dialog" aria-label="${esc(`Dar a ${nomeBot} acesso a um app`)}">
    <div class="da-cab"><b>Dar a ${esc(nomeBot)} acesso a…</b>${botao("dar-acesso", "×", { classe: "link", id: agenteId, aria: "Fechar" })}</div>
    ${conectados.length ? `<div class="da-grupo"><small>Já conectados por você</small>${conectados.join("")}</div>` : ""}
    ${faltam.length ? `<div class="da-grupo"><small>Conectar e dar acesso</small>${faltam.join("")}</div>` : ""}
    ${botao("navegar", "Ver todos no Marketplace", { classe: "link sm", dados: { tela: "conectores" } })}
  </div>`;
}

/**
 * Painel do bot (ADR-032: "painel de detalhes com perfil, colegas e rotinas"). Desde 2026-09-18 ele é
 * o lar do que É DO BOT — rotinas e acessos concedidos são por agente, nunca lugares próprios; por
 * isso saíram do rail e vieram para cá, ao lado da conversa a que pertencem. As telas cheias
 * (`rotinas`, `conectores`) continuam existindo e são alcançadas daqui, para o que não cabe no painel.
 */
/** "SLACK_FETCH_MESSAGE_THREAD" do conector Slack → "Fetch message thread": sem o prefixo do app, sem caixa alta. */
export function nomeLegivel(capacidade: string, conector: string): string {
  const prefixo = conector.toLowerCase().replace(/[^a-z0-9]+/g, "_") + "_";
  let nome = capacidade.toLowerCase();
  if (nome.startsWith(prefixo)) nome = nome.slice(prefixo.length);
  nome = nome.replace(/[_.-]+/g, " ").trim();
  return nome ? nome[0]!.toUpperCase() + nome.slice(1) : capacidade;
}

export function renderDetalhes(estado: Estado): string {
  const t = estado.tela;
  if (t.tipo !== "conversa") return "";
  const a = estado.frota?.agentes.find((b) => b.id === t.agenteId);
  if (!a) return "";
  const colegas = (estado.frota?.agentes ?? []).filter((b) => b.id !== a.id && b.ownerId === a.ownerId && b.confirmado);
  const rotinas = estado.rotinas.filter((r) => r.rotina.agenteId === a.id);
  const concessoes = estado.concessoes[a.id] ?? [];
  const dona = a.ownerId === estado.sessao?.pessoaId;

  /**
   * definido em 2026-09-24 (ADR-044): um clique concede as ferramentas de leitura de um app inteiro, e
   * 28 linhas de nome técnico escondiam o que importa. Uma linha por app e nível ("Gmail · só leitura ·
   * 28 ações"), os nomes no <details> e revogar tira o grupo de uma vez, com um registro só. O nível é
   * o readOnlyHint da sonda; o que o catálogo não descreve conta como escrita — o painel não promete
   * "só leitura" sem a sonda dizer.
   */
  const grupos = new Map<string, { nome: string; leitura: boolean; indisponivel: boolean; itens: typeof concessoes }>();
  const descricaoDe = new Map<string, string>();
  for (const g of concessoes) {
    const c = estado.conectores.find((x) => x.id === g.conectorId);
    const cap = c?.catalogo.find((x) => x.nome === g.capacidade);
    const leitura = cap?.readOnlyHint === true;
    if (cap?.descricao) descricaoDe.set(g.id, cap.descricao);
    const chave = `${g.conectorId}:${leitura ? "leitura" : "escrita"}`;
    const grupo = grupos.get(chave) ?? { nome: c?.nome ?? "conector", leitura, indisponivel: Boolean(c?.ultimaFalha), itens: [] };
    grupo.itens.push(g);
    grupos.set(chave, grupo);
  }
  // definido em 2026-09-24 (revisão da interface): o card diz em palavras o que o nível permite, e a
  // lista aberta mostra a descrição do catálogo — o nome técnico fica pequeno ao lado, para quem procura.
  const acessos = [...grupos.entries()]
    .map(([chave, g]) => {
      const indisponivel = g.indisponivel ? '<span class="tag tag-ambar" title="o conector está fora do ar">indisponível</span>' : "";
      const acoes = `${g.itens.length} ${g.itens.length === 1 ? "ação permitida" : "ações permitidas"}`;
      const frase = g.leitura ? "Pode consultar. Não envia nem altera nada." : "Pode fazer alterações em seu nome.";
      // definido em 2026-09-24: a descrição do catálogo tem parágrafos de instrução para o modelo — ilegível
      // aqui. Cada ação vira UMA linha com o nome legível; a descrição inteira fica no title.
      const itens = g.itens
        .map((i) => `<li title="${esc(descricaoDe.get(i.id) ?? i.capacidade)}">${esc(nomeLegivel(i.capacidade, g.nome))}</li>`)
        .join("");
      const nomes = `<details data-disclosure="acessos-${esc(a.id)}-${esc(chave)}"><summary>${acoes}</summary><ul class="acesso-acoes">${itens}</ul></details>`;
      return `<li class="acesso"><div class="acesso-cab"><span class="acesso-marca" aria-hidden="true">${esc(g.nome.slice(0, 1).toUpperCase())}</span><div><b>${esc(g.nome)}</b><small>${g.leitura ? "só leitura" : "pode alterar"}</small></div>${indisponivel}</div><p class="acesso-frase">${frase}</p><div class="acesso-rodape">${nomes}${botao("revogar-acessos", "Revogar", { classe: "link sm perigo", dados: { agente: a.id, ids: g.itens.map((i) => i.id).join(",") }, titulo: g.itens.length === 1 ? "revoga a ação deste grupo" : `revoga as ${g.itens.length} ações deste grupo` })}</div></li>`;
    })
    .join("");

  // definido em 2026-09-21: uma rotina pode encerrar em SILÊNCIO (desfecho sem_novidade não escreve
  // nada na conversa). Sem este histórico aqui a pessoa não teria como saber que ela rodou — o
  // painel é o lugar onde "rodou e não tinha nada" fica visível.
  const historico = (r: (typeof rotinas)[number]["rotina"]) => {
    const aberto = estado.historicoAberto[r.id] === true;
    const alternar = botao("ver-execucoes", aberto ? "Ocultar histórico" : "Histórico", { classe: "link sm", id: r.id });
    if (!aberto) return alternar;
    const exec = estado.execucoes[r.id];
    const lista = !exec ? '<p class="mudo sm">carregando…</p>' : !exec.length ? '<p class="mudo sm">nunca executou</p>' : `<ul class="dr-execucoes">${exec
      .slice(0, 3)
      .map((e) => `<li class="exec exec-${esc(e.desfecho)}">${esc(dataHora(e.em, r.fusoIana))} · ${esc(rotuloExecucao(e))}</li>`)
      .join("")}</ul>`;
    return alternar + lista;
  };

  // definido em 2026-09-24 (revisão da interface): um cartão por rotina — nome e chave liga/desliga no
  // topo, quando roda embaixo, Testar e Histórico no rodapé. A chave é o mesmo pausar/ativar de antes.
  // definido em 2026-09-24 (emenda da ADR-044): a rotina parada por falta de acesso diz qual app falta e
  // traz o mesmo botão de um clique do card, sem a pessoa procurar o card na conversa.
  const linhaRotina = ({ rotina: r, proximaExecucao, bloqueio }: (typeof rotinas)[number]) => {
    const ativa = r.estado === "ativa";
    const quando = ativa ? `próxima ${dataHora(proximaExecucao, r.fusoIana)} · ${interpolar(proximaExecucao, estado.agora)}` : "Pausada";
    const parada = bloqueio ? `<div class="dr-parada">${tagDaParada(bloqueio)}<small>${esc(desdeDaParada(bloqueio, estado.agora))}</small>${botaoDaParada(bloqueio, "pri sm")}</div>` : "";
    const chave = `<button type="button" class="chave" role="switch" aria-checked="${ativa}" data-act="${ativa ? "pausar-rotina" : "ativar-rotina"}" data-id="${esc(r.id)}" aria-label="${ativa ? "Pausar" : "Ativar"} a rotina ${esc(r.instrucao)}"><span></span></button>`;
    return `<li class="detalhe-rotina rotina-${esc(r.estado)}">
      <div class="dr-cab"><b title="${esc(r.instrucao)}">${esc(r.instrucao)}</b>${chave}</div>
      <small>${esc(quando)}</small>
      ${parada}
      <div class="dr-acoes">${botao("executar-rotina", "Testar", { classe: "link sm", id: r.id, dados: { agente: r.agenteId }, desabilitado: estado.ocupado })}${historico(r)}</div>
    </li>`;
  };

  // definido em 2026-09-24 (emenda da ADR-037): fora do ar, o computador do bot abre o painel — é o
  // estado que muda o que o bot consegue fazer agora. Ligado e respondendo, não ocupa lugar.
  const fora = a.computadorForaDoAr && dona ? a.computadorForaDoAr : null;
  const computador = fora
    ? `<section class="detalhes-secao"><h3>Computador do bot</h3><div class="detalhe-computador-fora"><span class="tag tag-vermelha">fora do ar</span><p>Desde ${esc(dataHora(fora.desde))} · ${esc(MOTIVO_FALHA_TEXTO[fora.motivo])}.</p><div class="dr-acoes">${botao("religar-computador", "Tentar de novo", { classe: "link sm", id: a.id })}${botao("abrir-computador", "Abrir computador", { classe: "link sm", id: a.id })}</div></div></section>`
    : "";

  return `<div class="detalhes-perfil"><div class="detalhes-identidade">${iconeAgente(a, "lg")}<div><h2>${esc(a.nome)}</h2><span>${esc(a.titulo || "Seu bot")}</span></div></div><p>${esc(a.descricao || "Conte na conversa como este bot pode ajudar você.")}</p>${botao("ir-perfil", "Editar perfil", { id: a.id, classe: "link" })}</div>
    ${computador}
    <section class="detalhes-secao"><h3>Atalhos</h3>
      ${botao("preencher-prompt", "✧  Planejar uma tarefa", { classe: "atalho", dados: { texto: "Me ajude a planejar esta tarefa: " } })}
      ${botao("preencher-prompt", "↗  Pedir ajuda a outro bot", { classe: "atalho", dados: { texto: "Consulte o colega mais adequado da minha equipe para me ajudar com: " } })}
      ${botao("ir-memoria", "▤  Ver memória", { classe: "atalho", id: a.id })}
    </section>
    <section class="detalhes-secao"><div class="secao-titulo"><h3>Rotinas</h3>${botao("nova-rotina", "+ Nova", { classe: "link", id: a.id })}</div>
      ${rotinas.length ? `<ul class="lista-cartoes">${rotinas.slice(0, 4).map(linhaRotina).join("")}</ul>` : '<p class="mudo">Uma tarefa que se repete? Programe aqui ou peça na conversa.</p>'}
      ${rotinas.length > 4 ? botao("navegar", `ver todas as ${rotinas.length}`, { classe: "link sm", dados: { tela: "rotinas" } }) : ""}
    </section>
    <section class="detalhes-secao secao-acessos"><div class="secao-titulo"><h3>Acessos</h3>${dona ? botao("dar-acesso", "+ Dar acesso", { classe: "link", id: a.id, aria: `Dar a ${a.nome} acesso a um app` }) : ""}</div>
      ${dona && estado.dandoAcesso === a.id ? popoverDarAcesso(estado, a.id, a.nome) : ""}
      ${acessos ? `<ul class="lista-cartoes">${acessos}</ul>` : '<p class="mudo">Este bot ainda não usa nenhuma ferramenta externa. Ele pede o acesso quando precisar — ou dê você mesmo.</p>'}
    </section>
    <section class="detalhes-secao"><div class="secao-titulo"><h3>Colabora com</h3>${botao("navegar", "Criar sala", { classe: "link", dados: { tela: "nova-sala" } })}</div>
      ${colegas.length ? colegas.slice(0, 8).map((b) => `<button class="colega" data-act="preencher-prompt" data-texto="Consulte @${esc(b.nome)} sobre: ">${iconeAgente(b)}<div><b>${esc(b.nome)}</b><small>${esc(b.titulo || "Bot da sua equipe")}</small></div></button>`).join("") : '<p class="mudo">Crie outro bot para eles trabalharem juntos.</p>'}
    </section>
    <section class="detalhes-secao"><h3>Ambiente</h3>
      ${dona ? botao("abrir-computador", `Computador do bot${a.computadorForaDoAr ? ' <span class="tag tag-vermelha">fora do ar</span>' : ""}`, { classe: "atalho", id: a.id, titulo: "O computador próprio do bot (ADR-037), não o seu Mac" }) : ""}
      ${dona ? botao("abrir-workspace", "Pasta de trabalho", { classe: "atalho", id: a.id }) : ""}
      ${dona ? botao("inteligencia", `✦ ${nomeInteligencia(a, estado.executor?.harnesses)}`, { classe: "atalho", id: a.id, titulo: "Inteligência do agente: modelo e harness" }) : ""}
      <p class="mudo">${estado.executor?.atual === "catcher" ? "Simulação · respostas de teste" : "Sua conta de IA · computador conectado"}</p>
    </section>`;
}
