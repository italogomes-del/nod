import type { Proposta } from "../../src/contracts/conversa.ts";
import type { Decisao } from "../../src/contracts/decisao.ts";
import type { Estado } from "../estado/reducer.ts";
import { linhaNaoRodaram } from "../lib/execucao.ts";
import { botao, esc } from "../lib/render.ts";
import { acoes, blocoEsperando, blocoFalhou, checkboxesDosGrupos, conectorDoApp, gruposDe, ICONE_OK, listaPodeENao, nomeDoApp, passos, podeENao, SETA_EXTERNA } from "./app-acesso.ts";
import { logoApp } from "./marketplace.ts";
import { detalheAcesso, marcaGemeas, marcaRotinaParada, rotulosAcesso } from "./sua-vez.ts";

/**
 * O card de acesso do chat (definido em 2026-09-25, jornadas de conexão): UM card do pedido até a
 * permissão. "Conectar {App}" abre o login ali mesmo — sem ir ao marketplace —, o card espera sozinho e,
 * quando o login termina, o servidor o troca pelo de permitir (ao-conectar-app.ts). Escrita também: o
 * pedido já traz o nível, e a pessoa desmarca grupos (Ler, Criar e enviar, Editar, Comentar) antes de
 * permitir. Conceder continua sendo o clique em Permitir (ADR-044).
 */

type ItemAberto = NonNullable<Estado["suaVez"]>["itens"][number];

/**
 * A linha embaixo do título: o "para quê" que o agente deu; sem ele, num pedido de rotina, a frase do
 * domínio (que diz qual rotina pediu, fraseDoPedidoDeAcesso).
 */
function subtitulo(p: Proposta, decisao: Decisao | null): string {
  if (p.payload.kind !== "acesso") return "";
  if (p.payload.para) {
    // Texto do modelo (revisão do PR #68): entre aspas e atribuído ao bot, nunca como frase do sistema.
    const t = p.payload.para.trim().replace(/^para\s+/i, "");
    return `“Para ${t.charAt(0).toLowerCase()}${t.slice(1)}”`;
  }
  return p.payload.rotinaId && decisao ? decisao.frase : "";
}

function nomeDoBot(estado: Estado, p: Proposta): string | null {
  return estado.frota?.agentes.find((a) => a.id === p.agenteId)?.nome ?? null;
}

function notaRevogar(bot: string | null): string {
  return `Dá para revogar no painel do ${bot ?? "bot"}.`;
}

function cabecalho(p: Proposta, estado: Estado, verbo: string, marcas = "", decisao: Decisao | null = null): string {
  if (p.payload.kind !== "acesso") return "";
  const slug = p.payload.conector;
  const nome = nomeDoApp(estado, slug);
  const bot = nomeDoBot(estado, p) ?? "O bot";
  const sub = subtitulo(p, decisao);
  return `<div class="ac-cab">${logoApp(estado, slug, nome)}<div class="ac-titulo"><b>${esc(bot)} quer ${esc(verbo)} seu ${esc(nome)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</div>${marcas}</div>`;
}

function rodape(botoes: string, nota = ""): string {
  return `<div class="ac-rodape">${botoes}${nota ? `<span class="ac-nota">${esc(nota)}</span>` : ""}</div>`;
}

/** O card de conexão: o app ainda não está pronto para este pedido. */
function cardConectar(p: Proposta, estado: Estado): string {
  if (p.payload.kind !== "acesso") return "";
  const slug = p.payload.conector;
  const nome = nomeDoApp(estado, slug);
  const bot = nomeDoBot(estado, p) ?? "bot";
  const verbo = p.payload.nivel === "escrita" ? "ler e alterar" : "ler";
  const pn = listaPodeENao(podeENao(estado, slug, p.payload.nivel, p.payload.naoPedido));
  const agoraNao = botao("recusar-proposta", "Agora não", { classe: "link", id: p.id });
  const login = estado.conectando[slug];
  const conector = conectorDoApp(estado, slug);
  let corpo: string;
  if (login && !login.falhou) {
    corpo = `${blocoEsperando(nome, login.url, false, login.semJanela === true)}${passos(nome, bot, 1)}${rodape(botao("cancelar-conexao", "Cancelar", { classe: "link", id: slug }))}`;
  } else if (conector?.habilitado) {
    // O login terminou por outro caminho e o card ainda não virou: um clique abre o de permitir.
    corpo = `<p class="ac-conectado">${ICONE_OK}${esc(nome)} conectado</p>${pn}${passos(nome, bot, 2)}${rodape(botao("confirmar-proposta", "Continuar", { classe: "pri", id: p.id }) + agoraNao)}`;
  } else {
    const falha = login?.falhou ? blocoFalhou(login.falhou) : "";
    corpo = `${falha}${pn}${passos(nome, bot, 1)}${rodape(botao("conectar-app", `${login?.falhou ? "Tentar de novo" : `Conectar ${esc(nome)}`} ${SETA_EXTERNA}`, { classe: "pri", id: slug }) + agoraNao, `Você entra no ${nome}; o Nod não vê sua senha.`)}`;
  }
  return `<section class="acesso-card" data-proposta="${esc(p.id)}">${cabecalho(p, estado, verbo)}${corpo}</section>`;
}

/** O card de permitir: proposta e decisão de mesmo id, o app conectado. */
function cardPermitir(p: Proposta, decisao: Decisao, aberto: ItemAberto | undefined, estado: Estado): string {
  if (p.payload.kind !== "acesso") return "";
  const c = p.payload;
  const nome = nomeDoApp(estado, c.conector);
  const bot = nomeDoBot(estado, p);
  const conector = conectorDoApp(estado, c.conector);
  const catalogo = conector?.catalogo ?? [];
  // Sem o catálogo à mão (conector de outra pessoa, estado ainda carregando), o nível do pedido decide —
  // nunca chamar de "alterar" o que não se sabe.
  const conhecidas = c.capacidades.length > 0 && c.capacidades.every((n) => catalogo.some((x) => x.nome === n));
  const grupos = conhecidas ? gruposDe(catalogo, c.capacidades) : [{ id: c.nivel === "leitura" ? ("ler" as const) : ("alterar" as const), rotulo: "", capacidades: c.capacidades }];
  const soLer = grupos.every((g) => g.id === "ler");
  const verbo = soLer ? "ler" : grupos.some((g) => g.id === "ler") || !conhecidas ? "ler e alterar" : "alterar";
  const marcas = `${marcaRotinaParada(p, aberto?.rotinaParada, estado.agora)}${marcaGemeas(aberto)}`;
  let oQue: string;
  if (soLer || grupos.length <= 1) {
    oQue = listaPodeENao(podeENao(estado, c.conector, soLer ? "leitura" : "escrita", c.naoPedido));
  } else {
    // Mais de um grupo: a pessoa desmarca o que não quer dar. O input fica sob [data-decisao] para o
    // render preservar a marcação (main.ts), e Permitir manda só as capacidades dos grupos marcados.

    const pedidos = new Set(c.capacidades);
    const deFora = catalogo.filter((x) => !pedidos.has(x.nome) && (x.grupo === "apagar" || x.grupo === "outras")).length;
    const fora = [...(deFora > 0 ? [`Ficam de fora: ${acoes(deFora)} de apagar, desfazer e outras`] : []), ...c.naoPedido.map((n) => `Não inclui: ${n}`)];
    oQue = `${checkboxesDosGrupos(catalogo, c.capacidades)}${fora.length ? listaPodeENao({ pode: [], nao: fora }) : ""}`;
  }
  const r = rotulosAcesso(p);
  const permitir = botao("permitir-acesso", r.permitir, { classe: "pri", id: decisao.id });
  const recusar = botao("recusar-decisao", r.recusar, { id: decisao.id });
  const conectado = conector?.habilitado ? `<p class="ac-conectado">${ICONE_OK}${esc(nome)} conectado</p>` : "";
  const naoRodaram = linhaNaoRodaram(aberto?.rotinaParada ?? null, estado.agora);
  return `<section class="acesso-card" data-proposta="${esc(p.id)}" data-decisao="${esc(decisao.id)}">${cabecalho(p, estado, verbo, marcas, decisao)}${conectado}${oQue}${naoRodaram}${detalheAcesso(p)}${rodape(permitir + recusar, notaRevogar(bot))}</section>`;
}

/** null = não é um card que este arquivo desenha (pedido antigo sem decisão: o card de revisão de antes). */
export function renderCardAcesso(p: Proposta, aberto: ItemAberto | undefined, estado: Estado): string | null {
  if (p.payload.kind !== "acesso") return null;
  if (p.payload.conectar) return cardConectar(p, estado);
  if (aberto) return cardPermitir(p, aberto.decisao, aberto, estado);
  return null;
}
