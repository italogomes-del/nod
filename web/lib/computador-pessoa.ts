import type { Agente } from "../../src/contracts/agente.ts";
import type { ControleComputador } from "../../src/contracts/computador.ts";
import type { EstadoTelaComputador } from "../../src/contracts/computador-motor.ts";
import type { MotivoFalhaComputador } from "../../src/contracts/motivos.ts";
import { htmlMascote } from "./mascote.ts";
import { esc } from "./escape.ts";

/**
 * Computador do bot v2 (NOD-96, PR 6; ADR-122): um computador por pessoa, uma tela e um Chrome por bot, logins em comum.
 * Só vale com NOD_COMPUTADORES=motor — a web descobre pela resposta de GET /computador: 404 (ou erro) = o modelo de
 * antes, e a interface fica como era. Tudo aqui é puro (sem DOM): o HTML sai pronto e o teste unitário lê sem navegador.
 * Os componentes foram portados de proto/_nod/computador-do-bot.js (o protótipo aprovado) e o CSS mora em
 * web/computador-do-bot.css.
 *
 * O contrato é o do plano (a rota é do PR 5, em paralelo): GET /computador devolve o estado do computador da pessoa,
 * as telas abertas por bot, quem espera memória e a operação em curso; POST /computador {operacao} acorda, dorme,
 * atualiza, redefine, sai de todos os sites ou tenta de novo. O controle e as ações continuam por tela em
 * /agentes/:id/computador.
 */
export const ESTADOS_COMPUTADOR_PESSOA = ["dormindo", "ligando", "pronto", "fora_do_ar", "operando"] as const;
export type EstadoComputadorPessoa = (typeof ESTADOS_COMPUTADOR_PESSOA)[number];
export const OPERACOES_PESSOA = ["acordar", "dormir", "atualizar", "redefinir", "sair_de_todos", "tentar_de_novo"] as const;
export type OperacaoPessoa = (typeof OPERACOES_PESSOA)[number];
/** As operações longas, que têm progresso e etapas. */
export type OperacaoLonga = "atualizar" | "redefinir" | "sair_de_todos";

export type TelaDaPessoa = {
  agenteId: string;
  estado: EstadoTelaComputador;
  controle: ControleComputador;
  memoriaMb: number | null;
  /** Opcionais do plano: o site aberto e a última ação, para a linha do painel. */
  titulo?: string | null;
  ultimaAcaoEm?: number | null;
  /** O pedido de ajuda aberto nesta tela (o texto do bot), quando houver. */
  ajuda?: string | null;
};

export type AtividadeDaPessoa = { agenteId: string | null; texto: string; em: number };

export type ComputadorPessoaDto = {
  estado: EstadoComputadorPessoa;
  maquina: { id: string; nome: string; contato: number | null } | null;
  telas: TelaDaPessoa[];
  /** Os bots esperando memória para abrir a tela, na ordem de chegada. */
  esperando: string[];
  operacao?: { tipo: OperacaoLonga; pct: number | null; etapa: string | null } | null;
  /** O computador foi recriado (troca de modelo ou de máquina): os logins não vieram, entre nos sites de novo uma vez. */
  aviso_recriado?: boolean;
  /** Opcionais do plano que a web usa quando vierem. */
  falha?: { motivo: MotivoFalhaComputador; desde: number } | null;
  memoria?: { usadaMb: number; totalMb: number } | null;
  ligadoDesde?: number | null;
  atividade?: AtividadeDaPessoa[];
};

/** O que a pessoa marcou no painel: a ação sugerida por um aviso e o diálogo de confirmação aberto. */
export type ComputadorUi = { realce: OperacaoPessoa | null; confirmar: "redefinir" | "sair_de_todos" | null; etapasAbertas: boolean };
export const UI_INICIAL: ComputadorUi = { realce: null, confirmar: null, etapasAbertas: false };

type BotVisto = Pick<Agente, "id" | "nome" | "cor" | "forma">;

/** Lê a resposta da rota com cuidado: a web nunca confia na forma de um contrato que ainda não existe no servidor. */
export function lerComputadorPessoa(bruto: unknown): ComputadorPessoaDto | null {
  if (typeof bruto !== "object" || bruto === null) return null;
  const d = bruto as Partial<ComputadorPessoaDto>;
  if (!ESTADOS_COMPUTADOR_PESSOA.includes(d.estado as EstadoComputadorPessoa)) return null;
  return { ...d, estado: d.estado as EstadoComputadorPessoa, maquina: d.maquina ?? null, telas: Array.isArray(d.telas) ? d.telas : [], esperando: Array.isArray(d.esperando) ? d.esperando : [] };
}

// ---- utilitários ---------------------------------------------------------------------------------------------------

/** "Dev 2", "Dev 2 e Dev 3", "Dev 2, Dev 3 e Dev 4". */
export function listaDeNomes(nomes: readonly string[]): string {
  return new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" }).format(nomes);
}

const SEP = ' <span class="cb-sep" aria-hidden="true">·</span> ';
const GIRO = '<span class="ob-gira" aria-hidden="true"></span>';
const svg = (corpo: string, classe = "") => `<svg${classe ? ` class="${classe}"` : ""} viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${corpo}</svg>`;
export const ICONE_CB = {
  pcBot: svg('<path d="M12.8 15H4.5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v4.8"/><path d="M7.5 19.5h6M10.5 15v4.5"/><path fill="currentColor" stroke="none" fill-rule="evenodd" d="M17.6 12.5h2.4a3 3 0 0 1 3 3v2.5a3 3 0 0 1-3 3h-2.4a3 3 0 0 1-3-3v-2.5a3 3 0 0 1 3-3zM16.30 16.1a1.05 1.4 0 1 0 2.10 0a1.05 1.4 0 1 0 -2.10 0zM19.20 16.1a1.05 1.4 0 1 0 2.10 0a1.05 1.4 0 1 0 -2.10 0z"/>', "cb-ic-pc"),
  monitor: svg('<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>'),
  relogio: svg('<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>'),
  ok: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  olho: svg('<path d="M2.5 12s3.5-6.5 9.5-6.5 9.5 6.5 9.5 6.5-3.5 6.5-9.5 6.5S2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>'),
  cursor: svg('<path d="M5 3.5 18.5 12l-6 1.4-2.8 5.6z"/>'),
  fechar: svg('<path d="M6 6l12 12M18 6 6 18"/>'),
  info: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8h.01"/>'),
};

export function link(texto: string, attrs: string): string {
  return `<button type="button" class="cb-link" ${attrs}>${esc(texto)}</button>`;
}

function ghost(texto: string, attrs: string, classe = ""): string {
  return `<button type="button" class="cb-bt-ghost${classe ? ` ${classe}` : ""}" ${attrs}>${esc(texto)}</button>`;
}

/** O card sutil (o erro com cara de mensagem): ponto pequeno, título, apoio cinza e as ações em link. */
export function htmlAviso(p: { titulo: string; apoio?: string; acoes: readonly string[]; tom?: "erro" | "aviso" | "neutro" }): string {
  const tom = p.tom === "aviso" ? " aviso" : p.tom === "neutro" ? " neutro" : "";
  return `<div class="bubble cb-aviso" role="status"><p class="cb-aviso-tit"><i class="cb-ponto${tom}" aria-hidden="true"></i><span>${esc(p.titulo)}</span></p>${p.apoio ? `<p class="cb-aviso-sub">${esc(p.apoio)}</p>` : ""}${p.acoes.length ? `<p class="cb-acoes">${p.acoes.join(SEP)}</p>` : ""}</div>`;
}

/** A linha cinza de espera (ou de ✓), sem caixa. Os segmentos se separam por "·" do próprio CSS. */
export function htmlLinha(p: { segmentos: readonly string[]; links?: readonly string[]; icone: "giro" | "ok" | "relogio" | "monitor"; centro?: boolean }): string {
  const ic = p.icone === "giro" ? GIRO : ICONE_CB[p.icone];
  const segs = [...p.segmentos.map((s) => esc(s)), ...(p.links?.length ? [p.links.join(SEP)] : [])];
  return `<p class="cb-linha${p.icone === "ok" ? " cb-ok" : ""}${p.centro ? " centro" : ""}" role="status"><span class="cb-linha-ic">${ic}</span><span class="cb-linha-txt"><span class="cb-segs">${segs.map((s) => `<span class="cb-seg">${s}</span>`).join("")}</span></span></p>`;
}

/** O anel de 12 px (pathLength 100: o traço é a porcentagem). */
export function htmlAnel(pct: number): string {
  const p = Math.max(0, Math.min(100, Math.round(pct)));
  return `<svg class="cb-anel" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><circle class="cb-anel-trilho" cx="6" cy="6" r="5"/><circle class="cb-anel-valor" cx="6" cy="6" r="5" pathLength="100" stroke-dasharray="${p} 100" transform="rotate(-90 6 6)"/></svg>`;
}

// ---- operação em curso ---------------------------------------------------------------------------------------------

const NOME_OPERACAO: Readonly<Record<OperacaoLonga, { gerundio: string; infinitivo: string }>> = {
  atualizar: { gerundio: "Atualizando", infinitivo: "atualizar" },
  redefinir: { gerundio: "Redefinindo", infinitivo: "redefinir" },
  sair_de_todos: { gerundio: "Saindo dos sites", infinitivo: "sair dos sites" },
};

/** As etapas de cada operação, na ordem. A etapa do servidor que não estiver aqui aparece como a atual, pelo nome. */
export const ETAPAS: Readonly<Record<OperacaoLonga, readonly string[]>> = {
  redefinir: ["Preparando", "Apagando seus dados", "Criando", "Iniciando", "Limpando", "Reconectando"],
  atualizar: ["Preparando", "Baixando a versão nova", "Reiniciando", "Reconectando"],
  sair_de_todos: ["Saindo das contas", "Limpando"],
};

export function pctDaOperacao(dto: ComputadorPessoaDto): number {
  return Math.max(0, Math.min(100, Math.round(dto.operacao?.pct ?? 0)));
}

/** "Redefinindo · 34%": a dica do item de menu e o texto do anel. */
export function dicaDaOperacao(dto: ComputadorPessoaDto): string | null {
  if (!dto.operacao) return null;
  return `${NOME_OPERACAO[dto.operacao.tipo].gerundio} · ${pctDaOperacao(dto)}%`;
}

/** As etapas, a atual com giro e %. */
export function htmlEtapas(tipo: OperacaoLonga, etapa: string | null, pct: number): string {
  const nomes = [...ETAPAS[tipo]];
  let atual = etapa ? nomes.indexOf(etapa) : 0;
  if (atual < 0) {
    nomes.splice(0, 0, etapa ?? "");
    atual = 0;
  }
  return `<ol class="pc-etapas">${nomes.map((n, i) => i < atual
    ? `<li class="feita"><span class="pc-et-ic">${ICONE_CB.ok}</span>${esc(n)}</li>`
    : i === atual
      ? `<li class="atual" aria-current="step"><span class="pc-et-ic">${GIRO}</span>${esc(n)}<span class="pc-pct">${pct}%</span></li>`
      : `<li><span class="pc-et-ic"><i></i></span>${esc(n)}</li>`).join("")}</ol>`;
}

// ---- item do menu da conta e fio do cabeçalho -----------------------------------------------------------------------

/** O item "Computador do bot" no menu da conta: o ícone, ou o anel com a dica durante uma operação (sem toast). */
export function htmlItemMenu(dto: ComputadorPessoaDto | null, ok = false): string {
  const dica = dto ? dicaDaOperacao(dto) : null;
  const ic = dica && dto ? htmlAnel(pctDaOperacao(dto)) : ok ? `<span class="cb-ok-v" aria-hidden="true">${ICONE_CB.ok}</span>${ICONE_CB.pcBot}` : ICONE_CB.pcBot;
  // Durante a operação o % já está na dica (e o anel o desenha): não repete no meta.
  const meta = !dica && dto?.estado === "dormindo" ? "Dormindo" : "";
  const aria = `Computador do bot${dica ? ` · ${dica}` : ""}`;
  return `<button type="button" role="menuitem" class="cb-item${ok ? " cb-item-ok" : ""}" data-secao="computador-do-bot" aria-label="${esc(aria)}"><span class="cb-item-ic">${ic}</span><span class="mc-nome">Computador do bot</span>${meta ? `<span class="mc-meta">${esc(meta)}</span>` : ""}${dica ? `<span class="cb-dica" role="tooltip">${esc(dica)}</span>` : ""}<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg></button>`;
}

/** A linha de 2 px dentro da pílula do cabeçalho do chat, durante uma operação. */
export function htmlFio(dto: ComputadorPessoaDto | null): string {
  if (!dto?.operacao) return "";
  return `<span class="cb-fio" aria-hidden="true"><i style="width:${pctDaOperacao(dto)}%"></i></span>`;
}


// ---- a gaveta --------------------------------------------------------------------------------------------------------

export type EstadoDaGaveta = "miniatura" | "sem_tela" | "dormindo" | "acordando" | "fora";

export function telaDoBot(dto: ComputadorPessoaDto, agenteId: string): TelaDaPessoa | null {
  return dto.telas.find((t) => t.agenteId === agenteId && t.estado !== "fechada") ?? null;
}

/** O que a gaveta do bot mostra no topo. A tela cheia nunca abre sozinha: aqui só a miniatura e o Abrir. */
export function estadoDaGaveta(dto: ComputadorPessoaDto, agenteId: string): EstadoDaGaveta {
  if (dto.estado === "fora_do_ar") return "fora";
  if (dto.estado === "dormindo") return "dormindo";
  if (dto.estado === "ligando") return "acordando";
  const tela = telaDoBot(dto, agenteId);
  return tela && (tela.estado === "aberta" || tela.estado === "abrindo") ? "miniatura" : "sem_tela";
}

function htmlMiniatura(bot: BotVisto): string {
  return `<button type="button" class="tela-preview cb-mini" data-act="abrir-computador" data-id="${esc(bot.id)}" data-tela-bot="${esc(bot.id)}" aria-label="Abrir a tela de ${esc(bot.nome)}"><img alt="" hidden /><span class="tela-abrir"><span class="cb-abrir">${ICONE_CB.monitor}<span>Abrir</span></span></span></button><p class="tela-legenda">Tela de ${esc(bot.nome)}</p>`;
}

function htmlSono(bot: BotVisto, titulo: string, sub: string, acao: string): string {
  const estrelas = `<span class="cb-estrelas" aria-hidden="true">${"<i></i>".repeat(6)}</span>`;
  const zzz = '<span class="cb-zzz" aria-hidden="true"><i>z</i><i>z</i><i>z</i></span>';
  return `<div class="cb-sono" role="status">${estrelas}<span class="cb-sono-masc">${htmlMascote(bot, "", "pausado", 'aria-hidden="true"').replace(' role="img"', "").replace("icon mascote", "icon mascote cb-respira")}${zzz}</span><p class="cb-sono-tit">${esc(titulo)}</p><p class="cb-sono-sub">${esc(sub)}</p>${acao}</div>`;
}

/** O topo da gaveta (só a dona): miniatura com Abrir, a linha "sem tela", o mascote dormindo ou acordando. */
export function htmlGavetaTela(dto: ComputadorPessoaDto, bot: BotVisto): string {
  const g = estadoDaGaveta(dto, bot.id);
  const corpo = g === "miniatura"
    ? htmlMiniatura(bot)
    : g === "sem_tela"
      ? `<p class="cb-gv-linha" role="status">${ICONE_CB.monitor}<span>${esc(bot.nome)} não está usando o navegador agora.</span></p>`
      : g === "dormindo"
        ? htmlSono(bot, "Zzz… o computador está descansando", "Acorda sozinho quando um bot precisar.", ghost("Acordar", 'data-act="operar-computador" data-op="acordar"', "gv-acordar"))
        : g === "acordando"
          ? `<div class="cb-acordando">${htmlSono(bot, "Acordando…", `Abrindo a tela de ${bot.nome}`, "")}</div>`
          : htmlAviso({ titulo: "O computador parou de responder", apoio: dto.falha ? textoDaFalha(dto.falha.motivo) : "Atualizar costuma resolver.", acoes: [link("Tentar de novo", 'data-act="operar-computador" data-op="tentar_de_novo"'), link("Ver computador do bot", 'data-act="ver-computador-do-bot" data-realce="atualizar"')] });
  // `data-comp-bot`: a aba Computador da gaveta (ADR-125) à vista — o laço de web/telas/tela-do-bot.ts só observa com ela.
  return `<section class="gv-secao gv-tela" data-comp-bot="${esc(bot.id)}" data-gaveta-computador="${g}">${corpo}</section>`;
}

const FALHA_CURTA: Partial<Record<MotivoFalhaComputador, string>> = {
  maquina_sem_contato: "A máquina do computador não está respondendo. Atualizar costuma resolver.",
  nao_ficou_pronto: "Ele não respondeu em 60 segundos.",
  nao_iniciou: "Ele não conseguiu ligar. Atualizar costuma resolver.",
  sem_resposta: "Tentei de novo e ele seguiu sem resposta. Atualizar costuma resolver.",
};

function textoDaFalha(motivo: MotivoFalhaComputador): string {
  return FALHA_CURTA[motivo] ?? "Atualizar costuma resolver.";
}

/**
 * O erro com o caminho (o card leve que substitui o cartão vermelho): Tentar de novo · Ver computador do bot. O link
 * abre o painel com a ação sugerida marcada e com o foco nela.
 */
export function htmlAvisoDeFalha(dto: ComputadorPessoaDto): string | null {
  if (dto.estado !== "fora_do_ar") return null;
  const naoLigou = dto.falha?.motivo === "nao_ficou_pronto";
  return htmlAviso({
    titulo: naoLigou ? "Não consegui ligar o computador" : "O computador parou de responder",
    apoio: dto.falha ? textoDaFalha(dto.falha.motivo) : "Atualizar costuma resolver.",
    acoes: [link("Tentar de novo", 'data-act="operar-computador" data-op="tentar_de_novo"'), link("Ver computador do bot", 'data-act="ver-computador-do-bot" data-realce="atualizar"')],
  });
}

// ---- a linha de espera no chat ---------------------------------------------------------------------------------------

/** Depois de ~10 min esperando memória, a linha encurta para "Ainda esperando…". */
export const MS_AINDA_ESPERANDO = 10 * 60_000;

export type MotivoDaEspera = "ligando" | "memoria" | "operacao";

/** Por que este bot espera o computador agora, ou null. Falta de memória é espera cinza, nunca erro. */
export function motivoDaEspera(dto: ComputadorPessoaDto, agenteId: string): MotivoDaEspera | null {
  const tela = dto.telas.find((t) => t.agenteId === agenteId);
  const espera = dto.esperando.includes(agenteId) || tela?.estado === "esperando" || tela?.estado === "abrindo";
  if (!espera) return null;
  if (dto.operacao) return "operacao";
  if (dto.estado === "ligando") return "ligando";
  return dto.esperando.includes(agenteId) || tela?.estado === "esperando" ? "memoria" : null;
}

/**
 * A linha cinza abaixo do turno. `desde` é quando a web viu a espera começar (o servidor não manda a hora): passa de
 * ~10 min, a linha vira "Ainda esperando…".
 */
export function htmlLinhaDeEspera(dto: ComputadorPessoaDto, agenteId: string, nomes: Readonly<Record<string, string>>, desde: number | null, agora: number): string {
  const motivo = motivoDaEspera(dto, agenteId);
  const nome = nomes[agenteId] ?? "O bot";
  const verTelas = link("ver telas", 'data-act="ver-computador-do-bot"');
  if (motivo === "ligando") return htmlLinha({ segmentos: ["Ligando o computador…", `${nome} continua assim que ele estiver pronto`], icone: "giro" });
  if (motivo === "operacao" && dto.operacao) return htmlLinha({ segmentos: [`Esperando o computador terminar de ${NOME_OPERACAO[dto.operacao.tipo].infinitivo}…`], icone: "giro" });
  if (motivo !== "memoria") return "";
  if (desde !== null && agora - desde >= MS_AINDA_ESPERANDO) return htmlLinha({ segmentos: ["Ainda esperando…"], links: [verTelas], icone: "relogio" });
  const usando = dto.telas.filter((t) => t.agenteId !== agenteId && (t.estado === "aberta" || t.estado === "abrindo")).map((t) => nomes[t.agenteId] ?? "outro bot");
  const quem = usando.length ? [`${listaDeNomes(usando)} ${usando.length === 1 ? "está" : "estão"} usando o computador`] : [];
  return htmlLinha({ segmentos: ["Esperando uma tela livre", ...quem], links: [verTelas], icone: "relogio" });
}

/** A espera que acabou vira um ✓ por alguns segundos: "Tela aberta" depois da memória, "Computador pronto" depois do resto. */
export function textoDoFimDaEspera(motivo: MotivoDaEspera): string {
  return motivo === "memoria" ? "Tela aberta" : "Computador pronto";
}

export function htmlLinhaOk(texto: string): string {
  return htmlLinha({ segmentos: [texto], icone: "ok" });
}

/** A linha no chat de cada bot cuja tela fechou por uma operação (redefinir ou atualizar). */
export function htmlLinhaTelaFechada(tipo: OperacaoLonga, nome: string): string {
  const oQue = tipo === "redefinir" ? "sendo redefinido" : tipo === "atualizar" ? "sendo atualizado" : "saindo dos sites";
  return htmlLinha({ segmentos: [`O computador está ${oQue}. A tela de ${nome} fechou; ela volta quando ele precisar do navegador.`], icone: "monitor", centro: true });
}


// ---- a tela cheia ----------------------------------------------------------------------------------------------------

export type EstadoPilula = "assistindo" | "assumindo" | "controle";

export function estadoDaPilula(controle: ControleComputador | undefined, assumindo: boolean): EstadoPilula {
  if (controle === "pessoa") return "controle";
  return assumindo ? "assumindo" : "assistindo";
}

/** A pílula embaixo e no meio da tela: o estado e a ação em link. */
export function htmlPilula(nome: string, estado: EstadoPilula): string {
  const corpo = estado === "assumindo"
    ? `<span class="cb-pilula-est" role="status">${GIRO}<span>Assumindo… ${esc(nome)} termina a ação em curso</span></span>`
    : estado === "controle"
      ? `<span class="cb-pilula-est" role="status">${ICONE_CB.cursor}<span>Você está no controle</span></span>${SEP}${link("Parar", 'data-c="devolver"')}`
      : `<span class="cb-pilula-est" role="status">${ICONE_CB.olho}<span>Assistindo</span></span>${SEP}${link("Assumir o controle", 'data-c="assumir"')}`;
  return `<div class="cb-pilula cb-${estado}" role="group" aria-label="Controle da tela de ${esc(nome)}">${corpo}</div>`;
}

/** A tela cheia: quase a janela toda, título pequeno, ✕ discreto, a imagem inteira e a pílula. */
export function htmlTelaCheia(nome: string, pedido: string | null): string {
  return `<div class="cb-tela"><header class="cb-tela-cab"><h2 class="cb-tela-tit">Tela de ${esc(nome)}</h2><span class="cb-tela-pedido">${esc(pedido ?? "")}</span><button type="button" class="cb-tela-x" data-c="fechar" aria-label="Fechar a tela de ${esc(nome)}">${ICONE_CB.fechar}</button></header><div class="cb-tela-vista"><img alt="Tela de ${esc(nome)}" tabindex="0" draggable="false" hidden /><p class="cb-gv-linha cb-tela-vazia" role="status">${ICONE_CB.monitor}<span>${esc(nome)} não está usando o navegador agora.</span></p><div class="cb-tela-pilula"></div></div></div>`;
}

/** O pedido de login leve (duas linhas, sem caixa): a miniatura é o clique. */
export function htmlLogin(p: { agenteId: string; titulo: string; apoio?: string | null; src?: string | null }): string {
  const mini = p.src ? `<img src="${esc(p.src)}" alt="" />` : "";
  return `<div class="cb-login"><button type="button" class="cb-login-mini${mini ? "" : " sem-imagem"}" data-act="abrir-computador" data-id="${esc(p.agenteId)}" data-assumir="1" data-pedido="${esc(p.titulo)}" aria-label="Abrir a tela para ${esc(p.titulo)}">${mini}<span class="cb-abrir">${ICONE_CB.monitor}<span>Abrir</span></span></button><div class="cb-login-txt"><p class="cb-login-tit">${esc(p.titulo)}<span class="cb-aguarda"><i class="cb-ponto" aria-hidden="true"></i>aguardando você</span></p>${p.apoio ? `<p class="cb-login-sub">${esc(p.apoio)}</p>` : ""}<p class="cb-login-dica">Vale para todos os bots · quando terminar, clique em Parar</p></div></div>`;
}

// ---- Seu espaço › Computador do bot ----------------------------------------------------------------------------------

function memoriaEmUso(dto: ComputadorPessoaDto): number | null {
  if (!dto.memoria || dto.memoria.totalMb <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((dto.memoria.usadaMb / dto.memoria.totalMb) * 100)));
}

/** A memória é "cheia" a partir de 90% ou quando já há bot esperando tela. */
export function memoriaCheia(dto: ComputadorPessoaDto): boolean {
  const pct = memoriaEmUso(dto);
  return dto.esperando.length > 0 || (pct !== null && pct >= 90);
}

function telasAbertas(dto: ComputadorPessoaDto): TelaDaPessoa[] {
  return dto.telas.filter((t) => t.estado === "aberta" || t.estado === "abrindo");
}

function haQuantoTempo(ms: number): string {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
}

function rotuloDoEstadoPc(dto: ComputadorPessoaDto): string {
  if (dto.operacao) return `<span class="maq-estado">${htmlAnel(pctDaOperacao(dto))}${esc(dicaDaOperacao(dto) ?? "")}</span>`;
  switch (dto.estado) {
    case "dormindo": return `<span class="maq-estado pc-dorme">${ICONE_CB.relogio}dormindo</span>`;
    case "ligando": return `<span class="maq-estado">${GIRO}ligando</span>`;
    case "fora_do_ar": return '<span class="maq-estado"><span class="tag tag-ambar">fora do ar</span></span>';
    default: return '<span class="maq-estado"><span class="maq-ponto" aria-hidden="true"></span>ligado</span>';
  }
}

const ACOES_PAINEL: readonly { op: OperacaoPessoa; grupo: "Manutenção" | "Logins"; titulo: string; texto: string; botao: string; perigo?: true }[] = [
  { op: "atualizar", grupo: "Manutenção", titulo: "Atualizar", texto: "Reinicia o computador com a versão mais nova. Arquivos e logins ficam.", botao: "Atualizar" },
  { op: "redefinir", grupo: "Manutenção", titulo: "Redefinir", texto: "Recria o computador do zero: apaga os arquivos e o que foi instalado. Os logins ficam.", botao: "Redefinir…", perigo: true },
  { op: "sair_de_todos", grupo: "Logins", titulo: "Sair de todos os sites", texto: "Seus bots saem de todas as contas em que entraram neste computador.", botao: "Sair de todos…", perigo: true },
];

/**
 * A seção nova de Seu espaço, depois de Máquinas. Na ordem: o estado e a memória; as telas abertas, por bot, com
 * Abrir; Manutenção (Atualizar, Redefinir); Logins (Sair de todos os sites); a Atividade. Redefinir e Sair pedem
 * confirmação; o progresso fica no cartão (e no menu da conta), nunca num toast.
 */
export function htmlPainelComputadorDoBot(dto: ComputadorPessoaDto, bots: readonly BotVisto[], ui: ComputadorUi, agora: number, avisoDispensado = false): string {
  const bot = (id: string | null) => (id ? bots.find((b) => b.id === id) : undefined);
  const faixa = dto.aviso_recriado && !avisoDispensado
    ? `<div class="pc-faixa" role="status">${ICONE_CB.info}<div><b>Entre nos sites de novo uma vez</b><p>O computador do bot foi recriado e os logins não vieram junto. Da próxima vez que um bot precisar de um site com login, ele pede para você entrar; o login vale para todos.</p></div>${ghost("Entendi", 'data-act="entendi-computador"')}</div>`
    : "";
  const fora = dto.estado === "fora_do_ar"
    ? `<div class="pc-faixa alerta" role="status">${ICONE_CB.info}<div><b>O computador parou de responder</b><p>${esc(dto.falha ? textoDaFalha(dto.falha.motivo) : "Atualizar costuma resolver.")}</p></div>${ghost("Tentar de novo", 'data-act="operar-computador" data-op="tentar_de_novo"')}</div>`
    : "";
  const ligado = dto.ligadoDesde && dto.estado !== "dormindo" ? ` · ligado ${haQuantoTempo(agora - dto.ligadoDesde)}` : "";
  const abertas = telasAbertas(dto);
  const pct = memoriaEmUso(dto);
  const cheia = memoriaCheia(dto);
  const memoria = dto.estado === "dormindo" || pct === null
    ? ""
    : `<div class="pc-memoria"><div class="pc-mem-cab"><span>Memória</span><span>${abertas.length} ${abertas.length === 1 ? "tela" : "telas"} · ${pct}%${cheia ? " · cheia" : ""}</span></div><div class="pc-barra${cheia ? " cheia" : ""}" role="meter" aria-label="Memória em uso" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><i style="width:${pct}%"></i></div></div>`;
  const progresso = dto.operacao
    ? `<div class="pc-prog-inline"><div class="pc-mem-cab"><span>${esc(NOME_OPERACAO[dto.operacao.tipo].gerundio)} o computador</span><span>${pctDaOperacao(dto)}%</span></div><div class="pc-barra grande" role="progressbar" aria-label="Progresso" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pctDaOperacao(dto)}"><i style="width:${pctDaOperacao(dto)}%"></i></div>${htmlEtapas(dto.operacao.tipo, dto.operacao.etapa, pctDaOperacao(dto))}</div>`
    : "";
  const acordar = dto.estado === "dormindo" ? `<div class="pc-acao"><span class="pc-acao-txt"><b>Dormindo</b><span>Acorda sozinho quando um bot precisar.</span></span>${ghost("Acordar", 'data-act="operar-computador" data-op="acordar"')}</div>` : "";
  const cartao = `<div class="espaco-cartao pc-cartao"><div class="maq-cab"><span class="maq-ic" aria-hidden="true">${ICONE_CB.pcBot}</span><span class="maq-id"><b>Computador do bot</b><small>${esc(`${dto.maquina?.nome ?? "Linux"} · Chrome${ligado}`)}</small></span>${rotuloDoEstadoPc(dto)}</div>${memoria}${progresso}${acordar ? `<div class="pc-memoria">${acordar}</div>` : ""}</div>`;

  const linhaTela = (t: TelaDaPessoa) => {
    const b = bot(t.agenteId);
    const nome = b?.nome ?? "Bot";
    const quando = t.controle === "pessoa" ? "você está no controle" : t.ultimaAcaoEm ? (agora - t.ultimaAcaoEm < 60_000 ? "ativo agora" : `parado ${haQuantoTempo(agora - t.ultimaAcaoEm)}`) : t.estado === "abrindo" ? "abrindo" : "aberta";
    const sub = [t.titulo ?? "", quando].filter(Boolean).join(" · ");
    return `<div class="bot-maq pc-tela">${b ? htmlMascote(b, "sm") : ""}<span class="bot-maq-txt"><b>${esc(nome)}</b><span>${esc(sub)}</span></span><button type="button" class="bt sm" data-act="abrir-computador" data-id="${esc(t.agenteId)}" aria-label="Abrir a tela de ${esc(nome)}">Abrir</button></div>`;
  };
  const esperando = dto.esperando.map((id) => bot(id)?.nome ?? "Bot");
  const telas = `<h3 class="espaco-subtitulo">Telas abertas</h3>${abertas.length
    ? `<div class="espaco-cartao bots-cartao pc-telas">${abertas.map(linhaTela).join("")}</div>`
    : `<div class="espaco-cartao"><p class="pc-vazio">${dto.estado === "dormindo" ? "O computador está dormindo. Nenhuma tela aberta." : "Nenhum bot está usando o navegador agora."}</p></div>`}${esperando.length ? `<p class="mudo sm">${esc(`Esperando uma tela livre: ${listaDeNomes(esperando)}.`)}</p>` : ""}`;

  const emCurso = Boolean(dto.operacao);
  const acao = (a: (typeof ACOES_PAINEL)[number]) => {
    const realce = ui.realce === a.op || (ui.realce === "tentar_de_novo" && a.op === "atualizar");
    return `<div class="pc-acao${realce ? " realce" : ""}" data-pc-acao="${a.op}"><span class="pc-acao-txt"><b>${esc(a.titulo)}${realce ? ' <span class="pc-sugerido">sugerido</span>' : ""}</b><span>${esc(a.texto)}</span></span><button type="button" class="bt sm${a.perigo ? " perigo" : ""}" data-act="operar-computador" data-op="${a.op}"${emCurso || dto.estado === "ligando" ? " disabled" : ""}>${esc(a.botao)}</button></div>`;
  };
  const grupo = (g: "Manutenção" | "Logins") => `<h3 class="espaco-subtitulo">${g}</h3><div class="espaco-cartao pc-acoes">${ACOES_PAINEL.filter((a) => a.grupo === g).map(acao).join("")}</div>`;

  const atividade = (dto.atividade ?? []).slice(0, 8).map((a) => {
    const b = bot(a.agenteId);
    const quem = b ? htmlMascote(b, "sm") : '<span class="av-me pc-eu" aria-hidden="true">eu</span>';
    return `<li>${quem}<span><b>${esc(b?.nome ?? "Você")}</b> ${esc(a.texto)}</span><time>${esc(new Date(a.em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }))}</time></li>`;
  }).join("");
  const atividadeHtml = atividade ? `<h3 class="espaco-subtitulo">Atividade</h3><ol class="espaco-cartao pc-atividade">${atividade}</ol>` : "";

  return `<section class="espaco-secao seu-pc" aria-labelledby="pc-titulo">${faixa}${fora}<h2 id="pc-titulo">Computador do bot</h2><p class="intro">Um computador para todos os seus bots. Cada bot tem a própria tela e o próprio navegador, e um login feito aqui vale para todos.</p>${cartao}${telas}${grupo("Manutenção")}${grupo("Logins")}${atividadeHtml}${htmlDialogoDoPainel(dto, bots, ui)}</section>`;
}

/** Os diálogos do painel: a confirmação (o foco começa em Cancelar) e as etapas, sem Cancelar no meio. */
export function htmlDialogoDoPainel(dto: ComputadorPessoaDto, bots: readonly BotVisto[], ui: ComputadorUi): string {
  const nomesAbertos = telasAbertas(dto).map((t) => bots.find((b) => b.id === t.agenteId)?.nome ?? "Bot");
  const acoes = (confirmar: string, rotulo: string) => `<div class="cl-dialogo-acoes"><button type="button" class="bt" data-act="pc-cancelar" data-cl-autofoco>Cancelar</button><button type="button" class="bt perigo" data-act="pc-confirmar" data-op="${confirmar}">${esc(rotulo)}</button></div>`;
  if (ui.confirmar === "redefinir") {
    const fecham = nomesAbertos.length ? `${nomesAbertos.length === 1 ? "A tela de" : "As telas de"} ${listaDeNomes(nomesAbertos)} ${nomesAbertos.length === 1 ? "fecha" : "fecham"} agora, e cada um recebe uma linha na conversa. Leva alguns minutos.` : "Leva alguns minutos.";
    return `<div class="cl-fundo" data-act="pc-cancelar"></div><div class="cl-dialogo" role="dialog" aria-modal="true" aria-labelledby="pc-red-tit"><h3 id="pc-red-tit">Redefinir o computador?</h3><p>Ele é recriado do zero: os arquivos dos seus bots e o que foi instalado são apagados. Os logins continuam.</p><div class="cl-caixa">${esc(fecham)}</div><p class="mudo pc-obs">Para sair das contas, use Sair de todos os sites.</p>${acoes("redefinir", "Redefinir")}</div>`;
  }
  if (ui.confirmar === "sair_de_todos") {
    return `<div class="cl-fundo" data-act="pc-cancelar"></div><div class="cl-dialogo" role="dialog" aria-modal="true" aria-labelledby="pc-sair-tit"><h3 id="pc-sair-tit">Sair de todos os sites?</h3><p>Todos os seus bots saem de todas as contas em que entraram neste computador. Os arquivos ficam.</p><div class="cl-caixa">Da próxima vez que um bot precisar de um site com login, ele pede para você entrar de novo.</div>${acoes("sair_de_todos", "Sair de todos")}</div>`;
  }
  if (ui.etapasAbertas && dto.operacao) {
    const pct = pctDaOperacao(dto);
    const nome = NOME_OPERACAO[dto.operacao.tipo].gerundio;
    return `<div class="cl-fundo" data-act="pc-segundo-plano"></div><div class="cl-dialogo pc-progresso" role="dialog" aria-modal="true" aria-labelledby="pc-prog-tit"><h3 id="pc-prog-tit">${esc(nome)} o computador</h3><p class="pc-lead">Leva alguns minutos. Dá para fechar e seguir usando o nod.</p><div class="pc-barra grande" role="progressbar" aria-label="Progresso" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-valuetext="${esc(`${dto.operacao.etapa ?? nome}, ${pct}%`)}"><i style="width:${pct}%"></i></div>${htmlEtapas(dto.operacao.tipo, dto.operacao.etapa, pct)}<div class="cl-dialogo-acoes"><button type="button" class="cb-bt-ghost" data-act="pc-segundo-plano" data-cl-autofoco>Continuar em segundo plano</button></div></div>`;
  }
  return "";
}

/** A linha da seção Esta máquina / máquinas: quantas telas abertas o computador do bot tem agora. */
export function resumoDasTelas(dto: ComputadorPessoaDto, bots: readonly Pick<Agente, "id" | "nome">[]): string {
  if (dto.estado === "dormindo") return "Computador do bot dormindo";
  const abertas = telasAbertas(dto).map((t) => bots.find((b) => b.id === t.agenteId)?.nome ?? "Bot");
  if (!abertas.length) return "Computador do bot · nenhuma tela aberta";
  return `Computador do bot · ${abertas.length === 1 ? "tela aberta" : `${abertas.length} telas abertas`}: ${listaDeNomes(abertas)}`;
}

// ---- o que a web lembra entre uma leitura e outra ----------------------------------------------------------------------

/** Quanto tempo o ✓ ("Tela aberta", "Computador pronto") fica no chat antes de sumir. */
export const MS_OK = 2_000;

export type MemoriaDoComputador = {
  /** Desde quando a web vê cada bot esperando, e por quê. */
  esperas: Readonly<Record<string, { motivo: MotivoDaEspera; desde: number }>>;
  /** O ✓ de cada bot que acabou de sair da espera, até a hora. */
  oks: Readonly<Record<string, { texto: string; ate: number }>>;
  /** As telas que uma operação fechou: a linha fica no chat de cada um até a operação acabar. */
  fechadas: { tipo: OperacaoLonga; agentes: readonly string[] } | null;
  /** O ✓ do item de menu quando a operação acaba. */
  okMenuAte: number;
};
export const MEMORIA_INICIAL: MemoriaDoComputador = { esperas: {}, oks: {}, fechadas: null, okMenuAte: 0 };

/** A leitura nova contra a anterior: quem começou e quem parou de esperar, que telas a operação fechou. */
export function lembrarComputador(antes: ComputadorPessoaDto | null, dto: ComputadorPessoaDto, mem: MemoriaDoComputador, agora: number): MemoriaDoComputador {
  const ids = new Set([...dto.esperando, ...dto.telas.map((t) => t.agenteId), ...Object.keys(mem.esperas)]);
  const esperas: Record<string, { motivo: MotivoDaEspera; desde: number }> = {};
  const oks: Record<string, { texto: string; ate: number }> = {};
  for (const [id, ok] of Object.entries(mem.oks)) if (ok.ate > agora) oks[id] = ok;
  for (const id of ids) {
    const motivo = motivoDaEspera(dto, id);
    const anterior = mem.esperas[id];
    if (motivo) {
      esperas[id] = { motivo, desde: anterior?.motivo === motivo ? anterior.desde : agora };
      delete oks[id];
    } else if (anterior) {
      oks[id] = { texto: textoDoFimDaEspera(anterior.motivo), ate: agora + MS_OK };
    }
  }
  let fechadas = mem.fechadas;
  if (dto.operacao && !antes?.operacao && dto.operacao.tipo !== "sair_de_todos") {
    const abertas = (antes ?? dto).telas.filter((t) => t.estado === "aberta" || t.estado === "abrindo").map((t) => t.agenteId);
    fechadas = { tipo: dto.operacao.tipo, agentes: abertas };
  }
  let okMenuAte = mem.okMenuAte;
  if (!dto.operacao && antes?.operacao) {
    fechadas = null;
    okMenuAte = agora + MS_OK;
  }
  if (!dto.operacao && !antes) fechadas = null;
  return { esperas, oks, fechadas, okMenuAte };
}

/** O que entra no chat de um bot agora: a espera, o ✓ que acabou de chegar ou a linha da tela fechada. */
export function htmlLinhaDoChat(dto: ComputadorPessoaDto | null, mem: MemoriaDoComputador, agenteId: string, nomes: Readonly<Record<string, string>>, agora: number): string {
  if (!dto) return "";
  const aviso = htmlAvisoDeFalha(dto);
  const tela = dto.telas.find((t) => t.agenteId === agenteId);
  // O erro só aparece no chat de quem estava usando ou esperando o computador.
  if (aviso) return tela || mem.esperas[agenteId] ? aviso : "";
  const fechada = mem.fechadas?.agentes.includes(agenteId) && dto.operacao ? htmlLinhaTelaFechada(mem.fechadas.tipo, nomes[agenteId] ?? "o bot") : "";
  const espera = htmlLinhaDeEspera(dto, agenteId, nomes, mem.esperas[agenteId]?.desde ?? null, agora);
  if (fechada || espera) return fechada + espera;
  const ok = mem.oks[agenteId];
  return ok && ok.ate > agora ? htmlLinhaOk(ok.texto) : "";
}

/** O pedido de ajuda do bot (computador_pedir_ajuda) na v2: o login leve enquanto aberto; depois, uma linha cinza. */
export function htmlPedidoDeTela(motivo: string, agenteId: string, aberta: boolean): string {
  return aberta && agenteId ? htmlLogin({ agenteId, titulo: motivo }) : htmlLinhaOk(textoDeEntrou(motivo));
}

/**
 * "Entrou no portal de vendas": o pedido que começa por entrar/logar ("Entrar no portal de vendas") vira o lugar dito, até
 * a primeira pausa ("…, depois", " para ", "."). Senão, o último nome próprio depois de no/na/nos/nas ("verificar na
 * Amazon"); sem ele, "o site".
 */
export function textoDeEntrou(motivo: string): string {
  const frase = motivo.split(/[.;:!?()\n]\s|[;:!?()\n]|,|\s+(?:e|para|pra|depois|com)\s+/iu)[0] ?? "";
  const direto = frase.match(/^\s*(?:entr(?:ar|e)|logar|fa(?:zer|ça)\s+(?:o\s+)?login)\s+(n[oa]s?)\s+(.+?)[\s.]*$/iu);
  if (direto?.[1] && direto[2]) return `Entrou ${direto[1].toLowerCase()} ${direto[2]}`;
  const nome = String.raw`\p{Lu}[\p{L}\p{N}&-]*(?:\.[\p{L}\p{N}]+)*`;
  const achados = [...motivo.matchAll(new RegExp(String.raw`(?:^|\s)(n[oa]s?)\s+(${nome}(?:\s+${nome})*)`, "gu"))];
  const ultimo = achados.at(-1);
  return ultimo?.[1] && ultimo[2] ? `Entrou ${ultimo[1]} ${ultimo[2]}` : "Entrou no site";
}

/** O aviso de fora do ar que ficou na conversa (a mensagem do sistema), na v2: o card leve com o caminho, ou o registro. */
export function htmlAvisoForaDoArRegistrado(dto: ComputadorPessoaDto): string {
  return htmlAvisoDeFalha(dto) ?? htmlLinha({ segmentos: ["O computador voltou a responder"], icone: "ok" });
}
