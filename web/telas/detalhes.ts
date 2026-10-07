import { secaoOnboardingDetalhes } from "./onboarding.ts";
import type { RotinaDto } from "../../src/contracts/api.ts";
import type { Estado, NivelGaveta } from "../estado/reducer.ts";
import { botao, dataHora, esc, iconeAgente } from "../lib/render.ts";
import { ICONE } from "../lib/icones.ts";
import { MOTIVO_FALHA_TEXTO } from "../lib/computador.ts";
import { botaoDaParada, desdeDaParada, rotuloExecucao, tagDaParada } from "../lib/execucao.ts";
import { CORES_MASCOTE, FORMAS_MASCOTE } from "../lib/mascote.ts";
import { VELOCIDADES, VOZES } from "./ligacao.ts";
import { caminhoDaPastaDoBot } from "../lib/pasta-do-bot.ts";
import { interpolar } from "../lib/relogio.ts";
import { nomeInteligencia, renderInteligencia } from "./inteligencia.ts";
import { MODOS } from "./aprovacoes.ts";
import { blocoEsperando, conectorDoApp, nivelDoBot, ROTULO_NIVEL, situacaoDoApp, type NivelAtual } from "./app-acesso.ts";
import { logoApp } from "./marketplace.ts";
import { renderMemoriaNaGaveta } from "./memoria.ts";
import { renderNovaRotinaNaGaveta } from "./nova-rotina.ts";
import { renderAFazerNaGaveta } from "./pendencias.ts";
import { textoMotivo } from "./negacao.ts";

type Bot = NonNullable<Estado["frota"]>["agentes"][number];
type Concessoes = Estado["concessoes"][string];

/**
 * A gaveta do bot (ADR-032: "painel de detalhes com perfil, colegas e rotinas"). Desde 2026-09-18 ela é o lar do que É
 * DO BOT. definido em 2026-09-30 (canvas "Menu, sidebar e gaveta"): 380 px e por níveis — rotina, acesso a um app,
 * Editar perfil, Memória, Inteligência, Nova rotina e Dar acesso abrem DENTRO dela, com ‹ para voltar à visão geral e a
 * conversa continuando ao lado. O ícone do painel fecha a gaveta inteira, de qualquer nível.
 */
export function renderDetalhes(estado: Estado): string {
  const t = estado.tela;
  if (t.tipo !== "conversa") return "";
  const a = estado.frota?.agentes.find((b) => b.id === t.agenteId);
  if (!a) return "";
  const dona = a.ownerId === estado.sessao?.pessoaId;
  const painel = `<button type="button" class="gv-icone gv-painel" data-act="alternar-detalhes" aria-label="Esconder painel" title="Esconder painel">${ICONE.painel}</button>`;
  const nivel = estado.gaveta?.agenteId === a.id ? estado.gaveta.nivel : null;
  if (!nivel) {
    const opcoes = `<button type="button" class="gv-icone" data-act="menu-agente" data-id="${esc(a.id)}" aria-haspopup="menu" aria-label="Opções de ${esc(a.nome)}" title="Opções de ${esc(a.nome)}">${ICONE.pontos}</button>`;
    return `<div class="gv-topo"><span class="gv-lado"></span><span class="gv-titulo"></span><span class="gv-lado gv-direita">${opcoes}${painel}</span></div>
      <div class="gv-corpo">${visaoGeral(estado, a, dona)}</div>`;
  }
  const n = renderNivel(estado, a, dona, nivel);
  const voltar = `<button type="button" class="gv-icone gv-voltar" data-act="gaveta-voltar" aria-label="Voltar para os detalhes de ${esc(a.nome)}" title="Voltar (Esc)">${ICONE.voltar}</button>`;
  const topo = `<div class="gv-topo"><span class="gv-lado">${voltar}</span><h2 class="gv-titulo" title="${esc(n.titulo)}">${esc(n.titulo)}</h2><span class="gv-lado gv-direita">${painel}</span></div>`;
  const corpo = `<div class="gv-corpo">${n.corpo}</div>${n.rodape ? `<div class="gv-rodape">${n.rodape}</div>` : ""}`;
  return topo + (n.form ? `<form class="gv-form" ${n.form}>${corpo}</form>` : corpo);
}

// ---- visão geral ----------------------------------------------------------------------------------------------------

function visaoGeral(estado: Estado, a: Bot, dona: boolean): string {
  const rotinas = estado.rotinas.filter((r) => r.rotina.agenteId === a.id);
  const grupos = gruposDeAcesso(estado, a.id);
  const colegas = (estado.frota?.agentes ?? []).filter((b) => b.id !== a.id && b.ownerId === a.ownerId && b.confirmado);
  const linha = (conteudo: string, dados: string, extra = "") => `<button type="button" class="gv-linha" ${dados}>${conteudo}${extra}</button>`;
  const irPara = (nivel: NivelGaveta["tipo"], id = "") => `data-act="gaveta" data-nivel="${nivel}" data-agente="${esc(a.id)}"${id ? ` data-id="${esc(id)}"` : ""}`;
  const identidade = `<div class="gv-identidade">${iconeAgente(a, "xl")}<h2>${esc(a.nome)}</h2><span>${esc(a.titulo || "Seu bot")}</span>
    <p class="gv-descricao">${esc(a.descricao || "Conte na conversa como este bot pode ajudar você.")}</p>
    ${dona ? `<button type="button" class="gv-pilula" ${irPara("perfil")}>Editar perfil</button>` : ""}</div>`;

  // definido em 2026-09-24 (emenda da ADR-037): fora do ar, o computador do bot abre o painel — é o estado que muda o que
  // o bot consegue fazer agora. Ligado e respondendo, não ocupa lugar.
  const fora = a.computadorForaDoAr && dona ? a.computadorForaDoAr : null;
  const computador = fora
    ? `<section class="gv-secao"><h3>Computador do bot</h3><div class="detalhe-computador-fora"><span class="tag tag-vermelha">fora do ar</span><p>Desde ${esc(dataHora(fora.desde))} · ${esc(MOTIVO_FALHA_TEXTO[fora.motivo])}.</p><div class="dr-acoes">${botao("religar-computador", "Tentar de novo", { classe: "link sm", id: a.id })}${botao("abrir-computador", "Abrir computador", { classe: "link sm", id: a.id })}</div></div></section>`
    : "";

  const atalhos = `<section class="gv-secao"><h3>Atalhos</h3><div class="gv-cartao">
      ${linha(`${ICONE.brilho}<span class="gv-linha-txt">Planejar uma tarefa</span>`, 'data-act="preencher-prompt" data-texto="Me ajude a planejar esta tarefa: "')}
      ${linha(`${ICONE.balao}<span class="gv-linha-txt">Pedir ajuda a outro bot</span>`, 'data-act="preencher-prompt" data-texto="Consulte o colega mais adequado da minha equipe para me ajudar com: "')}
      ${linha(`${ICONE.livro}<span class="gv-linha-txt">Memória</span>`, irPara("memoria"), ICONE.seta)}
    </div></section>`;

  // definido em 2026-09-24 (revisão da interface): a chave liga/desliga fica na linha; o resto da rotina (instrução,
  // quando, histórico, Testar) abre no nível dela. A rotina parada por falta de acesso diz o app ali mesmo (ADR-044).
  const linhaRotina = ({ rotina: r, proximaExecucao, bloqueio, resumo }: RotinaDto) => {
    const ativa = r.estado === "ativa";
    // "só com pendência" (definido em 2026-10-01, item 7 da ADR-066): a próxima janela só vira turno se o bot tiver pendência.
    const quando = [resumo ? capitalizar(semFuso(resumo)) : "", ativa ? `próxima ${interpolar(proximaExecucao, estado.agora)}` : "Pausada", r.soComPendencia ? "só com pendência" : ""].filter(Boolean).join(" · ");
    const chave = `<button type="button" class="chave" role="switch" aria-checked="${ativa}" data-act="${ativa ? "pausar-rotina" : "ativar-rotina"}" data-id="${esc(r.id)}" aria-label="${ativa ? "Pausar" : "Ativar"} a rotina ${esc(r.instrucao)}"><span></span></button>`;
    // A parada por falta de acesso fica à vista na linha, com o botão de um clique (emenda da ADR-044): é o que pede a pessoa.
    const parada = bloqueio ? `<div class="dr-parada">${tagDaParada(bloqueio)}<small>${esc(desdeDaParada(bloqueio, estado.agora))}</small>${botaoDaParada(bloqueio, "pri sm")}</div>` : "";
    return `<li class="detalhe-rotina rotina-${esc(r.estado)}${bloqueio ? " rotina-parada" : ""}">${linha(`<span class="gv-linha-txt"><b title="${esc(r.instrucao)}">${esc(r.instrucao)}</b><small>${esc(quando)}</small></span>`, irPara("rotina", r.id))}${chave}${parada}</li>`;
  };
  const rotinasHtml = `<section class="gv-secao"><div class="gv-secao-cab"><h3>Rotinas</h3>${dona ? `<button type="button" class="gv-link" ${irPara("nova-rotina")}>+ Nova</button>` : ""}</div>
      ${rotinas.length ? `<ul class="gv-cartao">${rotinas.map(linhaRotina).join("")}</ul>` : '<p class="mudo">Uma tarefa que se repete? Programe aqui ou peça na conversa.</p>'}
    </section>`;

  const acessos = grupos
    .map((g) => `<li class="acesso">${linha(`${logoApp(estado, g.slug, g.nome)}<span class="gv-linha-txt"><b>${esc(g.nome)}</b><small>${esc(nivelDoGrupo(g).rotulo)}</small></span>${g.indisponivel ? '<span class="tag tag-ambar" title="o conector está fora do ar">indisponível</span>' : ""}`, irPara("acesso", g.chave), ICONE.seta)}</li>`)
    .join("");
  const acessosHtml = `<section class="gv-secao secao-acessos"><div class="gv-secao-cab"><h3>Acessos</h3>${dona ? `<button type="button" class="gv-link" ${irPara("dar-acesso")} aria-label="Dar a ${esc(a.nome)} acesso a um app">+ Dar acesso</button>` : ""}</div>
      ${acessos ? `<ul class="gv-cartao">${acessos}</ul>` : '<p class="mudo">Este bot ainda não usa nenhuma ferramenta externa. Ele pede o acesso quando precisar — ou dê você mesmo.</p>'}
    </section>`;

  const colegasHtml = `<section class="gv-secao"><div class="gv-secao-cab"><h3>Colabora com</h3><button type="button" class="gv-link" data-act="navegar" data-tela="nova-sala">Criar sala</button></div>
      ${colegas.length ? `<div class="gv-cartao">${colegas.slice(0, 8).map((b) => `<button type="button" class="gv-linha colega" data-act="preencher-prompt" data-texto="Consulte @${esc(b.nome)} sobre: ">${iconeAgente(b, "sm")}<span class="gv-linha-txt"><b>${esc(b.nome)}</b><small>${esc(b.titulo || "Bot da sua equipe")}</small></span></button>`).join("")}</div>` : '<p class="mudo">Crie outro bot para eles trabalharem juntos.</p>'}
    </section>`;

  const modo = MODOS[a.modoAprovacao ?? "manual"];
  const ambiente = dona
    ? `<div class="gv-cartao">
        ${linha(`${ICONE.monitor}<span class="gv-linha-txt">Computador do bot</span>${a.computadorForaDoAr ? '<span class="tag tag-vermelha">fora do ar</span>' : ""}`, `data-act="abrir-computador" data-id="${esc(a.id)}" title="O computador próprio do bot (ADR-037), não o seu Mac"`)}
        ${linha(`${ICONE.pasta}<span class="gv-linha-txt">Pasta de trabalho${a.harness !== "codex-cli" ? `<small><code>${esc(caminhoDaPastaDoBot(a.nome))}</code></small>` : ""}</span>`, `data-act="abrir-workspace" data-id="${esc(a.id)}"`)}
        ${linha(`${ICONE.estrela}<span class="gv-linha-txt">Inteligência</span><span class="gv-meta">${esc(nomeInteligencia(a, estado.executor?.harnesses))}</span>`, irPara("inteligencia"), ICONE.seta)}
        ${linha(`${ICONE.escudo}<span class="gv-linha-txt">Aprovações</span><span class="gv-meta">${esc(modo.curto)}</span>`, `data-act="modo-aprovacao" data-id="${esc(a.id)}" title="${esc(`${modo.titulo}: ${modo.descricao}`)}"`)}
      </div>`
    : `<p class="mudo">Aprovações: ${esc(modo.titulo)}</p>`;
  const ambienteHtml = `<section class="gv-secao"><h3>Ambiente</h3>${ambiente}<p class="mudo gv-nota">${estado.executor?.atual === "catcher" ? "Simulação · respostas de teste" : "Sua conta de IA · computador conectado"}</p></section>`;

  // ADR-064: o "a fazer" do bot acima de Rotinas, com as mesmas ações da lista embaixo da conversa.
  const aFazer = dona ? renderAFazerNaGaveta(estado, a.id) : "";
  // ADR-077: durante a configuração guiada, o painel da guia mostra o que a pessoa contou e o que já foi montado.
  const o = estado.onboarding;
  const onboarding = estado.onboardingAberto && o && o.guia?.id === a.id && (o.etapa === "entrevista" || o.etapa === "configurando" || o.etapa === "concluido") ? secaoOnboardingDetalhes(o) : "";
  return identidade + onboarding + computador + atalhos + aFazer + rotinasHtml + acessosHtml + colegasHtml + ambienteHtml;
}

// ---- níveis ---------------------------------------------------------------------------------------------------------

type Nivel = { titulo: string; corpo: string; rodape?: string; form?: string };

function renderNivel(estado: Estado, a: Bot, dona: boolean, nivel: NivelGaveta): Nivel {
  switch (nivel.tipo) {
    case "rotina":
      return nivelRotina(estado, a, nivel.id);
    case "acesso":
      return nivelAcesso(estado, a, dona, nivel.id);
    case "dar-acesso":
      return { titulo: `Dar acesso a ${a.nome}`, corpo: darAcesso(estado, a.id, a.nome) };
    case "perfil":
      return nivelPerfil(a);
    case "memoria":
      return { titulo: "Memória", corpo: renderMemoriaNaGaveta(estado, a.id) };
    case "inteligencia":
      return {
        titulo: "Inteligência",
        corpo: renderInteligencia(a, estado.executor?.harnesses, true),
        rodape: rodapeDeFormulario("Salvar escolha"),
        form: `data-form="inteligencia" data-id="${esc(a.id)}"`,
      };
    case "nova-rotina":
      return { titulo: "Nova rotina", corpo: renderNovaRotinaNaGaveta(a), rodape: rodapeDeFormulario("Criar rotina"), form: 'data-form="criar-rotina"' };
  }
}

const rodapeDeFormulario = (salvar: string) => `<button type="button" class="gv-bt" data-act="gaveta-voltar">Cancelar</button><button type="submit" class="gv-bt pri">${esc(salvar)}</button>`;

/** Rotina: instrução inteira, quando roda, as últimas execuções (a silenciosa também, ADR de 2026-09-21) e as ações. */
function nivelRotina(estado: Estado, a: Bot, id: string): Nivel {
  const dto = estado.rotinas.find((r) => r.rotina.id === id && r.rotina.agenteId === a.id);
  if (!dto) return { titulo: "Rotina", corpo: '<p class="mudo">Esta rotina não existe mais.</p>' };
  const { rotina: r, proximaExecucao, bloqueio, resumo } = dto;
  const ativa = r.estado === "ativa";
  const exec = estado.execucoes[r.id];
  const execucoes = !exec
    ? '<p class="mudo">carregando…</p>'
    : !exec.length
      ? '<p class="mudo">nunca executou</p>'
      : `<ul class="gv-execucoes">${exec.slice(0, 5).map((e) => `<li class="exec exec-${esc(e.desfecho)}"><span class="gv-exec-ponto" aria-hidden="true"></span><span class="gv-exec-quando">${esc(dataHora(e.em, r.fusoIana))}</span><span>${esc(rotuloExecucao(e))}</span></li>`).join("")}</ul>`;
  const parada = bloqueio ? `<div class="dr-parada">${tagDaParada(bloqueio)}<small>${esc(desdeDaParada(bloqueio, estado.agora))}</small>${botaoDaParada(bloqueio, "pri sm")}</div>` : "";
  const detalhe = (rotulo: string, valor: string) => (valor ? `<dt>${esc(rotulo)}</dt><dd>${esc(valor)}</dd>` : "");
  const corpo = `${parada}
    <section class="gv-bloco"><h3>Instrução</h3><p class="gv-texto">${esc(r.instrucao)}</p></section>
    <section class="gv-bloco"><h3>Quando executar</h3><p class="gv-quando">${ICONE.relogio}<span>${esc(resumo ? capitalizar(resumo) : `${r.cron} (${r.fusoIana})`)}</span></p>
      <small class="gv-proxima">${ativa ? `Próxima: ${esc(dataHora(proximaExecucao, r.fusoIana))} · ${esc(interpolar(proximaExecucao, estado.agora))}` : "Pausada"}</small>${r.soComPendencia ? '<small class="gv-proxima">Só acorda quando o bot tem pendência aberta; sem nenhuma, a janela passa sem turno e sem custo.</small>' : ""}</section>
    <section class="gv-bloco"><h3>Últimas execuções</h3>${execucoes}</section>
    <section class="gv-bloco"><h3>Combinado</h3><dl class="gv-dl">${detalhe("Fonte", r.fonte)}${detalhe("Resultado", r.entregavel)}${detalhe("Antes de agir fora do nod", r.limitesAprovacao)}${detalhe("Se faltar informação", r.politicaSemDado)}</dl></section>`;
  // definido em 2026-09-30: quem muda a instrução ou o horário é o bot (ADR-043); "Ajustar" só escreve o pedido no campo.
  const ajustar = `Ajuste a rotina “${resumirInstrucao(r.instrucao)}”: `;
  const rodape = `<button type="button" class="gv-bt" data-act="${ativa ? "pausar-rotina" : "ativar-rotina"}" data-id="${esc(r.id)}">${ativa ? "Pausar" : "Ativar"}</button>
       <button type="button" class="gv-bt" data-act="executar-rotina" data-id="${esc(r.id)}" data-agente="${esc(r.agenteId)}"${estado.ocupado ? " disabled" : ""}>Testar agora</button>
       <button type="button" class="gv-bt" data-act="preencher-prompt" data-texto="${esc(ajustar)}" title="Escreve o pedido de ajuste no campo da conversa">Ajustar</button>`;
  return { titulo: r.instrucao, corpo, rodape };
}

/**
 * Acesso a um app: o nível (Nenhum / Ler / Ler e alterar), o que ele deixa em palavras e cada ação numa linha legível
 * (ADR-044: a descrição do catálogo fica no title). Revogar tira tudo; "Deixar só leitura" tira só o que altera.
 */
function nivelAcesso(estado: Estado, a: Bot, dona: boolean, chave: string): Nivel {
  const g = gruposDeAcesso(estado, a.id).find((x) => x.chave === chave);
  if (!g) return { titulo: "Acesso", corpo: '<p class="mudo">Este bot não tem mais acesso a este app.</p>' };
  const todos = [...g.leitura, ...g.escrita];
  const nivel = nivelDoGrupo(g);
  const conector = conectorDoApp(estado, g.slug);
  const falha = g.falha ? textoMotivo(g.falha.motivo) : "";
  const fora = g.indisponivel
    ? `<div class="gv-aviso" role="status"><b>Fora do ar${g.falha ? ` desde ${esc(dataHora(g.falha.em))}` : ""}.</b>${falha ? ` ${esc(capitalizar(falha))}.` : ""} Enquanto isso, ${esc(a.nome)} não consegue usar o ${esc(g.nome)}.${conector ? `<div>${botao("sondar-conector", "Tentar de novo", { classe: "sm", id: conector.id })}</div>` : ""}</div>`
    : "";
  const seg = dona && conector?.habilitado ? segmentado(a.id, a.nome, conector.id, nivelDoBot(estado, a.id, conector)) : "";
  const linhas = (itens: Concessoes) => itens.map((i) => `<li title="${esc(g.descricaoDe.get(i.id) ?? i.capacidade)}">${esc(nomeLegivel(i.capacidade, g.slug || g.nome))}</li>`).join("");
  const ids = (itens: Concessoes) => itens.map((i) => i.id).join(",");
  const soLeitura = g.leitura.length && g.escrita.length
    ? botao("revogar-acessos", "Deixar só leitura", { classe: "link sm perigo", dados: { agente: a.id, ids: ids(g.escrita) }, titulo: `${g.escrita.length === 1 ? "revoga a ação que altera" : `revoga as ${g.escrita.length} ações que alteram`}; as de leitura continuam` })
    : "";
  const lista = g.leitura.length && g.escrita.length
    ? `<div class="acesso-grupo"><small>Consulta · ${g.leitura.length}</small></div><ul class="acesso-acoes">${linhas(g.leitura)}</ul><div class="acesso-grupo"><small>Altera · ${g.escrita.length}</small>${soLeitura}</div><ul class="acesso-acoes">${linhas(g.escrita)}</ul>`
    : `<ul class="acesso-acoes">${linhas(todos)}</ul>`;
  const corpo = `<div class="gv-app">${logoApp(estado, g.slug, g.nome)}<div><b>${esc(g.nome)}</b><small>${esc(nivel.rotulo)}</small></div>${g.indisponivel ? '<span class="tag tag-ambar">indisponível</span>' : ""}</div>
    ${fora}
    <section class="gv-bloco"><h3>O que ${esc(a.nome)} pode fazer</h3>${seg}<p class="acesso-frase">${nivel.frase}</p></section>
    <section class="gv-bloco"><h3>${todos.length} ${todos.length === 1 ? "ação permitida" : "ações permitidas"}</h3><div class="gv-acoes">${lista}</div></section>`;
  const rodape = botao("revogar-acessos", `Revogar acesso ao ${esc(g.nome)}`, { classe: "gv-bt perigo", dados: { agente: a.id, ids: ids(todos) }, titulo: todos.length === 1 ? `revoga a ação do ${g.nome}` : `revoga as ${todos.length} ações do ${g.nome}` });
  return { titulo: g.nome, corpo, rodape };
}

/** Editar perfil, enxuto: mascote (forma e cor), nome, título e missão. O resto está no menu do bot e nas linhas da gaveta. */
function nivelPerfil(a: Bot): Nivel {
  const formas = FORMAS_MASCOTE.map((forma, i) => `<label class="gv-forma" title="${NOMES_FORMAS[i]}"><input type="radio" name="forma" value="${forma}"${a.forma === forma ? " checked" : ""} data-customiza-mascote />${iconeAgente({ ...a, forma }, "sm")}<span class="sr-only">${NOMES_FORMAS[i]}</span></label>`).join("");
  const cores = CORES_MASCOTE.map((cor, i) => `<label class="gv-cor" title="${NOMES_CORES[i]}"><input type="radio" name="cor" value="${cor}"${a.cor === cor ? " checked" : ""} data-customiza-mascote /><span class="cor-amostra ${cor}"></span><span class="sr-only">${NOMES_CORES[i]}</span></label>`).join("");
  const corpo = `<div class="gv-mascote">${iconeAgente(a, "xl", "disponivel", "data-mascote-preview")}
      <div class="gv-formas" role="radiogroup" aria-label="Forma do mascote">${formas}</div>
      <div class="gv-cores" role="radiogroup" aria-label="Cor do mascote">${cores}</div></div>
    <label class="gv-campo">Nome<input name="nome" value="${esc(a.nome)}" required maxlength="60"${a.papel === "nod" ? ' readonly aria-describedby="nome-do-nod"' : ""} />${a.papel === "nod" ? '<small id="nome-do-nod" class="mudo">O nome do Nod não muda.</small>' : ""}</label>
    <label class="gv-campo">Título<input name="titulo" value="${esc(a.titulo)}" maxlength="80" /></label>
    <label class="gv-campo">Missão e orientações<textarea name="descricao" rows="10">${esc(a.descricao)}</textarea></label>
    ${campoVoz(a)}`;
  return { titulo: "Editar perfil", corpo, rodape: rodapeDeFormulario("Salvar"), form: `data-form="editar-perfil" data-id="${esc(a.id)}"` };
}

/**
 * A voz do bot nas ligações (definido em 2026-10-04, ADR-071): escolhida como o mascote, com prévia (▶ toca a amostra do
 * provedor das ligações) e velocidade. Bot sem voz salva mostra a que o servidor deu a ele na criação.
 */
function campoVoz(a: Bot): string {
  const atual = a.voz ?? VOZES[0].id;
  const vozes = VOZES.map((v) => `<div class="gv-voz"><label><input type="radio" name="voz" value="${v.id}"${v.id === atual ? " checked" : ""} /><span><b>${esc(v.nome)}</b><small>${esc(v.descricao)}</small></span></label><button type="button" class="gv-icone" data-act="ouvir-voz" data-voz="${v.id}" aria-label="Ouvir a voz ${esc(v.nome)}" title="Ouvir">▶</button></div>`).join("");
  const vel = a.vozVelocidade ?? 1;
  const velocidades = VELOCIDADES.map((x) => `<label class="seg"><input type="radio" name="vozVelocidade" value="${x}"${x === vel ? " checked" : ""} /><span>${String(x).replace(".", ",")}x</span></label>`).join("");
  return `<fieldset class="gv-campo gv-vozes"><legend>Voz nas ligações</legend><div class="gv-lista-vozes" role="radiogroup" aria-label="Voz do bot">${vozes}</div>
    <div class="segmentado sm" role="radiogroup" aria-label="Velocidade da fala">${velocidades}</div></fieldset>`;
}

const NOMES_FORMAS = ["Quadrado", "Hexágono", "Círculo", "Galet", "Cápsula", "Triângulo", "Nuvem", "Gota"];
const NOMES_CORES = ["Vermelho", "Rosa", "Roxo", "Azul", "Turquesa", "Verde", "Laranja", "Preto", "Marrom", "Âmbar", "Cinza", "Creme"];

function segmentado(agenteId: string, nomeBot: string, conectorId: string, atual: NivelAtual): string {
  return `<div class="segmentado sm" role="group" aria-label="${esc(`Acesso de ${nomeBot}`)}">${(["nenhum", "leitura", "escrita"] as const).map((n) => `<button type="button" class="seg${n === atual ? " ativo" : ""}" data-act="nivel-bot" data-id="${esc(agenteId)}" data-conector="${esc(conectorId)}" data-nivel="${n}" aria-pressed="${n === atual}">${esc(ROTULO_NIVEL[n])}</button>`).join("")}</div>`;
}

/**
 * "+ Dar acesso" (definido em 2026-09-25, jornadas de conexão): em cima, os apps que a pessoa já conectou, com o nível
 * deste bot; embaixo, os que faltam conectar, com "Conectar" ali mesmo. Desde 2026-09-30 é um nível da gaveta.
 */
function darAcesso(estado: Estado, agenteId: string, nomeBot: string): string {
  const conectados = estado.marketplace.flatMap((app) => {
    const c = conectorDoApp(estado, app.slug);
    return c?.habilitado ? [`<div class="da-linha">${logoApp(estado, app.slug, app.nome)}<div class="da-nome"><b>${esc(app.nome)}</b>${segmentado(agenteId, nomeBot, c.id, nivelDoBot(estado, agenteId, c))}</div></div>`] : [];
  });
  const faltam = estado.marketplace.filter((app) => situacaoDoApp(estado, app.slug) !== "conectado").slice(0, 6).map((app) => {
    const login = estado.conectando[app.slug];
    const acao = login && !login.falhou ? blocoEsperando(app.nome, login.url, true) : botao("conectar-app", login?.falhou ? "Tentar de novo" : "Conectar", { classe: "sm", id: app.slug });
    return `<div class="da-linha">${logoApp(estado, app.slug, app.nome)}<div class="da-nome"><b>${esc(app.nome)}</b></div>${acao}</div>`;
  });
  return `<div class="dar-acesso gv-dar-acesso" aria-label="${esc(`Dar a ${nomeBot} acesso a um app`)}">
    ${conectados.length ? `<div class="da-grupo"><small>Já conectados por você</small>${conectados.join("")}</div>` : ""}
    ${faltam.length ? `<div class="da-grupo"><small>Conectar e dar acesso</small>${faltam.join("")}</div>` : ""}
    ${!conectados.length && !faltam.length ? '<p class="mudo">Nenhum app no Marketplace ainda.</p>' : ""}
    ${botao("navegar", "Ver todos no Marketplace", { classe: "link sm", dados: { tela: "conectores" } })}
  </div>`;
}

// ---- apoio ------------------------------------------------------------------------------------------------------------

/**
 * definido em 2026-09-24 (ADR-044): um clique concede as ferramentas de leitura de um app inteiro. definido em 2026-09-29
 * (emenda): UM grupo por app — pelo slug, dois registros do mesmo app (o antigo e o habilitado) são UMA ferramenta. O
 * nível é o readOnlyHint da sonda; o que o catálogo não descreve conta como escrita.
 */
type GrupoAcesso = { chave: string; slug: string; nome: string; indisponivel: boolean; falha: { motivo: Parameters<typeof textoMotivo>[0]; em: number } | null; leitura: Concessoes; escrita: Concessoes; descricaoDe: Map<string, string> };

function gruposDeAcesso(estado: Estado, agenteId: string): GrupoAcesso[] {
  const grupos = new Map<string, GrupoAcesso>();
  for (const g of estado.concessoes[agenteId] ?? []) {
    const c = estado.conectores.find((x) => x.id === g.conectorId);
    const cap = c?.catalogo.find((x) => x.nome === g.capacidade);
    const chave = c?.slug ?? g.conectorId;
    const grupo = grupos.get(chave) ?? { chave, slug: c?.slug ?? "", nome: c?.nome ?? "conector", indisponivel: false, falha: null, leitura: [], escrita: [], descricaoDe: new Map<string, string>() };
    if (c?.ultimaFalha) { grupo.indisponivel = true; grupo.falha ??= c.ultimaFalha; }
    if (cap?.descricao) grupo.descricaoDe.set(g.id, cap.descricao);
    (cap?.readOnlyHint === true ? grupo.leitura : grupo.escrita).push(g);
    grupos.set(chave, grupo);
  }
  return [...grupos.values()];
}

function nivelDoGrupo(g: GrupoAcesso): { rotulo: string; frase: string } {
  if (!g.escrita.length) return { rotulo: "só leitura", frase: "Pode consultar. Não envia nem altera nada." };
  if (g.leitura.length) return { rotulo: "pode ler e alterar", frase: "Pode consultar e fazer alterações em seu nome." };
  return { rotulo: "pode alterar", frase: "Pode fazer alterações em seu nome." };
}

/** "SLACK_FETCH_MESSAGE_THREAD" do conector Slack → "Fetch message thread": sem o prefixo do app, sem caixa alta. */
export function nomeLegivel(capacidade: string, conector: string): string {
  const prefixo = conector.toLowerCase().replace(/[^a-z0-9]+/g, "_") + "_";
  let nome = capacidade.toLowerCase();
  if (nome.startsWith(prefixo)) nome = nome.slice(prefixo.length);
  nome = nome.replace(/[_.-]+/g, " ").trim();
  return nome ? nome[0]!.toUpperCase() + nome.slice(1) : capacidade;
}

/** "dias úteis às 08:00 (America/Sao_Paulo)" → "dias úteis às 08:00": na linha da gaveta o fuso é ruído; no nível ele fica. */
function semFuso(resumo: string): string {
  return resumo.replace(/\s*\([^)]*\)\s*$/, "");
}

function capitalizar(texto: string): string {
  return texto ? texto[0]!.toUpperCase() + texto.slice(1) : texto;
}

/** A primeira frase da instrução, curta, para o pedido de ajuste citar a rotina sem colar o texto inteiro. */
function resumirInstrucao(instrucao: string): string {
  const frase = instrucao.split(/(?<=[.!?])\s/)[0] ?? instrucao;
  return frase.length > 80 ? `${frase.slice(0, 79).trimEnd()}…` : frase.replace(/[.!?]$/, "");
}
